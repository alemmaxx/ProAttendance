// ProAttendance — Gaji (Fasa 3)
// Semua kadar caruman (KWSP, PERKESO, SIP, PCB) diisi secara manual oleh admin syarikat.
import { epf as epfT, socso as socsoT, eis as eisT, ageAt } from './statutory.js';
import { L, esc, todayStr, toDate, summarizeDay, money, fmtDate } from './ui.js';
import { resolveDay, lateSettings, leaveTypes, otKind, otRates, dateRange, OT_LABEL } from './sched.js';

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const PAYROLL_DEFAULTS = {
  workDaysPerMonth: 26, hoursPerDay: 8,
  epfEe: 0, epfEr: 0, socsoEe: 0, socsoEr: 0, eisEe: 0, eisEr: 0,
  deductUnpaid: true, deductAbsent: false, lateMode: 'none', lateAmount: 0,
  otInEpf: false, otInSocso: false, perfectBonus: 0, otherAllowEpf: true, otherAllowSocso: true, statMode: 'table',
  slipStyle: 'classic', slipEmployer: true, slipStamp: true, hrdRate: 0
};
// Tetapan kewangan: kadar caruman, PCB setiap pekerja (pcbMap) & senarai elaun (KWSP/PERKESO)
export const payrollSettings = (c) => ({ ...PAYROLL_DEFAULTS, ...(c?.payroll || {}), pcbMap: c?.pcbMap || {}, allowTpl: c?.allowanceTemplates || [] });
const allowFlags = (P, name) => {
  const t = P.allowTpl.find(x => String(x.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());
  return t ? { epf: !!t.epf, socso: !!t.socso } : { epf: !!P.otherAllowEpf, socso: !!P.otherAllowSocso };
};

export function periodRange(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}
export const periodLabel = (period) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(L('ms-MY', 'en-GB'), { month: 'long', year: 'numeric' });
};

export function rates(w, P) {
  const rate = Number(w.salary || 0);
  const daily = w.payType === 'daily' ? rate : w.payType === 'hourly' ? rate * P.hoursPerDay : rate / (P.workDaysPerMonth || 26);
  const hourly = w.payType === 'hourly' ? rate : daily / (P.hoursPerDay || 8);
  return { rate, daily: r2(daily), hourly: r2(hourly) };
}

// Kira slip gaji draf seorang pekerja untuk satu bulan
// recs: rekod kehadiran pekerja dalam bulan itu; roster: peta jadual; reqs: permohonan diluluskan pekerja ini
export function computeItem({ c, w, period, recs, roster = {}, reqs = [], loans = [] }) {
  const P = payrollSettings(c);
  const { from, to } = periodRange(period);
  const today = todayStr();
  const info = (d) => resolveDay(c, w, d, roster[d]?.[w.id]);
  const types = Object.fromEntries(leaveTypes(c).map(t => [t.id, t]));

  // Kehadiran
  const byDate = {};
  recs.forEach(r => (byDate[r.date] = byDate[r.date] || []).push(r));
  let workMin = 0, lateMin = 0, lateDays = 0;
  const present = new Set();
  Object.entries(byDate).forEach(([d, list]) => {
    const s = summarizeDay(list, lateSettings(c, info(d)), d);
    if (s.firstIn) present.add(d);
    workMin += s.workMin; lateMin += s.lateMin; if (s.lateMin) lateDays++;
  });

  // Cuti
  let leavePaid = 0, leaveUnpaid = 0;
  const leaveDates = {};
  reqs.filter(r => r.kind === 'leave').forEach(r => {
    dateRange(r.from, r.to || r.from).forEach(d => {
      if (d < from || d > to || info(d).type !== 'work') return;
      const v = r.half && r.from === r.to ? 0.5 : 1;
      leaveDates[d] = true;
      if (types[r.typeId]?.paid === false) leaveUnpaid += v; else leavePaid += v;
    });
  });

  // Tidak hadir
  let absent = 0;
  const start = w.startDate || '0000-00-00';
  dateRange(from, to).forEach(d => {
    if (d > today || d < start) return;
    if (info(d).type === 'work' && !present.has(d) && !leaveDates[d]) absent++;
  });

  const R = rates(w, P);
  const presentN = present.size;
  const earnings = [], deductions = [];

  // Gaji asas
  let basic = 0, basicNote = '';
  if (w.payType === 'daily') { basic = R.rate * (presentN + leavePaid); basicNote = `${presentN + leavePaid} ${L('hari', 'days')} × ${money(R.rate)}`; }
  else if (w.payType === 'hourly') { basic = R.rate * (workMin / 60); basicNote = `${r2(workMin / 60)} ${L('jam', 'hrs')} × ${money(R.rate)}`; }
  else basic = R.rate;
  earnings.push({ name: L('Gaji Asas', 'Basic Pay'), note: basicNote, amount: r2(basic), kind: 'basic', epf: true, socso: true });

  // Elaun
  (w.allowances || []).forEach(a => {
    const amt = a.type === 'daily' ? a.amount * presentN : a.amount;
    if (!amt) return;
    earnings.push({
      name: a.name, note: a.type === 'daily' ? `${presentN} × ${money(a.amount)}` : '',
      amount: r2(amt), kind: 'allow', ...allowFlags(P, a.name), once: a.type === 'once'
    });
  });

  // OT diluluskan
  const otR = otRates(c);
  const otH = { normal: 0, rest: 0, holiday: 0 };
  reqs.filter(r => r.kind === 'ot' && r.date >= from && r.date <= to)
    .forEach(r => { otH[otKind(info(r.date))] += Number(r.approvedHours ?? r.hours ?? 0); });
  Object.entries(otH).forEach(([k, h]) => {
    if (!h) return;
    earnings.push({
      name: `OT ${OT_LABEL[k]()}`, note: `${r2(h)} ${L('jam', 'hrs')} × ${otR[k]} × ${money(R.hourly)}`,
      amount: r2(h * otR[k] * R.hourly), kind: 'ot', epf: !!P.otInEpf, socso: !!P.otInSocso
    });
  });

  // Bonus kehadiran penuh
  if (Number(P.perfectBonus) > 0 && presentN > 0 && absent === 0 && lateDays === 0 && leaveUnpaid === 0) {
    earnings.push({ name: L('Bonus kehadiran penuh', 'Perfect attendance bonus'), note: '', amount: r2(P.perfectBonus), kind: 'bonus', epf: true, socso: true });
  }

  // Tuntutan (claims) TIDAK masuk slip gaji — diurus melalui Borang Tuntutan berasingan
  const claimIds = [];

  // Potongan tanpa gaji / tidak hadir (gaji bulanan)
  if (w.payType !== 'daily' && w.payType !== 'hourly') {
    const unpaidDays = (P.deductUnpaid ? leaveUnpaid : 0) + (P.deductAbsent ? absent : 0);
    if (unpaidDays > 0) deductions.push({ name: L('Cuti tanpa gaji / tidak hadir', 'Unpaid leave / absence'), note: `${unpaidDays} × ${money(R.daily)}`, amount: r2(unpaidDays * R.daily), kind: 'unpaid' });
  }
  // Potongan lewat
  if (P.lateMode === 'perMin' && lateMin) deductions.push({ name: L('Potongan lewat', 'Late deduction'), note: `${lateMin} min × ${money(P.lateAmount)}`, amount: r2(lateMin * P.lateAmount), kind: 'late' });
  if (P.lateMode === 'perDay' && lateDays) deductions.push({ name: L('Potongan lewat', 'Late deduction'), note: `${lateDays} × ${money(P.lateAmount)}`, amount: r2(lateDays * P.lateAmount), kind: 'late' });

  // Potongan dari profil pekerja
  (w.deductions || []).forEach(d => {
    if (!d.amount) return;
    deductions.push({ name: d.name, note: '', amount: r2(d.amount), kind: 'other', once: d.type === 'once' });
  });

  // Ansuran pinjaman pekerja (dari Fail HR)
  const loanPays = [];
  (loans || []).filter(l => l.active !== false && (l.start || '0000-00') <= period).forEach(l => {
    const left = r2(Number(l.total || 0) - Number(l.paid || 0));
    const amt = r2(Math.min(Number(l.monthly || 0), left));
    if (amt <= 0) return;
    loanPays.push({ id: l.id, amt });
    deductions.push({ name: `${L('Pinjaman', 'Loan')}: ${l.name || ''}`.trim(), note: `${L('baki', 'balance')} ${money(left - amt)}`, amount: amt, kind: 'loan' });
  });

  // Pendahuluan gaji (advance)
  const advanceIds = [];
  reqs.filter(r => r.kind === 'advance' && !r.paidPeriod && (r.date || '') <= to).forEach(r => {
    advanceIds.push(r.id);
    deductions.push({ name: L('Pendahuluan gaji', 'Salary advance'), note: r.date ? fmtDate(r.date) : '', amount: r2(r.approvedAmount ?? r.amount), kind: 'advance' });
  });

  const item = {
    workerId: w.id, uid: w.uid || '', name: w.name, ic: w.ic || '', position: w.position || '', dept: w.dept || '',
    bank: w.bank || '', bankAcc: w.bankAcc || '', epfNo: w.epfNo || '', socsoNo: w.socsoNo || '', taxNo: w.taxNo || '',
    thNo: w.thNo || '', asbNo: w.asbNo || '',
    payType: w.payType || 'monthly', rate: R.rate, dailyRate: R.daily, hourlyRate: R.hourly,
    days: { present: presentN, leavePaid, leaveUnpaid, absent, lateMin, lateDays, workHours: r2(workMin / 60), ot: otH },
    earnings, deductions, employer: { epf: 0, socso: 0, eis: 0 }, period, claimIds, advanceIds, loanPays, branchId: w.branchId || ''
  };
  applyStatutory(item, P, w);
  return totals(item);
}

// Kira caruman berkanun (ganti baris sedia ada)
export function applyStatutory(item, P, w = {}) {
  // Caruman ikut kadar dalam Tetapan Kewangan; PCB ikut senarai PCB finance
  const st = {}, pcb = Number(P.pcbMap?.[w.id] || 0);
  const red = item.deductions.filter(d => d.kind === 'unpaid' || d.kind === 'late').reduce((a, d) => a + Number(d.amount || 0), 0);
  const epfBase = Math.max(0, item.earnings.filter(e => e.epf).reduce((a, e) => a + Number(e.amount || 0), 0) - red);
  const socsoBase = Math.max(0, item.earnings.filter(e => e.socso).reduce((a, e) => a + Number(e.amount || 0), 0) - red);
  const pick = (ov, base, pct) => (ov !== undefined && ov !== null && ov !== '') ? r2(ov) : r2(base * Number(pct || 0) / 100);
  item.bases = { epf: r2(epfBase), socso: r2(socsoBase) };
  let ee, skbbk = 0;
  if (P.statMode !== 'percent') {
    // Jadual rasmi KWSP / PERKESO / SIP / SKBBK ikut status & umur pekerja
    const period = item.period || new Date().toISOString().slice(0, 7);
    const o = { nationality: w.nationality || 'citizen', age: ageAt(w.dob, period), cat2: !!w.socsoCat2, skbbk: w.skbbk !== false, period };
    const E = epfT(epfBase, o), So = socsoT(socsoBase, o), Ei = eisT(socsoBase, o);
    ee = { epf: E.ee, socso: So.ee, eis: Ei.ee, pcb: r2(pcb) };
    skbbk = So.skbbk;
    item.employer = { epf: E.er, socso: So.er, eis: Ei.er };
    item.statNote = [E.note, So.cat === 2 ? L('PERKESO Kategori 2', 'SOCSO Category 2') : ''].filter(Boolean).join(' · ');
  } else {
    ee = { epf: pick(st.epfEe, epfBase, P.epfEe), socso: pick(st.socsoEe, socsoBase, P.socsoEe), eis: pick(st.eisEe, socsoBase, P.eisEe), pcb: r2(pcb) };
    item.employer = { epf: pick(st.epfEr, epfBase, P.epfEr), socso: pick(st.socsoEr, socsoBase, P.socsoEr), eis: pick(st.eisEr, socsoBase, P.eisEr) };
  }
  // Levi HRD Corp (majikan): % daripada gaji asas + elaun tetap bulanan
  if (Number(P.hrdRate) > 0) {
    const hrdBase = (item.earnings || []).filter(e => e.kind === 'basic' || (e.kind === 'allow' && !e.once)).reduce((a, e) => a + Number(e.amount || 0), 0);
    item.employer.levy = r2(hrdBase * Number(P.hrdRate) / 100);
  }
  item.base = { epf: r2(epfBase), socso: r2(socsoBase) };
  item.deductions = item.deductions.filter(d => !['epf', 'socso', 'eis', 'skbbk', 'pcb'].includes(d.kind));
  const stat = [
    { kind: 'epf', name: L('KWSP (pekerja)', 'EPF (employee)'), amount: ee.epf },
    { kind: 'socso', name: L('PERKESO (pekerja)', 'SOCSO (employee)'), amount: ee.socso },
    { kind: 'eis', name: L('SIP (pekerja)', 'EIS (employee)'), amount: ee.eis },
    { kind: 'skbbk', name: L('PERKESO Lindung 24 Jam (SKBBK)', 'SOCSO Lindung 24 Jam (SKBBK)'), amount: skbbk },
    { kind: 'pcb', name: L('PCB / Cukai', 'PCB / Tax'), amount: ee.pcb }
  ].filter(x => x.amount > 0);
  item.deductions = [...stat, ...item.deductions];
  return item;
}

export function totals(item) {
  const gross = item.earnings.filter(e => e.kind !== 'claim').reduce((a, e) => a + Number(e.amount || 0), 0);
  const claims = item.earnings.filter(e => e.kind === 'claim').reduce((a, e) => a + Number(e.amount || 0), 0);
  const ded = item.deductions.reduce((a, d) => a + Number(d.amount || 0), 0);
  item.gross = r2(gross); item.claims = r2(claims); item.totalDed = r2(ded);
  item.net = r2(gross + claims - ded);
  item.employerTotal = r2((item.employer?.epf || 0) + (item.employer?.socso || 0) + (item.employer?.eis || 0) + (item.employer?.levy || 0));
  return item;
}

// ---------- Slip gaji (HTML untuk cetak / PDF) ----------
const SLIP_CSS = (c) => `
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px;font-size:12px}
  .wrap{max-width:780px;margin:0 auto}
  .head{display:flex;gap:14px;align-items:center;border-bottom:3px solid ${esc(c.color || '#1d4ed8')};padding-bottom:10px}
  .head h1{font-size:18px;margin:0} .head .a{color:#555;font-size:11px;white-space:pre-line}
  .title{display:flex;justify-content:space-between;align-items:flex-end;margin:14px 0 8px}
  .title h2{margin:0;font-size:16px;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse}
  .info td{padding:3px 6px} .info .k{color:#555;width:130px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}
  .box{border:1px solid #ccc;border-radius:6px;overflow:hidden}
  .box h3{margin:0;background:#f1f5f9;padding:6px 8px;font-size:12px}
  .box td{padding:5px 8px;border-top:1px solid #eee;vertical-align:top} .r{text-align:right;white-space:nowrap}
  .n{color:#777;font-size:10px} .tot td{font-weight:bold;background:#fafafa}
  .net{margin-top:14px;display:flex;justify-content:space-between;align-items:center;border:2px solid ${esc(c.color || '#1d4ed8')};border-radius:8px;padding:10px 14px;font-size:16px;font-weight:bold}
  .small{font-size:10px;color:#666;margin-top:12px}
  .stats{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px} .stats span{background:#f1f5f9;border-radius:4px;padding:3px 7px;font-size:10.5px}
  @media print{body{padding:0} .noprint{display:none}}

  .page{page-break-after:always} .page:last-child{page-break-after:auto}`;

export function payslipBody(c, slip, period) {
  const logo = c.logo ? `<img src="${c.logo}" style="width:64px;height:64px;object-fit:contain">` : '';
  const row = (k, v) => v ? `<tr><td class="k">${k}</td><td>${esc(v)}</td></tr>` : '';
  const lines = (arr) => arr.map(x => `<tr><td>${esc(x.name)}${x.note ? `<div class="n">${esc(x.note)}</div>` : ''}</td><td class="r">${money(x.amount)}</td></tr>`).join('');
  const d = slip.days || {};
  return `<div class="wrap">
  <div class="head">${logo}<div><h1>${esc(c.name)}</h1><div class="a">${esc([c.ssm ? `(${c.ssm})` : '', c.address || '', c.phone || ''].filter(Boolean).join('\n'))}</div></div></div>
  <div class="title"><h2>${esc(L('SLIP GAJI', 'PAYSLIP'))}</h2><b>${esc(periodLabel(period))}</b></div>
  <table class="info"><tr><td style="width:50%;vertical-align:top"><table>
    ${row(L('Nama', 'Name'), slip.name)}${row(L('ID Pekerja', 'Staff ID'), slip.workerId)}${row(L('No. IC', 'IC No.'), slip.ic)}
    ${row(L('Jawatan', 'Position'), slip.position)}${row(L('Jabatan', 'Department'), slip.dept)}
  </table></td><td style="vertical-align:top"><table>
    ${row(L('Bank', 'Bank'), slip.bank)}${row(L('No. Akaun', 'Account No.'), slip.bankAcc)}
    ${row(L('No. KWSP', 'EPF No.'), slip.epfNo)}${row(L('No. PERKESO', 'SOCSO No.'), slip.socsoNo)}${row(L('No. Cukai', 'Tax No.'), slip.taxNo)}
  </table></td></tr></table>
  <div class="stats">
    <span>${L('Hadir', 'Present')}: ${d.present ?? 0}</span><span>${L('Cuti bergaji', 'Paid leave')}: ${d.leavePaid ?? 0}</span>
    <span>${L('Cuti tanpa gaji', 'Unpaid leave')}: ${d.leaveUnpaid ?? 0}</span><span>${L('Tidak hadir', 'Absent')}: ${d.absent ?? 0}</span>
    <span>${L('Lewat', 'Late')}: ${d.lateMin ?? 0} min</span><span>${L('Jam kerja', 'Hours')}: ${d.workHours ?? 0}</span>
  </div>
  <div class="grid">
    <div class="box"><h3>${L('PENDAPATAN', 'EARNINGS')}</h3><table>${lines(slip.earnings || [])}
      <tr class="tot"><td>${L('Jumlah', 'Total')}</td><td class="r">${money((slip.gross || 0) + (slip.claims || 0))}</td></tr></table></div>
    <div class="box"><h3>${L('POTONGAN', 'DEDUCTIONS')}</h3><table>${lines(slip.deductions || [])}
      <tr class="tot"><td>${L('Jumlah', 'Total')}</td><td class="r">${money(slip.totalDed)}</td></tr></table></div>
  </div>
  <div class="net"><span>${L('GAJI BERSIH', 'NET PAY')}</span><span>${money(slip.net)}</span></div>
  <div class="box" style="margin-top:12px"><h3>${L('CARUMAN MAJIKAN', 'EMPLOYER CONTRIBUTIONS')}</h3><table>
    <tr><td>${L('KWSP', 'EPF')}</td><td class="r">${money(slip.employer?.epf)}</td><td>${L('PERKESO', 'SOCSO')}</td><td class="r">${money(slip.employer?.socso)}</td><td>${L('SIP', 'EIS')}</td><td class="r">${money(slip.employer?.eis)}</td></tr>
  </table></div>
  <p class="small">${L('Slip ini dijana oleh komputer dan tidak memerlukan tandatangan.', 'This is a computer-generated payslip; no signature is required.')}</p>
</div>`;
}

// ---------- Slip gaji KLASIK (susunan korporat: pendapatan | potongan | maklumat & caruman majikan) ----------
const CLASSIC_DED = [
  ['epf', () => L('KWSP', 'EPF')], ['socso', () => L('PERKESO', 'SOCSO')], ['eis', () => L('SIP', 'EIS')], ['skbbk', () => 'SKBBK']
];
const OTHER_DED = [
  ['tax', () => L('Cukai Pendapatan', 'Income Tax'), /cukai|income tax/i],
  ['nopay', () => L('Cuti Tanpa Gaji', 'NoPay Leave'), null],
  ['loan', () => L('Pinjaman', 'Loan'), /pinjaman|loan/i],
  ['asb', () => 'ASB', /\basb\b/i],
  ['th', () => L('Tabung Haji', 'Tabung Haji'), /tabung\s*haji|\bth\b/i],
  ['personal', () => L('Peribadi', 'Personal'), /peribadi|personal/i],
  ['zakat', () => 'Zakat', /zakat/i]
];
export function payslipClassic(c, slip, period) {
  const P = payrollSettings(c);
  const n2 = (v) => (v || v === 0) && Number(v) !== 0 ? Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
  const E = slip.earnings || [], D = slip.deductions || [];
  const sumK = (arr, k) => arr.filter(x => x.kind === k).reduce((a, x) => a + Number(x.amount || 0), 0);
  const bonus = sumK(E, 'bonus');
  const arrears = E.filter(e => e.kind === 'other' && /tunggakan|arrears/i.test(e.name || '')).reduce((a, e) => a + Number(e.amount || 0), 0);
  const allow = E.filter(e => e.kind === 'allow');                    // elaun HANYA dari senarai profil pekerja
  const otherEarn = E.filter(e => e.kind === 'other' && !/tunggakan|arrears/i.test(e.name || ''));
  // Potongan "lain-lain" mengikut nama
  const used = new Set();
  const other = OTHER_DED.map(([k, lbl, re]) => {
    let amt = 0;
    D.forEach((d, i) => {
      if (used.has(i) || ['epf', 'socso', 'eis', 'skbbk', 'pcb'].includes(d.kind)) return;
      const hit = k === 'nopay' ? (d.kind === 'unpaid') : k === 'loan' ? (d.kind === 'loan' || d.kind === 'advance' || (re && re.test(d.name || ''))) : (re && re.test(d.name || ''));
      if (hit) { amt += Number(d.amount || 0); used.add(i); }
    });
    return [lbl(), amt];
  });
  const extra = D.map((d, i) => ({ d, i })).filter(({ d, i }) => !used.has(i) && !['epf', 'socso', 'eis', 'skbbk', 'pcb'].includes(d.kind));
  const er = slip.employer || {};
  const erRows = [[L('KWSP', 'EPF'), er.epf], [L('PERKESO', 'SOCSO'), er.socso], [L('SIP', 'EIS'), er.eis], ...(er.levy ? [[L('LEVI HRD', 'HRD LEVY'), er.levy]] : [])];
  const erTot = erRows.reduce((a, r) => a + Number(r[1] || 0), 0);
  const [y, m] = String(period).split('-').map(Number);
  const monthTxt = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
  const earnRows = [
    [L('Gaji Asas', 'Basic Salary'), sumK(E, 'basic')],
    [L('Tunggakan Gaji', 'Salary Arrears'), arrears],
    [L('Kerja Lebih Masa', 'Overtime'), sumK(E, 'ot')],
    ...(bonus ? E.filter(e => e.kind === 'bonus').map(e => [e.name || 'Bonus', e.amount]) : [['Bonus', 0]]),
    ...otherEarn.map(e => [e.name, e.amount])
  ];
  const infoRow = (k, v) => `<tr><td class="ck">${k}</td><td class="cv">${esc(v || '')}</td></tr>`;
  const L2 = (rows) => rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${n2(v)}</td></tr>`).join('');
  return `<div class="cl">
  <div class="cl-head">${c.logo ? `<img src="${c.logo}" alt="">` : ''}
    <div class="cl-co">${esc(c.name || '')}${c.ssm ? ` (${esc(c.ssm)})` : ''}</div>
    <div class="cl-addr">${esc(c.address || '')}</div>
    <div class="cl-addr">${[c.phone ? 'TEL : ' + esc(c.phone) : '', c.fax ? 'FAX : ' + esc(c.fax) : ''].filter(Boolean).join('&nbsp;&nbsp;&nbsp;')}</div></div>
  <div class="cl-title"><span>${bonus ? L('SLIP GAJI & BONUS BAGI BULAN', 'SALARY & BONUS SLIP FOR THE MONTH OF') : L('SLIP GAJI BAGI BULAN', 'SALARY SLIP FOR THE MONTH OF')}</span><b>${monthTxt}</b></div>
  <div class="cl-grid">
    <div class="cl-left">
      <table class="cl-name"><tr><td class="ck">${L('NAMA', 'NAME')}</td><td class="cv"><b>${esc(slip.name || '')}</b>${slip.position ? ` <span class="mut">· ${esc(slip.position)}</span>` : ''}</td></tr></table>
      <div class="cl-cols">
        <table class="cl-tbl"><tr class="h"><th>${L('Pendapatan', 'Earnings')} :</th><th class="r">RM</th></tr>
          ${L2(earnRows)}
          <tr class="sub"><td colspan="2"><u>${L('Elaun', 'Allowances')}</u></td></tr>
          ${L2(allow.map(a => [a.name, a.amount]))}
          <tr class="fill"><td></td><td></td></tr></table>
        <table class="cl-tbl"><tr class="h"><th>${L('Potongan', 'Deductions')}:</th><th class="r">RM</th></tr>
          <tr class="sub"><td colspan="2"><u>${L('Caruman Pekerja', "Employee's Contribution")}:</u></td></tr>
          ${L2(CLASSIC_DED.filter(([k]) => k !== 'skbbk' || sumK(D, 'skbbk')).map(([k, l]) => [l(), sumK(D, k)]))}
          <tr class="sub"><td colspan="2"><u>${L('Lain-lain', 'Others')}:</u></td></tr>
          ${L2(other)}
          ${L2(extra.map(({ d }) => [d.name, d.amount]))}
          <tr><td>PCB</td><td class="r">${n2(sumK(D, 'pcb'))}</td></tr>
          <tr class="fill"><td></td><td></td></tr></table>
      </div>
      <div class="cl-tots"><div><span>${L('GAJI KASAR', 'GROSS PAY')}</span><b>${n2((slip.gross || 0) + (slip.claims || 0)) || '0.00'}</b></div><div><span>${L('JUMLAH POTONGAN', 'TOTAL DEDUCTION')}</span><b>${n2(slip.totalDed) || '0.00'}</b></div></div>
    </div>
    <div class="cl-right">
      <table class="cl-info">
        ${infoRow(L('No. KP', 'NRIC No.'), slip.ic)}${infoRow(L('No. Akaun', 'A/C No.'), [slip.bank, slip.bankAcc].filter(Boolean).join('-'))}
        ${infoRow(L('No. KWSP', 'EPF No.'), slip.epfNo)}${infoRow(L('No. PERKESO', 'Socso No.'), slip.socsoNo)}${infoRow(L('No. Cukai', 'Inc.Tax No'), slip.taxNo)}
        ${infoRow(L('No. T.Haji', 'T.Haji No'), slip.thNo)}${infoRow(L('No. ASB', 'ASB No.'), slip.asbNo)}
      </table>
      ${P.slipEmployer !== false ? `<div class="cl-er"><u>${L('Caruman Majikan', "Employer's Contribution")}:</u></div>
      <table class="cl-tbl cl-ert">${erRows.map(([k, v]) => `<tr><td>${k}</td><td class="r">${n2(v) || '0.00'}</td></tr>`).join('')}</table>
      <div class="cl-ertot">${n2(erTot)}</div>` : ''}
      <div class="cl-net"><span>${L('GAJI BERSIH', 'NET PAY')}</span><b>${n2(slip.net) || '0.00'}</b></div>
      ${P.slipStamp !== false && c.stamp ? `<img class="cl-stamp" src="${c.stamp}" alt="">` : ''}
    </div>
  </div>
  <p class="cl-foot">${L('Ini adalah slip gaji janaan komputer. Tandatangan tidak diperlukan.', 'This is a computer generated pay advice. No signature is required.')}</p>
</div>`;
}
const CLASSIC_CSS = `
  .cl{max-width:820px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#111}
  .cl-head{text-align:center;margin-bottom:14px} .cl-head img{height:46px;max-width:160px;object-fit:contain;display:block;margin:0 auto 6px}
  .cl-co{font-family:"Courier New",monospace;font-weight:700;font-size:13px;letter-spacing:.5px} .cl-addr{font-family:"Courier New",monospace;font-size:12px;white-space:pre-line;line-height:1.45}
  .cl-title{display:flex;justify-content:center;align-items:center;gap:40px;margin:10px 0 14px;font-family:"Courier New",monospace;font-weight:700;font-size:12.5px}
  .cl-title b{border:1.5px solid #111;padding:3px 34px;font-family:Arial,sans-serif;font-size:12px}
  .cl-grid{display:grid;grid-template-columns:1.55fr 1fr;gap:14px;align-items:start}
  .cl table{border-collapse:collapse;width:100%} .cl td,.cl th{padding:2px 4px;text-align:left;font-weight:normal} .cl .r{text-align:right}
  .cl-name td{border:1px solid #111} .cl-name .ck{width:20%;font-weight:700}
  .cl-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:2px}
  .cl-tbl{border:1px solid #111;height:100%} .cl-tbl tr:not(.fill){height:1px} .cl-tbl .fill{height:auto} .cl-tbl td{border-right:1px solid #111} .cl-tbl td.r{border-right:0;width:38%}
  .cl-tbl .h th{font-weight:700;border-bottom:1px solid #111} .cl-tbl .sub td{border-right:0;padding-top:6px} .cl-tbl .fill td{height:auto;min-height:14px}
  .cl-tots{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px} .cl-tots div{display:flex;justify-content:space-between;align-items:center;gap:6px;font-family:"Courier New",monospace;font-weight:700}
  .cl-tots b{border:1.5px solid #111;padding:3px 8px;min-width:96px;text-align:right;font-family:Arial,sans-serif}
  .cl-info td{border:1px solid #111} .cl-info .ck{text-align:right;width:42%} .cl-info .cv{text-align:right}
  .cl-er{margin:16px 0 2px} .cl-ert td:first-child{width:35%} .cl-ertot{border:1.5px solid #111;text-align:right;padding:2px 6px;margin-left:30%;margin-top:3px}
  .cl-net{display:flex;justify-content:space-between;align-items:center;margin-top:16px;font-family:"Courier New",monospace;font-weight:700}
  .cl-net b{border:2px solid #111;padding:5px 10px;min-width:150px;text-align:right;font-family:Arial,sans-serif;font-size:13px}
  .cl-stamp{display:block;margin:14px 0 0 auto;max-width:130px;max-height:130px;object-fit:contain;opacity:.9}
  .cl-foot{margin-top:6px;font-size:11px} .cl .mut{color:#555;font-size:10.5px}
  @media(max-width:640px){.cl-grid,.cl-cols{grid-template-columns:1fr}}
`;

export function payslipHtml(c, slips, period) {
  const list = Array.isArray(slips) ? slips : [slips];
  const title = list.length === 1 ? `${L('Slip Gaji', 'Payslip')} ${list[0].name} ${period}` : `${L('Slip Gaji', 'Payslips')} ${period}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${SLIP_CSS(c)}${CLASSIC_CSS}</style></head><body>
${list.map(sl => `<div class="page">${payrollSettings(c).slipStyle === 'classic' ? payslipClassic(c, sl, period) : payslipBody(c, sl, period)}</div>`).join('')}
<p class="noprint" style="text-align:center;margin-top:20px"><button onclick="window.print()" style="padding:10px 20px;font-size:14px;cursor:pointer">${L('Cetak / Simpan PDF', 'Print / Save PDF')}</button></p>
</body></html>`;
}

export function openPrint(html, autoPrint = true) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  if (autoPrint) w.addEventListener('load', () => setTimeout(() => w.print(), 300));
  return true;
}
