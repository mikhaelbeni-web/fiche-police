// lib/incendieDetect.js
// Détection automatique à partir du nom de fichier et du texte d'un PDF :
// contrôle(s) concerné(s), date, organisme, nature du document, réserves
// probables, montant. Fonctions pures : le résultat n'est qu'une PROPOSITION,
// l'utilisateur confirme toujours le résultat (avec / sans réserve).

// Mots-clés par contrôle (texte du document) et mots-clés des lignes qui s'y rapportent.
export const REGLES_TYPES = [
  { id: "colonne-seche", doc: /colonne\s+(d'?\s*incendie|s[eè]che)|VCOLONNE/i, ligne: /colonne|bouches?\s+DSP|prise\s+ext/i },
  { id: "baes", doc: /bloc[s]?\s+(autonomes?\s+d['’]?\s*[ée]clairage|de\s+secours)|BAES|NF\s?C\s?71/i, ligne: /bloc[s]?\s+de\s+secours|BAES|[ée]clairage/i },
  { id: "extincteurs", doc: /extincteur|VERIF\s+EXT\b|VE\d?K?CO2|VE6L/i, ligne: /extincteur|\bEXT\b/i },
  { id: "desenfumage", doc: /d[ée]senfumage|ouvrants?\b|CDE\s+(PNEUMATIQUE|MECANIQUE)/i, ligne: /pneumatique|m[ée]canique|d[ée]senfum|ouvrant|cartouche/i },
  { id: "portes-coupe-feu", doc: /porte[s]?\s+coupe[-\s]?feu|\bPCF\b/i, ligne: /porte|ventouse|joint/i },
  { id: "electricite", doc: /installations?\s+[ée]lectriques?|v[ée]rification\s+[ée]lectrique|SOCOTEC|APAVE|RVRAT/i, ligne: /[ée]lectri/i },
  { id: "vmc", doc: /\bVMC\b|ventilation\s+m[ée]canique/i, ligne: /\bVMC\b|ventilation/i },
  { id: "plan-evacuation", doc: /plan[s]?\s+d['’]?\s*[ée]vacuation/i, ligne: /plan/i },
  { id: "ssi", doc: /\bSSI\b|syst[eè]me\s+de\s+s[ée]curit[ée]\s+incendie|ECS\s*\/?\s*CMSI|d[ée]tection\s+(automatique\s+)?incendie/i, ligne: /\bSSI\b|d[ée]tecteur|d[ée]clencheur|sir[eè]ne|batterie|centrale|\bUGA\b|\bAES\b/i },
  { id: "telesurveillance", doc: /t[ée]l[ée]surveillance|astreinte/i, ligne: /t[ée]l[ée]surveillance|astreinte/i },
];

const ORGANISMES = [
  [/CASI/i, "CASI"], [/FINSECUR/i, "FINSECUR"], [/SOCOTEC/i, "SOCOTEC"], [/APAVE/i, "APAVE"],
  [/BUREAU\s+VERITAS|\bVERITAS\b/i, "Bureau Veritas"], [/DEKRA/i, "DEKRA"], [/QUALICONSULT/i, "Qualiconsult"],
  [/SAMSIC/i, "SAMSIC"], [/ELIOR|ONET/i, null],
];

// Mots qui signalent un défaut dans un rapport : base de la suggestion « avec réserves ».
const RE_RESERVE = /\bmanque\b|manquant|non\s+satisfaisant|\bNS\b|fuite|hors\s+service|cass[ée]|[àa]\s+remplacer|[àa]\s+r[ée]parer|ne\s+se\s+ferme\s+pas|non\s+conforme|anomalies?\s+(ont\s+[ée]t[ée]\s+)?constat|pr[ée]voir\s+(le\s+|un\s+)?(remplacement|rplt|r[ée]paration)|[ée]quip[ée]e?\s+de\s+ventouse|d[ée]faut\s+g[ée]n[ée]ral/i;
// Lignes de grille qui ne décrivent pas un défaut réel.
const RE_IGNORER = /Oui\s*:|Non\s*:|S\s*=\s*Satisfaisant|bon\s+fonctionnement|S\/O|Obs\s*:/i;

function deuxChiffres(n) { return String(n).padStart(2, "0"); }
function iso(j, m, a) {
  const an = String(a).length === 2 ? 2000 + Number(a) : Number(a);
  const mm = Number(m), jj = Number(j);
  if (mm < 1 || mm > 12 || jj < 1 || jj > 31 || an < 2000 || an > 2100) return null;
  return an + "-" + deuxChiffres(mm) + "-" + deuxChiffres(jj);
}

// Date de la vérification : le texte prime (date d'intervention), puis le nom de fichier.
export function detecterDate(nom, texte) {
  const t = texte || "";
  const motifs = [
    /date\s+(?:d['’]\s*)?(?:intervention|v[ée]rification|visite)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4}|\d{2})/i,
    /(\d{2})\/(\d{2})\/(\d{2})\s+de\s+\d{1,2}:\d{2}/,
    /\bDate\s*:\s*(\d{2})\/(\d{2})\/(\d{4}|\d{2})/i,
  ];
  for (const re of motifs) {
    const m = t.match(re);
    if (m) { const d = iso(m[1], m[2], m[3]); if (d && d !== "2000-01-01") return { date: d, source: "texte" }; }
  }
  const f = (nom || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (f) return { date: f[0], source: "nom du fichier" };
  const m = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) { const d = iso(m[1], m[2], m[3]); if (d) return { date: d, source: "texte (première date)" }; }
  return { date: "", source: "" };
}

export function detecterOrganisme(nom, texte) {
  const bloc = (nom || "") + "\n" + (texte || "").slice(0, 4000);
  for (const [re, label] of ORGANISMES) if (label && re.test(bloc)) return label;
  return "";
}

export function detecterNature(nom, texte) {
  const n = (nom || "").toLowerCase();
  const t = (texte || "").slice(0, 3000);
  if (/facture/.test(n) || /^\s*facture\b/im.test(t)) return "Facture";
  if (/devis/.test(n) || /devis\s+n[°o]/i.test(t)) return "Devis";
  if (/contrat/.test(n) || /contrat\s+de\s+maintenance/i.test(t.slice(0, 600))) return "Contrat";
  if (/rapport|bulletin/.test(n) || /rapport\s+d['’]?\s*(intervention|maintenance|v[ée]rification)|bulletin\s+de\s+v[ée]rification/i.test(t)) return "Rapport";
  if (/rel[ée]v[ée]|grand_livre/.test(n)) return "Relevé";
  return "Document";
}

export function detecterReference(nom) {
  // 2026-08-19_CASI_Rapport_291656_bulletin.pdf → « 291656 bulletin »
  const base = (nom || "").replace(/\.[a-z0-9]+$/i, "");
  const m = base.match(/^\d{4}-\d{2}-\d{2}_[^_]+_(?:Rapport|Devis|Facture|Contrat|Document|Releve|Relevé)_?(.*)$/i);
  return (m ? m[1] : "").replace(/_/g, " ").trim();
}

export function detecterMontant(texte) {
  const t = texte || "";
  const m = t.match(/total\s+TTC[^\d]{0,20}([\d\s ]+[,.]\d{2})/i) || t.match(/net\s+[àa]\s+payer[^\d]{0,20}([\d\s ]+[,.]\d{2})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/[\s ]/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

export function detecterNumeroFacture(texte) {
  const m = (texte || "").match(/facture\s+n[°o]\s*:?\s*([A-Z0-9\-\/]+)/i);
  return m ? m[1] : "";
}

// Contrôles concernés (un bulletin peut en couvrir plusieurs), classés par nombre de mentions.
export function detecterTypes(nom, texte) {
  const bloc = (nom || "") + "\n" + (texte || "");
  const res = [];
  for (const r of REGLES_TYPES) {
    const g = new RegExp(r.doc.source, "gi");
    const n = (bloc.match(g) || []).length;
    if (n) res.push({ typeId: r.id, mentions: n });
  }
  // Le SSI cité en passant (ex. « SSI » dans l'en-tête d'un rapport CASI) n'est pas un contrôle propre.
  const autres = res.filter(r => r.typeId !== "ssi" && r.typeId !== "telesurveillance");
  const ssi = res.find(r => r.typeId === "ssi");
  if (ssi && autres.length >= 2 && ssi.mentions < 3) return autres.sort((a, b) => b.mentions - a.mentions);
  return res.sort((a, b) => b.mentions - a.mentions);
}

// Lignes à relire par contrôle : lignes qui contiennent un mot de défaut.
// Une ligne sans mot-clé de contrôle est rattachée au contrôle de la ligne précédente.
export function detecterReserves(texte, typeIds) {
  const out = {};
  typeIds.forEach(id => { out[id] = []; });
  let courant = null;
  const lignes = (texte || "").split(/\r?\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const l of lignes) {
    const propre = REGLES_TYPES.find(r => typeIds.includes(r.id) && r.ligne.test(l));
    if (propre) courant = propre.id;
    if (RE_RESERVE.test(l) && !RE_IGNORER.test(l)) {
      const cible = propre ? propre.id : (courant || (typeIds.length === 1 ? typeIds[0] : null));
      if (cible && out[cible] && !out[cible].includes(l)) out[cible].push(l);
    }
  }
  return out;
}

export function detecterDocument(nom, texte) {
  const nature = detecterNature(nom, texte);
  const types = detecterTypes(nom, texte);
  const typeIds = types.map(t => t.typeId);
  const { date, source } = detecterDate(nom, texte);
  const verification = nature === "Rapport";
  return {
    nom, nature, date, dateSource: source,
    organisme: detecterOrganisme(nom, texte),
    reference: detecterReference(nom),
    types,
    reserves: verification ? detecterReserves(texte, typeIds) : {},
    correctif: /maintenance\s+corrective|sur\s+devis|intervention\s+corrective/i.test((texte || "").slice(0, 1500)),
    montantTTC: nature === "Facture" ? detecterMontant(texte) : null,
    numeroFacture: nature === "Facture" ? detecterNumeroFacture(texte) : "",
    texteLu: Boolean((texte || "").trim()),
  };
}
