// pages/taches.js
// Tâches créées sur Hostaway (maintenance, ménage, etc.), affichées en vraie
// liste — une ligne par tâche, pas des cases — pour tenir sur une feuille à
// l'impression. Filtrable par résidence et/ou appartement.

import { useState, useEffect } from "react";
import Head from "next/head";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}

const STATUT_LABEL = {
  notStarted: "À faire", pending: "À faire", open: "À faire",
  inProgress: "En cours", started: "En cours",
  completed: "Fait", done: "Fait", closed: "Fait",
};

function Taches() {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState([]);
  const [unresolved, setUnresolved] = useState([]);
  const [status, setStatus] = useState("");
  const [residence, setResidence] = useState("__all__");
  const [appartement, setAppartement] = useState("__all__");
  const [cacherFaites, setCacherFaites] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setStatus("Chargement…");
    try {
      const acc = window.localStorage.getItem(ACCOUNT_KEY) || "";
      const key = window.localStorage.getItem(KEY_KEY) || "";
      if (!acc || !key) { setStatus("Identifiants Hostaway non configurés (onglet Fiches de police)."); setReady(true); return; }
      const res = await fetch("/api/tasks", { headers: { "x-hostaway-account": acc, "x-hostaway-key": key } });
      const d = await res.json();
      if (!res.ok) { setStatus("Erreur : " + (d.error || res.status)); setReady(true); return; }
      setItems(d.items || []);
      setUnresolved(d.unresolved || []);
      setStatus("");
    } catch (err) { setStatus("Erreur : " + err.message); }
    setReady(true);
  }

  const residences = Array.from(new Set(items.map(i => i.residence))).sort((a, b) => a.localeCompare(b));
  const appartements = Array.from(new Set(
    items.filter(i => residence === "__all__" || i.residence === residence).map(i => i.appartement)
  )).sort((a, b) => a.localeCompare(b));

  const visibles = items
    .filter(i => residence === "__all__" || i.residence === residence)
    .filter(i => appartement === "__all__" || i.appartement === appartement)
    .filter(i => !cacherFaites || !(i.statut === "completed" || i.statut === "done" || i.statut === "closed"));

  return (
    <>
      <Head><title>Tâches</title></Head>
      <div className="toolbar">
        <h1>Tâches</h1>
        <div className="quick">
          <label className="field">
            <select value={residence} onChange={e => { setResidence(e.target.value); setAppartement("__all__"); }}>
              <option value="__all__">Toutes résidences</option>
              {residences.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="field">
            <select value={appartement} onChange={e => setAppartement(e.target.value)}>
              <option value="__all__">Tous appartements</option>
              {appartements.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#fff" }}>
            <input type="checkbox" checked={cacherFaites} onChange={e => setCacherFaites(e.target.checked)} />
            Masquer les tâches faites
          </label>
          <button onClick={load}>↻</button>
          <button onClick={() => window.print()} className="primary" disabled={!visibles.length}>Imprimer</button>
        </div>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          <div className="recap-head">
            <div>
              <div className="recap-title">Liste des tâches</div>
              <div className="recap-sub">{visibles.length} tâche(s) {residence !== "__all__" ? `— ${residence}` : ""}{appartement !== "__all__" ? ` — ${appartement}` : ""}</div>
            </div>
          </div>

          {!ready && <div className="empty-state">Chargement…</div>}
          {ready && visibles.length === 0 && !status && <div className="empty-state">Aucune tâche sur ce filtre.</div>}

          {visibles.length > 0 && (
            <div className="tbl-wrap"><table className="tbl taches-tbl">
              <thead>
                <tr>
                  <th>Appartement</th>
                  <th>Tâche</th>
                  <th>Assignée à</th>
                  <th>Échéance</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(t => (
                  <tr key={t.id}>
                    <td className="apt">{t.residence} {t.appartement}{t.unitNumber ? ` (${t.unitNumber})` : ""}</td>
                    <td>
                      {t.titre}
                      {t.description && <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.description}</div>}
                    </td>
                    <td>{t.assigne || "—"}</td>
                    <td>{fmtFr(t.echeance) || "—"}</td>
                    <td>{STATUT_LABEL[t.statut] || t.statut || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}

          {unresolved.length > 0 && (
            <p style={{ fontSize: 11, color: "#999", marginTop: 14 }}>
              {unresolved.length} tâche(s) non rattachée(s) à un appartement connu (listing non résolu) — pas affichées ci-dessus.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

export default function TachesPage() {
  return <Taches />;
}
