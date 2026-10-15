# Routine « Heures de départ » (9h, Paris)

Alimente la colonne **Heure** de la page Ménages. Lecture seule de Hostaway et Gmail ;
seule écriture : Firestore, collection `heures_depart`.

Les heures de départ affichées par les portails (Booking, Expedia, Airbnb…) valent toujours 11h :
on ne les recopie jamais. Seule compte l'heure que le client a annoncée lui-même.

## Document Firestore

- Doc ID : id Hostaway de la réservation (`reservation.id`).
- Champs : `date` (AAAA-MM-JJ de départ), `client`, `heure` (ex. « 9h30 », « avant 10h », « 13h (late check-out accordé) »), `extrait` (la phrase du client, courte), `majLe` (ISO UTC), `source` (`"routine-9h"`).
- Pas de document quand le client n'a rien dit : la case reste vide sur la page.

## Où chercher

1. `hostNote` et `guestNote` de la réservation.
2. Messages Hostaway : `GET /v1/conversations?reservationId=ID` puis `/v1/conversations/{id}/messages?limit=100`. Seuls les messages du client (`isIncoming = 1`) annoncent une heure ; les messages automatiques (`communicationId` non nul) ne comptent pas. Un late check-out accordé par l'hôte dans un message sortant compte aussi.
3. Gmail (residencelebelleville) : réponses Booking et échanges Expedia, Hotels.com et agences, par nom du voyageur ou n° de réservation.

Si plusieurs heures se contredisent, garder la plus récente. Un départ demandé mais refusé n'est pas reporté.

## Interdits

Aucune requête d'écriture vers Hostaway (POST/PUT/DELETE), aucun mail envoyé.
