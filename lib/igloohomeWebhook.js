// lib/igloohomeWebhook.js
// SERVEUR UNIQUEMENT. Réception des webhooks igloohome (test « qui tranche » du 2026-11-09) :
// igloohome ENVOIE lui-même les événements de serrure à notre adresse. Nous ne faisons
// qu'enregistrer ce qui arrive : aucun appel vers igloohome, aucune action sur les serrures.
//
// Adresse : /api/igloohome/webhook/<jeton>. Le jeton est dérivé de SESSION_SECRET (aucune
// variable à créer) ; sans lui, la route répond 404. Il n'est affiché que dans l'Espace admin.
// Stockage : document chiffré « igloohome_webhook » (lib/adminStore.js), 300 derniers envois.
import crypto from "crypto";
import { readDoc, writeDoc } from "./adminStore";

const DOC = "igloohome_webhook";
const MAX_EVENTS = 300;
const MAX_BYTES = 64 * 1024;

export function webhookToken() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update("igloohome-webhook:v1").digest("hex").slice(0, 40);
}

export function isValidWebhookToken(t) {
  const expected = webhookToken();
  if (!expected || typeof t !== "string" || t.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected));
}

export function webhookPath() {
  const t = webhookToken();
  return t ? `/api/igloohome/webhook/${t}` : "";
}

export async function readRawBody(req, limit = MAX_BYTES) {
  if (typeof req.body === "string") return req.body.slice(0, limit);
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body).slice(0, limit);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").slice(0, limit)));
    req.on("error", reject);
  });
}

// En-têtes utiles au diagnostic (jamais les cookies ni l'autorisation).
const KEEP = /^(content-type|user-agent|x-[a-z0-9-]*signature[a-z0-9-]*|x-igloo[a-z0-9-]*|x-request-id|x-webhook[a-z0-9-]*)$/i;
export function keptHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) if (KEEP.test(k)) out[k.toLowerCase()] = String(v).slice(0, 300);
  return out;
}

export function parseBody(text) {
  try { return JSON.parse(text); } catch { return text; }
}

export async function storeWebhook(entry, fetchImpl) {
  const doc = (await readDoc(DOC, fetchImpl)) || { evenements: [] };
  const evenements = [entry, ...(doc.evenements || [])].slice(0, MAX_EVENTS);
  await writeDoc(DOC, { evenements }, fetchImpl);
  return evenements.length;
}

export async function listWebhooks(fetchImpl) {
  const doc = await readDoc(DOC, fetchImpl);
  return doc?.evenements || [];
}
