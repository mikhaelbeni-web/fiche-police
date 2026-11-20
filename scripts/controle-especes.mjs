// scripts/controle-especes.mjs — contrôle indépendant de la caisse, en LECTURE SEULE.
// Utilisé par la tâche quotidienne « Contrôle des espèces » (et à la main) :
//
//   node --import ./tests/loader.mjs scripts/controle-especes.mjs [--etat fichier.json] [--json]
//
// 1. relit cash_entries et cash_recoveries ;
// 2. recalcule la caisse et cherche les anomalies (lib/especesControle.js) ;
// 3. avec --etat : compare à la photo de la veille (lignes disparues, montants retouchés,
//    nouvelles lignes), puis remplace la photo. C'est le seul moyen de voir une ligne
//    effacée directement dans la base (la page, elle, n'efface plus rien).
//
// Base fermée (après la bascule des règles) : passer un jeton dans FIRESTORE_BEARER.
// N'écrit jamais dans Firestore.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";
import { controlerCaisse, jourParis } from "../lib/especesControle.js";

// Valeurs Firestore REST -> JS.
function depuisFs(v) {
  if (!v || typeof v !== "object" || "nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(depuisFs);
  if ("mapValue" in v) return champsDepuisFs(v.mapValue.fields || {});
  return null;
}
function champsDepuisFs(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = depuisFs(v);
  return out;
}
// JSON stable (clés triées) : même contenu -> même empreinte.
function canonique(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canonique).join(",") + "]";
  return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonique(v[k])).join(",") + "}";
}

const PROJET = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "beylev-linge";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJET}/databases/(default)/documents`;
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

async function lister(coll) {
  const out = [];
  let page = "";
  for (let i = 0; i < 50; i++) {
    const url = `${BASE}/${coll}?pageSize=300${page ? "&pageToken=" + encodeURIComponent(page) : ""}`;
    const headers = process.env.FIRESTORE_BEARER ? { Authorization: `Bearer ${process.env.FIRESTORE_BEARER}` } : {};
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (r.status === 403 || r.status === 401) throw new Error(`Lecture de ${coll} refusée (HTTP ${r.status}) : base fermée, définir FIRESTORE_BEARER.`);
    if (!r.ok) throw new Error(`Lecture de ${coll} : HTTP ${r.status}`);
    const d = await r.json();
    for (const doc of d.documents || []) out.push({ id: doc.name.split("/").pop(), champs: champsDepuisFs(doc.fields || {}), createTime: doc.createTime, updateTime: doc.updateTime });
    if (!d.nextPageToken) break;
    page = d.nextPageToken;
  }
  return out;
}

const empreinte = champs => crypto.createHash("sha256").update(canonique(champs)).digest("hex");

const [entreesL, recupsL] = await Promise.all([lister("cash_entries"), lister("cash_recoveries")]);
const entrees = entreesL.map(d => ({ id: d.id, ...d.champs }));
const recups = recupsL.map(d => ({ id: d.id, ...d.champs }));

const controle = controlerCaisse(entrees, recups);
const anomalies = [...controle.anomalies];

// Comparaison avec la photo précédente.
const photo = Object.fromEntries([
  ...entreesL.map(d => [`cash_entries/${d.id}`, { h: empreinte(d.champs), resume: `${d.champs.date} · ${d.champs.type === "client" ? "Paiement" : "Dépense"} · ${d.champs.client || d.champs.fournisseur || ""} · ${d.champs.designation || ""} · ${d.champs.amount} € · ${d.champs.saisiPar || "?"}`, amount: d.champs.amount, recoveryId: d.champs.recoveryId || null, deleted: !!d.champs.deleted }]),
  ...recupsL.map(d => [`cash_recoveries/${d.id}`, { h: empreinte(d.champs), resume: `Récupération ${d.champs.date} · ${d.champs.amountRecovered} € · laissé ${d.champs.amountLeftInBox} €`, amount: d.champs.amountRecovered, deleted: !!d.champs.deleted }]),
]);
const nouvelles = [];
const fichierEtat = opt("--etat");
let photoPrecedente = null;
if (fichierEtat && existsSync(fichierEtat)) {
  try { photoPrecedente = JSON.parse(readFileSync(fichierEtat, "utf8")); } catch { photoPrecedente = null; }
}
if (photoPrecedente?.docs) {
  for (const [cle, avant] of Object.entries(photoPrecedente.docs)) {
    const apres = photo[cle];
    if (!apres) anomalies.unshift({ niveau: "grave", code: "efface", titre: "Ligne effacée de la base depuis le dernier contrôle", detail: `${avant.resume} (contrôle précédent : ${photoPrecedente.le})`, ids: [cle] });
    else if (apres.h !== avant.h) {
      const seulRattachement = apres.amount === avant.amount && !avant.recoveryId && apres.recoveryId;
      if (apres.deleted && !avant.deleted) continue; // suppression tracée : déjà listée par le contrôle
      if (!seulRattachement) anomalies.push({ niveau: "attention", code: "modifie", titre: "Ligne modifiée depuis le dernier contrôle", detail: `Avant : ${avant.resume}\nMaintenant : ${apres.resume}`, ids: [cle] });
    }
  }
  for (const [cle, d] of Object.entries(photo)) if (!photoPrecedente.docs[cle]) nouvelles.push(d.resume);
}
if (fichierEtat) writeFileSync(fichierEtat, JSON.stringify({ le: new Date().toISOString(), docs: photo }, null, 1));

const ordre = { grave: 0, attention: 1, info: 2 };
anomalies.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
const resultat = {
  controleLe: controle.controleLe, jour: jourParis(),
  caisse: controle.etat,
  nbLignes: entrees.length, nbRecuperations: recups.length,
  photoPrecedente: photoPrecedente?.le || null, nouvelles, anomalies,
};

if (args.includes("--json")) {
  console.log(JSON.stringify(resultat, null, 1));
} else {
  const e = controle.etat;
  const euros = n => `${(Number(n) || 0).toFixed(2).replace(".", ",")} €`;
  const l = [];
  l.push(`Contrôle des espèces du ${resultat.jour}`);
  l.push(`En caisse selon le logiciel : ${euros(e.total)} (reliquat ${euros(e.baseline)} + encaissé ${euros(e.sumClient)} − dépensé ${euros(e.sumExpense)}, ${e.nbEnCours} ligne(s) en cours)`);
  l.push(`Dernière récupération : ${e.derniere ? `${e.derniere.date}, ${euros(e.derniere.amountRecovered)} récupérés` : "aucune"}`);
  const graves = anomalies.filter(a => a.niveau === "grave").length;
  l.push(graves ? `${graves} anomalie(s) grave(s)` : (anomalies.length ? "Rien de grave" : "Aucune anomalie"));
  for (const a of anomalies) l.push(`- [${a.niveau}] ${a.titre} : ${a.detail}`);
  if (photoPrecedente) l.push(`Nouveau depuis le ${photoPrecedente.le} : ${nouvelles.length ? "\n  " + nouvelles.join("\n  ") : "rien"}`);
  console.log(l.join("\n"));
}
process.exitCode = anomalies.some(a => a.niveau === "grave") ? 2 : 0;
