// lib/nuki.js
// SERVEUR UNIQUEMENT. Client Nuki Web API (api.nuki.io) pour l'Espace admin :
// serrures Nuki de Villiers et Lantiez (et Deep 02 à Belleville).
//
// Jeton : variable d'environnement Vercel NUKI_API_TOKEN (jeton API de web.nuki.io,
// envoyé en « Authorization: Bearer »). Il n'est jamais renvoyé au navigateur,
// jamais écrit dans Firestore, jamais journalisé.
//
// Codes clavier (PIN) : la liste envoyée au navigateur ne contient JAMAIS les codes.
// Un code n'est lu qu'à la demande (bouton « Afficher »), un par un, et n'est jamais
// journalisé. Pour regrouper « même code sur toutes les serrures », le serveur
// compare les codes lui-même et ne renvoie qu'une lettre (A, B, C…) par variante.
//
// Écritures (changement de code, activation, suppression, création) : uniquement
// depuis les routes /api/admin/nuki/*, sur clic de l'admin, une serrure à la fois,
// avec un résultat par serrure. Nuki applique les changements de façon asynchrone :
// une réponse 204 veut dire « accepté par le cloud Nuki », la serrure se met à jour
// dès qu'elle est jointe (bridge ou application).

export const NUKI_API_BASE = "https://api.nuki.io";
const TIMEOUT_MS = 20000;
export const TYPE_CODE_CLAVIER = 13;

export class NukiError extends Error {
  constructor(message, { status = 502, step, detail } = {}) {
    super(message);
    this.status = status;
    this.step = step;
    this.detail = detail;
  }
}

export function isNukiConfigured() {
  return Boolean((process.env.NUKI_API_TOKEN || "").trim());
}

function token() {
  const t = (process.env.NUKI_API_TOKEN || "").trim();
  if (!t) throw new NukiError("Jeton Nuki absent : créez la variable NUKI_API_TOKEN dans Vercel puis redéployez.", { status: 500, step: "configuration" });
  return t;
}

// ---------- Liste blanche des appels ----------

const ID = "\\d{1,20}";
const AUTH_ID = "[0-9a-fA-F]{6,40}";
const ROUTES = [
  ["GET", new RegExp(`^/smartlock$`)],
  ["GET", new RegExp(`^/smartlock/${ID}$`)],
  ["GET", new RegExp(`^/smartlock/auth$`)],
  ["GET", new RegExp(`^/smartlock/log$`)],
  ["GET", new RegExp(`^/smartlock/${ID}/auth$`)],
  ["GET", new RegExp(`^/smartlock/${ID}/auth/${AUTH_ID}$`)],
  ["GET", new RegExp(`^/smartlock/${ID}/log$`)],
  ["POST", new RegExp(`^/smartlock/${ID}/auth/${AUTH_ID}$`)], // modifier un code
  ["DELETE", new RegExp(`^/smartlock/${ID}/auth/${AUTH_ID}$`)], // supprimer un code
  ["PUT", new RegExp(`^/smartlock/${ID}/auth$`)], // créer un code
];

// Aucune ouverture de porte possible depuis l'Espace admin : /action n'est pas dans la liste.
// Seule exception : le portail d'ouverture d'UNE porte (lib/porte.js), qui doit passer
// explicitement l'identifiant de cette serrure dans `actionSur` ; l'appel n'est accepté
// que pour cette serrure-là.
export function assertAllowed(method, path, { actionSur } = {}) {
  const p = path.split("?")[0];
  if (ROUTES.some(([m, re]) => m === method && re.test(p))) return true;
  if (actionSur && /^\d{1,20}$/.test(String(actionSur)) && method === "POST" && p === `/smartlock/${actionSur}/action`) return true;
  throw new NukiError(`Appel Nuki refusé (hors liste blanche) : ${method} ${p}`, { status: 500, step: "liste-blanche" });
}

async function readBody(r) {
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text.slice(0, 1000); }
}

// Messages d'erreur Nuki : on n'y recopie jamais le corps envoyé (il peut contenir le code).
const STATUTS = {
  400: "Requête refusée par Nuki (valeur invalide)",
  401: "Jeton Nuki refusé (expiré ou révoqué)",
  402: "Abonnement Nuki requis pour cette action",
  403: "Action interdite pour ce jeton",
  404: "Introuvable chez Nuki",
  409: "Conflit : ce code existe déjà sur la serrure, ou une autre opération est en cours",
  423: "Code verrouillé : une autre opération est encore en cours sur cette serrure",
  426: "Mise à jour du firmware de la serrure nécessaire",
  429: "Trop de requêtes : Nuki demande d'attendre",
};

export async function nukiFetch(method, path, body, { fetchImpl = fetch, actionSur } = {}) {
  assertAllowed(method, path, { actionSur });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetchImpl(NUKI_API_BASE + path, {
      method,
      headers: { Authorization: `Bearer ${token()}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new NukiError(e.name === "AbortError" ? "Nuki ne répond pas (délai dépassé)." : `Nuki injoignable : ${e.message}`, { step: "réseau" });
  } finally {
    clearTimeout(timer);
  }
  const data = await readBody(r);
  if (!r.ok) {
    const detail = data && typeof data === "object" ? { status: r.status, message: data.detailMessage || data.message || data.error || null } : { status: r.status };
    throw new NukiError(`${STATUTS[r.status] || "Erreur Nuki"} (HTTP ${r.status}).`, { status: 502, step: "nuki", detail: { ...detail, httpStatus: r.status } });
  }
  return data;
}

// ---------- Résidences ----------

// Nom de serrure dans l'application Nuki → résidence.
// « Villiers … » = Villiers ; « A1 » à « A8 » = Lantiez (Levloft) ; « Deep » = Belleville (Deep 02).
export function residenceDe(nom) {
  const n = String(nom || "").trim();
  if (/^villiers/i.test(n)) return "Villiers";
  if (/^A\s*\d+$/i.test(n)) return "Lantiez";
  if (/^deep/i.test(n)) return "Belleville";
  return "Autre";
}

// serverState Nuki : 0 en ligne, 4 hors ligne (bridge ou serrure injoignable).
const SERVER_STATES = { 0: "en ligne", 1: "non enregistrée", 2: "clé invalide", 3: "authentification invalide", 4: "hors ligne" };
// state.state : 1 verrouillée, 3 déverrouillée, 5 déverrouillée (loquet), 254 moteur bloqué…
const LOCK_STATES = { 0: "non calibrée", 1: "verrouillée", 2: "déverrouillage…", 3: "déverrouillée", 4: "verrouillage…", 5: "ouverte (loquet)", 6: "lock'n'go", 7: "ouverture…", 254: "moteur bloqué", 255: "inconnu" };

export function resumeSerrure(s) {
  return {
    id: s.smartlockId,
    nom: String(s.name || "").trim() || String(s.smartlockId),
    residence: residenceDe(s.name),
    enLigne: s.serverState === 0,
    etatServeur: SERVER_STATES[s.serverState] || `état ${s.serverState}`,
    etat: s.state ? (LOCK_STATES[s.state.state] || `état ${s.state.state}`) : "—",
    batterieFaible: Boolean(s.state && s.state.batteryCritical),
    batterie: s.state && Number.isFinite(s.state.batteryCharge) ? s.state.batteryCharge : null,
    clavier: Boolean(s.advancedConfig && s.advancedConfig.keypadPaired) || Boolean(s.config && s.config.keypadPaired),
    clavierBatterieFaible: Boolean(s.state && s.state.keypadBatteryCritical),
  };
}

export function triSerrures(a, b) {
  const ordre = { Villiers: 0, Lantiez: 1, Belleville: 2, Autre: 3 };
  return (ordre[a.residence] - ordre[b.residence]) || a.nom.localeCompare(b.nom, "fr", { numeric: true });
}

// ---------- Codes ----------

export function nomCle(nom) {
  return String(nom || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

// Résumé d'un code clavier SANS sa valeur.
export function resumeCode(a, variante) {
  return {
    id: a.id,
    smartlockId: a.smartlockId,
    nom: String(a.name || "").trim(),
    actif: a.enabled !== false,
    variante: variante || null,
    debut: a.allowedFromDate || null,
    fin: a.allowedUntilDate || null,
    jours: a.allowedWeekDays ?? null,
    heureDebut: a.allowedFromTime ?? null,
    heureFin: a.allowedUntilTime ?? null,
    derniereUtilisation: a.lastActiveDate || null,
    utilisations: a.lockCount ?? null,
    creeLe: a.creationDate || null,
    modifieLe: a.updateDate || null,
    enCours: Boolean(a.operationId),
    erreur: a.error || null,
  };
}

// Regroupe les codes par nom ; dans un groupe, donne la même lettre aux codes de même valeur.
// Les valeurs ne sortent jamais de cette fonction.
export function codesSansValeur(auths) {
  const lettres = new Map(); // nomCle -> Map(code -> lettre)
  return auths.filter(a => a.type === TYPE_CODE_CLAVIER).map(a => {
    const k = nomCle(a.name);
    if (!lettres.has(k)) lettres.set(k, new Map());
    const m = lettres.get(k);
    let v = null;
    if (a.code !== undefined && a.code !== null) {
      const c = String(a.code);
      if (!m.has(c)) m.set(c, String.fromCharCode(65 + Math.min(m.size, 25)));
      v = m.get(c);
    }
    return resumeCode(a, v);
  });
}

// Règles Nuki du clavier : 6 chiffres de 1 à 9 (pas de 0), ne commence pas par « 12 ».
export function validerCode(code) {
  const c = String(code ?? "").trim();
  if (!/^\d{6}$/.test(c)) return "Le code doit faire exactement 6 chiffres.";
  if (c.includes("0")) return "Le clavier Nuki n'a pas de 0 : chiffres 1 à 9 seulement.";
  if (c.startsWith("12")) return "Nuki interdit les codes qui commencent par 12.";
  return null;
}

export function validerNom(nom) {
  const n = String(nom ?? "").trim();
  if (!n) return "Le nom est obligatoire.";
  if (n.length > 32) return "Nom trop long (32 caractères au maximum chez Nuki).";
  return null;
}

// Corps d'une modification : Nuki exige le nom ; on renvoie les réglages actuels
// (plages de dates, jours, heures) pour ne rien perdre, puis on applique le changement.
export function corpsModification(actuel, changement) {
  const b = { name: String(actuel.name || "").trim() || "Code" };
  for (const k of ["allowedFromDate", "allowedUntilDate", "allowedWeekDays", "allowedFromTime", "allowedUntilTime"]) {
    if (actuel[k] !== undefined && actuel[k] !== null) b[k] = actuel[k];
  }
  b.enabled = actuel.enabled !== false;
  b.remoteAllowed = Boolean(actuel.remoteAllowed);
  if (changement.nom !== undefined) b.name = String(changement.nom).trim();
  if (changement.actif !== undefined) b.enabled = Boolean(changement.actif);
  if (changement.code !== undefined) b.code = Number(changement.code);
  return b;
}

// Lit les codes clavier d'une serrure (avec valeurs, usage serveur uniquement).
export async function codesDeLaSerrure(smartlockId, opts) {
  const list = await nukiFetch("GET", `/smartlock/${smartlockId}/auth?types=${TYPE_CODE_CLAVIER}`, undefined, opts);
  return Array.isArray(list) ? list.filter(a => a.type === TYPE_CODE_CLAVIER) : [];
}

export async function lireTout(opts) {
  const [locks, auths] = await Promise.all([
    nukiFetch("GET", "/smartlock", undefined, opts),
    nukiFetch("GET", `/smartlock/auth?types=${TYPE_CODE_CLAVIER}`, undefined, opts),
  ]);
  const serrures = (Array.isArray(locks) ? locks : []).map(resumeSerrure).sort(triSerrures);
  const codes = codesSansValeur(Array.isArray(auths) ? auths : []);
  return { serrures, codes };
}

// ---------- Actions en masse ----------

export const ACTIONS = ["code", "activer", "desactiver", "supprimer", "renommer"];
export const MAX_ITEMS = 25; // par appel : le navigateur envoie par paquets et affiche l'avancement

const pause = ms => new Promise(r => setTimeout(r, ms));

function okItem(it) {
  return it && /^\d{1,20}$/.test(String(it.smartlockId)) && new RegExp(`^${AUTH_ID}$`).test(String(it.id));
}

// Contrôle avant tout appel réseau. Renvoie un message d'erreur ou null.
export function validerDemande({ action, items, code, nom }) {
  if (!ACTIONS.includes(action)) return "Action inconnue.";
  if (!Array.isArray(items) || !items.length) return "Aucun code sélectionné.";
  if (items.length > MAX_ITEMS) return `Trop de codes dans un seul envoi (${MAX_ITEMS} au maximum).`;
  if (!items.every(okItem)) return "Identifiant de serrure ou de code invalide.";
  if (action === "code") {
    const e = validerCode(code);
    if (e) return e;
  }
  if (action === "renommer" || (action === "code" && nom !== undefined && nom !== null && nom !== "")) {
    const e = validerNom(nom);
    if (e) return e;
  }
  return null;
}

// Exécute l'action code par code. Ne lève pas : chaque code reçoit son propre résultat.
// Pour « code » : refuse si la nouvelle valeur est déjà portée par un AUTRE code de la
// même serrure (Nuki refuserait), ou si deux codes de la même serrure sont dans l'envoi.
export async function executerMasse({ action, items, code, nom }, opts = {}) {
  const delai = opts.delaiMs ?? 150;
  const parSerrure = new Map(); // cache des codes actuels par serrure
  const dejaVise = new Set();
  const resultats = [];
  for (const it of items) {
    const smartlockId = String(it.smartlockId);
    const id = String(it.id);
    const r = { smartlockId: Number(smartlockId), id, ok: false };
    try {
      if (!parSerrure.has(smartlockId)) parSerrure.set(smartlockId, await codesDeLaSerrure(smartlockId, opts));
      const codes = parSerrure.get(smartlockId);
      const actuel = codes.find(a => String(a.id) === id);
      if (!actuel) throw new NukiError("Code introuvable sur cette serrure (déjà supprimé ?).", { step: "lecture" });
      r.nom = String(actuel.name || "").trim();
      if (action === "code") {
        if (dejaVise.has(smartlockId)) throw new NukiError("Deux codes de cette serrure ne peuvent pas recevoir la même valeur : ignoré.", { step: "contrôle" });
        const doublon = codes.find(a => String(a.id) !== id && String(a.code) === String(code));
        if (doublon) throw new NukiError(`Ce code est déjà utilisé sur cette serrure par « ${String(doublon.name || "").trim()} ».`, { step: "contrôle" });
        dejaVise.add(smartlockId);
        if (String(actuel.code) === String(code) && !(nom && nomCle(nom) !== nomCle(actuel.name))) {
          r.ok = true; r.statut = "inchangé (déjà ce code)";
          resultats.push(r); continue;
        }
      }
      if (action === "supprimer") {
        await nukiFetch("DELETE", `/smartlock/${smartlockId}/auth/${id}`, undefined, opts);
        r.statut = "supprimé";
      } else {
        const changement = action === "code" ? { code, ...(nom ? { nom } : {}) }
          : action === "activer" ? { actif: true }
          : action === "desactiver" ? { actif: false }
          : { nom };
        await nukiFetch("POST", `/smartlock/${smartlockId}/auth/${id}`, corpsModification(actuel, changement), opts);
        r.statut = action === "code" ? "code changé" : action === "activer" ? "activé" : action === "desactiver" ? "désactivé" : "renommé";
        if (action === "code") actuel.code = Number(code);
      }
      r.ok = true;
    } catch (e) {
      r.erreur = e.message;
      if (e.detail && e.detail.message) r.detailNuki = String(e.detail.message).slice(0, 200);
    }
    resultats.push(r);
    if (delai) await pause(delai);
  }
  return resultats;
}

// Création d'un code sur plusieurs serrures, une par une.
export function validerCreation({ nom, code, smartlockIds, debut, fin }) {
  const e = validerNom(nom) || validerCode(code);
  if (e) return e;
  if (!Array.isArray(smartlockIds) || !smartlockIds.length) return "Choisissez au moins une serrure.";
  if (smartlockIds.length > MAX_ITEMS) return `Trop de serrures dans un seul envoi (${MAX_ITEMS} au maximum).`;
  if (!smartlockIds.every(s => /^\d{1,20}$/.test(String(s)))) return "Identifiant de serrure invalide.";
  for (const d of [debut, fin]) if (d && !Number.isFinite(Date.parse(d))) return "Date invalide.";
  if (debut && fin && Date.parse(fin) <= Date.parse(debut)) return "La fin doit être après le début.";
  return null;
}

export async function creerCodes({ nom, code, smartlockIds, debut, fin }, opts = {}) {
  const delai = opts.delaiMs ?? 150;
  const resultats = [];
  for (const s of smartlockIds) {
    const smartlockId = String(s);
    const r = { smartlockId: Number(smartlockId), ok: false, nom: String(nom).trim() };
    try {
      const codes = await codesDeLaSerrure(smartlockId, opts);
      const doublon = codes.find(a => String(a.code) === String(code));
      if (doublon) throw new NukiError(`Ce code est déjà utilisé sur cette serrure par « ${String(doublon.name || "").trim()} ».`, { step: "contrôle" });
      const body = { name: String(nom).trim(), type: TYPE_CODE_CLAVIER, code: Number(code), remoteAllowed: false };
      if (debut) body.allowedFromDate = new Date(debut).toISOString();
      if (fin) body.allowedUntilDate = new Date(fin).toISOString();
      await nukiFetch("PUT", `/smartlock/${smartlockId}/auth`, body, opts);
      r.ok = true; r.statut = "créé";
    } catch (e) {
      r.erreur = e.message;
      if (e.detail && e.detail.message) r.detailNuki = String(e.detail.message).slice(0, 200);
    }
    resultats.push(r);
    if (delai) await pause(delai);
  }
  return resultats;
}

// ---------- Historique ----------

const ACTIONS_LOG = { 1: "Déverrouillage", 2: "Verrouillage", 3: "Ouverture (loquet)", 4: "Lock'n'go", 5: "Lock'n'go + loquet", 208: "Porte", 209: "Porte", 224: "Erreur de code", 240: "Porte ouverte", 241: "Porte fermée", 242: "Capteur de porte", 243: "Porte restée ouverte", 252: "Initialisation", 253: "Calibrage", 254: "Journal", 255: "Journal" };
const TRIGGERS = { 0: "système", 1: "manuel", 2: "bouton", 3: "automatique", 4: "web", 5: "application", 6: "verrouillage auto", 7: "accessoire", 255: "clavier" };
const SOURCES = { 1: "code clavier", 2: "empreinte", 3: "Tap to Unlock" };
const RESULTATS = { 0: "réussi", 1: "moteur bloqué", 2: "annulé", 3: "trop rapproché", 4: "occupé", 5: "tension faible", 6: "embrayage", 7: "panne moteur", 8: "incomplet", 9: "refusé", 10: "refusé", 224: "code erroné", 254: "erreur", 255: "inconnu" };

export function resumeLog(l) {
  return {
    id: l.id,
    smartlockId: l.smartlockId,
    date: l.date,
    qui: String(l.name || "").trim() || null,
    action: ACTIONS_LOG[l.action] || `action ${l.action}`,
    declencheur: l.trigger === 255 || l.source === 1 ? "clavier" : (TRIGGERS[l.trigger] || `déclencheur ${l.trigger}`),
    source: SOURCES[l.source] || null,
    resultat: RESULTATS[l.state] || `état ${l.state}`,
    reussi: l.state === 0,
  };
}

export async function lireHistorique({ smartlockId, jours = 7, limite = 300 }, opts) {
  const from = new Date(Date.now() - jours * 86400000).toISOString();
  const q = `fromDate=${encodeURIComponent(from)}&limit=${limite}`;
  const path = smartlockId ? `/smartlock/${smartlockId}/log?${q}` : `/smartlock/log?${q}`;
  const list = await nukiFetch("GET", path, undefined, opts);
  return (Array.isArray(list) ? list : []).map(resumeLog);
}
