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
