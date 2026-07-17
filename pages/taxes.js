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

function TaxesImpayees() {
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

// ---------- GESTION DES ESPÈCES ----------
// Registre manuel (Firebase) : le réceptionniste saisit chaque paiement client en espèces
// et chaque dépense hôtel. Suivi du solde en caisse. Mikhael passe régulièrement récupérer
// une partie des espèces, laisse un reliquat en caisse — chaque récupération est tracée
// et exportable en Excel (CSV), avec un historique complet consultable à tout moment.
function CashManagement() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [entries, setEntries] = useState([]);
  const [recoveries, setRecoveries] = useState([]);
  const [status, setStatus] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showRecoverForm, setShowRecoverForm] = useState(false);

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, writeBatch } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, writeBatch };
      setFs(api);
      await loadAll(api);
      setReady(true);
    })();
  }, []);

  async function loadAll(api) {
    setStatus("Chargement…");
    const eSnap = await api.getDocs(api.query(api.collection(api.db, "cash_entries"), api.orderBy("date", "desc")));
    setEntries(eSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const rSnap = await api.getDocs(api.query(api.collection(api.db, "cash_recoveries"), api.orderBy("createdAt", "desc")));
    setRecoveries(rSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setStatus("");
  }

  async function importHistorique() {
    const alreadyImported = entries.some(e => e.imported);
    if (alreadyImported) {
      if (!confirm("Un import historique semble déjà avoir été fait (des entrées 'imported' existent). Importer quand même une seconde fois ? Cela créera des doublons.")) return;
    } else {
      if (!confirm("Importer l'historique Excel (543 lignes) ? Les dates de séjour restent au format texte d'origine (ex. \"23 AU 25 FEVRIER\") car l'année n'est pas connue avec certitude — la date exacte ne sera pas remplie, seulement conservée dans la désignation.")) return;
    }
    try {
      setStatus("Import en cours…");
      const res = await fetch("/cash_history_import.json");
      const rows = await res.json();
      const toWrite = [];
      for (const r of rows) {
        if (r.espece > 0) {
          const desig = [r.designation, `Séjour : ${r.periode}`].filter(Boolean).join(" · ");
          toWrite.push({ type: "client", date: "", client: r.client, appartement: "", arrivalDate: "", designation: desig, amount: r.espece, recoveryId: null, imported: true, createdAt: new Date().toISOString() });
        }
        if (r.depense > 0) {
          const desig = r.designation || `Dépense (séjour ${r.client}, ${r.periode})`;
          toWrite.push({ type: "expense", date: "", designation: desig, amount: r.depense, recoveryId: null, imported: true, createdAt: new Date().toISOString() });
        }
      }
      // Écriture par lots de 450 (limite Firestore batch = 500)
      for (let i = 0; i < toWrite.length; i += 450) {
        const batch = fs.writeBatch(fs.db);
        const chunk = toWrite.slice(i, i + 450);
        for (const item of chunk) {
          const ref = fs.doc(fs.collection(fs.db, "cash_entries"));
          batch.set(ref, item);
        }
        await batch.commit();
      }
      await loadAll(fs);
      setStatus(`${toWrite.length} entrée(s) importée(s) depuis l'historique Excel.`);
    } catch (err) { setStatus("Erreur import : " + err.message); }
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <div className="menage-page"><div className="recap">
        <div className="recap-title">Configuration Firebase requise</div>
        <p style={{ color: "#666", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
      </div></div>
    );
  }

  const unrecovered = entries.filter(e => !e.recoveryId);
  const baseline = recoveries.length ? Number(recoveries[0].amountLeftInBox) || 0 : 0;
  const sumClient = unrecovered.filter(e => e.type === "client").reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const sumExpense = unrecovered.filter(e => e.type === "expense").reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalEnCaisse = baseline + sumClient - sumExpense;

  return (
    <>
      <Head><title>Gestion des espèces</title></Head>
      <div className="toolbar">
        <h1>Gestion des espèces</h1>
        <span className="status">{status}</span>
        <button onClick={importHistorique}>Importer historique Excel</button>
        <button onClick={() => setShowHistory(!showHistory)}>{showHistory ? "← Retour" : "Historique →"}</button>
      </div>

      <div className="menage-page">
        <div className="recap">
          {!showHistory ? (
            <CashCurrent
              fs={fs} entries={entries} unrecovered={unrecovered}
              baseline={baseline} sumClient={sumClient} sumExpense={sumExpense} totalEnCaisse={totalEnCaisse}
              showRecoverForm={showRecoverForm} setShowRecoverForm={setShowRecoverForm}
              reload={() => loadAll(fs)} setStatus={setStatus}
            />
          ) : (
            <CashHistory recoveries={recoveries} entries={entries} />
          )}
        </div>
      </div>
    </>
  );
}

function fmtFrShort(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
function euros2(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function downloadEntriesCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---- Vue courante : saisie + solde + liste depuis la dernière récupération ----
function CashCurrent({ fs, entries, unrecovered, baseline, sumClient, sumExpense, totalEnCaisse, showRecoverForm, setShowRecoverForm, reload, setStatus }) {
  const today = isoDay(new Date());
  const [mode, setMode] = useState("client"); // client | expense
  const [date, setDate] = useState(today);
  const [client, setClient] = useState("");
  const [appartement, setAppartement] = useState("");
  const [arrivalDate, setArrivalDate] = useState("");
  const [designation, setDesignation] = useState("");
  const [amount, setAmount] = useState("");

  async function addEntry() {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setStatus("Montant invalide."); return; }
    try {
      setStatus("Enregistrement…");
      const payload = {
        type: mode, date, amount: amt, designation: designation || "",
        recoveryId: null, createdAt: new Date().toISOString(),
      };
      if (mode === "client") {
        payload.client = client || ""; payload.appartement = appartement || ""; payload.arrivalDate = arrivalDate || "";
      }
      await fs.addDoc(fs.collection(fs.db, "cash_entries"), payload);
      setClient(""); setAppartement(""); setArrivalDate(""); setDesignation(""); setAmount("");
      await reload();
      setStatus("Enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function delEntry(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette entrée ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "cash_entries", id));
    await reload();
  }

  function exportCurrentCSV() {
    const rows = [["Type", "Date", "Client", "Appartement", "Date arrivée", "Désignation", "Montant"]];
    for (const e of unrecovered) {
      rows.push([
        e.type === "client" ? "Paiement client" : "Dépense",
        fmtFrShort(e.date), e.client || "", e.appartement || "",
        e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", e.designation || "", e.amount,
      ]);
    }
    downloadEntriesCSV(`especes_en_cours_${today}.csv`, rows);
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Espèces depuis la dernière récupération</div>
          <div className="recap-sub">Saisie des paiements clients en espèces et des dépenses hôtel</div>
        </div>
        <div className="recap-total">
          <div className="n">{euros2(totalEnCaisse)}</div>
          <div className="l">total en caisse</div>
        </div>
      </div>

      <div className="linen-form">
        <div className="linen-form-row">
          <label>Type
            <select value={mode} onChange={e => setMode(e.target.value)}>
              <option value="client">Paiement client (espèces)</option>
              <option value="expense">Dépense hôtel</option>
            </select>
          </label>
          <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        {mode === "client" ? (
          <div className="linen-form-row">
            <label>Nom du client <input type="text" value={client} onChange={e => setClient(e.target.value)} style={{ width: 180 }} /></label>
            <label>Appartement <input type="text" value={appartement} onChange={e => setAppartement(e.target.value)} style={{ width: 130 }} /></label>
            <label>Date arrivée <input type="date" value={arrivalDate} onChange={e => setArrivalDate(e.target.value)} /></label>
            <label>Désignation <input type="text" value={designation} onChange={e => setDesignation(e.target.value)} placeholder="taxe de séjour, autre vente…" style={{ width: 180 }} /></label>
            <label>Montant € <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 100 }} /></label>
          </div>
        ) : (
          <div className="linen-form-row">
            <label>Type de dépense <input type="text" value={designation} onChange={e => setDesignation(e.target.value)} placeholder="ex. fournitures, réparation…" style={{ width: 220 }} /></label>
            <label>Montant € <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 100 }} /></label>
          </div>
        )}
        <button className="primary" onClick={addEntry}>Ajouter</button>
      </div>

      <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        <button onClick={exportCurrentCSV} disabled={!unrecovered.length}>Télécharger Excel (en cours)</button>
        <button className="primary" onClick={() => setShowRecoverForm(!showRecoverForm)} disabled={!unrecovered.length && !baseline}>
          {showRecoverForm ? "Annuler" : "Récupération des espèces"}
        </button>
      </div>

      {showRecoverForm && (
        <RecoverForm fs={fs} unrecovered={unrecovered} totalEnCaisse={totalEnCaisse}
          onDone={() => { setShowRecoverForm(false); reload(); }} setStatus={setStatus} />
      )}

      <table className="tbl" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Client</th><th>Appartement</th>
            <th>Désignation</th><th className="c">Montant</th><th></th>
          </tr>
        </thead>
        <tbody>
          {unrecovered.map(e => (
            <tr key={e.id}>
              <td>{fmtFrShort(e.date)}</td>
              <td>{e.type === "client" ? "Client" : <span style={{ color: "#e74c3c" }}>Dépense</span>}</td>
              <td>{e.client || "—"}</td>
              <td>{e.appartement || "—"}</td>
              <td>{e.designation || "—"}</td>
              <td className="c" style={{ color: e.type === "expense" ? "#e74c3c" : "#1f7a3f", fontWeight: 600 }}>
                {e.type === "expense" ? "−" : "+"}{euros2(e.amount)}
              </td>
              <td><button onClick={() => delEntry(e.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button></td>
            </tr>
          ))}
          {unrecovered.length === 0 && <tr><td colSpan={7} className="empty-state">Rien depuis la dernière récupération.</td></tr>}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "#666", marginTop: 10 }}>
        Total en caisse = reliquat laissé à la dernière récupération ({euros2(baseline)}) + paiements clients ({euros2(sumClient)}) − dépenses ({euros2(sumExpense)}).
      </p>
    </>
  );
}

// ---- Formulaire de récupération : clôture les entrées en cours ----
function RecoverForm({ fs, unrecovered, totalEnCaisse, onDone, setStatus }) {
  const [amountRecovered, setAmountRecovered] = useState("");
  const [amountLeftInBox, setAmountLeftInBox] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setAmountRecovered(totalEnCaisse.toFixed(2));
    setAmountLeftInBox("0");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rec = Number(amountRecovered) || 0;
  const left = Number(amountLeftInBox) || 0;
  const coherent = Math.abs(rec + left - totalEnCaisse) < 0.01;
  const montantsValides = rec >= 0 && left >= 0;
  const totalPositif = totalEnCaisse > 0;
  const peutValider = coherent && montantsValides && totalPositif;

  async function confirmRecovery() {
    if (!totalPositif) { setStatus("La caisse est vide ou négative, rien à récupérer."); return; }
    if (!montantsValides) { setStatus("Les montants ne peuvent pas être négatifs."); return; }
    if (!coherent) { setStatus("Récupéré + laissé doit être égal au total en caisse."); return; }
    try {
      setStatus("Enregistrement de la récupération…");
      const date = isoDay(new Date());
      const entryIds = unrecovered.map(e => e.id);
      const recDoc = await fs.addDoc(fs.collection(fs.db, "cash_recoveries"), {
        date, amountRecovered: rec, amountLeftInBox: left, note: note || "",
        totalAvant: totalEnCaisse, entryIds, createdAt: new Date().toISOString(),
      });
      const batch = fs.writeBatch(fs.db);
      for (const id of entryIds) {
        batch.update(fs.doc(fs.db, "cash_entries", id), { recoveryId: recDoc.id });
      }
      await batch.commit();
      setStatus(`Récupération enregistrée : ${euros2(rec)} récupérés, ${euros2(left)} laissés en caisse.`);
      onDone();
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  return (
    <div className="linen-form" style={{ background: "#eef7ee", borderColor: "#bfe3bf" }}>
      <div className="linen-form-row">
        <div style={{ fontSize: 13 }}><strong>Total en caisse à répartir : {euros2(totalEnCaisse)}</strong></div>
      </div>
      <div className="linen-form-row">
        <label>Montant récupéré € <input type="number" step="0.01" value={amountRecovered} onChange={e => setAmountRecovered(e.target.value)} style={{ width: 110 }} /></label>
        <label>Laissé en caisse € <input type="number" step="0.01" value={amountLeftInBox} onChange={e => setAmountLeftInBox(e.target.value)} style={{ width: 110 }} /></label>
        <label style={{ flex: 1 }}>Note <input type="text" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%" }} /></label>
      </div>
      {!coherent && <div style={{ color: "#e74c3c", fontSize: 12, marginBottom: 8 }}>Récupéré + laissé ({euros2(rec + left)}) doit être égal au total en caisse ({euros2(totalEnCaisse)}).</div>}
      <button className="primary" onClick={confirmRecovery} disabled={!peutValider}>Confirmer la récupération</button>
    </div>
  );
}

// ---- Historique des récupérations ----
function CashHistory({ recoveries, entries }) {
  function exportRecoveryCSV(rec) {
    const linked = entries.filter(e => e.recoveryId === rec.id);
    const rows = [["Type", "Date", "Client", "Appartement", "Date arrivée", "Désignation", "Montant"]];
    for (const e of linked) {
      rows.push([
        e.type === "client" ? "Paiement client" : "Dépense",
        fmtFrShort(e.date), e.client || "", e.appartement || "",
        e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", e.designation || "", e.amount,
      ]);
    }
    rows.push([]);
    rows.push(["Récupéré", "", "", "", "", "", rec.amountRecovered]);
    rows.push(["Laissé en caisse", "", "", "", "", "", rec.amountLeftInBox]);
    downloadEntriesCSV(`recuperation_especes_${rec.date}.csv`, rows);
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Historique des récupérations</div>
          <div className="recap-sub">Chaque récupération est exportable individuellement</div>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Date</th><th className="c">Total avant</th><th className="c">Récupéré</th>
            <th className="c">Laissé en caisse</th><th>Note</th><th></th>
          </tr>
        </thead>
        <tbody>
          {recoveries.map(r => (
            <tr key={r.id}>
              <td>{fmtFrShort(r.date)}</td>
              <td className="c">{euros2(r.totalAvant)}</td>
              <td className="c" style={{ fontWeight: 700, color: "#1f7a3f" }}>{euros2(r.amountRecovered)}</td>
              <td className="c">{euros2(r.amountLeftInBox)}</td>
              <td>{r.note || "—"}</td>
              <td><button onClick={() => exportRecoveryCSV(r)} className="ghost" style={{ color: "#1f7a3f" }}>📥 Excel</button></td>
            </tr>
          ))}
          {recoveries.length === 0 && <tr><td colSpan={6} className="empty-state">Aucune récupération enregistrée.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

export default function TaxesPage() {
  const [subtab, setSubtab] = useState("impayees");
  return (
    <>
      <div className="toolbar" style={{ paddingBottom: 0 }}>
        <div className="quick">
          <button onClick={() => setSubtab("impayees")} className={subtab === "impayees" ? "primary" : ""}>Taxes impayées</button>
          <button onClick={() => setSubtab("especes")} className={subtab === "especes" ? "primary" : ""}>Gestion des espèces</button>
        </div>
      </div>
      {subtab === "impayees" && <TaxesImpayees />}
      {subtab === "especes" && <CashManagement />}
    </>
  );
}
