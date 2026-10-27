// components/FactureMenage.js
// Contrôle mensuel de la facture du prestataire de ménage (onglet Coûts ménage).
// L'annexe XLSX est lue dans le navigateur, comparée aux ménages réels du logiciel
// (départs Hostaway + ménages supplémentaires, comme le reste de la page) puis
// sauvegardée dans Firestore (`factures_menage`, un doc par résidence et par mois).
// Lecture seule côté Hostaway. Aucun mail n'est envoyé : le brouillon est copié ou
// ouvert dans la messagerie, et ne contient que les surfacturations.

import { useState, useEffect } from "react";
import { parseAnnexeRows, buildExpected, controlerFacture, buildReclamation, TYPES, moisLabel } from "../lib/factureMenage";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";
const RESIDENCES = ["Belleville", "Villiers", "Lantiez"];

const eur = n => n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmtFr = d => d ? d.split("-").reverse().join("/") : "";
const ecartKey = e => `${e.type}|${e.unit}|${e.date}|${e.ligne}`;
const docId = (residence, mois) => `${residence}_${mois}`;

function defaultMois() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function lastDay(mois) {
  const [y, m] = mois.split("-").map(Number);
  return `${mois}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

async function readXlsx(file) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Fichier XLSX vide.");
  const rows = [];
  ws.eachRow({ includeEmpty: false }, row => {
    const r = [];
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      let v = cell.value;
      if (v && typeof v === "object" && !(v instanceof Date) && "result" in v) v = v.result;
      r[i - 1] = v;
    });
    rows.push(r);
  });
  return rows;
}

export default function FactureMenage() {
  const [open, setOpen] = useState(false);
  const [residence, setResidence] = useState("Belleville");
  const [mois, setMois] = useState(defaultMois());
  const [numero, setNumero] = useState("");
  const [factureHT, setFactureHT] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null); // { residence, mois, numero, factureHT, lines, ecarts, totaux }
  const [ignored, setIgnored] = useState([]);
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);

  async function loadHistory() {
    try {
      const { isFirebaseConfigured, db } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) return;
      const { collection, getDocs } = await import("firebase/firestore");
      const snap = await getDocs(collection(db, "factures_menage"));
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.mois.localeCompare(a.mois) || a.residence.localeCompare(b.residence)));
    } catch (e) { /* historique facultatif */ }
  }
  useEffect(() => { if (open) loadHistory(); }, [open]);

  async function controler() {
    if (!file) { setStatus("Choisis d'abord l'annexe (fichier XLSX)."); return; }
    const account = window.localStorage.getItem(ACCOUNT_KEY) || "";
    const key = window.localStorage.getItem(KEY_KEY) || "";
    if (!account || !key) { setStatus("Identifiants Hostaway manquants — configure-les sur la page Fiches."); return; }
    setBusy(true);
    setResult(null);
    try {
      setStatus("Lecture de l'annexe…");
      const lines = parseAnnexeRows(await readXlsx(file));
      if (!lines.length) throw new Error("Aucune ligne trouvée dans l'annexe.");

      setStatus("Chargement des ménages du mois…");
      const from = `${mois}-01`, to = lastDay(mois);
      const res = await fetch(`/api/departures?from=${from}&to=${to}`, { headers: { "x-hostaway-account": account, "x-hostaway-key": key } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Erreur Hostaway");

      const { isFirebaseConfigured, db } = await import("../lib/firebase");
      let extras = [], hidden = [];
      if (isFirebaseConfigured()) {
        const { collection, getDocs, query, orderBy } = await import("firebase/firestore");
        extras = (await getDocs(query(collection(db, "extra_menages"), orderBy("date", "desc")))).docs.map(d => ({ id: d.id, ...d.data() }));
        hidden = (await getDocs(query(collection(db, "menages_masques"), orderBy("date", "desc")))).docs.map(d => ({ id: d.id, ...d.data() }));
      }
      const expected = buildExpected({ residence, from, to, groups: j.groups, extras, hidden });
      const ht = factureHT === "" ? null : parseFloat(String(factureHT).replace(",", "."));
      const out = controlerFacture({ lines, expected, facture: { ht }, mois });
      const full = { residence, mois, numero: numero.trim(), factureHT: ht, lines, ecarts: out.ecarts, totaux: out.totaux, surfactureHT: out.surfactureHT, annexeNom: file.name };
      setResult(full);
      setIgnored([]);
      setStatus("");
      await sauvegarder(full, []);
    } catch (e) {
      setStatus("Erreur : " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sauvegarder(full, ign) {
    try {
      const { isFirebaseConfigured, db } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) return;
      const { doc, setDoc } = await import("firebase/firestore");
      await setDoc(doc(db, "factures_menage", docId(full.residence, full.mois)), { ...full, ignores: ign, importeLe: new Date().toISOString() });
      loadHistory();
    } catch (e) {
      setStatus("Contrôle fait, mais sauvegarde impossible : " + e.message);
    }
  }

  function toggle(e) {
    const k = ecartKey(e);
    const next = ignored.includes(k) ? ignored.filter(x => x !== k) : [...ignored, k];
    setIgnored(next);
    sauvegarder(result, next);
  }

  function reopen(h) {
    setResidence(h.residence); setMois(h.mois); setNumero(h.numero || "");
    setFactureHT(h.factureHT ?? "");
    setResult(h); setIgnored(h.ignores || []); setStatus("");
  }

  // Résultat effectif : les écarts décochés par l'utilisateur ne sont plus réclamés.
  const effective = result && (() => {
    const ecarts = result.ecarts.map(e => ({ ...e, reclamable: e.reclamable && !ignored.includes(ecartKey(e)) }));
    const surfactureHT = Math.round(ecarts.filter(e => e.reclamable).reduce((s, e) => s + e.montantHT, 0) * 100) / 100;
    return { ...result, ecarts, surfactureHT };
  })();
  const mail = effective && buildReclamation({ residence: result.residence, mois: result.mois, numero: result.numero, resultat: effective });

  async function copyMail() {
    try { await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { /* ignoré */ }
  }

  const communes = result ? result.lines.filter(l => l.commune) : [];
  const info = effective ? effective.ecarts.filter(e => !TYPES[e.type].reclamable) : [];
  const reclam = effective ? effective.ecarts.filter(e => TYPES[e.type].reclamable) : [];

  return (
    <div className="recap facture-menage" style={{ marginBottom: 20 }}>
      <style>{`@media print { @page { size: landscape; margin: 10mm; } .facture-menage .no-print { display: none !important; } .facture-menage tr { page-break-inside: avoid; } .facture-menage td { padding-top: 10px !important; padding-bottom: 10px !important; } }`}</style>
      <div className="recap-head no-print" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <div>
          <div className="recap-title">{open ? "▾" : "▸"} Contrôle de la facture du prestataire</div>
          <div className="recap-sub">Importer l&apos;annexe du mois : les ménages facturés en trop ressortent automatiquement.</div>
        </div>
      </div>

      {open && (
        <div>
          <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", margin: "8px 0 14px" }}>
            <div className="field"><label>Résidence</label>
              <select value={residence} onChange={e => setResidence(e.target.value)}>{RESIDENCES.map(r => <option key={r}>{r}</option>)}</select>
            </div>
            <div className="field"><label>Mois</label><input type="month" value={mois} onChange={e => setMois(e.target.value)} /></div>
            <div className="field"><label>N° facture</label><input value={numero} onChange={e => setNumero(e.target.value)} style={{ width: 90 }} /></div>
            <div className="field"><label>Total facture HT (€)</label><input inputMode="decimal" value={factureHT} onChange={e => setFactureHT(e.target.value)} style={{ width: 110 }} placeholder="ex. 4465" /></div>
            <div className="field"><label>Annexe (XLSX)</label><input type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] || null)} /></div>
            <button className="primary" onClick={controler} disabled={busy} style={{ padding: "8px 14px" }}>{busy ? "Contrôle…" : "Contrôler la facture"}</button>
          </div>
          {status && <div className="recap-sub" style={{ marginBottom: 10 }}>{status}</div>}

          {history.length > 0 && (
            <div className="recap-sub no-print" style={{ marginBottom: 12 }}>
              Contrôles enregistrés :{" "}
              {history.map(h => (
                <button key={h.id} onClick={() => reopen(h)} style={{ marginRight: 6, fontSize: 12, cursor: "pointer" }}>
                  {h.residence} · {moisLabel(h.mois)} {h.surfactureHT > 0 ? `· ${eur(h.surfactureHT)} en trop` : "· OK"}
                </button>
              ))}
            </div>
          )}

          {effective && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 18, margin: "10px 0 16px", fontSize: 14 }}>
                <span>Facture : <b>{eur(result.factureHT)}</b> HT</span>
                <span>Annexe : <b>{eur(result.totaux.annexeHT)}</b> HT ({result.totaux.nbMenages} ménages{result.totaux.nbCommunes ? ` + ${result.totaux.nbCommunes} partie(s) commune(s)` : ""})</span>
                <span>Ménages attendus dans le logiciel : <b>{result.totaux.nbAttendus}</b></span>
                <span style={{ color: effective.surfactureHT > 0 ? "#c0392b" : "#27ae60", fontWeight: 700 }}>
                  {effective.surfactureHT > 0 ? `Facturé en trop : ${eur(effective.surfactureHT)} HT (${eur(effective.surfactureHT * 1.2)} TTC)` : "Aucune surfacturation détectée"}
                </span>
                <button className="no-print" onClick={() => window.print()} style={{ cursor: "pointer" }}>Imprimer (paysage)</button>
              </div>

              {reclam.length > 0 && (
                <div className="resid">
                  <div className="resid-head"><span className="resid-name">Facturé en trop</span><span className="resid-count">{reclam.filter(e => e.reclamable).length} ligne(s) réclamée(s)</span></div>
                  <div className="tbl-wrap"><table className="tbl">
                    <thead><tr><th className="no-print">Réclamer</th><th>Type</th><th>N°</th><th>Date</th><th className="c">Montant HT</th><th>Détail</th></tr></thead>
                    <tbody>{reclam.map(e => (
                      <tr key={ecartKey(e)} style={e.reclamable ? undefined : { opacity: .45 }}>
                        <td className="no-print"><input type="checkbox" checked={e.reclamable} onChange={() => toggle(e)} /></td>
                        <td>{TYPES[e.type].label}</td><td className="apt">{e.unit || "—"}</td><td>{fmtFr(e.date)}</td>
                        <td className="c">{eur(e.montantHT)}</td><td>{e.detail}</td>
                      </tr>))}</tbody>
                  </table></div>
                  <div className="recap-sub no-print">Décoche une ligne si le ménage a bien eu lieu (ex. ménage fait sans départ) : elle sort de la réclamation.</div>
                </div>
              )}

              {communes.length > 0 && (
                <div className="resid">
                  <div className="resid-head"><span className="resid-name">Parties communes</span><span className="resid-count">{eur(result.totaux.communesHT)} HT · incluses dans le total contrôlé</span></div>
                  <div className="tbl-wrap"><table className="tbl">
                    <thead><tr><th>Date</th><th>Description</th><th className="c">HT</th><th className="c">TVA</th><th className="c">TTC</th></tr></thead>
                    <tbody>{communes.map(l => (
                      <tr key={l.ligne}><td>{fmtFr(l.date)}</td><td>{l.desc}</td><td className="c">{eur(l.ht)}</td><td className="c">{eur(l.tva)}</td><td className="c">{eur(l.ttc)}</td></tr>))}</tbody>
                  </table></div>
                </div>
              )}

              {info.length > 0 && (
                <div className="resid">
                  <div className="resid-head"><span className="resid-name">À vérifier (pas une surfacturation)</span><span className="resid-count">{info.length}</span></div>
                  <div className="tbl-wrap"><table className="tbl">
                    <thead><tr><th>Type</th><th>N°</th><th>Date</th><th>Détail</th></tr></thead>
                    <tbody>{info.map(e => (
                      <tr key={ecartKey(e)}><td>{TYPES[e.type].label}</td><td className="apt">{e.unit || "—"}</td><td>{fmtFr(e.date)}</td><td>{e.detail}</td></tr>))}</tbody>
                  </table></div>
                </div>
              )}

              {mail && (
                <div className="resid no-print">
                  <div className="resid-head"><span className="resid-name">Mail de réclamation (surfacturations uniquement)</span></div>
                  <input readOnly value={mail.subject} style={{ width: "100%", marginTop: 8, padding: 6 }} />
                  <textarea readOnly value={mail.body} rows={Math.min(24, mail.body.split("\n").length + 1)} style={{ width: "100%", marginTop: 6, padding: 6, fontFamily: "inherit" }} />
                  <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                    <button className="primary" onClick={copyMail} style={{ padding: "6px 12px", cursor: "pointer" }}>{copied ? "Copié ✓" : "Copier le mail"}</button>
                    <a href={`mailto:?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`}><button style={{ padding: "6px 12px", cursor: "pointer" }}>Ouvrir dans la messagerie</button></a>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
