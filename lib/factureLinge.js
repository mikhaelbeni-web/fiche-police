// lib/factureLinge.js
// Facture mensuelle Elis (blanchisserie de Pantin) : lecture du PDF et
// comparaison avec les réceptions enregistrées dans Commande linge.
//
// La facture « Abonnement Linge Service Mensuel » liste, par article, la
// quantité livrée dans le mois (« Qté livr »), le prix unitaire HT (au
// millième) et le montant facturé (= Qté livr × prix). Viennent ensuite le
// sous-total HT, la « Participation pour perte » (≈ 2,5 % du sous-total), la
// TVA à 20 % et le net à payer.
//
// pdf.js est chargé à la demande depuis cdnjs (même méthode que l'onglet
// Sécurité incendie, aucune dépendance npm). Les fonctions de lecture du texte
// et de comparaison sont pures et ne touchent pas à Firestore.

import { LINEN_ARTICLES, ELIS_INVOICE_ARTICLES } from "./linen";

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
let chargement = null;

function chargerPdfJs() {
  if (typeof window === "undefined") return Promise.reject(new Error("pdf.js : navigateur requis"));
  if (window.pdfjsLib) {
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return Promise.resolve(window.pdfjsLib);
  }
  if (!chargement) {
    chargement = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDFJS;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { chargement = null; reject(new Error("pdf.js indisponible (connexion ?)")); };
      document.head.appendChild(s);
    });
  }
  return chargement;
}

// Regroupe des morceaux de texte positionnés ({ str, x, y, w }) en lignes,
// de haut en bas puis de gauche à droite. `yVersLeBas` : true si y grandit
// vers le bas de la page (pdftotext), false pour pdf.js (origine en bas).
export function lignesDepuisItems(items, yVersLeBas = false) {
  const tri = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ ...it, yy: yVersLeBas ? it.y : -it.y }))
    .sort((a, b) => a.yy - b.yy || a.x - b.x);
  const lignes = [];
  let cur = null;
  for (const it of tri) {
    if (!cur || Math.abs(it.yy - cur.yy) > 3) {
      cur = { yy: it.yy, items: [] };
      lignes.push(cur);
    }
    cur.items.push(it);
  }
  // Deux morceaux collés (écart < 1 pt) forment un seul mot : certains PDF
  // découpent le texte lettre par lettre, et « 3 4 2 » doit redevenir « 342 ».
  return lignes.map(l => {
    let txt = "", fin = null;
    for (const it of l.items.sort((a, b) => a.x - b.x)) {
      const colle = fin != null && it.w != null && it.x - fin < 1;
      txt += (txt && !colle ? " " : "") + (colle ? it.str : it.str.trim());
      fin = it.w != null ? it.x + it.w : null;
    }
    return txt.replace(/\s+/g, " ").trim();
  });
}

// Lit le texte du PDF (navigateur) et renvoie ses lignes.
export async function lireLignesPdf(file) {
  const pdfjs = await chargerPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lignes = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 10); p++) {
    const contenu = await (await pdf.getPage(p)).getTextContent();
    const items = contenu.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    lignes.push(...lignesDepuisItems(items, false));
  }
  return lignes;
}

// « 1.049,28 » -> 1049.28 ; « 1,804 » -> 1.804
export function nombreFr(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

function isoDate(dmy) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(dmy || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function finDeMois(annee, mois) { // mois 1..12
  const d = new Date(Date.UTC(annee, mois, 0));
  return d.toISOString().slice(0, 10);
}

const RE_MONTANT = /^\d{1,3}(?:\.\d{3})*,\d{2}$/; // 616,97 · 1.049,28
const RE_PRIX = /^\d+,\d{3,4}$/;                  // 1,804 (prix au millième)
const RE_ENTIER = /^\d+$/;

// Analyse une ligne d'article : renvoie { qte, prixUnitaire, montant, verifie }
// ou null si la ligne ne porte pas de prix + montant.
function lireChiffresArticle(reste) {
  const tokens = reste.split(/\s+/).filter(Boolean);
  const iPrix = tokens.findIndex(t => RE_PRIX.test(t));
  if (iPrix < 0) return null;
  const montants = tokens.slice(iPrix + 1).filter(t => RE_MONTANT.test(t));
  if (!montants.length) return null;
  const prixUnitaire = nombreFr(tokens[iPrix]);
  const montant = nombreFr(montants[montants.length - 1]);
  const entiers = tokens.slice(0, iPrix).filter(t => RE_ENTIER.test(t)).map(Number);
  // Colonnes avant le prix : [Ret. N°] [Suppl. N°] [Date] [Pror sem.] Qté livr, Stock réel, Stock calc.
  // On retient l'entier qui redonne le montant facturé (qté × prix), sinon on le déduit.
  let qte = entiers.find(q => Math.abs(q * prixUnitaire - montant) <= 0.02);
  let verifie = qte != null;
  if (qte == null) {
    qte = prixUnitaire > 0 ? Math.round(montant / prixUnitaire) : 0;
    verifie = Math.abs(qte * prixUnitaire - montant) <= 0.02;
  }
  return { qte, prixUnitaire, montant, verifie };
}

// Analyse le texte d'une facture Elis. Renvoie les champs du formulaire
// + des contrôles (avertissements) à afficher avant l'enregistrement.
export function analyserFactureElis(lignes) {
  const texte = lignes.join("\n");
  const avertissements = [];

  const numFacture = (/\b(\d{7}-\d{6})\b/.exec(texte) || [])[1] || "";
  if (!numFacture) avertissements.push("N° de facture introuvable.");

  let dateFacture = isoDate((/\bDate\s+(\d{2}\/\d{2}\/\d{4})/.exec(texte) || [])[1]);
  if (!dateFacture) dateFacture = isoDate((/(\d{2}\/\d{2}\/\d{4})/.exec(texte) || [])[1]);

  // Période : « Mois de Septembre 2026 » ; à défaut, le mois de la date de facture.
  let periodFrom = "", periodTo = "";
  const mm = /Mois\s+d[e']\s*([A-Za-zÀ-ÿ]+)\s+(\d{4})/i.exec(texte);
  const iMois = mm ? MOIS.indexOf(norm(mm[1])) : -1;
  if (iMois >= 0) {
    const y = Number(mm[2]);
    periodFrom = `${y}-${String(iMois + 1).padStart(2, "0")}-01`;
    periodTo = finDeMois(y, iMois + 1);
  } else if (dateFacture) {
    const [y, m] = dateFacture.split("-").map(Number);
    periodFrom = `${y}-${String(m).padStart(2, "0")}-01`;
    periodTo = finDeMois(y, m);
    avertissements.push("Mois facturé introuvable : période déduite de la date de facture, à vérifier.");
  }

  // Lignes d'articles
  const lines = {};
  for (const a of ELIS_INVOICE_ARTICLES) lines[a.id] = { qte: 0, prixUnitaire: 0 };
  const trouves = new Set();
  const autres = [];
  const connus = ELIS_INVOICE_ARTICLES.map(a => ({ ...a, n: norm(a.label) }));
  for (const ligne of lignes) {
    const n = norm(ligne);
    const art = connus.find(a => n.startsWith(a.n) || n.includes(a.n));
    if (art) {
      // Retire le libellé (caractère par caractère, espaces/points ignorés) puis lit les chiffres.
      let i = 0, k = 0;
      while (i < ligne.length && k < art.n.length) {
        if (norm(ligne[i]) === "") { i++; continue; }
        if (norm(ligne[i]) === art.n[k]) k++;
        i++;
      }
      const c = lireChiffresArticle(ligne.slice(i));
      if (!c) continue;
      lines[art.id] = { qte: (lines[art.id].qte || 0) + c.qte, prixUnitaire: c.prixUnitaire };
      trouves.add(art.id);
      if (!c.verifie) avertissements.push(`${art.label} : quantité × prix ne redonne pas le montant facturé, à vérifier.`);
      continue;
    }
    // Ligne d'article inconnue (nouvel article Elis) : libellé + prix + montant.
    if (/sous\s*total|net a payer|montant/i.test(ligne.normalize("NFD").replace(/[̀-ͯ]/g, ""))) continue;
    const m = /^(.*?[A-Za-z].*?)\s+(\d.*)$/.exec(ligne);
    if (!m) continue;
    const c = lireChiffresArticle(m[2]);
    if (c) autres.push({ label: m[1].trim(), qte: c.qte, prixUnitaire: c.prixUnitaire, montant: c.montant });
  }
  for (const a of autres) avertissements.push(`Article non suivi dans le logiciel : « ${a.label} » (${a.qte} × ${a.prixUnitaire} = ${a.montant} €). Compté dans le total, pas dans le comparatif.`);
  if (!trouves.size) avertissements.push("Aucune ligne d'article reconnue : ce PDF n'a pas la forme d'une facture Elis.");

  const montantApres = re => { const m = re.exec(texte); return m ? nombreFr(m[1]) : null; };
  const sousTotalImprime = montantApres(/Sous\s*total\s*HT[^\d]*([\d.]+,\d{2})/i);
  const participationPerte = montantApres(/Participation\s+Pour\s+Perte[^\d]*([\d.]+,\d{2})/i) || 0;
  const netImprime = montantApres(/NET\s+A\s+PAYER[^\d]*([\d.]+,\d{2})/i);

  const sousTotalCalcule = ELIS_INVOICE_ARTICLES.reduce((s, a) => s + lines[a.id].qte * lines[a.id].prixUnitaire, 0)
    + autres.reduce((s, a) => s + a.montant, 0);
  if (sousTotalImprime != null && Math.abs(sousTotalImprime - sousTotalCalcule) > 0.05) {
    avertissements.push(`Sous-total lu (${sousTotalImprime} €) différent de la somme des lignes (${sousTotalCalcule.toFixed(2)} €) : une ligne a peut-être été mal lue.`);
  }
  const netCalcule = Math.round((sousTotalCalcule + participationPerte) * 1.2 * 100) / 100;
  if (netImprime != null && Math.abs(netImprime - netCalcule) > 0.05) {
    avertissements.push(`Net à payer imprimé (${netImprime} €) différent du calcul (${netCalcule} €).`);
  }

  return {
    numFacture, dateFacture, periodFrom, periodTo, lines, autres, participationPerte,
    sousTotalImprime, netImprime, avertissements,
  };
}

// Comparaison facture / réceptions, par catégorie suivie dans le logiciel.
// Écart = facturé − reçu : positif = facturé en trop (à réclamer).
// La valeur d'un écart utilise le prix moyen facturé de la catégorie
// (Cocoon et Horizon ont le même prix chez Elis).
export function comparerFactureReceptions(inv, receptions) {
  const recu = {}, commande = {}, facture = {}, montant = {};
  for (const a of LINEN_ARTICLES) { recu[a.key] = 0; commande[a.key] = 0; facture[a.key] = 0; montant[a.key] = 0; }
  let nbReceptions = 0;
  for (const r of receptions || []) {
    const d = (r.date || "").slice(0, 10);
    if (!d || d < inv.periodFrom || d > inv.periodTo) continue;
    nbReceptions++;
    for (const a of LINEN_ARTICLES) {
      recu[a.key] += Number(r.quantities?.[a.key]) || 0;
      commande[a.key] += Number(r.commande?.[a.key]) || 0;
    }
  }
  for (const l of ELIS_INVOICE_ARTICLES) {
    const q = Number(inv.lines?.[l.id]?.qte) || 0;
    const p = Number(inv.lines?.[l.id]?.prixUnitaire) || 0;
    facture[l.key] += q;
    montant[l.key] += q * p;
  }
  const lignes = LINEN_ARTICLES.map(a => {
    const prix = facture[a.key] > 0 ? montant[a.key] / facture[a.key] : 0;
    const ecart = facture[a.key] - recu[a.key];
    return { key: a.key, label: a.label, commande: commande[a.key], facture: facture[a.key], recu: recu[a.key], ecart, prix, ecartEuros: ecart * prix };
  }).filter(l => l.facture || l.recu);
  const enTrop = lignes.reduce((s, l) => s + Math.max(0, l.ecartEuros), 0);
  const nonFacture = lignes.reduce((s, l) => s + Math.max(0, -l.ecartEuros), 0);
  const avecCommande = lignes.some(l => l.commande > 0);
  return { lignes, enTrop, nonFacture, net: enTrop - nonFacture, nbReceptions, avecCommande };
}

const eur = n => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const prix3 = n => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + " €";
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function periodeTexte(from, to) {
  const [y, m, d] = (from || "").split("-").map(Number);
  if (y && d === 1 && to === finDeMois(y, m)) return `${MOIS_FR[m - 1]} ${y}`;
  const fr = x => (x || "").split("-").reverse().join("/");
  return `la période du ${fr(from)} au ${fr(to)}`;
}

// Mail de réclamation à Elis (même principe que Coûts ménage) : liste ce qui a
// été facturé sans être reçu, déduit ce qui a été reçu sans être facturé, et
// demande un avoir du montant net. null si rien à réclamer.
export function mailReclamationLinge(inv, c) {
  if (!c || c.nbReceptions === 0 || c.net <= 0.005) return null;
  const libelleElis = key => ELIS_INVOICE_ARTICLES.filter(a => key === a.key && (Number(inv.lines?.[a.id]?.qte) || 0) > 0).map(a => a.label).join(" / ") || LINEN_ARTICLES.find(a => a.key === key)?.label;
  const ligne = l => {
    const cmd = c.avecCommande ? `commandé ${l.commande}, ` : "";
    return `- ${libelleElis(l.key)} : ${cmd}reçu ${l.recu}, facturé ${l.facture}, soit ${Math.abs(l.ecart)} × ${prix3(l.prix)} = ${eur(Math.abs(l.ecartEuros))} HT`;
  };
  const enTrop = c.lignes.filter(l => l.ecart > 0);
  const oublis = c.lignes.filter(l => l.ecart < 0);
  const periode = periodeTexte(inv.periodFrom, inv.periodTo);
  const tauxPerte = inv.sousTotalHT > 0 ? (Number(inv.participationPerte) || 0) / inv.sousTotalHT : 0;
  const perte = c.net * tauxPerte;
  const netHT = c.net + perte;
  const corps = [
    "Bonjour,",
    "",
    `Après vérification de votre facture n° ${inv.numFacture} (${periode}) par rapport au linge réellement reçu à la Résidence Le Belleville, nous relevons les écarts suivants :`,
    "",
    "Facturé mais non reçu :",
    ...enTrop.map(ligne),
    "",
    `Soit ${eur(c.enTrop)} HT facturés en trop.`,
  ];
  if (oublis.length) {
    corps.push(
      "",
      "À l'inverse, reçu mais non facturé (que nous déduisons de la réclamation) :",
      ...oublis.map(ligne),
      "",
      `Soit ${eur(c.nonFacture)} HT.`,
    );
  }
  corps.push(
    "",
    perte > 0.005
      ? `Montant net à régulariser : ${eur(c.net)} HT, plus la participation pour perte correspondante (${eur(perte)} HT), soit ${eur(netHT)} HT (${eur(netHT * 1.2)} TTC).`
      : `Montant net à régulariser : ${eur(netHT)} HT (${eur(netHT * 1.2)} TTC).`,
    "Merci de nous adresser un avoir correspondant, ou les bons de livraison signés justifiant ces quantités.",
    "",
    "Bien cordialement,",
    "Résidence Le Belleville",
  );
  return { subject: `Réclamation facture ${inv.numFacture} – linge (${periode})`, body: corps.join("\n") };
}

// Prix facturés différents des prix enregistrés dans le logiciel (linen_prices).
export function prixDifferents(lines, prices) {
  const res = [];
  for (const a of ELIS_INVOICE_ARTICLES) {
    const p = Number(lines?.[a.id]?.prixUnitaire) || 0;
    const ref = Number(prices?.[a.key]) || 0;
    if (p > 0 && ref > 0 && Math.abs(p - ref) > 0.0005) res.push({ label: a.label, facture: p, attendu: ref });
  }
  return res;
}
