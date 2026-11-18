// ProAttendance — Syif, jadual, cuti umum & cuti (Fasa 2)
import { L, todayStr, addDays } from './ui.js';
import { collection, query, where, getDocs, documentId } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ---------- Jenis cuti ----------
export const DEFAULT_LEAVE_TYPES = () => [
  { id: 'annual', name: L('Cuti Tahunan', 'Annual Leave'), days: 8, paid: true },
  { id: 'sick', name: L('Cuti Sakit (MC)', 'Sick Leave (MC)'), days: 14, paid: true },
  { id: 'emergency', name: L('Cuti Kecemasan', 'Emergency Leave'), days: 0, paid: true },
  { id: 'unpaid', name: L('Cuti Tanpa Gaji', 'Unpaid Leave'), days: 0, paid: false }
];
export const leaveTypes = (c) => (c?.leaveTypes && c.leaveTypes.length ? c.leaveTypes : DEFAULT_LEAVE_TYPES());
export const leaveTypeName = (c, id) => leaveTypes(c).find(t => t.id === id)?.name || id;

// ---------- Cuti umum ----------
export function holidayMap(c) {
  const m = {};
  (c?.holidays || []).forEach(h => { if (h.date) m[h.date] = h.name || L('Cuti umum', 'Public holiday'); });
  return m;
}
// Cuti umum kebangsaan bertarikh tetap (cuti agama perlu ditambah sendiri kerana tarikh berubah)
export function fixedNationalHolidays(year) {
  const firstMonJune = (() => { const d = new Date(year, 5, 1); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); return d.getDate(); })();
  const p = n => String(n).padStart(2, '0');
  return [
    { date: `${year}-05-01`, name: L('Hari Pekerja', 'Labour Day') },
    { date: `${year}-06-${p(firstMonJune)}`, name: L('Hari Keputeraan Agong', "King's Birthday") },
    { date: `${year}-08-31`, name: L('Hari Kebangsaan', 'National Day') },
    { date: `${year}-09-16`, name: L('Hari Malaysia', 'Malaysia Day') },
    { date: `${year}-12-25`, name: L('Hari Krismas', 'Christmas Day') }
  ];
}

// ---------- Syif ----------
export const shiftById = (c, id) => (c?.shiftTemplates || []).find(s => s.id === id) || null;
export const shiftLabel = (s) => s ? `${s.name} ${s.start}–${s.end}` : '';

// Tentukan jenis hari untuk seorang pekerja pada satu tarikh.
// rosterVal: nilai jadual (id syif / 'off' / undefined)
// Pulangkan { type: 'work' | 'off' | 'holiday', shift, holiday }
export function resolveDay(c, w, date, rosterVal) {
  const st = c?.settings || {};
  const hol = holidayMap(c)[date];
  if (rosterVal === 'off') return { type: 'off' };
  const rs = rosterVal ? shiftById(c, rosterVal) : null;
  if (rs) return { type: hol ? 'holiday' : 'work', holiday: hol, shift: rs, rostered: true };
  if (hol) return { type: 'holiday', holiday: hol };
  const dow = new Date(date + 'T00:00:00').getDay();
  const days = Array.isArray(w?.workDays) && w.workDays.length ? w.workDays : (st.workDays || [1, 2, 3, 4, 5]);
  if (!days.includes(dow)) return { type: 'off' };
  const def = w?.defaultShift ? shiftById(c, w.defaultShift) : null;
  return {
    type: 'work',
    shift: def || { id: '', name: L('Waktu biasa', 'Normal hours'), start: st.workStart || '09:00', end: st.workEnd || '18:00', grace: st.grace ?? 10 }
  };
}
// Tetapan untuk kiraan lewat
export function lateSettings(c, day) {
  if (!day?.shift) return {};
  return { workStart: day.shift.start, grace: day.shift.grace ?? c?.settings?.grace ?? 10 };
}
// Jenis OT ikut hari
export const otKind = (day) => day?.type === 'holiday' ? 'holiday' : day?.type === 'off' ? 'rest' : 'normal';
export const OT_LABEL = { normal: () => L('Hari biasa', 'Normal day'), rest: () => L('Hari rehat', 'Rest day'), holiday: () => L('Cuti umum', 'Public holiday') };
export const otRates = (c) => ({ normal: 1.5, rest: 2, holiday: 3, ...(c?.otRates || {}) });

// ---------- Jadual (roster) ----------
// Pulangkan { 'YYYY-MM-DD': { workerId: shiftId|'off' } }
export async function loadRoster(db, cid, from, to) {
  const s = await getDocs(query(collection(db, 'companies', cid, 'roster'), where(documentId(), '>=', from), where(documentId(), '<=', to)));
  const m = {};
  s.docs.forEach(d => { m[d.id] = d.data().a || {}; });
  return m;
}
export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function weekStart(date = todayStr()) {
  const d = new Date(date + 'T00:00:00');
  const diff = (d.getDay() + 6) % 7; // Isnin = permulaan minggu
  d.setDate(d.getDate() - diff);
  return todayStr(d);
}

// ---------- Kiraan cuti ----------
export function countLeaveDays(c, w, from, to, half, roster = {}) {
  if (!from || !to || from > to) return 0;
  if (half && from === to) return resolveDay(c, w, from, roster[from]?.[w?.id]).type === 'work' ? 0.5 : 0;
  return dateRange(from, to).filter(d => resolveDay(c, w, d, roster[d]?.[w?.id]).type === 'work').length;
}
// Baki cuti untuk tahun semasa
export function leaveBalances(c, w, approvedLeaves, year = new Date().getFullYear()) {
  return leaveTypes(c).map(t => {
    const ent = Number(w?.leaveEntitle?.[t.id] ?? t.days ?? 0);
    const carry = Number(w?.leaveCarry?.[t.id] || 0);
    const used = approvedLeaves
      .filter(r => r.kind === 'leave' && r.typeId === t.id && String(r.from || '').startsWith(String(year)))
      .reduce((a, r) => a + Number(r.days || 0), 0);
    return { ...t, ent, carry, used, left: ent + carry - used };
  });
}
// Tarikh cuti diluluskan → { date: request }
export function leaveDateMap(reqs) {
  const m = {};
  reqs.filter(r => r.kind === 'leave' && r.status === 'approved').forEach(r => {
    dateRange(r.from, r.to || r.from).forEach(d => { m[d] = r; });
  });
  return m;
}

export const REQ_LABEL = {
  leave: () => L('Cuti', 'Leave'),
  ot: () => 'OT',
  fix: () => L('Pembetulan punch', 'Punch correction')
};
export const STATUS_BADGE = (s) => ({
  pending: `<span class="badge b-warn">${L('Menunggu', 'Pending')}</span>`,
  approved: `<span class="badge b-ok">${L('Lulus', 'Approved')}</span>`,
  rejected: `<span class="badge b-bad">${L('Ditolak', 'Rejected')}</span>`,
  cancelled: `<span class="badge">${L('Dibatalkan', 'Cancelled')}</span>`
})[s] || s;

export function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const [h1, m1] = start.split(':').map(Number), [h2, m2] = end.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 1440;
  return Math.round(mins / 6) / 10;
}
