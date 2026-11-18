// ProAttendance — Halaman Pekerja
import { auth, db, workerEmail } from './fb.js';
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, getDocs, updateDoc, addDoc, collection, query, where, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  $, $$, L, esc, toast, modal, busy, applyLang, langBtn, todayStr, fmtTime, fmtDate, toDate, minsToHM, dayName,
  summarizeDay, TYPE_LABEL, METHOD_LABEL, haversine, getPosition, getDeviceId, takeSelfie, scanQR, verifyQr,
  applyBrand, logoHtml, isExpired, authErr, icon
} from './ui.js';

const app = $('#app');
const S = { user: null, me: null, cid: null, company: null, worker: null, locations: [], today: [], tab: 'home', clockT: 0 };

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

  const wid = $('#wid');
  let tmr = 0;
  const lookup = async () => {
    const v = wid.value.trim().toUpperCase();
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
  wid.addEventListener('input', () => { wid.value = wid.value.toUpperCase().replace(/\s/g, ''); clearTimeout(tmr); tmr = setTimeout(lookup, 400); });
  if (wid.value) lookup();

  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = wid.value.trim().toUpperCase(), pin = $('#pin').value.trim();
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
    S.worker = wS.data();
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

    await loadToday();
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

function forcePinChange() {
  modal({
    title: L('Tukar PIN Anda', 'Change Your PIN'),
    closable: false,
    body: `<p class="small muted">${L('Untuk keselamatan, sila tetapkan PIN baharu 6 digit.', 'For security, please set a new 6-digit PIN.')}</p>
      <div class="field"><label class="lbl">${L('PIN baharu', 'New PIN')}</label><input class="input pin-input" id="np1" type="password" inputmode="numeric" maxlength="6"></div>
      <div class="field"><label class="lbl">${L('Sahkan PIN', 'Confirm PIN')}</label><input class="input pin-input" id="np2" type="password" inputmode="numeric" maxlength="6"></div>`,
    actions: [{
      label: L('Simpan PIN', 'Save PIN'), cls: 'btn-primary', onClick: async ({ el }) => {
        const a = $('#np1', el).value.trim(), b = $('#np2', el).value.trim();
        if (!/^\d{6}$/.test(a)) { toast(L('PIN mesti 6 digit.', 'PIN must be 6 digits.'), 'warn'); return false; }
        if (a !== b) { toast(L('PIN tidak sepadan.', 'PINs do not match.'), 'warn'); return false; }
        try {
          await updatePassword(auth.currentUser, a);
          await updateDoc(doc(db, 'companies', S.cid, 'workers', S.me.workerId), { mustChangePin: false });
          S.worker.mustChangePin = false;
          toast(L('PIN berjaya ditukar.', 'PIN changed.'));
        } catch (e) { toast(authErr(e), 'bad'); return false; }
      }
    }]
  });
}

// ---------------------------------------------------------------- DATA
async function loadToday() {
  const t = todayStr();
  const q = query(collection(db, 'companies', S.cid, 'attendance'),
    where('uid', '==', S.user.uid), where('date', '>=', t), where('date', '<=', t));
  const s = await getDocs(q);
  S.today = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
    .sort((a, b) => (toDate(a.ts)?.getTime() || 0) - (toDate(b.ts)?.getTime() || 0));
}

// ---------------------------------------------------------------- SHELL
function renderShell() {
  const w = S.worker;
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
  ({ home: viewHome, rekod: viewRekod, berita: viewBerita, profil: viewProfil })[tab]();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- PUNCH
function nextActions() {
  const sum = summarizeDay(S.today, S.company.settings, todayStr());
  const lt = sum.lastType;
  if (!lt || lt === 'out') return { main: 'in', alt: [] , sum };
  if (lt === 'break_in') return { main: 'break_out', alt: [], sum };
  return { main: 'out', alt: ['break_in'], sum };
}

function myLocation() {
  if (S.worker.branchId) return S.locations.find(l => l.id === S.worker.branchId) || null;
  return null;
}

function viewHome() {
  const v = $('#view');
  const { main, alt, sum } = nextActions();
  const loc = myLocation();
  const cls = { in: 'in', out: 'out', break_in: 'brk', break_out: 'brk' }[main];
  const ico = { in: 'clock', out: 'out', break_in: 'clock', break_out: 'clock' }[main];
  const st = S.company.settings || {};
  v.innerHTML = `
  <div class="card clock-card">
    <div class="big-time" id="bigTime">--:--</div>
    <div class="muted" id="bigDate"></div>
    <button class="punch-btn ${cls}" id="mainBtn">${icon(ico, 34)}<span>${TYPE_LABEL[main]()}</span></button>
    ${alt.map(a => `<button class="btn btn-ghost" data-alt="${a}">${TYPE_LABEL[a]()}</button>`).join('')}
    <p class="small muted" style="margin-top:.8rem">
      ${icon('pin', 15)} ${loc ? esc(loc.name) + ' · ' + METHOD_LABEL[loc.mode || 'button']() : (S.locations.length ? L('Pilih lokasi semasa punch', 'Choose location when punching') : L('Tiada lokasi ditetapkan', 'No location set'))}
      ${st.workStart ? ` · ${L('Waktu kerja', 'Work hours')} ${esc(st.workStart)}–${esc(st.workEnd || '')}` : ''}
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
  </div>`;
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
    // 1) Lokasi GPS (cuba sentiasa; wajib untuk mod GPS)
    let pos = null;
    const posP = getPosition(12000).then(p => (pos = p)).catch(() => null);

    // 2) Tentukan lokasi kerja
    let loc = myLocation();
    if (!loc && S.locations.length === 1) loc = S.locations[0];
    if (!loc && S.locations.length > 1) {
      await Promise.race([posP, new Promise(r => setTimeout(r, 2500))]);
      loc = await pickLocation(pos);
      if (loc === undefined) return;
    }
    const mode = loc?.mode || 'button';
    let dist = null;

    // 3) Semakan ikut mod
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

    // 4) Selfie
    let selfie = null;
    if (S.company.settings?.selfie !== false) {
      const now = new Date();
      selfie = await takeSelfie(`${S.worker.name} (${S.me.workerId})\n${TYPE_LABEL[type]()} · ${fmtDate(now)} ${now.toLocaleTimeString('en-GB')}`);
      if (!selfie) return;
    }

    // 5) Simpan
    const rec = {
      uid: S.user.uid, workerId: S.me.workerId, name: S.worker.name, type,
      ts: serverTimestamp(), date: todayStr(),
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
    const q = query(collection(db, 'companies', S.cid, 'attendance'),
      where('uid', '==', S.user.uid), where('date', '>=', ym + '-01'), where('date', '<=', ym + '-31'));
    const s = await getDocs(q);
    const recs = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
    const byDate = {};
    recs.forEach(r => (byDate[r.date] = byDate[r.date] || []).push(r));
    const dates = Object.keys(byDate).sort().reverse();
    const sums = dates.map(dt => ({ dt, s: summarizeDay(byDate[dt], S.company.settings, dt) }));
    const totalMin = sums.reduce((a, x) => a + x.s.workMin, 0);
    const lateDays = sums.filter(x => x.s.lateMin > 0).length;
    $('#rekBody').innerHTML = `
      <div class="stats">
        <div class="stat ok"><div class="n">${dates.length}</div><div class="t">${L('Hari hadir', 'Days present')}</div></div>
        <div class="stat warn"><div class="n">${lateDays}</div><div class="t">${L('Hari lewat', 'Late days')}</div></div>
        <div class="stat info"><div class="n" style="font-size:1.2rem">${minsToHM(totalMin)}</div><div class="t">${L('Jumlah jam', 'Total hours')}</div></div>
      </div>
      ${sums.length ? sums.map(({ dt, s }) => {
        const d = new Date(dt + 'T00:00:00');
        return `<div class="day-row">
          <div class="day-box"><div class="d">${d.getDate()}</div><div class="w">${dayName(d.getDay())}</div></div>
          <div class="grow">
            <div class="bold">${fmtTime(s.firstIn)} → ${s.open ? L('masih bekerja', 'still working') : fmtTime(s.lastOut)}</div>
            <div class="small muted">${minsToHM(s.workMin)}${s.breakMin >= 1 ? ' · ' + L('rehat', 'break') + ' ' + Math.round(s.breakMin) + 'm' : ''}${s.locName ? ' · ' + esc(s.locName) : ''}</div>
          </div>
          ${s.lateMin ? `<span class="badge b-warn">${L('Lewat', 'Late')} ${s.lateMin}m</span>` : `<span class="badge b-ok">${L('Tepat', 'On time')}</span>`}
        </div>`;
      }).join('') : `<div class="empty">${L('Tiada rekod untuk bulan ini.', 'No records this month.')}</div>`}`;
  } catch (e) {
    console.error(e);
    $('#rekBody').innerHTML = `<div class="empty">${L('Gagal memuatkan rekod.', 'Failed to load records.')}<br><span class="xs">${esc(e.message)}</span></div>`;
  }
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
    ${row(L('Tarikh mula', 'Start date'), w.startDate ? fmtDate(w.startDate) : '')}
    ${row(L('Telefon', 'Phone'), w.phone)}
    ${row(L('Syarikat', 'Company'), S.company.name)}
  </div>
  <div class="card stack">
    <button class="btn btn-ghost btn-block" id="chPin">${icon('shield', 18)} ${L('Tukar PIN', 'Change PIN')}</button>
    <button class="btn btn-ghost btn-block" data-lang-toggle-btn>${L('Bahasa: Bahasa Melayu', 'Language: English')}</button>
    <button class="btn btn-danger btn-block" id="lo">${icon('out', 18)} ${L('Log Keluar', 'Log Out')}</button>
  </div>
  <p class="center xs muted" style="margin-top:1rem">ProAttendance</p>`;
  $('#chPin').onclick = forcePinChangeOptional;
  $('[data-lang-toggle-btn]').onclick = () => $('[data-lang-toggle]')?.click();
  $('#lo').onclick = () => signOut(auth);
}

function forcePinChangeOptional() {
  modal({
    title: L('Tukar PIN', 'Change PIN'),
    body: `<div class="field"><label class="lbl">${L('PIN baharu', 'New PIN')}</label><input class="input pin-input" id="np1" type="password" inputmode="numeric" maxlength="6"></div>
      <div class="field"><label class="lbl">${L('Sahkan PIN', 'Confirm PIN')}</label><input class="input pin-input" id="np2" type="password" inputmode="numeric" maxlength="6"></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
          const a = $('#np1', el).value.trim(), b = $('#np2', el).value.trim();
          if (!/^\d{6}$/.test(a)) { toast(L('PIN mesti 6 digit.', 'PIN must be 6 digits.'), 'warn'); return false; }
          if (a !== b) { toast(L('PIN tidak sepadan.', 'PINs do not match.'), 'warn'); return false; }
          try { await updatePassword(auth.currentUser, a); toast(L('PIN berjaya ditukar.', 'PIN changed.')); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
}
