// ProAttendance — Notifikasi push (pilihan; perlukan VAPID_KEY dalam config.js)
import { app, db } from './fb.js';
import { VAPID_KEY } from './config.js';
import { getMessaging, getToken, isSupported, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
import { doc, setDoc, serverTimestamp } from './fs.js';
import { toast } from './ui.js';

export async function pushAvailable() {
  if (!VAPID_KEY || !('Notification' in window) || !('serviceWorker' in navigator) || location.protocol !== 'https:') return false;
  try { return await isSupported(); } catch { return false; }
}
async function saveToken(cid, uid, extra) {
  const reg = await navigator.serviceWorker.ready;
  const m = getMessaging(app);
  const token = await getToken(m, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('no token');
  await setDoc(doc(db, 'companies', cid, 'tokens', uid), { token, ...extra, at: serverTimestamp() });
  onMessage(m, (p) => toast(`${p.notification?.title || ''} — ${p.notification?.body || ''}`, 'ok', 6000));
  return token;
}
// Minta kebenaran (dipanggil dari butang)
export async function enablePush(cid, uid, extra) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  return saveToken(cid, uid, extra);
}
// Kemas kini token secara senyap jika kebenaran sudah diberi
export async function refreshPush(cid, uid, extra) {
  try { if (await pushAvailable() && Notification.permission === 'granted') await saveToken(cid, uid, extra); } catch {}
}
