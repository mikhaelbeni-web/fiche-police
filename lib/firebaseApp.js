// lib/firebaseApp.js
// Application Firebase seule (sans Firestore) : petit module, importable
// partout sans embarquer le SDK Firestore complet dans le code de la page.
// Les clés NEXT_PUBLIC_* sont publiques par conception (voir lib/firebase.js).

import { initializeApp, getApps, getApp } from "firebase/app";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

// Évite la ré-initialisation en dev / hot reload
export function getFirebaseApp() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}
