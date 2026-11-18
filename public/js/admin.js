// ProAttendance — Halaman Admin Syarikat
import { auth, db, call, workerEmail, FIREBASE_CONFIG } from './fb.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut,
  sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, runTransaction, increment, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  $, $$, L, esc, toast, modal, confirmBox, busy, applyLang, langBtn, todayStr, fmtTime, fmtDate, fmtDateTime, toDate,
  minsToHM, dayName, addDays, summarizeDay, TYPE_LABEL, METHOD_LABEL, getPosition, mapLink, applyBrand, logoHtml,
  isExpired, daysLeft, randPin, randSecret, money, copyText, authErr, icon, fileToDataURL
} from './ui.js';

const app = $('#app');
const S = {
  user: null, me: null, cid: null, company: null, workers: [], locations: [], plans: {},
  view: 'dashboard', unsubs: [], viewUnsub: null
};
const cRef = () => doc(db, 'companies', S.cid);
const sub = (name) => collection(db, 'companies', S.cid, name);

// Akaun sekunder: cipta akaun pekerja tanpa log keluar admin
let secAuth = null;
const getSecAuth = () => (secAuth ||= getAuth(initializeApp(FIREBASE_CONFIG, 'secondary')));

const ALLOW_TYPES = () => [
  ['monthly', L('Bulanan tetap', 'Fixed monthly')],
  ['daily', L('Ikut hari hadir', 'Per day present')],
  ['once', L('Sekali sahaja', 'One-time')]
];
const DED_TYPES = () => [
  ['monthly', L('Setiap bulan', 'Monthly')],
  ['once', L('Sekali sahaja', 'One-time')]
];
const PAY_TYPES = () => [
  ['monthly', L('Bulanan', 'Monthly')],
  ['daily', L('Harian', 'Daily')],
  ['hourly', L('Ikut jam', 'Hourly')]
];
const MODES = () => [
  ['button', L('Butang biasa', 'Simple button')],
  ['gps', L('GPS + geofence', 'GPS + geofence')],
  ['qr', L('Imbas kod QR', 'Scan QR code')]
];
const opts = (arr, sel) => arr.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');

// ================================================================ AUTH
function renderAuth(mode = 'login') {
  stopAll();
  applyBrand({ color: '#1d4ed8' });
  const titles = {
    login: L('Log Masuk Majikan', 'Employer Login'),
    register: L('Daftar Akaun Baharu', 'Create New Account'),
    forgot: L('Lupa Kata Laluan', 'Forgot Password')
  };
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="af">
      <div class="row between" style="margin-bottom:.4rem"><span class="badge b-brand">${L('Admin', 'Admin')}</span>${langBtn()}</div>
      <div class="login-brand">
        <span class="logo-lg logo-ini">${icon('building', 38)}</span>
        <h2>${titles[mode]}</h2>
        <p class="muted small">${mode === 'register'
          ? L('Daftar dan cuba percuma. Isi butiran syarikat selepas ini.', 'Sign up and try it free. Fill in company details next.')
          : mode === 'forgot' ? L('Kami akan hantar pautan reset ke e-mel anda.', 'We will email you a reset link.')
          : L('Urus kehadiran pekerja syarikat anda.', "Manage your company's staff attendance.")}</p>
      </div>
      <div class="field"><label class="lbl">${L('E-mel', 'Email')}</label>
        <input class="input" type="email" id="em" required autocomplete="email"></div>
      ${mode !== 'forgot' ? `
      <div class="field"><label class="lbl">${L('Kata laluan', 'Password')}</label>
        <div class="pw"><input class="input" type="password" id="pw" required minlength="6" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}">
        <button type="button" data-eye>${icon('eye', 18)}</button></div></div>` : ''}
      ${mode === 'register' ? `
      <div class="field"><label class="lbl">${L('Sahkan kata laluan', 'Confirm password')}</label>
        <div class="pw"><input class="input" type="password" id="pw2" required minlength="6" autocomplete="new-password">
        <button type="button" data-eye>${icon('eye', 18)}</button></div></div>` : ''}
      <button class="btn btn-primary btn-block" id="ab" type="submit">${mode === 'login' ? L('Log Masuk', 'Log In') : mode === 'register' ? L('Daftar', 'Sign Up') : L('Hantar Pautan', 'Send Link')}</button>
      ${mode !== 'forgot' ? `
      <div class="divider">${L('atau', 'or')}</div>
      <button type="button" class="btn btn-ghost g-btn" id="gb">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        ${mode === 'register' ? L('Daftar dengan Google', 'Sign up with Google') : L('Log masuk dengan Google', 'Sign in with Google')}
      </button>` : ''}
      <div class="row between small" style="margin-top:1rem">
        ${mode === 'login'
          ? `<button type="button" class="link-btn" data-m="register">${L('Daftar baharu', 'Sign up')}</button>
             <button type="button" class="link-btn" data-m="forgot">${L('Lupa kata laluan?', 'Forgot password?')}</button>`
          : `<button type="button" class="link-btn" data-m="login">← ${L('Kembali ke log masuk', 'Back to login')}</button>`}
      </div>
      <div class="divider"></div>
      <p class="center small"><a href="/index.html">${L('Log masuk Pekerja', 'Staff login')}</a></p>
    </form>
  </div>`;
  $$('[data-m]').forEach(b => b.onclick = () => renderAuth(b.dataset.m));
  $('#gb') && ($('#gb').onclick = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { toast(authErr(e), 'bad'); }
  });
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    const em = $('#em').value.trim(), pw = $('#pw')?.value || '', btn = $('#ab');
    busy(btn, true);
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, em, pw);
      else if (mode === 'register') {
        if (pw !== $('#pw2').value) { toast(L('Kata laluan tidak sepadan.', 'Passwords do not match.'), 'warn'); return; }
        await createUserWithEmailAndPassword(auth, em, pw);
      } else {
        await sendPasswordResetEmail(auth, em);
        toast(L('Pautan reset telah dihantar ke e-mel anda.', 'Reset link sent to your email.'));
        renderAuth('login');
      }
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(btn, false); }
  };
}
document.addEventListener('langchange', () => {
  if (!S.user) renderAuth();
  else if (S.company) { renderShell(); }
});

function stopAll() {
  S.unsubs.forEach(u => u()); S.unsubs = [];
  if (S.viewUnsub) { S.viewUnsub(); S.viewUnsub = null; }
}

onAuthStateChanged(auth, async (u) => {
  S.user = u;
  stopAll();
  if (!u) return renderAuth();
  app.innerHTML = `<div class="loader"><span class="spin"></span></div>`;
  try {
    const [meS, plS] = await Promise.all([getDoc(doc(db, 'users', u.uid)), getDoc(doc(db, 'config', 'plans')).catch(() => null)]);
    S.plans = plS?.exists() ? plS.data() : {};
    if (!meS.exists()) return renderOnboarding();
    S.me = meS.data();
    if (S.me.role === 'worker') { location.href = '/index.html'; return; }
    if (S.me.role !== 'admin') { await signOut(auth); return; }
    S.cid = S.me.cid;
    startApp();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="blocked"><div class="card"><p>${L('Gagal memuatkan data.', 'Failed to load data.')}</p><p class="xs muted">${esc(e.code || e.message)}</p>
      <button class="btn btn-ghost" id="lo">${L('Log Keluar', 'Log Out')}</button></div></div>`;
    $('#lo').onclick = () => signOut(auth);
  }
});

// ================================================================ ONBOARDING
function suggestCode(name) {
  const w = name.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);
  let c = w.length >= 2 ? w.map(x => x[0]).join('') : (w[0] || '');
  return c.slice(0, 4).padEnd(3, 'X').slice(0, 6);
}
function renderOnboarding() {
  const td = Number(S.plans.trialDays || 14);
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="of" style="max-width:460px">
      <div class="row between"><span class="badge b-ok">${L(`Percubaan percuma ${td} hari`, `${td}-day free trial`)}</span>${langBtn()}</div>
      <div class="login-brand" style="margin-top:.8rem">
        <span class="logo-lg logo-ini">${icon('building', 38)}</span>
        <h2>${L('Daftar Syarikat Anda', 'Register Your Company')}</h2>
        <p class="muted small">${esc(S.user.email || '')}</p>
      </div>
      <div class="field"><label class="lbl">${L('Nama syarikat / perniagaan', 'Company / business name')} *</label>
        <input class="input" id="cn" required maxlength="80"></div>
      <div class="field"><label class="lbl">${L('Kod syarikat (2–6 huruf)', 'Company code (2–6 letters)')} *</label>
        <input class="input id-input" id="cc" required maxlength="6" pattern="[A-Za-z]{2,6}">
        <p class="xs muted" id="ccMsg">${L('Kod ini menjadi awalan ID pekerja, cth: KOD001. Tidak boleh ditukar.', 'This becomes the staff ID prefix, e.g. CODE001. Cannot be changed.')}</p></div>
      <div class="field"><label class="lbl">${L('No. telefon', 'Phone no.')} *</label>
        <input class="input" id="cp" required inputmode="tel" maxlength="20"></div>
      <button class="btn btn-primary btn-block" id="ob" type="submit">${L('Mula Sekarang', 'Get Started')}</button>
      <p class="center small" style="margin-top:1rem"><button type="button" class="link-btn" id="lo">${L('Log keluar', 'Log out')}</button></p>
    </form>
  </div>`;
  let manual = false, tmr = 0, okCode = false;
  const cn = $('#cn'), cc = $('#cc'), msg = $('#ccMsg');
  const check = async () => {
    const v = cc.value.trim().toUpperCase();
    okCode = false;
    if (!/^[A-Z]{2,6}$/.test(v)) { msg.textContent = L('Gunakan 2–6 huruf sahaja.', 'Use 2–6 letters only.'); msg.style.color = 'var(--bad)'; return; }
    const s = await getDoc(doc(db, 'companyCodes', v));
    if (s.exists()) { msg.textContent = L(`Kod ${v} sudah digunakan. Cuba kod lain.`, `Code ${v} is taken. Try another.`); msg.style.color = 'var(--bad)'; }
    else { okCode = true; msg.textContent = L(`✓ Kod ${v} boleh digunakan. ID pekerja: ${v}001, ${v}002 …`, `✓ Code ${v} is available. Staff IDs: ${v}001, ${v}002 …`); msg.style.color = 'var(--ok)'; }
  };
  cn.oninput = () => { if (!manual) { cc.value = suggestCode(cn.value); clearTimeout(tmr); tmr = setTimeout(check, 400); } };
  cc.oninput = () => { manual = true; cc.value = cc.value.toUpperCase().replace(/[^A-Z]/g, ''); clearTimeout(tmr); tmr = setTimeout(check, 400); };
  $('#lo').onclick = () => signOut(auth);
  $('#of').onsubmit = async (e) => {
    e.preventDefault();
    await check();
    if (!okCode) return toast(L('Sila pilih kod syarikat yang sah.', 'Please choose a valid company code.'), 'warn');
    const btn = $('#ob'); busy(btn, true);
    try {
      const code = cc.value.trim().toUpperCase();
      const name = cn.value.trim();
      const newRef = doc(collection(db, 'companies'));
      const expiry = Timestamp.fromMillis(Date.now() + td * 86400000 - 120000);
      const b = writeBatch(db);
      b.set(newRef, {
        name, code, phone: $('#cp').value.trim(), ownerUid: S.user.uid, ownerEmail: S.user.email || '',
        logo: '', address: '', ssm: '', color: '#1d4ed8',
        status: 'trial', plan: 'trial', expiry, createdAt: serverTimestamp(), seq: 0, workerCount: 0,
        settings: { workStart: '09:00', workEnd: '18:00', grace: 10, workDays: [1, 2, 3, 4, 5], selfie: true, oneDevice: false },
        departments: [], allowanceTemplates: []
      });
      b.set(doc(db, 'companyCodes', code), { cid: newRef.id, name, logo: '', color: '#1d4ed8' });
      b.set(doc(db, 'users', S.user.uid), { role: 'admin', cid: newRef.id, email: S.user.email || '', createdAt: serverTimestamp() });
      await b.commit();
      S.me = { role: 'admin', cid: newRef.id }; S.cid = newRef.id;
      toast(L('Syarikat berjaya didaftarkan!', 'Company registered!'));
      startApp();
    } catch (err) { console.error(err); toast(authErr(err), 'bad', 5000); busy(btn, false); }
  };
  applyLang();
}

// ================================================================ APP
function startApp() {
  let first = true;
  S.unsubs.push(onSnapshot(cRef(), (s) => {
    S.company = s.data();
    applyBrand(S.company);
    if (first) { first = false; renderShell(); checkPayReturn(); }
    else { updateBrandBits(); checkPaywall(); }
  }, err => toast(authErr(err), 'bad')));
  S.unsubs.push(onSnapshot(sub('workers'), (s) => {
    S.workers = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
    if (S.view === 'workers') renderWorkerList();
  }));
  S.unsubs.push(onSnapshot(sub('locations'), (s) => {
    S.locations = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (S.view === 'locations') viewLocations();
  }));
}

const NAV = () => [
  ['dashboard', 'home', L('Dashboard', 'Dashboard')],
  ['workers', 'users', L('Pekerja', 'Staff')],
  ['locations', 'pin', L('Lokasi', 'Locations')],
  ['reports', 'chart', L('Laporan', 'Reports')],
  ['news', 'bell', L('Pengumuman', 'Announcements')],
  ['settings', 'gear', L('Tetapan', 'Settings')],
  ['billing', 'card', L('Langganan', 'Subscription')]
];

function renderShell() {
  const c = S.company;
  app.innerHTML = `
  <div class="shell">
    <aside class="side" id="side">
      <div class="side-brand"><span data-brand-logo>${logoHtml(c)}</span>
        <div><div class="nm" data-brand-name>${esc(c.name)}</div><div class="xs" style="opacity:.7">${esc(c.code)} · Admin</div></div></div>
      <nav>${NAV().map(([k, ic, t]) => `<button data-v="${k}">${icon(ic)}<span>${t}</span></button>`).join('')}</nav>
      <div class="side-foot">
        <div class="xs" style="opacity:.75;word-break:break-all">${esc(S.user.email || '')}</div>
        <div class="row" style="margin-top:.5rem">${langBtn()}<button class="btn btn-sm btn-ghost" id="lo">${icon('out', 16)} ${L('Keluar', 'Logout')}</button></div>
      </div>
    </aside>
    <div class="side-bg" id="sideBg"></div>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menuBtn">${icon('menu', 22)}</button>
        <h1 id="vTitle"></h1>
        <span id="subBadge"></span>
      </header>
      <div class="content" id="view"></div>
    </div>
  </div>`;
  $$('.side nav button').forEach(b => b.onclick = () => { go(b.dataset.v); closeSide(); });
  $('#menuBtn').onclick = () => { $('#side').classList.add('open'); $('#sideBg').classList.add('open'); };
  $('#sideBg').onclick = closeSide;
  $('#lo').onclick = async () => { if (await confirmBox(L('Log keluar sekarang?', 'Log out now?'))) signOut(auth); };
  updateBrandBits();
  go(S.view);
  checkPaywall();
}
function closeSide() { $('#side')?.classList.remove('open'); $('#sideBg')?.classList.remove('open'); }
function updateBrandBits() {
  const c = S.company; if (!c) return;
  $$('[data-brand-name]').forEach(e => e.textContent = c.name);
  $$('[data-brand-logo]').forEach(e => e.innerHTML = logoHtml(c));
  const sb = $('#subBadge');
  if (sb) {
    const d = daysLeft(c);
    sb.innerHTML = isExpired(c) ? `<span class="badge b-bad">${L('Tamat', 'Expired')}</span>`
      : c.status === 'trial' ? `<span class="badge b-warn">${L('Percubaan', 'Trial')}: ${d} ${L('hari', 'days')}</span>`
      : d <= 7 ? `<span class="badge b-warn">${d} ${L('hari lagi', 'days left')}</span>` : '';
  }
}

function go(v) {
  if (S.viewUnsub) { S.viewUnsub(); S.viewUnsub = null; }
  S.view = v;
  $$('.side nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  const t = NAV().find(n => n[0] === v);
  $('#vTitle').textContent = t ? t[2] : '';
  ({ dashboard: viewDashboard, workers: viewWorkers, locations: viewLocations, reports: viewReports,
     news: viewNews, settings: viewSettings, billing: viewBilling })[v]();
  window.scrollTo(0, 0);
}

// ================================================================ PAYWALL
function checkPaywall() {
  $('#paywall')?.remove();
  if (!isExpired(S.company)) return;
  const el = document.createElement('div');
  el.className = 'paywall'; el.id = 'paywall';
  el.innerHTML = `<div class="card">
    <div class="row" style="margin-bottom:.6rem">${logoHtml(S.company)}<div><h3 style="margin:0">${esc(S.company.name)}</h3>
      <span class="badge b-bad">${S.company.status === 'suspended' ? L('Digantung', 'Suspended') : L('Langganan tamat', 'Subscription expired')}</span></div></div>
    <p>${S.company.status === 'suspended'
      ? L('Akaun syarikat anda telah digantung. Sila hubungi kami untuk bantuan.', 'Your company account is suspended. Please contact us.')
      : L('Sila bayar langganan untuk terus menggunakan sistem. Pekerja anda tidak boleh punch sehingga langganan aktif semula.', 'Please renew your subscription to continue. Your staff cannot punch until it is active again.')}</p>
    ${S.company.status !== 'suspended' ? `<div id="pwPlans" style="margin-top:1rem"></div>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="btn btn-ghost" id="pwLo">${icon('out', 16)} ${L('Log Keluar', 'Log Out')}</button></div>
  </div>`;
  document.body.appendChild(el);
  $('#pwLo').onclick = () => signOut(auth);
  if ($('#pwPlans')) renderPlans($('#pwPlans'));
}

function renderPlans(box) {
  const p = S.plans || {};
  const items = [
    ['monthly', L('Bulanan', 'Monthly'), 1, p.monthly],
    ['sixMonth', L('6 Bulan', '6 Months'), 6, p.sixMonth],
    ['yearly', L('Tahunan', 'Yearly'), 12, p.yearly]
  ].filter(x => Number(x[3]) > 0);
  if (!items.length) { box.innerHTML = `<div class="empty small">${L('Pakej belum ditetapkan. Sila hubungi kami.', 'Plans not set yet. Please contact us.')}</div>`; return; }
  box.innerHTML = `<div class="plans">${items.map(([k, t, m, pr], i) => `
    <div class="plan ${i === items.length - 1 ? 'best' : ''}">
      ${i === items.length - 1 && items.length > 1 ? `<span class="badge b-brand">${L('Paling jimat', 'Best value')}</span>` : ''}
      <div class="bold" style="margin-top:.3rem">${t}</div>
      <div class="price">${money(pr)}</div>
      <div class="xs muted">≈ ${money(pr / m)} / ${L('bulan', 'month')}</div>
      <button class="btn btn-primary btn-block" style="margin-top:.7rem" data-plan="${k}">${L('Bayar', 'Pay')}</button>
    </div>`).join('')}</div>
    <p class="xs muted center" style="margin-top:.6rem">${L('Bayaran selamat melalui FPX / kad.', 'Secure payment via FPX / card.')}</p>`;
  $$('[data-plan]', box).forEach(b => b.onclick = async () => {
    busy(b, true);
    try {
      const r = await call('pa_createBill', { plan: b.dataset.plan });
      if (r?.url) location.href = r.url; else throw new Error('No URL');
    } catch (e) { toast(L('Gagal memulakan bayaran: ', 'Failed to start payment: ') + (e.message || e), 'bad', 5000); busy(b, false); }
  });
}

async function checkPayReturn() {
  const id = new URLSearchParams(location.search).get('pay');
  if (!id) return;
  history.replaceState(null, '', location.pathname);
  try {
    const r = await call('pa_checkPayment', { id });
    if (r?.status === 'paid') toast(L('Bayaran berjaya! Langganan telah dikemas kini.', 'Payment successful! Subscription updated.'), 'ok', 5000);
    else toast(L('Bayaran belum disahkan. Jika anda sudah bayar, semak semula sebentar lagi.', 'Payment not confirmed yet. If you have paid, check again shortly.'), 'warn', 6000);
  } catch { /* abaikan */ }
}

// ================================================================ DASHBOARD
function viewDashboard() {
  const v = $('#view');
  const t = todayStr();
  v.innerHTML = `
    <div class="row between" style="margin-bottom:.8rem">
      <div><h2 style="margin:0">${L('Hari ini', 'Today')}</h2><div class="muted small">${fmtDate(t, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
      <button class="btn btn-soft btn-sm" data-goto="reports">${icon('chart', 16)} ${L('Laporan', 'Reports')}</button>
    </div>
    <div class="stats" id="dStats"></div>
    <div class="grid2" style="gap:1rem;align-items:start">
      <div class="card"><div class="card-head"><h3>${L('Aktiviti terkini', 'Latest activity')}</h3></div><div id="dAct"></div></div>
      <div class="card"><div class="card-head"><h3>${L('Belum hadir', 'Not yet in')}</h3></div><div id="dAbs"></div></div>
    </div>`;
  $$('[data-goto]').forEach(b => b.onclick = () => go(b.dataset.goto));
  if (!S.workers.length && !S.locations.length) {
    $('#dAct').innerHTML = `<div class="empty">${L('Mula dengan menambah lokasi dan pekerja.', 'Start by adding locations and staff.')}<br><br>
      <button class="btn btn-primary btn-sm" data-goto2="locations">${icon('pin', 16)} ${L('Tambah Lokasi', 'Add Location')}</button>
      <button class="btn btn-primary btn-sm" data-goto2="workers">${icon('users', 16)} ${L('Tambah Pekerja', 'Add Staff')}</button></div>`;
    $$('[data-goto2]').forEach(b => b.onclick = () => go(b.dataset.goto2));
  }
  S.viewUnsub = onSnapshot(query(sub('attendance'), where('date', '==', t)), (snap) => {
    const recs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    const active = S.workers.filter(w => w.active !== false);
    const byUid = {};
    recs.forEach(r => (byUid[r.uid] = byUid[r.uid] || []).push(r));
    const st = S.company.settings || {};
    let present = 0, late = 0, onBreak = 0, out = 0;
    const presentIds = new Set();
    Object.values(byUid).forEach(list => {
      const s = summarizeDay(list, st, t);
      if (s.firstIn) { present++; presentIds.add(list[0].workerId); }
      if (s.lateMin) late++;
      if (s.onBreak) onBreak++;
      if (s.lastType === 'out') out++;
    });
    const absent = active.filter(w => !presentIds.has(w.id));
    $('#dStats').innerHTML = `
      <div class="stat"><div class="n">${active.length}</div><div class="t">${L('Pekerja aktif', 'Active staff')}</div></div>
      <div class="stat ok"><div class="n">${present}</div><div class="t">${L('Hadir', 'Present')}</div></div>
      <div class="stat warn"><div class="n">${late}</div><div class="t">${L('Lewat', 'Late')}</div></div>
      <div class="stat bad"><div class="n">${absent.length}</div><div class="t">${L('Belum hadir', 'Not in')}</div></div>
      <div class="stat info"><div class="n">${onBreak}</div><div class="t">${L('Sedang rehat', 'On break')}</div></div>
      <div class="stat"><div class="n">${out}</div><div class="t">${L('Sudah keluar', 'Clocked out')}</div></div>`;
    if (S.workers.length || recs.length) {
      const sorted = recs.sort((a, b) => (toDate(b.ts)?.getTime() || 0) - (toDate(a.ts)?.getTime() || 0)).slice(0, 60);
      $('#dAct').innerHTML = sorted.length ? `<div class="table-wrap"><table>
        <thead><tr><th>${L('Masa', 'Time')}</th><th>${L('Pekerja', 'Staff')}</th><th>${L('Jenis', 'Type')}</th><th>${L('Lokasi', 'Location')}</th><th></th></tr></thead>
        <tbody>${sorted.map(r => `<tr>
          <td class="bold">${fmtTime(r.ts)}</td>
          <td>${esc(r.name)}<div class="xs muted mono">${esc(r.workerId)}</div></td>
          <td><span class="badge ${r.type === 'in' ? 'b-ok' : r.type === 'out' ? 'b-bad' : 'b-warn'}">${TYPE_LABEL[r.type]()}</span></td>
          <td class="small">${esc(r.locName || '-')}<div class="xs muted">${METHOD_LABEL[r.method || 'button']()}${r.dist != null ? ' · ' + r.dist + ' m' : ''}
            ${r.lat != null ? ` · <a href="${mapLink(r.lat, r.lng)}" target="_blank" rel="noopener">${L('Peta', 'Map')}</a>` : ''}</div></td>
          <td>${r.selfie ? `<img class="thumb" src="${r.selfie}" data-img="${r.id}" alt="">` : ''}</td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${L('Belum ada punch hari ini.', 'No punches yet today.')}</div>`;
      $$('[data-img]').forEach(im => im.onclick = () => {
        const r = recs.find(x => x.id === im.dataset.img);
        modal({ title: `${esc(r.name)} · ${TYPE_LABEL[r.type]()} ${fmtTime(r.ts)}`, body: `<img src="${r.selfie}" style="width:100%;border-radius:12px">` });
      });
    }
    $('#dAbs').innerHTML = absent.length ? `<ul class="timeline">${absent.map(w =>
      `<li><span class="dot d-out"></span><span class="grow">${esc(w.name)}</span><span class="xs muted mono">${esc(w.id)}</span></li>`).join('')}</ul>`
      : `<div class="empty small">${active.length ? L('Semua pekerja sudah hadir 🎉', 'Everyone is in 🎉') : L('Tiada pekerja aktif.', 'No active staff.')}</div>`;
  }, err => toast(authErr(err), 'bad'));
}

// ================================================================ PEKERJA
function viewWorkers() {
  $('#view').innerHTML = `
  <div class="card">
    <div class="card-head">
      <input class="input" id="wq" style="max-width:280px" placeholder="${L('Cari nama / ID…', 'Search name / ID…')}">
      <button class="btn btn-primary" id="addW">${icon('plus', 18)} ${L('Tambah Pekerja', 'Add Staff')}</button>
    </div>
    <div id="wList"></div>
  </div>`;
  $('#addW').onclick = () => workerForm(null);
  $('#wq').oninput = renderWorkerList;
  renderWorkerList();
}

function renderWorkerList() {
  const box = $('#wList'); if (!box) return;
  const q = ($('#wq')?.value || '').toLowerCase();
  const list = S.workers.filter(w => !q || (w.name || '').toLowerCase().includes(q) || w.id.toLowerCase().includes(q));
  if (!S.workers.length) {
    box.innerHTML = `<div class="empty">${L('Belum ada pekerja. Tekan "Tambah Pekerja" untuk mula.', 'No staff yet. Tap "Add Staff" to start.')}</div>`;
    return;
  }
  const locName = id => S.locations.find(l => l.id === id)?.name || L('Mana-mana', 'Any');
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>ID</th><th>${L('Nama', 'Name')}</th><th>${L('Jawatan', 'Position')}</th><th>${L('Lokasi', 'Location')}</th><th>${L('Status', 'Status')}</th><th></th></tr></thead>
    <tbody>${list.map(w => `<tr>
      <td class="mono bold">${esc(w.id)}</td>
      <td>${esc(w.name)}<div class="xs muted">${esc(w.phone || '')}</div></td>
      <td class="small">${esc(w.position || '-')}<div class="xs muted">${esc(w.dept || '')}</div></td>
      <td class="small">${esc(locName(w.branchId))}</td>
      <td>${w.active === false ? `<span class="badge b-bad">${L('Tidak aktif', 'Inactive')}</span>` : `<span class="badge b-ok">${L('Aktif', 'Active')}</span>`}
        ${w.mustChangePin ? `<div class="xs muted">${L('Belum log masuk', 'Not logged in yet')}</div>` : ''}</td>
      <td class="right" style="white-space:nowrap">
        <button class="btn btn-sm btn-ghost" data-ed="${esc(w.id)}">${L('Sunting', 'Edit')}</button>
        <button class="btn btn-sm btn-ghost" data-more="${esc(w.id)}">⋯</button>
      </td></tr>`).join('')}</tbody></table></div>
    <p class="xs muted" style="margin-top:.6rem">${list.length} / ${S.workers.length} ${L('pekerja', 'staff')}</p>`;
  $$('[data-ed]', box).forEach(b => b.onclick = () => workerForm(S.workers.find(w => w.id === b.dataset.ed)));
  $$('[data-more]', box).forEach(b => b.onclick = () => workerMenu(S.workers.find(w => w.id === b.dataset.more)));
}

function allowRow(a = {}) {
  return `<div class="dyn-row" data-row="allow">
    <input class="input" data-k="name" placeholder="${L('Nama elaun', 'Allowance name')}" value="${esc(a.name || '')}">
    <input class="input" data-k="amount" type="number" step="0.01" min="0" placeholder="RM" value="${a.amount ?? ''}">
    <select class="input" data-k="type">${opts(ALLOW_TYPES(), a.type || 'monthly')}</select>
    <label class="check"><input type="checkbox" data-k="epf" ${a.epf ? 'checked' : ''}>${L('KWSP', 'EPF')}</label>
    <label class="check"><input type="checkbox" data-k="socso" ${a.socso ? 'checked' : ''}>${L('PERKESO', 'SOCSO')}</label>
    <button type="button" class="icon-btn" data-del>✕</button>
  </div>`;
}
function dedRow(a = {}) {
  return `<div class="dyn-row ded" data-row="ded">
    <input class="input" data-k="name" placeholder="${L('Nama potongan', 'Deduction name')}" value="${esc(a.name || '')}">
    <input class="input" data-k="amount" type="number" step="0.01" min="0" placeholder="RM" value="${a.amount ?? ''}">
    <select class="input" data-k="type">${opts(DED_TYPES(), a.type || 'monthly')}</select>
    <button type="button" class="icon-btn" data-del>✕</button>
  </div>`;
}
function readRows(root, kind) {
  return $$(`[data-row="${kind}"]`, root).map(r => {
    const o = {};
    $$('[data-k]', r).forEach(i => { o[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
    o.amount = Number(o.amount || 0);
    return o;
  }).filter(o => o.name);
}
function bindDyn(root) {
  root.addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d) d.closest('.dyn-row').remove(); });
}

function workerForm(w) {
  const isNew = !w; w = w || {};
  const c = S.company;
  const tpls = c.allowanceTemplates || [];
  const m = modal({
    title: isNew ? L('Tambah Pekerja', 'Add Staff') : `${L('Sunting', 'Edit')} · ${esc(w.id)}`,
    wide: true,
    body: `
    <form id="wf">
      <div class="sec-title">${L('Maklumat Peribadi', 'Personal Details')}</div>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Nama penuh', 'Full name')} *</label><input class="input" name="name" required value="${esc(w.name || '')}"></div>
        <div class="field"><label class="lbl">${L('No. IC / Pasport', 'IC / Passport no.')}</label><input class="input" name="ic" value="${esc(w.ic || '')}"></div>
        <div class="field"><label class="lbl">${L('No. telefon', 'Phone no.')}</label><input class="input" name="phone" inputmode="tel" value="${esc(w.phone || '')}"></div>
        <div class="field"><label class="lbl">${L('E-mel (pilihan)', 'Email (optional)')}</label><input class="input" name="email" type="email" value="${esc(w.email || '')}"></div>
      </div>
      <div class="sec-title">${L('Pekerjaan', 'Employment')}</div>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Jawatan', 'Position')}</label><input class="input" name="position" value="${esc(w.position || '')}"></div>
        <div class="field"><label class="lbl">${L('Jabatan', 'Department')}</label>
          <select class="input" name="dept"><option value="">—</option>${(c.departments || []).map(d => `<option ${d === w.dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
        <div class="field"><label class="lbl">${L('Lokasi kerja', 'Work location')}</label>
          <select class="input" name="branchId"><option value="">${L('Mana-mana lokasi', 'Any location')}</option>${S.locations.map(l => `<option value="${l.id}" ${l.id === w.branchId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
        <div class="field"><label class="lbl">${L('Tarikh mula kerja', 'Start date')}</label><input class="input" name="startDate" type="date" value="${esc(w.startDate || '')}"></div>
        <div class="field"><label class="lbl">${L('Jenis gaji', 'Pay type')}</label><select class="input" name="payType">${opts(PAY_TYPES(), w.payType || 'monthly')}</select></div>
        <div class="field"><label class="lbl">${L('Kadar gaji asas (RM)', 'Basic pay rate (RM)')}</label><input class="input" name="salary" type="number" step="0.01" min="0" value="${w.salary ?? ''}"></div>
      </div>
      <div class="sec-title">${L('Bank & Berkanun', 'Bank & Statutory')}</div>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Nama bank', 'Bank name')}</label><input class="input" name="bank" value="${esc(w.bank || '')}"></div>
        <div class="field"><label class="lbl">${L('No. akaun bank', 'Bank account no.')}</label><input class="input" name="bankAcc" value="${esc(w.bankAcc || '')}"></div>
        <div class="field"><label class="lbl">${L('No. KWSP', 'EPF no.')}</label><input class="input" name="epfNo" value="${esc(w.epfNo || '')}"></div>
        <div class="field"><label class="lbl">${L('No. PERKESO', 'SOCSO no.')}</label><input class="input" name="socsoNo" value="${esc(w.socsoNo || '')}"></div>
        <div class="field"><label class="lbl">${L('No. cukai (LHDN)', 'Tax no. (LHDN)')}</label><input class="input" name="taxNo" value="${esc(w.taxNo || '')}"></div>
      </div>
      <div class="sec-title">${L('Elaun', 'Allowances')}</div>
      <div id="allowBox">${(w.allowances || []).map(allowRow).join('')}</div>
      <div class="row">
        <button type="button" class="btn btn-sm btn-plus" id="addAllow">${icon('plus', 16)} ${L('Tambah Elaun', 'Add Allowance')}</button>
        ${tpls.length ? `<select class="input" id="tplSel" style="width:auto;padding:.38rem .6rem;font-size:.85rem">
          <option value="">${L('+ Dari templat…', '+ From template…')}</option>${tpls.map((t, i) => `<option value="${i}">${esc(t.name)} (${money(t.amount)})</option>`).join('')}</select>` : ''}
      </div>
      <div class="sec-title">${L('Potongan', 'Deductions')}</div>
      <div id="dedBox">${(w.deductions || []).map(dedRow).join('')}</div>
      <button type="button" class="btn btn-sm btn-plus" id="addDed">${icon('plus', 16)} ${L('Tambah Potongan', 'Add Deduction')}</button>
    </form>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      { label: isNew ? L('Simpan & Jana ID', 'Save & Generate ID') : L('Simpan', 'Save'), cls: 'btn-primary', onClick: ({ el }) => saveWorker(el, isNew ? null : w) }
    ]
  });
  const el = m.el;
  bindDyn(el);
  $('#addAllow', el).onclick = () => $('#allowBox', el).insertAdjacentHTML('beforeend', allowRow());
  $('#addDed', el).onclick = () => $('#dedBox', el).insertAdjacentHTML('beforeend', dedRow());
  const ts = $('#tplSel', el);
  if (ts) ts.onchange = () => { if (ts.value !== '') { $('#allowBox', el).insertAdjacentHTML('beforeend', allowRow(tpls[Number(ts.value)])); ts.value = ''; } };
}

async function saveWorker(el, w) {
  const f = $('#wf', el);
  if (!f.reportValidity()) return false;
  const fd = Object.fromEntries(new FormData(f).entries());
  const data = {
    name: fd.name.trim(), ic: fd.ic.trim(), phone: fd.phone.trim(), email: fd.email.trim(),
    position: fd.position.trim(), dept: fd.dept, branchId: fd.branchId || null, startDate: fd.startDate || '',
    payType: fd.payType, salary: Number(fd.salary || 0),
    bank: fd.bank.trim(), bankAcc: fd.bankAcc.trim(), epfNo: fd.epfNo.trim(), socsoNo: fd.socsoNo.trim(), taxNo: fd.taxNo.trim(),
    allowances: readRows(el, 'allow'), deductions: readRows(el, 'ded'), updatedAt: serverTimestamp()
  };
  try {
    if (w) {
      await updateDoc(doc(db, 'companies', S.cid, 'workers', w.id), data);
      toast(L('Maklumat pekerja dikemas kini.', 'Staff updated.'));
      return;
    }
    // Pekerja baharu: jana ID berturutan
    const seq = await runTransaction(db, async tx => {
      const s = await tx.get(cRef());
      const n = (s.data().seq || 0) + 1;
      tx.update(cRef(), { seq: n });
      return n;
    });
    const wid = `${S.company.code}${String(seq).padStart(3, '0')}`;
    const pin = randPin();
    const sa = getSecAuth();
    const cred = await createUserWithEmailAndPassword(sa, workerEmail(wid), pin);
    const uid = cred.user.uid;
    await signOut(sa).catch(() => {});
    const b = writeBatch(db);
    b.set(doc(db, 'users', uid), { role: 'worker', cid: S.cid, workerId: wid, createdAt: serverTimestamp() });
    b.set(doc(db, 'companies', S.cid, 'workers', wid), { ...data, uid, active: true, mustChangePin: true, deviceId: null, createdAt: serverTimestamp() });
    b.update(cRef(), { workerCount: increment(1) });
    await b.commit();
    showLogin(wid, pin, data.name, data.phone, true);
  } catch (e) {
    console.error(e);
    toast(authErr(e), 'bad', 5000);
    return false;
  }
}

function loginText(wid, pin, name) {
  return L(
`Salam ${name},
Akaun kehadiran ${S.company.name} anda telah dibuka.

🔗 ${location.origin}
🆔 ID Pekerja: ${wid}
🔑 PIN sementara: ${pin}

Sila log masuk dan tukar PIN anda. Anda boleh "Add to Home Screen" untuk guna seperti app.`,
`Hi ${name},
Your ${S.company.name} attendance account is ready.

🔗 ${location.origin}
🆔 Staff ID: ${wid}
🔑 Temporary PIN: ${pin}

Please log in and change your PIN. You can "Add to Home Screen" to use it like an app.`);
}

function showLogin(wid, pin, name, phone, isNew) {
  const txt = loginText(wid, pin, name);
  const ph = String(phone || '').replace(/\D/g, '').replace(/^0/, '60');
  modal({
    title: isNew ? L('Pekerja Ditambah ✓', 'Staff Added ✓') : L('PIN Baharu', 'New PIN'),
    body: `
      <div class="center" style="padding:.5rem 0 1rem">
        <div class="muted small">${esc(name)}</div>
        <div class="stats" style="margin:.8rem 0">
          <div class="stat"><div class="t">${L('ID Pekerja', 'Staff ID')}</div><div class="n mono">${esc(wid)}</div></div>
          <div class="stat warn"><div class="t">PIN</div><div class="n mono">${esc(pin)}</div></div>
        </div>
        <p class="small muted">${L('Berikan maklumat ini kepada pekerja. Mereka wajib tukar PIN semasa log masuk pertama.', 'Give these details to the staff member. They must change the PIN on first login.')}</p>
      </div>`,
    actions: [
      { label: L('Salin', 'Copy'), onClick: () => { copyText(txt); return false; }, autoClose: false },
      { label: 'WhatsApp', cls: 'btn-ok', onClick: () => { window.open(`https://wa.me/${ph}?text=${encodeURIComponent(txt)}`, '_blank'); return false; }, autoClose: false },
      { label: L('Selesai', 'Done'), cls: 'btn-primary' }
    ]
  });
}

function workerMenu(w) {
  const m = modal({
    title: `${esc(w.name)} · ${esc(w.id)}`,
    body: `<div class="stack">
      <button class="btn btn-ghost btn-block" data-act="pin">${icon('shield', 18)} ${L('Reset PIN', 'Reset PIN')}</button>
      <button class="btn btn-ghost btn-block" data-act="dev">${icon('user', 18)} ${L('Reset telefon berdaftar', 'Reset registered phone')}</button>
      <button class="btn btn-ghost btn-block" data-act="hist">${icon('cal', 18)} ${L('Lihat rekod kehadiran', 'View attendance')}</button>
      <button class="btn ${w.active === false ? 'btn-ok' : 'btn-danger'} btn-block" data-act="act">${w.active === false ? L('Aktifkan semula', 'Reactivate') : L('Nyahaktifkan pekerja', 'Deactivate staff')}</button>
    </div>`
  });
  $$('[data-act]', m.el).forEach(b => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === 'pin') {
      if (!await confirmBox(L(`Reset PIN untuk ${w.name}?`, `Reset PIN for ${w.name}?`))) return;
      busy(b, true);
      const pin = randPin();
      try { await call('pa_resetWorkerPin', { workerId: w.id, pin }); m.close(); showLogin(w.id, pin, w.name, w.phone, false); }
      catch (e) { toast(L('Gagal reset PIN: ', 'Failed to reset PIN: ') + (e.message || e), 'bad', 5000); }
      finally { busy(b, false); }
    } else if (a === 'dev') {
      await updateDoc(doc(db, 'companies', S.cid, 'workers', w.id), { deviceId: null });
      toast(L('Telefon direset. Pekerja boleh log masuk dari telefon baharu.', 'Phone reset. Staff can log in from a new phone.'));
      m.close();
    } else if (a === 'hist') {
      m.close(); S.reportWorker = w.id; go('reports');
    } else if (a === 'act') {
      const to = w.active === false;
      if (!await confirmBox(to ? L(`Aktifkan semula ${w.name}?`, `Reactivate ${w.name}?`) : L(`Nyahaktifkan ${w.name}? Pekerja tidak boleh log masuk atau punch.`, `Deactivate ${w.name}? They will not be able to log in or punch.`))) return;
      busy(b, true);
      try { await call('pa_setWorkerActive', { workerId: w.id, active: to }); }
      catch { await updateDoc(doc(db, 'companies', S.cid, 'workers', w.id), { active: to }); }
      toast(to ? L('Pekerja diaktifkan.', 'Staff activated.') : L('Pekerja dinyahaktifkan.', 'Staff deactivated.'));
      m.close();
    }
  });
}

// ================================================================ LOKASI
function viewLocations() {
  const v = $('#view');
  v.innerHTML = `
  <div class="card">
    <div class="card-head"><div><h3>${L('Lokasi & Cawangan', 'Locations & Branches')}</h3>
      <p class="small muted">${L('Setiap lokasi boleh guna mod clock-in yang berbeza.', 'Each location can use a different clock-in mode.')}</p></div>
      <button class="btn btn-primary" id="addL">${icon('plus', 18)} ${L('Tambah Lokasi', 'Add Location')}</button></div>
    ${S.locations.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${L('Nama', 'Name')}</th><th>${L('Mod', 'Mode')}</th><th>${L('Radius', 'Radius')}</th><th>${L('Koordinat', 'Coordinates')}</th><th></th></tr></thead>
      <tbody>${S.locations.map(l => `<tr>
        <td class="bold">${esc(l.name)}</td>
        <td><span class="badge b-brand">${esc(MODES().find(x => x[0] === l.mode)?.[1] || l.mode)}</span></td>
        <td>${l.mode === 'gps' ? (l.radius || 100) + ' m' : '-'}</td>
        <td class="small">${l.lat != null ? `<a href="${mapLink(l.lat, l.lng)}" target="_blank" rel="noopener">${Number(l.lat).toFixed(5)}, ${Number(l.lng).toFixed(5)}</a>` : '-'}</td>
        <td class="right" style="white-space:nowrap">
          ${l.mode === 'qr' ? `<a class="btn btn-sm btn-soft" href="/qr.html?l=${l.id}" target="_blank">${icon('qr', 16)} ${L('Papar QR', 'Show QR')}</a>` : ''}
          <button class="btn btn-sm btn-ghost" data-el="${l.id}">${L('Sunting', 'Edit')}</button>
          <button class="btn btn-sm btn-ghost" data-dl="${l.id}">✕</button>
        </td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${L('Belum ada lokasi. Tambah lokasi pejabat / kedai / tapak anda.', 'No locations yet. Add your office / shop / site.')}</div>`}
  </div>
  <div class="card small">
    <b>${L('Panduan mod:', 'Mode guide:')}</b>
    <ul style="margin:.4rem 0 0;padding-left:1.1rem">
      <li><b>${L('Butang biasa', 'Simple button')}</b> — ${L('pekerja tekan butang sahaja (lokasi GPS tetap direkod jika ada).', 'staff just tap a button (GPS is still recorded if available).')}</li>
      <li><b>GPS + geofence</b> — ${L('pekerja hanya boleh punch dalam radius lokasi.', 'staff can only punch within the radius.')}</li>
      <li><b>${L('Imbas kod QR', 'Scan QR')}</b> — ${L('paparkan QR pada tablet/telefon di lokasi. Kod bertukar setiap 30 saat.', 'show the QR on a tablet/phone on site. The code changes every 30 seconds.')}</li>
    </ul>
  </div>`;
  $('#addL').onclick = () => locationForm(null);
  $$('[data-el]').forEach(b => b.onclick = () => locationForm(S.locations.find(l => l.id === b.dataset.el)));
  $$('[data-dl]').forEach(b => b.onclick = async () => {
    const l = S.locations.find(x => x.id === b.dataset.dl);
    if (!await confirmBox(L(`Padam lokasi "${l.name}"?`, `Delete location "${l.name}"?`))) return;
    await deleteDoc(doc(db, 'companies', S.cid, 'locations', l.id));
    toast(L('Lokasi dipadam.', 'Location deleted.'));
  });
}

function locationForm(l) {
  const isNew = !l; l = l || { mode: 'gps', radius: 100 };
  const m = modal({
    title: isNew ? L('Tambah Lokasi', 'Add Location') : L('Sunting Lokasi', 'Edit Location'),
    body: `<form id="lf">
      <div class="field"><label class="lbl">${L('Nama lokasi', 'Location name')} *</label><input class="input" name="name" required value="${esc(l.name || '')}" placeholder="${L('cth: Kedai Puchong', 'e.g. HQ Office')}"></div>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Mod clock-in', 'Clock-in mode')}</label><select class="input" name="mode" id="lm">${opts(MODES(), l.mode)}</select></div>
        <div class="field" id="radF"><label class="lbl">${L('Radius dibenarkan (meter)', 'Allowed radius (metres)')}</label><input class="input" name="radius" type="number" min="20" max="5000" value="${l.radius || 100}"></div>
      </div>
      <div class="field"><label class="lbl">${L('Koordinat (latitud, longitud)', 'Coordinates (latitude, longitude)')}</label>
        <input class="input" name="coords" id="lc" value="${l.lat != null ? `${l.lat}, ${l.lng}` : ''}" placeholder="3.0333, 101.6167">
        <p class="xs muted">${L('Tekan butang di bawah semasa berada di lokasi, atau tampal koordinat dari Google Maps (tekan lama pada peta).', 'Tap the button below while on site, or paste coordinates from Google Maps (long-press on the map).')}</p>
        <button type="button" class="btn btn-sm btn-soft" id="useMe">${icon('pin', 16)} ${L('Guna lokasi saya sekarang', 'Use my current location')}</button>
        <span class="small muted" id="accMsg"></span>
      </div>
    </form>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
          const f = $('#lf', el); if (!f.reportValidity()) return false;
          const fd = Object.fromEntries(new FormData(f).entries());
          const mm = String(fd.coords || '').match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
          if (fd.mode === 'gps' && !mm) { toast(L('Mod GPS memerlukan koordinat lokasi.', 'GPS mode needs coordinates.'), 'warn'); return false; }
          const data = {
            name: fd.name.trim(), mode: fd.mode, radius: Number(fd.radius || 100),
            lat: mm ? Number(mm[1]) : null, lng: mm ? Number(mm[2]) : null, updatedAt: serverTimestamp()
          };
          try {
            if (isNew) await addDoc(sub('locations'), { ...data, qrSecret: randSecret(), createdAt: serverTimestamp() });
            else await updateDoc(doc(db, 'companies', S.cid, 'locations', l.id), { ...data, ...(l.qrSecret ? {} : { qrSecret: randSecret() }) });
            toast(L('Lokasi disimpan.', 'Location saved.'));
          } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  const el = m.el;
  const syncMode = () => { $('#radF', el).style.display = $('#lm', el).value === 'gps' ? '' : 'none'; };
  $('#lm', el).onchange = syncMode; syncMode();
  $('#useMe', el).onclick = async (e) => {
    const b = e.currentTarget; busy(b, true);
    try {
      const p = await getPosition(20000);
      $('#lc', el).value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
      $('#accMsg', el).textContent = ` ±${p.acc} m`;
    } catch { toast(L('Tidak dapat kesan lokasi. Benarkan akses lokasi.', 'Cannot get location. Allow location access.'), 'bad'); }
    finally { busy(b, false); }
  };
}

// ================================================================ LAPORAN
function viewReports() {
  const t = todayStr();
  const from = S.repFrom || t.slice(0, 8) + '01', to = S.repTo || t;
  const wsel = S.reportWorker || '';
  S.reportWorker = '';
  $('#view').innerHTML = `
  <div class="card no-print">
    <div class="grid3" style="align-items:end">
      <div class="field"><label class="lbl">${L('Dari', 'From')}</label><input class="input" type="date" id="rf" value="${from}"></div>
      <div class="field"><label class="lbl">${L('Hingga', 'To')}</label><input class="input" type="date" id="rt" value="${to}"></div>
      <div class="field"><label class="lbl">${L('Pekerja', 'Staff')}</label><select class="input" id="rw"><option value="">${L('Semua pekerja', 'All staff')}</option>
        ${S.workers.map(w => `<option value="${esc(w.id)}" ${w.id === wsel ? 'selected' : ''}>${esc(w.id)} · ${esc(w.name)}</option>`).join('')}</select></div>
    </div>
    <div class="row">
      <button class="btn btn-primary" id="rgo">${icon('chart', 18)} ${L('Jana Laporan', 'Generate')}</button>
      <button class="btn btn-ghost" id="rxl" disabled>${icon('dl', 18)} Excel</button>
      <button class="btn btn-ghost" id="rpr" disabled>${icon('print', 18)} ${L('Cetak / PDF', 'Print / PDF')}</button>
    </div>
  </div>
  <div class="card" id="rOut" style="margin-top:1rem"><div class="empty">${L('Pilih tarikh dan tekan "Jana Laporan".', 'Choose dates and tap "Generate".')}</div></div>`;
  $('#rgo').onclick = genReport;
  $('#rpr').onclick = () => window.print();
  if (wsel) genReport();
}

let REPORT = null;
async function genReport() {
  const from = $('#rf').value, to = $('#rt').value, wid = $('#rw').value;
  if (!from || !to || from > to) return toast(L('Julat tarikh tidak sah.', 'Invalid date range.'), 'warn');
  S.repFrom = from; S.repTo = to;
  const out = $('#rOut');
  out.innerHTML = `<div class="loader" style="min-height:150px"><span class="spin"></span></div>`;
  try {
    const s = await getDocs(query(sub('attendance'), where('date', '>=', from), where('date', '<=', to)));
    let recs = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (wid) recs = recs.filter(r => r.workerId === wid);
    const st = S.company.settings || {};
    const workers = S.workers.filter(w => wid ? w.id === wid : true);
    // Harian
    const key = {};
    recs.forEach(r => { const k = r.workerId + '|' + r.date; (key[k] = key[k] || []).push(r); });
    const daily = Object.entries(key).map(([k, list]) => {
      const [workerId, date] = k.split('|');
      const sm = summarizeDay(list, st, date);
      return { workerId, name: list[0].name, date, ...sm };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.workerId.localeCompare(b.workerId));
    // Hari bekerja dalam julat (sehingga hari ini)
    const wd = st.workDays || [1, 2, 3, 4, 5];
    const end = to > todayStr() ? todayStr() : to;
    const workDates = [];
    for (let d = from; d <= end; d = addDays(d, 1)) if (wd.includes(new Date(d + 'T00:00:00').getDay())) workDates.push(d);
    // Ringkasan
    const summary = workers.map(w => {
      const rows = daily.filter(r => r.workerId === w.id);
      const start = w.startDate || '0000-00-00';
      const due = workDates.filter(d => d >= start).length;
      const present = rows.filter(r => r.firstIn).length;
      return {
        id: w.id, name: w.name, dept: w.dept || '', present,
        lateDays: rows.filter(r => r.lateMin > 0).length,
        lateMin: rows.reduce((a, r) => a + r.lateMin, 0),
        workMin: rows.reduce((a, r) => a + r.workMin, 0),
        absent: Math.max(0, due - rows.filter(r => workDates.includes(r.date)).length)
      };
    });
    REPORT = { from, to, daily, summary };
    const c = S.company;
    out.innerHTML = `
      <div class="print-head">${logoHtml(c)}<div><h3 style="margin:0">${esc(c.name)}</h3>
        <div class="small">${L('Laporan Kehadiran', 'Attendance Report')} · ${fmtDate(from)} – ${fmtDate(to)}</div></div></div>
      <div class="tabs no-print"><button class="on" data-rt="sum">${L('Ringkasan', 'Summary')}</button><button data-rt="day">${L('Harian', 'Daily')}</button></div>
      <div id="rtSum">
        <div class="table-wrap"><table>
          <thead><tr><th>ID</th><th>${L('Nama', 'Name')}</th><th>${L('Hadir', 'Present')}</th><th>${L('Tidak hadir', 'Absent')}</th><th>${L('Hari lewat', 'Late days')}</th><th>${L('Minit lewat', 'Late mins')}</th><th>${L('Jam kerja', 'Hours')}</th></tr></thead>
          <tbody>${summary.map(r => `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.name)}</td><td>${r.present}</td>
            <td>${r.absent ? `<span class="badge b-bad">${r.absent}</span>` : 0}</td><td>${r.lateDays ? `<span class="badge b-warn">${r.lateDays}</span>` : 0}</td>
            <td>${r.lateMin}</td><td>${minsToHM(r.workMin)}</td></tr>`).join('') || `<tr><td colspan="7" class="center muted">${L('Tiada data', 'No data')}</td></tr>`}</tbody>
        </table></div>
        <p class="xs muted" style="margin-top:.5rem">${L('Tidak hadir dikira berdasarkan hari bekerja dalam Tetapan (belum termasuk cuti).', 'Absences are based on work days in Settings (leave not yet included).')}</p>
      </div>
      <div id="rtDay" class="hide">
        <div class="table-wrap"><table>
          <thead><tr><th>${L('Tarikh', 'Date')}</th><th>ID</th><th>${L('Nama', 'Name')}</th><th>${L('Masuk', 'In')}</th><th>${L('Keluar', 'Out')}</th><th>${L('Rehat', 'Break')}</th><th>${L('Jam kerja', 'Hours')}</th><th>${L('Lewat', 'Late')}</th><th>${L('Lokasi', 'Location')}</th></tr></thead>
          <tbody>${daily.map(r => `<tr><td>${fmtDate(r.date)}</td><td class="mono">${esc(r.workerId)}</td><td>${esc(r.name)}</td>
            <td>${fmtTime(r.firstIn)}</td><td>${r.open ? '<span class="badge b-info">' + L('Belum keluar', 'Not out') + '</span>' : fmtTime(r.lastOut)}</td>
            <td>${Math.round(r.breakMin)}m</td><td>${minsToHM(r.workMin)}</td><td>${r.lateMin ? `<span class="badge b-warn">${r.lateMin}m</span>` : '-'}</td><td class="small">${esc(r.locName)}</td></tr>`).join('')
            || `<tr><td colspan="9" class="center muted">${L('Tiada data', 'No data')}</td></tr>`}</tbody>
        </table></div>
      </div>`;
    $$('[data-rt]', out).forEach(b => b.onclick = () => {
      $$('[data-rt]', out).forEach(x => x.classList.toggle('on', x === b));
      $('#rtSum').classList.toggle('hide', b.dataset.rt !== 'sum');
      $('#rtDay').classList.toggle('hide', b.dataset.rt !== 'day');
    });
    $('#rxl').disabled = false; $('#rpr').disabled = false;
    $('#rxl').onclick = exportExcel;
  } catch (e) { console.error(e); out.innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; }
}

function exportExcel() {
  if (!window.XLSX || !REPORT) return toast(L('Modul Excel belum dimuatkan.', 'Excel module not loaded.'), 'warn');
  const wb = XLSX.utils.book_new();
  const head = [[S.company.name], [`${L('Laporan Kehadiran', 'Attendance Report')}: ${REPORT.from} – ${REPORT.to}`], []];
  const s1 = XLSX.utils.aoa_to_sheet([...head,
    ['ID', L('Nama', 'Name'), L('Jabatan', 'Department'), L('Hadir', 'Present'), L('Tidak hadir', 'Absent'), L('Hari lewat', 'Late days'), L('Minit lewat', 'Late mins'), L('Jam kerja', 'Hours')],
    ...REPORT.summary.map(r => [r.id, r.name, r.dept, r.present, r.absent, r.lateDays, r.lateMin, +(r.workMin / 60).toFixed(2)])]);
  const s2 = XLSX.utils.aoa_to_sheet([...head,
    [L('Tarikh', 'Date'), 'ID', L('Nama', 'Name'), L('Masuk', 'In'), L('Keluar', 'Out'), L('Rehat (min)', 'Break (min)'), L('Jam kerja', 'Hours'), L('Lewat (min)', 'Late (min)'), L('Lokasi', 'Location')],
    ...REPORT.daily.map(r => [r.date, r.workerId, r.name, fmtTime(r.firstIn), r.open ? '' : fmtTime(r.lastOut), Math.round(r.breakMin), +(r.workMin / 60).toFixed(2), r.lateMin, r.locName])]);
  s1['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 16 }, { wch: 8 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 10 }];
  s2['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, s1, L('Ringkasan', 'Summary'));
  XLSX.utils.book_append_sheet(wb, s2, L('Harian', 'Daily'));
  XLSX.writeFile(wb, `Kehadiran_${S.company.code}_${REPORT.from}_${REPORT.to}.xlsx`);
}

// ================================================================ PENGUMUMAN
function viewNews() {
  $('#view').innerHTML = `
  <div class="card">
    <h3>${L('Hantar Pengumuman', 'Post Announcement')}</h3>
    <div class="field"><input class="input" id="nt" maxlength="120" placeholder="${L('Tajuk', 'Title')}"></div>
    <div class="field"><textarea class="input" id="nbd" maxlength="2000" placeholder="${L('Mesej kepada semua pekerja…', 'Message to all staff…')}"></textarea></div>
    <button class="btn btn-primary" id="nsend">${icon('plus', 18)} ${L('Hantar', 'Post')}</button>
  </div>
  <div class="card"><h3>${L('Senarai Pengumuman', 'Announcements')}</h3><div id="nlist"></div></div>`;
  $('#nsend').onclick = async (e) => {
    const title = $('#nt').value.trim(), body = $('#nbd').value.trim();
    if (!title) return toast(L('Sila isi tajuk.', 'Please enter a title.'), 'warn');
    busy(e.currentTarget, true);
    try { await addDoc(sub('announcements'), { title, body, createdAt: serverTimestamp(), by: S.user.email || '' }); $('#nt').value = ''; $('#nbd').value = ''; toast(L('Pengumuman dihantar.', 'Announcement posted.')); }
    catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  S.viewUnsub = onSnapshot(query(sub('announcements'), orderBy('createdAt', 'desc'), limit(50)), s => {
    $('#nlist').innerHTML = s.empty ? `<div class="empty">${L('Tiada pengumuman.', 'No announcements.')}</div>` : s.docs.map(d => {
      const a = d.data({ serverTimestamps: 'estimate' });
      return `<div class="day-row" style="align-items:flex-start"><div class="grow"><div class="bold">${esc(a.title)}</div>
        <div class="small" style="white-space:pre-wrap">${esc(a.body)}</div><div class="xs muted">${fmtDateTime(a.createdAt)}</div></div>
        <button class="icon-btn" data-dn="${d.id}">✕</button></div>`;
    }).join('');
    $$('[data-dn]').forEach(b => b.onclick = async () => {
      if (await confirmBox(L('Padam pengumuman ini?', 'Delete this announcement?'))) await deleteDoc(doc(db, 'companies', S.cid, 'announcements', b.dataset.dn));
    });
  });
}

// ================================================================ TETAPAN
function viewSettings() {
  const c = S.company, st = c.settings || {};
  const wd = st.workDays || [1, 2, 3, 4, 5];
  $('#view').innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${L('Profil Syarikat', 'Company Profile')}</h3><span class="badge b-brand mono">${L('Kod', 'Code')}: ${esc(c.code)}</span></div>
    <p class="small muted">${L('Nama & logo ini dipaparkan pada halaman admin, halaman pekerja, slip & laporan.', 'This name & logo appear on the admin page, staff page, slips & reports.')}</p>
    <div class="row" style="margin:.6rem 0 1rem">
      <span id="logoPrev">${logoHtml(c, 'logo-lg')}</span>
      <div class="stack" style="margin:0">
        <label class="btn btn-sm btn-soft" style="margin:0">${icon('plus', 16)} ${L('Muat naik logo', 'Upload logo')}<input type="file" accept="image/*" id="logoF" hidden></label>
        ${c.logo ? `<button class="btn btn-sm btn-ghost" id="logoX">${L('Buang logo', 'Remove logo')}</button>` : ''}
      </div>
    </div>
    <div class="grid2">
      <div class="field"><label class="lbl">${L('Nama syarikat', 'Company name')}</label><input class="input" id="sName" value="${esc(c.name)}"></div>
      <div class="field"><label class="lbl">${L('No. pendaftaran (SSM)', 'Registration no. (SSM)')}</label><input class="input" id="sSsm" value="${esc(c.ssm || '')}"></div>
      <div class="field"><label class="lbl">${L('No. telefon', 'Phone no.')}</label><input class="input" id="sPhone" value="${esc(c.phone || '')}"></div>
      <div class="field"><label class="lbl">${L('Warna tema', 'Theme colour')}</label><input class="input" type="color" id="sColor" value="${esc(c.color || '#1d4ed8')}" style="height:44px;padding:.2rem"></div>
    </div>
    <div class="field"><label class="lbl">${L('Alamat', 'Address')}</label><textarea class="input" id="sAddr" style="min-height:70px">${esc(c.address || '')}</textarea></div>
    <button class="btn btn-primary" id="saveProf">${L('Simpan Profil', 'Save Profile')}</button>
  </div>

  <div class="card">
    <h3>${L('Waktu Kerja', 'Working Hours')}</h3>
    <div class="grid3">
      <div class="field"><label class="lbl">${L('Masuk', 'Start')}</label><input class="input" type="time" id="wS" value="${esc(st.workStart || '09:00')}"></div>
      <div class="field"><label class="lbl">${L('Keluar', 'End')}</label><input class="input" type="time" id="wE" value="${esc(st.workEnd || '18:00')}"></div>
      <div class="field"><label class="lbl">${L('Tempoh tenggang lewat (minit)', 'Late grace (minutes)')}</label><input class="input" type="number" min="0" max="120" id="wG" value="${st.grace ?? 10}"></div>
    </div>
    <label class="lbl">${L('Hari bekerja', 'Work days')}</label>
    <div class="row" style="margin-bottom:1rem">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="check"><input type="checkbox" data-wd="${d}" ${wd.includes(d) ? 'checked' : ''}>${dayName(d)}</label>`).join('')}</div>
    <h3 style="margin-top:.6rem">${L('Tetapan Clock-in', 'Clock-in Settings')}</h3>
    <div class="set-row"><div><b>${L('Selfie wajib semasa punch', 'Selfie required when punching')}</b><div class="small muted">${L('Gambar disimpan sebagai bukti (tanpa pengecaman wajah).', 'Photo kept as proof (no face recognition).')}</div></div>
      <label class="switch"><input type="checkbox" id="tSelfie" ${st.selfie !== false ? 'checked' : ''}><span></span></label></div>
    <div class="set-row"><div><b>${L('Satu telefon seorang pekerja', 'One phone per staff')}</b><div class="small muted">${L('Akaun dikunci pada telefon pertama yang log masuk.', 'Account locks to the first phone that logs in.')}</div></div>
      <label class="switch"><input type="checkbox" id="tDev" ${st.oneDevice ? 'checked' : ''}><span></span></label></div>
    <button class="btn btn-primary" id="saveWork" style="margin-top:.8rem">${L('Simpan Tetapan', 'Save Settings')}</button>
  </div>

  <div class="card">
    <h3>${L('Jabatan', 'Departments')}</h3>
    <div class="chips" id="deptChips" style="margin-bottom:.7rem"></div>
    <div class="row"><input class="input grow" id="deptIn" style="max-width:300px" placeholder="${L('Nama jabatan', 'Department name')}">
      <button class="btn btn-plus" id="deptAdd">${icon('plus', 16)} ${L('Tambah', 'Add')}</button></div>
  </div>

  <div class="card">
    <h3>${L('Templat Elaun Syarikat', 'Company Allowance Templates')}</h3>
    <p class="small muted">${L('Tetapkan elaun biasa sekali, kemudian pilih untuk setiap pekerja dengan butang (+).', 'Set common allowances once, then add them to staff with the (+) button.')}</p>
    <div id="tplBox">${(c.allowanceTemplates || []).map(allowRow).join('')}</div>
    <div class="row"><button class="btn btn-sm btn-plus" id="tplAdd">${icon('plus', 16)} ${L('Tambah Templat Elaun', 'Add Allowance Template')}</button>
      <button class="btn btn-primary btn-sm" id="tplSave">${L('Simpan Templat', 'Save Templates')}</button></div>
  </div>

  <div class="card">
    <h3>${L('Akaun', 'Account')}</h3>
    <div class="set-row"><span class="muted">${L('E-mel', 'Email')}</span><b>${esc(S.user.email || '')}</b></div>
    <div class="set-row"><span class="muted">${L('Bahasa', 'Language')}</span>${langBtn().replace('lang-btn', 'btn btn-sm btn-ghost')}</div>
    <div class="set-row"><span class="muted">${L('Pautan login pekerja', 'Staff login link')}</span>
      <button class="btn btn-sm btn-ghost" id="cpLink">${esc(location.host)} · ${L('Salin', 'Copy')}</button></div>
  </div>`;

  let logo = c.logo || '';
  $('#logoF').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      logo = await fileToDataURL(f, 200, 'image/png');
      if (logo.length > 150000) logo = await fileToDataURL(f, 160, 'image/jpeg', 0.85);
      $('#logoPrev').innerHTML = logoHtml({ ...c, logo }, 'logo-lg');
    } catch { toast(L('Gagal membaca imej.', 'Failed to read image.'), 'bad'); }
  };
  $('#logoX') && ($('#logoX').onclick = () => { logo = ''; $('#logoPrev').innerHTML = logoHtml({ ...c, logo: '' }, 'logo-lg'); });
  $('#saveProf').onclick = async (e) => {
    const name = $('#sName').value.trim();
    if (!name) return toast(L('Nama syarikat diperlukan.', 'Company name required.'), 'warn');
    const color = $('#sColor').value;
    busy(e.currentTarget, true);
    try {
      const b = writeBatch(db);
      b.update(cRef(), { name, logo, color, ssm: $('#sSsm').value.trim(), phone: $('#sPhone').value.trim(), address: $('#sAddr').value.trim() });
      b.update(doc(db, 'companyCodes', c.code), { name, logo, color });
      await b.commit();
      toast(L('Profil disimpan.', 'Profile saved.'));
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  $('#saveWork').onclick = async (e) => {
    busy(e.currentTarget, true);
    try {
      await updateDoc(cRef(), {
        'settings.workStart': $('#wS').value || '09:00', 'settings.workEnd': $('#wE').value || '18:00',
        'settings.grace': Number($('#wG').value || 0),
        'settings.workDays': $$('[data-wd]').filter(x => x.checked).map(x => Number(x.dataset.wd)),
        'settings.selfie': $('#tSelfie').checked, 'settings.oneDevice': $('#tDev').checked
      });
      toast(L('Tetapan disimpan.', 'Settings saved.'));
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  const drawDepts = () => {
    const d = S.company.departments || [];
    $('#deptChips').innerHTML = d.length ? d.map((x, i) => `<span class="chip">${esc(x)}<button data-dd="${i}">✕</button></span>`).join('') : `<span class="small muted">${L('Tiada jabatan.', 'No departments.')}</span>`;
    $$('[data-dd]').forEach(b => b.onclick = async () => {
      const arr = [...(S.company.departments || [])]; arr.splice(Number(b.dataset.dd), 1);
      await updateDoc(cRef(), { departments: arr }); S.company.departments = arr; drawDepts();
    });
  };
  drawDepts();
  $('#deptAdd').onclick = async () => {
    const v = $('#deptIn').value.trim(); if (!v) return;
    const arr = [...new Set([...(S.company.departments || []), v])];
    await updateDoc(cRef(), { departments: arr }); S.company.departments = arr; $('#deptIn').value = ''; drawDepts();
  };
  const tplBox = $('#tplBox'); bindDyn(tplBox);
  $('#tplAdd').onclick = () => tplBox.insertAdjacentHTML('beforeend', allowRow());
  $('#tplSave').onclick = async (e) => {
    busy(e.currentTarget, true);
    try { await updateDoc(cRef(), { allowanceTemplates: readRows(tplBox, 'allow') }); toast(L('Templat disimpan.', 'Templates saved.')); }
    catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  $('#cpLink').onclick = () => copyText(location.origin);
}

// ================================================================ LANGGANAN
async function viewBilling() {
  const c = S.company, d = daysLeft(c);
  $('#view').innerHTML = `
  <div class="card">
    <h3>${L('Status Langganan', 'Subscription Status')}</h3>
    <div class="stats" style="margin:.6rem 0 0">
      <div class="stat ${isExpired(c) ? 'bad' : c.status === 'trial' ? 'warn' : 'ok'}"><div class="t">${L('Pakej', 'Plan')}</div>
        <div class="n" style="font-size:1.2rem">${c.status === 'suspended' ? L('Digantung', 'Suspended') : c.status === 'trial' ? L('Percubaan', 'Trial') : planName(c.plan)}</div></div>
      <div class="stat"><div class="t">${L('Tamat pada', 'Expires on')}</div><div class="n" style="font-size:1.2rem">${fmtDate(c.expiry)}</div></div>
      <div class="stat ${d <= 7 ? 'warn' : 'info'}"><div class="t">${L('Baki', 'Remaining')}</div><div class="n" style="font-size:1.2rem">${Math.max(0, d)} ${L('hari', 'days')}</div></div>
      <div class="stat"><div class="t">${L('Pekerja', 'Staff')}</div><div class="n" style="font-size:1.2rem">${S.workers.length}</div></div>
    </div>
  </div>
  <div class="card"><h3>${L('Perbaharui / Naik Taraf', 'Renew / Upgrade')}</h3>
    <p class="small muted">${L('Tempoh baharu akan ditambah selepas tarikh tamat semasa.', 'New period is added after the current expiry date.')}</p>
    <div id="bPlans" style="margin-top:.8rem"></div></div>
  <div class="card"><h3>${L('Sejarah Bayaran', 'Payment History')}</h3><div id="bHist"><div class="loader" style="min-height:80px"><span class="spin"></span></div></div></div>`;
  renderPlans($('#bPlans'));
  try {
    const s = await getDocs(query(collection(db, 'payments'), where('cid', '==', S.cid)));
    const list = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    $('#bHist').innerHTML = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${L('Tarikh', 'Date')}</th><th>${L('Pakej', 'Plan')}</th><th>${L('Jumlah', 'Amount')}</th><th>${L('Status', 'Status')}</th><th>Ref</th></tr></thead>
      <tbody>${list.map(p => `<tr><td>${fmtDateTime(p.createdAt)}</td><td>${planName(p.plan)}</td><td>${money(p.amount)}</td>
        <td><span class="badge ${p.status === 'paid' ? 'b-ok' : p.status === 'failed' ? 'b-bad' : 'b-warn'}">${p.status === 'paid' ? L('Berjaya', 'Paid') : p.status === 'failed' ? L('Gagal', 'Failed') : L('Menunggu', 'Pending')}</span></td>
        <td class="xs mono">${esc(p.billCode || p.id)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty small">${L('Tiada bayaran lagi.', 'No payments yet.')}</div>`;
  } catch (e) { $('#bHist').innerHTML = `<div class="empty small">${esc(authErr(e))}</div>`; }
}
function planName(p) {
  return ({ monthly: L('Bulanan', 'Monthly'), sixMonth: L('6 Bulan', '6 Months'), yearly: L('Tahunan', 'Yearly'), trial: L('Percubaan', 'Trial'), manual: L('Manual', 'Manual') })[p] || (p || '-');
}
