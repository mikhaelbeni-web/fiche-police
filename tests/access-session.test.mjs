// tests/access-session.test.mjs
// Code d'accès du logiciel : la session (cookie fp_session) expire 5 h après la saisie.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SESSION_SECRET, accessCookie, req, res } from "./helpers.mjs";

process.env.SESSION_SECRET = SESSION_SECRET;
process.env.ACCESS_CODE = "4242";
const h = await import("../lib/hostaway.js");
const auth = (await import("../pages/api/auth.js")).default;

test("la session du code d'accès dure 5 h, pas plus", () => {
  const now = Date.now();
  const { token } = h.makeSessionToken(now);
  assert.ok(h.verifySessionToken(token, now + 4.9 * 3600 * 1000) > 0);
  assert.equal(h.verifySessionToken(token, now + 5 * 3600 * 1000 + 1000), 0);
});

test("l'ancien jeton permanent « ok.<signature> » est refusé", () => {
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update("ok").digest("hex");
  const r = req({ cookies: [`fp_session=${encodeURIComponent("ok." + sig)}`] });
  assert.equal(h.verifySession(r), false);
});

test("jeton forgé (expiration rallongée ou signature fausse) refusé", () => {
  const loin = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  assert.equal(h.verifySession(req({ cookies: [accessCookie(SESSION_SECRET, loin)] })), false);
  assert.equal(h.verifySession(req({ cookies: [accessCookie("autre-secret")] })), false);
  assert.equal(h.verifySession(req({ cookies: [accessCookie()] })), true);
});

test("bon code : cookie de 5 h et heure d'expiration renvoyée", () => {
  const r = res();
  auth(req({ method: "POST", body: { code: "4242" } }), r);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["set-cookie"], /Max-Age=18000/);
  assert.match(r.headers["set-cookie"], /HttpOnly/);
  assert.ok(r.body.expiresAt > Date.now() / 1000 + 4.9 * 3600);
});

test("mauvais code : 401 sans cookie", () => {
  const r = res();
  auth(req({ method: "POST", body: { code: "0000" } }), r);
  assert.equal(r.statusCode, 401);
  assert.equal(r.headers["set-cookie"], undefined);
});

test("GET : l'usage ne prolonge pas la session (aucun nouveau cookie)", () => {
  const r = res();
  auth(req({ cookies: [accessCookie()] }), r);
  assert.equal(r.body.authenticated, true);
  assert.ok(r.body.expiresAt > 0);
  assert.equal(r.headers["set-cookie"], undefined);
});

test("changer ACCESS_CODE déconnecte toutes les sessions en cours", () => {
  const avant = req({ cookies: [accessCookie()] });
  assert.equal(h.verifySession(avant), true);
  process.env.ACCESS_CODE = "2323";
  try {
    assert.equal(h.verifySession(avant), false, "ancienne session refusée");
    assert.equal(h.verifySession(req({ cookies: [accessCookie()] })), true, "nouvelle session acceptée");
  } finally {
    process.env.ACCESS_CODE = "4242";
  }
});

test("l'ancien jeton v2 (avant ce changement) est refusé", () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(`v2.${exp}`).digest("hex");
  assert.equal(h.verifySession(req({ cookies: [`fp_session=${encodeURIComponent(`v2.${exp}.${sig}`)}`] })), false);
});
