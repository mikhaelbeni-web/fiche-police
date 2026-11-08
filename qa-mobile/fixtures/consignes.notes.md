# consignes (/consignes)
Renders: locker cards per residence (Villiers: 1 bookable; Lantiez: 4 bookable + 2 fixed "Réservée en permanence") showing Libre / Occupée (+ apt · client, type · date) and up to 2 "À venir" lines; a "Nouvelle réservation" form (4 selects/inputs + 3 text inputs + Réserver); an 8-column table of current/future bookings with ✕; a note counting past bookings.
Collection: `locker_bookings` (auto IDs) queried with orderBy("startDate","asc") -> every doc needs `startDate`. Fields: {residence:"Lantiez"|"Villiers", lockerId:"1".."4"|"V1", startDate, endDate ("YYYY-MM-DD"), bookingType:"checkin"|"checkout", appartement, client, code, createdAt (ISO string, not a Timestamp)}. `today()` is UTC ISO (lib/lockers.js:26) -> "2026-11-08" at the frozen clock.
Fixture: Lantiez 1 occupied today + 3 upcoming (only 2 shown), Lantiez 3 occupied (checkout), Villiers V1 occupied over a range 07→09 with a 43-char client name, upcoming with no client / no appartement / no code, 3 past bookings (note "3 réservation(s) passée(s)").
State: "Réserver" with the empty form only sets a validation status message (consignes.js:51) — no write. Never type in the form then click Réserver; never click ✕ (confirm + delete, no code guard!).
Mobile risks:
- consignes.js:190-209 8-column table (Résidence, Consigne, Date, Type, Appartement, Client, Code, ✕) + nowrap (globals.css:424): ~700px+ wide; the ✕ delete column is the one off-screen; unguarded delete right after a scroll gesture.
- consignes.js:204 ✕ ghost button: glyph only, 40px min-height but narrow width.
- consignes.js:182-184 inline widths 130/180/120px on inputs — rescued at <=768 by `!important` 100% (globals.css:389-393); between 769px and tablet they won't wrap nicely. Labels like "Code envoyé (optionnel)" fine when stacked.
- consignes.js:173 `<input type="date">` native control — iOS renders it shorter than the selects (no min-height), check alignment.
- globals.css:515 `.locker-grid minmax(160px,1fr)`: at 360px (content ≈ 308px after .menage-page 10px + .recap 14px paddings) it drops to 1 column -> 7 tall cards before the form; long client names in `.locker-detail` (consignes.js:131,141) wrap OK but "À venir : … (check-out) · …" lines get long.
- toolbar has only h1 + status; h1 is hidden <=480px (globals.css:438) -> empty-looking toolbar with only a status line on phones.
