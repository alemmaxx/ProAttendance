// ProAttendance — Gaji (Fasa 3)
// Semua kadar caruman (KWSP, PERKESO, SIP, PCB) diisi secara manual oleh admin syarikat.
import { L, esc, todayStr, toDate, summarizeDay, money, fmtDate } from './ui.js';
import { resolveDay, lateSettings, leaveTypes, otKind, otRates, dateRange, OT_LABEL } from './sched.js';

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const PAYROLL_DEFAULTS = {
  workDaysPerMonth: 26, hoursPerDay: 8,
  epfEe: 0, epfEr: 0, socsoEe: 0, socsoEr: 0, eisEe: 0, eisEr: 0,
  deductUnpaid: true, deductAbsent: false, lateMode: 'none', lateAmount: 0,
  otInEpf: false, otInSocso: false
};
export const payrollSettings = (c) => ({ ...PAYROLL_DEFAULTS, ...(c?.payroll || {}) });

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
export function computeItem({ c, w, period, recs, roster = {}, reqs = [] }) {
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
      amount: r2(amt), kind: 'allow', epf: !!a.epf, socso: !!a.socso, once: a.type === 'once'
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

  // Tuntutan (claims) — bayaran balik, tidak kena caruman
  const claimIds = [];
  reqs.filter(r => r.kind === 'claim' && !r.paidPeriod && (r.date || '') <= to).forEach(r => {
    claimIds.push(r.id);
    earnings.push({ name: `${L('Tuntutan', 'Claim')}: ${r.category || ''}`.trim(), note: r.date ? fmtDate(r.date) : '', amount: r2(r.approvedAmount ?? r.amount), kind: 'claim', epf: false, socso: false });
  });

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

  // Pendahuluan gaji (advance)
  const advanceIds = [];
  reqs.filter(r => r.kind === 'advance' && !r.paidPeriod && (r.date || '') <= to).forEach(r => {
    advanceIds.push(r.id);
    deductions.push({ name: L('Pendahuluan gaji', 'Salary advance'), note: r.date ? fmtDate(r.date) : '', amount: r2(r.approvedAmount ?? r.amount), kind: 'advance' });
  });

  const item = {
    workerId: w.id, uid: w.uid || '', name: w.name, ic: w.ic || '', position: w.position || '', dept: w.dept || '',
    bank: w.bank || '', bankAcc: w.bankAcc || '', epfNo: w.epfNo || '', socsoNo: w.socsoNo || '', taxNo: w.taxNo || '',
    payType: w.payType || 'monthly', rate: R.rate, dailyRate: R.daily, hourlyRate: R.hourly,
    days: { present: presentN, leavePaid, leaveUnpaid, absent, lateMin, lateDays, workHours: r2(workMin / 60), ot: otH },
    earnings, deductions, employer: { epf: 0, socso: 0, eis: 0 }, claimIds, advanceIds
  };
  applyStatutory(item, P, w);
  return totals(item);
}

// Kira caruman berkanun (ganti baris sedia ada)
export function applyStatutory(item, P, w = {}) {
  const st = w.statutory || {};
  const red = item.deductions.filter(d => d.kind === 'unpaid' || d.kind === 'late').reduce((a, d) => a + Number(d.amount || 0), 0);
  const epfBase = Math.max(0, item.earnings.filter(e => e.epf).reduce((a, e) => a + Number(e.amount || 0), 0) - red);
  const socsoBase = Math.max(0, item.earnings.filter(e => e.socso).reduce((a, e) => a + Number(e.amount || 0), 0) - red);
  const pick = (ov, base, pct) => (ov !== undefined && ov !== null && ov !== '') ? r2(ov) : r2(base * Number(pct || 0) / 100);
  const ee = {
    epf: pick(st.epfEe, epfBase, P.epfEe), socso: pick(st.socsoEe, socsoBase, P.socsoEe),
    eis: pick(st.eisEe, socsoBase, P.eisEe), pcb: (st.pcb !== undefined && st.pcb !== '') ? r2(st.pcb) : 0
  };
  item.employer = {
    epf: pick(st.epfEr, epfBase, P.epfEr), socso: pick(st.socsoEr, socsoBase, P.socsoEr), eis: pick(st.eisEr, socsoBase, P.eisEr)
  };
  item.base = { epf: r2(epfBase), socso: r2(socsoBase) };
  item.deductions = item.deductions.filter(d => !['epf', 'socso', 'eis', 'pcb'].includes(d.kind));
  const stat = [
    { kind: 'epf', name: L('KWSP (pekerja)', 'EPF (employee)'), amount: ee.epf },
    { kind: 'socso', name: L('PERKESO (pekerja)', 'SOCSO (employee)'), amount: ee.socso },
    { kind: 'eis', name: L('SIP (pekerja)', 'EIS (employee)'), amount: ee.eis },
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
  item.employerTotal = r2((item.employer?.epf || 0) + (item.employer?.socso || 0) + (item.employer?.eis || 0));
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

export function payslipHtml(c, slips, period) {
  const list = Array.isArray(slips) ? slips : [slips];
  const title = list.length === 1 ? `${L('Slip Gaji', 'Payslip')} ${list[0].name} ${period}` : `${L('Slip Gaji', 'Payslips')} ${period}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${SLIP_CSS(c)}</style></head><body>
${list.map(sl => `<div class="page">${payslipBody(c, sl, period)}</div>`).join('')}
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
