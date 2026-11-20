// pages/api/especes.js
// Gestion des espèces : seule porte d'écriture (le navigateur ne fait plus que lire).
// Session de la réception obligatoire (cookie fp_session). Chaque écriture est
// journalisée par lib/especesJournal.js.
//   GET                          -> liste des réceptionnistes (sans secret) + isAdmin
//   POST { action: "ajouter", personneId, pin, ligne }
//   POST { action: "activer", personneId, activation, pin }       (première utilisation)
//   POST { action: "recuperer", personneId?, pin?, montant, note, entryIds }  (code perso ou admin)
//   POST { action: "supprimer", entryId, motif }                   (admin seulement)
//   POST { action: "annuler_recuperation", recoveryId, motif }     (admin seulement)
//   POST { action: "solde_depart", date, montant }                 (admin seulement)
import { hasAccessSession, isAdminRequest } from "../../lib/adminAuth";
import {
  lirePersonnel, vuePublique, verifierPersonne, activerPersonne, ajouterLigne, supprimerLigne,
  recuperer, annulerRecuperation, soldeDepart, contexteRequete, EspecesError,
} from "../../lib/especesJournal";

const ADMIN = { nom: "admin", id: "admin", role: "admin" };

function exigerAdmin(req) {
  if (!isAdminRequest(req)) {
    throw new EspecesError("Réservé à l'administrateur : connectez-vous d'abord à l'Espace admin (Codes d'accès), puis revenez ici.", 403, "admin");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hasAccessSession(req)) return res.status(401).json({ ok: false, error: "Session expirée : rechargez la page." });
  const contexte = contexteRequete(req);
  try {
    if (req.method === "GET") {
      const personnes = (await lirePersonnel()).filter(p => p.actif !== false).map(vuePublique);
      return res.status(200).json({ ok: true, personnel: personnes, isAdmin: isAdminRequest(req) });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "Méthode non autorisée." });
    }
    const b = req.body || {};
    switch (b.action) {
      case "activer": {
        const p = await activerPersonne({ id: b.personneId, activation: b.activation, pin: b.pin, contexte });
        return res.status(200).json({ ok: true, personne: p });
      }
      case "ajouter": {
        const acteur = await verifierPersonne({ id: b.personneId, pin: b.pin, contexte });
        const out = await ajouterLigne({ acteur, ligne: b.ligne, contexte });
        return res.status(200).json({ ok: true, id: out.resultat.id, journal: out.tete });
      }
      case "recuperer": {
        const acteur = b.personneId ? await verifierPersonne({ id: b.personneId, pin: b.pin, contexte })
          : (exigerAdmin(req), ADMIN);
        const out = await recuperer({ acteur, montant: b.montant, note: b.note, entryIds: b.entryIds, contexte });
        return res.status(200).json({ ok: true, recuperation: out.resultat, journal: out.tete });
      }
      case "supprimer": {
        exigerAdmin(req);
        const out = await supprimerLigne({ id: b.entryId, motif: b.motif, contexte });
        return res.status(200).json({ ok: true, journal: out.tete });
      }
      case "annuler_recuperation": {
        exigerAdmin(req);
        const out = await annulerRecuperation({ id: b.recoveryId, motif: b.motif, contexte });
        return res.status(200).json({ ok: true, journal: out.tete });
      }
      case "solde_depart": {
        exigerAdmin(req);
        const out = await soldeDepart({ date: b.date, montant: b.montant, contexte });
        return res.status(200).json({ ok: true, journal: out.tete });
      }
      default:
        return res.status(400).json({ ok: false, error: "Action inconnue." });
    }
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message });
  }
}
