// pages/api/admin/session.js
// État de la session admin. 404 pour tout non-admin (comme toutes les routes /api/admin/*).
import { requireAdminApi, adminSessionExpiry } from "../../../lib/adminAuth";

export default function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  return res.status(200).json({ admin: true, expiresAt: adminSessionExpiry(req) });
}
