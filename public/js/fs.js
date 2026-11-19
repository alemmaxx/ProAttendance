// ProAttendance — pembalut Firestore.
// Simpanan ditulis serta-merta (pengguna nampak terus) dan disahkan oleh server di latar belakang.
// Butang tidak lagi "loading" lama jika pengesahan server lambat (antivirus / ad-blocker / rangkaian perlahan).
// Jika server menolak selepas itu, mesej ralat tetap dipaparkan.
import * as F from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
export * from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const WAIT = 2500;
function lateError(e) {
  console.error('[simpan]', e);
  const en = (() => { try { return localStorage.getItem('pa_lang') === 'en'; } catch { return false; } })();
  const msg = e?.code === 'permission-denied'
    ? (en ? 'Save was rejected by the server (no permission). Please refresh.' : 'Simpanan ditolak oleh server (tiada kebenaran). Sila refresh.')
    : (en ? 'Save failed. Please refresh and try again.' : 'Simpanan gagal. Sila refresh dan cuba lagi.');
  window.dispatchEvent(new CustomEvent('pa-save-error', { detail: msg }));
}
function quick(p) {
  let settled = false;
  const tracked = p.then(v => { settled = true; return v; }, e => { settled = true; throw e; });
  return Promise.race([tracked, new Promise(r => setTimeout(r, WAIT))]).then(v => {
    if (!settled) tracked.catch(lateError);
    return v;
  });
}

export const setDoc = (...a) => quick(F.setDoc(...a));
export const updateDoc = (...a) => quick(F.updateDoc(...a));
export const deleteDoc = (...a) => quick(F.deleteDoc(...a));
export function addDoc(col, data) {
  const ref = F.doc(col);
  return quick(F.setDoc(ref, data)).then(() => ref);
}
export function writeBatch(db) {
  const b = F.writeBatch(db);
  const full = b.commit.bind(b);
  b.commitFull = full;          // tunggu pengesahan server sepenuhnya (cth: daftar syarikat)
  b.commit = () => quick(full());
  return b;
}
