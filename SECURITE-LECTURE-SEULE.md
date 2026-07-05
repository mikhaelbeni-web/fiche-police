# Sécurité — Lecture seule garantie

Cette application ne peut PAS modifier Hostaway. Deux verrous :

## Verrou 1 — Côté application (déjà en place dans le code)

- La route serveur `/api/reservations` **refuse toute méthode autre que GET**
  (POST/PUT/PATCH/DELETE → erreur 405).
- Le seul appel vers Hostaway est un `GET /v1/reservations` (consultation).
- Aucune ligne de code n'écrit, ne crée, ni ne supprime quoi que ce soit.
  Il n'existe aucune fonction d'écriture dans ce projet.

## Verrou 2 — Côté Hostaway (À FAIRE, c'est le plus sûr)

Le vrai garde-fou est le **type de token** que tu génères dans Hostaway.
Un token en lecture seule ne PEUT PAS écrire, même si le code essayait.

Dans Hostaway → Settings → Hostaway API :
- Crée une clé API dédiée à cette app (ne réutilise pas ta clé principale).
- Si Hostaway propose un **scope / permission en lecture seule (read-only)**
  pour cette clé, active-le. La clé ne pourra alors que consulter.
- Nomme-la clairement, ex. « Fiches Police – lecture seule », pour la
  révoquer facilement en un clic si besoin.

Ainsi, même en cas de problème, l'app est physiquement incapable de
toucher à tes données Hostaway.
