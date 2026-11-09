// pages/api/admin/especes.js
// Espace admin > Espèces. Admin uniquement (404 sinon).
//   GET  ?vue=personnel     -> réceptionnistes (sans secret)
//   GET  ?vue=journal       -> journal complet + contrôle d'intégrité
//   POST { action: "creer", nom } | { action: "reinitialiser"|"desactiver"|"reactiver", id }
//        -> le code d'activation (6 chiffres) n'est renvoyé qu'une fois, jamais stocké en clair.
import { requireAdminApi } from "../../../lib/adminAuth";
import { lirePersonnel, vuePublique, adminPersonnel, verifierJournal, contexteRequete } from "../../../lib/especesJournal";

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  try {
    if (req.method === "GET") {
      if (req.query?.vue === "journal") {
        const v = await verifierJournal();
        return res.status(200).json({ ok: true, ...v, lueLe: new Date().toISOString() });
      }
      const personnes = (await lirePersonnel()).map(vuePublique);
      return res.status(200).json({ ok: true, personnel: personnes });
    }
    if (req.method === "POST") {
      const b = req.body || {};
      const out = await adminPersonnel({ action: b.action, nom: b.nom, id: b.id, contexte: contexteRequete(req) });
      return res.status(200).json({ ok: true, ...out });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Méthode non autorisée." });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message });
  }
}
