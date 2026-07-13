// pages/api/linen.js
// Lecture seule. Pour un jour donné : liste des appartements à faire (départs du jour),
// avec le nombre de personnes ATTENDUES (arrivée du même jour sur le même logement, si elle existe).
// Si aucune arrivée le jour même sur ce logement, "attendu" reste vide (à la charge du personnel).

import { verifySession, getAccessToken, getListingMap, isActive, fetchReservations } from "../../lib/hostaway";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule." });
  }
  if (!verifySession(req)) {
    return res.status(401).json({ error: "Session invalide. Reconnecte-toi." });
  }

  const accountId = req.headers["x-hostaway-account"] || process.env.HOSTAWAY_ACCOUNT_ID;
  const apiKey = req.headers["x-hostaway-key"] || process.env.HOSTAWAY_API_KEY;
  if (!accountId || !apiKey) {
    return res.status(401).json({ error: "Account ID et API Key requis." });
  }

  const { day } = req.query;
  if (!day) {
    return res.status(400).json({ error: "Paramètre 'day' requis (YYYY-MM-DD)." });
  }

  try {
    const accessToken = await getAccessToken(accountId, apiKey);
    const listingMap = await getListingMap(accessToken, accountId);

    // Départs du jour = appartements à nettoyer
    const departures = (await fetchReservations(accessToken, {
      departureStartDate: day, departureEndDate: day, limit: "500", includeResources: "1",
    })).filter(isActive).filter(rv => (rv.departureDate || rv.checkOutDate || "").slice(0, 10) === day);

    // Arrivées du jour = pour connaître qui est ATTENDU dans chaque logement
    const arrivals = (await fetchReservations(accessToken, {
      arrivalStartDate: day, arrivalEndDate: day, limit: "500", includeResources: "1",
    })).filter(isActive).filter(rv => (rv.arrivalDate || rv.checkInDate || "").slice(0, 10) === day);

    const arrivalByListing = {};
    for (const rv of arrivals) {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      arrivalByListing[lid] = rv.numberOfGuests ?? rv.adults ?? null;
    }

    const byResidence = {};
    for (const rv of departures) {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      const info = listingMap[lid] || { residence: "Sans résidence", appartement: rv.listingName || "—", unitNumber: "" };
      const key = info.residence;
      if (!byResidence[key]) byResidence[key] = { residence: key, items: [] };
      const attendu = Object.prototype.hasOwnProperty.call(arrivalByListing, lid) ? arrivalByListing[lid] : null;
      byResidence[key].items.push({
        unitNumber: info.unitNumber || "",
        appartement: info.appartement || rv.listingName || "—",
        attendu, // null = pas d'arrivée connue le jour même -> case vide à remplir à la main
      });
    }

    const groups = Object.values(byResidence).sort((a, b) => a.residence.localeCompare(b.residence));
    for (const g of groups) {
      g.items.sort((a, b) => (a.unitNumber || a.appartement).localeCompare(b.unitNumber || b.appartement, undefined, { numeric: true }));
    }

    return res.status(200).json({ day, groups });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
