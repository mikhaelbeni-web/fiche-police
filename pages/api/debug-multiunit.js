// pages/api/debug-multiunit.js
// Outil de diagnostic temporaire. Lecture seule. Renvoie la structure JSON BRUTE
// des réservations Cosy/Confort/Chic sur une période, pour identifier le champ exact
// qui porte le numéro de sous-unité chez Hostaway (au lieu de deviner).

import { verifySession, getAccessToken, isActive, fetchReservations } from "../../lib/hostaway";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule." });
  }
  if (!verifySession(req)) {
    return res.status(401).json({ error: "Session invalide." });
  }
  const accountId = req.headers["x-hostaway-account"] || process.env.HOSTAWAY_ACCOUNT_ID;
  const apiKey = req.headers["x-hostaway-key"] || process.env.HOSTAWAY_API_KEY;
  if (!accountId || !apiKey) {
    return res.status(401).json({ error: "Account ID et API Key requis." });
  }
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "Paramètres 'from' et 'to' requis." });
  }

  try {
    const accessToken = await getAccessToken(accountId, apiKey);
    const all = (await fetchReservations(accessToken, {
      departureStartDate: from, departureEndDate: to, limit: "500", includeResources: "1",
    })).filter(isActive);

    // Ne garder que les réservations dont le nom de logement évoque un multi-unit Belleville
    const multiUnit = all.filter(rv => /chic|confort|cosy/i.test(rv.listingName || ""));

    // Renvoie l'objet réservation COMPLET pour les 3 premiers cas, sans rien filtrer
    return res.status(200).json({
      count: multiUnit.length,
      raw: multiUnit.slice(0, 3),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
