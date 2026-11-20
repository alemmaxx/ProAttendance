import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { FIREBASE_CONFIG, DB_ID, REGION, WORKER_EMAIL_DOMAIN } from "./config.js";

// Halaman pekerja guna sesi log masuk berasingan, supaya log masuk pekerja & admin
// dalam pelayar yang sama tidak saling log keluar.
const WORKER_PAGE = /^\/worker(\.html)?\/?$/i.test(location.pathname);
export const app = initializeApp(FIREBASE_CONFIG, WORKER_PAGE ? 'pa-worker' : '[DEFAULT]');
export const auth = getAuth(app);

// Cache tempatan (luar talian) HANYA untuk halaman pekerja & kiosk — punch tetap disimpan semasa tiada internet.
// Halaman admin / Super Admin guna sambungan terus supaya simpanan tidak tersekat bila banyak tab dibuka.
const OFFLINE_PAGE = /^\/(worker|kiosk|qr)(\.html)?\/?$/i.test(location.pathname);
let _db;
try {
  _db = OFFLINE_PAGE
    ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }, DB_ID)
    : initializeFirestore(app, {}, DB_ID);
} catch (e) {
  _db = getFirestore(app, DB_ID);
}
export const db = _db;
export const fns = getFunctions(app, REGION);
export const call = (name, data) => httpsCallable(fns, name)(data).then(r => r.data);

export const workerEmail = (workerId) => `${String(workerId).trim().toLowerCase()}@${WORKER_EMAIL_DOMAIN}`;
export { FIREBASE_CONFIG };
