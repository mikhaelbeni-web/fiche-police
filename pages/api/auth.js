// pages/api/auth.js
// Vérification serveur du code d'accès. Le code n'est JAMAIS envoyé au navigateur :
// il vit dans la variable d'environnement ACCESS_CODE (Vercel). La route pose un
// cookie de session signé HMAC. Deux méthodes :
//   POST { code }  -> vérifie le code, pose le cookie si correct
//   GET            -> indique si le cookie de session est valide

import crypto from "crypto";
import { mintAccessToken } from "../../lib/firebaseAdmin";

const COOKIE_NAME = "fp_session";
// Secret de signature du cookie. À définir dans Vercel (SESSION_SECRET).
// Repli sur une valeur fixe si absent (moins sûr, mais fonctionnel).
const SECRET = process.env.SESSION_SECRET || "change-me-in-vercel-env";

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
}

function makeToken() {
  // Jeton opaque : "ok.<signature>". Ne contient pas le code.
  const payload = "ok";
  return payload + "." + sign(payload);
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (payload !== "ok") return false;
  // Comparaison à temps constant
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export default async function handler(req, res) {
  const expectedCode = process.env.ACCESS_CODE || "188";

  if (req.method === "GET") {
    const cookies = parseCookies(req);
    const ok = verifyToken(cookies[COOKIE_NAME]);
    const firebaseToken = ok ? await mintAccessToken() : null;
    return res.status(200).json({ authenticated: ok, firebaseToken });
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

    const token = makeToken();
    // Cookie 1 an, HttpOnly (invisible au JS), Secure, SameSite Lax
    res.setHeader("Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`
    );
    const firebaseToken = await mintAccessToken();
    return res.status(200).json({ authenticated: true, firebaseToken });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Méthode non autorisée." });
}
