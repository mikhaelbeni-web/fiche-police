// pages/api/admin/igloohome/activity.js
// « Voir l'historique » d'une serrure sur N jours (7 par défaut, 31 max), événements bruts.
// Admin uniquement (404 sinon). Lecture seule : voir lib/igloohome.js.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { readActivity, apiBase } from "../../../../lib/igloohome";

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule." });
  }
  const deviceId = String(req.query.deviceId || "");
  const days = Math.min(31, Math.max(1, parseInt(req.query.days, 10) || 7));
  const t0 = Date.now();
  try {
    const out = await readActivity(deviceId, { days });
    return res.status(200).json({ ok: true, deviceId, jours: days, dureeMs: Date.now() - t0, api: apiBase(), lueLe: new Date().toISOString(), ...out });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message, detail: e.detail ?? null, api: apiBase() });
  }
}
