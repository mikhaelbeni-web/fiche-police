// pages/taxes.js
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import CodeModal from "../components/CodeModal";
import { useCodeGate } from "../hooks/useCodeGate";

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

// Code demandé avant de masquer une taxe impayée. Ce n'est pas une vraie sécurité
// (comparaison faite dans le navigateur) : juste un frein contre une fausse
// manœuvre. Les espèces n'en dépendent plus : leurs suppressions et récupérations
// sont contrôlées par le serveur (/api/especes, Espace admin, codes personnels).
const DELETE_PASSWORD = process.env.NEXT_PUBLIC_DELETE_PASSWORD || "2305";

function ControleExclusions({ data }) {
  const [ouvert, setOuvert] = useState(false);
  const ex = data.exclus || {};
  const detail = data.exclusDetail || [];
  const totalExclus = Object.values(ex).reduce((s, n) => s + (n || 0), 0);
  if (!data.scanned) return null;

  return (
    <div className="panel">
      <div className="panel-row">
        <strong>Contrôle :</strong>
        <span>{data.scanned} réservation(s) analysée(s) sur la période</span>
        <span className="pill ok">{data.total} retenue(s)</span>
        <span>· {totalExclus} écartée(s)</span>
        {detail.length > 0 && (
          <button onClick={() => setOuvert(o => !o)} className="ghost">
            {ouvert ? "Masquer" : `Voir les ${detail.length} cas à vérifier`}
          </button>
        )}
      </div>

      <div className="note">
        Motifs d&apos;exclusion : {ex.horsBooking || 0} hors Booking.com · {ex.dejaPaye || 0} déjà payées · {ex.sansLigneTaxe || 0} sans ligne de taxe · {ex.pasEncoreArrive || 0} pas encore arrivées · {ex.horsPeriode || 0} hors période.
      </div>

      {ouvert && detail.length > 0 && (
        <div className="tbl-wrap"><table className="tbl tbl-cards" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>Client</th><th>Arrivée</th><th>Appartement</th><th>Canal</th><th>Statut paiement</th><th>Motif</th></tr>
          </thead>
          <tbody>
            {detail.map((d, i) => (
              <tr key={i}>
                <td className="card-title">{d.client}</td>
                <td data-label="Arrivée">{fmtFr(d.arrivee)}</td>
                <td data-label="Appartement">{d.listing}</td>
                <td data-label="Canal">{d.canal || "—"}</td>
                <td data-label="Statut paiement">{d.statutPaiement || "—"}</td>
                <td data-label="Motif" className="card-full">
                  {d.motif === "horsBooking" ? "Canal ≠ Booking.com"
                    : d.motif === "dejaPaye" ? "Paiement non partiel"
                    : d.motif === "sansLigneTaxe" ? "Aucune ligne taxe de séjour"
                    : d.motif}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function TaxesImpayees() {
  const { requestCode, codeModalProps } = useCodeGate(DELETE_PASSWORD, "Code admin requis pour masquer cette taxe");
  const today = isoDay(new Date());
  const [from, setFrom] = useState("2026-07-10"); // départ fixe : 10 juillet
  const [to, setTo] = useState(today);
  const [residence, setResidence] = useState("__all__");
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [creds, setCreds] = useState({ account: "", key: "" });
  const [fs, setFs] = useState(null);
  const [masked, setMasked] = useState([]); // taxes masquées manuellement (Firestore)
  const [showMasked, setShowMasked] = useState(false);

  useEffect(() => {
    setCreds({
      account: window.localStorage.getItem(ACCOUNT_KEY) || "",
      key: window.localStorage.getItem(KEY_KEY) || "",
    });
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) return;
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadMasked(api);
    })();
  }, []);

  async function loadMasked(api) {
    const snap = await api.getDocs(api.query(api.collection(api.db, "taxes_masquees"), api.orderBy("maskedAt", "desc")));
    setMasked(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  // Masque définitivement une taxe qui apparaît "partiellement payée" sur
  // Hostaway alors qu'elle est en réalité déjà réglée (désynchro côté PMS).
  // Protégé par code : à n'utiliser qu'après vérification manuelle du vrai
  // statut de paiement, pas comme raccourci pour ignorer une vraie impayée.
  function maskTax(it) {
    if (!fs) { setStatus("Firebase non configuré — impossible de masquer."); return; }
    if (!confirm(`Masquer définitivement la taxe de ${it.client} (${euros(it.taxeSejour)}) ? Elle disparaîtra de cette liste, considérée comme déjà payée.`)) return;
    requestCode(async () => {
      try {
        await fs.addDoc(fs.collection(fs.db, "taxes_masquees"), {
          reservation: it.reservation || "", client: it.client, residence: it.residence,
          appartement: it.appartement, arrivee: it.arrivee, taxeSejour: it.taxeSejour,
          maskedAt: new Date().toISOString(),
        });
        await loadMasked(fs);
        setStatus("Taxe masquée.");
      } catch (err) { setStatus("Erreur : " + err.message); }
    });
  }

  function unmaskTax(m) {
    if (!confirm(`Réafficher la taxe de ${m.client} dans la liste des impayées ?`)) return;
    requestCode(async () => {
      try {
        await fs.deleteDoc(fs.doc(fs.db, "taxes_masquees", m.id));
        await loadMasked(fs);
        setStatus("Taxe réaffichée.");
      } catch (err) { setStatus("Erreur : " + err.message); }
    });
  }

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
  const maskedKeys = new Set(masked.map(m => m.reservation).filter(Boolean));
  const items = (data?.items || [])
    .filter(i => residence === "__all__" || i.residence === residence)
    .filter(i => !(i.reservation && maskedKeys.has(i.reservation)));

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
        <button onClick={() => load(from, to, creds.account, creds.key)} disabled={loading} title="Actualiser" aria-label="Actualiser" className="tx-refresh">↻</button>
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

          {data && (
            <ControleExclusions data={data} />
          )}

          {groups.map(g => (
            <div className="resid" key={g.residence}>
              <div className="resid-head">
                <span className="resid-name">{g.residence}</span>
                <span className="resid-count">{g.items.length} résa · {euros(g.sum)}</span>
              </div>
              <div className="tbl-wrap"><table className="tbl tbl-cards">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Appartement</th>
                    <th>Arrivée</th>
                    <th>Client</th>
                    <th>Statut</th>
                    <th className="c">Taxe séjour</th>
                    <th className="c">Réglé</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, i) => (
                    <tr key={i}>
                      <td className="apt" data-label="N°">{it.unitNumber || "—"}</td>
                      <td data-label="Appartement">{it.appartement}</td>
                      <td data-label="Arrivée">{fmtFr(it.arrivee)}</td>
                      <td className="card-title">{it.client}</td>
                      <td data-label="Statut">{it.paymentStatus}</td>
                      <td className="c" data-label="Taxe séjour">{euros(it.taxeSejour)}</td>
                      <td className="c tx-regle"><span className="box" /></td>
                      <td className="tx-actions">
                        <button onClick={() => maskTax(it)} className="ghost"
                          title="Déjà réglée en réalité (désynchro Hostaway) — la masquer définitivement de cette liste">
                          Masquer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          ))}

          {!loading && !data && status.startsWith("Erreur") && (
            <div className="msg bad">
              ⚠ Impossible de vérifier — la connexion à Hostaway a échoué ({status.replace("Erreur : ", "")}).
              Ceci n&apos;est PAS un résultat « aucune taxe due », c&apos;est une vérification qui n&apos;a pas pu se faire. Réessaie avec ↻ avant de conclure quoi que ce soit.
            </div>
          )}

          {!loading && data && items.length === 0 && (
            <div className="empty-state">Aucune taxe de séjour impayée sur cette période.</div>
          )}

          {groups.length > 0 && (
            <div className="grand-total">
              <span className="gt">Total taxe due : {euros(shownTotal)}</span>
            </div>
          )}

          {masked.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <button onClick={() => setShowMasked(s => !s)} className="ghost">
                {showMasked ? "Masquer" : `Voir les ${masked.length} taxe(s) masquée(s) manuellement`}
              </button>
              {showMasked && (
                <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl tbl-cards">
                  <thead>
                    <tr><th>Client</th><th>Appartement</th><th>Arrivée</th><th className="c">Taxe</th><th>Masquée le</th><th></th></tr>
                  </thead>
                  <tbody>
                    {masked.map(m => (
                      <tr key={m.id}>
                        <td className="card-title">{m.client}</td>
                        <td data-label="Appartement">{m.residence} {m.appartement}</td>
                        <td data-label="Arrivée">{fmtFr(m.arrivee)}</td>
                        <td className="c" data-label="Taxe">{euros(m.taxeSejour)}</td>
                        <td data-label="Masquée le">{fmtFr((m.maskedAt || "").slice(0, 10))}</td>
                        <td className="tx-actions"><button onClick={() => unmaskTax(m)} className="ghost">Réafficher</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          )}
        </div>
      </div>
      <CodeModal {...codeModalProps} />
    </>
  );
}

// ---------- GESTION DES ESPÈCES ----------
// Registre manuel (Firebase) : le réceptionniste saisit chaque paiement client en espèces
// et chaque dépense hôtel. Suivi du solde en caisse. Mikhael passe régulièrement récupérer
// une partie des espèces, laisse un reliquat en caisse — chaque récupération est tracée
// et exportable en Excel (CSV), avec un historique complet consultable à tout moment.
// Écritures : toutes par /api/especes (journal d'audit côté serveur, voir
// lib/especesJournal.js). Le navigateur ne fait plus que lire Firestore.
async function especesApi(body) {
  const r = await fetch("/api/especes", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({ error: `Réponse illisible (HTTP ${r.status}).` }));
  if (!r.ok || d.ok === false) throw new Error(d.error || `Erreur HTTP ${r.status}`);
  return d;
}

function CashManagement() {
  const [personnel, setPersonnel] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
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
      await Promise.all([loadAll(api), loadPersonnel()]);
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

  async function loadPersonnel() {
    try {
      const r = await fetch("/api/especes", { headers: { Accept: "application/json" } });
      const d = await r.json();
      if (r.ok) { setPersonnel(d.personnel || []); setIsAdmin(Boolean(d.isAdmin)); }
    } catch { /* liste vide : la saisie affichera un message */ }
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <div className="menage-page"><div className="recap">
        <div className="recap-title">Configuration Firebase requise</div>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
      </div></div>
    );
  }

  // Rien n'est plus jamais effacé : les lignes et récupérations supprimées restent en
  // base (deleted = true) et sont écartées ici des calculs.
  const activeEntries = entries.filter(e => !e.deleted);
  const activeRecoveries = recoveries.filter(r => !r.deleted);
  const unrecovered = activeEntries.filter(e => !e.recoveryId);
  const baseline = activeRecoveries.length ? Number(activeRecoveries[0].amountLeftInBox) || 0 : 0;
  const sumClient = unrecovered.filter(e => e.type === "client").reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const sumExpense = unrecovered.filter(e => e.type === "expense").reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalEnCaisse = baseline + sumClient - sumExpense;

  return (
    <>
      <Head><title>Gestion des espèces</title></Head>
      <div className="toolbar">
        <h1>Gestion des espèces</h1>
        <span className="status">{status}</span>
        <button onClick={() => setShowHistory(!showHistory)}>{showHistory ? "← Retour" : "Historique →"}</button>
      </div>

      <div className="menage-page">
        <div className="recap">
          {!showHistory ? (
            <CashCurrent
              fs={fs} entries={activeEntries} unrecovered={unrecovered} recoveries={activeRecoveries}
              personnel={personnel} isAdmin={isAdmin} reloadPersonnel={loadPersonnel}
              baseline={baseline} sumClient={sumClient} sumExpense={sumExpense} totalEnCaisse={totalEnCaisse}
              showRecoverForm={showRecoverForm} setShowRecoverForm={setShowRecoverForm}
              reload={() => loadAll(fs)} setStatus={setStatus}
            />
          ) : (
            <CashHistory recoveries={recoveries} entries={entries} isAdmin={isAdmin} reload={() => loadAll(fs)} setStatus={setStatus} />
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
function CashCurrent({ fs, entries, unrecovered, recoveries, baseline, sumClient, sumExpense, totalEnCaisse, showRecoverForm, setShowRecoverForm, reload, setStatus, personnel, isAdmin, reloadPersonnel }) {
  const today = isoDay(new Date());
  const [mode, setMode] = useState("client"); // client | expense
  const [date, setDate] = useState(today);
  const [client, setClient] = useState("");
  const [appartement, setAppartement] = useState("");
  const [arrivalDate, setArrivalDate] = useState("");
  const [designation, setDesignation] = useState("");
  const [fournisseur, setFournisseur] = useState("");
  const [amount, setAmount] = useState("");
  const [saisiPar, setSaisiPar] = useState(""); // identifiant de la personne (liste de l'Espace admin)
  const [pin, setPin] = useState("");
  const [showActivation, setShowActivation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientMode, setClientMode] = useState("taxe"); // taxe | recherche | autre
  const [taxeClients, setTaxeClients] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);

  // Charge les clients Belleville avec taxe de séjour à régler depuis Hostaway :
  // un paiement espèces sert le plus souvent à encaisser une taxe impayée, donc
  // on pré-remplit la liste avec ces clients (et leur montant dû). L'option
  // "Autre client" reste dispo pour tout encaissement hors taxe / hors liste.
  useEffect(() => {
    (async () => {
      try {
        const acc = window.localStorage.getItem("hostaway_account") || "";
        const key = window.localStorage.getItem("hostaway_api_key") || "";
        if (!acc || !key) return;
        // Période large : du 10 juillet (départ fixe de l'onglet Taxes) à aujourd'hui
        const res = await fetch(`/api/tourist-tax?from=2026-07-10&to=${today}`, {
          headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
        });
        const d = await res.json();
        if (!res.ok) return;
        // On ne garde que Belleville avec une taxe due > 0 non entièrement réglée
        const bell = (d.items || []).filter(it =>
          it.residence === "Belleville" && Number(it.taxeSejour) > 0
        );
        setTaxeClients(bell);
      } catch { /* pas bloquant : saisie manuelle possible via "Autre client" */ }
    })();
  }, [today]);

  // Solde de départ : techniquement une "récupération" à 0 récupéré, dont le
  // reliquat laissé en caisse sert de base à tous les calculs suivants —
  // même mécanisme que le reliquat laissé après une vraie récupération.
  async function setStartingBalance(startDate, startAmount) {
    const amt = Number(startAmount);
    if (!amt || amt < 0) { setStatus("Montant de départ invalide."); return; }
    try {
      setStatus("Enregistrement du solde de départ…");
      await especesApi({ action: "solde_depart", date: startDate, montant: amt });
      setShowStartForm(false);
      await reload();
      setStatus(`Solde de départ de ${amt.toFixed(2)} € enregistré au ${startDate}.`);
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  // Recherche un client parmi TOUTES les réservations (peu importe leur statut
  // de paiement) — utile quand le paiement a déjà été marqué réglé dans
  // Hostaway, ce qui le fait disparaître de la liste "taxe impayée" ci-dessus
  // sans qu'il soit pour autant réglé en espèces dans notre app.
  async function runClientSearch(q) {
    setSearchQuery(q);
    setClient(""); setAppartement(""); setArrivalDate("");
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const acc = window.localStorage.getItem(ACCOUNT_KEY) || "";
      const key = window.localStorage.getItem(KEY_KEY) || "";
      if (!acc || !key) { setSearching(false); return; }
      const res = await fetch(`/api/reservation-search?q=${encodeURIComponent(q.trim())}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const d = await res.json();
      setSearchResults(res.ok ? (d.items || []) : []);
    } catch { setSearchResults([]); }
    setSearching(false);
  }

  async function addEntry() {
    if (!saisiPar) { setStatus("Choisis d'abord ton nom (réceptionniste)."); return; }
    if (!pin) { setStatus("Tape ton code personnel."); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setStatus("Montant invalide."); return; }
    const ligne = { type: mode, date, amount: amt, designation: designation || "" };
    if (mode === "client") Object.assign(ligne, { client: client || "", appartement: appartement || "", arrivalDate: arrivalDate || "" });
    else ligne.fournisseur = fournisseur || "";
    setBusy(true);
    try {
      setStatus("Enregistrement…");
      await especesApi({ action: "ajouter", personneId: saisiPar, pin, ligne });
      setClient(""); setAppartement(""); setArrivalDate(""); setDesignation(""); setFournisseur(""); setAmount(""); setPin("");
      await reload();
      setStatus("Enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
    setBusy(false);
  }

  // Suppression : réservée à l'admin (session de l'Espace admin vérifiée par le
  // serveur), motif obligatoire. La ligne n'est jamais effacée : elle est marquée
  // supprimée et reste visible dans l'historique complet.
  async function delEntry(entry) {
    if (!isAdmin) {
      setStatus("Suppression réservée à l'administrateur (connexion à l'Espace admin, onglet Codes d'accès).");
      return;
    }
    const motif = window.prompt(`Motif de la suppression de « ${entry.designation || entry.client || entry.fournisseur || "cette ligne"} » (${euros2(entry.amount)}) :`);
    if (motif === null) return;
    try {
      setStatus("Suppression…");
      await especesApi({ action: "supprimer", entryId: entry.id, motif });
      await reload();
      setStatus("Ligne marquée supprimée (elle reste dans l'historique complet).");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  function exportCurrentCSV() {
    const rows = [["Type", "Date", "Saisi par", "Client", "Appartement", "Date arrivée", "Fournisseur", "Désignation", "Montant"]];
    for (const e of unrecovered) {
      rows.push([
        e.type === "client" ? "Paiement client" : "Dépense",
        fmtFrShort(e.date), e.saisiPar || "", e.client || "", e.appartement || "",
        e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", e.fournisseur || "", e.designation || "", e.amount,
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

      {isAdmin && <div style={{ marginBottom: 14 }}>
        <button onClick={() => setShowStartForm(!showStartForm)} className="ghost">
          {showStartForm ? "Annuler" : (recoveries.length ? "Redéfinir le solde de départ" : "Définir un solde de départ")}
        </button>
      </div>}

      {showStartForm && (
        <StartingBalanceForm hasRecoveries={recoveries.length > 0} onConfirm={setStartingBalance} onCancel={() => setShowStartForm(false)} />
      )}

      <div className="linen-form">
        <div className={`linen-form-row recep-row${saisiPar && pin ? "" : " a-remplir"}`}>
          <label className="t-strong">Réceptionniste (obligatoire)
            <select value={saisiPar} onChange={e => { setSaisiPar(e.target.value); setPin(""); }}>
              <option value="">— Qui saisit ? —</option>
              {personnel.filter(p => p.codeChoisi).map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </label>
          <label className="t-strong">Code personnel
            <input type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={8}
              onChange={e => setPin(e.target.value.replace(/\D/g, ""))} style={{ width: 110 }} />
          </label>
          {!(saisiPar && pin) && <span className="pill warn">Nom et code demandés à chaque saisie</span>}
          <button type="button" onClick={() => setShowActivation(!showActivation)} className="ghost push-right">
            {showActivation ? "Fermer" : "Première utilisation"}
          </button>
        </div>
        {personnel.length === 0 && (
          <div className="msg warn">Aucun réceptionniste enregistré : l&apos;admin doit les créer dans Codes d&apos;accès &gt; Espace admin &gt; Espèces.</div>
        )}
        {showActivation && (
          <ActivationForm personnel={personnel} setStatus={setStatus}
            onDone={async () => { setShowActivation(false); await reloadPersonnel(); }} />
        )}
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
          <>
            <div className="linen-form-row">
              <label>Client
                <select value={clientMode} onChange={e => {
                  setClientMode(e.target.value);
                  setClient(""); setAppartement(""); setArrivalDate(""); setSearchQuery(""); setSearchResults([]);
                }}>
                  <option value="taxe">Client taxe de séjour (Belleville)</option>
                  <option value="recherche">Rechercher un client (toutes réservations)</option>
                  <option value="autre">Autre client (saisie manuelle)</option>
                </select>
              </label>

              {clientMode === "taxe" ? (
                <label style={{ minWidth: 300 }}>Client avec taxe à régler
                  <select
                    value={client}
                    onChange={e => {
                      const it = taxeClients.find(x => x.client === e.target.value);
                      setClient(e.target.value);
                      if (it) {
                        setAppartement(it.unitNumber || it.appartement || "");
                        setArrivalDate(it.arrivee || "");
                        setDesignation("Taxe de séjour");
                        if (it.taxeSejour) setAmount(String(it.taxeSejour));
                      }
                    }}
                  >
                    <option value="">— Choisir le client —</option>
                    {taxeClients.map((it, i) => (
                      <option key={i} value={it.client}>
                        {it.client} — {it.unitNumber || it.appartement} — {euros2(it.taxeSejour)}
                      </option>
                    ))}
                  </select>
                  {taxeClients.length === 0 && (
                    <span className="tx-help" style={{ fontSize: 11, color: "var(--warn)" }}>Aucun client taxe Belleville chargé (vérifie les identifiants Hostaway sur Fiches, ou utilise « Autre client »).</span>
                  )}
                </label>
              ) : clientMode === "recherche" ? (
                <label style={{ minWidth: 320, position: "relative" }}>Nom du client
                  <input type="text" value={client || searchQuery} onChange={e => runClientSearch(e.target.value)}
                    placeholder="Tape au moins 2 lettres du nom…" style={{ width: "100%" }} />
                  {searching && <span className="tx-help" style={{ fontSize: 11, color: "var(--muted)" }}>Recherche…</span>}
                  {!client && searchResults.length > 0 && (
                    <div className="tx-search-results" style={{ border: "1px solid #ddd", borderRadius: 6, marginTop: 4, maxHeight: 220, overflowY: "auto", background: "#fff", position: "absolute", width: "100%", zIndex: 5 }}>
                      {searchResults.map((r, i) => (
                        <div key={i} onClick={() => {
                          setClient(r.client); setAppartement(r.unitNumber || r.appartement || ""); setArrivalDate(r.arrivee || "");
                          setDesignation("Taxe de séjour"); setSearchResults([]);
                        }} className="tx-search-item" style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                          <strong>{r.client}</strong> — {r.residence} {r.appartement} ({r.unitNumber})
                          <div className="tx-help" style={{ fontSize: 11, color: "var(--muted)" }}>{fmtFr(r.arrivee)} → {fmtFr(r.depart)} · {r.channel}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {client && (
                    <div className="tx-help" style={{ fontSize: 11, color: "var(--ok)", marginTop: 4 }}>
                      {appartement} · {fmtFr(arrivalDate)}
                      {" "}<button type="button" onClick={() => { setClient(""); setSearchQuery(""); }} className="ghost tx-change" style={{ fontSize: 11 }}>changer</button>
                    </div>
                  )}
                </label>
              ) : (
                <>
                  <label>Nom du client <input type="text" value={client} onChange={e => setClient(e.target.value)} style={{ width: 180 }} /></label>
                  <label>Appartement <input type="text" value={appartement} onChange={e => setAppartement(e.target.value)} style={{ width: 130 }} /></label>
                  <label>Date arrivée <input type="date" value={arrivalDate} onChange={e => setArrivalDate(e.target.value)} /></label>
                </>
              )}
            </div>
            <div className="linen-form-row">
              <label>Désignation <input type="text" value={designation} onChange={e => setDesignation(e.target.value)} placeholder="taxe de séjour, autre vente…" style={{ width: 180 }} /></label>
              <label>Montant € <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 100 }} /></label>
            </div>
          </>
        ) : (
          <div className="linen-form-row">
            <label>Fournisseur (magasin) <input type="text" value={fournisseur} onChange={e => setFournisseur(e.target.value)} placeholder="ex. Leroy Merlin, Monoprix…" style={{ width: 200 }} /></label>
            <label>Raison de la dépense <input type="text" value={designation} onChange={e => setDesignation(e.target.value)} placeholder="ex. fournitures ménage, réparation serrure…" style={{ width: 240 }} /></label>
            <label>Montant € <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 100 }} /></label>
          </div>
        )}
        <button className="primary" onClick={addEntry} disabled={!saisiPar || !pin || busy}>{busy ? "Enregistrement…" : "Ajouter"}</button>
      </div>

      <div className="tx-btn-row" style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        <button onClick={exportCurrentCSV} disabled={!unrecovered.length}>Télécharger Excel (en cours)</button>
        <button className="primary" onClick={() => setShowRecoverForm(!showRecoverForm)} disabled={!unrecovered.length && !baseline}>
          {showRecoverForm ? "Annuler" : "Récupération des espèces"}
        </button>
      </div>

      {showRecoverForm && (
        <RecoverForm fs={fs} unrecovered={unrecovered} totalEnCaisse={totalEnCaisse}
          baseline={baseline} sumClient={sumClient} sumExpense={sumExpense}
          personnel={personnel} isAdmin={isAdmin}
          onDone={() => { setShowRecoverForm(false); reload(); }} setStatus={setStatus} />
      )}

      <div className="tbl-wrap"><table className="tbl tbl-cards" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Saisi par</th><th>Client</th><th>Appartement</th>
            <th>Fournisseur</th><th>Désignation</th><th className="c">Montant</th><th></th>
          </tr>
        </thead>
        <tbody>
          {unrecovered.map(e => (
            <tr key={e.id}>
              <td data-label="Date">{fmtFrShort(e.date)}</td>
              <td data-label="Type">{e.type === "client" ? <span className="pill ok">Client</span> : <span className="pill bad">Dépense</span>}</td>
              <td data-label="Saisi par">{e.saisiPar || "—"}</td>
              <td data-label="Client">{e.client || "—"}</td>
              <td data-label="Appartement">{e.appartement || "—"}</td>
              <td data-label="Fournisseur">{e.fournisseur || "—"}</td>
              <td className="card-title">{e.designation || "—"}</td>
              <td className="c" data-label="Montant" style={{ color: e.type === "expense" ? "var(--bad)" : "var(--ok)", fontWeight: 600 }}>
                {e.type === "expense" ? "−" : "+"}{euros2(e.amount)}
              </td>
              <td className="tx-actions">{isAdmin && <button onClick={() => delEntry(e)} className="ghost danger tx-del" title="Supprimer (admin, motif obligatoire)" aria-label="Supprimer">✕</button>}</td>
            </tr>
          ))}
          {unrecovered.length === 0 && <tr><td colSpan={9} className="empty-state">Rien depuis la dernière récupération.</td></tr>}
        </tbody>
      </table></div>
      <p className="note">
        Total en caisse = reliquat laissé à la dernière récupération ({euros2(baseline)}) + paiements clients ({euros2(sumClient)}) − dépenses ({euros2(sumExpense)}).
      </p>
    </>
  );
}

// ---- Première utilisation : la personne choisit elle-même son code personnel ----
// L'admin lui a remis un code d'activation à 6 chiffres (valable 7 jours). L'admin ne
// connaît donc jamais le code personnel : une saisie faite avec ce code engage la personne.
function ActivationForm({ personnel, setStatus, onDone }) {
  const [id, setId] = useState("");
  const [activation, setActivation] = useState("");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const enAttente = personnel.filter(p => p.activationEnAttente);
  async function valider() {
    if (pin1 !== pin2) { setStatus("Les deux codes personnels ne sont pas identiques."); return; }
    try {
      setStatus("Activation…");
      await especesApi({ action: "activer", personneId: id, activation, pin: pin1 });
      setStatus("Code personnel enregistré. Il sera demandé à chaque saisie : ne le communique à personne.");
      await onDone();
    } catch (err) { setStatus("Erreur : " + err.message); }
  }
  const digits = v => v.replace(/\D/g, "");
  return (
    <div className="panel">
      <div className="panel-title">Première utilisation : choisir mon code personnel</div>
      {enAttente.length === 0 ? <span className="note">Personne n&apos;a d&apos;activation en attente. Demande un code d&apos;activation à l&apos;admin.</span> : (
        <div className="panel-row">
          <label>Mon nom
            <select value={id} onChange={e => setId(e.target.value)}>
              <option value="">—</option>
              {enAttente.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </label>
          <label>Code d&apos;activation (6 chiffres)
            <input inputMode="numeric" autoComplete="off" maxLength={6} value={activation} onChange={e => setActivation(digits(e.target.value))} style={{ width: 100 }} />
          </label>
          <label>Nouveau code (4 à 8 chiffres)
            <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin1} onChange={e => setPin1(digits(e.target.value))} style={{ width: 100 }} />
          </label>
          <label>Confirmer
            <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin2} onChange={e => setPin2(digits(e.target.value))} style={{ width: 100 }} />
          </label>
          <button className="primary" onClick={valider} disabled={!id || activation.length !== 6 || pin1.length < 4}>Enregistrer mon code</button>
        </div>
      )}
    </div>
  );
}

// ---- Solde de départ (une seule fois, avant la première vraie récupération) ----
function StartingBalanceForm({ hasRecoveries, onConfirm, onCancel }) {
  const [startDate, setStartDate] = useState(isoDay(new Date()));
  const [startAmount, setStartAmount] = useState("");

  return (
    <div className="linen-form tone-info">
      {hasRecoveries && (
        <div className="msg warn">
          Attention : des récupérations existent déjà. Ce solde de départ créera une nouvelle entrée de base
          (la plus récente prévaut dans les calculs) — vérifie que c&apos;est bien ce que tu veux plutôt que de
          corriger une récupération existante.
        </div>
      )}
      <div className="linen-form-row">
        <label>Date <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
        <label>Montant de départ € <input type="number" min="0" step="0.01" value={startAmount} onChange={e => setStartAmount(e.target.value)} style={{ width: 120 }} /></label>
      </div>
      <div className="tx-btn-row" style={{ display: "flex", gap: 8 }}>
        <button className="primary" onClick={() => onConfirm(startDate, startAmount)}>Enregistrer le solde de départ</button>
        <button onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

// Excel de sauvegarde téléchargé juste avant une récupération : l'état de la
// caisse tel qu'il était avant que les entrées soient rattachées à la récupération.
// Lève une erreur si le fichier ne peut pas être généré.
async function downloadRecoveryXLSX({ unrecovered, baseline, sumClient, sumExpense, totalEnCaisse, rec, left, note }) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Espèces");
  ws.columns = [
    { header: "Type", key: "type", width: 16 },
    { header: "Date", key: "date", width: 12 },
    { header: "Saisi par", key: "saisiPar", width: 16 },
    { header: "Client", key: "client", width: 26 },
    { header: "Appartement", key: "appartement", width: 16 },
    { header: "Date arrivée", key: "arrivalDate", width: 13 },
    { header: "Fournisseur", key: "fournisseur", width: 20 },
    { header: "Désignation", key: "designation", width: 30 },
    { header: "Montant (€)", key: "amount", width: 13 },
  ];
  ws.getRow(1).font = { bold: true };
  const sorted = [...unrecovered].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  for (const e of sorted) {
    ws.addRow({
      type: e.type === "client" ? "Paiement client" : "Dépense",
      date: fmtFrShort(e.date), saisiPar: e.saisiPar || "", client: e.client || "", appartement: e.appartement || "",
      arrivalDate: e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", fournisseur: e.fournisseur || "",
      designation: e.designation || "", amount: Number(e.amount) || 0,
    });
  }
  ws.addRow([]);
  const now = new Date();
  const resume = [
    ["Reliquat de la dernière récupération", baseline],
    ["Total paiements clients", sumClient],
    ["Total dépenses", sumExpense],
    ["Total en caisse avant récupération", totalEnCaisse],
    ["Montant récupéré", rec],
    ["Laissé en caisse", left],
  ];
  for (const [label, value] of resume) {
    const r = ws.addRow({ type: label, amount: Math.round((Number(value) || 0) * 100) / 100 });
    r.font = { bold: true };
  }
  if (note) ws.addRow({ type: "Note", client: note });
  ws.addRow({ type: "Exporté le", client: now.toLocaleString("fr-FR") });
  ws.getColumn("amount").numFmt = "#,##0.00";

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const hh = String(now.getHours()).padStart(2, "0"), mm = String(now.getMinutes()).padStart(2, "0");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `recuperation_especes_${isoDay(now)}_${hh}h${mm}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- Formulaire de récupération : clôture les entrées en cours ----
// Faite par l'admin (session Espace admin) ou par un réceptionniste avec son code
// personnel : l'auteur est enregistré dans le journal.
function RecoverForm({ unrecovered, totalEnCaisse, baseline, sumClient, sumExpense, onDone, setStatus, personnel, isAdmin }) {
  const [amountRecovered, setAmountRecovered] = useState("");
  const [note, setNote] = useState("");
  const [qui, setQui] = useState(isAdmin ? "admin" : "");
  const [pin, setPin] = useState("");

  useEffect(() => {
    setAmountRecovered(totalEnCaisse.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rec = Number(amountRecovered) || 0;
  // Laissé en caisse = automatique, jamais saisi à la main : ce qui reste une fois
  // le montant récupéré soustrait du total (le total intègre déjà les dépenses,
  // puisque totalEnCaisse = reliquat + paiements clients - dépenses).
  const left = Math.max(0, Math.round((totalEnCaisse - rec) * 100) / 100);
  const montantValide = rec >= 0 && rec <= totalEnCaisse + 0.001;
  const totalPositif = totalEnCaisse > 0;
  const peutValider = montantValide && totalPositif;

  async function confirmRecovery() {
    if (!totalPositif) { setStatus("La caisse est vide ou négative, rien à récupérer."); return; }
    if (!montantValide) { setStatus("Le montant récupéré ne peut pas dépasser le total en caisse."); return; }
    if (!qui || (qui !== "admin" && !pin)) { setStatus("Indique qui récupère (nom et code personnel)."); return; }
    // Sauvegarde Excel d'abord : si elle échoue, rien n'est modifié.
    try {
      setStatus("Téléchargement de l'Excel de sauvegarde…");
      await downloadRecoveryXLSX({ unrecovered, baseline, sumClient, sumExpense, totalEnCaisse, rec, left, note });
    } catch (err) {
      setStatus("Récupération annulée : l'Excel de sauvegarde n'a pas pu être généré (" + err.message + "). Rien n'a été modifié.");
      return;
    }
    try {
      setStatus("Enregistrement de la récupération…");
      const body = { action: "recuperer", montant: rec, note: note || "", entryIds: unrecovered.map(e => e.id) };
      if (qui !== "admin") Object.assign(body, { personneId: qui, pin });
      const d = await especesApi(body);
      setStatus(`Récupération enregistrée : ${euros2(d.recuperation.amountRecovered)} récupérés, ${euros2(d.recuperation.amountLeftInBox)} laissés en caisse.`);
      onDone();
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  return (
    <div className="linen-form tone-ok">
      <div className="linen-form-row">
        <div style={{ fontSize: 13 }}><strong>Total en caisse à répartir : {euros2(totalEnCaisse)}</strong></div>
      </div>
      <div className="linen-form-row">
        <label>Montant récupéré € <input type="number" step="0.01" min="0" max={totalEnCaisse} value={amountRecovered} onChange={e => setAmountRecovered(e.target.value)} style={{ width: 110 }} /></label>
        <label>Laissé en caisse €
          <input type="text" value={euros2(left)} disabled style={{ width: 110 }} />
        </label>
        <label style={{ flex: 1 }}>Note <input type="text" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%" }} /></label>
      </div>
      <div className="linen-form-row">
        <label>Récupéré par
          <select value={qui} onChange={e => { setQui(e.target.value); setPin(""); }}>
            <option value="">—</option>
            {isAdmin && <option value="admin">Admin (session Espace admin)</option>}
            {personnel.filter(p => p.codeChoisi).map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
        </label>
        {qui && qui !== "admin" && (
          <label>Code personnel
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} style={{ width: 110 }} />
          </label>
        )}
      </div>
      {!montantValide && <div className="msg bad">Le montant récupéré ne peut pas dépasser le total en caisse ({euros2(totalEnCaisse)}).</div>}
      <button className="primary" onClick={confirmRecovery} disabled={!peutValider}>Confirmer la récupération</button>
    </div>
  );
}

// ---- Historique des récupérations + historique complet (lignes supprimées incluses) ----
function CashHistory({ recoveries, entries, isAdmin, reload, setStatus }) {
  const actives = recoveries.filter(r => !r.deleted);
  const annulees = recoveries.filter(r => r.deleted);
  const supprimees = entries.filter(e => e.deleted);

  function exportRecoveryCSV(rec) {
    const linked = entries.filter(e => e.recoveryId === rec.id && !e.deleted);
    const rows = [["Type", "Date", "Saisi par", "Client", "Appartement", "Date arrivée", "Fournisseur", "Désignation", "Montant"]];
    for (const e of linked) {
      rows.push([
        e.type === "client" ? "Paiement client" : "Dépense",
        fmtFrShort(e.date), e.saisiPar || "", e.client || "", e.appartement || "",
        e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", e.fournisseur || "", e.designation || "", e.amount,
      ]);
    }
    rows.push([]);
    rows.push(["Récupéré", "", "", "", "", "", "", "", rec.amountRecovered]);
    rows.push(["Laissé en caisse", "", "", "", "", "", "", "", rec.amountLeftInBox]);
    downloadEntriesCSV(`recuperation_especes_${rec.date}.csv`, rows);
  }

  // Toutes les lignes jamais saisies, y compris celles marquées supprimées, avec leur
  // statut, leur auteur et le motif de suppression.
  function exportHistoriqueComplet() {
    const rows = [["Identifiant", "Statut", "Type", "Date", "Saisi par", "Client", "Appartement", "Date arrivée",
      "Fournisseur", "Désignation", "Montant", "Créée le", "Journalisée", "Récupération", "Supprimée le", "Supprimée par", "Motif de suppression"]];
    const tri = [...entries].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    for (const e of tri) {
      rows.push([
        e.id, e.deleted ? "SUPPRIMÉE" : (e.recoveryId ? "Récupérée" : "En cours"),
        e.type === "client" ? "Paiement client" : "Dépense", fmtFrShort(e.date), e.saisiPar || "",
        e.client || "", e.appartement || "", e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", e.fournisseur || "",
        e.designation || "", e.amount, e.createdAt || "", e.journalise ? "oui" : "non (avant le journal)",
        e.recoveryId || "", e.deletedAt || "", e.deletedBy || "", e.deleteReason || "",
      ]);
    }
    rows.push([]);
    rows.push(["Récupérations"]);
    rows.push(["Identifiant", "Statut", "Date", "Total avant", "Récupéré", "Laissé en caisse", "Note", "Faite par", "Créée le", "Annulée le", "Motif d'annulation"]);
    for (const r of recoveries) {
      rows.push([r.id, r.deleted ? "ANNULÉE" : "Valide", fmtFrShort(r.date), r.totalAvant, r.amountRecovered, r.amountLeftInBox,
        r.note || "", r.faitPar || "", r.createdAt || "", r.deletedAt || "", r.deleteReason || ""]);
    }
    downloadEntriesCSV(`especes_historique_complet_${isoDay(new Date())}.csv`, rows);
  }

  // Annule une récupération (admin, motif obligatoire) : elle reste en base, marquée
  // annulée, et ses lignes redeviennent « en cours ».
  async function delRecovery(rec) {
    const motif = window.prompt(`Motif de l'annulation de « ${rec.note || "récupération"} » du ${fmtFrShort(rec.date)} :`);
    if (motif === null) return;
    try {
      setStatus("Annulation…");
      await especesApi({ action: "annuler_recuperation", recoveryId: rec.id, motif });
      await reload();
      setStatus("Récupération annulée (elle reste visible dans l'historique complet).");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Historique des récupérations</div>
          <div className="recap-sub">Chaque récupération est exportable individuellement</div>
        </div>
        <button onClick={exportHistoriqueComplet}>📥 Historique complet (lignes supprimées incluses)</button>
      </div>
      <div className="tbl-wrap"><table className="tbl tbl-cards">
        <thead>
          <tr>
            <th>Date</th><th className="c">Total avant</th><th className="c">Récupéré</th>
            <th className="c">Laissé en caisse</th><th>Note</th><th></th>
          </tr>
        </thead>
        <tbody>
          {actives.map(r => (
            <tr key={r.id}>
              <td className="card-title">{fmtFrShort(r.date)}</td>
              <td className="c" data-label="Total avant">{euros2(r.totalAvant)}</td>
              <td className="c" data-label="Récupéré" style={{ fontWeight: 700, color: "var(--ok)" }}>{euros2(r.amountRecovered)}</td>
              <td className="c" data-label="Laissé en caisse">{euros2(r.amountLeftInBox)}</td>
              <td data-label="Note" className="card-full">{r.note || "—"}{r.faitPar ? ` · par ${r.faitPar}` : ""}</td>
              <td className="tx-actions" style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => exportRecoveryCSV(r)} className="ghost" style={{ color: "var(--ok)" }}>📥 Excel</button>
                {isAdmin && <button onClick={() => delRecovery(r)} className="ghost danger tx-del" title="Annuler (admin, motif obligatoire)" aria-label="Annuler">✕</button>}
              </td>
            </tr>
          ))}
          {actives.length === 0 && <tr><td colSpan={6} className="empty-state">Aucune récupération enregistrée.</td></tr>}
        </tbody>
      </table></div>

      {(supprimees.length > 0 || annulees.length > 0) && (
        <>
          <div className="recap-title" style={{ marginTop: 20 }}>Lignes supprimées et récupérations annulées</div>
          <div className="tbl-wrap"><table className="tbl tbl-cards">
            <thead><tr><th>Supprimée le</th><th>Quoi</th><th>Saisi par</th><th className="c">Montant</th><th>Motif</th></tr></thead>
            <tbody>
              {[...supprimees.map(e => ({ k: e.id, at: e.deletedAt, quoi: `${e.type === "client" ? "Paiement client" : "Dépense"} du ${fmtFrShort(e.date)} : ${e.client || e.fournisseur || ""} ${e.designation || ""}`, qui: e.saisiPar, m: e.amount, motif: e.deleteReason })),
                ...annulees.map(r => ({ k: r.id, at: r.deletedAt, quoi: `Récupération du ${fmtFrShort(r.date)}`, qui: r.faitPar, m: r.amountRecovered, motif: r.deleteReason }))]
                .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
                .map(x => (
                  <tr key={x.k}>
                    <td data-label="Supprimée le">{x.at ? new Date(x.at).toLocaleString("fr-FR") : "—"}</td>
                    <td className="card-title">{x.quoi}</td>
                    <td data-label="Saisi par">{x.qui || "—"}</td>
                    <td className="c" data-label="Montant">{euros2(x.m)}</td>
                    <td data-label="Motif" className="card-full">{x.motif || "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table></div>
        </>
      )}
    </>
  );
}

export default function TaxesPage() {
  const [subtab, setSubtab] = useState("impayees");
  return (
    <div className="taxes-page">
      <div className="toolbar" style={{ paddingBottom: 0 }}>
        <div className="quick tabs">
          <button onClick={() => setSubtab("impayees")} className={subtab === "impayees" ? "primary" : ""}>Taxes impayées</button>
          <button onClick={() => setSubtab("especes")} className={subtab === "especes" ? "primary" : ""}>Gestion des espèces</button>
        </div>
      </div>
      {subtab === "impayees" && <TaxesImpayees />}
      {subtab === "especes" && <CashManagement />}
    </div>
  );
}
