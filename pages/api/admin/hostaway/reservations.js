// pages/api/admin/hostaway/reservations.js
// Réservations Hostaway qui touchent une période, pour le croisement igloohome.
// Admin uniquement (404 sinon). LECTURE SEULE (GET Hostaway uniquement).
// Identifiants Hostaway : ceux du poste (en-têtes x-hostaway-*), comme les autres pages.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { getAccessToken, fetchReservations } from "../../../../lib/hostaway";
import { bellevilleReservations, unresolvedBelleville, addDays } from "../../../../lib/croisement";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Lecture seule." });
  }
  const accountId = req.headers["x-hostaway-account"] || process.env.HOSTAWAY_ACCOUNT_ID;
  const apiKey = req.headers["x-hostaway-key"] || process.env.HOSTAWAY_API_KEY;
  if (!accountId || !apiKey) {
    return res.status(400).json({ ok: false, etape: "hostaway", error: "Identifiants Hostaway absents sur ce poste (à saisir une fois dans Arrivées ou Ménage)." });
  }
  const { from, to } = req.query;
  if (!DAY.test(String(from)) || !DAY.test(String(to)) || to < from) {
    return res.status(400).json({ ok: false, etape: "entrée", error: "Période invalide (AAAA-MM-JJ)." });
  }
  try {
    const token = await getAccessToken(accountId, apiKey);
    // Séjours qui touchent [from - 1 j ; to + 1 j] : arrivée <= to + 1 et départ >= from - 1.
    const raw = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const page = await fetchReservations(token, {
        arrivalEndDate: addDays(to, 1), departureStartDate: addDays(from, -1),
        limit: "500", offset: String(offset), includeResources: "1",
      });
      raw.push(...page);
      if (page.length < 500) break;
    }
    return res.status(200).json({
      ok: true, from, to, lues: raw.length,
      reservations: bellevilleReservations(raw),
      nonResolues: unresolvedBelleville(raw),
    });
  } catch (e) {
    return res.status(e.status && e.status < 600 ? 502 : 500).json({ ok: false, etape: "hostaway", error: e.message });
  }
}
