// tests/porte.test.mjs
// Relais Nuki du portail Samsic (lib/porte.js, routes /api/porte/*) :
//   - l'ouverture n'est possible QUE sur la serrure configurée, jamais sur une autre ;
//   - sans la clé partagée, les routes répondent 404 ;
//   - la serrure est trouvée par identifiant ou nom exact, jamais « la première qui ressemble » ;
//   - freins sur les actions ; rien du jeton Nuki ne sort.
import test from "node:test";
import assert from "node:assert/strict";
import { req, res } from "./helpers.mjs";

process.env.NUKI_API_TOKEN = "jeton-nuki-de-test-ne-doit-jamais-sortir";
process.env.PORTE_SAMSIC_CLE = "cle-partagee-de-test-0123456789abcdef";
process.env.PORTE_SAMSIC_SERRURE = "Bureau RLB";
const nuki = await import("../lib/nuki.js");
const porte = await import("../lib/porte.js");
const etat = (await import("../pages/api/porte/etat.js")).default;
const action = (await import("../pages/api/porte/action.js")).default;

const LOCKS = [
  { smartlockId: 111, name: "Villiers V1", serverState: 0, state: { state: 1, batteryCharge: 80 } },
  { smartlockId: 222, name: "Bureau RLB", serverState: 0, state: { state: 3, batteryCharge: 55, batteryCritical: false }, config: { keypadPaired: true } },
  { smartlockId: 333, name: "bureau rlb bis", serverState: 4, state: { state: 1 } },
];

function fakeNuki({ horsLigne = false } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers });
    if (u.pathname === "/smartlock") return new Response(JSON.stringify(horsLigne ? LOCKS.map(l => ({ ...l, serverState: 4 })) : LOCKS), { status: 200 });
    const one = /^\/smartlock\/(\d+)$/.exec(u.pathname);
    if (one) {
      const s = LOCKS.find(l => String(l.smartlockId) === one[1]);
      return new Response(JSON.stringify(horsLigne ? { ...s, serverState: 4 } : s), { status: 200 });
    }
    if (/^\/smartlock\/\d+\/log$/.test(u.pathname)) return new Response(JSON.stringify([{ id: "l1", smartlockId: 222, date: "2026-11-27T12:00:00Z", name: "Levhotel", action: 3, trigger: 4, state: 0 }]), { status: 200 });
    return new Response(null, { status: 204 });
  };
  fn.calls = calls;
  return fn;
}

const AUTH = `Bearer ${process.env.PORTE_SAMSIC_CLE}`;
function reqCle({ method = "GET", body, cle = AUTH, origine } = {}) {
  const r = req({ method, body });
  if (cle) r.headers.authorization = cle;
  if (origine) r.headers["x-porte-origine"] = origine;
  return r;
}

test.beforeEach(() => porte._resetPourTests());

test("liste blanche : /action refusé sauf avec actionSur pour cette serrure précise", () => {
  assert.throws(() => nuki.assertAllowed("POST", "/smartlock/222/action"), /liste blanche/);
  assert.ok(nuki.assertAllowed("POST", "/smartlock/222/action", { actionSur: "222" }));
  assert.throws(() => nuki.assertAllowed("POST", "/smartlock/111/action", { actionSur: "222" }), /liste blanche/);
  assert.throws(() => nuki.assertAllowed("DELETE", "/smartlock/222/action", { actionSur: "222" }), /liste blanche/);
  assert.throws(() => nuki.assertAllowed("POST", "/smartlock/222/action/unlock", { actionSur: "222" }), /liste blanche/);
  assert.ok(nuki.assertAllowed("GET", "/smartlock/222"));
});

test("serrure trouvée par nom exact ou identifiant ; ambiguïté et absence refusées", () => {
  assert.equal(porte.trouverSerrure(LOCKS, "Bureau RLB").smartlockId, 222);
  assert.equal(porte.trouverSerrure(LOCKS, " bureau  rlb ").smartlockId, 222);
  assert.equal(porte.trouverSerrure(LOCKS, "333").smartlockId, 333);
  assert.throws(() => porte.trouverSerrure(LOCKS, "Bureau"), /introuvable/);
  assert.throws(() => porte.trouverSerrure(LOCKS, "999"), /introuvable/);
  assert.throws(() => porte.trouverSerrure([...LOCKS, { smartlockId: 444, name: "Bureau RLB" }], "Bureau RLB"), /Plusieurs/);
});

test("clé partagée : longueur minimale, comparaison exacte, lecture de l'en-tête", () => {
  assert.equal(porte.verifierCle(process.env.PORTE_SAMSIC_CLE), true);
  assert.equal(porte.verifierCle(process.env.PORTE_SAMSIC_CLE + "x"), false);
  assert.equal(porte.verifierCle("courte"), false);
  assert.equal(porte.verifierCle(undefined), false);
  assert.equal(porte.cleDeLaRequete(reqCle()), process.env.PORTE_SAMSIC_CLE);
  assert.equal(porte.cleDeLaRequete(reqCle({ cle: "Basic abc" })), "");
});

test("état : l'action POST part sur la serrure configurée, avec le bon code Nuki", async () => {
  const f = fakeNuki();
  const e = await porte.etatPortail({ fetchImpl: f });
  assert.equal(e.porte.nom, "Bureau RLB");
  assert.equal(e.porte.etat, "déverrouillée");
  assert.equal(e.porte.enLigne, true);
  assert.ok(!("id" in e.porte) && !("residence" in e.porte), "rien d'interne dans le résumé public");
  assert.equal(e.evenements.length, 1);
  assert.equal(e.evenements[0].action, "Ouverture (loquet)");
  const r = await porte.executerAction("ouvrir", { fetchImpl: f });
  assert.equal(r.action, "ouvrir");
  const post = f.calls.filter(c => c.method === "POST");
  assert.equal(post.length, 1);
  assert.equal(post[0].path, "/smartlock/222/action");
  assert.deepEqual(post[0].body, { action: 3 });
  assert.equal(post[0].headers.Authorization, "Bearer jeton-nuki-de-test-ne-doit-jamais-sortir");
  const v = await porte.executerAction("verrouiller", { fetchImpl: f });
  assert.equal(v.libelle, "Verrouillage");
  assert.deepEqual(f.calls.at(-1).body, { action: 2 });
  assert.ok(f.calls.every(c => c.method === "GET" || c.path === "/smartlock/222/action"), "aucune écriture ailleurs");
  await assert.rejects(porte.executerAction("supprimer", { fetchImpl: f }), /inconnue/);
});

test("serrure hors ligne : refus clair, aucun appel d'action", async () => {
  const f = fakeNuki({ horsLigne: true });
  await assert.rejects(porte.executerAction("ouvrir", { fetchImpl: f }), /hors ligne/);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});

test("routes : 404 sans la clé, 405 mauvaise méthode, 400 action inconnue", async () => {
  for (const [h, m] of [[etat, "GET"], [action, "POST"]]) {
    const r1 = res(); await h(reqCle({ method: m, cle: null }), r1); assert.equal(r1.statusCode, 404);
    const r2 = res(); await h(reqCle({ method: m, cle: "Bearer mauvaise-cle-mais-assez-longue-0000" }), r2); assert.equal(r2.statusCode, 404);
    const r3 = res(); await h(reqCle({ method: m === "GET" ? "POST" : "GET" }), r3); assert.equal(r3.statusCode, 405);
  }
  const r4 = res(); await action(reqCle({ method: "POST", body: { action: "exploser" } }), r4);
  assert.equal(r4.statusCode, 400);
  assert.ok(!JSON.stringify(r4.body).includes("jeton-nuki"));
});

test("freins : 6 actions par origine et par 5 minutes, puis 429", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < porte.MAX_ACTIONS_PAR_ORIGINE; i++) assert.equal(porte.limiterActions("samsic-1", t0 + i), null);
  assert.match(porte.limiterActions("samsic-1", t0 + 10), /Trop d'actions/);
  assert.equal(porte.limiterActions("samsic-2", t0 + 10), null, "une autre origine n'est pas bloquée");
  assert.equal(porte.limiterActions("samsic-1", t0 + porte.FENETRE_ORIGINE_MS + 1), null, "la fenêtre glisse");
});

test("non configuré : 404 partout", async () => {
  const sauve = process.env.PORTE_SAMSIC_CLE;
  process.env.PORTE_SAMSIC_CLE = "";
  const r = res(); await etat(reqCle(), r);
  assert.equal(r.statusCode, 404);
  assert.equal(porte.isPorteConfigured(), false);
  process.env.PORTE_SAMSIC_CLE = sauve;
});
