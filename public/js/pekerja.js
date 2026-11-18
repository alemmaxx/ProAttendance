// ProAttendance — Halaman Pekerja
import { auth, db, workerEmail } from './fb.js';
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, getDocs, updateDoc, addDoc, collection, query, where, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  $, $$, L, esc, toast, modal, confirmBox, busy, applyLang, langBtn, todayStr, addDays, fmtTime, fmtDate, toDate, minsToHM, dayName,
  summarizeDay, TYPE_LABEL, METHOD_LABEL, haversine, getPosition, getDeviceId, takeSelfie, scanQR, verifyQr,
  applyBrand, logoHtml, isExpired, authErr, icon, fileToDataURL
} from './ui.js';
import {
  leaveTypes, leaveTypeName, resolveDay, lateSettings, shiftLabel, loadRoster, countLeaveDays, leaveBalances,
  leaveDateMap, holidayMap, otKind, OT_LABEL, REQ_LABEL, STATUS_BADGE, hoursBetween
} from './sched.js';
import { payslipHtml, openPrint, periodLabel } from './payroll.js';
import { money } from './ui.js';

const app = $('#app');
const S = {
  user: null, me: null, cid: null, company: null, worker: null, locations: [], today: [], sessionDate: todayStr(),
  roster: {}, reqs: [], tab: 'home', clockT: 0
};
const wid = () => S.me.workerId;
const dayInfo = (date) => resolveDay(S.company, S.worker, date, S.roster[date]?.[wid()]);

// ---------------------------------------------------------------- LOGIN
const BRAND_KEY = 'pa_last_brand';
const savedBrand = () => { try { return JSON.parse(localStorage.getItem(BRAND_KEY) || 'null'); } catch { return null; } };

function renderLogin() {
  clearInterval(S.clockT);
  const b = savedBrand();
  if (b) applyBrand(b);
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="loginForm" autocomplete="on">
      <div class="row between" style="margin-bottom:.6rem"><span></span>${langBtn()}</div>
      <div class="login-brand">
        <div id="brandLogo">${b ? logoHtml(b, 'logo-lg') : `<span class="logo-lg logo-ini">${icon('clock', 38)}</span>`}</div>
        <h2 id="brandName">${b ? esc(b.name) : L('Kehadiran Pekerja', 'Staff Attendance')}</h2>
        <p class="muted small" data-ms="Log masuk dengan ID pekerja anda" data-en="Log in with your staff ID"></p>
      </div>
      <div class="field">
        <label class="lbl" data-ms="ID Pekerja" data-en="Staff ID"></label>
        <input class="input id-input" id="wid" required autocomplete="username" autocapitalize="characters" spellcheck="false"
          data-ms-ph="cth: ABC001" data-en-ph="e.g. ABC001" value="${esc(b?.lastId || '')}">
      </div>
      <div class="field">
        <label class="lbl" data-ms="PIN (6 digit)" data-en="PIN (6 digits)"></label>
        <div class="pw">
          <input class="input pin-input" id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="current-password" placeholder="••••••">
          <button type="button" data-eye>${icon('eye', 18)}</button>
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="loginBtn" type="submit" data-ms="Log Masuk" data-en="Log In"></button>
      <p class="muted small center" style="margin-top:.9rem" data-ms="Lupa PIN? Sila hubungi majikan anda untuk reset." data-en="Forgot PIN? Ask your employer to reset it."></p>
      <div class="divider"></div>
      <p class="center small"><a href="/admin.html" data-ms="Log masuk Majikan / Admin" data-en="Employer / Admin login"></a></p>
    </form>
  </div>`;
  applyLang();

  const widEl = $('#wid');
  let tmr = 0;
  const lookup = async () => {
    const v = widEl.value.trim().toUpperCase();
    const m = v.match(/^([A-Z]{2,6})\d+$/);
    if (!m) return;
    try {
      const s = await getDoc(doc(db, 'companyCodes', m[1]));
      if (s.exists()) {
        const c = s.data();
        applyBrand(c);
        $('#brandLogo').innerHTML = logoHtml(c, 'logo-lg');
        $('#brandName').textContent = c.name;
      }
    } catch {}
  };
  widEl.addEventListener('input', () => { widEl.value = widEl.value.toUpperCase().replace(/\s/g, ''); clearTimeout(tmr); tmr = setTimeout(lookup, 400); });
  if (widEl.value) lookup();

  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = widEl.value.trim().toUpperCase(), pin = $('#pin').value.trim();
    if (!/^[A-Z]{2,6}\d+$/.test(id)) return toast(L('Format ID tidak sah.', 'Invalid ID format.'), 'warn');
    if (!/^\d{6}$/.test(pin)) return toast(L('PIN mesti 6 digit.', 'PIN must be 6 digits.'), 'warn');
    const btn = $('#loginBtn');
    busy(btn, true);
    try {
      await signInWithEmailAndPassword(auth, workerEmail(id), pin);
    } catch (err) {
      toast(authErr(err), 'bad');
      busy(btn, false);
    }
  };
}

// ---------------------------------------------------------------- SESI
onAuthStateChanged(auth, async (u) => {
  S.user = u;
  if (!u) return renderLogin();
  app.innerHTML = `<div class="loader"><span class="spin"></span></div>`;
  try {
    const meS = await getDoc(doc(db, 'users', u.uid));
    if (!meS.exists()) { await signOut(auth); toast(L('Akaun tidak dijumpai.', 'Account not found.'), 'bad'); return; }
    S.me = meS.data();
    if (S.me.role === 'admin') { location.href = '/admin.html'; return; }
    if (S.me.role !== 'worker') { await signOut(auth); return; }
    S.cid = S.me.cid;
    const [cS, wS, lS] = await Promise.all([
      getDoc(doc(db, 'companies', S.cid)),
      getDoc(doc(db, 'companies', S.cid, 'workers', S.me.workerId)),
      getDocs(collection(db, 'companies', S.cid, 'locations'))
    ]);
    S.company = cS.data();
    S.worker = wS.exists() ? { id: wS.id, ...wS.data() } : null;
    S.locations = lS.docs.map(d => ({ id: d.id, ...d.data() }));
    applyBrand(S.company);
    try {
      localStorage.setItem(BRAND_KEY, JSON.stringify({ name: S.company.name, logo: S.company.logo || '', color: S.company.color || '', lastId: S.me.workerId }));
    } catch {}

    if (!S.worker || S.worker.active === false) return renderBlocked(L('Akaun anda telah dinyahaktifkan. Sila hubungi majikan anda.', 'Your account has been deactivated. Please contact your employer.'));
    if (isExpired(S.company)) return renderBlocked(L('Sistem tergendala. Sila rujuk majikan anda.', 'System unavailable. Please contact your employer.'));

    // Satu telefon seorang pekerja
    const dev = getDeviceId();
    const upd = { lastLogin: serverTimestamp() };
    if (S.company.settings?.oneDevice) {
      if (S.worker.deviceId && S.worker.deviceId !== dev) {
        return renderBlocked(L('Akaun ini telah didaftarkan pada telefon lain. Minta majikan anda untuk reset telefon.', 'This account is registered to another phone. Ask your employer to reset the phone.'));
      }
      if (!S.worker.deviceId) upd.deviceId = dev;
    }
    updateDoc(doc(db, 'companies', S.cid, 'workers', S.me.workerId), upd).catch(() => {});

    await Promise.all([loadToday(), loadMeta()]);
    renderShell();
    if (S.worker.mustChangePin) forcePinChange();
  } catch (err) {
    console.error(err);
    renderBlocked(L('Gagal memuatkan data. Semak sambungan internet.', 'Failed to load data. Check your internet connection.') + `<br><span class="xs muted">${esc(err.code || err.message)}</span>`);
  }
});

function renderBlocked(msg) {
  clearInterval(S.clockT);
  app.innerHTML = `
  <div class="blocked"><div class="card" style="max-width:420px">
    <div style="margin-bottom:.8rem">${logoHtml(S.company || savedBrand() || {}, 'logo-lg')}</div>
    <h3>${esc(S.company?.name || '')}</h3>
    <p>${msg}</p>
    <button class="btn btn-ghost" style="margin-top:1rem" id="lo">${icon('out', 18)} ${L('Log Keluar', 'Log Out')}</button>
  </div></div>`;
  $('#lo').onclick = () => signOut(auth);
}

function pinModal(force) {
  modal({
    title: force ? L('Tukar PIN Anda', 'Change Your PIN') : L('Tukar PIN', 'Change PIN'),
    closable: !force,
    body: `${force ? `<p class="small muted">${L('Untuk keselamatan, sila tetapkan PIN baharu 6 digit.', 'For security, please set a new 6-digit PIN.')}</p>` : ''}
      <div class="field"><label class="lbl">${L('PIN baharu', 'New PIN')}</label><input class="input pin-input" id="np1" type="password" inputmode="numeric" maxlength="6"></div>
      <div class="field"><label class="lbl">${L('Sahkan PIN', 'Confirm PIN')}</label><input class="input pin-input" id="np2" type="password" inputmode="numeric" maxlength="6"></div>`,
    actions: [
      ...(force ? [] : [{ label: L('Batal', 'Cancel') }]),
      {
        label: L('Simpan PIN', 'Save PIN'), cls: 'btn-primary', onClick: async ({ el }) => {
          const a = $('#np1', el).value.trim(), b = $('#np2', el).value.trim();
          if (!/^\d{6}$/.test(a)) { toast(L('PIN mesti 6 digit.', 'PIN must be 6 digits.'), 'warn'); return false; }
          if (a !== b) { toast(L('PIN tidak sepadan.', 'PINs do not match.'), 'warn'); return false; }
          try {
            await updatePassword(auth.currentUser, a);
            if (S.worker.mustChangePin) {
              await updateDoc(doc(db, 'companies', S.cid, 'workers', S.me.workerId), { mustChangePin: false });
              S.worker.mustChangePin = false;
            }
            toast(L('PIN berjaya ditukar.', 'PIN changed.'));
          } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
}
const forcePinChange = () => pinModal(true);

// ---------------------------------------------------------------- DATA
const sortTs = (a, b) => (toDate(a.ts)?.getTime() || 0) - (toDate(b.ts)?.getTime() || 0);

// Sesi kerja semasa: hari ini, atau semalam jika syif semalam masih terbuka (syif malam)
async function loadToday() {
  const t = todayStr(), y = addDays(t, -1);
  const q = query(collection(db, 'companies', S.cid, 'attendance'),
    where('uid', '==', S.user.uid), where('date', '>=', y), where('date', '<=', t));
  const s = await getDocs(q);
  const recs = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).sort(sortTs);
  const tRecs = recs.filter(r => r.date === t), yRecs = recs.filter(r => r.date === y);
  const yLast = yRecs[yRecs.length - 1];
  const yOpen = yLast && yLast.type !== 'out' && (Date.now() - (toDate(yRecs.find(r => r.type === 'in')?.ts)?.getTime() || 0)) < 16 * 3600000;
  if (!tRecs.length && yOpen) { S.sessionDate = y; S.today = yRecs; }
  else { S.sessionDate = t; S.today = tRecs; }
}

async function loadMeta() {
  const t = todayStr();
  const [ro, rq] = await Promise.all([
    loadRoster(db, S.cid, addDays(t, -1), addDays(t, 60)).catch(() => ({})),
    getDocs(query(collection(db, 'companies', S.cid, 'requests'), where('uid', '==', S.user.uid))).catch(() => null)
  ]);
  S.roster = ro;
  S.reqs = rq ? rq.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)) : [];
}

// ---------------------------------------------------------------- SHELL
function renderShell() {
  const w = S.worker;
  const pend = S.reqs.filter(r => r.status === 'pending').length;
  app.innerHTML = `
  <div class="w-top">
    <div class="row">
      ${logoHtml(S.company)}
      <div class="grow">
        <div class="co">${esc(S.company.name)}</div>
        <div class="small" style="opacity:.85">${esc(w.name)} · ${esc(S.me.workerId)}</div>
      </div>
      ${langBtn()}
    </div>
  </div>
  <main class="w-main" id="view"></main>
  <nav class="bnav">
    <button data-tab="home">${icon('clock', 22)}<span>${L('Punch', 'Punch')}</span></button>
    <button data-tab="rekod">${icon('cal', 22)}<span>${L('Rekod', 'Records')}</span></button>
    <button data-tab="mohon">${icon('doc', 22)}<span>${L('Mohon', 'Requests')}${pend ? ` (${pend})` : ''}</span></button>
    <button data-tab="berita">${icon('bell', 22)}<span>${L('Berita', 'News')}</span></button>
    <button data-tab="profil">${icon('user', 22)}<span>${L('Profil', 'Profile')}</span></button>
  </nav>`;
  $$('.bnav button').forEach(b => b.onclick = () => go(b.dataset.tab));
  go(S.tab);
}
document.addEventListener('langchange', () => { if (S.worker && $('#view')) renderShell(); });

function go(tab) {
  S.tab = tab;
  clearInterval(S.clockT);
  $$('.bnav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ home: viewHome, rekod: viewRekod, mohon: viewMohon, berita: viewBerita, profil: viewProfil })[tab]();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- PUNCH
function nextActions() {
  const sum = summarizeDay(S.today, lateSettings(S.company, dayInfo(S.sessionDate)), S.sessionDate);
  const lt = sum.lastType;
  if (!lt || lt === 'out') return { main: 'in', alt: [], sum };
  if (lt === 'break_in') return { main: 'break_out', alt: [], sum };
  return { main: 'out', alt: ['break_in'], sum };
}

function myLocation() {
  if (S.worker.branchId) return S.locations.find(l => l.id === S.worker.branchId) || null;
  return null;
}

function todayStatusHtml() {
  const t = todayStr();
  const lv = leaveDateMap(S.reqs)[t];
  if (lv) return `<span class="badge b-info">${L('Cuti', 'Leave')}: ${esc(lv.typeName || leaveTypeName(S.company, lv.typeId))}</span>`;
  const d = dayInfo(t);
  if (d.type === 'holiday' && !d.shift) return `<span class="badge b-info">${L('Cuti umum', 'Public holiday')}: ${esc(d.holiday)}</span>`;
  if (d.type === 'off') return `<span class="badge">${L('Hari rehat', 'Rest day')}</span>`;
  return `<span class="badge b-brand">${esc(shiftLabel(d.shift))}</span>${d.type === 'holiday' ? ` <span class="badge b-info">${esc(d.holiday)}</span>` : ''}`;
}

function viewHome() {
  const v = $('#view');
  const { main, alt, sum } = nextActions();
  const loc = myLocation();
  const cls = { in: 'in', out: 'out', break_in: 'brk', break_out: 'brk' }[main];
  const ico = { in: 'clock', out: 'out', break_in: 'clock', break_out: 'clock' }[main];
  v.innerHTML = `
  <div class="card clock-card">
    <div class="big-time" id="bigTime">--:--</div>
    <div class="muted" id="bigDate"></div>
    <div style="margin-top:.5rem">${todayStatusHtml()}</div>
    ${S.sessionDate !== todayStr() ? `<p class="small" style="color:var(--warn);margin-top:.4rem">${L('Syif semalam masih terbuka', "Yesterday's shift is still open")} (${fmtDate(S.sessionDate)})</p>` : ''}
    <button class="punch-btn ${cls}" id="mainBtn">${icon(ico, 34)}<span>${TYPE_LABEL[main]()}</span></button>
    ${alt.map(a => `<button class="btn btn-ghost" data-alt="${a}">${TYPE_LABEL[a]()}</button>`).join('')}
    <p class="small muted" style="margin-top:.8rem">
      ${icon('pin', 15)} ${loc ? esc(loc.name) + ' · ' + METHOD_LABEL[loc.mode || 'button']() : (S.locations.length ? L('Pilih lokasi semasa punch', 'Choose location when punching') : L('Tiada lokasi ditetapkan', 'No location set'))}
    </p>
  </div>
  <div class="stats" style="margin-top:1rem">
    <div class="stat ok"><div class="n">${sum.firstIn ? fmtTime(sum.firstIn) : '--:--'}</div><div class="t">${L('Masuk', 'In')}</div></div>
    <div class="stat bad"><div class="n">${sum.lastOut && !sum.open ? fmtTime(sum.lastOut) : '--:--'}</div><div class="t">${L('Keluar', 'Out')}</div></div>
    <div class="stat info"><div class="n" style="font-size:1.25rem">${minsToHM(sum.workMin)}</div><div class="t">${L('Jam kerja', 'Hours')}</div></div>
    ${sum.lateMin ? `<div class="stat warn"><div class="n" style="font-size:1.25rem">${sum.lateMin} min</div><div class="t">${L('Lewat', 'Late')}</div></div>` : ''}
  </div>
  <div class="card">
    <h3>${L('Aktiviti hari ini', "Today's activity")}</h3>
    ${S.today.length ? `<ul class="timeline">${S.today.map(r => `
      <li><span class="dot d-${r.type}"></span><b>${fmtTime(r.ts)}</b><span class="grow">${TYPE_LABEL[r.type]()}</span>
      <span class="badge">${esc(r.locName || METHOD_LABEL[r.method || 'button']())}</span></li>`).join('')}</ul>`
      : `<div class="empty small">${L('Belum ada rekod hari ini.', 'No records yet today.')}</div>`}
  </div>
  ${upcomingHtml()}`;
  const tick = () => {
    const d = new Date();
    const bt = $('#bigTime'); if (!bt) return;
    bt.textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#bigDate').textContent = d.toLocaleDateString(L('ms-MY', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  tick(); S.clockT = setInterval(tick, 1000);
  $('#mainBtn').onclick = (e) => punch(main, e.currentTarget);
  $$('[data-alt]').forEach(b => b.onclick = (e) => punch(b.dataset.alt, e.currentTarget));
}

// Jadual 7 hari akan datang
function upcomingHtml() {
  const t = todayStr();
  const lv = leaveDateMap(S.reqs);
  const rows = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(t, i), info = dayInfo(d), dt = new Date(d + 'T00:00:00');
    const lbl = lv[d] ? `<span class="badge b-info">${L('Cuti', 'Leave')}</span>`
      : info.type === 'off' ? `<span class="badge">${L('Rehat', 'Rest')}</span>`
      : info.type === 'holiday' && !info.shift ? `<span class="badge b-info">${esc(info.holiday)}</span>`
      : `<span class="badge b-brand">${esc(shiftLabel(info.shift))}</span>`;
    rows.push(`<div class="set-row"><span>${dayName(dt.getDay())}, ${fmtDate(d, { day: 'numeric', month: 'short' })}</span>${lbl}</div>`);
  }
  return `<div class="card"><h3>${L('Jadual 7 hari', '7-day schedule')}</h3>${rows.join('')}</div>`;
}

function pickLocation(pos) {
  return new Promise(resolve => {
    let list = [...S.locations];
    if (pos) list = list.map(l => ({ ...l, _d: (l.lat != null && l.lng != null) ? haversine(pos.lat, pos.lng, l.lat, l.lng) : null }))
      .sort((a, b) => (a._d ?? 1e12) - (b._d ?? 1e12));
    let done = false;
    const m = modal({
      title: L('Pilih Lokasi', 'Choose Location'),
      body: `<div class="stack">${list.map(l => `
        <button class="btn btn-ghost btn-block" style="justify-content:space-between" data-l="${l.id}">
          <span>${icon('pin', 16)} ${esc(l.name)}</span>
          <span class="badge">${METHOD_LABEL[l.mode || 'button']()}${l._d != null ? ' · ' + (l._d < 1000 ? Math.round(l._d) + ' m' : (l._d / 1000).toFixed(1) + ' km') : ''}</span>
        </button>`).join('')}</div>`,
      onClose: () => { if (!done) resolve(undefined); }
    });
    $$('[data-l]', m.el).forEach(b => b.onclick = () => { done = true; m.close(); resolve(S.locations.find(l => l.id === b.dataset.l)); });
  });
}

async function punch(type, btn) {
  if (isExpired(S.company)) return toast(L('Sistem tergendala. Sila rujuk majikan anda.', 'System unavailable.'), 'bad');
  busy(btn, true);
  try {
    let pos = null;
    const posP = getPosition(12000).then(p => (pos = p)).catch(() => null);

    let loc = myLocation();
    if (!loc && S.locations.length === 1) loc = S.locations[0];
    if (!loc && S.locations.length > 1) {
      await Promise.race([posP, new Promise(r => setTimeout(r, 2500))]);
      loc = await pickLocation(pos);
      if (loc === undefined) return;
    }
    const mode = loc?.mode || 'button';
    let dist = null;

    if (mode === 'gps') {
      await posP;
      if (!pos) { toast(L('Tidak dapat kesan lokasi. Hidupkan GPS dan benarkan akses lokasi.', 'Cannot get location. Turn on GPS and allow location access.'), 'bad', 5000); return; }
      dist = Math.round(haversine(pos.lat, pos.lng, loc.lat, loc.lng));
      const allow = Number(loc.radius || 100);
      if (dist > allow) {
        toast(L(`Anda berada ${dist} m dari ${loc.name}. Had dibenarkan ${allow} m.`, `You are ${dist} m from ${loc.name}. Allowed: ${allow} m.`), 'bad', 6000);
        return;
      }
    } else if (mode === 'qr') {
      const text = await scanQR();
      if (!text) return;
      const r = await verifyQr(text, S.cid, S.locations);
      if (!r.ok) { toast(r.err, 'bad', 5000); return; }
      loc = r.loc;
    }
    if (!pos) await Promise.race([posP, new Promise(r => setTimeout(r, 1500))]);
    if (pos && loc && loc.lat != null && dist == null) dist = Math.round(haversine(pos.lat, pos.lng, loc.lat, loc.lng));

    let selfie = null;
    if (S.company.settings?.selfie !== false) {
      const now = new Date();
      selfie = await takeSelfie(`${S.worker.name} (${S.me.workerId})\n${TYPE_LABEL[type]()} · ${fmtDate(now)} ${now.toLocaleTimeString('en-GB')}`);
      if (!selfie) return;
    }

    const rec = {
      uid: S.user.uid, workerId: S.me.workerId, name: S.worker.name, type,
      ts: serverTimestamp(), date: type === 'in' ? todayStr() : S.sessionDate,
      lid: loc?.id || null, locName: loc?.name || '', method: mode,
      lat: pos?.lat ?? null, lng: pos?.lng ?? null, acc: pos?.acc ?? null, dist,
      selfie, deviceId: getDeviceId(), dept: S.worker.dept || ''
    };
    await addDoc(collection(db, 'companies', S.cid, 'attendance'), rec);
    if (navigator.vibrate) navigator.vibrate(120);
    toast(`${TYPE_LABEL[type]()} ✓ ${fmtTime(new Date())}`);
    await loadToday();
    if (S.tab === 'home') viewHome();
  } catch (e) {
    console.error(e);
    toast(e.code === 'permission-denied'
      ? L('Punch ditolak. Akaun atau langganan syarikat mungkin tidak aktif.', 'Punch rejected. Account or company subscription may be inactive.')
      : authErr(e), 'bad', 5000);
  } finally { busy(btn, false); }
}

// ---------------------------------------------------------------- REKOD
async function viewRekod() {
  const v = $('#view');
  const ym = S.rekodMonth || todayStr().slice(0, 7);
  v.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${L('Rekod Kehadiran', 'Attendance Records')}</h3>
      <input type="month" class="input" id="mon" value="${ym}" style="width:auto"></div>
    <div id="rekBody"><div class="loader" style="min-height:120px"><span class="spin"></span></div></div>
  </div>`;
  $('#mon').onchange = (e) => { S.rekodMonth = e.target.value; viewRekod(); };
  try {
    const from = ym + '-01', to = ym + '-31';
    const [s, roster] = await Promise.all([
      getDocs(query(collection(db, 'companies', S.cid, 'attendance'), where('uid', '==', S.user.uid), where('date', '>=', from), where('date', '<=', to))),
      loadRoster(db, S.cid, from, to).catch(() => ({}))
    ]);
    const recs = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    const byDate = {};
    recs.forEach(r => (byDate[r.date] = byDate[r.date] || []).push(r));
    const lv = leaveDateMap(S.reqs), hol = holidayMap(S.company);
    const t = todayStr();
    const dates = new Set(Object.keys(byDate));
    Object.keys(lv).forEach(d => { if (d.startsWith(ym) && d <= t) dates.add(d); });
    Object.keys(hol).forEach(d => { if (d.startsWith(ym) && d <= t) dates.add(d); });
    const sorted = [...dates].sort().reverse();
    const info = (d) => resolveDay(S.company, S.worker, d, roster[d]?.[wid()]);
    const sums = sorted.map(dt => ({ dt, s: byDate[dt] ? summarizeDay(byDate[dt], lateSettings(S.company, info(dt)), dt) : null }));
    const present = sums.filter(x => x.s?.firstIn).length;
    const totalMin = sums.reduce((a, x) => a + (x.s?.workMin || 0), 0);
    const lateDays = sums.filter(x => x.s?.lateMin > 0).length;
    $('#rekBody').innerHTML = `
      <div class="stats">
        <div class="stat ok"><div class="n">${present}</div><div class="t">${L('Hari hadir', 'Days present')}</div></div>
        <div class="stat warn"><div class="n">${lateDays}</div><div class="t">${L('Hari lewat', 'Late days')}</div></div>
        <div class="stat info"><div class="n" style="font-size:1.2rem">${minsToHM(totalMin)}</div><div class="t">${L('Jumlah jam', 'Total hours')}</div></div>
      </div>
      ${sums.length ? sums.map(({ dt, s }) => {
        const d = new Date(dt + 'T00:00:00');
        let right = '', main = '', sub = '';
        if (s) {
          main = `${fmtTime(s.firstIn)} → ${s.open ? L('masih bekerja', 'still working') : fmtTime(s.lastOut)}`;
          sub = `${minsToHM(s.workMin)}${s.breakMin >= 1 ? ' · ' + L('rehat', 'break') + ' ' + Math.round(s.breakMin) + 'm' : ''}${s.locName ? ' · ' + esc(s.locName) : ''}`;
          right = s.lateMin ? `<span class="badge b-warn">${L('Lewat', 'Late')} ${s.lateMin}m</span>` : `<span class="badge b-ok">${L('Tepat', 'On time')}</span>`;
        } else if (lv[dt]) {
          main = esc(lv[dt].typeName || leaveTypeName(S.company, lv[dt].typeId));
          right = `<span class="badge b-info">${L('Cuti', 'Leave')}</span>`;
        } else {
          main = esc(hol[dt]);
          right = `<span class="badge b-info">${L('Cuti umum', 'Holiday')}</span>`;
        }
        return `<div class="day-row">
          <div class="day-box"><div class="d">${d.getDate()}</div><div class="w">${dayName(d.getDay())}</div></div>
          <div class="grow"><div class="bold">${main}</div><div class="small muted">${sub}</div></div>
          ${right}
        </div>`;
      }).join('') : `<div class="empty">${L('Tiada rekod untuk bulan ini.', 'No records this month.')}</div>`}`;
  } catch (e) {
    console.error(e);
    $('#rekBody').innerHTML = `<div class="empty">${L('Gagal memuatkan rekod.', 'Failed to load records.')}<br><span class="xs">${esc(e.message)}</span></div>`;
  }
}

// ---------------------------------------------------------------- MOHON (cuti / OT / pembetulan)
function viewMohon() {
  const approved = S.reqs.filter(r => r.status === 'approved');
  const bal = leaveBalances(S.company, S.worker, approved).filter(b => b.ent + b.carry > 0 || b.used > 0);
  $('#view').innerHTML = `
  <div class="card">
    <h3>${L('Baki Cuti', 'Leave Balance')} ${new Date().getFullYear()}</h3>
    ${bal.length ? `<div class="stats" style="margin:.5rem 0 0">${bal.map(b => `
      <div class="stat ${b.left <= 0 ? 'bad' : 'ok'}"><div class="n">${b.left}</div>
      <div class="t">${esc(b.name)}</div><div class="xs muted">${L('daripada', 'of')} ${b.ent + b.carry} · ${L('guna', 'used')} ${b.used}</div></div>`).join('')}</div>`
      : `<p class="small muted">${L('Tiada kelayakan cuti ditetapkan.', 'No leave entitlement set.')}</p>`}
  </div>
  <div class="card">
    <h3>${L('Buat Permohonan', 'New Request')}</h3>
    <div class="stack">
      <button class="btn btn-soft btn-block" id="rqLeave">${icon('cal', 18)} ${L('Mohon Cuti / MC', 'Apply Leave / MC')}</button>
      <button class="btn btn-soft btn-block" id="rqOt">${icon('clock', 18)} ${L('Mohon OT', 'Apply Overtime')}</button>
      <button class="btn btn-soft btn-block" id="rqFix">${icon('check', 18)} ${L('Betulkan Punch (terlupa punch)', 'Fix Punch (forgot to punch)')}</button>
      <button class="btn btn-soft btn-block" id="rqClaim">${icon('money', 18)} ${L('Tuntutan (minyak, tol, dll.)', 'Claim (fuel, toll, etc.)')}</button>
      <button class="btn btn-soft btn-block" id="rqAdv">${icon('card', 18)} ${L('Pendahuluan Gaji', 'Salary Advance')}</button>
    </div>
  </div>
  <div class="card">
    <h3>${L('Permohonan Saya', 'My Requests')}</h3>
    <div id="myReqs">${myReqsHtml()}</div>
  </div>`;
  $('#rqLeave').onclick = leaveForm;
  $('#rqOt').onclick = otForm;
  $('#rqFix').onclick = fixForm;
  $('#rqClaim').onclick = claimForm;
  $('#rqAdv').onclick = advanceForm;
  bindCancel();
}

function reqDetail(r) {
  if (r.kind === 'leave') return `${esc(r.typeName || leaveTypeName(S.company, r.typeId))} · ${fmtDate(r.from)}${r.to && r.to !== r.from ? ' – ' + fmtDate(r.to) : ''} · ${r.days} ${L('hari', 'day(s)')}${r.half ? ' (' + (r.half === 'am' ? L('pagi', 'AM') : L('petang', 'PM')) + ')' : ''}`;
  if (r.kind === 'ot') return `${fmtDate(r.date)} · ${esc(r.start)}–${esc(r.end)} · ${r.approvedHours ?? r.hours} ${L('jam', 'hrs')}`;
  if (r.kind === 'claim') return `${esc(r.category || '')} · ${fmtDate(r.date)} · ${money(r.approvedAmount ?? r.amount)}${r.paidPeriod ? ' · ' + L('dibayar', 'paid') + ' ' + esc(r.paidPeriod) : ''}`;
  if (r.kind === 'advance') return `${money(r.approvedAmount ?? r.amount)} · ${fmtDate(r.date)}${r.paidPeriod ? ' · ' + L('dipotong', 'deducted') + ' ' + esc(r.paidPeriod) : ''}`;
  return `${fmtDate(r.date)} · ${TYPE_LABEL[r.type]?.() || r.type} ${esc(r.time)}`;
}

function myReqsHtml() {
  if (!S.reqs.length) return `<div class="empty small">${L('Belum ada permohonan.', 'No requests yet.')}</div>`;
  return S.reqs.slice(0, 50).map(r => `
    <div class="day-row" style="align-items:flex-start">
      <div class="grow">
        <div class="bold">${REQ_LABEL[r.kind]()}</div>
        <div class="small">${reqDetail(r)}</div>
        ${r.reason ? `<div class="xs muted">${esc(r.reason)}</div>` : ''}
        ${r.adminNote ? `<div class="xs" style="margin-top:.2rem">💬 ${esc(r.adminNote)}</div>` : ''}
      </div>
      <div class="right">${STATUS_BADGE(r.status)}
        ${r.status === 'pending' ? `<div><button class="link-btn xs" data-cancel="${r.id}">${L('Batal', 'Cancel')}</button></div>` : ''}</div>
    </div>`).join('');
}
function bindCancel() {
  $$('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!await confirmBox(L('Batalkan permohonan ini?', 'Cancel this request?'))) return;
    try {
      await updateDoc(doc(db, 'companies', S.cid, 'requests', b.dataset.cancel), { status: 'cancelled', cancelledAt: serverTimestamp() });
      await loadMeta(); renderShell();
    } catch (e) { toast(authErr(e), 'bad'); }
  });
}

async function submitReq(data) {
  await addDoc(collection(db, 'companies', S.cid, 'requests'), {
    uid: S.user.uid, workerId: S.me.workerId, name: S.worker.name, status: 'pending',
    createdAt: serverTimestamp(), ...data
  });
  toast(L('Permohonan dihantar. Tunggu kelulusan majikan.', 'Request sent. Waiting for approval.'));
  await loadMeta();
  S.tab = 'mohon'; renderShell();
}

function leaveForm() {
  const types = leaveTypes(S.company);
  const t = todayStr();
  let mc = null;
  const m = modal({
    title: L('Mohon Cuti / MC', 'Apply Leave / MC'),
    body: `
      <div class="field"><label class="lbl">${L('Jenis cuti', 'Leave type')}</label>
        <select class="input" id="lt">${types.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Dari', 'From')}</label><input class="input" type="date" id="lf" value="${t}"></div>
        <div class="field"><label class="lbl">${L('Hingga', 'To')}</label><input class="input" type="date" id="lto" value="${t}"></div>
      </div>
      <div class="field" id="halfF"><label class="lbl">${L('Tempoh', 'Duration')}</label>
        <select class="input" id="lh"><option value="">${L('Sehari penuh', 'Full day')}</option><option value="am">${L('Separuh hari (pagi)', 'Half day (AM)')}</option><option value="pm">${L('Separuh hari (petang)', 'Half day (PM)')}</option></select></div>
      <p class="small"><b id="ldays">1</b> ${L('hari bekerja', 'working day(s)')} · <span class="muted" id="lbal"></span></p>
      <div class="field"><label class="lbl">${L('Sebab', 'Reason')}</label><textarea class="input" id="lr" maxlength="500" style="min-height:70px"></textarea></div>
      <div class="field"><label class="lbl">${L('Lampiran (surat MC / dokumen)', 'Attachment (MC slip / document)')}</label>
        <input class="input" type="file" accept="image/*" id="lmc"><div id="lmcPrev" style="margin-top:.4rem"></div></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Hantar', 'Submit'), cls: 'btn-primary', onClick: async ({ el }) => {
          const from = $('#lf', el).value, to = $('#lto', el).value, half = from === to ? $('#lh', el).value : '';
          if (!from || !to || to < from) { toast(L('Tarikh tidak sah.', 'Invalid dates.'), 'warn'); return false; }
          const days = countLeaveDays(S.company, S.worker, from, to, half, S.roster);
          if (!days) { toast(L('Tarikh dipilih bukan hari bekerja.', 'Selected dates are not working days.'), 'warn'); return false; }
          const typeId = $('#lt', el).value, type = types.find(x => x.id === typeId);
          const b = leaveBalances(S.company, S.worker, S.reqs.filter(r => r.status === 'approved')).find(x => x.id === typeId);
          if (b && (b.ent + b.carry) > 0 && b.left < days) {
            if (!await confirmBox(L(`Baki ${type.name} anda hanya ${b.left} hari. Teruskan juga?`, `Your ${type.name} balance is only ${b.left} day(s). Continue anyway?`))) return false;
          }
          try {
            await submitReq({ kind: 'leave', typeId, typeName: type.name, from, to, half, days, reason: $('#lr', el).value.trim(), attachment: mc });
          } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  const el = m.el;
  const upd = () => {
    const from = $('#lf', el).value, to = $('#lto', el).value;
    if (to < from) $('#lto', el).value = from;
    $('#halfF', el).style.display = $('#lf', el).value === $('#lto', el).value ? '' : 'none';
    const half = $('#lf', el).value === $('#lto', el).value ? $('#lh', el).value : '';
    $('#ldays', el).textContent = countLeaveDays(S.company, S.worker, $('#lf', el).value, $('#lto', el).value, half, S.roster);
    const b = leaveBalances(S.company, S.worker, S.reqs.filter(r => r.status === 'approved')).find(x => x.id === $('#lt', el).value);
    $('#lbal', el).textContent = b && (b.ent + b.carry) > 0 ? `${L('Baki', 'Balance')}: ${b.left}` : '';
  };
  ['#lf', '#lto', '#lh', '#lt'].forEach(s => $(s, el).onchange = upd);
  upd();
  $('#lmc', el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) { mc = null; $('#lmcPrev', el).innerHTML = ''; return; }
    try {
      mc = await fileToDataURL(f, 900, 'image/jpeg', 0.6);
      $('#lmcPrev', el).innerHTML = `<img src="${mc}" style="max-width:120px;border-radius:8px">`;
    } catch { toast(L('Gagal membaca imej.', 'Failed to read image.'), 'bad'); }
  };
}

function otForm() {
  const t = todayStr();
  const st = S.company.settings || {};
  const m = modal({
    title: L('Mohon OT', 'Apply Overtime'),
    body: `
      <div class="field"><label class="lbl">${L('Tarikh', 'Date')}</label><input class="input" type="date" id="od" value="${t}"></div>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Mula', 'Start')}</label><input class="input" type="time" id="os" value="${esc(dayInfo(t).shift?.end || st.workEnd || '18:00')}"></div>
        <div class="field"><label class="lbl">${L('Tamat', 'End')}</label><input class="input" type="time" id="oe"></div>
      </div>
      <p class="small"><b id="oh">0</b> ${L('jam', 'hours')} · <span class="muted" id="ok"></span></p>
      <div class="field"><label class="lbl">${L('Sebab / kerja dibuat', 'Reason / work done')}</label><textarea class="input" id="or" maxlength="500" style="min-height:70px"></textarea></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Hantar', 'Submit'), cls: 'btn-primary', onClick: async ({ el }) => {
          const date = $('#od', el).value, start = $('#os', el).value, end = $('#oe', el).value;
          const hours = hoursBetween(start, end);
          if (!date || !start || !end || !hours) { toast(L('Sila isi tarikh dan masa.', 'Please fill in date and time.'), 'warn'); return false; }
          try { await submitReq({ kind: 'ot', date, start, end, hours, otKind: otKind(dayInfo(date)), reason: $('#or', el).value.trim() }); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  const el = m.el;
  const upd = () => {
    $('#oh', el).textContent = hoursBetween($('#os', el).value, $('#oe', el).value);
    $('#ok', el).textContent = OT_LABEL[otKind(dayInfo($('#od', el).value))]();
  };
  ['#od', '#os', '#oe'].forEach(s => $(s, el).oninput = upd);
  upd();
}

function fixForm() {
  const t = todayStr();
  const m = modal({
    title: L('Betulkan Punch', 'Fix Punch'),
    body: `
      <p class="small muted">${L('Untuk punch yang terlupa. Majikan akan semak dan luluskan.', 'For a missed punch. Your employer will review and approve.')}</p>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Tarikh', 'Date')}</label><input class="input" type="date" id="fd" value="${t}" max="${t}"></div>
        <div class="field"><label class="lbl">${L('Masa sebenar', 'Actual time')}</label><input class="input" type="time" id="ft"></div>
      </div>
      <div class="field"><label class="lbl">${L('Jenis punch', 'Punch type')}</label>
        <select class="input" id="fy">${['in', 'out', 'break_in', 'break_out'].map(x => `<option value="${x}">${TYPE_LABEL[x]()}</option>`).join('')}</select></div>
      <div class="field"><label class="lbl">${L('Sebab', 'Reason')}</label><textarea class="input" id="fr" maxlength="500" style="min-height:70px" required></textarea></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Hantar', 'Submit'), cls: 'btn-primary', onClick: async ({ el }) => {
          const date = $('#fd', el).value, time = $('#ft', el).value, reason = $('#fr', el).value.trim();
          if (!date || !time) { toast(L('Sila isi tarikh dan masa.', 'Please fill in date and time.'), 'warn'); return false; }
          if (date > t) { toast(L('Tarikh tidak boleh pada masa depan.', 'Date cannot be in the future.'), 'warn'); return false; }
          if (!reason) { toast(L('Sila nyatakan sebab.', 'Please give a reason.'), 'warn'); return false; }
          try { await submitReq({ kind: 'fix', date, time, type: $('#fy', el).value, reason }); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
}

function claimForm() {
  const t = todayStr();
  let rcpt = null;
  const cats = [L('Minyak', 'Fuel'), L('Tol', 'Toll'), L('Parkir', 'Parking'), L('Makan', 'Meals'), L('Pengangkutan', 'Transport'), L('Lain-lain', 'Others')];
  const m = modal({
    title: L('Tuntutan', 'Claim'),
    body: `
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Tarikh', 'Date')}</label><input class="input" type="date" id="cd" value="${t}" max="${t}"></div>
        <div class="field"><label class="lbl">${L('Jumlah (RM)', 'Amount (RM)')}</label><input class="input" type="number" step="0.01" min="0" id="ca" inputmode="decimal"></div>
      </div>
      <div class="field"><label class="lbl">${L('Kategori', 'Category')}</label>
        <select class="input" id="cc">${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label class="lbl">${L('Keterangan', 'Description')}</label><textarea class="input" id="cr" maxlength="500" style="min-height:60px"></textarea></div>
      <div class="field"><label class="lbl">${L('Gambar resit', 'Receipt photo')}</label>
        <input class="input" type="file" accept="image/*" id="cf"><div id="cfPrev" style="margin-top:.4rem"></div></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Hantar', 'Submit'), cls: 'btn-primary', onClick: async ({ el }) => {
          const amount = Number($('#ca', el).value || 0), date = $('#cd', el).value;
          if (!(amount > 0) || !date) { toast(L('Sila isi tarikh dan jumlah.', 'Please fill in date and amount.'), 'warn'); return false; }
          try { await submitReq({ kind: 'claim', date, amount, category: $('#cc', el).value, reason: $('#cr', el).value.trim(), attachment: rcpt }); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  $('#cf', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) { rcpt = null; $('#cfPrev', m.el).innerHTML = ''; return; }
    try { rcpt = await fileToDataURL(f, 900, 'image/jpeg', 0.6); $('#cfPrev', m.el).innerHTML = `<img src="${rcpt}" style="max-width:120px;border-radius:8px">`; }
    catch { toast(L('Gagal membaca imej.', 'Failed to read image.'), 'bad'); }
  };
}

function advanceForm() {
  modal({
    title: L('Pendahuluan Gaji', 'Salary Advance'),
    body: `
      <p class="small muted">${L('Jumlah yang diluluskan akan dipotong dalam gaji bulan berikutnya.', 'The approved amount will be deducted from your next payroll.')}</p>
      <div class="field"><label class="lbl">${L('Jumlah (RM)', 'Amount (RM)')}</label><input class="input" type="number" step="0.01" min="0" id="aa" inputmode="decimal"></div>
      <div class="field"><label class="lbl">${L('Sebab', 'Reason')}</label><textarea class="input" id="ar" maxlength="500" style="min-height:60px"></textarea></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Hantar', 'Submit'), cls: 'btn-primary', onClick: async ({ el }) => {
          const amount = Number($('#aa', el).value || 0);
          if (!(amount > 0)) { toast(L('Sila isi jumlah.', 'Please enter an amount.'), 'warn'); return false; }
          try { await submitReq({ kind: 'advance', date: todayStr(), amount, reason: $('#ar', el).value.trim() }); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
}

// ---------------------------------------------------------------- BERITA
async function viewBerita() {
  const v = $('#view');
  v.innerHTML = `<div class="card"><h3>${L('Pengumuman', 'Announcements')}</h3><div id="nb"><div class="loader" style="min-height:120px"><span class="spin"></span></div></div></div>`;
  try {
    const s = await getDocs(query(collection(db, 'companies', S.cid, 'announcements'), orderBy('createdAt', 'desc'), limit(30)));
    $('#nb').innerHTML = s.empty ? `<div class="empty">${L('Tiada pengumuman.', 'No announcements.')}</div>` :
      s.docs.map(d => { const a = d.data(); return `
        <div class="day-row" style="align-items:flex-start">
          <div class="day-box" style="padding:.5rem 0">${icon('bell', 20)}</div>
          <div class="grow"><div class="bold">${esc(a.title)}</div>
          <div class="small" style="white-space:pre-wrap">${esc(a.body)}</div>
          <div class="xs muted" style="margin-top:.3rem">${fmtDate(a.createdAt)}</div></div>
        </div>`; }).join('');
  } catch (e) { $('#nb').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ---------------------------------------------------------------- PROFIL
function viewProfil() {
  const w = S.worker, loc = myLocation();
  const row = (k, val) => val ? `<div class="set-row"><span class="muted small">${k}</span><b class="right">${esc(val)}</b></div>` : '';
  const ph = String(S.company.phone || '').replace(/\D/g, '').replace(/^0/, '60');
  $('#view').innerHTML = `
  <div class="card center">
    <span class="logo-lg logo-ini" style="margin:0 auto .5rem">${esc((w.name || '?').split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase())}</span>
    <h3>${esc(w.name)}</h3>
    <span class="badge b-brand mono">${esc(S.me.workerId)}</span>
  </div>
  <div class="card">
    ${row(L('Jawatan', 'Position'), w.position)}
    ${row(L('Jabatan', 'Department'), w.dept)}
    ${row(L('Lokasi kerja', 'Work location'), loc?.name)}
    ${row(L('Syif biasa', 'Usual shift'), shiftLabel(dayInfo(todayStr()).shift))}
    ${row(L('Tarikh mula', 'Start date'), w.startDate ? fmtDate(w.startDate) : '')}
    ${row(L('Telefon', 'Phone'), w.phone)}
    ${row(L('Syarikat', 'Company'), S.company.name)}
  </div>
  <div class="card"><h3>${L('Slip Gaji', 'Payslips')}</h3><div id="slips"><div class="loader" style="min-height:60px"><span class="spin"></span></div></div></div>
  <div class="card stack">
    ${ph ? `<a class="btn btn-ok btn-block" target="_blank" rel="noopener" href="https://wa.me/${ph}?text=${encodeURIComponent(`Salam, saya ${w.name} (${S.me.workerId}).`)}">${icon('chat', 18)} ${L('WhatsApp Majikan', 'WhatsApp Employer')}</a>` : ''}
    <button class="btn btn-ghost btn-block" id="chPin">${icon('shield', 18)} ${L('Tukar PIN', 'Change PIN')}</button>
    <button class="btn btn-ghost btn-block" id="langB">${L('Bahasa: Bahasa Melayu', 'Language: English')}</button>
    <button class="btn btn-danger btn-block" id="lo">${icon('out', 18)} ${L('Log Keluar', 'Log Out')}</button>
  </div>
  <p class="center xs muted" style="margin-top:1rem">ProAttendance</p>`;
  $('#chPin').onclick = () => pinModal(false);
  $('#langB').onclick = () => $('[data-lang-toggle]')?.click();
  $('#lo').onclick = () => signOut(auth);
  loadSlips();
}

async function loadSlips() {
  try {
    const s = await getDocs(query(collection(db, 'companies', S.cid, 'payslips'), where('uid', '==', S.user.uid)));
    const list = s.docs.map(d => d.data()).sort((a, b) => b.period.localeCompare(a.period));
    const box = $('#slips'); if (!box) return;
    box.innerHTML = list.length ? list.map((x, i) => `<div class="set-row"><div><b>${esc(periodLabel(x.period))}</b><div class="small muted">${L('Bersih', 'Net')}: ${money(x.net)}</div></div>
      <button class="btn btn-sm btn-soft" data-slip="${i}">${icon('doc', 16)} ${L('Lihat', 'View')}</button></div>`).join('')
      : `<div class="empty small">${L('Belum ada slip gaji.', 'No payslips yet.')}</div>`;
    $$('[data-slip]', box).forEach(b => b.onclick = () => {
      const x = list[Number(b.dataset.slip)];
      if (!openPrint(payslipHtml(S.company, x, x.period), false)) toast(L('Benarkan pop-up untuk lihat slip.', 'Allow pop-ups to view the slip.'), 'warn');
    });
  } catch (e) { const box = $('#slips'); if (box) box.innerHTML = `<div class="empty small">${esc(authErr(e))}</div>`; }
}
