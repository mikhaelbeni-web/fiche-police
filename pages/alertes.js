// pages/alertes.js
// Alertes / tâches prioritaires — liste manuelle (pas liée à Hostaway) des
// choses à faire en priorité, avec case à cocher une fois fait. Sans code :
// c'est un pense-bête d'équipe, pas une action sensible.

import { useState, useEffect } from "react";
import Head from "next/head";

function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d);
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Alertes() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [alertes, setAlertes] = useState([]);
  const [status, setStatus] = useState("");
  const [titre, setTitre] = useState("");
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadAll(api);
      setReady(true);
    })();
  }, []);

  async function loadAll(api) {
    const snap = await api.getDocs(api.query(api.collection(api.db, "alertes"), api.orderBy("createdAt", "desc")));
    setAlertes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  async function addAlerte() {
    if (!titre.trim()) { setStatus("Le titre est obligatoire."); return; }
    try {
      setStatus("Enregistrement…");
      await fs.addDoc(fs.collection(fs.db, "alertes"), {
        titre: titre.trim(), note: note.trim(), urgent,
        fait: false, faitAt: null,
        createdAt: new Date().toISOString(),
      });
      setTitre(""); setNote(""); setUrgent(false);
      await loadAll(fs);
      setStatus("Alerte ajoutée.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function toggleFait(a) {
    try {
      await fs.updateDoc(fs.doc(fs.db, "alertes", a.id), {
        fait: !a.fait, faitAt: !a.fait ? new Date().toISOString() : null,
      });
      await loadAll(fs);
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function delAlerte(id) {
    if (!confirm("Supprimer définitivement cette alerte ?")) return;
    try {
      await fs.deleteDoc(fs.doc(fs.db, "alertes", id));
      await loadAll(fs);
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <>
        <div className="toolbar"><h1>🔔 Alertes</h1></div>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "#666", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
        </div></div>
      </>
    );
  }

  const open = alertes.filter(a => !a.fait).sort((a, b) => {
    if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  const done = alertes.filter(a => a.fait);

  return (
    <>
      <Head><title>Alertes — Tâches prioritaires</title></Head>
      <div className="toolbar">
        <h1>🔔 Alertes</h1>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          <div className="recap-head">
            <div>
              <div className="recap-title">Tâches prioritaires</div>
              <div className="recap-sub">À faire en priorité — coche une fois que c&apos;est fait</div>
            </div>
            <div className="recap-total">
              <div className="n">{open.length}</div>
              <div className="l">en attente</div>
            </div>
          </div>

          <div className="linen-form" style={{ marginBottom: 18 }}>
            <div className="recap-title" style={{ fontSize: 15, marginBottom: 10 }}>Nouvelle alerte</div>
            <div className="linen-form-row">
              <label style={{ flex: 1 }}>Titre (obligatoire)
                <input type="text" value={titre} onChange={e => setTitre(e.target.value)}
                  placeholder="ex. Appeler le plombier pour la fuite A3" style={{ width: "100%" }} />
              </label>
            </div>
            <div className="linen-form-row">
              <label style={{ flex: 1 }}>Détail (optionnel)
                <input type="text" value={note} onChange={e => setNote(e.target.value)}
                  placeholder="ex. Intervention à prévoir avant vendredi" style={{ width: "100%" }} />
              </label>
            </div>
            <div className="linen-form-row">
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />
                Urgent (mise en avant en haut de liste)
              </label>
            </div>
            <button className="primary" onClick={addAlerte}>Ajouter l&apos;alerte</button>
          </div>

          {open.length === 0 && (
            <div className="empty-state">Aucune alerte en attente 🎉</div>
          )}

          {open.length > 0 && (
            <div className="alert-list">
              {open.map(a => (
                <div key={a.id} className={`alert-card${a.urgent ? " urgent" : ""}`}>
                  <label className="alert-check">
                    <input type="checkbox" checked={false} onChange={() => toggleFait(a)} />
                  </label>
                  <div className="alert-body">
                    <div className="alert-title">
                      {a.urgent && <span className="alert-badge">URGENT</span>}
                      {a.titre}
                    </div>
                    {a.note && <div className="alert-note">{a.note}</div>}
                    <div className="alert-meta">Ajoutée le {fmtFr(a.createdAt)}</div>
                  </div>
                  <button onClick={() => delAlerte(a.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 22 }}>
            <button className="ghost" onClick={() => setShowDone(v => !v)}>
              {showDone ? "Masquer" : "Afficher"} les alertes terminées ({done.length})
            </button>
          </div>

          {showDone && done.length > 0 && (
            <div className="alert-list" style={{ marginTop: 12 }}>
              {done.map(a => (
                <div key={a.id} className="alert-card done">
                  <label className="alert-check">
                    <input type="checkbox" checked={true} onChange={() => toggleFait(a)} />
                  </label>
                  <div className="alert-body">
                    <div className="alert-title done">{a.titre}</div>
                    {a.note && <div className="alert-note">{a.note}</div>}
                    <div className="alert-meta">Fait le {fmtFr(a.faitAt)}</div>
                  </div>
                  <button onClick={() => delAlerte(a.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function AlertesPage() {
  return <Alertes />;
}
