// components/ReclamationsGmail.js
// 2e vue de l'onglet Sinistres : réclamations clients repérées automatiquement
// dans Gmail (demandes de remboursement, clients mécontents, litiges, avis négatifs).
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
// montantRembourse, plateformeRemboursement, motif, note, traiteLe, traitePar.

import { useState, useEffect } from "react";
import { getCurrentStaff } from "../lib/staff";

export const RECLAMATIONS_COLLECTION = "reclamations_gmail";

const PLATEFORMES = [
  { value: "booking", label: "Booking.com" },
  { value: "airbnb", label: "Airbnb" },
  { value: "expedia", label: "Expedia" },
  { value: "direct", label: "En direct" },
  { value: "autre", label: "Autre" },
];
const PLATEFORME_LABEL = Object.fromEntries(PLATEFORMES.map(p => [p.value, p.label]));

const TYPE_LABEL = {
  remboursement: "Demande de remboursement",
  mecontentement: "Client mécontent",
  litige: "Litige",
  avis_negatif: "Avis négatif",
};

function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d.length === 10 ? d + "T12:00:00" : d);
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
function euros(n) {
  if (n == null || n === "") return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default function ReclamationsGmail({ fs, items, onReload, onStatus }) {
  const [filtre, setFiltre] = useState("a_traiter"); // a_traiter | traitees | toutes

  async function save(id, patch) {
    try {
      await fs.updateDoc(fs.doc(fs.db, RECLAMATIONS_COLLECTION, id), patch);
      await onReload();
      onStatus("Réclamation enregistrée.");
    } catch (err) { onStatus("Erreur : " + err.message); }
  }

  const visibles = items.filter(r => {
    if (filtre === "a_traiter") return !r.traite;
    if (filtre === "traitees") return !!r.traite;
    return true;
  });
  const totalRembourse = items
    .filter(r => r.rembourse === "oui" && r.montantRembourse != null)
    .reduce((s, r) => s + Number(r.montantRembourse || 0), 0);

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">{visibles.length} réclamation(s)</div>
          <div className="recap-sub">
            Repérées automatiquement dans Gmail chaque jour · total remboursé : {euros(totalRembourse)}
          </div>
        </div>
        <div className="quick">
          <button onClick={() => setFiltre("a_traiter")} className={filtre === "a_traiter" ? "primary" : ""}>À traiter</button>
          <button onClick={() => setFiltre("traitees")} className={filtre === "traitees" ? "primary" : ""}>Traitées</button>
          <button onClick={() => setFiltre("toutes")} className={filtre === "toutes" ? "primary" : ""}>Toutes</button>
        </div>
      </div>

      {visibles.length === 0 && (
        <div className="empty-state">
          {filtre === "a_traiter" ? "Aucune réclamation en attente." : "Aucune réclamation sur ce filtre."}
        </div>
      )}

      {visibles.map(r => <ReclamationRow key={r.id} r={r} onSave={patch => save(r.id, patch)} />)}
    </>
  );
}

function ReclamationRow({ r, onSave }) {
  const [traite, setTraite] = useState(!!r.traite);
  const [rembourse, setRembourse] = useState(r.rembourse || "");
  const [montant, setMontant] = useState(r.montantRembourse ?? "");
  const [plateforme, setPlateforme] = useState(r.plateformeRemboursement || r.plateforme || "booking");
  const [motif, setMotif] = useState(r.motif ?? r.motifSuggere ?? "");
  const [note, setNote] = useState(r.note || "");
  const [err, setErr] = useState("");

  // Resynchronise le formulaire si le document change (rechargement après enregistrement).
  useEffect(() => {
    setTraite(!!r.traite);
    setRembourse(r.rembourse || "");
    setMontant(r.montantRembourse ?? "");
    setPlateforme(r.plateformeRemboursement || r.plateforme || "booking");
    setMotif(r.motif ?? r.motifSuggere ?? "");
    setNote(r.note || "");
  }, [r]);

  function submit() {
    if (traite && !rembourse) { setErr("Indique si le client a été remboursé."); return; }
    if (rembourse === "oui" && (montant === "" || Number(montant) <= 0)) { setErr("Indique le montant remboursé."); return; }
    if (traite && !motif.trim()) { setErr("Indique le motif."); return; }
    setErr("");
    onSave({
      traite,
      rembourse,
      montantRembourse: rembourse === "oui" ? Number(montant) : null,
      plateformeRemboursement: plateforme,
      motif: motif.trim(),
      note: note.trim(),
      traiteLe: traite ? (r.traiteLe || new Date().toISOString()) : null,
      traitePar: traite ? (r.traitePar || getCurrentStaff() || "") : null,
    });
  }

  return (
    <div className="resid" style={{ padding: "12px 14px", background: r.traite ? "#f4faf4" : "#fdf3f0", borderRadius: 8, marginBottom: 10, border: "1px solid #eee" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong>{r.client || "Client inconnu"}</strong>{" "}
          {r.logement && <span style={{ fontSize: 12, color: "#666" }}>· {r.logement}</span>}
          {r.reservation && <span style={{ fontSize: 12, color: "#888" }}> · résa {r.reservation}</span>}
          <span style={{ fontSize: 12, color: "#888" }}> · reçu le {fmtFr(r.dateRecu)}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {r.type && <span style={{ fontSize: 11, fontWeight: 600, color: "#c0392b" }}>{TYPE_LABEL[r.type] || r.type}</span>}
          <span style={{ fontSize: 12, fontWeight: 600, color: "#2980b9" }}>{PLATEFORME_LABEL[r.plateforme] || r.plateforme || "—"}</span>
          {r.gmailUrl && <a href={r.gmailUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Ouvrir le mail</a>}
        </div>
      </div>

      {r.resume && <div style={{ fontSize: 14, margin: "6px 0" }}>{r.resume}</div>}
      {r.citation && <div style={{ fontSize: 12, color: "#666", fontStyle: "italic" }}>« {r.citation} »</div>}
      {r.montantDemande != null && <div style={{ fontSize: 12, color: "#e67e22" }}>Montant demandé : {euros(r.montantDemande)}</div>}
      {r.traite && (
        <div style={{ fontSize: 12, color: "#1f7a3f", marginTop: 4 }}>
          Traité{r.traitePar ? ` par ${r.traitePar}` : ""}{r.traiteLe ? ` le ${fmtFr(r.traiteLe)}` : ""}
          {r.rembourse === "oui" ? ` · remboursé ${euros(r.montantRembourse)} via ${PLATEFORME_LABEL[r.plateformeRemboursement] || r.plateformeRemboursement}` : r.rembourse === "non" ? " · non remboursé" : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={traite} onChange={e => setTraite(e.target.checked)} />
          Traité
        </label>
        <label style={{ fontSize: 12 }}>Remboursé{" "}
          <select value={rembourse} onChange={e => setRembourse(e.target.value)}>
            <option value="">—</option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </select>
        </label>
        {rembourse === "oui" && (
          <label style={{ fontSize: 12 }}>Montant €{" "}
            <input type="number" min="0" step="0.01" value={montant} onChange={e => setMontant(e.target.value)} style={{ width: 90 }} />
          </label>
        )}
        <label style={{ fontSize: 12 }}>Plateforme{" "}
          <select value={plateforme} onChange={e => setPlateforme(e.target.value)}>
            {PLATEFORMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, flex: 1, minWidth: 200 }}>Motif
          <input type="text" value={motif} onChange={e => setMotif(e.target.value)} placeholder="ex. TV en panne, ménage insuffisant…" style={{ width: "100%" }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, alignItems: "flex-end" }}>
        <label style={{ fontSize: 12, flex: 1, minWidth: 200 }}>Note (optionnel)
          <input type="text" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%" }} />
        </label>
        <button className="primary" onClick={submit}>Enregistrer</button>
      </div>
      {err && <div style={{ fontSize: 12, color: "#e67e22", marginTop: 6 }}>{err}</div>}
    </div>
  );
}
