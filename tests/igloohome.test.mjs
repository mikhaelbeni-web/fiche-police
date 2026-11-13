// tests/igloohome.test.mjs
// Prouve que le client igloohome est en LECTURE SEULE : scopes de lecture
// uniquement, GET uniquement, liste blanche d'adresses, secret jamais renvoyé.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SESSION_SECRET, ADMIN_PASSWORD, accessCookie, req, res, setCookieValue } from "./helpers.mjs";

process.env.SESSION_SECRET = SESSION_SECRET;
process.env.IGLOOHOME_CLIENT_ID = "id-de-test";
process.env.IGLOOHOME_CLIENT_SECRET = "secret-igloo-de-test-ne-doit-jamais-sortir";
const igloo = await import("../lib/igloohome.js");
const auth = await import("../lib/adminAuth.js");
process.env.ADMIN_PASSWORD_HASH = auth.hashPassword(ADMIN_PASSWORD, { iterations: 100000 });

// Faux serveur igloohome : enregistre chaque appel.
function fakeFetch(handlers = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    const u = new URL(url);
    const h = handlers[u.pathname] || (u.pathname.endsWith("/oauth2/token")
      ? () => ({ status: 200, body: { access_token: "jeton", expires_in: 86400, scope: igloo.READ_SCOPES.join(" ") } })
      : () => ({ status: 404, body: { message: "inconnu" } }));
    const { status, body } = h(u, opts);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}

test("liste blanche : seules la liste des serrures et l'historique sont autorisés", () => {
  assert.equal(igloo.assertAllowedPath("/devices"), "/devices");
  assert.equal(igloo.assertAllowedPath("/devices/IGB123_ab-9/activity"), "/devices/IGB123_ab-9/activity");
  for (const p of [
    "/devices/IGB1/unlock", "/devices/IGB1/lock", "/devices/IGB1/jobs/bridge", "/devices/IGB1/algopin/onetime",
    "/devices/IGB1/pin", "/devices/IGB1", "/devices/../admin/activity", "/devices/a%2Fb/activity", "/devices/IGB1/activity/x", "/properties",
  ]) {
    assert.throws(() => igloo.assertAllowedPath(p), /liste blanche/, p);
  }
});

test("jeton : demandé avec les seuls scopes de lecture, identifiants en Basic", async () => {
  igloo._resetTokenCacheForTests();
  const f = fakeFetch();
  await igloo.getToken(f);
  assert.equal(f.calls.length, 1);
  const c = f.calls[0];
  assert.equal(c.method, "POST");
  assert.equal(new URL(c.url).host, "auth.igloohome.co");
  const scope = new URLSearchParams(c.body).get("scope").split(" ");
  assert.deepEqual(scope.sort(), ["igloohomeapi/get-device-activity", "igloohomeapi/get-devices"]);
  assert.equal(new URLSearchParams(c.body).get("grant_type"), "client_credentials");
  assert.equal(c.headers.Authorization, "Basic " + Buffer.from("id-de-test:secret-igloo-de-test-ne-doit-jamais-sortir").toString("base64"));
});

test("lecture : uniquement des GET vers api.igloohome.co", async () => {
  igloo._resetTokenCacheForTests();
  const now = Date.now();
  const f = fakeFetch({
    "/home/devices": () => ({ status: 200, body: { payload: [{ deviceId: "IGL1", deviceName: "Cosy 11", type: "Lock", linkedBridge: "IGB9" }, { deviceId: "IGB9", type: "Bridge" }] } }),
    "/home/devices/IGL1/activity": () => ({ status: 200, body: { nextCursor: null, payload: [
      { activityTimeAt: new Date(now - 3600e3).toISOString(), activityType: "UNLOCK", description: "PIN" },
      { activityTimeAt: new Date(now - 10 * 86400e3).toISOString(), activityType: "LOCK", description: "vieux" },
    ] } }),
  });
  await igloo.apiGet("/devices", {}, f);
  const act = await igloo.readActivity("IGL1", { days: 7, fetchImpl: f });
  const nonToken = f.calls.filter(c => !c.url.includes("/oauth2/token"));
  assert.ok(nonToken.length >= 2);
  for (const c of nonToken) {
    assert.equal(c.method, "GET", c.url);
    assert.equal(new URL(c.url).host, "api.igloohome.co");
    assert.equal(c.headers.Authorization, "Bearer jeton");
  }
  assert.equal(act.evenements.length, 1, "l'événement de plus de 7 jours est écarté");
  assert.equal(act.evenementsLus, 2, "mais il reste dans le brut");
  const devs = igloo.summarizeDevices({ payload: [{ deviceId: "IGL1", deviceName: "Cosy 11", type: "Lock", linkedBridge: "IGB9" }, { deviceId: "IGB9", type: "Bridge" }] });
  assert.equal(devs[0].indicesBridge[0].champ, "linkedBridge");
  assert.equal(devs[1].estUnBridge, true);
});

test("historique : jeton demandé avec le SEUL scope get-device-activity (consigne igloohome 12/11)", async () => {
  igloo._resetTokenCacheForTests();
  const f = fakeFetch({
    "/home/devices": () => ({ status: 200, body: { payload: [] } }),
    "/home/devices/IGL1/activity": () => ({ status: 200, body: { payload: [] } }),
  });
  await igloo.apiGet("/devices", {}, f);
  await igloo.apiGet("/devices/IGL1/activity", {}, f);
  const tokens = f.calls.filter(c => c.url.includes("/oauth2/token")).map(c => new URLSearchParams(c.body).get("scope"));
  assert.deepEqual(tokens, ["igloohomeapi/get-devices igloohomeapi/get-device-activity", "igloohomeapi/get-device-activity"]);
  await assert.rejects(() => igloo.getToken(f, ["igloohomeapi/unlock"]), /lecture seule/);
});

test("historique : pagination par nextCursor, arrêt dès qu'on dépasse 7 jours", async () => {
  igloo._resetTokenCacheForTests();
  const now = Date.now();
  let n = 0;
  const f = fakeFetch({
    "/home/devices/IGL1/activity": (u) => {
      n++;
      const cursor = u.searchParams.get("cursor");
      if (!cursor) return { status: 200, body: { nextCursor: "p2", payload: [{ activityTimeAt: new Date(now - 86400e3).toISOString() }] } };
      return { status: 200, body: { nextCursor: "p3", payload: [{ activityTimeAt: new Date(now - 9 * 86400e3).toISOString() }] } };
    },
  });
  const act = await igloo.readActivity("IGL1", { days: 7, fetchImpl: f });
  assert.equal(n, 2);
  assert.equal(act.evenements.length, 1);
});

test("identifiant de serrure invalide : refusé avant tout appel réseau", async () => {
  const f = fakeFetch();
  await assert.rejects(igloo.readActivity("../x", { fetchImpl: f }), /invalide/);
  assert.equal(f.calls.length, 0);
});

test("le code du client ne contient aucun appel d'écriture", () => {
  const src = fs.readFileSync(new URL("../lib/igloohome.js", import.meta.url), "utf8");
  const methods = [...src.matchAll(/method:\s*"([A-Z]+)"/g)].map(m => m[1]);
  assert.deepEqual(methods.sort(), ["GET", "POST"], "un seul POST (jeton OAuth) et un seul GET");
  assert.equal((src.match(/fetchImpl\(/g) || []).length, 2, "deux appels réseau en tout");
  for (const f of ["pages/api/admin/igloohome/devices.js", "pages/api/admin/igloohome/activity.js"]) {
    const r = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/fetch\(/.test(r), `${f} ne doit appeler igloohome que via lib/igloohome.js`);
  }
});

test("routes : 404 pour un non-admin, secret jamais renvoyé même en cas d'erreur", async () => {
  const devices = (await import("../pages/api/admin/igloohome/devices.js")).default;
  const r1 = res();
  await devices(req({ cookies: [accessCookie()] }), r1);
  assert.equal(r1.statusCode, 404);

  // Admin, mais igloohome refuse : la réponse ne doit contenir ni le secret ni l'en-tête Basic.
  const login = (await import("../pages/api/admin/login.js")).default;
  const lr = res();
  await login(req({ method: "POST", cookies: [accessCookie()], body: { password: ADMIN_PASSWORD } }), lr);
  const admin = `fp_admin=${encodeURIComponent(setCookieValue(lr, "fp_admin"))}`;
  igloo._resetTokenCacheForTests();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
  try {
    const r2 = res();
    await devices(req({ cookies: [accessCookie(), admin] }), r2);
    assert.equal(r2.statusCode, 502);
    const out = JSON.stringify(r2.body);
    assert.ok(!out.includes(process.env.IGLOOHOME_CLIENT_SECRET));
    assert.ok(!out.includes(Buffer.from("id-de-test:" + process.env.IGLOOHOME_CLIENT_SECRET).toString("base64")));
    assert.equal(r2.body.etape, "jeton");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("403 : un jeton neuf est redemandé une fois, puis l'erreur cite les droits du jeton", async () => {
  igloo._resetTokenCacheForTests();
  let n = 0;
  const f = fakeFetch({ "/home/devices/IGL1/activity": () => { n++; return { status: 403, body: { message: "Forbidden" } }; } });
  await assert.rejects(igloo.apiGet("/devices/IGL1/activity", {}, f), /HTTP 403.*Droits du jeton/);
  assert.equal(n, 2, "deux essais, pas plus");
  assert.equal(f.calls.filter(c => c.url.includes("/oauth2/token")).length, 2, "jeton redemandé");
  assert.ok(f.calls.every(c => c.method === "GET" || c.url.includes("/oauth2/token")));
});

test("diagnostic : seulement des GET sur l'historique, s'arrête à la première variante qui marche", async () => {
  igloo._resetTokenCacheForTests();
  const f = fakeFetch({
    "/home/devices/IGL1/activity": (u) => u.searchParams.get("startDate") ? { status: 200, body: { payload: [] } } : { status: 403, body: "Forbidden" },
  });
  const r = await igloo.diagnoseActivity("IGL1", "1785487165632", f);
  assert.deepEqual(r.map(t => t.ok), [false, false, true]);
  assert.ok(f.calls.every(c => c.method === "GET" || c.url.includes("/oauth2/token")));
  assert.ok(f.calls.every(c => c.url.includes("/oauth2/token") || /\/home\/devices\/IGL1\/activity/.test(c.url)));
});

test("historique : lecture reprise avec le curseur `suite`, plus ancien événement indiqué", async () => {
  igloo._resetTokenCacheForTests();
  const now = Date.now();
  const f = fakeFetch({
    "/home/devices/IGL1/activity": (u) => {
      const c = u.searchParams.get("cursor");
      if (!c) return { status: 200, body: { nextCursor: "p2", payload: [{ activityTimeAt: new Date(now - 86400e3).toISOString() }] } };
      if (c === "p2") return { status: 200, body: { nextCursor: "p3", payload: [{ activityTimeAt: new Date(now - 2 * 86400e3).toISOString() }] } };
      return { status: 200, body: { nextCursor: null, payload: [{ activityTimeAt: new Date(now - 3 * 86400e3).toISOString() }] } };
    },
  });
  const a = await igloo.readActivity("IGL1", { days: 30, maxPages: 1, fetchImpl: f });
  assert.equal(a.suite, "p2");
  const b = await igloo.readActivity("IGL1", { days: 30, maxPages: 5, startCursor: a.suite, fetchImpl: f });
  assert.equal(b.suite, null);
  assert.equal(b.debutAtteint, false, "l'historique s'arrête avant le début de la période");
  assert.equal(b.plusAncien, new Date(now - 3 * 86400e3).toISOString());
  await assert.rejects(igloo.readActivity("IGL1", { startCursor: "a b", fetchImpl: f }), /Curseur invalide/);
});
