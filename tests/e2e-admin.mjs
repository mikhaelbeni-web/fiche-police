// tests/e2e-admin.mjs
// Contrôle de bout en bout sur l'application construite (next build + next start),
// lancé par .github/workflows/tests-admin.yml. Simule un réceptionniste (code
// d'accès seul) qui tape les adresses admin à la main et appelle l'API.
// Variables : BASE_URL, SESSION_SECRET, ADMIN_PASSWORD.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update("ok").digest("hex");
const ACCESS = `fp_session=${encodeURIComponent("ok." + sig)}`;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${e.message}`); }
}
const get = (p, cookie) => fetch(BASE + p, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const nextData = html => JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)[1]);

await check("sans aucun cookie : /codes/admin → 404", async () => {
  assert.equal((await get("/codes/admin")).status, 404);
});
await check("réceptionniste : /codes/admin tapée à la main → 404", async () => {
  assert.equal((await get("/codes/admin", ACCESS)).status, 404);
});
await check("réceptionniste : GET /api/admin/session → 404", async () => {
  assert.equal((await get("/api/admin/session", ACCESS)).status, 404);
});
await check("réceptionniste : /codes ne contient ni isAdmin=true ni lien admin", async () => {
  const r = await get("/codes", ACCESS);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.equal(nextData(html).props.pageProps.isAdmin, false);
  assert.ok(!html.includes("/codes/admin"), "lien admin présent dans le HTML");
  assert.ok(!html.includes("Espace admin"), "texte « Espace admin » présent dans le HTML");
});
await check("réceptionniste : mauvais mot de passe admin → 401, pas de cookie", async () => {
  const r = await fetch(BASE + "/api/admin/login", {
    method: "POST", headers: { cookie: ACCESS, "content-type": "application/json" },
    body: JSON.stringify({ password: "pas-le-bon" }),
  });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("set-cookie"), null);
});

let ADMIN = "";
await check("admin : connexion → 200 + cookie fp_admin", async () => {
  const r = await fetch(BASE + "/api/admin/login", {
    method: "POST", headers: { cookie: ACCESS, "content-type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(r.status, 200);
  const m = (r.headers.get("set-cookie") || "").match(/fp_admin=([^;]+)/);
  assert.ok(m, "cookie absent");
  ADMIN = `fp_admin=${m[1]}`;
});
await check("admin : /codes reçoit isAdmin=true", async () => {
  const html = await (await get("/codes", `${ACCESS}; ${ADMIN}`)).text();
  assert.equal(nextData(html).props.pageProps.isAdmin, true);
});
await check("admin : /codes/admin → 200", async () => {
  assert.equal((await get("/codes/admin", `${ACCESS}; ${ADMIN}`)).status, 200);
});
await check("cookie admin sans code d'accès → 404", async () => {
  assert.equal((await get("/codes/admin", ADMIN)).status, 404);
  assert.equal((await get("/api/admin/session", ADMIN)).status, 404);
});
await check("aucun secret ni code serveur admin dans les fichiers envoyés au navigateur", async () => {
  const dir = path.join(process.cwd(), ".next", "static");
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p);
  });
  walk(dir);
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    // « fp_admin:v1: » n'existe que dans lib/adminAuth.js : sa présence prouverait que le module serveur
    // est parti dans le navigateur. (pbkdf2Sync n'est pas un bon témoin : le polyfill crypto
    // embarqué par exceljs le contient.)
    for (const needle of ["ADMIN_PASSWORD_HASH", "SESSION_SECRET", "fp_admin:v1:", process.env.ADMIN_PASSWORD]) {
      assert.ok(!s.includes(needle), `${needle} trouvé dans ${path.relative(process.cwd(), f)}`);
    }
  }
});

if (failures) { console.log(`${failures} échec(s)`); process.exit(1); }
console.log("Tous les contrôles de bout en bout sont passés.");
