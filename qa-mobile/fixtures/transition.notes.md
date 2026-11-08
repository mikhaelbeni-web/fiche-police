# transition (/transition)
Renders: toolbar with 3 tabs (Aujourd'hui / Rapport d'hier / Historique); a report form per residence (Lantiez, Belleville, Villiers) × 6 questions as textareas (+ "Non" quick button) when editable, plain text when locked; Historique = table date / author / 🔴🟢 / Consulter + ✕.
Collection: `shift_reports/{YYYY-MM-DD}` with doc ID built by `toISOString().slice(0,10)` (UTC!, lib/shiftReport.js:28-34). Frozen 2026-11-08T10:00+01:00 = 09:00Z -> today "2026-11-08", yesterday "2026-11-07". Historique uses orderBy("date","desc") -> every doc must carry a `date` field (seeded). Fields: {date, author, residences:{<Res>:{arrivees,codesNonConfirmes,urgenceTechnicien,aSavoirDemain,invitesIndesirables,autre}}}. 2026-11-02 lacks the Villiers block, 2026-11-05 has no author (renders "—"). No Timestamps.
Today's doc is pre-filled (long texts) so the editable form shows overflow cases; delete it from the fixture to see the empty form (emptyReport).
States: tab switches + "Consulter" are read-only. ✕ (delete) is CodeModal-guarded (code 2305) but destructive: never click. "Enregistrer le rapport" writes: never click.
Mobile risks:
- transition.js:193-198 textarea `rows={1}` with long answers: one visible line, content hidden; resize handle only. Next to it the "Non" button (200) with inline fontSize 12 shrinks the textarea further on 360px.
- transition.js:175 author input inline `width: 180` (overridden only via `.linen-form-row input {width:100% !important}` globals.css:389-393 — OK, but the label is stacked).
- transition.js:227-245 Historique table: `.tbl td` nowrap (globals.css:424) + long French date "dimanche 08 novembre 2026" + long author -> Consulter/✕ actions (237-240) end up off-screen, horizontal scroll needed; ✕ is a ghost button right next to Consulter (mis-tap -> confirm + code modal).
- transition.js:118-122 three tabs in the toolbar `.quick.tabs`; with h1 hidden <=480px they wrap; tab buttons are `.toolbar *` so they don't get the 40px min-height (globals.css:1108).
- transition.js:188 question labels 12px, recap-sub 12px — small but readable.
