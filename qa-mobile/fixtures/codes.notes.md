# codes — notes QA mobile

- Lit `access_codes` (orderBy `residence` asc — tous les docs ont `residence`). Champs : residence, emplacement, code, createdAt (ISO, non affiché). Regroupement par résidence avec fusion de casse (« LANTIEZ », « lantiez  » → Lantiez) ; résidence libre très longue pour tester `.resid-head`.
- Pas d'/api/*, pas de CodeModal (suppression = simple `confirm()`, destructif → non capturé). Aucun Timestamp.
- États : liste, formulaire nouveau, résidence « Autre » (champ libre), modification (résidence fixe et libre), recherche avec/sans résultat.

## Risques mobile (360–430 px)
1. `pages/codes.js:163-177` + `styles/globals.css:423-424` : `.tbl` passe en `width:max-content` + `white-space:nowrap` → un emplacement long (« Garde-bagages (placard sous l'escalier…) ») ou un code long rend le tableau 2-3× plus large que l'écran ; les boutons Modifier/✕ (colonne 3, codes.js:170-173) sortent de l'écran et ne sont atteignables qu'en défilant horizontalement dans `.tbl-wrap`.
2. `pages/codes.js:169` : code en `fontSize: 14` monospace nowrap — c'est l'info principale de la page, pourrait être plus gros et sans scroll.
3. `pages/codes.js:127` : `style={{ minWidth: 200 }}` inline sur la recherche : bat la règle mobile `.field input{min-width:0}` (globals.css:373) — tient à 360 px mais rigide.
4. `pages/codes.js:171-172` : 2 boutons ghost côte à côte en `nowrap`, ✕ sans libellé, cible ≈ 40 px de large collée à « Modifier » → tap accidentel.
5. `pages/codes.js:148,150,151` : largeurs inline 180/260/120 px neutralisées par `!important` mobile (globals.css:389-393) : OK. Le formulaire s'ouvre en haut de la liste : sur mobile après « Modifier » d'une ligne basse, le formulaire est hors écran (pas de scrollIntoView).
6. Barre d'outils : `.toolbar button` 12px / ~30 px de haut (globals.css:370-372) → « + Nouveau code » petite cible.
