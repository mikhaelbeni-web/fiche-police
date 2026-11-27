// pages/api/porte/etat.js
// Relais pour le portail Samsic : état de LA porte du bureau et ses derniers événements Nuki.
// GET avec « Authorization: Bearer <clé partagée> ». 404 sans la bonne clé.
import { isPorteConfigured, verifierCle, cleDeLaRequete, etatPortail } from "../../../lib/porte";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isPorteConfigured() || !verifierCle(cleDeLaRequete(req))) return res.status(404).json({ error: "Introuvable." });
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  try {
    const out = await etatPortail();
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    return res.status(e.status && e.status < 600 ? e.status : 502).json({ ok: false, error: e.message });
  }
}
