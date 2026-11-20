// ProAttendance — jadual caruman berkanun Malaysia (KWSP, PERKESO, SIP, SKBBK)
// Dikemas kini Nov 2026. Kaedah ikut jadual rasmi:
//  • KWSP (Jadual Ketiga): gaji ≤ RM5,000 julat RM20, RM5,000–RM20,000 julat RM100;
//    caruman = kadar × had atas julat, dibundarkan NAIK ke ringgit. > RM20,000: kadar × gaji (bundar naik).
//    Contoh rasmi: RM6,250 → majikan RM756, pekerja RM693.
//  • PERKESO / SIP / SKBBK: julat RM100 (julat kecil di bawah RM300), siling RM6,000;
//    caruman = kadar × titik tengah julat, dibundarkan ke 5 sen terdekat.
//    Contoh rasmi: RM2,900.01–3,000 → majikan 51.65, pekerja 14.75, SKBBK 22.15, Kategori 2 majikan 36.90.

import { L } from './ui.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const to5sen = (x) => Math.round(x * 20 + 1e-7) / 20;
const ceilRM = (x) => Math.ceil(x - 1e-7);

// Umur pada akhir bulan gaji
export function ageAt(dob, period) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y) return null;
  const [by, bm] = dob.split('-').map(Number);
  return y - by - (m < bm ? 1 : 0);
}

// ---------- KWSP ----------
function epfBand(w) {
  if (w <= 10) return 0;
  if (w <= 5000) return Math.ceil(w / 20) * 20;
  if (w <= 20000) return Math.ceil(w / 100) * 100;
  return w;
}
export function epf(wage, { nationality = 'citizen', age = null } = {}) {
  const w = Math.max(0, Number(wage) || 0);
  if (w <= 10) return { ee: 0, er: 0, note: '' };
  if (nationality === 'foreign') return { ee: ceilRM(w * 0.02), er: ceilRM(w * 0.02), note: L('Asing 2% + 2%', 'Foreign 2% + 2%') };
  const U = epfBand(w), over60 = age != null && age >= 60;
  let eeR, erR, note;
  if (!over60) { eeR = 0.11; erR = w <= 5000 ? 0.13 : 0.12; note = ''; }
  else if (nationality === 'pr') { eeR = 0.055; erR = w <= 5000 ? 0.065 : 0.06; note = L('PR ≥60', 'PR ≥60'); }
  else { eeR = 0; erR = 0.04; note = L('≥60 tahun', 'age ≥60'); }
  return { ee: eeR ? ceilRM(U * eeR) : 0, er: ceilRM(U * erR), note };
}

// ---------- PERKESO / SIP / SKBBK (titik tengah julat) ----------
const LOW = [[0, 30], [30, 50], [50, 70], [70, 100], [100, 140], [140, 200], [200, 300]];
export const SOCSO_CEIL = 6000;
function midpoint(wage) {
  const w = Math.min(Math.max(0, Number(wage) || 0), SOCSO_CEIL);
  if (w <= 0) return 0;
  const lo = LOW.find(([a, b]) => w > a && w <= b);
  if (lo) return (lo[0] + lo[1]) / 2;
  const hi = Math.ceil(w / 100) * 100;
  return hi - 50;
}
export const skbbkRate = (period) => (period >= '2031-06' ? 0.0125 : period >= '2028-06' ? 0.01 : period >= '2026-06' ? 0.0075 : 0);

export function socso(wage, { nationality = 'citizen', age = null, cat2 = false, skbbk = true, period = '' } = {}) {
  const mp = midpoint(wage);
  if (!mp) return { ee: 0, er: 0, skbbk: 0, cat: 0 };
  const second = cat2 || (age != null && age >= 60);
  const er = to5sen(mp * (second ? 0.0125 : 0.0175));
  const ee = second ? 0 : to5sen(mp * 0.005);
  const sk = (nationality === 'foreign' || skbbk !== false) ? to5sen(mp * skbbkRate(period || '9999')) : 0;
  return { ee: r2(ee), er: r2(er), skbbk: r2(sk), cat: second ? 2 : 1 };
}
export function eis(wage, { nationality = 'citizen', age = null } = {}) {
  if (nationality === 'foreign' || (age != null && age >= 60)) return { ee: 0, er: 0 };
  const mp = midpoint(wage);
  const v = r2(to5sen(mp * 0.002));
  return { ee: v, er: v };
}
