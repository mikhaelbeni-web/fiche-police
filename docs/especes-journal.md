# Gestion des espèces : journal d'audit et codes personnels

## Ce qui change

| Avant | Maintenant |
|---|---|
| Le navigateur écrit et efface directement dans Firestore | Le navigateur ne fait que lire ; toute écriture passe par `/api/especes` (compte de service) |
| Suppression physique, sans trace | Suppression logique : `deleted`, `deletedAt`, `deletedBy`, `deleteReason` ; la ligne reste en base |
| Supprimer un paiement client : simple « Êtes-vous sûr ? » | Admin seulement (session Espace admin vérifiée par le serveur), motif obligatoire (5 caractères minimum) |
| « Qui saisit ? » : nom choisi dans une liste | Nom + code personnel vérifié par le serveur, demandé à chaque saisie et à chaque récupération |
| Récupération protégée par un code commun visible dans le code source | Récupération par l'admin ou avec le code personnel de la personne ; auteur enregistré |
| Aucun historique des suppressions | Journal `cash_audit` + export « Historique complet » (lignes supprimées incluses) |

## Journal (`cash_audit`, tête dans `cash_audit_meta/tete`)

Chaque événement : n° (`seq`), heure du serveur, action, cible, auteur et rôle, adresse IP,
navigateur, motif, état avant et état après (JSON), empreinte du précédent (`prevHash`) et
sa propre empreinte SHA-256 (`hash`). L'événement et la modification de la ligne sont
écrits dans le même commit Firestore : l'un ne peut pas exister sans l'autre. Une
précondition sur la tête empêche deux écritures simultanées de casser la chaîne.

Le premier événement (`ouverture_journal`) scelle l'empreinte de chaque ligne et
récupération déjà présente.

Événements tracés : saisie, suppression, récupération, rattachement d'une ligne à une
récupération, annulation de récupération, solde de départ, création / réinitialisation /
désactivation d'une personne, choix du code personnel, **code personnel incorrect** et
code d'activation incorrect.

### Contrôle d'intégrité

Espace admin > Espèces > « Lire et contrôler le journal ». Signale :

- `chaine` : événement manquant, retouché, ou effacé en fin de journal ;
- `hors_journal_creation` : ligne apparue en base sans passer par l'application ;
- `hors_journal_modification` : ligne modifiée sans passer par l'application ;
- `hors_journal_effacement` : ligne effacée de la base sans passer par l'application.

Le journal s'exporte en CSV (avec les empreintes).

### Limite

Qui détient la clé du compte de service ou l'accès à la console Google peut réécrire
toute la chaîne d'un coup. Parade simple : noter régulièrement, hors de l'application
(mail, papier), le n° et l'empreinte de tête affichés après le contrôle. Une chaîne
réécrite n'aurait plus la même empreinte à ce n°.

## Codes personnels

1. Espace admin > Espèces : ajouter le prénom. Un code d'activation à 6 chiffres s'affiche
   **une seule fois** (valable 7 jours). Le remettre en main propre.
2. La personne ouvre Taxes > Gestion des espèces > « Première utilisation », saisit le code
   d'activation et choisit son code (4 à 8 chiffres, pas 1234 ni 0000).
3. L'admin ne connaît jamais ce code. Il peut seulement le réinitialiser (nouveau code
   d'activation), ce qui est tracé.

Stockage : document chiffré `admin_prive/especes_personnel` (hash PBKDF2, jamais le code).
5 codes faux à la suite bloquent la personne 15 minutes.

## Règles Firestore à prévoir (bascule de la PR #52)

La règle générale de la PR #52 (`allow read, write` pour `reception-gate` sur tout) laisserait
le navigateur écrire dans les espèces et contourner le journal. Les règles Firestore ne
peuvent pas retirer un droit accordé par une règle plus large : il faut exclure ces
collections dans la règle générale.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function poste() { return request.auth != null && request.auth.uid == "reception-gate"; }
    match /{coll}/{rest=**} {
      // Espèces : lecture seule pour le navigateur, écritures par le serveur uniquement.
      allow read: if poste() && !(coll in ["cash_audit", "cash_audit_meta", "admin_prive"]);
      allow write: if poste() && !(coll in ["cash_entries", "cash_recoveries", "cash_audit", "cash_audit_meta", "admin_prive"]);
    }
  }
}
```

Tant que la base reste ouverte, un contournement reste possible, mais il est désormais
**détecté** par le contrôle d'intégrité au lieu de passer inaperçu.

## Tests

`node --import ./tests/loader.mjs --test tests/especes-journal.test.mjs` (faux Firestore en
mémoire : parcours complet, contournements détectés, retouche du journal détectée, blocage
après 5 codes faux).
