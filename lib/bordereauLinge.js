// lib/bordereauLinge.js
// Bordereaux d'expédition Elis (un par livraison) et contrôle de la facture
// mensuelle : la quantité facturée de chaque article doit être exactement la
// somme des quantités livrées sur les bordereaux du mois.
//
// Le PDF du bordereau (« BORDEREAU D'EXPEDITION – LIVRAISON DU jj/mm/aaaa »)
// est tourné de 90° comme la facture : on le lit avec lireLignesPdf
// (lib/factureLinge.js), qui redresse les positions. Son numéro n'est pas écrit
// dans la page : il vient du nom du fichier envoyé par Elis
// (bordereau_expe_20260911_1_NULL_28840255_99063.pdf -> 28840255) et reste
// modifiable avant l'enregistrement. Fonctions pures, sans Firestore.

import { LINEN_ARTICLES, ELIS_INVOICE_ARTICLES } from "./linen";

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

export function numeroDepuisNomFichier(nom) {
  const base = String(nom || "").replace(/\.pdf$/i, "");
  const m = /_(\d{6,})_\d+$/.exec(base);
  if (m) return m[1];
  const tous = base.match(/\d{7,}/g) || [];
  return tous.length ? tous[tous.length - 1] : "";
}

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
// { numero, dateLivraison, lines: { [idArticleFacture]: { aLivrer, livree } }, avertissements }.
export function analyserBordereauElis(lignes, nomFichier = "") {
  const texte = lignes.join("\n");
  const avertissements = [];
  if (!/BORDEREAU\s+D.?EXP[EÉ]DITION/i.test(texte)) avertissements.push("Ce PDF ne ressemble pas à un bordereau d'expédition Elis.");
  const dateLivraison = isoDate((/LIVRAISON\s+DU\s+(\d{2}\/\d{2}\/\d{4})/i.exec(texte) || [])[1]);
  if (!dateLivraison) avertissements.push("Date de livraison introuvable.");
  const numero = numeroDepuisNomFichier(nomFichier);
  if (!numero) avertissements.push("N° de bordereau introuvable dans le nom du fichier : à saisir.");

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
  return { numero, dateLivraison, lines, avertissements };
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
    .sort((a, b) => a.dateLivraison.localeCompare(b.dateLivraison) || String(a.numero).localeCompare(String(b.numero)));
}

// Facture comparée aux bordereaux, ligne de facture par ligne de facture.
// ecart = facturé − livré selon les bordereaux (positif = facturé en trop).
export function comparerFactureBordereaux(inv, bordereaux) {
  const liste = bordereauxDeLaPeriode(bordereaux, inv);
  const lignes = ELIS_INVOICE_ARTICLES.map(a => {
    const facture = Number(inv.lines?.[a.id]?.qte) || 0;
    const prix = Number(inv.lines?.[a.id]?.prixUnitaire) || 0;
    const detail = liste
      .map(b => ({ numero: b.numero, date: b.dateLivraison, qte: Number(b.lines?.[a.id]?.livree) || 0 }))
      .filter(d => d.qte > 0);
    const livre = detail.reduce((s, d) => s + d.qte, 0);
    const ecart = facture - livre;
    return { id: a.id, label: a.label, facture, livre, ecart, prix, ecartEuros: ecart * prix, detail };
  }).filter(l => l.facture || l.livre);
  const enTrop = lignes.reduce((s, l) => s + Math.max(0, l.ecartEuros), 0);
  const enMoins = lignes.reduce((s, l) => s + Math.max(0, -l.ecartEuros), 0);
  return { bordereaux: liste, lignes, conforme: lignes.every(l => l.ecart === 0), enTrop, enMoins };
}

const eur = n => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fr = iso => (iso || "").split("-").reverse().join("/");
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function periode(inv) {
  const [y, m] = (inv.periodFrom || "").split("-").map(Number);
  return y && m ? `${MOIS_FR[m - 1]} ${y}` : `du ${fr(inv.periodFrom)} au ${fr(inv.periodTo)}`;
}

// Mail à Elis : tous les n° de bordereau du mois, puis chaque ligne de facture
// qui ne correspond pas, avec les bordereaux concernés et les quantités.
// null si la facture correspond exactement.
export function mailEcartBordereaux(inv, c) {
  if (!c || c.conforme) return null;
  const pieces = n => `${n} pièce${n > 1 ? "s" : ""}`;
  const ecarts = c.lignes.filter(l => l.ecart !== 0);
  const corps = [
    "Bonjour,",
    "",
    `Votre facture n° ${inv.numFacture} (linge de ${periode(inv)}) ne correspond pas à vos bordereaux d'expédition du mois.`,
    "",
    `Bordereaux d'expédition reçus pour ${periode(inv)} (${c.bordereaux.length}) :`,
    ...c.bordereaux.map(b => `- n° ${b.numero || "?"} – livraison du ${fr(b.dateLivraison)}`),
    "",
    "Écarts entre la facture et ces bordereaux :",
  ];
  for (const l of ecarts) {
    corps.push(
      "",
      `• ${l.label}`,
      `    facturé : ${l.facture} – livré selon vos bordereaux : ${l.livre}`,
      `    bordereaux : ${l.detail.length ? l.detail.map(d => `n° ${d.numero || "?"} (${fr(d.date)}) : ${d.qte}`).join(" ; ") : "aucun"}`,
      `    → ${pieces(Math.abs(l.ecart))} ${l.ecart > 0 ? "facturée(s) en trop" : "livrée(s) mais non facturée(s)"}${l.prix ? ` (${eur(Math.abs(l.ecartEuros))} HT)` : ""}`,
    );
  }
  corps.push("");
  if (c.enTrop > 0.005) corps.push(`Total facturé en trop : ${eur(c.enTrop)} HT.`);
  if (c.enMoins > 0.005) corps.push(`Total livré non facturé : ${eur(c.enMoins)} HT.`);
  corps.push(
    "",
    "Merci de corriger la facture pour qu'elle corresponde exactement à vos bordereaux d'expédition, ou de nous envoyer le bordereau manquant si une livraison n'apparaît pas dans cette liste.",
    "",
    "Bien cordialement,",
    "Résidence Le Belleville",
  );
  return { subject: `Facture ${inv.numFacture} – écarts avec vos bordereaux d'expédition (${periode(inv)})`, body: corps.join("\n") };
}
