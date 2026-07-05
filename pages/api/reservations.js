// pages/api/reservations.js
// Appel serveur vers l'API Hostaway — évite le CORS et n'expose pas le token au navigateur.

export default async function handler(req, res) {
  // === SÉCURITÉ : lecture seule stricte ===
  // Cette route n'accepte QUE des requêtes GET (lecture). Toute tentative
  // d'écriture (POST, PUT, PATCH, DELETE) est rejetée avant tout traitement.
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule : seule la consultation est autorisée." });
  }

  // Token : soit depuis le header envoyé par le front, soit depuis la variable d'env Vercel
  const token = req.headers["x-hostaway-token"] || process.env.HOSTAWAY_TOKEN;
  const accountId = req.headers["x-hostaway-account"] || process.env.HOSTAWAY_ACCOUNT_ID;

  if (!token) {
    return res.status(401).json({ error: "Token Hostaway manquant. Colle ton token dans l'app." });
  }

  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: "Paramètres 'from' et 'to' requis (YYYY-MM-DD)." });
  }

  try {
    const url = new URL("https://api.hostaway.com/v1/reservations");
    url.searchParams.set("arrivalStartDate", from);
    url.searchParams.set("arrivalEndDate", to);
    url.searchParams.set("limit", "100");
    url.searchParams.set("includeResources", "1");

    const headers = {
      "Authorization": "Bearer " + token,
      "Cache-control": "no-cache",
    };
    if (accountId) headers["Account-Id"] = accountId;

    // SÉCURITÉ : method: "GET" explicite. L'app ne fait JAMAIS d'appel
    // d'écriture vers Hostaway — aucun POST/PUT/PATCH/DELETE n'existe dans ce code.
    const r = await fetch(url, { method: "GET", headers });
    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: `Hostaway HTTP ${r.status}`, detail: body.slice(0, 300) });
    }
    const data = await r.json();
    return res.status(200).json({ result: data.result || [] });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
}
