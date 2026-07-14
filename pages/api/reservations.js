// pages/api/reservations.js
// Lecture seule stricte. OAuth Hostaway (Account ID + API Key -> access token),
// puis : (1) charge les listings taggés "belleville", (2) lit les réservations du jour,
// (3) ne renvoie que celles dont le logement porte le tag Belleville.
// Gère les multi-units : un multi-unit = un listingMapId unique, donc si le parent
// est taggé, toutes ses sous-unités passent le filtre.

import { resolveApartment } from "../../lib/apartments";

let tokenCache = { key: null, accessToken: null, expiresAt: 0 };

// Cache des IDs de listings Belleville (évite de recharger les listings à chaque appel)
let listingCache = { key: null, ids: null, expiresAt: 0 };

const TAG_FILTER = "belleville"; // insensible à la casse

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
    const detail = await r.text();
    throw new Error(`Auth Hostaway échouée (HTTP ${r.status}). Vérifie l'Account ID et l'API Key. ${detail.slice(0, 200)}`);
  }
  const data = await r.json();
  const accessToken = data.access_token;
  const expiresIn = (data.expires_in || 60 * 60 * 24) * 1000;
  tokenCache = { key: cacheKey, accessToken, expiresAt: now + expiresIn };
  return accessToken;
}

// Cherche le mot "belleville" dans plusieurs champs candidats d'un listing.
// Défensif : la structure exacte des tags varie selon la version de l'API Hostaway.
function listingMatchesBelleville(listing) {
  const needle = TAG_FILTER;

  // 1) Champs "tags" possibles
  const tagSources = [listing.tags, listing.listingTags, listing.customFieldValues];
  for (const src of tagSources) {
    if (Array.isArray(src)) {
      for (const t of src) {
        const val = (t?.name || t?.tag || t?.value || t || "").toString().toLowerCase();
        if (val.includes(needle)) return true;
      }
    }
  }

  // 2) Repli : nom du listing (attrape aussi les cas où le tag n'est pas exposé par l'API)
  const name = (listing.name || listing.internalListingName || listing.externalListingName || "").toLowerCase();
  if (name.includes(needle)) return true;

  return false;
}

async function getBellevilleListingIds(accessToken, accountId) {
  const now = Date.now();
  if (listingCache.ids && listingCache.key === accountId && listingCache.expiresAt > now) {
    return listingCache.ids;
  }

  const url = new URL("https://api.hostaway.com/v1/listings");
  url.searchParams.set("limit", "500");

  const r = await fetch(url, {
    method: "GET",
    headers: { "Authorization": "Bearer " + accessToken, "Cache-control": "no-cache" },
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Lecture des listings échouée (HTTP ${r.status}). ${detail.slice(0, 200)}`);
  }
  const data = await r.json();
  const listings = data.result || [];

  const ids = new Set();
  for (const l of listings) {
    if (listingMatchesBelleville(l)) {
      // id du listing = clé de rapprochement avec listingMapId des réservations
      if (l.id != null) ids.add(String(l.id));
    }
  }

  // Cache 10 min (les tags changent rarement)
  listingCache = { key: accountId, ids, expiresAt: now + 10 * 60 * 1000 };
  return ids;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule : seule la consultation est autorisée." });
  }

  const accountId = req.headers["x-hostaway-account"] || process.env.HOSTAWAY_ACCOUNT_ID;
  const apiKey = req.headers["x-hostaway-key"] || process.env.HOSTAWAY_API_KEY;
  if (!accountId || !apiKey) {
    return res.status(401).json({ error: "Account ID et API Key Hostaway requis." });
  }

  const { from, to, debug } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "Paramètres 'from' et 'to' requis (YYYY-MM-DD)." });
  }

  try {
    const accessToken = await getAccessToken(accountId, apiKey);

    // Listings Belleville (par tag, repli sur le nom)
    const bellevilleIds = await getBellevilleListingIds(accessToken, accountId);

    // Réservations du jour
    const url = new URL("https://api.hostaway.com/v1/reservations");
    url.searchParams.set("arrivalStartDate", from);
    url.searchParams.set("arrivalEndDate", to);
    url.searchParams.set("limit", "100");
    url.searchParams.set("includeResources", "1");

    const r = await fetch(url, {
      method: "GET",
      headers: { "Authorization": "Bearer " + accessToken, "Cache-control": "no-cache" },
    });
    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: `Hostaway HTTP ${r.status}`, detail: detail.slice(0, 300) });
    }
    const data = await r.json();
    const all = data.result || [];

    // Liste BLANCHE : ne garder que les réservations réellement confirmées.
    // Exclut par défaut tout ce qui n'est pas confirmé (demandes, en attente,
    // non payées) en plus des annulées. Statuts confirmés Hostaway : new, modified, ownerStay.
    const CONFIRMED_STATUSES = new Set(["new", "modified", "ownerstay"]);
    const active = all.filter(resv => {
      const status = (resv.status || "").toString().toLowerCase();
      if (!CONFIRMED_STATUSES.has(status)) return false;
      if (resv.isCancelled === true) return false;
      if (resv.cancellationDate) return false;
      return true;
    });

    // Filtre : ne garder que les réservations dont le logement est Belleville.
    // On rapproche listingMapId (résa) avec l'id du listing taggé.
    const filtered = active.filter(resv => {
      const lid = String(resv.listingMapId ?? resv.listingId ?? "");
      if (bellevilleIds.has(lid)) return true;
      // Repli supplémentaire : nom du listing dans la résa contient "belleville"
      const lname = (resv.listingName || "").toLowerCase();
      return lname.includes(TAG_FILTER);
    });

    // Enrichit chaque réservation avec le numéro de sous-unité réel (résolution
    // multi-unit via reservationUnit[].listingUnitId, comme pour le ménage).
    const enriched = filtered.map(resv => {
      const lid = String(resv.listingMapId ?? resv.listingId ?? "");
      const info = resolveApartment(resv, lid);
      return {
        ...resv,
        resolvedUnitNumber: info?.unitNumber || null,
        resolvedAppartement: info?.appartement || null,
      };
    });

    // Mode debug : renvoyer aussi les infos de diagnostic
    if (debug === "1") {
      return res.status(200).json({
        result: enriched,
        _debug: {
          bellevilleListingIds: Array.from(bellevilleIds),
          totalReservations: all.length,
          activeAfterCancelFilter: active.length,
          cancelledExcluded: all.length - active.length,
          filteredReservations: filtered.length,
          sampleReservationKeys: all[0] ? Object.keys(all[0]) : [],
          sampleReservation: all[0] || null,
        },
      });
    }

    return res.status(200).json({ result: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
