// lib/adminStore.js
// SERVEUR UNIQUEMENT. Petit stockage privé de l'espace admin (table de correspondance
// des serrures, codes du personnel, réglages du croisement).
//
// Où : Firestore (projet de l'application), collection « admin_prive », écrit et lu
// UNIQUEMENT par le serveur avec le compte de service (FIREBASE_PROJECT_ID,
// FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, déjà présents sur Vercel).
//
// Pourquoi chiffré : tant que les règles Firestore restent ouvertes, n'importe qui peut
// lire la base sans être connecté. Le contenu est donc chiffré (AES-256-GCM) avec une clé
// dérivée de SESSION_SECRET, qui n'existe que sur le serveur : lu depuis le navigateur,
// le document n'est qu'une suite de caractères illisible.

import crypto from "crypto";

const COLLECTION = "admin_prive";
const SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 15000;

export class StoreError extends Error {
  constructor(message, { status = 502, step } = {}) {
    super(message);
    this.status = status;
    this.step = step;
  }
}

function creds() {
  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  return { projectId, clientEmail, privateKey };
}

export function isStoreConfigured() {
  const c = creds();
  return Boolean(c.projectId && c.clientEmail && c.privateKey && process.env.SESSION_SECRET);
}

// ---------- Chiffrement ----------

function dataKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new StoreError("SESSION_SECRET absent.", { status: 503, step: "configuration" });
  return crypto.createHmac("sha256", secret).update("fp_admin_data:v1").digest();
}

export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", dataKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decrypt(str) {
  const [v, iv, tag, ct] = String(str || "").split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new StoreError("Données admin illisibles (format).", { status: 500, step: "dechiffrement" });
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"));
  } catch {
    throw new StoreError("Données admin illisibles : SESSION_SECRET a-t-il changé ?", { status: 500, step: "dechiffrement" });
  }
}

// ---------- Jeton Google (compte de service, sans dépendance) ----------

let tokenCache = { token: "", exp: 0 };

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function googleToken(fetchImpl) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.exp > now + 60000) return tokenCache.token;
  const { clientEmail, privateKey } = creds();
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  let sig;
  try {
    sig = b64url(crypto.createSign("RSA-SHA256").update(`${head}.${claims}`).sign(privateKey));
  } catch (e) {
    throw new StoreError(`Clé du compte de service illisible (FIREBASE_PRIVATE_KEY) : ${e.message}`, { status: 500, step: "jeton-google" });
  }
  let r;
  try {
    r = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new StoreError(`Google injoignable : ${e.message}`, { step: "jeton-google" });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new StoreError(`Jeton Google refusé (HTTP ${r.status}) : ${data.error_description || data.error || "inconnu"}`, { step: "jeton-google" });
  }
  tokenCache = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}

// Jeton d'accès Google du compte de service (réutilisé par lib/especesJournal.js).
export async function jetonGoogle(fetchImpl = fetch) {
  return googleToken(fetchImpl);
}

export function projetFirestore() {
  return creds().projectId;
}

export function _resetStoreForTests() { tokenCache = { token: "", exp: 0 }; }

const DOC_NAME = /^[a-z0-9_-]{1,40}$/;

function docUrl(name) {
  if (!DOC_NAME.test(name)) throw new StoreError("Nom de document invalide.", { status: 500, step: "entree" });
  const { projectId } = creds();
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${COLLECTION}/${name}`;
}

// ---------- Lecture / écriture ----------

export async function readDoc(name, fetchImpl = fetch) {
  if (!isStoreConfigured()) throw new StoreError("Stockage admin non configuré (variables FIREBASE_* ou SESSION_SECRET absentes).", { status: 503, step: "configuration" });
  const token = await googleToken(fetchImpl);
  const r = await fetchImpl(docUrl(name), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status === 404) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new StoreError(`Lecture Firestore refusée (HTTP ${r.status}) : ${data?.error?.message || ""}`, { step: "lecture" });
  const enc = data?.fields?.data?.stringValue;
  return enc ? decrypt(enc) : null;
}

export async function writeDoc(name, obj, fetchImpl = fetch) {
  if (!isStoreConfigured()) throw new StoreError("Stockage admin non configuré (variables FIREBASE_* ou SESSION_SECRET absentes).", { status: 503, step: "configuration" });
  const token = await googleToken(fetchImpl);
  const body = { fields: { data: { stringValue: encrypt(obj) }, majLe: { timestampValue: new Date().toISOString() } } };
  const r = await fetchImpl(docUrl(name), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new StoreError(`Écriture Firestore refusée (HTTP ${r.status}) : ${data?.error?.message || ""}`, { step: "ecriture" });
  }
  return true;
}
