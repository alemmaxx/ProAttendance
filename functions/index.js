// ProAttendance — Cloud Functions (codebase "proattendance")
// Semua fungsi berawalan pa_ supaya tidak bertembung dengan fungsi KUKUSAN / ProSewa.
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore('proattendance');
const TOYYIB_KEY = defineSecret('TOYYIBPAY_SECRET_KEY'); // dikongsi dengan KUKUSAN / ProSewa

const REGION = 'asia-southeast1';
const TOYYIB = 'https://toyyibpay.com';
const SITE = 'https://proattendancemy.web.app';
const TOYYIB_CATEGORY = 'mqp1yoga'; // kategori ToyyibPay ProAttendance
const PLAN_MONTHS = { monthly: 1, sixMonth: 6, yearly: 12 };
const PLAN_NAME = { monthly: 'Bulanan', sixMonth: '6 Bulan', yearly: 'Tahunan' };

async function requireAdmin(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sila log masuk.');
  const s = await db.doc(`users/${req.auth.uid}`).get();
  const me = s.exists ? s.data() : null;
  if (!me || me.role !== 'admin' || !me.cid) throw new HttpsError('permission-denied', 'Hanya admin syarikat.');
  return me;
}

async function getWorker(cid, workerId) {
  if (!/^[A-Z]{2,6}\d+$/.test(String(workerId || ''))) throw new HttpsError('invalid-argument', 'ID pekerja tidak sah.');
  const ref = db.doc(`companies/${cid}/workers/${workerId}`);
  const s = await ref.get();
  if (!s.exists || !s.data().uid) throw new HttpsError('not-found', 'Pekerja tidak dijumpai.');
  return { ref, data: s.data() };
}

// ---------------------------------------------------------------- Reset PIN pekerja
exports.pa_resetWorkerPin = onCall({ region: REGION }, async (req) => {
  const me = await requireAdmin(req);
  const pin = String(req.data?.pin || '');
  if (!/^\d{6}$/.test(pin)) throw new HttpsError('invalid-argument', 'PIN mesti 6 digit.');
  const w = await getWorker(me.cid, req.data?.workerId);
  await getAuth().updateUser(w.data.uid, { password: pin });
  await w.ref.update({ mustChangePin: true, pinResetAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ---------------------------------------------------------------- Aktif / nyahaktif pekerja
exports.pa_setWorkerActive = onCall({ region: REGION }, async (req) => {
  const me = await requireAdmin(req);
  const active = !!req.data?.active;
  const w = await getWorker(me.cid, req.data?.workerId);
  await getAuth().updateUser(w.data.uid, { disabled: !active });
  if (!active) await getAuth().revokeRefreshTokens(w.data.uid);
  await w.ref.update({ active });
  return { ok: true };
});

// ---------------------------------------------------------------- ToyyibPay: cipta bil
const clean = (s, n) => String(s || '').replace(/[^A-Za-z0-9 _]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

exports.pa_createBill = onCall({ region: REGION, secrets: [TOYYIB_KEY] }, async (req) => {
  const me = await requireAdmin(req);
  const plan = String(req.data?.plan || '');
  const months = PLAN_MONTHS[plan];
  if (!months) throw new HttpsError('invalid-argument', 'Pakej tidak sah.');

  const cfg = (await db.doc('config/plans').get()).data() || {};
  const price = Number(cfg[plan] || 0);
  if (!(price > 0)) throw new HttpsError('failed-precondition', 'Harga pakej belum ditetapkan.');

  const comp = (await db.doc(`companies/${me.cid}`).get()).data() || {};
  const ref = db.collection('payments').doc();
  const project = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
  const phone = String(comp.phone || '').replace(/\D/g, '') || '0123456789';

  const body = new URLSearchParams({
    userSecretKey: TOYYIB_KEY.value(),
    categoryCode: TOYYIB_CATEGORY,
    billName: clean(`Langganan ${PLAN_NAME[plan]}`, 30),
    billDescription: clean(`${comp.name || ''} ${comp.code || ''} langganan ${months} bulan`, 100),
    billPriceSetting: '1',
    billPayorInfo: '1',
    billAmount: String(Math.round(price * 100)),
    billReturnUrl: `${SITE}/admin.html?pay=${ref.id}`,
    billCallbackUrl: `https://${REGION}-${project}.cloudfunctions.net/pa_toyyibCallback`,
    billExternalReferenceNo: ref.id,
    billTo: clean(comp.name || 'Pelanggan', 60) || 'Pelanggan',
    billEmail: req.auth.token.email || comp.ownerEmail || 'noreply@proattendance.app',
    billPhone: phone,
    billPaymentChannel: '0',
    billExpiryDays: '3'
  });

  const res = await fetch(`${TOYYIB}/index.php/api/createBill`, { method: 'POST', body });
  const text = await res.text();
  let billCode = null;
  try { billCode = JSON.parse(text)?.[0]?.BillCode; } catch { /* abaikan */ }
  if (!billCode) {
    console.error('ToyyibPay createBill gagal:', text);
    throw new HttpsError('internal', 'Gagal mencipta bil bayaran.');
  }

  await ref.set({
    cid: me.cid, plan, months, amount: price, billCode, status: 'pending',
    email: req.auth.token.email || '', createdAt: FieldValue.serverTimestamp()
  });
  return { url: `${TOYYIB}/${billCode}`, id: ref.id };
});

// ---------------------------------------------------------------- Sahkan & lanjutkan langganan
async function settle(paymentId) {
  const pRef = db.doc(`payments/${paymentId}`);
  const pSnap = await pRef.get();
  if (!pSnap.exists) return { status: 'not-found' };
  const p = pSnap.data();
  if (p.status === 'paid') return { status: 'paid' };

  // Semak status sebenar terus dari ToyyibPay (jangan percaya callback sahaja)
  const res = await fetch(`${TOYYIB}/index.php/api/getBillTransactions`, {
    method: 'POST',
    body: new URLSearchParams({ billCode: p.billCode })
  });
  const text = await res.text();
  let tx = [];
  try { tx = JSON.parse(text); } catch { tx = []; }
  const paid = Array.isArray(tx) && tx.find(t => String(t.billpaymentStatus) === '1');
  if (!paid) {
    const failed = Array.isArray(tx) && tx.length && tx.every(t => String(t.billpaymentStatus) === '3');
    if (failed) await pRef.update({ status: 'failed' });
    return { status: failed ? 'failed' : 'pending' };
  }

  await db.runTransaction(async (t) => {
    const ps = await t.get(pRef);
    if (ps.data().status === 'paid') return;
    const cRef = db.doc(`companies/${p.cid}`);
    const cs = await t.get(cRef);
    const cur = cs.data()?.expiry?.toMillis?.() || 0;
    const base = new Date(Math.max(Date.now(), cur));
    base.setMonth(base.getMonth() + Number(p.months || 1));
    t.update(cRef, { expiry: Timestamp.fromDate(base), status: 'active', plan: p.plan, lastPaidAt: FieldValue.serverTimestamp() });
    t.update(pRef, {
      status: 'paid', paidAt: FieldValue.serverTimestamp(),
      refNo: paid.billpaymentInvoiceNo || '', newExpiry: Timestamp.fromDate(base)
    });
  });
  return { status: 'paid' };
}

// Callback dari ToyyibPay (POST form)
exports.pa_toyyibCallback = onRequest({ region: REGION }, async (req, res) => {
  try {
    const id = req.body?.order_id || req.query?.order_id;
    if (!id) { res.status(400).send('missing order_id'); return; }
    const r = await settle(String(id));
    res.status(200).send(`OK ${r.status}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('ERR');
  }
});

// Semakan dari halaman admin selepas kembali dari ToyyibPay
exports.pa_checkPayment = onCall({ region: REGION }, async (req) => {
  const me = await requireAdmin(req);
  const id = String(req.data?.id || '');
  const s = await db.doc(`payments/${id}`).get();
  if (!s.exists || s.data().cid !== me.cid) throw new HttpsError('not-found', 'Bayaran tidak dijumpai.');
  return settle(id);
});
