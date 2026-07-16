// pages/debug.js
// Page de diagnostic temporaire. Tableau compact des départs sur une période :
// nom du listing, ID top-level, ID de sous-unité réel, et résolution actuelle.
// Surligne les cas où un même nom de listing a plusieurs listingUnitId différents
// (signe qu'il s'agit d'un multi-unit non encore mappé dans lib/apartments.js).
import { useState, useEffect } from "react";
import Head from "next/head";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

function isoDay(d) { return d.toISOString().slice(0, 10); }

function Debug() {
  const [from, setFrom] = useState(isoDay(new Date()));
  const [to, setTo] = useState(isoDay(new Date()));
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState("");
  const [creds, setCreds] = useState({ account: "", key: "" });

  useEffect(() => {
    setCreds({
      account: window.localStorage.getItem(ACCOUNT_KEY) || "",
      key: window.localStorage.getItem(KEY_KEY) || "",
    });
  }, []);

  async function load() {
    setStatus("Chargement…");
    try {
      const res = await fetch(`/api/debug-multiunit?from=${from}&to=${to}`, {
        headers: { "x-hostaway-account": creds.account, "x-hostaway-key": creds.key },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Erreur");
      setRows(j.rows);
      setStatus(`${j.count} départ(s)`);
    } catch (err) {
      setStatus("Erreur : " + err.message);
      setRows(null);
    }
  }

  // Détecte : un même listingName associé à plusieurs listingUnitId différents
  const suspects = new Set();
  if (rows) {
    const byName = {};
    for (const r of rows) {
      const key = r.listingName || "";
      if (!byName[key]) byName[key] = new Set();
      byName[key].add(r.reservationUnitListingUnitId ?? "null");
    }
    for (const [name, ids] of Object.entries(byName)) {
      if (ids.size > 1) suspects.add(name);
    }
  }

  return (
    <>
      <Head><title>Diagnostic multi-unit</title></Head>
      <div style={{ padding: 24, fontFamily: "-apple-system, sans-serif", background: "#f0f2f5", minHeight: "100vh" }}>
        <h2 style={{ margin: "0 0 10px" }}>Diagnostic multi-unit</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          <button onClick={load} style={{ padding: "6px 14px" }}>Charger</button>
          <span>{status}</span>
        </div>
        <p style={{ color: "#666", fontSize: 13, marginBottom: 14 }}>
          Les lignes surlignées en jaune = un même nom de logement apparaît avec plusieurs
          <code> listingUnitId</code> différents → probablement un multi-unit non mappé.
          Envoie une capture de ce tableau.
        </p>
        {rows && (
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #333" }}>
                <th style={{ padding: 6 }}>Client</th>
                <th style={{ padding: 6 }}>Départ</th>
                <th style={{ padding: 6 }}>Nom listing</th>
                <th style={{ padding: 6 }}>listingMapId</th>
                <th style={{ padding: 6 }}>reservationUnit.listingUnitId</th>
                <th style={{ padding: 6 }}>Résolu → Résidence</th>
                <th style={{ padding: 6 }}>Résolu → N°</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #eee", background: suspects.has(r.listingName) ? "#fff6d5" : "transparent" }}>
                  <td style={{ padding: 6 }}>{r.guest}</td>
                  <td style={{ padding: 6 }}>{r.depart}</td>
                  <td style={{ padding: 6 }}>{r.listingName}</td>
                  <td style={{ padding: 6 }}>{r.listingMapId}</td>
                  <td style={{ padding: 6, fontWeight: 700 }}>{r.reservationUnitListingUnitId ?? "—"}</td>
                  <td style={{ padding: 6 }}>{r.resoluResidence ?? "?"}</td>
                  <td style={{ padding: 6 }}>{r.resoluNumero ?? "?"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function DebugPage() {
  return <Debug />;
}
