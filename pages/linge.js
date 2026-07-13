// pages/linge.js
// Linge à commander — Résidence Le Belleville uniquement.
// Ligne 1 : nombre de personnes attendues. Ligne 2 : numéro d'appartement.
// Lignes suivantes : types de linge, cases vides à remplir par le personnel.

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
  const [items, setItems] = useState([]);
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
      setItems(j.items || []);
      const n = j.items?.length || 0;
      const u = j.unresolved?.length || 0;
      setStatus(
        (n ? `${n} appartement(s) à faire` : "Aucun appartement à faire") +
        (u ? ` · ⚠ ${u} départ(s) non identifié(s), vérifie manuellement` : "")
      );
    } catch (err) {
      setStatus("Erreur : " + err.message);
      setItems([]);
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
        <button className="primary" onClick={() => window.print()} disabled={!items.length}>Imprimer</button>
        <span className="status">{status}</span>
        <Link href="/menage" className="navlink">Ménages →</Link>
        <Link href="/couts" className="navlink">Coûts ménage →</Link>
        <Link href="/" className="navlink">Fiches →</Link>
      </div>

      <div className="linge-page">
        {items.length === 0 && !loading && (
          <div className="empty-state">Aucun appartement Belleville à faire ce jour.</div>
        )}

        {items.length > 0 && (
          <div className="linge-sheet">
            <div className="linge-title">LINGE SALE — Résidence Le Belleville</div>
            <div className="linge-date">Date : <strong>{fmtFr(day)}</strong></div>

            <table className="linge-tbl">
              <thead>
                <tr>
                  <th className="rowlabel">Nombre de personnes</th>
                  {items.map((it, i) => (
                    <th key={i} className="pax">
                      {it.attendu != null ? `${it.attendu}P` : "—"}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="rowlabel">N° Appartement</th>
                  {items.map((it, i) => (
                    <th key={i} className="aptnum">{it.unitNumber}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LINEN_ROWS.map(row => (
                  <tr key={row}>
                    <td className="rowlabel">{row}</td>
                    {items.map((_, i) => <td key={i} className="blank" />)}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="linge-footer">
              <div className="linge-signature">Prénom (personnel de ménage) : ____________________</div>
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
