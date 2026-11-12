// tests/bordereaux.test.mjs — bordereaux d'expédition Elis comparés à la facture.
import test from "node:test";
import assert from "node:assert/strict";

const B = await import("../lib/bordereauLinge.js");

// Texte du vrai bordereau du 10/11/2026 (lignes telles que regroupées par lireLignesPdf).
const LIGNES = [
  "MAJ - BLANCHISSERIE DE PANTIN BORDEREAU D’EXPEDITION RESIDENCE LE BELLEVILLE",
  "ELIS PANTIN LINGE SERVICE 32 RUE FREDERICK LEMAITRE",
  "31 Che. Latéral au Chemin de Fer LIVRAISON DU 10/11/2026 75020 PARIS",
  "237827 237827 237827 RESIDENCE LE BELLEVILLE 4 40 01 55 74 64 42",
  "1460 Moyen cabri 7",
  "2941 Drap Clas blc l. noir 280 NF 44 44",
  "3244 Drap bain COCOON blc 81 81",
  "41115 Housse Stella S l.MARINE blc NF 47 47",
  "421 Serv Eponge COCOON blc 77 77",
  "517 Taie Am Clas blc 50x80 NF 94 94",
  "76549 Tapis bain harmony 49x70 blc 30 30",
  "49110 Torchon carreaux bleus resid 47x70 21 20",
  "Commentaires Signature client Sign.PANTIN US",
  "Lun 09/11/2026 - 20:28:00",
];

test("lecture d'un bordereau", () => {
  const r = B.analyserBordereauElis(LIGNES);
  assert.equal(r.saisieLe, "2026-11-09T20:28");
  assert.equal(r.dateLivraison, "2026-11-10");
  assert.deepEqual(r.lines.drap_clas, { aLivrer: 44, livree: 44 });
  assert.deepEqual(r.lines.taie_clas, { aLivrer: 94, livree: 94 });
  assert.deepEqual(r.lines.torchon_carreaux, { aLivrer: 21, livree: 20 });
  assert.equal(r.lines.drap_horizon.livree, 0);
  assert.equal(r.avertissements.length, 1); // torchon : 21 à livrer, 20 livrés
});

const bord = (saisieLe, dateLivraison, q) => {
  const lines = B.lignesVidesBordereau();
  for (const [id, n] of Object.entries(q)) lines[id] = { aLivrer: n, livree: n };
  return { saisieLe, dateLivraison, lines };
};
const BORDS = [
  bord("2026-10-05T19:10", "2026-10-06", { drap_clas: 50, taie_clas: 100 }),
  bord("2026-10-19T20:05", "2026-10-20", { drap_clas: 40 }),
  bord("2026-11-02T18:00", "2026-11-03", { drap_clas: 999 }), // hors période
];
const INV = { numFacture: "2600104-998989", periodFrom: "2026-10-01", periodTo: "2026-10-31",
  lines: { drap_clas: { qte: 100, prixUnitaire: 1.804 }, taie_clas: { qte: 100, prixUnitaire: 0.558 }, torchon_carreaux: { qte: 0, prixUnitaire: 0.651 } } };

test("facture comparée aux bordereaux du mois", () => {
  const c = B.comparerFactureBordereaux(INV, BORDS);
  assert.deepEqual(c.bordereaux.map(b => b.dateLivraison), ["2026-10-06", "2026-10-20"]);
  const drap = c.lignes.find(l => l.id === "drap_clas");
  assert.equal(drap.livre, 90);
  assert.equal(drap.ecart, 10);
  assert.ok(Math.abs(drap.ecartEuros - 18.04) < 1e-9);
  assert.deepEqual(drap.detail.map(d => d.saisieLe), ["2026-10-05T19:10", "2026-10-19T20:05"]);
  assert.equal(c.lignes.find(l => l.id === "taie_clas").ecart, 0);
  assert.equal(c.conforme, false);
  const mail = B.mailEcartBordereaux(INV, c);
  assert.match(mail.body, /- Bordereau livraison du 06\/10\/2026 \(saisi le 05\/10\/2026 à 19h10\)/);
  assert.match(mail.body, /      - livraison du 20\/10\/2026 \(saisi le 19\/10\/2026 à 20h05\) : 40/);
  assert.doesNotMatch(mail.body, /bordereau n°|- n° /i);
  assert.match(mail.body, /facturé : 100 – livré selon vos bordereaux : 90/);
  assert.match(mail.body, /10 pièces facturée\(s\) en trop \(18,04 € HT\)/);
  assert.doesNotMatch(mail.body, /Taie/);
});

test("facture conforme : pas de mail", () => {
  const inv = { ...INV, lines: { drap_clas: { qte: 90, prixUnitaire: 1.804 }, taie_clas: { qte: 100, prixUnitaire: 0.558 } } };
  const c = B.comparerFactureBordereaux(inv, BORDS);
  assert.equal(c.conforme, true);
  assert.equal(B.mailEcartBordereaux(inv, c), null);
});

test("contrôle avec la réception saisie le même jour", () => {
  const b = bord("2026-11-09T20:28", "2026-11-10", { drap_clas: 44, drap_cocoon: 81 });
  const rec = [{ date: "2026-11-10", quantities: { drap: 44, grande_serviette: 80 } }];
  const r = B.controleReception(b, rec);
  assert.equal(r.statut, "different");
  assert.deepEqual(r.ecarts.map(e => [e.key, e.bordereau, e.recu]), [["grande_serviette", 81, 80]]);
  assert.equal(B.controleReception(b, []).statut, "aucune");
});
