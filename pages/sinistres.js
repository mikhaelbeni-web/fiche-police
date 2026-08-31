// pages/sinistres.js
// Suivi des sinistres/réclamations clients : cause, statut de résolution,
// et suivi côté Booking (ouvert/fermé, géré via Booking ou en direct).

import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import CodeModal from "../components/CodeModal";
import { useCodeGate } from "../hooks/useCodeGate";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";
const DELETE_PASSWORD = process.env.NEXT_PUBLIC_DELETE_PASSWORD || "2305";

function isoDay(d) { return d.toISOString().slice(0, 10); }
function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
function euros(n) {
  if (n == null || n === "") return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

const CANAUX = [
  { value: "booking", label: "Booking.com" },
  { value: "airbnb", label: "Airbnb" },
  { value: "autre", label: "Autre plateforme" },
];

const STATUT_PLATEFORME = [
  { value: "non_ouvert", label: "Pas encore ouvert" },
  { value: "ouvert", label: "Ouvert" },
  { value: "ferme", label: "Fermé" },
];

function Sinistres() {
  const { requestCode, codeModalProps } = useCodeGate(DELETE_PASSWORD, "Code requis pour cette suppression");
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [status, setStatus] = useState("");
  const [sinistres, setSinistres] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [filterStatut, setFilterStatut] = useState("tous"); // tous | ouverts | regles

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadSinistres(api);
      setReady(true);
    })();
  }, []);

  async function loadSinistres(api) {
    const snap = await api.getDocs(api.query(api.collection(api.db, "sinistres"), api.orderBy("date", "desc")));
    setSinistres(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  async function addSinistre(payload) {
    try {
      setStatus("Enregistrement…");
      await fs.addDoc(fs.collection(fs.db, "sinistres"), { ...payload, createdAt: new Date().toISOString() });
      await loadSinistres(fs);
      setShowForm(false);
      setStatus("Sinistre enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function updateSinistre(id, patch) {
    try {
      await fs.updateDoc(fs.doc(fs.db, "sinistres", id), patch);
      await loadSinistres(fs);
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  function deleteSinistre(s) {
    if (!confirm(`Supprimer le sinistre de ${s.client} (${s.motif}) ?`)) return;
    requestCode(async () => {
      try {
        await fs.deleteDoc(fs.doc(fs.db, "sinistres", s.id));
        await loadSinistres(fs);
        setStatus("Sinistre supprimé.");
      } catch (err) { setStatus("Erreur : " + err.message); }
    });
  }

  const visibles = sinistres.filter(s => {
    if (filterStatut === "ouverts") return !s.problemeRegle;
    if (filterStatut === "regles") return !!s.problemeRegle;
    return true;
  });

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <>
        <div className="toolbar"><h1>Sinistres</h1></div>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "#666", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
        </div></div>
      </>
    );
  }

  return (
    <>
      <Head><title>Sinistres</title></Head>
      <div className="toolbar">
        <h1>Sinistres</h1>
        <div className="quick">
          <button onClick={() => setFilterStatut("tous")} className={filterStatut === "tous" ? "primary" : ""}>Tous</button>
          <button onClick={() => setFilterStatut("ouverts")} className={filterStatut === "ouverts" ? "primary" : ""}>Non réglés</button>
          <button onClick={() => setFilterStatut("regles")} className={filterStatut === "regles" ? "primary" : ""}>Réglés</button>
        </div>
        <button className="primary" onClick={() => setShowForm(s => !s)}>{showForm ? "Annuler" : "+ Nouveau sinistre"}</button>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          {showForm && <SinistreForm onSave={addSinistre} onCancel={() => setShowForm(false)} />}

          <div className="recap-head">
            <div>
              <div className="recap-title">{visibles.length} sinistre(s)</div>
              <div className="recap-sub">Réclamations clients — cause, résolution, suivi Booking</div>
            </div>
          </div>

          {visibles.length === 0 && <div className="empty-state">Aucun sinistre sur ce filtre.</div>}

          {visibles.map(s => (
            <SinistreRow key={s.id} s={s} onUpdate={patch => updateSinistre(s.id, patch)} onDelete={() => deleteSinistre(s)} />
          ))}
        </div>
      </div>
      <CodeModal {...codeModalProps} />
    </>
  );
}

// ---- Formulaire de création ----
function SinistreForm({ onSave, onCancel }) {
  const [clientMode, setClientMode] = useState("hostaway"); // hostaway | manuel
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null); // réservation choisie
  const [manualClient, setManualClient] = useState("");

  const [motif, setMotif] = useState("");
  const [montant, setMontant] = useState("");
  const [origine, setOrigine] = useState("plateforme"); // plateforme | direct
  const [canal, setCanal] = useState("booking"); // booking | airbnb | autre (si origine === "plateforme")
  const [problemeRegle, setProblemeRegle] = useState(false);
  const [reponseRapide, setReponseRapide] = useState(false);
  const [statutPlateforme, setStatutPlateforme] = useState("non_ouvert");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(isoDay(new Date()));
  const [formStatus, setFormStatus] = useState("");

  async function runSearch(q) {
    setQuery(q);
    setPicked(null);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const acc = window.localStorage.getItem(ACCOUNT_KEY) || "";
      const key = window.localStorage.getItem(KEY_KEY) || "";
      if (!acc || !key) { setFormStatus("Identifiants Hostaway non configurés (onglet Fiches de police) — utilise la saisie manuelle."); setSearching(false); return; }
      const res = await fetch(`/api/reservation-search?q=${encodeURIComponent(q.trim())}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const d = await res.json();
      if (!res.ok) { setFormStatus("Erreur recherche : " + (d.error || res.status)); setResults([]); }
      else { setResults(d.items || []); setFormStatus(""); }
    } catch (err) { setFormStatus("Erreur : " + err.message); }
    setSearching(false);
  }

  function submit() {
    const client = clientMode === "hostaway" ? (picked?.client || "") : manualClient.trim();
    if (!client) { setFormStatus("Choisis ou saisis un client."); return; }
    if (!motif.trim()) { setFormStatus("La cause est obligatoire."); return; }
    onSave({
      date,
      clientMode,
      client,
      residence: picked?.residence || "",
      appartement: picked?.appartement || "",
      unitNumber: picked?.unitNumber || "",
      arrivee: picked?.arrivee || "",
      depart: picked?.depart || "",
      reservation: picked?.reservation || "",
      motif: motif.trim(),
      montant: montant === "" ? null : Number(montant),
      origine,
      canal: origine === "plateforme" ? canal : null,
      problemeRegle,
      reponseRapide,
      statutPlateforme,
      note: note.trim(),
    });
  }

  return (
    <div className="linen-form" style={{ marginBottom: 20 }}>
      <div className="linen-form-row">
        <label>Date de la réclamation <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>

      <div className="linen-form-row">
        <label>Client
          <select value={clientMode} onChange={e => { setClientMode(e.target.value); setPicked(null); setResults([]); setQuery(""); }}>
            <option value="hostaway">Rechercher dans les réservations</option>
            <option value="manuel">Saisie manuelle</option>
          </select>
        </label>

        {clientMode === "hostaway" ? (
          <label style={{ minWidth: 320, position: "relative" }}>Nom du client
            <input type="text" value={picked ? picked.client : query} onChange={e => runSearch(e.target.value)}
              placeholder="Tape au moins 2 lettres du nom…" style={{ width: "100%" }} />
            {searching && <span style={{ fontSize: 11, color: "#666" }}>Recherche…</span>}
            {!picked && results.length > 0 && (
              <div style={{ border: "1px solid #ddd", borderRadius: 6, marginTop: 4, maxHeight: 220, overflowY: "auto", background: "#fff", position: "relative", zIndex: 5 }}>
                {results.map((r, i) => (
                  <div key={i} onClick={() => {
                    setPicked(r); setResults([]);
                    const ch = (r.channel || "").toLowerCase();
                    if (ch.includes("airbnb")) setCanal("airbnb");
                    else if (ch.includes("booking")) setCanal("booking");
                    else setCanal("autre");
                  }}
                    style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                    <strong>{r.client}</strong> — {r.residence} {r.appartement} ({r.unitNumber})
                    <div style={{ fontSize: 11, color: "#888" }}>{fmtFr(r.arrivee)} → {fmtFr(r.depart)} · {r.channel}</div>
                  </div>
                ))}
              </div>
            )}
            {picked && (
              <div style={{ fontSize: 11, color: "#1f7a3f", marginTop: 4 }}>
                {picked.residence} {picked.appartement} · {fmtFr(picked.arrivee)} → {fmtFr(picked.depart)}
                {" "}<button type="button" onClick={() => { setPicked(null); setQuery(""); }} className="ghost" style={{ fontSize: 11 }}>changer</button>
              </div>
            )}
          </label>
        ) : (
          <label style={{ minWidth: 260 }}>Nom du client
            <input type="text" value={manualClient} onChange={e => setManualClient(e.target.value)} style={{ width: "100%" }} />
          </label>
        )}
      </div>

      <div className="linen-form-row">
        <label style={{ flex: 1 }}>Cause du remboursement / motif (obligatoire)
          <input type="text" value={motif} onChange={e => setMotif(e.target.value)}
            placeholder="ex. chauffage en panne, ménage insuffisant…" style={{ width: "100%" }} />
        </label>
        <label>Montant remboursé/réduit € <input type="number" min="0" step="0.01" value={montant} onChange={e => setMontant(e.target.value)} style={{ width: 120 }} /></label>
      </div>

      <div className="linen-form-row">
        <label>Géré
          <select value={origine} onChange={e => setOrigine(e.target.value)}>
            <option value="plateforme">Sur une plateforme</option>
            <option value="direct">En direct (téléphone)</option>
          </select>
        </label>
        {origine === "plateforme" && (
          <label>Plateforme
            <select value={canal} onChange={e => setCanal(e.target.value)}>
              {CANAUX.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        {origine === "plateforme" && (
          <label>Statut sur la plateforme
            <select value={statutPlateforme} onChange={e => setStatutPlateforme(e.target.value)}>
              {STATUT_PLATEFORME.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="linen-form-row">
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={reponseRapide} onChange={e => setReponseRapide(e.target.checked)} />
          Répondu rapidement à Booking
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={problemeRegle} onChange={e => setProblemeRegle(e.target.checked)} />
          Problème réglé
        </label>
      </div>

      <div className="linen-form-row">
        <label style={{ flex: 1 }}>Note (optionnel) <input type="text" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%" }} /></label>
      </div>

      {formStatus && <div style={{ fontSize: 12, color: "#e67e22", marginBottom: 8 }}>{formStatus}</div>}
      <button className="primary" onClick={submit}>Enregistrer le sinistre</button>
      <button onClick={onCancel} className="ghost" style={{ marginLeft: 8 }}>Annuler</button>
    </div>
  );
}

// ---- Ligne d'un sinistre existant ----
const CANAL_LABEL = { booking: "Booking.com", airbnb: "Airbnb", autre: "Autre plateforme" };

function SinistreRow({ s, onUpdate, onDelete }) {
  // Rétrocompatibilité : les sinistres créés avant l'ajout d'Airbnb avaient
  // origine: "booking" directement (pas de champ canal séparé).
  const isDirect = s.origine === "direct";
  const canal = s.canal || (s.origine === "booking" ? "booking" : null);

  return (
    <div className="resid" style={{ padding: "12px 14px", background: s.problemeRegle ? "#f4faf4" : "#fdf9f0", borderRadius: 8, marginBottom: 10, border: "1px solid #eee" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong>{s.client}</strong>{" "}
          {s.residence && <span style={{ fontSize: 12, color: "#666" }}>· {s.residence} {s.appartement}</span>}
          <span style={{ fontSize: 12, color: "#888" }}> · {fmtFr(s.date)}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: isDirect ? "#8e44ad" : "#2980b9" }}>
            {isDirect ? "En direct" : (CANAL_LABEL[canal] || "Plateforme")}
          </span>
          <button onClick={onDelete} className="ghost" style={{ color: "#e74c3c" }}>✕</button>
        </div>
      </div>

      <div style={{ fontSize: 14, margin: "6px 0" }}>{s.motif}</div>
      {s.montant != null && <div style={{ fontSize: 13, color: "#e74c3c" }}>Montant : {euros(s.montant)}</div>}
      {s.note && <div style={{ fontSize: 12, color: "#666", fontStyle: "italic" }}>{s.note}</div>}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={!!s.reponseRapide} onChange={e => onUpdate({ reponseRapide: e.target.checked })} />
          Répondu rapidement
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={!!s.problemeRegle} onChange={e => onUpdate({ problemeRegle: e.target.checked })} />
          Problème réglé
        </label>
        <label style={{ fontSize: 12 }}>
          Statut plateforme{" "}
          <select value={s.statutPlateforme || s.statutBooking || "non_ouvert"} onChange={e => onUpdate({ statutPlateforme: e.target.value })}>
            {STATUT_PLATEFORME.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

export default function SinistresPage() {
  return <Sinistres />;
}
