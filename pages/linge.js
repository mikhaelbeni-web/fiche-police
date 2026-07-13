// pages/linge.js
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import Link from "next/link";
import Gate from "../components/Gate";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

const LINEN_ROWS = [
  "Grande serviette",
  "Housse",
  "Petite serviette",
  "Tapis de bain",
  "Torchon à carreaux",
  "Taie d'oreiller",
  "Drap",
];

function isoDay(d) { return d.toISOString().slice(0, 10); }
function fmtFr(d) {
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function Linge() {
  const [day, setDay] = useState(isoDay(new Date()));
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

  const load = useCallback(async (d, acc, key) => {
    if (!acc || !key) { setStatus("Identifiants Hostaway manquants — configure-les sur la page Fiches."); return; }
    setLoading(true);
    setStatus("Chargement…");
    try {
      const res = await fetch(`/api/linen?day=${d}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Erreur");
      setData(j);
      const n = j.groups.reduce((s, g) => s + g.items.length, 0);
      setStatus(n ? `${n} appartement(s) à faire` : "Aucun appartement à faire");
    } catch (err) {
      setStatus("Erreur : " + err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (creds.account && creds.key) load(day, creds.account, creds.key);
  }, [day, creds, load]);

  function shiftDay(n) {
    const d = new Date(day + "T12:00:00");
    d.setDate(d.getDate() + n);
    setDay(isoDay(d));
  }

  const allItems = (data?.groups || []).flatMap(g => g.items.map(it => ({ ...it, residence: g.residence })));

  return (
    <>
      <Head><title>Linge à commander — {fmtFr(day)}</title></Head>

      <div className="toolbar">
        <h1>Linge à commander</h1>
        <div className="daynav">
          <button className="arrow" onClick={() => shiftDay(-1)}>‹</button>
          <div className="daylabel">{fmtFr(day)}</div>
          <button className="arrow" onClick={() => shiftDay(1)}>›</button>
        </div>
        <button onClick={() => setDay(isoDay(new Date()))}>Aujourd&apos;hui</button>
        <button onClick={() => load(day, creds.account, creds.key)} disabled={loading} title="Actualiser">↻</button>
        <button className="primary" onClick={() => window.print()} disabled={!allItems.length}>Imprimer</button>
        <span className="status">{status}</span>
        <Link href="/menage" className="navlink">Ménages →</Link>
        <Link href="/" className="navlink">Fiches →</Link>
      </div>

      <div className="linge-page">
        {allItems.length === 0 && !loading && (
          <div className="empty-state">Aucun appartement à faire ce jour.</div>
        )}

        {allItems.length > 0 && (
          <div className="linge-sheet">
            <div className="linge-title">LINGE SALE</div>
            <div className="linge-date">Date : <strong>{fmtFr(day)}</strong></div>

            <table className="linge-tbl">
              <thead>
                <tr>
                  <th className="rowlabel">PRÉNOM :</th>
                  {allItems.map((it, i) => (
                    <th key={i} className="pax">
                      {it.attendu != null ? `${it.attendu}P` : "—"}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="rowlabel">N° Appartement</th>
                  {allItems.map((it, i) => (
                    <th key={i} className="aptnum">{it.unitNumber || "—"}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LINEN_ROWS.map(row => (
                  <tr key={row}>
                    <td className="rowlabel">{row}</td>
                    {allItems.map((_, i) => <td key={i} className="blank" />)}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="linge-legend">
              {Array.from(new Set(allItems.map(it => it.residence))).map(r => (
                <span key={r} className="legend-tag">{r}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function LingePage() {
  return (
    <Gate>
      <Linge />
    </Gate>
  );
}
