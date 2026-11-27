// porte-samsic/pages/api/action.js
// POST { action: "ouvrir" | "deverrouiller" | "verrouiller" } → relais Hotel Desk. Session obligatoire.
import { exigerSession, adresse } from "../../lib/session.js";
import { envoyerAction } from "../../lib/relais.js";

export const config = { maxDuration: 30 };
const ACTIONS = ["ouvrir", "deverrouiller", "verrouiller"];

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  if (!exigerSession(req, res)) return;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const action = ACTIONS.includes(body.action) ? body.action : null;
  if (!action) return res.status(400).json({ ok: false, error: "Action inconnue." });
  const ip = adresse(req);
  try {
    const d = await envoyerAction(action, { origine: ip });
    console.log(`[portail] ${d.libelle} demandée depuis ${ip}`);
    return res.status(200).json({ ok: true, action: d.action, libelle: d.libelle, a: d.a });
  } catch (e) {
    console.error(`[portail] ${action} refusée depuis ${ip} : ${e.message}`);
    return res.status(e.status || 502).json({ ok: false, error: e.message });
  }
}
