// tests/especes-controle.test.mjs — contrôle de cohérence de la caisse (lib/especesControle.js).
import test from "node:test";
import assert from "node:assert/strict";
import { controlerCaisse, jourParis, etatCaisse } from "../lib/especesControle.js";

const R0 = { id: "r0", date: "2026-07-22", amountRecovered: 0, amountLeftInBox: 187.1, totalAvant: 187.1, note: "Solde de départ", entryIds: [], createdAt: "2026-07-22T11:51:00Z" };
const e = (id, o) => ({ id, type: "client", date: "2026-11-19", amount: 10, client: "X", saisiPar: "THOMAS", recoveryId: null, createdAt: "2026-11-19T10:00:00Z", ...o });

test("jour de Paris : minuit et demi en hiver reste le jour même", () => {
  assert.equal(jourParis(new Date("2026-11-19T23:30:00Z")), "2026-11-20");
  assert.equal(new Date("2026-11-19T23:30:00Z").toISOString().slice(0, 10), "2026-11-19");
  assert.equal(jourParis(new Date("2026-07-14T22:30:00Z")), "2026-07-15");
});

test("caisse saine : aucune anomalie, total juste au centime", () => {
  const R1 = { id: "r1", date: "2026-09-22", amountRecovered: 100, amountLeftInBox: 97.1, totalAvant: 197.1, entryIds: ["a"], createdAt: "2026-09-22T12:00:00Z" };
  const lignes = [e("a", { recoveryId: "r1", date: "2026-09-01", createdAt: "2026-09-01T10:00:00Z" }), e("b", { amount: 0.1 }), e("c", { amount: 0.2, client: "Y" })];
  const r = controlerCaisse(lignes, [R0, R1], { maintenant: "2026-11-20T00:30:00Z" });
  assert.deepEqual(r.anomalies, []);
  assert.equal(r.etat.total, 97.4);
});

test("récupération incohérente, orpheline, caisse négative", () => {
  const R1 = { id: "r1", date: "2026-09-22", amountRecovered: 100, amountLeftInBox: 50, totalAvant: 197.1, entryIds: ["a"], createdAt: "2026-09-22T12:00:00Z" };
  const lignes = [e("a", { recoveryId: "r1", createdAt: "2026-09-01T10:00:00Z", date: "2026-09-01" }), e("z", { recoveryId: "disparue" }), e("d", { type: "expense", amount: 80, fournisseur: "F" })];
  const codes = controlerCaisse(lignes, [R0, R1], { maintenant: "2026-11-20T10:00:00Z" }).anomalies.map(a => a.code);
  assert.ok(codes.includes("repartition"));
  assert.ok(codes.includes("orpheline"));
  assert.ok(codes.includes("negatif"));
});

test("doublons : même réservation signalée, deux réservations d'un même client non", () => {
  const deuxResas = [e("a", { appartement: "31", arrivalDate: "2026-11-19", amount: 33.18, designation: "Taxe de séjour" }), e("b", { appartement: "12", arrivalDate: "2026-11-19", amount: 33.18, designation: "Taxe de séjour" })];
  assert.deepEqual(controlerCaisse(deuxResas, [R0], { maintenant: "2026-11-20T10:00:00Z" }).anomalies, []);
  const memeResa = [e("a", { reservationId: "1", designation: "Taxe de séjour" }), e("b", { reservationId: "1", designation: "Taxe de séjour", client: "x " })];
  const an = controlerCaisse(memeResa, [R0], { maintenant: "2026-11-20T10:00:00Z" }).anomalies;
  assert.equal(an.length, 1);
  assert.equal(an[0].code, "doublon");
  assert.deepEqual(an[0].ids, ["a", "b"]);
});

test("antidatée, future, sans auteur, hors application, suppression récente", () => {
  const lignes = [
    e("a", { date: "2026-10-02", createdAt: "2026-11-03T16:00:00Z" }),
    e("b", { date: "2026-11-25", client: "B" }),
    e("c", { saisiPar: "", client: "C" }),
    e("j", { journalise: true, client: "J", createdAt: "2026-11-15T10:00:00Z" }),
    e("h", { client: "H", createdAt: "2026-11-18T10:00:00Z" }),
    e("s", { deleted: true, deletedAt: "2026-11-18T10:00:00Z", deleteReason: "erreur de montant", client: "S" }),
  ];
  const codes = controlerCaisse(lignes, [R0], { maintenant: "2026-11-20T10:00:00Z" }).anomalies.map(a => a.code);
  for (const c of ["antidatee", "date_future", "sans_auteur", "hors_application", "suppression"]) assert.ok(codes.includes(c), c);
});

test("état : la dernière récupération non annulée sert de base", () => {
  const R1 = { id: "r1", amountRecovered: 10, amountLeftInBox: 5, totalAvant: 15, createdAt: "2026-09-22T12:00:00Z", deleted: true };
  assert.equal(etatCaisse([], [R0, R1]).baseline, 187.1);
});
