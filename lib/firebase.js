// lib/firebase.js
// Configuration Firebase (client). Les clés viennent des variables d'environnement
// NEXT_PUBLIC_* définies sur Vercel. Ces clés Firebase sont publiques par conception
// (la sécurité repose sur les Firestore Security Rules, pas sur le secret des clés).

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Évite la ré-initialisation en dev / hot reload
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Auth est initialisé PARESSEUSEMENT (pas au chargement du module) : getAuth()
// valide le format de la clé API immédiatement et plante si elle est absente/vide,
// ce qui casserait le build/SSR dans les contextes sans variables d'environnement.
let _auth = null;
export function getAppAuth() {
  if (!_auth) _auth = getAuth(app);
  return _auth;
}

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}
