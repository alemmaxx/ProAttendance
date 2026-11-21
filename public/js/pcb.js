// PCB / MTD — pengiraan berkomputer (anggaran ikut formula LHDN untuk saraan biasa + saraan tambahan)
// PCB bulan semasa = [ (P − M) × R + B − (Z + X) ] / (n + 1)
//   P = [Σ(Y − K) + (Y1 − K1) + (Y2 − K2) × n + (Yt − Kt)] − (D + S + Du + Su + QC)
// Nota: anggaran — finance boleh tukar kepada amaun manual (cth. ikut Kalkulator PCB LHDN) pada bila-bila masa.

// Jadual kadar cukai pemastautin (had atas band, kadar). YA 2027 = cadangan Bajet 2027.
const BANDS = {
  2026: [[5000, 0], [20000, 0.01], [35000, 0.03], [50000, 0.06], [70000, 0.11], [100000, 0.19], [400000, 0.25], [600000, 0.26], [2000000, 0.28], [Infinity, 0.30]],
  2027: [[5000, 0], [20000, 0.01], [35000, 0.03], [50000, 0.06], [70000, 0.11], [100000, 0.18], [150000, 0.24], [400000, 0.25], [600000, 0.26], [1000000, 0.28], [Infinity, 0.30]]
};
const RELIEF = {
  2026: { D: 9000, S: 4000, Du: 7000, Su: 6000, Q: 2000, Qhigher: 8000, Qoku: 8000, epfMax: 4000, rebate: 400, rebateLimit: 35000 },
  2027: { D: 12000, S: 4000, Du: 7000, Su: 6000, Q: 2000, Qhigher: 8000, Qoku: 8000, epfMax: 4000, rebate: 400, rebateLimit: 35000 }
};
export const PCB_YEAR_NOTE = { 2027: 'Bajet 2027 (cadangan)' };

const yearOf = (y) => (BANDS[y] ? y : (y > 2027 ? 2027 : 2026));
const trunc2 = (x) => Math.floor(x * 100 + 1e-6) / 100;
const up5sen = (x) => Math.ceil(Math.round(x * 100) / 5 - 1e-9) * 5 / 100;

// Cukai setahun atas pendapatan bercukai P (sebelum rebat)
export function annualTax(P, year) {
  const b = BANDS[yearOf(year)];
  let tax = 0, lo = 0;
  for (const [hi, r] of b) {
    if (P <= lo) break;
    tax += (Math.min(P, hi) - lo) * r;
    lo = hi;
  }
  return tax;
}

// Profil cukai pekerja (dari pcbMap finance): { mode:'auto', cat:1|2|3, kids, kidsHigher, kidsOku, oku, spouseOku, zakat, nonRes }
export const isAutoPcb = (cfg) => cfg && typeof cfg === 'object' && cfg.mode === 'auto';
export const manualPcb = (cfg) => (cfg && typeof cfg === 'object') ? Number(cfg.amount || 0) : Number(cfg || 0);

/**
 * @param {object} a
 *  year, month (1-12), cfg (profil), y1 (saraan biasa bulan ini), k1 (KWSP pekerja atas saraan biasa),
 *  yt (saraan tambahan / bonus bulan ini), kt (KWSP atas bonus), ytd {y, k, x, z} (bulan terdahulu dalam tahun yang sama)
 */
export function calcPcb(a) {
  const year = yearOf(a.year), R = RELIEF[year], n = 12 - a.month;
  const cfg = a.cfg || {}, ytd = a.ytd || {};
  const y1 = Math.max(0, a.y1 || 0), yt = Math.max(0, a.yt || 0);
  // Bukan pemastautin: kadar rata 30%
  if (cfg.nonRes) {
    const v = up5sen(trunc2((y1 + yt) * 0.30));
    return { pcb: v, normal: v, bonus: 0, P: 0, note: 'Bukan pemastautin 30%' };
  }
  const kPrev = Math.max(0, ytd.k || 0);
  const k1 = Math.min(Math.max(0, a.k1 || 0), Math.max(0, R.epfMax - kPrev));
  const kt = Math.min(Math.max(0, a.kt || 0), Math.max(0, R.epfMax - kPrev - k1));
  const k2 = n > 0 ? Math.min(k1, Math.max(0, (R.epfMax - kPrev - k1 - kt) / n)) : 0;
  const cat = Number(cfg.cat || 1);
  const relief = R.D + (cat === 2 ? R.S : 0) + (cfg.oku ? R.Du : 0) + (cat === 2 && cfg.spouseOku ? R.Su : 0)
    + Number(cfg.kids || 0) * R.Q + Number(cfg.kidsHigher || 0) * R.Qhigher + Number(cfg.kidsOku || 0) * R.Qoku;
  const rebate = (P) => P <= R.rebateLimit ? R.rebate + (cat === 2 ? R.rebate : 0) : 0;
  const tax = (P) => Math.max(0, annualTax(P, year) - rebate(P));
  const X = Math.max(0, ytd.x || 0), Z = Math.max(0, ytd.z || 0) + Number(cfg.zakat || 0) * (a.month - 1);
  const base = Math.max(0, (ytd.y || 0) - kPrev) + (y1 - k1) + (y1 - k2) * n;
  // Saraan biasa
  const P1 = Math.max(0, base - relief);
  const T1 = tax(P1);
  let normal = Math.max(0, (T1 - (Z + X)) / (n + 1));
  normal = trunc2(normal);
  // Saraan tambahan (bonus / insentif)
  let bonus = 0;
  if (yt > 0) {
    const P2 = Math.max(0, base + (yt - kt) - relief);
    bonus = trunc2(Math.max(0, tax(P2) - (X + Z + normal * (n + 1))));
  }
  let pcb = up5sen(normal + bonus);
  // Zakat bulan semasa ditolak daripada PCB
  pcb = Math.max(0, up5sen(pcb - Number(cfg.zakat || 0)));
  if (pcb < 10) pcb = 0;   // PCB < RM10 tidak perlu dipotong
  return { pcb, normal, bonus, P: Math.round(P1), relief, year, note: PCB_YEAR_NOTE[year] || '' };
}
