// components/FactureMenage.js
// Contrôle mensuel de la facture du prestataire de ménage (onglet Coûts ménage).
// L'annexe XLSX est lue dans le navigateur, comparée aux ménages réels du logiciel
// (départs Hostaway + ménages supplémentaires, comme le reste de la page) puis
// sauvegardée dans Firestore (`factures_menage`, un doc par résidence et par mois).
// Lecture seule côté Hostaway. Aucun mail n'est envoyé : le brouillon est copié ou
// ouvert dans la messagerie, et ne contient que les surfacturations.

import { useState, useEffect } from "react";
import { parseAnnexeRows, applyMapping, unitsResidence, buildExpected, controlerFacture, buildReclamation, bilanControle, attendusHorsMois, plageHorsMois, TYPES, moisLabel, nettoyerEcarts, normRemise, libelleRemise } from "../lib/factureMenage";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";
const RESIDENCES = ["Belleville", "Villiers", "Lantiez"];

const eur = n => n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmtFr = d => d ? d.split("-").reverse().join("/") : "";
const ecartKey = e => `${e.type}|${e.unit}|${e.date}|${e.ligne}`;
// Clé React d'une ligne : ecartKey peut se répéter (plusieurs ménages « manquants » même
// logement, même date, sans n° de ligne) ; des clés en double laissaient à l'écran des lignes
// d'un autre mois après changement de contrôle. L'index les rend uniques.
const rowKey = (e, i) => `${ecartKey(e)}|${i}`;
const docId = (residence, mois) => `${residence}_${mois}`;
const SUIVI = { controle: "Contrôlé", reclame: "Réclamation envoyée", avoir: "Avoir reçu" };
const suiviDe = h => (SUIVI[h.suivi] ? h.suivi : "controle");

function moisDecale(mois, n) {
  const [y, m] = mois.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function scrollResultat() {
  setTimeout(() => { const el = document.getElementById("fm-resultat"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
}

// Montant net : jamais « −X € à réclamer ». Net ≤ 0 → « Rien à réclamer », et si le
// prestataire a oublié de facturer plus qu'il n'a facturé en trop, on le dit en petit.
function NetResume({ net, big }) {
  if (net > 0) {
    return (
      <div className={`fm-net rouge${big ? " big" : ""}`}>
        <span className="fm-net-l">À réclamer</span>
        <span className="fm-net-v">{eur(net)} HT</span>
        {big && <span className="fm-net-sub">soit {eur(net * 1.2)} TTC</span>}
      </div>
    );
  }
  return (
    <div className={`fm-net vert${big ? " big" : ""}`}>
      <span className="fm-net-v">Rien à réclamer</span>
      {net < 0 && <span className="fm-net-sub">Le prestataire a oublié de facturer {eur(-net)} HT net.</span>}
    </div>
  );
}

// Saisie de la remise accordée par le prestataire : valeur + unité (% ou € HT).
// Enregistrée en quittant le champ (ou Entrée) et à chaque changement d'unité.
function RemiseSaisie({ remise, onChange }) {
  const [valeur, setValeur] = useState(remise ? String(remise.valeur).replace(".", ",") : "");
  const [type, setType] = useState(remise?.type || "pct");
  useEffect(() => {
    setValeur(remise ? String(remise.valeur).replace(".", ",") : "");
    setType(remise?.type || "pct");
  }, [remise?.valeur, remise?.type]);
  const valider = (v = valeur, t = type) => onChange(normRemise({ type: t, valeur: v }));
  return (
    <div className="fm-remise no-print">
      <label htmlFor="fm-remise-v">Remise accordée sur la facture</label>
      <div className="fm-remise-champs">
        <input id="fm-remise-v" type="text" inputMode="decimal" placeholder="0" value={valeur}
          onChange={e => setValeur(e.target.value.replace(/[^0-9.,]/g, ""))}
          onBlur={() => valider()} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <select value={type} onChange={e => { setType(e.target.value); valider(valeur, e.target.value); }} aria-label="Unité de la remise">
          <option value="pct">%</option>
          <option value="eur">€ HT</option>
        </select>
        {remise && <button type="button" className="fm-btn fm-btn-light" onClick={() => { setValeur(""); onChange(null); }}>Retirer</button>}
      </div>
      <div className="fm-note">En %, la remise réduit d&apos;autant le trop-facturé à réclamer. En €, elle est déduite du montant à réclamer.</div>
    </div>
  );
}

// Mois précédent, en heure locale. L'ancien calcul (setMonth − 1 puis toISOString)
// tombait sur le mauvais mois le 29, 30 ou 31 (ex. 31 mars → « 3 mars » → mars).
function defaultMois() {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
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
  const [open, setOpen] = useState(true);
  const [residence, setResidence] = useState("Belleville");
  const [mois, setMois] = useState(defaultMois());
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null); // { residence, mois, lines, ecarts, totaux }
  const [ignored, setIgnored] = useState([]);
  const [history, setHistory] = useState([]);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState([]); // libellés de l'annexe non rapprochés
  const [choices, setChoices] = useState({});
  const [apercu, setApercu] = useState(null); // contrôle dont on affiche l'annexe

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

  async function controler(newChoices = {}, over = {}) {
    const resi = over.residence ?? residence;
    const fichier = over.file ?? file;
    if (!fichier) { setStatus("Choisis d'abord l'annexe (fichier XLSX)."); return; }
    const account = window.localStorage.getItem(ACCOUNT_KEY) || "";
    const key = window.localStorage.getItem(KEY_KEY) || "";
    if (!account || !key) { setStatus("Identifiants Hostaway manquants — configure-les sur la page Fiches."); return; }
    setBusy(true);
    setResult(null);
    try {
      if (over.residence) { setResidence(resi); setFile(fichier); }
      setStatus("Lecture de l'annexe…");
      const lines = parseAnnexeRows(await readXlsx(fichier));
      if (!lines.length) throw new Error("Aucune ligne trouvée dans l'annexe.");

      // Rapprochement des libellés de l'annexe aux appartements : automatique, puis
      // associations mémorisées (Firestore `mapping_logements_facture`), puis choix de l'utilisateur.
      const fb = await import("../lib/firebase");
      let saved = {};
      if (fb.isFirebaseConfigured()) {
        const { doc, getDoc, setDoc } = await import("firebase/firestore");
        const ref = doc(fb.db, "mapping_logements_facture", resi);
        saved = (await getDoc(ref)).data()?.map || {};
        if (Object.keys(newChoices).length) {
          saved = { ...saved, ...newChoices };
          await setDoc(ref, { map: saved, residence: resi });
        }
      } else saved = newChoices;
      const mapped = applyMapping(lines, resi, saved);
      if (mapped.unresolved.length) {
        setPending(mapped.unresolved);
        setChoices({});
        setStatus("");
        return;
      }
      setPending([]);

      setStatus("Chargement des ménages du mois…");
      const from = `${mois}-01`, to = lastDay(mois);
      const departs = async (a, b) => {
        const res = await fetch(`/api/departures?from=${a}&to=${b}`, { headers: { "x-hostaway-account": account, "x-hostaway-key": key } });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Erreur Hostaway");
        return j.groups;
      };
      const groups = await departs(from, to);
      // Lignes datées d'un autre mois (ménage facturé en retard) : départs de ces jours-là.
      const plage = plageHorsMois(mapped.lines, mois);
      const groupsHors = plage ? await departs(plage.from, plage.to) : [];

      const { isFirebaseConfigured, db } = await import("../lib/firebase");
      let extras = [], hidden = [];
      if (isFirebaseConfigured()) {
        const { collection, getDocs, query, orderBy } = await import("firebase/firestore");
        extras = (await getDocs(query(collection(db, "extra_menages"), orderBy("date", "desc")))).docs.map(d => ({ id: d.id, ...d.data() }));
        hidden = (await getDocs(query(collection(db, "menages_masques"), orderBy("date", "desc")))).docs.map(d => ({ id: d.id, ...d.data() }));
      }
      const expected = buildExpected({ residence: resi, from, to, groups, extras, hidden });
      if (plage) expected.push(...attendusHorsMois({ lines: mapped.lines, mois, expected: buildExpected({ residence: resi, ...plage, groups: groupsHors, extras, hidden }) }));
      // Annexes déjà contrôlées des autres mois : un ménage facturé en retard peut y figurer déjà.
      const autresMois = history.filter(h => h.residence === resi && h.mois !== mois).flatMap(h => (h.lines || []).map(l => ({ ...l, mois: h.mois })));
      const out = controlerFacture({ lines: mapped.lines, expected, mois, autresMois });
      const full = { residence: resi, mois, lines: mapped.lines, ecarts: out.ecarts, totaux: out.totaux, surfactureHT: out.netHT, brutHT: out.surfactureHT, compensationHT: out.sousFactureHT, annexeNom: fichier.name };
      // Une remise déjà saisie pour ce mois est conservée quand on réimporte l'annexe.
      const ancienne = history.find(h => h.id === docId(resi, mois))?.remise;
      if (normRemise(ancienne)) full.remise = ancienne;
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
      const t = bilanControle(full, ign);
      await setDoc(doc(db, "factures_menage", docId(full.residence, full.mois)), { ...full, surfactureHT: t.netHT, brutHT: t.brutHT, compensationHT: t.compensationHT, ignores: ign, importeLe: new Date().toISOString() }, { merge: true });
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

  async function majRemise(remise) {
    const next = { ...result, remise };
    setResult(next);
    const id = docId(result.residence, result.mois);
    setHistory(history.map(x => x.id === id ? { ...x, remise } : x));
    try {
      const { isFirebaseConfigured, db } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) return;
      const { doc, setDoc } = await import("firebase/firestore");
      const t = bilanControle(next, ignored);
      await setDoc(doc(db, "factures_menage", id), { remise, surfactureHT: t.netHT }, { merge: true });
    } catch (e) { setStatus("Remise non enregistrée : " + e.message); }
  }

  async function majSuivi(h, suivi) {
    setHistory(history.map(x => x.id === h.id ? { ...x, suivi } : x));
    try {
      const { db } = await import("../lib/firebase");
      const { doc, setDoc } = await import("firebase/firestore");
      await setDoc(doc(db, "factures_menage", h.id), { suivi }, { merge: true });
    } catch (e) { setStatus("Suivi non enregistré : " + e.message); }
  }

  async function supprimer(h) {
    if (!window.confirm(`Supprimer le contrôle ${h.residence} · ${moisLabel(h.mois)} ?`)) return;
    try {
      const { db } = await import("../lib/firebase");
      const { doc, deleteDoc } = await import("firebase/firestore");
      await deleteDoc(doc(db, "factures_menage", h.id));
      if (result && docId(result.residence, result.mois) === h.id) setResult(null);
      loadHistory();
    } catch (e) { setStatus("Suppression impossible : " + e.message); }
  }

  function reopen(h) {
    setResidence(h.residence); setMois(h.mois);
    setResult(h); setIgnored(h.ignores || []); setStatus("");
  }

  // Résultat effectif : les écarts décochés par l'utilisateur ne sont plus réclamés.
  const effective = result && bilanControle(result, ignored);
  const mail = effective && buildReclamation({ residence: result.residence, mois: result.mois, resultat: effective });

  async function copyMail() {
    try { await navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { /* ignoré */ }
  }

  function ouvrir(h) {
    if (!(result && docId(result.residence, result.mois) === h.id)) reopen(h);
    scrollResultat();
  }

  const communes = result ? result.lines.filter(l => l.commune) : [];
  const info = effective ? effective.ecarts.filter(e => !TYPES[e.type].reclamable && e.type !== "manquant") : [];
  const compens = effective ? effective.ecarts.filter(e => e.type === "manquant") : [];
  const reclam = effective ? effective.ecarts.filter(e => TYPES[e.type].reclamable) : [];
  const resultId = result ? docId(result.residence, result.mois) : null;
  const statusErreur = /Erreur|impossible|manquants|non enregistré|Choisis/.test(status);

  // Historique regroupé par mois (déjà trié du plus récent au plus ancien).
  const parMois = [];
  for (const h of history) {
    const g = parMois.find(x => x.mois === h.mois);
    if (g) g.items.push(h); else parMois.push({ mois: h.mois, items: [h] });
  }

  return (
    <div className="recap facture-menage" style={{ marginBottom: 20 }}>
      <style>{`@media print { @page { size: landscape; margin: 10mm; } .facture-menage .no-print { display: none !important; } .facture-menage tr { page-break-inside: avoid; } .facture-menage td { padding-top: 10px !important; padding-bottom: 10px !important; } }`}</style>
      <div className="recap-head no-print fm-toggle" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); } }}>
        <div>
          <div className="recap-title">{open ? "▾" : "▸"} Contrôle de la facture du prestataire</div>
          <div className="recap-sub">Choisis le mois, puis importe l&apos;annexe de chaque résidence : le contrôle se fait tout seul.</div>
        </div>
      </div>

      {open && (
        <div>
          <div className="fm-step no-print">
            <div className="fm-step-title"><span className="fm-num">1</span>Mois de la facture</div>
            <div className="fm-mois">
              <button type="button" className="fm-btn fm-arrow" onClick={() => setMois(moisDecale(mois, -1))} aria-label="Mois précédent">‹</button>
              <input type="month" value={mois} onChange={e => { if (e.target.value) setMois(e.target.value); }} aria-label="Mois de la facture" />
              <button type="button" className="fm-btn fm-arrow" onClick={() => setMois(moisDecale(mois, 1))} aria-label="Mois suivant">›</button>
            </div>
          </div>

          <div className="fm-step no-print">
            <div className="fm-step-title"><span className="fm-num">2</span>Annexe de chaque résidence · {moisLabel(mois)}</div>
            <div className="fm-cards">
              {RESIDENCES.map(r => {
                const h = history.find(x => x.id === docId(r, mois));
                const net = h ? bilanControle(h, h.ignores || []).netHT : null;
                const actif = h && h.id === resultId;
                return (
                  <div key={r} className={`fm-card${h ? "" : " vide"}${actif ? " actif" : ""}`}>
                    <div className="fm-card-head">
                      <span className="fm-card-name">{r}</span>
                      <span className={`fm-badge ${h ? suiviDe(h) : "vide"}`}>{h ? SUIVI[suiviDe(h)] : "À importer"}</span>
                    </div>
                    {h ? (
                      <>
                        <NetResume net={net} />
                        <div className="fm-card-sub">Annexe : {eur(h.totaux?.annexeHT)} HT{normRemise(h.remise) ? ` · remise ${libelleRemise(h.remise)}` : ""}</div>
                      </>
                    ) : (
                      <div className="fm-card-sub fm-card-vide">Annexe pas encore importée pour ce mois.</div>
                    )}
                    <div className="fm-card-actions">
                      {h && <button type="button" className="fm-btn" onClick={() => ouvrir(h)}>Voir le détail</button>}
                      {h?.lines?.length > 0 && <button type="button" className="fm-btn fm-btn-light" onClick={() => setApercu(h)}>Voir l&apos;annexe</button>}
                      <label className={`fm-btn${h ? " fm-btn-light" : " primary"}${busy ? " disabled" : ""}`}>
                        {h ? "Réimporter" : "Importer l'annexe"}
                        <input type="file" accept=".xlsx" className="fm-file" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) controler({}, { residence: r, file: f }); }} />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            {status && <div className={`fm-status${statusErreur ? " erreur" : ""}`} role="status">{busy && <span className="fm-spin" aria-hidden="true" />}{status}</div>}

            {pending.length > 0 && (
              <div className="fm-warn">
                <div className="fm-warn-title">{residence} : {pending.length} libellé(s) de l&apos;annexe à rattacher à un appartement</div>
                <div className="fm-warn-sub">Choisis l&apos;appartement pour chaque libellé. C&apos;est mémorisé pour les mois suivants.</div>
                {pending.map(label => (
                  <label key={label} className="fm-warn-row">
                    <span className="fm-warn-label">{label}</span>
                    <select value={choices[label] || ""} onChange={e => setChoices({ ...choices, [label]: e.target.value })}>
                      <option value="">— choisir l&apos;appartement —</option>
                      {unitsResidence(residence).map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </label>
                ))}
                <button type="button" className="fm-btn primary" disabled={busy || pending.some(l => !choices[l])} onClick={() => controler(choices)}>Enregistrer et contrôler</button>
              </div>
            )}
          </div>

          <div className="fm-step fm-resultat" id="fm-resultat">
            <div className="fm-step-title no-print"><span className="fm-num">3</span>Résultat du contrôle</div>
            {!effective ? (
              <div className="fm-hint no-print">Importe une annexe ou clique sur « Voir le détail » d&apos;une résidence : le résultat s&apos;affiche ici.</div>
            ) : (
              <>
                <div className="fm-res-head">
                  <div>
                    <div className="fm-res-title">{result.residence} · {moisLabel(result.mois)}</div>
                    <div className="recap-sub">Contrôle de la facture ménage{result.annexeNom ? ` · annexe ${result.annexeNom}` : ""}</div>
                  </div>
                  <div className="fm-actions no-print">
                    {result.lines?.length > 0 && <button type="button" className="fm-btn" onClick={() => setApercu(result)}>Voir l&apos;annexe</button>}
                    <button type="button" className="fm-btn" onClick={() => window.print()}>Imprimer (paysage)</button>
                  </div>
                </div>

                <div className="fm-res-grid">
                  <NetResume net={effective.netHT} big />
                  <div>
                    <table className="tbl fm-calc">
                      <tbody>
                        <tr><td>Facturé dans l&apos;annexe ({result.totaux.nbMenages} ménages{result.totaux.nbCommunes ? ` + ${result.totaux.nbCommunes} partie(s) commune(s)` : ""})</td><td className="r">{eur(effective.annexeHT)}</td></tr>
                        {effective.remise && <tr><td>Remise accordée sur la facture ({libelleRemise(effective.remise)}), soit {eur(effective.annexeHT - effective.remiseHT)} HT à payer</td><td className="r">− {eur(effective.remiseHT)}</td></tr>}
                        {effective.prevuHT != null && <tr><td>Prévu d&apos;après le logiciel ({result.totaux.nbAttendus} ménages au tarif convenu{result.totaux.communesHT ? " + parties communes" : ""})</td><td className="r">{eur(effective.prevuHT)}</td></tr>}
                        {effective.ecartHT != null && <tr className="sub"><td>Écart (facturé − prévu)</td><td className="r">{eur(effective.ecartHT)}</td></tr>}
                        <tr><td>Facturé en trop (sans ménage, doublons, tarifs)</td><td className="r">+ {eur(effective.brutHT)}</td></tr>
                        <tr><td>Ménages effectués non facturés (déduits)</td><td className="r">− {eur(effective.compensationHT)}</td></tr>
                        {effective.remiseSurNetHT ? <tr><td>Part du trop-facturé déjà couverte par la remise</td><td className="r">− {eur(effective.remiseSurNetHT)}</td></tr> : null}
                        {effective.autresHT ? <tr><td>Autres écarts, sans réclamation (tarifs inférieurs, logements sans tarif)</td><td className="r">{eur(effective.autresHT)}</td></tr> : null}
                        <tr className={`net ${effective.netHT > 0 ? "rouge" : "vert"}`}>
                          <td>Net à réclamer</td>
                          <td className="r">{effective.netHT > 0 ? `${eur(effective.netHT)} HT` : "Rien"}</td>
                        </tr>
                      </tbody>
                    </table>
                    <RemiseSaisie remise={effective.remise} onChange={majRemise} />
                    {effective.prevuHT == null && <div className="recap-sub no-print">Contrôle enregistré avant le calcul du « prévu » : réimporte l&apos;annexe pour le détail complet.</div>}
                  </div>
                </div>

                {reclam.length > 0 && (
                  <div className="resid">
                    <div className="resid-head"><span className="resid-name">Facturé en trop</span><span className="resid-count">{reclam.filter(e => e.reclamable).length} ligne(s) réclamée(s) · {eur(effective.brutHT)} HT</span></div>
                    <div className="tbl-wrap"><table className="tbl">
                      <thead><tr><th className="no-print c">Réclamer</th><th>Type</th><th>N°</th><th>Date</th><th className="r">Montant HT</th><th>Détail</th></tr></thead>
                      <tbody>{reclam.map((e, i) => (
                        <tr key={rowKey(e, i)} className={e.reclamable ? undefined : "fm-off"}>
                          <td className="no-print c"><label className="fm-check"><input type="checkbox" checked={e.reclamable} onChange={() => toggle(e)} aria-label="Réclamer cette ligne" /></label></td>
                          <td>{TYPES[e.type].label}</td><td className="apt">{e.unit || "—"}</td><td>{fmtFr(e.date)}</td>
                          <td className="r" data-label="HT">{eur(e.montantHT)}</td><td className="fm-detail">{e.detail}</td>
                        </tr>))}</tbody>
                    </table></div>
                    <div className="fm-note no-print">Décoche une ligne si le ménage a bien eu lieu (ex. ménage fait sans départ) : elle sort de la réclamation.</div>
                  </div>
                )}

                {compens.length > 0 && (
                  <div className="resid">
                    <div className="resid-head"><span className="resid-name">Ménages effectués non facturés (déduits)</span><span className="resid-count">{eur(effective.compensationHT)} HT</span></div>
                    <div className="tbl-wrap"><table className="tbl">
                      <thead><tr><th className="no-print c">Déduire</th><th>N°</th><th>Date</th><th className="r">Valeur HT</th><th>Détail</th></tr></thead>
                      <tbody>{compens.map((e, i) => (
                        <tr key={rowKey(e, i)} className={e.compensation ? undefined : "fm-off"}>
                          <td className="no-print c"><label className="fm-check"><input type="checkbox" checked={e.compensation} onChange={() => toggle(e)} aria-label="Déduire ce ménage" /></label></td>
                          <td className="apt">{e.unit || "—"}</td><td>{fmtFr(e.date)}</td><td className="r" data-label="HT">{eur(e.montantHT)}</td><td className="fm-detail">{e.detail}</td>
                        </tr>))}</tbody>
                    </table></div>
                    <div className="fm-note no-print">Décoche un ménage s&apos;il n&apos;a finalement pas eu lieu : il n&apos;est plus déduit.</div>
                  </div>
                )}

                {communes.length > 0 && (
                  <div className="resid">
                    <div className="resid-head"><span className="resid-name">Parties communes</span><span className="resid-count">{eur(result.totaux.communesHT)} HT · comprises dans le total</span></div>
                    <div className="tbl-wrap"><table className="tbl">
                      <thead><tr><th>Date</th><th>Description</th><th className="r">HT</th><th className="r">TVA</th><th className="r">TTC</th></tr></thead>
                      <tbody>{communes.map(l => (
                        <tr key={l.ligne}><td>{fmtFr(l.date)}</td><td className="fm-detail">{l.desc}</td><td className="r" data-label="HT">{eur(l.ht)}</td><td className="r" data-label="TVA">{eur(l.tva)}</td><td className="r" data-label="TTC">{eur(l.ttc)}</td></tr>))}</tbody>
                    </table></div>
                  </div>
                )}

                {info.length > 0 && (
                  <div className="resid">
                    <div className="resid-head"><span className="resid-name">À vérifier de ton côté (rien à réclamer)</span><span className="resid-count">{info.length} ligne(s)</span></div>
                    <div className="fm-note">Sans effet sur le montant. « Date différente » : même logement facturé à une autre date que le départ.</div>
                    <div className="tbl-wrap"><table className="tbl">
                      <thead><tr><th>Type</th><th>N°</th><th>Date</th><th>Détail</th></tr></thead>
                      <tbody>{info.map((e, i) => (
                        <tr key={rowKey(e, i)}><td>{TYPES[e.type].label}</td><td className="apt">{e.unit || "—"}</td><td>{fmtFr(e.date)}</td><td className="fm-detail">{e.detail}</td></tr>))}</tbody>
                    </table></div>
                  </div>
                )}

                {mail && (
                  <div className="resid no-print">
                    <div className="resid-head"><span className="resid-name">Mail de réclamation</span><span className="resid-count">montant net, après déduction</span></div>
                    <div className="fm-mail">
                      <input readOnly value={mail.subject} aria-label="Objet du mail" />
                      <textarea readOnly value={mail.body} rows={Math.min(24, mail.body.split("\n").length + 1)} aria-label="Texte du mail" />
                      <div className="fm-actions">
                        <button type="button" className="fm-btn primary" onClick={copyMail}>{copied ? "Copié ✓" : "Copier le mail"}</button>
                        <a className="fm-btn" href={`mailto:?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`}>Ouvrir dans la messagerie</a>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {parMois.length > 0 && (
            <div className="fm-step no-print">
              <div className="fm-step-title">Contrôles enregistrés <span className="fm-count">{history.length}</span></div>
              {parMois.map((g, i) => {
                const lignes = g.items.map(h => ({ h, net: bilanControle(h, h.ignores || []).netHT }));
                const aReclamer = lignes.reduce((s, x) => s + (x.net > 0 ? x.net : 0), 0);
                return (
                  <details key={g.mois} className="fm-groupe" open={i === 0 || g.mois === mois}>
                    <summary>
                      <span className="fm-sum-fleche" aria-hidden="true">▸</span>
                      <span className="fm-sum-mois">{moisLabel(g.mois)}</span>
                      <span className="fm-sum-info">{g.items.length}/{RESIDENCES.length} résidence(s)</span>
                      <span className={`fm-sum-net ${aReclamer > 0 ? "rouge" : "vert"}`}>{aReclamer > 0 ? `${eur(aReclamer)} à réclamer` : "Rien à réclamer"}</span>
                    </summary>
                    <div className="tbl-wrap"><table className="tbl fm-hist">
                      <thead><tr><th>Résidence</th><th className="r">Annexe HT</th><th className="r">Net à réclamer</th><th>Suivi</th><th></th></tr></thead>
                      <tbody>{lignes.map(({ h, net }) => (
                        <tr key={h.id} className={h.id === resultId ? "fm-actif" : undefined}>
                          <td className="apt fm-h-nom">{h.residence}</td>
                          <td className="r fm-h-annexe">{eur(h.totaux?.annexeHT)}</td>
                          <td className={`r fm-net-cell fm-h-net ${net > 0 ? "rouge" : "vert"}`}>{net > 0 ? eur(net) : "Rien"}</td>
                          <td className="fm-h-suivi">
                            <select value={suiviDe(h)} onChange={e => majSuivi(h, e.target.value)} aria-label={`Suivi ${h.residence} ${moisLabel(h.mois)}`}>
                              <option value="controle">Contrôlé</option>
                              <option value="reclame">Réclamation envoyée</option>
                              <option value="avoir">Avoir reçu</option>
                            </select>
                          </td>
                          <td className="fm-row-actions">
                            <button type="button" className="fm-btn" onClick={() => ouvrir(h)}>Voir</button>
                            <button type="button" className="fm-btn fm-btn-danger" onClick={() => supprimer(h)}>Supprimer</button>
                          </td>
                        </tr>))}</tbody>
                    </table></div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}
      {apercu && <AnnexeApercu controle={apercu} onClose={() => setApercu(null)} />}
    </div>
  );
}

// Visualisation rapide de l'annexe importée : lignes telles que lues dans le fichier Excel
// (lignes vides et ligne de totaux écartées), avec l'écart trouvé sur chaque ligne.
function AnnexeApercu({ controle, onClose }) {
  const [filtre, setFiltre] = useState("");
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const ecartsParLigne = {};
  for (const e of nettoyerEcarts(controle.ecarts)) if (e.ligne != null) (ecartsParLigne[e.ligne] ||= []).push(e);
  const f = filtre.trim().toLowerCase();
  const lignes = (controle.lines || []).filter(l => !f
    || [l.unit, l.label, l.desc, fmtFr(l.date), l.resa].some(v => String(v || "").toLowerCase().includes(f)));
  const total = lignes.reduce((s, l) => s + (l.ht || 0) + (l.amenities || 0), 0);
  const titre = `Annexe ${controle.residence} · ${moisLabel(controle.mois)}`;
  return (
    <div className="fl-pdf-overlay no-print" onClick={onClose} role="dialog" aria-modal="true" aria-label={titre}>
      <div className="fl-pdf fm-apercu" onClick={e => e.stopPropagation()}>
        <div className="fl-pdf-head">
          <span className="fl-pdf-titre">{titre}{controle.annexeNom ? ` · ${controle.annexeNom}` : ""}</span>
          <input type="search" className="fm-apercu-filtre" placeholder="Filtrer (n°, date…)" value={filtre} onChange={e => setFiltre(e.target.value)} aria-label="Filtrer les lignes" />
          <button type="button" className="fm-btn" onClick={onClose}>Fermer</button>
        </div>
        <div className="fm-apercu-info">{lignes.length} ligne(s) · {eur(Math.round(total * 100) / 100)} HT{f ? " (filtrées)" : ""}. En couleur : lignes avec un écart.</div>
        <div className="fm-apercu-cadre"><table className="tbl fm-apercu-tbl">
          <thead><tr><th className="r">Ligne</th><th>N°</th><th>Libellé</th><th>Date</th><th>Description</th><th className="r">HT</th><th className="r">Amenities</th><th className="r">TTC</th><th>Écart</th></tr></thead>
          <tbody>{lignes.map(l => {
            const ec = ecartsParLigne[l.ligne] || [];
            const cls = ec.some(e => e.reclamable) ? "fm-ap-rouge" : ec.length ? "fm-ap-orange" : undefined;
            return (
              <tr key={l.ligne} className={cls}>
                <td className="r">{l.ligne}</td>
                <td className="apt">{l.commune ? "Communs" : (l.unit || "—")}</td>
                <td>{l.label}</td>
                <td>{fmtFr(l.date)}</td>
                <td className="fm-detail">{l.desc}</td>
                <td className="r">{eur(l.ht)}</td>
                <td className="r">{l.amenities ? eur(l.amenities) : ""}</td>
                <td className="r">{eur(l.ttc)}</td>
                <td className="fm-detail">{ec.map(e => TYPES[e.type]?.label).join(", ")}</td>
              </tr>);
          })}</tbody>
        </table></div>
      </div>
    </div>
  );
}
