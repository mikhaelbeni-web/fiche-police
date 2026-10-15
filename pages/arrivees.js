// pages/arrivees.js
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

// Synthèse écrite chaque matin par une routine Claude (lecture seule de
// Hostaway + Gmail). Un document par réservation, doc ID = id Hostaway.
// Champs : date (AAAA-MM-JJ d'arrivée), client, heure (heure d'arrivée),
// resume (conversations Hostaway + Gmail, 1-2 lignes, seulement ce qui existe),
// ota et taxe (facultatifs : corrigent ce que Hostaway indique, ex. agence,
// taxe payée à la réception), alerte (reste quelque chose à faire), majLe (ISO).
// Villiers et Lantiez seulement : codesEnvoyes (booléen), codesEnvoyesLe
// (ex. « 14/10 13h »), codesConfirmes (booléen : le client a dit les avoir reçus).
const NOTES_COLLECTION = "notes_arrivees";

function isoDay(d) { return d.toISOString().slice(0, 10); }
function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}

function euros(n) {
  return n ? Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "";
}

// Ligne affichée : les valeurs de la note du matin priment sur celles de Hostaway.
function ligne(it, note) {
  const n = note || {};
  const taxe = n.taxe
    ? { libelle: n.taxe, statut: /(à|a) r[ée]gler|impay/i.test(n.taxe) ? "a_regler" : /r[ée]gl|pay/i.test(n.taxe) ? "reglee" : "inconnue" }
    : (it.taxe || { libelle: "", statut: "inconnue" });
  return {
    ota: n.ota || it.ota || "",
    heure: n.heure || "",
    resume: n.resume || n.note || "",
    alerte: !!n.alerte,
    majLe: n.majLe || "",
    taxe,
    depot: it.depot || null,
    codesEnvoyes: n.codesEnvoyes,
    codesEnvoyesLe: n.codesEnvoyesLe || "",
    codesConfirmes: n.codesConfirmes,
  };
}

// Texte des colonnes Dépôt et Codes (aussi utilisé pour le CSV).
function depotTexte(l) {
  return l.depot ? [l.depot.libelle, l.depot.detail].filter(Boolean).join(" · ") : "";
}
function codesTexte(l) {
  if (l.codesEnvoyes === undefined) return "";
  if (!l.codesEnvoyes) return "Non envoyés";
  return ["Envoyés" + (l.codesEnvoyesLe ? " " + l.codesEnvoyesLe : ""),
    l.codesConfirmes ? "Réception confirmée" : "Pas de confirmation"].join(" · ");
}

// « 15/10 à 08h56 » (heure de Paris) : date et heure de la dernière mise à jour des notes.
function fmtDateHeure(iso) {
  const x = new Date(iso);
  if (isNaN(x)) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(x).map(o => [o.type, o.value]));
  return `${p.day}/${p.month} à ${p.hour}h${p.minute}`;
}

function fmtHeure(iso) {
  const x = new Date(iso);
  return isNaN(x) ? "" : x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", "h");
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
  const [notes, setNotes] = useState({});

  useEffect(() => {
    const a = window.localStorage.getItem(ACCOUNT_KEY) || "";
    const k = window.localStorage.getItem(KEY_KEY) || "";
    setCreds({ account: a, key: k });
  }, []);

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

  const loadNotes = useCallback(async (f, t) => {
    try {
      const { isFirebaseConfigured, db } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) return;
      const { collection, getDocs, query, where } = await import("firebase/firestore");
      const snap = await getDocs(query(collection(db, NOTES_COLLECTION), where("date", ">=", f), where("date", "<=", t)));
      const byId = {};
      snap.forEach(d => { byId[d.id] = d.data(); });
      setNotes(byId);
    } catch {
      setNotes({});
    }
  }, []);

  useEffect(() => { loadNotes(from, to); }, [from, to, loadNotes]);

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
  // Dernière écriture de la routine parmi les arrivées affichées (toutes résidences).
  const derniereMaj = groups.flatMap(g => g.items)
    .map(it => (notes[it.reservationId] || {}).majLe || "")
    .reduce((a, b) => (b > a ? b : a), "");

  function downloadCSV() {
    const rows = [["Résidence", "N°", "Appartement", "Date d'arrivée", "Client", "OTA", "Heure", "Résumé", "Taxe de séjour", "Dépôt de garantie", "Codes", "Réservation"]];
    for (const g of groups) {
      for (const it of g.items) {
        const l = ligne(it, notes[it.reservationId]);
        const depotMode = g.mode === "depot";
        rows.push([g.residence, it.unitNumber, it.appartement, fmtFr(it.arrivee), it.client, l.ota, l.heure, l.resume,
          depotMode ? "Réglée par l'OTA" : [l.taxe.libelle, euros(l.taxe.montant)].filter(Boolean).join(" "),
          depotMode ? depotTexte(l) : "", depotMode ? codesTexte(l) : "", it.reservation]);
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
      <Head>
        <title>Arrivées — Résidences</title>
        {/* Feuille imprimée en paysage, quelle que soit la résidence. */}
        <style>{"@page { size: A4 landscape; margin: 6mm; }"}</style>
      </Head>

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

        <button onClick={() => { load(from, to, creds.account, creds.key); loadNotes(from, to); }} disabled={loading} title="Actualiser">↻</button>
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
              {derniereMaj && <div className="maj">Infos mises à jour le {fmtDateHeure(derniereMaj)}</div>}
            </div>
          </div>

          {groups.map(g => (
            <div className={"resid arr-resid" + (g.mode === "depot" ? " mode-depot" : "")} key={g.residence}>
              <div className="resid-head">
                <span className="resid-name">{g.residence}</span>
                <span className="resid-count">{g.count} arrivée{g.count > 1 ? "s" : ""}</span>
              </div>
              <div className="tbl-wrap"><table className="tbl arr-tbl">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Client</th>
                    <th>OTA</th>
                    <th>Arrivée</th>
                    <th className="arr-resume">Résumé des échanges</th>
                    {g.mode === "depot" ? <>
                      <th>Dépôt de garantie</th>
                      <th>Codes</th>
                    </> : <th>Taxe de séjour</th>}
                    <th className="c">Fait</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, i) => {
                    const l = ligne(it, notes[it.reservationId]);
                    return (
                      <tr key={i} className={i % 2 ? "alt" : ""}>
                        <td className="apt">
                          <div className="arr-num">{it.unitNumber || "—"}</div>
                          <div className="arr-sub">{it.appartement}</div>
                        </td>
                        <td>
                          <div className="arr-client">{it.client}</div>
                          {it.voyageurs !== "" && <div className="arr-sub">{it.voyageurs} pers.{from !== to ? " · " + fmtFr(it.arrivee) : ""}</div>}
                        </td>
                        <td className="arr-ota">{l.ota}</td>
                        <td className="arr-heure">{l.heure}</td>
                        <td className={"arr-resume" + (l.alerte ? " alerte" : "")}>
                          {l.resume}
                          {l.majLe && <span className="auto-note-maj"> · {fmtHeure(l.majLe)}</span>}
                        </td>
                        {g.mode === "depot" ? <>
                          <td className={"arr-taxe " + (l.depot ? l.depot.statut : "")}>
                            {l.depot && <>
                              {l.depot.libelle}
                              {l.depot.detail && <div className="arr-sub">{l.depot.detail}</div>}
                            </>}
                          </td>
                          <td className="arr-codes">
                            {l.codesEnvoyes === undefined ? null : !l.codesEnvoyes
                              ? <span className="a_regler">Non envoyés</span>
                              : <>
                                <div>Envoyés{l.codesEnvoyesLe && <span className="arr-sub"> {l.codesEnvoyesLe}</span>}</div>
                                <div className={l.codesConfirmes ? "reglee" : "a_regler"}>
                                  {l.codesConfirmes ? "Réception confirmée" : "Pas de confirmation"}
                                </div>
                              </>}
                          </td>
                        </> : (
                          <td className={"arr-taxe " + l.taxe.statut}>
                            {l.taxe.libelle}
                            {l.taxe.montant ? <div className="arr-sub">{euros(l.taxe.montant)}</div> : null}
                          </td>
                        )}
                        <td className="c"><span className="box" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
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
