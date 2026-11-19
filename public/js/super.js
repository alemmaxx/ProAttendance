// ProAttendance — Super Admin (pemilik sistem)
import { auth, db } from './fb.js';
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, orderBy, limit, serverTimestamp, Timestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  $, $$, L, esc, toast, modal, confirmBox, busy, langBtn, fmtDate, fmtDateTime, toDate, isExpired, daysLeft,
  money, authErr, icon, applyBrand, copyText, todayStr
} from './ui.js';

const app = $('#app');
const S = { user: null, view: 'companies', companies: [], payments: [], plans: {} };
applyBrand({ color: '#d9b44a' });

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
  ['promos', 'plus', L('Kod Promo', 'Promo Codes')],
  ['agents', 'users', L('Agen / Reseller', 'Agents / Resellers')],
  ['kit', 'chat', L('Kit Promosi', 'Promo Kit')],
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
      <header class="topbar"><button class="icon-btn menu-btn" id="menuBtn">${icon('menu', 22)}</button><h1 id="vTitle"></h1>
        <a class="btn btn-sm btn-primary" href="/admin.html" target="_blank">${icon('building', 16)} ${L('Admin Syarikat', 'Company Admin')}</a></header>
      <div class="content"><div class="pghero no-print"><div class="tag" id="vTag"></div><h2 class="gold-h" id="vH"></h2><p class="sub" id="vSub"></p></div><div id="view"></div></div>
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
  $('#vTag').textContent = '✦ Super Admin';
  $('#vH').textContent = NAV().find(n => n[0] === v)[2] + '.';
  $('#vSub').textContent = 'ProAttendance';
  ({ companies: viewCompanies, plans: viewPlans, payments: viewPayments, stats: viewStats, promos: viewPromos, agents: viewAgents, kit: viewKit })[v]();
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
  <div class="card" style="border-color:var(--gold);background:var(--gold2)">
    <h3 style="margin-top:0">${icon('building', 18)} ${L('Halaman Admin Syarikat', 'Company Admin Page')}</h3>
    <p class="small muted">${L('Buka halaman admin untuk syarikat anda sendiri / demo. Untuk syarikat pelanggan, tekan "Buka" pada senarai di bawah (mod sokongan).', 'Open the admin page for your own / demo company. For client companies, press "Open" in the list below (support mode).')}</p>
    <div class="row">
      <a class="btn btn-primary" href="/admin.html" target="_blank">${icon('building', 16)} ${L('Buka Admin Syarikat Saya', 'Open My Company Admin')}</a>
      <a class="btn btn-ghost" href="/admin.html?register=1" target="_blank">${icon('plus', 16)} ${L('Daftar Syarikat Demo Baharu', 'Register New Demo Company')}</a>
      <a class="btn btn-ghost" href="/" target="_blank">${icon('users', 16)} ${L('Halaman Pekerja', 'Staff Page')}</a>
    </div>
  </div>
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
        <td class="right" style="white-space:nowrap"><a class="btn btn-sm btn-soft" href="/admin.html?cid=${c.id}" target="_blank">${L('Buka', 'Open')}</a>
          <button class="btn btn-sm btn-ghost" data-c="${c.id}">${L('Urus', 'Manage')}</button></td></tr>`).join('')}</tbody></table></div>
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
      <div class="field"><label class="lbl">${L('No. WhatsApp jualan (landing page)', 'Sales WhatsApp no. (landing page)')}</label><input class="input" id="pw" value="${esc(p.salesPhone || '')}" placeholder="60123456789"></div>
    </div>
    <button class="btn btn-primary" id="sv" style="margin-top:.8rem">${L('Simpan', 'Save')}</button>
  </div>`;
  $('#sv').onclick = async (e) => {
    busy(e.currentTarget, true);
    try {
      await setDoc(doc(db, 'config', 'plans'), {
        trialDays: Math.round(Number($('#td').value || 0)), monthly: Number($('#pm').value || 0),
        sixMonth: Number($('#p6').value || 0), yearly: Number($('#py').value || 0), salesPhone: $('#pw').value.replace(/\D/g, '')
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
  <div class="card"><h3>${L('Ikut agen (bulan ini)', 'By agent (this month)')}</h3>
    ${(() => {
      const by = {};
      paid.filter(p => p.ref && (toDate(p.paidAt || p.createdAt)?.toISOString() || '').startsWith(ym)).forEach(p => { by[p.ref] = (by[p.ref] || 0) + Number(p.amount || 0); });
      const refs = cs.reduce((m, c) => { if (c.ref) m[c.ref] = (m[c.ref] || 0) + 1; return m; }, {});
      const keys = [...new Set([...Object.keys(by), ...Object.keys(refs)])];
      return keys.length ? keys.map(k => `<div class="set-row"><span class="mono">${esc(k)}</span><span class="small">${refs[k] || 0} ${L('syarikat', 'companies')} · ${money(by[k] || 0)}</span></div>`).join('') : `<div class="empty small">${L('Tiada.', 'None.')}</div>`;
    })()}
  </div>
  <div class="card"><h3>${L('Akan tamat dalam 7 hari', 'Expiring within 7 days')}</h3>
    ${cs.filter(c => !isExpired(c) && daysLeft(c) <= 7).map(c => `<div class="set-row"><span>${esc(c.name)} <span class="xs muted">${esc(c.phone || '')}</span></span>${statusBadge(c)} <b>${daysLeft(c)} ${L('hari', 'days')}</b></div>`).join('')
      || `<div class="empty small">${L('Tiada.', 'None.')}</div>`}
  </div>`;
}


// ---------- Kod promo ----------
async function viewPromos() {
  loading();
  let list = [];
  try { const s = await getDocs(query(collection(db, 'promos'), orderBy('createdAt', 'desc'), limit(300))); list = s.docs.map(d => ({ code: d.id, ...d.data() })); }
  catch (e) { $('#view').innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; return; }
  $('#view').innerHTML = `
  <div class="card">
    <h3>${L('Jana Kod Promo (sekali guna)', 'Generate Promo Codes (single-use)')}</h3>
    <div class="grid3">
      <div class="field"><label class="lbl">${L('Jenis', 'Type')}</label><select class="input" id="ptype"><option value="days">${L('Tambah hari langganan', 'Add subscription days')}</option><option value="percent">${L('Diskaun % semasa bayar', '% discount at payment')}</option></select></div>
      <div class="field"><label class="lbl">${L('Nilai (hari / %)', 'Value (days / %)')}</label><input class="input" type="number" min="1" id="pval" value="30"></div>
      <div class="field"><label class="lbl">${L('Bilangan kod', 'Number of codes')}</label><input class="input" type="number" min="1" max="200" id="pn" value="5"></div>
    </div>
    <div class="field"><label class="lbl">${L('Awalan (pilihan)', 'Prefix (optional)')}</label><input class="input id-input" id="ppre" maxlength="6" style="max-width:200px" placeholder="TIKTOK"></div>
    <button class="btn btn-primary" id="pgen">${icon('plus', 18)} ${L('Jana', 'Generate')}</button>
  </div>
  <div class="card"><div class="card-head"><h3>${L('Senarai Kod', 'Codes')}</h3><button class="btn btn-sm btn-ghost" id="pcopy">${L('Salin kod belum guna', 'Copy unused codes')}</button></div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>${L('Kod', 'Code')}</th><th>${L('Jenis', 'Type')}</th><th>${L('Status', 'Status')}</th><th></th></tr></thead><tbody>
      ${list.map(p => `<tr><td class="mono bold">${esc(p.code)}</td><td>${p.type === 'days' ? `+${p.value} ${L('hari', 'days')}` : `-${p.value}%`}</td>
        <td>${p.used ? `<span class="badge">${L('Digunakan', 'Used')}${p.usedByName ? ' · ' + esc(p.usedByName) : ''}</span>` : `<span class="badge b-ok">${L('Aktif', 'Active')}</span>`}</td>
        <td>${!p.used ? `<button class="icon-btn" data-pdel="${esc(p.code)}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${L('Belum ada kod.', 'No codes yet.')}</div>`}</div>`;
  $('#pgen').onclick = async (e) => {
    const type = $('#ptype').value, value = Number($('#pval').value || 0), n = Math.min(200, Number($('#pn').value || 1));
    const pre = $('#ppre').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!(value > 0) || (type === 'percent' && value > 100)) return toast(L('Nilai tidak sah.', 'Invalid value.'), 'warn');
    busy(e.currentTarget, true);
    try {
      const b = writeBatch(db);
      for (let i = 0; i < n; i++) {
        const code = (pre ? pre + '-' : '') + Array.from(crypto.getRandomValues(new Uint8Array(6))).map(x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
        b.set(doc(db, 'promos', code), { type, value, used: false, createdAt: serverTimestamp() });
      }
      await b.commit();
      toast(L('Kod dijana.', 'Codes generated.')); viewPromos();
    } catch (err) { toast(authErr(err), 'bad'); busy(e.currentTarget, false); }
  };
  $('#pcopy').onclick = () => copyText(list.filter(p => !p.used).map(p => `${p.code} (${p.type === 'days' ? '+' + p.value + ' hari' : '-' + p.value + '%'})`).join('\n'));
  $$('[data-pdel]').forEach(b => b.onclick = async () => { if (await confirmBox(L('Padam kod ini?', 'Delete this code?'))) { await deleteDoc(doc(db, 'promos', b.dataset.pdel)); viewPromos(); } });
}

// ---------- Agen / reseller ----------
async function viewAgents() {
  loading();
  let list = [];
  try { const s = await getDocs(collection(db, 'agents')); list = s.docs.map(d => ({ code: d.id, ...d.data() })); }
  catch (e) { $('#view').innerHTML = `<div class="empty">${esc(authErr(e))}</div>`; return; }
  if (!S.companies.length) { try { await loadCompanies(); } catch {} }
  if (!S.payments.length) { try { await loadPayments(); } catch {} }
  const base = location.origin + '/landing.html?ref=';
  $('#view').innerHTML = `
  <div class="card">
    <h3>${L('Tambah Agen', 'Add Agent')}</h3>
    <p class="small muted">${L('Setiap agen dapat pautan khas. Syarikat yang mendaftar melalui pautan itu direkod di bawah agen tersebut.', 'Each agent gets a special link. Companies that sign up through it are recorded under that agent.')}</p>
    <div class="grid3">
      <div class="field"><label class="lbl">${L('Kod agen', 'Agent code')}</label><input class="input id-input" id="ac" maxlength="12"></div>
      <div class="field"><label class="lbl">${L('Nama', 'Name')}</label><input class="input" id="an"></div>
      <div class="field"><label class="lbl">${L('Komisen (%)', 'Commission (%)')}</label><input class="input" type="number" min="0" max="100" id="ap" value="20"></div>
    </div>
    <div class="field"><label class="lbl">${L('No. telefon', 'Phone')}</label><input class="input" id="at" style="max-width:240px"></div>
    <button class="btn btn-primary" id="aadd">${icon('plus', 18)} ${L('Tambah', 'Add')}</button>
  </div>
  <div class="card"><h3>${L('Senarai Agen', 'Agents')}</h3>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>${L('Kod', 'Code')}</th><th>${L('Nama', 'Name')}</th><th>${L('Syarikat', 'Companies')}</th><th>${L('Jualan', 'Sales')}</th><th>${L('Komisen', 'Commission')}</th><th></th></tr></thead><tbody>
      ${list.map(a => {
        const comps = S.companies.filter(c => (c.ref || '') === a.code).length;
        const sales = S.payments.filter(p => p.status === 'paid' && p.ref === a.code).reduce((x, p) => x + Number(p.amount || 0), 0);
        return `<tr><td class="mono bold">${esc(a.code)}</td><td>${esc(a.name || '')}<div class="xs muted">${esc(a.phone || '')}</div></td><td>${comps}</td><td>${money(sales)}</td><td>${money(sales * Number(a.pct || 0) / 100)} <span class="xs muted">(${a.pct || 0}%)</span></td>
          <td style="white-space:nowrap"><button class="btn btn-sm btn-ghost" data-alink="${esc(a.code)}">${L('Salin pautan', 'Copy link')}</button><button class="icon-btn" data-adel="${esc(a.code)}">✕</button></td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="empty">${L('Belum ada agen.', 'No agents yet.')}</div>`}</div>`;
  $('#aadd').onclick = async () => {
    const code = $('#ac').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return toast(L('Sila isi kod agen.', 'Please enter an agent code.'), 'warn');
    try { await setDoc(doc(db, 'agents', code), { name: $('#an').value.trim(), pct: Number($('#ap').value || 0), phone: $('#at').value.trim(), createdAt: serverTimestamp() }); viewAgents(); }
    catch (e) { toast(authErr(e), 'bad'); }
  };
  $$('[data-alink]').forEach(b => b.onclick = () => copyText(base + b.dataset.alink));
  $$('[data-adel]').forEach(b => b.onclick = async () => { if (await confirmBox(L('Padam agen ini?', 'Delete this agent?'))) { await deleteDoc(doc(db, 'agents', b.dataset.adel)); viewAgents(); } });
}

// ---------- Kit promosi ----------
async function viewKit() {
  const p = (await getDoc(doc(db, 'config', 'plans')).catch(() => null))?.data() || {};
  const link = location.origin + '/landing.html';
  const td = p.trialDays ?? 14;
  const texts = [
    [L('TikTok / Reels (kapsyen)', 'TikTok / Reels (caption)'), `Masih guna buku log / kad punch untuk kehadiran pekerja? 😩
Cuba sistem kehadiran online — pekerja punch guna telefon (GPS, QR atau selfie), bos nampak semua secara langsung! 📲
✅ Cuti & MC online
✅ OT & syif
✅ Gaji & slip gaji automatik
Cuba PERCUMA ${td} hari 👉 ${link}
#kehadiranpekerja #sistemhr #bisneskecil #usahawan #payroll`],
    [L('Facebook / kumpulan FB', 'Facebook / FB groups'), `📢 Untuk pemilik bisnes yang ada pekerja!

Sistem kehadiran & gaji yang mudah — dalam Bahasa Melayu, guna di telefon sahaja:
• Pekerja punch masuk/keluar dengan GPS, kod QR atau tablet kiosk
• Selfie sebagai bukti — tiada lagi "punch kan kawan"
• Mohon cuti, MC, OT & tuntutan dalam app
• Laporan kehadiran & Excel
• Kira gaji, KWSP/PERKESO/SIP (kadar anda isi sendiri) & slip gaji PDF
• Nama & logo syarikat anda sendiri

💰 Mulai RM${p.monthly ?? '-'} sebulan untuk satu syarikat
🎁 Cuba percuma ${td} hari — tiada kad kredit

Daftar: ${link}`],
    [L('WhatsApp (mesej ringkas)', 'WhatsApp (short message)'), `Salam tuan/puan 👋 Saya nak kongsi sistem kehadiran pekerja online — punch guna telefon (GPS/QR/selfie), cuti & OT online, siap kira gaji & slip gaji. Cuba percuma ${td} hari: ${link}`],
    [L('Skrip video 30 saat', '30-second video script'), `[0-3s] "Bos, pekerja selalu lewat tapi buku log tulis tepat masa?"
[3-10s] Tunjuk pekerja tekan Punch di telefon → selfie → GPS disahkan.
[10-18s] Tunjuk dashboard bos: siapa hadir, lewat, belum datang — masa nyata.
[18-25s] Tunjuk cuti/OT diluluskan & slip gaji PDF.
[25-30s] "Cuba percuma ${td} hari. Link di bio!"`]
  ];
  $('#view').innerHTML = texts.map(([t, x], i) => `<div class="card"><div class="card-head"><h3>${t}</h3><button class="btn btn-sm btn-soft" data-kc="${i}">${L('Salin', 'Copy')}</button></div>
    <pre style="white-space:pre-wrap;font-family:inherit;margin:0;background:var(--card2);padding:.8rem;border-radius:10px;border:1px solid var(--line)">${esc(x)}</pre></div>`).join('')
    + `<div class="card small"><b>${L('Pautan landing page', 'Landing page link')}:</b> <a href="${link}" target="_blank">${link}</a></div>`;
  $$('[data-kc]').forEach(b => b.onclick = () => copyText(texts[Number(b.dataset.kc)][1]));
}
