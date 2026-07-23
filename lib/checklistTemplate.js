// lib/checklistTemplate.js
// Référentiel statique du planning journalier de réception (source : feuille papier
// "Planning journalier" / "Tâches par semaine", édition 22 Mai 2026).
// Chaque tâche a un id STABLE : ne jamais renommer un id existant (il sert de clé
// Firestore dans daily_checklist/{date}.tasks.{id}) — on peut modifier le texte,
// ajouter des tâches, mais un id retiré "gèle" juste l'historique passé, il ne le casse pas.

export const MORNING = [
  { id: "m01", time: "08h30", task: "Rentrer les poubelles + Consulter la boîte aux lettres" },
  { id: "m02", time: "08h35", task: "Vérifier les fiches des arrivées autonomes de la nuit dernière" },
  { id: "m03", time: "08h40", task: "Mettre à jour le planning ménage du jour pour LEVLOFT, Villier & RLB (google sheet)" },
  { id: "m04", time: "08h45", task: "Vérifier l'état des batteries des serrures NUKI (Levloft, Villier & Le Deep)" },
  { id: "m05", time: "09h00", task: "Répondre aux e-mails et messages WhatsApp (Hostway, RLB, Airbnb…)" },
  { id: "m06", time: "09h15", task: "Gérer les overbookings dans Chloé pour les 30 prochains jours" },
  { id: "m07", time: "09h45", task: "Contacter les clients arrivés en autonome la nuit dernière + Paiement taxe de séjour" },
  { id: "m08", time: "09h55", task: "Déclarer les NoShow si absence de présentation sur Booking" },
  { id: "m09", time: "10h05", task: "Imprimer les fiches des arrivées du jour" },
  { id: "m10", time: "10h20", task: "Envoyer l'« Heure d'arrivée » et le « lien de paiement » pour les arrivées tardives du jour" },
  { id: "m11", time: "10h30", task: "Ajouter les recouches et les demandes de lit bébé dans Quire&Chloé / Note sur Hostaway" },
  { id: "m12", time: "10h50", task: "Vérifier les départs des clients" },
  { id: "m13", time: "11h30", task: "Inspection des appartements déjà nettoyés" },
  { id: "m14", time: "11h45", task: "Vérifier que les lumières et chauffages sont éteints/allumés selon la saison" },
  { id: "m15", time: "12h30", task: "Vérifier les profils Portails Voyageurs et l'accessibilité du code (Hostaway)" },
  { id: "m16", time: "12h45", task: "Relancer les clients de demain des résidences pour ETA / Compléter leur profil par WhatsApp" },
];

export const AFTERNOON = [
  { id: "a01", time: "14h30", task: "Contrôle des ménages pour les appartements avec check-in aujourd'hui" },
  { id: "a02", time: "15h00", task: "Rapporter toutes anomalies ou manquements sur QUIRE & Hostaway pour suivi" },
  { id: "a03", time: "15h20", task: "Répondre aux commentaires (LEVLOFT / Villiers / RLB / Google Reviews)" },
  { id: "a04", time: "15h40", task: "Réapprovisionner le stock de matériel pour les femmes de ménage" },
  { id: "a05", time: "17h00", task: "Compléter la planche des ménages RLB du lendemain + Envoi au groupe WhatsApp" },
  { id: "a06", time: "17h15", task: "Vérifier les e-mails auto des codes RLB / Envoi des codes manuellement si nécessaire" },
  { id: "a07", time: "18h00", task: "Vérifier les sorties de secours + Fermer tous les placards à linge / Ranger les chariots" },
  { id: "a08", time: "18h10", task: "Sortir le(s) poubelle(s)" },
  { id: "a09", time: "18h25", task: "Envoyer le rapport du jour à Zack pour la permanence de nuit" },
];

// Tâches par semaine — un jour ISO (1=lundi … 7=dimanche) -> liste de tâches.
export const WEEKLY = {
  1: [ // Lundi
    { id: "w-lun-1", task: "Contacter Expertéo pour les tarifs des appartements J-4 sans réservation" },
    { id: "w-lun-2", task: "Rentrer (verte) et sortir les poubelles (jaune & verte)" },
    { id: "w-lun-3", task: "Remise en banque des réservations totalement encaissées" },
    { id: "w-lun-4", task: "Descendre le linge sale au rez-de-chaussée pour ramassage Elis" },
  ],
  2: [ // Mardi
    { id: "w-mar-1", task: "Clôture des préautorisations clients + sortir la poubelle" },
    { id: "w-mar-2", task: "Compter le linge reçu et le ranger dans les placards" },
    { id: "w-mar-3", task: "Envoyer le bon de ramassage ELIS avant midi" },
  ],
  3: [ // Mercredi
    { id: "w-mer-1", task: "Descendre le linge sale au rez-de-chaussée pour ramassage Elis" },
    { id: "w-mer-2", task: "Rentrer (verte) et sortir les poubelles (jaune & verte)" },
  ],
  4: [ // Jeudi
    { id: "w-jeu-1", task: "Envoyer le bon de ramassage ELIS avant midi" },
    { id: "w-jeu-2", task: "Compter le linge reçu et le ranger dans les placards" },
  ],
  5: [ // Vendredi
    { id: "w-ven-1", task: "Mettre à jour le planning du ménage de la semaine d'après (google sheet RLB de Bridge Street)" },
    { id: "w-ven-2", task: "Rentrer (verte) et sortir les poubelles (jaune & verte)" },
  ],
  6: [ // Samedi
    { id: "w-sam-1", task: "Clôturer les préautorisations des clients" },
  ],
  7: [ // Dimanche
    { id: "w-dim-1", task: "Gérer les No Show / Annulations dans Chloé" },
  ],
};

export const WEEKDAY_LABELS = {
  1: "Lundi", 2: "Mardi", 3: "Mercredi", 4: "Jeudi",
  5: "Vendredi", 6: "Samedi", 7: "Dimanche",
};

// Lundi=1 … Dimanche=7 (JS getDay() renvoie 0=dimanche, on convertit)
export function isoWeekday(date = new Date()) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}

export function allTaskIds() {
  const ids = [...MORNING, ...AFTERNOON].map(t => t.id);
  Object.values(WEEKLY).forEach(list => list.forEach(t => ids.push(t.id)));
  return ids;
}
