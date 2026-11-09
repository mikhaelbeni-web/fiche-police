# Espace admin (Codes d'accès > Espace admin)

Espace réservé à l'administrateur, invisible pour le réceptionniste. Il sert à
construire et tester le croisement de l'historique des serrures igloohome avec les
réservations Hostaway avant toute mise en production.

## Principe

- Le code d'accès de la réception (`ACCESS_CODE`, cookie `fp_session`) ne distingue
  personne. L'espace admin exige **en plus** un mot de passe admin.
- Le mot de passe n'est stocké nulle part en clair : seul son hash PBKDF2-SHA256
  (600 000 itérations) est enregistré dans la variable Vercel `ADMIN_PASSWORD_HASH`.
- Une connexion réussie pose le cookie `fp_admin` (HttpOnly, Secure, SameSite=Strict),
  signé avec une clé dérivée de `SESSION_SECRET` et du hash, valable **8 h**.
  Changer le mot de passe déconnecte immédiatement toutes les sessions admin.
- Contrôle côté serveur (`lib/adminAuth.js`) :
  - `/codes/admin` : `getServerSideProps` renvoie 404 à tout non-admin ;
  - `/api/admin/*` : 404 à tout non-admin ;
  - `/codes` : le serveur transmet `isAdmin` ; le sous-onglet n'est rendu que si
    `isAdmin === true` (`components/CodesTabs.js` renvoie `null` sinon).
- Sans `ADMIN_PASSWORD_HASH` (ou sans `SESSION_SECRET`), l'espace admin est fermé : 404 partout.
- 5 mauvais mots de passe depuis la même adresse bloquent la connexion 15 minutes
  (mémoire de l'instance serveur : frein, pas une garantie absolue).

## Mise en place

1. Calculer le hash du mot de passe avec l'outil hors ligne `generer-hash-admin.html`
   (fichier du projet, calcul dans le navigateur, rien n'est envoyé).
2. Vercel → fiche-police → Settings → Environment Variables : créer `ADMIN_PASSWORD_HASH`
   (Sensitive, Production et Preview) avec le hash, puis redéployer.
3. Se connecter à l'adresse **/codes/admin/connexion** (adresse non liée dans l'application ;
   l'ajouter en favori). Le sous-onglet « Espace admin » apparaît ensuite dans Codes d'accès.

## Limite connue

Le fichier JavaScript de l'interface admin reste téléchargeable par qui devine son
nom (fonctionnement normal de Next.js). Il ne contient que l'interface : aucune
donnée, aucun secret. Les données ne sont servies que par les routes `/api/admin/*`,
protégées côté serveur.

## Tests

- `node --import ./tests/loader.mjs --test 'tests/*.test.mjs'` : tests unitaires
  (aucune dépendance pour `admin-auth`, `react` requis pour `codes-tabs`).
- `.github/workflows/tests-admin.yml` : tests unitaires, `next build`, puis contrôles de
  bout en bout (`tests/e2e-admin.mjs`) contre l'application lancée.

## igloohome (phase 2, lecture seule)

- Variables Vercel : `IGLOOHOME_CLIENT_ID`, `IGLOOHOME_CLIENT_SECRET` (Secret). Facultatives pour
  ajuster les adresses sans toucher au code : `IGLOOHOME_AUTH_URL`
  (défaut `https://auth.igloohome.co/oauth2/token`), `IGLOOHOME_API_BASE`
  (défaut `https://api.igloohome.co/home`).
- `lib/igloohome.js` : jeton demandé avec les seuls scopes `igloohomeapi/get-devices` et
  `igloohomeapi/get-device-activity` ; liste blanche `GET /devices` et
  `GET /devices/{id}/activity` ; aucun autre appel réseau.
- Routes (admin seulement, 404 sinon) : `/api/admin/igloohome/devices`,
  `/api/admin/igloohome/activity?deviceId=…&days=7`. Elles renvoient toujours le JSON brut.
- Historique : lu page par page (`nextCursor`, 10 pages max), filtré sur 7 jours d'après
  `activityTimeAt` ; aucun paramètre de date n'est envoyé (noms non confirmés par la doc).

## Croisement igloohome × Hostaway (phase 3, Belleville)

- Périmètre : les 19 appartements de Belleville équipés igloohome (Deep 02 est chez Nuki,
  donc exclu). Les appareils nommés par étage ou de type bridge sont ignorés.
- **Règle d'alerte** : une ouverture entre **19 h et 8 h le lendemain** (heure de Paris), une
  nuit où aucune réservation de client ne couvre l'appartement (un séjour propriétaire ou
  un blocage de calendrier ne couvre rien : appartement vérifié). Une nuit D est couverte si
  arrivée ≤ D < départ. Les heures sont réglables dans « Réglages du croisement ».
- « Serrure activée » = toute action d'une personne : ouverture par code, ouverture
  manuelle ou depuis l'intérieur, verrouillage au bouton (pas le verrouillage automatique).
  La nuit sans client, une ouverture depuis l'intérieur est aussi une ALERTE.
- Autres classes : OK (nuit couverte, ou journée pendant le séjour ± marge de 2 h),
  Personnel (code du personnel en journée ; la nuit sans réservation reste une ALERTE),
  Journée sans réservation (information), Depuis l'intérieur (ignoré), Autre événement.
  Si l'événement porte un code de réservation utilisé hors de son séjour ou sur une autre
  porte : ALERTE.
- Onglets de l'Espace admin : Croisement (période, rejeu d'un mois, filtres, export CSV),
  Correspondance (serrure → appartement, proposition d'après les noms, chaque ligne doit
  être validée), Codes du personnel, Test de connexion.
- Moteur : `lib/croisement.js` (pur, testé par `tests/croisement.test.mjs`). Il tourne dans le
  navigateur de l'admin : une lecture d'historique par serrure, pour éviter les délais
  maximum des fonctions Vercel.
- Stockage : `lib/adminStore.js`, Firestore collection `admin_prive`, écrit par le serveur
  seul avec le compte de service (`FIREBASE_*`), contenu chiffré AES-256-GCM avec une clé
  dérivée de `SESSION_SECRET` (changer `SESSION_SECRET` rend la configuration illisible :
  il faudrait la ressaisir).
- Routes : `/api/admin/igloohome/config` (GET/PUT), `/api/admin/hostaway/reservations`
  (GET, identifiants Hostaway du poste), `/api/admin/igloohome/activity?from=&to=`.
- Coût igloohome : 2 $ par serrure lue dans le mois (facturé au premier appel du mois).
