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

// Villiers et Lantiez : taxe de séjour encaissée par les OTA, mais les clients
// Booking doivent laisser un dépôt de garantie (pré-autorisation Stripe faite
// par Hostaway la veille de l'arrivée). Ces résidences ont une colonne Dépôt et
// une colonne Codes à la place de la colonne Taxe.
const RESIDENCES_DEPOT = ["Villiers", "Lantiez"];

// Dates Hostaway « AAAA-MM-JJ HH:MM:SS » en UTC → « JJ/MM HHhMM » heure de Paris.
function fmtJourHeure(s) {
  const x = new Date((s || "").replace(" ", "T") + "Z");
  if (!s || isNaN(x)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(x).map(o => [o.type, o.value]));
  return `${p.day}/${p.month} ${p.hour}h${p.minute}`;
}

// Statut du dépôt de garantie d'une résa, d'après ses pré-autorisations
// (GET /guestPayments/charges, lecture seule). Une pré-autorisation réussie
// l'emporte sur un échec antérieur (client qui a refait sa carte via le lien).
async function depotOf(accessToken, reservationId) {
  const r = await fetch(`https://api.hostaway.com/v1/guestPayments/charges?reservationId=${reservationId}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Cache-control": "no-cache" },
  });
  if (!r.ok) return { statut: "inconnue", libelle: "À vérifier" };
  const d = await r.json();
  const holds = (d.result || []).filter(c => c.type === "preAuth");
  if (holds.length === 0) return { statut: "a_regler", libelle: "Aucune demande" };
  const ok = holds.find(c => c.status === "holdSuccess" || c.status === "captured" || Number(c.capturedAmount) > 0);
  if (ok) return { statut: "reglee", libelle: "Réussi", detail: `${ok.amount} € · ${fmtJourHeure(ok.chargeDate)}` };
  const last = holds.sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate)))[0];
  if (last.status === "awaitingHold") return { statut: "attente", libelle: "Prévu", detail: fmtJourHeure(last.scheduledDate) };
  if (last.status === "holdFail") return { statut: "a_regler", libelle: "Échec", detail: "codes non envoyés" };
  if (last.status === "holdCancelled") return { statut: "a_regler", libelle: "Annulé" };
  return { statut: "inconnue", libelle: last.status || "À vérifier" };
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
          taxe: RESIDENCES_DEPOT.includes(key) ? null : taxeOf(rv, ota),
          depot: null,
          voyageurs: rv.numberOfGuests ?? rv.adults ?? "",
        });
      }
    }

    // Dépôt de garantie : Booking à Villiers/Lantiez seulement (une requête par résa).
    const depots = {};
    await Promise.all(Object.values(byResidence)
      .filter(g => RESIDENCES_DEPOT.includes(g.residence))
      .flatMap(g => g.items)
      .filter(it => it.ota === "Booking" && it.reservationId)
      .map(async it => {
        if (!depots[it.reservationId]) depots[it.reservationId] = depotOf(accessToken, it.reservationId);
        it.depot = await depots[it.reservationId];
      }));

    const groups = Object.values(byResidence).sort((a, b) => a.residence.localeCompare(b.residence));
    for (const g of groups) {
      g.mode = RESIDENCES_DEPOT.includes(g.residence) ? "depot" : "taxe";
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
