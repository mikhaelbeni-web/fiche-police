// pages/api/reservations.js
// Lecture seule stricte. Fait l'échange OAuth Hostaway (Account ID + API Key -> access token)
// puis lit les réservations. Le token est mis en cache en mémoire pour éviter de le
// régénérer à chaque appel.

// Cache mémoire simple (persiste tant que la fonction serveur reste "chaude")
let tokenCache = { key: null, accessToken: null, expiresAt: 0 };

async function getAccessToken(accountId, apiKey) {
  const cacheKey = accountId + ":" + apiKey.slice(0, 8);
  const now = Date.now();

  // Réutilise le token en cache s'il est encore valide (marge 60s)
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-control": "no-cache",
    },
    body: body.toString(),
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Auth Hostaway échouée (HTTP ${r.status}). Vérifie l'Account ID et l'API Key. ${detail.slice(0, 200)}`);
  }

  const data = await r.json();
  const accessToken = data.access_token;
  const expiresIn = (data.expires_in || 60 * 60 * 24) * 1000; // secondes -> ms

  tokenCache = { key: cacheKey, accessToken, expiresAt: now + expiresIn };
  return accessToken;
}

export default async function handler(req, res) {
  // === SÉCURITÉ : lecture seule stricte ===
  // Cette route n'accepte QUE des requêtes GET. Toute tentative d'écriture est rejetée.
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule : seule la consultation est autorisée." });
  }

  // Identifiants : depuis les headers envoyés par le front, ou les variables d'env Vercel
  const accountId = req.headers["x-hostaway-account"] || process.env.HOSTAWAY_ACCOUNT_ID;
  const apiKey = req.headers["x-hostaway-key"] || process.env.HOSTAWAY_API_KEY;

  if (!accountId || !apiKey) {
    return res.status(401).json({ error: "Account ID et API Key Hostaway requis." });
  }

  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "Paramètres 'from' et 'to' requis (YYYY-MM-DD)." });
  }

  try {
    // 1) Obtenir l'access token (OAuth, généré et mis en cache automatiquement)
    const accessToken = await getAccessToken(accountId, apiKey);

    // 2) Lire les réservations (GET uniquement — aucune écriture)
    const url = new URL("https://api.hostaway.com/v1/reservations");
    url.searchParams.set("arrivalStartDate", from);
    url.searchParams.set("arrivalEndDate", to);
    url.searchParams.set("limit", "100");
    url.searchParams.set("includeResources", "1");

    const r = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Cache-control": "no-cache",
      },
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: `Hostaway HTTP ${r.status}`, detail: detail.slice(0, 300) });
    }

    const data = await r.json();
    return res.status(200).json({ result: data.result || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
