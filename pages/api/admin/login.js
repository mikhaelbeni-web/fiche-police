// pages/api/admin/login.js
// Connexion à l'espace admin. Exige d'abord la session normale (code d'accès),
// puis le mot de passe admin, comparé au hash ADMIN_PASSWORD_HASH (variable Vercel).
// Espace admin non configuré : 404. Session du code d'accès absente ou expirée (5 h) :
// 401 avec acces: true, pour que la page redemande le code d'accès au lieu d'afficher
// un « Introuvable » trompeur (la page de connexion est déjà visible par tout titulaire du code).
import {
  isAdminConfigured, hasAccessSession, verifyPassword, makeAdminToken, adminCookieHeader,
  loginBlocked, recordLoginFailure, clearLoginFailures,
} from "../../../lib/adminAuth";

const FAIL_DELAY_MS = 800;
const wait = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isAdminConfigured()) {
    return res.status(404).json({ error: "Introuvable." });
  }
  if (!hasAccessSession(req)) {
    return res.status(401).json({ acces: true, error: "Session du code d\u2019accès terminée (5 h) : retape le code d\u2019accès." });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  if (loginBlocked(req)) {
    return res.status(429).json({ error: "Trop d'essais. Réessaie dans 15 minutes." });
  }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const password = body && typeof body.password === "string" ? body.password : "";

  if (!verifyPassword(password, process.env.ADMIN_PASSWORD_HASH)) {
    recordLoginFailure(req);
    await wait(FAIL_DELAY_MS);
    return res.status(401).json({ error: "Mot de passe incorrect." });
  }
  clearLoginFailures(req);
  const { token, exp } = makeAdminToken();
  res.setHeader("Set-Cookie", adminCookieHeader(token));
  return res.status(200).json({ ok: true, expiresAt: exp });
}
