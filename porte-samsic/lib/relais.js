// porte-samsic/lib/relais.js
// SERVEUR UNIQUEMENT. Appels vers Hotel Desk (fiche-police), qui détient le jeton Nuki
// et ne connaît qu'UNE serrure (voir lib/porte.js là-bas). Ce portail n'a que la clé
// partagée PORTE_SAMSIC_CLE, envoyée en « Authorization: Bearer ». L'adresse de
// l'opérateur est transmise (X-Porte-Origine) pour les journaux côté Hotel Desk.
// HOTEL_DESK_BYPASS (prévisualisation seulement) : secret « Protection Bypass for
// Automation » du projet fiche-police, pour atteindre une prévisualisation protégée
// par Vercel. Inutile en production (fiche-police.vercel.app est public).

const TIMEOUT_MS = 25000;

export class RelaisError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function base() {
  return (process.env.HOTEL_DESK_URL || "").trim().replace(/\/+$/, "");
}

export async function appelerRelais(chemin, { method = "GET", body, origine, fetchImpl = fetch } = {}) {
  const cle = (process.env.PORTE_SAMSIC_CLE || "").trim();
  if (!base() || !cle) throw new RelaisError("Relais non configuré (HOTEL_DESK_URL, PORTE_SAMSIC_CLE).", 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetchImpl(base() + chemin, {
      method,
      headers: {
        Authorization: `Bearer ${cle}`,
        Accept: "application/json",
        ...(process.env.HOTEL_DESK_BYPASS ? { "x-vercel-protection-bypass": process.env.HOTEL_DESK_BYPASS.trim() } : {}),
        ...(origine ? { "X-Porte-Origine": String(origine).slice(0, 80) } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new RelaisError(e.name === "AbortError" ? "Le relais ne répond pas (délai dépassé)." : "Relais injoignable.", 502);
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (r.status === 404) throw new RelaisError("Le relais refuse la clé du portail : configuration à vérifier.", 502);
  if (!r.ok || !data || data.ok !== true) {
    const msg = (data && data.error) || `Erreur du relais (HTTP ${r.status}).`;
    throw new RelaisError(msg, r.status === 429 || r.status === 409 ? r.status : 502);
  }
  return data;
}

export function lireEtat(opts) {
  return appelerRelais("/api/porte/etat", opts);
}

export function envoyerAction(action, opts) {
  return appelerRelais("/api/porte/action", { ...opts, method: "POST", body: { action } });
}
