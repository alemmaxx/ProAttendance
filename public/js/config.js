// =====================================================================
//  ProAttendance — Tetapan Firebase
//  Salin firebaseConfig projek "kukusanmy" (sama seperti ProSewa) di sini.
//  Firebase Console → Project settings → General → Your apps → Config
// =====================================================================
export const FIREBASE_CONFIG = {
  apiKey: "ISI_API_KEY",
  authDomain: "kukusanmy.firebaseapp.com",
  projectId: "kukusanmy",
  storageBucket: "kukusanmy.appspot.com",
  messagingSenderId: "ISI_SENDER_ID",
  appId: "ISI_APP_ID"
};

// Firestore database khas ProAttendance (data berasingan dari KUKUSAN & ProSewa)
export const DB_ID = "proattendance";

// Kawasan Cloud Functions
export const REGION = "asia-southeast1";

// Domain e-mel dalaman untuk akaun pekerja (pekerja tidak nampak ini)
export const WORKER_EMAIL_DOMAIN = "pekerja.proattendance.app";

// Versi Firebase SDK
export const SDK = "10.12.2";
