// pages/taxes.js
import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import CodeModal from "../components/CodeModal";
import { useCodeGate } from "../hooks/useCodeGate";
import { useInterrupteur5h } from "../hooks/useEcheance";
import { listStaff, ensureStaff, deleteStaff, getCurrentStaff, setCurrentStaff } from "../lib/staff";
import { controlerCaisse, etatCaisse, jourParis } from "../lib/especesControle";
import { ajouterLigne, supprimerLigne, recuperer, annulerRecuperation, soldeDepart, nouvelleCle } from "../lib/especesEcritures";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

// Jour à Paris (et non en UTC : entre minuit et 1 h, toISOString donnait la veille).
function isoDay(d) { return jourParis(d); }
function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
function euros(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// Code demandé avant de masquer une taxe impayée et, côté espèces, avant toute
// suppression (avec motif), récupération, annulation ou solde de départ. Ce n'est pas une
// vraie sécurité (comparaison faite dans le navigateur) — juste un frein
// volontaire contre une action accidentelle ou par une personne non autorisée
// à qui l'accès à l'app a été partagé. Changeable via NEXT_PUBLIC_DELETE_PASSWORD
// sur Vercel.
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
// Écritures : lib/especesEcritures.js (transactions, rien n'est plus effacé).
// Contrôle de caisse : lib/especesControle.js, recalculé à chaque affichage.
function CashManagement() {
  const { requestCode, codeModalProps } = useCodeGate(DELETE_PASSWORD, "Code requis");
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [fs, setFs] = useState(null);
  const [entries, setEntries] = useState([]);
  const [recoveries, setRecoveries] = useState([]);
  const [status, setStatus] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showRecoverForm, setShowRecoverForm] = useState(false);
  const [majLe, setMajLe] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { isFirebaseConfigured } = await import("../lib/firebase");
        if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
        const { db } = await import("../lib/firebase");
        const { collection, doc, getDocs, query, orderBy, setDoc, deleteDoc, runTransaction } = await import("firebase/firestore");
        const api = { db, collection, doc, getDocs, query, orderBy, setDoc, deleteDoc, runTransaction };
        setFs(api);
        await loadAll(api);
      } catch (err) {
        setLoadError(err.message || String(err));
      }
      setReady(true);
    })();
  }, []);

  async function loadAll(api) {
    // Lecture sans tri Firestore : orderBy écarte les documents sans le champ trié.
    const [eSnap, rSnap] = await Promise.all([
      api.getDocs(api.collection(api.db, "cash_entries")),
      api.getDocs(api.collection(api.db, "cash_recoveries")),
    ]);
    const parDate = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    setEntries(eSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort(parDate));
    setRecoveries(rSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    setMajLe(new Date());
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state" aria-busy="true">Chargement de la caisse…</div></div></div>;
  if (!configured) {
    return (
      <div className="menage-page"><div className="recap">
        <div className="recap-title">Configuration Firebase requise</div>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
      </div></div>
    );
  }
  if (loadError) {
    return (
      <div className="menage-page"><div className="recap">
        <div className="msg bad" role="alert">Impossible de lire la caisse : {loadError}. Rechargez la page ; si l&apos;erreur revient, ne saisissez rien et prévenez l&apos;admin.</div>
      </div></div>
    );
  }

  // Rien n'est plus jamais effacé : les lignes et récupérations supprimées restent en
  // base (deleted = true) et sont écartées ici des calculs.
  const activeEntries = entries.filter(e => !e.deleted);
  const activeRecoveries = recoveries.filter(r => !r.deleted);
  const etat = etatCaisse(entries, recoveries);
  const unrecovered = etat.enCours;
  const controle = controlerCaisse(entries, recoveries);
  const reload = async () => { await loadAll(fs); };

  return (
    <>
      <Head><title>Gestion des espèces</title></Head>
      <div className="toolbar">
        <h1>Gestion des espèces</h1>
        <span className="status" role="status">{status}</span>
        <button onClick={() => setShowHistory(!showHistory)}>{showHistory ? "← Caisse en cours" : "Historique des récupérations →"}</button>
      </div>

      <div className="menage-page">
        <div className="recap esp">
          {!showHistory ? (
            <CashCurrent
              fs={fs} requestCode={requestCode}
              entries={activeEntries} unrecovered={unrecovered} recoveries={activeRecoveries}
              etat={etat} controle={controle} majLe={majLe}
              showRecoverForm={showRecoverForm} setShowRecoverForm={setShowRecoverForm}
              reload={reload} setStatus={setStatus}
            />
          ) : (
            <CashHistory fs={fs} requestCode={requestCode} recoveries={recoveries} entries={entries} reload={reload} setStatus={setStatus} />
          )}
        </div>
      </div>
      <CodeModal {...codeModalProps} />
    </>
  );
}

function fmtFrShort(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
function fmtJour(d) {
  if (!d) return "Sans date";
  const x = new Date(d + "T12:00:00");
  if (isNaN(x)) return d;
  const s = x.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function heureParis(iso) {
  return iso ? new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "";
}
function euros2(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
// Montant tapé « 12,50 » ou « 12.50 » : arrondi au centime.
function lireMontant(v) {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const normNom = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

function downloadEntriesCSV(filename, rows) {
  // Montants en virgule décimale : Excel français les lit comme des nombres.
  const cell = c => (typeof c === "number" ? String(c).replace(".", ",") : String(c ?? ""));
  const csv = rows.map(r => r.map(c => `"${cell(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const NIVEAUX = { grave: { cls: "bad", lib: "À traiter" }, attention: { cls: "warn", lib: "À vérifier" }, info: { cls: "info", lib: "Pour info" } };

// ---- Contrôle de caisse : recalcul indépendant à chaque affichage (lib/especesControle.js) ----
function ControleCaisse({ controle }) {
  const [ouvert, setOuvert] = useState(false);
  const an = controle.anomalies;
  const graves = an.filter(a => a.niveau === "grave").length;
  const attention = an.filter(a => a.niveau === "attention").length;
  const ton = graves ? "bad" : attention ? "warn" : "ok";
  const titre = graves ? `${graves} point(s) à traiter` : attention ? `${attention} point(s) à vérifier` : "Caisse cohérente";
  return (
    <section className={`esp-controle tone-${ton}`} aria-label="Contrôle de caisse">
      <div className="esp-controle-head">
        <span className={`esp-dot ${ton}`} aria-hidden="true" />
        <div>
          <strong>Contrôle de caisse : {titre}</strong>
          <div className="esp-muted">
            Total recalculé à partir de toutes les récupérations et de toutes les lignes, doublons, dates et lignes écrites hors application.
            {an.length > 0 && !graves && !attention && " Rien d'anormal, seulement des informations."}
          </div>
        </div>
        {an.length > 0 && (
          <button type="button" className="ghost push-right" aria-expanded={ouvert} onClick={() => setOuvert(o => !o)}>
            {ouvert ? "Masquer le détail" : `Voir le détail (${an.length})`}
          </button>
        )}
      </div>
      {ouvert && (
        <ul className="esp-anomalies">
          {an.map((a, i) => (
            <li key={i}>
              <span className={`pill ${NIVEAUX[a.niveau].cls}`}>{NIVEAUX[a.niveau].lib}</span>
              <div><strong>{a.titre}</strong><div className="esp-muted">{a.detail}</div></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Vue courante : chiffres clés, saisie, opérations depuis la dernière récupération ----
function CashCurrent({ fs, requestCode, entries, unrecovered, recoveries, etat, controle, majLe, showRecoverForm, setShowRecoverForm, reload, setStatus }) {
  const today = jourParis();
  const [mode, setMode] = useState("client"); // client | expense
  const [date, setDate] = useState(today);
  const [client, setClient] = useState("");
  const [appartement, setAppartement] = useState("");
  const [arrivalDate, setArrivalDate] = useState("");
  const [reservationId, setReservationId] = useState("");
  const [designation, setDesignation] = useState("");
  const [fournisseur, setFournisseur] = useState("");
  const [amount, setAmount] = useState("");
  const [saisiPar, setSaisiPar] = useState("");
  const [staffList, setStaffList] = useState([]);
  const [staffAdmin, setStaffAdmin] = useInterrupteur5h(); // se referme seul 5 h après le code
  const [newStaffName, setNewStaffName] = useState("");
  const [busy, setBusy] = useState(false);
  const [cle, setCle] = useState("");
  const [confirmeDoublon, setConfirmeDoublon] = useState(false);
  const [retour, setRetour] = useState(null); // { ton, texte } affiché sous le bouton
  const [clientMode, setClientMode] = useState("taxe"); // taxe | recherche | autre
  const [taxeClients, setTaxeClients] = useState([]);
  const [taxeEtat, setTaxeEtat] = useState("chargement"); // chargement | ok | indisponible
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);

  useEffect(() => { setCle(nouvelleCle()); }, []);

  // Réceptionnistes : liste partagée avec la Check-list (Firestore « staff_members »).
  // Le dernier nom choisi sur cet appareil est proposé d'office.
  useEffect(() => {
    (async () => {
      try {
        const liste = await listStaff(fs);
        setStaffList(liste);
        const moi = getCurrentStaff();
        if (moi && liste.includes(moi)) setSaisiPar(moi);
      } catch { /* collection pas encore créée */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choisirMoi(nom) { setSaisiPar(nom); setCurrentStaff(nom); }

  function toggleStaffAdmin() {
    if (staffAdmin) { setStaffAdmin(false); return; }
    requestCode(() => setStaffAdmin(true));
  }

  async function addStaffName() {
    const name = newStaffName.trim();
    if (!name) return;
    try {
      await ensureStaff(fs, name);
      setNewStaffName("");
      setStaffList(await listStaff(fs));
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function removeStaffName(name) {
    if (!window.confirm(`Retirer « ${name} » de la liste des réceptionnistes ?`)) return;
    try {
      await deleteStaff(fs, name);
      if (saisiPar === name) setSaisiPar("");
      setStaffList(await listStaff(fs));
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  // Clients Belleville avec une taxe de séjour à régler (Hostaway) : un paiement en
  // espèces sert le plus souvent à encaisser cette taxe.
  useEffect(() => {
    (async () => {
      try {
        const acc = window.localStorage.getItem(ACCOUNT_KEY) || "";
        const key = window.localStorage.getItem(KEY_KEY) || "";
        if (!acc || !key) { setTaxeEtat("indisponible"); return; }
        const res = await fetch(`/api/tourist-tax?from=2026-07-10&to=${today}`, {
          headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
        });
        const d = await res.json();
        if (!res.ok) { setTaxeEtat("indisponible"); return; }
        setTaxeClients((d.items || []).filter(it => it.residence === "Belleville" && Number(it.taxeSejour) > 0));
        setTaxeEtat("ok");
      } catch { setTaxeEtat("indisponible"); }
    })();
  }, [today]);

  function viderFormulaire() {
    setClient(""); setAppartement(""); setArrivalDate(""); setReservationId(""); setDesignation("");
    setFournisseur(""); setAmount(""); setSearchQuery(""); setSearchResults([]);
    setConfirmeDoublon(false); setDate(jourParis()); setCle(nouvelleCle());
  }

  function choisirReservation(it) {
    setClient(it.client || "");
    setAppartement(it.unitNumber || it.appartement || "");
    setArrivalDate(it.arrivee || "");
    setReservationId(String(it.reservation || ""));
    setConfirmeDoublon(false);
  }

  function setStartingBalance(startDate, startAmount) {
    const amt = lireMontant(startAmount);
    if (!(amt > 0)) { setStatus("Montant de départ invalide."); return; }
    requestCode(async () => {
      try {
        setStatus("Enregistrement du solde de départ…");
        await soldeDepart(fs, { date: startDate, montant: amt, recups: recoveries });
        setShowStartForm(false);
        await reload();
        setStatus(`Solde de départ de ${euros2(amt)} enregistré au ${fmtFrShort(startDate)}.`);
      } catch (err) { setStatus("Erreur : " + err.message); }
    });
  }

  // Recherche parmi toutes les réservations (quel que soit le statut de paiement).
  async function runClientSearch(q) {
    setSearchQuery(q);
    setClient(""); setAppartement(""); setArrivalDate(""); setReservationId("");
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

  const amt = lireMontant(amount);
  const ecartDate = date ? Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(date + "T12:00:00Z")) / 86400000) : 0;

  // Même paiement déjà saisi ? Même réservation Hostaway, ou même client + appartement +
  // montant (deux réservations d'un même client restent distinctes).
  const doublon = mode === "client" && normNom(client) ? entries.find(e => e.type === "client" && (
    (reservationId && e.reservationId && e.reservationId === reservationId && normNom(e.designation) === normNom(designation))
    || (normNom(e.client) === normNom(client) && normNom(e.appartement) === normNom(appartement)
      && Math.abs((Number(e.amount) || 0) - amt) < 0.005 && (e.arrivalDate || "") === (arrivalDate || ""))
  )) : null;

  const manque = [];
  if (!(amt > 0)) manque.push("le montant");
  if (!date) manque.push("la date");
  if (mode === "client" && !client.trim()) manque.push("le client");
  if (mode === "expense" && !designation.trim()) manque.push("la raison de la dépense");
  if (!saisiPar) manque.push("ton nom");
  const bloqueDoublon = Boolean(doublon) && !confirmeDoublon;
  const peutEnregistrer = manque.length === 0 && !bloqueDoublon && !busy && ecartDate >= 0;

  async function addEntry() {
    if (!peutEnregistrer) return;
    const ligne = { type: mode, date, amount: amt, designation: designation.trim(), saisiPar };
    if (mode === "client") Object.assign(ligne, { client: client.trim(), appartement: appartement.trim(), arrivalDate: arrivalDate || "", reservationId });
    else ligne.fournisseur = fournisseur.trim();
    const qui = saisiPar;
    setBusy(true); setRetour(null);
    try {
      const d = await ajouterLigne(fs, ligne, cle);
      viderFormulaire();
      await reload();
      const quoi = mode === "client" ? `${ligne.designation || "Paiement"} de ${ligne.client}` : `Dépense ${ligne.fournisseur ? ligne.fournisseur + " " : ""}(${ligne.designation})`;
      setRetour({ ton: "ok", texte: `${d.dejaEnregistree ? "Déjà enregistrée" : "Enregistré"} : ${quoi}, ${euros2(ligne.amount)}, par ${qui}.` });
    } catch (err) {
      // La clé d'envoi est conservée : renvoyer le formulaire ne créera pas de doublon.
      setRetour({ ton: "bad", texte: "Pas enregistré : " + err.message });
    }
    setBusy(false);
  }

  // Suppression : code admin + motif ; la ligne reste en base, marquée supprimée.
  function delEntry(entry) {
    const motif = window.prompt(`Motif de la suppression de « ${entry.designation || entry.client || entry.fournisseur || "cette ligne"} » (${euros2(entry.amount)}) :`);
    if (motif === null) return;
    if (motif.trim().length < 5) { setStatus("Suppression annulée : motif obligatoire (au moins 5 caractères)."); return; }
    requestCode(async () => {
      try {
        setStatus("Suppression…");
        await supprimerLigne(fs, entry.id, motif);
        await reload();
        setStatus("Ligne marquée supprimée (elle reste dans l'historique complet).");
      } catch (err) { setStatus("Erreur : " + err.message); }
    });
  }

  function exportCurrentCSV() {
    const rows = [["Type", "Date", "Saisi le", "Saisi par", "Client", "Appartement", "Date arrivée", "Fournisseur", "Désignation", "Montant"]];
    for (const e of unrecovered) {
      rows.push([
        e.type === "client" ? "Paiement client" : "Dépense",
        fmtFrShort(e.date), e.createdAt ? new Date(e.createdAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "",
        e.saisiPar || "", e.client || "", e.appartement || "",
        e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", e.fournisseur || "", e.designation || "", Number(e.amount) || 0,
      ]);
    }
    rows.push([]);
    rows.push(["Reliquat de la dernière récupération", "", "", "", "", "", "", "", "", etat.baseline]);
    rows.push(["Total en caisse", "", "", "", "", "", "", "", "", etat.total]);
    downloadEntriesCSV(`especes_en_cours_${today}.csv`, rows);
  }

  // Lignes signalées par le contrôle, pour les repérer dans le tableau.
  const signalees = new Map();
  for (const a of controle.anomalies) for (const id of a.ids || []) if (!signalees.has(id) || a.niveau === "grave") signalees.set(id, a);

  // Regroupement par jour (date de l'opération), le plus récent en haut.
  const jours = [];
  for (const e of unrecovered) {
    let j = jours[jours.length - 1];
    if (!j || j.date !== e.date) { j = { date: e.date, lignes: [], net: 0 }; jours.push(j); }
    j.lignes.push(e);
    j.net += (e.type === "expense" ? -1 : 1) * (Number(e.amount) || 0);
  }
  const nbClient = unrecovered.filter(e => e.type === "client").length;
  const nbDep = unrecovered.length - nbClient;
  const derniere = etat.derniere;

  return (
    <>
      <div className="esp-kpis">
        <div className="esp-kpi esp-kpi-main">
          <div className="l">En caisse</div>
          <div className={`n${etat.total < 0 ? " neg" : ""}`}>{euros2(etat.total)}</div>
          <div className="s">{majLe ? `calculé à ${heureParis(majLe.toISOString())}` : ""} <button type="button" className="ghost esp-mini" onClick={reload}>Actualiser</button></div>
        </div>
        <div className="esp-kpi">
          <div className="l">Laissé à la dernière récupération</div>
          <div className="n">{euros2(etat.baseline)}</div>
          <div className="s">{derniere ? `${fmtFrShort(derniere.date)}${derniere.faitPar ? ` · ${derniere.faitPar}` : ""}` : "aucune récupération"}</div>
        </div>
        <div className="esp-kpi">
          <div className="l">Encaissé depuis</div>
          <div className="n ok">+{euros2(etat.sumClient)}</div>
          <div className="s">{nbClient} paiement(s) client</div>
        </div>
        <div className="esp-kpi">
          <div className="l">Dépensé depuis</div>
          <div className="n bad">−{euros2(etat.sumExpense)}</div>
          <div className="s">{nbDep} dépense(s)</div>
        </div>
      </div>

      <ControleCaisse controle={controle} />

      <div className="esp-grid">
        <section className="esp-card esp-form" aria-labelledby="esp-form-titre">
          <h2 id="esp-form-titre">Nouvelle opération</h2>
          <div className="esp-seg" role="radiogroup" aria-label="Type d'opération">
            <button type="button" role="radio" aria-checked={mode === "client"} className={mode === "client" ? "on ok" : ""} onClick={() => { setMode("client"); setConfirmeDoublon(false); }}>+ Encaissement client</button>
            <button type="button" role="radio" aria-checked={mode === "expense"} className={mode === "expense" ? "on bad" : ""} onClick={() => { setMode("expense"); setConfirmeDoublon(false); }}>− Dépense hôtel</button>
          </div>

          {mode === "client" ? (
            <>
              <label className="esp-field">Client
                <select value={clientMode} onChange={e => {
                  setClientMode(e.target.value);
                  setClient(""); setAppartement(""); setArrivalDate(""); setReservationId(""); setSearchQuery(""); setSearchResults([]);
                }}>
                  <option value="taxe">Taxe de séjour à régler (Belleville)</option>
                  <option value="recherche">Rechercher dans toutes les réservations</option>
                  <option value="autre">Autre client (saisie manuelle)</option>
                </select>
              </label>

              {clientMode === "taxe" && (
                <label className="esp-field">Réservation
                  <select value={reservationId ? String(taxeClients.findIndex(x => String(x.reservation || "") === reservationId)) : ""}
                    onChange={e => {
                      const it = taxeClients[Number(e.target.value)];
                      if (!it) { setClient(""); setReservationId(""); return; }
                      choisirReservation(it);
                      setDesignation("Taxe de séjour");
                      if (it.taxeSejour) setAmount(String(it.taxeSejour).replace(".", ","));
                    }}>
                    <option value="">{taxeEtat === "chargement" ? "Chargement des réservations…" : "— Choisir le client —"}</option>
                    {taxeClients.map((it, i) => (
                      <option key={i} value={i}>{it.client} · appart {it.unitNumber || it.appartement} · arrivée {fmtFr(it.arrivee)} · {euros2(it.taxeSejour)}</option>
                    ))}
                  </select>
                  {taxeEtat === "indisponible" && <span className="esp-help warn">Liste Hostaway indisponible (identifiants à vérifier sur Fiches). Utilise « Autre client ».</span>}
                  {taxeEtat === "ok" && taxeClients.length === 0 && <span className="esp-help">Aucune taxe à régler à Belleville.</span>}
                </label>
              )}

              {clientMode === "recherche" && (
                <label className="esp-field esp-search">Nom du client
                  <input type="text" value={client || searchQuery} onChange={e => runClientSearch(e.target.value)} placeholder="Au moins 2 lettres du nom" />
                  {searching && <span className="esp-help">Recherche…</span>}
                  {!client && searchResults.length > 0 && (
                    <ul className="esp-results" role="listbox">
                      {searchResults.map((r, i) => (
                        <li key={i} role="option" aria-selected="false" tabIndex={0}
                          onClick={() => { choisirReservation(r); setDesignation(d => d || "Taxe de séjour"); setSearchResults([]); }}
                          onKeyDown={ev => { if (ev.key === "Enter") { choisirReservation(r); setDesignation(d => d || "Taxe de séjour"); setSearchResults([]); } }}>
                          <strong>{r.client}</strong> · {r.residence} {r.appartement} ({r.unitNumber})
                          <span className="esp-muted">{fmtFr(r.arrivee)} → {fmtFr(r.depart)} · {r.channel}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {client && (
                    <span className="esp-help ok">Appart {appartement || "—"} · arrivée {fmtFr(arrivalDate) || "—"} <button type="button" onClick={() => { setClient(""); setSearchQuery(""); setReservationId(""); }} className="ghost esp-mini">changer</button></span>
                  )}
                </label>
              )}

              {clientMode === "autre" && (
                <div className="esp-row esp-row-client">
                  <label className="esp-field">Nom du client <input type="text" value={client} onChange={e => setClient(e.target.value)} /></label>
                  <label className="esp-field esp-w-s">Appartement <input type="text" value={appartement} onChange={e => setAppartement(e.target.value)} /></label>
                  <label className="esp-field esp-w-s">Arrivée <input type="date" value={arrivalDate} onChange={e => setArrivalDate(e.target.value)} /></label>
                </div>
              )}

              <label className="esp-field">Désignation <input type="text" value={designation} onChange={e => setDesignation(e.target.value)} placeholder="Taxe de séjour, nuit supplémentaire…" /></label>
            </>
          ) : (
            <>
              <label className="esp-field">Raison de la dépense <input type="text" value={designation} onChange={e => setDesignation(e.target.value)} placeholder="ex. fournitures ménage, réparation serrure…" /></label>
              <label className="esp-field">Fournisseur (magasin) <input type="text" value={fournisseur} onChange={e => setFournisseur(e.target.value)} placeholder="ex. Leroy Merlin, Monoprix…" /></label>
            </>
          )}

          <div className="esp-row">
            <label className="esp-field esp-montant">Montant
              <span className="esp-euro"><input type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" aria-invalid={amount !== "" && !(amt > 0)} /> €</span>
            </label>
            <label className="esp-field esp-w-s">Date de l&apos;opération <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} /></label>
          </div>
          {ecartDate < 0 && <div className="msg bad">La date est dans le futur.</div>}
          {ecartDate > 3 && <div className="msg warn">Opération datée d&apos;il y a {ecartDate} jours : elle sera signalée au contrôle. Précise la raison du retard dans la désignation.</div>}

          {doublon && (
            <div className="msg warn" role="alert">
              Déjà saisi le {fmtFrShort(doublon.date)} par {doublon.saisiPar || "?"} : {doublon.client}, appart {doublon.appartement || "—"}, {euros2(doublon.amount)}{doublon.recoveryId ? " (déjà récupéré)" : ""}.
              <label className="esp-check"><input type="checkbox" checked={confirmeDoublon} onChange={e => setConfirmeDoublon(e.target.checked)} /> C&apos;est bien un second paiement</label>
            </div>
          )}

          <div className="esp-signature">
            <div className="esp-row">
              <label className="esp-field">Saisi par
                <select value={saisiPar} onChange={e => choisirMoi(e.target.value)} aria-invalid={!saisiPar}>
                  <option value="">— Mon nom —</option>
                  {staffList.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>
            <button className="primary esp-submit" onClick={addEntry} disabled={!peutEnregistrer} aria-busy={busy}>
              {busy ? "Enregistrement…" : mode === "client" ? `Enregistrer l'encaissement${amt > 0 ? " de " + euros2(amt) : ""}` : `Enregistrer la dépense${amt > 0 ? " de " + euros2(amt) : ""}`}
            </button>
            {!busy && manque.length > 0 && <div className="esp-help">Il manque : {manque.join(", ")}.</div>}
            {bloqueDoublon && manque.length === 0 && <div className="esp-help warn">Confirme le second paiement ci-dessus pour enregistrer.</div>}
            {retour && <div className={`msg ${retour.ton}`} role="status">{retour.texte}</div>}
            <div className="esp-help">
              Ton nom n&apos;est pas dans la liste ?{" "}
              <button type="button" onClick={toggleStaffAdmin} className="ghost esp-mini">
                {staffAdmin ? "Fermer la gestion de la liste" : "Gérer la liste (code)"}
              </button>
            </div>
            {staffAdmin && (
              <div className="panel">
                <div className="panel-title">Réceptionnistes (liste partagée avec la Check-list)</div>
                <div className="panel-row">
                  {staffList.map(name => (
                    <span key={name} className="chip">
                      {name}
                      <button type="button" onClick={() => removeStaffName(name)} className="chip-del" title={`Retirer ${name}`} aria-label={`Retirer ${name}`}>✕</button>
                    </span>
                  ))}
                  {staffList.length === 0 && <span className="note">Aucun nom pour l&apos;instant.</span>}
                </div>
                <div className="panel-row">
                  <input type="text" value={newStaffName} onChange={e => setNewStaffName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addStaffName(); }} placeholder="Ajouter un prénom…" />
                  <button type="button" onClick={addStaffName} className="primary">Ajouter</button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="esp-card esp-liste" aria-labelledby="esp-liste-titre">
          <div className="esp-liste-head">
            <h2 id="esp-liste-titre">Opérations depuis {derniere ? `le ${fmtFrShort(derniere.date)}` : "le début"}</h2>
            <div className="esp-actions">
              <button onClick={exportCurrentCSV} disabled={!unrecovered.length}>Télécharger (Excel)</button>
              <button className="primary" onClick={() => setShowRecoverForm(!showRecoverForm)} disabled={!(etat.total > 0)}>
                {showRecoverForm ? "Annuler la récupération" : "Récupérer les espèces"}
              </button>
            </div>
          </div>

          {showRecoverForm && (
            <RecoverForm fs={fs} requestCode={requestCode} entries={entries} recoveries={recoveries}
              unrecovered={unrecovered} totalEnCaisse={etat.total}
              baseline={etat.baseline} sumClient={etat.sumClient} sumExpense={etat.sumExpense}
              staffList={staffList} saisiPar={saisiPar}
              onDone={() => { setShowRecoverForm(false); reload(); }} setStatus={setStatus} />
          )}

          {jours.length === 0 && <div className="empty-state">Rien depuis la dernière récupération.</div>}
          {jours.map(j => (
            <div key={j.date || "sans"} className="esp-jour">
              <div className="esp-jour-head">
                <span>{fmtJour(j.date)}</span>
                <span className={j.net < 0 ? "bad" : "ok"}>{j.net < 0 ? "−" : "+"}{euros2(Math.abs(j.net))}</span>
              </div>
              <table className="tbl esp-tbl">
                <thead className="sr-only"><tr><th>Type</th><th>Opération</th><th>Saisi par</th><th>Montant</th><th>Action</th></tr></thead>
                <tbody>
                  {j.lignes.map(e => {
                    const sig = signalees.get(e.id);
                    const saisie = e.createdAt ? jourParis(e.createdAt) : "";
                    return (
                      <tr key={e.id} className={sig ? `esp-sig ${NIVEAUX[sig.niveau].cls}` : ""}>
                        <td className="esp-type">{e.type === "client" ? <span className="pill ok">Encaissement</span> : <span className="pill bad">Dépense</span>}</td>
                        <td>
                          <strong>{e.type === "client" ? (e.client || "Client ?") : (e.designation || "Dépense")}</strong>
                          <div className="esp-muted">
                            {e.type === "client"
                              ? [e.designation, e.appartement && `appart ${e.appartement}`, e.arrivalDate && `arrivée ${fmtFrShort(e.arrivalDate)}`].filter(Boolean).join(" · ")
                              : (e.fournisseur || "")}
                            {sig && <> · <span className={`esp-flag ${NIVEAUX[sig.niveau].cls}`}>{sig.titre}</span></>}
                          </div>
                        </td>
                        <td className="esp-qui">
                          {e.saisiPar || "—"}
                          <div className="esp-muted">{saisie && saisie !== e.date ? `saisi le ${fmtFrShort(saisie)}` : heureParis(e.createdAt)}</div>
                        </td>
                        <td className={`esp-mt ${e.type === "expense" ? "bad" : "ok"}`}>{e.type === "expense" ? "−" : "+"}{euros2(e.amount)}</td>
                        <td className="tx-actions">{<button onClick={() => delEntry(e)} className="ghost danger tx-del" title="Supprimer (code et motif obligatoires)" aria-label={`Supprimer ${e.client || e.designation || "la ligne"}`}>✕</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
          <p className="esp-muted esp-formule">
            En caisse = laissé le {derniere ? fmtFrShort(derniere.date) : "—"} ({euros2(etat.baseline)}) + encaissé ({euros2(etat.sumClient)}) − dépensé ({euros2(etat.sumExpense)}).
          </p>
          <div>
            <button onClick={() => setShowStartForm(!showStartForm)} className="ghost esp-mini">
              {showStartForm ? "Annuler" : (recoveries.length ? "Redéfinir le solde de départ (code)" : "Définir un solde de départ (code)")}
            </button>
            {showStartForm && (
              <StartingBalanceForm hasRecoveries={recoveries.length > 0} enCours={unrecovered.length} onConfirm={setStartingBalance} onCancel={() => setShowStartForm(false)} />
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// ---- Solde de départ (une seule fois, avant la première vraie récupération) ----
function StartingBalanceForm({ hasRecoveries, enCours = 0, onConfirm, onCancel }) {
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
      {enCours > 0 && (
        <div className="msg warn">
          {enCours} opération(s) en cours resteront comptées en plus de ce solde. Si le montant compté dans la
          caisse les inclut déjà, fais d&apos;abord une récupération.
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
// Code admin demandé ; la personne qui récupère est enregistrée (faitPar).
function RecoverForm({ fs, requestCode, entries, recoveries, unrecovered, totalEnCaisse, baseline, sumClient, sumExpense, onDone, setStatus, staffList, saisiPar }) {
  const [amountRecovered, setAmountRecovered] = useState("");
  const [note, setNote] = useState("");
  const [qui, setQui] = useState(saisiPar || "");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setAmountRecovered(totalEnCaisse.toFixed(2).replace(".", ","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rec = lireMontant(amountRecovered) || 0;
  // Laissé en caisse = automatique, jamais saisi à la main : ce qui reste une fois
  // le montant récupéré soustrait du total (le total intègre déjà les dépenses,
  // puisque totalEnCaisse = reliquat + paiements clients - dépenses).
  const left = Math.max(0, Math.round((totalEnCaisse - rec) * 100) / 100);
  const montantValide = rec >= 0 && rec <= totalEnCaisse + 0.001;
  const totalPositif = totalEnCaisse > 0;
  const peutValider = montantValide && totalPositif && !busy && Boolean(qui);

  async function confirmRecovery() {
    if (!totalPositif) { setStatus("La caisse est vide ou négative, rien à récupérer."); return; }
    if (!montantValide) { setStatus("Le montant récupéré ne peut pas dépasser le total en caisse."); return; }
    if (!qui) { setStatus("Indique qui récupère."); return; }
    requestCode(enregistrer);
  }

  async function enregistrer() {
    setBusy(true); setErreur("");
    // Sauvegarde Excel d'abord : si elle échoue, rien n'est modifié.
    try {
      setStatus("Téléchargement de l'Excel de sauvegarde…");
      await downloadRecoveryXLSX({ unrecovered, baseline, sumClient, sumExpense, totalEnCaisse, rec, left, note });
    } catch (err) {
      setErreur("Récupération annulée : l'Excel de sauvegarde n'a pas pu être généré (" + err.message + "). Rien n'a été modifié.");
      setBusy(false);
      return;
    }
    try {
      setStatus("Enregistrement de la récupération…");
      const d = await recuperer(fs, { montant: rec, note, entrees: entries, recups: recoveries, faitPar: qui });
      setStatus(`Récupération enregistrée : ${euros2(d.amountRecovered)} récupérés, ${euros2(d.amountLeftInBox)} laissés en caisse.`);
      onDone();
    } catch (err) { setErreur("Pas enregistrée : " + err.message); }
    setBusy(false);
  }

  return (
    <div className="linen-form tone-ok">
      <div className="linen-form-row">
        <div style={{ fontSize: 13 }}><strong>Total en caisse à répartir : {euros2(totalEnCaisse)}</strong></div>
      </div>
      <div className="linen-form-row">
        <label>Montant récupéré € <input type="text" inputMode="decimal" autoComplete="off" value={amountRecovered} onChange={e => setAmountRecovered(e.target.value.replace(/[^\d.,]/g, ""))} style={{ width: 110 }} /></label>
        <label>Laissé en caisse €
          <input type="text" value={euros2(left)} disabled style={{ width: 110 }} />
        </label>
        <label style={{ flex: 1 }}>Note <input type="text" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%" }} /></label>
      </div>
      <div className="linen-form-row">
        <label>Récupéré par
          <select value={qui} onChange={e => setQui(e.target.value)}>
            <option value="">—</option>
            {[...new Set(["Mikhael", ...staffList])].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      {!montantValide && <div className="msg bad">Le montant récupéré ne peut pas dépasser le total en caisse ({euros2(totalEnCaisse)}).</div>}
      {erreur && <div className="msg bad" role="alert">{erreur}</div>}
      <button className="primary" onClick={confirmRecovery} disabled={!peutValider} aria-busy={busy}>{busy ? "Enregistrement…" : `Confirmer : je récupère ${euros2(rec)} et je laisse ${euros2(left)}`}</button>
    </div>
  );
}

// ---- Historique des récupérations + historique complet (lignes supprimées incluses) ----
function CashHistory({ fs, requestCode, recoveries, entries, reload, setStatus }) {
  const actives = recoveries.filter(r => !r.deleted);
  // Seule la plus récente peut être annulée (sinon des espèces déjà sorties redeviendraient « en caisse »).
  const derniereId = [...actives].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0]?.id;
  const annulees = recoveries.filter(r => r.deleted);
  const supprimees = entries.filter(e => e.deleted);

  function exportRecoveryCSV(rec) {
    const linked = entries.filter(e => e.recoveryId === rec.id && !e.deleted);
    const rows = [["Type", "Date", "Saisi par", "Client", "Appartement", "Date arrivée", "Fournisseur", "Désignation", "Montant"]];
    for (const e of linked) {
      rows.push([
        e.type === "client" ? "Paiement client" : "Dépense",
        fmtFrShort(e.date), e.saisiPar || "", e.client || "", e.appartement || "",
        e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", e.fournisseur || "", e.designation || "", Number(e.amount) || 0,
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
      "Fournisseur", "Désignation", "Montant", "Créée le", "Récupération", "Supprimée le", "Motif de suppression"]];
    const tri = [...entries].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    for (const e of tri) {
      rows.push([
        e.id, e.deleted ? "SUPPRIMÉE" : (e.recoveryId ? "Récupérée" : "En cours"),
        e.type === "client" ? "Paiement client" : "Dépense", fmtFrShort(e.date), e.saisiPar || "",
        e.client || "", e.appartement || "", e.arrivalDate ? fmtFrShort(e.arrivalDate) : "", e.fournisseur || "",
        e.designation || "", Number(e.amount) || 0, e.createdAt || "",
        e.recoveryId || "", e.deletedAt || "", e.deleteReason || "",
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
  function delRecovery(rec) {
    const motif = window.prompt(`Motif de l'annulation de « ${rec.note || "récupération"} » du ${fmtFrShort(rec.date)} :`);
    if (motif === null) return;
    if (motif.trim().length < 5) { setStatus("Annulation abandonnée : motif obligatoire (au moins 5 caractères)."); return; }
    requestCode(async () => {
      try {
        setStatus("Annulation…");
        await annulerRecuperation(fs, { id: rec.id, motif, entrees: entries, recups: recoveries });
        await reload();
        setStatus("Récupération annulée (elle reste visible dans l'historique complet).");
      } catch (err) { setStatus("Erreur : " + err.message); }
    });
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
                <button onClick={() => exportRecoveryCSV(r)} className="ghost" style={{ color: "var(--ok)" }} aria-label={`Télécharger la récupération du ${fmtFrShort(r.date)}`}>Excel</button>
                {r.id === derniereId && <button onClick={() => delRecovery(r)} className="ghost danger tx-del" title="Annuler (code et motif obligatoires)" aria-label="Annuler">✕</button>}
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
