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

// heureArrivee / heureDepart : heures d'arrivée (15 h) et de départ (11 h) de toutes les
// réservations (mikhael, 2026-11-13). Entre le départ de 11 h et l'arrivée de 15 h,
// l'appartement est sans réservation.
export const DEFAULT_SETTINGS = { heureDebut: 19, heureFin: 8, margeH: 2, heureArrivee: 15, heureDepart: 11 };

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

// Seules les réservations de CLIENTS couvrent un appartement. Un séjour propriétaire
// (ownerStay) ou un blocage de calendrier (« verrouillé ») ne le couvre pas : l'appartement
// est vérifié comme s'il était vide (mikhael, 2026-11-09).
const CONFIRMED = new Set(["new", "modified"]);
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

// Historique réel (13/11) : activityType en code anglais (ex. CREATE_NEW_PIN_VIA_BLUETOOTH),
// description « Unknown activity: … », extra.description, pinType. Les autres champs sont
// des identifiants aléatoires (_id, lockRef, userRef, keyId) qui pourraient contenir
// « open » ou « auto » par hasard : on ne les lit pas.
export function eventText(e) {
  if (e && typeof e === "object" && e.activityType !== undefined) {
    const x = e.extra && typeof e.extra === "object" ? e.extra : {};
    const res = Array.isArray(x.unlockResult) ? x.unlockResult : [x.unlockResult];
    return [e.activityType, e.description, x.description, e.pinType, ...res]
      .filter(v => typeof v === "string" && v.trim()).join(" | ");
  }
  return strings(e).join(" | ");
}

const OPENING = /unlock|open|ouvert|d[ée]verrouill/i;
const INTERIOR = /inside|interior|int[ée]rieur|indoor|knob|thumb|bouton|button|manual|manuel/i;
// Verrouillage automatique : conséquence d'une fermeture, jamais une action d'une personne.
const AUTO = /auto/i;
// Action manuelle sur la serrure sans ouverture (ex. « Verrouillage par bouton ») :
// quelqu'un était là.
const MANUAL_LOCK = /\block|verrouill/i;
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

      const opening = OPENING.test(text);
      const interior = INTERIOR.test(text);
      // « Serrure activée » (mikhael) : toute action d'une personne sur la serrure, ouverture
      // par code, de l'intérieur (manuelle, bouton) ou verrouillage au bouton.
      const humain = !AUTO.test(text) && (opening || (interior && MANUAL_LOCK.test(text)));
      if (!humain) { row.classe = "autre"; }
      else if (night && !occupant) {
        row.classe = "alerte"; row.personnel = staff;
        const methode = MECHANICAL.test(text) ? " par clé mécanique"
          : MASTER.test(text) ? " par code maître ou permanent"
          : interior ? " depuis l'intérieur (quelqu'un est dans l'appartement)" : "";
        row.motif = `Serrure activée${methode} la nuit du ${night} (${String(s.heureDebut)} h → ${String(s.heureFin)} h), aucun client`
          + (staff ? ` · code du personnel : ${staff.nom}` : "");
      }
      else if (interior) { row.classe = "interieur"; }
      else if (byCode && aptIds && (!byCode.appartements.includes(cible) || (night ? !(byCode.arrivee <= night && night < byCode.depart) : !inStayWindow(byCode, w, s.margeH)))) {
        row.classe = "alerte"; row.reservation = byCode;
        row.motif = `Code de la réservation de ${byCode.client || byCode.id} (${byCode.arrivee} → ${byCode.depart}), utilisé hors de son séjour ou sur une autre porte`;
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

// ---------- Visites hors réservation (mikhael, 2026-11-13) ----------
//
// mikhael ne veut voir QUE ce qui se passe quand l'appartement n'a pas de réservation de
// client, interprété en visites : entrée, sortie, temps passé dans l'appartement.
// Une réservation occupe l'appartement de l'arrivée (15 h) au départ (11 h), heures réglables.
// Une visite qui touche la plage d'alerte (19 h → 8 h, réglable) est une ALERTE ; en journée,
// c'est une information (ménage, maintenance…).

// Nature d'un événement pour l'interprétation :
//   entree   : ouverture depuis l'extérieur (code, application, carte, clé) ;
//   sortie   : ouverture depuis l'intérieur ;
//   presence : verrouillage à la main ou au bouton (quelqu'un était à la porte) ;
//   ignorer  : système (verrouillage automatique, réglage d'heure, création de code…).
// mikhael valide ou corrige l'interprétation de chaque type d'action (config.interpretations) ;
// tant qu'un type n'est pas validé, la proposition automatique s'applique et la visite est
// marquée « à confirmer ».
export const NATURES = {
  entree: "Entrée (ouverture depuis l'extérieur)",
  sortie: "Sortie (ouverture depuis l'intérieur)",
  presence: "Présence (verrouillage à la main)",
  ignorer: "Système, ignoré",
};

export function eventType(e) {
  return String(e?.activityType ?? e?.type ?? "").trim() || "?";
}

export function proposeNature(e) {
  const text = eventText(e);
  if (AUTO.test(text)) return "ignorer";
  const opening = OPENING.test(text);
  const interior = INTERIOR.test(text);
  if (opening) return interior ? "sortie" : "entree";
  if (interior && MANUAL_LOCK.test(text)) return "presence";
  return "ignorer";
}

// Nature retenue : celle validée par mikhael, sinon la proposition. null = ignoré.
export function eventKind(e, interpretations = {}) {
  const v = interpretations?.[eventType(e)];
  const n = v && v.valide && NATURES[v.nature] ? v.nature : proposeNature(e);
  return n === "ignorer" ? null : n;
}

export function isValidated(e, interpretations = {}) {
  const v = interpretations?.[eventType(e)];
  return Boolean(v && v.valide && NATURES[v.nature]);
}

// Écarts admis entre deux événements d'une même visite.
const REPRISE_ENTREE = 5 * 60000;   // 2e ouverture par code dans les 5 min : même entrée
const REPRISE_SORTIE = 15 * 60000;  // allers-retours dans les 15 min après une sortie : même sortie
const VISITE_MAX = 24 * 3600000;    // au-delà, une sortie n'est plus rattachée à l'entrée

// Intervalles occupés (heure murale de Paris) d'un appartement.
function stays(reservations, aptId, s) {
  return reservations.filter(r => r.appartements.includes(aptId))
    .map(r => ({ r, start: wall(r.arrivee, s.heureArrivee), end: wall(r.depart, s.heureDepart) }))
    .filter(x => x.end > x.start)
    .sort((a, b) => a.start - b.start);
}

function hhmm(p) {
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function inAlertWindow(ms, s) {
  return nightOf(parisParts(ms), s) !== null;
}

export function dureeTexte(min) {
  if (min === null || min === undefined) return "";
  if (min < 1) return "moins d'1 min";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

function wallDateTime(w) {
  const d = new Date(w).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 13)} h`;
}

// devices : [{ id, nom }] ; events : { [deviceId]: [événements bruts] } ; mapping ; reservations
// (bellevilleReservations) ; personnel ; settings. Renvoie les visites hors réservation,
// les plus récentes d'abord.
export function visitesHorsReservation({ devices, events, mapping, reservations, personnel = [], settings = {}, interpretations = {} }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const out = [];
  for (const d of devices) {
    const cible = mapping?.[d.id]?.cible;
    if (!cible || !IGLOO_IDS.has(String(cible))) continue; // appartements seulement
    const sejours = stays(reservations, cible, s);
    const evs = (events[d.id] || [])
      .map(e => ({ e, ms: eventMs(e), kind: eventKind(e, interpretations) }))
      .filter(x => x.ms !== null && x.kind)
      .sort((a, b) => a.ms - b.ms);

    const visites = [];
    let cur = null;
    const open = (x) => { cur = { entree: x.kind === "entree" ? x : null, sortie: x.kind === "sortie" ? x : null, evs: [x] }; visites.push(cur); };
    for (const x of evs) {
      const last = cur ? cur.evs[cur.evs.length - 1].ms : -Infinity;
      if (x.kind === "entree") {
        if (cur && !cur.sortie && x.ms - last <= REPRISE_ENTREE && cur.entree) cur.evs.push(x);
        else if (cur && cur.sortie && x.ms - cur.sortie.ms <= REPRISE_SORTIE) cur.evs.push(x); // aller-retour
        else open(x);
      } else if (x.kind === "sortie") {
        if (cur && cur.sortie && x.ms - cur.sortie.ms <= REPRISE_SORTIE) { cur.sortie = x; cur.evs.push(x); }
        else if (cur && !cur.sortie && x.ms - last <= VISITE_MAX) { cur.sortie = x; cur.evs.push(x); }
        else open(x);
      } else { // presence
        if (cur && x.ms - last <= (cur.sortie ? REPRISE_SORTIE : VISITE_MAX)) cur.evs.push(x);
        else open(x);
      }
    }

    for (const v of visites) {
      const first = v.evs[0].ms, lastMs = v.evs[v.evs.length - 1].ms;
      const debut = v.entree ? v.entree.ms : first;
      const pd = parisParts(debut);
      const wd = wall(pd.date, pd.hour, pd.minute, pd.second);
      if (sejours.some(x => wd >= x.start && wd < x.end)) continue; // pendant une réservation
      const avant = [...sejours].reverse().find(x => x.end <= wd) || null;
      const apres = sejours.find(x => x.start > wd) || null;
      const fin = v.sortie ? v.sortie.ms : lastMs;
      const nuit = v.evs.some(x => inAlertWindow(x.ms, s));
      const staff = v.evs.map(x => matchStaff(x.e, personnel)).find(Boolean) || null;
      const codes = v.evs.flatMap(x => eventCodes(x.e));
      const resaCode = codes.length ? reservations.find(r => r.code && codes.includes(r.code)) || null : null;

      const parts = [];
      if (v.entree && v.sortie) parts.push(`Entrée à ${hhmm(pd)}, sortie à ${hhmm(parisParts(v.sortie.ms))} : ${dureeTexte((v.sortie.ms - v.entree.ms) / 60000)} dans l'appartement`);
      else if (v.entree) parts.push(`Entrée à ${hhmm(pd)}, sortie non enregistrée par la serrure`);
      else if (v.sortie) parts.push(`Sortie à ${hhmm(pd)} sans entrée enregistrée : quelqu'un était déjà dans l'appartement`);
      else parts.push(`Action sur la serrure à ${hhmm(pd)} (verrouillage manuel) : quelqu'un était à la porte`);
      if (!v.entree && avant && wd - avant.end <= 3 * 3600000) parts.push(`probablement le client sortant (départ prévu à ${s.heureDepart} h)`);
      if (staff) parts.push(`code du personnel : ${staff.nom}`);
      if (resaCode) parts.push(`code de la réservation de ${resaCode.client || resaCode.id} (${resaCode.arrivee} → ${resaCode.depart})`);

      out.push({
        ms: debut, date: pd.date, nuit,
        classe: nuit ? "alerte" : "jour",
        appartementId: cible, appartement: apartmentName(cible), serrure: d.nom || d.id, deviceId: d.id,
        entree: v.entree ? hhmm(pd) : "", sortie: v.sortie ? hhmm(parisParts(v.sortie.ms)) : "",
        dateSortie: v.sortie ? parisParts(v.sortie.ms).date : "",
        dureeMin: v.entree && v.sortie ? Math.round((v.sortie.ms - v.entree.ms) / 60000) : null,
        finMs: fin,
        // Clé stable d'une visite (décision « Normal / À vérifier » mémorisée).
        cle: `${d.id}:${debut}`,
        // Frise : période vide (heures murales de Paris, ms « comme si UTC ») et visite.
        videDebut: avant ? avant.end : null,
        videFin: apres ? apres.start : null,
        debutWall: wd,
        finWall: (() => { const p = parisParts(fin); return wall(p.date, p.hour, p.minute, p.second); })(),
        aConfirmer: v.evs.some(x => !isValidated(x.e, interpretations)),
        interpretation: parts.join(" · "),
        personnel: staff, reservationCode: resaCode,
        precedent: avant ? `${avant.r.client || avant.r.id}, départ ${wallDateTime(avant.end)}` : "",
        suivant: apres ? `${apres.r.client || apres.r.id}, arrivée ${wallDateTime(apres.start)}` : "",
        evenements: v.evs.map(x => { const p = parisParts(x.ms); return { date: p.date, heure: hhmm(p), nature: x.kind, type: String(x.e.activityType ?? x.e.type ?? ""), brut: x.e }; }),
      });
    }
  }
  return out.sort((a, b) => b.ms - a.ms);
}

// Libellé en français d'un type d'action igloohome (codes anglais non documentés).
const LIBELLES = {
  BLUETOOTH_SET_TIME: "Réglage de l'heure (Bluetooth)",
  CREATE_NEW_PIN_VIA_BLUETOOTH: "Création d'un code PIN (Bluetooth)",
};
const QUALIF = [
  [/PIN|PASSCODE|CODE/, "par code"], [/BLUETOOTH|BLE/, "par Bluetooth"], [/REMOTE|GATEWAY|BRIDGE|APP/, "à distance"],
  [/CARD|RFID/, "par carte"], [/FINGER/, "par empreinte"], [/MECHANICAL|PHYSICAL/, "par clé mécanique"],
  [/EKEY|E_KEY/, "par clé électronique"], [/MANUAL|THUMB|KNOB/, "manuel"], [/BUTTON/, "au bouton"],
  [/INSIDE|INTERIOR|INDOOR/, "depuis l'intérieur"], [/AUTO/, "automatique"],
];
export function libelleType(type) {
  const t = String(type || "").toUpperCase();
  if (LIBELLES[t]) return LIBELLES[t];
  const base = /UNLOCK|OPEN/.test(t) ? "Ouverture" : /LOCK/.test(t) ? "Verrouillage" : null;
  if (!base) return t ? t.toLowerCase().replace(/_/g, " ").replace(/^./, c => c.toUpperCase()) : "Type inconnu";
  const q = QUALIF.filter(([re]) => re.test(t)).map(([, l]) => l);
  return [base, ...q].join(" ").replace("Ouverture manuel", "Ouverture manuelle");
}

// Types d'action lus, avec la proposition et l'interprétation retenue, pour validation.
export function typesLus(events, interpretations = {}) {
  const c = {};
  for (const list of Object.values(events || {})) for (const e of list || []) {
    const t = eventType(e);
    if (!c[t]) {
      const v = interpretations?.[t];
      const proposition = proposeNature(e);
      c[t] = { type: t, libelle: libelleType(t), nombre: 0, proposition, nature: v && NATURES[v.nature] ? v.nature : proposition, valide: Boolean(v && v.valide && NATURES[v.nature]), exemple: eventText(e) };
    }
    c[t].nombre++;
  }
  return Object.values(c).sort((a, b) => Number(a.valide) - Number(b.valide) || b.nombre - a.nombre);
}

export function visitesCsv(rows) {
  const head = ["Date", "Appartement", "Serrure", "Entrée", "Sortie", "Durée", "Plage", "Interprétation", "Réservation précédente", "Réservation suivante"];
  const esc = v => { const t = String(v ?? ""); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const lines = rows.map(r => [r.date, r.appartement, r.serrure, r.entree, r.sortie, dureeTexte(r.dureeMin), r.nuit ? "ALERTE (nuit)" : "Journée",
    r.interpretation, r.precedent, r.suivant].map(esc).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\r\n");
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
  return { mapping: {}, personnel: [], reglages: { ...DEFAULT_SETTINGS }, interpretations: {} };
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
    heureArrivee: clampInt(r.heureArrivee, 10, 23, DEFAULT_SETTINGS.heureArrivee),
    heureDepart: clampInt(r.heureDepart, 6, 14, DEFAULT_SETTINGS.heureDepart),
  };
  const interp = src.interpretations && typeof src.interpretations === "object" ? src.interpretations : {};
  const types = Object.keys(interp);
  if (types.length > 300) throw new Error("Trop de types d'action.");
  for (const t of types) {
    if (!/^[A-Za-z0-9_ .:-]{1,80}$/.test(t)) throw new Error(`Type d'action invalide : ${t}`);
    const v = interp[t] || {};
    if (!NATURES[v.nature]) throw new Error(`Interprétation inconnue pour ${t}.`);
    out.interpretations[t] = { nature: v.nature, valide: v.valide === true };
  }
  return out;
}

// ---------- Suivi : décisions sur les visites et dernier résultat (stockage chiffré) ----------

export const DECISIONS = { normal: "Normal", "a-verifier": "À vérifier" };
const CLE = /^[A-Za-z0-9_-]{1,64}:\d{10,14}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n) => String(v ?? "").slice(0, n);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

export function emptySuivi() {
  return { decisions: {}, dernier: null };
}

// Une décision : { statut: "normal" | "a-verifier", note, le } ; statut vide = effacer.
export function applyDecision(suivi, { cle, statut, note }) {
  if (!CLE.test(String(cle || ""))) throw new Error("Visite inconnue.");
  const out = { ...suivi, decisions: { ...(suivi.decisions || {}) } };
  if (!statut) { delete out.decisions[cle]; return out; }
  if (!DECISIONS[statut]) throw new Error("Décision inconnue.");
  out.decisions[cle] = { statut, note: str(note, 300).trim(), le: new Date().toISOString() };
  if (Object.keys(out.decisions).length > 5000) throw new Error("Trop de décisions enregistrées.");
  return out;
}

// Dernier résultat gardé : visites et résumés seulement. Jamais d'événement brut (le code
// PIN y figure en clair).
export function slimResultat(r) {
  if (!r || typeof r !== "object") return null;
  if (!DAY_RE.test(String(r.from)) || !DAY_RE.test(String(r.to))) throw new Error("Période invalide.");
  const visites = (Array.isArray(r.visites) ? r.visites : []).slice(0, 3000).map(v => ({
    cle: str(v.cle, 90), ms: num(v.ms), date: str(v.date, 10), nuit: v.nuit === true, classe: v.nuit === true ? "alerte" : "jour",
    appartementId: str(v.appartementId, 20), appartement: str(v.appartement, 60), serrure: str(v.serrure, 80), deviceId: str(v.deviceId, 64),
    entree: str(v.entree, 5), sortie: str(v.sortie, 5), dateSortie: str(v.dateSortie, 10), dureeMin: num(v.dureeMin),
    videDebut: num(v.videDebut), videFin: num(v.videFin), debutWall: num(v.debutWall), finWall: num(v.finWall),
    aConfirmer: v.aConfirmer === true, interpretation: str(v.interpretation, 400), precedent: str(v.precedent, 120), suivant: str(v.suivant, 120),
    evenements: (Array.isArray(v.evenements) ? v.evenements : []).slice(0, 60).map(x => ({ date: str(x.date, 10), heure: str(x.heure, 5), nature: str(x.nature, 12), type: str(x.type, 80) })),
  }));
  const types = (Array.isArray(r.types) ? r.types : []).slice(0, 300).map(t => ({
    type: str(t.type, 80), libelle: str(t.libelle, 120), nombre: num(t.nombre) || 0, proposition: str(t.proposition, 12), exemple: str(t.exemple, 200),
  }));
  const profondeur = (Array.isArray(r.profondeur) ? r.profondeur : []).slice(0, 200).map(p => ({
    id: str(p.id, 64), nom: str(p.nom, 80), plusAncien: p.plusAncien ? str(p.plusAncien, 30) : null, complet: p.complet === true, debutAtteint: p.debutAtteint === true, nb: num(p.nb) || 0,
  }));
  return {
    from: r.from, to: r.to, lueLe: str(r.lueLe, 30), nbSerrures: num(r.nbSerrures) || 0, nbResas: num(r.nbResas) || 0,
    incidents: (Array.isArray(r.incidents) ? r.incidents : []).slice(0, 100).map(t => str(t, 300)),
    nonResolues: (Array.isArray(r.nonResolues) ? r.nonResolues : []).slice(0, 100).map(x => ({ id: str(x.id, 20), client: str(x.client, 80), arrivee: str(x.arrivee, 10), depart: str(x.depart, 10) })),
    interpretationsAuCalcul: str(r.interpretationsAuCalcul, 20000),
    visites, types, profondeur,
  };
}
