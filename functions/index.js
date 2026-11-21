// ProAttendance — Cloud Functions (codebase "proattendance")
// Semua fungsi berawalan pa_ supaya tidak bertembung dengan fungsi KUKUSAN / ProSewa.
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

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
  await w.ref.update({ mustChangePin: true, tempPin: pin, pinResetAt: FieldValue.serverTimestamp() });
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

// to: uid pekerja, 'workers' (semua pekerja) atau 'admins' — disimpan dalam peti notifikasi app (loceng)
async function sendTo(cid, filter, title, body, link, to) {
  if (to) await db.collection(`companies/${cid}/inbox`).add({ to, title, body: String(body || '').slice(0, 300), link: link || '', at: FieldValue.serverTimestamp() }).catch(e => console.warn('inbox', e.message));
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
  await sendTo(e.params.cid, t => t.role === 'admin', 'Permohonan baharu', `${r.name}: ${KIND[r.kind] || r.kind}`, '/admin.html', 'admins');
});

exports.pa_onRequestUpdated = onDocumentUpdated(TRIG('companies/{cid}/requests/{rid}'), async (e) => {
  const b = e.data?.before?.data(), a = e.data?.after?.data();
  if (!a || !b || a.status === b.status || !['approved', 'rejected'].includes(a.status)) return;
  await sendTo(e.params.cid, t => t.id === a.uid,
    a.status === 'approved' ? 'Permohonan diluluskan ✓' : 'Permohonan ditolak',
    `${KIND[a.kind] || a.kind}${a.adminNote ? ' — ' + a.adminNote : ''}`, '/worker', a.uid);
});

// Borang tuntutan bulanan: hantar → semak penyelia → lulus finance/boss → dibayar
exports.pa_onClaim = onDocumentWritten(TRIG('companies/{cid}/claims/{id}'), async (e) => {
  const b = e.data?.before?.exists ? e.data.before.data() : null, a = e.data?.after?.exists ? e.data.after.data() : null;
  if (!a || (b && b.status === a.status)) return;
  const cid = e.params.cid, mo = a.month || '', who = `${a.name || ''} (${a.workerId || ''})`;
  const full = t => t.role === 'admin' && t.perm !== 'supervisor';
  if (a.status === 'submitted') {
    await sendTo(cid, t => t.role === 'admin', 'Tuntutan baharu untuk disemak', `${who} · ${mo}`, '/admin.html', 'admins');
  } else if (a.status === 'checked') {
    await sendTo(cid, full, 'Tuntutan menunggu kelulusan', `${who} · ${mo} · disemak oleh ${a.checkedBy || 'penyelia'}`, '/admin.html', 'admins');
    await sendTo(cid, t => t.id === a.uid, 'Tuntutan disemak ✓', `Tuntutan ${mo} sudah disemak penyelia dan dihantar ke finance.`, '/worker', a.uid);
  } else if (a.status === 'approved') {
    await sendTo(cid, t => t.id === a.uid, 'Tuntutan diluluskan ✓', `Tuntutan ${mo} diluluskan${a.approvedBy ? ' oleh ' + a.approvedBy : ''}.`, '/worker', a.uid);
  } else if (a.status === 'rejected') {
    await sendTo(cid, t => t.id === a.uid, 'Tuntutan ditolak', `Tuntutan ${mo}${a.adminNote ? ' — ' + a.adminNote : ''}. Sila betulkan & hantar semula.`, '/worker', a.uid);
  } else if (a.status === 'paid') {
    await sendTo(cid, t => t.id === a.uid, 'Tuntutan dibayar 💰', `Tuntutan ${mo} sudah dibayar${a.paidRef ? ' (' + a.paidRef + ')' : ''}.`, '/worker', a.uid);
  }
});

// Slip gaji diterbitkan
exports.pa_onPayslip = onDocumentCreated(TRIG('companies/{cid}/payslips/{id}'), async (e) => {
  const x = e.data?.data(); if (!x || !x.uid) return;
  await sendTo(e.params.cid, t => t.id === x.uid, 'Slip gaji baharu', `Slip gaji ${x.period || ''} sudah tersedia.`, '/worker', x.uid);
});

exports.pa_onAnnouncement = onDocumentCreated(TRIG('companies/{cid}/announcements/{aid}'), async (e) => {
  const a = e.data?.data(); if (!a) return;
  await sendTo(e.params.cid, t => t.role === 'worker', a.title || 'Pengumuman', String(a.body || '').slice(0, 140), '/worker', 'workers');
});

exports.pa_onTask = onDocumentCreated(TRIG('companies/{cid}/tasks/{tid}'), async (e) => {
  const x = e.data?.data(); if (!x) return;
  await sendTo(e.params.cid, t => t.id === x.uid, 'Tugasan baharu', x.title || '', '/worker', x.uid);
});


// ================================================================ LOG MASUK CAP JARI / FACE ID (passkey, WebAuthn)
// Pekerja daftar sekali (selepas log masuk dengan ID + PIN), kemudian log masuk dengan
// kunci skrin telefon. Kunci awam disimpan di passkeys/{credId}; cabaran di passkeyChallenges.
const RP_ID = 'proattendancemy.web.app';
const RP_NAME = 'ProAttendance';
const ORIGINS = ['https://proattendancemy.web.app', 'https://proattendancemy.firebaseapp.com'];
const swa = () => import('@simplewebauthn/server');
const b64u = {
  enc: (u8) => Buffer.from(u8).toString('base64url'),
  dec: (s) => new Uint8Array(Buffer.from(String(s), 'base64url'))
};
async function newChallenge(data) {
  const ref = db.collection('passkeyChallenges').doc();
  await ref.set({ ...data, exp: Date.now() + 5 * 60 * 1000 });
  return ref.id;
}
async function takeChallenge(id) {
  if (!/^[A-Za-z0-9]{10,40}$/.test(String(id || ''))) throw new HttpsError('invalid-argument', 'Cabaran tidak sah.');
  const ref = db.doc(`passkeyChallenges/${id}`);
  const s = await ref.get();
  if (!s.exists) throw new HttpsError('deadline-exceeded', 'Sesi tamat. Cuba lagi.');
  await ref.delete();
  const c = s.data();
  if (c.exp < Date.now()) throw new HttpsError('deadline-exceeded', 'Sesi tamat. Cuba lagi.');
  return c;
}
async function requireWorker(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sila log masuk.');
  const s = await db.doc(`users/${req.auth.uid}`).get();
  const me = s.exists ? s.data() : null;
  if (!me || me.role !== 'worker' || !me.cid || !me.workerId) throw new HttpsError('permission-denied', 'Hanya akaun pekerja.');
  return me;
}

exports.pa_passkeyRegOptions = onCall({ region: REGION }, async (req) => {
  const me = await requireWorker(req);
  const { generateRegistrationOptions } = await swa();
  const mine = await db.collection('passkeys').where('uid', '==', req.auth.uid).get();
  const opts = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: RP_ID,
    userName: me.workerId, userDisplayName: me.name || me.workerId,
    userID: new TextEncoder().encode(req.auth.uid),
    attestationType: 'none',
    excludeCredentials: mine.docs.map(d => ({ id: d.id, transports: d.data().transports || [] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' }
  });
  const challengeId = await newChallenge({ kind: 'reg', uid: req.auth.uid, challenge: opts.challenge });
  return { options: opts, challengeId };
});

exports.pa_passkeyRegVerify = onCall({ region: REGION }, async (req) => {
  const me = await requireWorker(req);
  const c = await takeChallenge(req.data?.challengeId);
  if (c.kind !== 'reg' || c.uid !== req.auth.uid) throw new HttpsError('permission-denied', 'Cabaran tidak sepadan.');
  const { verifyRegistrationResponse } = await swa();
  let v;
  try {
    v = await verifyRegistrationResponse({ response: req.data?.response, expectedChallenge: c.challenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID, requireUserVerification: true });
  } catch (e) { throw new HttpsError('invalid-argument', 'Pendaftaran gagal: ' + (e.message || e)); }
  if (!v.verified || !v.registrationInfo) throw new HttpsError('invalid-argument', 'Pendaftaran tidak sah.');
  const cr = v.registrationInfo.credential;
  await db.doc(`passkeys/${cr.id}`).set({
    uid: req.auth.uid, cid: me.cid, workerId: me.workerId,
    publicKey: b64u.enc(cr.publicKey), counter: cr.counter || 0, transports: cr.transports || [],
    device: String(req.data?.device || '').slice(0, 120), createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true, credId: cr.id };
});

exports.pa_passkeyAuthOptions = onCall({ region: REGION }, async (req) => {
  const { generateAuthenticationOptions } = await swa();
  const hint = String(req.data?.credId || '');
  const opts = await generateAuthenticationOptions({
    rpID: RP_ID, userVerification: 'required',
    allowCredentials: /^[A-Za-z0-9_-]{10,512}$/.test(hint) ? [{ id: hint }] : []
  });
  const challengeId = await newChallenge({ kind: 'auth', challenge: opts.challenge });
  return { options: opts, challengeId };
});

exports.pa_passkeyAuthVerify = onCall({ region: REGION }, async (req) => {
  const c = await takeChallenge(req.data?.challengeId);
  if (c.kind !== 'auth') throw new HttpsError('permission-denied', 'Cabaran tidak sepadan.');
  const resp = req.data?.response;
  const id = String(resp?.id || '');
  if (!/^[A-Za-z0-9_-]{10,512}$/.test(id)) throw new HttpsError('invalid-argument', 'Kelayakan tidak sah.');
  const ref = db.doc(`passkeys/${id}`);
  const s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', 'Cap jari / Face ID ini belum didaftarkan. Log masuk dengan ID & PIN, kemudian aktifkan semula di Profil.');
  const pk = s.data();
  const { verifyAuthenticationResponse } = await swa();
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: resp, expectedChallenge: c.challenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID, requireUserVerification: true,
      credential: { id, publicKey: b64u.dec(pk.publicKey), counter: pk.counter || 0, transports: pk.transports || [] }
    });
  } catch (e) { throw new HttpsError('permission-denied', 'Pengesahan gagal: ' + (e.message || e)); }
  if (!v.verified) throw new HttpsError('permission-denied', 'Pengesahan gagal.');
  // Pekerja masih aktif?
  const w = await db.doc(`companies/${pk.cid}/workers/${pk.workerId}`).get();
  if (!w.exists || w.data().active === false || w.data().uid !== pk.uid) throw new HttpsError('permission-denied', 'Akaun pekerja tidak aktif.');
  await ref.update({ counter: v.authenticationInfo.newCounter || 0, lastUsed: FieldValue.serverTimestamp() });
  let token;
  try { token = await getAuth().createCustomToken(pk.uid); }
  catch (e) {
    console.error('createCustomToken', e);
    throw new HttpsError('failed-precondition', 'Log masuk cap jari belum disediakan sepenuhnya oleh pentadbir sistem (kebenaran token). Sila guna ID & PIN.');
  }
  return { token, workerId: pk.workerId };
});

exports.pa_passkeyRemove = onCall({ region: REGION }, async (req) => {
  await requireWorker(req);
  const mine = await db.collection('passkeys').where('uid', '==', req.auth.uid).get();
  await Promise.all(mine.docs.map(d => d.ref.delete()));
  return { removed: mine.size };
});


// ================================================================ PERINGATAN LANGGANAN HAMPIR TAMAT
// Setiap pagi 9:00 (waktu Malaysia): notifikasi kepada pemilik / pengurus 7, 3 & 1 hari sebelum tamat, dan pada hari tamat.
exports.pa_expiryReminder = onSchedule({ schedule: 'every day 09:00', timeZone: 'Asia/Kuala_Lumpur', region: REGION }, async () => {
  const now = Date.now(), DAY = 86400000;
  const s = await db.collection('companies').where('expiry', '<=', Timestamp.fromMillis(now + 8 * DAY)).where('expiry', '>=', Timestamp.fromMillis(now - DAY)).get();
  const full = t => t.role === 'admin' && t.perm !== 'supervisor';
  await Promise.all(s.docs.map(async d => {
    const c = d.data();
    if (c.status === 'suspended') return;
    const left = Math.ceil((c.expiry.toMillis() - now) / DAY);
    if (![7, 3, 1, 0].includes(left)) return;
    const what = c.status === 'trial' ? 'Tempoh percubaan' : 'Langganan';
    const body = left > 0
      ? `${what} ${c.name || ''} tamat dalam ${left} hari. Bayar sekarang supaya pekerja boleh terus punch.`
      : `${what} ${c.name || ''} tamat hari ini. Pekerja tidak boleh punch selepas tamat — sila bayar.`;
    await sendTo(d.id, full, left > 0 ? `⏰ ${left} hari lagi` : '⚠️ Langganan tamat hari ini', body, '/', 'admins');
  }));
});


// ================================================================ AUTO TAMAT KERJA & PERINGATAN JEJAK LOKASI
// Setiap 15 minit. (1) Pekerja yang lupa tekan Tamat Kerja dikeluarkan automatik pada waktu tamat syif.
// (2) Jika jejak lokasi diaktifkan: pekerja yang sedang bekerja & tiada kemas kini lokasi > 2 jam dapat notifikasi.
const KL = 8 * 3600000;                                            // UTC+8
const klDate = (ms) => new Date(ms + KL).toISOString().slice(0, 10);
const klMs = (date, hm) => Date.parse(`${date}T${hm || '00:00'}:00Z`) - KL;
const hmOf = (ms) => new Date(ms + KL).toISOString().slice(11, 16);
function shiftFor(c, w, date, rosterVal) {
  const st = c.settings || {}, T = c.shiftTemplates || [];
  const byId = (id) => T.find(t => t.id === id);
  const hols = new Set((c.holidays || []).map(h => h.date));
  if (rosterVal === 'off') return null;
  if (rosterVal && byId(rosterVal)) return byId(rosterVal);
  if (hols.has(date)) return null;
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  const days = Array.isArray(w.workDays) && w.workDays.length ? w.workDays : (st.workDays || [1, 2, 3, 4, 5]);
  if (!days.includes(dow)) return null;
  return (w.defaultShift && byId(w.defaultShift)) || { start: st.workStart || '09:00', end: st.workEnd || '18:00', bStart: st.breakStart, bEnd: st.breakEnd };
}
exports.pa_attendanceWatch = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Asia/Kuala_Lumpur', region: REGION }, async () => {
  const now = Date.now(), today = klDate(now), yest = klDate(now - 86400000);
  const cos = await db.collection('companies').where('status', 'in', ['trial', 'active']).get();
  for (const cd of cos.docs) {
    const c = cd.data(), st = c.settings || {};
    if (c.expiry && c.expiry.toMillis() < now) continue;
    const autoOut = st.autoOut !== false, trail = !!st.trail;
    if (!autoOut && !trail) continue;
    const cid = cd.id;
    const att = await db.collection(`companies/${cid}/attendance`).where('date', 'in', [yest, today]).get();
    if (att.empty) continue;
    // Kumpul ikut pekerja + tarikh sesi
    const ses = {};
    att.docs.forEach(d => { const r = d.data(); if (!r.ts || r.type === 'visit') return; const k = `${r.workerId}|${r.date}`; (ses[k] = ses[k] || []).push({ ...r, _t: r.ts.toMillis() }); });
    const open = Object.entries(ses).map(([k, rs]) => { rs.sort((a, b) => a._t - b._t); return { k, rs, last: rs[rs.length - 1] }; }).filter(x => x.last.type !== 'out');
    if (!open.length) continue;
    const rosterCache = {}, workerCache = {};
    const roster = async (date) => rosterCache[date] ??= ((await db.doc(`companies/${cid}/roster/${date}`).get()).data()?.a || {});
    const worker = async (wid) => workerCache[wid] ??= ((await db.doc(`companies/${cid}/workers/${wid}`).get()).data() || null);
    let trailLast = null;
    for (const { rs, last } of open) {
      const wid = last.workerId, date = last.date, w = await worker(wid);
      if (!w || w.active === false) continue;
      const sh = shiftFor(c, w, date, (await roster(date))[wid]);
      const firstIn = rs.find(r => r.type === 'in');
      // Waktu tamat: tamat syif (merentas hari jika perlu); hari rehat / cuti umum: N jam selepas masuk (tetapan, asal 9)
      let endMs;
      if (sh) { endMs = klMs(date, sh.end); if (sh.end <= sh.start) endMs += 86400000; }
      else endMs = (firstIn?._t || last._t) + Math.min(16, Math.max(1, Number(st.offDayAutoOutHrs ?? 9))) * 3600000;
      // Masuk semula selepas waktu tamat (OT malam): beri 4 jam dari masuk semula
      const lastIn = [...rs].reverse().find(r => r.type === 'in');
      if (lastIn && lastIn._t >= endMs) endMs = lastIn._t + 4 * 3600000;
      const delay = Number(st.autoOutAfter ?? 30) * 60000;
      if (autoOut && now >= endMs + delay) {
        const b = db.batch();
        if (last.type === 'break_in') b.set(db.collection(`companies/${cid}/attendance`).doc(), { uid: last.uid, workerId: wid, name: last.name || w.name || '', type: 'break_out', date, ts: Timestamp.fromMillis(Math.max(last._t, endMs - 60000)), method: 'auto', auto: true, lat: null, lng: null, deviceId: null, dept: w.dept || '' });
        b.set(db.collection(`companies/${cid}/attendance`).doc(), { uid: last.uid, workerId: wid, name: last.name || w.name || '', type: 'out', date, ts: Timestamp.fromMillis(Math.max(last._t + 60000, endMs)), method: 'auto', auto: true, lat: null, lng: null, acc: null, deviceId: null, dept: w.dept || '', lid: null, locName: '', hasSelfie: false });
        await b.commit();
        await sendTo(cid, t => t.id === last.uid, 'Tamat kerja automatik', `Anda dikeluarkan automatik pada ${hmOf(Math.max(last._t + 60000, endMs))} kerana terlupa tekan Tamat Kerja. Mohon Pembetulan Punch dengan masa sebenar anda balik — OT dikira automatik bila diluluskan.`, '/worker', last.uid);
        continue;
      }
      // Peringatan jejak lokasi (hanya dalam waktu kerja, bukan semasa rehat)
      if (trail && now < endMs && last.type !== 'break_in') {
        if (sh?.bStart && sh?.bEnd) { const bs = klMs(date, sh.bStart), be = klMs(date, sh.bEnd); if (now >= bs && now < be) continue; }
        if (!trailLast) {
          trailLast = {};
          const tr = await db.collection(`companies/${cid}/trail`).where('date', 'in', [yest, today]).get();
          tr.docs.forEach(d => { const x = d.data(); const k = x.workerId; trailLast[k] = Math.max(trailLast[k] || 0, x.ts?.toMillis?.() || 0, x.checkedAt || 0); });
        }
        const lastSeen = Math.max(trailLast[wid] || 0, last._t);
        if (now - lastSeen >= 2 * 3600000 && now - lastSeen < 2 * 3600000 + 15 * 60000) {
          await sendTo(cid, t => t.id === last.uid, '📍 Kemas kini lokasi', 'Buka app sebentar untuk merekod lokasi kerja anda (untuk rekod & tuntutan perjalanan).', '/worker');
        }
      }
    }
  }
});
