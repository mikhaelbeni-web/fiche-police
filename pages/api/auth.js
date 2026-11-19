// pages/api/auth.js
// Vérification serveur du code d'accès. Le code n'est JAMAIS envoyé au navigateur :
// il vit dans la variable d'environnement ACCESS_CODE (Vercel). La route pose un
// cookie de session signé HMAC, valable 5 h après la saisie du code (voir lib/hostaway.js).
//   POST { code }  -> vérifie le code, pose le cookie si correct
//   GET            -> indique si la session est valide et quand elle expire

import crypto from "crypto";
import { makeSessionToken, sessionExpiry, ACCESS_COOKIE, ACCESS_TTL_SECONDS } from "../../lib/hostaway";

export default function handler(req, res) {
  const expectedCode = process.env.ACCESS_CODE || "188";
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const exp = sessionExpiry(req);
    return res.status(200).json({ authenticated: exp > 0, expiresAt: exp || null, serverNowMs: Date.now() });
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const code = (body && body.code != null) ? String(body.code) : "";

    // Comparaison à temps constant du code
    const a = Buffer.from(code);
    const b = Buffer.from(expectedCode);
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!match) {
      return res.status(401).json({ authenticated: false, error: "Code incorrect." });
    }

    const { token, exp } = makeSessionToken();
    // Cookie 5 h, HttpOnly (invisible au JS), Secure, SameSite Lax
    res.setHeader("Set-Cookie",
      `${ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ACCESS_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`
    );
    return res.status(200).json({ authenticated: true, expiresAt: exp, serverNowMs: Date.now() });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Méthode non autorisée." });
}
