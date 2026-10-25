import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
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
