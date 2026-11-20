// Écritures de la caisse (lib/especesEcritures.js) avec une fausse base Firestore en mémoire.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ajouterLigne, supprimerLigne, recuperer, annulerRecuperation, soldeDepart,
  validerLigne, horodatageApres, nouvelleCle,
} from "../lib/especesEcritures.js";

// Fausse base : collections -> Map(id -> données). Transactions : lectures puis
// écritures appliquées d'un coup ; une erreur n'applique rien.
function fausseBase(init = {}) {
  const data = {};
  for (const [c, docs] of Object.entries(init)) data[c] = new Map(Object.entries(docs).map(([k, v]) => [k, { ...v }]));
  let n = 0;
  const db = {};
  const coll = c => (data[c] ||= new Map());
  const api = {
    db, data,
    collection: (_db, c) => ({ c }),
    doc: (a, b, id) => (b === undefined ? { c: a.c, id: "auto" + (++n) } : { c: b, id }),
    runTransaction: async (_db, fn) => {
      const ops = [];
      const tx = {
        get: async ref => { const v = coll(ref.c).get(ref.id); return { exists: () => Boolean(v), data: () => ({ ...v }) }; },
        set: (ref, v) => ops.push(() => coll(ref.c).set(ref.id, { ...v })),
        update: (ref, v) => ops.push(() => {
          if (!coll(ref.c).has(ref.id)) throw new Error("absent");
          coll(ref.c).set(ref.id, { ...coll(ref.c).get(ref.id), ...v });
        }),
      };
      const r = await fn(tx);
      ops.forEach(o => o());
      return r;
    },
  };
  return api;
}
const lignes = api => [...api.data.cash_entries.entries()].map(([id, v]) => ({ id, ...v }));
const recups = api => [...(api.data.cash_recoveries || new Map()).entries()].map(([id, v]) => ({ id, ...v }));

test("double envoi : une seule ligne", async () => {
  const api = fausseBase({ cash_entries: {} });
  const cle = nouvelleCle();
  const l = { type: "client", date: "2026-11-20", amount: 12.5, client: "Jo", saisiPar: "Amina", reservationId: "123" };
  const a = await ajouterLigne(api, l, cle, new Date("2026-11-20T10:00:00Z"));
  const b = await ajouterLigne(api, l, cle, new Date("2026-11-20T10:00:01Z"));
  assert.equal(a.dejaEnregistree, false);
  assert.equal(b.dejaEnregistree, true);
  assert.equal(lignes(api).length, 1);
  assert.equal(lignes(api)[0].reservationId, "123");
  assert.equal(lignes(api)[0].recoveryId, null);
});

test("validations : date future (heure de Paris), montant, auteur, raison", () => {
  // 23 h 30 UTC le 19 = 0 h 30 le 20 à Paris : le 20 est déjà aujourd'hui.
  const minuit = new Date("2026-11-19T23:30:00Z");
  assert.equal(validerLigne({ type: "client", date: "2026-11-20", amount: 1, saisiPar: "A" }, minuit).date, "2026-11-20");
  assert.throws(() => validerLigne({ type: "client", date: "2026-11-21", amount: 1, saisiPar: "A" }, minuit), /futur/);
  assert.throws(() => validerLigne({ type: "client", date: "2026-11-20", amount: 0, saisiPar: "A" }, minuit), /Montant/);
  assert.throws(() => validerLigne({ type: "client", date: "2026-11-20", amount: 5 }, minuit), /qui saisit/);
  assert.throws(() => validerLigne({ type: "expense", date: "2026-11-20", amount: 5, saisiPar: "A" }, minuit), /raison/);
});

test("suppression : marquée, jamais effacée ; motif obligatoire ; ligne récupérée refusée", async () => {
  const api = fausseBase({ cash_entries: { a: { type: "client", amount: 10, recoveryId: null }, b: { type: "client", amount: 5, recoveryId: "r1" } } });
  await assert.rejects(supprimerLigne(api, "a", "non"), /Motif/);
  await supprimerLigne(api, "a", "erreur de saisie", new Date("2026-11-20T10:00:00Z"));
  const a = api.data.cash_entries.get("a");
  assert.equal(a.deleted, true);
  assert.equal(a.deleteReason, "erreur de saisie");
  await assert.rejects(supprimerLigne(api, "a", "encore une fois"), /déjà supprimée/);
  await assert.rejects(supprimerLigne(api, "b", "erreur de saisie"), /récupérée/);
});

test("récupération atomique, contrôle de concurrence, annulation de la dernière seulement", async () => {
  const api = fausseBase({
    cash_recoveries: { r0: { amountLeftInBox: 20, createdAt: "2026-11-01T10:00:00.000Z", note: "Solde de départ", amountRecovered: 0 } },
    cash_entries: {
      e1: { type: "client", amount: 100, recoveryId: null },
      e2: { type: "expense", amount: 30, recoveryId: null },
      e3: { type: "client", amount: 7, deleted: true, recoveryId: null },
    },
  });
  const t = new Date("2026-11-20T10:00:00Z");
  await assert.rejects(recuperer(api, { montant: 91, entrees: lignes(api), recups: recups(api) }, t), /dépasser/);
  const r = await recuperer(api, { montant: 60, note: "", entrees: lignes(api), recups: recups(api), faitPar: "Mikhael" }, t);
  assert.equal(r.totalAvant, 90);
  assert.equal(r.amountLeftInBox, 30);
  assert.equal(api.data.cash_entries.get("e1").recoveryId, r.id);
  assert.equal(api.data.cash_entries.get("e2").recoveryId, r.id);
  assert.equal(api.data.cash_entries.get("e3").recoveryId, null);

  // Page restée ouverte sur l'ancien état : refusée, rien n'est écrit.
  const avant = recups(api).length;
  await assert.rejects(recuperer(api, { montant: 10, entrees: [{ id: "e1", type: "client", amount: 100 }], recups: [recups(api).find(x => x.id === "r0")] }, t), /changé/);
  assert.equal(recups(api).length, avant);

  await assert.rejects(annulerRecuperation(api, { id: "r0", motif: "test annulation", entrees: lignes(api), recups: recups(api) }), /dernière/);
  await annulerRecuperation(api, { id: r.id, motif: "erreur de montant", entrees: lignes(api), recups: recups(api) });
  assert.equal(api.data.cash_recoveries.get(r.id).deleted, true);
  assert.equal(api.data.cash_entries.get("e1").recoveryId, null);
});

test("horodatage strictement après la dernière récupération (horloge en retard)", async () => {
  const rs = [{ id: "r", createdAt: "2026-11-20T10:00:00.000Z" }];
  assert.equal(horodatageApres(rs, new Date("2026-11-20T09:00:00Z")), "2026-11-20T10:00:00.001Z");
  const api = fausseBase({ cash_recoveries: { r: rs[0] } });
  const s = await soldeDepart(api, { date: "2026-11-20", montant: 50, recups: rs }, new Date("2026-11-20T09:00:00Z"));
  assert.ok(s.createdAt > rs[0].createdAt);
  await assert.rejects(soldeDepart(api, { date: "2026-11-25", montant: 50, recups: rs }, new Date("2026-11-20T09:00:00Z")), /futur/);
});
