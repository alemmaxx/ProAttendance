// ProAttendance — Borang Tuntutan Bulanan (ikut format Excel syarikat)
//   1) EXPENSES CLAIM JUSTIFICATION FORM  (perjalanan: km, tol, parkir, lain-lain, outstation, overnight, elaun A/B)
//   2) SST PURCHASES CLAIM FORM           (resit pembelian: pembekal, kod SST, no. invois, kategori, amaun, SST)
//   3) ALLOWANCE CLAIM FORM               (elaun projek, outstation, overnight, elaun A/B)
//   4) EXPENSES PROJECT CLAIM FORM        (ringkasan ikut projek, potongan perbatuan, pendahuluan, baki)
// Tuntutan TIDAK masuk slip gaji — dokumen kelulusan berasingan.
import { L, esc, money, fmtDate } from './ui.js';

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const CLAIM_RATE_DEFAULTS = {
  km: 0.8, outstation: 15, overnight: 25,
  offset: 50, sst: 8
};
export const claimRates = (c) => ({ ...CLAIM_RATE_DEFAULTS, ...(c?.claimRates || {}) });

// Kategori borang SST (Expenses Details) + penerangan (SST REFERENCE)
export const SST_CATS = () => [
  ['TRAVEL', L('Isi minyak kenderaan, tambang Grab, tiket tren/MRT/LRT.', 'Vehicle fuel, Grab fares, train/MRT/LRT tickets.')],
  ['LODGING', L('Perbelanjaan penginapan hotel.', 'Hotel lodging expenses.')],
  ['FOOD AND BEVERAGES', L('Belanja makan pelanggan (entertainment).', 'Client entertainment meals.')],
  ['TOOLS', L('Barang untuk projek (kabel, mesin, black tape dll.).', 'Items for projects (cables, machines, tape etc.).')],
  ['STATIONERY', L('Alat tulis, kertas A4 dll.', 'Stationery, A4 paper etc.')],
  ['MEDICAL', L('Bil ubat / klinik (kecuali klinik gigi).', 'Medicine / clinic bills (excluding dental).')],
  ['OTHERS', L('Permit, SSM, CIDB & keperluan rasmi lain.', 'Permits, SSM, CIDB & other official needs.')]
];

export const STATUS = {
  draft: () => [L('Draf', 'Draft'), ''],
  submitted: () => [L('Menunggu kelulusan', 'Pending approval'), 'b-warn'],
  approved: () => [L('Diluluskan', 'Approved'), 'b-ok'],
  rejected: () => [L('Ditolak', 'Rejected'), 'b-bad'],
  paid: () => [L('Dibayar', 'Paid'), 'b-info']
};
export const statusBadge = (s) => { const [t, c] = (STATUS[s] || STATUS.draft)(); return `<span class="badge ${c}">${t}</span>`; };

export const emptyClaim = (month) => ({ month, status: 'draft', journeys: [], purchases: [], allowances: [] });

// Jumlah satu baris perjalanan
export function journeyTotal(j, R) {
  return r2(Number(j.km || 0) * R.km + Number(j.toll || 0) + Number(j.parking || 0)
    + Number(j.outstation || 0) * R.outstation + Number(j.overnight || 0) * R.overnight);
}
export const purchaseTotal = (p) => r2(Number(p.amount || 0) + Number(p.sst || 0));
export function allowanceTotal(a, R) {
  return r2(Number(a.project || 0));
}

// Kira semua jumlah borang
export function computeClaim(claim, c) {
  const R = claimRates(c);
  const J = claim.journeys || [], P = claim.purchases || [], A = claim.allowances || [];
  const NOPROJ = L('(Tiada projek)', '(No project)');
  const projects = [];
  const add = (p) => { const k = p || NOPROJ; if (!projects.includes(k)) projects.push(k); return k; };
  J.forEach(j => add(j.project)); P.forEach(p => add(p.project));
  const sumP = (proj, cat) => r2(P.filter(p => (p.project || NOPROJ) === proj && p.cat === cat).reduce((a, p) => a + purchaseTotal(p), 0));
  const sumJ = (proj, f) => J.filter(j => (j.project || NOPROJ) === proj).reduce((a, j) => a + Number(j[f] || 0), 0);
  const rows = projects.map(proj => {
    const row = {
      project: proj,
      mileage: r2(sumJ(proj, 'km') * R.km),
      toll: r2(sumJ(proj, 'toll')),
      travel: sumP(proj, 'TRAVEL'),
      outOver: r2(sumJ(proj, 'outstation') * R.outstation + sumJ(proj, 'overnight') * R.overnight),
      lodging: sumP(proj, 'LODGING'),
      parking: r2(sumJ(proj, 'parking')),
      fnb: sumP(proj, 'FOOD AND BEVERAGES'),
      tools: sumP(proj, 'TOOLS'),
      stationery: sumP(proj, 'STATIONERY'),
      medical: sumP(proj, 'MEDICAL'),
      others: sumP(proj, 'OTHERS')
    };
    row.total = r2(Object.entries(row).filter(([k]) => k !== 'project').reduce((a, [, v]) => a + v, 0));
    return row;
  });
  const COLS = ['mileage', 'toll', 'travel', 'outOver', 'lodging', 'parking', 'fnb', 'tools', 'stationery', 'medical', 'others'];
  const sub = Object.fromEntries(COLS.map(k => [k, r2(rows.reduce((a, r) => a + r[k], 0))]));
  const kmTotal = J.reduce((a, j) => a + Number(j.km || 0), 0);
  // Syarikat tanggung RM offset pertama mileage; hanya baki selepas offset boleh dituntut (resit tidak terlibat)
  const offset = r2(Math.min(R.offset, sub.mileage));
  sub.mileage = r2(sub.mileage - offset);
  const totalExpenses = r2(COLS.reduce((a, k) => a + sub[k], 0));
  // Elaun: borang elaun
  const allowSub = {
    project: r2(A.reduce((a, x) => a + Number(x.project || 0), 0))
  };
  const allowanceTotalAll = r2(Object.values(allowSub).reduce((a, v) => a + v, 0));
  const justTotal = r2(J.reduce((a, j) => a + journeyTotal(j, R), 0) - offset);
  const sstSub = {
    amount: r2(P.reduce((a, p) => a + Number(p.amount || 0), 0)),
    sst: r2(P.reduce((a, p) => a + Number(p.sst || 0), 0)),
    total: r2(P.reduce((a, p) => a + purchaseTotal(p), 0))
  };
  return {
    R, rows, sub, offset, kmTotal, totalExpenses, allowSub,
    allowanceTotal: allowanceTotalAll, claimTotal: totalExpenses, reimbursement: r2(allowanceTotalAll + totalExpenses),
    justTotal, sstSub
  };
}

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
const dmy = (d) => d ? d.split('-').reverse().join('/') : '';
const monthTxt = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(y, mm - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).replace(' ', '-'); };
const n2 = (v) => (v === '' || v == null) ? '' : Number(v).toFixed(2);

// ---------- Dokumen cetak (4 borang, susunan sama seperti Excel) ----------
export function claimDocHtml(c, claim, files = {}) {
  const X = computeClaim(claim, c), R = X.R;
  const { from, to } = monthRange(claim.month);
  const range = `${dmy(from)} - ${dmy(to)}`;
  const head = (title) => `
    <div class="hd">${c.logo ? `<img src="${c.logo}">` : ''}<div><b>${esc(c.name)}</b><div class="s">${esc(c.address || '')}</div></div></div>
    <h2>${title}</h2>
    <table class="meta"><tr><td>Claimant:</td><td><b>${esc(claim.name)}</b> (${esc(claim.workerId)})</td></tr><tr><td>Month:</td><td><b>${monthTxt(claim.month)}</b></td></tr></table>`;
  const sign = () => `<div class="sign"><div>Approved by:<br><br>${claim.approvedBy ? `<b>${esc(claim.approvedBy)}</b><br><span class="s">${claim.approvedAt ? esc(claim.approvedAt) : ''}</span>` : '…………………………………………………..'}</div></div>`;
  const totRow = (label, v) => `<tr class="tt"><td colspan="2" class="r">${label}</td><td class="r">${n2(v)}</td></tr>`;

  // 1. CLAIM FORM
  const cf = `<div class="pg">${head('EXPENSES PROJECT CLAIM FORM')}
    <table class="g"><thead><tr><th>DATE RANGE</th><th>PROJECT NAME</th><th>MILEAGE</th><th>TOLL</th><th>TRAVEL</th><th>OUTSTATION/<br>OVERNIGHT</th><th>LODGING</th><th>PARKING</th><th>ENTERTAINMENT<br>FOOD &amp; BEVERAGES</th><th>TOOLS<br>ACCESSORIES</th><th>STATIONERY</th><th>MEDICAL</th><th>MISC/OTHERS</th><th>TOTAL</th></tr></thead>
    <tbody>${X.rows.map(r => `<tr><td>${range}</td><td>${esc(r.project)}</td>${['mileage', 'toll', 'travel', 'outOver', 'lodging', 'parking', 'fnb', 'tools', 'stationery', 'medical', 'others', 'total'].map(k => `<td class="r">${n2(r[k])}</td>`).join('')}</tr>`).join('')}
      <tr><td></td><td>MILEAGE ALLOWANCE OFFSET</td><td class="r">${X.offset ? n2(-X.offset) : n2(0)}</td><td colspan="11"></td></tr>
      ${claim.otherDetails ? `<tr><td></td><td colspan="13">Details for others claims: ${esc(claim.otherDetails)}</td></tr>` : ''}
      <tr class="tt"><td>Sub-Total</td><td></td>${['mileage', 'toll', 'travel', 'outOver', 'lodging', 'parking', 'fnb', 'tools', 'stationery', 'medical', 'others'].map(k => `<td class="r">${n2(X.sub[k])}</td>`).join('')}<td></td></tr>
    </tbody></table>
    <table class="sum"><tr><td>Total Expenses</td><td class="r">${n2(X.totalExpenses)}</td></tr><tr><td>&nbsp;</td><td></td></tr>
      <tr><td>Total (Allowance)</td><td class="r">${n2(X.allowanceTotal)}</td></tr><tr><td>Total (Claim)</td><td class="r">${n2(X.claimTotal)}</td></tr>
      <tr class="big"><td>Claim Reimbursement (RM)</td><td class="r">${n2(X.reimbursement)}</td></tr></table>
    ${sign()}</div>`;

  // 2. ALLOWANCE FORM
  const A = claim.allowances || [];
  const af = `<div class="pg">${head('ALLOWANCE CLAIM FORM')}
    <table class="g"><thead><tr><th>No</th><th>Expenses Details</th><th>Project<br>Allowance</th></tr></thead>
    <tbody>${A.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.details || '')}</td><td class="r">${n2(a.project)}</td></tr>`).join('') || '<tr><td colspan="3" class="c">-</td></tr>'}
      <tr class="tt"><td></td><td>Sub-Total</td><td class="r">${n2(X.allowSub.project)}</td></tr></tbody></table>
    <p class="s">${L('Outstation & overnight dituntut dalam Justification Form.', 'Outstation & overnight are claimed in the Justification Form.')}</p>
    <table class="sum"><tr class="big"><td>Total Expenses</td><td class="r">${n2(X.allowanceTotal)}</td></tr></table>
    ${sign()}</div>`;

  // 3. SST PURCHASES FORM
  const P = claim.purchases || [];
  const sf = `<div class="pg">${head('SST PURCHASES CLAIM FORM')}
    <table class="g"><thead><tr><th>Date</th><th>Supplier Name</th><th>SST Code</th><th>Invoice No</th><th>Expenses Details</th><th>Total Exclude SST</th><th>${R.sst}% SST</th><th>Total Inclusive ${R.sst}% SST</th><th>Remark</th></tr></thead>
    <tbody>${P.map(p => `<tr><td>${dmy(p.date)}</td><td>${esc(p.supplier || '')}</td><td>${esc(p.sstCode || '')}</td><td>${esc(p.invoice || '')}</td><td>${esc(p.cat)}</td><td class="r">${n2(p.amount)}</td><td class="r">${n2(p.sst || 0)}</td><td class="r">${n2(purchaseTotal(p))}</td><td>${esc(p.project || '')}${p.desc ? ` — ${esc(p.desc)}` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="c">-</td></tr>'}
      <tr class="tt"><td colspan="4"></td><td>Sub-Total</td><td class="r">${n2(X.sstSub.amount)}</td><td class="r">${n2(X.sstSub.sst)}</td><td class="r">${n2(X.sstSub.total)}</td><td></td></tr></tbody></table>
    <table class="sum"><tr class="big"><td>Total Expenses</td><td class="r">${n2(X.sstSub.total)}</td></tr></table>
    ${sign()}</div>`;

  // 4. JUSTIFICATION FORM
  const J = [...(claim.journeys || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const sumJ = (f) => J.reduce((a, j) => a + Number(j[f] || 0), 0);
  const jf = `<div class="pg">${head('EXPENSES CLAIM JUSTIFICATION FORM')}
    <table class="g"><thead><tr><th>Date</th><th>Journey From/To</th><th>Purpose of Journey</th><th>Mileage<br>(km)</th><th>Toll<br>(RM)</th><th>Parking<br>(RM)</th><th>Outstation</th><th>Overnight</th><th>Total<br>(RM)</th><th>Remarks</th></tr></thead>
    <tbody>${J.map(j => `<tr><td>${dmy(j.date)}</td><td>${esc(j.route || '')}</td><td>${esc(j.project || '')}</td><td class="r">${j.km || ''}</td><td class="r">${n2(j.toll || '')}</td><td class="r">${n2(j.parking || '')}</td><td class="r">${j.outstation || ''}</td><td class="r">${j.overnight || ''}</td><td class="r">${n2(journeyTotal(j, R))}</td><td>${esc(j.remarks || '')}</td></tr>`).join('') || '<tr><td colspan="10" class="c">-</td></tr>'}
      <tr class="tt"><td></td><td></td><td></td><td class="r">${sumJ('km')}</td><td class="r">${n2(sumJ('toll'))}</td><td class="r">${n2(sumJ('parking'))}</td>
        <td class="r">${n2(sumJ('outstation') * R.outstation)}</td><td class="r">${n2(sumJ('overnight') * R.overnight)}</td><td class="r">${n2(X.justTotal)}</td><td></td></tr></tbody></table>
    <p class="s">Mileage × RM${R.km}/km · Outstation × RM${R.outstation} · Overnight × RM${R.overnight}${X.kmTotal > 0 ? ` · ${L('Tolak', 'Less')} RM${R.offset} mileage offset` : ''}</p>
    ${sign()}</div>`;

  // Lampiran resit
  const pics = P.filter(p => p.fileId && files[p.fileId]);
  const att = pics.length ? `<div class="pg"><h2>RECEIPTS</h2><div class="pics">${pics.map(p => `<figure><img src="${files[p.fileId]}"><figcaption>${dmy(p.date)} · ${esc(p.supplier || '')} · ${esc(p.invoice || '')} · RM${n2(purchaseTotal(p))}</figcaption></figure>`).join('')}</div></div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Claim ${esc(claim.name)} ${esc(claim.month)}</title><style>
    @page{size:A4 landscape;margin:10mm}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#000;margin:0;padding:12px}
    .pg{page-break-after:always;margin-bottom:24px} .pg:last-child{page-break-after:auto}
    .hd{display:flex;gap:10px;align-items:center;border-bottom:2px solid #000;padding-bottom:6px} .hd img{height:42px} .s{color:#555;font-size:9.5px}
    h2{text-align:center;font-size:15px;margin:10px 0 6px;letter-spacing:.5px}
    .meta td{padding:1px 6px 1px 0}
    table.g{width:100%;border-collapse:collapse;margin-top:6px} .g th,.g td{border:1px solid #444;padding:4px 5px;vertical-align:top}
    .g th{background:#e9e9e9;font-size:9.5px} .r{text-align:right;white-space:nowrap} .c{text-align:center}
    .tt td{font-weight:bold;background:#f6f6f6}
    table.sum{margin:10px 0 0 auto;border-collapse:collapse;min-width:280px} .sum td{padding:3px 8px;border-bottom:1px solid #ccc} .sum .big td{font-size:13px;font-weight:bold;border-top:2px solid #000}
    .sign{margin-top:22px}
    .pics{display:flex;flex-wrap:wrap;gap:10px} figure{margin:0;width:31%} figure img{width:100%;border:1px solid #ccc} figcaption{font-size:9px}
    .noprint{text-align:center;margin:10px} @media print{.noprint{display:none}}
  </style></head><body>
  <div class="noprint"><button onclick="window.print()" style="padding:10px 20px;font-size:14px">Print / Save PDF</button></div>
  ${cf}${af}${sf}${jf}${att}</body></html>`;
}

// ---------- Eksport Excel (susunan sama) ----------
export function claimExcel(c, claim) {
  if (!window.XLSX) return false;
  const X = computeClaim(claim, c), R = X.R, { from, to } = monthRange(claim.month);
  const range = `${dmy(from)} - ${dmy(to)}`;
  const top = (title) => [['', '', title], ['Claimant:', claim.name], ['Month:', monthTxt(claim.month)], []];
  const wb = XLSX.utils.book_new();
  const cf = [...top('EXPENSES  PROJECT CLAIM  FORM'),
    ['DATE RANGE', 'PROJECT NAME', 'MILEAGE', 'TOLL', 'TRAVEL', 'OUTSTATION/\nOVERNIGHT', 'LODGING', 'PARKING', 'ENTERTAINMENT\nFOOD & BEVERAGES', 'TOOLS\nACCESSORIES', 'STATIONERY', 'MEDICAL', 'MISC/OTHERS', 'TOTAL'],
    ...X.rows.map(r => [range, r.project, r.mileage, r.toll, r.travel, r.outOver, r.lodging, r.parking, r.fnb, r.tools, r.stationery, r.medical, r.others, r.total]),
    ['', 'MILEAGE ALLOWANCE OFFSET', X.offset ? -X.offset : 0],
    ['', 'Details for others claims:', claim.otherDetails || ''],
    [], ['Sub-Total', '', X.sub.mileage, X.sub.toll, X.sub.travel, X.sub.outOver, X.sub.lodging, X.sub.parking, X.sub.fnb, X.sub.tools, X.sub.stationery, X.sub.medical, X.sub.others],
    ['', '', '', '', '', '', '', '', '', '', '', 'Total Expenses ', '', X.totalExpenses],
    ['', '            Approved by:'],
    ['', claim.approvedBy || '…………………………………………………..'],
    ['', '', '', '', '', '', '', '', '', '', 'Total (Allowance)', '', '', X.allowanceTotal],
    ['', '', '', '', '', '', '', '', '', '', 'Total (Claim)', '', '', X.claimTotal],
    ['', '', '', '', '', '', '', '', '', '', 'Claim Reimbursement', '', 'RM', X.reimbursement]];
  const ws1 = XLSX.utils.aoa_to_sheet(cf); ws1['!cols'] = [{ wch: 24 }, { wch: 30 }, ...Array(12).fill({ wch: 13 })];
  XLSX.utils.book_append_sheet(wb, ws1, 'CLAIM FORM');
  const A = claim.allowances || [];
  const af = [...top('ALLOWANCE CLAIM  FORM'),
    ['No', 'Expenses Details', 'Project\nAllowance'],
    ...A.map((a, i) => [i + 1, a.details || '', a.project || '']),
    ['Sub-Total', '', X.allowSub.project],
    ['', 'Total Expenses ', X.allowanceTotal], ['            Approved by:'], ['', claim.approvedBy || '…………………………………………………..']];
  const ws2 = XLSX.utils.aoa_to_sheet(af); ws2['!cols'] = [{ wch: 8 }, { wch: 34 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'ALLOWANCE FORM');
  const P = claim.purchases || [];
  const sf = [...top('SST PURCHASES CLAIM FORM'),
    ['Date', 'Supplier Name', 'SST Code', 'Invoice No', 'Expenses Details', 'Total Exclude SST', `${R.sst}% SST`, `Total Inclusive ${R.sst}% SST`, 'Remark'],
    ...P.map(p => [dmy(p.date), p.supplier || '', p.sstCode || '', p.invoice || '', p.cat, Number(p.amount || 0), Number(p.sst || 0), purchaseTotal(p), p.project || '']),
    ['', '', '', '', 'Sub-Total', X.sstSub.amount, X.sstSub.sst, X.sstSub.total],
    ['', '', '', '', '', 'Total Expenses ', '', X.sstSub.total], ['            Approved by:'], ['', claim.approvedBy || '…………………………………………………..']];
  const ws3 = XLSX.utils.aoa_to_sheet(sf); ws3['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'SST CLAIM FORM');
  const J = [...(claim.journeys || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const sumJ = (f) => J.reduce((a, j) => a + Number(j[f] || 0), 0);
  const jf = [...top('EXPENSES  CLAIM JUSTIFICATION FORM'),
    ['Date', 'Journey From/To', 'Purpose of Journey', 'Mileage\n(km)', 'Toll\n(RM)', 'Parking\n(RM)', 'Outstation', 'Overnight', 'Total \n(RM)', 'Remarks '],
    ...J.map(j => [dmy(j.date), j.route || '', j.project || '', j.km || '', j.toll || '', j.parking || '', j.outstation || '', j.overnight || '', journeyTotal(j, R), j.remarks || '']),
    ['', '', '', sumJ('km'), sumJ('toll'), sumJ('parking'), sumJ('outstation') * R.outstation, sumJ('overnight') * R.overnight, X.justTotal]];
  const ws4 = XLSX.utils.aoa_to_sheet(jf); ws4['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 28 }, ...Array(6).fill({ wch: 11 }), { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'JUSTIFICATION FORM');
  XLSX.writeFile(wb, `Claim_${claim.workerId}_${claim.month}.xlsx`);
  return true;
}
