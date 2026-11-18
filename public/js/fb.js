import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { FIREBASE_CONFIG, DB_ID, REGION, WORKER_EMAIL_DOMAIN } from "./config.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = getFirestore(app, DB_ID);
export const fns = getFunctions(app, REGION);
export const call = (name, data) => httpsCallable(fns, name)(data).then(r => r.data);

export const workerEmail = (workerId) => `${String(workerId).trim().toLowerCase()}@${WORKER_EMAIL_DOMAIN}`;
export { FIREBASE_CONFIG };
