// =====================================================================
//  ProAttendance — Tetapan Firebase
//  Salin firebaseConfig projek "kukusanmy" (sama seperti ProSewa) di sini.
//  Firebase Console → Project settings → General → Your apps → Config
// =====================================================================
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDIncQ3Nt6v6_WbMCs42t81DZVg6f35Hwc",
  authDomain: "kukusanmy.firebaseapp.com",
  projectId: "kukusanmy",
  storageBucket: "kukusanmy.firebasestorage.app",
  messagingSenderId: "710803283811",
  appId: "1:710803283811:web:4ceb3dbabf376b7a39fd56"
};

// Firestore database khas ProAttendance (data berasingan dari KUKUSAN & ProSewa)
export const DB_ID = "proattendance";

// Kawasan Cloud Functions
export const REGION = "asia-southeast1";

// Domain e-mel dalaman untuk akaun pekerja (pekerja tidak nampak ini)
export const WORKER_EMAIL_DOMAIN = "pekerja.proattendance.app";

// Versi Firebase SDK
export const SDK = "10.12.2";

// Notifikasi push (pilihan): Firebase Console → Project settings → Cloud Messaging →
// Web Push certificates → "Generate key pair", kemudian tampal kunci di sini.
// Biarkan kosong untuk matikan notifikasi push.
export const VAPID_KEY = "";

// Versi aplikasi (dipaparkan di bawah menu — untuk pastikan deploy terkini)
export const APP_VERSION = "2026.11.20-c";
