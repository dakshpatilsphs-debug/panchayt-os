import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

const cfg = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || "AIzaSyBCy_Y7f9tJAYGr2dz4G2FQNypb3ubNGKM",
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || "panchayat-2f83a.firebaseapp.com",
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || "panchayat-2f83a",
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) || "panchayat-2f83a.firebasestorage.app",
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || "233500855531",
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || "1:233500855531:web:7340a35a733208c7a0c2ae",
};

/** Demo mode = no Firebase keys configured; data lives in localStorage instead. */
export const isDemo = !cfg.apiKey || !cfg.projectId;

let app: FirebaseApp | null = null;
let fs: Firestore | null = null;

if (!isDemo) {
  app = initializeApp(cfg as Record<string, string>);
  fs = getFirestore(app);
}

export function fdb(): Firestore {
  if (!fs) throw new Error("Firestore is not configured — check your .env keys.");
  return fs;
}

// keep tree-shaking honest even if app is unused elsewhere
export function firebaseApp(): FirebaseApp | null {
  return app;
}
