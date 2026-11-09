# Sécurité Firestore et Storage (projet beylev-linge)

## Qui accède à la base

| Accès | Comment | Après fermeture |
|---|---|---|
| Logiciel (navigateur, ~30 collections + Storage `incendie/`) | SDK Firebase, après le code d'accès | Connexion Firebase « reception-gate » via `/api/auth?firebase=1` (lib/firebaseAuth.js) |
| Tâche « Notes d'arrivée 9h » (`notes_arrivees`, PATCH) | REST sans authentification | Jeton du compte de service |
| Tâche « Heures de départ 9h » (`heures_depart`, PATCH/DELETE) | REST sans authentification | Jeton du compte de service |
| Tâche « Réclamations Gmail » (`reclamations_gmail`, POST) | REST avec la clé web publique | Jeton du compte de service |
| Scripts ponctuels (imports incendie, `linen_settings`…) | REST sans authentification | Jeton du compte de service |
| Routes API Vercel (`pages/api/*`) | n'utilisent pas Firestore | rien à changer |
| Audit mobile (`qa-mobile/`) | émulateur local | rien à changer |

## Règles

`firestore.rules` et `storage.rules` (à la racine) : lecture et écriture
réservées à l'utilisateur Firebase `reception-gate`. Le compte de service
passe par IAM et n'est pas soumis aux règles.

Ces fichiers ne sont pas déployés automatiquement : ils se collent dans
Firebase Console (Firestore > Règles, Storage > Règles). Retour arrière : coller
l'ancienne règle `allow read, write: if true;`.

## Jeton des tâches planifiées

Compte de service dédié (rôle « Cloud Datastore User »), clé JSON encodée en
base64 dans la variable `FIRESTORE_SA_B64` de l'environnement cloud (jamais
dans le dépôt, qui est public). Dans une tâche :

    FTOK=$(python3 docs/firestore-jeton.py)
    curl -sS -X PATCH -H "Authorization: Bearer $FTOK" -H 'Content-Type: application/json' \
      "https://firestore.googleapis.com/v1/projects/beylev-linge/databases/(default)/documents/notes_arrivees/ID" --data @doc.json

Sans dépôt cloné, le contenu de `docs/firestore-jeton.py` peut être recopié
dans `/tmp/firestore-jeton.py`.

## Ordre de bascule

1. Déployer le logiciel avec la connexion Firebase (sans effet tant que les règles sont ouvertes).
2. Vérifier dans Firebase Console > Authentication > Utilisateurs que `reception-gate` apparaît.
3. Passer les tâches et scripts au jeton du compte de service, vérifier une exécution.
4. Recharger chaque poste (onglets ouverts depuis avant le déploiement).
5. Publier les règles. Tester une lecture REST anonyme : elle doit répondre 403.
