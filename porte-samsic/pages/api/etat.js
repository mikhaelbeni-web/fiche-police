// porte-samsic/pages/api/etat.js
// État courant de la porte via le relais Hotel Desk. Session obligatoire. Aucun historique :
// seuls les champs listés ci-dessous sortent, quoi que renvoie le relais.
import { exigerSession, adresse } from "../../lib/session.js";
import { lireEtat } from "../../lib/relais.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  if (!exigerSession(req, res)) return;
  try {
    const d = await lireEtat({ origine: adresse(req) });
    return res.status(200).json({ ok: true, porte: d.porte, lueLe: d.lueLe });
  } catch (e) {
    return res.status(e.status || 502).json({ ok: false, error: e.message });
  }
}
