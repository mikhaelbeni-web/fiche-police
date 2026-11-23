// tests/nuki.test.mjs
// Client Nuki (lib/nuki.js) et routes /api/admin/nuki/* :
//   - aucune ouverture de porte possible (liste blanche, pas de /action) ;
//   - la liste envoyée au navigateur ne contient jamais la valeur des codes ;
//   - règles du clavier Nuki ; actions en masse code par code avec contrôles ;
//   - routes réservées à l'admin (404 sinon) et confirmation obligatoire.
import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_SECRET, ADMIN_PASSWORD, accessCookie, req, res } from "./helpers.mjs";

process.env.SESSION_SECRET = SESSION_SECRET;
process.env.NUKI_API_TOKEN = "jeton-nuki-de-test-ne-doit-jamais-sortir";
const nuki = await import("../lib/nuki.js");
const auth = await import("../lib/adminAuth.js");
process.env.ADMIN_PASSWORD_HASH = auth.hashPassword(ADMIN_PASSWORD, { iterations: 100000 });

const A1 = "6773c4a173c3a772110bf2f7", A2 = "6773c4a173c3a772110bf2fe", A3 = "6773c4a273c3a772110bf79a";
function fakeNuki(authsParSerrure) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname + u.search, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers });
    const m = /^\/smartlock\/(\d+)\/auth$/.exec(u.pathname);
    if ((opts.method || "GET") === "GET" && m) return new Response(JSON.stringify(authsParSerrure[m[1]] || []), { status: 200 });
    return new Response(null, { status: 204 });
  };
  fn.calls = calls;
  return fn;
}

test("liste blanche : lecture, codes clavier ; jamais d'ouverture", () => {
  assert.ok(nuki.assertAllowed("GET", "/smartlock"));
  assert.ok(nuki.assertAllowed("POST", `/smartlock/123/auth/${A1}`));
  assert.ok(nuki.assertAllowed("DELETE", `/smartlock/123/auth/${A1}`));
  assert.ok(nuki.assertAllowed("PUT", "/smartlock/123/auth"));
  for (const [m, p] of [["POST", "/smartlock/123/action"], ["POST", "/smartlock/123/action/unlock"], ["POST", "/smartlock/123"], ["DELETE", "/smartlock/123"], ["DELETE", "/smartlock/auth"], ["POST", "/smartlock/auth"], ["GET", "/account"]]) {
    assert.throws(() => nuki.assertAllowed(m, p), /liste blanche/, `${m} ${p}`);
  }
});

test("résidences d'après le nom de la serrure", () => {
  assert.equal(nuki.residenceDe("Villiers  V7/V8  INTER"), "Villiers");
  assert.equal(nuki.residenceDe(" A5"), "Lantiez");
  assert.equal(nuki.residenceDe("A8"), "Lantiez");
  assert.equal(nuki.residenceDe("Deep "), "Belleville");
  assert.equal(nuki.residenceDe("Garage"), "Autre");
});

test("règles du clavier Nuki", () => {
  assert.equal(nuki.validerCode("345678"), null);
  assert.match(nuki.validerCode("34567"), /6 chiffres/);
  assert.match(nuki.validerCode("345670"), /0/);
  assert.match(nuki.validerCode("123456"), /12/);
  assert.match(nuki.validerCode("34a678"), /6 chiffres/);
});

test("la liste ne contient jamais la valeur des codes, seulement une lettre par variante", () => {
  const list = nuki.codesSansValeur([
    { id: A1, smartlockId: 1, type: 13, name: "admin menage", code: 456789, enabled: true },
    { id: A2, smartlockId: 2, type: 13, name: "Admin  menage ", code: 456789, enabled: true },
    { id: A3, smartlockId: 3, type: 13, name: "admin menage", code: 987654, enabled: false },
    { id: "abcdef", smartlockId: 3, type: 0, name: "application" },
  ]);
  assert.equal(list.length, 3);
  const json = JSON.stringify(list);
  assert.ok(!json.includes("456789") && !json.includes("987654"));
  assert.deepEqual(list.map(c => c.variante), ["A", "A", "B"]);
  assert.equal(list[2].actif, false);
});

test("modification : garde les réglages existants, change seulement ce qui est demandé", () => {
  const b = nuki.corpsModification({ name: "admin menage", code: 456789, enabled: true, remoteAllowed: false, allowedWeekDays: 127, allowedFromTime: 480 }, { code: "345678" });
  assert.deepEqual(b, { name: "admin menage", allowedWeekDays: 127, allowedFromTime: 480, enabled: true, remoteAllowed: false, code: 345678 });
  assert.equal(nuki.corpsModification({ name: "x", enabled: true }, { actif: false }).enabled, false);
});

test("validation de la demande avant tout appel", () => {
  const it = [{ smartlockId: 1, id: A1 }];
  assert.equal(nuki.validerDemande({ action: "code", items: it, code: "345678" }), null);
  assert.match(nuki.validerDemande({ action: "ouvrir", items: it }), /inconnue/);
  assert.match(nuki.validerDemande({ action: "code", items: it, code: "120000" }), /0|12/);
  assert.match(nuki.validerDemande({ action: "supprimer", items: [] }), /Aucun/);
  assert.match(nuki.validerDemande({ action: "supprimer", items: [{ smartlockId: "1/../x", id: A1 }] }), /invalide/);
  assert.match(nuki.validerDemande({ action: "supprimer", items: Array.from({ length: 26 }, () => it[0]) }), /Trop/);
  assert.match(nuki.validerDemande({ action: "renommer", items: it, nom: "x".repeat(33) }), /32/);
});

test("changement de code en masse : un résultat par serrure, doublons refusés", async () => {
  const f = fakeNuki({
    1: [{ id: A1, smartlockId: 1, type: 13, name: "admin menage", code: 456789, enabled: true }],
    2: [{ id: A2, smartlockId: 2, type: 13, name: "admin menage", code: 456789, enabled: true }, { id: "aaaaaa", smartlockId: 2, type: 13, name: "Anna", code: 345678 }],
    3: [{ id: A3, smartlockId: 3, type: 13, name: "admin menage", code: 345678, enabled: true }],
  });
  const r = await nuki.executerMasse({ action: "code", code: "345678", items: [{ smartlockId: 1, id: A1 }, { smartlockId: 2, id: A2 }, { smartlockId: 3, id: A3 }, { smartlockId: 1, id: "bbbbbb" }] }, { fetchImpl: f, delaiMs: 0 });
  assert.equal(r[0].ok, true); assert.equal(r[0].statut, "code changé");
  assert.equal(r[1].ok, false); assert.match(r[1].erreur, /Anna/);
  assert.equal(r[2].ok, true); assert.match(r[2].statut, /inchangé/);
  assert.equal(r[3].ok, false);
  const ecritures = f.calls.filter(c => c.method !== "GET");
  assert.equal(ecritures.length, 1);
  assert.equal(ecritures[0].path, `/smartlock/1/auth/${A1}`);
  assert.equal(ecritures[0].body.code, 345678);
  assert.equal(ecritures[0].headers.Authorization, "Bearer jeton-nuki-de-test-ne-doit-jamais-sortir");
  assert.ok(!JSON.stringify(r).includes("345678") && !JSON.stringify(r).includes("456789"), "aucun code dans le compte rendu");
});

test("suppression et création : un appel par serrure", async () => {
  const f = fakeNuki({ 1: [{ id: A1, smartlockId: 1, type: 13, name: "vieux", code: 456789 }], 2: [] });
  const r = await nuki.executerMasse({ action: "supprimer", items: [{ smartlockId: 1, id: A1 }] }, { fetchImpl: f, delaiMs: 0 });
  assert.equal(r[0].ok, true);
  assert.equal(f.calls.at(-1).method, "DELETE");
  const c = await nuki.creerCodes({ nom: "admin menage", code: "456789", smartlockIds: [1, 2] }, { fetchImpl: f, delaiMs: 0 });
  assert.equal(c[0].ok, false); assert.match(c[0].erreur, /vieux/);
  assert.equal(c[1].ok, true);
  const put = f.calls.filter(x => x.method === "PUT");
  assert.equal(put.length, 1);
  assert.deepEqual(put[0].body, { name: "admin menage", type: 13, code: 456789, remoteAllowed: false });
});

test("routes Nuki : 404 sans session admin, confirmation obligatoire", async () => {
  for (const name of ["etat", "code", "masse", "creer", "historique"]) {
    const h = (await import(`../pages/api/admin/nuki/${name}.js`)).default;
    const r = res();
    await h(req({ method: name === "masse" || name === "creer" ? "POST" : "GET", cookies: [accessCookie()] }), r);
    assert.equal(r.statusCode, 404, name);
  }
  const login = (await import("../pages/api/admin/login.js")).default;
  const lr = res();
  await login(req({ method: "POST", cookies: [accessCookie()], body: { password: ADMIN_PASSWORD } }), lr);
  const adminCookie = String(lr.headers["set-cookie"]).split(";")[0];
  const masse = (await import("../pages/api/admin/nuki/masse.js")).default;
  const r1 = res();
  await masse(req({ method: "POST", cookies: [accessCookie(), adminCookie], body: { action: "supprimer", items: [{ smartlockId: 1, id: A1 }] } }), r1);
  assert.equal(r1.statusCode, 400); assert.match(r1.body.error, /Confirmation/);
  const r2 = res();
  await masse(req({ method: "POST", cookies: [accessCookie(), adminCookie], body: { confirme: true, action: "code", code: "120000", items: [{ smartlockId: 1, id: A1 }] } }), r2);
  assert.equal(r2.statusCode, 400);
  assert.ok(!JSON.stringify(r2.body).includes("jeton-nuki"));
});
