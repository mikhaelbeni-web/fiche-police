// pages/api/admin/nuki/masse.js
// Action en masse sur des codes clavier Nuki : changer le code, activer, désactiver,
// renommer, supprimer. Un résultat par code (succès ou motif d'échec).
// Le navigateur a déjà montré le récapitulatif et obtenu la confirmation de l'admin ;
// il envoie par paquets de 25 au maximum pour afficher l'avancement.
// Le code envoyé n'est jamais journalisé ni renvoyé.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { validerDemande, executerMasse, isNukiConfigured } from "../../../../lib/nuki";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  if (!isNukiConfigured()) return res.status(500).json({ ok: false, etape: "configuration", error: "Jeton Nuki absent : variable NUKI_API_TOKEN." });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  if (b.confirme !== true) return res.status(400).json({ ok: false, error: "Confirmation manquante." });
  const demande = { action: b.action, items: b.items, code: b.code != null ? String(b.code) : undefined, nom: b.nom != null ? String(b.nom) : undefined };
  const err = validerDemande(demande);
  if (err) return res.status(400).json({ ok: false, etape: "contrôle", error: err });
  const resultats = await executerMasse(demande);
  return res.status(200).json({ ok: true, action: demande.action, resultats });
}
