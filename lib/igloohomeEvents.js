// lib/igloohomeEvents.js
// Lecture des envois du webhook igloohome (isomorphe, sans dépendance serveur).
// Un envoi = { recuLe, corps: { payload: { event: { type, date, data, proxyId }, product: { id } } } }.
// type 5 : journal de la serrure (data.activityLogs[] : entryDate en secondes, logType, keyId…)
// type 3 : commande passée par le bridge (« job »), par ex. un déverrouillage à distance.
import { apartmentName, CIBLE_IGNORER, CIBLE_COMMUN } from "./croisement";

// Ce qui est établi par des essais réels. Le reste est affiché comme « inconnu ».
export const LOG_TYPES = {
  11: "Ouverture depuis l'application (à distance)",
  13: "Reverrouillage (à confirmer)",
};
export const EVENT_TYPES = { 3: "Commande via le bridge", 5: "Journal de la serrure" };

function target(mapping, deviceId) {
  const m = mapping?.[deviceId];
  if (!m) return { serrure: deviceId || "?", appartement: "Serrure inconnue" };
  let appartement = "Non attribuée";
  if (m.cible === CIBLE_IGNORER) appartement = "Ignorée";
  else if (m.cible === CIBLE_COMMUN) appartement = "Porte commune";
  else if (m.cible) appartement = apartmentName(m.cible);
  return { serrure: m.nom || deviceId, appartement };
}

export function flattenWebhooks(envois = [], mapping = {}) {
  const rows = [];
  for (const e of envois) {
    const ev = e?.corps?.payload?.event;
    const deviceId = e?.corps?.payload?.product?.id || "";
    const recuMs = Date.parse(e?.recuLe);
    const base = { recuMs: Number.isFinite(recuMs) ? recuMs : null, deviceId, bridge: ev?.proxyId || "", eventType: ev?.type ?? null, ...target(mapping, deviceId) };
    if (!ev) { rows.push({ ...base, ms: base.recuMs, quoi: "Envoi non reconnu" }); continue; }
    const logs = ev?.data?.activityLogs;
    if (Array.isArray(logs) && logs.length) {
      for (const l of logs) {
        const ms = Number.isFinite(Number(l?.entryDate)) ? Number(l.entryDate) * 1000 : Date.parse(ev.date);
        rows.push({ ...base, ms, logType: l?.logType ?? null, keyId: l?.keyId ?? null, operationId: l?.operationId ?? null,
          quoi: LOG_TYPES[l?.logType] || `Type ${l?.logType} (inconnu)` });
      }
    } else {
      const ms = Date.parse(ev.date);
      rows.push({ ...base, ms: Number.isFinite(ms) ? ms : base.recuMs, jobStatus: ev?.data?.jobStatus ?? null,
        quoi: EVENT_TYPES[ev.type] || `Événement de type ${ev.type} (inconnu)` });
    }
  }
  return rows.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
}

const fmt = ms => (ms === null || ms === undefined) ? "" : new Date(ms).toLocaleString("fr-FR", { timeZone: "Europe/Paris" });

export function rowsToText(rows) {
  const head = ["Heure (Paris)", "Appartement", "Serrure", "Quoi", "logType", "keyId", "operationId", "Reçu (Paris)"];
  const lines = rows.map(r => [fmt(r.ms), r.appartement, r.serrure, r.quoi, r.logType ?? "", r.keyId ?? "", r.operationId ?? "", fmt(r.recuMs)].join("\t"));
  return [head.join("\t"), ...lines].join("\n");
}

export { fmt as formatParis };
