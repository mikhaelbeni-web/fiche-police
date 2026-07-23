// pages/arrivees.js
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { getCurrentStaff, setCurrentStaff, listStaff, ensureStaff, deleteStaff } from "../lib/staff";
import StaffBar from "../components/StaffBar";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

function isoDay(d) {
  // Date locale (pas UTC) : evite le decalage "hier" observe entre minuit
  // et l'heure UTC en France (ete/hiver), car toISOString() est en UTC.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}

function Arrivees() {
  const today = isoDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [residence, setResidence] = useState("__all__");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [creds, setCreds] = useState({ account: "", key: "" });

  const [fsApi, setFsApi] = useState(null);
  const [current, setCurrent] = useState("");
  const [staffList, setStaffList] = useState([]);
  const [attrib, setAttrib] = useState({}); // { [reservationId]: { by, at } }

  useEffect(() => {
    const a = window.localStorage.getItem(ACCOUNT_KEY) || "";
    const k = window.localStorage.getItem(KEY_KEY) || "";
    setCreds({ account: a, key: k });
    setCurrent(getCurrentStaff());
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) return;
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, orderBy };
      setFsApi(api);
      try { setStaffList(await listStaff(api)); } catch { /* pas encore de staff enregistré */ }
    })();
  }, []);

  // Charge l'attribution "fait par" des check-in visibles sur la période affichée.
  useEffect(() => {
    if (!fsApi || !data?.groups) return;
    (async () => {
      const ids = [...new Set(data.groups.flatMap(g => g.items.map(it => String(it.reservation))))].filter(Boolean);
      const next = {};
      await Promise.all(ids.map(async id => {
        try {
          const snap = await fsApi.getDoc(fsApi.doc(fsApi.db, "checkin_attribution", id));
          if (snap.exists()) next[id] = snap.data();
        } catch { /* ignore */ }
      }));
      setAttrib(next);
    })();
  }, [fsApi, data]);

  function pickStaff(name) {
    setCurrent(name);
    setCurrentStaff(name);
  }
  async function addStaff(name) {
    if (fsApi) { try { await ensureStaff(fsApi, name); setStaffList(await listStaff(fsApi)); } catch { /* ignore */ } }
    pickStaff(name);
  }
  async function removeStaff(name) {
    if (!fsApi) return;
    try { await deleteStaff(fsApi, name); setStaffList(await listStaff(fsApi)); } catch { /* ignore */ }
  }

  async function markCheckin(reservationId) {
    if (!fsApi || !current || !reservationId) return;
    const entry = { by: current, at: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) };
    setAttrib(prev => ({ ...prev, [reservationId]: entry })); // optimiste
    try {
      await fsApi.setDoc(fsApi.doc(fsApi.db, "checkin_attribution", String(reservationId)), entry, { merge: true });
    } catch { /* pas bloquant pour l'accueil */ }
  }

  const load = useCallback(async (f, t, acc, key) => {
    if (!acc || !key) { setStatus("Identifiants Hostaway manquants — configure-les sur la page Fiches."); return; }
    setLoading(true);
    setStatus("Chargement…");
    try {
      const res = await fetch(`/api/arrivals?from=${f}&to=${t}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      setData(d);
      setStatus(`${d.total} arrivée(s) sur la période`);
    } catch (err) {
      setStatus("Erreur : " + err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (creds.account && creds.key) load(from, to, creds.account, creds.key);
  }, [from, to, creds, load]);

  function setToday() { setFrom(today); setTo(today); }
  function setTomorrow() {
    const t = isoDay(new Date(Date.now() + 864e5));
    setFrom(t); setTo(t);
  }
  function setWeek() {
    setFrom(today);
    setTo(isoDay(new Date(Date.now() + 6 * 864e5)));
  }

  const groups = (data?.groups || []).filter(
    g => residence === "__all__" || g.residence === residence
  );
  const shownTotal = groups.reduce((s, g) => s + g.count, 0);

  function downloadCSV() {
    const rows = [["Résidence", "N°", "Appartement", "Date d'arrivée", "Client", "Note", "Réservation"]];
    for (const g of groups) {
      for (const it of g.items) {
        rows.push([g.residence, it.unitNumber, it.appartement, fmtFr(it.arrivee), it.client, "", it.reservation]);
      }
    }
    const csv = rows
      .map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const label = from === to ? from : `${from}_${to}`;
    a.download = `arrivees_${label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Head><title>Arrivées — Résidences</title></Head>

      <StaffBar current={current} list={staffList} onPick={pickStaff} onAdd={addStaff} onDelete={removeStaff} compact />

      <div className="toolbar">
        <h1>Arrivées</h1>

        <div className="quick">
          <button onClick={setToday}>Aujourd&apos;hui</button>
          <button onClick={setTomorrow}>Demain</button>
          <button onClick={setWeek}>7 jours</button>
        </div>

        <div className="field">
          <label>Du</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>Au</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Résidence</label>
          <select value={residence} onChange={e => setResidence(e.target.value)}>
            <option value="__all__">Toutes</option>
            {(data?.residences || []).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <button onClick={() => load(from, to, creds.account, creds.key)} disabled={loading} title="Actualiser">↻</button>
        <button className="primary" onClick={downloadCSV} disabled={!shownTotal}>Télécharger CSV</button>
        <button onClick={() => window.print()} disabled={!shownTotal}>Imprimer</button>

        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          <div className="recap-head">
            <div>
              <div className="recap-title">
                {from === to
                  ? `Arrivées du ${fmtFr(from)}`
                  : `Arrivées du ${fmtFr(from)} au ${fmtFr(to)}`}
              </div>
              <div className="recap-sub">Un check-in = une arrivée · réservations annulées et demandes exclues</div>
            </div>
            <div className="recap-total">
              <div className="n">{shownTotal}</div>
              <div className="l">arrivée{shownTotal > 1 ? "s" : ""}</div>
            </div>
          </div>

          {groups.map(g => (
            <div className="resid" key={g.residence}>
              <div className="resid-head">
                <span className="resid-name">{g.residence}</span>
                <span className="resid-count">{g.count} arrivée{g.count > 1 ? "s" : ""}</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Appartement</th>
                    <th>Arrivée</th>
                    <th>Client</th>
                    <th className="note-col">Note</th>
                    <th className="c">Fait</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, i) => {
                    const rid = String(it.reservation || "");
                    const done = attrib[rid];
                    return (
                      <tr key={i}>
                        <td className="apt">{it.unitNumber || "—"}</td>
                        <td>{it.appartement}</td>
                        <td>{fmtFr(it.arrivee)}</td>
                        <td>{it.client}</td>
                        <td className="note-col"></td>
                        <td className="c">
                          {done ? (
                            <span className="checkin-done" title={`Check-in fait par ${done.by} à ${done.at}`}>
                              ✓ {done.by}
                            </span>
                          ) : (
                            <button
                              className="checkin-btn"
                              disabled={!rid || !current}
                              title={!current ? "Choisis ton prénom ci-dessus" : "Marquer le check-in fait"}
                              onClick={() => markCheckin(rid)}
                            >
                              Marquer fait
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {!loading && shownTotal === 0 && (
            <div className="empty-state">Aucune arrivée sur cette période.</div>
          )}
        </div>
      </div>
    </>
  );
}

export default function ArriveesPage() {
  return <Arrivees />;
}
