// lib/porte.js
// SERVEUR UNIQUEMENT. Relais Nuki pour le portail d'ouverture de LA porte du bureau de
// la Résidence Le Belleville (serrure « Bureau RLB »), utilisé par le centre de
// télésurveillance Samsic (intervention pompiers, levée de doute).
//
// Le portail lui-même est un site à part (dossier porte-samsic/, projet Vercel distinct,
// mot de passe propre). Il ne détient pas le jeton Nuki : il appelle les routes
// /api/porte/* de cette application avec une clé partagée (PORTE_SAMSIC_CLE), et cette
// application parle à Nuki avec NUKI_API_TOKEN.
//
// Ce que le relais peut faire : ouvrir (déverrouiller + tirer le loquet), déverrouiller,
// verrouiller cette porte, lire son état et son historique Nuki. Rien d'autre : aucune
// autre serrure, aucun code clavier, aucune donnée de l'application.
//
// Protection (voir docs/porte-samsic.md) :
//   - sans la clé partagée (en-tête Authorization: Bearer …, 24 caractères au moins),
//     les routes répondent 404, comme si rien n'existait ;
//   - freins : 6 actions par 5 min et par origine, 40 actions par heure au total
//     (mémoire de l'instance serveur) ;
//   - la serrure visée est fixée par PORTE_SAMSIC_SERRURE (identifiant Nuki ou nom exact
//     dans l'application Nuki) ; une seule serrure doit correspondre ;
//   - chaque action est écrite dans les journaux du serveur (origine, action, résultat)
//     et apparaît dans l'historique Nuki de la serrure (source : Nuki Web).

import crypto from "crypto";
import { nukiFetch, NukiError, isNukiConfigured, resumeSerrure, lireHistorique } from "./nuki";

// Actions Nuki Web API (POST /smartlock/{id}/action) : 1 déverrouiller, 2 verrouiller,
// 3 ouvrir (déverrouiller et tirer le loquet : la porte peut être poussée).
export const ACTIONS = {
  ouvrir: { nuki: 3, libelle: "Ouverture de la porte" },
  deverrouiller: { nuki: 1, libelle: "Déverrouillage" },
  verrouiller: { nuki: 2, libelle: "Verrouillage" },
};

export const CLE_LONGUEUR_MIN = 24;
export const MAX_ACTIONS_PAR_ORIGINE = 6;
export const FENETRE_ORIGINE_MS = 5 * 60 * 1000;
export const MAX_ACTIONS_GLOBAL = 40;
export const FENETRE_GLOBAL_MS = 60 * 60 * 1000;

export class PorteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- Configuration ----------

function cleConfig() { return (process.env.PORTE_SAMSIC_CLE || "").trim(); }
export function serrureConfig() { return (process.env.PORTE_SAMSIC_SERRURE || "").trim(); }

export function isPorteConfigured() {
  return isNukiConfigured() && cleConfig().length >= CLE_LONGUEUR_MIN && Boolean(serrureConfig());
}

function egal(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Vraie si la clé donnée est la clé partagée. Toujours fausse si le relais n'est pas configuré.
export function verifierCle(cle) {
  if (!isPorteConfigured() || typeof cle !== "string" || cle.length < CLE_LONGUEUR_MIN || cle.length > 200) return false;
  return egal(cle, cleConfig());
}

// Clé lue dans « Authorization: Bearer <clé> ». Renvoie la clé ou "".
export function cleDeLaRequete(req) {
  const h = String((req.headers && req.headers.authorization) || "");
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : "";
}

// Origine affichée dans les journaux : l'adresse de l'opérateur transmise par le portail
// (en-tête X-Porte-Origine), sinon l'adresse qui appelle le relais.
export function origine(req) {
  const o = String((req.headers && req.headers["x-porte-origine"]) || "").trim().slice(0, 80);
  if (o) return o;
  const fwd = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || "inconnu";
}

// ---------- Freins ----------

const actionsParOrigine = new Map(); // origine -> [dates]
let actionsGlobal = []; // dates

// Renvoie un message si l'action doit attendre, sinon null (et compte l'action).
export function limiterActions(orig, nowMs = Date.now()) {
  const recentes = (actionsParOrigine.get(orig) || []).filter(t => t > nowMs - FENETRE_ORIGINE_MS);
  actionsGlobal = actionsGlobal.filter(t => t > nowMs - FENETRE_GLOBAL_MS);
  if (recentes.length >= MAX_ACTIONS_PAR_ORIGINE) return `Trop d'actions en peu de temps (${MAX_ACTIONS_PAR_ORIGINE} par 5 minutes). Patientez puis réessayez.`;
  if (actionsGlobal.length >= MAX_ACTIONS_GLOBAL) return "Limite horaire d'actions atteinte. Appelez le contact indiqué.";
  recentes.push(nowMs);
  actionsParOrigine.set(orig, recentes);
  actionsGlobal.push(nowMs);
  return null;
}

export function _resetPourTests() {
  actionsParOrigine.clear();
  actionsGlobal = [];
  cache = { id: null, nom: null, at: 0 };
}

// ---------- Serrure ----------

let cache = { id: null, nom: null, at: 0 };
const CACHE_MS = 10 * 60 * 1000;

function nomNormalise(n) { return String(n || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr"); }

// Trouve la serrure du portail dans la liste Nuki : PORTE_SAMSIC_SERRURE est soit
// l'identifiant Nuki (chiffres), soit le nom exact de la serrure dans l'application Nuki.
// Une seule serrure doit correspondre, sinon refus (jamais « la première qui ressemble »).
export function trouverSerrure(liste, conf = serrureConfig()) {
  const locks = Array.isArray(liste) ? liste : [];
  const c = conf.trim();
  let trouvees;
  if (/^\d{1,20}$/.test(c)) trouvees = locks.filter(s => String(s.smartlockId) === c);
  else trouvees = locks.filter(s => nomNormalise(s.name) === nomNormalise(c));
  if (trouvees.length === 1) return trouvees[0];
  if (trouvees.length === 0) throw new PorteError(`Serrure « ${c} » introuvable dans le compte Nuki.`, 500);
  throw new PorteError(`Plusieurs serrures Nuki s'appellent « ${c} » : indiquez l'identifiant.`, 500);
}

export async function serrureDuPortail(opts = {}) {
  const now = Date.now();
  if (cache.id && cache.at > now - CACHE_MS) {
    const s = await nukiFetch("GET", `/smartlock/${cache.id}`, undefined, opts);
    return resumeSerrure(s);
  }
  const liste = await nukiFetch("GET", "/smartlock", undefined, opts);
  const s = trouverSerrure(liste);
  cache = { id: String(s.smartlockId), nom: s.name, at: now };
  return resumeSerrure(s);
}

// Résumé transmis au portail : ni identifiant Nuki, ni résidence, ni clavier.
export function resumePublic(s) {
  return { nom: s.nom, enLigne: s.enLigne, etatServeur: s.etatServeur, etat: s.etat, batterie: s.batterie, batterieFaible: s.batterieFaible };
}

export async function etatPortail(opts = {}) {
  const s = await serrureDuPortail(opts);
  let evenements = [];
  try {
    evenements = (await lireHistorique({ smartlockId: cache.id, jours: 7, limite: 30 }, opts))
      .map(e => ({ date: e.date, qui: e.qui, action: e.action, declencheur: e.declencheur, resultat: e.resultat, reussi: e.reussi }));
  } catch (e) {
    evenements = null; // l'état reste utile même sans historique
  }
  return { porte: resumePublic(s), evenements, lueLe: new Date().toISOString() };
}

export function validerAction(action) {
  return typeof action === "string" && Object.prototype.hasOwnProperty.call(ACTIONS, action) ? action : null;
}

// Exécute une action sur LA serrure du portail. Nuki répond 204 : la commande est
// acceptée par le cloud, la serrure l'exécute dès qu'elle est jointe (quelques secondes).
export async function executerAction(action, opts = {}) {
  const a = validerAction(action);
  if (!a) throw new PorteError("Action inconnue.", 400);
  const s = await serrureDuPortail(opts);
  if (!s.enLigne) throw new PorteError(`La serrure est ${s.etatServeur} : impossible d'agir à distance pour le moment.`, 409);
  await nukiFetch("POST", `/smartlock/${cache.id}/action`, { action: ACTIONS[a].nuki }, { ...opts, actionSur: cache.id });
  return { action: a, libelle: ACTIONS[a].libelle, serrure: s.nom, a: new Date().toISOString() };
}

export { NukiError };
