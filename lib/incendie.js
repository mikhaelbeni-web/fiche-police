// lib/incendie.js
// Suivi des obligations de sécurité incendie : types de contrôle, périodicité,
// et calcul de l'état (à jour / bientôt / en retard / non conforme).
// Collections Firestore : incendie_types, incendie_verifications, incendie_documents.

export const COL_TYPES = "incendie_types";
export const COL_VERIFS = "incendie_verifications";
export const COL_DOCS = "incendie_documents";
export const COL_FACTURES = "incendie_factures";

export const CATEGORIES_FACTURE = {
  verification: "Vérification / contrat",
  intervention: "Intervention / dépannage",
  travaux: "Travaux / équipement",
};

export const SEUIL_BIENTOT_JOURS = 60;

export const NATURES_DOC = ["Rapport", "Devis", "Facture", "Contrat", "Document", "Relevé"];

// Types créés à la première ouverture de l'onglet (périodicité modifiable ensuite).
// periodiciteMois = null : pas d'échéance (documents seulement).
export const TYPES_PAR_DEFAUT = [
  { id: "ssi", nom: "SSI (détection / alarme)", ordre: 1, periodiciteMois: 6 },
  { id: "desenfumage", nom: "Désenfumage", ordre: 2, periodiciteMois: 12 },
  { id: "extincteurs", nom: "Extincteurs", ordre: 3, periodiciteMois: 12 },
  { id: "baes", nom: "Blocs secours (BAES)", ordre: 4, periodiciteMois: 12 },
  { id: "colonne-seche", nom: "Colonne sèche", ordre: 5, periodiciteMois: 12 },
  { id: "electricite", nom: "Installations électriques", ordre: 6, periodiciteMois: 12 },
  { id: "vmc", nom: "VMC", ordre: 8, periodiciteMois: 12 },
  { id: "portes-coupe-feu", nom: "Portes coupe-feu", ordre: 7, periodiciteMois: 12 },
  { id: "plan-evacuation", nom: "Plan d'évacuation", ordre: 9, periodiciteMois: null },
  { id: "telesurveillance", nom: "Télésurveillance / astreinte", ordre: 10, periodiciteMois: null },
];

export const RESULTATS = {
  sans_reserve: "Sans réserve",
  avec_reserves: "Avec réserves",
};

export function isoDay(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}

export function fmtFr(iso) {
  if (!iso) return "";
  const x = new Date(iso + "T12:00:00");
  return isNaN(x) ? iso : x.toLocaleDateString("fr-FR");
}

// Ajoute des mois à une date ISO en gardant le jour (31/08 + 6 mois = 28/02).
export function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const total = (m - 1) + n;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(ny, nm + 1, 0).getDate();
  return ny + "-" + String(nm + 1).padStart(2, "0") + "-" + String(Math.min(d, last)).padStart(2, "0");
}

export function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + "T12:00:00");
  const b = new Date(toIso + "T12:00:00");
  return Math.round((b - a) / 86400000);
}

export function periodiciteLabel(mois) {
  if (!mois) return "Sans échéance";
  if (mois === 6) return "Semestrielle";
  if (mois === 12) return "Annuelle";
  if (mois % 12 === 0) return "Tous les " + (mois / 12) + " ans";
  return "Tous les " + mois + " mois";
}

// Réserves non levées : une vérification avec réserves reste ouverte tant
// qu'aucune vérification sans réserve ne la référence (contreVisiteDe).
export function reservesOuvertes(verifs) {
  const levees = new Set(verifs.filter(v => v.resultat === "sans_reserve" && v.contreVisiteDe).map(v => v.contreVisiteDe));
  return verifs.filter(v => v.resultat === "avec_reserves" && !levees.has(v.id));
}

// Vérifications qui font courir la périodicité : les visites périodiques sans
// réserve, et celles avec réserves dont les réserves sont levées (la date de la
// visite d'origine reste la référence). Une intervention corrective qui lève des
// réserves (compteEcheance === false) ne compte pas comme visite.
export function verifsComptees(verifs) {
  const ouvertes = new Set(reservesOuvertes(verifs).map(v => v.id));
  return verifs.filter(v => v.compteEcheance !== false && (v.resultat === "sans_reserve" || (v.resultat === "avec_reserves" && !ouvertes.has(v.id))));
}

// Écarts de suivi : deux visites consécutives séparées de plus que la
// périodicité (+1 mois de tolérance).
export function trous(verifs, periodiciteMois) {
  if (!periodiciteMois) return [];
  const propres = verifsComptees(verifs).sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 1; i < propres.length; i++) {
    const limite = addMonths(propres[i - 1].date, periodiciteMois + 1);
    if (propres[i].date > limite) out.push({ de: propres[i - 1].date, a: propres[i].date, echeance: addMonths(propres[i - 1].date, periodiciteMois) });
  }
  return out;
}

// État d'un type. etat : conforme | bientot | retard | non_conforme | jamais | sans_echeance
export function statutType(type, verifs, today) {
  const mois = type.periodiciteMois || null;
  const ouvertes = reservesOuvertes(verifs);
  const propres = verifsComptees(verifs).sort((a, b) => b.date.localeCompare(a.date));
  const derniere = propres[0] || null;
  const echeance = derniere && mois ? addMonths(derniere.date, mois) : null;
  const jours = echeance ? daysBetween(today, echeance) : null;

  let etat;
  if (ouvertes.length) etat = "non_conforme";
  else if (!mois) etat = "sans_echeance";
  else if (!derniere) etat = "jamais";
  else if (jours < 0) etat = "retard";
  else if (jours <= SEUIL_BIENTOT_JOURS) etat = "bientot";
  else etat = "conforme";

  return { etat, derniere, echeance, jours, ouvertes, trous: trous(verifs, mois) };
}

export const ETAT_LABEL = {
  conforme: "À jour",
  bientot: "À planifier bientôt",
  retard: "En retard",
  non_conforme: "Non conforme – contre-visite en attente",
  jamais: "Jamais vérifié – à planifier",
  sans_echeance: "Sans échéance",
};

// Ordre de gravité pour trier les alertes.
export const ETAT_RANG = { non_conforme: 0, retard: 1, jamais: 2, bientot: 3, conforme: 4, sans_echeance: 5 };
