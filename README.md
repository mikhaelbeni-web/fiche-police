# Fiche de Police — Hostaway

Génère une fiche individuelle de police (art. R.611-42 CESEDA) par client,
sur une seule page A4, à partir des réservations Hostaway. Prête à imprimer
pour signature à l'arrivée.

## Déploiement Vercel

1. Pousser ce repo sur GitHub.
2. Sur Vercel : New Project → importer le repo `fiche-police`.
3. Dans Settings → Environment Variables, ajouter :
   - `HOSTAWAY_TOKEN` = ton access token Hostaway
   - `HOSTAWAY_ACCOUNT_ID` = (optionnel) ton account id
4. Deploy.

## Champs personnalisés Hostaway (check-in en ligne)

Pour le remplissage auto, créer ces custom fields et les collecter au check-in :
`Date de naissance`, `Lieu de naissance`, `Domicile`, `Ville`, `Nationalité`.

## Local

    npm install
    cp .env.example .env    # renseigner le token
    npm run dev
