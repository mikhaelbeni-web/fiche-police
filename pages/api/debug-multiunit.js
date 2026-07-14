// pages/api/debug-multiunit.js
// Outil de diagnostic. Lecture seule. Pour chaque départ d'une période, affiche
// le nom du listing, l'ID top-level, l'ID de sous-unité réel (reservationUnit[].listingUnitId)
// et ce que la résolution actuelle en déduit. Permet de repérer d'un coup d'œil
// les cas où un listing (ex. Villiers V6) est en réalité multi-unit sans qu'on le sache.

import { verifySession, getAccessToken, isActive, fetchReservations } from "../../lib/hostaway";
import { resolveApartment } from "../../lib/apartments";

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

    const rows = all.map(rv => {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      const ru = Array.isArray(rv.reservationUnit) ? rv.reservationUnit[0] : null;
      const resolved = resolveApartment(rv, lid);
      return {
        guest: rv.guestName || [rv.guestFirstName, rv.guestLastName].filter(Boolean).join(" "),
        depart: (rv.departureDate || rv.checkOutDate || "").slice(0, 10),
        listingName: rv.listingName,
        listingMapId: lid,
        reservationUnitListingUnitId: ru?.listingUnitId ?? null,
        resoluResidence: resolved?.residence ?? null,
        resoluAppartement: resolved?.appartement ?? null,
        resoluNumero: resolved?.unitNumber ?? null,
      };
    }).sort((a, b) => (a.listingName || "").localeCompare(b.listingName || ""));

    return res.status(200).json({ count: rows.length, rows });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
