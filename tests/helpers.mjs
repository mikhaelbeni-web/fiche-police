// tests/helpers.mjs — fausses requêtes / réponses Next.js et cookies de test.
import crypto from "node:crypto";

export const SESSION_SECRET = "secret-de-test-session";
export const ADMIN_PASSWORD = "mot-de-passe-admin-de-test";

// Cookie fp_session valide, identique à celui que pose /api/auth après le code d'accès.
export function accessCookie(secret = SESSION_SECRET) {
  const sig = crypto.createHmac("sha256", secret).update("ok").digest("hex");
  return `fp_session=${encodeURIComponent("ok." + sig)}`;
}

let ipCounter = 0;
export function req({ method = "GET", cookies = [], body, ip } = {}) {
  return {
    method,
    headers: { cookie: cookies.join("; "), "x-forwarded-for": ip || `10.0.0.${++ipCounter % 250}` },
    body,
    socket: { remoteAddress: "127.0.0.1" },
  };
}

export function res() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  return r;
}

export function setCookieValue(r, name) {
  const h = r.headers["set-cookie"];
  if (!h) return null;
  const m = String(h).match(new RegExp(`${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}
