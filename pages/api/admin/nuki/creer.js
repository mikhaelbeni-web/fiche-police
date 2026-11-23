// pages/api/admin/nuki/creer.js
// Crée le même code clavier sur plusieurs serrures, une par une, avec un résultat par serrure.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { validerCreation, creerCodes, isNukiConfigured } from "../../../../lib/nuki";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  if (!isNukiConfigured()) return res.status(500).json({ ok: false, etape: "configuration", error: "Jeton Nuki absent : variable NUKI_API_TOKEN." });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  if (b.confirme !== true) return res.status(400).json({ ok: false, error: "Confirmation manquante." });
  const demande = { nom: String(b.nom ?? ""), code: String(b.code ?? ""), smartlockIds: b.smartlockIds, debut: b.debut || null, fin: b.fin || null };
  const err = validerCreation(demande);
  if (err) return res.status(400).json({ ok: false, etape: "contrôle", error: err });
  const resultats = await creerCodes(demande);
  return res.status(200).json({ ok: true, resultats });
}
