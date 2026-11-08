# Smartphone : motifs communs (≤ 640 px)

Toutes les règles sont dans `styles/globals.css`, section « TÉLÉPHONE (≤ 640 px) ».
Elles sont sous `@media screen` : l'impression (fiche police A4 portrait,
Arrivées / Ménages / Incendie en paysage) ne change pas. Toute règle propre à
une page doit elle aussi être sous `@media screen and (max-width: 640px)`.

## Déjà réglé pour toutes les pages (rien à faire)
- `viewport` explicite (`width=device-width, initial-scale=1, viewport-fit=cover`), zoom autorisé.
- Navigation : sur téléphone, barre « ☰ Menu » + nom de la page ; le menu ouvre la liste de toutes les pages (lignes de 48 px). La barre d'onglets du bureau est cachée.
- `.toolbar` : boutons, listes et champs à 44 px de haut, texte 15 px ; `.daynav` sur toute la largeur ; `.field` se partagent la ligne.
- Sous-onglets `.quick.tabs` / `.tabs` : une seule ligne qui défile au doigt (plus d'empilement sur 3 lignes).
- `.quick` sans `.tabs` (raccourcis Aujourd'hui / Demain…) : boutons qui se partagent la largeur.
- Boutons sans classe, `.primary`, `.ghost`, `.danger`, `.icon-btn` : 44 px minimum. Champs : 44 px, texte 16 px (évite le zoom automatique d'iPhone).
- Cases à cocher 22 px ; un `<label>` qui contient directement une case devient une zone de 44 px.
- Fenêtres `CodeModal` (et `.modal-overlay` / `.modal-box` / `.modal-actions` pour toute nouvelle fenêtre) : feuille en bas d'écran, boutons de 48 px.
- Bouton Notes flottant : décalé des bords arrondis de l'iPhone ; la page a 72 px de marge en bas pour qu'il ne cache jamais le dernier bouton.
- `.tbl-wrap` : défilement horizontal interne avec une ombre au bord qui montre qu'il reste des colonnes.
- Images, canvas, iframes : jamais plus larges que l'écran. Texte long dans `.card`, `.panel`, `.linen-form` : coupé proprement.

## À appliquer dans chaque page

### 1. Tableau → cartes (motif recommandé pour les listes)
```jsx
<div className="tbl-wrap">
  <table className="tbl tbl-cards">
    <thead>…inchangé…</thead>
    <tbody>
      <tr>
        <td className="card-title">{apt}</td>              {/* gros titre de la carte */}
        <td data-label="Client">{client}</td>              {/* « Client ……… valeur » */}
        <td data-label="Résumé" className="card-full">{resume}</td> {/* titre au-dessus, texte sur toute la largeur */}
        <td data-label="Action"><button className="icon-btn">✎</button></td>
      </tr>
```
- Sur ordinateur et à l'impression, rien ne change (le `thead` reste, `data-label` est ignoré).
- Cellule vide (`<td></td>` sans espace) : masquée sur téléphone.
- Garder `.tbl-wrap` seul (sans `tbl-cards`) pour les grilles à lire en croisé (linge par appartement, stock) : là le défilement horizontal interne est le bon choix.

### 2. Pas de largeur fixe
- Pas de `width: 300px`, `min-width: 240px` en style en ligne sans `max-width: 100%`. Préférer `flex: 1 1 200px; min-width: 0`.
- Pas de `grid-template-columns: 90px 90px 1fr 80px` sans repli : sous 640 px, passer à `1fr`.
- `white-space: nowrap` seulement sur des textes courts (heure, montant).

### 3. Hauteurs
- `100dvh` avec repli `100vh` avant (`height: 100vh; height: 100dvh;`) pour tout panneau plein écran.
- Pas de nouvelle barre `position: sticky/fixed` sur téléphone sans vérifier qu'elle ne mange pas l'écran.

### 4. Cibles tactiles
- Tout élément cliquable ≥ 44 × 44 px (`min-height: var(--tap)`), espacé d'au moins 8 px de son voisin.
- Les petits boutons « × » ou « ✎ » : classe `icon-btn`.

## Vérifier
`node qa-mobile/audit.js` contrôle la maquette commune (360, 390, 430 px) :
débordement horizontal, éléments hors écran, cibles < 44 px, champs < 16 px.
Le même script peut viser une vraie page : remplacer `url` par l'adresse de
l'aperçu Vercel (après connexion) et garder les mêmes contrôles.
