// pages/api/departures.js
// Lecture seule. Renvoie les DÉPARTS (check-outs) sur une période, groupés par résidence,
// avec le numéro de sous-unité exact de chaque appartement.

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

  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "Paramètres 'from' et 'to' requis (YYYY-MM-DD)." });
  }

  try {
    const accessToken = await getAccessToken(accountId, apiKey);
    const listingMap = await getListingMap(accessToken, accountId);

    const all = (await fetchReservations(accessToken, {
      departureStartDate: from,
      departureEndDate: to,
      limit: "500",
      includeResources: "1",
    })).filter(isActive);

    const inRange = all.filter(rv => {
      const d = (rv.departureDate || rv.checkOutDate || "").slice(0, 10);
      return d >= from && d <= to;
    });

    const byResidence = {};
    for (const rv of inRange) {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      const info = listingMap[lid] || { residence: "Sans résidence", appartement: rv.listingName || "—", unitNumber: "" };
      const key = info.residence;
      if (!byResidence[key]) byResidence[key] = { residence: key, count: 0, items: [] };
      byResidence[key].count += 1;
      byResidence[key].items.push({
        listingId: lid,
        appartement: info.appartement || rv.listingName || "—",
        unitNumber: info.unitNumber || "",
        depart: (rv.departureDate || rv.checkOutDate || "").slice(0, 10),
        arrivee: (rv.arrivalDate || rv.checkInDate || "").slice(0, 10),
        client: rv.guestName || [rv.guestFirstName, rv.guestLastName].filter(Boolean).join(" ") || "—",
        reservation: rv.hostawayReservationId || rv.channelReservationId || rv.id || "",
        voyageurs: rv.numberOfGuests ?? rv.adults ?? "",
      });
    }

    const groups = Object.values(byResidence).sort((a, b) => a.residence.localeCompare(b.residence));
    for (const g of groups) {
      g.items.sort((a, b) => (a.unitNumber || a.appartement).localeCompare(b.unitNumber || b.appartement, undefined, { numeric: true }));
    }

    const residences = Array.from(new Set(Object.values(listingMap).map(v => v.residence))).sort((a, b) => a.localeCompare(b));

    return res.status(200).json({ from, to, total: inRange.length, residences, groups });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
