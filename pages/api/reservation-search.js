// pages/api/reservation-search.js
// Recherche un client par nom, toutes résidences, toutes dates (passées ou
// futures) — pour le suivi des sinistres, où le séjour concerné peut dater de
// n'importe quand. Lecture seule.
//
// Hostaway n'offre pas de recherche fiable par nom sur toute la durée de vie
// du compte ; on récupère donc une large fenêtre de réservations (18 mois en
// arrière, 6 mois en avant) et on filtre le nom du client côté serveur, avant
// de renvoyer une liste courte au client.

import { verifySession, getAccessToken, isActive, fetchReservations } from "../../lib/hostaway";
import { resolveApartments } from "../../lib/apartments";

function isoDay(d) { return d.toISOString().slice(0, 10); }

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Lecture seule." });
  if (!verifySession(req)) return res.status(401).json({ error: "Session invalide. Reconnecte-toi." });

  const accountId = req.headers["x-hostaway-account"];
  const apiKey = req.headers["x-hostaway-key"];
  if (!accountId || !apiKey) return res.status(401).json({ error: "Account ID et API Key requis." });

  const q = (req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.status(200).json({ query: q, items: [] });

  try {
    const accessToken = await getAccessToken(accountId, apiKey);

    const now = new Date();
    const from = new Date(now); from.setMonth(from.getMonth() - 18);
    const to = new Date(now); to.setMonth(to.getMonth() + 6);

    const all = (await fetchReservations(accessToken, {
      arrivalStartDate: isoDay(from),
      arrivalEndDate: isoDay(to),
    })).filter(isActive);

    const matches = [];
    for (const rv of all) {
      const name = rv.guestName || [rv.guestFirstName, rv.guestLastName].filter(Boolean).join(" ") || "";
      if (!name.toLowerCase().includes(q)) continue;
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      const infos = resolveApartments(rv, lid);
      const info = infos[0] || { residence: "?", appartement: rv.listingName || "—", unitNumber: "" };
      matches.push({
        client: name,
        residence: info.residence,
        appartement: infos.length > 1 ? infos.map(i => i.appartement).join(" + ") : info.appartement,
        unitNumber: infos.length > 1 ? infos.map(i => i.unitNumber).filter(Boolean).join("+") : (info.unitNumber || ""),
        arrivee: (rv.arrivalDate || rv.checkInDate || "").slice(0, 10),
        depart: (rv.departureDate || rv.checkOutDate || "").slice(0, 10),
        reservation: rv.hostawayReservationId || rv.channelReservationId || rv.id || "",
        channel: rv.channelName || "",
      });
    }
    // Plus récent en premier, capé pour rester léger
    matches.sort((a, b) => (b.arrivee || "").localeCompare(a.arrivee || ""));
    return res.status(200).json({ query: q, scanned: all.length, items: matches.slice(0, 30) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
