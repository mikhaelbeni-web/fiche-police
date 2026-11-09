// pages/api/admin/logout.js
// Fin de la session admin (efface le cookie fp_admin). Sans effet pour un non-admin.
import { clearAdminCookieHeader } from "../../../lib/adminAuth";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  res.setHeader("Set-Cookie", clearAdminCookieHeader());
  return res.status(200).json({ ok: true });
}
