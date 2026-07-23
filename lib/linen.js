// lib/linen.js
// Définitions et logique métier partagées pour le suivi du linge (Belleville).

// Les 7 articles suivis (validés par l'exploitant). Ordre aligné sur le document
// Excel du bon de ramassage. Entre parenthèses : le minimum pour identifier
// l'article sans ambiguïté (taille si elle existe, sinon référence courte).
export const LINEN_ARTICLES = [
  { key: "grande_serviette", label: "Grande serviette (Drap bain)" },
  { key: "housse", label: "Housse (Marine C260)" },
  { key: "petite_serviette", label: "Petite serviette (Éponge)" },
  { key: "tapis_bain", label: "Tapis de bain (49x70)" },
  { key: "torchon", label: "Torchon à carreaux (47x70)" },
  { key: "taie", label: "Taie d'oreiller (50x80)" },
  { key: "drap", label: "Drap (280)" },
];

// Mapping vers les codes/libellés exacts du bon de ramassage Pantin (Elis).
// Extrait du fichier "Bon_de_ramassage" fourni par l'exploitant.
export const PANTIN_CODES = {
  grande_serviette: { code: "3244", libelle: "Drap bain COCOON blc" },
  petite_serviette: { code: "421", libelle: "Serv Eponge COCOON blc" },
  drap: { code: "2941", libelle: "Drap Clas blc l. noir 280 NF" },
  housse: { code: "41115", libelle: "Housse Stella S l. MARINE C260 blc" },
  taie: { code: "517", libelle: "Taie Am Clas blc 50x80 NF" },
  tapis_bain: { code: "76549", libelle: "Tapis bain harmony 49x70 blc" },
  torchon: { code: "49110", libelle: "Torchon carreaux bleus resid 47x70" },
};

// Infos fixes du client Pantin (résidence Le Belleville), extraites du bon de ramassage.
export const PANTIN_CLIENT = {
  nClient: "237827",
  zone: "6",
  tournee: "40",
  frequence: "2",
  residence: "RESIDENCE LE BELLEVILLE",
  adresse: "32 rue Frédérick Lemaître",
  ville: "75020 PARIS",
};

// Deux commandes par semaine : mardi (2) et jeudi (4). getDay(): 0=dim..6=sam
export const ORDER_DAYS = { mardi: 2, jeudi: 4 };

// Les 9 lignes exactes qui apparaissent sur la facture Elis (deux variantes,
// Cocoon et Horizon, existent pour les draps de bain et les serviettes éponge —
// Elis les facture séparément même si l'app ne suit qu'une seule catégorie
// "grande_serviette" / "petite_serviette" pour le stock). `key` relie chaque
// ligne de facture à sa catégorie de suivi pour le rapprochement avec les
// réceptions enregistrées dans l'app.
export const ELIS_INVOICE_ARTICLES = [
  { id: "drap_clas", label: "Drap Clas blc l. noir 280 NF", key: "drap" },
  { id: "drap_cocoon", label: "Drap bain COCOON blc", key: "grande_serviette" },
  { id: "drap_horizon", label: "Drap bain L Horizon blc", key: "grande_serviette" },
  { id: "housse_stella", label: "Housse Stella S l.MARINE blc NF", key: "housse" },
  { id: "eponge_cocoon", label: "Serv Eponge COCOON blc", key: "petite_serviette" },
  { id: "eponge_horizon", label: "Serv Eponge Horizon blc", key: "petite_serviette" },
  { id: "taie_clas", label: "Taie Am Clas blc 50x80 NF", key: "taie" },
  { id: "tapis_harmony", label: "Tapis bain harmony 49x70 blc", key: "tapis_bain" },
  { id: "torchon_carreaux", label: "Torchon carreaux bleus resid 47x70", key: "torchon" },
];

function isoDay(d) {
  // Date locale (pas UTC) : evite le decalage "hier" observe entre minuit
  // et l'heure UTC en France (ete/hiver), car toISOString() est en UTC.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Renvoie la fenêtre de calcul (linge utilisé) pour une commande donnée.
// Commande du JEUDI : couvre mardi (inclus) -> jeudi (exclu) de la même semaine.
// Commande du MARDI : couvre jeudi (inclus) semaine préc. -> mardi (exclu).
export function orderWindow(orderDate, type) {
  const d = new Date(orderDate + "T12:00:00");
  const from = new Date(d);
  const to = new Date(d);
  if (type === "jeudi") {
    // du mardi de cette semaine (2 jours avant jeudi) au jeudi exclu
    from.setDate(d.getDate() - 2); // mardi
    // to = jeudi (exclu) -> on borne au jeudi lui-même exclu
  } else {
    // mardi : du jeudi précédent (5 jours avant mardi) au mardi exclu
    from.setDate(d.getDate() - 5); // jeudi précédent
  }
  return { from: isoDay(from), toExclusive: isoDay(to) };
}

// Date de réception prévue : commande reçue le même jour de la semaine, une semaine plus tard.
export function expectedReception(orderDate) {
  const d = new Date(orderDate + "T12:00:00");
  d.setDate(d.getDate() + 7);
  return isoDay(d);
}

// Somme des quantités utilisées par article sur une liste d'entrées linge_used.
export function sumUsage(entries) {
  const totals = {};
  for (const a of LINEN_ARTICLES) totals[a.key] = 0;
  for (const e of entries || []) {
    for (const a of LINEN_ARTICLES) {
      totals[a.key] += Number(e.quantities?.[a.key]) || 0;
    }
  }
  return totals;
}

export function emptyQuantities() {
  const q = {};
  for (const a of LINEN_ARTICLES) q[a.key] = 0;
  return q;
}

// Solde PARTIEL et cumulatif des défectueux par l'excédent d'une réception.
// Règle : un défectueux est soldé au fur et à mesure. Chaque excédent (reçu - commande)
// grignote les quantités restantes du/des défectueux renvoyés, article par article,
// du plus ancien au plus récent (FIFO). Un lot passe "revenu" seulement quand TOUTES
// ses quantités restantes sont retombées à zéro. Gère les livraisons en plusieurs fois.
//
// Chaque défectueux porte un champ `remaining` (map article->qté restant à récupérer).
// À l'accumulation, remaining = quantities. Il décroît à chaque excédent.
//
// Retourne les mises à jour à appliquer : [{ id, fields }].
export function computeDefectSettlements(received, ordered, defects) {
  const surplus = {};
  for (const a of LINEN_ARTICLES) {
    surplus[a.key] = Math.max(0, (Number(received[a.key]) || 0) - (Number(ordered[a.key]) || 0));
  }

  // Défectueux partis (renvoyés) et pas encore soldés, du plus ancien au plus récent
  const renvoyes = defects
    .filter(d => d.status === "renvoye")
    .sort((a, b) => (a.sentDate || a.date || "").localeCompare(b.sentDate || b.date || ""));

  const updates = [];
  for (const d of renvoyes) {
    // `remaining` = ce qu'il reste à récupérer ; par défaut = quantities si absent
    const remaining = {};
    for (const a of LINEN_ARTICLES) {
      remaining[a.key] = d.remaining
        ? (Number(d.remaining[a.key]) || 0)
        : (Number(d.quantities?.[a.key]) || 0);
    }

    let changed = false;
    for (const a of LINEN_ARTICLES) {
      if (remaining[a.key] > 0 && surplus[a.key] > 0) {
        const take = Math.min(remaining[a.key], surplus[a.key]);
        remaining[a.key] -= take;
        surplus[a.key] -= take;
        changed = true;
      }
    }

    if (changed) {
      const totalRemaining = Object.values(remaining).reduce((s, n) => s + n, 0);
      if (totalRemaining === 0) {
        updates.push({ id: d.id, fields: { status: "revenu", remaining, returnedAuto: true } });
      } else {
        updates.push({ id: d.id, fields: { remaining } }); // solde partiel, reste en attente
      }
    }

    // Si plus aucun excédent, inutile de continuer
    if (Object.values(surplus).every(n => n <= 0)) break;
  }
  return updates;
}
