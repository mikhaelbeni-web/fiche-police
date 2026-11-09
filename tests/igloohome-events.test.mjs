import test from "node:test";
import assert from "node:assert/strict";
import { flattenWebhooks, rowsToText } from "../lib/igloohomeEvents.js";
import { IGLOO_APARTMENTS } from "../lib/croisement.js";

// Envois réels reçus le 2026-11-09 (ouverture à distance du Zen 62 depuis l'application).
const zen = IGLOO_APARTMENTS.find(a => /62/.test(a.nom));
const mapping = { IGM408c47536: { nom: "62", cible: zen.id, valide: true } };
const envois = [
  { recuLe: "2026-11-09T15:06:04.000Z", corps: { payload: { event: { id: "a", type: 5, data: { activityLogs: [
    { entryDate: 1794236762, logType: 13, keyId: 1026810524, time1: 1794236762 },
    { entryDate: 1794236760, logType: 11, keyId: 1026810524, operationId: 1087911593 },
  ] }, date: "2026-11-09T15:06:03.000Z", proxyId: "EB1X12fe334c" }, product: { id: "IGM408c47536", type: 1 } } } },
  { recuLe: "2026-11-09T15:06:01.000Z", corps: { payload: { event: { id: "b", type: 3, data: { jobId: "x", jobStatus: 0 }, date: "2026-11-09T15:06:00.000Z", proxyId: "EB1X12fe334c" }, product: { id: "IGM408c47536", type: 1 } } } },
  { recuLe: "2026-11-09T15:07:00.000Z", corps: { payload: { event: { type: 5, data: { activityLogs: [{ entryDate: 1794236800, logType: 99, keyId: 1 }] } }, product: { id: "IGMinconnu" } } } },
];

test("webhook : un événement par entrée de journal, avec l'appartement de la correspondance", () => {
  const rows = flattenWebhooks(envois, mapping);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].appartement, "Serrure inconnue");
  assert.match(rows[0].quoi, /99 \(inconnu\)/);
  const zenRows = rows.filter(r => r.deviceId === "IGM408c47536");
  assert.ok(zenRows.every(r => r.appartement === zen.nom));
  assert.deepEqual(zenRows.map(r => r.logType ?? "job"), [13, 11, "job"]);
  assert.equal(zenRows[1].ms, 1794236760 * 1000);
  assert.match(zenRows[1].quoi, /application/);
});

test("webhook : résumé copiable, une ligne par événement", () => {
  const txt = rowsToText(flattenWebhooks(envois, mapping));
  assert.equal(txt.split("\n").length, 5);
  assert.match(txt, /1026810524/);
});

test("webhook : envoi illisible ne casse rien", () => {
  assert.equal(flattenWebhooks([{ recuLe: "x", corps: "texte" }], {}).length, 1);
  assert.deepEqual(flattenWebhooks(undefined, undefined), []);
});
