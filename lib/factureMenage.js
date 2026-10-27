// lib/factureMenage.js
// Contrôle d'une facture de ménage (prestataire) contre les ménages réels du logiciel.
// Fonctions pures, sans dépendance réseau : utilisables côté client et testables seules.
//
// Entrées :
//  - l'annexe du prestataire (une ligne par ménage, + lignes « parties communes »),
//  - les ménages attendus (départs Hostaway + ménages supplémentaires, comme /couts),
//  - les totaux de la facture.
// Sortie : liste d'écarts. Seuls les écarts « réclamables » sont des surfacturations
// (à notre détriment) ; les autres sont informatifs et ne vont jamais dans le mail.

import { APARTMENTS, isDepartureMoved, isNoShowHidden } from "./apartments";

const EPS = 0.005;
const round2 = n => Math.round(n * 100) / 100;

export function normUnit(s) {
  return String(s ?? "").replace(/^\s*UNIT\s*/i, "").trim().toUpperCase();
}

function toIso(v) {
  if (!v) return "";
  if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

function num(v) {
  if (v && typeof v === "object" && "result" in v) v = v.result;
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

const COLS = {
  resa: /reservation/i,
  guest: /guest|name/i,
  unit: /unit/i,
  date: /cleaning date|date/i,
  invoice: /invoice number/i,
  desc: /description/i,
  ht: /^ht$/i,
  tva: /^tva$/i,
  ttc: /^ttc$/i,
};

// rows : tableau de tableaux (première ligne = en-têtes), tel que lu dans le XLSX.
// Les lignes sans date ni unité (ligne de totaux, lignes vides) sont ignorées :
// les totaux sont toujours recalculés, jamais lus.
export function parseAnnexeRows(rows) {
  const headerIdx = rows.findIndex(r => (r || []).some(c => /^\s*ht\s*$/i.test(String(c?.result ?? c ?? ""))));
  if (headerIdx < 0) throw new Error("En-têtes introuvables (colonnes HT / Unit ID / Cleaning Date attendues).");
  const header = rows[headerIdx].map(c => String(c ?? "").trim());
  const idx = {};
  for (const [k, re] of Object.entries(COLS)) {
    const i = header.findIndex((h, j) => re.test(h) && !Object.values(idx).includes(j));
    if (i >= 0) idx[k] = i;
  }
  for (const k of ["unit", "date", "ht"]) {
    if (idx[k] == null) throw new Error(`Colonne « ${k} » introuvable dans l'annexe.`);
  }
  const lines = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    r = r || [];
    const unitRaw = String(r[idx.unit] ?? "").trim();
    const date = toIso(r[idx.date]);
    const ht = num(r[idx.ht]);
    if (!unitRaw && !date) return;
    if (ht == null) return;
    const desc = String(r[idx.desc] ?? "").trim();
    const commune = /commun|parti/i.test(unitRaw) || /commun|parti/i.test(desc);
    const tva = num(r[idx.tva]);
    lines.push({
      ligne: headerIdx + 2 + i,
      resa: r[idx.resa] != null ? String(r[idx.resa]) : "",
      unit: commune ? "" : normUnit(unitRaw),
      date,
      desc,
      ht,
      tva: tva ?? round2(ht * 0.2),
      ttc: num(r[idx.ttc]) ?? round2(ht * 1.2),
      commune,
    });
  });
  return lines;
}

function allowedFor(menageHT, amenitiesHT) {
  if (menageHT == null) return [];
  return [menageHT, menageHT + (amenitiesHT || 0)];
}

export function tarifsResidence(residence) {
  const byUnit = {};
  for (const a of Object.values(APARTMENTS)) {
    if (a.residence === residence) byUnit[normUnit(a.unitNumber)] = allowedFor(a.menageHT, a.amenitiesHT);
  }
  return byUnit;
}

// Ménages attendus (même règle que /couts : décalés, no-show et doublons évités).
// groups = réponse de /api/departures ; extras / hidden = collections Firestore.
export function buildExpected({ residence, from, to, groups, extras, hidden }) {
  const out = [];
  for (const g of groups || []) {
    if (g.residence !== residence) continue;
    for (const it of g.items) {
      if (isDepartureMoved(it, extras) || isNoShowHidden(it, hidden)) continue;
      out.push({ unit: normUnit(it.unitNumber), date: it.depart, label: it.appartement, allowed: allowedFor(it.menageHT, it.amenitiesHT), source: "depart" });
    }
  }
  for (const e of extras || []) {
    if (e.residence !== residence || !e.date || e.date < from || e.date > to) continue;
    if (isNoShowHidden(e, hidden)) continue;
    const u = normUnit(e.unitNumber);
    if (e.type === "decale" && out.some(o => o.unit === u && o.date === e.date)) continue;
    out.push({ unit: u, date: e.date, label: e.appartement, allowed: allowedFor(e.menageHT, e.amenitiesHT), source: "supplementaire" });
  }
  return out;
}

function dayDiff(a, b) {
  return Math.abs((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 86400000);
}

export const TYPES = {
  sans_menage: { label: "Facturé sans ménage", reclamable: true },
  doublon: { label: "Doublon", reclamable: true },
  tarif_superieur: { label: "Tarif supérieur au tarif convenu", reclamable: true },
  total_facture: { label: "Facture supérieure à l'annexe", reclamable: true },
  date_differente: { label: "Date différente du départ", reclamable: false },
  manquant: { label: "Ménage absent de l'annexe", reclamable: false },
  tarif_inferieur: { label: "Tarif inférieur au tarif convenu", reclamable: false },
  unite_inconnue: { label: "Logement inconnu du logiciel", reclamable: false },
  total_annexe: { label: "Annexe supérieure à la facture", reclamable: false },
  hors_mois: { label: "Date hors du mois", reclamable: false },
};

// lines : lignes de l'annexe ; expected : buildExpected ; facture : { ht } ; mois : "YYYY-MM"
export function controlerFacture({ lines, expected, facture, mois }) {
  const ecarts = [];
  const add = (type, line, montantHT, detail) =>
    ecarts.push({ type, reclamable: TYPES[type].reclamable, ligne: line?.ligne ?? null, unit: line?.unit ?? "", date: line?.date ?? "", montantHT: round2(montantHT || 0), detail });

  const menage = lines.filter(l => !l.commune);
  const communes = lines.filter(l => l.commune);

  const key = (u, d) => u + "|" + d;
  const expBy = {};
  for (const e of expected) (expBy[key(e.unit, e.date)] ||= []).push(e);
  const linesBy = {};
  for (const l of menage) (linesBy[key(l.unit, l.date)] ||= []).push(l);

  const unmatchedExpected = [];
  const surplus = [];
  const matched = [];

  for (const k of new Set([...Object.keys(expBy), ...Object.keys(linesBy)])) {
    const ex = (expBy[k] || []).slice();
    const ls = (linesBy[k] || []).slice();
    const n = Math.min(ex.length, ls.length);
    for (let i = 0; i < n; i++) matched.push({ line: ls[i], exp: ex[i] });
    for (const l of ls.slice(n)) surplus.push({ line: l, hadExpected: ex.length > 0 });
    for (const e of ex.slice(n)) unmatchedExpected.push(e);
  }

  // Écart de tarif sur les lignes rapprochées
  for (const { line, exp } of matched) {
    if (!exp.allowed.length) {
      add("unite_inconnue", line, 0, `Pas de tarif connu pour ${exp.label || line.unit}.`);
      continue;
    }
    const max = Math.max(...exp.allowed), min = Math.min(...exp.allowed);
    if (line.ht > max + EPS) add("tarif_superieur", line, line.ht - max, `Facturé ${line.ht} € HT, tarif convenu ${max} € HT.`);
    else if (line.ht < min - EPS) add("tarif_inferieur", line, 0, `Facturé ${line.ht} € HT, tarif convenu ${min} € HT.`);
  }

  // Lignes en surplus : date décalée, doublon ou ménage inexistant
  for (const { line, hadExpected } of surplus) {
    if (hadExpected) {
      add("doublon", line, line.ht, "Même logement et même date facturés plusieurs fois.");
      continue;
    }
    const j = unmatchedExpected.findIndex(e => e.unit === line.unit && dayDiff(e.date, line.date) <= 7);
    if (j >= 0) {
      const e = unmatchedExpected.splice(j, 1)[0];
      add("date_differente", line, 0, `Départ prévu le ${e.date}, ménage facturé le ${line.date}.`);
    } else {
      add("sans_menage", line, line.ht, "Aucun départ ni ménage dans le logiciel à cette date.");
    }
  }

  for (const e of unmatchedExpected) {
    add("manquant", { unit: e.unit, date: e.date }, 0, `${e.label || e.unit} : ménage du ${e.date} non présent dans l'annexe.`);
  }

  for (const l of menage) {
    if (mois && l.date && l.date.slice(0, 7) !== mois) add("hors_mois", l, 0, `Date ${l.date} en dehors de ${mois}.`);
  }

  const sum = a => round2(a.reduce((s, l) => s + l.ht, 0));
  const menageHT = sum(menage), communesHT = sum(communes);
  const annexeHT = round2(menageHT + communesHT);
  const factureHT = facture?.ht != null ? round2(facture.ht) : null;
  if (factureHT != null && Math.abs(factureHT - annexeHT) > 0.01) {
    const diff = round2(factureHT - annexeHT);
    if (diff > 0) add("total_facture", null, diff, `Facture ${factureHT} € HT, annexe ${annexeHT} € HT.`);
    else add("total_annexe", null, 0, `Facture ${factureHT} € HT, annexe ${annexeHT} € HT.`);
  }

  ecarts.sort((a, b) => Number(b.reclamable) - Number(a.reclamable) || a.date.localeCompare(b.date) || a.unit.localeCompare(b.unit, undefined, { numeric: true }));
  const surfactureHT = round2(ecarts.filter(e => e.reclamable).reduce((s, e) => s + e.montantHT, 0));
  return {
    ecarts,
    surfactureHT,
    totaux: { menageHT, communesHT, annexeHT, factureHT, nbMenages: menage.length, nbCommunes: communes.length, nbAttendus: expected.length },
  };
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export function moisLabel(mois) {
  const [y, m] = String(mois).split("-");
  return `${MOIS[Number(m) - 1] || mois} ${y}`;
}
const fmtDate = d => d ? d.split("-").reverse().join("/") : "";
const eur = n => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

// Brouillon de réclamation : uniquement les écarts à notre détriment (réclamables).
// Retourne null s'il n'y en a aucun : aucun mail n'est proposé.
export function buildReclamation({ residence, mois, numero, resultat }) {
  const rec = resultat.ecarts.filter(e => e.reclamable);
  if (!rec.length) return null;
  const lignes = rec.map(e => {
    const quoi = e.unit ? `logement ${e.unit}${e.date ? `, ${fmtDate(e.date)}` : ""}` : "total";
    return `- ${TYPES[e.type].label} (${quoi}) : ${eur(e.montantHT)} HT. ${e.detail}`;
  });
  const total = resultat.surfactureHT;
  const subject = `Réclamation facture${numero ? ` n° ${numero}` : ""} – ${moisLabel(mois)} – Résidence ${residence}`;
  const body = [
    "Bonjour,",
    "",
    `Après vérification de votre facture${numero ? ` n° ${numero}` : ""} de ${moisLabel(mois)} (Résidence ${residence}) et de son annexe, nous relevons les points suivants, facturés à tort :`,
    "",
    ...lignes,
    "",
    `Soit un total de ${eur(total)} HT (${eur(round2(total * 1.2))} TTC) à déduire de la facture. Merci de nous adresser un avoir correspondant ou de nous transmettre les justificatifs de ces ménages.`,
    "",
    "Cordialement,",
  ].join("\n");
  return { subject, body };
}
