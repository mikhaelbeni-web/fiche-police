// pages/linge.js
// Linge à commander — Résidence Le Belleville uniquement.
// Ligne 1 : nombre de personnes attendues. Ligne 2 : numéro d'appartement.
// Lignes suivantes : types de linge, cases vides à remplir par le personnel.

import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { listApartments } from "../lib/apartments";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

// Même mot de passe que pour les suppressions sensibles de Gestion des espèces
// (solde de départ / lignes taxe de séjour). Frein volontaire côté navigateur,
// pas une vraie sécurité. Changeable via NEXT_PUBLIC_DELETE_PASSWORD sur Vercel.
const DELETE_PASSWORD = process.env.NEXT_PUBLIC_DELETE_PASSWORD || "2305";
function checkDeletePassword() {
  const entered = prompt("Mot de passe requis pour cette suppression :");
  if (entered === null) return false;
  if (entered !== DELETE_PASSWORD) { alert("Mot de passe incorrect."); return false; }
  return true;
}

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
function euros(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function Linge() {
  const [day, setDay] = useState(isoDay(new Date()));
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [creds, setCreds] = useState({ account: "", key: "" });

  // Ménages supplémentaires (Firebase)
  const [fs, setFs] = useState(null);
  const [fbConfigured, setFbConfigured] = useState(true);
  const [extraMenages, setExtraMenages] = useState([]);
  const [extraStatus, setExtraStatus] = useState("");
  const [extraApt, setExtraApt] = useState("");
  const [extraDate, setExtraDate] = useState(isoDay(new Date()));
  const [extraMotif, setExtraMotif] = useState("");
  const apartments = listApartments();

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setFbConfigured(false); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadExtras(api);
    })();
  }, []);

  async function loadExtras(api) {
    const snap = await api.getDocs(api.query(api.collection(api.db, "extra_menages"), api.orderBy("date", "desc")));
    setExtraMenages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  async function addExtraMenage() {
    if (!extraApt) { setExtraStatus("Choisis un appartement."); return; }
    if (!extraMotif.trim()) { setExtraStatus("Le motif est obligatoire."); return; }
    const info = apartments.find(a => a.id === extraApt);
    try {
      setExtraStatus("Enregistrement…");
      await fs.addDoc(fs.collection(fs.db, "extra_menages"), {
        listingId: extraApt, residence: info.residence, appartement: info.appartement,
        unitNumber: info.unitNumber, menageHT: info.menageHT, amenitiesHT: info.amenitiesHT,
        date: extraDate, motif: extraMotif.trim(), createdAt: new Date().toISOString(),
      });
      setExtraMotif("");
      await loadExtras(fs);
      setExtraStatus("Ménage supplémentaire ajouté.");
    } catch (err) { setExtraStatus("Erreur : " + err.message); }
  }

  async function delExtraMenage(id) {
    if (!checkDeletePassword()) return;
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce ménage supplémentaire ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "extra_menages", id));
    await loadExtras(fs);
  }

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

  // Ménages supplémentaires Belleville du jour affiché : ajoutés comme colonnes
  // supplémentaires sur la feuille de linge, pour que le personnel sache qu'il
  // faut aussi passer dans cet appartement (même sans check-out réel ce jour-là).
  const extraToday = extraMenages.filter(e => e.residence === "Belleville" && e.date === day);
  const sheetItems = [
    ...items,
    ...extraToday.map(e => ({
      unitNumber: e.unitNumber, appartement: e.appartement, attendu: null,
      extra: true, motif: e.motif,
    })),
  ];

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
        <button className="primary" onClick={() => window.print()} disabled={!sheetItems.length}>Imprimer</button>
        <span className="status">{status}</span>
      </div>

      <div className="linge-page">
        {fbConfigured && (
          <div className="linen-form" style={{ marginBottom: 18 }}>
            <div className="recap-title" style={{ fontSize: 15, marginBottom: 10 }}>Ajouter un ménage supplémentaire</div>
            <div className="linen-form-row">
              <label>Appartement
                <select value={extraApt} onChange={e => setExtraApt(e.target.value)} style={{ minWidth: 220 }}>
                  <option value="">— Choisir —</option>
                  {["Belleville", "Lantiez", "Villiers"].map(res => (
                    <optgroup key={res} label={res}>
                      {apartments.filter(a => a.residence === res).map(a => (
                        <option key={a.id} value={a.id}>{a.appartement} ({euros(a.menageHT + (a.amenitiesHT || 0))} = ménage {euros(a.menageHT)} + amenities {euros(a.amenitiesHT || 0)})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>Date <input type="date" value={extraDate} onChange={e => setExtraDate(e.target.value)} /></label>
              <label style={{ flex: 1 }}>Motif (obligatoire)
                <input type="text" value={extraMotif} onChange={e => setExtraMotif(e.target.value)}
                  placeholder="ex. technicien est intervenu et a fait du désordre" style={{ width: "100%" }} />
              </label>
            </div>
            <button className="primary" onClick={addExtraMenage}>Ajouter</button>
            {extraStatus && <span style={{ marginLeft: 10, fontSize: 12, color: "#666" }}>{extraStatus}</span>}

            {extraMenages.length > 0 && (
              <table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>Date</th><th>Résidence</th><th>Appartement</th><th>Motif</th><th className="c">Coût</th><th></th></tr>
                </thead>
                <tbody>
                  {extraMenages.map(e => (
                    <tr key={e.id}>
                      <td>{fmtFr(e.date)}</td>
                      <td>{e.residence}</td>
                      <td>{e.appartement}</td>
                      <td>{e.motif}</td>
                      <td className="c">{euros((e.menageHT || 0) + (e.amenitiesHT || 0))}</td>
                      <td><button onClick={() => delExtraMenage(e.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {sheetItems.length === 0 && !loading && (
          <div className="empty-state">Aucun appartement Belleville à faire ce jour.</div>
        )}

        {sheetItems.length > 0 && (
          <div className="linge-sheet">
            <div className="linge-title">LINGE SALE — Résidence Le Belleville</div>
            <div className="linge-date">Date : <strong>{fmtFr(day)}</strong></div>

            <table className="linge-tbl">
              <thead>
                <tr>
                  <th className="rowlabel">Nombre de personnes</th>
                  {sheetItems.map((it, i) => {
                    // Lits doubles : arrondir au pair supérieur pour le linge.
                    // 1 -> 2, 3 -> 4, 2 -> 2, 4 -> 4, 5 -> 6...
                    const n = it.attendu;
                    const affiche = (n != null && n > 0) ? (n % 2 === 0 ? n : n + 1) : null;
                    return (
                      <th key={i} className="pax">
                        {it.extra ? <span style={{ color: "#b8860b" }}>SUPPL.</span> : (affiche != null ? `${affiche}P` : "—")}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  <th className="rowlabel">N° Appartement</th>
                  {sheetItems.map((it, i) => (
                    <th key={i} className="aptnum" title={it.extra ? it.motif : undefined}>{it.unitNumber}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LINEN_ROWS.map(row => (
                  <tr key={row}>
                    <td className="rowlabel">{row}</td>
                    {sheetItems.map((_, i) => <td key={i} className="blank" />)}
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
  return <Linge />;
}
