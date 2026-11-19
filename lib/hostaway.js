// lib/hostaway.js
// Fonctions partagées : auth OAuth Hostaway, vérification de session, mapping des listings
// (résidence via tag + numéro de sous-unité), exclusion des réservations annulées.

import crypto from "crypto";

const COOKIE_NAME = "fp_session";
const SECRET = process.env.SESSION_SECRET || "change-me-in-vercel-env";

// Session du code d'accès (cookie fp_session). Elle expire 5 h après la saisie du
// code, sur tout appareil : l'usage ne la prolonge jamais, il faut retaper le code.
// Jeton : "v2.<expiration en secondes epoch>.<HMAC hex>". L'ancien jeton "ok.<sig>"
// (valable sans limite) est refusé.
export const ACCESS_TTL_SECONDS = 5 * 60 * 60;
export const ACCESS_COOKIE = COOKIE_NAME;

function signAccess(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function makeSessionToken(nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + ACCESS_TTL_SECONDS;
  const payload = `v2.${exp}`;
  return { token: `${payload}.${signAccess(payload)}`, exp };
}

// Renvoie l'expiration (secondes epoch) si le jeton est valide, sinon 0.
export function verifySessionToken(token, nowMs = Date.now()) {
  if (typeof token !== "string") return 0;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v2" || !/^\d{1,12}$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return 0;
  const a = Buffer.from(parts[2], "hex");
  const b = Buffer.from(signAccess(`v2.${parts[1]}`), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 0;
  const exp = Number(parts[1]);
  const now = Math.floor(nowMs / 1000);
  if (exp <= now || exp > now + ACCESS_TTL_SECONDS) return 0;
  return exp;
}

export function sessionExpiry(req, nowMs = Date.now()) {
  const raw = (req && req.headers && req.headers.cookie) || "";
  let token;
  raw.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1 && p.slice(0, i).trim() === COOKIE_NAME) {
      try { token = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* illisible */ }
    }
  });
  return verifySessionToken(token, nowMs);
}

export function verifySession(req, nowMs = Date.now()) {
  return sessionExpiry(req, nowMs) > 0;
}

let tokenCache = { key: null, accessToken: null, expiresAt: 0 };

export async function getAccessToken(accountId, apiKey) {
  const cacheKey = accountId + ":" + apiKey.slice(0, 8);
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.key === cacheKey && tokenCache.expiresAt > now + 60000) {
    return tokenCache.accessToken;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: accountId,
    client_secret: apiKey,
    scope: "general",
  });
  const r = await fetch("https://api.hostaway.com/v1/accessTokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-control": "no-cache" },
    body: body.toString(),
  });
  if (!r.ok) {
    const d = await r.text();
    throw new Error(`Auth Hostaway échouée (HTTP ${r.status}). ${d.slice(0, 150)}`);
  }
  const data = await r.json();
  const expiresIn = (data.expires_in || 86400) * 1000;
  tokenCache = { key: cacheKey, accessToken: data.access_token, expiresAt: now + expiresIn };
  return data.access_token;
}

function extractTags(listing) {
  const tags = [];
  const sources = [listing.tags, listing.listingTags];
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const t of src) {
        const v = (t?.name || t?.tag || t?.value || t || "").toString().trim();
        if (v) tags.push(v);
      }
    }
  }
  return tags;
}

function customFieldMap(listing) {
  const m = {};
  (listing.customFieldValues || listing.customFields || []).forEach(c => {
    const k = (c.customField?.name || c.name || "").toLowerCase();
    if (k) m[k] = c.value;
  });
  return m;
}

// Cherche un numéro de sous-unité : tag purement numérique, champ personnalisé dédié,
// ou nombre isolé dans le nom du logement. Défensif : plusieurs sources, la structure
// exacte selon laquelle Hostaway expose ça n'est pas garantie a priori.
function extractUnitNumber(listing, tags) {
  // 1) tag entièrement numérique (hors premier tag = résidence)
  for (const t of tags.slice(1)) {
    if (/^\d{1,4}$/.test(t.trim())) return t.trim();
  }
  // 2) champ personnalisé nommé explicitement
  const cf = customFieldMap(listing);
  const candidates = ["numero appartement", "n° appartement", "numero", "room number", "numéro chambre", "numéro"];
  for (const key of candidates) {
    if (cf[key]) return String(cf[key]).trim();
  }
  // 3) nombre isolé en fin de nom, ex. "Cosy 11" -> "11"
  const name = listing.internalListingName || listing.name || listing.externalListingName || "";
  const m = name.match(/(\d{1,4})\s*$/);
  if (m) return m[1];
  // 4) repli : id du listing (peu lisible mais unique)
  return String(listing.id);
}

let listingsCache = { key: null, map: null, expiresAt: 0 };

// Carte listingId -> { residence, appartement (nom), unitNumber, tags }
export async function getListingMap(accessToken, accountId) {
  const now = Date.now();
  if (listingsCache.map && listingsCache.key === accountId && listingsCache.expiresAt > now) {
    return listingsCache.map;
  }
  const url = new URL("https://api.hostaway.com/v1/listings");
  url.searchParams.set("limit", "500");
  const r = await fetch(url, {
    method: "GET",
    headers: { "Authorization": "Bearer " + accessToken, "Cache-control": "no-cache" },
  });
  if (!r.ok) {
    const d = await r.text();
    throw new Error(`Lecture des listings échouée (HTTP ${r.status}). ${d.slice(0, 150)}`);
  }
  const data = await r.json();
  const listings = data.result || [];

  const map = {};
  for (const l of listings) {
    const tags = extractTags(l);
    const name = l.internalListingName || l.name || l.externalListingName || `Logement ${l.id}`;
    const residence = tags.length ? tags[0] : "Sans résidence";
    const unitNumber = extractUnitNumber(l, tags);
    map[String(l.id)] = { residence, appartement: name, unitNumber, tags };
  }
  listingsCache = { key: accountId, map, expiresAt: now + 10 * 60 * 1000 };
  return map;
}

// Liste BLANCHE : on n'accepte que les réservations réellement confirmées.
// Tout le reste (demandes, en attente, non payées, annulées...) est exclu par défaut.
// Statuts confirmés connus chez Hostaway : "new", "modified", "ownerStay".
const CONFIRMED_STATUSES = new Set(["new", "modified", "ownerstay"]);

export function isActive(resv) {
  const status = (resv.status || "").toString().toLowerCase();
  if (!CONFIRMED_STATUSES.has(status)) return false;
  if (resv.isCancelled === true) return false;
  if (resv.cancellationDate) return false;
  return true;
}

export async function fetchReservations(accessToken, params) {
  const url = new URL("https://api.hostaway.com/v1/reservations");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    method: "GET",
    headers: { "Authorization": "Bearer " + accessToken, "Cache-control": "no-cache" },
  });
  if (!r.ok) {
    const d = await r.text();
    const err = new Error(`Hostaway HTTP ${r.status} — ${d.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  return data.result || [];
}

// Tâches (maintenance/ménage) assignées par logement sur Hostaway. Même
// pattern que fetchReservations. Le format exact des tâches n'a pas encore
// été vérifié avec de vraies données — pages/api/tasks.js expose un mode
// debug (?debug=1) qui renvoie les champs bruts d'un échantillon, pour ajuster
// le mapping si un nom de champ diffère de ce qu'on suppose ici.
export async function fetchTasks(accessToken, params) {
  const url = new URL("https://api.hostaway.com/v1/tasks");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    method: "GET",
    headers: { "Authorization": "Bearer " + accessToken, "Cache-control": "no-cache" },
  });
  if (!r.ok) {
    const d = await r.text();
    const err = new Error(`Hostaway HTTP ${r.status} — ${d.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  return data.result || [];
}
