// pages/debug.js
// Page de diagnostic temporaire. Affiche le JSON brut d'une réservation Cosy/Confort/Chic
// pour identifier le champ exact du numéro de sous-unité chez Hostaway.
import { useState, useEffect } from "react";
import Head from "next/head";
import Gate from "../components/Gate";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

function isoDay(d) { return d.toISOString().slice(0, 10); }

function Debug() {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 14 * 864e5)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [data, setData] = useState(null);
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
      setData(j);
      setStatus(`${j.count} réservation(s) trouvée(s)`);
    } catch (err) {
      setStatus("Erreur : " + err.message);
      setData(null);
    }
  }

  return (
    <>
      <Head><title>Diagnostic multi-unit</title></Head>
      <div style={{ padding: 24, fontFamily: "monospace", background: "#1a1a1a", minHeight: "100vh", color: "#0f0" }}>
        <div style={{ fontFamily: "-apple-system, sans-serif", color: "#fff", marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 10px" }}>Diagnostic multi-unit (Cosy/Confort/Chic)</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
            <button onClick={load} style={{ padding: "6px 14px" }}>Charger</button>
            <span>{status}</span>
          </div>
          <p style={{ color: "#aaa", fontSize: 13 }}>
            Cette page affiche le contenu brut renvoyé par Hostaway. Fais une capture d&apos;écran
            (ou copie le texte) et envoie-la — ça permettra de voir exactement quel champ contient
            le numéro de sous-unité.
          </p>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
          {data ? JSON.stringify(data, null, 2) : "(aucune donnée chargée)"}
        </pre>
      </div>
    </>
  );
}

export default function DebugPage() {
  return (
    <Gate>
      <Debug />
    </Gate>
  );
}
