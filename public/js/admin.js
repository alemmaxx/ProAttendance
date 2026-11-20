// ProAttendance — Halaman Admin Syarikat
import { auth, db, call, workerEmail, FIREBASE_CONFIG } from './fb.js';
import { APP_VERSION } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut,
  sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, runTransaction, increment, Timestamp, deleteField
} from './fs.js';
import {
  $, $$, L, esc, toast, modal, confirmBox, busy, applyLang, langBtn, keepInputs, installBtn, todayStr, fmtTime, fmtDate, fmtDateTime, toDate,
  minsToHM, dayName, addDays, summarizeDay, TYPE_LABEL, METHOD_LABEL, getPosition, mapLink, applyBrand, logoHtml,
  isExpired, daysLeft, randPin, randSecret, money, copyText, authErr, icon, fileToDataURL
} from './ui.js';
import {
  leaveTypes, leaveTypeName, DEFAULT_LEAVE_TYPES, holidayMap, fixedNationalHolidays, shiftById, shiftLabel, resolveDay,
  lateSettings, otKind, OT_LABEL, otRates, loadRoster, dateRange, weekStart, leaveBalances, leaveDateMap,
  REQ_LABEL, STATUS_BADGE, countLeaveDays
} from './sched.js';
import {
  computeItem, applyStatutory, totals, payrollSettings, periodRange, periodLabel, payslipHtml, openPrint, r2
} from './payroll.js';
import { pushAvailable, enablePush, refreshPush } from './push.js';
import { computeClaim, claimRates, CLAIM_RATE_DEFAULTS, claimDocHtml, claimExcel, claimSummaryExcel, statusBadge as claimBadge, claimTimeline } from './claims.js';

const app = $('#app');
const S = {
  user: null, me: null, cid: null, company: null, workers: [], locations: [], plans: {},
  view: 'dashboard', unsubs: [], viewUnsub: null, pending: []
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
  S.screen = ['auth', mode];
  stopAll();
  applyBrand({ color: '#d9b44a' });
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
        <img class="logo-lg" src="/icon.svg" alt="ProAttendance" style="background:none;border:0;padding:0">
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
      <p class="center small"><a href="/worker">${L('Log masuk Pekerja', 'Staff login')}</a></p>
      <p class="center xs" style="margin-top:.6rem"><a href="/privasi.html" target="_blank">${L('Terma & Notis Privasi', 'Terms & Privacy Notice')}</a></p>
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
  if (S.user && S.company && $('.shell')) return renderShell();
  const [k, arg] = S.screen || [];
  if (k === 'onb') keepInputs(() => renderOnboarding(arg));
  else if (!S.user || k === 'auth') keepInputs(() => renderAuth(arg || 'login'));
});

function stopAll() {
  S.unsubs.forEach(u => u()); S.unsubs = [];
  if (S.viewUnsub) { S.viewUnsub(); S.viewUnsub = null; }
}

onAuthStateChanged(auth, async (u) => {
  S.user = u;
  stopAll();
  if (!u) return renderAuth(new URLSearchParams(location.search).get('register') ? 'register' : 'login');
  app.innerHTML = `<div class="loader"><span class="spin"></span></div>`;
  try {
    const [meS, plS, supS] = await Promise.all([
      getDoc(doc(db, 'users', u.uid)), getDoc(doc(db, 'config', 'plans')).catch(() => null), getDoc(doc(db, 'config', 'super')).catch(() => null)
    ]);
    S.plans = plS?.exists() ? plS.data() : {};
    S.isSuper = !!(supS?.exists() && supS.data().uid === u.uid);
    const asCid = new URLSearchParams(location.search).get('cid');
    if (S.isSuper && asCid) {
      // Mod sokongan: Super Admin masuk ke syarikat pelanggan
      S.me = { role: 'admin', cid: asCid, perm: 'owner', support: true };
      S.cid = asCid;
      return startApp();
    }
    if (!meS.exists()) return renderOnboarding();
    S.me = meS.data();
    if (S.me.role === 'worker') { location.href = '/worker'; return; }
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
function renderOnboarding(extra = false) {
  S.screen = ['onb', extra];
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
      <div class="field"><label class="lbl">${L('E-mel syarikat', 'Company email')} *</label>
        <input class="input" id="cp" type="email" required maxlength="120" value="${esc(S.user.email || '')}"></div>
      <label class="check small" style="margin:.2rem 0 .8rem;align-items:flex-start"><input type="checkbox" id="obTerms" required>
        <span>${L('Saya bersetuju dengan <a href="/privasi.html" target="_blank">Terma & Notis Privasi</a>, dan akan mendapatkan persetujuan pekerja untuk data kehadiran (GPS, swafoto) & gaji.', 'I agree to the <a href="/privasi.html" target="_blank">Terms & Privacy Notice</a>, and will obtain staff consent for attendance (GPS, selfie) & payroll data.')}</span></label>
      <button class="btn btn-primary btn-block" id="ob" type="submit">${L('Mula Sekarang', 'Get Started')}</button>
      <p class="center small" style="margin-top:1rem">${extra ? `<button type="button" class="link-btn" id="back">← ${L('Kembali', 'Back')}</button> · ` : ''}${S.isSuper ? `<a href="/superadmin.html">Super Admin</a> · ` : ''}<button type="button" class="link-btn" id="lo">${L('Log keluar', 'Log out')}</button></p>
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
  $('#back') && ($('#back').onclick = () => startApp());
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
      let ref = '';
      try { ref = (localStorage.getItem('pa_ref') || '').toUpperCase().slice(0, 20); } catch {}
      b.set(newRef, {
        name, code, email: $('#cp').value.trim(), phone: '', termsAt: serverTimestamp(), termsVer: '2026-11', ownerUid: S.user.uid, ownerEmail: S.user.email || '', ref,
        logo: '', address: '', ssm: '', color: '#d9b44a',
        status: 'trial', plan: 'trial', expiry, createdAt: serverTimestamp(), seq: 0, workerCount: 0,
        settings: { workStart: '09:00', workEnd: '18:00', grace: 10, workDays: [1, 2, 3, 4, 5], selfie: true, oneDevice: false },
        departments: [], allowanceTemplates: []
      });
      b.set(doc(db, 'companyCodes', code), { cid: newRef.id, name, logo: '', color: '#d9b44a' });
      if (extra) {
        const cids = [...new Set([...(S.me.cids || [S.me.cid]), newRef.id])];
        b.update(doc(db, 'users', S.user.uid), { cid: newRef.id, cids });
        S.me = { ...S.me, cid: newRef.id, cids };
      } else {
        b.set(doc(db, 'users', S.user.uid), { role: 'admin', cid: newRef.id, cids: [newRef.id], email: S.user.email || '', createdAt: serverTimestamp() });
        S.me = { role: 'admin', cid: newRef.id, cids: [newRef.id] };
      }
      await b.commitFull();
      S.cid = newRef.id;
      stopAll();
      toast(L('Syarikat berjaya didaftarkan!', 'Company registered!'));
      startApp();
    } catch (err) { console.error(err); toast(authErr(err), 'bad', 5000); busy(btn, false); }
  };
  applyLang();
}

// ================================================================ APP
const perm = () => S.me?.perm || 'owner';
const isOwner = () => perm() === 'owner';
const isSupervisor = () => perm() === 'supervisor';
function logAct(action, detail = '') {
  if (!S.cid) return;
  addDoc(sub('logs'), {
    uid: S.user.uid, email: S.user.email || '', action, detail: String(detail).slice(0, 300),
    at: serverTimestamp(), support: !!S.me?.support
  }).catch(() => {});
}

function startApp() {
  stopAll();
  let first = true;
  S.unsubs.push(onSnapshot(cRef(), (s) => {
    S.company = s.data();
    applyBrand(S.company);
    if (first) { first = false; renderShell(); checkPayReturn(); if (!S.me.support) refreshPush(S.cid, S.user.uid, { role: 'admin', email: S.user.email || '', perm: perm() }); }
    else { updateBrandBits(); checkPaywall(); }
  }, err => toast(authErr(err), 'bad')));
  S.unsubs.push(onSnapshot(sub('workers'), (s) => {
    S.workers = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
    if (S.view === 'workers') renderWorkerList();
  }));
  S.unsubs.push(onSnapshot(query(sub('requests'), where('status', '==', 'pending')), (s) => {
    S.pending = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
      .sort((a, b) => (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0));
    updatePendingBadge();
    if (S.view === 'approvals') drawApprovals();
  }));
  S.unsubs.push(onSnapshot(sub('locations'), (s) => {
    S.locations = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (S.view === 'locations') viewLocations();
  }));
}

const NAV = () => [
  ['dashboard', 'home', L('Dashboard', 'Dashboard')],
  ['workers', 'users', L('Pekerja', 'Staff')],
  ['roster', 'cal', L('Syif & Jadual', 'Shifts & Roster')],
  ['approvals', 'check', L('Kelulusan (Cuti/OT)', 'Approvals (Leave/OT)')],
  ['claims', 'doc', L('Tuntutan', 'Claims')],
  ['payroll', 'money', L('Gaji', 'Payroll')],
  ['hr', 'shield', L('Fail HR', 'HR Files')],
  ['locations', 'pin', L('Lokasi', 'Locations')],
  ['reports', 'chart', L('Laporan', 'Reports')],
  ['news', 'bell', L('Pengumuman', 'Announcements')],
  ['settings', 'gear', L('Tetapan', 'Settings')],
  ['billing', 'card', L('Langganan', 'Subscription')]
].filter(([k]) => !isSupervisor() || ['dashboard', 'roster', 'approvals', 'claims', 'tasks', 'reports', 'news'].includes(k))
 .filter(([k]) => k !== 'billing' || isOwner());

function renderShell() {
  S.screen = ['shell'];
  const c = S.company;
  app.innerHTML = `
  <div class="shell">
    <aside class="side" id="side">
      <div class="side-brand"><span data-brand-logo>${logoHtml(c)}</span>
        <div><div class="nm" data-brand-name>${esc(c.name)}</div><div class="xs" style="opacity:.7">${esc(c.code)} · ${S.me.support ? 'Super Admin' : ({ owner: L('Pemilik', 'Owner'), manager: L('Pengurus', 'Manager'), supervisor: L('Penyelia', 'Supervisor') })[perm()]}</div></div></div>
      ${S.me.support ? `<div style="background:var(--warn-soft);color:var(--warn);padding:.5rem 1rem;font-size:.8rem;font-weight:700;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">${L('MOD SOKONGAN', 'SUPPORT MODE')} · <a href="/superadmin.html" style="color:var(--warn)">${L('Kembali', 'Back')}</a></div>` : ''}
      ${isOwner() && !S.me.support ? `<div style="padding:.5rem .8rem"><select class="input" id="coSwitch" style="font-size:.85rem;padding:.4rem .6rem;min-height:38px"></select></div>` : ''}
      <nav>${NAV().map(([k, ic, t]) => `<button data-v="${k}">${icon(ic)}<span class="grow">${t}</span>${k === 'approvals' ? '<span class="badge b-warn hide" id="pendBadge"></span>' : ''}</button>`).join('')}</nav>
      <div class="side-foot">
        <div class="xs" style="opacity:.75;word-break:break-all">${esc(S.user.email || '')}</div><div class="xs" style="opacity:.55">v${APP_VERSION}</div>
        <a class="btn btn-sm btn-ghost btn-block" href="/panduan.html" target="_blank">${icon('doc', 14)} ${L('Panduan Pengguna', 'User Guide')}</a>
        ${installBtn('btn btn-sm btn-soft btn-block')}
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
      <div class="content"><div class="pghero no-print"><div class="tag" id="vTag"></div><h2 class="gold-h" id="vH"></h2><p class="sub" id="vSub"></p></div><div id="view"></div></div>
    </div>
  </div>`;
  $$('.side nav button').forEach(b => b.onclick = () => { go(b.dataset.v); closeSide(); });
  $('#menuBtn').onclick = () => { $('#side').classList.add('open'); $('#sideBg').classList.add('open'); };
  $('#sideBg').onclick = closeSide;
  $('#lo').onclick = async () => { if (await confirmBox(L('Log keluar sekarang?', 'Log out now?'))) signOut(auth); };
  updateBrandBits();
  updatePendingBadge();
  if (!NAV().some(n => n[0] === S.view)) S.view = 'dashboard';
  go(S.view);
  checkPaywall();
  initSwitcher();
}

// Tukar antara syarikat (pemilik yang ada lebih dari satu syarikat)
async function initSwitcher() {
  const sel = $('#coSwitch'); if (!sel) return;
  const ids = [...new Set([...(S.me.cids || []), S.cid])];
  const docs = await Promise.all(ids.map(id => getDoc(doc(db, 'companies', id)).then(s => s.exists() ? { id, name: s.data().name } : null).catch(() => null)));
  sel.innerHTML = docs.filter(Boolean).map(d => `<option value="${d.id}" ${d.id === S.cid ? 'selected' : ''}>${esc(d.name)}</option>`).join('')
    + `<option value="__new">+ ${L('Tambah syarikat lain', 'Add another company')}</option>`;
  sel.onchange = async () => {
    if (sel.value === '__new') { stopAll(); S.company = null; return renderOnboarding(true); }
    try {
      await updateDoc(doc(db, 'users', S.user.uid), { cid: sel.value, cids: ids });
      S.me = { ...S.me, cid: sel.value, cids: ids }; S.cid = sel.value; S.view = 'dashboard';
      startApp();
    } catch (e) { toast(authErr(e), 'bad'); }
  };
}
function updatePendingBadge() {
  const b = $('#pendBadge'); if (!b) return;
  b.textContent = S.pending.length;
  b.classList.toggle('hide', !S.pending.length);
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
  // Jalur peringatan langganan hampir tamat (untuk pemilik / pengurus)
  $('#expBanner')?.remove();
  const d = daysLeft(c);
  if (!isExpired(c) && d <= 7 && !isSupervisor() && !S.me?.support && $('#view')) {
    const el = document.createElement('div');
    el.id = 'expBanner'; el.className = 'card'; el.style.cssText = 'border-color:var(--warn);background:var(--warn-soft);display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px';
    el.innerHTML = `<span>⏰ ${c.status === 'trial' ? L(`Tempoh percubaan tamat dalam <b>${d} hari</b>.`, `Your trial ends in <b>${d} days</b>.`) : L(`Langganan tamat dalam <b>${d} hari</b>.`, `Subscription ends in <b>${d} days</b>.`)} ${L('Pekerja tidak boleh punch selepas tamat.', 'Staff cannot punch after it ends.')}</span>
      <button class="btn btn-sm btn-primary" id="expPay">${L('Bayar sekarang', 'Pay now')}</button>`;
    $('#view').insertAdjacentElement('beforebegin', el);
    $('#expPay').onclick = () => go('billing');
  }
}

function go(v) {
  if (S.viewUnsub) { S.viewUnsub(); S.viewUnsub = null; }
  S.viewToken = null;
  S.view = v;
  $$('.side nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  const t = NAV().find(n => n[0] === v);
  $('#vTitle').textContent = t ? t[2] : '';
  const H = {
    dashboard: [L('Kehadiran hari ini.', "Today's attendance."), fmtDate(todayStr(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
    workers: [L('Senarai pekerja.', 'Your staff.'), L('Tambah pekerja, elaun (+), potongan & kad pekerja.', 'Add staff, allowances (+), deductions & staff cards.')],
    roster: [L('Syif & jadual.', 'Shifts & roster.'), L('Templat syif dan jadual mingguan setiap pekerja.', 'Shift templates and each staff weekly roster.')],
    approvals: [L('Kelulusan.', 'Approvals.'), L('Cuti, OT (masuk slip gaji), pembetulan punch, pendahuluan & tukar syif.', 'Leave, OT (goes to payslip), punch fixes, advances & shift swaps.')],
    claims: [L('Tuntutan pekerja.', 'Staff claims.'), L('Borang tuntutan bulanan — dokumen kelulusan berasingan, tidak masuk slip gaji.', 'Monthly claim forms — separate approval document, not in the payslip.')],
    tasks: [L('Tugasan harian.', 'Daily tasks.'), L('Beri tugasan dan semak yang sudah siap.', 'Assign tasks and check what is done.')],
    payroll: [L('Gaji pekerja.', 'Payroll.'), L('Jana, semak, kunci & terbit slip gaji.', 'Generate, review, lock & publish payslips.')],
    hr: [L('Fail HR.', 'HR files.'), L('Dokumen, amaran, prestasi, aset, pinjaman & onboarding.', 'Documents, warnings, reviews, assets, loans & onboarding.')],
    locations: [L('Lokasi kerja.', 'Work locations.'), L('Cawangan, geofence, kod QR & mod kiosk.', 'Branches, geofence, QR codes & kiosk mode.')],
    reports: [L('Laporan.', 'Reports.'), L('Kehadiran, cuti, lewat & OT — Excel / PDF.', 'Attendance, leave, lateness & OT — Excel / PDF.')],
    news: [L('Pengumuman.', 'Announcements.'), L('Mesej & undian kepada semua pekerja.', 'Messages & polls to all staff.')],
    settings: [L('Tetapan.', 'Settings.'), L('Profil syarikat, waktu kerja, cuti & admin.', 'Company profile, work hours, leave & admins.')],
    billing: [L('Langganan.', 'Subscription.'), L('Pakej, bayaran & kod promo.', 'Plans, payments & promo codes.')]
  }[v] || [t ? t[2] + '.' : '', ''];
  $('#vTag').textContent = '✦ ' + (S.company?.name || '');
  $('#vH').textContent = H[0];
  $('#vSub').textContent = H[1];
  ({ dashboard: viewDashboard, workers: viewWorkers, locations: viewLocations, reports: viewReports,
     news: viewNews, settings: viewSettings, billing: viewBilling, roster: viewRoster, approvals: viewApprovals, payroll: viewPayroll, tasks: viewTasks, hr: viewHR, claims: viewClaims })[v]();
  window.scrollTo(0, 0);
}

// ================================================================ PAYWALL
function checkPaywall() {
  $('#paywall')?.remove();
  if (!isExpired(S.company) || S.me.support) return;
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
      <div class="price">${S.promo ? `<s class="small muted">${money(pr)}</s> ${money(pr * (100 - S.promo.value) / 100)}` : money(pr)}</div>
      <div class="xs muted">≈ ${money(pr / m)} / ${L('bulan', 'month')}</div>
      <button class="btn btn-primary btn-block" style="margin-top:.7rem" data-plan="${k}">${L('Bayar', 'Pay')}</button>
    </div>`).join('')}</div>
    <p class="xs muted center" style="margin-top:.6rem">${L('Bayaran selamat melalui FPX / kad.', 'Secure payment via FPX / card.')}</p>`;
  $$('[data-plan]', box).forEach(b => b.onclick = async () => {
    busy(b, true);
    try {
      const r = await call('pa_createBill', { plan: b.dataset.plan, promo: S.promo?.code || '' });
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
      <span></span>
      <div class="row"><button class="btn btn-ok btn-sm" id="waSum">${icon('chat', 16)} ${L('Kongsi ringkasan', 'Share summary')}</button>
      <button class="btn btn-soft btn-sm" data-goto="reports">${icon('chart', 16)} ${L('Laporan', 'Reports')}</button></div>
    </div>
    <div class="stats" id="dStats"></div>
    <div class="grid2" style="gap:1rem;align-items:start">
      <div class="card"><div class="card-head"><h3>${L('Aktiviti terkini', 'Latest activity')}</h3></div><div id="dAct"></div></div>
      <div class="card"><div class="card-head"><h3>${L('Belum hadir', 'Not yet in')}</h3></div><div id="dAbs"></div></div>
    </div>
    <div class="grid2" style="gap:1rem;align-items:start;margin-top:1rem">
      <div class="card"><h3>${L('Kehadiran 14 hari', 'Attendance, last 14 days')}</h3><div id="dTrend"><div class="loader" style="min-height:100px"><span class="spin"></span></div></div></div>
      <div class="card"><h3>${L('Peringatan', 'Reminders')}</h3><div id="dRem"><div class="loader" style="min-height:100px"><span class="spin"></span></div></div></div>
    </div>
    <div class="grid2" style="gap:1rem;align-items:start;margin-top:1rem">
      <div class="card"><h3>${L('Kehadiran terbaik bulan ini', 'Best attendance this month')}</h3><div id="dRank"></div></div>
      <div class="card"><h3>${L('Ramalan kakitangan 14 hari', 'Staffing forecast, 14 days')}</h3><div id="dFc"></div></div>
    </div>`;
  $('#waSum').onclick = () => {
    const st = S.dashStats; if (!st) return;
    const txt = `*${S.company.name}* — ${L('Ringkasan kehadiran', 'Attendance summary')} ${fmtDate(t)}
${L('Hadir', 'Present')}: ${st.present}/${st.active}
${L('Lewat', 'Late')}: ${st.late}
${L('Bercuti', 'On leave')}: ${st.leave}
${L('Belum hadir', 'Not in')}: ${st.absent.length}${st.absent.length ? '\n- ' + st.absent.join('\n- ') : ''}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
  };
  dashExtras();
  $$('[data-goto]').forEach(b => b.onclick = () => go(b.dataset.goto));
  if (!S.workers.length && !S.locations.length) {
    $('#dAct').innerHTML = `<div class="empty">${L('Mula dengan menambah lokasi dan pekerja.', 'Start by adding locations and staff.')}<br><br>
      <button class="btn btn-primary btn-sm" data-goto2="locations">${icon('pin', 16)} ${L('Tambah Lokasi', 'Add Location')}</button>
      <button class="btn btn-primary btn-sm" data-goto2="workers">${icon('users', 16)} ${L('Tambah Pekerja', 'Add Staff')}</button></div>`;
    $$('[data-goto2]').forEach(b => b.onclick = () => go(b.dataset.goto2));
  }
  let roster = {}, todayLeave = {};
  const token = (S.viewToken = {});
  Promise.all([
    loadRoster(db, S.cid, t, t).then(r => { roster = r; }).catch(() => {}),
    getDocs(query(sub('requests'), where('status', '==', 'approved'))).then(s => {
      s.docs.map(d => d.data()).filter(r => r.kind === 'leave' && r.from <= t && (r.to || r.from) >= t)
        .forEach(r => { todayLeave[r.workerId] = r; });
    }).catch(() => {})
  ]).then(() => {
  if (S.viewToken !== token) return;
  S.viewUnsub = onSnapshot(query(sub('attendance'), where('date', '==', t)), (snap) => {
    const recs = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    const active = S.workers.filter(w => w.active !== false);
    const byUid = {};
    recs.forEach(r => (byUid[r.uid] = byUid[r.uid] || []).push(r));
    let present = 0, late = 0, onBreak = 0, out = 0;
    const presentIds = new Set();
    Object.values(byUid).forEach(list => {
      const w = S.workers.find(x => x.id === list[0].workerId);
      const s = summarizeDay(list, lateSettings(S.company, resolveDay(S.company, w, t, roster[t]?.[list[0].workerId])), t);
      if (s.firstIn) { present++; presentIds.add(list[0].workerId); }
      if (s.lateMin) late++;
      if (s.onBreak) onBreak++;
      if (s.lastType === 'out') out++;
    });
    const onLeave = active.filter(w => todayLeave[w.id] && !presentIds.has(w.id));
    S.dashStats = { present, late, active: active.length, leave: onLeave.length, absent: [] };
    const absent = active.filter(w => !presentIds.has(w.id) && !todayLeave[w.id]
      && resolveDay(S.company, w, t, roster[t]?.[w.id]).type === 'work');
    S.dashStats.absent = absent.map(w => w.name);
    $('#dStats').innerHTML = `
      <div class="stat"><div class="n">${active.length}</div><div class="t">${L('Pekerja aktif', 'Active staff')}</div></div>
      <div class="stat ok"><div class="n">${present}</div><div class="t">${L('Hadir', 'Present')}</div></div>
      <div class="stat warn"><div class="n">${late}</div><div class="t">${L('Lewat', 'Late')}</div></div>
      <div class="stat bad"><div class="n">${absent.length}</div><div class="t">${L('Belum hadir', 'Not in')}</div></div>
      <div class="stat info"><div class="n">${onBreak}</div><div class="t">${L('Sedang rehat', 'On break')}</div></div>
      <div class="stat"><div class="n">${out}</div><div class="t">${L('Sudah keluar', 'Clocked out')}</div></div>
      <div class="stat info"><div class="n">${onLeave.length}</div><div class="t">${L('Bercuti', 'On leave')}</div></div>
      <div class="stat warn" style="cursor:pointer" data-goto3="approvals"><div class="n">${S.pending.length}</div><div class="t">${L('Menunggu kelulusan', 'Pending approval')}</div></div>`;
    $$('[data-goto3]').forEach(b => b.onclick = () => go('approvals'));
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
          <td>${r.selfie ? `<img class="thumb" src="${r.selfie}" data-img="${r.id}" alt="">` : r.hasSelfie ? `<button class="btn btn-sm btn-ghost" data-img="${r.id}">📷</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${L('Belum ada punch hari ini.', 'No punches yet today.')}</div>`;
      $$('[data-img]').forEach(im => im.onclick = () => {
        const r = recs.find(x => x.id === im.dataset.img);
        showSelfie(r);
      });
    }
    $('#dAbs').innerHTML = absent.length ? `<ul class="timeline">${absent.map(w =>
      `<li><span class="dot d-out"></span><span class="grow">${esc(w.name)}</span><span class="xs muted mono">${esc(w.id)}</span></li>`).join('')}</ul>`
      : `<div class="empty small">${active.length ? L('Semua pekerja yang bertugas sudah hadir 🎉', 'Everyone on duty is in 🎉') : L('Tiada pekerja aktif.', 'No active staff.')}</div>`;
  }, err => toast(authErr(err), 'bad'));
  });
}

async function showSelfie(r) {
  let src = r.selfie;
  if (!src) {
    try { const s = await getDoc(doc(db, 'companies', S.cid, 'selfies', r.id)); src = s.exists() ? s.data().selfie : ''; } catch {}
  }
  modal({
    title: `${esc(r.name)} · ${TYPE_LABEL[r.type]?.() || r.type} ${fmtTime(r.ts)}`,
    body: src ? `<img src="${src}" style="width:100%;border-radius:12px">` : `<div class="empty">${L('Tiada gambar.', 'No photo.')}</div>`
  });
}

// ================================================================ PEKERJA
function viewWorkers() {
  $('#view').innerHTML = `
  <div class="card">
    <div class="card-head">
      <input class="input" id="wq" style="max-width:280px" placeholder="${L('Cari nama / ID…', 'Search name / ID…')}">
      <div class="row"><button class="btn btn-ghost" id="impW">${icon('dl', 18)} ${L('Import Excel', 'Import Excel')}</button>
      <button class="btn btn-ghost" id="cardsAll">${icon('qr', 18)} ${L('Kad semua', 'All cards')}</button>
      <button class="btn btn-primary" id="addW">${icon('plus', 18)} ${L('Tambah Pekerja', 'Add Staff')}</button></div>
    </div>
    <div id="wList"></div>
  </div>`;
  $('#addW').onclick = () => workerForm(null);
  $('#impW').onclick = importWorkers;
  $('#cardsAll').onclick = () => printCards(S.workers.filter(w => w.active !== false));
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
        ${w.phone ? `<a class="btn btn-sm btn-ghost" title="WhatsApp" target="_blank" rel="noopener" href="https://wa.me/${String(w.phone).replace(/\D/g, '').replace(/^0/, '60')}">${icon('chat', 16)}</a>` : ''}
        <button class="btn btn-sm btn-ghost" data-ed="${esc(w.id)}">${L('Sunting', 'Edit')}</button>
        <button class="btn btn-sm btn-ghost" data-more="${esc(w.id)}">⋯</button>
      </td></tr>`).join('')}</tbody></table></div>
    <p class="xs muted" style="margin-top:.6rem">${list.length} / ${S.workers.length} ${L('pekerja', 'staff')}</p>`;
  $$('[data-ed]', box).forEach(b => b.onclick = () => workerForm(S.workers.find(w => w.id === b.dataset.ed)));
  $$('[data-more]', box).forEach(b => b.onclick = () => workerMenu(S.workers.find(w => w.id === b.dataset.more)));
}

function allowRow(a = {}, finance = false) {
  return `<div class="dyn-row${finance ? '' : ' ded'}" data-row="allow">
    <input class="input" data-k="name" ${finance ? '' : 'list="allowList"'} placeholder="${L('Nama elaun', 'Allowance name')}" value="${esc(a.name || '')}">
    <input class="input" data-k="amount" type="number" step="0.01" min="0" placeholder="RM" value="${a.amount ?? ''}">
    <select class="input" data-k="type">${opts(ALLOW_TYPES(), a.type || 'monthly')}</select>
    ${finance ? `<label class="check"><input type="checkbox" data-k="epf" ${a.epf ? 'checked' : ''}>${L('KWSP', 'EPF')}</label>
    <label class="check"><input type="checkbox" data-k="socso" ${a.socso ? 'checked' : ''}>${L('PERKESO', 'SOCSO')}</label>` : ''}
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
        <div class="field"><label class="lbl">${L('Tarikh lahir', 'Date of birth')}</label><input class="input" name="dob" type="date" value="${esc(w.dob || '')}"></div>
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
        <div class="field"><label class="lbl">${L('Status (untuk caruman)', 'Status (for contributions)')}</label><select class="input" name="nationality">${opts([['citizen', L('Warganegara', 'Citizen')], ['pr', L('Pemastautin Tetap (PR)', 'Permanent Resident (PR)')], ['foreign', L('Pekerja asing', 'Foreign worker')]], w.nationality || 'citizen')}</select></div>
        <label class="check small"><input type="checkbox" name="socsoCat2" ${w.socsoCat2 ? 'checked' : ''}>${L('PERKESO Kategori 2 (mula mencarum pada umur 55+)', 'SOCSO Category 2 (first contributed at age 55+)')}</label>
        <label class="check small"><input type="checkbox" name="skbbkOut" ${w.skbbk === false ? 'checked' : ''}>${L('Tarik diri SKBBK / Lindung 24 Jam (warganegara sahaja)', 'Opted out of SKBBK / Lindung 24 Jam (locals only)')}</label>
      </div>
      <div class="sec-title">${L('Syif & Hari Bekerja', 'Shift & Work Days')}</div>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Syif biasa', 'Default shift')}</label>
          <select class="input" name="defaultShift"><option value="">${L('Ikut waktu kerja syarikat', 'Company work hours')} (${esc((c.settings || {}).workStart || '09:00')}–${esc((c.settings || {}).workEnd || '18:00')})</option>
          ${(c.shiftTemplates || []).map(sh => `<option value="${esc(sh.id)}" ${sh.id === w.defaultShift ? 'selected' : ''}>${esc(shiftLabel(sh))}</option>`).join('')}</select></div>
        <div class="field"><label class="lbl">${L('Hari bekerja', 'Work days')}</label>
          <label class="check" style="margin-bottom:.4rem"><input type="checkbox" id="wdOwn" ${Array.isArray(w.workDays) && w.workDays.length ? 'checked' : ''}>${L('Tetapkan khas untuk pekerja ini', 'Set specifically for this staff')}</label>
          <div class="row" id="wdBox">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="check"><input type="checkbox" data-wwd="${d}" ${(Array.isArray(w.workDays) && w.workDays.length ? w.workDays : ((c.settings || {}).workDays || [1, 2, 3, 4, 5])).includes(d) ? 'checked' : ''}>${dayName(d)}</label>`).join('')}</div></div>
      </div>
      <div class="sec-title">${L('Kelayakan Cuti (setahun)', 'Leave Entitlement (per year)')}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>${L('Jenis cuti', 'Leave type')}</th><th>${L('Kelayakan (hari)', 'Entitlement (days)')}</th><th>${L('Bawa ke hadapan', 'Carried forward')}</th></tr></thead>
        <tbody>${leaveTypes(c).map(lt => `<tr><td>${esc(lt.name)}</td>
          <td><input class="input" type="number" min="0" step="0.5" data-ent="${esc(lt.id)}" value="${w.leaveEntitle?.[lt.id] ?? ''}" placeholder="${lt.days ?? 0}" style="max-width:110px"></td>
          <td><input class="input" type="number" min="0" step="0.5" data-carry="${esc(lt.id)}" value="${w.leaveCarry?.[lt.id] ?? ''}" placeholder="0" style="max-width:110px"></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="xs muted">${L('Kosongkan untuk guna nilai lalai syarikat.', 'Leave blank to use the company default.')}</p>
      <div class="sec-title">${L('Elaun', 'Allowances')}</div>
      <p class="xs muted" style="margin-top:-.3rem">${L('KWSP / PERKESO untuk setiap elaun ditetapkan oleh finance di Gaji → Tetapan Kewangan.', 'EPF / SOCSO for each allowance is set by finance in Payroll → Finance Settings.')}</p>
      <datalist id="allowList">${tpls.map(t => `<option value="${esc(t.name)}">`).join('')}</datalist>
      <div id="allowBox">${(w.allowances || []).map(allowRow).join('')}</div>
      <div class="row">
        <button type="button" class="btn btn-sm btn-plus" id="addAllow">${icon('plus', 16)} ${L('Tambah Elaun', 'Add Allowance')}</button>
        ${tpls.length ? `<select class="input" id="tplSel" style="width:auto;padding:.38rem .6rem;font-size:.85rem">
          <option value="">${L('+ Dari templat…', '+ From template…')}</option>${tpls.map((t, i) => `<option value="${i}">${esc(t.name)}${t.amount ? ` (${money(t.amount)})` : ""}</option>`).join('')}</select>` : ''}
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
  const syncWd = () => $$('[data-wwd]', el).forEach(x => x.disabled = !$('#wdOwn', el).checked);
  $('#wdOwn', el).onchange = syncWd; syncWd();
  const ts = $('#tplSel', el);
  if (ts) ts.onchange = () => { if (ts.value !== '') { $('#allowBox', el).insertAdjacentHTML('beforeend', allowRow(tpls[Number(ts.value)])); ts.value = ''; } };
}

async function saveWorker(el, w) {
  const f = $('#wf', el);
  if (!f.reportValidity()) return false;
  const fd = Object.fromEntries(new FormData(f).entries());
  const data = {
    name: fd.name.trim(), ic: fd.ic.trim(), phone: fd.phone.trim(), email: fd.email.trim(), dob: fd.dob || '',
    position: fd.position.trim(), dept: fd.dept, branchId: fd.branchId || null, startDate: fd.startDate || '',
    payType: fd.payType, salary: Number(fd.salary || 0),
    bank: fd.bank.trim(), bankAcc: fd.bankAcc.trim(), epfNo: fd.epfNo.trim(), socsoNo: fd.socsoNo.trim(), taxNo: fd.taxNo.trim(),
    nationality: fd.nationality || 'citizen', socsoCat2: !!fd.socsoCat2, skbbk: !(fd.skbbkOut && fd.nationality !== 'foreign'),
    allowances: readRows(el, 'allow'), deductions: readRows(el, 'ded'), updatedAt: serverTimestamp(),
    defaultShift: fd.defaultShift || '',
    workDays: $('#wdOwn', el).checked ? $$('[data-wwd]', el).filter(x => x.checked).map(x => Number(x.dataset.wwd)) : [],
    leaveEntitle: Object.fromEntries($$('[data-ent]', el).filter(x => x.value !== '').map(x => [x.dataset.ent, Number(x.value)])),
    leaveCarry: Object.fromEntries($$('[data-carry]', el).filter(x => x.value !== '').map(x => [x.dataset.carry, Number(x.value)])),
    leaveCarryYear: new Date().getFullYear(),
    statutory: {}
  };
  try {
    if (w) {
      await updateDoc(doc(db, 'companies', S.cid, 'workers', w.id), data);
      logAct('worker.update', `${w.id} ${data.name}`);
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
    await b.commitFull();
    logAct('worker.create', `${wid} ${data.name}`);
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

🔗 ${location.origin}/worker
🆔 ID Pekerja: ${wid}
🔑 PIN sementara: ${pin}

Sila log masuk dan tukar PIN anda. Anda boleh "Add to Home Screen" untuk guna seperti app.`,
`Hi ${name},
Your ${S.company.name} attendance account is ready.

🔗 ${location.origin}/worker
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
      ${!isSupervisor() ? `<button class="btn btn-ghost btn-block" data-act="hr">${icon('shield', 18)} ${L('Fail HR', 'HR File')}</button>` : ''}
      <button class="btn btn-ghost btn-block" data-act="card">${icon('qr', 18)} ${L('Cetak kad pekerja', 'Print staff card')}</button>
      <button class="btn ${w.active === false ? 'btn-ok' : 'btn-danger'} btn-block" data-act="act">${w.active === false ? L('Aktifkan semula', 'Reactivate') : L('Nyahaktifkan pekerja', 'Deactivate staff')}</button>
    </div>`
  });
  $$('[data-act]', m.el).forEach(b => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === 'pin') {
      if (!await confirmBox(L(`Reset PIN untuk ${w.name}?`, `Reset PIN for ${w.name}?`))) return;
      busy(b, true);
      const pin = randPin();
      try { await call('pa_resetWorkerPin', { workerId: w.id, pin }); logAct('worker.resetPin', w.id); m.close(); showLogin(w.id, pin, w.name, w.phone, false); }
      catch (e) { toast(L('Gagal reset PIN: ', 'Failed to reset PIN: ') + (e.message || e), 'bad', 5000); }
      finally { busy(b, false); }
    } else if (a === 'dev') {
      await updateDoc(doc(db, 'companies', S.cid, 'workers', w.id), { deviceId: null });
      toast(L('Telefon direset. Pekerja boleh log masuk dari telefon baharu.', 'Phone reset. Staff can log in from a new phone.'));
      m.close();
    } else if (a === 'hist') {
      m.close(); S.reportWorker = w.id; go('reports');
    } else if (a === 'hr') {
      m.close(); S.hrWorker = w.id; go('hr');
    } else if (a === 'card') {
      printCards([w]);
    } else if (a === 'act') {
      const to = w.active === false;
      if (!await confirmBox(to ? L(`Aktifkan semula ${w.name}?`, `Reactivate ${w.name}?`) : L(`Nyahaktifkan ${w.name}? Pekerja tidak boleh log masuk atau punch.`, `Deactivate ${w.name}? They will not be able to log in or punch.`))) return;
      busy(b, true);
      try { await call('pa_setWorkerActive', { workerId: w.id, active: to }); }
      catch { await updateDoc(doc(db, 'companies', S.cid, 'workers', w.id), { active: to }); }
      logAct(to ? 'worker.activate' : 'worker.deactivate', w.id);
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
      <div class="row"><a class="btn btn-ghost" href="/kiosk.html" target="_blank">${icon('building', 18)} ${L('Mod Kiosk (tablet)', 'Kiosk Mode (tablet)')}</a>
      <button class="btn btn-primary" id="addL">${icon('plus', 18)} ${L('Tambah Lokasi', 'Add Location')}</button></div></div>
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
    logAct('location.delete', l.name);
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
            logAct('location.save', data.name);
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
    const [s, roster, rq] = await Promise.all([
      getDocs(query(sub('attendance'), where('date', '>=', from), where('date', '<=', to))),
      loadRoster(db, S.cid, from, to).catch(() => ({})),
      getDocs(query(sub('requests'), where('status', '==', 'approved'))).catch(() => null)
    ]);
    let recs = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (wid) recs = recs.filter(r => r.workerId === wid);
    const approved = rq ? rq.docs.map(d => d.data()) : [];
    const workers = S.workers.filter(w => wid ? w.id === wid : true);
    const wById = Object.fromEntries(S.workers.map(w => [w.id, w]));
    const info = (w, d) => resolveDay(S.company, w, d, roster[d]?.[w?.id]);
    // Harian
    const key = {};
    recs.forEach(r => { const k = r.workerId + '|' + r.date; (key[k] = key[k] || []).push(r); });
    const daily = Object.entries(key).map(([k, list]) => {
      const [workerId, date] = k.split('|');
      const sm = summarizeDay(list, lateSettings(S.company, info(wById[workerId], date)), date);
      return { workerId, name: list[0].name, date, ...sm };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.workerId.localeCompare(b.workerId));
    const end = to > todayStr() ? todayStr() : to;
    const dates = from <= end ? dateRange(from, end) : [];
    // Ringkasan
    const summary = workers.map(w => {
      const rows = daily.filter(r => r.workerId === w.id);
      const presentDates = new Set(rows.filter(r => r.firstIn).map(r => r.date));
      const lv = leaveDateMap(approved.filter(r => r.workerId === w.id));
      const start = w.startDate || '0000-00-00';
      let absent = 0, leave = 0;
      dates.forEach(d => {
        if (d < start) return;
        const di = info(w, d);
        if (lv[d] && di.type === 'work') { leave += (lv[d].half && lv[d].from === lv[d].to) ? 0.5 : 1; return; }
        if (di.type === 'work' && !presentDates.has(d)) absent++;
      });
      const ot = { normal: 0, rest: 0, holiday: 0 };
      approved.filter(r => r.kind === 'ot' && r.workerId === w.id && r.date >= from && r.date <= to).forEach(r => {
        ot[otKind(info(w, r.date))] += Number(r.approvedHours ?? r.hours ?? 0);
      });
      return {
        id: w.id, name: w.name, dept: w.dept || '', present: presentDates.size, leave, absent,
        lateDays: rows.filter(r => r.lateMin > 0).length,
        lateMin: rows.reduce((a, r) => a + r.lateMin, 0),
        workMin: rows.reduce((a, r) => a + r.workMin, 0),
        ot
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
          <thead><tr><th>ID</th><th>${L('Nama', 'Name')}</th><th>${L('Hadir', 'Present')}</th><th>${L('Cuti', 'Leave')}</th><th>${L('Tidak hadir', 'Absent')}</th><th>${L('Hari lewat', 'Late days')}</th><th>${L('Minit lewat', 'Late mins')}</th><th>${L('Jam kerja', 'Hours')}</th>
            <th>OT ${L('biasa', 'normal')}</th><th>OT ${L('rehat', 'rest')}</th><th>OT ${L('C.umum', 'holiday')}</th></tr></thead>
          <tbody>${summary.map(r => `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.name)}</td><td>${r.present}</td><td>${r.leave || 0}</td>
            <td>${r.absent ? `<span class="badge b-bad">${r.absent}</span>` : 0}</td><td>${r.lateDays ? `<span class="badge b-warn">${r.lateDays}</span>` : 0}</td>
            <td>${r.lateMin}</td><td>${minsToHM(r.workMin)}</td><td>${r.ot.normal}j</td><td>${r.ot.rest}j</td><td>${r.ot.holiday}j</td></tr>`).join('') || `<tr><td colspan="11" class="center muted">${L('Tiada data', 'No data')}</td></tr>`}</tbody>
        </table></div>
        <p class="xs muted" style="margin-top:.5rem">${L('Tidak hadir = hari bekerja (ikut syif/jadual) tanpa punch dan tanpa cuti diluluskan. Cuti umum & hari rehat tidak dikira. OT = jam OT yang diluluskan.', 'Absent = work days (by shift/roster) with no punch and no approved leave. Holidays & rest days excluded. OT = approved OT hours.')}</p>
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
    ['ID', L('Nama', 'Name'), L('Jabatan', 'Department'), L('Hadir', 'Present'), L('Cuti', 'Leave'), L('Tidak hadir', 'Absent'), L('Hari lewat', 'Late days'), L('Minit lewat', 'Late mins'), L('Jam kerja', 'Hours'),
      L('OT hari biasa (jam)', 'OT normal (hrs)'), L('OT hari rehat (jam)', 'OT rest (hrs)'), L('OT cuti umum (jam)', 'OT holiday (hrs)')],
    ...REPORT.summary.map(r => [r.id, r.name, r.dept, r.present, r.leave, r.absent, r.lateDays, r.lateMin, +(r.workMin / 60).toFixed(2), r.ot.normal, r.ot.rest, r.ot.holiday])]);
  const s2 = XLSX.utils.aoa_to_sheet([...head,
    [L('Tarikh', 'Date'), 'ID', L('Nama', 'Name'), L('Masuk', 'In'), L('Keluar', 'Out'), L('Rehat (min)', 'Break (min)'), L('Jam kerja', 'Hours'), L('Lewat (min)', 'Late (min)'), L('Lokasi', 'Location')],
    ...REPORT.daily.map(r => [r.date, r.workerId, r.name, fmtTime(r.firstIn), r.open ? '' : fmtTime(r.lastOut), Math.round(r.breakMin), +(r.workMin / 60).toFixed(2), r.lateMin, r.locName])]);
  s1['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
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
    <div class="field"><label class="lbl">${L('Undian (pilihan) — satu pilihan setiap baris', 'Poll (optional) — one option per line')}</label>
      <textarea class="input" id="nopt" maxlength="500" style="min-height:60px" placeholder="${L('cth:\nSetuju\nTidak setuju', 'e.g.\nAgree\nDisagree')}"></textarea></div>
    <button class="btn btn-primary" id="nsend">${icon('plus', 18)} ${L('Hantar', 'Post')}</button>
  </div>
  <div class="card"><h3>${L('Senarai Pengumuman', 'Announcements')}</h3><div id="nlist"></div></div>`;
  $('#nsend').onclick = async (e) => {
    const title = $('#nt').value.trim(), body = $('#nbd').value.trim();
    if (!title) return toast(L('Sila isi tajuk.', 'Please enter a title.'), 'warn');
    busy(e.currentTarget, true);
    const options = $('#nopt').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 10);
    try { await addDoc(sub('announcements'), { title, body, options, createdAt: serverTimestamp(), by: S.user.email || '' }); $('#nt').value = ''; $('#nbd').value = ''; $('#nopt').value = ''; logAct('announcement.create', title); toast(L('Pengumuman dihantar.', 'Announcement posted.')); }
    catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  S.viewUnsub = onSnapshot(query(sub('announcements'), orderBy('createdAt', 'desc'), limit(50)), s => {
    $('#nlist').innerHTML = s.empty ? `<div class="empty">${L('Tiada pengumuman.', 'No announcements.')}</div>` : s.docs.map(d => {
      const a = d.data({ serverTimestamps: 'estimate' });
      return `<div class="day-row" style="align-items:flex-start"><div class="grow"><div class="bold">${esc(a.title)}</div>
        <div class="small" style="white-space:pre-wrap">${esc(a.body)}</div>
        ${(a.options || []).length ? `<div class="row" style="margin:.3rem 0" data-res="${d.id}">${a.options.map((o, i) => `<span class="badge" data-o="${i}">${esc(o)}: …</span>`).join('')}</div>` : ''}
        <div class="xs muted">${fmtDateTime(a.createdAt)}</div></div>
        <button class="icon-btn" data-dn="${d.id}">✕</button></div>`;
    }).join('');
    $$('[data-res]').forEach(async box => {
      try {
        const v = await getDocs(collection(db, 'companies', S.cid, 'announcements', box.dataset.res, 'votes'));
        const cnt = {}; v.docs.forEach(x => { cnt[x.data().opt] = (cnt[x.data().opt] || 0) + 1; });
        $$('[data-o]', box).forEach(b => { b.textContent = b.textContent.replace(/: …$/, '') + ': ' + (cnt[b.dataset.o] || 0); b.classList.add('b-brand'); });
      } catch {}
    });
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
      <div class="field"><label class="lbl">${L('No. telefon', 'Phone no.')}</label><input class="input" id="sPhone" inputmode="tel" value="${esc(c.phone || '')}"></div>
      <div class="field"><label class="lbl">${L('E-mel syarikat', 'Company email')}</label><input class="input" id="sEmail" type="email" value="${esc(c.email || c.ownerEmail || '')}"></div>
      <div class="field"><label class="lbl">${L('Warna tema', 'Theme colour')}</label><input class="input" type="color" id="sColor" value="${esc(c.color && c.color.toLowerCase() !== '#1d4ed8' ? c.color : '#d9b44a')}" style="height:46px;padding:.2rem"></div>
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
    <h3 style="margin-top:.6rem">${L('Rehat & OT Automatik', 'Automatic Break & OT')}</h3>
    <div class="set-row"><div><b>${L('Rehat automatik', 'Automatic break')}</b><div class="small muted">${L('Masa rehat ditolak sendiri untuk semua pekerja — tidak perlu punch rehat. Syif boleh ada masa rehat sendiri.', 'Break time is deducted automatically for all staff — no break punch needed. Shifts can have their own break time.')}</div></div>
      <label class="switch"><input type="checkbox" id="tABrk" ${st.autoBreak ? 'checked' : ''}><span></span></label></div>
    <div class="grid2" style="margin-top:.4rem">
      <div class="field"><label class="lbl">${L('Rehat mula', 'Break from')}</label><input class="input" type="time" id="wBs" value="${esc(st.breakStart || '13:00')}"></div>
      <div class="field"><label class="lbl">${L('Rehat tamat', 'Break until')}</label><input class="input" type="time" id="wBe" value="${esc(st.breakEnd || '14:00')}"></div>
    </div>
    <div class="set-row"><div><b>${L('OT automatik', 'Automatic OT')}</b><div class="small muted">${L('Bila pekerja keluar lewat dari tamat syif, atau masuk semula (cth: waktu malam), jam OT dikira dan dihantar ke Kelulusan. Hari rehat / cuti umum: semua jam dikira OT.', 'When staff clock out after shift end, or come back (e.g. at night), OT hours are calculated and sent to Approvals. Rest days / public holidays: all hours count as OT.')}</div></div>
      <label class="switch"><input type="checkbox" id="tAOT" ${st.autoOT ? 'checked' : ''}><span></span></label></div>
    <div class="grid2" style="margin-top:.4rem">
      <div class="field"><label class="lbl">${L('OT minimum (minit)', 'Minimum OT (minutes)')}</label><input class="input" type="number" min="0" id="wOm" value="${st.otMin ?? 30}"></div>
      <div class="field"><label class="lbl">${L('Bundar ke bawah setiap (minit)', 'Round down to every (minutes)')}</label><input class="input" type="number" min="1" id="wOr" value="${st.otRound ?? 15}"></div>
    </div>
    <h3 style="margin-top:.6rem">${L('Tetapan Clock-in', 'Clock-in Settings')}</h3>
    <div class="set-row"><div><b>${L('Selfie wajib semasa punch', 'Selfie required when punching')}</b><div class="small muted">${L('Gambar disimpan sebagai bukti (tanpa pengecaman wajah).', 'Photo kept as proof (no face recognition).')}</div></div>
      <label class="switch"><input type="checkbox" id="tSelfie" ${st.selfie !== false ? 'checked' : ''}><span></span></label></div>
    <div class="set-row"><div><b>${L('Satu telefon seorang pekerja', 'One phone per staff')}</b><div class="small muted">${L('Akaun dikunci pada telefon pertama yang log masuk.', 'Account locks to the first phone that logs in.')}</div></div>
      <label class="switch"><input type="checkbox" id="tDev" ${st.oneDevice ? 'checked' : ''}><span></span></label></div>
    <div class="set-row"><div><b>${L('Butang Update Kerja (luar pejabat)', 'Work Update button (outside office)')}</b><div class="small muted">${L('Muncul hanya bila pekerja berada di luar kawasan pejabat. Lokasi GPS, kerja & gambar dikemas kini ke Jadual & Catatan.', 'Appears only when staff are outside the office area. GPS location, work & photo update Schedule & Notes.')}</div></div>
      <label class="switch"><input type="checkbox" id="tVisit" ${st.visits ? 'checked' : ''}><span></span></label></div>
    <button class="btn btn-primary" id="saveWork" style="margin-top:.8rem">${L('Simpan Tetapan', 'Save Settings')}</button>
  </div>

  <div class="card">
    <h3>${L('Jabatan', 'Departments')}</h3>
    <div class="chips" id="deptChips" style="margin-bottom:.7rem"></div>
    <div class="row"><input class="input grow" id="deptIn" style="max-width:300px" placeholder="${L('Nama jabatan', 'Department name')}">
      <button class="btn btn-plus" id="deptAdd">${icon('plus', 16)} ${L('Tambah', 'Add')}</button></div>
  </div>

  <div class="card">
    <h3>${L('Jenis Cuti', 'Leave Types')}</h3>
    <p class="small muted">${L('Kelayakan lalai setahun. Boleh diubah untuk setiap pekerja.', 'Default yearly entitlement. Can be changed per staff.')}</p>
    <div id="ltBox">${leaveTypes(c).map(ltRow).join('')}</div>
    <div class="row"><button class="btn btn-sm btn-plus" id="ltAdd">${icon('plus', 16)} ${L('Tambah Jenis Cuti', 'Add Leave Type')}</button>
      <button class="btn btn-primary btn-sm" id="ltSave">${L('Simpan', 'Save')}</button></div>
    <div class="sec-title">${L('Pro-rata & Bawa ke Hadapan', 'Pro-rata & Carry Forward')}</div>
    <div class="set-row"><div><b>${L('Cuti tahunan pro-rata', 'Pro-rated annual leave')}</b><div class="small muted">${L('Pekerja yang mula bekerja tahun ini dapat cuti tahunan ikut bulan berkhidmat (perlu Tarikh Mula Kerja dalam profil).', 'Staff who joined this year get annual leave by months served (needs Start Date in the profile).')}</div></div>
      <label class="switch"><input type="checkbox" id="lvPr" ${c.settings?.leaveProrata ? 'checked' : ''}><span></span></label></div>
    <div class="set-row"><div><b>${L('Had bawa ke hadapan (hari)', 'Carry-forward limit (days)')}</b><div class="small muted">${L('Baki cuti tahunan maksimum yang boleh dibawa ke tahun baharu.', 'Maximum unused annual leave carried into the new year.')}</div></div>
      <input class="input" type="number" min="0" step="0.5" id="lvCarryMax" value="${c.settings?.carryMax ?? 5}" style="max-width:100px"></div>
    <div class="row"><button class="btn btn-primary btn-sm" id="lvSave">${L('Simpan', 'Save')}</button>
      <button class="btn btn-soft btn-sm" id="lvCarry">${L(`Kira baki bawa ke ${new Date().getFullYear()}`, `Calculate carry-forward into ${new Date().getFullYear()}`)}</button></div>
  </div>

  <div class="card">
    <h3>${L('Cuti Umum', 'Public Holidays')}</h3>
    <p class="small muted">${L('Hari cuti umum tidak dikira tidak hadir, dan OT pada hari ini guna kadar cuti umum.', 'Holidays are not counted as absent, and OT on these days uses the holiday rate.')}</p>
    <div id="holBox">${[...(c.holidays || [])].sort((a, b) => a.date.localeCompare(b.date)).map(holRow).join('')}</div>
    <div class="row">
      <button class="btn btn-sm btn-plus" id="holAdd">${icon('plus', 16)} ${L('Tambah Cuti Umum', 'Add Holiday')}</button>
      <button class="btn btn-sm btn-soft" id="holFixed">${L('+ Cuti tetap kebangsaan', '+ Fixed national holidays')} ${new Date().getFullYear()}</button>
      <button class="btn btn-sm btn-soft" id="holCopy">${L('Salin dari tahun lepas', 'Copy from last year')}</button>
      <button class="btn btn-primary btn-sm" id="holSave">${L('Simpan', 'Save')}</button>
    </div>
    <p class="xs muted" style="margin-top:.5rem">${L('Cuti agama (Hari Raya, CNY, Deepavali dll.) berubah setiap tahun — sila tambah sendiri ikut kalendar rasmi negeri anda.', 'Religious holidays (Hari Raya, CNY, Deepavali etc.) change yearly — add them from your state\'s official calendar.')}</p>
  </div>

  ${isOwner() ? `<div class="card">
    <div class="card-head"><h3>${L('Admin & Penyelia', 'Admins & Supervisors')}</h3>
      <button class="btn btn-sm btn-plus" id="admAdd">${icon('plus', 16)} ${L('Tambah Admin', 'Add Admin')}</button></div>
    <p class="small muted">${L('Pengurus: semua kecuali langganan & urus admin. Penyelia: dashboard, jadual, kelulusan, tugasan, laporan & pengumuman sahaja.', 'Manager: everything except subscription & admin management. Supervisor: dashboard, roster, approvals, tasks, reports & announcements only.')}</p>
    <div id="admList"><div class="loader" style="min-height:60px"><span class="spin"></span></div></div>
  </div>` : ''}

  <div class="card" style="border:2px dashed var(--brand)">
    <h3>${L('Data Demo', 'Demo Data')}</h3>
    <p class="small muted">${L('Isi syarikat ini dengan data contoh (8 pekerja, kehadiran 30 hari, syif, cuti, OT, tuntutan, tugasan, pengumuman, fail HR) untuk cuba semua ciri. Boleh dipadam bila-bila masa.', 'Fill this company with sample data (8 staff, 30 days of attendance, shifts, leave, OT, claims, tasks, announcements, HR files) to try every feature. Can be deleted any time.')}</p>
    <div class="row">
      <button class="btn btn-primary" id="demoSeed">${icon('plus', 18)} ${L('Isi Data Demo', 'Fill Demo Data')}</button>
      <button class="btn btn-ghost" id="demoClear">${L('Padam Data Demo', 'Delete Demo Data')}</button>
    </div>
  </div>

  <div class="card">
    <h3>${L('Log Perubahan & Sandaran', 'Change Log & Backup')}</h3>
    <div class="row">
      <button class="btn btn-ghost" id="logBtn">${icon('doc', 18)} ${L('Lihat log perubahan', 'View change log')}</button>
      <button class="btn btn-ghost" id="bkBtn">${icon('dl', 18)} ${L('Muat turun semua data (JSON)', 'Download all data (JSON)')}</button>
    </div>
  </div>

  <div class="card">
    <h3>${L('Akaun', 'Account')}</h3>
    <div class="set-row"><span class="muted">${L('E-mel', 'Email')}</span><b>${esc(S.user.email || '')}</b></div>
    <div class="set-row"><span class="muted">${L('Bahasa', 'Language')}</span>${langBtn().replace('lang-btn', 'btn btn-sm btn-ghost')}</div>
    <div class="set-row hide" id="pushRow"><span class="muted">${L('Notifikasi push (permohonan baharu)', 'Push notifications (new requests)')}</span>
      <button class="btn btn-sm btn-ghost" id="pushA">${L('Hidupkan', 'Turn on')}</button></div>
    <div class="set-row"><span class="muted">${L('Pautan login pekerja', 'Staff login link')}</span>
      <button class="btn btn-sm btn-ghost" id="cpLink">${esc(location.host)}/worker · ${L('Salin', 'Copy')}</button></div>
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
      b.update(cRef(), { name, logo, color, ssm: $('#sSsm').value.trim(), phone: $('#sPhone').value.trim(), email: $('#sEmail').value.trim(), address: $('#sAddr').value.trim() });
      b.update(doc(db, 'companyCodes', c.code), { name, logo, color });
      await b.commit();
      logAct('settings.profile', name);
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
        'settings.autoBreak': $('#tABrk').checked, 'settings.breakStart': $('#wBs').value || '', 'settings.breakEnd': $('#wBe').value || '',
        'settings.autoOT': $('#tAOT').checked, 'settings.otMin': Number($('#wOm').value || 0), 'settings.otRound': Math.max(1, Number($('#wOr').value || 15)),
        'settings.workDays': $$('[data-wd]').filter(x => x.checked).map(x => Number(x.dataset.wd)),
        'settings.selfie': $('#tSelfie').checked, 'settings.oneDevice': $('#tDev').checked, 'settings.visits': $('#tVisit').checked
      });
      logAct('settings.work');
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
  $('#cpLink').onclick = () => copyText(location.origin + '/worker');

  $('#logBtn').onclick = showLogs;
  $('#demoSeed').onclick = (e) => seedDemo(e.currentTarget);
  $('#demoClear').onclick = (e) => clearDemo(e.currentTarget);
  if (!S.me.support) pushAvailable().then(ok => {
    if (!ok || !$('#pushRow')) return;
    $('#pushRow').classList.remove('hide');
    if (Notification.permission === 'granted') $('#pushA').textContent = '✓ ' + L('Aktif', 'On');
    $('#pushA').onclick = async () => {
      try { await enablePush(S.cid, S.user.uid, { role: 'admin', email: S.user.email || '', perm: perm() }); $('#pushA').textContent = '✓ ' + L('Aktif', 'On'); }
      catch { toast(L('Notifikasi tidak dibenarkan oleh pelayar.', 'Notifications blocked by the browser.'), 'warn'); }
    };
  });
  $('#bkBtn').onclick = (e) => backupAll(e.currentTarget);
  if ($('#admList')) { drawAdmins(); $('#admAdd').onclick = addAdmin; }

  // Jenis cuti
  const ltBox = $('#ltBox'); bindDyn(ltBox);
  $('#ltAdd').onclick = () => ltBox.insertAdjacentHTML('beforeend', ltRow({}));
  $('#ltSave').onclick = async (e) => {
    const rows = $$('[data-row="lt"]', ltBox).map(r => ({
      id: r.dataset.id || ('t' + Math.random().toString(36).slice(2, 8)),
      name: $('[data-k="name"]', r).value.trim(), days: Number($('[data-k="days"]', r).value || 0), paid: $('[data-k="paid"]', r).checked
    })).filter(x => x.name);
    busy(e.currentTarget, true);
    try { await updateDoc(cRef(), { leaveTypes: rows }); toast(L('Jenis cuti disimpan.', 'Leave types saved.')); viewSettings(); }
    catch (err) { toast(authErr(err), 'bad'); busy(e.currentTarget, false); }
  };
  // Pro-rata & bawa ke hadapan
  $('#lvSave').onclick = async (e) => {
    busy(e.currentTarget, true);
    try { await updateDoc(cRef(), { 'settings.leaveProrata': $('#lvPr').checked, 'settings.carryMax': Number($('#lvCarryMax').value || 0) }); toast(L('Disimpan.', 'Saved.')); }
    catch (err) { toast(authErr(err), 'bad'); } finally { busy(e.currentTarget, false); }
  };
  $('#lvCarry').onclick = async (e) => {
    const Y = new Date().getFullYear(), max = Number($('#lvCarryMax').value || 0);
    busy(e.currentTarget, true);
    try {
      const s = await getDocs(query(sub('requests'), where('kind', '==', 'leave')));
      const prev = s.docs.map(d => d.data()).filter(r => r.status === 'approved' && String(r.from || '').startsWith(String(Y - 1)));
      const rows = S.workers.filter(w => w.active !== false).map(w => {
        const b = leaveBalances(S.company, { ...w, leaveCarryYear: w.leaveCarryYear ?? Y - 1 }, prev.filter(r => r.workerId === w.id), Y - 1).find(x => x.id === 'annual');
        const left = Math.max(0, b ? b.left : 0);
        return { w, left, carry: Math.min(max, left) };
      });
      busy(e.currentTarget, false);
      modal({
        title: L(`Baki cuti tahunan dibawa ke ${Y}`, `Annual leave carried into ${Y}`), wide: true,
        body: `<p class="small muted">${L(`Baki cuti tahunan ${Y - 1} setiap pekerja, dihadkan kepada ${max} hari.`, `Each staff member's unused ${Y - 1} annual leave, capped at ${max} days.`)}</p>
          <div class="table-wrap" style="max-height:340px;overflow:auto"><table><thead><tr><th>${L('Pekerja', 'Staff')}</th><th class="right">${L(`Baki ${Y - 1}`, `${Y - 1} balance`)}</th><th class="right">${L('Dibawa', 'Carried')}</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td>${esc(r.w.name)} <span class="xs muted mono">${esc(r.w.id)}</span></td><td class="right">${r.left}</td><td class="right"><b>${r.carry}</b></td></tr>`).join('')}</tbody></table></div>`,
        actions: [{ label: L('Batal', 'Cancel') }, { label: L('Simpan ke profil pekerja', 'Save to staff profiles'), cls: 'btn-primary', onClick: async () => {
          const b = writeBatch(db);
          rows.forEach(r => b.update(doc(db, 'companies', S.cid, 'workers', r.w.id), { 'leaveCarry.annual': r.carry, leaveCarryYear: Y }));
          await b.commit(); logAct('leave.carry', `${Y}`); toast(L('Baki bawa ke hadapan disimpan.', 'Carry-forward saved.'));
        } }]
      });
    } catch (err) { toast(authErr(err), 'bad'); busy(e.currentTarget, false); }
  };

  // Cuti umum
  const holBox = $('#holBox'); bindDyn(holBox);
  const readHol = () => $$('[data-row="hol"]', holBox).map(r => ({ date: $('[data-k="date"]', r).value, name: $('[data-k="name"]', r).value.trim() })).filter(h => h.date);
  const drawHol = (list) => { holBox.innerHTML = list.sort((a, b) => a.date.localeCompare(b.date)).map(holRow).join(''); };
  const mergeHol = (add) => { const m = {}; [...readHol(), ...add].forEach(h => { m[h.date] = h; }); drawHol(Object.values(m)); };
  $('#holAdd').onclick = () => holBox.insertAdjacentHTML('beforeend', holRow({}));
  $('#holFixed').onclick = () => { mergeHol(fixedNationalHolidays(new Date().getFullYear())); toast(L('Ditambah. Tekan Simpan.', 'Added. Press Save.'), 'warn'); };
  $('#holCopy').onclick = () => {
    const y = new Date().getFullYear();
    const prev = readHol().filter(h => h.date.startsWith(String(y - 1))).map(h => ({ date: (y) + h.date.slice(4), name: h.name }));
    if (!prev.length) return toast(L(`Tiada cuti umum ${y - 1} untuk disalin.`, `No ${y - 1} holidays to copy.`), 'warn');
    mergeHol(prev);
    toast(L('Disalin. Semak tarikh cuti agama, kemudian tekan Simpan.', 'Copied. Check religious holiday dates, then press Save.'), 'warn', 5000);
  };
  $('#holSave').onclick = async (e) => {
    busy(e.currentTarget, true);
    try { await updateDoc(cRef(), { holidays: readHol() }); toast(L('Cuti umum disimpan.', 'Holidays saved.')); }
    catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  // Kadar OT
}

function ltRow(t = {}) {
  return `<div class="dyn-row ded" data-row="lt" data-id="${esc(t.id || '')}">
    <input class="input" data-k="name" placeholder="${L('Nama cuti', 'Leave name')}" value="${esc(t.name || '')}">
    <input class="input" data-k="days" type="number" min="0" step="0.5" placeholder="${L('Hari', 'Days')}" value="${t.days ?? ''}">
    <label class="check"><input type="checkbox" data-k="paid" ${t.paid !== false ? 'checked' : ''}>${L('Bergaji', 'Paid')}</label>
    <button type="button" class="icon-btn" data-del>✕</button>
  </div>`;
}
function holRow(h = {}) {
  return `<div class="dyn-row ded" data-row="hol" style="grid-template-columns:1fr 2fr auto">
    <input class="input" data-k="date" type="date" value="${esc(h.date || '')}">
    <input class="input" data-k="name" placeholder="${L('Nama cuti umum', 'Holiday name')}" value="${esc(h.name || '')}">
    <button type="button" class="icon-btn" data-del>✕</button>
  </div>`;
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
  <div class="card"><h3>${L('Kod Promo', 'Promo Code')}</h3>
    <div class="row"><input class="input id-input" id="promoIn" style="max-width:220px" placeholder="KOD">
      <button class="btn btn-soft" id="promoBtn">${L('Guna', 'Apply')}</button><span class="small" id="promoMsg">${S.promo ? `✓ ${esc(S.promo.code)} −${S.promo.value}%` : ''}</span></div></div>
  <div class="card"><h3>${L('Perbaharui / Naik Taraf', 'Renew / Upgrade')}</h3>
    <p class="small muted">${L('Tempoh baharu akan ditambah selepas tarikh tamat semasa.', 'New period is added after the current expiry date.')}</p>
    <div id="bPlans" style="margin-top:.8rem"></div></div>
  <div class="card"><h3>${L('Sejarah Bayaran', 'Payment History')}</h3><div id="bHist"><div class="loader" style="min-height:80px"><span class="spin"></span></div></div></div>`;
  renderPlans($('#bPlans'));
  $('#promoBtn').onclick = async (e) => {
    const code = $('#promoIn').value.trim().toUpperCase(); if (!code) return;
    busy(e.currentTarget, true);
    try {
      const r = await call('pa_redeemPromo', { code });
      if (r.type === 'days') { toast(L(`Berjaya! Langganan dilanjutkan ${r.value} hari.`, `Done! Subscription extended by ${r.value} days.`)); logAct('promo.redeem', code); }
      else { S.promo = { code, value: r.value }; toast(L(`Diskaun ${r.value}% akan digunakan semasa bayaran.`, `${r.value}% discount will apply at payment.`)); viewBilling(); }
    } catch (err) { toast(err.message || String(err), 'bad', 5000); }
    finally { busy(e.currentTarget, false); }
  };
  try {
    const s = await getDocs(query(collection(db, 'payments'), where('cid', '==', S.cid)));
    const list = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    $('#bHist').innerHTML = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${L('Tarikh', 'Date')}</th><th>${L('Pakej', 'Plan')}</th><th>${L('Jumlah', 'Amount')}</th><th>${L('Status', 'Status')}</th><th>Ref</th><th></th></tr></thead>
      <tbody>${list.map(p => `<tr><td>${fmtDateTime(p.createdAt)}</td><td>${planName(p.plan)}</td><td>${money(p.amount)}</td>
        <td><span class="badge ${p.status === 'paid' ? 'b-ok' : p.status === 'failed' ? 'b-bad' : 'b-warn'}">${p.status === 'paid' ? L('Berjaya', 'Paid') : p.status === 'failed' ? L('Gagal', 'Failed') : L('Menunggu', 'Pending')}</span></td>
        <td class="xs mono">${esc(p.billCode || p.id)}</td><td>${p.status === 'paid' ? `<button class="btn btn-sm btn-soft" data-rcpt="${esc(p.id)}">${icon('print', 14)} ${L('Resit', 'Receipt')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty small">${L('Tiada bayaran lagi.', 'No payments yet.')}</div>`;
    $$('[data-rcpt]').forEach(b => b.onclick = () => openPrint(receiptHtml(list.find(x => x.id === b.dataset.rcpt)), false) || toast(L('Benarkan pop-up.', 'Allow pop-ups.'), 'warn'));
  } catch (e) { $('#bHist').innerHTML = `<div class="empty small">${esc(authErr(e))}</div>`; }
}
// Resit langganan (cetak / PDF)
function receiptHtml(p) {
  const c = S.company, sp = S.plans || {};
  const d = (t) => { const x = toDate(t); return x ? x.toLocaleDateString('en-GB') : '-'; };
  const no = 'PA-' + (toDate(p.paidAt) || new Date()).toISOString().slice(0, 7).replace('-', '') + '-' + String(p.id).slice(-6).toUpperCase();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${L('Resit', 'Receipt')} ${no}</title><style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:32px;font-size:13px}
    .w{max-width:720px;margin:0 auto} .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111827;padding-bottom:14px}
    .brand{display:flex;gap:12px;align-items:center} .brand b{font-size:18px} h1{font-size:22px;margin:0;letter-spacing:.06em}
    table{width:100%;border-collapse:collapse;margin-top:18px} th,td{border:1px solid #ccc;padding:8px 10px;text-align:left} th{background:#f2f4f7}
    .r{text-align:right} .meta td{border:0;padding:3px 0} .muted{color:#666;font-size:11px} .tot td{font-weight:700;background:#fff8e1}
    .paid{display:inline-block;border:2px solid #16a34a;color:#16a34a;font-weight:700;padding:4px 12px;border-radius:6px;transform:rotate(-4deg);margin-top:16px}
    @media print{body{padding:0}}
  </style></head><body><div class="w">
    <div class="top"><div class="brand"><img src="${location.origin}/icon.svg" width="44" height="44" alt=""><div><b>${esc(sp.sellerName || 'KUKUSAN LEGACY')}</b><div class="muted">ProAttendance${sp.sellerSsm ? ' · SSM ' + esc(sp.sellerSsm) : ''}</div>
      <div class="muted">${esc(sp.sellerAddr || '')}${sp.sellerEmail ? '<br>' + esc(sp.sellerEmail) : ''}</div></div></div>
      <div style="text-align:right"><h1>${L('RESIT', 'RECEIPT')}</h1><div class="muted">No. ${no}</div><div class="muted">${L('Tarikh', 'Date')}: ${d(p.paidAt || p.createdAt)}</div></div></div>
    <table class="meta" style="margin-top:14px"><tr><td style="width:120px" class="muted">${L('Diterima daripada', 'Received from')}</td><td><b>${esc(c.name)}</b></td></tr>
      <tr><td class="muted">${L('Alamat', 'Address')}</td><td>${esc(c.address || '-')}</td></tr><tr><td class="muted">${L('E-mel', 'Email')}</td><td>${esc(c.email || c.ownerEmail || '-')}</td></tr>
      <tr><td class="muted">${L('Kod syarikat', 'Company code')}</td><td>${esc(c.code)}</td></tr></table>
    <table><thead><tr><th>${L('Perkara', 'Description')}</th><th class="r">${L('Jumlah (RM)', 'Amount (RM)')}</th></tr></thead><tbody>
      <tr><td>${L('Langganan ProAttendance', 'ProAttendance subscription')} — ${esc(planName(p.plan))}${p.newExpiry ? `<div class="muted">${L('Aktif sehingga', 'Active until')} ${d(p.newExpiry)}</div>` : ''}${p.promo ? `<div class="muted">${L('Kod promo', 'Promo code')}: ${esc(p.promo)}${p.discount ? ` (−${Number(p.discount)}%)` : ''}</div>` : ''}</td><td class="r">${Number(p.amount || 0).toFixed(2)}</td></tr>
      <tr class="tot"><td class="r">${L('JUMLAH DIBAYAR', 'TOTAL PAID')}</td><td class="r">RM ${Number(p.amount || 0).toFixed(2)}</td></tr></tbody></table>
    <table class="meta" style="margin-top:12px"><tr><td style="width:120px" class="muted">${L('Kaedah', 'Method')}</td><td>ToyyibPay (FPX / ${L('kad', 'card')})</td></tr>
      <tr><td class="muted">${L('Rujukan', 'Reference')}</td><td>${esc(p.refNo || p.billCode || p.id)}</td></tr></table>
    <div class="paid">${L('DIBAYAR', 'PAID')}</div>
    <p class="muted" style="margin-top:28px">${L('Resit ini dijana oleh komputer dan tidak memerlukan tandatangan.', 'This is a computer-generated receipt; no signature is required.')}</p>
  </div><script>setTimeout(()=>print(),400)</script></body></html>`;
}
function planName(p) {
  return ({ monthly: L('Bulanan', 'Monthly'), sixMonth: L('6 Bulan', '6 Months'), yearly: L('Tahunan', 'Yearly'), trial: L('Percubaan', 'Trial'), manual: L('Manual', 'Manual') })[p] || (p || '-');
}

const CLAIM_LABEL = (k) => ({ mileage: L('Perbatuan', 'Mileage'), toll: L('Tol', 'Toll'), parking: L('Parkir', 'Parking'), fuel: L('Minyak', 'Fuel'),
  outstation: L('Elaun Outstation', 'Outstation'), overnight: L('Elaun Bermalam', 'Overnight'), meal: L('Makan', 'Meals'), hotel: L('Hotel', 'Hotel'),
  transport: L('Pengangkutan', 'Transport'), other: L('Lain-lain', 'Others') })[k] || k;
function claimItemsHtml(r) {
  const unit = { mileage: 'km', outstation: L('hari', 'days'), overnight: L('malam', 'nights') };
  return `<div class="table-wrap" style="margin-top:.5rem"><table><thead><tr><th>${L('Tarikh', 'Date')}</th><th>${L('Perkara', 'Item')}</th><th>${L('No. resit', 'Receipt no.')}</th><th class="right">RM</th><th></th></tr></thead><tbody>
    ${r.items.map(x => `<tr><td class="small">${fmtDate(x.date, { day: 'numeric', month: 'short' })}</td>
      <td><b>${esc(CLAIM_LABEL(x.cat))}</b>${x.qty ? ` <span class="xs muted">${x.qty} ${unit[x.cat] || ''}${x.rate ? ' × ' + money(x.rate) : ''}</span>` : ''}${x.desc ? `<div class="xs muted">${esc(x.desc)}</div>` : ''}</td>
      <td class="small mono">${esc(x.inv || '-')}</td><td class="right">${money(x.amount)}</td>
      <td>${x.photo ? `<img src="${x.photo}" class="thumb" data-ciph="1">` : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th colspan="3">${L('Jumlah', 'Total')}</th><th class="right">${money(r.items.reduce((a, x) => a + Number(x.amount || 0), 0))}</th><th></th></tr></tfoot></table></div>`;
}

// ================================================================ SYIF & JADUAL
function viewRoster() {
  S.rosterTab = S.rosterTab || 'week';
  $('#view').innerHTML = `
    <div class="tabs">
      <button data-rtab="week">${L('Jadual Mingguan', 'Weekly Roster')}</button>
      <button data-rtab="tpl">${L('Templat Syif', 'Shift Templates')}</button>
    </div>
    <div id="rosterBody"></div>`;
  $$('[data-rtab]').forEach(b => {
    b.classList.toggle('on', b.dataset.rtab === S.rosterTab);
    b.onclick = () => { S.rosterTab = b.dataset.rtab; viewRoster(); };
  });
  S.rosterTab === 'tpl' ? drawShiftTpl() : drawWeek();
}

function shiftRow(sh = {}) {
  return `<div class="dyn-row" data-row="shift" data-id="${esc(sh.id || '')}" style="grid-template-columns:2fr 1fr 1fr 1fr 1fr .8fr auto">
    <input class="input" data-k="name" placeholder="${L('Nama syif (cth: Pagi)', 'Shift name (e.g. Morning)')}" value="${esc(sh.name || '')}">
    <input class="input" data-k="start" type="time" value="${esc(sh.start || '08:00')}" title="${L('Masuk', 'Start')}">
    <input class="input" data-k="end" type="time" value="${esc(sh.end || '17:00')}" title="${L('Keluar', 'End')}">
    <input class="input" data-k="bStart" type="time" value="${esc(sh.bStart || '')}" title="${L('Rehat mula', 'Break from')}">
    <input class="input" data-k="bEnd" type="time" value="${esc(sh.bEnd || '')}" title="${L('Rehat tamat', 'Break until')}">
    <input class="input" data-k="grace" type="number" min="0" max="120" value="${sh.grace ?? (S.company.settings?.grace ?? 10)}" title="${L('Tenggang lewat (minit)', 'Late grace (min)')}">
    <button type="button" class="icon-btn" data-del>✕</button>
  </div>`;
}

function drawShiftTpl() {
  const box = $('#rosterBody');
  box.innerHTML = `
  <div class="card">
    <h3>${L('Templat Syif', 'Shift Templates')}</h3>
    <p class="small muted">${L('Contoh: Pagi 07:00–15:00, Petang 15:00–23:00, Malam 23:00–07:00. Lajur: nama · masuk · keluar · rehat mula · rehat tamat · tenggang lewat (minit). Rehat kosong = ikut rehat syarikat.', 'E.g. Morning 07:00–15:00, Evening 15:00–23:00, Night 23:00–07:00. Columns: name · start · end · break from · break until · late grace (min).')}</p>
    <div class="dyn-row shd" style="grid-template-columns:2fr 1fr 1fr 1fr 1fr .8fr auto;background:none;border:0;padding-bottom:0">
      ${[L('Nama syif', 'Shift name'), L('Mula kerja', 'Start Work'), L('Tamat kerja', 'End Work'), L('Mula rehat', 'Start Break'), L('Tamat rehat', 'End Break'), L('Lewat (minit)', 'Late (min)')].map(t => `<span class="xs muted bold">${t}</span>`).join('')}<span style="width:36px"></span></div>
    <div id="shBox">${(S.company.shiftTemplates || []).map(shiftRow).join('')}</div>
    <div class="row">
      <button class="btn btn-sm btn-plus" id="shAdd">${icon('plus', 16)} ${L('Tambah Syif', 'Add Shift')}</button>
      <button class="btn btn-primary btn-sm" id="shSave">${L('Simpan Templat', 'Save Templates')}</button>
    </div>
  </div>`;
  const shBox = $('#shBox'); bindDyn(shBox);
  $('#shAdd').onclick = () => shBox.insertAdjacentHTML('beforeend', shiftRow());
  $('#shSave').onclick = async (e) => {
    const rows = $$('[data-row="shift"]', shBox).map(r => ({
      id: r.dataset.id || ('s' + Math.random().toString(36).slice(2, 8)),
      name: $('[data-k="name"]', r).value.trim(), start: $('[data-k="start"]', r).value, end: $('[data-k="end"]', r).value,
      grace: Number($('[data-k="grace"]', r).value || 0),
      bStart: $('[data-k="bStart"]', r).value || '', bEnd: $('[data-k="bEnd"]', r).value || ''
    })).filter(x => x.name && x.start && x.end);
    busy(e.currentTarget, true);
    try { await updateDoc(cRef(), { shiftTemplates: rows }); toast(L('Templat syif disimpan.', 'Shift templates saved.')); }
    catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
}

async function drawWeek() {
  const box = $('#rosterBody');
  S.weekFrom = S.weekFrom || weekStart();
  const from = S.weekFrom, to = addDays(from, 6), days = dateRange(from, to);
  const hol = holidayMap(S.company);
  const tpls = S.company.shiftTemplates || [];
  const workers = S.workers.filter(w => w.active !== false);
  box.innerHTML = `
  <div class="card">
    <div class="card-head">
      <div class="row">
        <button class="btn btn-sm btn-ghost" id="wkPrev">${icon('left', 16)}</button>
        <b>${fmtDate(from, { day: 'numeric', month: 'short' })} – ${fmtDate(to)}</b>
        <button class="btn btn-sm btn-ghost" id="wkNext">${icon('right', 16)}</button>
        <button class="btn btn-sm btn-ghost" id="wkToday">${L('Minggu ini', 'This week')}</button>
      </div>
      <div class="row">
        <button class="btn btn-sm btn-primary" id="wkAuto">${icon('cal', 16)} ${L('Jadual Auto', 'Auto Roster')}</button>
        <button class="btn btn-sm btn-soft" id="wkCopy">${L('Salin minggu lepas', 'Copy last week')}</button>
        <button class="btn btn-sm btn-ghost" id="wkClear">${L('Kosongkan', 'Clear')}</button>
      </div>
    </div>
    ${!tpls.length ? `<p class="small" style="color:var(--warn)">${L('Belum ada templat syif. Tambah di tab "Templat Syif" dahulu — atau guna waktu kerja biasa.', 'No shift templates yet. Add them in "Shift Templates" first — or use normal hours.')}</p>` : ''}
    <div id="wkGrid"><div class="loader" style="min-height:120px"><span class="spin"></span></div></div>
    <p class="xs muted" style="margin-top:.6rem">${L('↺ = ikut biasa (syif biasa & hari kerja dalam profil pekerja). Pekerja yang syifnya tetap TIDAK perlu diubah di sini — tetapkan sekali sahaja di Pekerja → Edit → Syif biasa & Hari kerja. Guna <b>Jadual Auto</b> untuk syif bergilir. Tekan nama pekerja atau tajuk hari untuk ubah sekali gus.', '↺ = default (usual shift & work days in the staff profile). Staff with fixed shifts need NO changes here — set them once in Staff → Edit → Usual shift & Work days. Use <b>Auto Roster</b> for rotating shifts. Tap a staff name or day header to change in bulk.')}</p>
  </div>`;
  $('#wkPrev').onclick = () => { S.weekFrom = addDays(from, -7); drawWeek(); };
  $('#wkNext').onclick = () => { S.weekFrom = addDays(from, 7); drawWeek(); };
  $('#wkToday').onclick = () => { S.weekFrom = weekStart(); drawWeek(); };
  const [roster, rq, pl] = await Promise.all([
    loadRoster(db, S.cid, from, to).catch(() => ({})),
    getDocs(query(sub('requests'), where('status', '==', 'approved'))).catch(() => null),
    getDocs(query(sub('plans'), where('date', '>=', from), where('date', '<=', to))).catch(() => null)
  ]);
  const notes = {}; (pl ? pl.docs : []).forEach(d => { const x = d.data(); notes[x.workerId + '|' + x.date] = x.note; });
  const lv = {};
  (rq ? rq.docs.map(d => d.data()) : []).filter(r => r.kind === 'leave' && r.from <= to && (r.to || r.from) >= from)
    .forEach(r => dateRange(r.from, r.to || r.from).forEach(d => { (lv[r.workerId] = lv[r.workerId] || {})[d] = r; }));
  if (!workers.length) { $('#wkGrid').innerHTML = `<div class="empty">${L('Tiada pekerja aktif.', 'No active staff.')}</div>`; return; }
  const defLabel = (w, d) => {
    const di = resolveDay(S.company, w, d, undefined);
    return di.type === 'off' ? L('Rehat', 'Rest') : di.type === 'holiday' ? L('C. umum', 'Holiday') : (di.shift?.name || '');
  };
  $('#wkGrid').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>${L('Pekerja', 'Staff')}</th>${days.map(d => {
      const dt = new Date(d + 'T00:00:00');
      return `<th class="center" data-dcol="${d}" style="cursor:pointer" title="${L('Ubah semua pekerja hari ini', 'Change all staff this day')}">${dayName(dt.getDay())}<div style="font-weight:600;text-transform:none">${dt.getDate()}/${dt.getMonth() + 1}</div>${hol[d] ? `<div class="badge b-info" style="text-transform:none">${esc(hol[d])}</div>` : ''}</th>`;
    }).join('')}</tr></thead>
    <tbody>${workers.map(w => `<tr><td style="white-space:nowrap;cursor:pointer" data-wrow="${esc(w.id)}" title="${L('Ubah sekali gus', 'Change in bulk')}"><b>${esc(w.name)}</b><div class="xs muted mono">${esc(w.id)}</div></td>
      ${days.map(d => {
        const val = roster[d]?.[w.id] || '';
        const leave = lv[w.id]?.[d];
        return `<td style="min-width:118px">
          <select class="input" data-cell="${esc(w.id)}|${d}" style="padding:.35rem .4rem;font-size:.8rem;${val === 'off' ? 'background:var(--card2);color:var(--muted)' : val ? 'background:var(--brand-soft);color:var(--gold)' : ''}">
            <option value="">↺ ${esc(defLabel(w, d))}</option>
            ${tpls.map(t => `<option value="${esc(t.id)}" ${val === t.id ? 'selected' : ''}>${esc(t.name)} ${esc(t.start)}</option>`).join('')}
            <option value="off" ${val === 'off' ? 'selected' : ''}>${L('Rehat', 'Rest')}</option>
          </select>
          ${leave ? `<div class="badge b-info" style="margin-top:2px">${L('Cuti', 'Leave')}</div>` : ''}
          ${notes[w.id + '|' + d] ? `<div class="xs" style="color:var(--gold);margin-top:2px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(notes[w.id + '|' + d])}">📍 ${esc(notes[w.id + '|' + d])}</div>` : ''}
        </td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`;
  $$('[data-cell]').forEach(sel => sel.onchange = async () => {
    const [w, d] = sel.dataset.cell.split('|');
    const v = sel.value;
    sel.style.background = v === 'off' ? 'var(--card2)' : v ? 'var(--brand-soft)' : ''; sel.style.color = v === 'off' ? 'var(--muted)' : v ? 'var(--gold)' : '';
    try { await setDoc(doc(db, 'companies', S.cid, 'roster', d), { a: { [w]: v || deleteField() } }, { merge: true }); }
    catch (e) { toast(authErr(e), 'bad'); }
  });
  $('#wkAuto').onclick = () => autoRoster(from, workers.map(w => w.id));
  $$('[data-wrow]').forEach(td => td.onclick = () => autoRoster(from, [td.dataset.wrow], 1));
  $$('[data-dcol]').forEach(th => th.onclick = () => {
    const d = th.dataset.dcol;
    modal({
      title: `${L('Semua pekerja', 'All staff')} · ${fmtDate(d)}`,
      body: `<div class="field"><label class="lbl">${L('Tetapkan kepada', 'Set to')}</label><select class="input" id="dv">
        <option value="">↺ ${L('Ikut biasa', 'Default')}</option>${tpls.map(t => `<option value="${esc(t.id)}">${esc(t.name)} ${esc(t.start)}–${esc(t.end)}</option>`).join('')}<option value="off">${L('Rehat', 'Rest')}</option></select></div>`,
      actions: [{ label: L('Batal', 'Cancel') }, { label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
        const v = $('#dv', el).value, a = {};
        workers.forEach(w => { a[w.id] = v || deleteField(); });
        try { await setDoc(doc(db, 'companies', S.cid, 'roster', d), { a }, { merge: true }); drawWeek(); } catch (e) { toast(authErr(e), 'bad'); return false; }
      } }]
    });
  });
  $('#wkCopy').onclick = async (e) => {
    if (!await confirmBox(L('Salin jadual minggu lepas ke minggu ini? Jadual sedia ada akan ditulis ganti.', "Copy last week's roster to this week? Existing entries will be overwritten."))) return;
    busy(e.currentTarget, true);
    try {
      const prev = await loadRoster(db, S.cid, addDays(from, -7), addDays(from, -1));
      const b = writeBatch(db);
      days.forEach((d, i) => {
        const src = prev[addDays(from, i - 7)] || {};
        b.set(doc(db, 'companies', S.cid, 'roster', d), { a: src });
      });
      await b.commit();
      toast(L('Jadual disalin.', 'Roster copied.'));
      drawWeek();
    } catch (err) { toast(authErr(err), 'bad'); busy(e.currentTarget, false); }
  };
  $('#wkClear').onclick = async () => {
    if (!await confirmBox(L('Kosongkan semua jadual minggu ini? Semua pekerja akan ikut syif biasa.', "Clear this week's roster? Everyone goes back to their default shift."))) return;
    const b = writeBatch(db);
    days.forEach(d => b.delete(doc(db, 'companies', S.cid, 'roster', d)));
    await b.commit();
    drawWeek();
  };
}

// ================================================================ KELULUSAN
function viewApprovals() {
  S.apTab = S.apTab || 'pending';
  $('#view').innerHTML = `
    <div class="tabs">
      <button data-atab="pending">${L('Menunggu', 'Pending')} <span class="badge b-warn" id="apCount">${S.pending.length}</span></button>
      <button data-atab="history">${L('Sejarah', 'History')}</button>
    </div>
    <div id="apBody"></div>`;
  $$('[data-atab]').forEach(b => {
    b.classList.toggle('on', b.dataset.atab === S.apTab);
    b.onclick = () => { S.apTab = b.dataset.atab; viewApprovals(); };
  });
  S.apApproved = null;
  drawApprovals();
}

async function drawApprovals() {
  const box = $('#apBody'); if (!box) return;
  const cnt = $('#apCount'); if (cnt) cnt.textContent = S.pending.length;
  // cuti diluluskan (untuk kira baki)
  if (!S.apApproved) {
    try {
      const s = await getDocs(query(sub('requests'), where('status', '==', 'approved')));
      S.apApproved = s.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch { S.apApproved = []; }
  }
  let list;
  if (S.apTab === 'pending') list = S.pending;
  else {
    box.innerHTML = `<div class="loader" style="min-height:120px"><span class="spin"></span></div>`;
    try {
      const s = await getDocs(query(sub('requests'), orderBy('createdAt', 'desc'), limit(150)));
      list = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.status !== 'pending');
    } catch (e) { box.innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; return; }
  }
  if (!list.length) {
    box.innerHTML = `<div class="card"><div class="empty">${S.apTab === 'pending' ? L('Tiada permohonan menunggu 🎉', 'No pending requests 🎉') : L('Tiada sejarah.', 'No history.')}</div></div>`;
    return;
  }
  box.innerHTML = list.map(r => {
    const w = S.workers.find(x => x.id === r.workerId);
    let detail = '', extra = '';
    if (r.kind === 'leave') {
      detail = `<b>${esc(r.typeName || leaveTypeName(S.company, r.typeId))}</b> · ${fmtDate(r.from)}${r.to && r.to !== r.from ? ' – ' + fmtDate(r.to) : ''} · <b>${r.days}</b> ${L('hari', 'day(s)')}${r.half ? ` (${r.half === 'am' ? L('pagi', 'AM') : L('petang', 'PM')})` : ''}`;
      if (w && r.status === 'pending') {
        const b = leaveBalances(S.company, w, S.apApproved.filter(x => x.workerId === w.id)).find(x => x.id === r.typeId);
        if (b && (b.ent + b.carry) > 0) extra = `<span class="badge ${b.left >= r.days ? 'b-ok' : 'b-bad'}">${L('Baki semasa', 'Current balance')}: ${b.left}</span>`;
      }
    } else if (r.kind === 'ot') {
      detail = `${r.auto ? '<span class="badge b-info">AUTO</span> ' : ''}${fmtDate(r.date)} · ${esc(r.start)}–${esc(r.end)} · <b>${r.approvedHours ?? r.hours}</b> ${L('jam', 'hrs')} · ${OT_LABEL[otKind(resolveDay(S.company, w, r.date))]()}`;
    } else if (r.kind === 'swap') {
      const o = S.workers.find(x => x.id === r.withId);
      detail = `${fmtDate(r.date)} · ${L('tukar syif dengan', 'swap shift with')} <b>${esc(r.withId)}</b> ${o ? esc(o.name) : `<span class="badge b-bad">${L('ID tidak wujud', 'ID not found')}</span>`}`;
    } else if (r.kind === 'claim') {
      detail = `<b>${esc(r.category || '')}</b>${r.km ? ` · ${r.km} km` : ''} · ${fmtDate(r.date)} · <b>${money(r.approvedAmount ?? r.amount)}</b>${r.paidPeriod ? ` · <span class="badge b-ok">${L('Dibayar', 'Paid')} ${esc(r.paidPeriod)}</span>` : ''}`;
    } else if (r.kind === 'advance') {
      detail = `<b>${money(r.approvedAmount ?? r.amount)}</b> · ${fmtDate(r.date)}${r.paidPeriod ? ` · <span class="badge b-ok">${L('Dipotong', 'Deducted')} ${esc(r.paidPeriod)}</span>` : ''}`;
    } else {
      detail = `${fmtDate(r.date)} · ${TYPE_LABEL[r.type]?.() || r.type} <b>${esc(r.time)}</b>`;
    }
    return `<div class="card">
      <div class="row between">
        <div><b>${esc(r.name)}</b> <span class="xs muted mono">${esc(r.workerId)}</span></div>
        <div class="row"><span class="badge b-brand">${REQ_LABEL[r.kind]()}</span>${STATUS_BADGE(r.status)}</div>
      </div>
      <div class="small" style="margin-top:.4rem">${detail} ${extra}</div>
      ${r.reason ? `<div class="small muted" style="margin-top:.3rem">“${esc(r.reason)}”</div>` : ''}
      ${r.kind === 'claim' && r.items?.length ? claimItemsHtml(r) : ''}
      ${r.attachment ? `<img src="${r.attachment}" class="thumb" style="width:64px;height:64px;margin-top:.5rem;border-radius:8px;object-fit:cover;cursor:pointer" data-att="${r.id}">` : ''}
      ${r.adminNote ? `<div class="xs" style="margin-top:.3rem">💬 ${esc(r.adminNote)}</div>` : ''}
      <div class="row between" style="margin-top:.6rem">
        <span class="xs muted">${fmtDateTime(r.createdAt)}</span>
        ${r.status === 'pending' ? `<div class="row">
          <button class="btn btn-sm btn-danger" data-rej="${r.id}">${L('Tolak', 'Reject')}</button>
          <button class="btn btn-sm btn-ok" data-ok="${r.id}">${icon('check', 16)} ${L('Lulus', 'Approve')}</button></div>` : ''}
      </div>
    </div>`;
  }).join('');
  $$('[data-ciph]', box).forEach(im => im.onclick = () => modal({ title: L('Resit', 'Receipt'), body: `<img src="${im.src}" style="width:100%;border-radius:10px">` }));
  $$('[data-att]', box).forEach(im => im.onclick = () => modal({ title: L('Lampiran', 'Attachment'), body: `<img src="${im.src}" style="width:100%;border-radius:10px">` }));
  $$('[data-ok]', box).forEach(b => b.onclick = () => decide(list.find(r => r.id === b.dataset.ok), true));
  $$('[data-rej]', box).forEach(b => b.onclick = () => decide(list.find(r => r.id === b.dataset.rej), false));
}

function decide(r, ok) {
  modal({
    title: ok ? L('Luluskan permohonan', 'Approve request') : L('Tolak permohonan', 'Reject request'),
    body: `<p class="small"><b>${esc(r.name)}</b> · ${REQ_LABEL[r.kind]()}</p>
      ${ok && r.kind === 'ot' ? `<div class="field"><label class="lbl">${L('Jam OT diluluskan', 'Approved OT hours')}</label><input class="input" type="number" step="0.1" min="0" id="apH" value="${r.hours}"></div>` : ''}
      ${ok && r.kind === 'advance' ? `<div class="field"><label class="lbl">${L('Amaun diluluskan (RM)', 'Approved amount (RM)')}</label><input class="input" type="number" step="0.01" min="0" id="apA" value="${r.amount}"></div>
        <p class="xs muted">${L('Akan dipotong dalam gaji bulan berikutnya yang diproses.', 'Will be deducted in the next payroll run.')}</p>` : ''}
      ${ok && r.kind === 'fix' ? `<p class="small muted">${L('Rekod punch akan ditambah secara automatik:', 'A punch record will be added automatically:')} ${fmtDate(r.date)} ${esc(r.time)} · ${TYPE_LABEL[r.type]?.()}</p>` : ''}
      <div class="field"><label class="lbl">${ok ? L('Catatan kepada pekerja (pilihan)', 'Note to staff (optional)') : L('Sebab ditolak (wajib)', 'Reason for rejection (required)')}</label><textarea class="input" id="apN" maxlength="300" style="min-height:60px"></textarea></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: ok ? L('Lulus', 'Approve') : L('Tolak', 'Reject'), cls: ok ? 'btn-ok' : 'btn-danger', onClick: async ({ el }) => {
          if (!ok && !$('#apN', el).value.trim()) { toast(L('Sila nyatakan sebab ditolak.', 'Please give a reason for rejection.'), 'warn'); return false; }
          try {
            const b = writeBatch(db);
            const upd = { status: ok ? 'approved' : 'rejected', decidedAt: serverTimestamp(), decidedBy: S.user.email || '', adminNote: $('#apN', el).value.trim() };
            if (ok && r.kind === 'ot') upd.approvedHours = Number($('#apH', el).value || 0);
            if (ok && r.kind === 'advance') upd.approvedAmount = Number($('#apA', el).value || 0);
            b.update(doc(db, 'companies', S.cid, 'requests', r.id), upd);
            if (ok && r.kind === 'swap') {
              const ro = await loadRoster(db, S.cid, r.date, r.date);
              const a = ro[r.date] || {};
              const eff = (wid) => {
                if (a[wid]) return a[wid];
                const w = S.workers.find(x => x.id === wid);
                const di = resolveDay(S.company, w, r.date, undefined);
                return di.type === 'off' ? 'off' : (di.shift?.id || '');
              };
              const mine = eff(r.workerId), theirs = eff(r.withId);
              b.set(doc(db, 'companies', S.cid, 'roster', r.date), { a: { [r.workerId]: theirs || deleteField(), [r.withId]: mine || deleteField() } }, { merge: true });
            }
            if (ok && r.kind === 'fix') {
              const ts = new Date(`${r.date}T${r.time}:00`);
              b.set(doc(sub('attendance')), {
                uid: r.uid, workerId: r.workerId, name: r.name, type: r.type, ts: Timestamp.fromDate(ts), date: r.date,
                lid: null, locName: L('Pembetulan', 'Correction'), method: 'fix', lat: null, lng: null, acc: null, dist: null,
                selfie: null, deviceId: '', fixed: true, reqId: r.id, by: S.user.email || ''
              });
            }
            await b.commit();
            logAct(ok ? 'request.approve' : 'request.reject', `${r.kind} ${r.workerId} ${r.id}`);
            S.apApproved = null;
            toast(ok ? L('Diluluskan.', 'Approved.') : L('Ditolak.', 'Rejected.'));
            if (S.apTab !== 'pending') drawApprovals();
          } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
}

// Jumlah ansuran pinjaman yang telah dibayar (dari gaji yang dikunci)
function loanPaid(hr, loanId, exceptPeriod) {
  return r2(Object.entries(hr?.loanTx || {}).filter(([p]) => p !== exceptPeriod)
    .reduce((a, [, arr]) => a + (arr || []).filter(x => x.id === loanId).reduce((b, x) => b + Number(x.amt || 0), 0), 0));
}

// ================================================================ GAJI
function viewPayroll() {
  S.payTab = S.payTab || 'run';
  $('#view').innerHTML = `
    <div class="tabs">
      <button data-ptab="run">${L('Proses Gaji', 'Run Payroll')}</button>
      <button data-ptab="ea">${L('Ringkasan Tahunan (EA)', 'Yearly Summary (EA)')}</button>
      <button data-ptab="settings">${L('Tetapan Kewangan', 'Finance Settings')}</button>
    </div>
    <div id="payBody"></div>`;
  $$('[data-ptab]').forEach(b => {
    b.classList.toggle('on', b.dataset.ptab === S.payTab);
    b.onclick = () => { S.payTab = b.dataset.ptab; viewPayroll(); };
  });
  S.payTab === 'settings' ? drawPaySettings() : S.payTab === 'ea' ? drawEA() : drawPayrun();
}

// Komit batch dalam ketulan (had 500 operasi)
async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(fn => fn(b));
    await b.commit();
  }
}

function payTotals(items) {
  const list = Object.values(items || {});
  const sum = (f) => r2(list.reduce((a, x) => a + Number(f(x) || 0), 0));
  return {
    count: list.length, gross: sum(x => x.gross), claims: sum(x => x.claims), ded: sum(x => x.totalDed), net: sum(x => x.net),
    employer: sum(x => x.employerTotal),
    epf: sum(x => (x.deductions || []).filter(d => d.kind === 'epf').reduce((a, d) => a + d.amount, 0) + (x.employer?.epf || 0)),
    socso: sum(x => (x.deductions || []).filter(d => d.kind === 'socso').reduce((a, d) => a + d.amount, 0) + (x.employer?.socso || 0)),
    eis: sum(x => (x.deductions || []).filter(d => d.kind === 'eis').reduce((a, d) => a + d.amount, 0) + (x.employer?.eis || 0)),
    skbbk: sum(x => (x.deductions || []).filter(d => d.kind === 'skbbk').reduce((a, d) => a + d.amount, 0)),
    pcb: sum(x => (x.deductions || []).filter(d => d.kind === 'pcb').reduce((a, d) => a + d.amount, 0))
  };
}

async function drawPayrun() {
  const box = $('#payBody');
  S.payPeriod = S.payPeriod || todayStr().slice(0, 7);
  const period = S.payPeriod;
  box.innerHTML = `
    <div class="card no-print">
      <div class="row between">
        <div class="row"><label class="lbl" style="margin:0">${L('Bulan gaji', 'Pay month')}</label>
          <input type="month" class="input" id="payMon" value="${period}" style="width:auto"></div>
        <div class="row" id="payActs"></div>
      </div>
    </div>
    <div id="payOut" style="margin-top:1rem"><div class="loader" style="min-height:150px"><span class="spin"></span></div></div>`;
  $('#payMon').onchange = (e) => { S.payPeriod = e.target.value; drawPayrun(); };
  let run;
  try { const s = await getDoc(doc(db, 'companies', S.cid, 'payruns', period)); run = s.exists() ? s.data() : null; }
  catch (e) { $('#payOut').innerHTML = `<div class="card"><div class="empty">${esc(authErr(e))}</div></div>`; return; }
  S.payRun = run;
  const acts = $('#payActs');
  if (!run) {
    $('#payOut').innerHTML = `<div class="card"><div class="empty">
      <p><b>${esc(periodLabel(period))}</b> — ${L('belum diproses.', 'not processed yet.')}</p>
      <p class="small">${L('Sistem akan kira gaji asas, elaun, OT diluluskan, cuti, tuntutan, pendahuluan dan caruman ikut tetapan anda. Semua boleh disunting sebelum dikunci.', 'The system calculates basic pay, allowances, approved OT, leave, claims, advances and contributions from your settings. Everything is editable before locking.')}</p>
      <button class="btn btn-primary" id="genPay">${icon('money', 18)} ${L('Jana Gaji', 'Generate Payroll')}</button></div></div>`;
    $('#genPay').onclick = (e) => generatePayrun(period, e.currentTarget);
    return;
  }
  const locked = run.status === 'locked';
  acts.innerHTML = `
    <span class="badge ${locked ? 'b-ok' : 'b-warn'}">${locked ? L('Dikunci', 'Locked') : L('Draf', 'Draft')}</span>
    ${!locked ? `<button class="btn btn-sm btn-ghost" id="regen">${L('Jana semula', 'Regenerate')}</button>
      <button class="btn btn-sm btn-primary" id="lockPay">${icon('check', 16)} ${L('Kunci & Terbit Slip', 'Lock & Publish Slips')}</button>`
      : `<button class="btn btn-sm btn-ghost" id="unlockPay">${L('Buka kunci', 'Unlock')}</button>`}
    <button class="btn btn-sm btn-ghost" id="payXl">${icon('dl', 16)} Excel</button>
    <button class="btn btn-sm btn-ghost" id="payBank">${icon('dl', 16)} ${L('Fail bank', 'Bank file')}</button>
    <button class="btn btn-sm btn-ghost" id="payPrint">${icon('print', 16)} ${L('Semua slip', 'All slips')}</button>`;
  const items = Object.values(run.items || {}).sort((a, b) => a.workerId.localeCompare(b.workerId));
  const t = payTotals(run.items);
  $('#payOut').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="n">${t.count}</div><div class="t">${L('Pekerja', 'Staff')}</div></div>
      <div class="stat info"><div class="n" style="font-size:1.15rem">${money(t.gross)}</div><div class="t">${L('Gaji kasar', 'Gross pay')}</div></div>
      <div class="stat warn"><div class="n" style="font-size:1.15rem">${money(t.ded)}</div><div class="t">${L('Potongan', 'Deductions')}</div></div>
      <div class="stat ok"><div class="n" style="font-size:1.15rem">${money(t.net)}</div><div class="t">${L('Gaji bersih', 'Net pay')}</div></div>
      <div class="stat"><div class="n" style="font-size:1.15rem">${money(t.employer)}</div><div class="t">${L('Caruman majikan', 'Employer contrib.')}</div></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>ID</th><th>${L('Nama', 'Name')}</th><th class="right">${L('Kasar', 'Gross')}</th><th class="right">${L('Tuntutan', 'Claims')}</th>
          <th class="right">${L('Potongan', 'Deductions')}</th><th class="right">${L('Bersih', 'Net')}</th><th></th></tr></thead>
        <tbody>${items.map(x => `<tr>
          <td class="mono">${esc(x.workerId)}</td><td>${esc(x.name)}<div class="xs muted">${L('Hadir', 'Present')} ${x.days?.present ?? 0} · OT ${r2((x.days?.ot?.normal || 0) + (x.days?.ot?.rest || 0) + (x.days?.ot?.holiday || 0))}j</div></td>
          <td class="right">${money(x.gross)}</td><td class="right">${x.claims ? money(x.claims) : '-'}</td><td class="right">${money(x.totalDed)}</td>
          <td class="right bold">${money(x.net)}</td>
          <td class="right" style="white-space:nowrap">
            ${!locked ? `<button class="btn btn-sm btn-ghost" data-pe="${esc(x.workerId)}">${L('Sunting', 'Edit')}</button>` : ''}
            <button class="btn btn-sm btn-ghost" data-ps="${esc(x.workerId)}">${L('Slip', 'Slip')}</button>
          </td></tr>`).join('')}</tbody>
        <tfoot><tr><th></th><th>${L('Jumlah', 'Total')}</th><th class="right">${money(t.gross)}</th><th class="right">${money(t.claims)}</th><th class="right">${money(t.ded)}</th><th class="right">${money(t.net)}</th><th></th></tr></tfoot>
      </table></div>
    </div>
    <div class="card small">
      <b>${L('Ringkasan caruman (pekerja + majikan)', 'Contributions summary (employee + employer)')}</b>
      <div class="row" style="margin-top:.4rem">
        <span class="badge">${L('KWSP', 'EPF')}: ${money(t.epf)}</span><span class="badge">${L('PERKESO', 'SOCSO')}: ${money(t.socso)}</span>
        <span class="badge">${L('SIP', 'EIS')}: ${money(t.eis)}</span><span class="badge">PCB: ${money(t.pcb)}</span>
      </div>
      <div style="margin-top:.6rem"><b>${L('Kos buruh ikut lokasi', 'Labour cost by location')}</b> <span class="xs muted">(${L('kasar + caruman majikan', 'gross + employer contributions')})</span>
        <div class="row" style="margin-top:.3rem">${Object.entries(items.reduce((m, x) => {
          const k = S.locations.find(l => l.id === (x.branchId || S.workers.find(w => w.id === x.workerId)?.branchId))?.name || L('Tiada lokasi', 'No location');
          m[k] = (m[k] || 0) + (x.gross || 0) + (x.employerTotal || 0); return m;
        }, {})).map(([k, v]) => `<span class="badge b-brand">${esc(k)}: ${money(v)}</span>`).join('')}</div></div>
      ${locked ? `<p class="xs muted" style="margin-top:.5rem">${L('Dikunci pada', 'Locked on')} ${fmtDateTime(run.lockedAt)}. ${L('Slip boleh dilihat oleh pekerja dalam app.', 'Staff can view their slips in the app.')}</p>`
        : `<p class="xs muted" style="margin-top:.5rem">${L('Semak & sunting setiap pekerja, kemudian tekan "Kunci & Terbit Slip". Tuntutan & pendahuluan akan ditanda dibayar, dan item "sekali sahaja" dibuang dari profil pekerja.', 'Review & edit each staff, then press "Lock & Publish Slips". Claims & advances will be marked paid, and "one-time" items removed from staff profiles.')}</p>`}
    </div>`;
  $$('[data-pe]').forEach(b => b.onclick = () => editPayItem(period, run.items[b.dataset.pe]));
  $$('[data-ps]').forEach(b => b.onclick = () => openPrint(payslipHtml(S.company, run.items[b.dataset.ps], period), false) || toast(L('Benarkan pop-up untuk lihat slip.', 'Allow pop-ups to view the slip.'), 'warn'));
  $('#payPrint').onclick = () => openPrint(payslipHtml(S.company, items, period)) || toast(L('Benarkan pop-up untuk cetak.', 'Allow pop-ups to print.'), 'warn');
  $('#payXl').onclick = () => payExcel(period, items, t);
  $('#payBank').onclick = () => bankFile(period, items);
  $('#regen') && ($('#regen').onclick = async (e) => {
    if (!await confirmBox(L('Jana semula akan menulis ganti semua suntingan dalam draf ini. Teruskan?', 'Regenerating will overwrite all edits in this draft. Continue?'))) return;
    generatePayrun(period, e.currentTarget);
  });
  $('#lockPay') && ($('#lockPay').onclick = (e) => lockPayrun(period, run, e.currentTarget));
  $('#unlockPay') && ($('#unlockPay').onclick = (e) => unlockPayrun(period, run, e.currentTarget));
}

async function generatePayrun(period, btn) {
  busy(btn, true);
  try {
    const { from, to } = periodRange(period);
    const [att, roster, rq, hrS] = await Promise.all([
      getDocs(query(sub('attendance'), where('date', '>=', from), where('date', '<=', to))),
      loadRoster(db, S.cid, from, to).catch(() => ({})),
      getDocs(query(sub('requests'), where('status', '==', 'approved'))),
      getDocs(sub('hr')).catch(() => null)
    ]);
    const hrMap = {}; (hrS ? hrS.docs : []).forEach(d => { hrMap[d.id] = d.data(); });
    const recs = att.docs.map(d => d.data());
    const reqs = rq.docs.map(d => ({ id: d.id, ...d.data() }));
    const withRecs = new Set(recs.map(r => r.workerId));
    const workers = S.workers.filter(w => w.active !== false || withRecs.has(w.id));
    const items = {};
    workers.forEach(w => {
      items[w.id] = computeItem({
        c: S.company, w, period, roster,
        recs: recs.filter(r => r.workerId === w.id),
        reqs: reqs.filter(r => r.workerId === w.id),
        loans: (hrMap[w.id]?.loans || []).map(l => ({ ...l, paid: loanPaid(hrMap[w.id], l.id, period) }))
      });
    });
    await setDoc(doc(db, 'companies', S.cid, 'payruns', period), {
      period, status: 'draft', items, totals: payTotals(items), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), by: S.user.email || ''
    });
    logAct('payroll.generate', period);
    toast(L('Draf gaji dijana. Sila semak.', 'Payroll draft generated. Please review.'));
    drawPayrun();
  } catch (e) { console.error(e); toast(authErr(e), 'bad', 5000); busy(btn, false); }
}

function payLineRow(x, kind) {
  return `<div class="dyn-row ded" data-row="${kind}" data-kind="${esc(x.kind || 'other')}" data-epf="${x.epf ? 1 : 0}" data-socso="${x.socso ? 1 : 0}" data-once="${x.once ? 1 : 0}" style="grid-template-columns:2fr 1fr auto">
    <div><input class="input" data-k="name" value="${esc(x.name || '')}" placeholder="${L('Perkara', 'Item')}">${x.note ? `<div class="xs muted">${esc(x.note)}</div>` : ''}</div>
    <input class="input" data-k="amount" type="number" step="0.01" value="${x.amount ?? ''}" placeholder="RM">
    <button type="button" class="icon-btn" data-del>✕</button>
  </div>`;
}
function readPayLines(root, kind) {
  return $$(`[data-row="${kind}"]`, root).map(r => ({
    name: $('[data-k="name"]', r).value.trim(), amount: r2($('[data-k="amount"]', r).value),
    kind: r.dataset.kind, epf: r.dataset.epf === '1', socso: r.dataset.socso === '1', once: r.dataset.once === '1',
    note: $('.xs', r)?.textContent || ''
  })).filter(x => x.name);
}

function editPayItem(period, item) {
  const w = S.workers.find(x => x.id === item.workerId) || {};
  const m = modal({
    title: `${esc(item.name)} · ${esc(periodLabel(period))}`, wide: true,
    body: `
      <div class="row small" style="margin-bottom:.6rem">
        <span class="badge">${L('Hadir', 'Present')}: ${item.days?.present ?? 0}</span>
        <span class="badge">${L('Cuti bergaji', 'Paid leave')}: ${item.days?.leavePaid ?? 0}</span>
        <span class="badge">${L('Tanpa gaji', 'Unpaid')}: ${item.days?.leaveUnpaid ?? 0}</span>
        <span class="badge">${L('Tidak hadir', 'Absent')}: ${item.days?.absent ?? 0}</span>
        <span class="badge">${L('Lewat', 'Late')}: ${item.days?.lateMin ?? 0}m</span>
        <span class="badge">${L('Kadar sehari', 'Daily rate')}: ${money(item.dailyRate)}</span>
        <span class="badge">${L('Kadar sejam', 'Hourly rate')}: ${money(item.hourlyRate)}</span>
      </div>
      <div class="sec-title">${L('Pendapatan', 'Earnings')}</div>
      <div id="earnBox">${item.earnings.map(x => payLineRow(x, 'earn')).join('')}</div>
      <div class="row"><button class="btn btn-sm btn-plus" id="addEarn">${icon('plus', 16)} ${L('Tambah pendapatan', 'Add earning')}</button>
        <label class="check xs"><input type="checkbox" id="newEpf" checked>${L('baris baharu kena KWSP/PERKESO', 'new lines subject to EPF/SOCSO')}</label></div>
      <div class="sec-title">${L('Potongan', 'Deductions')}</div>
      <div id="dedBox2">${item.deductions.map(x => payLineRow(x, 'ded2')).join('')}</div>
      <div class="row"><button class="btn btn-sm btn-plus" id="addDed2">${icon('plus', 16)} ${L('Tambah potongan', 'Add deduction')}</button>
        <button class="btn btn-sm btn-soft" id="reStat">${L('Kira semula caruman', 'Recalculate contributions')}</button></div>
      <div class="sec-title">${L('Caruman majikan', 'Employer contributions')}</div>
      <div class="grid3">
        <div class="field"><label class="lbl">${L('KWSP', 'EPF')}</label><input class="input" type="number" step="0.01" id="erEpf" value="${item.employer?.epf ?? 0}"></div>
        <div class="field"><label class="lbl">${L('PERKESO', 'SOCSO')}</label><input class="input" type="number" step="0.01" id="erSocso" value="${item.employer?.socso ?? 0}"></div>
        <div class="field"><label class="lbl">${L('SIP', 'EIS')}</label><input class="input" type="number" step="0.01" id="erEis" value="${item.employer?.eis ?? 0}"></div>
      </div>
      <div class="card" style="background:var(--brand-soft);margin-top:.5rem"><div class="row between">
        <span>${L('Kasar', 'Gross')}: <b id="tG"></b></span><span>${L('Potongan', 'Deductions')}: <b id="tD"></b></span><span>${L('Bersih', 'Net')}: <b id="tN" style="font-size:1.1rem"></b></span>
      </div></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async () => {
          const it = build();
          try {
            const items = { ...S.payRun.items, [it.workerId]: it };
            await updateDoc(doc(db, 'companies', S.cid, 'payruns', period), { [`items.${it.workerId}`]: it, totals: payTotals(items), updatedAt: serverTimestamp() });
            toast(L('Disimpan.', 'Saved.'));
            drawPayrun();
          } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  const el = m.el;
  const build = () => totals({
    ...item, earnings: readPayLines(el, 'earn'), deductions: readPayLines(el, 'ded2'),
    employer: { epf: r2($('#erEpf', el).value), socso: r2($('#erSocso', el).value), eis: r2($('#erEis', el).value) }
  });
  const refresh = () => { const it = build(); $('#tG', el).textContent = money(it.gross + it.claims); $('#tD', el).textContent = money(it.totalDed); $('#tN', el).textContent = money(it.net); };
  bindDyn(el);
  el.addEventListener('input', refresh);
  el.addEventListener('click', e => { if (e.target.closest('[data-del]')) setTimeout(refresh, 0); });
  $('#addEarn', el).onclick = () => { const f = $('#newEpf', el).checked; $('#earnBox', el).insertAdjacentHTML('beforeend', payLineRow({ kind: 'other', epf: f, socso: f }, 'earn')); };
  $('#addDed2', el).onclick = () => $('#dedBox2', el).insertAdjacentHTML('beforeend', payLineRow({ kind: 'other' }, 'ded2'));
  $('#reStat', el).onclick = () => {
    const it = applyStatutory(build(), payrollSettings(S.company), w);
    $('#dedBox2', el).innerHTML = it.deductions.map(x => payLineRow(x, 'ded2')).join('');
    $('#erEpf', el).value = it.employer.epf; $('#erSocso', el).value = it.employer.socso; $('#erEis', el).value = it.employer.eis;
    refresh();
  };
  refresh();
}

async function lockPayrun(period, run, btn) {
  const items = Object.values(run.items || {});
  if (!await confirmBox(L(`Kunci gaji ${periodLabel(period)} dan terbitkan ${items.length} slip kepada pekerja?`, `Lock ${periodLabel(period)} payroll and publish ${items.length} slips to staff?`))) return;
  busy(btn, true);
  try {
    const ops = [];
    ops.push(b => b.update(doc(db, 'companies', S.cid, 'payruns', period), { status: 'locked', lockedAt: serverTimestamp(), lockedBy: S.user.email || '' }));
    items.forEach(it => {
      ops.push(b => b.set(doc(db, 'companies', S.cid, 'payslips', `${period}_${it.workerId}`), { ...it, period, publishedAt: serverTimestamp() }));
      (it.claimIds || []).forEach(id => ops.push(b => b.update(doc(db, 'companies', S.cid, 'requests', id), { paidPeriod: period })));
      (it.advanceIds || []).forEach(id => ops.push(b => b.update(doc(db, 'companies', S.cid, 'requests', id), { paidPeriod: period })));
      if ((it.loanPays || []).length) ops.push(b => b.set(doc(db, 'companies', S.cid, 'hr', it.workerId), { loanTx: { [period]: it.loanPays } }, { merge: true }));
      const w = S.workers.find(x => x.id === it.workerId);
      if (w && ((w.allowances || []).some(a => a.type === 'once') || (w.deductions || []).some(d => d.type === 'once'))) {
        ops.push(b => b.update(doc(db, 'companies', S.cid, 'workers', w.id), {
          allowances: (w.allowances || []).filter(a => a.type !== 'once'),
          deductions: (w.deductions || []).filter(d => d.type !== 'once')
        }));
      }
    });
    await commitOps(ops);
    logAct('payroll.lock', period);
    toast(L('Gaji dikunci & slip diterbitkan.', 'Payroll locked & slips published.'));
    drawPayrun();
  } catch (e) { console.error(e); toast(authErr(e), 'bad', 5000); busy(btn, false); }
}

async function unlockPayrun(period, run, btn) {
  if (!await confirmBox(L('Buka kunci? Slip akan ditarik balik daripada pekerja, dan tuntutan/pendahuluan ditanda belum dibayar. Item "sekali sahaja" yang telah dibuang dari profil tidak dikembalikan (masih ada dalam draf ini).', 'Unlock? Slips will be withdrawn from staff, and claims/advances marked unpaid. "One-time" items removed from profiles are not restored (they remain in this draft).'))) return;
  busy(btn, true);
  try {
    const ops = [b => b.update(doc(db, 'companies', S.cid, 'payruns', period), { status: 'draft', unlockedAt: serverTimestamp() })];
    Object.values(run.items || {}).forEach(it => {
      ops.push(b => b.delete(doc(db, 'companies', S.cid, 'payslips', `${period}_${it.workerId}`)));
      [...(it.claimIds || []), ...(it.advanceIds || [])].forEach(id => ops.push(b => b.update(doc(db, 'companies', S.cid, 'requests', id), { paidPeriod: deleteField() })));
      if ((it.loanPays || []).length) ops.push(b => b.set(doc(db, 'companies', S.cid, 'hr', it.workerId), { loanTx: { [period]: deleteField() } }, { merge: true }));
    });
    await commitOps(ops);
    logAct('payroll.unlock', period);
    toast(L('Kunci dibuka.', 'Unlocked.'));
    drawPayrun();
  } catch (e) { toast(authErr(e), 'bad'); busy(btn, false); }
}

function payExcel(period, items, t) {
  if (!window.XLSX) return toast(L('Modul Excel belum dimuatkan.', 'Excel module not loaded.'), 'warn');
  const dk = (x, k) => r2((x.deductions || []).filter(d => d.kind === k).reduce((a, d) => a + d.amount, 0));
  const other = (x) => r2((x.deductions || []).filter(d => !['epf', 'socso', 'eis', 'skbbk', 'pcb'].includes(d.kind)).reduce((a, d) => a + d.amount, 0));
  const head = [[S.company.name], [`${L('Gaji', 'Payroll')}: ${periodLabel(period)}`], []];
  const rows = items.map(x => [x.workerId, x.name, x.ic, x.bank, x.bankAcc, x.days?.present ?? 0, x.gross, x.claims || 0,
    dk(x, 'epf'), dk(x, 'socso'), dk(x, 'eis'), dk(x, 'skbbk'), dk(x, 'pcb'), other(x), x.totalDed, x.net, x.employer?.epf || 0, x.employer?.socso || 0, x.employer?.eis || 0]);
  const ws = XLSX.utils.aoa_to_sheet([...head,
    ['ID', L('Nama', 'Name'), 'IC', 'Bank', L('No. akaun', 'Account'), L('Hadir', 'Present'), L('Kasar', 'Gross'), L('Tuntutan', 'Claims'),
      L('KWSP pekerja', 'EPF ee'), L('PERKESO pekerja', 'SOCSO ee'), L('SIP pekerja', 'EIS ee'), 'SKBBK', 'PCB', L('Potongan lain', 'Other ded.'), L('Jumlah potongan', 'Total ded.'), L('Bersih', 'Net'),
      L('KWSP majikan', 'EPF er'), L('PERKESO majikan', 'SOCSO er'), L('SIP majikan', 'EIS er')],
    ...rows, [], ['', L('JUMLAH', 'TOTAL'), '', '', '', '', t.gross, t.claims, '', '', '', t.pcb, '', t.ded, t.net]]);
  ws['!cols'] = [{ wch: 9 }, { wch: 26 }, { wch: 15 }, { wch: 12 }, { wch: 16 }, ...Array(13).fill({ wch: 12 })];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, period);
  XLSX.writeFile(wb, `Gaji_${S.company.code}_${period}.xlsx`);
}

function bankFile(period, items) {
  const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Nama', 'IC', 'Bank', 'No Akaun', 'Amaun', 'Rujukan'].map(csvEsc).join(',')];
  items.filter(x => x.net > 0).forEach(x => lines.push([x.name, x.ic, x.bank, x.bankAcc, x.net.toFixed(2), `GAJI ${period} ${x.workerId}`].map(csvEsc).join(',')));
  const missing = items.filter(x => x.net > 0 && !x.bankAcc).length;
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `Bank_${S.company.code}_${period}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  if (missing) toast(L(`${missing} pekerja tiada no. akaun bank.`, `${missing} staff have no bank account number.`), 'warn', 5000);
}

function drawPaySettings() {
  const P = payrollSettings(S.company), c = S.company;
  const num = (id, v, step = '0.01') => `<input class="input" type="number" step="${step}" min="0" id="${id}" value="${v}">`;
  $('#payBody').innerHTML = `
  <div class="card">
    <h3>${L('Caruman Berkanun', 'Statutory Contributions')}</h3>
    <div class="field"><label class="lbl">${L('Kaedah kiraan', 'Calculation method')}</label>
      <select class="input" id="pMode" style="max-width:460px">
        <option value="table" ${P.statMode !== 'percent' ? 'selected' : ''}>${L('Jadual rasmi KWSP / PERKESO / SIP / SKBBK (disyorkan)', 'Official EPF / SOCSO / EIS / SKBBK tables (recommended)')}</option>
        <option value="percent" ${P.statMode === 'percent' ? 'selected' : ''}>${L('Peratus manual (isi sendiri)', 'Manual percentage (enter yourself)')}</option>
      </select></div>
    <div id="pModeTable" class="${P.statMode === 'percent' ? 'hide' : ''}">
      <p class="small muted">${L('Dikira automatik ikut jadual rasmi (kemas kini Nov 2026), status warganegara & umur setiap pekerja:', 'Calculated automatically from the official schedules (updated Nov 2026), each staff member\'s citizenship & age:')}</p>
      <ul class="small" style="padding-left:1.1rem;line-height:1.6;margin:.3rem 0 .6rem">
        <li>${L('KWSP: 11% pekerja; majikan 13% (≤RM5,000) / 12%. Umur ≥60: 0% / 4%. Asing: 2% / 2%. Ikut julat Jadual Ketiga.', 'EPF: 11% employee; employer 13% (≤RM5,000) / 12%. Age ≥60: 0% / 4%. Foreign: 2% / 2%. Third Schedule bands.')}</li>
        <li>${L('PERKESO: Kategori 1 — majikan 1.75%, pekerja 0.5%; Kategori 2 (≥60) — majikan 1.25%. Siling RM6,000.', 'SOCSO: Category 1 — employer 1.75%, employee 0.5%; Category 2 (≥60) — employer 1.25%. Ceiling RM6,000.')}</li>
        <li>${L('SIP: 0.2% + 0.2% (bukan untuk asing / ≥60). Siling RM6,000.', 'EIS: 0.2% + 0.2% (not for foreign / ≥60). Ceiling RM6,000.')}</li>
        <li>${L('SKBBK / Lindung 24 Jam: 0.75% pekerja sahaja (wajib untuk asing; warganegara boleh tarik diri di profil pekerja).', 'SKBBK / Lindung 24 Jam: 0.75% employee only (mandatory for foreign staff; locals can opt out in the staff profile).')}</li>
      </ul>
    </div>
    <div class="table-wrap ${P.statMode === 'percent' ? '' : 'hide'}" id="pModePct" style="margin-top:.6rem"><table>
      <thead><tr><th></th><th>${L('Pekerja (%)', 'Employee (%)')}</th><th>${L('Majikan (%)', 'Employer (%)')}</th></tr></thead>
      <tbody>
        <tr><td>${L('KWSP', 'EPF')}</td><td>${num('pEpfEe', P.epfEe)}</td><td>${num('pEpfEr', P.epfEr)}</td></tr>
        <tr><td>${L('PERKESO', 'SOCSO')}</td><td>${num('pSoEe', P.socsoEe)}</td><td>${num('pSoEr', P.socsoEr)}</td></tr>
        <tr><td>${L('SIP', 'EIS')}</td><td>${num('pEiEe', P.eisEe)}</td><td>${num('pEiEr', P.eisEr)}</td></tr>
      </tbody></table></div>
    <div class="set-row"><span>${L('OT dikira untuk KWSP', 'OT counts for EPF')}</span><label class="switch"><input type="checkbox" id="pOtEpf" ${P.otInEpf ? 'checked' : ''}><span></span></label></div>
    <div class="set-row"><span>${L('OT dikira untuk PERKESO / SIP', 'OT counts for SOCSO / EIS')}</span><label class="switch"><input type="checkbox" id="pOtSo" ${P.otInSocso ? 'checked' : ''}><span></span></label></div>
    <div class="set-row"><div><span>${L('Elaun lain (tiada dalam senarai elaun) dikira untuk KWSP', 'Other allowances (not in the list) count for EPF')}</span></div><label class="switch"><input type="checkbox" id="pOaEpf" ${P.otherAllowEpf ? 'checked' : ''}><span></span></label></div>
    <div class="set-row"><div><span>${L('Elaun lain dikira untuk PERKESO / SIP', 'Other allowances count for SOCSO / EIS')}</span></div><label class="switch"><input type="checkbox" id="pOaSo" ${P.otherAllowSocso ? 'checked' : ''}><span></span></label></div>
  </div>
  <div class="card">
    <h3>${L('Kiraan Gaji', 'Pay Calculation')}</h3>
    <div class="grid2">
      <div class="field"><label class="lbl">${L('Hari bekerja sebulan (untuk kadar sehari)', 'Work days per month (for daily rate)')}</label>${num('pWd', P.workDaysPerMonth, '0.5')}</div>
      <div class="field"><label class="lbl">${L('Jam bekerja sehari (untuk kadar sejam / OT)', 'Work hours per day (for hourly rate / OT)')}</label>${num('pHd', P.hoursPerDay, '0.5')}</div>
    </div>
    <div class="set-row"><div><b>${L('Potong gaji untuk cuti tanpa gaji', 'Deduct pay for unpaid leave')}</b><div class="small muted">${L('Pekerja bergaji bulanan sahaja.', 'Monthly-paid staff only.')}</div></div><label class="switch"><input type="checkbox" id="pUnpaid" ${P.deductUnpaid ? 'checked' : ''}><span></span></label></div>
    <div class="set-row"><div><b>${L('Potong gaji untuk hari tidak hadir', 'Deduct pay for absent days')}</b><div class="small muted">${L('Hari bekerja tanpa punch & tanpa cuti.', 'Work days with no punch & no leave.')}</div></div><label class="switch"><input type="checkbox" id="pAbsent" ${P.deductAbsent ? 'checked' : ''}><span></span></label></div>
    <div class="grid2" style="margin-top:.8rem">
      <div class="field"><label class="lbl">${L('Potongan lewat', 'Late deduction')}</label>
        <select class="input" id="pLate">${opts([['none', L('Tiada', 'None')], ['perMin', L('Per minit lewat', 'Per late minute')], ['perDay', L('Per hari lewat', 'Per late day')]], P.lateMode)}</select></div>
      <div class="field"><label class="lbl">${L('Amaun (RM)', 'Amount (RM)')}</label>${num('pLateAmt', P.lateAmount)}</div>
    </div>
    <div class="field"><label class="lbl">${L('Bonus kehadiran penuh sebulan (RM, 0 = tiada)', 'Monthly perfect attendance bonus (RM, 0 = none)')}</label>${num('pBonus', P.perfectBonus)}</div>
    <button class="btn btn-primary" id="pSave">${L('Simpan Tetapan Gaji', 'Save Payroll Settings')}</button>
  </div>
  <div class="card">
    <h3>${L('Elaun & Caruman', 'Allowances & Contributions')}</h3>
    <p class="small muted">${L('Senarai ini diambil terus daripada elaun dalam profil pekerja. Finance hanya tandakan sama ada setiap elaun dikenakan KWSP / PERKESO — gaji dikira automatik.', 'This list comes straight from the allowances in staff profiles. Finance just ticks whether each allowance is subject to EPF / SOCSO — payroll calculates automatically.')}</p>
    <div id="alBox"></div>
    <div class="row" style="margin-top:.6rem"><input class="input grow" id="alNew" style="max-width:280px" placeholder="${L('Tambah nama elaun lain', 'Add another allowance name')}">
      <button class="btn btn-sm btn-plus" id="alAdd">${icon('plus', 16)} ${L('Tambah', 'Add')}</button>
      <button class="btn btn-primary btn-sm" id="tplSave">${L('Simpan', 'Save')}</button></div>
  </div>
  <div class="card">
    <h3>${L('Kadar OT', 'Overtime Rates')}</h3>
    <p class="small muted">${L('Gandaan kadar sejam. Isi ikut polisi syarikat anda.', 'Multiplier of the hourly rate. Set according to your company policy.')}</p>
    <div class="grid3">
      <div class="field"><label class="lbl">${L('Hari biasa', 'Normal day')}</label><input class="input" type="number" step="0.1" min="0" id="otN" value="${otRates(c).normal}"></div>
      <div class="field"><label class="lbl">${L('Hari rehat', 'Rest day')}</label><input class="input" type="number" step="0.1" min="0" id="otR" value="${otRates(c).rest}"></div>
      <div class="field"><label class="lbl">${L('Cuti umum', 'Public holiday')}</label><input class="input" type="number" step="0.1" min="0" id="otH" value="${otRates(c).holiday}"></div>
    </div>
    <button class="btn btn-primary btn-sm" id="otSave">${L('Simpan', 'Save')}</button>
  </div>

  <div class="card">
    <h3>${L('Borang Tuntutan — Kadar & Projek', 'Claim Form — Rates & Projects')}</h3>
    <p class="small muted">${L('Kadar ini digunakan dalam borang tuntutan bulanan pekerja (Justification, Allowance & Claim Form).', 'These rates are used in the staff monthly claim form (Justification, Allowance & Claim Form).')}</p>
    <div class="grid3">
      <div class="field"><label class="lbl">Mileage (RM/km)</label><input class="input" type="number" step="0.01" min="0" id="crKm" value="${claimRates(c).km}"></div>
      <div class="field"><label class="lbl">Outstation (RM)</label><input class="input" type="number" step="0.01" min="0" id="crOut" value="${claimRates(c).outstation}"></div>
      <div class="field"><label class="lbl">Overnight (RM)</label><input class="input" type="number" step="0.01" min="0" id="crOver" value="${claimRates(c).overnight}"></div>
      <div class="field"><label class="lbl">Mileage allowance offset (RM)</label><input class="input" type="number" step="0.01" min="0" id="crOff" value="${claimRates(c).offset}"></div>
      <div class="field"><label class="lbl">SST (%)</label><input class="input" type="number" step="0.1" min="0" id="crSst" value="${claimRates(c).sst}"></div>
    </div>
    <button class="btn btn-primary btn-sm" id="crSave">${L('Simpan Kadar', 'Save Rates')}</button>
    <div class="sec-title">${L('Senarai Projek (Purpose of Journey / Remark)', 'Project List (Purpose of Journey / Remark)')}</div>
    <div class="chips" id="prjChips" style="margin-bottom:.7rem"></div>
    <div class="row"><input class="input grow" id="prjIn" style="max-width:340px" placeholder="${L('Nama projek', 'Project name')}">
      <button class="btn btn-plus" id="prjAdd">${icon('plus', 16)} ${L('Tambah', 'Add')}</button></div>
  </div>

  <div class="card">
    <h3>${L('PCB / Cukai Bulanan Pekerja', 'Monthly PCB / Tax per Staff')}</h3>
    <p class="small muted">${L('Isi amaun PCB bulanan setiap pekerja (ikut kalkulator LHDN). Kosong = tiada PCB. Dipotong automatik setiap kali gaji diproses.', 'Enter each staff member\'s monthly PCB (from the LHDN calculator). Blank = no PCB. Deducted automatically every payroll run.')}</p>
    <div class="table-wrap"><table><thead><tr><th>${L('Pekerja', 'Staff')}</th><th>${L('Gaji asas', 'Basic pay')}</th><th>PCB (RM)</th></tr></thead><tbody>
      ${S.workers.filter(w => w.active !== false).map(w => `<tr><td><b>${esc(w.name)}</b><div class="xs muted mono">${esc(w.id)}</div></td><td>${w.payType === 'monthly' || !w.payType ? money(w.salary || 0) : esc(w.payType)}</td>
        <td><input class="input" type="number" step="0.01" min="0" data-pcb="${esc(w.id)}" value="${(c.pcbMap || {})[w.id] ?? ''}" style="max-width:130px"></td></tr>`).join('')}</tbody></table></div>
    <button class="btn btn-primary btn-sm" id="pcbSave">${L('Simpan PCB', 'Save PCB')}</button>
  </div>
`;
  $('#pcbSave').onclick = async (e) => {
    const map = {}; $$('[data-pcb]').forEach(i => { if (Number(i.value) > 0) map[i.dataset.pcb] = Number(i.value); });
    busy(e.currentTarget, true);
    try { await updateDoc(cRef(), { pcbMap: map }); S.company.pcbMap = map; logAct('finance.pcb'); toast(L('PCB disimpan.', 'PCB saved.')); }
    catch (err) { toast(authErr(err), 'bad'); } finally { busy(e.currentTarget, false); }
  };
  // Senarai elaun = templat syarikat + semua elaun dalam profil pekerja
  const key = (n) => String(n || '').trim().toLowerCase();
  const alMap = new Map();
  (c.allowanceTemplates || []).forEach(t => { if (t.name) alMap.set(key(t.name), { ...t, name: t.name.trim(), users: 0, total: 0 }); });
  S.workers.filter(w => w.active !== false).forEach(w => (w.allowances || []).forEach(a => {
    if (!a.name) return;
    const k = key(a.name);
    if (!alMap.has(k)) alMap.set(k, { name: a.name.trim(), amount: 0, type: a.type || 'monthly', epf: !!P.otherAllowEpf, socso: !!P.otherAllowSocso, users: 0, total: 0, isNew: true });
    const o = alMap.get(k); o.users++; o.total += a.type === 'daily' ? Number(a.amount || 0) * (P.workDaysPerMonth || 26) : Number(a.amount || 0);
  }));
  const drawAl = () => {
    const rows = [...alMap.values()].sort((x, y) => y.users - x.users || x.name.localeCompare(y.name));
    $('#alBox').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>${L('Elaun', 'Allowance')}</th><th>${L('Digunakan oleh', 'Used by')}</th><th class="center">${L('KWSP', 'EPF')}</th><th class="center">${L('PERKESO / SIP', 'SOCSO / EIS')}</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r.name)}</b>${r.isNew ? ` <span class="badge b-warn">${L('baru — sila semak', 'new — please check')}</span>` : ''}</td>
        <td class="small">${r.users ? `${r.users} ${L('pekerja', 'staff')} · ~${money(r.total)}/${L('bln', 'mo')}` : '<span class="muted">-</span>'}</td>
        <td class="center"><input type="checkbox" data-alk="${esc(key(r.name))}" data-f="epf" ${r.epf ? 'checked' : ''}></td>
        <td class="center"><input type="checkbox" data-alk="${esc(key(r.name))}" data-f="socso" ${r.socso ? 'checked' : ''}></td>
        <td class="right">${r.users ? '' : `<button class="icon-btn" data-aldel="${esc(key(r.name))}">✕</button>`}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty small">${L('Belum ada elaun dalam profil pekerja.', 'No allowances in staff profiles yet.')}</div>`;
    $$('[data-alk]').forEach(cb => cb.onchange = () => { const o = alMap.get(cb.dataset.alk); if (o) o[cb.dataset.f] = cb.checked; });
    $$('[data-aldel]').forEach(b => b.onclick = () => { alMap.delete(b.dataset.aldel); drawAl(); });
  };
  drawAl();
  $('#alAdd').onclick = () => { const n = $('#alNew').value.trim(); if (!n || alMap.has(key(n))) return; alMap.set(key(n), { name: n, amount: 0, type: 'monthly', epf: true, socso: true, users: 0, total: 0 }); $('#alNew').value = ''; drawAl(); };
  $('#tplSave').onclick = async (e) => {
    const list = [...alMap.values()].map(({ name, amount, type, epf, socso }) => ({ name, amount: Number(amount || 0), type: type || 'monthly', epf: !!epf, socso: !!socso }));
    busy(e.currentTarget, true);
    try {
      await updateDoc(cRef(), { allowanceTemplates: list }); S.company.allowanceTemplates = list;
      alMap.forEach(o => { delete o.isNew; }); drawAl();
      logAct('finance.allowances'); toast(L('Disimpan. Gaji akan dikira ikut tetapan ini.', 'Saved. Payroll will follow these settings.'));
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  $('#otSave').onclick = async (e) => {
    busy(e.currentTarget, true);
    try {
      await updateDoc(cRef(), { otRates: { normal: Number($('#otN').value || 0), rest: Number($('#otR').value || 0), holiday: Number($('#otH').value || 0) } });
      toast(L('Kadar OT disimpan.', 'OT rates saved.'));
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  // Kadar tuntutan & projek
  $('#crSave').onclick = async (e) => {
    const v = (id) => Number($('#' + id).value || 0);
    busy(e.currentTarget, true);
    try {
      await updateDoc(cRef(), { claimRates: { km: v('crKm'), outstation: v('crOut'), overnight: v('crOver'), offset: v('crOff'), sst: v('crSst') } });
      logAct('settings.claimRates'); toast(L('Kadar disimpan.', 'Rates saved.'));
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  const drawPrj = () => {
    const d = S.company.projects || [];
    $('#prjChips').innerHTML = d.length ? d.map((x, i) => `<span class="chip">${esc(x)}<button data-pdx="${i}">✕</button></span>`).join('') : `<span class="small muted">${L('Tiada projek.', 'No projects.')}</span>`;
    $$('[data-pdx]').forEach(b => b.onclick = async () => { const arr = [...(S.company.projects || [])]; arr.splice(Number(b.dataset.pdx), 1); await updateDoc(cRef(), { projects: arr }); S.company.projects = arr; drawPrj(); });
  };
  drawPrj();
  $('#prjAdd').onclick = async () => {
    const v = $('#prjIn').value.trim(); if (!v) return;
    const arr = [...new Set([...(S.company.projects || []), v])];
    await updateDoc(cRef(), { projects: arr }); S.company.projects = arr; $('#prjIn').value = ''; drawPrj();
  };


  $('#pMode').onchange = (e) => { $('#pModeTable').classList.toggle('hide', e.target.value === 'percent'); $('#pModePct').classList.toggle('hide', e.target.value !== 'percent'); };
  $('#pSave').onclick = async (e) => {
    const v = (id) => Number($('#' + id).value || 0);
    busy(e.currentTarget, true);
    try {
      await updateDoc(cRef(), {
        payroll: {
          statMode: $('#pMode').value, epfEe: v('pEpfEe'), epfEr: v('pEpfEr'), socsoEe: v('pSoEe'), socsoEr: v('pSoEr'), eisEe: v('pEiEe'), eisEr: v('pEiEr'),
          otInEpf: $('#pOtEpf').checked, otInSocso: $('#pOtSo').checked,
          otherAllowEpf: $('#pOaEpf').checked, otherAllowSocso: $('#pOaSo').checked,
          workDaysPerMonth: v('pWd') || 26, hoursPerDay: v('pHd') || 8,
          deductUnpaid: $('#pUnpaid').checked, deductAbsent: $('#pAbsent').checked,
          lateMode: $('#pLate').value, lateAmount: v('pLateAmt'), perfectBonus: v('pBonus')
        }
      });
      toast(L('Tetapan gaji disimpan.', 'Payroll settings saved.'));
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
}

// ================================================================ DASHBOARD: ANALITIK & PERINGATAN
async function dashExtras() {
  const t = todayStr();
  const from = addDays(t, -13), monthStart = t.slice(0, 8) + '01';
  const qFrom = from < monthStart ? from : monthStart;
  try {
    const [att, ro, rq, files] = await Promise.all([
      getDocs(query(sub('attendance'), where('date', '>=', qFrom), where('date', '<=', t))),
      loadRoster(db, S.cid, t, addDays(t, 13)).catch(() => ({})),
      getDocs(query(sub('requests'), where('status', '==', 'approved'))).catch(() => null),
      isSupervisor() ? null : getDocs(query(sub('hrfiles'), where('expiry', '<=', addDays(t, 30)))).catch(() => null),
      getDocs(query(sub('plans'), where('date', '==', t))).catch(() => null)
    ]).then(r => { S.todayPlans = r[4] ? r[4].docs.map(d => d.data()) : []; return r; });
    const recs = att.docs.map(d => d.data()).filter(r => r.type !== 'visit');
    const wById = Object.fromEntries(S.workers.map(w => [w.id, w]));
    // Trend 14 hari
    const days = dateRange(from, t);
    const per = days.map(d => {
      const byW = {};
      recs.filter(r => r.date === d).forEach(r => (byW[r.workerId] = byW[r.workerId] || []).push(r));
      let p = 0, late = 0;
      Object.entries(byW).forEach(([wid, list]) => {
        const s = summarizeDay(list, lateSettings(S.company, resolveDay(S.company, wById[wid], d)), d);
        if (s.firstIn) p++; if (s.lateMin) late++;
      });
      return { d, p, late };
    });
    const max = Math.max(1, ...per.map(x => x.p), S.workers.filter(w => w.active !== false).length);
    if ($('#dTrend')) $('#dTrend').innerHTML = `
      <div style="display:flex;align-items:flex-end;gap:4px;height:130px;padding-top:.5rem">${per.map(x => {
        const dt = new Date(x.d + 'T00:00:00');
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px" title="${fmtDate(x.d)}: ${x.p} ${L('hadir', 'present')}, ${x.late} ${L('lewat', 'late')}">
          <span class="xs muted">${x.p || ''}</span>
          <div style="width:100%;height:${Math.round(x.p / max * 90)}px;background:var(--brand);border-radius:4px 4px 0 0;position:relative">
            <div style="position:absolute;bottom:0;width:100%;height:${x.p ? Math.round(x.late / x.p * 100) : 0}%;background:var(--warn);border-radius:0 0 0 0"></div></div>
          <span class="xs muted">${dt.getDate()}</span></div>`;
      }).join('')}</div>
      <div class="row xs muted" style="margin-top:.4rem"><span><span class="dot" style="display:inline-block;background:var(--brand)"></span> ${L('Hadir', 'Present')}</span><span><span class="dot" style="display:inline-block;background:var(--warn)"></span> ${L('Lewat', 'Late')}</span></div>`;
    // Ranking bulan ini
    const score = {};
    const mrecs = recs.filter(r => r.date >= monthStart);
    const byWD = {};
    mrecs.forEach(r => { const k = r.workerId + '|' + r.date; (byWD[k] = byWD[k] || []).push(r); });
    Object.entries(byWD).forEach(([k, list]) => {
      const [wid, d] = k.split('|');
      const s = summarizeDay(list, lateSettings(S.company, resolveDay(S.company, wById[wid], d)), d);
      score[wid] = score[wid] || { p: 0, late: 0 };
      if (s.firstIn) score[wid].p++; score[wid].late += s.lateMin;
    });
    const rank = Object.entries(score).filter(([wid]) => wById[wid]).sort((a, b) => b[1].p - a[1].p || a[1].late - b[1].late).slice(0, 5);
    if ($('#dRank')) $('#dRank').innerHTML = rank.length ? rank.map(([wid, x], i) => `<div class="set-row"><span>${['🥇', '🥈', '🥉', '4.', '5.'][i]} ${esc(wById[wid].name)}</span>
      <span class="small">${x.p} ${L('hari', 'days')} · ${L('lewat', 'late')} ${x.late}m</span></div>`).join('') : `<div class="empty small">${L('Belum ada data.', 'No data yet.')}</div>`;
    // Ramalan 14 hari
    const approved = rq ? rq.docs.map(d => d.data()) : [];
    const lv = {};
    approved.filter(r => r.kind === 'leave').forEach(r => dateRange(r.from, r.to || r.from).forEach(d => { (lv[d] = lv[d] || new Set()).add(r.workerId); }));
    const active = S.workers.filter(w => w.active !== false);
    const fc = dateRange(t, addDays(t, 13)).map(d => {
      let on = 0, leave = 0;
      active.forEach(w => {
        const di = resolveDay(S.company, w, d, ro[d]?.[w.id]);
        if (di.type !== 'work' && !(di.type === 'holiday' && di.shift)) return;
        if (lv[d]?.has(w.id)) leave++; else on++;
      });
      return { d, on, leave };
    });
    if ($('#dFc')) $('#dFc').innerHTML = `<div class="table-wrap"><table><thead><tr><th>${L('Tarikh', 'Date')}</th><th>${L('Bertugas', 'On duty')}</th><th>${L('Cuti', 'Leave')}</th></tr></thead>
      <tbody>${fc.map(x => { const dt = new Date(x.d + 'T00:00:00'); const low = active.length && x.on < active.length * 0.6 && x.on + x.leave > 0;
        return `<tr><td>${dayName(dt.getDay())} ${fmtDate(x.d, { day: 'numeric', month: 'short' })}</td><td>${low ? `<span class="badge b-bad">${x.on}</span>` : x.on}</td><td>${x.leave || '-'}</td></tr>`; }).join('')}</tbody></table></div>`;
    // Peringatan
    const m = t.slice(5, 7);
    const bdays = active.filter(w => (w.dob || '').slice(5, 7) === m).sort((a, b) => a.dob.slice(8).localeCompare(b.dob.slice(8)));
    const anniv = active.filter(w => (w.startDate || '').slice(5, 7) === m && w.startDate.slice(0, 4) < t.slice(0, 4));
    const exp = files ? files.docs.map(d => d.data()).filter(f => f.expiry && wById[f.workerId]).sort((a, b) => a.expiry.localeCompare(b.expiry)) : [];
    const items = [
      ...(S.todayPlans || []).map(p => `<div class="set-row"><span>📍 ${esc(p.name)}</span><span class="small" style="color:var(--gold)">${esc(p.note)}</span></div>`),
      ...exp.map(f => `<div class="set-row"><span>📄 ${esc(f.title)} · ${esc(wById[f.workerId].name)}</span><span class="badge ${f.expiry < t ? 'b-bad' : 'b-warn'}">${f.expiry < t ? L('Tamat', 'Expired') : L('Tamat', 'Expires')} ${fmtDate(f.expiry)}</span></div>`),
      ...bdays.map(w => `<div class="set-row"><span>🎂 ${esc(w.name)}</span><span class="small">${fmtDate(w.dob, { day: 'numeric', month: 'short' })}</span></div>`),
      ...anniv.map(w => `<div class="set-row"><span>🎉 ${esc(w.name)}</span><span class="small">${Number(t.slice(0, 4)) - Number(w.startDate.slice(0, 4))} ${L('tahun berkhidmat', 'years of service')}</span></div>`)
    ];
    if ($('#dRem')) $('#dRem').innerHTML = items.length ? items.join('') : `<div class="empty small">${L('Tiada peringatan.', 'No reminders.')}</div>`;
  } catch (e) {
    console.error(e);
    ['#dTrend', '#dRem'].forEach(s => { if ($(s)) $(s).innerHTML = `<div class="empty small">${esc(authErr(e))}</div>`; });
  }
}

// ================================================================ KAD PEKERJA
function printCards(list) {
  if (!window.QRCode) return toast(L('Modul QR belum dimuatkan.', 'QR module not loaded.'), 'warn');
  const c = S.company;
  const qr = (text) => { const d = document.createElement('div'); new QRCode(d, { text, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M }); const cv = d.querySelector('canvas'); return cv ? cv.toDataURL() : (d.querySelector('img')?.src || ''); };
  const cards = list.map(w => `
    <div class="card">
      <div class="top">${c.logo ? `<img src="${c.logo}" class="lg">` : ''}<div><b>${esc(c.name)}</b><div class="s">${L('KAD PEKERJA', 'STAFF CARD')}</div></div></div>
      <div class="mid"><div><div class="nm">${esc(w.name)}</div><div class="s">${esc(w.position || '')}</div><div class="id">${esc(w.id)}</div></div><img src="${qr('PAW|' + w.id)}" class="qr"></div>
    </div>`).join('');
  openPrint(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${L('Kad Pekerja', 'Staff Cards')}</title><style>
    body{font-family:Arial,sans-serif;margin:10mm} .wrap{display:flex;flex-wrap:wrap;gap:6mm}
    .card{width:86mm;height:54mm;border:1px solid #999;border-radius:3mm;padding:4mm;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;page-break-inside:avoid;border-top:3mm solid ${esc(c.color || '#1d4ed8')}}
    .top{display:flex;gap:3mm;align-items:center;font-size:11px} .lg{width:10mm;height:10mm;object-fit:contain} .s{font-size:9px;color:#666}
    .mid{display:flex;justify-content:space-between;align-items:flex-end} .nm{font-weight:bold;font-size:13px} .id{font-family:monospace;font-size:16px;font-weight:bold;margin-top:2mm}
    .qr{width:24mm;height:24mm}
  </style></head><body><div class="wrap">${cards}</div></body></html>`);
}

// ================================================================ TUGASAN
async function viewTasks() {
  S.taskDate = S.taskDate || todayStr();
  const active = S.workers.filter(w => w.active !== false);
  $('#view').innerHTML = `
  <div class="card">
    <h3>${L('Beri Tugasan', 'Assign Task')}</h3>
    <div class="grid2">
      <div class="field"><label class="lbl">${L('Pekerja', 'Staff')}</label><select class="input" id="tkW"><option value="__all">${L('Semua pekerja aktif', 'All active staff')}</option>${active.map(w => `<option value="${esc(w.id)}">${esc(w.id)} · ${esc(w.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="lbl">${L('Tarikh', 'Date')}</label><input class="input" type="date" id="tkD" value="${S.taskDate}"></div>
    </div>
    <div class="field"><label class="lbl">${L('Tugasan', 'Task')}</label><input class="input" id="tkT" maxlength="120"></div>
    <div class="field"><label class="lbl">${L('Catatan (pilihan)', 'Notes (optional)')}</label><textarea class="input" id="tkN" maxlength="500" style="min-height:60px"></textarea></div>
    <button class="btn btn-primary" id="tkAdd">${icon('plus', 18)} ${L('Beri Tugasan', 'Assign')}</button>
  </div>
  <div class="card"><div class="card-head"><h3>${L('Senarai Tugasan', 'Tasks')}</h3><input type="date" class="input" id="tkF" value="${S.taskDate}" style="width:auto"></div><div id="tkList"></div></div>`;
  $('#tkF').onchange = (e) => { S.taskDate = e.target.value; drawTasks(); };
  $('#tkAdd').onclick = async (e) => {
    const title = $('#tkT').value.trim(), date = $('#tkD').value, sel = $('#tkW').value;
    if (!title || !date) return toast(L('Sila isi tugasan dan tarikh.', 'Please fill in task and date.'), 'warn');
    const targets = sel === '__all' ? active : active.filter(w => w.id === sel);
    busy(e.currentTarget, true);
    try {
      await commitOps(targets.filter(w => w.uid).map(w => (b) => b.set(doc(sub('tasks')), {
        uid: w.uid, workerId: w.id, name: w.name, title, note: $('#tkN').value.trim(), date, status: 'open', createdAt: serverTimestamp(), by: S.user.email || ''
      })));
      logAct('task.create', `${title} → ${targets.length}`);
      toast(L('Tugasan diberi.', 'Task assigned.')); $('#tkT').value = ''; $('#tkN').value = '';
      S.taskDate = date; $('#tkF').value = date; drawTasks();
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  drawTasks();
}
async function drawTasks() {
  const box = $('#tkList'); if (!box) return;
  box.innerHTML = `<div class="loader" style="min-height:80px"><span class="spin"></span></div>`;
  try {
    const s = await getDocs(query(sub('tasks'), where('date', '==', S.taskDate)));
    const list = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.workerId.localeCompare(b.workerId));
    box.innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>${L('Pekerja', 'Staff')}</th><th>${L('Tugasan', 'Task')}</th><th>${L('Status', 'Status')}</th><th></th></tr></thead><tbody>
      ${list.map(x => `<tr><td>${esc(x.name)}<div class="xs muted mono">${esc(x.workerId)}</div></td>
        <td><b>${esc(x.title)}</b>${x.note ? `<div class="xs muted">${esc(x.note)}</div>` : ''}${x.workerNote ? `<div class="xs">💬 ${esc(x.workerNote)}</div>` : ''}</td>
        <td>${x.status === 'done' ? `<span class="badge b-ok">${L('Siap', 'Done')} ${fmtTime(x.doneAt)}</span>` : `<span class="badge b-warn">${L('Belum', 'Open')}</span>`}
          ${x.photo ? `<img src="${x.photo}" class="thumb" data-tph="${x.id}" style="margin-top:.3rem">` : ''}</td>
        <td><button class="icon-btn" data-tdel="${x.id}">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${L('Tiada tugasan untuk tarikh ini.', 'No tasks for this date.')}</div>`;
    $$('[data-tph]', box).forEach(im => im.onclick = () => modal({ title: L('Gambar kerja', 'Work photo'), body: `<img src="${im.src}" style="width:100%;border-radius:10px">` }));
    $$('[data-tdel]', box).forEach(b => b.onclick = async () => { if (await confirmBox(L('Padam tugasan ini?', 'Delete this task?'))) { await deleteDoc(doc(db, 'companies', S.cid, 'tasks', b.dataset.tdel)); drawTasks(); } });
  } catch (e) { box.innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; }
}

// ================================================================ FAIL HR
async function viewHR() {
  const ws = S.workers;
  if (!ws.length) { $('#view').innerHTML = `<div class="card"><div class="empty">${L('Tiada pekerja.', 'No staff.')}</div></div>`; return; }
  S.hrWorker = S.hrWorker && ws.some(w => w.id === S.hrWorker) ? S.hrWorker : ws[0].id;
  const w = ws.find(x => x.id === S.hrWorker);
  $('#view').innerHTML = `
  <div class="card"><div class="row between">
    <select class="input" id="hrSel" style="max-width:340px">${ws.map(x => `<option value="${esc(x.id)}" ${x.id === w.id ? 'selected' : ''}>${esc(x.id)} · ${esc(x.name)}${x.active === false ? ' (' + L('tidak aktif', 'inactive') + ')' : ''}</option>`).join('')}</select>
    <span class="small muted">${esc(w.position || '')} ${w.startDate ? '· ' + L('mula', 'since') + ' ' + fmtDate(w.startDate) : ''}</span>
  </div></div>
  <div id="hrBody"><div class="loader" style="min-height:150px"><span class="spin"></span></div></div>`;
  $('#hrSel').onchange = (e) => { S.hrWorker = e.target.value; viewHR(); };
  let hr = {}, files = [];
  try {
    const [h, f] = await Promise.all([getDoc(doc(db, 'companies', S.cid, 'hr', w.id)), getDocs(query(sub('hrfiles'), where('workerId', '==', w.id)))]);
    hr = h.exists() ? h.data() : {};
    files = f.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { $('#hrBody').innerHTML = `<div class="card"><div class="empty">${esc(authErr(e))}</div></div>`; return; }
  const t = todayStr();
  const sec = (key, title, desc, cols, rows, addLabel) => `
    <div class="card"><div class="card-head"><div><h3>${title}</h3>${desc ? `<p class="small muted" style="margin:0">${desc}</p>` : ''}</div>
      <div class="row"><button class="btn btn-sm btn-plus" data-hadd="${key}">${icon('plus', 16)} ${addLabel}</button><button class="btn btn-sm btn-primary" data-hsave="${key}">${L('Simpan', 'Save')}</button></div></div>
      <div data-hbox="${key}">${rows.map(r => hrRow(key, cols, r)).join('')}</div></div>`;
  const C = HR_COLS();
  $('#hrBody').innerHTML = `
    <div class="card"><div class="card-head"><h3>${L('Dokumen', 'Documents')}</h3><button class="btn btn-sm btn-plus" id="fAdd">${icon('plus', 16)} ${L('Muat naik dokumen', 'Upload document')}</button></div>
      ${files.length ? files.sort((a, b) => (a.expiry || '9').localeCompare(b.expiry || '9')).map(f => `<div class="set-row"><div><b>${esc(f.title)}</b>
        <div class="xs muted">${f.expiry ? `${L('Tamat', 'Expires')}: ${fmtDate(f.expiry)}` : L('Tiada tarikh tamat', 'No expiry')} ${f.expiry && f.expiry < t ? `<span class="badge b-bad">${L('Tamat', 'Expired')}</span>` : f.expiry && f.expiry <= addDays(t, 30) ? `<span class="badge b-warn">${L('Hampir tamat', 'Expiring')}</span>` : ''}</div></div>
        <div class="row">${f.image ? `<button class="btn btn-sm btn-ghost" data-fv="${f.id}">${L('Lihat', 'View')}</button>` : ''}<button class="icon-btn" data-fd="${f.id}">✕</button></div></div>`).join('')
        : `<div class="empty small">${L('Tiada dokumen. Contoh: IC, permit kerja, lesen, sijil.', 'No documents. E.g. IC, work permit, licence, certificate.')}</div>`}
    </div>
    ${sec('onboard', L('Senarai Semak Onboarding', 'Onboarding Checklist'), '', C.onboard, hr.onboard || [], L('Tambah', 'Add'))}
    ${sec('warnings', L('Amaran & Disiplin', 'Warnings & Discipline'), '', C.warnings, hr.warnings || [], L('Tambah amaran', 'Add warning'))}
    ${sec('reviews', L('Penilaian Prestasi', 'Performance Reviews'), L('Markah 1–5.', 'Score 1–5.'), C.reviews, hr.reviews || [], L('Tambah penilaian', 'Add review'))}
    ${sec('assets', L('Aset Syarikat', 'Company Assets'), L('Telefon, kunci, uniform dll. yang dipegang pekerja.', 'Phones, keys, uniforms etc. held by the staff.'), C.assets, hr.assets || [], L('Tambah aset', 'Add asset'))}
    ${sec('loans', L('Pinjaman Pekerja', 'Staff Loans'), L('Ansuran dipotong automatik dalam gaji mulai bulan dipilih.', 'Instalments are deducted automatically in payroll from the chosen month.'), C.loans,
      (hr.loans || []).map(l => ({ ...l, _paid: loanPaid(hr, l.id) })), L('Tambah pinjaman', 'Add loan'))}
    <div class="card"><h3>${L('Berhenti Kerja', 'Resignation / Exit')}</h3>
      <div class="grid3">
        <div class="field"><label class="lbl">${L('Jenis', 'Type')}</label><select class="input" id="exType">${opts([['', '—'], ['resign', L('Letak jawatan', 'Resignation')], ['terminate', L('Penamatan', 'Termination')], ['contract', L('Tamat kontrak', 'Contract end')]], hr.exit?.type || '')}</select></div>
        <div class="field"><label class="lbl">${L('Tarikh notis', 'Notice date')}</label><input class="input" type="date" id="exNotice" value="${esc(hr.exit?.notice || '')}"></div>
        <div class="field"><label class="lbl">${L('Hari terakhir', 'Last day')}</label><input class="input" type="date" id="exLast" value="${esc(hr.exit?.lastDay || '')}"></div>
      </div>
      <div class="field"><label class="lbl">${L('Catatan / gaji akhir', 'Notes / final pay')}</label><textarea class="input" id="exNote" style="min-height:60px">${esc(hr.exit?.note || '')}</textarea></div>
      <p class="xs muted">${L('Gaji akhir: proses gaji bulan terakhir seperti biasa (kehadiran dikira sehingga hari terakhir). Nyahaktifkan pekerja selepas hari terakhir.', 'Final pay: run the last month payroll as usual (attendance counts up to the last day). Deactivate the staff after the last day.')}</p>
      <button class="btn btn-primary btn-sm" id="exSave">${L('Simpan', 'Save')}</button>
    </div>`;
  const hrRef = doc(db, 'companies', S.cid, 'hr', w.id);
  $$('[data-hadd]').forEach(b => b.onclick = () => $(`[data-hbox="${b.dataset.hadd}"]`).insertAdjacentHTML('beforeend', hrRow(b.dataset.hadd, C[b.dataset.hadd], {})));
  $$('[data-hbox]').forEach(bx => bindDyn(bx));
  $$('[data-hsave]').forEach(b => b.onclick = async () => {
    const key = b.dataset.hsave, cols = C[key];
    const rows = $$(`[data-hbox="${key}"] .dyn-row`).map(r => {
      const o = { id: r.dataset.id || ('x' + Math.random().toString(36).slice(2, 8)) };
      cols.forEach(c => { const i = $(`[data-k="${c.k}"]`, r); if (!i) return; o[c.k] = c.type === 'check' ? i.checked : c.type === 'number' ? Number(i.value || 0) : i.value.trim(); });
      return o;
    }).filter(o => cols.some(c => c.type !== 'check' && o[c.k]));
    busy(b, true);
    try { await setDoc(hrRef, { [key]: rows, updatedAt: serverTimestamp() }, { merge: true }); logAct('hr.' + key, w.id); toast(L('Disimpan.', 'Saved.')); }
    catch (e) { toast(authErr(e), 'bad'); }
    finally { busy(b, false); }
  });
  $('#exSave').onclick = async (e) => {
    busy(e.currentTarget, true);
    try {
      await setDoc(hrRef, { exit: { type: $('#exType').value, notice: $('#exNotice').value, lastDay: $('#exLast').value, note: $('#exNote').value.trim() } }, { merge: true });
      logAct('hr.exit', w.id); toast(L('Disimpan.', 'Saved.'));
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
  $('#fAdd').onclick = () => {
    let img = null;
    const m = modal({
      title: L('Muat naik dokumen', 'Upload document'),
      body: `<div class="field"><label class="lbl">${L('Nama dokumen', 'Document name')}</label><input class="input" id="fT" placeholder="${L('cth: Permit kerja', 'e.g. Work permit')}"></div>
        <div class="field"><label class="lbl">${L('Tarikh tamat (pilihan)', 'Expiry date (optional)')}</label><input class="input" type="date" id="fE"></div>
        <div class="field"><label class="lbl">${L('Gambar dokumen', 'Document image')}</label><input class="input" type="file" accept="image/*" id="fI"><div id="fP"></div></div>`,
      actions: [{ label: L('Batal', 'Cancel') }, {
        label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
          const title = $('#fT', el).value.trim(); if (!title) { toast(L('Sila isi nama dokumen.', 'Please enter a name.'), 'warn'); return false; }
          try { await addDoc(sub('hrfiles'), { workerId: w.id, title, expiry: $('#fE', el).value || '', image: img, at: serverTimestamp() }); logAct('hr.file', `${w.id} ${title}`); viewHR(); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }]
    });
    $('#fI', m.el).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { img = await fileToDataURL(f, 1000, 'image/jpeg', 0.6); $('#fP', m.el).innerHTML = `<img src="${img}" style="max-width:140px;border-radius:8px;margin-top:.4rem">`; } catch {} };
  };
  $$('[data-fv]').forEach(b => b.onclick = () => { const f = files.find(x => x.id === b.dataset.fv); modal({ title: esc(f.title), body: `<img src="${f.image}" style="width:100%;border-radius:10px">` }); });
  $$('[data-fd]').forEach(b => b.onclick = async () => { if (await confirmBox(L('Padam dokumen ini?', 'Delete this document?'))) { await deleteDoc(doc(db, 'companies', S.cid, 'hrfiles', b.dataset.fd)); viewHR(); } });
}

const HR_COLS = () => ({
  onboard: [{ k: 'item', ph: L('Perkara (cth: Serah salinan IC)', 'Item (e.g. Submit IC copy)') }, { k: 'done', type: 'check', label: L('Siap', 'Done') }],
  warnings: [{ k: 'date', type: 'date' }, { k: 'level', ph: L('Tahap (cth: Lisan / Bertulis 1)', 'Level (e.g. Verbal / Written 1)') }, { k: 'reason', ph: L('Sebab', 'Reason') }],
  reviews: [{ k: 'date', type: 'date' }, { k: 'score', type: 'number', ph: '1–5' }, { k: 'notes', ph: L('Ulasan', 'Comments') }],
  assets: [{ k: 'name', ph: L('Aset', 'Asset') }, { k: 'serial', ph: L('No. siri', 'Serial no.') }, { k: 'issued', type: 'date' }, { k: 'returned', type: 'check', label: L('Dipulangkan', 'Returned') }],
  loans: [{ k: 'name', ph: L('Tujuan', 'Purpose') }, { k: 'total', type: 'number', ph: L('Jumlah RM', 'Total RM') }, { k: 'monthly', type: 'number', ph: L('Sebulan RM', 'Monthly RM') }, { k: 'start', type: 'month' }, { k: 'active', type: 'check', label: L('Aktif', 'Active') }]
});
function hrRow(key, cols, r) {
  return `<div class="dyn-row" data-id="${esc(r.id || '')}" style="grid-template-columns:${cols.map(c => c.type === 'check' ? 'auto' : c.type === 'date' || c.type === 'month' || c.type === 'number' ? '1fr' : '2fr').join(' ')} auto">
    ${cols.map(c => c.type === 'check'
      ? `<label class="check"><input type="checkbox" data-k="${c.k}" ${r[c.k] || (c.k === 'active' && r.active === undefined) ? 'checked' : ''}>${c.label}</label>`
      : `<input class="input" data-k="${c.k}" type="${c.type || 'text'}" ${c.type === 'number' ? 'step="0.01" min="0"' : ''} placeholder="${esc(c.ph || '')}" value="${esc(r[c.k] ?? '')}">`).join('')}
    <button type="button" class="icon-btn" data-del>✕</button>
    ${key === 'loans' && r.total ? `<div class="xs muted" style="grid-column:1/-1">${L('Dibayar', 'Paid')}: ${money(r._paid || 0)} · ${L('Baki', 'Balance')}: ${money((r.total || 0) - (r._paid || 0))}</div>` : ''}
  </div>`;
}

// ================================================================ ADMIN TAMBAHAN
async function drawAdmins() {
  const box = $('#admList'); if (!box) return;
  try {
    const s = await getDocs(query(collection(db, 'users'), where('cid', '==', S.cid), where('role', '==', 'admin')));
    const list = s.docs.map(d => ({ uid: d.id, ...d.data() }));
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>${L('E-mel', 'Email')}</th><th>${L('Peranan', 'Role')}</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr><td>${esc(a.email || a.uid)}</td><td>${a.uid === S.company.ownerUid ? `<span class="badge b-brand">${L('Pemilik', 'Owner')}</span>`
        : `<select class="input" data-perm="${a.uid}" style="width:auto;padding:.3rem .5rem">${opts([['manager', L('Pengurus', 'Manager')], ['supervisor', L('Penyelia', 'Supervisor')]], a.perm)}</select>`}</td>
        <td>${a.uid !== S.company.ownerUid ? `<button class="icon-btn" data-adel="${a.uid}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-perm]', box).forEach(sel => sel.onchange = async () => { try { await updateDoc(doc(db, 'users', sel.dataset.perm), { perm: sel.value }); logAct('admin.perm', sel.value); toast(L('Dikemas kini.', 'Updated.')); } catch (e) { toast(authErr(e), 'bad'); } });
    $$('[data-adel]', box).forEach(b => b.onclick = async () => {
      if (!await confirmBox(L('Buang akses admin ini?', 'Remove this admin access?'))) return;
      try { await deleteDoc(doc(db, 'users', b.dataset.adel)); logAct('admin.remove', b.dataset.adel); drawAdmins(); } catch (e) { toast(authErr(e), 'bad'); }
    });
  } catch (e) { box.innerHTML = `<div class="empty small">${esc(authErr(e))}</div>`; }
}
function addAdmin() {
  modal({
    title: L('Tambah Admin', 'Add Admin'),
    body: `<div class="field"><label class="lbl">${L('E-mel', 'Email')}</label><input class="input" type="email" id="aE"></div>
      <div class="field"><label class="lbl">${L('Kata laluan sementara (min 6)', 'Temporary password (min 6)')}</label><input class="input" id="aP" value="${randPin()}${randPin().slice(0, 2)}"></div>
      <div class="field"><label class="lbl">${L('Peranan', 'Role')}</label><select class="input" id="aR">${opts([['manager', L('Pengurus', 'Manager')], ['supervisor', L('Penyelia', 'Supervisor')]], 'supervisor')}</select></div>
      <p class="xs muted">${L('Admin baharu log masuk di halaman admin dengan e-mel & kata laluan ini, kemudian boleh tukar kata laluan melalui "Lupa kata laluan".', 'The new admin logs in on the admin page with this email & password, and can change it via "Forgot password".')}</p>`,
    actions: [{ label: L('Batal', 'Cancel') }, {
      label: L('Tambah', 'Add'), cls: 'btn-primary', onClick: async ({ el }) => {
        const email = $('#aE', el).value.trim(), pw = $('#aP', el).value;
        if (!email || pw.length < 6) { toast(L('Sila isi e-mel dan kata laluan (min 6).', 'Enter email and password (min 6).'), 'warn'); return false; }
        try {
          const sa = getSecAuth();
          const cred = await createUserWithEmailAndPassword(sa, email, pw);
          await signOut(sa).catch(() => {});
          await setDoc(doc(db, 'users', cred.user.uid), { role: 'admin', cid: S.cid, email, perm: $('#aR', el).value, createdAt: serverTimestamp() });
          logAct('admin.add', email);
          copyText(`${location.origin}/\n${email}\n${pw}`);
          toast(L('Admin ditambah. Maklumat login telah disalin.', 'Admin added. Login details copied.'), 'ok', 5000);
          drawAdmins();
        } catch (e) {
          toast(e.code === 'auth/email-already-in-use' ? L('E-mel ini sudah ada akaun. Guna e-mel lain.', 'This email already has an account. Use another email.') : authErr(e), 'bad', 6000);
          return false;
        }
      }
    }]
  });
}

// ================================================================ LOG & SANDARAN
async function showLogs() {
  const m = modal({ title: L('Log Perubahan', 'Change Log'), wide: true, body: `<div class="loader" style="min-height:100px"><span class="spin"></span></div>` });
  try {
    const s = await getDocs(query(sub('logs'), orderBy('at', 'desc'), limit(200)));
    $('.modal-body', m.el).innerHTML = s.empty ? `<div class="empty">${L('Tiada log.', 'No logs.')}</div>` : `<div class="table-wrap"><table>
      <thead><tr><th>${L('Masa', 'Time')}</th><th>${L('Oleh', 'By')}</th><th>${L('Tindakan', 'Action')}</th><th>${L('Butiran', 'Details')}</th></tr></thead>
      <tbody>${s.docs.map(d => { const x = d.data(); return `<tr><td class="small">${fmtDateTime(x.at)}</td><td class="small">${esc(x.email)}${x.support ? ' <span class="badge b-warn">support</span>' : ''}</td><td class="mono small">${esc(x.action)}</td><td class="small">${esc(x.detail)}</td></tr>`; }).join('')}</tbody></table></div>`;
  } catch (e) { $('.modal-body', m.el).innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; }
}
async function backupAll(btn) {
  busy(btn, true);
  try {
    const cols = ['workers', 'locations', 'roster', 'requests', 'attendance', 'payruns', 'payslips', 'announcements', 'tasks', 'hr', 'hrfiles', 'claims'];
    const out = { exportedAt: new Date().toISOString(), company: S.company };
    for (const c of cols) {
      try { const s = await getDocs(sub(c)); out[c] = s.docs.map(d => ({ _id: d.id, ...d.data() })); } catch { out[c] = []; }
    }
    const blob = new Blob([JSON.stringify(out, (k, v) => (v && typeof v === 'object' && typeof v.toDate === 'function') ? v.toDate().toISOString() : v, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Sandaran_${S.company.code}_${todayStr()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    logAct('backup.export');
  } catch (e) { toast(authErr(e), 'bad'); }
  finally { busy(btn, false); }
}

// ================================================================ RINGKASAN TAHUNAN (EA)
async function drawEA() {
  S.eaYear = S.eaYear || String(new Date().getFullYear());
  const box = $('#payBody');
  box.innerHTML = `<div class="card"><div class="row between"><div class="row"><label class="lbl" style="margin:0">${L('Tahun', 'Year')}</label>
    <input class="input" type="number" id="eaY" value="${S.eaYear}" style="width:110px"></div>
    <button class="btn btn-sm btn-ghost" id="eaPrint">${icon('print', 16)} ${L('Cetak semua penyata', 'Print all statements')}</button></div>
    <p class="xs muted">${L('Ringkasan daripada slip gaji yang telah dikunci — untuk membantu mengisi Borang EA rasmi LHDN. Ini bukan Borang EA rasmi.', 'Summary from locked payslips — to help you fill the official LHDN EA form. This is not the official EA form.')}</p>
    <div id="eaOut"><div class="loader" style="min-height:100px"><span class="spin"></span></div></div></div>`;
  $('#eaY').onchange = (e) => { S.eaYear = e.target.value; drawEA(); };
  try {
    const y = S.eaYear;
    const s = await getDocs(query(sub('payslips'), where('period', '>=', `${y}-01`), where('period', '<=', `${y}-12`)));
    const by = {};
    s.docs.map(d => d.data()).forEach(x => {
      const k = x.workerId; const ded = (kind) => (x.deductions || []).filter(d => d.kind === kind).reduce((a, d) => a + d.amount, 0);
      const o = by[k] = by[k] || { workerId: k, name: x.name, ic: x.ic, taxNo: x.taxNo, epfNo: x.epfNo, months: 0, gross: 0, epf: 0, socso: 0, eis: 0, pcb: 0, net: 0, erEpf: 0 };
      o.months++; o.gross += x.gross || 0; o.epf += ded('epf'); o.socso += ded('socso'); o.eis += ded('eis'); o.pcb += ded('pcb'); o.net += x.net || 0; o.erEpf += x.employer?.epf || 0;
    });
    const list = Object.values(by).sort((a, b) => a.workerId.localeCompare(b.workerId));
    $('#eaOut').innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>${L('Nama', 'Name')}</th><th>${L('Bulan', 'Months')}</th><th class="right">${L('Saraan kasar', 'Gross')}</th>
      <th class="right">${L('KWSP', 'EPF')}</th><th class="right">${L('PERKESO', 'SOCSO')}</th><th class="right">${L('SIP', 'EIS')}</th><th class="right">PCB</th><th></th></tr></thead><tbody>
      ${list.map((o, i) => `<tr><td class="mono">${esc(o.workerId)}</td><td>${esc(o.name)}</td><td>${o.months}</td><td class="right">${money(o.gross)}</td><td class="right">${money(o.epf)}</td><td class="right">${money(o.socso)}</td><td class="right">${money(o.eis)}</td><td class="right">${money(o.pcb)}</td>
        <td><button class="btn btn-sm btn-ghost" data-ea="${i}">${icon('print', 14)}</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${L('Tiada slip gaji dikunci untuk tahun ini.', 'No locked payslips for this year.')}</div>`;
    const stmt = (arr) => {
      const c = S.company;
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>EA ${y}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}
        .p{page-break-after:always;max-width:700px;margin:0 auto} .p:last-child{page-break-after:auto} table{width:100%;border-collapse:collapse;margin-top:10px} td{padding:6px;border:1px solid #ccc} .r{text-align:right} h2{margin:4px 0}</style></head><body>
        ${arr.map(o => `<div class="p">${c.logo ? `<img src="${c.logo}" style="height:50px">` : ''}<h2>${esc(c.name)}</h2><div>${esc(c.address || '')}</div>
          <h3>${L('PENYATA SARAAN TAHUNAN', 'ANNUAL REMUNERATION STATEMENT')} ${y}</h3><p style="color:#666">${L('Ringkasan untuk rujukan pengisian Borang EA (bukan Borang EA rasmi).', 'Summary for reference when filling the EA form (not the official EA form).')}</p>
          <table><tr><td>${L('Nama', 'Name')}</td><td>${esc(o.name)}</td></tr><tr><td>${L('No. IC', 'IC No.')}</td><td>${esc(o.ic || '')}</td></tr><tr><td>${L('No. Cukai', 'Tax No.')}</td><td>${esc(o.taxNo || '')}</td></tr><tr><td>${L('No. KWSP', 'EPF No.')}</td><td>${esc(o.epfNo || '')}</td></tr></table>
          <table><tr><td>${L('Jumlah saraan kasar', 'Total gross remuneration')} (${o.months} ${L('bulan', 'months')})</td><td class="r">${money(o.gross)}</td></tr>
          <tr><td>${L('Caruman KWSP pekerja', 'Employee EPF')}</td><td class="r">${money(o.epf)}</td></tr><tr><td>${L('Caruman PERKESO pekerja', 'Employee SOCSO')}</td><td class="r">${money(o.socso)}</td></tr>
          <tr><td>${L('Caruman SIP pekerja', 'Employee EIS')}</td><td class="r">${money(o.eis)}</td></tr><tr><td>${L('PCB dipotong', 'PCB deducted')}</td><td class="r">${money(o.pcb)}</td></tr>
          <tr><td>${L('Caruman KWSP majikan', 'Employer EPF')}</td><td class="r">${money(o.erEpf)}</td></tr></table></div>`).join('')}</body></html>`;
    };
    $$('[data-ea]').forEach(b => b.onclick = () => openPrint(stmt([list[Number(b.dataset.ea)]])));
    $('#eaPrint').onclick = () => list.length && openPrint(stmt(list));
  } catch (e) { $('#eaOut').innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; }
}


// ================================================================ DATA DEMO
const DEMO_COLS = ['attendance', 'requests', 'claims', 'tasks', 'announcements', 'hrfiles', 'hr', 'plans', 'workers'];

async function seedDemo(btn) {
  if (S.workers.some(w => w.demo)) return toast(L('Data demo sudah ada. Padam dahulu jika mahu isi semula.', 'Demo data already exists. Delete it first to refill.'), 'warn', 5000);
  if (!await confirmBox(L('Isi data demo? Tetapan syif, cuti umum, jenis cuti dan kadar caruman CONTOH juga akan ditetapkan (sila semak sebelum guna sebenar).', 'Fill demo data? SAMPLE shift templates, holidays, leave types and contribution rates will also be set (review them before real use).'))) return;
  busy(btn, true, L('Mengisi…', 'Filling…'));
  try {
    const c = S.company, t = todayStr(), yr = t.slice(0, 4);
    // Generator rawak tetap (hasil sama setiap kali)
    let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const at = (d, hh, mm) => Timestamp.fromDate(new Date(`${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`));

    // 1) Tetapan syarikat
    const shiftTemplates = [
      { id: 'sPagi', name: L('Pagi', 'Morning'), start: '08:00', end: '17:00', grace: 10, bStart: '12:30', bEnd: '13:30' },
      { id: 'sPetang', name: L('Petang', 'Evening'), start: '14:00', end: '23:00', grace: 10, bStart: '18:30', bEnd: '19:30' }
    ];
    const holidays = [...(c.holidays || []), ...fixedNationalHolidays(Number(yr))].filter((h, i, a) => a.findIndex(x => x.date === h.date) === i);
    await updateDoc(cRef(), {
      shiftTemplates: c.shiftTemplates?.length ? c.shiftTemplates : shiftTemplates,
      holidays,
      departments: [...new Set([...(c.departments || []), L('Operasi', 'Operations'), L('Dapur', 'Kitchen'), L('Pentadbiran', 'Admin')])],
      leaveTypes: c.leaveTypes?.length ? c.leaveTypes : DEFAULT_LEAVE_TYPES(),
      allowanceTemplates: c.allowanceTemplates?.length ? c.allowanceTemplates : [
        { name: L('Elaun Makan', 'Meal Allowance'), amount: 10, type: 'daily', epf: false, socso: false },
        { name: L('Elaun Tetap', 'Fixed Allowance'), amount: 150, type: 'monthly', epf: true, socso: true }
      ],
      payroll: { ...(c.payroll || {}), epfEe: 11, epfEr: 13, socsoEe: 0.5, socsoEr: 1.75, eisEe: 0.2, eisEr: 0.2, workDaysPerMonth: 26, hoursPerDay: 8, perfectBonus: 50, lateMode: 'perMin', lateAmount: 0.2, deductUnpaid: true, deductAbsent: false },
      'settings.visits': true, 'settings.autoBreak': true, 'settings.breakStart': '13:00', 'settings.breakEnd': '14:00',
      'settings.autoOT': true, 'settings.otMin': 30, 'settings.otRound': 15
    });
    const sh = (await getDoc(cRef())).data().shiftTemplates || shiftTemplates;

    // 2) Lokasi
    let loc = S.locations[0];
    if (!loc) {
      const r = await addDoc(sub('locations'), { name: L('Ibu Pejabat (Demo)', 'HQ (Demo)'), mode: 'button', radius: 150, lat: null, lng: null, qrSecret: randSecret(), createdAt: serverTimestamp(), demo: true });
      loc = { id: r.id, name: L('Ibu Pejabat (Demo)', 'HQ (Demo)') };
    }

    // 3) Pekerja
    const P = [
      ['Ahmad Faiz bin Rahman', 'Penyelia Operasi', 0, 'monthly', 3200, '1990-' + t.slice(5, 7) + '-21'],
      ['Nurul Aina binti Hassan', 'Kerani Akaun', 2, 'monthly', 2400, '1995-03-12'],
      ['Muhammad Hakim bin Ali', 'Tukang Masak', 1, 'monthly', 2600, '1992-07-04'],
      ['Siti Hajar binti Osman', 'Pembantu Dapur', 1, 'monthly', 1800, '1998-11-30'],
      ['Tan Wei Ming', 'Juruteknik', 0, 'monthly', 2900, '1988-01-15'],
      ['Kavitha a/p Raj', 'Penyambut Tetamu', 2, 'monthly', 1900, '1996-' + t.slice(5, 7) + '-08'],
      ['Amirul Hafiz bin Zainal', 'Pekerja Am (Harian)', 0, 'daily', 80, '2000-05-19'],
      ['Farah Nadia binti Yusof', 'Pembantu Kedai (Sambilan)', 0, 'hourly', 10, '2002-09-27']
    ];
    const depts = [L('Operasi', 'Operations'), L('Dapur', 'Kitchen'), L('Pentadbiran', 'Admin')];
    const seq0 = await runTransaction(db, async tx => { const s = await tx.get(cRef()); const n = s.data().seq || 0; tx.update(cRef(), { seq: n + P.length }); return n; });
    const workers = [];
    for (let i = 0; i < P.length; i++) {
      const [name, position, di, payType, salary, dob] = P[i];
      const wid = `${c.code}${String(seq0 + i + 1).padStart(3, '0')}`;
      let uid = '';
      if (i < 2) { // Dua akaun sebenar untuk cuba login pekerja (PIN 123456)
        try { const cr = await createUserWithEmailAndPassword(getSecAuth(), workerEmail(wid), '123456'); uid = cr.user.uid; await signOut(getSecAuth()).catch(() => {}); } catch {}
      }
      workers.push({
        id: wid, uid, name, position, dept: depts[di], payType, salary, dob, phone: '0123456' + String(100 + i), ic: `9${i}0101-10-${String(1000 + i * 7)}`,
        branchId: loc.id, startDate: '2025-01-06', bank: pick(['Maybank', 'CIMB', 'Bank Islam', 'RHB']), bankAcc: '1640' + String(1000000 + i * 1234),
        epfNo: String(20000000 + i * 911), socsoNo: '', taxNo: i % 2 ? '' : 'SG' + String(1000000 + i), active: true, mustChangePin: false, deviceId: null,
        defaultShift: i === 2 || i === 3 ? 'sPagi' : '', workDays: payType === 'hourly' ? [1, 3, 5, 6] : [],
        allowances: payType === 'monthly' ? [{ name: L('Elaun Makan', 'Meal Allowance'), amount: 10, type: 'daily', epf: false, socso: false }, ...(i === 0 ? [{ name: L('Elaun Penyelia', 'Supervisor Allowance'), amount: 300, type: 'monthly', epf: true, socso: true }] : [])] : [],
        deductions: i === 4 ? [{ name: L('Potongan uniform', 'Uniform deduction'), amount: 30, type: 'once' }] : [],
        leaveEntitle: {}, leaveCarry: i === 1 ? { annual: 2 } : {}, statutory: {}, demo: true
      });
    }
    const ops = [];
    workers.forEach(w => {
      const { id, ...data } = w;
      ops.push(b => b.set(doc(db, 'companies', S.cid, 'workers', id), { ...data, createdAt: serverTimestamp() }));
      if (w.uid) ops.push(b => b.set(doc(db, 'users', w.uid), { role: 'worker', cid: S.cid, workerId: id, createdAt: serverTimestamp() }));
    });
    ops.push(b => b.update(cRef(), { workerCount: increment(workers.length) }));
    const uidOf = (w) => w.uid || ('demo-' + w.id);

    // 4) Kehadiran 30 hari lepas + hari ini
    const roster = {};
    const ws = weekStart(t);
    dateRange(ws, addDays(ws, 6)).forEach((d, i) => { if (i % 2 === 0) roster[d] = { [workers[4].id]: 'sPetang' }; if (i === 2) roster[d] = { ...(roster[d] || {}), [workers[5].id]: 'off' }; });
    const leaveDays = new Set(dateRange(addDays(t, -9), addDays(t, -8)).map(d => workers[2].id + d));
    for (const d of dateRange(addDays(t, -30), t)) {
      for (const w of workers) {
        const info = resolveDay({ ...c, shiftTemplates: sh, holidays }, w, d, roster[d]?.[w.id]);
        if (info.type !== 'work' || leaveDays.has(w.id + d)) continue;
        if (rnd() < 0.05 && d !== t) continue; // tidak hadir sekali-sekala
        const [sh0, sm0] = info.shift.start.split(':').map(Number), [eh, em] = info.shift.end.split(':').map(Number);
        const late = rnd() < 0.15 ? 12 + Math.floor(rnd() * 25) : -Math.floor(rnd() * 15);
        const inMin = sh0 * 60 + sm0 + late;
        const base = { uid: uidOf(w), workerId: w.id, name: w.name, date: d, lid: loc.id, locName: loc.name, method: pick(['button', 'gps', 'qr']), lat: 3.0333, lng: 101.6167, acc: 12, dist: Math.floor(rnd() * 60), selfie: null, hasSelfie: false, deviceId: 'demo', dept: w.dept, demo: true };
        ops.push(b => b.set(doc(sub('attendance')), { ...base, type: 'in', ts: at(d, Math.floor(inMin / 60), inMin % 60) }));
        if (d === t && new Date().getHours() < eh) continue; // hari ini: masih bekerja
        if (w.payType !== 'hourly') {
          ops.push(b => b.set(doc(sub('attendance')), { ...base, type: 'break_in', ts: at(d, sh0 + 4, Math.floor(rnd() * 10)) }));
          ops.push(b => b.set(doc(sub('attendance')), { ...base, type: 'break_out', ts: at(d, sh0 + 5, Math.floor(rnd() * 10)) }));
        }
        const outMin = eh * 60 + em + Math.floor(rnd() * 40);
        ops.push(b => b.set(doc(sub('attendance')), { ...base, type: 'out', ts: at(d, Math.floor(outMin / 60) % 24, outMin % 60) }));
      }
    }
    // Lawatan tapak
    ops.push(b => b.set(doc(sub('attendance')), { uid: uidOf(workers[4]), workerId: workers[4].id, name: workers[4].name, type: 'visit', ts: at(addDays(t, -1), 11, 20), date: addDays(t, -1), lid: null, locName: L('Tapak Pelanggan - Puchong', 'Client Site - Puchong'), note: L('Servis penghawa dingin', 'Air-cond service'), method: 'gps', lat: 3.03, lng: 101.62, acc: 15, dist: null, selfie: null, hasSelfie: false, deviceId: 'demo', dept: workers[4].dept, demo: true }));

    // 5) Jadual minggu ini
    Object.entries(roster).forEach(([d, a]) => ops.push(b => b.set(doc(db, 'companies', S.cid, 'roster', d), { a }, { merge: true })));

    // 6) Permohonan
    const R = (w, data) => ops.push(b => b.set(doc(sub('requests')), { uid: uidOf(w), workerId: w.id, name: w.name, createdAt: serverTimestamp(), demo: true, ...data }));
    R(workers[2], { kind: 'leave', typeId: 'annual', typeName: leaveTypeName(c, 'annual'), from: addDays(t, -9), to: addDays(t, -8), half: '', days: 2, reason: L('Urusan keluarga', 'Family matters'), status: 'approved', adminNote: 'OK' });
    R(workers[3], { kind: 'leave', typeId: 'sick', typeName: leaveTypeName(c, 'sick'), from: addDays(t, 3), to: addDays(t, 3), half: '', days: 1, reason: L('Temujanji klinik', 'Clinic appointment'), status: 'pending' });
    R(workers[0], { kind: 'ot', date: addDays(t, -3), start: '18:00', end: '21:00', hours: 3, approvedHours: 3, otKind: 'normal', reason: L('Stok masuk', 'Stock arrival'), status: 'approved' });
    R(workers[4], { kind: 'ot', date: addDays(t, -1), start: '23:00', end: '01:00', hours: 2, otKind: 'normal', reason: L('Kerosakan mesin', 'Machine breakdown'), status: 'pending' });
    // Borang tuntutan bulanan (dokumen berasingan, ikut format Excel)
    const mo = t.slice(0, 7), dd = (n) => `${mo}-${String(n).padStart(2, '0')}`, PJ = ['DMZ Sepang', 'Logger Puchong'];
    ops.push(b => b.set(doc(db, 'companies', S.cid, 'claims', `${workers[0].id}_${mo}`), {
      uid: uidOf(workers[0]), workerId: workers[0].id, name: workers[0].name, month: mo, status: 'submitted', submittedAt: serverTimestamp(), demo: true,
      journeys: [
        { date: dd(3), route: 'Puchong - Sepang - Puchong', project: PJ[0], km: 86, toll: 7.4, parking: 0, outstation: 0, overnight: 0, remarks: L('Pasang logger', 'Install logger') },
        { date: dd(5), route: 'Puchong - Kuantan', project: PJ[0], km: 250, toll: 32.5, parking: 6, outstation: 1, overnight: 1, remarks: L('Lawatan tapak', 'Site visit') },
        { date: dd(6), route: 'Kuantan - Puchong', project: PJ[0], km: 250, toll: 32.5, parking: 0, outstation: 1, overnight: 0, remarks: '' },
        { date: dd(9), route: 'Puchong - Bandar Kinrara', project: PJ[1], km: 24, toll: 2.1, parking: 4, outstation: 0, overnight: 0, remarks: L('Semak sensor', 'Check sensor') }],
      purchases: [
        { date: dd(5), supplier: 'Hotel Seri Malaysia', sstCode: '', invoice: 'INV-88213', cat: 'LODGING', amount: 120, sst: 9.6, project: PJ[0] },
        { date: dd(5), supplier: 'Restoran Pak Su', sstCode: '', invoice: 'R-1022', cat: 'FOOD AND BEVERAGES', amount: 38.5, sst: 0, project: PJ[0] },
        { date: dd(9), supplier: 'Mr DIY', sstCode: 'W10-1808-32000123', invoice: 'MD-55190', cat: 'TOOLS', amount: 46.3, sst: 3.7, project: PJ[1] }],
      allowances: [], otherDetails: ''
    }));
    ops.push(b => b.set(doc(db, 'companies', S.cid, 'claims', `${workers[4].id}_${mo}`), {
      uid: uidOf(workers[4]), workerId: workers[4].id, name: workers[4].name, month: mo, status: 'approved', submittedAt: serverTimestamp(), approvedBy: 'Demo Admin', approvedAt: t.split('-').reverse().join('/'), demo: true,
      journeys: [{ date: dd(2), route: 'Puchong - Klang - Puchong', project: PJ[1], km: 60, toll: 4.2, parking: 3, outstation: 0, overnight: 0, remarks: '' }],
      purchases: [], allowances: [], otherDetails: ''
    }));
    if (!(S.company.projects || []).length) ops.push(b => b.update(cRef(), { projects: PJ }));
    R(workers[3], { kind: 'advance', date: addDays(t, -5), amount: 200, approvedAmount: 200, reason: L('Kecemasan', 'Emergency'), status: 'approved' });
    R(workers[5], { kind: 'fix', date: addDays(t, -1), time: '18:05', type: 'out', reason: L('Terlupa punch keluar', 'Forgot to clock out'), status: 'pending' });
    R(workers[6], { kind: 'swap', date: addDays(t, 2), withId: workers[7].id, reason: L('Urusan peribadi', 'Personal matters'), status: 'pending' });

    // Catatan "pergi mana"
    [[workers[4], t, L('Tapak pelanggan Puchong', 'Client site Puchong')], [workers[0], addDays(t, 1), L('Mesyuarat pembekal, Shah Alam', 'Supplier meeting, Shah Alam')], [workers[1], addDays(t, 2), L('Bank & LHDN', 'Bank & LHDN')]]
      .forEach(([w, d, note]) => ops.push(b => b.set(doc(db, 'companies', S.cid, 'plans', `${w.id}_${d}`), { uid: uidOf(w), workerId: w.id, name: w.name, date: d, note, at: serverTimestamp(), demo: true })));
    // OT automatik (contoh: keluar lewat semalam)
    R(workers[1], { kind: 'ot', auto: true, date: addDays(t, -1), start: '18:00', end: '19:45', hours: 1.75, otKind: 'normal', reason: L('Auto: bekerja selepas tamat syif', 'Auto: worked after shift end'), status: 'pending' });

    // 7) Tugasan, pengumuman, fail HR
    [[workers[0], L('Semak stok gudang', 'Check warehouse stock'), 'done'], [workers[2], L('Sediakan menu katering Sabtu', "Prepare Saturday's catering menu"), 'open'], [workers[4], L('Servis mesin pendingin', 'Service the chiller'), 'open']]
      .forEach(([w, title, status]) => ops.push(b => b.set(doc(sub('tasks')), { uid: uidOf(w), workerId: w.id, name: w.name, title, note: '', date: t, status, ...(status === 'done' ? { doneAt: serverTimestamp(), workerNote: L('Siap, semua cukup', 'Done, all in stock') } : {}), createdAt: serverTimestamp(), demo: true })));
    ops.push(b => b.set(doc(sub('announcements')), { title: L('Makan malam syarikat', 'Company dinner'), body: L('Makan malam akhir tahun pada Sabtu depan, jam 8 malam. Sila undi lokasi pilihan anda.', 'Year-end dinner next Saturday at 8pm. Please vote for your preferred venue.'), options: ['Restoran Nasi Kandar', 'Restoran Thai', 'BBQ di pejabat'], createdAt: serverTimestamp(), demo: true }));
    ops.push(b => b.set(doc(sub('announcements')), { title: L('Selamat datang ke sistem kehadiran baharu', 'Welcome to the new attendance system'), body: L('Mulai hari ini sila punch masuk & keluar melalui telefon. Hubungi penyelia jika ada masalah.', 'From today please clock in & out on your phone. Contact your supervisor if you have any issues.'), options: [], createdAt: serverTimestamp(), demo: true }));
    ops.push(b => b.set(doc(sub('hrfiles')), { workerId: workers[4].id, title: L('Lesen memandu (GDL)', 'Driving licence (GDL)'), expiry: addDays(t, 20), image: null, at: serverTimestamp(), demo: true }));
    ops.push(b => b.set(doc(sub('hrfiles')), { workerId: workers[3].id, title: L('Sijil tifoid', 'Typhoid certificate'), expiry: addDays(t, -3), image: null, at: serverTimestamp(), demo: true }));
    ops.push(b => b.set(doc(db, 'companies', S.cid, 'hr', workers[1].id), {
      demo: true, loans: [{ id: 'xloan1', name: L('Pinjaman motosikal', 'Motorcycle loan'), total: 1200, monthly: 200, start: t.slice(0, 7), active: true }],
      onboard: [{ id: 'o1', item: L('Serah salinan IC', 'Submit IC copy'), done: true }, { id: 'o2', item: L('Buka akaun bank', 'Open bank account'), done: true }, { id: 'o3', item: L('Latihan keselamatan', 'Safety training'), done: false }],
      reviews: [{ id: 'r1', date: addDays(t, -60), score: 4, notes: L('Teliti dan cepat belajar', 'Careful and learns quickly') }]
    }, { merge: true }));
    ops.push(b => b.set(doc(db, 'companies', S.cid, 'hr', workers[6].id), { demo: true, warnings: [{ id: 'w1', date: addDays(t, -14), level: L('Amaran lisan', 'Verbal warning'), reason: L('Lewat 3 kali seminggu', 'Late 3 times in a week') }] }, { merge: true }));

    await commitOps(ops);
    logAct('demo.seed', `${workers.length} workers`);
    modal({
      title: L('Data demo siap ✓', 'Demo data ready ✓'),
      body: `<p>${L('Semua halaman kini ada data contoh. Cuba:', 'Every page now has sample data. Try:')}</p>
        <ul class="small"><li>${L('Dashboard — kehadiran hari ini, carta 14 hari, peringatan', 'Dashboard — today, 14-day chart, reminders')}</li>
        <li>${L('Kelulusan — 5 permohonan menunggu', 'Approvals — 5 pending requests')}</li>
        <li>${L('Gaji → Jana Gaji bulan ini → Kunci → lihat slip', 'Payroll → Generate this month → Lock → view slips')}</li>
        <li>${L('Laporan, Syif & Jadual, Tugasan, Fail HR', 'Reports, Shifts & Roster, Tasks, HR Files')}</li></ul>
        <p><b>${L('Login pekerja demo', 'Demo staff login')}</b> (${location.origin}/worker):<br>
        ID <b class="mono">${workers[0].id}</b> / <b class="mono">${workers[1].id}</b> · PIN <b class="mono">123456</b></p>
        <p class="xs muted">${L('Kadar caruman demo hanyalah contoh — semak di Gaji → Tetapan Gaji sebelum guna sebenar.', 'Demo contribution rates are examples only — review them in Payroll → Settings before real use.')}</p>`
    });
  } catch (e) { console.error(e); toast(authErr(e), 'bad', 6000); }
  finally { busy(btn, false); }
}

async function clearDemo(btn) {
  if (!await confirmBox(L('Padam semua data demo (pekerja, kehadiran, permohonan, tugasan, pengumuman, fail HR demo)? Data sebenar tidak terjejas.', 'Delete all demo data (demo staff, attendance, requests, tasks, announcements, HR files)? Real data is not affected.'))) return;
  busy(btn, true, L('Memadam…', 'Deleting…'));
  try {
    const ops = [];
    let n = 0;
    for (const col of DEMO_COLS) {
      const s = await getDocs(query(sub(col), where('demo', '==', true)));
      s.docs.forEach(d => {
        ops.push(b => b.delete(d.ref));
        if (col === 'workers') { n++; const u = d.data().uid; if (u) ops.push(b => b.delete(doc(db, 'users', u))); }
      });
    }
    const ls = await getDocs(query(sub('locations'), where('demo', '==', true)));
    ls.docs.forEach(d => ops.push(b => b.delete(d.ref)));
    if (n) ops.push(b => b.update(cRef(), { workerCount: increment(-n) }));
    await commitOps(ops);
    logAct('demo.clear', `${ops.length} docs`);
    toast(L('Data demo dipadam.', 'Demo data deleted.'));
  } catch (e) { toast(authErr(e), 'bad'); }
  finally { busy(btn, false); }
}


// ================================================================ TUNTUTAN (borang bulanan, dokumen berasingan)
async function viewClaims() {
  S.clMonth = S.clMonth || todayStr().slice(0, 7);
  $('#view').innerHTML = `
  <div class="card no-print"><div class="row between">
    <div class="row"><label class="lbl" style="margin:0">${L('Bulan', 'Month')}</label><input type="month" class="input" id="clM" value="${S.clMonth}" style="width:auto"></div>
    <div class="row"><select class="input" id="clF" style="width:auto">
      <option value="">${L('Semua status', 'All statuses')}</option><option value="submitted">${L('Menunggu semakan', 'Awaiting check')}</option><option value="checked">${L('Disemak, menunggu kelulusan', 'Checked, awaiting approval')}</option>
      <option value="approved">${L('Diluluskan', 'Approved')}</option><option value="paid">${L('Dibayar', 'Paid')}</option><option value="rejected">${L('Ditolak', 'Rejected')}</option><option value="draft">${L('Draf', 'Draft')}</option></select>
      <button class="btn btn-sm btn-ghost" id="clX">${icon('dl', 16)} ${L('Ringkasan Excel', 'Summary Excel')}</button></div>
  </div></div>
  <div id="clOut" style="margin-top:12px"><div class="loader" style="min-height:120px"><span class="spin"></span></div></div>`;
  $('#clM').onchange = (e) => { S.clMonth = e.target.value; viewClaims(); };
  let list = [];
  try {
    const s = await getDocs(query(sub('claims'), where('month', '==', S.clMonth)));
    list = s.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { $('#clOut').innerHTML = `<div class="card"><div class="empty">${esc(authErr(e))}</div></div>`; return; }
  const order = isSupervisor() ? { submitted: 0, checked: 1, approved: 2, rejected: 3, paid: 4, draft: 5 } : { checked: 0, submitted: 1, approved: 2, rejected: 3, paid: 4, draft: 5 };
  const draw = () => {
    const f = $('#clF').value;
    const rows = list.filter(x => !f || x.status === f).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.workerId || '').localeCompare(b.workerId || ''));
    const tot = (st) => list.filter(x => st.includes(x.status)).reduce((a, x) => a + computeClaim(x, S.company).reimbursement, 0);
    $('#clOut').innerHTML = `
      <div class="stats">
        <div class="stat warn"><div class="n" style="font-size:1.15rem">${money(tot(['submitted']))}</div><div class="t">${L('Menunggu semakan penyelia', 'Awaiting supervisor check')}</div></div>
        <div class="stat warn"><div class="n" style="font-size:1.15rem">${money(tot(['checked']))}</div><div class="t">${L('Menunggu kelulusan finance/boss', 'Awaiting finance/boss approval')}</div></div>
        <div class="stat info"><div class="n" style="font-size:1.15rem">${money(tot(['approved']))}</div><div class="t">${L('Lulus, belum dibayar', 'Approved, unpaid')}</div></div>
        <div class="stat ok"><div class="n" style="font-size:1.15rem">${money(tot(['paid']))}</div><div class="t">${L('Dibayar', 'Paid')}</div></div>
      </div>
      <div class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${L('Pekerja', 'Staff')}</th><th class="right">Claim</th><th class="right">Allowance</th><th class="right">Reimbursement</th><th>${L('Status', 'Status')}</th><th></th></tr></thead><tbody>
        ${rows.map(x => { const X = computeClaim(x, S.company); return `<tr><td><b>${esc(x.name)}</b><div class="xs muted mono">${esc(x.workerId)}</div></td>
          <td class="right">${money(X.claimTotal)}</td><td class="right">${money(X.allowanceTotal)}</td><td class="right bold">${money(X.reimbursement)}</td>
          <td>${claimBadge(x.status)}${x.paidRef ? `<div class="xs muted">${esc(x.paidRef)}</div>` : ''}</td>
          <td class="right"><button class="btn btn-sm btn-soft" data-cl="${esc(x.id)}">${L('Buka', 'Open')}</button></td></tr>`; }).join('')}</tbody></table></div>`
        : `<div class="empty">${L('Tiada tuntutan untuk bulan ini.', 'No claims for this month.')}</div>`}</div>`;
    $$('[data-cl]').forEach(b => b.onclick = () => openClaimAdmin(list.find(x => x.id === b.dataset.cl), () => viewClaims()));
  };
  $('#clF').onchange = draw;
  $('#clX').onclick = (e) => {
    if (!list.length) return toast(L('Tiada tuntutan untuk bulan ini.', 'No claims for this month.'), 'warn');
    busy(e.currentTarget, true);
    claimSummaryExcel(S.company, list, S.clMonth).catch(() => toast(L('Gagal muat modul Excel. Semak internet.', 'Could not load the Excel module. Check your connection.'), 'warn')).finally(() => busy(e.currentTarget, false));
  };
  draw();
}

async function claimFiles(cl) {
  const ids = (cl.purchases || []).map(p => p.fileId).filter(Boolean), out = {};
  await Promise.all(ids.map(id => getDoc(doc(db, 'companies', S.cid, 'claimFiles', id)).then(s => { if (s.exists()) out[id] = s.data().img; }).catch(() => {})));
  return out;
}

function openClaimAdmin(cl, after) {
  const X = computeClaim(cl, S.company);
  const ref = doc(db, 'companies', S.cid, 'claims', cl.id);
  const m = modal({
    title: `${esc(cl.name)} · ${esc(cl.month)}`, wide: true,
    body: `
      <div class="row between" style="margin-bottom:.6rem">${claimBadge(cl.status)}<span class="xs muted">${cl.submittedAt ? L('Dihantar', 'Submitted') + ' ' + fmtDateTime(cl.submittedAt) : ''}</span></div>
      ${claimTimeline(cl)}
      <div class="stats">
        <div class="stat"><div class="n" style="font-size:1.1rem">${money(X.claimTotal)}</div><div class="t">Total (Claim)</div></div>
        <div class="stat info"><div class="n" style="font-size:1.1rem">${money(X.allowanceTotal)}</div><div class="t">Total (Allowance)</div></div>
        <div class="stat ok"><div class="n" style="font-size:1.1rem">${money(X.reimbursement)}</div><div class="t">Claim Reimbursement</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>PROJECT</th><th class="right">MILEAGE</th><th class="right">TOLL</th><th class="right">TRAVEL</th><th class="right">OUTST/OVERN</th><th class="right">LODGING</th><th class="right">PARKING</th><th class="right">F&amp;B</th><th class="right">TOOLS</th><th class="right">STAT.</th><th class="right">MED.</th><th class="right">OTHERS</th><th class="right">TOTAL</th></tr></thead><tbody>
        ${X.rows.map(r => `<tr><td>${esc(r.project)}</td>${['mileage', 'toll', 'travel', 'outOver', 'lodging', 'parking', 'fnb', 'tools', 'stationery', 'medical', 'others', 'total'].map(k => `<td class="right">${r[k].toFixed(2)}</td>`).join('')}</tr>`).join('')}
        <tr><td>MILEAGE ALLOWANCE OFFSET</td><td class="right">${X.offset ? (-X.offset).toFixed(2) : '0.00'}</td><td colspan="11"></td></tr></tbody></table></div>
      <div class="grid2" style="margin-top:.6rem"><div>
        <div class="set-row"><span>Total Expenses</span><b>${money(X.totalExpenses)}</b></div>
</div><div>
        <div class="set-row"><span>Total (Allowance)</span><b>${money(X.allowanceTotal)}</b></div>
        <div class="set-row"><span>Total (Claim)</span><b>${money(X.claimTotal)}</b></div>
        <div class="set-row"><span><b>Claim Reimbursement</b></span><b style="color:var(--gold)">${money(X.reimbursement)}</b></div></div></div>
      ${cl.adminNote ? `<p class="small">💬 ${esc(cl.adminNote)}</p>` : ''}
      <div class="row" style="margin-top:.6rem">
        <button class="btn btn-ghost" id="cDoc">${icon('print', 16)} ${L('Dokumen penuh / PDF', 'Full document / PDF')}</button>
        <button class="btn btn-ghost" id="cXl">${icon('dl', 16)} Excel</button>
      </div>`,
    actions: [
      ...(isSupervisor() && cl.status === 'submitted' ? [
        { label: L('Tolak', 'Reject'), cls: 'btn-danger', autoClose: false, onClick: () => { decideClaim(false); return false; } },
        { label: L('Semak & hantar ke finance', 'Check & send to finance'), cls: 'btn-ok', autoClose: false, onClick: () => { decideClaim('check'); return false; } }] : []),
      ...(!isSupervisor() && cl.status === 'submitted' ? [
        { label: L('Tolak', 'Reject'), cls: 'btn-danger', autoClose: false, onClick: () => { decideClaim(false); return false; } },
        { label: L('Semak', 'Check'), cls: 'btn-ghost', autoClose: false, onClick: () => { decideClaim('check'); return false; } },
        { label: L('Lulus terus', 'Approve directly'), cls: 'btn-ok', autoClose: false, onClick: () => { decideClaim(true); return false; } }] : []),
      ...(!isSupervisor() && cl.status === 'checked' ? [
        { label: L('Tolak', 'Reject'), cls: 'btn-danger', autoClose: false, onClick: () => { decideClaim(false); return false; } },
        { label: L('Lulus', 'Approve'), cls: 'btn-ok', autoClose: false, onClick: () => { decideClaim(true); return false; } }] : []),
      ...(!isSupervisor() && cl.status === 'approved' ? [
        { label: L('Tolak / minta edit', 'Reject / request edit'), cls: 'btn-danger', autoClose: false, onClick: () => { decideClaim(false); return false; } },
        { label: L('Tanda sudah dibayar', 'Mark as paid'), cls: 'btn-primary', autoClose: false, onClick: () => { markPaid(); return false; } }] : []),
      ...(!isSupervisor() && cl.status === 'paid' ? [{ label: L('Batal status dibayar', 'Undo paid'), cls: 'btn-ghost', autoClose: false, onClick: () => { undoPaid(); return false; } }] : []),
      { label: L('Tutup', 'Close') }
    ]
  });
  $('#cDoc', m.el).onclick = async () => { const f = await claimFiles(cl); openPrint(claimDocHtml(S.company, cl, f), false) || toast(L('Benarkan pop-up.', 'Allow pop-ups.'), 'warn'); };
  $('#cXl', m.el).onclick = (e) => { busy(e.currentTarget, true); claimExcel(S.company, cl).catch(() => toast(L('Gagal muat modul Excel. Semak internet.', 'Could not load the Excel module. Check your connection.'), 'warn')).finally(() => busy(e.currentTarget, false)); };
  const decideClaim = (ok) => ok === 'check' ? modal({
    title: L('Semak tuntutan', 'Check claim'),
    body: `<p class="small">${esc(cl.name)} · ${esc(cl.month)} · <b>${money(X.reimbursement)}</b></p>
      <p class="xs muted">${L('Selepas disemak, tuntutan dihantar kepada finance/boss untuk kelulusan.', 'After checking, the claim goes to finance/boss for approval.')}</p>
      <div class="field"><label class="lbl">${L('Disemak oleh (nama)', 'Checked by (name)')}</label><input class="input" id="dBy" value="${esc(S.user.displayName || S.user.email || '')}"></div>
      <div class="field"><label class="lbl">${L('Catatan (pilihan)', 'Note (optional)')}</label><textarea class="input" id="dN" maxlength="300" style="min-height:60px"></textarea></div>`,
    actions: [{ label: L('Batal', 'Cancel') }, {
      label: L('Hantar ke finance', 'Send to finance'), cls: 'btn-ok', onClick: async ({ el }) => {
        try {
          await updateDoc(ref, { status: 'checked', checkedBy: $('#dBy', el).value.trim() || S.user.email || '', checkedAt: todayStr().split('-').reverse().join('/'), adminNote: $('#dN', el).value.trim(), decidedAt: serverTimestamp() });
          logAct('claim.check', cl.id); toast(L('Dihantar ke finance.', 'Sent to finance.')); m.close(); after && after();
        } catch (e) { toast(authErr(e), 'bad'); return false; }
      }
    }]
  }) : modal({
    title: ok ? L('Luluskan tuntutan', 'Approve claim') : L('Tolak tuntutan', 'Reject claim'),
    body: `<p class="small">${esc(cl.name)} · ${esc(cl.month)} · <b>${money(X.reimbursement)}</b></p>
      ${ok ? `<div class="field"><label class="lbl">${L('Diluluskan oleh (nama)', 'Approved by (name)')}</label><input class="input" id="dBy" value="${esc(S.user.displayName || S.user.email || '')}"></div>` : ''}
      <div class="field">${!ok ? `<p class="xs muted">${L('Pekerja boleh edit borang ini dan hantar semula.', 'The staff member can edit this form and resubmit.')}</p>` : ''}<label class="lbl">${ok ? L('Catatan (pilihan)', 'Note (optional)') : L('Sebab ditolak (wajib)', 'Reason for rejection (required)')}</label><textarea class="input" id="dN" maxlength="300" style="min-height:60px"></textarea></div>`,
    actions: [{ label: L('Batal', 'Cancel') }, {
      label: ok ? L('Lulus', 'Approve') : L('Tolak', 'Reject'), cls: ok ? 'btn-ok' : 'btn-danger', onClick: async ({ el }) => {
        const note = $('#dN', el).value.trim();
        if (!ok && !note) { toast(L('Sila nyatakan sebab ditolak.', 'Please give a reason.'), 'warn'); return false; }
        try {
          await updateDoc(ref, ok
            ? { status: 'approved', approvedBy: $('#dBy', el).value.trim() || S.user.email || '', approvedAt: todayStr().split('-').reverse().join('/'), decidedAt: serverTimestamp(), adminNote: note }
            : { status: 'rejected', adminNote: note, decidedAt: serverTimestamp(), approvedBy: '', approvedAt: '', checkedBy: '', checkedAt: '' });
          logAct(ok ? 'claim.approve' : 'claim.reject', cl.id);
          toast(ok ? L('Diluluskan.', 'Approved.') : L('Ditolak.', 'Rejected.'));
          m.close(); after && after();
        } catch (e) { toast(authErr(e), 'bad'); return false; }
      }
    }]
  });
  const undoPaid = async () => {
    if (!(await confirmBox(L('Batalkan status dibayar? Tuntutan akan kembali ke "Diluluskan".', 'Undo paid? The claim goes back to "Approved".')))) return;
    try { await updateDoc(ref, { status: 'approved', paidRef: '', paidAt: null }); logAct('claim.unpaid', cl.id); toast(L('Status dibayar dibatalkan.', 'Paid status undone.')); m.close(); after && after(); }
    catch (e) { toast(authErr(e), 'bad'); }
  };
  const markPaid = () => modal({
    title: L('Tanda sudah dibayar', 'Mark as paid'),
    body: `<div class="field"><label class="lbl">${L('Rujukan bayaran (cth: no. transaksi bank, tarikh)', 'Payment reference (e.g. bank transaction no., date)')}</label><input class="input" id="pRef" value="${todayStr().split('-').reverse().join('/')}"></div>`,
    actions: [{ label: L('Batal', 'Cancel') }, {
      label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
        try { await updateDoc(ref, { status: 'paid', paidRef: $('#pRef', el).value.trim(), paidAt: serverTimestamp() }); logAct('claim.paid', cl.id); m.close(); after && after(); }
        catch (e) { toast(authErr(e), 'bad'); return false; }
      }
    }]
  });
}


// ---------------------------------------------------------------- JADUAL AUTO (syif bergilir)
function autoRoster(from, preIds, preWeeks = 4) {
  const tpls = S.company.shiftTemplates || [];
  const workers = S.workers.filter(w => w.active !== false);
  const depts = [...new Set(workers.map(w => w.dept).filter(Boolean))];
  const st = S.company.settings || {};
  const DOW = [1, 2, 3, 4, 5, 6, 0];
  const m = modal({
    title: L('Jadual Auto', 'Auto Roster'), wide: true,
    body: `
      <p class="small muted">${L('Pilih pekerja, susunan syif dan hari rehat. Sistem isi jadual untuk beberapa minggu sekali gus.', 'Pick staff, shift order and rest days. The system fills the roster for several weeks at once.')}</p>
      <div class="sec-title">1. ${L('Pekerja', 'Staff')}</div>
      <div class="row" style="margin-bottom:.4rem"><button type="button" class="btn btn-sm btn-ghost" id="arAll">${L('Pilih semua', 'Select all')}</button><button type="button" class="btn btn-sm btn-ghost" id="arNone">${L('Kosongkan', 'None')}</button>
        ${depts.map(d => `<button type="button" class="btn btn-sm btn-soft" data-ardept="${esc(d)}">${esc(d)}</button>`).join('')}</div>
      <div class="chips" style="max-height:170px;overflow:auto">${workers.map(w => `<label class="check" style="min-width:210px"><input type="checkbox" data-arw="${esc(w.id)}" ${preIds.includes(w.id) ? 'checked' : ''}>${esc(w.name)} <span class="xs muted mono">${esc(w.id)}</span></label>`).join('')}</div>

      <div class="sec-title">2. ${L('Susunan syif', 'Shift order')}</div>
      <p class="xs muted">${L('Satu syif = syif tetap. Dua atau lebih = bergilir mengikut minggu (cth: Pagi → Petang → Malam).', 'One shift = fixed. Two or more = rotate weekly (e.g. Morning → Evening → Night).')}</p>
      <div id="arSeq" class="stack"></div>
      <button type="button" class="btn btn-sm btn-plus" id="arAdd">${icon('plus', 16)} ${L('Tambah syif dalam giliran', 'Add shift to rotation')}</button>
      <label class="check" style="margin-top:.5rem"><input type="checkbox" id="arStag" checked>${L('Agihkan sama rata (pekerja bermula pada syif berbeza supaya setiap syif ada orang)', 'Spread evenly (staff start on different shifts so every shift is covered)')}</label>

      <div class="sec-title">3. ${L('Hari rehat', 'Rest days')}</div>
      <select class="input" id="arRestMode" style="max-width:360px">
        <option value="own">${L('Ikut hari kerja setiap pekerja', "Follow each staff's work days")}</option>
        <option value="fixed">${L('Tetapkan hari rehat yang sama untuk semua', 'Same rest days for everyone')}</option>
        <option value="rot">${L('Hari rehat bergilir (berbeza untuk setiap pekerja)', 'Rotating rest day (different for each staff)')}</option>
      </select>
      <div class="row hide" id="arRestDays" style="margin-top:.4rem">${DOW.map(d => `<label class="check"><input type="checkbox" data-arr="${d}" ${!(st.workDays || [1, 2, 3, 4, 5]).includes(d) ? 'checked' : ''}>${dayName(d)}</label>`).join('')}</div>
      <div class="hide" id="arRotBox" style="margin-top:.4rem"><label class="lbl">${L('Bilangan hari rehat seminggu', 'Rest days per week')}</label><input class="input" type="number" min="0" max="3" id="arRotN" value="1" style="max-width:100px"></div>

      <div class="sec-title">4. ${L('Tempoh', 'Period')}</div>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Mula minggu', 'Starting week')}</label><input class="input" type="date" id="arFrom" value="${from}"></div>
        <div class="field"><label class="lbl">${L('Berapa minggu', 'How many weeks')}</label><input class="input" type="number" min="1" max="12" id="arWeeks" value="${preWeeks}"></div>
      </div>
      <label class="check"><input type="checkbox" id="arHol" checked>${L('Cuti umum ikut biasa (tidak diisi)', 'Leave public holidays as default (not filled)')}</label>
      <div class="card" style="margin-top:.6rem;background:var(--gold2);border-color:var(--gold)" id="arPrev"></div>`,
    actions: [{ label: L('Batal', 'Cancel') }, { label: L('Jana Jadual', 'Generate Roster'), cls: 'btn-primary', autoClose: false, onClick: () => { run(); return false; } }]
  });
  const el = m.el;
  const seqRow = (id = '') => `<div class="row" data-seq><select class="input grow" style="max-width:320px">${tpls.map(t => `<option value="${esc(t.id)}" ${t.id === id ? 'selected' : ''}>${esc(t.name)} ${esc(t.start)}–${esc(t.end)}</option>`).join('')}
    <option value="__normal" ${id === '__normal' ? 'selected' : ''}>${L('Waktu biasa syarikat', 'Company normal hours')} ${esc(st.workStart || '09:00')}–${esc(st.workEnd || '18:00')}</option></select><button type="button" class="icon-btn" data-sdel>✕</button></div>`;
  const seqBox = $('#arSeq', el);
  seqBox.innerHTML = seqRow(tpls[0]?.id || '__normal');
  $('#arAdd', el).onclick = () => { seqBox.insertAdjacentHTML('beforeend', seqRow(tpls[$$('[data-seq]', seqBox).length]?.id || '')); prev(); };
  seqBox.onclick = (e) => { if (e.target.closest('[data-sdel]') && $$('[data-seq]', seqBox).length > 1) { e.target.closest('[data-seq]').remove(); prev(); } };
  const ids = () => $$('[data-arw]', el).filter(x => x.checked).map(x => x.dataset.arw);
  $('#arAll', el).onclick = () => { $$('[data-arw]', el).forEach(x => x.checked = true); prev(); };
  $('#arNone', el).onclick = () => { $$('[data-arw]', el).forEach(x => x.checked = false); prev(); };
  $$('[data-ardept]', el).forEach(b => b.onclick = () => { $$('[data-arw]', el).forEach(x => { x.checked = S.workers.find(w => w.id === x.dataset.arw)?.dept === b.dataset.ardept; }); prev(); });
  $('#arRestMode', el).onchange = (e) => { $('#arRestDays', el).classList.toggle('hide', e.target.value !== 'fixed'); $('#arRotBox', el).classList.toggle('hide', e.target.value !== 'rot'); prev(); };
  el.addEventListener('change', () => prev());

  // Bina pelan: { date: { wid: value } }
  const build = () => {
    const seq = $$('[data-seq] select', seqBox).map(x => x.value);
    const sel = ids(), weeks = Math.min(12, Math.max(1, Number($('#arWeeks', el).value || 1)));
    const start = weekStart($('#arFrom', el).value || from);
    const mode = $('#arRestMode', el).value, stag = $('#arStag', el).checked, skipHol = $('#arHol', el).checked;
    const fixedRest = $$('[data-arr]', el).filter(x => x.checked).map(x => Number(x.dataset.arr));
    const rotN = Math.min(3, Math.max(0, Number($('#arRotN', el).value || 0)));
    const hol = holidayMap(S.company), plan = {};
    sel.forEach((wid, i) => {
      const w = S.workers.find(x => x.id === wid);
      const own = Array.isArray(w?.workDays) && w.workDays.length ? w.workDays : (st.workDays || [1, 2, 3, 4, 5]);
      for (let k = 0; k < weeks; k++) {
        const sh = seq[(k + (stag ? i : 0)) % seq.length];
        const rotRest = Array.from({ length: rotN }, (_, j) => DOW[(i * rotN + j) % 7]); // hari rehat tetap, berbeza setiap pekerja
        for (let dI = 0; dI < 7; dI++) {
          const d = addDays(start, k * 7 + dI), dow = new Date(d + 'T00:00:00').getDay();
          const rest = mode === 'own' ? !own.includes(dow) : mode === 'fixed' ? fixedRest.includes(dow) : rotRest.includes(dow);
          let v;
          if (skipHol && hol[d]) v = '';
          else if (rest) v = 'off';
          else v = sh === '__normal' ? '' : sh;
          (plan[d] = plan[d] || {})[wid] = v;
        }
      }
    });
    return { plan, start, weeks, sel, seq };
  };
  const prev = () => {
    const { plan, start, weeks, sel, seq } = build();
    const name = (v) => v === 'off' ? L('Rehat', 'Rest') : v === '' ? '↺' : (tpls.find(t => t.id === v)?.name || v);
    const wk1 = dateRange(start, addDays(start, 6));
    $('#arPrev', el).innerHTML = sel.length ? `<b>${L('Pratonton minggu pertama', 'First week preview')}</b> · ${sel.length} ${L('pekerja', 'staff')} · ${weeks} ${L('minggu', 'weeks')}${seq.length > 1 ? ' · ' + L('bergilir', 'rotating') : ''}
      <div class="table-wrap" style="margin-top:.4rem"><table><thead><tr><th></th>${wk1.map(d => `<th class="center">${dayName(new Date(d + 'T00:00:00').getDay())}</th>`).join('')}</tr></thead>
      <tbody>${sel.slice(0, 6).map(wid => `<tr><td class="small">${esc(S.workers.find(w => w.id === wid)?.name || wid)}</td>${wk1.map(d => `<td class="center small">${esc(name(plan[d]?.[wid] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${sel.length > 6 ? `<div class="xs muted">+${sel.length - 6} ${L('lagi', 'more')}</div>` : ''}` : `<span class="small">${L('Pilih sekurang-kurangnya seorang pekerja.', 'Select at least one staff member.')}</span>`;
  };
  prev();
  const run = async () => {
    const { plan, sel, weeks } = build();
    if (!sel.length) return toast(L('Pilih pekerja dahulu.', 'Select staff first.'), 'warn');
    if (!await confirmBox(L(`Isi jadual ${weeks} minggu untuk ${sel.length} pekerja? Jadual sedia ada pekerja ini akan ditulis ganti.`, `Fill ${weeks} weeks for ${sel.length} staff? Their existing roster entries will be overwritten.`))) return;
    try {
      const b = writeBatch(db);
      Object.entries(plan).forEach(([d, a]) => {
        const upd = {}; Object.entries(a).forEach(([wid, v]) => { upd[wid] = v || deleteField(); });
        b.set(doc(db, 'companies', S.cid, 'roster', d), { a: upd }, { merge: true });
      });
      await b.commit();
      logAct('roster.auto', `${sel.length} staff × ${weeks} weeks`);
      toast(L('Jadual dijana.', 'Roster generated.'));
      m.close(); drawWeek();
    } catch (e) { toast(authErr(e), 'bad'); }
  };
}


// ================================================================ IMPORT PEKERJA DARI EXCEL
const IMP_COLS = [
  ['name', 'Nama *'], ['ic', 'No. IC / Pasport'], ['phone', 'No. Telefon'], ['email', 'E-mel'], ['dob', 'Tarikh Lahir (YYYY-MM-DD)'],
  ['position', 'Jawatan'], ['dept', 'Jabatan'], ['startDate', 'Tarikh Mula Kerja (YYYY-MM-DD)'],
  ['payType', 'Jenis Gaji (Bulanan / Harian / Jam)'], ['salary', 'Gaji / Kadar (RM)'],
  ['nationality', 'Status (Warganegara / PR / Asing)'],
  ['bank', 'Bank'], ['bankAcc', 'No. Akaun Bank'], ['epfNo', 'No. KWSP'], ['socsoNo', 'No. PERKESO'], ['taxNo', 'No. Cukai'],
  ['a1n', 'Elaun 1 — Nama'], ['a1v', 'Elaun 1 — RM sebulan'], ['a2n', 'Elaun 2 — Nama'], ['a2v', 'Elaun 2 — RM sebulan']
];
function impTemplate() {
  if (!window.XLSX) return toast(L('Modul Excel belum dimuatkan.', 'Excel module not loaded.'), 'warn');
  const head = IMP_COLS.map(c => c[1]);
  const ex = ['Ahmad bin Ali', '900101-10-1234', '0123456789', 'ahmad@email.com', '1990-01-01', 'Juruteknik', (S.company.departments || [])[0] || 'Operasi', '2026-01-02', 'Bulanan', 2500, 'Warganegara', 'Maybank', '1640123456', '12345678', '', '', 'Elaun Rumah', 150, 'Transport', 200];
  const ws = XLSX.utils.aoa_to_sheet([head, ex]);
  ws['!cols'] = head.map(h => ({ wch: Math.max(14, h.length + 2) }));
  const info = XLSX.utils.aoa_to_sheet([
    ['Cara isi'], ['1. Satu baris = seorang pekerja. Padam baris contoh sebelum import.'], ['2. Hanya "Nama" wajib. Lajur lain boleh dikosongkan & diisi kemudian.'],
    ['3. Tarikh dalam format YYYY-MM-DD (cth: 2026-01-02).'], ['4. Jenis Gaji: Bulanan, Harian atau Jam.'], ['5. Status: Warganegara, PR atau Asing (untuk kiraan KWSP/PERKESO/SIP).'],
    ['6. ID pekerja & PIN dijana automatik. Selepas import, muat turun senarai ID & PIN untuk diberi kepada pekerja.'],
    ['Jabatan sedia ada: ' + ((S.company.departments || []).join(', ') || '-')]
  ]);
  info['!cols'] = [{ wch: 100 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pekerja'); XLSX.utils.book_append_sheet(wb, info, 'Panduan');
  XLSX.writeFile(wb, `Templat_Pekerja_${S.company.code}.xlsx`);
}
const impDate = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};
function impRow(r) {
  const g = (k) => { const v = r[k]; return v == null ? '' : (typeof v === 'string' ? v.trim() : v); };
  const err = [];
  const name = String(g('name') || '');
  if (!name) err.push(L('Nama kosong', 'Name empty'));
  const pt = String(g('payType') || 'Bulanan').toLowerCase();
  const payType = /hari|daily/.test(pt) ? 'daily' : /jam|hour/.test(pt) ? 'hourly' : 'monthly';
  const nat = String(g('nationality') || 'Warganegara').toLowerCase();
  const nationality = /asing|foreign/.test(nat) ? 'foreign' : /pr|tetap|permanent/.test(nat) ? 'pr' : 'citizen';
  const dob = impDate(g('dob')), startDate = impDate(g('startDate'));
  if (dob === null) err.push(L('Tarikh lahir tidak sah', 'Invalid date of birth'));
  if (startDate === null) err.push(L('Tarikh mula tidak sah', 'Invalid start date'));
  const salary = Number(String(g('salary') || 0).toString().replace(/[^\d.]/g, '')) || 0;
  const allowances = [['a1n', 'a1v'], ['a2n', 'a2v']].map(([n, v]) => ({ name: String(g(n) || ''), amount: Number(g(v) || 0) })).filter(a => a.name && a.amount > 0).map(a => ({ ...a, type: 'monthly' }));
  return {
    err, data: {
      name, ic: String(g('ic') || ''), phone: String(g('phone') || ''), email: String(g('email') || ''), dob: dob || '',
      position: String(g('position') || ''), dept: String(g('dept') || ''), branchId: null, startDate: startDate || '',
      payType, salary, nationality, bank: String(g('bank') || ''), bankAcc: String(g('bankAcc') || ''), epfNo: String(g('epfNo') || ''),
      socsoNo: String(g('socsoNo') || ''), taxNo: String(g('taxNo') || ''), allowances, deductions: [], defaultShift: '', workDays: [],
      leaveEntitle: {}, leaveCarry: {}, statutory: {}
    }
  };
}
function importWorkers() {
  let rows = [];
  const m = modal({
    title: L('Import Pekerja dari Excel', 'Import Staff from Excel'), wide: true,
    body: `
      <ol class="small" style="padding-left:1.2rem;line-height:1.7">
        <li>${L('Muat turun templat & isi satu baris seorang pekerja.', 'Download the template & fill one row per staff member.')} <button type="button" class="btn btn-sm btn-soft" id="impTpl">${icon('dl', 16)} ${L('Templat Excel', 'Excel template')}</button></li>
        <li>${L('Pilih fail yang sudah diisi. Semak pratonton.', 'Choose the filled file. Check the preview.')}</li>
        <li>${L('Tekan Import. ID & PIN dijana automatik — muat turun senarai untuk diberi kepada pekerja.', 'Press Import. IDs & PINs are generated — download the list to give to staff.')}</li>
      </ol>
      <input type="file" class="input" id="impFile" accept=".xlsx,.xls,.csv">
      <div id="impPrev" style="margin-top:.8rem"></div>`,
    actions: [{ label: L('Tutup', 'Close') }, { label: L('Import', 'Import'), cls: 'btn-primary', autoClose: false, onClick: () => { run(); return false; } }]
  });
  const el = m.el;
  $('#impTpl', el).onclick = impTemplate;
  $('#impFile', el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!window.XLSX) return toast(L('Modul Excel belum dimuatkan.', 'Excel module not loaded.'), 'warn');
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const sh = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '', raw: true });
      const head = (aoa[0] || []).map(h => String(h).trim().toLowerCase());
      const idx = IMP_COLS.map(([k, label]) => [k, head.indexOf(label.toLowerCase())]);
      if (idx.find(([k]) => k === 'name')[1] < 0) { $('#impPrev', el).innerHTML = `<div class="empty small">${L('Lajur "Nama *" tidak dijumpai. Guna templat yang disediakan.', 'Column "Nama *" not found. Use the provided template.')}</div>`; return; }
      rows = aoa.slice(1).filter(r => r.some(v => String(v).trim() !== '')).map(r => impRow(Object.fromEntries(idx.filter(([, i]) => i >= 0).map(([k, i]) => [k, r[i]]))));
      const bad = rows.filter(r => r.err.length).length;
      $('#impPrev', el).innerHTML = `<p class="small"><b>${rows.length}</b> ${L('pekerja dijumpai', 'staff found')}${bad ? ` · <span style="color:var(--bad)">${bad} ${L('ada ralat (tidak diimport)', 'with errors (skipped)')}</span>` : ''}</p>
        <div class="table-wrap" style="max-height:320px;overflow:auto"><table><thead><tr><th>#</th><th>${L('Nama', 'Name')}</th><th>${L('Jawatan', 'Position')}</th><th>${L('Gaji', 'Pay')}</th><th>${L('Status', 'Status')}</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.data.name || '-')}</b><div class="xs muted">${esc(r.data.ic)}</div></td><td class="small">${esc(r.data.position)}</td>
          <td class="small">${money(r.data.salary)} · ${esc(PAY_TYPES().find(p => p[0] === r.data.payType)[1])}</td><td class="small">${esc({ citizen: L('Warganegara', 'Citizen'), pr: 'PR', foreign: L('Asing', 'Foreign') }[r.data.nationality])}</td>
          <td class="small">${r.err.length ? `<span style="color:var(--bad)">${esc(r.err.join(', '))}</span>` : '✓'}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (err) { console.error(err); $('#impPrev', el).innerHTML = `<div class="empty small">${L('Fail tidak dapat dibaca.', 'Could not read the file.')}</div>`; }
  };
  const run = async () => {
    const ok = rows.filter(r => !r.err.length);
    if (!ok.length) return toast(L('Pilih fail dengan sekurang-kurangnya seorang pekerja.', 'Choose a file with at least one staff member.'), 'warn');
    if (!await confirmBox(L(`Import ${ok.length} pekerja? Akaun log masuk akan dibuka untuk setiap pekerja.`, `Import ${ok.length} staff? A login account will be created for each.`))) return;
    const prev = $('#impPrev', el);
    const out = [];
    try {
      const seq0 = await runTransaction(db, async tx => { const s = await tx.get(cRef()); const n = s.data().seq || 0; tx.update(cRef(), { seq: n + ok.length }); return n; });
      const sa = getSecAuth();
      for (let i = 0; i < ok.length; i++) {
        const d = ok[i].data, wid = `${S.company.code}${String(seq0 + i + 1).padStart(3, '0')}`, pin = randPin();
        prev.innerHTML = `<p class="small"><span class="spin"></span> ${L('Membuka akaun', 'Creating accounts')} ${i + 1} / ${ok.length} — ${esc(d.name)}</p>`;
        try {
          const cred = await createUserWithEmailAndPassword(sa, workerEmail(wid), pin);
          await signOut(sa).catch(() => {});
          const b = writeBatch(db);
          b.set(doc(db, 'users', cred.user.uid), { role: 'worker', cid: S.cid, workerId: wid, createdAt: serverTimestamp() });
          b.set(doc(db, 'companies', S.cid, 'workers', wid), { ...d, uid: cred.user.uid, active: true, mustChangePin: true, deviceId: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          b.update(cRef(), { workerCount: increment(1) });
          await b.commitFull();
          out.push({ wid, pin, name: d.name, phone: d.phone, ok: true });
        } catch (err) {
          console.error(err);
          out.push({ wid, pin: '', name: d.name, phone: d.phone, ok: false, err: authErr(err) });
          if (err.code === 'auth/too-many-requests') { toast(L('Terlalu banyak akaun dibuka serentak. Cuba baki selepas 1 jam.', 'Too many accounts at once. Try the rest after 1 hour.'), 'warn', 8000); break; }
        }
      }
      logAct('worker.import', `${out.filter(o => o.ok).length} staff`);
    } catch (err) { toast(authErr(err), 'bad'); }
    const good = out.filter(o => o.ok);
    prev.innerHTML = `<p><b>${good.length}</b> ${L('pekerja berjaya diimport', 'staff imported')}${out.length - good.length ? ` · <span style="color:var(--bad)">${out.length - good.length} ${L('gagal', 'failed')}</span>` : ''}.</p>
      <p class="small muted">${L('Muat turun senarai ID & PIN sekarang — PIN tidak boleh dilihat semula (boleh reset kemudian).', 'Download the ID & PIN list now — PINs cannot be viewed again (can be reset later).')}</p>
      <button type="button" class="btn btn-primary" id="impDl">${icon('dl', 16)} ${L('Muat turun ID & PIN', 'Download IDs & PINs')}</button>`;
    $('#impDl', el).onclick = () => {
      const aoa = [[S.company.name], [L('Akaun pekerja — log masuk di ', 'Staff accounts — log in at ') + location.origin + '/worker'], [], ['ID', L('Nama', 'Name'), L('Telefon', 'Phone'), L('PIN sementara', 'Temporary PIN'), L('Status', 'Status')],
        ...out.map(o => [o.ok ? o.wid : '', o.name, o.phone, o.pin, o.ok ? 'OK' : (o.err || 'Gagal')])];
      const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, 'ID & PIN'); XLSX.writeFile(wb, `Akaun_Pekerja_${S.company.code}.xlsx`);
    };
    rows = [];
  };
}
