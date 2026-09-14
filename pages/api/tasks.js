// pages/api/tasks.js
// Récupère les tâches (maintenance/ménage) créées sur Hostaway, résout leur
// appartement/résidence, et renvoie une liste plate — filtrable ensuite
// côté page par résidence et/ou appartement.
//
// Champs Hostaway supposés (pas encore vérifiés en conditions réelles) :
// listingMapId, title/description, dueDate, assigneeName ou assignedTo,
// status, priority. Utilise ?debug=1 pour voir les champs bruts d'un
// échantillon et corriger le mapping si besoin.

import { verifySession, getAccessToken, isActive, fetchTasks } from "../../lib/hostaway";
import { resolveApartments } from "../../lib/apartments";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Lecture seule." });
  if (!verifySession(req)) return res.status(401).json({ error: "Session invalide. Reconnecte-toi." });

  const accountId = req.headers["x-hostaway-account"];
  const apiKey = req.headers["x-hostaway-key"];
  if (!accountId || !apiKey) return res.status(401).json({ error: "Account ID et API Key requis." });

  const debug = req.query.debug === "1";

  try {
    const accessToken = await getAccessToken(accountId, apiKey);
    const raw = await fetchTasks(accessToken, { limit: 200 });

    if (debug) {
      return res.status(200).json({ total: raw.length, sample: raw.slice(0, 5) });
    }

    const items = [];
    const unresolved = [];
    for (const t of raw) {
      // Une tâche déjà annulée/supprimée ne doit pas apparaître dans la liste.
      if (t.isDeleted || t.status === "cancelled" || t.status === "deleted") continue;

      const lid = String(t.listingMapId ?? t.listingId ?? "");
      const infos = resolveApartments({ reservationUnit: null, listingMapId: lid, listingName: t.listingName }, lid);
      const info = infos[0];

      const titre = t.title || t.taskTypeName || t.description || "Tâche sans titre";
      const description = (t.description && t.description !== titre) ? t.description : "";
      const assigne = t.assigneeName || t.assignedToName || t.assignedTo || "";
      const echeance = (t.dueDate || t.assignedDate || t.date || "").slice(0, 10);
      const statut = t.status || "";
      const priorite = t.priority || "";

      const row = {
        id: t.id || `${lid}-${titre}-${echeance}`,
        residence: info?.residence || "?",
        appartement: info?.appartement || t.listingName || "—",
        unitNumber: info?.unitNumber || "",
        titre, description, assigne, echeance, statut, priorite,
      };
      if (!info) unresolved.push({ listingId: lid, listingName: t.listingName || null });
      items.push(row);
    }

    items.sort((a, b) => (a.residence + a.appartement).localeCompare(b.residence + b.appartement));

    return res.status(200).json({ total: items.length, items, unresolved });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}
