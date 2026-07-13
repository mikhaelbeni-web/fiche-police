// lib/apartments.js
// Référentiel statique des appartements : ID Hostaway -> résidence, numéro/nom d'appartement,
// tarifs ménage et amenities HT. Source de vérité fournie par l'exploitant (plus fiable
// que toute extraction automatique depuis les tags/noms Hostaway).
// Module isomorphe (utilisable côté serveur et côté client, aucune dépendance Node).

export const APARTMENTS = {
  // --- Lantiez ---
  "371952": { residence: "Lantiez", appartement: "A1", unitNumber: "A1", menageHT: 90, amenitiesHT: 10 },
  "372373": { residence: "Lantiez", appartement: "A2", unitNumber: "A2", menageHT: 85, amenitiesHT: 10 },
  "372378": { residence: "Lantiez", appartement: "A3", unitNumber: "A3", menageHT: 85, amenitiesHT: 10 },
  "372407": { residence: "Lantiez", appartement: "A4", unitNumber: "A4", menageHT: 85, amenitiesHT: 10 },
  "372410": { residence: "Lantiez", appartement: "Studio A5", unitNumber: "A5", menageHT: 53, amenitiesHT: 10 },
  "372415": { residence: "Lantiez", appartement: "Studio A6", unitNumber: "A6", menageHT: 53, amenitiesHT: 10 },
  "372417": { residence: "Lantiez", appartement: "A7", unitNumber: "A7", menageHT: 63, amenitiesHT: 10 },
  "372420": { residence: "Lantiez", appartement: "A8", unitNumber: "A8", menageHT: 70, amenitiesHT: 10 },

  // --- Villiers ---
  "445498": { residence: "Villiers", appartement: "V1", unitNumber: "V1", menageHT: 74, amenitiesHT: 7.5 },
  "445514": { residence: "Villiers", appartement: "Studio V2", unitNumber: "V2", menageHT: 53, amenitiesHT: 7.5 },
  "446874": { residence: "Villiers", appartement: "Studio V3", unitNumber: "V3", menageHT: 53, amenitiesHT: 7.5 },
  "446875": { residence: "Villiers", appartement: "V4", unitNumber: "V4", menageHT: 68, amenitiesHT: 7.5 },
  "446872": { residence: "Villiers", appartement: "Studio V5", unitNumber: "V5", menageHT: 53, amenitiesHT: 7.5 },
  "446873": { residence: "Villiers", appartement: "V6", unitNumber: "V6", menageHT: 68, amenitiesHT: 7.5 },
  "446877": { residence: "Villiers", appartement: "V7", unitNumber: "V7", menageHT: 74, amenitiesHT: 7.5 },
  "446876": { residence: "Villiers", appartement: "Studio V8", unitNumber: "V8", menageHT: 53, amenitiesHT: 7.5 },

  // --- Belleville ---
  "80082": { residence: "Belleville", appartement: "COSY 10", unitNumber: "10", menageHT: 23, amenitiesHT: null },
  "80083": { residence: "Belleville", appartement: "COSY 20", unitNumber: "20", menageHT: 23, amenitiesHT: null },
  "80084": { residence: "Belleville", appartement: "COSY 30", unitNumber: "30", menageHT: 23, amenitiesHT: null },
  "80085": { residence: "Belleville", appartement: "COSY 40", unitNumber: "40", menageHT: 23, amenitiesHT: null },
  "80086": { residence: "Belleville", appartement: "COSY 50", unitNumber: "50", menageHT: 23, amenitiesHT: null },
  "80087": { residence: "Belleville", appartement: "CONFORT 11", unitNumber: "11", menageHT: 23, amenitiesHT: null },
  "80088": { residence: "Belleville", appartement: "CONFORT 21", unitNumber: "21", menageHT: 23, amenitiesHT: null },
  "80089": { residence: "Belleville", appartement: "CONFORT 31", unitNumber: "31", menageHT: 23, amenitiesHT: null },
  "80090": { residence: "Belleville", appartement: "CONFORT 41", unitNumber: "41", menageHT: 23, amenitiesHT: null },
  "80091": { residence: "Belleville", appartement: "CONFORT 51", unitNumber: "51", menageHT: 23, amenitiesHT: null },
  "80092": { residence: "Belleville", appartement: "CHIC 12", unitNumber: "12", menageHT: 23, amenitiesHT: null },
  "80093": { residence: "Belleville", appartement: "CHIC 22", unitNumber: "22", menageHT: 23, amenitiesHT: null },
  "80094": { residence: "Belleville", appartement: "CHIC 32", unitNumber: "32", menageHT: 23, amenitiesHT: null },
  "80095": { residence: "Belleville", appartement: "CHIC 42", unitNumber: "42", menageHT: 23, amenitiesHT: null },
  "80096": { residence: "Belleville", appartement: "CHIC 52", unitNumber: "52", menageHT: 23, amenitiesHT: null },
  "567569": { residence: "Belleville", appartement: "ÉLÉGANCE 60", unitNumber: "60", menageHT: 23, amenitiesHT: null },
  "567570": { residence: "Belleville", appartement: "ÉVASION 61", unitNumber: "61", menageHT: 23, amenitiesHT: null },
  "567568": { residence: "Belleville", appartement: "ZEN 62", unitNumber: "62", menageHT: 23, amenitiesHT: null },
  "567572": { residence: "Belleville", appartement: "PMR 01", unitNumber: "01", menageHT: 23, amenitiesHT: null },
  "567560": { residence: "Belleville", appartement: "DEEP 02", unitNumber: "02", menageHT: 33, amenitiesHT: null },
};

export function getApartmentInfo(listingId) {
  return APARTMENTS[String(listingId)] || null;
}

// Numéros connus pour les catégories multi-unit de Belleville.
// Motif : le dernier chiffre indique la catégorie (0=Cosy, 1=Confort, 2=Chic).
const BELLEVILLE_MULTIUNIT_NUMBERS = new Set([
  "10", "20", "30", "40", "50",
  "11", "21", "31", "41", "51",
  "12", "22", "32", "42", "52",
]);
function categoryFromNumber(num) {
  if (num.endsWith("0")) return "COSY";
  if (num.endsWith("1")) return "CONFORT";
  if (num.endsWith("2")) return "CHIC";
  return "";
}

// Résout les infos d'un appartement pour UNE réservation donnée.
// Gère le cas multi-unit : quand listingId pointe sur le listing PARENT (Cosy/Confort/Chic),
// la sous-unité réelle est dans rv.reservationUnit (nécessite includeResources=1).
// rv = objet réservation brut Hostaway. Renvoie null si totalement inconnu.
export function resolveApartment(rv, listingId) {
  const id = String(listingId);

  // 1) Correspondance exacte dans la table statique (cas normal, non multi-unit)
  if (APARTMENTS[id]) return APARTMENTS[id];

  // 2) Cas multi-unit : chercher un numéro dans reservationUnit
  const ru = rv.reservationUnit;
  let ruName = "";
  if (ru) {
    const first = Array.isArray(ru) ? ru[0] : ru;
    ruName = (first?.name || first?.unitName || first?.customName || first?.title || "").toString();
  }
  const digitMatch = ruName.match(/(\d{1,2})/);
  if (digitMatch) {
    const num = digitMatch[1].padStart(2, "0");
    if (BELLEVILLE_MULTIUNIT_NUMBERS.has(num)) {
      return {
        residence: "Belleville",
        appartement: `${categoryFromNumber(num)} ${num}`,
        unitNumber: num,
        menageHT: 23,
        amenitiesHT: null,
      };
    }
  }

  // 3) Repli : deviner la catégorie depuis le nom du listing parent (numéro inconnu)
  const name = (rv.listingName || "").toLowerCase();
  if (/cosy|confort|chic/.test(name)) {
    return {
      residence: "Belleville",
      appartement: rv.listingName || "Belleville (sous-unité non résolue)",
      unitNumber: "?",
      menageHT: 23,
      amenitiesHT: null,
    };
  }

  // 4) Totalement inconnu
  return null;
}

export function bellevilleIds() {
  return Object.keys(APARTMENTS).filter(id => APARTMENTS[id].residence === "Belleville");
}
