// pages/api/porte/action.js
// Relais pour le portail Samsic : ouvrir / déverrouiller / verrouiller LA porte du bureau.
// POST { action } avec « Authorization: Bearer <clé partagée> ». 404 sans la bonne clé ;
// 429 trop d'actions. Chaque demande est écrite dans les journaux du serveur (jamais la clé).
import { isPorteConfigured, verifierCle, cleDeLaRequete, validerAction, executerAction, origine, limiterActions } from "../../../lib/porte";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isPorteConfigured() || !verifierCle(cleDeLaRequete(req))) return res.status(404).json({ error: "Introuvable." });
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const orig = origine(req);
  const action = validerAction(body.action);
  if (!action) return res.status(400).json({ ok: false, error: "Action inconnue." });
  const attente = limiterActions(orig);
  if (attente) return res.status(429).json({ ok: false, error: attente });
  try {
    const r = await executerAction(action);
    console.log(`[porte] ${r.libelle} acceptée par Nuki (${r.serrure}) — origine ${orig}`);
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error(`[porte] ${action} refusée — origine ${orig} : ${e.message}`);
    return res.status(e.status && e.status < 600 ? e.status : 502).json({ ok: false, error: e.message });
  }
}
