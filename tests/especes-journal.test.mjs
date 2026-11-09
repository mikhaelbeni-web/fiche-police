// tests/especes-journal.test.mjs
// Gestion des espèces : journal chaîné, suppression logique réservée à l'admin avec
// motif, codes personnels, détection des écritures faites en contournant l'application.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SESSION_SECRET, ADMIN_PASSWORD, accessCookie, req, res, setCookieValue } from "./helpers.mjs";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.FIREBASE_PROJECT_ID = "projet-test";
process.env.FIREBASE_CLIENT_EMAIL = "sa@projet-test.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n");

const store = await import("../lib/adminStore.js");
const auth = await import("../lib/adminAuth.js");
process.env.ADMIN_PASSWORD_HASH = auth.hashPassword(ADMIN_PASSWORD, { iterations: 100000 });
const J = await import("../lib/especesJournal.js");
const login = (await import("../pages/api/admin/login.js")).default;
const route = (await import("../pages/api/especes.js")).default;
const routeAdmin = (await import("../pages/api/admin/especes.js")).default;

const PREFIX = "/v1/projects/projet-test/databases/(default)/documents/";

// Faux Firestore REST : GET document, liste, PATCH, commit atomique avec préconditions.
function fauxFirestore() {
  const docs = new Map(); // "coll/id" -> { fields, createTime, updateTime }
  let horloge = Date.parse("2026-11-10T08:00:00Z");
  const tick = () => new Date(horloge += 1000).toISOString();
  const fn = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    if (u.host === "oauth2.googleapis.com") return new Response(JSON.stringify({ access_token: "jeton", expires_in: 3600 }), { status: 200 });
    if (u.host !== "firestore.googleapis.com") return new Response("{}", { status: 599 });
    const path = decodeURIComponent(u.pathname);
    if (path.endsWith("documents:commit")) {
      const { writes } = JSON.parse(opts.body);
      for (const w of writes) {
        const cle = w.update.name.split("/documents/")[1];
        const cur = docs.get(cle);
        const pre = w.currentDocument;
        if (pre && pre.exists === false && cur) return new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), { status: 400 });
        if (pre && pre.updateTime && (!cur || cur.updateTime !== pre.updateTime)) return new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), { status: 400 });
      }
      const t = tick();
      for (const w of writes) {
        const cle = w.update.name.split("/documents/")[1];
        const cur = docs.get(cle);
        docs.set(cle, { fields: w.update.fields, createTime: cur?.createTime || t, updateTime: t });
      }
      return new Response(JSON.stringify({ commitTime: t }), { status: 200 });
    }
    const rel = path.slice(PREFIX.length);
    const parts = rel.split("/");
    if (parts.length === 1) {
      const documents = [...docs.entries()].filter(([k]) => k.split("/")[0] === parts[0])
        .map(([k, d]) => ({ name: "projects/projet-test/databases/(default)/documents/" + k, ...d }));
      return new Response(JSON.stringify({ documents }), { status: 200 });
    }
    if (method === "PATCH") {
      const t = tick();
      const cur = docs.get(rel);
      docs.set(rel, { fields: JSON.parse(opts.body).fields, createTime: cur?.createTime || t, updateTime: t });
      return new Response("{}", { status: 200 });
    }
    const d = docs.get(rel);
    return d ? new Response(JSON.stringify({ name: rel, ...d }), { status: 200 }) : new Response("{}", { status: 404 });
  };
  fn.docs = docs;
  // Écriture « en contournant l'application » (comme un navigateur sur une base ouverte).
  fn.direct = (cle, obj) => { const t = tick(); const cur = docs.get(cle); docs.set(cle, { fields: J.champsVersFs(obj), createTime: cur?.createTime || t, updateTime: t }); };
  fn.effacer = cle => docs.delete(cle);
  fn.champs = cle => J.champsDepuisFs(docs.get(cle).fields);
  return fn;
}

const ctx = { ip: "203.0.113.7", navigateur: "test" };

async function avecFetch(f, cb) {
  const real = globalThis.fetch;
  globalThis.fetch = f;
  try { return await cb(); } finally { globalThis.fetch = real; }
}

async function cookiesAdmin() {
  const lr = res();
  await login(req({ method: "POST", cookies: [accessCookie()], body: { password: ADMIN_PASSWORD } }), lr);
  return [accessCookie(), `fp_admin=${encodeURIComponent(setCookieValue(lr, "fp_admin"))}`];
}

async function appel(handler, { method = "POST", cookies = [accessCookie()], body, query } = {}) {
  const r = res();
  const q = req({ method, cookies, body });
  q.query = query || {};
  await handler(q, r);
  return r;
}

test("canonique : clés triées, même empreinte quel que soit l'ordre", () => {
  assert.equal(J.canonique({ b: 1, a: [2, { d: null, c: "x" }] }), '{"a":[2,{"c":"x","d":null}],"b":1}');
  assert.equal(J.sha256(J.canonique({ a: 1, b: 2 })), J.sha256(J.canonique({ b: 2, a: 1 })));
});

test("code personnel : refuse les suites et répétitions", () => {
  for (const p of ["1234", "0000", "4321", "12", "abcd", "123456789"]) assert.equal(J.pinValide(p), false, p);
  for (const p of ["2580", "739164", "1357"]) assert.equal(J.pinValide(p), true, p);
});

test("parcours complet : personnel, saisie, suppression logique, récupération, contrôle d'intégrité", async () => {
  store._resetStoreForTests();
  const f = fauxFirestore();
  // Une ligne ancienne, antérieure au journal.
  f.direct("cash_entries/ancienne", { type: "client", date: "2026-11-06", amount: 99.54, client: "Ancien", saisiPar: "THOMAS", recoveryId: null, createdAt: "2026-11-06T17:35:24Z" });
  f.direct("cash_recoveries/r0", { date: "2026-10-26", amountRecovered: 1100, amountLeftInBox: 38.73, note: "", totalAvant: 1138.73, entryIds: [], createdAt: "2026-10-26T17:04:08Z" });

  await avecFetch(f, async () => {
    const admin = await cookiesAdmin();

    // Le réceptionniste ne peut pas gérer le personnel.
    assert.equal((await appel(routeAdmin, { body: { action: "creer", nom: "Zack" } })).statusCode, 404);

    // L'admin crée Zack : code d'activation affiché une fois.
    let r = await appel(routeAdmin, { cookies: admin, body: { action: "creer", nom: "Zack" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const activation = r.body.codeActivation;
    assert.match(activation, /^\d{6}$/);
    const brut = JSON.stringify([...f.docs.values()]);
    assert.ok(!brut.includes(activation), "code d'activation jamais stocké en clair");

    // Saisie impossible avant activation.
    r = await appel(route, { body: { action: "ajouter", personneId: "zack", pin: "2580", ligne: { type: "client", date: "2026-11-10", amount: 120 } } });
    assert.equal(r.statusCode, 403);

    // Activation : mauvais code puis bon code.
    r = await appel(route, { body: { action: "activer", personneId: "zack", activation: "000000", pin: "2580" } });
    assert.equal(r.statusCode, 403);
    r = await appel(route, { body: { action: "activer", personneId: "zack", activation, pin: "2580" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));

    // Mauvais code personnel : refus, tracé dans le journal.
    r = await appel(route, { body: { action: "ajouter", personneId: "zack", pin: "9999", ligne: { type: "client", date: "2026-11-10", amount: 120 } } });
    assert.equal(r.statusCode, 403);

    // Saisie correcte : l'auteur vient du serveur, pas du navigateur.
    r = await appel(route, { body: { action: "ajouter", personneId: "zack", pin: "2580", ligne: { type: "client", date: "2026-11-10", amount: 120, client: "Client X", appartement: "20", designation: "SEJOUR", saisiPar: "QUELQU'UN D'AUTRE" } } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const idX = r.body.id;
    const ligne = f.champs("cash_entries/" + idX);
    assert.equal(ligne.saisiPar, "Zack");
    assert.equal(ligne.amount, 120);
    assert.equal(ligne.deleted, false);

    // Suppression : refusée au réceptionniste, refusée sans motif, puis logique.
    r = await appel(route, { body: { action: "supprimer", entryId: idX, motif: "erreur de saisie" } });
    assert.equal(r.statusCode, 403);
    r = await appel(route, { cookies: admin, body: { action: "supprimer", entryId: idX, motif: "" } });
    assert.equal(r.statusCode, 400);
    r = await appel(route, { cookies: admin, body: { action: "supprimer", entryId: idX, motif: "Doublon de la ligne du 10/11" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const sup = f.champs("cash_entries/" + idX);
    assert.equal(sup.deleted, true);
    assert.equal(sup.deleteReason, "Doublon de la ligne du 10/11");
    assert.equal(sup.amount, 120, "la ligne existe toujours, intacte");

    // Récupération : la liste envoyée doit correspondre à l'état réel.
    r = await appel(route, { body: { action: "recuperer", personneId: "zack", pin: "2580", montant: 100, entryIds: [] } });
    assert.equal(r.statusCode, 409);
    r = await appel(route, { body: { action: "recuperer", personneId: "zack", pin: "2580", montant: 100, note: "test", entryIds: ["ancienne"] } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.recuperation.totalAvant, 138.27);
    assert.equal(r.body.recuperation.amountLeftInBox, 38.27);
    assert.equal(f.champs("cash_entries/ancienne").recoveryId, r.body.recuperation.id);

    // Journal intact.
    r = await appel(routeAdmin, { method: "GET", cookies: admin, query: { vue: "journal" } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.ok, true, JSON.stringify(r.body.anomalies));
    const actions = r.body.evenements.map(e => e.action);
    assert.deepEqual(actions, ["ouverture_journal", "personnel_creation", "echec_activation", "personnel_activation", "echec_code", "creation", "suppression", "recuperation", "rattachement"]);
    assert.ok(r.body.evenements.every(e => e.ip === r.body.evenements[0].ip || e.ip));
    const supEv = r.body.evenements.find(e => e.action === "suppression");
    assert.equal(supEv.motif, "Doublon de la ligne du 10/11");
    assert.equal(JSON.parse(supEv.avant).deleted, false);

    // Contournements : effacement physique, modification directe, création directe.
    f.effacer("cash_entries/" + idX);
    f.direct("cash_entries/ancienne", { ...f.champs("cash_entries/ancienne"), amount: 9.54 });
    f.direct("cash_entries/fantome", { type: "client", date: "2026-11-10", amount: 5, saisiPar: "X", recoveryId: null });
    let v = await J.verifierJournal({ fetchImpl: f });
    assert.equal(v.ok, false);
    const types = v.anomalies.map(a => `${a.type}:${a.cible}`).sort();
    assert.deepEqual(types, [
      "hors_journal_creation:cash_entries/fantome",
      `hors_journal_effacement:cash_entries/${idX}`,
      "hors_journal_modification:cash_entries/ancienne",
    ]);

    // Retouche d'un événement du journal : chaîne cassée.
    const cleEv = [...f.docs.keys()].find(k => k.startsWith("cash_audit/") && J.champsDepuisFs(f.docs.get(k).fields).action === "suppression");
    const ev = J.champsDepuisFs(f.docs.get(cleEv).fields);
    f.direct(cleEv, { ...ev, motif: "autre motif" });
    v = await J.verifierJournal({ fetchImpl: f });
    assert.ok(v.anomalies.some(a => a.type === "chaine" && /retouché/.test(a.detail)));

    // Effacement du dernier événement : détecté par la tête.
    const derniers = [...f.docs.keys()].filter(k => k.startsWith("cash_audit/")).sort();
    f.effacer(derniers[derniers.length - 1]);
    v = await J.verifierJournal({ fetchImpl: f });
    assert.ok(v.anomalies.some(a => a.type === "chaine" && /tête/.test(a.detail)));
  });
});

test("blocage après 5 mauvais codes", async () => {
  store._resetStoreForTests();
  const f = fauxFirestore();
  await avecFetch(f, async () => {
    const admin = await cookiesAdmin();
    const { body } = await appel(routeAdmin, { cookies: admin, body: { action: "creer", nom: "Thomas" } });
    await appel(route, { body: { action: "activer", personneId: "thomas", activation: body.codeActivation, pin: "7391" } });
    for (let i = 0; i < 5; i++) await appel(route, { body: { action: "ajouter", personneId: "thomas", pin: "0001", ligne: { type: "expense", date: "2026-11-10", amount: 3 } } });
    const r = await appel(route, { body: { action: "ajouter", personneId: "thomas", pin: "7391", ligne: { type: "expense", date: "2026-11-10", amount: 3 } } });
    assert.equal(r.statusCode, 429, "bloqué même avec le bon code");
  });
});

test("sans session de la réception : 401", async () => {
  const r = await appel(route, { cookies: [], body: { action: "ajouter" } });
  assert.equal(r.statusCode, 401);
});
