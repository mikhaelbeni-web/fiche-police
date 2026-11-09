// tests/admin-store.test.mjs
// Stockage privé de l'espace admin : contenu chiffré (illisible depuis Firestore),
// accès par compte de service, route de configuration réservée à l'admin.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SESSION_SECRET, ADMIN_PASSWORD, accessCookie, req, res, setCookieValue } from "./helpers.mjs";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.FIREBASE_PROJECT_ID = "projet-test";
process.env.FIREBASE_CLIENT_EMAIL = "sa@projet-test.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n");

const store = await import("../lib/adminStore.js");
const auth = await import("../lib/adminAuth.js");
process.env.ADMIN_PASSWORD_HASH = auth.hashPassword(ADMIN_PASSWORD, { iterations: 100000 });
const login = (await import("../pages/api/admin/login.js")).default;
const configRoute = (await import("../pages/api/admin/igloohome/config.js")).default;

// Faux Google + faux Firestore en mémoire.
function fakeGoogle() {
  const docs = new Map();
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    const u = new URL(url);
    if (u.host === "oauth2.googleapis.com") {
      const jwt = new URLSearchParams(opts.body).get("assertion");
      const [h, c, s] = jwt.split(".");
      const valid = crypto.createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
      const claims = JSON.parse(Buffer.from(c.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
      if (!valid || claims.scope !== "https://www.googleapis.com/auth/datastore") return new Response("{}", { status: 400 });
      return new Response(JSON.stringify({ access_token: "jeton-google", expires_in: 3600 }), { status: 200 });
    }
    if (u.host === "firestore.googleapis.com") {
      if (opts.headers?.Authorization !== "Bearer jeton-google") return new Response("{}", { status: 403 });
      if ((opts.method || "GET") === "PATCH") { docs.set(u.pathname, JSON.parse(opts.body)); return new Response(opts.body, { status: 200 }); }
      return docs.has(u.pathname) ? new Response(JSON.stringify(docs.get(u.pathname)), { status: 200 }) : new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 599 });
  };
  fn.calls = calls; fn.docs = docs;
  return fn;
}

test("chiffrement : aller-retour, illisible sans SESSION_SECRET", () => {
  const enc = store.encrypt({ code: "777777" });
  assert.ok(!enc.includes("777777"));
  assert.deepEqual(store.decrypt(enc), { code: "777777" });
  process.env.SESSION_SECRET = "autre";
  assert.throws(() => store.decrypt(enc), /illisibles/);
  process.env.SESSION_SECRET = SESSION_SECRET;
});

test("Firestore : compte de service signé, document chiffré, collection admin_prive", async () => {
  store._resetStoreForTests();
  const f = fakeGoogle();
  assert.equal(await store.readDoc("igloohome_croisement", f), null);
  await store.writeDoc("igloohome_croisement", { personnel: [{ nom: "Fatou", code: "777777" }] }, f);
  const patch = f.calls.find(c => c.method === "PATCH");
  assert.match(patch.url, /\/projects\/projet-test\/databases\/\(default\)\/documents\/admin_prive\/igloohome_croisement$/);
  assert.ok(!patch.body.includes("777777") && !patch.body.includes("Fatou"), "rien en clair");
  assert.deepEqual(await store.readDoc("igloohome_croisement", f), { personnel: [{ nom: "Fatou", code: "777777" }] });
  await assert.rejects(store.readDoc("../autre", f), /invalide/);
});

test("route de configuration : admin seulement, validation avant écriture", async () => {
  store._resetStoreForTests();
  const f = fakeGoogle();
  const realFetch = globalThis.fetch;
  globalThis.fetch = f;
  try {
    const lr = res();
    await login(req({ method: "POST", cookies: [accessCookie()], body: { password: ADMIN_PASSWORD } }), lr);
    const admin = [accessCookie(), `fp_admin=${encodeURIComponent(setCookieValue(lr, "fp_admin"))}`];

    let r = res();
    await configRoute(req({ method: "GET", cookies: [accessCookie()] }), r);
    assert.equal(r.statusCode, 404, "réceptionniste : 404");

    r = res();
    await configRoute(req({ method: "GET", cookies: admin }), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.body.config.mapping, {});

    r = res();
    await configRoute(req({ method: "PUT", cookies: admin, body: { config: { mapping: { X: { cible: "567560" } } } } }), r);
    assert.equal(r.statusCode, 400, "Deep refusé");
    assert.equal(f.calls.filter(c => c.method === "PATCH").length, 0, "rien écrit");

    r = res();
    await configRoute(req({ method: "PUT", cookies: admin, body: { config: { mapping: { IGL1: { cible: "80082", valide: true, nom: "Cosy 10" } }, personnel: [{ nom: "Fatou", categorie: "Ménage", code: "777777" }] } } }), r);
    assert.equal(r.statusCode, 200);
    r = res();
    await configRoute(req({ method: "GET", cookies: admin }), r);
    assert.equal(r.body.config.mapping.IGL1.cible, "80082");
    assert.equal(r.body.config.personnel[0].code, "777777");
  } finally {
    globalThis.fetch = realFetch;
  }
});
