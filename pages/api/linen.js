// pages/api/linen.js
// Lecture seule. Résidence Le Belleville UNIQUEMENT.
// Pour un jour donné : appartements à faire (départs du jour), numéro exact via la table
// statique lib/apartments.js, et nombre de personnes ATTENDUES (arrivée du même jour
// sur le même logement, si elle existe — sinon case vide).

import { verifySession, getAccessToken, isActive, fetchReservations } from "../../lib/hostaway";
import { getApartmentInfo, bellevilleIds } from "../../lib/apartments";

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
    const bIds = new Set(bellevilleIds());

    const departures = (await fetchReservations(accessToken, {
      departureStartDate: day, departureEndDate: day, limit: "500", includeResources: "1",
    })).filter(isActive)
      .filter(rv => (rv.departureDate || rv.checkOutDate || "").slice(0, 10) === day)
      .filter(rv => bIds.has(String(rv.listingMapId ?? rv.listingId ?? "")));

    const arrivals = (await fetchReservations(accessToken, {
      arrivalStartDate: day, arrivalEndDate: day, limit: "500", includeResources: "1",
    })).filter(isActive)
      .filter(rv => (rv.arrivalDate || rv.checkInDate || "").slice(0, 10) === day);

    const arrivalByListing = {};
    for (const rv of arrivals) {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      arrivalByListing[lid] = rv.numberOfGuests ?? rv.adults ?? null;
    }

    const items = departures.map(rv => {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      const info = getApartmentInfo(lid) || { appartement: rv.listingName || "—", unitNumber: "—" };
      const attendu = Object.prototype.hasOwnProperty.call(arrivalByListing, lid) ? arrivalByListing[lid] : null;
      return {
        listingId: lid,
        appartement: info.appartement,
        unitNumber: info.unitNumber,
        attendu,
      };
    });

    // Tri numérique par numéro d'appartement
    items.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));

    return res.status(200).json({ day, items });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
