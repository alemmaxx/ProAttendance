// ProAttendance — Halaman Pekerja
import { auth, db, workerEmail } from './fb.js';
import { APP_VERSION } from './config.js';
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, getDocs, updateDoc, addDoc, setDoc, deleteDoc, collection, query, where, orderBy, limit, serverTimestamp, writeBatch
} from './fs.js';
import {
  $, $$, L, esc, toast, modal, confirmBox, busy, applyLang, langBtn, keepInputs, todayStr, addDays, fmtTime, fmtDate, toDate, minsToHM, dayName,
  summarizeDay, TYPE_LABEL, METHOD_LABEL, haversine, getPosition, getDeviceId, takeSelfie, scanQR, verifyQr,
  applyBrand, logoHtml, isExpired, authErr, icon, fileToDataURL, punchTime
} from './ui.js';
import {
  leaveTypes, leaveTypeName, resolveDay, lateSettings, shiftLabel, loadRoster, countLeaveDays, leaveBalances,
  leaveDateMap, holidayMap, otKind, OT_LABEL, REQ_LABEL, STATUS_BADGE, hoursBetween, submitAutoOT, weekStart
} from './sched.js';
import { payslipHtml, openPrint, periodLabel } from './payroll.js';
import { claimTimeline, computeClaim, claimRates, SST_CATS, journeyTotal, purchaseTotal, allowanceTotal, claimDocHtml, statusBadge, emptyClaim } from './claims.js';
import { pushAvailable, enablePush, refreshPush } from './push.js';
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
    refreshPush(S.cid, S.user.uid, { role: 'worker', workerId: S.me.workerId });
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
const sortTs = (a, b) => (punchTime(a)?.getTime() || 0) - (punchTime(b)?.getTime() || 0);

// Sesi kerja semasa: hari ini, atau semalam jika syif semalam masih terbuka (syif malam)
async function loadToday() {
  const t = todayStr(), y = addDays(t, -1);
  const q = query(collection(db, 'companies', S.cid, 'attendance'),
    where('uid', '==', S.user.uid), where('date', '>=', y), where('date', '<=', t));
  const s = await getDocs(q);
  const all = s.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })).sort(sortTs);
  S.visits = all.filter(r => r.type === 'visit' && r.date === t);
  const recs = all.filter(r => r.type !== 'visit');
  const tRecs = recs.filter(r => r.date === t), yRecs = recs.filter(r => r.date === y);
  const yLast = yRecs[yRecs.length - 1];
  const yOpen = yLast && yLast.type !== 'out' && (Date.now() - (toDate(yRecs.find(r => r.type === 'in')?.ts)?.getTime() || 0)) < 16 * 3600000;
  if (!tRecs.length && yOpen) { S.sessionDate = y; S.today = yRecs; }
  else { S.sessionDate = t; S.today = tRecs; }
}

async function loadMeta() {
  const t = todayStr();
  const [ro, rq, pl] = await Promise.all([
    loadRoster(db, S.cid, addDays(t, -1), addDays(t, 60)).catch(() => ({})),
    getDocs(query(collection(db, 'companies', S.cid, 'requests'), where('uid', '==', S.user.uid))).catch(() => null),
    getDocs(query(collection(db, 'companies', S.cid, 'plans'), where('uid', '==', S.user.uid))).catch(() => null),
    getDocs(query(collection(db, 'companies', S.cid, 'claims'), where('uid', '==', S.user.uid))).catch(() => null)
  ]).then(r => { S.claims = {}; (r[3] ? r[3].docs : []).forEach(d => { const x = d.data(); S.claims[x.month] = x; }); return r; });
  S.roster = ro;
  S.plans = {}; (pl ? pl.docs : []).forEach(d => { const x = d.data(); S.plans[x.date] = x.note; });
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
document.addEventListener('langchange', () => { if (S.worker && $('#view')) renderShell(); else if ($('.login-wrap')) keepInputs(renderLogin); });

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
  return { main: 'out', alt: S.company.settings?.autoBreak ? [] : ['break_in'], sum };
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
  <div class="card" id="weekStrip" style="margin-bottom:12px"></div>
  <div class="card clock-card">
    <div class="big-time" id="bigTime">--:--</div>
    <div class="muted" id="bigDate"></div>
    <div style="margin-top:.5rem">${todayStatusHtml()}</div>
    ${S.sessionDate !== todayStr() ? `<p class="small" style="color:var(--warn);margin-top:.4rem">${L('Syif semalam masih terbuka', "Yesterday's shift is still open")} (${fmtDate(S.sessionDate)})</p>` : ''}
    <button class="punch-btn ${cls}" id="mainBtn">${icon(ico, 34)}<span>${TYPE_LABEL[main]()}</span></button>
    ${alt.map(a => `<button class="btn btn-ghost" data-alt="${a}">${TYPE_LABEL[a]()}</button>`).join('')}
    ${S.company.settings?.visits ? `<button class="btn btn-ghost hide" id="visitBtn">${icon('pin', 16)} ${L('Update Kerja', 'Work Update')}${S.visits?.length ? ` (${S.visits.length})` : ''}</button>` : ''}
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
      <li><span class="dot d-${r.type}"></span><b>${fmtTime(punchTime(r))}</b><span class="grow">${TYPE_LABEL[r.type]?.() || r.type}${r.offline ? ' <span class="badge b-warn">offline</span>' : ''}</span>
      <span class="badge">${esc(r.locName || METHOD_LABEL[r.method || 'button']?.() || '')}</span></li>`).join('')}</ul>`
      : `<div class="empty small">${L('Belum ada rekod hari ini.', 'No records yet today.')}</div>`}
  </div>
  ${leaveChipsHtml()}
  <div id="taskCard"></div>
  ${upcomingHtml()}`;
  const tick = () => {
    const d = new Date();
    const bt = $('#bigTime'); if (!bt) return;
    bt.textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#bigDate').textContent = d.toLocaleDateString(L('ms-MY', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  tick(); S.clockT = setInterval(tick, 1000);
  $('#mainBtn').onclick = (e) => punch(main, e.currentTarget);
  if ($('#visitBtn')) { $('#visitBtn').onclick = visitForm; checkOutsideOffice(); }
  $$('[data-plan]').forEach(r => r.onclick = () => planNote(r.dataset.plan));
  drawWeekStrip();
  $('#lvCard') && ($('#lvCard').onclick = () => go('mohon'));
  $$('[data-alt]').forEach(b => b.onclick = (e) => punch(b.dataset.alt, e.currentTarget));
}

// Baki cuti ringkas di skrin utama
function leaveChipsHtml() {
  const bal = leaveBalances(S.company, S.worker, S.reqs.filter(r => r.status === 'approved')).filter(b => b.ent + b.carry > 0);
  if (!bal.length) return '';
  return `<div class="card" id="lvCard" style="cursor:pointer"><div class="card-head" style="margin-bottom:.5rem"><h3>${L('Baki cuti', 'Leave balance')} ${new Date().getFullYear()}</h3><span class="xs muted">${L('Mohon cuti', 'Apply')} ›</span></div>
    <div class="row">${bal.map(b => `<span class="badge ${b.left <= 0 ? 'b-bad' : 'b-ok'}" style="font-size:13px;padding:5px 11px">${esc(b.name)}: <b>${b.left}</b> / ${b.ent + b.carry}</span>`).join('')}</div></div>`;
}

// Masa masuk/keluar & status dalam kotak kalendar
function calTimes(sm) {
  if (!sm?.firstIn) return '';
  return `<span class="cal-t">${fmtTime(sm.firstIn)}<br>${sm.lastOut && !sm.open ? fmtTime(sm.lastOut) : '…'}</span>`;
}
function calStatus(cls, sm, d, t) {
  return ({ 'cal-ok': L('Hadir', 'Present'), 'cal-late': L('Lewat', 'Late'), 'cal-leave': L('Cuti', 'Leave'), 'cal-hol': L('Cuti U.', 'Holiday'),
    'cal-off': L('Rehat', 'Off'), 'cal-abs': L('Tak hadir', 'Absent') })[cls] || (d === t ? L('Hari ini', 'Today') : '');
}

// Jalur kalendar minggu (skrin utama)
async function drawWeekStrip() {
  const box = $('#weekStrip'); if (!box) return;
  S.wk = S.wk || weekStart(todayStr());
  const from = S.wk, to = addDays(from, 6), t = todayStr();
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const lbl = `${fmtDate(from, { day: 'numeric', month: 'short' })} – ${fmtDate(to, { day: 'numeric', month: 'short' })}`;
  const paint = (byDate) => {
    const lv = leaveDateMap(S.reqs), hol = holidayMap(S.company);
    box.innerHTML = `<div class="row between" style="margin-bottom:.6rem">
        <button class="icon-btn" id="wkP">${icon('left', 18)}</button><b>${lbl}</b><button class="icon-btn" id="wkN">${icon('right', 18)}</button></div>
      <div class="cal" style="margin:0">${days.map(d => {
        const dt = new Date(d + 'T00:00:00'), inf = dayInfo(d), recs = byDate?.[d] || [];
        const pun = recs.filter(r => r.type !== 'visit');
        const sm = pun.length ? summarizeDay(pun, lateSettings(S.company, inf), d) : null;
        let cls = 'cal-f';
        if (sm?.firstIn) cls = sm.lateMin ? 'cal-late' : 'cal-ok';
        else if (lv[d]) cls = 'cal-leave';
        else if (hol[d] || inf.type === 'holiday') cls = 'cal-hol';
        else if (inf.type === 'off') cls = 'cal-off';
        else if (d < t && byDate) cls = 'cal-abs';
        const mark = S.plans?.[d] || recs.some(r => r.type === 'visit');
        return `<button class="cal-d ${cls} ${d === t ? 'cal-today' : ''}" data-wd="${d}" style="aspect-ratio:auto;padding:6px 0;line-height:1.1;align-content:start">
          <span style="font-size:10px;font-weight:600;opacity:.8">${dayName(dt.getDay())}</span><br>${dt.getDate()}${mark ? '<i></i>' : ''}
          ${calTimes(sm)}<span class="cal-s">${calStatus(cls, sm, d, t)}</span></button>`;
      }).join('')}</div>
      <p class="xs muted center" style="margin:.5rem 0 0">${L('Tekan tarikh untuk butiran, catatan & tuntutan', 'Tap a date for details, notes & claims')}</p>`;
    $('#wkP').onclick = () => { S.wk = addDays(S.wk, -7); drawWeekStrip(); };
    $('#wkN').onclick = () => { S.wk = addDays(S.wk, 7); drawWeekStrip(); };
    $$('[data-wd]', box).forEach(b => b.onclick = () => openDay(b.dataset.wd, byDate ? (byDate[b.dataset.wd] || []) : undefined));
  };
  paint(null);
  try {
    const q = await getDocs(query(collection(db, 'companies', S.cid, 'attendance'), where('uid', '==', S.user.uid), where('date', '>=', from), where('date', '<=', to)));
    const byDate = {};
    q.docs.forEach(x => { const r = { id: x.id, ...x.data({ serverTimestamps: 'estimate' }) }; (byDate[r.date] = byDate[r.date] || []).push(r); });
    if ($('#weekStrip') === box && S.wk === from) paint(byDate);
  } catch { /* abaikan */ }
}

// Jadual 7 hari akan datang
function upcomingHtml() {
  const t = todayStr();
  const lv = leaveDateMap(S.reqs);
  const rows = [];
  for (let i = 0; i <= 7; i++) {
    const d = addDays(t, i), info = dayInfo(d), dt = new Date(d + 'T00:00:00');
    const lbl = lv[d] ? `<span class="badge b-info">${L('Cuti', 'Leave')}</span>`
      : info.type === 'off' ? `<span class="badge">${L('Rehat', 'Rest')}</span>`
      : info.type === 'holiday' && !info.shift ? `<span class="badge b-info">${esc(info.holiday)}</span>`
      : `<span class="badge b-brand">${esc(shiftLabel(info.shift))}</span>`;
    rows.push(`<div class="set-row" data-plan="${d}" style="cursor:pointer"><div><b>${i === 0 ? L('Hari ini', 'Today') : dayName(dt.getDay())}</b>, ${fmtDate(d, { day: 'numeric', month: 'short' })}
      <div class="xs" style="color:${S.plans?.[d] ? 'var(--gold)' : 'var(--muted)'}">${S.plans?.[d] ? '📍 ' + esc(S.plans[d]) : '+ ' + L('Ke mana hari ini?', 'Where to?')}</div></div>${lbl}</div>`);
  }
  return `<div class="card"><h3>${L('Jadual & catatan', 'Schedule & notes')}</h3>${rows.join('')}</div>`;
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
      selfie: null, hasSelfie: !!selfie, deviceId: getDeviceId(), dept: S.worker.dept || ''
    };
    const before = [...S.today];
    await savePunch(rec, selfie);
    if (navigator.vibrate) navigator.vibrate(120);
    toast(`${TYPE_LABEL[type]()} ✓ ${fmtTime(new Date())}${rec.offline ? ' · ' + L('disimpan, akan dihantar bila ada internet', 'saved, will sync when online') : ''}`, rec.offline ? 'warn' : 'ok', rec.offline ? 6000 : 3200);
    if (rec.offline) { S.today.push({ ...rec, id: 'local' + Date.now() }); S.today.sort(sortTs); }
    else await loadToday();
    // OT automatik selepas punch keluar
    if (type === 'out') {
      try {
        const h = await submitAutoOT(db, S.cid, S.company, S.worker, S.user.uid, rec.date,
          [...before.filter(r => r.date === rec.date), { ...rec, ts: new Date() }], S.roster[rec.date]?.[wid()], S.reqs);
        if (h) { toast(L(`OT ${h} jam dihantar untuk kelulusan majikan.`, `OT of ${h} hrs sent for employer approval.`), 'ok', 5000); await loadMeta(); }
      } catch (e) { console.warn('autoOT', e); }
    }
    if (S.tab === 'home') viewHome();
  } catch (e) {
    console.error(e);
    toast(e.code === 'permission-denied'
      ? L('Punch ditolak. Akaun atau langganan syarikat mungkin tidak aktif.', 'Punch rejected. Account or company subscription may be inactive.')
      : authErr(e), 'bad', 5000);
  } finally { busy(btn, false); }
}

// Simpan punch (kehadiran + selfie). Jika tiada internet, simpan dalam peranti dan hantar kemudian.
async function savePunch(rec, selfie) {
  rec.clientTs = Date.now();
  rec.offline = !navigator.onLine;
  const ref = doc(collection(db, 'companies', S.cid, 'attendance'));
  const b = writeBatch(db);
  b.set(ref, rec);
  if (selfie) b.set(doc(db, 'companies', S.cid, 'selfies', ref.id), { uid: S.user.uid, workerId: S.me.workerId, selfie, at: serverTimestamp() });
  const p = b.commit();
  if (rec.offline) { p.catch(() => {}); return ref.id; }
  // Jika talian perlahan, jangan tunggu terlalu lama
  const r = await Promise.race([p.then(() => 'ok'), new Promise(res => setTimeout(() => res('slow'), 12000))]);
  if (r === 'slow') { rec.offline = true; }
  return ref.id;
}

// ---------------------------------------------------------------- UPDATE KERJA (di luar kawasan pejabat)
// Butang hanya muncul bila pekerja berada di luar kawasan pejabat (geofence lokasi syarikat).
async function checkOutsideOffice() {
  const b = $('#visitBtn'); if (!b) return;
  const locs = (S.locations || []).filter(l => l.lat != null && l.lng != null);
  if (!locs.length) { b.classList.remove('hide'); return; }
  let pos = null; try { pos = await getPosition(10000); } catch {}
  if (!pos) { b.classList.remove('hide'); return; }          // tiada GPS: benarkan update
  const inside = locs.some(l => haversine(pos.lat, pos.lng, l.lat, l.lng) <= Number(l.radius || 100) + Math.min(Number(pos.acc || 0), 100));
  if (!$('#visitBtn')) return;
  $('#visitBtn').classList.toggle('hide', inside);
}

function visitForm() {
  let photo = null;
  const m = modal({
    title: L('Update Kerja', 'Work Update'),
    body: `<p class="small muted">${L('Anda di luar kawasan pejabat. Rekod lokasi & kerja semasa — dikemas kini terus ke Jadual & Catatan hari ini. Tidak menjejaskan jam kerja.', 'You are outside the office area. Record your current location & work — updates today\'s Schedule & Notes directly. Does not affect work hours.')}</p>
      <div class="field"><label class="lbl">${L('Lokasi / tapak / pelanggan', 'Location / site / client')}</label><input class="input" id="vn" maxlength="100" list="projList"></div>
      <datalist id="projList">${(S.company.projects || []).map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="field"><label class="lbl">${L('Kerja yang dibuat', 'Work done')}</label><textarea class="input" id="vt" maxlength="500" style="min-height:60px"></textarea></div>
      <div class="field"><label class="lbl">${L('Gambar (pilihan)', 'Photo (optional)')}</label><input class="input" type="file" accept="image/*" capture="environment" id="vp"><div id="vpPrev"></div></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Rekod', 'Record'), cls: 'btn-primary', onClick: async ({ el }) => {
          const name = $('#vn', el).value.trim();
          if (!name) { toast(L('Sila isi nama tapak.', 'Please enter the site name.'), 'warn'); return false; }
          let pos = null; try { pos = await getPosition(12000); } catch {}
          const rec = {
            uid: S.user.uid, workerId: S.me.workerId, name: S.worker.name, type: 'visit', ts: serverTimestamp(), date: todayStr(),
            lid: null, locName: name, method: 'gps', note: $('#vt', el).value.trim(),
            lat: pos?.lat ?? null, lng: pos?.lng ?? null, acc: pos?.acc ?? null, dist: null,
            selfie: null, hasSelfie: !!photo, deviceId: getDeviceId(), dept: S.worker.dept || ''
          };
          try {
            await savePunch(rec, photo);
            // Kemas kini Jadual & Catatan hari ini
            const d = todayStr(), hm = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            const line = `${hm} ${name}${rec.note ? ' — ' + rec.note : ''}`;
            const note = (S.plans?.[d] ? S.plans[d] + '\n' : '') + line;
            await setDoc(doc(db, 'companies', S.cid, 'plans', `${S.me.workerId}_${d}`), { uid: S.user.uid, workerId: S.me.workerId, name: S.worker.name, date: d, note: note.slice(0, 1500), at: serverTimestamp() });
            S.plans = S.plans || {}; S.plans[d] = note;
            toast(L('Update kerja direkod.', 'Work update recorded.')); await loadToday(); viewHome();
          }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  $('#vp', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { photo = await fileToDataURL(f, 800, 'image/jpeg', 0.6); $('#vpPrev', m.el).innerHTML = `<img src="${photo}" style="max-width:120px;border-radius:8px;margin-top:.4rem">`; } catch {}
  };
}

// ---------------------------------------------------------------- TUGASAN
async function loadTasks() {
  const box = $('#taskCard'); if (!box) return;
  try {
    const s = await getDocs(query(collection(db, 'companies', S.cid, 'tasks'), where('uid', '==', S.user.uid)));
    const t = todayStr();
    const list = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(x => (x.date || t) <= t && (x.status !== 'done' || x.date === t))
      .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.date || '').localeCompare(b.date || ''));
    if (!list.length || !$('#taskCard')) return;
    $('#taskCard').innerHTML = `<div class="card"><h3>${L('Tugasan', 'Tasks')}</h3>${list.map(x => `
      <div class="set-row"><div><b style="${x.status === 'done' ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(x.title)}</b>
        ${x.note ? `<div class="small muted">${esc(x.note)}</div>` : ''}<div class="xs muted">${fmtDate(x.date)}</div></div>
        ${x.status === 'done' ? `<span class="badge b-ok">${L('Siap', 'Done')}</span>` : `<button class="btn btn-sm btn-ok" data-task="${x.id}">${icon('check', 16)} ${L('Siap', 'Done')}</button>`}
      </div>`).join('')}</div>`;
    $$('[data-task]').forEach(b => b.onclick = () => taskDone(list.find(x => x.id === b.dataset.task)));
  } catch { /* abaikan */ }
}
function taskDone(task) {
  let photo = null;
  const m = modal({
    title: esc(task.title),
    body: `<div class="field"><label class="lbl">${L('Catatan (pilihan)', 'Note (optional)')}</label><textarea class="input" id="tn" maxlength="300" style="min-height:60px"></textarea></div>
      <div class="field"><label class="lbl">${L('Gambar kerja (pilihan)', 'Work photo (optional)')}</label><input class="input" type="file" accept="image/*" capture="environment" id="tp"><div id="tpPrev"></div></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Tanda Siap', 'Mark Done'), cls: 'btn-ok', onClick: async ({ el }) => {
          try {
            await updateDoc(doc(db, 'companies', S.cid, 'tasks', task.id), { status: 'done', doneAt: serverTimestamp(), workerNote: $('#tn', el).value.trim(), photo });
            toast(L('Tugasan siap.', 'Task done.')); loadTasks();
          } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  $('#tp', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { photo = await fileToDataURL(f, 800, 'image/jpeg', 0.6); $('#tpPrev', m.el).innerHTML = `<img src="${photo}" style="max-width:120px;border-radius:8px;margin-top:.4rem">`; } catch {}
  };
}

// Catatan "pergi mana" untuk satu tarikh (pilihan)
function planNote(date, after) {
  const cur = S.plans?.[date] || '';
  modal({
    title: `📍 ${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}`,
    body: `<p class="small muted">${L('Catat ke mana anda pergi / bekerja pada hari ini (pilihan). Majikan boleh lihat.', 'Note where you will go / work on this day (optional). Your employer can see it.')}</p>
      <div class="field"><input class="input" id="pn" maxlength="120" value="${esc(cur)}" placeholder="${L('cth: Tapak projek Cyberjaya', 'e.g. Cyberjaya project site')}"></div>`,
    actions: [
      ...(cur ? [{ label: L('Padam', 'Delete'), cls: 'btn-danger', onClick: async () => {
        try { await deleteDoc(doc(db, 'companies', S.cid, 'plans', `${S.me.workerId}_${date}`)); delete S.plans[date]; (after || refreshPlanViews)(); }
        catch (e) { toast(authErr(e), 'bad'); return false; } } }] : []),
      { label: L('Batal', 'Cancel') },
      { label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
        const note = $('#pn', el).value.trim();
        if (!note) { toast(L('Sila isi catatan.', 'Please enter a note.'), 'warn'); return false; }
        try {
          await setDoc(doc(db, 'companies', S.cid, 'plans', `${S.me.workerId}_${date}`), { uid: S.user.uid, workerId: S.me.workerId, name: S.worker.name, date, note, at: serverTimestamp() });
          S.plans[date] = note; (after || refreshPlanViews)();
        } catch (e) { toast(authErr(e), 'bad'); return false; }
      } }
    ]
  });
}
// Butiran satu hari: kehadiran, lawatan, catatan + tindakan (tuntutan / betulkan punch)
async function openDay(d, recs) {
  if (!recs) {
    try {
      const q = await getDocs(query(collection(db, 'companies', S.cid, 'attendance'), where('uid', '==', S.user.uid), where('date', '>=', d), where('date', '<=', d)));
      recs = q.docs.map(x => ({ id: x.id, ...x.data({ serverTimestamps: 'estimate' }) }));
    } catch { recs = []; }
  }
  const inf = dayInfo(d), lvReq = leaveDateMap(S.reqs)[d], holName = holidayMap(S.company)[d];
  const punches = recs.filter(r => r.type !== 'visit'), visits = recs.filter(r => r.type === 'visit');
  const sm = punches.length ? summarizeDay(punches, lateSettings(S.company, inf), d) : null;
  const claims = [];
  const mc = S.claims?.[d.slice(0, 7)], CR = claimRates(S.company);
  if (mc) {
    (mc.journeys || []).filter(j => j.date === d).forEach(j => claims.push({ category: j.route || L('Perjalanan', 'Journey'), km: j.km, amount: journeyTotal(j, CR), status: mc.status }));
    (mc.purchases || []).filter(p => p.date === d).forEach(p => claims.push({ category: `${p.cat} · ${p.supplier || ''}`, amount: purchaseTotal(p), status: mc.status }));
  }
  const row = (k, v) => v ? `<div class="set-row"><span class="muted small">${k}</span><b class="right">${v}</b></div>` : '';
  const t = todayStr();
  const visitTxt = visits.map(v => `${fmtTime(punchTime(v))} ${v.locName}${v.note ? ' (' + v.note + ')' : ''}`).join('; ');
  const m = modal({
    title: fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    body: `${row(L('Syif', 'Shift'), inf.shift ? esc(shiftLabel(inf.shift)) : (inf.type === 'off' ? L('Hari rehat', 'Rest day') : ''))}
      ${row(L('Cuti umum', 'Public holiday'), holName ? esc(holName) : '')}
      ${row(L('Cuti', 'Leave'), lvReq ? esc(lvReq.typeName || '') : '')}
      ${sm ? row(L('Masuk', 'In'), fmtTime(sm.firstIn)) + row(L('Keluar', 'Out'), sm.open ? L('masih bekerja', 'still working') : fmtTime(sm.lastOut))
        + row(L('Jam kerja', 'Hours'), minsToHM(sm.workMin)) + row(L('Rehat', 'Break'), sm.breakMin >= 1 ? Math.round(sm.breakMin) + 'm' + (sm.autoBreak ? ' (auto)' : '') : '')
        + row(L('Lewat', 'Late'), sm.lateMin ? sm.lateMin + 'm' : '') : (d <= t && inf.type === 'work' && !lvReq ? row(L('Status', 'Status'), `<span class="badge b-bad">${L('Tiada punch', 'No punch')}</span>`) : '')}
      ${visits.length ? `<div class="sec-title">${L('Lawatan tapak', 'Site visits')}</div>${visits.map(v => `<div class="set-row"><span>${fmtTime(punchTime(v))} · ${esc(v.locName)}${v.note ? `<div class="xs muted">${esc(v.note)}</div>` : ''}</span>${v.lat != null ? `<a class="xs" target="_blank" href="https://www.google.com/maps?q=${v.lat},${v.lng}">${L('Peta', 'Map')}</a>` : ''}</div>`).join('')}` : ''}
      ${claims.length ? `<div class="sec-title">${L('Tuntutan hari ini', 'Claims this day')}</div>${claims.map(c => `<div class="set-row"><span>${esc(c.category || '')}${c.km ? ` · ${c.km} km` : ''}</span><span>${money(c.amount)} ${statusBadge(c.status)}</span></div>`).join('')}` : ''}
      <div class="set-row"><span class="muted small">📍 ${L('Catatan', 'Note')}</span><b class="right">${esc(S.plans?.[d] || '-')}</b></div>
      <div class="stack" style="margin-top:.8rem">
        <button class="btn btn-soft btn-block" data-da="note">📍 ${S.plans?.[d] ? L('Ubah catatan', 'Edit note') : L('Tambah catatan pergi mana', 'Add where-to note')}</button>
        ${d <= t ? `<button class="btn btn-soft btn-block" data-da="claim">💰 ${L('Tambah perjalanan ke tuntutan bulan ini', "Add journey to this month's claim")}</button>
        <button class="btn btn-ghost btn-block" data-da="fix">✏️ ${L('Terlupa punch? Betulkan', 'Forgot to punch? Fix it')}</button>` : ''}
      </div>`
  });
  $$('[data-da]', m.el).forEach(b => b.onclick = () => {
    m.close();
    const a = b.dataset.da;
    setTimeout(() => {
      if (a === 'note') planNote(d);
      else if (a === 'claim') claimForm({ date: d, desc: [S.plans?.[d], visitTxt].filter(Boolean).join(' — ') });
      else fixForm({ date: d });
    }, 60);
  });
}
function refreshPlanViews() { if (S.tab === 'home') viewHome(); else if (S.tab === 'rekod') viewRekod(); }

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
    // Kalendar bulan
    const [yy, mm] = ym.split('-').map(Number);
    const last = new Date(yy, mm, 0).getDate(), first = (new Date(yy, mm - 1, 1).getDay() + 6) % 7;
    const sumOf = Object.fromEntries(sums.map(x => [x.dt, x.s]));
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<div></div>');
    for (let dd = 1; dd <= last; dd++) {
      const d = `${ym}-${String(dd).padStart(2, '0')}`, inf = info(d), sm = sumOf[d] || (byDate[d] ? summarizeDay(byDate[d], lateSettings(S.company, inf), d) : null);
      let cls = 'cal-f';
      if (sm?.firstIn) cls = sm.lateMin ? 'cal-late' : 'cal-ok';
      else if (lv[d]) cls = 'cal-leave';
      else if (hol[d] || inf.type === 'holiday') cls = 'cal-hol';
      else if (inf.type === 'off') cls = 'cal-off';
      else if (d < t) cls = 'cal-abs';
      cells.push(`<button class="cal-d ${cls} ${d === t ? 'cal-today' : ''}" data-cd="${d}" style="aspect-ratio:auto;min-height:54px;align-content:start;padding:4px 0;line-height:1.1">${dd}${S.plans?.[d] ? '<i></i>' : ''}${calTimes(sm)}</button>`);
    }
    const calHtml = `<div class="cal">${['Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab', 'Ahd'].map((x, i) => `<div class="cal-h">${dayName((i + 1) % 7)}</div>`).join('')}${cells.join('')}</div>
      <div class="row xs muted" style="margin:.5rem 0 1rem;gap:.8rem">
        <span><b class="cal-k cal-ok"></b>${L('Hadir', 'Present')}</span><span><b class="cal-k cal-late"></b>${L('Lewat', 'Late')}</span>
        <span><b class="cal-k cal-leave"></b>${L('Cuti', 'Leave')}</span><span><b class="cal-k cal-abs"></b>${L('Tidak hadir', 'Absent')}</span>
        <span><b class="cal-k cal-off"></b>${L('Rehat', 'Off')}</span><span>📍 ${L('ada catatan', 'has note')}</span></div>`;
    $('#rekBody').innerHTML = calHtml + `
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
    $$('[data-cd]').forEach(b => b.onclick = () => openDay(b.dataset.cd, byDate[b.dataset.cd] || []));
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
      <button class="btn btn-soft btn-block" id="rqClaim">${icon('money', 18)} ${L('Tuntutan Bulanan (perjalanan, resit SST, elaun)', 'Monthly Claim (journeys, SST receipts, allowances)')} ${statusBadge(S.claims?.[todayStr().slice(0, 7)]?.status || 'draft')}</button>
      <button class="btn btn-soft btn-block" id="rqAdv">${icon('card', 18)} ${L('Pendahuluan Gaji', 'Salary Advance')}</button>
      <button class="btn btn-soft btn-block" id="rqSwap">${icon('users', 18)} ${L('Tukar Syif dengan Rakan', 'Swap Shift with Colleague')}</button>
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
  $('#rqSwap').onclick = swapForm;
  bindCancel();
}

function reqDetail(r) {
  if (r.kind === 'leave') return `${esc(r.typeName || leaveTypeName(S.company, r.typeId))} · ${fmtDate(r.from)}${r.to && r.to !== r.from ? ' – ' + fmtDate(r.to) : ''} · ${r.days} ${L('hari', 'day(s)')}${r.half ? ' (' + (r.half === 'am' ? L('pagi', 'AM') : L('petang', 'PM')) + ')' : ''}`;
  if (r.kind === 'ot') return `${fmtDate(r.date)} · ${esc(r.start)}–${esc(r.end)} · ${r.approvedHours ?? r.hours} ${L('jam', 'hrs')}`;
  if (r.kind === 'claim') return `${esc(r.category || '')}${r.items?.length ? ` (${r.items.length} ${L('item', 'items')})` : ''} · ${fmtDate(r.date)} · ${money(r.approvedAmount ?? r.amount)}${r.paidPeriod ? ' · ' + L('dibayar', 'paid') + ' ' + esc(r.paidPeriod) : ''}`;
  if (r.kind === 'swap') return `${fmtDate(r.date)} · ${L('dengan', 'with')} ${esc(r.withId)}`;
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

function fixForm(pre = {}) {
  const t = todayStr();
  const m = modal({
    title: L('Betulkan Punch', 'Fix Punch'),
    body: `
      <p class="small muted">${L('Untuk punch yang terlupa. Majikan akan semak dan luluskan.', 'For a missed punch. Your employer will review and approve.')}</p>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Tarikh', 'Date')}</label><input class="input" type="date" id="fd" value="${esc(pre.date || t)}" max="${t}"></div>
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

// ================= TUNTUTAN BULANAN (ikut borang syarikat) — dokumen kelulusan berasingan, tidak masuk gaji =================
const claimId = (m) => `${S.me.workerId}_${m}`;
const myClaim = (m) => S.claims?.[m] || { ...emptyClaim(m), uid: S.user.uid, workerId: S.me.workerId, name: S.worker.name };
const editable = (cl) => ['draft', 'rejected'].includes(cl.status || 'draft');
async function saveClaim(cl, status) {
  const data = {
    uid: S.user.uid, workerId: S.me.workerId, name: S.worker.name, month: cl.month,
    status: status || (cl.status === 'rejected' ? 'draft' : (cl.status || 'draft')),
    journeys: cl.journeys || [], purchases: cl.purchases || [], allowances: cl.allowances || [],
    otherDetails: cl.otherDetails || '', updatedAt: serverTimestamp(),
    ...(status === 'submitted' ? { submittedAt: serverTimestamp(), adminNote: '' } : {})
  };
  await setDoc(doc(db, 'companies', S.cid, 'claims', claimId(cl.month)), data, { merge: true });
  S.claims[cl.month] = { ...cl, ...data };
}

// Dipanggil dari Mohon / kalendar
function claimForm(pre = {}) {
  const month = (pre && pre.date ? pre.date : todayStr()).slice(0, 7);
  if (pre && pre.date) {
    const cl = myClaim(month);
    if (!editable(cl)) { toast(L('Tuntutan bulan ini sudah dihantar.', 'This month’s claim has already been submitted.'), 'warn'); return claimEditor(month); }
    journeyForm(cl, { date: pre.date, remarks: pre.desc || '' }, null, () => claimEditor(month, 'j'));
  } else claimEditor(month);
}

function projOpts() {
  return `<datalist id="projList">${(S.company.projects || []).map(p => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

function claimEditor(month, tab = 'j') {
  const cl = myClaim(month), X = computeClaim(cl, S.company), R = X.R, ed = editable(cl);
  const J = cl.journeys || [], P = cl.purchases || [], A = cl.allowances || [];
  const m = modal({
    title: L('Tuntutan Bulanan', 'Monthly Claim'), wide: true,
    body: `
      <div class="row between" style="margin-bottom:.6rem">
        <input type="month" class="input" id="cm" value="${month}" style="width:auto">
        <span>${statusBadge(cl.status || 'draft')}</span>
      </div>
      ${claimTimeline(cl)}
      ${cl.status === 'rejected' && cl.adminNote ? `<div class="card" style="border-color:var(--bad);margin-bottom:10px"><b style="color:var(--bad)">${L('Ditolak', 'Rejected')}:</b> ${esc(cl.adminNote)}<div class="xs muted">${L('Betulkan dan hantar semula.', 'Fix and resubmit.')}</div></div>` : ''}
      <div class="stats">
        <div class="stat"><div class="n" style="font-size:1.1rem">${money(X.claimTotal)}</div><div class="t">Total (Claim)</div></div>
        <div class="stat info"><div class="n" style="font-size:1.1rem">${money(X.allowanceTotal)}</div><div class="t">Total (Allowance)</div></div>
        <div class="stat ok"><div class="n" style="font-size:1.1rem">${money(X.reimbursement)}</div><div class="t">Claim Reimbursement</div></div>
      </div>
      <div class="tabs">
        <button data-ct="j">${L('Perjalanan', 'Journeys')} (${J.length})</button>
        <button data-ct="p">${L('Resit SST', 'SST Receipts')} (${P.length})</button>
        <button data-ct="a">${L('Elaun', 'Allowance')} (${A.length})</button>
        <button data-ct="s">${L('Ringkasan', 'Summary')}</button>
      </div>
      <div id="ctBody"></div>`,
    actions: [
      { label: L('Pratonton dokumen', 'Preview document'), cls: 'btn-ghost', autoClose: false, onClick: () => { previewClaim(cl); return false; } },
      ...(ed && (J.length || P.length || A.length) ? [{ label: L('Hantar untuk kelulusan', 'Submit for approval'), cls: 'btn-primary', autoClose: false, onClick: () => { m.close(); submitClaim(month); return false; } }] : [])
    ]
  });
  const el = m.el;
  $('#cm', el).onchange = (e) => { m.close(); claimEditor(e.target.value || month); };
  const reopen = (t) => () => claimEditor(month, t);
  const draw = (t) => {
    $$('[data-ct]', el).forEach(b => b.classList.toggle('on', b.dataset.ct === t));
    const body = $('#ctBody', el);
    const addBtn = (id, label) => ed ? `<button class="btn btn-plus" id="${id}" style="margin-top:.6rem">${icon('plus', 16)} ${label}</button>` : '';
    if (t === 'j') {
      body.innerHTML = `<p class="xs muted">EXPENSES CLAIM JUSTIFICATION FORM · RM${R.km}/km · Outstation RM${R.outstation} · Overnight RM${R.overnight}</p>
        ${J.length ? `<div class="table-wrap"><table><thead><tr><th>${L('Tarikh', 'Date')}</th><th>${L('Perjalanan / Tujuan', 'Journey / Purpose')}</th><th class="right">km</th><th class="right">${L('Tol', 'Toll')}</th><th class="right">${L('Parkir', 'Park')}</th><th class="right">RM</th><th></th></tr></thead><tbody>
          ${J.map((j, i) => `<tr><td class="small">${fmtDate(j.date, { day: 'numeric', month: 'short' })}</td><td><b>${esc(j.route || '-')}</b><div class="xs muted">${esc(j.project || '')}${j.outstation ? ` · Outst ${j.outstation}` : ''}${j.overnight ? ` · Overn ${j.overnight}` : ''}</div></td>
            <td class="right">${j.km || ''}</td><td class="right">${j.toll ? Number(j.toll).toFixed(2) : ''}</td><td class="right">${j.parking ? Number(j.parking).toFixed(2) : ''}</td><td class="right bold">${journeyTotal(j, R).toFixed(2)}</td>
            <td style="white-space:nowrap">${ed ? `<button class="icon-btn" data-je="${i}">✎</button><button class="icon-btn" data-jd="${i}">✕</button>` : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="5">${L('Jumlah', 'Total')}${X.kmTotal > 0 ? ` (${L('tolak', 'less')} RM${R.offset} offset)` : ''}</th><th class="right">${X.justTotal.toFixed(2)}</th><th></th></tr></tfoot></table></div>`
          : `<div class="empty small">${L('Tiada perjalanan lagi.', 'No journeys yet.')}</div>`}
        ${addBtn('jAdd', L('Tambah perjalanan', 'Add journey'))}`;
      $('#jAdd', el) && ($('#jAdd', el).onclick = () => { m.close(); journeyForm(cl, {}, null, reopen('j')); });
      $$('[data-je]', el).forEach(b => b.onclick = () => { m.close(); journeyForm(cl, J[Number(b.dataset.je)], Number(b.dataset.je), reopen('j')); });
      $$('[data-jd]', el).forEach(b => b.onclick = async () => { if (!await confirmBox(L('Buang baris ini?', 'Remove this row?'))) return; J.splice(Number(b.dataset.jd), 1); cl.journeys = J; await saveClaim(cl); m.close(); claimEditor(month, 'j'); });
    } else if (t === 'p') {
      body.innerHTML = `<p class="xs muted">SST PURCHASES CLAIM FORM</p>
        ${P.length ? `<div class="table-wrap"><table><thead><tr><th>${L('Tarikh', 'Date')}</th><th>${L('Pembekal / Invois', 'Supplier / Invoice')}</th><th>${L('Kategori', 'Category')}</th><th class="right">RM</th><th></th></tr></thead><tbody>
          ${P.map((p, i) => `<tr><td class="small">${fmtDate(p.date, { day: 'numeric', month: 'short' })}</td><td><b>${esc(p.supplier || '-')}</b><div class="xs muted mono">${esc(p.invoice || '')}${p.sstCode ? ' · ' + esc(p.sstCode) : ''}</div><div class="xs muted">${esc(p.project || '')}</div></td>
            <td class="small">${esc(p.cat)}${p.fileId ? ' 🧾' : ''}</td><td class="right bold">${purchaseTotal(p).toFixed(2)}</td>
            <td style="white-space:nowrap">${ed ? `<button class="icon-btn" data-pe="${i}">✎</button><button class="icon-btn" data-pd="${i}">✕</button>` : ''}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="3">${L('Jumlah', 'Total')}</th><th class="right">${X.sstSub.total.toFixed(2)}</th><th></th></tr></tfoot></table></div>`
          : `<div class="empty small">${L('Tiada resit lagi.', 'No receipts yet.')}</div>`}
        ${addBtn('pAdd', L('Tambah resit', 'Add receipt'))}`;
      $('#pAdd', el) && ($('#pAdd', el).onclick = () => { m.close(); purchaseForm(cl, {}, null, reopen('p')); });
      $$('[data-pe]', el).forEach(b => b.onclick = () => { m.close(); purchaseForm(cl, P[Number(b.dataset.pe)], Number(b.dataset.pe), reopen('p')); });
      $$('[data-pd]', el).forEach(b => b.onclick = async () => {
        if (!await confirmBox(L('Buang resit ini?', 'Remove this receipt?'))) return;
        const [x] = P.splice(Number(b.dataset.pd), 1); cl.purchases = P;
        if (x?.fileId) deleteDoc(doc(db, 'companies', S.cid, 'claimFiles', x.fileId)).catch(() => {});
        await saveClaim(cl); m.close(); claimEditor(month, 'p');
      });
    } else if (t === 'a') {
      body.innerHTML = `<p class="xs muted">ALLOWANCE CLAIM FORM · Project Allowance</p>
        ${A.length ? `<div class="table-wrap"><table><thead><tr><th>No</th><th>${L('Butiran', 'Details')}</th><th class="right">RM</th><th></th></tr></thead><tbody>
          ${A.map((a, i) => `<tr><td>${i + 1}</td><td><b>${esc(a.details || '-')}</b><div class="xs muted">${a.project ? 'Project RM' + a.project : ''}</div></td>
            <td class="right bold">${allowanceTotal(a, R).toFixed(2)}</td><td style="white-space:nowrap">${ed ? `<button class="icon-btn" data-ae="${i}">✎</button><button class="icon-btn" data-ad="${i}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
          : `<div class="empty small">${L('Tiada elaun.', 'No allowances.')}</div>`}
        ${addBtn('aAdd', L('Tambah elaun', 'Add allowance'))}`;
      $('#aAdd', el) && ($('#aAdd', el).onclick = () => { m.close(); allowanceForm(cl, {}, null, reopen('a')); });
      $$('[data-ae]', el).forEach(b => b.onclick = () => { m.close(); allowanceForm(cl, A[Number(b.dataset.ae)], Number(b.dataset.ae), reopen('a')); });
      $$('[data-ad]', el).forEach(b => b.onclick = async () => { if (!await confirmBox(L('Buang baris ini?', 'Remove this row?'))) return; A.splice(Number(b.dataset.ad), 1); cl.allowances = A; await saveClaim(cl); m.close(); claimEditor(month, 'a'); });
    } else {
      body.innerHTML = `<p class="xs muted">EXPENSES PROJECT CLAIM FORM</p>
        ${X.rows.length ? `<div class="table-wrap"><table><thead><tr><th>${L('Projek', 'Project')}</th><th class="right">Mileage</th><th class="right">Toll</th><th class="right">Travel</th><th class="right">Outst/Overn</th><th class="right">Others*</th><th class="right">Total</th></tr></thead><tbody>
          ${X.rows.map(r => `<tr><td>${esc(r.project)}</td><td class="right">${r.mileage.toFixed(2)}</td><td class="right">${r.toll.toFixed(2)}</td><td class="right">${r.travel.toFixed(2)}</td><td class="right">${r.outOver.toFixed(2)}</td>
            <td class="right">${(r.lodging + r.parking + r.fnb + r.tools + r.stationery + r.medical + r.others).toFixed(2)}</td><td class="right bold">${r.total.toFixed(2)}</td></tr>`).join('')}
          <tr><td>MILEAGE ALLOWANCE OFFSET</td><td class="right">${X.offset ? (-X.offset).toFixed(2) : '0.00'}</td><td colspan="5"></td></tr></tbody></table></div>
          <p class="xs muted">* ${L('Lodging, parking, F&B, tools, stationery, medical & others — lihat dokumen penuh.', 'Lodging, parking, F&B, tools, stationery, medical & others — see full document.')}</p>` : `<div class="empty small">-</div>`}
        <div class="set-row"><span>Total Expenses</span><b>${money(X.totalExpenses)}</b></div>
        <div class="set-row"><span>Total (Allowance)</span><b>${money(X.allowanceTotal)}</b></div>
        <div class="set-row"><span><b>Claim Reimbursement</b></span><b style="color:var(--gold);font-size:1.2rem">${money(X.reimbursement)}</b></div>
        <div class="field" style="margin-top:.6rem"><label class="lbl">Details for others claims</label>${ed ? `<textarea class="input" id="cOth" maxlength="400" style="min-height:60px">${esc(cl.otherDetails || '')}</textarea>` : `<div>${esc(cl.otherDetails || '-')}</div>`}</div>
        ${ed ? `<button class="btn btn-soft" id="cSaveS">${L('Simpan', 'Save')}</button>` : ''}`;
      $('#cSaveS', el) && ($('#cSaveS', el).onclick = async () => {
        cl.otherDetails = $('#cOth', el).value.trim();
        try { await saveClaim(cl); toast(L('Disimpan.', 'Saved.')); m.close(); claimEditor(month, 's'); } catch (e) { toast(authErr(e), 'bad'); }
      });
    }
  };
  $$('[data-ct]', el).forEach(b => b.onclick = () => draw(b.dataset.ct));
  draw(tab);
}

// Tukar teks koordinat / pautan Google Maps kepada {lat, lng}
function parseCoord(txt) {
  const t = String(txt || '').trim(); if (!t) return null;
  const pats = [/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination|origin)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /^\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*$/];
  for (const re of pats) { const m = t.match(re); if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; } }
  return null;
}
// Jarak jalan raya (km) antara titik — guna laluan jalan, jika gagal anggar dari garis lurus × 1.3
async function routeKm(pts) {
  try {
    const q = pts.map(p => `${p.lng},${p.lat}`).join(';');
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${q}?overview=false`, { signal: ctl.signal });
    clearTimeout(tm);
    const js = await r.json();
    if (js.code === 'Ok' && js.routes?.[0]) return { km: Math.round(js.routes[0].distance / 100) / 10, est: false };
  } catch {}
  let m = 0; for (let i = 1; i < pts.length; i++) m += haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  return { km: Math.round(m * 1.3 / 100) / 10, est: true };
}

function journeyForm(cl, j = {}, idx = null, after) {
  const R = claimRates(S.company), t = todayStr();
  const f = (k, label, step = '0.01') => `<div class="field"><label class="lbl">${label}</label><input class="input" type="number" step="${step}" min="0" data-jk="${k}" value="${j[k] ?? ''}" inputmode="decimal"></div>`;
  // Tempat tersimpan: lokasi syarikat + titik yang pernah digunakan dalam tuntutan ini
  const saved = [];
  (S.locations || []).filter(l => l.lat != null).forEach(l => saved.push({ n: l.name, lat: l.lat, lng: l.lng }));
  (cl.journeys || []).forEach(x => (x.points || []).forEach(p => { if (p.lat != null && !saved.some(s => s.n === p.n)) saved.push(p); }));
  let pts = j.points?.length ? j.points.map(p => ({ ...p })) : [{ n: '', lat: null, lng: null }, { n: '', lat: null, lng: null }];
  let kmAuto = j.km || 0, est = false, manual = !!(j.km && !j.points?.length);
  const ptRow = (p, i) => `<div class="jpt" data-pi="${i}">
      <span class="jpt-n">${i === 0 ? L('Dari', 'From') : i === pts.length - 1 ? L('Ke', 'To') : L('Hentian', 'Stop') + ' ' + i}</span>
      <input class="input" data-pn value="${esc(p.n || '')}" placeholder="${L('Nama tempat', 'Place name')}" list="savedPl">
      <input class="input mono" data-pc value="${p.lat != null ? `${p.lat}, ${p.lng}` : ''}" placeholder="${L('koordinat / pautan Google Maps', 'coordinates / Google Maps link')}">
      <button type="button" class="icon-btn" data-pg title="${L('Lokasi semasa', 'Current location')}">${icon('gps', 18)}</button>
      ${pts.length > 2 ? `<button type="button" class="icon-btn" data-px>✕</button>` : '<span></span>'}
    </div>`;
  const m = modal({
    title: idx === null ? L('Tambah perjalanan', 'Add journey') : L('Ubah perjalanan', 'Edit journey'),
    body: `${projOpts()}<datalist id="savedPl">${saved.map(p => `<option value="${esc(p.n)}">`).join('')}</datalist>
      <div class="grid2">
        <div class="field"><label class="lbl">${L('Tarikh', 'Date')}</label><input class="input" type="date" id="jd" value="${esc(j.date || t)}" max="${t}"></div>
        <div class="field"><label class="lbl">Purpose of Journey (${L('projek', 'project')})</label><input class="input" id="jp" list="projList" value="${esc(j.project || '')}"></div>
      </div>
      <div class="sec-title" style="margin-top:.2rem">Journey From/To</div>
      <p class="xs muted" style="margin-top:-.3rem">${L('Pilih tempat tersimpan, tekan 📍 untuk lokasi semasa, atau tampal koordinat / pautan Google Maps. Jarak & RM dikira automatik.', 'Pick a saved place, tap 📍 for current location, or paste coordinates / a Google Maps link. Distance & RM are calculated automatically.')}</p>
      <div id="jPts"></div>
      <div class="row"><button type="button" class="btn btn-sm btn-plus" id="jAddPt">${icon('plus', 16)} ${L('Tambah hentian', 'Add stop')}</button>
        <label class="check"><input type="checkbox" id="jRt" ${j.roundTrip ? 'checked' : ''}>${L('Pergi-balik (kembali ke titik mula)', 'Round trip (back to start)')}</label></div>
      <div class="card" style="margin-top:.6rem;padding:.8rem">
        <div class="row between"><span>${L('Jarak', 'Distance')}</span><b id="jKm">-</b></div>
        <div class="row between"><span>Mileage × RM${R.km}/km</span><b id="jMil">RM0.00</b></div>
        <p class="xs muted" id="jKmNote" style="margin:.3rem 0 0"></p>
        <label class="check xs" style="margin-top:.3rem"><input type="checkbox" id="jMan" ${manual ? 'checked' : ''}>${L('Isi km sendiri', 'Enter km manually')}</label>
        <input class="input ${manual ? '' : 'hide'}" type="number" step="0.1" min="0" id="jKmIn" value="${manual ? j.km : ''}" placeholder="km" style="max-width:140px;margin-top:.3rem">
      </div>
      <div class="grid2">${f('toll', 'Toll (RM)')}${f('parking', 'Parking (RM)')}</div>
      <div class="grid2">${f('outstation', `Outstation × RM${R.outstation}`, '1')}${f('overnight', `Overnight × RM${R.overnight}`, '1')}</div>
      <div class="field"><label class="lbl">Remarks</label><input class="input" id="jm" maxlength="200" value="${esc(j.remarks || '')}"></div>
      <div class="card" style="background:var(--gold2);border-color:var(--gold)"><div class="row between"><b>Total (RM)</b><b id="jt" style="color:var(--gold);font-size:1.2rem">0.00</b></div></div>`,
    actions: [
      { label: L('Batal', 'Cancel'), onClick: () => { after && setTimeout(after, 60); } },
      {
        label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
          const row = read(el);
          if (!row.date || !row.route) { toast(L('Sila isi tarikh dan tempat perjalanan.', 'Please fill in date and journey places.'), 'warn'); return false; }
          if (row.date.slice(0, 7) !== cl.month) { toast(L('Tarikh mesti dalam bulan tuntutan ini.', 'Date must be within this claim month.'), 'warn'); return false; }
          const J = [...(cl.journeys || [])];
          if (idx === null) J.push(row); else J[idx] = row;
          cl.journeys = J;
          try { await saveClaim(cl); toast(L('Disimpan ke draf.', 'Saved to draft.')); after && setTimeout(after, 60); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  const el = m.el, box = $('#jPts', el);
  const drawPts = () => { box.innerHTML = pts.map(ptRow).join(''); };
  const syncPts = () => {
    $$('[data-pi]', box).forEach(r => {
      const i = Number(r.dataset.pi), p = pts[i]; if (!p) return;
      p.n = $('[data-pn]', r).value.trim();
      const c = parseCoord($('[data-pc]', r).value);
      p.lat = c ? c.lat : null; p.lng = c ? c.lng : null;
    });
  };
  const kmNow = () => manual ? Number($('#jKmIn', el).value || 0) : kmAuto;
  const read = () => {
    syncPts();
    const names = pts.map(p => p.n).filter(Boolean);
    const route = names.length ? (names.join(' → ') + ($('#jRt', el).checked && names.length > 1 ? ' → ' + names[0] : '')) : (j.route || '');
    const o = { date: $('#jd', el).value, route, project: $('#jp', el).value.trim(), remarks: $('#jm', el).value.trim(),
      points: pts.map(p => ({ n: p.n, lat: p.lat, lng: p.lng })), roundTrip: $('#jRt', el).checked };
    const km = kmNow(); if (km) o.km = km;
    $$('[data-jk]', el).forEach(i => { const v = Number(i.value || 0); if (v) o[i.dataset.jk] = v; });
    return o;
  };
  const upd = () => {
    const km = kmNow();
    $('#jKm', el).textContent = km ? `${km} km${est && !manual ? ' (' + L('anggaran', 'estimate') + ')' : ''}` : '-';
    $('#jMil', el).textContent = 'RM' + (km * R.km).toFixed(2);
    $('#jt', el).textContent = journeyTotal(read(), R).toFixed(2);
  };
  let calcT = null, seq = 0;
  const calc = () => {
    clearTimeout(calcT);
    calcT = setTimeout(async () => {
      syncPts();
      if (manual) return upd();
      let path = pts.filter(p => p.lat != null);
      if (path.length < 2 || path.length !== pts.length) {
        $('#jKmNote', el).textContent = L('Isi lokasi (koordinat) untuk semua titik supaya jarak dikira.', 'Add a location (coordinates) for every point to calculate distance.');
        kmAuto = 0; return upd();
      }
      if ($('#jRt', el).checked) path = [...path, path[0]];
      const my = ++seq;
      $('#jKmNote', el).textContent = L('Mengira jarak…', 'Calculating distance…');
      const r = await routeKm(path);
      if (my !== seq) return;
      kmAuto = r.km; est = r.est;
      $('#jKmNote', el).textContent = r.est ? L('Anggaran (laluan jalan tidak dapat dicapai): jarak garis lurus × 1.3.', 'Estimate (road route unavailable): straight-line distance × 1.3.') : L('Jarak ikut laluan jalan raya.', 'Distance by road route.');
      upd();
    }, 500);
  };
  drawPts();
  box.addEventListener('change', (e) => {
    const r = e.target.closest('[data-pi]'); if (!r) return;
    if (e.target.matches('[data-pn]')) {           // pilih tempat tersimpan → isi koordinat
      const sp = saved.find(x => x.n === e.target.value.trim());
      if (sp && !parseCoord($('[data-pc]', r).value)) $('[data-pc]', r).value = `${sp.lat}, ${sp.lng}`;
    }
    calc();
  });
  box.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-pi]'); if (!r) return;
    const i = Number(r.dataset.pi);
    if (e.target.closest('[data-px]')) { syncPts(); pts.splice(i, 1); drawPts(); calc(); return; }
    if (e.target.closest('[data-pg]')) {
      const b = e.target.closest('[data-pg]'); b.disabled = true;
      try {
        const p = await getPosition(12000);
        $('[data-pc]', r).value = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
        if (!$('[data-pn]', r).value.trim()) $('[data-pn]', r).value = L('Lokasi semasa', 'Current location');
        calc();
      } catch { toast(L('Tidak dapat lokasi GPS.', 'Could not get GPS location.'), 'warn'); }
      b.disabled = false;
    }
  });
  $('#jAddPt', el).onclick = () => { syncPts(); pts.splice(pts.length - 1, 0, { n: '', lat: null, lng: null }); drawPts(); };
  $('#jRt', el).onchange = calc;
  $('#jMan', el).onchange = (e) => { manual = e.target.checked; $('#jKmIn', el).classList.toggle('hide', !manual); calc(); upd(); };
  el.addEventListener('input', (e) => { if (!e.target.closest('#jPts')) upd(); });
  if (pts.every(p => p.lat != null) && !j.km) calc();
  upd();
}

function purchaseForm(cl, p = {}, idx = null, after) {
  const R = claimRates(S.company), t = todayStr(), cats = SST_CATS();
  let img = null, imgChanged = false;
  const m = modal({
    title: idx === null ? L('Tambah resit (SST Purchases)', 'Add receipt (SST Purchases)') : L('Ubah resit', 'Edit receipt'),
    body: `${projOpts()}
      <div class="grid2">
        <div class="field"><label class="lbl">Date</label><input class="input" type="date" id="pd" value="${esc(p.date || t)}" max="${t}"></div>
        <div class="field"><label class="lbl">Supplier Name</label><input class="input" id="ps" maxlength="80" value="${esc(p.supplier || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label class="lbl">SST Code</label><input class="input" id="pc" maxlength="30" value="${esc(p.sstCode || '')}"></div>
        <div class="field"><label class="lbl">Invoice No</label><input class="input" id="pi" maxlength="40" value="${esc(p.invoice || '')}"></div>
      </div>
      <div class="field"><label class="lbl">Expenses Details</label><select class="input" id="pk">${cats.map(([k]) => `<option ${k === (p.cat || 'TRAVEL') ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <div class="xs muted" id="pkh"></div></div>
      <div class="grid3">
        <div class="field"><label class="lbl">Total Exclude SST</label><input class="input" type="number" step="0.01" min="0" id="pa" value="${p.amount ?? ''}" inputmode="decimal"></div>
        <div class="field"><label class="lbl">${R.sst}% SST <button type="button" class="link-btn xs" id="psst">${L('kira', 'calc')}</button></label><input class="input" type="number" step="0.01" min="0" id="px" value="${p.sst ?? 0}" inputmode="decimal"></div>
        <div class="field"><label class="lbl">Total Inclusive SST</label><input class="input" id="pt" disabled></div>
      </div>
      <div class="field"><label class="lbl">Remark (${L('projek', 'project')})</label><input class="input" id="pp" list="projList" value="${esc(p.project || '')}"></div>
      <div class="field"><label class="lbl">${L('Gambar resit', 'Receipt photo')}</label><input class="input" type="file" accept="image/*" id="pf"><div id="pfP" class="xs muted" style="margin-top:.3rem">${p.fileId ? '🧾 ' + L('Resit sudah dimuat naik', 'Receipt uploaded') : ''}</div></div>`,
    actions: [
      { label: L('Batal', 'Cancel'), onClick: () => { after && setTimeout(after, 60); } },
      {
        label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
          const row = {
            date: $('#pd', el).value, supplier: $('#ps', el).value.trim(), sstCode: $('#pc', el).value.trim(), invoice: $('#pi', el).value.trim(),
            cat: $('#pk', el).value, amount: Number($('#pa', el).value || 0), sst: Number($('#px', el).value || 0), project: $('#pp', el).value.trim(), fileId: p.fileId || null
          };
          if (!row.date || !(row.amount > 0)) { toast(L('Sila isi tarikh dan amaun.', 'Please fill in date and amount.'), 'warn'); return false; }
          if (row.date.slice(0, 7) !== cl.month) { toast(L('Tarikh mesti dalam bulan tuntutan ini.', 'Date must be within this claim month.'), 'warn'); return false; }
          try {
            if (imgChanged && img) {
              const fr = await addDoc(collection(db, 'companies', S.cid, 'claimFiles'), { uid: S.user.uid, workerId: S.me.workerId, claimId: claimId(cl.month), img, at: serverTimestamp() });
              if (p.fileId) deleteDoc(doc(db, 'companies', S.cid, 'claimFiles', p.fileId)).catch(() => {});
              row.fileId = fr.id;
            }
            const P = [...(cl.purchases || [])];
            if (idx === null) P.push(row); else P[idx] = row;
            cl.purchases = P;
            await saveClaim(cl);
            toast(L('Disimpan ke draf.', 'Saved to draft.')); after && setTimeout(after, 60);
          } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  const el = m.el;
  const upd = () => {
    $('#pt', el).value = (Number($('#pa', el).value || 0) + Number($('#px', el).value || 0)).toFixed(2);
    $('#pkh', el).textContent = (cats.find(c => c[0] === $('#pk', el).value) || [])[1] || '';
  };
  el.addEventListener('input', upd); $('#pk', el).onchange = upd; upd();
  $('#psst', el).onclick = () => { $('#px', el).value = (Number($('#pa', el).value || 0) * R.sst / 100).toFixed(2); upd(); };
  $('#pf', el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { img = await fileToDataURL(f, 1000, 'image/jpeg', 0.6); imgChanged = true; $('#pfP', el).innerHTML = `<img src="${img}" style="max-width:120px;border-radius:8px">`; }
    catch { toast(L('Gagal membaca imej.', 'Failed to read image.'), 'bad'); }
  };
}

function allowanceForm(cl, a = {}, idx = null, after) {
  const R = claimRates(S.company);
  const f = (k, label, step = '0.01') => `<div class="field"><label class="lbl">${label}</label><input class="input" type="number" step="${step}" min="0" data-ak="${k}" value="${a[k] ?? ''}" inputmode="decimal"></div>`;
  const m = modal({
    title: L('Elaun (Allowance Claim Form)', 'Allowance (Allowance Claim Form)'),
    body: `<div class="field"><label class="lbl">Expenses Details</label><input class="input" id="ad" maxlength="150" value="${esc(a.details || '')}"></div>
      ${f('project', 'Project Allowance (RM)')}
      <p class="xs muted">${L('Outstation & overnight diisi dalam tab Perjalanan.', 'Outstation & overnight are entered in the Journey tab.')}</p>
      <div class="card" style="background:var(--gold2);border-color:var(--gold)"><div class="row between"><b>Total (RM)</b><b id="at" style="color:var(--gold);font-size:1.2rem">0.00</b></div></div>`,
    actions: [
      { label: L('Batal', 'Cancel'), onClick: () => { after && setTimeout(after, 60); } },
      {
        label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
          const row = read(el);
          if (!row.details) { toast(L('Sila isi butiran.', 'Please fill in details.'), 'warn'); return false; }
          const A = [...(cl.allowances || [])];
          if (idx === null) A.push(row); else A[idx] = row;
          cl.allowances = A;
          try { await saveClaim(cl); after && setTimeout(after, 60); } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  const read = (el) => { const o = { details: $('#ad', el).value.trim() }; $$('[data-ak]', el).forEach(i => { const v = Number(i.value || 0); if (v) o[i.dataset.ak] = v; }); return o; };
  const upd = () => { $('#at', m.el).textContent = allowanceTotal(read(m.el), R).toFixed(2); };
  m.el.addEventListener('input', upd); upd();
}

async function claimFilesMap(cl) {
  const ids = (cl.purchases || []).map(p => p.fileId).filter(Boolean);
  if (!ids.length) return {};
  const out = {};
  await Promise.all(ids.map(id => getDoc(doc(db, 'companies', S.cid, 'claimFiles', id)).then(s => { if (s.exists()) out[id] = s.data().img; }).catch(() => {})));
  return out;
}
async function previewClaim(cl) {
  const files = await claimFilesMap(cl);
  if (!openPrint(claimDocHtml(S.company, { ...cl, name: S.worker.name, workerId: S.me.workerId }, files), false)) toast(L('Benarkan pop-up untuk lihat dokumen.', 'Allow pop-ups to view the document.'), 'warn');
}

function submitClaim(month) {
  const cl = myClaim(month), X = computeClaim(cl, S.company);
  const noPic = (cl.purchases || []).filter(p => !p.fileId).length;
  modal({
    title: L('Semak & hantar tuntutan', 'Review & submit claim'),
    body: `<p class="small muted">${L('Pastikan semua maklumat betul. Selepas dihantar, tuntutan tidak boleh diubah kecuali ditolak oleh majikan.', 'Make sure everything is correct. After submitting, the claim cannot be changed unless your employer rejects it.')}</p>
      <div class="set-row"><span>${L('Perjalanan', 'Journeys')}</span><b>${(cl.journeys || []).length}</b></div>
      <div class="set-row"><span>${L('Resit SST', 'SST receipts')}</span><b>${(cl.purchases || []).length}</b></div>
      <div class="set-row"><span>${L('Elaun', 'Allowances')}</span><b>${(cl.allowances || []).length}</b></div>
      <div class="set-row"><span>Total (Claim)</span><b>${money(X.claimTotal)}</b></div>
      <div class="set-row"><span>Total (Allowance)</span><b>${money(X.allowanceTotal)}</b></div>
      <div class="set-row"><span><b>Claim Reimbursement</b></span><b style="color:var(--gold);font-size:1.25rem">${money(X.reimbursement)}</b></div>
      ${noPic ? `<p class="small" style="color:var(--warn)">⚠ ${noPic} ${L('resit tiada gambar.', 'receipt(s) have no photo.')}</p>` : ''}
      <button class="btn btn-ghost btn-block" id="sPrev" style="margin:.6rem 0">${L('Pratonton dokumen penuh', 'Preview full document')}</button>
      <label class="check"><input type="checkbox" id="sOk">${L('Saya mengesahkan semua maklumat adalah benar.', 'I confirm all the information is true.')}</label>`,
    actions: [
      { label: L('Kembali', 'Back'), onClick: () => { setTimeout(() => claimEditor(month), 60); } },
      {
        label: L('Hantar', 'Submit'), cls: 'btn-primary', onClick: async ({ el }) => {
          if (!$('#sOk', el).checked) { toast(L('Sila tandakan pengesahan.', 'Please tick the confirmation.'), 'warn'); return false; }
          try { await saveClaim(cl, 'submitted'); toast(L('Tuntutan dihantar untuk kelulusan.', 'Claim submitted for approval.')); if (S.tab === 'mohon') viewMohon(); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  setTimeout(() => { const b = document.getElementById('sPrev'); if (b) b.onclick = () => previewClaim(cl); }, 50);
}

function swapForm() {
  const t = todayStr();
  modal({
    title: L('Tukar Syif', 'Swap Shift'),
    body: `<p class="small muted">${L('Tukar syif anda pada tarikh tersebut dengan syif rakan sekerja. Majikan perlu luluskan.', 'Swap your shift on that date with a colleague’s shift. Employer approval needed.')}</p>
      <div class="field"><label class="lbl">${L('Tarikh', 'Date')}</label><input class="input" type="date" id="sd" min="${t}" value="${t}"></div>
      <div class="field"><label class="lbl">${L('ID pekerja rakan', 'Colleague staff ID')}</label><input class="input id-input" id="sw" placeholder="${esc(S.me.workerId.replace(/\d+$/, ''))}002"></div>
      <div class="field"><label class="lbl">${L('Sebab', 'Reason')}</label><textarea class="input" id="sr" maxlength="300" style="min-height:60px"></textarea></div>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Hantar', 'Submit'), cls: 'btn-primary', onClick: async ({ el }) => {
          const date = $('#sd', el).value, withId = $('#sw', el).value.trim().toUpperCase();
          if (!date || !/^[A-Z]{2,6}\d+$/.test(withId) || withId === S.me.workerId) { toast(L('Sila isi tarikh dan ID rakan yang sah.', 'Please enter a date and a valid colleague ID.'), 'warn'); return false; }
          try { await submitReq({ kind: 'swap', date, withId, reason: $('#sr', el).value.trim() }); }
          catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
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
          ${(a.options || []).length ? `<div class="stack" style="margin-top:.5rem" data-poll="${d.id}">${a.options.map((o, i) => `<button class="btn btn-sm btn-ghost btn-block" data-opt="${i}">${esc(o)}</button>`).join('')}</div>` : ''}
          <div class="xs muted" style="margin-top:.3rem">${fmtDate(a.createdAt)}</div></div>
        </div>`; }).join('');
    // Undian
    $$('[data-poll]').forEach(async box => {
      const aid = box.dataset.poll;
      const mark = (i) => $$('[data-opt]', box).forEach(b => { b.classList.toggle('btn-primary', Number(b.dataset.opt) === i); b.classList.toggle('btn-ghost', Number(b.dataset.opt) !== i); });
      try { const v = await getDoc(doc(db, 'companies', S.cid, 'announcements', aid, 'votes', S.user.uid)); if (v.exists()) mark(v.data().opt); } catch {}
      $$('[data-opt]', box).forEach(b => b.onclick = async () => {
        const opt = Number(b.dataset.opt);
        try { await setDoc(doc(db, 'companies', S.cid, 'announcements', aid, 'votes', S.user.uid), { opt, workerId: S.me.workerId, at: serverTimestamp() }); mark(opt); toast(L('Undian direkod.', 'Vote recorded.')); }
        catch (e) { toast(authErr(e), 'bad'); }
      });
    });
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
  <div class="card"><h3>${L('Status Tuntutan', 'Claim Status')}</h3>${(() => {
    const ms = Object.keys(S.claims || {}).sort().reverse().slice(0, 6);
    return ms.length ? ms.map(mo => { const c = S.claims[mo]; return `<div class="set-row" data-myc="${mo}" style="cursor:pointer"><div><b>${esc(periodLabel(mo))}</b><div class="small muted">${money(computeClaim(c, S.company).reimbursement)}</div></div>${statusBadge(c.status || 'draft')}</div>`; }).join('')
      : `<div class="empty small">${L('Belum ada tuntutan.', 'No claims yet.')}</div>`;
  })()}</div>
  <div class="card"><h3>${L('Slip Gaji', 'Payslips')}</h3><div id="slips"><div class="loader" style="min-height:60px"><span class="spin"></span></div></div></div>
  <div class="card stack">
    ${ph ? `<a class="btn btn-ok btn-block" target="_blank" rel="noopener" href="https://wa.me/${ph}?text=${encodeURIComponent(`Salam, saya ${w.name} (${S.me.workerId}).`)}">${icon('chat', 18)} ${L('WhatsApp Majikan', 'WhatsApp Employer')}</a>` : ''}
    <button class="btn btn-ghost btn-block hide" id="pushB">${icon('bell', 18)} ${L('Hidupkan notifikasi', 'Turn on notifications')}</button>
    <button class="btn btn-ghost btn-block" id="chPin">${icon('shield', 18)} ${L('Tukar PIN', 'Change PIN')}</button>
    <button class="btn btn-ghost btn-block" id="langB">${L('Bahasa: Bahasa Melayu', 'Language: English')}</button>
    <button class="btn btn-danger btn-block" id="lo">${icon('out', 18)} ${L('Log Keluar', 'Log Out')}</button>
  </div>
  <p class="center xs muted" style="margin-top:1rem">ProAttendance · v${APP_VERSION}</p>`;
  $('#chPin').onclick = () => pinModal(false);
  $$('[data-myc]').forEach(r => r.onclick = () => claimEditor(r.dataset.myc, 's'));
  pushAvailable().then(ok => {
    const b = $('#pushB'); if (!ok || !b) return;
    b.classList.remove('hide');
    if (Notification.permission === 'granted') b.innerHTML = `${icon('check', 18)} ${L('Notifikasi aktif', 'Notifications on')}`;
    b.onclick = async () => {
      try { await enablePush(S.cid, S.user.uid, { role: 'worker', workerId: S.me.workerId }); toast(L('Notifikasi dihidupkan.', 'Notifications turned on.')); b.innerHTML = `${icon('check', 18)} ${L('Notifikasi aktif', 'Notifications on')}`; }
      catch { toast(L('Notifikasi tidak dibenarkan. Benarkan dalam tetapan pelayar.', 'Notifications blocked. Allow them in browser settings.'), 'warn', 5000); }
    };
  });
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
