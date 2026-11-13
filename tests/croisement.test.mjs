// tests/croisement.test.mjs
// Règle d'alerte de mikhael : ouverture entre 19 h et 8 h le lendemain (Paris), une nuit
// sans réservation dans l'appartement => ALERTE. Belleville seulement, hors Deep (Nuki).
import test from "node:test";
import assert from "node:assert/strict";

const c = await import("../lib/croisement.js");

// Cosy 10 = 80082, Cosy 20 = 80083, Zen 62 = 567568, Deep 02 = 567560.
const resaHostaway = (o) => ({ status: "new", checkInTime: 15, checkOutTime: 11, ...o });
const RAW = [
  resaHostaway({ id: 1, guestName: "Client A", listingMapId: 567565, reservationUnit: [{ listingUnitId: 80082 }], arrivalDate: "2026-11-03", departureDate: "2026-11-05", doorCode: "4821", channelName: "booking" }),
  resaHostaway({ id: 2, guestName: "Annulé", listingMapId: 567565, reservationUnit: [{ listingUnitId: 80082 }], arrivalDate: "2026-11-05", departureDate: "2026-11-07", status: "cancelled", doorCode: "9999" }),
  resaHostaway({ id: 3, guestName: "Demande", listingMapId: 567568, arrivalDate: "2026-11-05", departureDate: "2026-11-07", status: "inquiry" }),
  resaHostaway({ id: 4, guestName: "Deep", listingMapId: 567560, arrivalDate: "2026-11-05", departureDate: "2026-11-07" }),
  resaHostaway({ id: 5, guestName: "Lantiez", listingMapId: 371952, arrivalDate: "2026-11-05", departureDate: "2026-11-07" }),
  resaHostaway({ id: 7, guestName: "Proprio", listingMapId: 567568, arrivalDate: "2026-11-08", departureDate: "2026-11-10", status: "ownerStay" }),
  resaHostaway({ id: 6, guestName: "Cosy sans unité", listingMapId: 567565, reservationUnit: [], arrivalDate: "2026-11-05", departureDate: "2026-11-06" }),
];
const RESAS = c.bellevilleReservations(RAW);
const DEVICES = [{ id: "IGL_COSY10", nom: "Cosy 10" }, { id: "IGL_ZEN", nom: "Zen 62" }, { id: "IGL_IGN", nom: "Test" }];
const MAPPING = { IGL_COSY10: { cible: "80082", valide: true }, IGL_ZEN: { cible: "567568", valide: true }, IGL_IGN: { cible: "ignorer", valide: true } };
const PERSONNEL = [{ nom: "Fatou", categorie: "Ménage", code: "777777" }];

// Novembre : Paris = UTC+1.
const ev = (iso, type = "UNLOCK", extra = {}) => ({ activityTimeAt: iso, activityType: type, description: "", ...extra });

function run(events, settings) {
  return c.classify({ devices: DEVICES, events, mapping: MAPPING, reservations: RESAS, personnel: PERSONNEL, settings });
}
const one = (deviceId, e, s) => { const rows = run({ [deviceId]: [e] }, s); assert.equal(rows.length, 1); return rows[0]; };

test("réservations : seules les confirmées de Belleville (hors Deep) sont gardées", () => {
  assert.deepEqual(RESAS.map(r => r.id), ["1"]);
  assert.deepEqual(RESAS[0].appartements, ["80082"]);
  assert.equal(RESAS[0].code, "4821");
  assert.deepEqual(c.unresolvedBelleville(RAW).map(r => r.id), ["6"]);
  assert.ok(!c.IGLOO_APARTMENTS.some(a => a.id === "567560"), "Deep exclu");
  assert.equal(c.IGLOO_APARTMENTS.length, 19);
});

test("heure de Paris et nuit", () => {
  assert.deepEqual(c.parisParts(Date.parse("2026-11-05T19:30:00Z")), { date: "2026-11-05", hour: 20, minute: 30, second: 0 });
  assert.deepEqual(c.parisParts(Date.parse("2026-07-05T17:30:00Z")).hour, 19, "heure d'été UTC+2");
  const s = c.DEFAULT_SETTINGS;
  assert.equal(c.nightOf({ date: "2026-11-05", hour: 19 }, s), "2026-11-05");
  assert.equal(c.nightOf({ date: "2026-11-06", hour: 7 }, s), "2026-11-05");
  assert.equal(c.nightOf({ date: "2026-11-06", hour: 8 }, s), null);
  assert.equal(c.nightOf({ date: "2026-11-06", hour: 18 }, s), null);
});

test("nuit couverte par une réservation : OK", () => {
  const r = one("IGL_COSY10", ev("2026-11-04T21:00:00Z")); // 22 h le 4, séjour du 3 au 5
  assert.equal(r.classe, "ok");
  assert.equal(r.reservation.id, "1");
  assert.equal(one("IGL_COSY10", ev("2026-11-03T18:00:00Z")).classe, "ok", "19 h le jour d'arrivée");
  assert.equal(one("IGL_COSY10", ev("2026-11-05T06:00:00Z")).classe, "ok", "7 h le matin du départ");
});

test("soir du départ, client parti : ALERTE dès 19 h", () => {
  const r = one("IGL_COSY10", ev("2026-11-05T19:00:00Z")); // 20 h le 5
  assert.equal(r.classe, "alerte");
  assert.equal(r.nuit, "2026-11-05");
  assert.equal(one("IGL_COSY10", ev("2026-11-05T18:00:00Z")).classe, "alerte", "19 h pile");
  assert.equal(one("IGL_COSY10", ev("2026-11-06T01:00:00Z")).classe, "alerte", "2 h du matin : nuit du 5");
  assert.equal(one("IGL_COSY10", ev("2026-11-06T06:59:00Z")).classe, "alerte", "7 h 59");
  assert.equal(one("IGL_COSY10", ev("2026-11-06T07:00:00Z")).classe, "jour-vide", "8 h : journée");
  assert.equal(one("IGL_COSY10", ev("2026-11-05T17:59:00Z")).classe, "jour-vide", "18 h 59 : journée");
});

test("réservation annulée, demande ou d'un autre appartement : ne couvre pas la nuit", () => {
  assert.equal(one("IGL_COSY10", ev("2026-11-06T20:00:00Z")).classe, "alerte", "résa annulée du 5 au 7");
  assert.equal(one("IGL_ZEN", ev("2026-11-05T20:00:00Z")).classe, "alerte", "simple demande sur Zen");
  assert.equal(one("IGL_ZEN", ev("2026-11-08T21:00:00Z")).classe, "alerte", "séjour propriétaire / appartement verrouillé : vérifié comme vide");
});

test("journée : séjour + marge = OK, sinon journée sans réservation (pas d'alerte)", () => {
  assert.equal(one("IGL_COSY10", ev("2026-11-05T11:30:00Z")).classe, "ok", "12 h 30 le jour du départ, marge 2 h");
  assert.equal(one("IGL_COSY10", ev("2026-11-05T13:30:00Z")).classe, "jour-vide", "14 h 30 le jour du départ");
  assert.equal(one("IGL_COSY10", ev("2026-11-05T13:30:00Z"), { margeH: 4 }).classe, "ok", "marge réglable");
});

test("intérieur : ignoré quand un client est là, ALERTE la nuit sans client ; verrouillage auto mis à part", () => {
  assert.equal(one("IGL_COSY10", ev("2026-11-04T20:00:00Z", "UNLOCK", { description: "Unlocked from inside" })).classe, "interieur", "nuit avec client");
  assert.equal(one("IGL_COSY10", ev("2026-11-05T10:00:00Z", "", { description: "Déverrouillé manuellement." })).classe, "interieur", "journée");
  // Textes vus dans l'app igloohome (PMR 01, 07/11/2026) :
  const manu = one("IGL_COSY10", ev("2026-11-05T18:29:00Z", "", { description: "Déverrouillé manuellement." }));
  assert.equal(manu.classe, "alerte", "19 h 29, aucun client : quelqu'un est dedans");
  assert.match(manu.motif, /intérieur/);
  assert.equal(one("IGL_COSY10", ev("2026-11-05T20:00:00Z", "", { description: "Verrouillage par bouton" })).classe, "alerte");
  assert.equal(one("IGL_COSY10", ev("2026-11-05T20:00:00Z", "", { description: "Verrouillage automatique après la fermeture." })).classe, "autre");
  const staff = one("IGL_COSY10", ev("2026-11-06T00:29:00Z", "", { description: "(staff) déverrouillé par le code Code PIN permanent ." }));
  assert.equal(staff.classe, "alerte", "1 h 29, code permanent du personnel, aucun client");
  assert.match(staff.motif, /code maître ou permanent/);
  assert.equal(one("IGL_COSY10", ev("2026-11-05T20:00:00Z", "LOCK")).classe, "autre");
  assert.equal(run({ IGL_IGN: [ev("2026-11-05T20:00:00Z")] }).length, 0);
});

test("personnel : classé à part le jour, mais ALERTE la nuit sans réservation", () => {
  const day = one("IGL_ZEN", ev("2026-11-05T10:00:00Z", "UNLOCK", { pinCode: "777777" }));
  assert.equal(day.classe, "personnel");
  assert.equal(day.personnel.nom, "Fatou");
  const night = one("IGL_ZEN", ev("2026-11-05T21:00:00Z", "UNLOCK", { pinCode: "777777" }));
  assert.equal(night.classe, "alerte");
  assert.match(night.motif, /Fatou/);
});

test("code d'une réservation utilisé hors de son séjour : ALERTE même en journée", () => {
  const r = one("IGL_COSY10", ev("2026-11-06T13:00:00Z", "UNLOCK", { pin: "4821" }));
  assert.equal(r.classe, "alerte");
  assert.match(r.motif, /Client A/);
  assert.equal(one("IGL_ZEN", ev("2026-11-04T13:00:00Z", "UNLOCK", { pin: "4821" })).classe, "alerte", "code de Cosy 10 sur Zen");
  assert.equal(one("IGL_COSY10", ev("2026-11-04T13:00:00Z", "UNLOCK", { pin: "4821" })).classe, "ok");
});

test("méthode d'ouverture signalée dans le motif", () => {
  assert.match(one("IGL_ZEN", ev("2026-11-05T21:00:00Z", "UNLOCK", { description: "Mechanical key" })).motif, /clé mécanique/);
  assert.match(one("IGL_ZEN", ev("2026-11-05T21:00:00Z", "UNLOCK", { description: "Master PIN" })).motif, /code maître/);
});

test("proposition de correspondance d'après les noms", () => {
  assert.deepEqual(c.suggestTarget("Cosy 20"), { cible: "80083", confiance: "sure", raison: "nom et numéro 20" });
  assert.equal(c.suggestTarget("Belleville - CONFORT 41").cible, "80090");
  assert.equal(c.suggestTarget("Élégance 60").confiance, "sure");
  assert.equal(c.suggestTarget("PMR 01").cible, "567572");
  assert.equal(c.suggestTarget("Porte 21").confiance, "a-verifier", "numéro seul");
  assert.equal(c.suggestTarget("Chic 21").confiance, "a-verifier", "Chic n'a pas de 21");
  assert.equal(c.suggestTarget("Zen").confiance, "a-verifier", "nom sans numéro");
  assert.equal(c.suggestTarget("Le Deep").confiance, "aucune", "Deep hors igloohome");
  assert.equal(c.suggestTarget("Entrée immeuble").cible, "commun");
  assert.equal(c.isBridgeDevice({ nom: "Étage 2", type: "Lock" }), true);
  assert.equal(c.isBridgeDevice({ nom: "Bridge 1er", type: "" }), true);
  assert.equal(c.isBridgeDevice({ nom: "Cosy 10", type: "Lock" }), false);
});

test("configuration : cibles connues seulement, pas deux serrures sur le même appartement", () => {
  const ok = c.sanitizeConfig({ mapping: { A: { cible: "80082", valide: true, nom: "Cosy 10" } }, personnel: [{ nom: "X", code: "1234" }], reglages: { heureDebut: 19, heureFin: 8, margeH: 2 } });
  assert.equal(ok.mapping.A.cible, "80082");
  assert.throws(() => c.sanitizeConfig({ mapping: { A: { cible: "567560" } } }), /inconnu/, "Deep refusé");
  assert.throws(() => c.sanitizeConfig({ mapping: { A: { cible: "371952" } } }), /inconnu/, "Lantiez refusé");
  assert.throws(() => c.sanitizeConfig({ mapping: { A: { cible: "80082" }, B: { cible: "80082" } } }), /deux serrures/);
  assert.throws(() => c.sanitizeConfig({ mapping: { "../x": { cible: "" } } }), /invalide/);
  assert.throws(() => c.sanitizeConfig({ personnel: [{ nom: "Sans code" }] }), /nom et un code/);
  assert.deepEqual(c.sanitizeConfig({ reglages: { heureDebut: 99 } }).reglages, c.DEFAULT_SETTINGS);
});

test("export CSV", () => {
  const rows = run({ IGL_COSY10: [ev("2026-11-05T19:00:00Z")] });
  const csv = c.toCsv(rows);
  assert.ok(csv.startsWith("﻿Date;Heure (Paris);Classe"));
  assert.match(csv, /2026-11-05;20:00;ALERTE;COSY 10;Cosy 10/);
});

// ---------- Visites hors réservation (mikhael, 13/11) ----------
// Résa 1 : Cosy 10 du 03/11 (15 h) au 05/11 (11 h). Novembre : Paris = UTC+1.
const V = (events, interpretations, settings) => c.visitesHorsReservation({ devices: DEVICES, events, mapping: MAPPING, reservations: RESAS, personnel: PERSONNEL, settings, interpretations });
const evIn = (iso) => ev(iso, "MANUAL_UNLOCK", { description: "Unlocked manually from inside" });

test("texte d'un événement réel : les identifiants aléatoires ne sont pas lus", () => {
  const e = { _id: "x", lockRef: "AutoOpenLock99", userRef: "unlock", keyId: "1", activityType: "BLUETOOTH_SET_TIME", description: "Unknown activity: BLUETOOTH_SET_TIME", extra: { description: "", unlockResult: [] }, pinType: "" };
  assert.equal(c.eventText(e), "BLUETOOTH_SET_TIME | Unknown activity: BLUETOOTH_SET_TIME");
  assert.equal(c.eventKind(e), null);
  assert.equal(c.eventKind(ev("2026-11-01T10:00:00Z", "CREATE_NEW_PIN_VIA_BLUETOOTH")), null);
});

test("visite : entrée puis sortie, durée calculée ; pendant la réservation rien n'apparaît", () => {
  const rows = V({ IGL_COSY10: [
    ev("2026-11-04T21:00:00Z"),                       // 22 h le 04, client présent : ignoré
    ev("2026-11-05T11:30:00Z"), evIn("2026-11-05T13:15:00Z"), // 12 h 30 → 14 h 15, après le départ de 11 h
  ] });
  assert.equal(rows.length, 1);
  const v = rows[0];
  assert.equal(v.date, "2026-11-05");
  assert.equal(v.entree, "12:30"); assert.equal(v.sortie, "14:15"); assert.equal(v.dureeMin, 105);
  assert.equal(v.nuit, false); assert.equal(v.classe, "jour");
  assert.match(v.interpretation, /1 h 45 dans l'appartement/);
  assert.match(v.precedent, /Client A, départ 05\/11 11 h/);
});

test("visite de nuit sans réservation : ALERTE, même si elle commence avant 19 h", () => {
  const rows = V({ IGL_ZEN: [ev("2026-11-06T17:30:00Z"), evIn("2026-11-06T18:40:00Z")] }); // 18 h 30 → 19 h 40
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nuit, true); assert.equal(rows[0].classe, "alerte");
});

test("heures d'arrivée 15 h et de départ 11 h : l'arrivée à 14 h est hors réservation", () => {
  const rows = V({ IGL_COSY10: [ev("2026-11-03T13:00:00Z"), ev("2026-11-03T15:00:00Z")] }); // 14 h et 16 h le 03
  assert.deepEqual(rows.map(r => r.entree), ["14:00"]);
});

test("sortie sans entrée et entrée sans sortie sont signalées", () => {
  const rows = V({ IGL_ZEN: [evIn("2026-11-07T01:00:00Z"), ev("2026-11-08T09:00:00Z")] });
  assert.equal(rows.length, 2);
  assert.match(rows.find(r => r.date === "2026-11-07").interpretation, /sans entrée enregistrée/);
  assert.match(rows.find(r => r.date === "2026-11-08").interpretation, /sortie non enregistrée/);
});

test("ouvertures répétées en quelques minutes : une seule visite", () => {
  const rows = V({ IGL_ZEN: [ev("2026-11-06T10:00:00Z"), ev("2026-11-06T10:02:00Z"), evIn("2026-11-06T10:40:00Z"), evIn("2026-11-06T10:45:00Z")] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dureeMin, 45);
});

test("interprétation validée par mikhael : remplace la proposition, la visite n'est plus « à confirmer »", () => {
  const e = ev("2026-11-06T22:00:00Z", "PIN_ACCESS");
  assert.equal(c.eventKind(e), null, "proposition : rien d'une ouverture");
  assert.equal(V({ IGL_ZEN: [e] }).length, 0);
  const interp = { PIN_ACCESS: { nature: "entree", valide: true } };
  const rows = V({ IGL_ZEN: [e] }, interp);
  assert.equal(rows.length, 1); assert.equal(rows[0].aConfirmer, false); assert.equal(rows[0].nuit, true);
  assert.equal(V({ IGL_ZEN: [ev("2026-11-06T22:00:00Z")] })[0].aConfirmer, true);
  const t = c.typesLus({ IGL_ZEN: [e, e, ev("2026-11-06T22:00:00Z")] }, interp);
  assert.deepEqual(t.map(x => [x.type, x.nombre, x.nature, x.valide]), [["UNLOCK", 1, "entree", false], ["PIN_ACCESS", 2, "entree", true]]);
});

test("configuration : interprétations nettoyées, réglages arrivée/départ", () => {
  const cfg = c.sanitizeConfig({ interpretations: { PIN_UNLOCK: { nature: "entree", valide: true } }, reglages: { heureArrivee: 16, heureDepart: 10 } });
  assert.deepEqual(cfg.interpretations, { PIN_UNLOCK: { nature: "entree", valide: true } });
  assert.equal(cfg.reglages.heureArrivee, 16); assert.equal(cfg.reglages.heureDepart, 10);
  assert.throws(() => c.sanitizeConfig({ interpretations: { X: { nature: "ouvrir" } } }), /inconnue/);
  assert.equal(c.sanitizeConfig({}).reglages.heureArrivee, 15);
});
