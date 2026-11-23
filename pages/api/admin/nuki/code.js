// pages/api/admin/nuki/code.js
// Affiche la valeur d'UN code clavier, à la demande de l'admin (bouton « Afficher »).
// Jamais journalisée, jamais mise en cache (Cache-Control: no-store posé par requireAdminApi).
import { requireAdminApi } from "../../../../lib/adminAuth";
import { codesDeLaSerrure } from "../../../../lib/nuki";

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  const smartlockId = String(req.query.smartlockId || "");
  const id = String(req.query.id || "");
  if (!/^\d{1,20}$/.test(smartlockId) || !/^[0-9a-fA-F]{6,40}$/.test(id)) return res.status(400).json({ ok: false, error: "Identifiant invalide." });
  try {
    const a = (await codesDeLaSerrure(smartlockId)).find(x => String(x.id) === id);
    if (!a) return res.status(404).json({ ok: false, error: "Code introuvable." });
    return res.status(200).json({ ok: true, code: a.code != null ? String(a.code) : null });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message });
  }
}
