# Routine « Notes d'arrivée » (9h, Paris)

Alimente la colonne **Note** de la page Arrivées. Lecture seule de Hostaway et Gmail ;
seule écriture : Firestore, collection `notes_arrivees`.

## Document Firestore

- Doc ID : id Hostaway de la réservation (`reservation.id`).
- Champs : `date` (AAAA-MM-JJ d'arrivée), `client`, `heure` (heure d'arrivée, ex. « 20h30 »), `resume` (texte), `alerte` (booléen), `majLe` (ISO), `source` (`"routine-9h"`).
- Facultatifs, seulement pour corriger Hostaway : `ota` (ex. « Expedia via Djocatravel ») et `taxe` (ex. « Réglée à la réception », « À régler »). Sans eux, la page calcule l'OTA (email du voyageur) et la taxe (règle Booking partiellement payé) depuis Hostaway.
- Villiers et Lantiez seulement : `codesEnvoyes` (booléen : message « Check-in Instructions » contenant le code de porte parti), `codesEnvoyesLe` (« 14/10 15h02 », heure de Paris), `codesConfirmes` (booléen : le client a écrit, après l'envoi, qu'il a bien reçu ses codes ou les instructions).
- La routine réécrit la note à chaque passage (c'est une synthèse, rien n'y est saisi à la main).

## Résidences

- Belleville : colonne Taxe de séjour (calculée par la page).
- Villiers (listingMapId 445498, 445514, 446872 à 446877) et Lantiez (371952, 372373, 372378, 372407, 372410, 372415, 372417, 372420) : taxe de séjour réglée par les OTA, pas de colonne Taxe. À la place :
  - Dépôt de garantie (Booking uniquement, 200 €) : la page le lit en direct dans Hostaway (`GET /v1/guestPayments/charges?reservationId=`, ligne `type = preAuth`). `holdSuccess` = réussi ; `holdFail` = échec, le client n'a pas reçu ses codes ; `awaitingHold` = pré-autorisation pas encore tentée (Hostaway la lance 24 h avant l'arrivée). Airbnb et Expedia : pas de dépôt.
  - Codes : écrits par la routine (`codesEnvoyes`, `codesEnvoyesLe`, `codesConfirmes`).

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
