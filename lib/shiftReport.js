// lib/shiftReport.js
// Rapport de transition quotidien entre équipes de réception.
// Un document par jour, un sous-objet par résidence, 5 questions fixes chacun.

export const RESIDENCES = ["Lantiez", "Belleville", "Villiers"];

export const QUESTIONS = [
  { key: "arrivees", label: "Nombre d'arrivées autonomes aujourd'hui", quickNon: false },
  { key: "codesNonConfirmes", label: "Qui n'a pas confirmé la réception des codes ?", quickNon: true },
  { key: "urgenceTechnicien", label: "Y a-t-il quelque chose d'urgent à demander à un technicien ?", quickNon: true, alertField: true },
  { key: "aSavoirDemain", label: "Y a-t-il quelque chose à savoir pour demain ?", quickNon: true, alertField: true },
  { key: "invitesIndesirables", label: "Y a-t-il des invités indésirables à prendre en compte ?", quickNon: true, alertField: true },
];

export function emptyResidenceBlock() {
  const b = {};
  for (const q of QUESTIONS) b[q.key] = "";
  return b;
}

export function emptyReport(date) {
  const residences = {};
  for (const r of RESIDENCES) residences[r] = emptyResidenceBlock();
  return { date, author: "", residences };
}

function isoDay(d) { return d.toISOString().slice(0, 10); }
export function today() { return isoDay(new Date()); }
export function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDay(d);
}

// Un rapport est verrouillé (non modifiable) dès que sa date n'est plus celle
// du jour — seul le rapport du jour même reste éditable.
export function isLocked(reportDate) {
  return reportDate !== today();
}

// Détecte si un rapport contient une alerte à faire ressortir dans l'historique :
// une réponse non vide et différente de "non" sur un champ marqué alertField.
export function hasAlert(report) {
  if (!report?.residences) return false;
  for (const r of RESIDENCES) {
    const block = report.residences[r];
    if (!block) continue;
    for (const q of QUESTIONS) {
      if (!q.alertField) continue;
      const val = (block[q.key] || "").trim().toLowerCase();
      if (val && val !== "non" && val !== "non." && val !== "aucun" && val !== "aucune") return true;
    }
  }
  return false;
}
