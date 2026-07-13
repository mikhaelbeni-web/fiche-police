// pages/api/departures.js
// Lecture seule. Renvoie les DÉPARTS (check-outs) sur une période, groupés par résidence.
// Un check-out = un ménage. Les résidences sont découvertes dynamiquement via les tags
// Hostaway des listings (aucune liste codée en dur).

import crypto from "crypto";

let tokenCache = { key: null, accessToken: null, expiresAt: 0 };
let listingsCache = { key: null, map: null, expiresAt: 0 };

const COOKIE_NAME = "fp_session";
const SECRET = process.env.SESSION_SECRET || "change-me-in-vercel-env";

function verifySession(req) {
  const raw = req.headers.cookie || "";
  const cookies = {};
  raw.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) cookies[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  const token = cookies[COOKIE_NAME];
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (payload !== "ok") return false;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function getAccessToken(accountId, apiKey) {
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

// Extrait les tags d'un listing. Défensif : la structure varie selon l'API.
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

// Construit une carte listingId -> { residence, appartement }
async function getListingMap(accessToken, accountId) {
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
    // La résidence = le premier tag trouvé. Si aucun tag, repli sur "Sans résidence".
    const residence = tags.length ? tags[0] : "Sans résidence";
    map[String(l.id)] = { residence, appartement: name, tags };
  }

  listingsCache = { key: accountId, map, expiresAt: now + 10 * 60 * 1000 };
  return map;
}

const CANCELLED = new Set(["cancelled", "canceled", "declined", "expired", "denied", "aborted"]);

function isActive(resv) {
  const s = (resv.status || "").toString().toLowerCase();
  if (CANCELLED.has(s)) return false;
  if (resv.isCancelled === true) return false;
  if (resv.cancellationDate) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule." });
  }
  if (!verifySession(req)) {
    return res.status(401).json({ error: "Session invalide. Reconnecte-toi." });
  }

  const accountId = req.headers["x-hostaway-account"] || process.env.HOSTAWAY_ACCOUNT_ID;
  const apiKey = req.headers["x-hostaway-key"] || process.env.HOSTAWAY_API_KEY;
  if (!accountId || !apiKey) {
    return res.status(401).json({ error: "Account ID et API Key requis." });
  }

  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "Paramètres 'from' et 'to' requis (YYYY-MM-DD)." });
  }

  try {
    const accessToken = await getAccessToken(accountId, apiKey);
    const listingMap = await getListingMap(accessToken, accountId);

    // Départs sur la période
    const url = new URL("https://api.hostaway.com/v1/reservations");
    url.searchParams.set("departureStartDate", from);
    url.searchParams.set("departureEndDate", to);
    url.searchParams.set("limit", "500");
    url.searchParams.set("includeResources", "1");

    const r = await fetch(url, {
      method: "GET",
      headers: { "Authorization": "Bearer " + accessToken, "Cache-control": "no-cache" },
    });
    if (!r.ok) {
      const d = await r.text();
      return res.status(r.status).json({ error: `Hostaway HTTP ${r.status}`, detail: d.slice(0, 250) });
    }
    const data = await r.json();
    const all = (data.result || []).filter(isActive);

    // Ne garder que les départs réellement dans la fenêtre demandée
    const inRange = all.filter(rv => {
      const d = (rv.departureDate || rv.checkOutDate || "").slice(0, 10);
      return d >= from && d <= to;
    });

    // Groupement par résidence
    const byResidence = {};
    for (const rv of inRange) {
      const lid = String(rv.listingMapId ?? rv.listingId ?? "");
      const info = listingMap[lid] || { residence: "Sans résidence", appartement: rv.listingName || "—" };
      const key = info.residence;
      if (!byResidence[key]) byResidence[key] = { residence: key, count: 0, items: [] };
      byResidence[key].count += 1;
      byResidence[key].items.push({
        appartement: info.appartement || rv.listingName || "—",
        depart: (rv.departureDate || rv.checkOutDate || "").slice(0, 10),
        arrivee: (rv.arrivalDate || rv.checkInDate || "").slice(0, 10),
        client: rv.guestName || [rv.guestFirstName, rv.guestLastName].filter(Boolean).join(" ") || "—",
        reservation: rv.hostawayReservationId || rv.channelReservationId || rv.id || "",
        voyageurs: rv.numberOfGuests ?? rv.adults ?? "",
      });
    }

    // Tri : résidences par ordre alpha, appartements par nom
    const groups = Object.values(byResidence).sort((a, b) => a.residence.localeCompare(b.residence));
    for (const g of groups) {
      g.items.sort((a, b) => (a.depart + a.appartement).localeCompare(b.depart + b.appartement));
    }

    // Liste des résidences connues (pour le filtre côté front)
    const residences = Array.from(
      new Set(Object.values(listingMap).map(v => v.residence))
    ).sort((a, b) => a.localeCompare(b));

    return res.status(200).json({
      from, to,
      total: inRange.length,
      residences,
      groups,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
