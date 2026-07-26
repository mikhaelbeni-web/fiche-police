// pages/api/tourist-tax.js
// Lecture seule. Remonte les réservations Booking.com dont la taxe de séjour est
// présumée impayée, selon les conditions cumulatives :
//   1. canal = bookingcom uniquement (Airbnb/Expedia/direct exclus)
//   2. statut confirmé (new/modified/ownerStay)
//   3. paymentStatus partiellement payé
//   4. présence d'une ligne "taxe de séjour" dans reservationFees
//   5. check-in déjà passé (arrivalDate <= aujourd'hui)
//   6. arrivalDate dans [from, to]
//
// NB : Hostaway ne fournit pas d'indicateur de paiement PAR fee. Le statut de paiement
// est au niveau réservation. La règle métier retenue : Booking + partiellement payé
// => taxe de séjour non encaissée (Booking prélève le séjour mais pas la taxe).

import { verifySession, getAccessToken, getListingMap, isActive, fetchReservations } from "../../lib/hostaway";
import { resolveApartment } from "../../lib/apartments";

function isPartiallyPaid(rv) {
  const p = (rv.paymentStatus || "").toString().toLowerCase();
  return p.includes("partial"); // "Partially paid"
}

function isBooking(rv) {
  const c = (rv.channelName || "").toString().toLowerCase();
  return c === "bookingcom" || c.includes("booking");
}

function touristTaxFees(rv) {
  const fees = Array.isArray(rv.reservationFees) ? rv.reservationFees : [];
  // On dédoublonne guest/hotel : une seule ligne "taxe de séjour" compte, côté guest en priorité
  const taxes = fees.filter(f => (f.name || "").toLowerCase().includes("taxe de séjour"));
  const guest = taxes.find(f => f.feeType === "guest");
  const chosen = guest || taxes[0] || null;
  return { chosen, amount: chosen ? Number(chosen.amount) || 0 : 0, hasTax: taxes.length > 0 };
}

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

  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.from || "2026-07-10"; // défaut : 10 juillet
  const to = req.query.to || today;
  const debug = req.query.debug === "1";

  try {
    const accessToken = await getAccessToken(accountId, apiKey);
    const listingMap = await getListingMap(accessToken, accountId);

    // On interroge par date d'ARRIVÉE sur la période
    const all = (await fetchReservations(accessToken, {
      arrivalStartDate: from,
      arrivalEndDate: to,
      limit: "500",
      includeResources: "1",
    })).filter(isActive); // statut confirmé uniquement

    const items = [];
    let debugSample = [];
    for (const rv of all) {
      const arr = (rv.arrivalDate || rv.checkInDate || "").slice(0, 10);
      const checkedIn = arr <= today;         // check-in déjà passé
      const inRange = arr >= from && arr <= to;
      const booking = isBooking(rv);
      const partial = isPartiallyPaid(rv);
      const { chosen, amount, hasTax } = touristTaxFees(rv);

      if (debug && debugSample.length < 8) {
        debugSample.push({
          guest: rv.guestName, channel: rv.channelName, paymentStatus: rv.paymentStatus,
          arrival: arr, booking, partial, hasTax, taxAmount: amount,
        });
      }

      // Conditions cumulatives
      if (!booking) continue;
      if (!partial) continue;
      if (!hasTax) continue;
      if (!checkedIn) continue;
      if (!inRange) continue;

      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      let info = resolveApartment(rv, lid) || listingMap[lid] || { residence: "?", appartement: rv.listingName || "—", unitNumber: "" };

      items.push({
        residence: info.residence,
        appartement: info.appartement,
        unitNumber: info.unitNumber || "",
        arrivee: arr,
        depart: (rv.departureDate || rv.checkOutDate || "").slice(0, 10),
        client: rv.guestName || [rv.guestFirstName, rv.guestLastName].filter(Boolean).join(" ") || "—",
        reservation: rv.hostawayReservationId || rv.channelReservationId || rv.id || "",
        paymentStatus: rv.paymentStatus || "",
        taxeSejour: amount,
        voyageurs: rv.numberOfGuests ?? rv.adults ?? "",
      });
    }

    // Tri par résidence puis date d'arrivée
    items.sort((a, b) => {
      if (a.residence !== b.residence) return a.residence.localeCompare(b.residence);
      return a.arrivee.localeCompare(b.arrivee);
    });

    const totalTax = items.reduce((s, it) => s + (it.taxeSejour || 0), 0);

    const payload = { from, to, total: items.length, totalTax, items };
    if (debug) payload._debug = { scanned: all.length, sample: debugSample };
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
