// pages/taxes.js
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
function euros(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function Taxes() {
  const today = isoDay(new Date());
  const [from, setFrom] = useState("2026-07-10"); // départ fixe : 10 juillet
  const [to, setTo] = useState(today);
  const [residence, setResidence] = useState("__all__");
  const [data, setData] = useState(null);
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
      const res = await fetch(`/api/tourist-tax?from=${f}&to=${t}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erreur");
      setData(d);
      setStatus(`${d.total} réservation(s) · ${euros(d.totalTax)} de taxe`);
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

  const residences = Array.from(new Set((data?.items || []).map(i => i.residence))).sort((a, b) => a.localeCompare(b));
  const items = (data?.items || []).filter(i => residence === "__all__" || i.residence === residence);

  // Regroupement par résidence
  const byResidence = {};
  for (const it of items) {
    if (!byResidence[it.residence]) byResidence[it.residence] = { residence: it.residence, items: [], sum: 0 };
    byResidence[it.residence].items.push(it);
    byResidence[it.residence].sum += it.taxeSejour || 0;
  }
  const groups = Object.values(byResidence).sort((a, b) => a.residence.localeCompare(b.residence));
  const shownTotal = items.reduce((s, it) => s + (it.taxeSejour || 0), 0);

  function downloadCSV() {
    const rows = [["Résidence", "N°", "Appartement", "Arrivée", "Départ", "Client", "Statut paiement", "Taxe séjour", "Réservation"]];
    for (const g of groups) {
      for (const it of g.items) {
        rows.push([g.residence, it.unitNumber, it.appartement, fmtFr(it.arrivee), fmtFr(it.depart), it.client, it.paymentStatus, it.taxeSejour, it.reservation]);
      }
    }
    rows.push([]);
    rows.push(["TOTAL", "", "", "", "", "", "", shownTotal.toFixed(2), ""]);
    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `taxes_sejour_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Head><title>Taxes de séjour impayées</title></Head>

      <div className="toolbar">
        <h1>Taxes de séjour</h1>
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
            {residences.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button onClick={() => load(from, to, creds.account, creds.key)} disabled={loading} title="Actualiser">↻</button>
        <button className="primary" onClick={downloadCSV} disabled={!items.length}>Télécharger CSV</button>
        <button onClick={() => window.print()} disabled={!items.length}>Imprimer</button>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          <div className="recap-head">
            <div>
              <div className="recap-title">
                Taxes de séjour impayées · {fmtFr(from)} → {fmtFr(to)}
              </div>
              <div className="recap-sub">
                Booking.com uniquement · partiellement payé · check-in passé · réservations confirmées
              </div>
            </div>
            <div className="recap-total">
              <div className="n">{euros(shownTotal)}</div>
              <div className="l">taxe due</div>
            </div>
          </div>

          {groups.map(g => (
            <div className="resid" key={g.residence}>
              <div className="resid-head">
                <span className="resid-name">{g.residence}</span>
                <span className="resid-count">{g.items.length} résa · {euros(g.sum)}</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Appartement</th>
                    <th>Arrivée</th>
                    <th>Client</th>
                    <th>Statut</th>
                    <th className="c">Taxe séjour</th>
                    <th className="c">Réglé</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, i) => (
                    <tr key={i}>
                      <td className="apt">{it.unitNumber || "—"}</td>
                      <td>{it.appartement}</td>
                      <td>{fmtFr(it.arrivee)}</td>
                      <td>{it.client}</td>
                      <td>{it.paymentStatus}</td>
                      <td className="c">{euros(it.taxeSejour)}</td>
                      <td className="c"><span className="box" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {!loading && items.length === 0 && (
            <div className="empty-state">Aucune taxe de séjour impayée sur cette période.</div>
          )}

          {groups.length > 0 && (
            <div className="grand-total">
              <span className="gt">Total taxe due : {euros(shownTotal)}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function TaxesPage() {
  return <Taxes />;
}
