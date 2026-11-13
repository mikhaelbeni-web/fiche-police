// pages/sinistres.js
// Suivi des sinistres / réclamations clients, en UNE liste :
//   - les réclamations repérées dans Gmail (collection "reclamations_gmail",
//     voir components/ReclamationsGmail.js) ;
//   - les sinistres saisis à la main (collection "sinistres") : cause, montant,
//     suivi sur la plateforme (Booking, Airbnb…), problème réglé ou non.
// La liste est en lecture (cartes compactes) ; on modifie un dossier dans sa
// fiche : panneau à droite sur ordinateur, feuille plein écran sur téléphone.
// Aucune donnée n'est migrée : les champs existants sont relus tels quels.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Head from "next/head";
import CodeModal from "../components/CodeModal";
import { useCodeGate } from "../hooks/useCodeGate";
import {
  RECLAMATIONS_COLLECTION, ReclamationDetail, PLATEFORMES, plateformeLabel, typeLabel,
  fmtFr, euros, parseMontant, joursDepuis,
} from "../components/ReclamationsGmail";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";
const DELETE_PASSWORD = process.env.NEXT_PUBLIC_DELETE_PASSWORD || "2305";

function isoDay(d) { return d.toISOString().slice(0, 10); }
function sansAccents(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

// Canal unique d'un sinistre : "direct" ou la plateforme (rétrocompatibilité :
// les anciens sinistres avaient origine: "booking" sans champ canal).
function canalSinistre(s) {
  if (s.origine === "direct") return "direct";
  return s.canal || (s.origine === "booking" ? "booking" : "autre");
}
function statutPlateforme(s) { return s.statutPlateforme || s.statutBooking || "non_ouvert"; }

// Pastille de statut d'un sinistre, en toutes lettres.
function badgeSinistre(s) {
  if (s.problemeRegle) return { cls: "ok", txt: "✓ Réglé" };
  const c = canalSinistre(s);
  if (c === "direct") return { cls: "warn", txt: "● Non réglé" };
  const st = statutPlateforme(s);
  if (st === "ouvert") return { cls: "warn", txt: `● Ouvert sur ${plateformeLabel(c)}` };
  if (st === "ferme") return { cls: "warn", txt: `● Non réglé · fermé sur ${plateformeLabel(c)}` };
  return { cls: "gr", txt: `○ À ouvrir sur ${plateformeLabel(c)}` };
}

function ageCls(j) { return j == null ? "" : j > 5 ? "bad" : j > 2 ? "warn" : ""; }

function Sinistres() {
  const { requestCode, codeModalProps } = useCodeGate(DELETE_PASSWORD, "Code requis pour cette suppression");
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [sinistres, setSinistres] = useState([]);
  const [reclamations, setReclamations] = useState([]);
  const [vue, setVue] = useState("a_traiter"); // a_traiter | clos | tout
  const [q, setQ] = useState("");
  const [canal, setCanal] = useState("tous");
  const [sel, setSel] = useState(null); // { kind: "sin"|"gmail"|"new", id?, prefill? }
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), kind === "bad" ? 6000 : 2500);
  }, []);

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy };
      setFs(api);
      await Promise.all([loadSinistres(api), loadReclamations(api)]);
      setReady(true);
    })();
  }, []);

  // Échap ferme la fiche (utile sur téléphone où elle couvre l'écran).
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") setSel(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function loadSinistres(api) {
    const snap = await api.getDocs(api.query(api.collection(api.db, "sinistres"), api.orderBy("date", "desc")));
    setSinistres(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }
  async function loadReclamations(api) {
    const snap = await api.getDocs(api.query(api.collection(api.db, RECLAMATIONS_COLLECTION), api.orderBy("dateRecu", "desc")));
    setReclamations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  async function addSinistre(payload, msg = "Sinistre enregistré.") {
    try {
      const ref = await fs.addDoc(fs.collection(fs.db, "sinistres"), { ...payload, createdAt: new Date().toISOString() });
      await loadSinistres(fs);
      notify(msg);
      return ref.id;
    } catch (err) { notify("Erreur : " + err.message, "bad"); return null; }
  }

  async function updateSinistre(id, patch, msg = "Enregistré.") {
    try {
      await fs.updateDoc(fs.doc(fs.db, "sinistres", id), patch);
      await loadSinistres(fs);
      notify(msg);
      return true;
    } catch (err) { notify("Erreur : " + err.message, "bad"); return false; }
  }

  async function saveReclamation(id, patch, msg = "Enregistré.") {
    try {
      await fs.updateDoc(fs.doc(fs.db, RECLAMATIONS_COLLECTION, id), patch);
      await loadReclamations(fs);
      notify(msg);
      return true;
    } catch (err) { notify("Erreur : " + err.message, "bad"); return false; }
  }

  // Sinistre pré-rempli depuis une réclamation Gmail traitée.
  async function sinistreDepuisReclamation(r) {
    const p = r.plateformeRemboursement || r.plateforme;
    const direct = p === "direct";
    const canalSin = ["booking", "airbnb", "expedia"].includes(p) ? p : "autre";
    const id = await addSinistre({
      date: r.dateRecu || isoDay(new Date()),
      clientMode: "gmail",
      client: r.client || "Client inconnu",
      residence: "",
      appartement: r.logement || "",
      unitNumber: "",
      arrivee: "",
      depart: "",
      reservation: r.reservation || "",
      motif: (r.motif || r.motifSuggere || r.resume || "").trim() || "Réclamation Gmail",
      montant: r.rembourse === "oui" ? r.montantRembourse : null,
      origine: direct ? "direct" : "plateforme",
      canal: direct ? null : canalSin,
      problemeRegle: false,
      reponseRapide: false,
      statutPlateforme: "non_ouvert",
      note: (r.note || "").trim(),
      reclamationId: r.id,
    }, "Réclamation classée et sinistre créé.");
    if (id) {
      try {
        await fs.updateDoc(fs.doc(fs.db, RECLAMATIONS_COLLECTION, r.id), { sinistreId: id });
        await loadReclamations(fs);
      } catch (err) { notify("Sinistre créé, mais lien non enregistré : " + err.message, "bad"); }
    }
  }

  function deleteSinistre(s) {
    if (!confirm(`Supprimer le sinistre de ${s.client} (${s.motif}) ?`)) return;
    requestCode(async () => {
      try {
        await fs.deleteDoc(fs.doc(fs.db, "sinistres", s.id));
        await loadSinistres(fs);
        setSel(null);
        notify("Sinistre supprimé.");
      } catch (err) { notify("Erreur : " + err.message, "bad"); }
    });
  }

  // ---- Liste unifiée ----
  const items = useMemo(() => {
    const g = reclamations.map(r => ({
      kind: "gmail", key: "g:" + r.id, id: r.id, raw: r,
      date: r.dateRecu || "", client: r.client || "Client inconnu",
      lieu: [r.logement, r.reservation && `résa ${r.reservation}`].filter(Boolean).join(" · "),
      canal: r.traite && r.plateformeRemboursement ? r.plateformeRemboursement : (r.plateforme || "autre"),
      motif: r.resume || r.motifSuggere || r.motif || "",
      ouvert: !r.traite,
      montant: r.traite ? (r.rembourse === "oui" ? r.montantRembourse : null) : r.montantDemande,
      montantLbl: r.traite ? "remboursé" : "demandé",
      search: sansAccents([r.client, r.logement, r.reservation, r.resume, r.motif, r.motifSuggere].join(" ")),
    }));
    const s = sinistres.map(x => ({
      kind: "sin", key: "s:" + x.id, id: x.id, raw: x,
      date: x.date || "", client: x.client || "Client inconnu",
      lieu: [x.residence, x.appartement].filter(Boolean).join(" ") || "",
      canal: canalSinistre(x),
      motif: x.motif || "",
      ouvert: !x.problemeRegle,
      montant: x.montant > 0 ? x.montant : null,
      montantLbl: "",
      search: sansAccents([x.client, x.residence, x.appartement, x.reservation, x.motif, x.note].join(" ")),
    }));
    return [...g, ...s];
  }, [reclamations, sinistres]);

  const canalOk = it => canal === "tous" || it.canal === canal || (canal === "autre" && !PLATEFORMES.some(p => p.value === it.canal));
  const qn = sansAccents(q.trim());
  const filtres = items.filter(it => canalOk(it) && (!qn || it.search.includes(qn)));
  const parVue = filtres.filter(it => vue === "tout" || (vue === "a_traiter" ? it.ouvert : !it.ouvert));
  const tri = vue === "a_traiter"
    ? (a, b) => a.date.localeCompare(b.date) // plus ancien d'abord : c'est lui qui attend le plus
    : (a, b) => b.date.localeCompare(a.date);
  const gmailListe = parVue.filter(i => i.kind === "gmail").sort(tri);
  const sinListe = parVue.filter(i => i.kind === "sin").sort(tri);
  const tousListe = [...parVue].sort(tri);

  // ---- Chiffres ----
  const mois = isoDay(new Date()).slice(0, 7);
  const nomMois = new Date().toLocaleDateString("fr-FR", { month: "long" });
  const gmailOuverts = reclamations.filter(r => !r.traite);
  const nbATraiter = gmailOuverts.length + sinistres.filter(s => !s.problemeRegle).length;
  const rembourseMois =
    sinistres.filter(s => (s.date || "").startsWith(mois) && s.montant > 0).reduce((t, s) => t + Number(s.montant), 0) +
    reclamations.filter(r => r.rembourse === "oui" && !r.sinistreId && r.montantRembourse > 0 && (r.traiteLe || r.dateRecu || "").startsWith(mois))
      .reduce((t, r) => t + Number(r.montantRembourse), 0);
  const demandeAttente = gmailOuverts.reduce((t, r) => t + (Number(r.montantDemande) || 0), 0);
  const plusAncienne = gmailOuverts.reduce((m, r) => Math.max(m, joursDepuis(r.dateRecu) ?? 0), 0);

  const selItem = sel && sel.kind !== "new"
    ? (sel.kind === "gmail" ? reclamations.find(r => r.id === sel.id) : sinistres.find(s => s.id === sel.id))
    : null;

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <>
        <div className="toolbar"><h1>Sinistres</h1></div>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
        </div></div>
      </>
    );
  }

  const renderItem = it => (
    <ItemRow key={it.key} it={it} selected={!!sel && sel.kind === it.kind && sel.id === it.id}
      onOpen={() => setSel({ kind: it.kind, id: it.id })} />
  );

  return (
    <>
      <Head><title>Sinistres</title></Head>
      <div className="toolbar sin-toolbar">
        <h1>Sinistres</h1>
        <button className="primary" onClick={() => setSel({ kind: "new" })}>+ Nouveau sinistre</button>
      </div>

      <div className={`sx-page ${sel ? "has-sel" : ""}`}>
        <div className="sx-main">
          <div className="sx-kpis">
            <div className={`sx-kpi ${nbATraiter ? "hot" : ""}`}><b>{nbATraiter}</b><span>à traiter</span></div>
            <div className="sx-kpi"><b>{euros(rembourseMois)}</b><span>remboursé en {nomMois}</span></div>
            <div className="sx-kpi"><b>{euros(demandeAttente)}</b><span>demandé, sans réponse</span></div>
            <div className={`sx-kpi ${plusAncienne > 5 ? "hot" : ""}`}><b>{gmailOuverts.length ? `${plusAncienne} j` : "—"}</b><span>plus ancienne en attente</span></div>
          </div>

          <div className="sx-bar">
            <div className="sx-seg" role="tablist" aria-label="Filtrer par état">
              {[["a_traiter", "À traiter"], ["clos", "Clos"], ["tout", "Tout"]].map(([v, l]) => (
                <button key={v} role="tab" aria-selected={vue === v} className={vue === v ? "on" : ""} onClick={() => setVue(v)}>
                  {l}{v === "a_traiter" && nbATraiter > 0 && <span className="sx-n">{nbATraiter}</span>}
                </button>
              ))}
            </div>
            <div className="sx-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Client, logement, n° de résa, motif…" aria-label="Rechercher" />
            </div>
            <select value={canal} onChange={e => setCanal(e.target.value)} aria-label="Filtrer par canal">
              <option value="tous">Tous canaux</option>
              {PLATEFORMES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {vue === "a_traiter" ? (
            <>
              <div className="sx-sec">Réclamations Gmail à traiter · {gmailListe.length}</div>
              {gmailListe.length === 0
                ? <div className="sx-empty">{qn || canal !== "tous" ? "Aucune réclamation Gmail sur cette recherche." : "Aucune réclamation Gmail en attente."}</div>
                : gmailListe.map(renderItem)}
              <div className="sx-sec">Sinistres non réglés · {sinListe.length}</div>
              {sinListe.length === 0
                ? <div className="sx-empty">{qn || canal !== "tous" ? "Aucun sinistre non réglé sur cette recherche." : "Aucun sinistre en cours."}</div>
                : sinListe.map(renderItem)}
            </>
          ) : (
            <>
              <div className="sx-sec">{tousListe.length} dossier(s)</div>
              {tousListe.length === 0 && <div className="sx-empty">Aucun dossier sur cette recherche.</div>}
              {tousListe.map(renderItem)}
            </>
          )}
        </div>

        <aside className={`sx-panel ${sel ? "open" : ""}`} aria-label="Fiche du dossier">
          {sel && <div className="sx-backdrop" onClick={() => setSel(null)} />}
          <div className="sx-sheet">
            {sel ? (
              <>
                <div className="sx-sheet-head">
                  <span>{sel.kind === "new" ? "Nouveau sinistre" : sel.kind === "gmail" ? "Réclamation Gmail" : "Sinistre"}</span>
                  <button type="button" className="sx-close" onClick={() => setSel(null)} aria-label="Fermer la fiche">✕</button>
                </div>
                {sel.kind === "new" && (
                  <SinistreForm
                    onSave={async payload => { const id = await addSinistre(payload); if (id) setSel({ kind: "sin", id }); }}
                    onCancel={() => setSel(null)} />
                )}
                {sel.kind === "gmail" && selItem && (
                  <ReclamationDetail r={selItem}
                    onSave={(patch, msg) => saveReclamation(selItem.id, patch, msg)}
                    onCreateSinistre={sinistreDepuisReclamation}
                    onOpenSinistre={id => setSel({ kind: "sin", id })} />
                )}
                {sel.kind === "sin" && selItem && (
                  <SinistreDetail s={selItem}
                    onUpdate={(patch, msg) => updateSinistre(selItem.id, patch, msg)}
                    onDelete={() => deleteSinistre(selItem)}
                    onOpenReclamation={id => setSel({ kind: "gmail", id })} />
                )}
                {sel.kind !== "new" && !selItem && <div className="sx-empty">Ce dossier n'existe plus.</div>}
              </>
            ) : (
              <div className="sx-placeholder">Choisis un dossier dans la liste pour le traiter ou le modifier.</div>
            )}
          </div>
        </aside>
      </div>

      {toast && <div className={`sx-toast ${toast.kind}`} role="status" aria-live="polite">{toast.msg}</div>}
      <CodeModal {...codeModalProps} />
    </>
  );
}

// ---- Carte compacte de la liste ----
function ItemRow({ it, selected, onOpen }) {
  const r = it.raw;
  const age = it.kind === "gmail" && it.ouvert ? joursDepuis(it.date) : null;
  let badge;
  if (it.kind === "gmail") {
    badge = it.ouvert ? { cls: "bad", txt: "● Gmail · à traiter" }
      : r.ignoree ? { cls: "ok", txt: "✓ Gmail · sans suite" } : { cls: "ok", txt: "✓ Gmail · traitée" };
  } else badge = badgeSinistre(r);

  return (
    <button type="button" className={`sx-item ${selected ? "sel" : ""} ${it.ouvert ? "is-open" : "is-closed"}`} onClick={onOpen} aria-current={selected || undefined}>
      <span className="sx-i-badges">
        <span className={`sx-b ${badge.cls}`}>{badge.txt}</span>
        {it.kind === "gmail" && r.type && <span className="sx-b gr">{typeLabel(r.type)}</span>}
        <span className={`sx-b ${it.canal === "direct" ? "vi" : "info"}`}>{plateformeLabel(it.canal)}</span>
        {it.kind === "sin" && it.canal !== "direct" && r.reponseRapide && <span className="sx-b ok">Répondu vite</span>}
      </span>
      <span className="sx-i-who">{it.client}</span>
      <span className="sx-i-meta">{[it.lieu, fmtFr(it.date)].filter(Boolean).join(" · ")}</span>
      {it.motif && <span className="sx-i-txt">{it.motif}</span>}
      <span className="sx-i-end">
        {age != null && <span className={`sx-age ${ageCls(age)}`}>il y a {age} j</span>}
        {it.montant != null && it.montant !== "" && (
          <span className={`sx-amt ${it.kind === "sin" ? "neg" : ""}`}>{euros(it.montant)}{it.montantLbl && <small> {it.montantLbl}</small>}</span>
        )}
        <span className="sx-chev" aria-hidden="true">›</span>
      </span>
    </button>
  );
}

// ---- Fiche d'un sinistre ----
function SinistreDetail({ s, onUpdate, onDelete, onOpenReclamation }) {
  const c = canalSinistre(s);
  const direct = c === "direct";
  const st = statutPlateforme(s);
  const init = () => ({ motif: s.motif || "", montant: s.montant ?? "", note: s.note || "", date: s.date || "" });
  const [f, setF] = useState(init);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(init()); setErr(""); }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = f.motif !== (s.motif || "") || String(f.montant ?? "") !== String(s.montant ?? "") || f.note !== (s.note || "") || f.date !== (s.date || "");
  const badge = badgeSinistre(s);

  async function enregistrer() {
    const m = parseMontant(f.montant);
    if (!f.motif.trim()) { setErr("La cause est obligatoire."); return; }
    if (m != null && (isNaN(m) || m < 0)) { setErr("Montant invalide."); return; }
    setErr(""); setBusy(true);
    await onUpdate({ motif: f.motif.trim(), montant: m, note: f.note.trim(), date: f.date || s.date }, "Modifications enregistrées.");
    setBusy(false);
  }

  return (
    <div className="sx-detail">
      <div className="sx-d-badges">
        <span className={`sx-b ${badge.cls}`}>{badge.txt}</span>
        <span className={`sx-b ${direct ? "vi" : "info"}`}>{plateformeLabel(c)}</span>
      </div>
      <h2 className="sx-d-title">{s.client}</h2>
      <div className="sx-d-meta">
        {[[s.residence, s.appartement].filter(Boolean).join(" "), s.reservation && `résa ${s.reservation}`].filter(Boolean).join(" · ") || "Logement non renseigné"}
        {s.arrivee && <><br />Séjour du {fmtFr(s.arrivee)} au {fmtFr(s.depart)}</>}
      </div>
      {s.reclamationId && (
        <p className="sx-d-link"><button type="button" className="sx-linkbtn" onClick={() => onOpenReclamation(s.reclamationId)}>Voir la réclamation Gmail ›</button></p>
      )}

      <div className="sx-fld">
        <div className="sx-lbl">Problème réglé ?</div>
        <div className="sx-yn" role="group">
          <button type="button" className={`sx-btn ${!s.problemeRegle ? "on-warn" : ""}`} aria-pressed={!s.problemeRegle}
            onClick={() => s.problemeRegle && onUpdate({ problemeRegle: false }, "Remis en « non réglé ».")}>Non réglé</button>
          <button type="button" className={`sx-btn ${s.problemeRegle ? "on-ok" : ""}`} aria-pressed={!!s.problemeRegle}
            onClick={() => !s.problemeRegle && onUpdate({ problemeRegle: true }, "Sinistre réglé.")}>Réglé</button>
        </div>
      </div>

      {!direct && (
        <>
          <div className="sx-fld">
            <div className="sx-lbl">Dossier sur {plateformeLabel(c)}</div>
            <div className="sx-chips">
              {[["non_ouvert", "Pas ouvert"], ["ouvert", "Ouvert"], ["ferme", "Fermé"]].map(([v, l]) => (
                <button type="button" key={v} className={`sx-chip ${st === v ? "on" : ""}`} aria-pressed={st === v}
                  onClick={() => st !== v && onUpdate({ statutPlateforme: v }, `Dossier ${plateformeLabel(c)} : ${l.toLowerCase()}.`)}>{l}</button>
              ))}
            </div>
          </div>
          <label className="sx-check">
            <input type="checkbox" checked={!!s.reponseRapide} onChange={e => onUpdate({ reponseRapide: e.target.checked }, "Enregistré.")} />
            Répondu rapidement à la plateforme
          </label>
        </>
      )}

      <div className="sx-form sx-edit">
        <div className="sx-fld">
          <label className="sx-lbl" htmlFor={`sm-${s.id}`}>Cause / motif</label>
          <textarea id={`sm-${s.id}`} rows={2} value={f.motif} onChange={e => setF({ ...f, motif: e.target.value })} />
        </div>
        <div className="sx-2col">
          <div className="sx-fld">
            <label className="sx-lbl" htmlFor={`sa-${s.id}`}>Montant remboursé (€)</label>
            <input id={`sa-${s.id}`} inputMode="decimal" value={f.montant ?? ""} onChange={e => setF({ ...f, montant: e.target.value })} />
          </div>
          <div className="sx-fld">
            <label className="sx-lbl" htmlFor={`sd-${s.id}`}>Date</label>
            <input id={`sd-${s.id}`} type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
          </div>
        </div>
        <div className="sx-fld">
          <label className="sx-lbl" htmlFor={`sn-${s.id}`}>Note <span className="sx-opt">(facultatif)</span></label>
          <textarea id={`sn-${s.id}`} rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        </div>
        {err && <div className="sx-err">{err}</div>}
        {dirty && (
          <div className="sx-foot">
            <button type="button" className="sx-btn" onClick={() => { setF(init()); setErr(""); }} disabled={busy}>Annuler</button>
            <button type="button" className="sx-btn pri" onClick={enregistrer} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
        )}
      </div>

      <button type="button" className="sx-delete" onClick={onDelete}>Supprimer ce sinistre…</button>
    </div>
  );
}

// ---- Formulaire de création ----
const GERE = [
  { value: "booking", label: "Booking" },
  { value: "airbnb", label: "Airbnb" },
  { value: "expedia", label: "Expedia" },
  { value: "autre", label: "Autre plateforme" },
  { value: "direct", label: "En direct" },
];

function SinistreForm({ onSave, onCancel }) {
  const [clientMode, setClientMode] = useState("hostaway"); // hostaway | manuel
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [searchMsg, setSearchMsg] = useState("");
  const [picked, setPicked] = useState(null);
  const [manualClient, setManualClient] = useState("");
  const [motif, setMotif] = useState("");
  const [montant, setMontant] = useState("");
  const [gere, setGere] = useState("booking");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(isoDay(new Date()));
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  function onQuery(v) {
    setQuery(v);
    setPicked(null);
    clearTimeout(timer.current);
    if (v.trim().length < 2) { setResults([]); setSearchMsg(""); return; }
    timer.current = setTimeout(() => runSearch(v.trim()), 300);
  }

  async function runSearch(qq) {
    const acc = window.localStorage.getItem(ACCOUNT_KEY) || "";
    const key = window.localStorage.getItem(KEY_KEY) || "";
    if (!acc || !key) { setSearchMsg("Identifiants Hostaway non configurés (onglet Fiches de police) : utilise la saisie libre."); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/reservation-search?q=${encodeURIComponent(qq)}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const d = await res.json();
      if (!res.ok) { setSearchMsg("Erreur de recherche : " + (d.error || res.status)); setResults([]); }
      else { setResults(d.items || []); setSearchMsg((d.items || []).length ? "" : "Aucune réservation trouvée. Vérifie l'orthographe ou passe en saisie libre."); }
    } catch (err) { setSearchMsg("Erreur : " + err.message); }
    setSearching(false);
  }

  function pick(r) {
    setPicked(r); setResults([]); setErrs(e => ({ ...e, client: "" }));
    const ch = (r.channel || "").toLowerCase();
    setGere(ch.includes("airbnb") ? "airbnb" : ch.includes("booking") ? "booking" : ch.includes("expedia") ? "expedia" : "autre");
  }

  async function submit() {
    const client = clientMode === "hostaway" ? (picked?.client || "") : manualClient.trim();
    const m = parseMontant(montant);
    const e = {};
    if (!client) e.client = clientMode === "hostaway" ? "Choisis une réservation dans la liste." : "Saisis le nom du client.";
    if (!motif.trim()) e.motif = "La cause est obligatoire.";
    if (m != null && (isNaN(m) || m < 0)) e.montant = "Montant invalide.";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    await onSave({
      date,
      clientMode,
      client,
      residence: picked?.residence || "",
      appartement: picked?.appartement || "",
      unitNumber: picked?.unitNumber || "",
      arrivee: picked?.arrivee || "",
      depart: picked?.depart || "",
      reservation: picked?.reservation || "",
      motif: motif.trim(),
      montant: m,
      origine: gere === "direct" ? "direct" : "plateforme",
      canal: gere === "direct" ? null : gere,
      problemeRegle: false,
      reponseRapide: false,
      statutPlateforme: "non_ouvert",
      note: note.trim(),
    });
    setBusy(false);
  }

  return (
    <div className="sx-detail sx-form">
      <div className="sx-fld">
        <div className="sx-lbl">Client</div>
        <div className="sx-chips">
          <button type="button" className={`sx-chip ${clientMode === "hostaway" ? "on" : ""}`} aria-pressed={clientMode === "hostaway"} onClick={() => setClientMode("hostaway")}>Chercher une réservation</button>
          <button type="button" className={`sx-chip ${clientMode === "manuel" ? "on" : ""}`} aria-pressed={clientMode === "manuel"} onClick={() => { setClientMode("manuel"); setPicked(null); setResults([]); }}>Saisie libre</button>
        </div>
      </div>

      {clientMode === "hostaway" ? (
        <div className="sx-fld">
          <label className="sx-lbl" htmlFor="sf-q">Nom du client</label>
          {picked ? (
            <div className="sx-picked">
              <div><b>{picked.client}</b><br /><small>{picked.residence} {picked.appartement} · {fmtFr(picked.arrivee)} → {fmtFr(picked.depart)} · {picked.channel}</small></div>
              <button type="button" className="sx-btn" onClick={() => { setPicked(null); setQuery(""); }}>Changer</button>
            </div>
          ) : (
            <>
              <input id="sf-q" type="search" value={query} onChange={e => onQuery(e.target.value)} placeholder="Au moins 2 lettres du nom" autoComplete="off" />
              {searching && <div className="sx-hint">Recherche…</div>}
              {searchMsg && <div className="sx-hint">{searchMsg}</div>}
              {results.length > 0 && (
                <div className="sx-results" role="listbox">
                  {results.map((r, i) => (
                    <button type="button" key={i} className="sx-result" onClick={() => pick(r)}>
                      <b>{r.client}</b> · {r.residence} {r.appartement}
                      <small>{fmtFr(r.arrivee)} → {fmtFr(r.depart)} · {r.channel}</small>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {errs.client && <div className="sx-err">{errs.client}</div>}
        </div>
      ) : (
        <div className="sx-fld">
          <label className="sx-lbl" htmlFor="sf-c">Nom du client</label>
          <input id="sf-c" value={manualClient} onChange={e => { setManualClient(e.target.value); setErrs(x => ({ ...x, client: "" })); }} />
          {errs.client && <div className="sx-err">{errs.client}</div>}
        </div>
      )}

      <div className="sx-fld">
        <label className="sx-lbl" htmlFor="sf-m">Cause / motif <span className="sx-req">(obligatoire)</span></label>
        <input id="sf-m" value={motif} onChange={e => { setMotif(e.target.value); setErrs(x => ({ ...x, motif: "" })); }} />
        <div className="sx-hint">Exemples : chauffage en panne, ménage insuffisant.</div>
        {errs.motif && <div className="sx-err">{errs.motif}</div>}
      </div>

      <div className="sx-2col">
        <div className="sx-fld">
          <label className="sx-lbl" htmlFor="sf-a">Montant remboursé (€)</label>
          <input id="sf-a" inputMode="decimal" value={montant} onChange={e => { setMontant(e.target.value); setErrs(x => ({ ...x, montant: "" })); }} />
          {errs.montant && <div className="sx-err">{errs.montant}</div>}
        </div>
        <div className="sx-fld">
          <label className="sx-lbl" htmlFor="sf-d">Date de la réclamation</label>
          <input id="sf-d" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>

      <div className="sx-fld">
        <div className="sx-lbl">Géré</div>
        <div className="sx-chips">
          {GERE.map(g => (
            <button type="button" key={g.value} className={`sx-chip ${gere === g.value ? "on" : ""}`} aria-pressed={gere === g.value} onClick={() => setGere(g.value)}>{g.label}</button>
          ))}
        </div>
        {picked && <div className="sx-hint">Déduit de la réservation, modifiable.</div>}
      </div>

      <div className="sx-fld">
        <label className="sx-lbl" htmlFor="sf-n">Note <span className="sx-opt">(facultatif)</span></label>
        <input id="sf-n" value={note} onChange={e => setNote(e.target.value)} />
      </div>

      <div className="sx-foot">
        <button type="button" className="sx-btn" onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="button" className="sx-btn pri" onClick={submit} disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le sinistre"}</button>
      </div>
    </div>
  );
}

export default function SinistresPage() {
  return <Sinistres />;
}
