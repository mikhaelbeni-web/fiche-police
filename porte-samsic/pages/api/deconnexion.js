// porte-samsic/pages/api/deconnexion.js
import { enteteCookieVide } from "../../lib/session.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  res.setHeader("Set-Cookie", enteteCookieVide());
  return res.status(200).json({ ok: true });
}
