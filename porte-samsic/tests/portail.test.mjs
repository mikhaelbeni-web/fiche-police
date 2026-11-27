// porte-samsic/tests/portail.test.mjs
// Portail Samsic : mot de passe (hash seulement), session signée 12 h, freins, et appels au
// relais Hotel Desk avec la clé partagée (jamais envoyée au navigateur).
import test from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "secret-de-test";
process.env.HOTEL_DESK_URL = "https://hotel-desk.test";
process.env.PORTE_SAMSIC_CLE = "cle-partagee-de-test-0123456789abcdef";
const session = await import("../lib/session.js");
process.env.MOT_DE_PASSE_HASH = session.hashMotDePasse("Mot-De-Passe-Test", { iterations: 100000 });
const relais = await import("../lib/relais.js");
const connexion = (await import("../pages/api/connexion.js")).default;
const etat = (await import("../pages/api/etat.js")).default;
const action = (await import("../pages/api/action.js")).default;

let ipCounter = 0;
function req({ method = "GET", cookies = [], body, ip } = {}) {
  return { method, headers: { cookie: cookies.join("; "), "x-forwarded-for": ip || `10.0.0.${++ipCounter % 250}` }, body, socket: { remoteAddress: "127.0.0.1" } };
}
function res() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  return r;
}
function cookieDe(r) { return String(r.headers["set-cookie"]).split(";")[0]; }

test.beforeEach(() => session._resetPourTests());

test("mot de passe : hash PBKDF2 vérifiable, refus des mauvais formats", () => {
  assert.equal(session.verifierMotDePasse("Mot-De-Passe-Test", process.env.MOT_DE_PASSE_HASH), true);
  assert.equal(session.verifierMotDePasse("autre", process.env.MOT_DE_PASSE_HASH), false);
  assert.equal(session.verifierMotDePasse("", process.env.MOT_DE_PASSE_HASH), false);
  assert.equal(session.verifierMotDePasse("Mot-De-Passe-Test", "Mot-De-Passe-Test"), false, "jamais de mot de passe en clair");
});

test("jeton de session : valide 12 h, expiré ou forgé refusé, dépend du hash", () => {
  const { jeton, exp } = session.creerJeton(0);
  assert.equal(session.verifierJeton(jeton, 1000), exp);
  assert.equal(session.verifierJeton(jeton, session.TTL_SECONDES * 1000 + 1), 0);
  assert.equal(session.verifierJeton(jeton.slice(0, -1) + "0", 1000), 0);
  assert.equal(session.verifierJeton("v1.99999999999." + "a".repeat(64), 1000), 0);
  const sauve = process.env.MOT_DE_PASSE_HASH;
  process.env.MOT_DE_PASSE_HASH = session.hashMotDePasse("nouveau", { iterations: 100000 });
  assert.equal(session.verifierJeton(jeton, 1000), 0, "changer le mot de passe déconnecte");
  process.env.MOT_DE_PASSE_HASH = sauve;
});

test("connexion : 401 puis cookie ; 5 échecs = 429", async () => {
  const r1 = res(); await connexion(req({ method: "POST", body: { motDePasse: "faux" }, ip: "1.1.1.1" }), r1);
  assert.equal(r1.statusCode, 401);
  const r2 = res(); await connexion(req({ method: "POST", body: { motDePasse: "Mot-De-Passe-Test" }, ip: "1.1.1.1" }), r2);
  assert.equal(r2.statusCode, 200);
  assert.match(String(r2.headers["set-cookie"]), /porte_session=.*HttpOnly.*Secure.*SameSite=Strict/);
  assert.ok(session.expirationSession(req({ cookies: [cookieDe(r2)] })) > 0);
  for (let i = 0; i < 5; i++) { const r = res(); await connexion(req({ method: "POST", body: { motDePasse: "faux" }, ip: "2.2.2.2" }), r); }
  const r3 = res(); await connexion(req({ method: "POST", body: { motDePasse: "Mot-De-Passe-Test" }, ip: "2.2.2.2" }), r3);
  assert.equal(r3.statusCode, 429);
  const r4 = res(); await connexion(req({ method: "GET" }), r4);
  assert.equal(r4.statusCode, 405);
});

test("routes etat/action : 401 sans session, 400 action inconnue", async () => {
  const r1 = res(); await etat(req(), r1); assert.equal(r1.statusCode, 401);
  const r2 = res(); await action(req({ method: "POST", body: { action: "ouvrir" } }), r2); assert.equal(r2.statusCode, 401);
  const { jeton } = session.creerJeton();
  const r3 = res(); await action(req({ method: "POST", cookies: [`porte_session=${jeton}`], body: { action: "exploser" } }), r3);
  assert.equal(r3.statusCode, 400);
});

test("route etat : seuls l'état courant et l'heure de lecture sortent, jamais l'historique", async () => {
  const ancien = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, porte: { nom: "Bureau RLB", etat: "verrouillée", enLigne: true }, evenements: [{ action: "Ouverture", qui: "Levhotel" }], lueLe: "2026-11-27T12:00:00Z" }), { status: 200 });
  try {
    const { jeton } = session.creerJeton();
    const r = res(); await etat(req({ cookies: [`porte_session=${jeton}`] }), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ["lueLe", "ok", "porte"]);
    assert.equal(r.body.porte.etat, "verrouillée");
  } finally {
    globalThis.fetch = ancien;
  }
});

test("relais : clé partagée en Bearer, origine transmise, erreurs traduites", async () => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith("/api/porte/etat")) return new Response(JSON.stringify({ ok: true, porte: { nom: "Bureau RLB", etat: "déverrouillée", enLigne: true }, lueLe: "2026-11-27T12:00:00Z" }), { status: 200 });
    if (url.endsWith("/api/porte/action")) return new Response(JSON.stringify({ ok: true, action: "ouvrir", libelle: "Ouverture de la porte", serrure: "Bureau RLB", a: "2026-11-27T12:00:01Z" }), { status: 200 });
    return new Response(JSON.stringify({ error: "Introuvable." }), { status: 404 });
  };
  const e = await relais.lireEtat({ origine: "9.9.9.9", fetchImpl: f });
  assert.equal(e.porte.nom, "Bureau RLB");
  assert.equal(calls[0].url, "https://hotel-desk.test/api/porte/etat");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer " + process.env.PORTE_SAMSIC_CLE);
  assert.equal(calls[0].opts.headers["X-Porte-Origine"], "9.9.9.9");
  const a = await relais.envoyerAction("ouvrir", { fetchImpl: f });
  assert.equal(a.libelle, "Ouverture de la porte");
  assert.deepEqual(JSON.parse(calls[1].opts.body), { action: "ouvrir" });
  await assert.rejects(relais.appelerRelais("/api/autre", { fetchImpl: f }), /refuse la clé/);
  const f429 = async () => new Response(JSON.stringify({ ok: false, error: "Trop d'actions" }), { status: 429 });
  await assert.rejects(relais.envoyerAction("ouvrir", { fetchImpl: f429 }), e2 => e2.status === 429 && /Trop/.test(e2.message));
  const fPanne = async () => { throw new Error("ECONNRESET"); };
  await assert.rejects(relais.lireEtat({ fetchImpl: fPanne }), /injoignable/);
});

test("non configuré : 503 et liste des variables manquantes", async () => {
  const sauve = process.env.HOTEL_DESK_URL;
  process.env.HOTEL_DESK_URL = "";
  assert.deepEqual(session.manques(), ["HOTEL_DESK_URL"]);
  const r = res(); await connexion(req({ method: "POST", body: { motDePasse: "x" } }), r);
  assert.equal(r.statusCode, 503);
  process.env.HOTEL_DESK_URL = sauve;
});
