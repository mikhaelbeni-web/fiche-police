// pages/consignes.js
// Suivi des consignes à bagages par résidence (Villiers, Lantiez). Une réservation
// bloque un casier sur une plage de dates ; le lendemain de la fin, il redevient
// libre automatiquement (aucune action manuelle). Firebase pour la persistance.

import { useState, useEffect } from "react";
import Head from "next/head";
import { LOCKERS_CONFIG, today, isOccupied, overlaps } from "../lib/lockers";

function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}

function Consignes() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [status, setStatus] = useState("");
  const [formResidence, setFormResidence] = useState("Lantiez");
  const [formLocker, setFormLocker] = useState("1");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [appartement, setAppartement] = useState("");
  const [client, setClient] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadAll(api);
      setReady(true);
    })();
  }, []);

  async function loadAll(api) {
    setStatus("Chargement…");
    const snap = await api.getDocs(api.query(api.collection(api.db, "locker_bookings"), api.orderBy("startDate", "asc")));
    setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setStatus("");
  }

  async function addBooking() {
    if (!appartement && !client) { setStatus("Renseigne au moins l'appartement ou le nom du client."); return; }
    if (endDate < startDate) { setStatus("La date de fin doit être après la date de début."); return; }

    // Vérifie les chevauchements sur ce casier avant d'enregistrer
    const conflict = bookings.find(b =>
      b.residence === formResidence && b.lockerId === formLocker &&
      overlaps(startDate, endDate, b.startDate, b.endDate)
    );
    if (conflict) {
      setStatus(`Conflit : ce casier est déjà réservé du ${fmtFr(conflict.startDate)} au ${fmtFr(conflict.endDate)} (${conflict.client || conflict.appartement || "—"}).`);
      return;
    }

    try {
      setStatus("Enregistrement…");
      await fs.addDoc(fs.collection(fs.db, "locker_bookings"), {
        residence: formResidence, lockerId: formLocker,
        startDate, endDate, appartement: appartement || "", client: client || "", code: code || "",
        createdAt: new Date().toISOString(),
      });
      setAppartement(""); setClient(""); setCode("");
      await loadAll(fs);
      setStatus("Réservation enregistrée.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function delBooking(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette réservation ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "locker_bookings", id));
    await loadAll(fs);
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <>
        <div className="toolbar"><h1>Consignes à bagages</h1></div>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "#666", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
        </div></div>
      </>
    );
  }

  const t = today();
  // Purge visuelle : les réservations totalement passées (endDate < aujourd'hui) sont
  // toujours en base (historique) mais n'occupent plus rien — le casier est libre
  // automatiquement dès que la date du jour dépasse endDate, sans action manuelle.
  const activeAndFuture = bookings.filter(b => b.endDate >= t);
  const past = bookings.filter(b => b.endDate < t);

  return (
    <>
      <Head><title>Consignes à bagages</title></Head>
      <div className="toolbar">
        <h1>Consignes à bagages</h1>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          <div className="recap-title">État en temps réel</div>
          <div className="recap-sub">Libération automatique le lendemain de la date de fin — rien à faire manuellement</div>

          {Object.entries(LOCKERS_CONFIG).map(([residence, cfg]) => (
            <div className="resid" key={residence}>
              <div className="resid-head"><span className="resid-name">{residence}</span></div>
              <div className="locker-grid">
                {cfg.bookable.map(l => {
                  const occ = activeAndFuture.find(b => b.residence === residence && b.lockerId === l.id && isOccupied(b, t));
                  const upcoming = activeAndFuture
                    .filter(b => b.residence === residence && b.lockerId === l.id && b.startDate > t)
                    .sort((a, b) => a.startDate.localeCompare(b.startDate));
                  return (
                    <div key={l.id} className={`locker-card${occ ? " occupied" : ""}`}>
                      <div className="locker-card-title">{l.label}</div>
                      {occ ? (
                        <>
                          <div className="locker-status occ">Occupée</div>
                          <div className="locker-detail">{occ.appartement || "—"} {occ.client ? `· ${occ.client}` : ""}</div>
                          <div className="locker-detail small">jusqu&apos;au {fmtFr(occ.endDate)}</div>
                        </>
                      ) : (
                        <div className="locker-status free">Libre</div>
                      )}
                      {upcoming.length > 0 && (
                        <div className="locker-upcoming">
                          {upcoming.slice(0, 2).map(u => (
                            <div key={u.id} className="locker-detail small">
                              À venir : {fmtFr(u.startDate)}{u.startDate !== u.endDate ? `→${fmtFr(u.endDate)}` : ""} · {u.appartement || u.client || "—"}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {cfg.fixed.map(l => (
                  <div key={l.id} className="locker-card fixed">
                    <div className="locker-card-title">{l.label}</div>
                    <div className="locker-status fixed">Réservée en permanence</div>
                    <div className="locker-detail small">{l.usage}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="linen-form" style={{ marginTop: 20 }}>
            <div className="recap-title" style={{ fontSize: 15, marginBottom: 10 }}>Nouvelle réservation</div>
            <div className="linen-form-row">
              <label>Résidence
                <select value={formResidence} onChange={e => { setFormResidence(e.target.value); setFormLocker(LOCKERS_CONFIG[e.target.value].bookable[0].id); }}>
                  {Object.keys(LOCKERS_CONFIG).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label>Consigne
                <select value={formLocker} onChange={e => setFormLocker(e.target.value)}>
                  {LOCKERS_CONFIG[formResidence].bookable.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
              <label>Du <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
              <label>Au <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
            </div>
            <div className="linen-form-row">
              <label>Appartement <input type="text" value={appartement} onChange={e => setAppartement(e.target.value)} style={{ width: 130 }} /></label>
              <label>Nom du client <input type="text" value={client} onChange={e => setClient(e.target.value)} style={{ width: 180 }} /></label>
              <label>Code envoyé (optionnel) <input type="text" value={code} onChange={e => setCode(e.target.value)} style={{ width: 120 }} /></label>
            </div>
            <button className="primary" onClick={addBooking}>Réserver</button>
          </div>

          <div className="recap-title" style={{ fontSize: 15, marginTop: 24 }}>Réservations à venir et en cours</div>
          <table className="tbl">
            <thead>
              <tr><th>Résidence</th><th>Consigne</th><th>Du</th><th>Au</th><th>Appartement</th><th>Client</th><th>Code</th><th></th></tr>
            </thead>
            <tbody>
              {activeAndFuture.sort((a, b) => a.startDate.localeCompare(b.startDate)).map(b => (
                <tr key={b.id} style={{ background: isOccupied(b, t) ? "#fdf3e6" : "transparent" }}>
                  <td>{b.residence}</td>
                  <td>{LOCKERS_CONFIG[b.residence]?.bookable.find(l => l.id === b.lockerId)?.label || b.lockerId}</td>
                  <td>{fmtFr(b.startDate)}</td>
                  <td>{fmtFr(b.endDate)}</td>
                  <td>{b.appartement || "—"}</td>
                  <td>{b.client || "—"}</td>
                  <td>{b.code || "—"}</td>
                  <td><button onClick={() => delBooking(b.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button></td>
                </tr>
              ))}
              {activeAndFuture.length === 0 && <tr><td colSpan={8} className="empty-state">Aucune réservation en cours ou à venir.</td></tr>}
            </tbody>
          </table>

          {past.length > 0 && (
            <p style={{ fontSize: 12, color: "#999", marginTop: 10 }}>
              {past.length} réservation(s) passée(s), libérées automatiquement (non affichées ci-dessus).
            </p>
          )}
        </div>
      </div>
    </>
  );
}

export default function ConsignesPage() {
  return <Consignes />;
}
