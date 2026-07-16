// pages/couts.js
// Calcule le coût ménage (+ amenities) sur une plage de dates, à partir du nombre
// de check-outs par appartement et du tarif statique de lib/apartments.js.

import { useState, useEffect, useCallback } from "react";
import Head from "next/head";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

function isoDay(d) { return d.toISOString().slice(0, 10); }
function fmtFr(d) {
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
function euros(n) {
  if (n == null) return "—";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function Couts() {
  const today = isoDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [residence, setResidence] = useState("__all__");
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [creds, setCreds] = useState({ account: "", key: "" });

  useEffect(() => {
    setCreds({
      account: window.localStorage.getItem(ACCOUNT_KEY) || "",
      key: window.localStorage.getItem(KEY_KEY) || "",
    });
  }, []);

  const load = useCallback(async (f, t, acc, key) => {
    if (!acc || !key) { setStatus("Identifiants Hostaway manquants — configure-les sur la page Fiches."); return; }
    setLoading(true);
    setStatus("Chargement…");
    try {
      const res = await fetch(`/api/departures?from=${f}&to=${t}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Erreur");

      // Chaque item de départ porte déjà son tarif, résolu côté serveur
      // (gère les listings multi-unit via reservationUnit).
      const flat = [];
      for (const g of j.groups || []) {
        for (const it of g.items) {
          flat.push({
            residence: g.residence,
            appartement: it.appartement,
            unitNumber: it.unitNumber || "—",
            depart: it.depart,
            menageHT: it.menageHT,
            amenitiesHT: it.amenitiesHT,
          });
        }
      }
      setRows(flat);
      setStatus(`${flat.length} ménage(s) trouvé(s)`);
    } catch (err) {
      setStatus("Erreur : " + err.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (creds.account && creds.key) load(from, to, creds.account, creds.key);
  }, [from, to, creds, load]);

  function setToday() { setFrom(today); setTo(today); }
  function setMonth() {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    setFrom(isoDay(first)); setTo(isoDay(last));
  }

  const residences = Array.from(new Set(rows.map(r => r.residence))).sort((a, b) => a.localeCompare(b));
  const filtered = rows.filter(r => residence === "__all__" || r.residence === residence);

  const byResidence = {};
  for (const r of filtered) {
    if (!byResidence[r.residence]) byResidence[r.residence] = { residence: r.residence, items: [], menage: 0, amenities: 0, unknown: 0 };
    byResidence[r.residence].items.push(r);
    if (r.menageHT != null) byResidence[r.residence].menage += r.menageHT;
    else byResidence[r.residence].unknown += 1;
    if (r.amenitiesHT != null) byResidence[r.residence].amenities += r.amenitiesHT;
  }
  const groups = Object.values(byResidence).sort((a, b) => a.residence.localeCompare(b.residence));
  const grandMenage = groups.reduce((s, g) => s + g.menage, 0);
  const grandAmenities = groups.reduce((s, g) => s + g.amenities, 0);
  const grandTotal = grandMenage + grandAmenities;
  const unknownCount = groups.reduce((s, g) => s + g.unknown, 0);

  function downloadCSV() {
    const headerRows = [["Résidence", "N°", "Appartement", "Départ", "Ménage HT", "Amenities HT", "Total HT"]];
    for (const g of groups) {
      for (const it of g.items) {
        const total = (it.menageHT ?? 0) + (it.amenitiesHT ?? 0);
        headerRows.push([g.residence, it.unitNumber, it.appartement, fmtFr(it.depart), it.menageHT ?? "?", it.amenitiesHT ?? "—", total]);
      }
    }
    headerRows.push([]);
    headerRows.push(["TOTAL", "", "", "", grandMenage.toFixed(2), grandAmenities.toFixed(2), grandTotal.toFixed(2)]);
    const csv = headerRows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `couts_menage_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Head><title>Coûts ménage</title></Head>

      <div className="toolbar">
        <h1>Coûts ménage</h1>
        <div className="quick">
          <button onClick={setToday}>Aujourd&apos;hui</button>
          <button onClick={setMonth}>Ce mois-ci</button>
        </div>
        <div className="field"><label>Du</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="field"><label>Au</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="field">
          <label>Résidence</label>
          <select value={residence} onChange={e => setResidence(e.target.value)}>
            <option value="__all__">Toutes</option>
            {residences.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button onClick={() => load(from, to, creds.account, creds.key)} disabled={loading} title="Actualiser">↻</button>
        <button className="primary" onClick={downloadCSV} disabled={!filtered.length}>Télécharger CSV</button>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          <div className="recap-head">
            <div>
              <div className="recap-title">
                {from === to ? `Coûts ménage du ${fmtFr(from)}` : `Coûts ménage du ${fmtFr(from)} au ${fmtFr(to)}`}
              </div>
              <div className="recap-sub">
                Tarifs HT fixes par appartement · {filtered.length} ménage(s)
                {unknownCount > 0 && ` · ${unknownCount} sans tarif connu`}
              </div>
            </div>
          </div>

          {groups.map(g => (
            <div className="resid" key={g.residence}>
              <div className="resid-head">
                <span className="resid-name">{g.residence}</span>
                <span className="resid-count">
                  {g.items.length} ménage(s) · {euros(g.menage + g.amenities)}
                </span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>N°</th><th>Appartement</th><th>Départ</th>
                    <th className="c">Ménage HT</th><th className="c">Amenities HT</th><th className="c">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, i) => (
                    <tr key={i}>
                      <td className="apt">{it.unitNumber}</td>
                      <td>{it.appartement}</td>
                      <td>{fmtFr(it.depart)}</td>
                      <td className="c">{it.menageHT != null ? euros(it.menageHT) : "?"}</td>
                      <td className="c">{it.amenitiesHT != null ? euros(it.amenitiesHT) : "—"}</td>
                      <td className="c">{euros((it.menageHT ?? 0) + (it.amenitiesHT ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {!loading && filtered.length === 0 && (
            <div className="empty-state">Aucun ménage sur cette période.</div>
          )}

          {groups.length > 0 && (
            <div className="grand-total">
              <span>Ménage : {euros(grandMenage)}</span>
              <span>Amenities : {euros(grandAmenities)}</span>
              <span className="gt">Total HT : {euros(grandTotal)}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function CoutsPage() {
  return <Couts />;
}
