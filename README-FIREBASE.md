# Configuration Firebase — onglet Commande linge

L'onglet "Commande linge" stocke ses données (stock, commandes, réceptions, linge
utilisé) dans Firebase Firestore. Les autres onglets n'en ont pas besoin.

## 1. Créer un projet Firebase
1. https://console.firebase.google.com → Ajouter un projet
2. Active **Firestore Database** (mode production)
3. Paramètres du projet → Tes applications → Web (</>) → enregistre l'app
4. Copie les valeurs de `firebaseConfig`

## 2. Variables d'environnement Vercel
Dans Vercel → Settings → Environment Variables, ajoute :

    NEXT_PUBLIC_FIREBASE_API_KEY=...
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
    NEXT_PUBLIC_FIREBASE_APP_ID=...

Puis redéploie.

## 3. Règles Firestore (sécurité)
Comme l'app est déjà protégée par le code d'accès, tu peux commencer avec des règles
simples. Dans Firestore → Règles :

    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /{document=**} {
          allow read, write: if true;
        }
      }
    }

⚠ Ces règles ouvrent la base à qui a l'URL. Pour renforcer plus tard : passer par
Firebase Auth. Pour l'instant, l'accès reste limité par le fait que l'URL et le code
188 ne sont pas publics.

## Collections créées automatiquement
- `linen_stock/belleville` : stock de base
- `linen_orders` : commandes
- `linen_receptions` : réceptions
- `linen_used` : linge utilisé
- `linen_defects` : linge défectueux (propre arrivé sale)
- `linen_thresholds/belleville` : seuils d'alerte par article
- `cash_entries` : paiements clients en espèces + dépenses hôtel
- `cash_recoveries` : historique des récupérations d'espèces
- `locker_bookings` : réservations des consignes à bagages (Villiers, Lantiez)
- `contacts` : répertoire des contacts fournisseurs/sociétés
- `access_codes` : codes des boîtes à clés statiques par résidence
