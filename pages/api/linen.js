// pages/api/linen.js
// Lecture seule. Résidence Le Belleville UNIQUEMENT.
// Numéro d'appartement résolu via lib/apartments.js (gère les listings multi-unit
// Cosy/Confort/Chic via reservationUnit). Nombre de personnes attendues = arrivée
// du même jour sur le même logement, sinon case vide.

import { verifySession, getAccessToken, getListingMap, isActive, fetchReservations } from "../../lib/hostaway";
import { resolveApartment } from "../../lib/apartments";

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

  const { day, debug } = req.query;
  if (!day) {
    return res.status(400).json({ error: "Paramètre 'day' requis (YYYY-MM-DD)." });
  }

  try {
    const accessToken = await getAccessToken(accountId, apiKey);
    const listingMap = await getListingMap(accessToken, accountId); // filet de sécurité, tags dynamiques

    const departures = (await fetchReservations(accessToken, {
      departureStartDate: day, departureEndDate: day, limit: "500", includeResources: "1",
    })).filter(isActive).filter(rv => (rv.departureDate || rv.checkOutDate || "").slice(0, 10) === day);

    const arrivals = (await fetchReservations(accessToken, {
      arrivalStartDate: day, arrivalEndDate: day, limit: "500", includeResources: "1",
    })).filter(isActive).filter(rv => (rv.arrivalDate || rv.checkInDate || "").slice(0, 10) === day);

    const arrivalByListing = {};
    for (const rv of arrivals) {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      arrivalByListing[lid] = rv.numberOfGuests ?? rv.adults ?? null;
    }

    const items = [];
    const unresolved = [];
    for (const rv of departures) {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      let info = resolveApartment(rv, lid);

      // Filet de sécurité : si resolveApartment échoue, vérifier via les tags/nom
      // dynamiques Hostaway avant de conclure que ce n'est pas Belleville.
      // Objectif : ne JAMAIS faire disparaître silencieusement un ménage réel.
      if (!info) {
        const fb = listingMap[lid];
        const looksLikeBelleville =
          fb?.residence?.toLowerCase().includes("belleville") ||
          (rv.listingName || "").toLowerCase().includes("belleville");
        if (looksLikeBelleville) {
          info = { residence: "Belleville", appartement: fb?.appartement || rv.listingName || "—", unitNumber: "?" };
        } else if (fb) {
          info = { residence: fb.residence, appartement: fb.appartement, unitNumber: fb.unitNumber };
        }
      }

      if (!info) {
        // Vraiment aucune piste : on le garde en trace de debug plutôt que de le perdre
        unresolved.push({ listingId: lid, listingName: rv.listingName || null });
        continue;
      }
      if (info.residence !== "Belleville") continue; // autre résidence, exclusion légitime

      const attendu = Object.prototype.hasOwnProperty.call(arrivalByListing, lid) ? arrivalByListing[lid] : null;
      items.push({
        listingId: lid,
        appartement: info.appartement,
        unitNumber: info.unitNumber,
        attendu,
      });
    }

    items.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));

    if (debug === "1") {
      return res.status(200).json({
        day, items, unresolved,
        _debug: {
          totalDepartures: departures.length,
          sample: departures.slice(0, 5).map(rv => ({
            listingMapId: rv.listingMapId,
            listingName: rv.listingName,
            reservationUnit: rv.reservationUnit ?? null,
          })),
        },
      });
    }

    return res.status(200).json({ day, items, unresolved });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
