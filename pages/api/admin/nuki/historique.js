// pages/api/admin/nuki/historique.js
// Historique Nuki (lecture) : toutes les serrures ou une seule, sur 1 à 30 jours.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { lireHistorique } from "../../../../lib/nuki";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  const smartlockId = req.query.smartlockId ? String(req.query.smartlockId) : null;
  if (smartlockId && !/^\d{1,20}$/.test(smartlockId)) return res.status(400).json({ ok: false, error: "Identifiant invalide." });
  const jours = Math.min(30, Math.max(1, parseInt(req.query.jours, 10) || 7));
  try {
    const evenements = await lireHistorique({ smartlockId, jours, limite: smartlockId ? 300 : 1000 });
    return res.status(200).json({ ok: true, jours, evenements });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message, detail: e.detail ?? null });
  }
}
