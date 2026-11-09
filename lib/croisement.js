// lib/croisement.js
// Croisement historique des serrures igloohome × réservations Hostaway (Belleville).
// Module ISOMORPHE et PUR (aucun appel réseau, aucune dépendance Node) : il tourne
// dans le navigateur de l'admin et dans les tests.
//
// Règle d'alerte (mikhael, 2026-11-09) :
//   une ouverture entre 19 h et 8 h le lendemain (heure de Paris), une nuit où aucune
//   réservation ne couvre l'appartement, est une ALERTE.
// Une nuit D est couverte par une réservation si arrivée <= D < départ
// (le client qui part le D laisse l'appartement vide le soir du D).
//
// Périmètre : Belleville uniquement, hors Deep 02 (serrure Nuki, pas igloohome).

import { APARTMENTS } from "./apartments";

export const DEFAULT_SETTINGS = { heureDebut: 19, heureFin: 8, margeH: 2 };

const NON_IGLOO = new Set(["567560"]); // Deep 02 : serrure Nuki

// Appartements concernés : Belleville sauf Deep.
export const IGLOO_APARTMENTS = Object.entries(APARTMENTS)
  .filter(([id, a]) => a.residence === "Belleville" && !NON_IGLOO.has(id))
  .map(([id, a]) => ({ id, nom: a.appartement, numero: a.unitNumber }))
  .sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));

const IGLOO_IDS = new Set(IGLOO_APARTMENTS.map(a => a.id));

export function apartmentName(id) {
  return APARTMENTS[String(id)]?.appartement || String(id);
}

// Cibles possibles d'une serrure dans la table de correspondance.
export const CIBLE_IGNORER = "ignorer";
export const CIBLE_COMMUN = "commun"; // porte commune de la résidence

// ---------- Dates et heures de Paris ----------

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

// Heure « murale » de Paris d'un instant, sous forme de parties.
export function parisParts(ms) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(ms))) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
  };
}

// Représente une heure murale de Paris par un nombre comparable (ms « comme si UTC »).
function wall(date, hour = 0, minute = 0, second = 0) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, hour, minute, second);
}

export function addDays(date, n) {
  const t = wall(date) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// Nuit à laquelle appartient une heure de Paris, ou null si c'est la journée.
// heureDebut 19, heureFin 8 : 20 h le 3 -> nuit du 3 ; 2 h le 4 -> nuit du 3 ; 10 h -> null.
export function nightOf(parts, { heureDebut, heureFin } = DEFAULT_SETTINGS) {
  if (parts.hour >= heureDebut) return parts.date;
  if (parts.hour < heureFin) return addDays(parts.date, -1);
  return null;
}

// ---------- Réservations ----------

// Appartements (ids de lib/apartments.js) occupés par une réservation Hostaway.
// Multi-unit (Cosy/Confort/Chic) : la sous-unité réelle est dans reservationUnit[].listingUnitId.
export function apartmentIdsOf(rv) {
  const ru = Array.isArray(rv.reservationUnit) ? rv.reservationUnit : [];
  const fromUnits = ru.map(u => String(u.listingUnitId)).filter(id => APARTMENTS[id]);
  if (fromUnits.length) return [...new Set(fromUnits)];
  const lid = String(rv.listingMapId ?? rv.listingId ?? "");
  return APARTMENTS[lid] ? [lid] : [];
}

const CONFIRMED = new Set(["new", "modified", "ownerstay"]);
export function isConfirmed(rv) {
  const s = String(rv.status || "").toLowerCase();
  return CONFIRMED.has(s) && rv.isCancelled !== true && !rv.cancellationDate;
}

function hourOr(v, def) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 23 ? n : def;
}

// Réservation Hostaway -> forme réduite utilisée par le croisement (et envoyée au navigateur).
export function slimReservation(rv) {
  return {
    id: String(rv.id),
    client: rv.guestName || [rv.guestFirstName, rv.guestLastName].filter(Boolean).join(" ") || "",
    canal: rv.channelName || rv.source || "",
    arrivee: String(rv.arrivalDate || "").slice(0, 10),
    depart: String(rv.departureDate || "").slice(0, 10),
    heureArrivee: hourOr(rv.checkInTime, 15),
    heureDepart: hourOr(rv.checkOutTime, 11),
    code: rv.doorCode != null && rv.doorCode !== "" ? String(rv.doorCode) : "",
    appartements: apartmentIdsOf(rv),
    statut: String(rv.status || ""),
  };
}

// Réservations confirmées de Belleville (hors Deep) qui touchent la période.
export function bellevilleReservations(raw) {
  return raw.filter(isConfirmed).map(slimReservation)
    .map(r => ({ ...r, appartements: r.appartements.filter(id => IGLOO_IDS.has(id)) }))
    .filter(r => r.appartements.length && r.arrivee && r.depart);
}

// Réservations confirmées dont l'appartement n'a pas pu être résolu (parent multi-unit
// sans sous-unité) : elles pourraient couvrir une nuit sans qu'on le sache.
export function unresolvedBelleville(raw) {
  const parents = new Set(["567563", "567565", "567567"]); // Chic, Cosy, Confort
  return raw.filter(isConfirmed).filter(rv => apartmentIdsOf(rv).length === 0
    && parents.has(String(rv.listingMapId ?? rv.listingId ?? ""))).map(slimReservation);
}

function covering(resas, aptId, night) {
  return resas.find(r => r.appartements.includes(aptId) && r.arrivee <= night && night < r.depart) || null;
}

function inStayWindow(r, w, margeH) {
  const start = wall(r.arrivee, r.heureArrivee) - margeH * 3600000;
  const end = wall(r.depart, r.heureDepart) + margeH * 3600000;
  return w >= start && w <= end;
}

// ---------- Lecture d'un événement igloohome (champs exacts non garantis) ----------

const TIME_KEYS = ["activityTimeAt", "activityTime", "timestamp", "time", "createdAt"];
export function eventMs(e) {
  for (const k of TIME_KEYS) {
    const v = e?.[k];
    if (v === undefined || v === null || v === "") continue;
    const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function strings(obj, depth = 0, out = []) {
  if (obj === null || obj === undefined || depth > 2) return out;
  if (typeof obj === "string" || typeof obj === "number") { out.push(String(obj)); return out; }
  if (typeof obj === "object") for (const [k, v] of Object.entries(obj)) {
    if (TIME_KEYS.includes(k)) continue;
    strings(v, depth + 1, out);
  }
  return out;
}

export function eventText(e) {
  return strings(e).join(" | ");
}

const OPENING = /unlock|open|ouvert|d[ée]verrouill/i;
const INTERIOR = /inside|interior|int[ée]rieur|indoor|knob|thumb|bouton|button/i;
const MECHANICAL = /mechanical|m[ée]canique|physical key|cl[ée] physique/i;
const MASTER = /master|ma[iî]tre|permanent/i;

export function isOpening(e) { return OPENING.test(eventText(e)); }
export function isInterior(e) { return INTERIOR.test(eventText(e)); }

// Codes possibles portés par l'événement : champs nommés pin/code/… et nombres de 4 à 10
// chiffres dans la description.
export function eventCodes(e) {
  const out = new Set();
  const walk = (obj, depth) => {
    if (!obj || typeof obj !== "object" || depth > 2) return;
    for (const [k, v] of Object.entries(obj)) {
      if ((typeof v === "string" || typeof v === "number") && /pin|code|passcode|ekey|keyid|user|name/i.test(k) && !/device|lock/i.test(k)) {
        const s = String(v).trim();
        if (s) out.add(s);
      } else if (v && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(e, 0);
  for (const m of String(e?.description || "").matchAll(/\b\d{4,10}\b/g)) out.add(m[0]);
  return [...out];
}

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Code du personnel reconnu dans l'événement : valeur exacte d'un champ, ou nom présent dans le texte.
export function matchStaff(e, personnel = []) {
  const codes = eventCodes(e).map(norm);
  const text = norm(eventText(e));
  return personnel.find(p => {
    const c = norm(p.code);
    if (!c) return false;
    return codes.includes(c) || (c.length >= 4 && text.includes(c));
  }) || null;
}

// ---------- Classement ----------

export const CLASSES = {
  alerte: "ALERTE",
  ok: "OK",
  personnel: "Personnel",
  "jour-vide": "Journée sans réservation",
  interieur: "Depuis l'intérieur",
  autre: "Autre événement",
};

// devices : [{ id, nom }] ; events : { [deviceId]: [événements bruts] } ;
// mapping : { [deviceId]: { cible } } ; reservations : bellevilleReservations(...)
export function classify({ devices, events, mapping, reservations, personnel = [], settings = {} }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const rows = [];
  for (const d of devices) {
    const cible = mapping?.[d.id]?.cible;
    if (!cible || cible === CIBLE_IGNORER) continue;
    for (const e of events[d.id] || []) {
      const ms = eventMs(e);
      if (ms === null) continue;
      const p = parisParts(ms);
      const w = wall(p.date, p.hour, p.minute, p.second);
      const night = nightOf(p, s);
      const text = eventText(e);
      const row = {
        ms, date: p.date, heure: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`,
        deviceId: d.id, serrure: d.nom || d.id,
        appartementId: cible, appartement: cible === CIBLE_COMMUN ? "Porte commune" : apartmentName(cible),
        type: String(e.activityType ?? e.type ?? ""), description: String(e.description ?? ""),
        nuit: night, classe: "", motif: "", reservation: null, personnel: null, brut: e,
      };
      const aptIds = cible === CIBLE_COMMUN ? null : [cible];
      const occupant = night
        ? (aptIds ? covering(reservations, cible, night) : reservations.find(r => r.arrivee <= night && night < r.depart) || null)
        : reservations.find(r => (!aptIds || r.appartements.includes(cible)) && inStayWindow(r, w, s.margeH)) || null;
      const staff = matchStaff(e, personnel);
      const codes = eventCodes(e);
      const byCode = codes.length ? reservations.find(r => r.code && codes.includes(r.code)) || null : null;

      if (!OPENING.test(text)) { row.classe = "autre"; }
      else if (INTERIOR.test(text)) { row.classe = "interieur"; }
      else if (byCode && aptIds && (!byCode.appartements.includes(cible) || (night ? !(byCode.arrivee <= night && night < byCode.depart) : !inStayWindow(byCode, w, s.margeH)))) {
        row.classe = "alerte"; row.reservation = byCode;
        row.motif = `Code de la réservation de ${byCode.client || byCode.id} (${byCode.arrivee} → ${byCode.depart}), utilisé hors de son séjour ou sur une autre porte`;
      } else if (night && !occupant) {
        row.classe = "alerte"; row.personnel = staff;
        const methode = MECHANICAL.test(text) ? " par clé mécanique" : MASTER.test(text) ? " par code maître ou permanent" : "";
        row.motif = `Ouverture${methode} la nuit du ${night} (${String(s.heureDebut)} h → ${String(s.heureFin)} h), aucune réservation`
          + (staff ? ` · code du personnel : ${staff.nom}` : "");
      } else if (night) {
        row.classe = "ok"; row.reservation = byCode || occupant;
        row.motif = byCode ? "Code de la réservation en cours" : "Nuit couverte par une réservation";
      } else if (staff) {
        row.classe = "personnel"; row.personnel = staff; row.reservation = occupant;
        row.motif = `${staff.nom}${staff.categorie ? ` (${staff.categorie})` : ""}`;
      } else if (occupant) {
        row.classe = "ok"; row.reservation = byCode || occupant;
        row.motif = byCode ? "Code de la réservation en cours" : `Pendant le séjour (marge ${s.margeH} h)`;
      } else {
        row.classe = "jour-vide";
        row.motif = "Journée, aucune réservation (ménage, maintenance ?)";
      }
      rows.push(row);
    }
  }
  return rows.sort((a, b) => b.ms - a.ms);
}

// ---------- Proposition de correspondance serrure -> appartement ----------

const FLOOR = /[ée]tage|floor|\bbridge\b|\brdc\b|rez/i;

export function isBridgeDevice(d) {
  return Boolean(d.estUnBridge) || /bridge|gateway/i.test(String(d.type || "")) || FLOOR.test(String(d.nom || ""));
}

const CATS = [
  { re: /cosy/, nums: ["10", "20", "30", "40", "50"] },
  { re: /confort|comfort/, nums: ["11", "21", "31", "41", "51"] },
  { re: /chic/, nums: ["12", "22", "32", "42", "52"] },
];

// Renvoie { cible, confiance: "sure" | "a-verifier" | "aucune", raison }.
// Ne décide jamais seule : l'admin valide chaque ligne.
export function suggestTarget(nomSerrure) {
  const n = norm(nomSerrure);
  const nums = [...n.matchAll(/\d+/g)].map(m => m[0]);
  const byNum = num => IGLOO_APARTMENTS.filter(a => a.numero === num || a.numero === num.padStart(2, "0"));
  const cat = CATS.find(c => c.re.test(n));
  const named = IGLOO_APARTMENTS.filter(a => {
    const word = norm(a.nom).replace(/\d+/g, "").trim();
    return word && n.includes(word);
  });

  for (const num of nums) {
    const hits = byNum(num);
    if (hits.length === 1) {
      const a = hits[0];
      const word = norm(a.nom).replace(/\d+/g, "").trim();
      const consistent = !cat || cat.nums.includes(a.numero);
      if (consistent && (n.includes(word) || named.length === 0)) {
        return { cible: a.id, confiance: n.includes(word) ? "sure" : "a-verifier", raison: n.includes(word) ? `nom et numéro ${a.numero}` : `numéro ${a.numero} seul` };
      }
      return { cible: a.id, confiance: "a-verifier", raison: `numéro ${a.numero}, mais le nom ne correspond pas` };
    }
  }
  if (named.length === 1) return { cible: named[0].id, confiance: "a-verifier", raison: "nom seul, sans numéro" };
  if (/entr[ée]e|porte|hall|commun|main|immeuble/.test(n)) return { cible: CIBLE_COMMUN, confiance: "a-verifier", raison: "ressemble à une porte commune" };
  return { cible: "", confiance: "aucune", raison: named.length > 1 ? "plusieurs appartements possibles" : "aucun appartement reconnu" };
}

// ---------- Export ----------

export function toCsv(rows) {
  const head = ["Date", "Heure (Paris)", "Classe", "Appartement", "Serrure", "Type", "Description", "Motif", "Réservation", "Client", "Personnel"];
  const esc = v => {
    const s = String(v ?? "");
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map(r => [
    r.date, r.heure, CLASSES[r.classe] || r.classe, r.appartement, r.serrure, r.type, r.description, r.motif,
    r.reservation ? `${r.reservation.id} (${r.reservation.arrivee} → ${r.reservation.depart})` : "",
    r.reservation?.client || "", r.personnel?.nom || "",
  ].map(esc).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n");
}

// ---------- Configuration enregistrée (validée côté serveur avant écriture) ----------

export function emptyConfig() {
  return { mapping: {}, personnel: [], reglages: { ...DEFAULT_SETTINGS } };
}

function clampInt(v, min, max, def) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

// Nettoie une configuration reçue : seules des cibles connues, des textes courts,
// des heures plausibles. Lève une erreur lisible si quelque chose ne va pas.
export function sanitizeConfig(input) {
  const out = emptyConfig();
  const src = input && typeof input === "object" ? input : {};
  const mapping = src.mapping && typeof src.mapping === "object" ? src.mapping : {};
  const keys = Object.keys(mapping);
  if (keys.length > 200) throw new Error("Trop de serrures.");
  const used = new Map();
  for (const id of keys) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Identifiant de serrure invalide : ${id}`);
    const m = mapping[id] || {};
    const cible = String(m.cible || "");
    if (cible && cible !== CIBLE_IGNORER && cible !== CIBLE_COMMUN && !IGLOO_IDS.has(cible)) {
      throw new Error(`Appartement inconnu pour la serrure ${id} : ${cible}`);
    }
    if (IGLOO_IDS.has(cible)) {
      if (used.has(cible)) throw new Error(`${apartmentName(cible)} est attribué à deux serrures (${used.get(cible)} et ${id}).`);
      used.set(cible, id);
    }
    out.mapping[id] = { cible, nom: String(m.nom || "").slice(0, 80), valide: m.valide === true };
  }
  const pers = Array.isArray(src.personnel) ? src.personnel : [];
  if (pers.length > 100) throw new Error("Trop de codes du personnel.");
  out.personnel = pers
    .map(p => ({ nom: String(p?.nom || "").trim().slice(0, 60), categorie: String(p?.categorie || "").trim().slice(0, 30), code: String(p?.code || "").trim().slice(0, 40) }))
    .filter(p => p.nom || p.code);
  for (const p of out.personnel) if (!p.nom || !p.code) throw new Error("Chaque code du personnel doit avoir un nom et un code.");
  const r = src.reglages || {};
  out.reglages = {
    heureDebut: clampInt(r.heureDebut, 12, 23, DEFAULT_SETTINGS.heureDebut),
    heureFin: clampInt(r.heureFin, 0, 12, DEFAULT_SETTINGS.heureFin),
    margeH: clampInt(r.margeH, 0, 12, DEFAULT_SETTINGS.margeH),
  };
  return out;
}
