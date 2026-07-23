// lib/firebaseAdmin.js
// SERVEUR UNIQUEMENT — ne jamais importer ce fichier depuis un composant React.
// Utilise un compte de service pour signer des jetons Firebase Auth personnalisés,
// délivrés uniquement après validation du code d'accès (pages/api/auth.js).
// Variables d'environnement requises sur Vercel (issues du JSON du compte de service
// téléchargé depuis Firebase Console > Paramètres du projet > Comptes de service) :
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY   (coller la valeur avec les \n échappés, voir README-FIREBASE.md)

import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function buildApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) return null;

  return getApps().length
    ? getApp()
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function isAdminConfigured() {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

// uid fixe : il n'y a qu'un seul "compte" partagé (celui qui a le code d'accès).
// L'identification nominative (qui a fait quoi) reste gérée séparément par lib/staff.js.
export async function mintAccessToken() {
  const app = buildApp();
  if (!app) return null;
  return getAuth(app).createCustomToken("reception-gate");
}
