# Porte du bureau — portail Samsic

Site à part : mot de passe, état de la porte, trois boutons (Ouvrir / Verrouiller /
Déverrouiller) pour la seule serrure « Bureau RLB » de la Résidence Le Belleville.
Il ne détient pas le jeton Nuki : il appelle le relais de Hotel Desk (`/api/porte/*`,
projet `fiche-police`) avec une clé partagée.

Mise en place, variables, protection : voir `../docs/porte-samsic.md`.

## Local

    npm install
    cp .env.example .env.local   # renseigner les variables
    npm run dev                  # http://localhost:3100

## Tests

    npm test
