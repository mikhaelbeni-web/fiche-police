# Routine « Notes d'arrivée » (9h, Paris)

Alimente la colonne **Note** de la page Arrivées. Lecture seule de Hostaway et Gmail ;
seule écriture : Firestore, collection `notes_arrivees`.

## Document Firestore

- Doc ID : id Hostaway de la réservation (`reservation.id`).
- Champs : `date` (AAAA-MM-JJ d'arrivée), `client`, `note` (texte), `alerte` (booléen), `majLe` (ISO), `source` (`"routine-9h"`).
- La routine réécrit la note à chaque passage (c'est une synthèse, rien n'y est saisi à la main).

## Contenu de la note

Une ou deux lignes au maximum, séparées par « · ». Seulement des faits trouvés :

1. OTA réelle (se fier à l'email : `@expedia-import.local` = Hotels.com même si Hostaway dit « direct » ; agence si l'échange passe par une agence).
2. Heure d'arrivée (hostNote, puis conversation, puis Gmail) ; « heure inconnue » si rien.
3. Le client a-t-il écrit / a-t-on répondu (les messages automatiques, `communicationId` non nul, ne comptent pas).
4. Demandes spéciales (guestNote, messages).
5. Mails Gmail liés à la réservation (nom du voyageur, n° de résa, agence) : ce qu'ils disent, en quelques mots.
6. Incohérences repérées (code de porte, date, OTA).

Ne jamais écrire un champ vide (« pas de note », « aucun mail ») ni une consigne que le
réceptionniste connaît déjà (lien taxe de séjour après 18h, etc.).
`alerte = true` quand un fait demande une action (heure inconnue, client sans réponse, carte à débiter, incohérence).

Exemples :
- `Booking · heure inconnue · aucun message du client` (alerte)
- `Expedia via Djocatravel, échanges par mail · self check-in envoyé à l'agence · carte virtuelle à débiter (mail du 15/09)` (alerte)
- `Hotels.com · 20h30 · self check-in envoyé · ⚠️ code Hostaway 059509376 ≠ code envoyé 6773` (alerte)

## Interdits

Aucune requête d'écriture vers Hostaway (POST/PUT/DELETE), aucun mail envoyé.
