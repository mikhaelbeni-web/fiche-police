// components/ReclamationsGmail.js
// Réclamations clients repérées automatiquement dans Gmail (demandes de
// remboursement, clients mécontents, litiges, avis négatifs), affichées dans
// la liste unique de l'onglet Sinistres (pages/sinistres.js).
//
// Alimentation : une routine Claude quotidienne lit la boîte Gmail et crée un
// document par fil dans la collection Firestore "reclamations_gmail"
// (doc ID = "gmail_<threadId>", création seulement : elle ne réécrit jamais un
// document existant, donc le traitement du réceptionniste n'est jamais écrasé).
//
// Champs écrits par la routine : threadId, gmailUrl, dateRecu (AAAA-MM-JJ), client,
// logement, reservation, plateforme, type, resume, citation, montantDemande,
// motifSuggere, detectedAt, source.
// Champs remplis par le réceptionniste : traite, rembourse ("oui" | "non"),
// montantRembourse, plateformeRemboursement, motif, note, traiteLe, traitePar,
// ignoree (true = « pas une réclamation »), sinistreId (sinistre créé depuis
// cette réclamation).

import { useState, useEffect } from "react";
import { getCurrentStaff } from "../lib/staff";

export const RECLAMATIONS_COLLECTION = "reclamations_gmail";

export const PLATEFORMES = [
  { value: "booking", label: "Booking" },
  { value: "airbnb", label: "Airbnb" },
  { value: "expedia", label: "Expedia" },
  { value: "direct", label: "En direct" },
  { value: "autre", label: "Autre" },
];
export const PLATEFORME_LABEL = Object.fromEntries(PLATEFORMES.map(p => [p.value, p.label]));

const TYPE_LABEL = {
  remboursement: "Remboursement",
  mecontentement: "Mécontent",
  litige: "Litige",
  avis_negatif: "Avis négatif",
};

// Libellé lisible pour une valeur inconnue (« reclamation_inconnue » → « Reclamation inconnue »).
export function humanize(v) {
  if (!v) return "";
  const s = String(v).replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function typeLabel(t) { return TYPE_LABEL[t] || humanize(t); }
export function plateformeLabel(p) { return PLATEFORME_LABEL[p] || humanize(p) || "—"; }

export function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d.length === 10 ? d + "T12:00:00" : d);
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
export function euros(n) {
  if (n == null || n === "") return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
// "12,5" ou "12.5" → 12.5 ; vide → null ; invalide → NaN
export function parseMontant(s) {
  const t = String(s ?? "").replace(/\s|€/g, "").replace(",", ".");
  if (t === "") return null;
  return Number(t);
}
// Nombre de jours entiers depuis une date AAAA-MM-JJ.
export function joursDepuis(d) {
  if (!d) return null;
  const x = new Date(d.length === 10 ? d + "T12:00:00" : d);
  if (isNaN(x)) return null;
  return Math.max(0, Math.floor((Date.now() - x.getTime()) / 86400000));
}

function plateformeInitiale(r) {
  const p = r.plateformeRemboursement || r.plateforme;
  return PLATEFORME_LABEL[p] ? p : "autre";
}

// ---- Fiche d'une réclamation : lecture + « Traiter » ----
// L'état du formulaire vit ici (une seule fiche ouverte à la fois) et n'est
// réinitialisé que quand on change de réclamation : enregistrer ne vide plus
// la saisie d'une autre réclamation.
export function ReclamationDetail({ r, onSave, onCreateSinistre, onOpenSinistre }) {
  const [edit, setEdit] = useState(!r.traite);
  const [rembourse, setRembourse] = useState(r.rembourse || "");
  const [montant, setMontant] = useState(r.montantRembourse ?? r.montantDemande ?? "");
  const [plateforme, setPlateforme] = useState(plateformeInitiale(r));
  const [motif, setMotif] = useState(r.motif ?? r.motifSuggere ?? "");
  const [note, setNote] = useState(r.note || "");
  const [suivre, setSuivre] = useState(false);
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEdit(!r.traite);
    setRembourse(r.rembourse || "");
    setMontant(r.montantRembourse ?? r.montantDemande ?? "");
    setPlateforme(plateformeInitiale(r));
    setMotif(r.motif ?? r.motifSuggere ?? "");
    setNote(r.note || "");
    setSuivre(false);
    setErrs({});
  }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function choisirRembourse(v) {
    setRembourse(v);
    setErrs(e => ({ ...e, rembourse: "" }));
    // Proposé par défaut quand il y a eu un geste, et pas déjà de sinistre lié.
    if (!r.sinistreId) setSuivre(v === "oui");
  }

  async function valider() {
    const e = {};
    const m = parseMontant(montant);
    if (!rembourse) e.rembourse = "Choisis Oui ou Non.";
    if (rembourse === "oui" && !(m > 0)) e.montant = "Indique le montant remboursé.";
    if (!motif.trim()) e.motif = "Indique le motif.";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const patch = {
      traite: true,
      ignoree: false,
      rembourse,
      montantRembourse: rembourse === "oui" ? m : null,
      plateformeRemboursement: plateforme,
      motif: motif.trim(),
      note: note.trim(),
      traiteLe: r.traiteLe || new Date().toISOString(),
      traitePar: r.traitePar || getCurrentStaff() || "",
    };
    const ok = await onSave(patch, "Réclamation classée.");
    if (ok && suivre && !r.sinistreId) await onCreateSinistre({ ...r, ...patch });
    setBusy(false);
    if (ok) setEdit(false);
  }

  async function pasUneReclamation() {
    setBusy(true);
    const ok = await onSave({
      traite: true,
      ignoree: true,
      rembourse: "non",
      montantRembourse: null,
      motif: "Pas une réclamation",
      traiteLe: new Date().toISOString(),
      traitePar: getCurrentStaff() || "",
    }, "Classée : pas une réclamation.");
    setBusy(false);
    if (ok) setEdit(false);
  }

  async function rouvrir() {
    setBusy(true);
    const ok = await onSave({ traite: false, ignoree: false, traiteLe: null, traitePar: null }, "Réclamation remise à traiter.");
    setBusy(false);
    if (ok) setEdit(true);
  }

  const age = joursDepuis(r.dateRecu);

  return (
    <div className="sx-detail">
      <div className="sx-d-badges">
        <span className={`sx-b ${r.traite ? "ok" : "bad"}`}>{r.traite ? (r.ignoree ? "✓ Classée sans suite" : "✓ Traitée") : "● Gmail · à traiter"}</span>
        {r.type && <span className="sx-b gr">{typeLabel(r.type)}</span>}
        <span className="sx-b info">{plateformeLabel(r.plateforme)}</span>
      </div>
      <h2 className="sx-d-title">{r.client || "Client inconnu"}</h2>
      <div className="sx-d-meta">
        {[r.logement, r.reservation && `résa ${r.reservation}`].filter(Boolean).join(" · ") || "Logement non trouvé"}
        <br />Reçue le {fmtFr(r.dateRecu)}{!r.traite && age != null ? ` · il y a ${age} j` : ""}
      </div>
      {r.gmailUrl && <a href={r.gmailUrl} target="_blank" rel="noreferrer" className="sx-btn sx-mail">Ouvrir le mail ↗</a>}
      {r.resume && <p className="sx-d-text">{r.resume}</p>}
      {r.citation && <p className="sx-d-quote">« {r.citation} »</p>}
      {r.montantDemande != null && <p className="sx-d-amt">Montant demandé : <b>{euros(r.montantDemande)}</b></p>}

      {r.sinistreId && (
        <p className="sx-d-link"><button type="button" className="sx-linkbtn" onClick={() => onOpenSinistre(r.sinistreId)}>Voir le sinistre lié ›</button></p>
      )}

      {!edit && r.traite && (
        <div className="sx-d-done">
          <div>
            Traitée{r.traitePar ? ` par ${r.traitePar}` : ""}{r.traiteLe ? ` le ${fmtFr(r.traiteLe)}` : ""}.
            {r.ignoree ? " Pas une réclamation."
              : r.rembourse === "oui" ? ` Remboursé ${euros(r.montantRembourse)} via ${plateformeLabel(r.plateformeRemboursement)}.`
              : r.rembourse === "non" ? " Pas de remboursement." : ""}
          </div>
          {r.motif && !r.ignoree && <div>Motif : {r.motif}</div>}
          {r.note && <div>Note : {r.note}</div>}
          <div className="sx-row-btns">
            <button type="button" className="sx-btn" onClick={() => setEdit(true)}>Modifier</button>
            <button type="button" className="sx-btn" onClick={rouvrir} disabled={busy}>Remettre à traiter</button>
          </div>
        </div>
      )}

      {edit && (
        <div className="sx-form">
          <div className="sx-fld">
            <div className="sx-lbl" id={`rb-${r.id}`}>Le client a-t-il été remboursé ?</div>
            <div className="sx-yn" role="group" aria-labelledby={`rb-${r.id}`}>
              <button type="button" className={`sx-btn ${rembourse === "oui" ? "on-ok" : ""}`} aria-pressed={rembourse === "oui"} onClick={() => choisirRembourse("oui")}>Oui</button>
              <button type="button" className={`sx-btn ${rembourse === "non" ? "on" : ""}`} aria-pressed={rembourse === "non"} onClick={() => choisirRembourse("non")}>Non</button>
            </div>
            {errs.rembourse && <div className="sx-err">{errs.rembourse}</div>}
          </div>

          {rembourse === "oui" && (
            <>
              <div className="sx-fld">
                <label className="sx-lbl" htmlFor={`mt-${r.id}`}>Montant remboursé (€)</label>
                <input id={`mt-${r.id}`} inputMode="decimal" value={montant} onChange={e => { setMontant(e.target.value); setErrs(x => ({ ...x, montant: "" })); }} />
                {r.montantDemande != null && <div className="sx-hint">Pré-rempli avec le montant demandé.</div>}
                {errs.montant && <div className="sx-err">{errs.montant}</div>}
              </div>
              <div className="sx-fld">
                <div className="sx-lbl">Remboursé via</div>
                <div className="sx-chips">
                  {PLATEFORMES.map(p => (
                    <button type="button" key={p.value} className={`sx-chip ${plateforme === p.value ? "on" : ""}`} aria-pressed={plateforme === p.value} onClick={() => setPlateforme(p.value)}>{p.label}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="sx-fld">
            <label className="sx-lbl" htmlFor={`mo-${r.id}`}>Motif</label>
            <input id={`mo-${r.id}`} value={motif} onChange={e => { setMotif(e.target.value); setErrs(x => ({ ...x, motif: "" })); }} />
            {r.motifSuggere && <div className="sx-hint">Proposé par la détection, modifiable.</div>}
            {errs.motif && <div className="sx-err">{errs.motif}</div>}
          </div>
          <div className="sx-fld">
            <label className="sx-lbl" htmlFor={`no-${r.id}`}>Note <span className="sx-opt">(facultatif)</span></label>
            <input id={`no-${r.id}`} value={note} onChange={e => setNote(e.target.value)} />
          </div>

          {!r.sinistreId && (
            <label className="sx-follow">
              <input type="checkbox" checked={suivre} onChange={e => setSuivre(e.target.checked)} />
              <span><b>Suivre aussi comme sinistre</b><br /><small>Crée le sinistre pré-rempli (client, logement, résa, montant) pour suivre le dossier sur la plateforme.</small></span>
            </label>
          )}

          <div className="sx-foot">
            {!r.traite
              ? <button type="button" className="sx-btn" onClick={pasUneReclamation} disabled={busy}>Pas une réclamation</button>
              : <button type="button" className="sx-btn" onClick={() => setEdit(false)} disabled={busy}>Annuler</button>}
            <button type="button" className="sx-btn pri" onClick={valider} disabled={busy}>{busy ? "Enregistrement…" : "Valider"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
