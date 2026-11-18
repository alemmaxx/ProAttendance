// ProAttendance — Super Admin (pemilik sistem)
import { auth, db } from './fb.js';
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, collection, query, orderBy, limit, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  $, $$, L, esc, toast, modal, confirmBox, busy, langBtn, fmtDate, fmtDateTime, toDate, isExpired, daysLeft,
  money, authErr, icon, applyBrand
} from './ui.js';

const app = $('#app');
const S = { user: null, view: 'companies', companies: [], payments: [], plans: {} };
applyBrand({ color: '#0f172a' });

function renderLogin() {
  app.innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="lf">
      <div class="row between"><span class="badge">Super Admin</span>${langBtn()}</div>
      <div class="login-brand" style="margin-top:.6rem"><span class="logo-lg logo-ini">${icon('shield', 38)}</span><h2>ProAttendance</h2></div>
      <div class="field"><label class="lbl">${L('E-mel', 'Email')}</label><input class="input" type="email" id="em" required></div>
      <div class="field"><label class="lbl">${L('Kata laluan', 'Password')}</label><div class="pw"><input class="input" type="password" id="pw" required><button type="button" data-eye>${icon('eye', 18)}</button></div></div>
      <button class="btn btn-primary btn-block" id="lb">${L('Log Masuk', 'Log In')}</button>
      <div class="divider">${L('atau', 'or')}</div>
      <button type="button" class="btn btn-ghost btn-block" id="gb">Google</button>
    </form>
  </div>`;
  $('#gb').onclick = () => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => toast(authErr(e), 'bad'));
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); const b = $('#lb'); busy(b, true);
    try { await signInWithEmailAndPassword(auth, $('#em').value.trim(), $('#pw').value); }
    catch (err) { toast(authErr(err), 'bad'); busy(b, false); }
  };
}

onAuthStateChanged(auth, async (u) => {
  S.user = u;
  if (!u) return renderLogin();
  app.innerHTML = `<div class="loader"><span class="spin"></span></div>`;
  const sup = await getDoc(doc(db, 'config', 'super')).catch(() => null);
  if (!sup || !sup.exists()) return renderClaim();
  if (sup.data().uid !== u.uid) {
    app.innerHTML = `<div class="blocked"><div class="card"><h3>${L('Akses ditolak', 'Access denied')}</h3><p>${esc(u.email)}</p>
      <button class="btn btn-ghost" id="lo">${L('Log Keluar', 'Log Out')}</button></div></div>`;
    $('#lo').onclick = () => signOut(auth);
    return;
  }
  renderShell();
});

function renderClaim() {
  app.innerHTML = `<div class="blocked"><div class="card" style="max-width:460px">
    <h3>${L('Tetapkan Super Admin', 'Set Up Super Admin')}</h3>
    <p>${L('Belum ada Super Admin. Jadikan akaun ini sebagai Super Admin ProAttendance?', 'No Super Admin yet. Make this account the ProAttendance Super Admin?')}</p>
    <p class="bold">${esc(S.user.email)}</p>
    <p class="small muted">${L('Langkah ini hanya boleh dibuat sekali.', 'This can only be done once.')}</p>
    <div class="row" style="justify-content:flex-end;margin-top:1rem">
      <button class="btn btn-ghost" id="lo">${L('Log Keluar', 'Log Out')}</button>
      <button class="btn btn-primary" id="cl">${L('Ya, jadikan Super Admin', 'Yes, make Super Admin')}</button></div></div></div>`;
  $('#lo').onclick = () => signOut(auth);
  $('#cl').onclick = async () => {
    try {
      await setDoc(doc(db, 'config', 'super'), { uid: S.user.uid, email: S.user.email || '', at: serverTimestamp() });
      await setDoc(doc(db, 'config', 'plans'), { trialDays: 14, monthly: 29, sixMonth: 159, yearly: 290 }, { merge: true });
      toast('OK'); renderShell();
    } catch (e) { toast(authErr(e), 'bad'); }
  };
}

const NAV = () => [
  ['companies', 'building', L('Syarikat', 'Companies')],
  ['plans', 'money', L('Pakej & Harga', 'Plans & Pricing')],
  ['payments', 'card', L('Bayaran', 'Payments')],
  ['stats', 'chart', L('Statistik', 'Statistics')]
];

function renderShell() {
  app.innerHTML = `
  <div class="shell">
    <aside class="side" id="side">
      <div class="side-brand"><span class="logo logo-ini">${icon('shield', 22)}</span><div><div class="nm">ProAttendance</div><div class="xs" style="opacity:.7">Super Admin</div></div></div>
      <nav>${NAV().map(([k, ic, t]) => `<button data-v="${k}">${icon(ic)}<span>${t}</span></button>`).join('')}</nav>
      <div class="side-foot"><div class="xs" style="opacity:.75">${esc(S.user.email)}</div>
        <div class="row" style="margin-top:.5rem">${langBtn()}<button class="btn btn-sm btn-ghost" id="lo">${L('Keluar', 'Logout')}</button></div></div>
    </aside>
    <div class="side-bg" id="sideBg"></div>
    <div class="main">
      <header class="topbar"><button class="icon-btn menu-btn" id="menuBtn">${icon('menu', 22)}</button><h1 id="vTitle"></h1></header>
      <div class="content" id="view"></div>
    </div>
  </div>`;
  $$('.side nav button').forEach(b => b.onclick = () => { go(b.dataset.v); $('#side').classList.remove('open'); $('#sideBg').classList.remove('open'); });
  $('#menuBtn').onclick = () => { $('#side').classList.add('open'); $('#sideBg').classList.add('open'); };
  $('#sideBg').onclick = () => { $('#side').classList.remove('open'); $('#sideBg').classList.remove('open'); };
  $('#lo').onclick = () => signOut(auth);
  go(S.view);
}
document.addEventListener('langchange', () => { if (S.user && $('.shell')) renderShell(); });

function go(v) {
  S.view = v;
  $$('.side nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#vTitle').textContent = NAV().find(n => n[0] === v)[2];
  ({ companies: viewCompanies, plans: viewPlans, payments: viewPayments, stats: viewStats })[v]();
}

const loading = () => { $('#view').innerHTML = `<div class="loader" style="min-height:200px"><span class="spin"></span></div>`; };
async function loadCompanies() {
  const s = await getDocs(collection(db, 'companies'));
  S.companies = s.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}
async function loadPayments() {
  const s = await getDocs(query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(500)));
  S.payments = s.docs.map(d => ({ id: d.id, ...d.data() }));
}
const statusBadge = c => c.status === 'suspended' ? `<span class="badge b-bad">${L('Digantung', 'Suspended')}</span>`
  : isExpired(c) ? `<span class="badge b-bad">${L('Tamat', 'Expired')}</span>`
  : c.status === 'trial' ? `<span class="badge b-warn">${L('Percubaan', 'Trial')}</span>`
  : `<span class="badge b-ok">${L('Aktif', 'Active')}</span>`;

// ---------- Syarikat ----------
async function viewCompanies() {
  loading();
  try { await loadCompanies(); } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; return; }
  $('#view').innerHTML = `
  <div class="card">
    <div class="card-head"><input class="input" id="q" style="max-width:300px" placeholder="${L('Cari nama / kod / e-mel…', 'Search name / code / email…')}">
      <select class="input" id="fs" style="width:auto"><option value="">${L('Semua', 'All')}</option><option value="trial">${L('Percubaan', 'Trial')}</option>
        <option value="active">${L('Aktif', 'Active')}</option><option value="expired">${L('Tamat', 'Expired')}</option><option value="suspended">${L('Digantung', 'Suspended')}</option></select></div>
    <div id="cl"></div>
  </div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), f = $('#fs').value;
    const list = S.companies.filter(c => (!q || [c.name, c.code, c.ownerEmail, c.phone].join(' ').toLowerCase().includes(q))
      && (!f || (f === 'expired' ? isExpired(c) && c.status !== 'suspended' : f === 'suspended' ? c.status === 'suspended' : c.status === f && !isExpired(c))));
    $('#cl').innerHTML = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>${L('Syarikat', 'Company')}</th><th>${L('Pemilik', 'Owner')}</th><th>${L('Pekerja', 'Staff')}</th><th>${L('Status', 'Status')}</th><th>${L('Tamat', 'Expiry')}</th><th></th></tr></thead>
      <tbody>${list.map(c => `<tr>
        <td><b>${esc(c.name)}</b><div class="xs muted mono">${esc(c.code)} · ${fmtDate(c.createdAt)}</div></td>
        <td class="small">${esc(c.ownerEmail || '')}<div class="xs muted">${esc(c.phone || '')}</div></td>
        <td>${c.workerCount || 0}</td>
        <td>${statusBadge(c)}</td>
        <td class="small">${fmtDate(c.expiry)}<div class="xs muted">${daysLeft(c)} ${L('hari', 'days')}</div></td>
        <td class="right"><button class="btn btn-sm btn-ghost" data-c="${c.id}">${L('Urus', 'Manage')}</button></td></tr>`).join('')}</tbody></table></div>
      <p class="xs muted" style="margin-top:.5rem">${list.length} ${L('syarikat', 'companies')}</p>`
      : `<div class="empty">${L('Tiada syarikat.', 'No companies.')}</div>`;
    $$('[data-c]').forEach(b => b.onclick = () => manage(S.companies.find(c => c.id === b.dataset.c)));
  };
  $('#q').oninput = draw; $('#fs').onchange = draw; draw();
}

function manage(c) {
  const exp = toDate(c.expiry) || new Date();
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const m = modal({
    title: esc(c.name),
    body: `
      <div class="set-row"><span class="muted">${L('Kod', 'Code')}</span><b class="mono">${esc(c.code)}</b></div>
      <div class="set-row"><span class="muted">${L('Pemilik', 'Owner')}</span><b>${esc(c.ownerEmail || '-')}</b></div>
      <div class="set-row"><span class="muted">${L('Telefon', 'Phone')}</span><b>${esc(c.phone || '-')}
        ${c.phone ? ` <a class="btn btn-sm btn-ok" target="_blank" href="https://wa.me/${String(c.phone).replace(/\D/g, '').replace(/^0/, '60')}">WhatsApp</a>` : ''}</b></div>
      <div class="set-row"><span class="muted">${L('Status', 'Status')}</span>${statusBadge(c)}</div>
      <div class="sec-title">${L('Tarikh tamat langganan', 'Subscription expiry')}</div>
      <div class="row"><input class="input" type="date" id="ex" value="${ymd(exp)}" style="max-width:200px">
        <button class="btn btn-sm btn-soft" data-add="7">+7</button><button class="btn btn-sm btn-soft" data-add="30">+30</button><button class="btn btn-sm btn-soft" data-add="365">+365</button></div>
      <div class="sec-title">${L('Status akaun', 'Account status')}</div>
      <select class="input" id="stt">
        <option value="trial" ${c.status === 'trial' ? 'selected' : ''}>${L('Percubaan', 'Trial')}</option>
        <option value="active" ${c.status === 'active' ? 'selected' : ''}>${L('Aktif', 'Active')}</option>
        <option value="suspended" ${c.status === 'suspended' ? 'selected' : ''}>${L('Digantung', 'Suspended')}</option></select>`,
    actions: [
      { label: L('Batal', 'Cancel') },
      {
        label: L('Simpan', 'Save'), cls: 'btn-primary', onClick: async ({ el }) => {
          const d = new Date($('#ex', el).value + 'T23:59:59');
          if (isNaN(d)) { toast(L('Tarikh tidak sah', 'Invalid date'), 'warn'); return false; }
          const status = $('#stt', el).value;
          try {
            await updateDoc(doc(db, 'companies', c.id), { expiry: Timestamp.fromDate(d), status, ...(status === 'active' && c.plan === 'trial' ? { plan: 'manual' } : {}) });
            toast(L('Dikemas kini.', 'Updated.')); viewCompanies();
          } catch (e) { toast(authErr(e), 'bad'); return false; }
        }
      }
    ]
  });
  $$('[data-add]', m.el).forEach(b => b.onclick = () => {
    const base = new Date(Math.max(Date.now(), new Date($('#ex', m.el).value + 'T00:00:00').getTime()));
    base.setDate(base.getDate() + Number(b.dataset.add));
    $('#ex', m.el).value = ymd(base);
  });
}

// ---------- Pakej ----------
async function viewPlans() {
  loading();
  const s = await getDoc(doc(db, 'config', 'plans'));
  const p = s.exists() ? s.data() : {};
  $('#view').innerHTML = `
  <div class="card" style="max-width:640px">
    <h3>${L('Pakej & Harga Langganan', 'Subscription Plans & Pricing')}</h3>
    <p class="small muted">${L('Letak harga 0 untuk sembunyikan pakej.', 'Set a price to 0 to hide a plan.')}</p>
    <div class="grid2" style="margin-top:.8rem">
      <div class="field"><label class="lbl">${L('Tempoh percubaan percuma (hari)', 'Free trial length (days)')}</label><input class="input" type="number" min="0" max="365" id="td" value="${p.trialDays ?? 14}"></div>
      <div class="field"><label class="lbl">${L('Bulanan (RM)', 'Monthly (RM)')}</label><input class="input" type="number" min="0" step="0.01" id="pm" value="${p.monthly ?? 0}"></div>
      <div class="field"><label class="lbl">${L('6 Bulan (RM)', '6 Months (RM)')}</label><input class="input" type="number" min="0" step="0.01" id="p6" value="${p.sixMonth ?? 0}"></div>
      <div class="field"><label class="lbl">${L('Tahunan (RM)', 'Yearly (RM)')}</label><input class="input" type="number" min="0" step="0.01" id="py" value="${p.yearly ?? 0}"></div>
    </div>
    <button class="btn btn-primary" id="sv" style="margin-top:.8rem">${L('Simpan', 'Save')}</button>
  </div>`;
  $('#sv').onclick = async (e) => {
    busy(e.currentTarget, true);
    try {
      await setDoc(doc(db, 'config', 'plans'), {
        trialDays: Math.round(Number($('#td').value || 0)), monthly: Number($('#pm').value || 0),
        sixMonth: Number($('#p6').value || 0), yearly: Number($('#py').value || 0)
      }, { merge: true });
      toast(L('Disimpan.', 'Saved.'));
    } catch (err) { toast(authErr(err), 'bad'); }
    finally { busy(e.currentTarget, false); }
  };
}

// ---------- Bayaran ----------
async function viewPayments() {
  loading();
  try { await Promise.all([loadPayments(), S.companies.length ? null : loadCompanies()]); }
  catch (e) { $('#view').innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; return; }
  const cn = id => S.companies.find(c => c.id === id)?.name || id;
  $('#view').innerHTML = `<div class="card">${S.payments.length ? `<div class="table-wrap"><table>
    <thead><tr><th>${L('Tarikh', 'Date')}</th><th>${L('Syarikat', 'Company')}</th><th>${L('Pakej', 'Plan')}</th><th>${L('Jumlah', 'Amount')}</th><th>${L('Status', 'Status')}</th><th>Bill</th></tr></thead>
    <tbody>${S.payments.map(p => `<tr><td class="small">${fmtDateTime(p.createdAt)}</td><td>${esc(cn(p.cid))}</td><td>${esc(p.plan)}</td><td>${money(p.amount)}</td>
      <td><span class="badge ${p.status === 'paid' ? 'b-ok' : p.status === 'failed' ? 'b-bad' : 'b-warn'}">${esc(p.status)}</span></td><td class="xs mono">${esc(p.billCode || '')}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">${L('Tiada bayaran.', 'No payments.')}</div>`}</div>`;
}

// ---------- Statistik ----------
async function viewStats() {
  loading();
  try { await Promise.all([loadCompanies(), loadPayments()]); }
  catch (e) { $('#view').innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; return; }
  const cs = S.companies;
  const active = cs.filter(c => !isExpired(c) && c.status === 'active').length;
  const trial = cs.filter(c => !isExpired(c) && c.status === 'trial').length;
  const expired = cs.filter(c => isExpired(c)).length;
  const workers = cs.reduce((a, c) => a + (c.workerCount || 0), 0);
  const paid = S.payments.filter(p => p.status === 'paid');
  const ym = new Date().toISOString().slice(0, 7);
  const monthRev = paid.filter(p => (toDate(p.paidAt || p.createdAt)?.toISOString() || '').startsWith(ym)).reduce((a, p) => a + Number(p.amount || 0), 0);
  const totalRev = paid.reduce((a, p) => a + Number(p.amount || 0), 0);
  $('#view').innerHTML = `
  <div class="stats">
    <div class="stat"><div class="n">${cs.length}</div><div class="t">${L('Jumlah syarikat', 'Total companies')}</div></div>
    <div class="stat ok"><div class="n">${active}</div><div class="t">${L('Aktif berbayar', 'Paid active')}</div></div>
    <div class="stat warn"><div class="n">${trial}</div><div class="t">${L('Percubaan', 'Trial')}</div></div>
    <div class="stat bad"><div class="n">${expired}</div><div class="t">${L('Tamat / digantung', 'Expired / suspended')}</div></div>
    <div class="stat info"><div class="n">${workers}</div><div class="t">${L('Jumlah pekerja', 'Total staff')}</div></div>
    <div class="stat ok"><div class="n" style="font-size:1.25rem">${money(monthRev)}</div><div class="t">${L('Hasil bulan ini', 'Revenue this month')}</div></div>
    <div class="stat"><div class="n" style="font-size:1.25rem">${money(totalRev)}</div><div class="t">${L('Jumlah hasil', 'Total revenue')}</div></div>
  </div>
  <div class="card"><h3>${L('Akan tamat dalam 7 hari', 'Expiring within 7 days')}</h3>
    ${cs.filter(c => !isExpired(c) && daysLeft(c) <= 7).map(c => `<div class="set-row"><span>${esc(c.name)} <span class="xs muted">${esc(c.phone || '')}</span></span>${statusBadge(c)} <b>${daysLeft(c)} ${L('hari', 'days')}</b></div>`).join('')
      || `<div class="empty small">${L('Tiada.', 'None.')}</div>`}
  </div>`;
}
