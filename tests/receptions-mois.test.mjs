// tests/receptions-mois.test.mjs — relevé mensuel des réceptions envoyé à Elis.
import test from "node:test";
import assert from "node:assert/strict";

const { monthReceptionReport, moisLabel, emptyQuantities } = await import("../lib/linen.js");
const q = (o) => ({ ...emptyQuantities(), ...o });

const ORDERS = [
  { id: "o1", date: "2026-10-06", type: "mardi", expectedReception: "2026-10-13", status: "recue", quantities: q({ drap: 63, housse: 62 }) },
  { id: "o2", date: "2026-10-22", type: "jeudi", expectedReception: "2026-10-29", status: "commandee", quantities: q({ taie: 10 }) },
  { id: "o3", date: "2026-10-29", type: "jeudi", expectedReception: "2026-11-05", status: "commandee", quantities: q({ taie: 4 }) },
];
const RECEPTIONS = [
  // Livraison incomplète puis complément sans commande le même jour (cas réel du 13/10).
  { id: "r1", date: "2026-10-13", orderId: "o1", orderDate: "2026-10-06", orderType: "mardi", quantities: q({ housse: 60 }), commande: q({ drap: 63, housse: 62 }), defectAttendu: q() },
  { id: "r2", date: "2026-10-13", orderId: null, orderDate: null, quantities: q({ drap: 63 }), ecart: q({ drap: 63 }) },
  // Ancienne réception sans champ commande : retombe sur la commande liée.
  { id: "r3", date: "2026-10-20", orderId: "o1", quantities: q({ drap: 1 }) },
  { id: "r4", date: "2026-11-03", orderId: null, quantities: q({ taie: 2 }) },
];

test("relevé d'octobre : complément déduit, manque restant", () => {
  const r = monthReceptionReport(RECEPTIONS, ORDERS, "2026-10");
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map(x => x.id), ["r1", "r2", "r3"]);
  assert.equal(r.rows[1].libre, true);
  assert.equal(r.rows[1].ecart, null);
  assert.equal(r.rows[0].ecart.drap, -63);
  assert.equal(r.rows[0].ecart.housse, -2);
  assert.equal(r.rows[2].attendu.drap, 63);       // repli sur la commande
  assert.equal(r.rows[2].orderType, "mardi");
  assert.equal(r.totalRecu.drap, 64);
  assert.equal(r.totalRecuLibre.drap, 63);
  assert.equal(r.totalAttendu.drap, 126);
  // r1 ouvre 63 draps + 2 housses ; r2 en comble 63 ; r3 (repli commande) ouvre 62 draps + 62 housses.
  assert.equal(r.manqueOuvert.drap, 125);
  assert.equal(r.comble.drap, 63);
  assert.equal(r.manquant.drap, 62);
  assert.equal(r.manquant.housse, 64);
  assert.deepEqual(r.sansReception.map(o => o.id), ["o2"]);
});

test("mois sans réception", () => {
  const r = monthReceptionReport(RECEPTIONS, ORDERS, "2026-09");
  assert.equal(r.rows.length, 0);
  assert.equal(r.manquant.drap, 0);
});

test("une livraison sans commande AVANT le manque ne l'efface pas", () => {
  const rec = [
    { id: "a", date: "2026-10-06", quantities: q({ drap: 100 }) },
    { id: "b", date: "2026-10-15", orderId: "o1", quantities: q({ drap: 56, housse: 62 }), commande: q({ drap: 63, housse: 62 }) },
    { id: "c", date: "2026-10-20", orderId: "o1", quantities: q({ drap: 65, housse: 62 }), commande: q({ drap: 63, housse: 62 }) },
  ];
  const r = monthReceptionReport(rec, ORDERS, "2026-10");
  assert.equal(r.manqueOuvert.drap, 7);
  assert.equal(r.comble.drap, 2);   // excédent de 2 le 20/10
  assert.equal(r.manquant.drap, 5);
  assert.equal(r.manquant.housse, 0);
});

test("libellé du mois", () => {
  assert.equal(moisLabel("2026-10"), "octobre 2026");
  assert.equal(moisLabel("2026-01"), "janvier 2026");
});
