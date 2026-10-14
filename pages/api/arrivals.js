// pages/api/arrivals.js
// Lecture seule. Arrivées (check-in) sur une période, groupées par résidence.
// Même logique que departures.js (résolution multi-unit, statuts confirmés uniquement),
// mais filtrée sur la date d'ARRIVÉE plutôt que de départ.

import { verifySession, getAccessToken, getListingMap, isActive, fetchReservations } from "../../lib/hostaway";
import { resolveApartments } from "../../lib/apartments";

// OTA réelle : Hostaway affiche « direct » pour certaines résas Hotels.com,
// l'email du voyageur fait foi.
function otaOf(rv) {
  const email = (rv.guestEmail || "").toLowerCase();
  if (email.endsWith("@expedia-import.local")) return "Hotels.com";
  const c = (rv.channelName || "").toLowerCase();
  if (c.includes("booking")) return "Booking";
  if (c.includes("expedia")) return "Expedia";
  if (c.includes("airbnb")) return "Airbnb";
  if (c.includes("vrbo") || c.includes("homeaway")) return "Vrbo";
  if (c === "direct" || c === "website" || c.includes("bookingengine")) return "Direct";
  return rv.channelName || "—";
}

// Taxe de séjour. Expedia/Hotels.com/Airbnb l'encaissent eux-mêmes. Booking :
// ligne « taxe de séjour » + résa partiellement payée = taxe non encaissée
// (même règle que /api/tourist-tax). Sinon on ne conclut pas.
function taxeOf(rv, ota) {
  if (["Expedia", "Hotels.com", "Airbnb"].includes(ota)) return { statut: "reglee", libelle: "Réglée" };
  const fees = Array.isArray(rv.reservationFees) ? rv.reservationFees : [];
  const taxes = fees.filter(f => (f.name || "").toLowerCase().includes("taxe de séjour"));
  const fee = taxes.find(f => f.feeType === "guest") || taxes[0];
  const montant = fee ? Number(fee.amount) || 0 : 0;
  const pay = (rv.paymentStatus || "").toLowerCase();
  if (fee && pay.includes("partial")) return { statut: "a_regler", libelle: "À régler", montant };
  if (pay === "paid") return { statut: "reglee", libelle: "Réglée" };
  return { statut: "inconnue", libelle: "À vérifier", montant: montant || null };
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

  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "Paramètres 'from' et 'to' requis (YYYY-MM-DD)." });
  }

  try {
    const accessToken = await getAccessToken(accountId, apiKey);
    const listingMap = await getListingMap(accessToken, accountId); // repli si totalement inconnu

    const rawAll = await fetchReservations(accessToken, {
      arrivalStartDate: from,
      arrivalEndDate: to,
      limit: "500",
      includeResources: "1",
    });

    // Mode diagnostic : montre, pour chaque réservation de la période, si elle
    // a été écartée par isActive() et pourquoi (statut brut, canal, annulation).
    // Sert à repérer un statut/canal (ex. Airbnb) non couvert par le filtre.
    if (req.query.debug === "1") {
      const rows = rawAll.map(rv => ({
        listingMapId: rv.listingMapId ?? rv.listingId ?? null,
        listingName: rv.listingName || null,
        guest: rv.guestName || [rv.guestFirstName, rv.guestLastName].filter(Boolean).join(" ") || null,
        arrivalDate: (rv.arrivalDate || rv.checkInDate || "").slice(0, 10),
        channelName: rv.channelName || null,
        status: rv.status || null,
        isCancelled: rv.isCancelled ?? null,
        cancellationDate: rv.cancellationDate || null,
        passeIsActive: isActive(rv),
      }));
      return res.status(200).json({ from, to, total: rawAll.length, rows });
    }

    const all = rawAll.filter(isActive);

    const inRange = all.filter(rv => {
      const d = (rv.arrivalDate || rv.checkInDate || "").slice(0, 10);
      return d >= from && d <= to;
    });

    const byResidence = {};
    for (const rv of inRange) {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      let infos = resolveApartments(rv, lid);
      if (infos.length === 0) {
        const fb = listingMap[lid];
        infos = [fb
          ? { residence: fb.residence, appartement: fb.appartement, unitNumber: fb.unitNumber }
          : { residence: "Sans résidence", appartement: rv.listingName || "—", unitNumber: "" }];
      }
      const ota = otaOf(rv);
      for (const info of infos) {
        const key = info.residence;
        if (!byResidence[key]) byResidence[key] = { residence: key, count: 0, items: [] };
        byResidence[key].count += 1;
        byResidence[key].items.push({
          listingId: lid,
          appartement: info.appartement,
          unitNumber: info.unitNumber || "",
          arrivee: (rv.arrivalDate || rv.checkInDate || "").slice(0, 10),
          depart: (rv.departureDate || rv.checkOutDate || "").slice(0, 10),
          client: rv.guestName || [rv.guestFirstName, rv.guestLastName].filter(Boolean).join(" ") || "—",
          reservation: rv.hostawayReservationId || rv.channelReservationId || rv.id || "",
          reservationId: String(rv.id ?? ""),
          ota,
          taxe: taxeOf(rv, ota),
          voyageurs: rv.numberOfGuests ?? rv.adults ?? "",
        });
      }
    }

    const groups = Object.values(byResidence).sort((a, b) => a.residence.localeCompare(b.residence));
    for (const g of groups) {
      g.items.sort((a, b) => {
        if (a.arrivee !== b.arrivee) return a.arrivee.localeCompare(b.arrivee);
        return (a.unitNumber || a.appartement).localeCompare(b.unitNumber || b.appartement, undefined, { numeric: true });
      });
    }

    const residences = Array.from(new Set(groups.map(g => g.residence))).sort((a, b) => a.localeCompare(b));

    // total = nombre de logements à traiter (une réservation multi-unité compte
    // pour autant d'appartements qu'elle en couvre), cohérent avec les lignes
    // réellement affichées. reservations = nombre de réservations sous-jacentes.
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    return res.status(200).json({ from, to, total, reservations: inRange.length, residences, groups });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
