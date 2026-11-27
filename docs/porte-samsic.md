# Portail d'ouverture de la porte du bureau (Samsic)

Site à part, destiné au centre de télésurveillance Samsic : une adresse, un mot de passe,
et trois boutons pour **la seule porte du bureau** de la Résidence Le Belleville (serrure
Nuki « Bureau RLB »). Il remplace la procédure Google Home / Yale « Réception RBL » envoyée
à Samsic le 12/11/2025.

## Deux morceaux

| Morceau | Où | Rôle |
|---|---|---|
| **Portail** | dossier `porte-samsic/` de ce dépôt, projet Vercel `porte-samsic` (dossier racine `porte-samsic`) | Page de connexion par mot de passe, état de la porte, boutons Ouvrir / Verrouiller / Déverrouiller avec confirmation. Aucun historique affiché. Ne connaît **pas** le jeton Nuki. |
| **Relais** | ce projet (Hotel Desk), `lib/porte.js` et `pages/api/porte/*` | Parle à Nuki avec `NUKI_API_TOKEN`, pour UNE serrure seulement. Répond 404 sans la clé partagée. |

Le portail appelle le relais avec `Authorization: Bearer <PORTE_SAMSIC_CLE>` et transmet
l'adresse de l'opérateur (`X-Porte-Origine`) pour les journaux.

## Ce que le relais ne peut pas faire

- Agir sur une autre serrure : `lib/nuki.js` refuse tout `POST /smartlock/{id}/action` sauf
  si l'appelant passe explicitement `actionSur` = l'identifiant de la serrure configurée,
  et `lib/porte.js` ne passe jamais autre chose que cette serrure.
- Lire ou modifier des codes clavier, des réservations, l'espace admin : routes séparées.
- Transmettre l'historique de la serrure : le relais ne renvoie que l'état courant (état,
  en ligne ou non, pile). Le journal Nuki reste visible dans Nuki Web et dans l'espace admin.
- Choisir « la première serrure qui ressemble » : `PORTE_SAMSIC_SERRURE` doit correspondre
  à exactement une serrure (identifiant Nuki ou nom exact), sinon refus.

## Variables

Hotel Desk (`fiche-police`, Production + Preview) :

- `NUKI_API_TOKEN` : déjà en place (Espace admin > Serrures Nuki).
- `PORTE_SAMSIC_SERRURE` (facultatif) : nom exact ou identifiant Nuki de la serrure ;
  `Bureau RLB` si absent.
- `PORTE_SAMSIC_CLE` : clé partagée, 24 caractères au moins, générée au hasard. Jamais dans
  le dépôt, jamais dans le navigateur.

Portail (`porte-samsic`) :

- `SESSION_SECRET` : longue chaîne au hasard, propre à ce site.
- `MOT_DE_PASSE_HASH` : hash PBKDF2 du mot de passe donné à Samsic (le mot de passe lui-même
  n'est stocké nulle part). Calcul : `node -e "const c=require('crypto');const s=c.randomBytes(16);const h=c.pbkdf2Sync(process.argv[1],s,600000,32,'sha256');console.log('pbkdf2$sha256$600000$'+s.toString('base64')+'$'+h.toString('base64'))" 'LeMotDePasse'`.
- `HOTEL_DESK_URL` : `https://fiche-police.vercel.app`.
- `PORTE_SAMSIC_CLE` : la même clé que côté Hotel Desk.
- `PORTE_NOM` (facultatif) : titre affiché. `PORTE_CONTACT` (facultatif) : contact affiché en bas.

## Protection

- Mot de passe : 5 échecs depuis la même adresse = 15 min de blocage. Session 12 h
  (cookie signé HttpOnly, Secure, SameSite=Strict), jamais prolongée. Changer le mot de passe
  déconnecte tout le monde.
- Actions : confirmation à deux clics (12 s), 6 actions par 5 min et par origine,
  40 par heure au total côté relais. Boutons grisés si la serrure est hors ligne.
- Journaux : chaque action est écrite dans les journaux Vercel des deux projets (origine,
  action, résultat, jamais la clé ni le mot de passe) et apparaît dans l'historique Nuki
  de la serrure (Nuki Web). Le portail n'affiche rien de cet historique.
- Pages `noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.

## Changer le mot de passe de Samsic

Recalculer `MOT_DE_PASSE_HASH` (commande ci-dessus), remplacer la variable sur Vercel
(projet `porte-samsic`), redéployer. Toutes les sessions en cours sont coupées.

## Couper l'accès

Supprimer `PORTE_SAMSIC_CLE` côté Hotel Desk (le relais répond 404) ou côté portail.

## Tests

- Relais : `node --import ./tests/loader.mjs --test tests/porte.test.mjs`
- Portail : `cd porte-samsic && npm test`
