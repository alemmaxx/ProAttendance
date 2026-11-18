// ProAttendance — Mod Kiosk (satu tablet di pintu masuk untuk semua pekerja)
import { auth, db, workerEmail, FIREBASE_CONFIG } from './fb.js';
import { DB_ID } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, collection, query, where, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  $, $$, L, esc, toast, modal, langBtn, applyLang, todayStr, addDays, fmtTime, toDate, summarizeDay, TYPE_LABEL,
  applyBrand, logoHtml, takeSelfie, scanQR, authErr, icon, getDeviceId, isExpired, fmtDate, punchTime
} from './ui.js';

const app = $('#app');
const KEY = 'pa_kiosk';
const cfg = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

// Aplikasi kedua untuk log masuk pekerja (tidak mengganggu sesi lain)
const kApp = initializeApp(FIREBASE_CONFIG, 'kiosk');
const kAuth = getAuth(kApp);
const kDb = getFirestore(kApp, DB_ID);

// ---------------------------------------------------------------- SETUP
function start() {
  const c = cfg();
  if (c) return renderKiosk(c);
  const unsub = onAuthStateChanged(auth, async (u) => {
    unsub();
    if (!u) return renderNeedAdmin();
    try {
      const me = (await getDoc(doc(db, 'users', u.uid))).data();
      if (!me || me.role !== 'admin') return renderNeedAdmin();
      const [cS, lS] = await Promise.all([getDoc(doc(db, 'companies', me.cid)), getDocs(collection(db, 'companies', me.cid, 'locations'))]);
      renderSetup(me.cid, cS.data(), lS.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { renderNeedAdmin(authErr(e)); }
  });
}

function renderNeedAdmin(err) {
  app.innerHTML = `<div class="blocked"><div class="card" style="max-width:440px">
    <h3>${L('Sediakan Mod Kiosk', 'Set Up Kiosk Mode')}</h3>
    <p>${L('Log masuk sebagai admin syarikat pada tablet ini dahulu, kemudian buka semula halaman ini.', 'Log in as a company admin on this tablet first, then reopen this page.')}</p>
    ${err ? `<p class="xs muted">${esc(err)}</p>` : ''}
    <a class="btn btn-primary" href="/admin.html">${L('Log masuk Admin', 'Admin login')}</a></div></div>`;
}

function renderSetup(cid, c, locs) {
  applyBrand(c);
  app.innerHTML = `<div class="blocked"><div class="card" style="max-width:480px;text-align:left">
    <div class="row">${logoHtml(c)}<h3 style="margin:0">${esc(c.name)}</h3></div>
    <h3 style="margin-top:1rem">${L('Sediakan Mod Kiosk', 'Set Up Kiosk Mode')}</h3>
    <p class="small muted">${L('Tablet ini akan digunakan oleh semua pekerja untuk punch dengan ID + PIN atau kad QR pekerja.', 'This tablet will be used by all staff to punch with ID + PIN or their QR staff card.')}</p>
    <div class="field"><label class="lbl">${L('Lokasi kiosk', 'Kiosk location')}</label>
      <select class="input" id="kl"><option value="">${L('Tiada lokasi tertentu', 'No specific location')}</option>${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
    <label class="check" style="margin-bottom:1rem"><input type="checkbox" id="ks" ${c.settings?.selfie !== false ? 'checked' : ''}>${L('Ambil selfie semasa punch', 'Take a selfie when punching')}</label>
    <button class="btn btn-primary btn-block" id="kgo">${L('Mula Kiosk', 'Start Kiosk')}</button>
    <p class="xs muted" style="margin-top:.6rem">${L('Selepas mula, sesi admin pada tablet ini akan dilog keluar supaya pekerja tidak boleh masuk ke halaman admin.', 'After starting, the admin session on this tablet is logged out so staff cannot access the admin page.')}</p>
  </div></div>`;
  $('#kgo').onclick = async () => {
    const lid = $('#kl').value;
    const conf = { cid, code: c.code, name: c.name, logo: c.logo || '', color: c.color || '', lid, locName: locs.find(l => l.id === lid)?.name || '', selfie: $('#ks').checked };
    try { localStorage.setItem(KEY, JSON.stringify(conf)); } catch {}
    await signOut(auth).catch(() => {});
    renderKiosk(conf);
  };
}

// ---------------------------------------------------------------- KIOSK
let clockT = 0, idleT = 0;
function renderKiosk(c) {
  applyBrand(c);
  let field = 'id', idVal = '', pinVal = '';
  app.innerHTML = `
  <div class="kiosk" style="justify-content:flex-start;padding-top:2rem">
    <div class="row" style="justify-content:space-between;width:100%;max-width:720px">
      <div class="row">${logoHtml(c, 'logo-lg')}<div style="text-align:left"><h2 style="margin:0">${esc(c.name)}</h2><div style="opacity:.85">${esc(c.locName || '')}</div></div></div>
      <div>${langBtn()}</div>
    </div>
    <div class="big-time" id="kc" style="font-size:3.4rem">--:--:--</div>
    <div id="kd" style="opacity:.85;margin-top:-.6rem"></div>
    <div style="width:100%;max-width:360px">
      <div class="klabel">${L('ID Pekerja', 'Staff ID')}</div>
      <div class="kfield on" id="fid"></div>
      <div class="klabel">PIN</div>
      <div class="kfield" id="fpin"></div>
    </div>
    <div class="kpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
      <button data-k="del">⌫</button><button data-k="0">0</button><button data-k="ok" style="background:var(--gold);color:var(--on-brand)">OK</button></div>
    <button class="btn btn-ghost" id="kscan" style="margin-top:.4rem">${icon('qr', 18)} ${L('Imbas kad pekerja', 'Scan staff card')}</button>
    <button class="link-btn xs" id="kreset" style="color:var(--muted);margin-top:1rem">${L('Tetapan kiosk', 'Kiosk settings')}</button>
  </div>`;
  const draw = () => {
    $('#fid').textContent = idVal ? c.code + idVal : c.code + '…';
    $('#fpin').textContent = '•'.repeat(pinVal.length);
    $('#fid').classList.toggle('on', field === 'id'); $('#fpin').classList.toggle('on', field === 'pin');
  };
  const reset = () => { idVal = ''; pinVal = ''; field = 'id'; draw(); };
  const bump = () => { clearTimeout(idleT); idleT = setTimeout(reset, 30000); };
  draw();
  $('#fid').onclick = () => { field = 'id'; draw(); };
  $('#fpin').onclick = () => { field = 'pin'; draw(); };
  $$('[data-k]').forEach(b => b.onclick = async () => {
    bump();
    const k = b.dataset.k;
    if (k === 'del') { if (field === 'pin' && pinVal) pinVal = pinVal.slice(0, -1); else if (field === 'pin') field = 'id'; else idVal = idVal.slice(0, -1); }
    else if (k === 'ok') {
      if (field === 'id') { if (idVal) field = 'pin'; }
      else if (pinVal.length === 6) { const id = c.code + idVal, pin = pinVal; reset(); await doPunch(c, id, pin); }
    } else if (field === 'id') { if (idVal.length < 6) idVal += k; }
    else if (pinVal.length < 6) { pinVal += k; if (pinVal.length === 6) { const id = c.code + idVal, pin = pinVal; reset(); await doPunch(c, id, pin); } }
    draw();
  });
  $('#kscan').onclick = async () => {
    const t = await scanQR();
    const m = String(t || '').match(/^PAW\|([A-Z]{2,6})(\d+)$/);
    if (!m) { if (t) toast(L('Kad tidak sah.', 'Invalid card.'), 'bad'); return; }
    if (m[1] !== c.code) return toast(L('Kad ini milik syarikat lain.', 'This card belongs to another company.'), 'bad');
    idVal = m[2]; field = 'pin'; draw(); bump();
  };
  $('#kreset').onclick = () => modal({
    title: L('Tetapan kiosk', 'Kiosk settings'),
    body: `<p class="small">${L('Untuk tukar tetapan, log masuk admin semula selepas menetapkan semula kiosk.', 'To change settings, log in as admin again after resetting the kiosk.')}</p>`,
    actions: [{ label: L('Batal', 'Cancel') }, { label: L('Tetapkan semula kiosk', 'Reset kiosk'), cls: 'btn-danger', onClick: () => { localStorage.removeItem(KEY); location.reload(); } }]
  });
  const tick = () => {
    const d = new Date();
    if (!$('#kc')) return;
    $('#kc').textContent = d.toLocaleTimeString('en-GB');
    $('#kd').textContent = d.toLocaleDateString(L('ms-MY', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  clearInterval(clockT); tick(); clockT = setInterval(tick, 1000);
  try { navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('langchange', () => { const c = cfg(); if (c) renderKiosk(c); });

async function doPunch(c, id, pin) {
  const wait = modal({ title: L('Sila tunggu…', 'Please wait…'), body: `<div class="loader" style="min-height:80px"><span class="spin"></span></div>`, closable: false });
  try {
    const cred = await signInWithEmailAndPassword(kAuth, workerEmail(id), pin);
    const uid = cred.user.uid;
    const me = (await getDoc(doc(kDb, 'users', uid))).data();
    if (!me || me.role !== 'worker' || me.cid !== c.cid) throw new Error(L('Akaun bukan pekerja syarikat ini.', 'Not a staff account of this company.'));
    const [wS, cS] = await Promise.all([getDoc(doc(kDb, 'companies', c.cid, 'workers', me.workerId)), getDoc(doc(kDb, 'companies', c.cid))]);
    const w = wS.data(), co = cS.data();
    if (!w || w.active === false) throw new Error(L('Akaun dinyahaktifkan.', 'Account deactivated.'));
    if (isExpired(co)) throw new Error(L('Sistem tergendala. Sila rujuk majikan.', 'System unavailable. Contact your employer.'));
    // Rekod hari ini & semalam (syif malam)
    const t = todayStr(), y = addDays(t, -1);
    const s = await getDocs(query(collection(kDb, 'companies', c.cid, 'attendance'), where('uid', '==', uid), where('date', '>=', y), where('date', '<=', t)));
    const recs = s.docs.map(d => d.data()).filter(r => r.type !== 'visit').sort((a, b) => (punchTime(a)?.getTime() || 0) - (punchTime(b)?.getTime() || 0));
    const tR = recs.filter(r => r.date === t), yR = recs.filter(r => r.date === y);
    const yLast = yR[yR.length - 1];
    const yOpen = yLast && yLast.type !== 'out' && (Date.now() - (punchTime(yR.find(r => r.type === 'in'))?.getTime() || 0)) < 16 * 3600000;
    const sessionDate = !tR.length && yOpen ? y : t;
    const cur = sessionDate === t ? tR : yR;
    const lt = summarizeDay(cur, {}, sessionDate).lastType;
    const acts = !lt || lt === 'out' ? ['in'] : lt === 'break_in' ? ['break_out'] : ['out', 'break_in'];
    wait.close();
    const choice = await new Promise(res => {
      let done = false;
      const m = modal({
        title: `${esc(w.name)} · ${esc(id)}`,
        body: `<div class="center">
          ${cur.length ? `<p class="small muted">${cur.map(r => `${TYPE_LABEL[r.type]()} ${fmtTime(punchTime(r))}`).join(' · ')}</p>` : ''}
          <div class="stack">${acts.map((a, i) => `<button class="btn ${i === 0 ? (a === 'in' ? 'btn-ok' : a === 'out' ? 'btn-danger' : 'btn-warn') : 'btn-ghost'} btn-block" style="font-size:1.2rem;padding:1rem" data-ch="${a}">${TYPE_LABEL[a]()}</button>`).join('')}</div></div>`,
        onClose: () => { if (!done) res(null); }
      });
      $$('[data-ch]', m.el).forEach(b => b.onclick = () => { done = true; m.close(); res(b.dataset.ch); });
      setTimeout(() => { if (!done) { done = true; m.close(); res(null); } }, 20000);
    });
    if (!choice) return;
    let selfie = null;
    if (c.selfie) {
      const now = new Date();
      selfie = await takeSelfie(`${w.name} (${id})\n${TYPE_LABEL[choice]()} · ${fmtDate(now)} ${now.toLocaleTimeString('en-GB')} · Kiosk`);
      if (!selfie) return;
    }
    const ref = doc(collection(kDb, 'companies', c.cid, 'attendance'));
    const b = writeBatch(kDb);
    b.set(ref, {
      uid, workerId: me.workerId, name: w.name, type: choice, ts: serverTimestamp(), date: choice === 'in' ? t : sessionDate,
      lid: c.lid || null, locName: c.locName || 'Kiosk', method: 'kiosk', lat: null, lng: null, acc: null, dist: null,
      selfie: null, hasSelfie: !!selfie, deviceId: getDeviceId(), dept: w.dept || '', clientTs: Date.now(), offline: false
    });
    if (selfie) b.set(doc(kDb, 'companies', c.cid, 'selfies', ref.id), { uid, workerId: me.workerId, selfie, at: serverTimestamp() });
    await b.commit();
    modal({ title: '✓', body: `<div class="center"><h2>${TYPE_LABEL[choice]()}</h2><p class="big-time" style="font-size:2.4rem">${fmtTime(new Date())}</p><p>${esc(w.name)}</p></div>` });
    setTimeout(() => $$('.modal-bg').forEach(x => x.remove()), 3000);
  } catch (e) {
    wait.close();
    toast(e.code ? authErr(e) : (e.message || String(e)), 'bad', 5000);
  } finally {
    signOut(kAuth).catch(() => {});
  }
}

start();
applyLang();
