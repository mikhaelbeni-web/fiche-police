// pages/menage.js
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

function isoDay(d) { return d.toISOString().slice(0, 10); }
function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}

function Menage() {
  const today = isoDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [residence, setResidence] = useState("__all__");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [creds, setCreds] = useState({ account: "", key: "" });
  const [extraMenages, setExtraMenages] = useState([]);

  useEffect(() => {
    const a = window.localStorage.getItem(ACCOUNT_KEY) || "";
    const k = window.localStorage.getItem(KEY_KEY) || "";
    setCreds({ account: a, key: k });
  }, []);

  // Ménages supplémentaires ajoutés depuis /linge (Firebase) — doivent apparaître
  // dans la liste opérationnelle du jour, pas seulement dans les coûts.
  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) return;
      const { db } = await import("../lib/firebase");
      const { collection, getDocs, query, orderBy } = await import("firebase/firestore");
      const snap = await getDocs(query(collection(db, "extra_menages"), orderBy("date", "desc")));
      setExtraMenages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    })();
  }, []);

  const load = useCallback(async (f, t, acc, key) => {
    if (!acc || !key) { setStatus("Identifiants Hostaway manquants — configure-les sur la page Fiches."); return; }
    setLoading(true);
    setStatus("Chargement…");
    try {
      const res = await fetch(`/api/departures?from=${f}&to=${t}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      setData(d);
      setStatus(`${d.total} ménage(s) sur la période`);
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

  // Ménages supplémentaires dans la plage de dates et la résidence sélectionnées,
  // marqués distinctement (badge + motif) mais comptés avec les autres.
  const extraFiltered = extraMenages.filter(e => {
    if (residence !== "__all__" && e.residence !== residence) return false;
    return e.date >= from && e.date <= to;
  });

  const byResidence = {};
  for (const g of groups) {
    byResidence[g.residence] = { residence: g.residence, items: [...g.items], count: g.count };
  }
  for (const e of extraFiltered) {
    if (!byResidence[e.residence]) byResidence[e.residence] = { residence: e.residence, items: [], count: 0 };
    byResidence[e.residence].items.push({
      unitNumber: e.unitNumber, appartement: e.appartement, depart: e.date,
      client: null, extra: true, motif: e.motif,
    });
    byResidence[e.residence].count += 1;
  }
  const mergedGroups = Object.values(byResidence).sort((a, b) => a.residence.localeCompare(b.residence));
  const shownTotal = mergedGroups.reduce((s, g) => s + g.count, 0);

  function downloadCSV() {
    const rows = [["Résidence", "N°", "Appartement", "Date de départ", "Client", "Note", "Réservation"]];
    for (const g of mergedGroups) {
      for (const it of g.items) {
        const note = it.extra ? `Ménage supplémentaire : ${it.motif}` : "";
        rows.push([g.residence, it.unitNumber, it.appartement, fmtFr(it.depart), it.client || "", note, it.reservation || ""]);
      }
    }
    const csv = rows
      .map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    // BOM UTF-8 pour Excel
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const label = from === to ? from : `${from}_${to}`;
    a.download = `menages_${label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Head><title>Ménages — Résidences</title></Head>

      <div className="toolbar">
        <h1>Ménages</h1>

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
                  ? `Ménages du ${fmtFr(from)}`
                  : `Ménages du ${fmtFr(from)} au ${fmtFr(to)}`}
              </div>
              <div className="recap-sub">Un check-out = un ménage · réservations annulées exclues</div>
            </div>
            <div className="recap-total">
              <div className="n">{shownTotal}</div>
              <div className="l">ménage{shownTotal > 1 ? "s" : ""}</div>
            </div>
          </div>

          {mergedGroups.map(g => (
            <div className="resid" key={g.residence}>
              <div className="resid-head">
                <span className="resid-name">{g.residence}</span>
                <span className="resid-count">{g.count} ménage{g.count > 1 ? "s" : ""}</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Appartement</th>
                    <th>Départ</th>
                    <th>Client</th>
                    <th className="note-col">Note</th>
                    <th className="c">Fait</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, i) => (
                    <tr key={i} style={it.extra ? { background: "#fff8ec" } : undefined}>
                      <td className="apt">{it.unitNumber || "—"}</td>
                      <td>{it.appartement}</td>
                      <td>{fmtFr(it.depart)}</td>
                      <td>
                        {it.extra
                          ? <span style={{ color: "#b8860b", fontWeight: 700, fontSize: 12 }}>SUPPLÉMENTAIRE</span>
                          : it.client}
                      </td>
                      <td className="note-col">{it.extra ? <span style={{ fontStyle: "italic", color: "var(--muted)" }}>{it.motif}</span> : null}</td>
                      <td className="c"><span className="box" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {!loading && shownTotal === 0 && (
            <div className="empty-state">Aucun ménage sur cette période.</div>
          )}
        </div>
      </div>
    </>
  );
}

export default function MenagePage() {
  return <Menage />;
}
