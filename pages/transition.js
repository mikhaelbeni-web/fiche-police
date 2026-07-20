// pages/transition.js
// Rapport de transition quotidien entre équipes de réception, remplace l'envoi
// de mail. Un rapport par jour, un bloc par résidence, 5 questions fixes.
// Le rapport du jour est modifiable ; les rapports passés sont verrouillés.

import { useState, useEffect } from "react";
import Head from "next/head";
import { RESIDENCES, QUESTIONS, emptyReport, today, yesterday, isLocked, hasAlert } from "../lib/shiftReport";

// Même mot de passe que les autres suppressions sensibles de l'app. Frein
// volontaire côté navigateur, pas une vraie sécurité. Changeable via
// NEXT_PUBLIC_DELETE_PASSWORD sur Vercel.
const DELETE_PASSWORD = process.env.NEXT_PUBLIC_DELETE_PASSWORD || "2305";
function checkDeletePassword() {
  const entered = prompt("Mot de passe requis pour cette suppression :");
  if (entered === null) return false;
  if (entered !== DELETE_PASSWORD) { alert("Mot de passe incorrect."); return false; }
  return true;
}

function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}


function Transition() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [tab, setTab] = useState("jour"); // jour | hier | historique
  const [status, setStatus] = useState("");

  const [todayReport, setTodayReport] = useState(null);
  const [yesterdayReport, setYesterdayReport] = useState(null);
  const [allReports, setAllReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null); // pour consultation détaillée depuis l'historique

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadToday(api);
      await loadYesterday(api);
      setReady(true);
    })();
  }, []);

  async function loadToday(api) {
    const snap = await api.getDoc(api.doc(api.db, "shift_reports", today()));
    setTodayReport(snap.exists() ? snap.data() : emptyReport(today()));
  }
  async function loadYesterday(api) {
    const snap = await api.getDoc(api.doc(api.db, "shift_reports", yesterday()));
    setYesterdayReport(snap.exists() ? snap.data() : null);
  }
  async function loadHistorique(api) {
    setStatus("Chargement de l'historique…");
    const snap = await api.getDocs(api.query(api.collection(api.db, "shift_reports"), api.orderBy("date", "desc")));
    setAllReports(snap.docs.map(d => d.data()));
    setStatus("");
  }

  async function saveReport(report) {
    try {
      setStatus("Enregistrement…");
      await fs.setDoc(fs.doc(fs.db, "shift_reports", report.date), report);
      setTodayReport(report);
      setStatus("Rapport enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  // Suppression protégée par mot de passe. Le rapport peut être supprimé qu'il
  // soit verrouillé ou non — la protection par date ne concerne que l'édition.
  async function deleteReport(report) {
    if (!checkDeletePassword()) return;
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le rapport du ${fmtFr(report.date)} ?`)) return;
    try {
      setStatus("Suppression…");
      await fs.deleteDoc(fs.doc(fs.db, "shift_reports", report.date));
      if (report.date === today()) setTodayReport(emptyReport(today()));
      if (report.date === yesterday()) setYesterdayReport(null);
      setAllReports(prev => prev.filter(r => r.date !== report.date));
      setSelectedReport(null);
      setStatus("Rapport supprimé.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  // Suppression protégée par mot de passe, réservée aux rapports verrouillés
  // (hier / historique) — jamais au rapport du jour en cours de rédaction.
  async function deleteReport(report) {
    if (!checkDeletePassword()) return;
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le rapport du ${fmtFr(report.date)} ?`)) return;
    try {
      setStatus("Suppression…");
      const { deleteDoc, doc } = await import("firebase/firestore");
      await deleteDoc(doc(fs.db, "shift_reports", report.date));
      if (tab === "hier") setYesterdayReport(null);
      if (tab === "historique") {
        setSelectedReport(null);
        await loadHistorique(fs);
      }
      setStatus("Rapport supprimé.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  function openTab(t) {
    setTab(t);
    setSelectedReport(null);
    if (t === "historique") loadHistorique(fs);
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <>
        <div className="toolbar"><h1>Rapport de transition</h1></div>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "#666", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
        </div></div>
      </>
    );
  }

  return (
    <>
      <Head><title>Rapport de transition</title></Head>
      <div className="toolbar">
        <h1>Rapport de transition</h1>
        <div className="quick">
          <button onClick={() => openTab("jour")} className={tab === "jour" ? "primary" : ""}>Aujourd&apos;hui</button>
          <button onClick={() => openTab("hier")} className={tab === "hier" ? "primary" : ""}>Rapport d&apos;hier</button>
          <button onClick={() => openTab("historique")} className={tab === "historique" ? "primary" : ""}>Historique</button>
        </div>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          {tab === "jour" && todayReport && (
            <ReportForm report={todayReport} onSave={saveReport} onDelete={deleteReport} locked={false} />
          )}
          {tab === "hier" && (
            yesterdayReport
              ? <ReportForm report={yesterdayReport} onSave={saveReport} onDelete={deleteReport} locked={isLocked(yesterdayReport.date)} />
              : <div className="empty-state">Aucun rapport enregistré pour hier.</div>
          )}
          {tab === "historique" && !selectedReport && (
            <HistoriqueList reports={allReports} onSelect={setSelectedReport} onDelete={deleteReport} />
          )}
          {tab === "historique" && selectedReport && (
            <>
              <button onClick={() => setSelectedReport(null)} className="ghost" style={{ marginBottom: 12 }}>← Retour à la liste</button>
              <ReportForm report={selectedReport} onSave={saveReport} onDelete={deleteReport} locked={isLocked(selectedReport.date)} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---- Formulaire d'un rapport (édition ou lecture seule si verrouillé) ----
function ReportForm({ report, onSave, onDelete, locked }) {
  const [draft, setDraft] = useState(report);
  useEffect(() => { setDraft(report); }, [report]);

  function setField(residence, key, value) {
    setDraft(d => ({
      ...d,
      residences: { ...d.residences, [residence]: { ...d.residences[residence], [key]: value } },
    }));
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title" style={{ textTransform: "capitalize" }}>{fmtFr(draft.date)}</div>
          <div className="recap-sub">{locked ? "Rapport verrouillé (jour passé) — lecture seule" : "Rapport du jour — modifiable jusqu'à minuit"}</div>
        </div>
      </div>

      {!locked && (
        <div className="linen-form-row" style={{ marginBottom: 14 }}>
          <label>Rédigé par <input type="text" value={draft.author || ""} onChange={e => setDraft({ ...draft, author: e.target.value })} placeholder="Prénom" style={{ width: 180 }} /></label>
        </div>
      )}
      {locked && draft.author && (
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Rédigé par <strong>{draft.author}</strong></div>
      )}
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => onDelete(draft)} className="ghost" style={{ color: "#e74c3c", fontSize: 12 }}>Supprimer ce rapport</button>
      </div>

      {RESIDENCES.map(res => (
        <div className="resid" key={res}>
          <div className="resid-head"><span className="resid-name">{res}</span></div>
          <div style={{ padding: "10px 4px" }}>
            {QUESTIONS.map(q => (
              <div key={q.key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>{q.label}</div>
                {locked ? (
                  <div style={{ fontSize: 14, padding: "4px 0" }}>{draft.residences[res]?.[q.key] || <span style={{ color: "#ccc" }}>—</span>}</div>
                ) : (
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <textarea
                      value={draft.residences[res]?.[q.key] || ""}
                      onChange={e => setField(res, q.key, e.target.value)}
                      rows={1}
                      style={{ flex: 1, padding: "7px 9px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                    />
                    {q.quickNon && (
                      <button onClick={() => setField(res, q.key, "Non")} type="button" style={{ fontSize: 12 }}>Non</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {!locked && (
        <button className="primary" onClick={() => onSave(draft)}>Enregistrer le rapport</button>
      )}
    </>
  );
}

// ---- Liste historique de tous les rapports, avec badge d'alerte ----
function HistoriqueList({ reports, onSelect, onDelete }) {
  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Historique des rapports</div>
          <div className="recap-sub">🔴 rapport avec un point signalé · 🟢 journée sans anomalie déclarée</div>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Date</th><th>Rédigé par</th><th className="c">État</th><th></th></tr>
        </thead>
        <tbody>
          {reports.map(r => (
            <tr key={r.date}>
              <td style={{ textTransform: "capitalize" }}>{fmtFr(r.date)}</td>
              <td>{r.author || "—"}</td>
              <td className="c">{hasAlert(r) ? "🔴" : "🟢"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => onSelect(r)} className="ghost" style={{ color: "#2980b9" }}>Consulter</button>
                <button onClick={() => onDelete(r)} className="ghost" style={{ color: "#e74c3c" }}>✕</button>
              </td>
            </tr>
          ))}
          {reports.length === 0 && <tr><td colSpan={4} className="empty-state">Aucun rapport enregistré.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

export default function TransitionPage() {
  return <Transition />;
}
