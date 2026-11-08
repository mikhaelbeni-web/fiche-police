# Inventaire des pages (2026-11-08)

Composants communs (toutes les pages) : `Gate` (code d'accès), `Nav` (onglets / menu), `NotesWidget` (bouton flottant + panneau), `CodeModal` (code de protection), `StaffBar` (« Qui es-tu ? »).

| Route | Fichier | Contenu principal | Points mobiles à surveiller |
|---|---|---|---|
| `/` Fiches de police | pages/index.js | barre de recherche + fiches A4 | fiche A4 lisible à l'écran ; impression A4 portrait inchangée |
| `/arrivees` | pages/arrivees.js | tableau par résidence (N°, client, OTA, heure, résumé, taxe/dépôt, codes, fait) | tableau → cartes ; impression paysage inchangée |
| `/menage` | pages/menage.js | tableau par résidence + heures de départ | tableau → cartes ; impression |
| `/checklist` | pages/checklist.js | StaffBar, tâches à cocher, mode admin | cases 44 px, boutons admin |
| `/commande-linge` | pages/commande-linge.js + FactureLinge | 7 sous-onglets (Commandes, Réceptions, Stock, Position, Défauts, Usage, Coût) ; 8 tableaux, formulaires de quantités | sous-onglets (réglé en commun), grilles de quantités, PDF facture |
| `/linge` | pages/linge.js | grille linge par appartement, no-show | grille croisée : défilement interne |
| `/transition` | pages/transition.js | 3 sous-onglets (jour, hier, historique), rapport | formulaires, historique |
| `/couts` | pages/couts.js + FactureMenage | coûts ménage, contrôle facture | lignes en grille fixe (90px…) |
| `/taxes` | pages/taxes.js | 2 sous-onglets (impayées, espèces), 5 tableaux | tableaux larges, export Excel |
| `/sinistres` | pages/sinistres.js + ReclamationsGmail | cartes sinistres, réclamations Gmail | cartes déjà en place |
| `/incendie` | pages/incendie.js + IncendieAcces/Import | tableau en cartes (déjà), coûts, import | impression paysage inchangée |
| `/taches` | pages/taches.js | liste de tâches | tableau |
| `/consignes` | pages/consignes.js | grille de casiers + formulaire | formulaire |
| `/contacts` | pages/contacts.js | tableau de contacts + formulaire | tableau → cartes, liens tel: |
| `/codes` | pages/codes.js | tableau des codes + formulaire | tableau → cartes |
| `/debug` | pages/debug.js | page technique (hors menu) | non prioritaire |
