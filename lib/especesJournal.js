// lib/especesJournal.js
// SERVEUR UNIQUEMENT. Gestion des espèces : toutes les écritures passent ici, avec un
// journal d'audit chaîné.
//
// Pourquoi : avant, le navigateur écrivait et effaçait directement dans Firestore, sans
// trace. Une ligne effacée disparaissait sans laisser de preuve (voir le dossier
// « contentieux-especes »). Désormais :
//   - le navigateur ne fait plus que LIRE ; chaque création, suppression, récupération
//     passe par /api/especes, qui écrit avec le compte de service ;
//   - chaque écriture ajoute, DANS LA MÊME TRANSACTION, un événement au journal
//     « cash_audit » : horodatage serveur, auteur vérifié (code personnel ou session
//     admin), adresse IP, navigateur, état avant, état après, motif ;
//   - les événements sont chaînés : chacun contient l'empreinte SHA-256 du précédent.
//     Effacer ou retoucher un événement casse la chaîne, ce que verifierJournal() signale ;
//   - rien n'est jamais effacé : une suppression marque la ligne « deleted » (avec la
//     date, l'auteur et le motif) ;
//   - verifierJournal() compare aussi la base au journal : une ligne créée, modifiée ou
//     effacée en contournant l'application (base encore ouverte) est signalée.
//
// Limite assumée : quelqu'un qui détient le compte de service (ou la console Google)
// peut réécrire toute la chaîne d'un coup. Pour s'en prémunir, communiquer régulièrement
// l'empreinte de tête hors de l'application (mail, impression) : une chaîne réécrite
// n'aurait plus la même empreinte.

import crypto from "crypto";
import { jetonGoogle, projetFirestore, isStoreConfigured, readDoc, writeDoc, StoreError } from "./adminStore";
import { hashPassword, verifyPassword } from "./adminAuth";

export const C_ENTREES = "cash_entries";
export const C_RECUPS = "cash_recoveries";
export const C_JOURNAL = "cash_audit";
export const C_TETE = "cash_audit_meta";
const ID_TETE = "tete";
const DOC_PERSONNEL = "especes_personnel";
const ZERO = "0".repeat(64);
const TIMEOUT_MS = 15000;

const PIN_ITERATIONS = 100000;
const MAX_ECHECS = 5;
const BLOCAGE_MS = 15 * 60 * 1000;
const ACTIVATION_MS = 7 * 24 * 60 * 60 * 1000;

export class EspecesError extends Error {
  constructor(message, status = 400, etape = null) {
    super(message);
    this.status = status;
    this.step = etape;
  }
}

// ---------- Valeurs Firestore <-> JS ----------

export function versFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(versFs) } : {} };
  if (typeof v === "object") return { mapValue: { fields: champsVersFs(v) } };
  throw new Error("Type non pris en charge : " + typeof v);
}

export function champsVersFs(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = versFs(v);
  return out;
}

export function depuisFs(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(depuisFs);
  if ("mapValue" in v) return champsDepuisFs(v.mapValue.fields || {});
  return null;
}

export function champsDepuisFs(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = depuisFs(v);
  return out;
}

// JSON stable (clés triées) : même objet -> même texte -> même empreinte.
export function canonique(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canonique).join(",") + "]";
  return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonique(v[k])).join(",") + "}";
}

export function sha256(txt) {
  return crypto.createHash("sha256").update(txt, "utf8").digest("hex");
}

// Empreinte d'un événement : tout sauf le champ « hash » lui-même.
export function empreinteEvenement(ev) {
  const { hash, ...reste } = ev; // eslint-disable-line no-unused-vars
  return sha256(canonique(reste));
}

// ---------- Accès Firestore (REST, compte de service) ----------

function base() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projetFirestore())}/databases/(default)/documents`;
}

function idValide(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

async function appel(fetchImpl, url, opts = {}) {
  const token = await jetonGoogle(fetchImpl);
  const r = await fetchImpl(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

async function lireDoc(fetchImpl, coll, id) {
  const { r, data } = await appel(fetchImpl, `${base()}/${coll}/${id}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new EspecesError(`Lecture Firestore refusée (HTTP ${r.status}) : ${data?.error?.message || ""}`, 502, "lecture");
  return { id, champs: champsDepuisFs(data.fields), updateTime: data.updateTime, createTime: data.createTime };
}

export async function listerCollection(fetchImpl, coll) {
  const out = [];
  let page = "";
  for (let i = 0; i < 50; i++) {
    const url = `${base()}/${coll}?pageSize=300${page ? "&pageToken=" + encodeURIComponent(page) : ""}`;
    const { r, data } = await appel(fetchImpl, url);
    if (!r.ok) throw new EspecesError(`Lecture Firestore refusée (HTTP ${r.status}) : ${data?.error?.message || ""}`, 502, "lecture");
    for (const d of data.documents || []) {
      out.push({ id: d.name.split("/").pop(), champs: champsDepuisFs(d.fields), createTime: d.createTime, updateTime: d.updateTime });
    }
    if (!data.nextPageToken) break;
    page = data.nextPageToken;
  }
  return out;
}

function nomDoc(coll, id) {
  return `projects/${projetFirestore()}/databases/(default)/documents/${coll}/${id}`;
}

// Écriture atomique (tout ou rien). Renvoie false si une précondition a échoué
// (quelqu'un a écrit entre-temps) : l'appelant recommence.
async function commit(fetchImpl, writes) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projetFirestore())}/databases/(default)/documents:commit`;
  const { r, data } = await appel(fetchImpl, url, { method: "POST", body: JSON.stringify({ writes }) });
  if (r.ok) return { ok: true, commitTime: data.commitTime };
  const statut = data?.error?.status || "";
  if (r.status === 409 || statut === "FAILED_PRECONDITION" || statut === "ABORTED" || statut === "ALREADY_EXISTS") return { ok: false };
  throw new EspecesError(`Écriture Firestore refusée (HTTP ${r.status}) : ${data?.error?.message || ""}`, 502, "ecriture");
}

export function nouvelId() {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const b = crypto.randomBytes(20);
  let s = "";
  for (let i = 0; i < 20; i++) s += alpha[b[i] % alpha.length];
  return s;
}

function numeroEvenement(seq) {
  return String(seq).padStart(8, "0");
}

// ---------- Contexte de la requête ----------

export function contexteRequete(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    ip: fwd || String(req.headers?.["x-real-ip"] || "") || (req.socket && req.socket.remoteAddress) || "inconnue",
    navigateur: String(req.headers?.["user-agent"] || "").slice(0, 300),
  };
}

// ---------- Écriture avec journal ----------

// construire(etat) reçoit { entrees, recups } (Map id -> {champs}) lus juste avant, et
// renvoie { docs: [{ coll, id, apres, avant, creation }], evenements: [{ action, cible, motif, avant, apres, extra }] }.
// Chaque doc écrit doit être accompagné d'un événement. Tout part en un seul commit.
export async function ecrireAvecJournal({ acteur, contexte, construire, fetchImpl = fetch, maintenant = () => new Date() }) {
  if (!isStoreConfigured()) throw new EspecesError("Serveur non configuré (variables FIREBASE_* ou SESSION_SECRET absentes).", 503, "configuration");
  for (let essai = 0; essai < 4; essai++) {
    const [tete, entreesL, recupsL] = await Promise.all([
      lireDoc(fetchImpl, C_TETE, ID_TETE),
      listerCollection(fetchImpl, C_ENTREES),
      listerCollection(fetchImpl, C_RECUPS),
    ]);
    const etat = {
      entrees: new Map(entreesL.map(d => [d.id, d])),
      recups: new Map(recupsL.map(d => [d.id, d])),
    };
    const plan = construire(etat);
    const at = maintenant().toISOString();
    const writes = [];
    const evenements = [];
    let seq = tete ? Number(tete.champs.seq) : 0;
    let prev = tete ? tete.champs.hash : ZERO;

    const ajouterEvenement = (partiel) => {
      seq += 1;
      const ev = {
        seq, at,
        action: partiel.action,
        cible: partiel.cible || "",
        acteur: acteur.nom, acteurId: acteur.id || "", role: acteur.role,
        motif: partiel.motif || "",
        avant: partiel.avant === undefined || partiel.avant === null ? null : canonique(partiel.avant),
        apres: partiel.apres === undefined || partiel.apres === null ? null : canonique(partiel.apres),
        ip: contexte.ip, navigateur: contexte.navigateur,
        prevHash: prev,
      };
      ev.hash = empreinteEvenement(ev);
      prev = ev.hash;
      evenements.push(ev);
      writes.push({ update: { name: nomDoc(C_JOURNAL, numeroEvenement(seq)), fields: champsVersFs(ev) }, currentDocument: { exists: false } });
    };

    // Premier passage : ouverture du journal avec l'empreinte de chaque ligne existante.
    if (!tete) {
      const instantane = { entrees: {}, recups: {} };
      for (const d of entreesL) instantane.entrees[d.id] = sha256(canonique(d.champs));
      for (const d of recupsL) instantane.recups[d.id] = sha256(canonique(d.champs));
      ajouterEvenement({
        action: "ouverture_journal", cible: "",
        apres: { ...instantane, nbEntrees: entreesL.length, nbRecups: recupsL.length },
      });
    }

    for (const ev of plan.evenements) ajouterEvenement(ev);
    for (const d of plan.docs) {
      const w = { update: { name: nomDoc(d.coll, d.id), fields: champsVersFs(d.apres) } };
      if (d.creation) w.currentDocument = { exists: false };
      else w.currentDocument = { updateTime: d.updateTime };
      writes.push(w);
    }
    writes.push({
      update: { name: nomDoc(C_TETE, ID_TETE), fields: champsVersFs({ seq, hash: prev, majLe: at }) },
      currentDocument: tete ? { updateTime: tete.updateTime } : { exists: false },
    });

    const res = await commit(fetchImpl, writes);
    if (res.ok) return { evenements, tete: { seq, hash: prev }, resultat: plan.resultat };
  }
  throw new EspecesError("Trop d'écritures simultanées, réessayez.", 409, "concurrence");
}

// ---------- Personnel : codes personnels ----------

function normaliserNom(nom) {
  return String(nom || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

export function idPersonne(nom) {
  return normaliserNom(nom).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function lirePersonnel(fetchImpl = fetch) {
  const d = await readDoc(DOC_PERSONNEL, fetchImpl);
  return Array.isArray(d?.personnes) ? d.personnes : [];
}

async function ecrirePersonnel(personnes, fetchImpl = fetch) {
  await writeDoc(DOC_PERSONNEL, { personnes }, fetchImpl);
}

export function vuePublique(p) {
  return { id: p.id, nom: p.nom, actif: p.actif !== false, codeChoisi: Boolean(p.pinHash), activationEnAttente: Boolean(p.activationHash) };
}

function codeAleatoire6() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

export function pinValide(pin) {
  if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) return false;
  if (/^(\d)\1+$/.test(pin)) return false; // 0000, 1111…
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return false; // 1234, 4321…
  return true;
}

// Admin : crée une personne ou renvoie un nouveau code d'activation (réinitialisation).
// Le code d'activation n'est montré qu'une fois ; la personne choisit ensuite elle-même
// son code personnel, que l'admin ne connaît donc pas.
export async function adminPersonnel({ action, nom, id, contexte, fetchImpl = fetch, maintenant = () => new Date() }) {
  const personnes = await lirePersonnel(fetchImpl);
  const now = maintenant();
  let cible, code = null, evAction;
  if (action === "creer") {
    const n = normaliserNom(nom);
    const pid = idPersonne(n);
    if (!pid) throw new EspecesError("Nom invalide.");
    if (personnes.some(p => p.id === pid)) throw new EspecesError("Ce nom existe déjà.");
    code = codeAleatoire6();
    cible = { id: pid, nom: n, actif: true, pinHash: null, activationHash: hashPassword(code, { iterations: PIN_ITERATIONS }), activationExp: now.getTime() + ACTIVATION_MS, echecs: 0, bloqueJusqua: 0, creeLe: now.toISOString() };
    personnes.push(cible);
    evAction = "personnel_creation";
  } else {
    cible = personnes.find(p => p.id === id);
    if (!cible) throw new EspecesError("Personne introuvable.", 404);
    if (action === "reinitialiser") {
      code = codeAleatoire6();
      Object.assign(cible, { pinHash: null, activationHash: hashPassword(code, { iterations: PIN_ITERATIONS }), activationExp: now.getTime() + ACTIVATION_MS, echecs: 0, bloqueJusqua: 0 });
      evAction = "personnel_reinitialisation";
    } else if (action === "desactiver" || action === "reactiver") {
      cible.actif = action === "reactiver";
      evAction = "personnel_" + action;
    } else throw new EspecesError("Action inconnue.");
  }
  await ecrirePersonnel(personnes, fetchImpl);
  await ecrireAvecJournal({
    acteur: { nom: "admin", id: "admin", role: "admin" }, contexte, fetchImpl, maintenant,
    construire: () => ({ docs: [], evenements: [{ action: evAction, cible: "personnel/" + cible.id, apres: vuePublique(cible) }] }),
  });
  return { personne: vuePublique(cible), codeActivation: code };
}

async function journaliserSeul(acteur, contexte, ev, fetchImpl, maintenant) {
  try {
    await ecrireAvecJournal({ acteur, contexte, fetchImpl, maintenant, construire: () => ({ docs: [], evenements: [ev] }) });
  } catch { /* la trace d'un échec ne doit pas masquer la réponse principale */ }
}

// Réceptionniste : première utilisation, avec le code d'activation donné par l'admin.
export async function activerPersonne({ id, activation, pin, contexte, fetchImpl = fetch, maintenant = () => new Date() }) {
  const personnes = await lirePersonnel(fetchImpl);
  const p = personnes.find(x => x.id === id);
  if (!p || p.actif === false) throw new EspecesError("Personne inconnue ou désactivée.", 403);
  const now = maintenant().getTime();
  if (p.bloqueJusqua && p.bloqueJusqua > now) throw new EspecesError("Trop d'essais : réessayez dans 15 minutes.", 429);
  if (!p.activationHash) throw new EspecesError("Pas d'activation en attente : demandez un nouveau code à l'admin.", 403);
  if (p.activationExp && p.activationExp < now) throw new EspecesError("Code d'activation expiré : demandez-en un nouveau à l'admin.", 403);
  if (!verifyPassword(String(activation || ""), p.activationHash)) {
    await noterEchec(personnes, p, now, fetchImpl);
    await journaliserSeul({ nom: p.nom, id: p.id, role: "receptionniste" }, contexte, { action: "echec_activation", cible: "personnel/" + p.id }, fetchImpl, maintenant);
    throw new EspecesError("Code d'activation incorrect.", 403);
  }
  if (!pinValide(pin)) throw new EspecesError("Code personnel : 4 à 8 chiffres, pas de suite (1234) ni de chiffre répété (0000).");
  Object.assign(p, { pinHash: hashPassword(pin, { iterations: PIN_ITERATIONS }), activationHash: null, activationExp: 0, echecs: 0, bloqueJusqua: 0 });
  await ecrirePersonnel(personnes, fetchImpl);
  await ecrireAvecJournal({
    acteur: { nom: p.nom, id: p.id, role: "receptionniste" }, contexte, fetchImpl, maintenant,
    construire: () => ({ docs: [], evenements: [{ action: "personnel_activation", cible: "personnel/" + p.id, apres: vuePublique(p) }] }),
  });
  return vuePublique(p);
}

async function noterEchec(personnes, p, now, fetchImpl) {
  p.echecs = (Number(p.echecs) || 0) + 1;
  if (p.echecs >= MAX_ECHECS) { p.bloqueJusqua = now + BLOCAGE_MS; p.echecs = 0; }
  await ecrirePersonnel(personnes, fetchImpl);
}

// Vérifie le code personnel. Renvoie l'acteur, ou lève une erreur (et trace l'échec).
export async function verifierPersonne({ id, pin, contexte, fetchImpl = fetch, maintenant = () => new Date() }) {
  const personnes = await lirePersonnel(fetchImpl);
  const p = personnes.find(x => x.id === id);
  if (!p || p.actif === false) throw new EspecesError("Choisissez votre nom dans la liste.", 403);
  if (!p.pinHash) throw new EspecesError("Code personnel pas encore choisi : utilisez « Première utilisation ».", 403);
  const now = maintenant().getTime();
  if (p.bloqueJusqua && p.bloqueJusqua > now) throw new EspecesError("Trop d'essais : réessayez dans 15 minutes.", 429);
  if (!verifyPassword(String(pin || ""), p.pinHash)) {
    await noterEchec(personnes, p, now, fetchImpl);
    await journaliserSeul({ nom: p.nom, id: p.id, role: "receptionniste" }, contexte, { action: "echec_code", cible: "personnel/" + p.id }, fetchImpl, maintenant);
    throw new EspecesError("Code personnel incorrect.", 403);
  }
  if (p.echecs) { p.echecs = 0; await ecrirePersonnel(personnes, fetchImpl); }
  return { nom: p.nom, id: p.id, role: "receptionniste" };
}

// ---------- Opérations sur les espèces ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max = 200) => String(v ?? "").trim().slice(0, max);

export function validerLigne(l) {
  const type = l?.type;
  if (type !== "client" && type !== "expense") throw new EspecesError("Type invalide.");
  if (!DATE.test(String(l.date || ""))) throw new EspecesError("Date invalide.");
  const amount = Math.round(Number(l.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new EspecesError("Montant invalide.");
  const out = { type, date: l.date, amount, designation: txt(l.designation) };
  if (type === "client") {
    out.client = txt(l.client, 120);
    out.appartement = txt(l.appartement, 60);
    out.arrivalDate = l.arrivalDate && DATE.test(String(l.arrivalDate)) ? l.arrivalDate : "";
  } else {
    out.fournisseur = txt(l.fournisseur, 120);
  }
  return out;
}

export function motifValide(m) {
  const s = txt(m, 500);
  if (s.length < 5) throw new EspecesError("Motif obligatoire (au moins 5 caractères).");
  return s;
}

export async function ajouterLigne({ acteur, ligne, contexte, fetchImpl = fetch, maintenant = () => new Date() }) {
  const base = validerLigne(ligne);
  const id = nouvelId();
  return ecrireAvecJournal({
    acteur, contexte, fetchImpl, maintenant,
    construire: () => {
      const apres = { ...base, saisiPar: acteur.nom, saisiParId: acteur.id, recoveryId: null, createdAt: maintenant().toISOString(), deleted: false, journalise: true };
      return {
        docs: [{ coll: C_ENTREES, id, apres, creation: true }],
        evenements: [{ action: "creation", cible: `${C_ENTREES}/${id}`, apres }],
        resultat: { id },
      };
    },
  });
}

export async function supprimerLigne({ id, motif, contexte, fetchImpl = fetch, maintenant = () => new Date() }) {
  if (!idValide(id)) throw new EspecesError("Identifiant invalide.");
  const m = motifValide(motif);
  return ecrireAvecJournal({
    acteur: { nom: "admin", id: "admin", role: "admin" }, contexte, fetchImpl, maintenant,
    construire: ({ entrees }) => {
      const d = entrees.get(id);
      if (!d) throw new EspecesError("Ligne introuvable.", 404);
      if (d.champs.deleted) throw new EspecesError("Ligne déjà supprimée.", 409);
      if (d.champs.recoveryId) throw new EspecesError("Ligne déjà rattachée à une récupération : annulez d'abord la récupération.", 409);
      const apres = { ...d.champs, deleted: true, deletedAt: maintenant().toISOString(), deletedBy: "admin", deleteReason: m };
      return {
        docs: [{ coll: C_ENTREES, id, apres, updateTime: d.updateTime }],
        evenements: [{ action: "suppression", cible: `${C_ENTREES}/${id}`, motif: m, avant: d.champs, apres }],
        resultat: { id },
      };
    },
  });
}

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

function recupsActives(recups) {
  return [...recups.values()].filter(r => !r.champs.deleted)
    .sort((a, b) => String(b.champs.createdAt || "").localeCompare(String(a.champs.createdAt || "")));
}

export function etatCaisse({ entrees, recups }) {
  const actives = recupsActives(recups);
  const baseline = actives.length ? Number(actives[0].champs.amountLeftInBox) || 0 : 0;
  const enCours = [...entrees.values()].filter(e => !e.champs.deleted && !e.champs.recoveryId);
  const sumClient = enCours.filter(e => e.champs.type === "client").reduce((s, e) => s + (Number(e.champs.amount) || 0), 0);
  const sumExpense = enCours.filter(e => e.champs.type === "expense").reduce((s, e) => s + (Number(e.champs.amount) || 0), 0);
  return { baseline, enCours, total: r2(baseline + sumClient - sumExpense) };
}

export async function recuperer({ acteur, montant, note, entryIds, contexte, fetchImpl = fetch, maintenant = () => new Date() }) {
  const rec = r2(montant);
  if (!Number.isFinite(rec) || rec < 0) throw new EspecesError("Montant récupéré invalide.");
  const attendus = new Set(Array.isArray(entryIds) ? entryIds : []);
  const id = nouvelId();
  return ecrireAvecJournal({
    acteur, contexte, fetchImpl, maintenant,
    construire: (etat) => {
      const { enCours, total } = etatCaisse(etat);
      const ids = enCours.map(e => e.id);
      if (ids.length !== attendus.size || ids.some(x => !attendus.has(x))) {
        throw new EspecesError("La liste des espèces a changé depuis l'affichage : rechargez la page avant de récupérer.", 409, "concurrence");
      }
      if (total <= 0) throw new EspecesError("La caisse est vide ou négative, rien à récupérer.");
      if (rec > total + 0.001) throw new EspecesError("Le montant récupéré dépasse le total en caisse.");
      const now = maintenant().toISOString();
      const recDoc = {
        date: now.slice(0, 10), amountRecovered: rec, amountLeftInBox: r2(Math.max(0, total - rec)),
        note: txt(note, 300), totalAvant: total, entryIds: ids, createdAt: now,
        faitPar: acteur.nom, faitParId: acteur.id, deleted: false, journalise: true,
      };
      const docs = [{ coll: C_RECUPS, id, apres: recDoc, creation: true }];
      const evenements = [{ action: "recuperation", cible: `${C_RECUPS}/${id}`, apres: recDoc }];
      for (const e of enCours) {
        const apres = { ...e.champs, recoveryId: id };
        docs.push({ coll: C_ENTREES, id: e.id, apres, updateTime: e.updateTime });
        evenements.push({ action: "rattachement", cible: `${C_ENTREES}/${e.id}`, avant: e.champs, apres });
      }
      return { docs, evenements, resultat: { id, ...recDoc } };
    },
  });
}

export async function annulerRecuperation({ id, motif, contexte, fetchImpl = fetch, maintenant = () => new Date() }) {
  if (!idValide(id)) throw new EspecesError("Identifiant invalide.");
  const m = motifValide(motif);
  return ecrireAvecJournal({
    acteur: { nom: "admin", id: "admin", role: "admin" }, contexte, fetchImpl, maintenant,
    construire: ({ entrees, recups }) => {
      const d = recups.get(id);
      if (!d) throw new EspecesError("Récupération introuvable.", 404);
      if (d.champs.deleted) throw new EspecesError("Déjà annulée.", 409);
      const apres = { ...d.champs, deleted: true, deletedAt: maintenant().toISOString(), deletedBy: "admin", deleteReason: m };
      const docs = [{ coll: C_RECUPS, id, apres, updateTime: d.updateTime }];
      const evenements = [{ action: "annulation_recuperation", cible: `${C_RECUPS}/${id}`, motif: m, avant: d.champs, apres }];
      for (const e of entrees.values()) {
        if (e.champs.recoveryId !== id) continue;
        const ea = { ...e.champs, recoveryId: null };
        docs.push({ coll: C_ENTREES, id: e.id, apres: ea, updateTime: e.updateTime });
        evenements.push({ action: "detachement", cible: `${C_ENTREES}/${e.id}`, motif: m, avant: e.champs, apres: ea });
      }
      return { docs, evenements, resultat: { id } };
    },
  });
}

export async function soldeDepart({ date, montant, contexte, fetchImpl = fetch, maintenant = () => new Date() }) {
  if (!DATE.test(String(date || ""))) throw new EspecesError("Date invalide.");
  const amt = r2(montant);
  if (!(amt > 0)) throw new EspecesError("Montant de départ invalide.");
  const id = nouvelId();
  return ecrireAvecJournal({
    acteur: { nom: "admin", id: "admin", role: "admin" }, contexte, fetchImpl, maintenant,
    construire: () => {
      const recDoc = { date, amountRecovered: 0, amountLeftInBox: amt, note: "Solde de départ", totalAvant: amt, entryIds: [], createdAt: maintenant().toISOString(), faitPar: "admin", faitParId: "admin", deleted: false, journalise: true };
      return { docs: [{ coll: C_RECUPS, id, apres: recDoc, creation: true }], evenements: [{ action: "solde_depart", cible: `${C_RECUPS}/${id}`, apres: recDoc }], resultat: { id } };
    },
  });
}

// ---------- Vérification ----------

// Relit tout le journal et toute la base, et liste chaque incohérence :
//   chaine     : numéro manquant, empreinte recalculée différente, lien rompu
//   hors_journal_creation : ligne présente en base mais jamais journalisée
//   hors_journal_modification : ligne dont le contenu diffère du dernier état journalisé
//   hors_journal_effacement : ligne journalisée (ou présente à l'ouverture) qui a disparu
export async function verifierJournal({ fetchImpl = fetch } = {}) {
  const [evL, tete, entreesL, recupsL] = await Promise.all([
    listerCollection(fetchImpl, C_JOURNAL),
    lireDoc(fetchImpl, C_TETE, ID_TETE),
    listerCollection(fetchImpl, C_ENTREES),
    listerCollection(fetchImpl, C_RECUPS),
  ]);
  return analyser({ evenements: evL.map(d => d.champs), tete: tete?.champs || null, entrees: entreesL, recups: recupsL });
}

export function analyser({ evenements, tete, entrees, recups }) {
  const anomalies = [];
  const evs = [...evenements].sort((a, b) => Number(a.seq) - Number(b.seq));
  let prev = ZERO;
  evs.forEach((ev, i) => {
    if (Number(ev.seq) !== i + 1) anomalies.push({ type: "chaine", detail: `Événement n° ${i + 1} manquant (trouvé n° ${ev.seq}).` });
    if (ev.prevHash !== prev) anomalies.push({ type: "chaine", detail: `Lien rompu avant l'événement n° ${ev.seq}.` });
    if (empreinteEvenement(ev) !== ev.hash) anomalies.push({ type: "chaine", detail: `Événement n° ${ev.seq} retouché (empreinte différente).` });
    prev = ev.hash;
  });
  if (tete && evs.length && (Number(tete.seq) !== evs.length || tete.hash !== prev)) {
    anomalies.push({ type: "chaine", detail: `La tête du journal (n° ${tete.seq}) ne correspond pas au dernier événement (n° ${evs.length}) : événements effacés en fin de journal ?` });
  }

  // État attendu de chaque document d'après le journal (empreinte de son contenu).
  const attendu = new Map();
  for (const ev of evs) {
    if (ev.action === "ouverture_journal" && ev.apres) {
      const o = JSON.parse(ev.apres);
      for (const [id, h] of Object.entries(o.entrees || {})) attendu.set(`${C_ENTREES}/${id}`, h);
      for (const [id, h] of Object.entries(o.recups || {})) attendu.set(`${C_RECUPS}/${id}`, h);
    } else if (ev.cible && (ev.cible.startsWith(C_ENTREES + "/") || ev.cible.startsWith(C_RECUPS + "/")) && ev.apres) {
      attendu.set(ev.cible, sha256(ev.apres));
    }
  }
  const ouvert = evs.length > 0;
  const presents = new Set();
  for (const [coll, liste] of [[C_ENTREES, entrees], [C_RECUPS, recups]]) {
    for (const d of liste) {
      const cle = `${coll}/${d.id}`;
      presents.add(cle);
      if (!ouvert) continue;
      const h = attendu.get(cle);
      if (!h) anomalies.push({ type: "hors_journal_creation", cible: cle, detail: `Créée le ${d.createTime} sans passer par l'application.` });
      else if (h !== sha256(canonique(d.champs))) anomalies.push({ type: "hors_journal_modification", cible: cle, detail: `Modifiée le ${d.updateTime} sans passer par l'application.` });
    }
  }
  for (const cle of attendu.keys()) {
    if (!presents.has(cle)) anomalies.push({ type: "hors_journal_effacement", cible: cle, detail: "Effacée de la base sans passer par l'application." });
  }
  return {
    ok: anomalies.length === 0,
    ouvert,
    nbEvenements: evs.length,
    tete: evs.length ? { seq: evs.length, hash: prev } : null,
    anomalies,
    evenements: evs,
  };
}

export { StoreError };
