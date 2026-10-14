# Routine « Notes d'arrivée » (9h, Paris)

Alimente la colonne **Note** de la page Arrivées. Lecture seule de Hostaway et Gmail ;
seule écriture : Firestore, collection `notes_arrivees`.

## Document Firestore

- Doc ID : id Hostaway de la réservation (`reservation.id`).
- Champs : `date` (AAAA-MM-JJ d'arrivée), `client`, `heure` (heure d'arrivée, ex. « 20h30 »), `resume` (texte), `alerte` (booléen), `majLe` (ISO), `source` (`"routine-9h"`).
- Facultatifs, seulement pour corriger Hostaway : `ota` (ex. « Expedia via Djocatravel ») et `taxe` (ex. « Réglée à la réception », « À régler »). Sans eux, la page calcule l'OTA (email du voyageur) et la taxe (règle Booking partiellement payé) depuis Hostaway.
- La routine réécrit la note à chaque passage (c'est une synthèse, rien n'y est saisi à la main).

## Contenu

`heure` : hostNote, puis conversation, puis Gmail ; vide si rien.

`resume` : une ou deux lignes au maximum, séparées par « · ». Seulement des faits trouvés :

1. Le client a-t-il écrit / a-t-on répondu (les messages automatiques, `communicationId` non nul, ne comptent pas).
2. Demandes spéciales (guestNote, messages) et notes Hostaway utiles.
3. Mails Gmail liés à la réservation (nom du voyageur, n° de résa, agence) : ce qu'ils disent, en quelques mots.
4. Incohérences repérées (code de porte, date, OTA).

Ne jamais écrire un champ vide (« pas de note », « aucun mail ») ni une consigne que le
réceptionniste connaît déjà (lien taxe de séjour après 18h, etc.).
`alerte = true` quand un fait demande une action (heure inconnue, client sans réponse, carte à débiter, incohérence).

Exemples de `resume` :
- `Aucun message du client` (alerte, heure vide)
- `Échanges par mail avec l'agence · self check-in envoyé à l'agence · carte virtuelle à débiter (mail du 15/09)` (alerte, ota « Expedia via Djocatravel »)
- `Atterrit 19h40 · 2 adultes + 2 enfants · self check-in envoyé · ⚠️ code Hostaway 059509376 ≠ code envoyé 6773` (alerte, heure « 20h30 »)

## Interdits

Aucune requête d'écriture vers Hostaway (POST/PUT/DELETE), aucun mail envoyé.
