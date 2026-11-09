// lib/igloohome.js
// SERVEUR UNIQUEMENT. Client igloohome en LECTURE SEULE pour l'espace admin.
//
// Garde-fous (contrainte n°3 : rien qui ouvre, ferme, crée, modifie ou supprime) :
//   1. Le jeton OAuth est demandé avec les SEULS scopes de lecture
//      (liste des serrures, historique). Même un bug ne peut donc pas ouvrir une
//      serrure ni créer de PIN : igloohome refuserait l'appel (403).
//   2. Liste blanche : apiGet() n'accepte que GET sur /devices et
//      /devices/{id}/activity. Toute autre adresse lève une erreur avant l'appel réseau.
//   3. Ce fichier ne contient aucun autre appel réseau que le jeton (POST imposé
//      par OAuth) et apiGet().
//
// Identifiants : IGLOOHOME_CLIENT_ID / IGLOOHOME_CLIENT_SECRET (variables Vercel,
// jamais envoyées au navigateur). Adresses par défaut d'après docs.igloohome.co,
// ajustables sans changer le code : IGLOOHOME_AUTH_URL, IGLOOHOME_API_BASE.

export const READ_SCOPES = ["igloohomeapi/get-devices", "igloohomeapi/get-device-activity"];

const DEFAULT_AUTH_URL = "https://auth.igloohome.co/oauth2/token";
const DEFAULT_API_BASE = "https://api.igloohome.co/home";
const TIMEOUT_MS = 20000;

export function authUrl() {
  return (process.env.IGLOOHOME_AUTH_URL || DEFAULT_AUTH_URL).trim();
}
export function apiBase() {
  return (process.env.IGLOOHOME_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
}

export function isIgloohomeConfigured() {
  return Boolean(process.env.IGLOOHOME_CLIENT_ID && process.env.IGLOOHOME_CLIENT_SECRET);
}

export class IglooError extends Error {
  constructor(message, { status = 502, step, detail } = {}) {
    super(message);
    this.status = status;
    this.step = step;
    this.detail = detail;
  }
}

import crypto from "crypto";

// ---------- Liste blanche ----------

const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Renvoie le chemin si autorisé, sinon lève une erreur. Seules deux formes existent.
export function assertAllowedPath(path) {
  if (path === "/devices") return path;
  const m = /^\/devices\/([^/]+)\/activity$/.exec(path);
  if (m && DEVICE_ID.test(m[1])) return path;
  throw new IglooError(`Appel igloohome refusé (hors liste blanche lecture seule) : ${path}`, { status: 500, step: "liste-blanche" });
}

// ---------- Jeton ----------

let tokenCache = { key: "", token: "", exp: 0, scope: "" };

async function readBody(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text.slice(0, 2000); }
}

export async function getToken(fetchImpl = fetch) {
  if (!isIgloohomeConfigured()) {
    throw new IglooError("Identifiants igloohome absents (IGLOOHOME_CLIENT_ID / IGLOOHOME_CLIENT_SECRET).", { status: 503, step: "configuration" });
  }
  const id = process.env.IGLOOHOME_CLIENT_ID.trim();
  const secret = process.env.IGLOOHOME_CLIENT_SECRET.trim();
  const key = crypto.createHash("sha256").update(id + ":" + secret).digest("hex");
  const now = Date.now();
  if (tokenCache.token && tokenCache.key === key && tokenCache.exp > now + 60000) return tokenCache;

  const body = new URLSearchParams({ grant_type: "client_credentials", scope: READ_SCOPES.join(" ") });
  let r;
  try {
    r = await fetchImpl(authUrl(), {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new IglooError(`Serveur d'authentification igloohome injoignable : ${e.message}`, { step: "jeton" });
  }
  const data = await readBody(r);
  if (!r.ok || !data || typeof data !== "object" || !data.access_token) {
    throw new IglooError(`Authentification igloohome refusée (HTTP ${r.status}).`, { status: 502, step: "jeton", detail: data });
  }
  tokenCache = {
    key,
    token: data.access_token,
    exp: now + (Number(data.expires_in) || 3600) * 1000,
    scope: data.scope || READ_SCOPES.join(" "),
  };
  return tokenCache;
}

export function _resetTokenCacheForTests() {
  tokenCache = { key: "", token: "", exp: 0, scope: "" };
}

// ---------- Lecture ----------

export async function apiGet(path, query = {}, fetchImpl = fetch, retried = false) {
  assertAllowedPath(path);
  const { token, scope } = await getToken(fetchImpl);
  const url = new URL(apiBase() + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  let r;
  try {
    r = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new IglooError(`API igloohome injoignable : ${e.message}`, { step: path });
  }
  const data = await readBody(r);
  // 403 : le jeton en cache a pu être émis avant qu'un droit soit ajouté dans le portail
  // igloohome. On redemande un jeton neuf une seule fois.
  if (r.status === 403 && !retried) {
    _resetTokenCacheForTests();
    return apiGet(path, query, fetchImpl, true);
  }
  if (!r.ok) {
    const droits = r.status === 403 ? ` Droits du jeton : « ${scope || "aucun"} ».` : "";
    throw new IglooError(`igloohome a répondu HTTP ${r.status} sur GET ${url.pathname}.${droits}`, { status: 502, step: path, detail: data });
  }
  return { url: url.pathname + url.search, data };
}

// ---------- Mise en forme (sans rien supposer : le brut est toujours renvoyé à côté) ----------

function arrayIn(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of ["payload", "data", "devices", "items", "results"]) if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function findBridgeHints(obj, prefix = "", out = []) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (/bridge|gateway|linked/i.test(k) && v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) {
      out.push({ champ: p, valeur: v });
    }
    if (v && typeof v === "object" && !Array.isArray(v) && prefix.split(".").length < 3) findBridgeHints(v, p, out);
  }
  return out;
}

export function summarizeDevices(data) {
  const list = arrayIn(data);
  return list.map(d => {
    const type = d.type || d.deviceType || d.category || d.productType || "";
    const hints = findBridgeHints(d);
    return {
      id: String(d.deviceId ?? d.id ?? d.device_id ?? ""),
      nom: d.deviceName || d.name || d.displayName || "",
      type: String(type),
      estUnBridge: /bridge/i.test(String(type)),
      indicesBridge: hints,
      champs: Object.keys(d),
    };
  });
}

export function eventsOf(data) {
  return arrayIn(data);
}

export function nextCursorOf(data) {
  if (!data || typeof data !== "object") return null;
  return data.nextCursor || data.next_cursor || data.cursor?.next || null;
}

export function eventTime(e) {
  const v = e && (e.activityTimeAt ?? e.activityTime ?? e.timestamp ?? e.time ?? e.createdAt);
  if (v === undefined || v === null || v === "") return null;
  const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// Lit l'historique d'une serrure, page par page, jusqu'à couvrir la période demandée ou
// atteindre maxPages. Les paramètres de date de l'API ne sont pas documentés de façon
// sûre : on n'en envoie pas, on filtre ici sur l'horodatage et on garde tout le brut.
// Période : `days` jours jusqu'à maintenant, ou [fromMs, toMs] (rejeu d'un mois passé).
export async function readActivity(deviceId, { days = 7, fromMs, toMs, maxPages = 10, limit = 100, keepRaw = true, fetchImpl = fetch } = {}) {
  if (!DEVICE_ID.test(String(deviceId))) throw new IglooError("Identifiant de serrure invalide.", { status: 400, step: "entrée" });
  const since = Number.isFinite(fromMs) ? fromMs : Date.now() - days * 86400000;
  const until = Number.isFinite(toMs) ? toMs : Infinity;
  const pages = [];
  let cursor = null;
  let reachedOlder = false;
  for (let i = 0; i < maxPages; i++) {
    const { url, data } = await apiGet(`/devices/${deviceId}/activity`, { limit, cursor }, fetchImpl);
    pages.push({ url, data });
    const evs = eventsOf(data);
    if (evs.some(e => { const t = eventTime(e); return t !== null && t < since; })) reachedOlder = true;
    cursor = nextCursorOf(data);
    if (!cursor || reachedOlder || evs.length === 0) break;
  }
  const all = pages.flatMap(p => eventsOf(p.data));
  const inRange = all.filter(e => { const t = eventTime(e); return t === null || (t >= since && t <= until); });
  return {
    since: new Date(since).toISOString(),
    until: Number.isFinite(until) ? new Date(until).toISOString() : null,
    pagesLues: pages.length,
    pageSuivanteRestante: Boolean(cursor) && !reachedOlder,
    evenementsLus: all.length,
    evenements: inRange,
    ...(keepRaw ? { brut: pages } : {}),
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Bornes larges (UTC -1 jour / +2 jours) : le découpage exact en heure de Paris se fait
// dans le croisement. 62 jours au plus.
export function parseRange(from, to) {
  if (from === undefined && to === undefined) return null;
  if (!DAY.test(String(from)) || !DAY.test(String(to))) return { error: "Dates attendues au format AAAA-MM-JJ." };
  const fromMs = Date.parse(from + "T00:00:00Z") - 86400000;
  const toMs = Date.parse(to + "T00:00:00Z") + 2 * 86400000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return { error: "Période invalide." };
  if (toMs - fromMs > 65 * 86400000) return { error: "Période trop longue (62 jours au plus)." };
  return { fromMs, toMs };
}
