// lib/factureMenage.js
// Contrôle d'une facture de ménage (prestataire) contre les ménages réels du logiciel.
// Fonctions pures, sans dépendance réseau : utilisables côté client et testables seules.
//
// Entrées :
//  - l'annexe du prestataire (une ligne par ménage, + lignes « parties communes »),
//  - les ménages attendus (départs Hostaway + ménages supplémentaires, comme /couts).
// Le n° et le total de la facture ne sont pas saisis ici (ils le sont avec les factures) :
// le contrôle porte sur l'annexe, dont le total est recalculé ligne par ligne.
// Sortie : liste d'écarts. Seuls les écarts « réclamables » sont des surfacturations
// (à notre détriment) ; les autres sont informatifs et ne vont jamais dans le mail.

import { APARTMENTS, isDepartureMoved, isNoShowHidden } from "./apartments";

const EPS = 0.005;
const round2 = n => Math.round(n * 100) / 100;

export function normUnit(s) {
  return String(s ?? "").replace(/^\s*UNIT\s*/i, "").trim().toUpperCase();
}

// Normalise un libellé de logement de l'annexe : sans accents, en majuscules,
// sans ponctuation ni préfixe de résidence (« LANT- RDC1 » → « RDC1 »).
export function normLabel(s) {
  let t = String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  t = t.replace(/[^A-Z0-9]+/g, " ").trim();
  let prev;
  do { prev = t; t = t.replace(/^(UNIT|LANTIEZ|LANT|VILLIERS|VILL|BELLEVILLE|BELL)\b\s*/, ""); } while (t !== prev);
  return t.trim();
}

// Rapproche un libellé de l'annexe d'un numéro d'appartement du logiciel.
// 1) correspondance exacte (« 12 », « A1 », « A 1 ») ; 2) pour les résidences dont les
// appartements sont « lettre + numéro » (Lantiez A1…A8, Villiers V1…V8), le dernier
// nombre du libellé désigne l'appartement (« RDC1 » → A1, « 1ET 6 » → A6) tant qu'un
// seul appartement porte ce numéro. Sinon null : l'utilisateur choisit, le choix est mémorisé.
export function resolveLabel(label, units, saved) {
  const norm = normLabel(label);
  if (!norm) return null;
  if (saved && saved[norm] && units.includes(saved[norm])) return saved[norm];
  const compact = norm.replace(/\s/g, "");
  const exact = units.find(u => u === norm || u === compact);
  if (exact) return exact;
  const lettered = units.filter(u => /^[A-Z]+\d+$/.test(u));
  // Les numéros d'étage (« 1ET », « 2EME », « 1ER ») ne désignent pas l'appartement : on les
  // écarte, puis le dernier nombre restant est le numéro (« 1ET 6 » → 6, « 2ST RDC » → 2).
  const nums = norm.replace(/\b\d+\s*(ER|ERE|EME|E|ET|ETAGE)\b/g, " ").match(/\d+/g);
  if (nums && lettered.length) {
    const n = String(parseInt(nums[nums.length - 1], 10));
    const cands = lettered.filter(u => String(parseInt(u.replace(/\D/g, ""), 10)) === n);
    if (cands.length === 1) return cands[0];
  }
  return null;
}

export function unitsResidence(residence) {
  return Object.values(APARTMENTS).filter(a => a.residence === residence).map(a => normUnit(a.unitNumber));
}

// Affecte `unit` à chaque ligne de ménage. Retourne les libellés non rapprochés.
export function applyMapping(lines, residence, saved) {
  const units = unitsResidence(residence);
  const unresolved = new Set();
  const out = lines.map(l => {
    if (l.commune) return l;
    const unit = resolveLabel(l.label, units, saved);
    if (!unit) unresolved.add(normLabel(l.label));
    return { ...l, unit: unit || normLabel(l.label) };
  });
  return { lines: out, unresolved: [...unresolved] };
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
      label: commune ? "" : unitRaw,
      unit: "",
      date,
      desc,
      ht,
      amenities: 0,
      amenOnly: false,
      tva: tva ?? round2(ht * 0.2),
      ttc: num(r[idx.ttc]) ?? round2(ht * 1.2),
      commune,
    });
  });
  return fusionnerAmenities(lines);
}

// Certaines annexes (Lantiez) facturent le ménage et les amenities sur deux lignes
// d'une même réservation : on rattache l'amenity à son ménage (même résa, logement, date).
function fusionnerAmenities(lines) {
  const isAmen = l => !l.commune && /amenit|produits? d.?accueil/i.test(l.desc);
  const base = lines.filter(l => !isAmen(l));
  for (const a of lines.filter(isAmen)) {
    const target = base.find(l => !l.commune && l.label === a.label && l.date === a.date && l.resa === a.resa && l.amenities === 0)
      || base.find(l => !l.commune && l.label === a.label && l.date === a.date && l.amenities === 0);
    if (target) target.amenities = round2(target.amenities + a.ht);
    else base.push({ ...a, ht: 0, amenities: a.ht, amenOnly: true });
  }
  return base.sort((x, y) => x.ligne - y.ligne);
}

// Tarif attendu : { menage, amenities } (amenities null = pas de tarif connu), ou null.
function allowedFor(menageHT, amenitiesHT) {
  if (menageHT == null) return null;
  return { menage: menageHT, amenities: amenitiesHT ?? null };
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

// Surfacturation brute (ce qu'ils ont facturé sans ménage, doublons, tarifs en trop), ménages
// effectués mais non facturés (à compenser), et net = brut − compensation. Les écarts dont
// `reclamable` / `compensation` ont été mis à faux (lignes décochées) ne comptent pas.
export function totauxEcarts(ecarts) {
  const somme = f => round2(ecarts.filter(f).reduce((s, e) => s + e.montantHT, 0));
  const brutHT = somme(e => e.reclamable);
  const compensationHT = somme(e => e.compensation);
  return { brutHT, compensationHT, netHT: round2(brutHT - compensationHT) };
}

export const TYPES = {
  sans_menage: { label: "Facturé sans ménage", reclamable: true },
  doublon: { label: "Doublon", reclamable: true },
  tarif_superieur: { label: "Tarif supérieur au tarif convenu", reclamable: true },
  date_differente: { label: "Date différente du départ", reclamable: false },
  manquant: { label: "Ménage effectué, absent de l'annexe", reclamable: false },
  tarif_inferieur: { label: "Tarif inférieur au tarif convenu", reclamable: false },
  amenities_sans_tarif: { label: "Amenities sans tarif connu", reclamable: false },
  amenities_seuls: { label: "Amenities sans ménage", reclamable: false },
  unite_inconnue: { label: "Logement inconnu du logiciel", reclamable: false },
  hors_mois: { label: "Date hors du mois", reclamable: false },
};

// Les premiers contrôles enregistraient un écart « total facture » calculé à partir d'un total
// saisi à la main (source de l'erreur d'août 2026 : n° de facture tapé comme montant). Ce
// total n'est plus saisi : ces écarts sont ignorés à la relecture, sans toucher aux données.
const TYPES_RETIRES = ["total_facture", "total_annexe"];
export function nettoyerEcarts(ecarts) {
  return (ecarts || []).filter(e => !TYPES_RETIRES.includes(e.type) && TYPES[e.type]);
}

// Bilan chiffré d'un contrôle (enregistré ou en cours), écarts décochés exclus :
//  facturé (annexe) − prévu (logiciel) = écart ; net à réclamer = facturé en trop − ménages
//  faits non facturés ; « autres » = part de l'écart sans impact sur la réclamation
//  (tarifs inférieurs, dates décalées, logements sans tarif…). prevuHT est null pour les
//  contrôles enregistrés avant son calcul.
export function bilanControle(controle, ignores = []) {
  const k = e => `${e.type}|${e.unit}|${e.date}|${e.ligne}`;
  const ecarts = nettoyerEcarts(controle.ecarts).map(e => ({ ...e, reclamable: e.reclamable && !ignores.includes(k(e)), compensation: e.compensation && !ignores.includes(k(e)) }));
  const { brutHT, compensationHT, netHT } = totauxEcarts(ecarts);
  const t = controle.totaux || {};
  const prevuHT = t.prevuHT ?? null;
  const ecartHT = prevuHT == null ? null : round2(t.annexeHT - prevuHT);
  return { ecarts, annexeHT: t.annexeHT ?? null, prevuHT, ecartHT, brutHT, compensationHT, netHT, autresHT: ecartHT == null ? null : round2(ecartHT - netHT) };
}

// Lignes de l'annexe datées hors du mois contrôlé : seuls les ménages du logiciel proches
// (même logement, 7 jours max) servent à les rapprocher ; les autres départs de ces jours-là
// appartiennent à l'autre mois et ne sont pas attendus ici.
export function attendusHorsMois({ lines, expected, mois }) {
  const hors = lines.filter(l => !l.commune && !l.amenOnly && l.date && l.date.slice(0, 7) !== mois);
  return expected.filter(e => e.date.slice(0, 7) !== mois && hors.some(l => l.unit === e.unit && dayDiff(l.date, e.date) <= 7));
}

// Bornes des dates de l'annexe hors du mois (pour charger les départs correspondants), ou null.
export function plageHorsMois(lines, mois) {
  const d = lines.filter(l => !l.commune && l.date && l.date.slice(0, 7) !== mois).map(l => l.date).sort();
  if (!d.length) return null;
  const decale = (iso, n) => { const x = new Date(iso + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  return { from: decale(d[0], -7), to: decale(d[d.length - 1], 7) };
}

// lines : lignes de l'annexe ; expected : buildExpected (mois + attendusHorsMois) ; mois : "YYYY-MM" ;
// autresMois : lignes des annexes déjà contrôlées des autres mois (même résidence), pour repérer
// un ménage facturé deux fois sur deux annexes.
export function controlerFacture({ lines, expected, mois, autresMois = [] }) {
  const ecarts = [];
  const add = (type, line, montantHT, detail) =>
    ecarts.push({ type, reclamable: TYPES[type].reclamable, compensation: type === "manquant", ligne: line?.ligne ?? null, unit: line?.unit ?? "", date: line?.date ?? "", montantHT: round2(montantHT || 0), detail });

  const amenOnly = lines.filter(l => l.amenOnly);
  for (const l of amenOnly) add("amenities_seuls", l, 0, `Amenities de ${l.amenities} € HT sans ligne de ménage associée.`);
  const menage = lines.filter(l => !l.commune && !l.amenOnly);
  const communes = lines.filter(l => l.commune);
  const tot = l => l.ht + l.amenities;
  // Ménage daté d'un autre mois et déjà présent (même logement, même date) dans l'annexe
  // contrôlée de ce mois-là : facturé deux fois.
  const dejaFactures = new Set();
  for (const l of menage) {
    if (!mois || !l.date || l.date.slice(0, 7) === mois) continue;
    const autre = autresMois.find(o => !o.commune && o.unit === l.unit && o.date === l.date);
    if (autre) { dejaFactures.add(l); add("doublon", l, tot(l), `Déjà facturé dans l'annexe de ${moisLabel(autre.mois)}.`); }
  }

  const key = (u, d) => u + "|" + d;
  const expBy = {};
  for (const e of expected) (expBy[key(e.unit, e.date)] ||= []).push(e);
  const linesBy = {};
  for (const l of menage) if (!dejaFactures.has(l)) (linesBy[key(l.unit, l.date)] ||= []).push(l);

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

  // Écart de tarif sur les lignes rapprochées (ménage et amenities contrôlés séparément)
  for (const { line, exp } of matched) {
    if (!exp.allowed) {
      add("unite_inconnue", line, 0, `Pas de tarif connu pour ${exp.label || line.unit}.`);
      continue;
    }
    const { menage: tm, amenities: ta } = exp.allowed;
    if (line.ht > tm + EPS) add("tarif_superieur", line, line.ht - tm, `Ménage facturé ${line.ht} € HT, tarif convenu ${tm} € HT.`);
    else if (line.ht < tm - EPS) add("tarif_inferieur", line, 0, `Ménage facturé ${line.ht} € HT, tarif convenu ${tm} € HT.`);
    if (line.amenities > 0) {
      if (ta == null) add("amenities_sans_tarif", line, 0, `Amenities facturés ${line.amenities} € HT, aucun tarif d'amenities connu pour ce logement.`);
      else if (line.amenities > ta + EPS) add("tarif_superieur", line, line.amenities - ta, `Amenities facturés ${line.amenities} € HT, tarif convenu ${ta} € HT.`);
    }
  }

  // Lignes en surplus : date décalée, doublon ou ménage inexistant
  for (const { line, hadExpected } of surplus) {
    if (hadExpected) {
      add("doublon", line, tot(line), "Même logement et même date facturés plusieurs fois.");
      continue;
    }
    const j = unmatchedExpected.findIndex(e => e.unit === line.unit && dayDiff(e.date, line.date) <= 7);
    if (j >= 0) {
      const e = unmatchedExpected.splice(j, 1)[0];
      add("date_differente", line, 0, `Départ prévu le ${e.date}, ménage facturé le ${line.date}.`);
    } else {
      add("sans_menage", line, tot(line), "Aucun départ ni ménage dans le logiciel à cette date.");
    }
  }

  // Un départ d'un autre mois non rapproché appartient à l'annexe de ce mois-là.
  for (const e of unmatchedExpected.filter(x => !mois || x.date.slice(0, 7) === mois)) {
    const valeur = e.allowed ? e.allowed.menage + (e.allowed.amenities || 0) : 0;
    add("manquant", { unit: e.unit, date: e.date }, valeur, `${e.label || e.unit} : ménage du ${e.date} effectué mais absent de l'annexe (valeur ${valeur} € HT).`);
  }

  for (const l of menage) {
    if (mois && l.date && l.date.slice(0, 7) !== mois && !ecarts.some(e => e.ligne === l.ligne && e.reclamable))
      add("hors_mois", l, 0, `Ménage du ${fmtDate(l.date)} facturé dans l'annexe de ${moisLabel(mois)} : vérifier qu'il n'apparaît pas dans l'annexe de ${moisLabel(l.date.slice(0, 7))}.`);
  }

  const sum = a => round2(a.reduce((s, l) => s + tot(l), 0));
  const menageHT = sum([...menage, ...amenOnly]), communesHT = sum(communes);
  const annexeHT = round2(menageHT + communesHT);
  // Prévu = ménages du mois dans le logiciel (+ ceux d'un autre mois rapprochés d'une ligne de
  // l'annexe) au tarif convenu, + parties communes (pas suivies dans le logiciel : reprises
  // telles que facturées).
  const duMois = expected.filter(e => !mois || e.date.slice(0, 7) === mois || !unmatchedExpected.includes(e));
  const prevuMenagesHT = round2(duMois.reduce((s, e) => s + (e.allowed ? e.allowed.menage + (e.allowed.amenities || 0) : 0), 0));
  const prevuHT = round2(prevuMenagesHT + communesHT);

  ecarts.sort((a, b) => Number(b.reclamable) - Number(a.reclamable) || a.date.localeCompare(b.date) || a.unit.localeCompare(b.unit, undefined, { numeric: true }));
  const { brutHT: surfactureHT, compensationHT: sousFactureHT, netHT } = totauxEcarts(ecarts);
  return {
    ecarts,
    surfactureHT,
    sousFactureHT,
    netHT,
    totaux: { menageHT, communesHT, annexeHT, prevuHT, prevuMenagesHT, nbMenages: menage.length, nbCommunes: communes.length, nbAttendus: duMois.length, nbSansTarif: duMois.filter(e => !e.allowed).length },
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
export function buildReclamation({ residence, mois, resultat }) {
  const rec = resultat.ecarts.filter(e => e.reclamable);
  const comp = resultat.ecarts.filter(e => e.compensation);
  const { brutHT, compensationHT, netHT } = totauxEcarts(resultat.ecarts);
  if (!rec.length || netHT <= 0) return null;
  const quoi = e => e.unit ? `logement ${e.unit}${e.date ? `, ${fmtDate(e.date)}` : ""}` : "total";
  const lignes = rec.map(e => `- ${TYPES[e.type].label} (${quoi(e)}) : ${eur(e.montantHT)} HT. ${e.detail}`);
  const subject = `Réclamation facture ménage – ${moisLabel(mois)} – Résidence ${residence}`;
  const corps = [
    "Bonjour,",
    "",
    `Après vérification de votre facture de ${moisLabel(mois)} (Résidence ${residence}) et de son annexe, nous relevons les points suivants, facturés à tort :`,
    "",
    ...lignes,
    "",
    `Soit ${eur(brutHT)} HT facturés en trop.`,
  ];
  if (comp.length) {
    corps.push(
      "",
      "À l'inverse, les ménages suivants ont bien été effectués mais ne figurent pas dans votre annexe ; nous les déduisons de la réclamation :",
      "",
      ...comp.map(e => `- ${quoi(e)} : ${eur(e.montantHT)} HT.`),
      "",
      `Soit ${eur(compensationHT)} HT à compenser.`,
    );
  }
  corps.push(
    "",
    `Montant net à déduire de la facture : ${eur(netHT)} HT (${eur(round2(netHT * 1.2))} TTC). Merci de nous adresser un avoir correspondant ou de nous transmettre les justificatifs des ménages concernés.`,
    "",
    "Cordialement,",
  );
  return { subject, body: corps.join("\n") };
}
