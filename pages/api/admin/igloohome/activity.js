// pages/api/admin/igloohome/activity.js
// « Voir l'historique » d'une serrure sur N jours (7 par défaut, 31 max), événements bruts.
// Avec ?from=AAAA-MM-JJ&to=AAAA-MM-JJ (62 jours max) : période du croisement (rejeu),
// dates prises en heure de Paris, marge d'un jour de chaque côté pour les nuits.
// Admin uniquement (404 sinon). Lecture seule : voir lib/igloohome.js.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { readActivity, apiBase, parseRange } from "../../../../lib/igloohome";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule." });
  }
  const deviceId = String(req.query.deviceId || "");
  const days = Math.min(31, Math.max(1, parseInt(req.query.days, 10) || 7));
  const range = parseRange(req.query.from, req.query.to);
  if (range && range.error) return res.status(400).json({ ok: false, etape: "entrée", error: range.error });
  const t0 = Date.now();
  try {
    const out = range
      ? await readActivity(deviceId, { fromMs: range.fromMs, toMs: range.toMs, maxPages: 40, keepRaw: false })
      : await readActivity(deviceId, { days });
    return res.status(200).json({ ok: true, deviceId, jours: days, dureeMs: Date.now() - t0, api: apiBase(), lueLe: new Date().toISOString(), ...out });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message, detail: e.detail ?? null, api: apiBase() });
  }
}
