// pages/api/admin/igloohome/webhook.js
// Espace admin : adresse du webhook à coller dans le portail igloohome, et envois reçus.
// Admin uniquement (404 sinon).
import { requireAdminApi } from "../../../../lib/adminAuth";
import { webhookPath, listWebhooks } from "../../../../lib/igloohomeWebhook";

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule." });
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const path = webhookPath();
  try {
    return res.status(200).json({ ok: true, adresse: host && path ? `https://${host}${path}` : "", evenements: await listWebhooks() });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message, adresse: host && path ? `https://${host}${path}` : "" });
  }
}
