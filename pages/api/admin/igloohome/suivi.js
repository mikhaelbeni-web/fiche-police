// pages/api/admin/igloohome/suivi.js
// Suivi du croisement : décision de l'admin sur chaque visite (« Normal » / « À vérifier »
// + note) et dernier résultat calculé (visites et résumés, jamais d'événement brut).
// Admin uniquement (404 sinon). Stockage privé et chiffré : lib/adminStore.js.
// Ne touche jamais igloohome ni Hostaway.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { readDoc, writeDoc } from "../../../../lib/adminStore";
import { emptySuivi, applyDecision, slimResultat } from "../../../../lib/croisement";

const DOC = "igloohome_suivi";
const MAX = 800000; // un document Firestore ne dépasse pas 1 Mo (chiffré + base64)

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  try {
    const cur = (await readDoc(DOC)) || emptySuivi();
    if (req.method === "GET") return res.status(200).json({ ok: true, suivi: { decisions: cur.decisions || {}, dernier: cur.dernier || null } });
    if (req.method === "PUT") {
      let next = { decisions: cur.decisions || {}, dernier: cur.dernier || null };
      let avertissement = null;
      try {
        if (req.body?.decision) next = applyDecision(next, req.body.decision);
        if (req.body?.dernier) next.dernier = slimResultat(req.body.dernier);
      } catch (e) { return res.status(400).json({ ok: false, etape: "validation", error: e.message }); }
      if (JSON.stringify(next).length > MAX && next.dernier) {
        next.dernier = { ...next.dernier, visites: next.dernier.visites.map(v => ({ ...v, evenements: [] })) };
        avertissement = "Résultat trop volumineux : le détail des événements n'est pas gardé.";
        if (JSON.stringify(next).length > MAX) { next.dernier = null; avertissement = "Résultat trop volumineux pour être gardé."; }
      }
      await writeDoc(DOC, { ...next, majLe: new Date().toISOString() });
      return res.status(200).json({ ok: true, suivi: next, avertissement });
    }
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ ok: false, error: "Méthode non autorisée." });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message });
  }
}
