# contacts — notes QA mobile

- Lit `contacts` (orderBy `nom` asc — tous les docs ont `nom`). Champs : nom, societe (vide → « — »), telephones (tableau de chaînes, vide → « — »), createdAt (ISO, non affiché). 14 contacts dont nom/société très longs, 4 numéros, email dans les numéros, aucun numéro.
- Pas d'/api/*, pas de CodeModal (suppression = `confirm()`, destructif → non capturé). Aucun Timestamp.
- États : liste, nouveau, nouveau avec 2 champs numéro, modification d'un contact à 4 numéros, recherche avec/sans résultat.

## Risques mobile (360–430 px)
1. `pages/contacts.js:160-178` + `styles/globals.css:423-424` : tableau à 4 colonnes en `nowrap` / `max-content` → avec « Société Générale de Maintenance… » et 4 numéros joints par « · » (contacts.js:169) la table fait > 1000 px ; tout se lit en défilement horizontal.
2. `pages/contacts.js:169` : numéros en texte brut, pas de lien `tel:` — sur téléphone, impossible d'appeler en un tap (usage principal de la page sur mobile).
3. `pages/contacts.js:170-173` : Modifier/✕ en dernière colonne, hors écran à droite sans défilement ; ✕ sans libellé collé à Modifier.
4. `pages/contacts.js:162` : en-têtes `.tbl th` à 11px (globals.css:1087), cellules 13px — petit pour un répertoire.
5. `pages/contacts.js:146-149` : `.phone-row` avec `width: 180` inline, corrigé par `.phone-row input{width:auto !important; flex:1}` (globals.css:658-659) : OK ; bouton ✕ par numéro à côté.
6. `pages/contacts.js:140-141` : largeurs inline 200/220 neutralisées par `!important` mobile : OK. Formulaire en haut de page → hors écran après « Modifier » d'un contact en bas de liste.
7. `pages/contacts.js:126` : recherche `minWidth: 200` inline (bat `.field input{min-width:0}`, globals.css:373).
