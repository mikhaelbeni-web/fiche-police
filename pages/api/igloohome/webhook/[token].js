// pages/api/igloohome/webhook/[token].js
// Adresse appelée PAR igloohome (webhook). Publique par nature, mais protégée par un jeton
// secret dans l'adresse (404 sinon). Enregistre l'envoi tel quel, ne répond rien d'autre.
import { isValidWebhookToken, readRawBody, keptHeaders, parseBody, storeWebhook } from "../../../../lib/igloohomeWebhook";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!isValidWebhookToken(String(req.query.token || ""))) return res.status(404).json({ error: "Introuvable." });
  res.setHeader("Cache-Control", "no-store");
  // Certains services vérifient l'adresse par un GET ou un HEAD avant de l'enregistrer.
  if (req.method === "GET" || req.method === "HEAD") return res.status(200).json({ ok: true });
  if (req.method !== "POST" && req.method !== "PUT") {
    res.setHeader("Allow", "GET, POST, PUT");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  try {
    const raw = await readRawBody(req);
    await storeWebhook({
      recuLe: new Date().toISOString(),
      methode: req.method,
      entetes: keptHeaders(req.headers),
      corps: parseBody(raw),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    // On répond quand même 200 pour qu'igloohome ne désactive pas le webhook ; l'erreur
    // apparaît dans les journaux Vercel.
    console.error("webhook igloohome : enregistrement impossible :", e.message);
    return res.status(200).json({ ok: true, enregistre: false });
  }
}
