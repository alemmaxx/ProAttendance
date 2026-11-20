// ProAttendance — Cloud Functions (codebase "proattendance")
// Semua fungsi berawalan pa_ supaya tidak bertembung dengan fungsi KUKUSAN / ProSewa.
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');

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
  // Kod promo diskaun (%)
  let promo = '', discount = 0, price0 = price;
  const pcode = String(req.data?.promo || '').trim().toUpperCase();
  if (pcode) {
    const ps = await db.doc(`promos/${pcode}`).get();
    const pd = ps.exists ? ps.data() : null;
    if (!pd || pd.used || pd.type !== 'percent') throw new HttpsError('failed-precondition', 'Kod promo tidak sah atau telah digunakan.');
    discount = Math.min(100, Number(pd.value || 0)); promo = pcode;
  }
  const finalPrice = Math.round(price0 * (100 - discount)) / 100;
  if (!(finalPrice >= 1)) throw new HttpsError('failed-precondition', 'Jumlah selepas diskaun terlalu rendah. Hubungi kami.');
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
    billAmount: String(Math.round(finalPrice * 100)),
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
    cid: me.cid, plan, months, amount: finalPrice, listPrice: price0, promo, discount, ref: comp.ref || '', billCode, status: 'pending',
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
    if (p.promo) t.set(db.doc(`promos/${p.promo}`), { used: true, usedBy: p.cid, usedByName: cs.data()?.name || '', usedAt: FieldValue.serverTimestamp() }, { merge: true });
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

// ---------------------------------------------------------------- Kod promo
// Jenis 'days' → terus tambah hari langganan. Jenis 'percent' → disahkan sahaja; digunakan semasa bayar.
exports.pa_redeemPromo = onCall({ region: REGION }, async (req) => {
  const me = await requireAdmin(req);
  const code = String(req.data?.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,30}$/.test(code)) throw new HttpsError('invalid-argument', 'Kod promo tidak sah.');
  const pRef = db.doc(`promos/${code}`);
  return db.runTransaction(async (t) => {
    const ps = await t.get(pRef);
    const p = ps.exists ? ps.data() : null;
    if (!p || p.used) throw new HttpsError('failed-precondition', 'Kod promo tidak sah atau telah digunakan.');
    if (p.type === 'percent') return { type: 'percent', value: Number(p.value || 0) };
    const days = Number(p.value || 0);
    if (!(days > 0)) throw new HttpsError('failed-precondition', 'Kod promo tidak sah.');
    const cRef = db.doc(`companies/${me.cid}`);
    const cs = await t.get(cRef);
    const cur = cs.data()?.expiry?.toMillis?.() || 0;
    const base = new Date(Math.max(Date.now(), cur));
    base.setDate(base.getDate() + days);
    t.update(cRef, { expiry: Timestamp.fromDate(base) });
    t.update(pRef, { used: true, usedBy: me.cid, usedByName: cs.data()?.name || '', usedAt: FieldValue.serverTimestamp() });
    return { type: 'days', value: days, expiry: base.toISOString() };
  });
});

// ---------------------------------------------------------------- Notifikasi push
const KIND = { leave: 'Cuti', ot: 'OT', fix: 'Pembetulan punch', claim: 'Tuntutan', advance: 'Pendahuluan gaji', swap: 'Tukar syif' };
const TRIG = (document) => ({ document, database: 'proattendance', region: REGION });

async function sendTo(cid, filter, title, body, link) {
  const s = await db.collection(`companies/${cid}/tokens`).get();
  const list = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(filter).filter(t => t.token);
  if (!list.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens: list.map(t => t.token),
    webpush: { notification: { title, body, icon: '/icon-192.png' }, fcmOptions: { link: SITE + link } }
  });
  // Buang token yang tidak sah lagi
  await Promise.all(res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || ''))
    ? db.doc(`companies/${cid}/tokens/${list[i].id}`).delete().catch(() => {}) : null));
}

exports.pa_onRequestCreated = onDocumentCreated(TRIG('companies/{cid}/requests/{rid}'), async (e) => {
  const r = e.data?.data(); if (!r) return;
  await sendTo(e.params.cid, t => t.role === 'admin', 'Permohonan baharu', `${r.name}: ${KIND[r.kind] || r.kind}`, '/admin.html');
});

exports.pa_onRequestUpdated = onDocumentUpdated(TRIG('companies/{cid}/requests/{rid}'), async (e) => {
  const b = e.data?.before?.data(), a = e.data?.after?.data();
  if (!a || !b || a.status === b.status || !['approved', 'rejected'].includes(a.status)) return;
  await sendTo(e.params.cid, t => t.id === a.uid,
    a.status === 'approved' ? 'Permohonan diluluskan ✓' : 'Permohonan ditolak',
    `${KIND[a.kind] || a.kind}${a.adminNote ? ' — ' + a.adminNote : ''}`, '/worker');
});

// Borang tuntutan bulanan: hantar → semak penyelia → lulus finance/boss → dibayar
exports.pa_onClaim = onDocumentWritten(TRIG('companies/{cid}/claims/{id}'), async (e) => {
  const b = e.data?.before?.exists ? e.data.before.data() : null, a = e.data?.after?.exists ? e.data.after.data() : null;
  if (!a || (b && b.status === a.status)) return;
  const cid = e.params.cid, mo = a.month || '', who = `${a.name || ''} (${a.workerId || ''})`;
  const full = t => t.role === 'admin' && t.perm !== 'supervisor';
  if (a.status === 'submitted') {
    await sendTo(cid, t => t.role === 'admin', 'Tuntutan baharu untuk disemak', `${who} · ${mo}`, '/admin.html');
  } else if (a.status === 'checked') {
    await sendTo(cid, full, 'Tuntutan menunggu kelulusan', `${who} · ${mo} · disemak oleh ${a.checkedBy || 'penyelia'}`, '/admin.html');
    await sendTo(cid, t => t.id === a.uid, 'Tuntutan disemak ✓', `Tuntutan ${mo} sudah disemak penyelia dan dihantar ke finance.`, '/worker');
  } else if (a.status === 'approved') {
    await sendTo(cid, t => t.id === a.uid, 'Tuntutan diluluskan ✓', `Tuntutan ${mo} diluluskan${a.approvedBy ? ' oleh ' + a.approvedBy : ''}.`, '/worker');
  } else if (a.status === 'rejected') {
    await sendTo(cid, t => t.id === a.uid, 'Tuntutan ditolak', `Tuntutan ${mo}${a.adminNote ? ' — ' + a.adminNote : ''}. Sila betulkan & hantar semula.`, '/worker');
  } else if (a.status === 'paid') {
    await sendTo(cid, t => t.id === a.uid, 'Tuntutan dibayar 💰', `Tuntutan ${mo} sudah dibayar${a.paidRef ? ' (' + a.paidRef + ')' : ''}.`, '/worker');
  }
});

// Slip gaji diterbitkan
exports.pa_onPayslip = onDocumentCreated(TRIG('companies/{cid}/payslips/{id}'), async (e) => {
  const x = e.data?.data(); if (!x || !x.uid) return;
  await sendTo(e.params.cid, t => t.id === x.uid, 'Slip gaji baharu', `Slip gaji ${x.period || ''} sudah tersedia.`, '/worker');
});

exports.pa_onAnnouncement = onDocumentCreated(TRIG('companies/{cid}/announcements/{aid}'), async (e) => {
  const a = e.data?.data(); if (!a) return;
  await sendTo(e.params.cid, t => t.role === 'worker', a.title || 'Pengumuman', String(a.body || '').slice(0, 140), '/worker');
});

exports.pa_onTask = onDocumentCreated(TRIG('companies/{cid}/tasks/{tid}'), async (e) => {
  const x = e.data?.data(); if (!x) return;
  await sendTo(e.params.cid, t => t.id === x.uid, 'Tugasan baharu', x.title || '', '/worker');
});
