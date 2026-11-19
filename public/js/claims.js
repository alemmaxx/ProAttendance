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
  submitted: () => [L('Menunggu semakan', 'Awaiting check'), 'b-warn'],
  checked: () => [L('Disemak — menunggu kelulusan', 'Checked — awaiting approval'), 'b-warn'],
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
  const who = (n, d) => n ? `<b>${esc(n)}</b><br><span class="s">${d ? esc(d) : ''}</span>` : '…………………………………………………..';
  const sign = () => `<div class="sign"><div>Checked by:<br><br>${who(claim.checkedBy, claim.checkedAt)}</div><div>Approved by:<br><br>${who(claim.approvedBy, claim.approvedAt)}</div></div>`;
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
    .sign{margin-top:22px;display:flex;gap:60px}
    .pics{display:flex;flex-wrap:wrap;gap:10px} figure{margin:0;width:31%} figure img{width:100%;border:1px solid #ccc} figcaption{font-size:9px}
    .noprint{text-align:center;margin:10px} @media print{.noprint{display:none}}
  </style></head><body>
  <div class="noprint"><button onclick="window.print()" style="padding:10px 20px;font-size:14px">Print / Save PDF</button></div>
  ${cf}${af}${sf}${jf}${att}</body></html>`;
}

// ---------- Eksport Excel bergaya (berkotak, ikut borang syarikat) ----------
let _xl = null;
export function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (_xl) return _xl;
  _xl = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    sc.onload = () => res(window.ExcelJS); sc.onerror = () => { _xl = null; rej(new Error('excel')); };
    document.head.appendChild(sc);
  });
  return _xl;
}
const THIN = { style: 'thin', color: { argb: 'FF555555' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2EC' } };
const TOT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F3F3' } };
const GOLD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const NUM = '#,##0.00;[Red]-#,##0.00;"-"';

// Tajuk borang: nama syarikat, tajuk, pemohon & bulan
function xlHead(ws, c, claim, title, cols) {
  ws.mergeCells(1, 1, 1, cols); ws.getCell(1, 1).value = c.name || '';
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, cols); ws.getCell(2, 1).value = title;
  ws.getCell(2, 1).font = { bold: true, size: 13 }; ws.getCell(2, 1).alignment = { horizontal: 'center' };
  ws.getCell(4, 1).value = 'Claimant:'; ws.getCell(4, 2).value = `${claim.name || ''} (${claim.workerId || ''})`; ws.getCell(4, 2).font = { bold: true };
  ws.getCell(5, 1).value = 'Month:'; ws.getCell(5, 2).value = monthTxt(claim.month); ws.getCell(5, 2).font = { bold: true };
  return 7;
}
// Jadual berkotak: header + baris; pulangkan baris seterusnya
function xlTable(ws, r0, headers, rows, opt = {}) {
  const hr = ws.getRow(r0);
  headers.forEach((h, i) => { const cell = hr.getCell(i + 1); cell.value = h; cell.font = { bold: true, size: 10 }; cell.fill = HEAD_FILL; cell.border = BOX; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  hr.height = opt.headH || 32;
  rows.forEach((row, k) => {
    const r = ws.getRow(r0 + 1 + k);
    row.forEach((v, i) => {
      const cell = r.getCell(i + 1); cell.value = v; cell.border = BOX;
      if (typeof v === 'number') { cell.numFmt = (opt.intCols || []).includes(i) ? '0' : NUM; cell.alignment = { horizontal: 'right' }; }
      else cell.alignment = { vertical: 'top', wrapText: true };
      if (opt.totalRows?.includes(k)) { cell.font = { bold: true }; cell.fill = TOT_FILL; }
    });
  });
  return r0 + 1 + rows.length;
}
// Blok ringkasan (label : nilai) di sebelah kanan
function xlSummary(ws, r0, col, items) {
  items.forEach(([label, v, strong], k) => {
    const r = ws.getRow(r0 + k);
    const a = r.getCell(col), b = r.getCell(col + 1);
    a.value = label; b.value = v; b.numFmt = NUM;
    [a, b].forEach(x => { x.border = BOX; if (strong) { x.font = { bold: true, size: strong === 2 ? 12 : 11 }; x.fill = strong === 2 ? GOLD_FILL : TOT_FILL; } });
    b.alignment = { horizontal: 'right' };
  });
  return r0 + items.length;
}
function xlSign(ws, r, claim) {
  ws.getCell(r, 1).value = 'Checked by:'; ws.getCell(r, 4).value = 'Approved by:';
  ws.getCell(r + 2, 1).value = claim.checkedBy || '……………………………'; ws.getCell(r + 2, 4).value = claim.approvedBy || '……………………………';
  ws.getCell(r + 3, 1).value = claim.checkedAt || ''; ws.getCell(r + 3, 4).value = claim.approvedAt || '';
  [ws.getCell(r + 2, 1), ws.getCell(r + 2, 4)].forEach(x => { x.font = { bold: true }; x.border = { top: THIN }; });
}
function xlPrint(ws) { ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: .3, right: .3, top: .4, bottom: .4, header: .2, footer: .2 } }; }
async function xlDownload(wb, name) {
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

export async function claimExcel(c, claim) {
  const ExcelJS = await loadExcelJS();
  const X = computeClaim(claim, c), R = X.R, { from, to } = monthRange(claim.month);
  const range = `${dmy(from)} - ${dmy(to)}`;
  const wb = new ExcelJS.Workbook(); wb.creator = c.name || '';

  // 1. CLAIM FORM
  let ws = wb.addWorksheet('CLAIM FORM'); xlPrint(ws);
  ws.columns = [{ width: 23 }, { width: 30 }, ...Array.from({ length: 12 }, () => ({ width: 13 }))];
  let r = xlHead(ws, c, claim, 'EXPENSES PROJECT CLAIM FORM', 14);
  const K = ['mileage', 'toll', 'travel', 'outOver', 'lodging', 'parking', 'fnb', 'tools', 'stationery', 'medical', 'others'];
  const rows = X.rows.map(x => [range, x.project, ...K.map(k => x[k]), x.total]);
  rows.push(['', 'MILEAGE ALLOWANCE OFFSET', X.offset ? -X.offset : 0, ...Array(11).fill('')]);
  if (claim.otherDetails) rows.push(['', 'Details for others claims: ' + claim.otherDetails, ...Array(12).fill('')]);
  rows.push(['Sub-Total', '', ...K.map(k => X.sub[k]), X.totalExpenses]);
  r = xlTable(ws, r, ['DATE RANGE', 'PROJECT NAME', 'MILEAGE', 'TOLL', 'TRAVEL', 'OUTSTATION/\nOVERNIGHT', 'LODGING', 'PARKING', 'ENTERTAINMENT\nFOOD & BEVERAGES', 'TOOLS\nACCESSORIES', 'STATIONERY', 'MEDICAL', 'MISC/OTHERS', 'TOTAL'], rows, { totalRows: [rows.length - 1], headH: 42 });
  const sEnd = xlSummary(ws, r + 1, 12, [['Total Expenses', X.totalExpenses, 1], ['Total (Allowance)', X.allowanceTotal], ['Total (Claim)', X.claimTotal], ['Claim Reimbursement (RM)', X.reimbursement, 2]]);
  xlSign(ws, sEnd + 2, claim);

  // 2. ALLOWANCE FORM
  ws = wb.addWorksheet('ALLOWANCE FORM'); xlPrint(ws);
  ws.columns = [{ width: 8 }, { width: 46 }, { width: 18 }];
  r = xlHead(ws, c, claim, 'ALLOWANCE CLAIM FORM', 3);
  const A = claim.allowances || [];
  const arows = A.map((a, i) => [i + 1, a.details || '', Number(a.project || 0)]);
  arows.push(['', 'Sub-Total', X.allowSub.project]);
  r = xlTable(ws, r, ['No', 'Expenses Details', 'Project\nAllowance'], arows, { totalRows: [arows.length - 1], intCols: [0] });
  ws.getCell(r, 2).value = 'Outstation & overnight are claimed in the Justification Form.'; ws.getCell(r, 2).font = { italic: true, size: 9, color: { argb: 'FF777777' } };
  xlSummary(ws, r + 1, 2, [['Total Expenses', X.allowanceTotal, 2]]);
  xlSign(ws, r + 4, claim);

  // 3. SST PURCHASES
  ws = wb.addWorksheet('SST CLAIM FORM'); xlPrint(ws);
  ws.columns = [{ width: 12 }, { width: 28 }, { width: 18 }, { width: 15 }, { width: 22 }, { width: 15 }, { width: 11 }, { width: 17 }, { width: 30 }];
  r = xlHead(ws, c, claim, 'SST PURCHASES CLAIM FORM', 9);
  const P = claim.purchases || [];
  const prow = P.map(p => [dmy(p.date), p.supplier || '', p.sstCode || '', p.invoice || '', p.cat || '', Number(p.amount || 0), Number(p.sst || 0), purchaseTotal(p), p.project || '']);
  prow.push(['', '', '', '', 'Sub-Total', X.sstSub.amount, X.sstSub.sst, X.sstSub.total, '']);
  r = xlTable(ws, r, ['Date', 'Supplier Name', 'SST Code', 'Invoice No', 'Expenses Details', 'Total Exclude SST', `${R.sst}% SST`, `Total Inclusive ${R.sst}% SST`, 'Remark'], prow, { totalRows: [prow.length - 1] });
  xlSummary(ws, r + 1, 7, [['Total Expenses', X.sstSub.total, 2]]);
  xlSign(ws, r + 3, claim);

  // 4. JUSTIFICATION FORM
  ws = wb.addWorksheet('JUSTIFICATION FORM'); xlPrint(ws);
  ws.columns = [{ width: 12 }, { width: 38 }, { width: 26 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 13 }, { width: 28 }];
  r = xlHead(ws, c, claim, 'EXPENSES CLAIM JUSTIFICATION FORM', 10);
  const J = [...(claim.journeys || [])].sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const sumJ = (f) => J.reduce((a, j) => a + Number(j[f] || 0), 0);
  const jrows = J.map(j => [dmy(j.date), j.route || '', j.project || '', Number(j.km || 0), Number(j.toll || 0), Number(j.parking || 0), Number(j.outstation || 0), Number(j.overnight || 0), journeyTotal(j, R), j.remarks || '']);
  jrows.push(['', '', 'Total', sumJ('km'), sumJ('toll'), sumJ('parking'), sumJ('outstation') * R.outstation, sumJ('overnight') * R.overnight, r2(J.reduce((a, j) => a + journeyTotal(j, R), 0)), '']);
  if (X.kmTotal > 0) jrows.push(['', '', 'Less mileage allowance offset', '', '', '', '', '', -X.offset, '']);
  jrows.push(['', '', 'Grand Total', '', '', '', '', '', X.justTotal, '']);
  r = xlTable(ws, r, ['Date', 'Journey From/To', 'Purpose of Journey', 'Mileage\n(km)', 'Toll\n(RM)', 'Parking\n(RM)', 'Outstation', 'Overnight', 'Total\n(RM)', 'Remarks'], jrows,
    { totalRows: [J.length, ...(X.kmTotal > 0 ? [J.length + 1] : []), jrows.length - 1] });
  ws.getCell(r, 2).value = `Mileage × RM${R.km}/km · Outstation × RM${R.outstation} · Overnight × RM${R.overnight}`; ws.getCell(r, 2).font = { italic: true, size: 9, color: { argb: 'FF777777' } };
  xlSign(ws, r + 2, claim);

  await xlDownload(wb, `Claim_${claim.workerId}_${claim.month}.xlsx`);
  return true;
}

// Ringkasan tuntutan sebulan (admin)
export async function claimSummaryExcel(c, list, month) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(month); xlPrint(ws);
  const H = ['ID', 'Name', 'Status', 'Mileage', 'Toll', 'Travel', 'Outstation/\nOvernight', 'Lodging', 'Parking', 'F&B', 'Tools', 'Stationery', 'Medical', 'Others', 'Total\nExpenses', 'Total\n(Allowance)', 'Claim\nReimbursement', 'Checked by', 'Approved by', 'Paid ref'];
  ws.columns = [{ width: 11 }, { width: 26 }, { width: 12 }, ...Array.from({ length: 14 }, () => ({ width: 12 })), { width: 18 }, { width: 18 }, { width: 16 }];
  ws.mergeCells(1, 1, 1, H.length); ws.getCell(1, 1).value = c.name || ''; ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, H.length); ws.getCell(2, 1).value = `CLAIMS SUMMARY — ${monthTxt(month)}`; ws.getCell(2, 1).font = { bold: true, size: 12 };
  const K = ['mileage', 'toll', 'travel', 'outOver', 'lodging', 'parking', 'fnb', 'tools', 'stationery', 'medical', 'others'];
  const rows = list.map(x => { const X = computeClaim(x, c); return [x.workerId || '', x.name || '', x.status || '', ...K.map(k => X.sub[k]), X.totalExpenses, X.allowanceTotal, X.reimbursement, x.checkedBy || '', x.approvedBy || '', x.paidRef || '']; });
  const tot = ['', 'TOTAL', '', ...Array.from({ length: 14 }, (_, i) => r2(rows.reduce((a, row) => a + Number(row[3 + i] || 0), 0))), '', '', ''];
  rows.push(tot);
  xlTable(ws, 4, H, rows, { totalRows: [rows.length - 1], headH: 34 });
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 2 }];
  await xlDownload(wb, `Claims_${c.code || ''}_${month}.xlsx`);
}

// Garis masa status (untuk pekerja & admin)
export function claimTimeline(cl) {
  const st = cl.status || 'draft';
  const rank = { draft: 0, rejected: 0, submitted: 1, checked: 2, approved: 3, paid: 4 }[st] ?? 0;
  const steps = [
    [L('Dihantar', 'Submitted'), ''],
    [L('Disemak penyelia', 'Checked by supervisor'), cl.checkedBy ? `${cl.checkedBy}${cl.checkedAt ? ' · ' + cl.checkedAt : ''}` : ''],
    [L('Diluluskan finance/boss', 'Approved by finance/boss'), cl.approvedBy ? `${cl.approvedBy}${cl.approvedAt ? ' · ' + cl.approvedAt : ''}` : ''],
    [L('Dibayar', 'Paid'), cl.paidRef || '']
  ];
  return `<div class="tl">${steps.map(([t, d], i) => `<div class="tl-s ${i < rank ? 'done' : ''} ${i === rank ? 'now' : ''}"><span class="tl-d">${i < rank ? '✓' : i + 1}</span><div><b>${t}</b>${d && i < rank ? `<div class="xs muted">${esc(d)}</div>` : ''}</div></div>`).join('')}</div>`
    + (st === 'rejected' ? `<p class="xs" style="color:var(--bad);margin:.3rem 0 0">${L('Ditolak — sila betulkan & hantar semula.', 'Rejected — please fix & resubmit.')}</p>` : '');
}
