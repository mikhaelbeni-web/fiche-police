// lib/firebase.js
// Configuration Firebase (client). Les clés viennent des variables d'environnement
// NEXT_PUBLIC_* définies sur Vercel. Ces clés Firebase sont publiques par conception
// (la sécurité repose sur les Firestore Security Rules, pas sur le secret des clés).
// lib/firebaseApp.js porte la configuration seule, pour les pages qui veulent
// savoir si Firebase est configuré sans embarquer le SDK Firestore.

import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFirebaseApp, isFirebaseConfigured } from "./firebaseApp";

export const app = getFirebaseApp();
export const db = getFirestore(app);

// Audit mobile (qa-mobile/) uniquement : quand cette variable est définie au
// build, l'app lit l'émulateur Firestore local rempli de données fictives.
// Jamais définie sur Vercel : sans effet en production.
const EMU = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR;
if (EMU && !globalThis.__fsEmu) {
  const [host, port] = EMU.split(":");
  connectFirestoreEmulator(db, host, Number(port));
  globalThis.__fsEmu = true;
}

export { isFirebaseConfigured };
