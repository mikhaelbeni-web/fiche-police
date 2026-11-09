// pages/api/admin/igloohome/diagnostic.js
// Diagnostic d'un refus d'igloohome sur l'historique d'une serrure : plusieurs formes
// de la même lecture (GET uniquement). Admin uniquement (404 sinon).
import { requireAdminApi } from "../../../../lib/adminAuth";
import { diagnoseActivity, apiBase } from "../../../../lib/igloohome";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule." });
  }
  const deviceId = String(req.query.deviceId || "");
  const idNumerique = String(req.query.idNumerique || "");
  if (!ID.test(deviceId) || (idNumerique && !ID.test(idNumerique))) {
    return res.status(400).json({ ok: false, etape: "entrée", error: "Identifiant invalide." });
  }
  try {
    return res.status(200).json({ ok: true, api: apiBase(), essais: await diagnoseActivity(deviceId, idNumerique) });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message, detail: e.detail ?? null });
  }
}
