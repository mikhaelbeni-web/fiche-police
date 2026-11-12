// lib/bordereauLinge.js
// Bordereaux d'expédition Elis (un par livraison) et contrôle de la facture
// mensuelle : la quantité facturée de chaque article doit être exactement la
// somme des quantités livrées sur les bordereaux du mois.
//
// Le PDF du bordereau (« BORDEREAU D'EXPEDITION – LIVRAISON DU jj/mm/aaaa »)
// est tourné de 90° comme la facture : on le lit avec lireLignesPdf
// (lib/factureLinge.js), qui redresse les positions. Elis n'a pas de numéro de
// bordereau fiable (mikhael) : un bordereau s'identifie par sa date de livraison
// et sa date + heure de saisie, imprimée en bas (« Lun 09/11/2026 - 20:28:00 »).
// Fonctions pures, sans Firestore.

import { LINEN_ARTICLES, ELIS_INVOICE_ARTICLES } from "./linen";

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

function isoDate(dmy) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(dmy || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

export function lignesVidesBordereau() {
  const l = {};
  for (const a of ELIS_INVOICE_ARTICLES) l[a.id] = { aLivrer: 0, livree: 0 };
  return l;
}

// Lit le texte d'un bordereau (une chaîne par ligne). Renvoie
// { saisieLe, dateLivraison, lines: { [idArticleFacture]: { aLivrer, livree } }, avertissements }.
export function analyserBordereauElis(lignes) {
  const texte = lignes.join("\n");
  const avertissements = [];
  if (!/BORDEREAU\s+D.?EXP[EÉ]DITION/i.test(texte)) avertissements.push("Ce PDF ne ressemble pas à un bordereau d'expédition Elis.");
  const dateLivraison = isoDate((/LIVRAISON\s+DU\s+(\d{2}\/\d{2}\/\d{4})/i.exec(texte) || [])[1]);
  if (!dateLivraison) avertissements.push("Date de livraison introuvable.");
  // Date + heure de saisie : la date suivie d'une heure (« 09/11/2026 - 20:28:00 »).
  const ms = /(\d{2}\/\d{2}\/\d{4})\s*[-–]?\s*(\d{2}):(\d{2})(?::(\d{2}))?/.exec(texte);
  const saisieLe = ms ? `${isoDate(ms[1])}T${ms[2]}:${ms[3]}` : "";
  if (!saisieLe) avertissements.push("Date et heure de saisie introuvables : à saisir.");

  const lines = lignesVidesBordereau();
  const connus = ELIS_INVOICE_ARTICLES.map(a => ({ ...a, n: norm(a.label) }));
  let trouves = 0;
  for (const ligne of lignes) {
    const n = norm(ligne);
    const art = connus.find(a => n.includes(a.n));
    if (!art) continue;
    // Retire code + libellé (sous-séquence des caractères du libellé), puis lit les entiers.
    let i = 0, k = 0;
    while (i < ligne.length && k < art.n.length) {
      if (norm(ligne[i]) === art.n[k]) k++;
      i++;
    }
    const entiers = ligne.slice(i).split(/\s+/).filter(t => /^\d+$/.test(t)).map(Number);
    if (!entiers.length) continue;
    // Colonnes : Quantité à livrer, Quantité livrée, (Quantité visée).
    const aLivrer = entiers[0];
    const livree = entiers.length >= 2 ? entiers[1] : entiers[0];
    lines[art.id] = { aLivrer: lines[art.id].aLivrer + aLivrer, livree: lines[art.id].livree + livree };
    trouves++;
    if (aLivrer !== livree) avertissements.push(`${art.label} : ${aLivrer} à livrer, ${livree} livrés (c'est la quantité livrée qui compte).`);
  }
  if (!trouves) avertissements.push("Aucun article reconnu sur ce bordereau.");
  return { saisieLe, dateLivraison, lines, avertissements };
}

// Quantités livrées d'un bordereau, regroupées par catégorie suivie dans le logiciel.
export function quantitesParCategorie(lines) {
  const q = {};
  for (const a of LINEN_ARTICLES) q[a.key] = 0;
  for (const a of ELIS_INVOICE_ARTICLES) q[a.key] += Number(lines?.[a.id]?.livree) || 0;
  return q;
}

// Bordereau comparé aux réceptions saisies le même jour dans l'onglet Réceptions.
export function controleReception(bordereau, receptions) {
  const duJour = (receptions || []).filter(r => (r.date || "").slice(0, 10) === bordereau.dateLivraison);
  if (!duJour.length) return { statut: "aucune", ecarts: [] };
  const recu = {};
  for (const a of LINEN_ARTICLES) recu[a.key] = duJour.reduce((s, r) => s + (Number(r.quantities?.[a.key]) || 0), 0);
  const livre = quantitesParCategorie(bordereau.lines);
  const ecarts = LINEN_ARTICLES.filter(a => livre[a.key] !== recu[a.key]).map(a => ({ key: a.key, label: a.label, bordereau: livre[a.key], recu: recu[a.key] }));
  return { statut: ecarts.length ? "different" : "identique", ecarts };
}

// Bordereaux dont la date de livraison tombe dans la période de la facture.
export function bordereauxDeLaPeriode(bordereaux, inv) {
  return (bordereaux || [])
    .filter(b => b.dateLivraison && b.dateLivraison >= inv.periodFrom && b.dateLivraison <= inv.periodTo)
    .sort((a, b) => a.dateLivraison.localeCompare(b.dateLivraison) || String(a.saisieLe || "").localeCompare(String(b.saisieLe || "")));
}

// Facture comparée aux bordereaux, ligne de facture par ligne de facture.
// ecart = facturé − livré selon les bordereaux (positif = facturé en trop).
export function comparerFactureBordereaux(inv, bordereaux) {
  const liste = bordereauxDeLaPeriode(bordereaux, inv);
  const lignes = ELIS_INVOICE_ARTICLES.map(a => {
    const facture = Number(inv.lines?.[a.id]?.qte) || 0;
    const prix = Number(inv.lines?.[a.id]?.prixUnitaire) || 0;
    const detail = liste
      .map(b => ({ saisieLe: b.saisieLe, date: b.dateLivraison, qte: Number(b.lines?.[a.id]?.livree) || 0 }))
      .filter(d => d.qte > 0);
    const livre = detail.reduce((s, d) => s + d.qte, 0);
    const ecart = facture - livre;
    return { id: a.id, label: a.label, facture, livre, ecart, prix, ecartEuros: ecart * prix, detail };
  }).filter(l => l.facture || l.livre);
  const enTrop = lignes.reduce((s, l) => s + Math.max(0, l.ecartEuros), 0);
  const enMoins = lignes.reduce((s, l) => s + Math.max(0, -l.ecartEuros), 0);
  return { bordereaux: liste, lignes, conforme: lignes.every(l => l.ecart === 0), enTrop, enMoins };
}

// Noms courts des articles dans la liste des bordereaux du mail.
const COURT = { drap_clas: "Drap", drap_cocoon: "Drap bain", drap_horizon: "Drap bain Horizon", housse_stella: "Housse", eponge_cocoon: "Serv. éponge", eponge_horizon: "Serv. éponge Horizon", taie_clas: "Taie", tapis_harmony: "Tapis", torchon_carreaux: "Torchon" };
const eur = n => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fr = iso => (iso || "").slice(0, 10).split("-").reverse().join("/");
// « livraison du 10/11/2026 (saisi le 09/11/2026 à 20:28) »
export function libelleBordereau(b) {
  const h = (b.saisieLe || "").slice(11, 16).replace(":", "h");
  return `livraison du ${fr(b.dateLivraison)}` + (b.saisieLe ? ` (saisi le ${fr(b.saisieLe)} à ${h})` : "");
}
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function periode(inv) {
  const [y, m] = (inv.periodFrom || "").split("-").map(Number);
  return y && m ? `${MOIS_FR[m - 1]} ${y}` : `du ${fr(inv.periodFrom)} au ${fr(inv.periodTo)}`;
}

// Mail à Elis : tous les bordereaux du mois (date de livraison + saisie), puis chaque ligne de facture
// qui ne correspond pas, avec les bordereaux concernés et les quantités.
// null si la facture correspond exactement.
export function mailEcartBordereaux(inv, c) {
  if (!c || c.conforme) return null;
  const pieces = n => `${n} pièce${n > 1 ? "s" : ""}`;
  const ecarts = c.lignes.filter(l => l.ecart !== 0);
  // Mail court : chaque bordereau une seule fois avec toutes ses quantités, puis
  // les écarts par article. (Le détail répété par article dépassait la longueur
  // d'adresse acceptée par Gmail : erreur 404 avec 10 bordereaux.)
  const corps = [
    "Bonjour,",
    "",
    `Votre facture n° ${inv.numFacture} (linge ${/^[aeiouyéèh]/i.test(periode(inv)) ? "d'" : "de "}${periode(inv)}) ne correspond pas à vos bordereaux d'expédition du mois.`,
    "",
    `Vos bordereaux d'expédition ${/^[aeiouyéèh]/i.test(periode(inv)) ? "d'" : "de "}${periode(inv)} (${c.bordereaux.length}) :`,
    ...c.bordereaux.map(b => {
      const q = ELIS_INVOICE_ARTICLES.filter(a => Number(b.lines?.[a.id]?.livree) > 0).map(a => `${COURT[a.id] || a.label} ${Number(b.lines[a.id].livree)}`).join(", ");
      return `- ${libelleBordereau(b)} : ${q || "rien"}`;
    }),
    "",
    "Écarts entre la facture et le total de ces bordereaux :",
    ...ecarts.map(l => `- ${l.label} : facturé ${l.facture}, bordereaux ${l.livre} → ${pieces(Math.abs(l.ecart))} ${l.ecart > 0 ? "facturée(s) en trop" : "livrée(s) non facturée(s)"}${l.prix ? ` (${eur(Math.abs(l.ecartEuros))} HT)` : ""}`),
  ];
  corps.push("");
  if (c.enTrop > 0.005) corps.push(`Total facturé en trop : ${eur(c.enTrop)} HT.`);
  if (c.enMoins > 0.005) corps.push(`Total livré non facturé : ${eur(c.enMoins)} HT.`);
  corps.push(
    "",
    "Merci de corriger la facture pour qu'elle corresponde exactement à vos bordereaux d'expédition, ou de nous envoyer le bordereau manquant (date de livraison et de saisie) si une livraison n'apparaît pas dans cette liste.",
    "",
    "Bien cordialement,",
    "Résidence Le Belleville",
  );
  return { subject: `Facture ${inv.numFacture} – écarts avec vos bordereaux d'expédition (${periode(inv)})`, body: corps.join("\n") };
}
