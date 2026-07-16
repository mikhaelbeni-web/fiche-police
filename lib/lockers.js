// lib/lockers.js
// Référentiel fixe des consignes à bagages par résidence.
// Villiers : 1 consigne réservable.
// Lantiez : 6 consignes — 1 à 4 réservables (bagages clients), 5 fixe (livraisons Amazon),
// 6 fixe (stock papier toilette). Les consignes 5 et 6 ne sont jamais réservables.

export const LOCKERS_CONFIG = {
  Villiers: {
    bookable: [{ id: "V1", label: "Consigne unique" }],
    fixed: [],
  },
  Lantiez: {
    bookable: [
      { id: "1", label: "Consigne 1" },
      { id: "2", label: "Consigne 2" },
      { id: "3", label: "Consigne 3" },
      { id: "4", label: "Consigne 4" },
    ],
    fixed: [
      { id: "5", label: "Consigne 5", usage: "Livraisons (Amazon)" },
      { id: "6", label: "Consigne 6", usage: "Stock papier toilette" },
    ],
  },
};

function isoDay(d) { return d.toISOString().slice(0, 10); }
export function today() { return isoDay(new Date()); }

// Un casier est occupé pour une date donnée si une réservation couvre cette date
// (startDate <= date <= endDate). Le lendemain de endDate, il redevient libre —
// aucune action manuelle : c'est un simple test de date.
export function isOccupied(booking, date) {
  return booking.startDate <= date && date <= booking.endDate;
}

// Détecte un chevauchement entre une nouvelle réservation et les existantes sur le même casier
export function overlaps(newStart, newEnd, existingStart, existingEnd) {
  return newStart <= existingEnd && existingStart <= newEnd;
}
