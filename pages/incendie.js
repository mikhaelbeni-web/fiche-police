// pages/incendie.js
// Suivi des obligations de sécurité incendie : un type de contrôle = une
// périodicité + un historique de vérifications (date, organisme, résultat,
// réserves, documents). Une vérification avec réserves reste « non conforme »
// tant qu'une contre-visite sans réserve ne lui est pas liée.
// Modèle de données et calcul d'état : lib/incendie.js.

import { useState, useEffect, useMemo } from "react";
import Head from "next/head";
import CodeModal from "../components/CodeModal";
import IncendieAcces from "../components/IncendieAcces";
import { useCodeGate } from "../hooks/useCodeGate";
import {
  COL_TYPES, COL_VERIFS, COL_DOCS, COL_FACTURES, CATEGORIES_FACTURE, TYPES_PAR_DEFAUT, RESULTATS, ETAT_LABEL, ETAT_RANG,
  SEUIL_BIENTOT_JOURS, isoDay, fmtFr, statutType, periodiciteLabel,
} from "../lib/incendie";

const DELETE_PASSWORD = process.env.NEXT_PUBLIC_DELETE_PASSWORD || "2305";
const MAX_FICHIER = 10 * 1024 * 1024;
const PERIODES = [6, 12, 24, 36, 48, 60];

function Incendie({ verrouiller, changerCode }) {
  const { requestCode, codeModalProps } = useCodeGate(DELETE_PASSWORD, "Code requis pour cette suppression");
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [status, setStatus] = useState("");
  const [types, setTypes] = useState([]);
  const [verifs, setVerifs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [factures, setFactures] = useState([]);
  const [vue, setVue] = useState("verifications"); // verifications | factures
  const [ouvert, setOuvert] = useState(null); // id du type déplié
  const [nouveau, setNouveau] = useState(false);
  const today = isoDay(new Date());

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const f = await import("firebase/firestore");
      const api = { db, ...f };
      setFs(api);
      await charger(api, true);
      setReady(true);
    })();
  }, []);

  async function charger(api, seed) {
    let tSnap = await api.getDocs(api.collection(api.db, COL_TYPES));
    if (seed && tSnap.empty) {
      // Première ouverture : on crée les types usuels (id fixe → sans doublon si deux onglets s'ouvrent en même temps).
      await Promise.all(TYPES_PAR_DEFAUT.map(t => api.setDoc(api.doc(api.db, COL_TYPES, t.id), t)));
      tSnap = await api.getDocs(api.collection(api.db, COL_TYPES));
    }
    const [vSnap, dSnap, fSnap] = await Promise.all([
      api.getDocs(api.collection(api.db, COL_VERIFS)),
      api.getDocs(api.collection(api.db, COL_DOCS)),
      api.getDocs(api.collection(api.db, COL_FACTURES)),
    ]);
    setTypes(tSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.ordre || 99) - (b.ordre || 99)));
    setVerifs(vSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setDocs(dSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    setFactures(fSnap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  const lignes = useMemo(() => types.map(t => {
    const vs = verifs.filter(v => v.typeId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const ds = docs.filter(d => d.typeId === t.id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return { type: t, verifs: vs, docs: ds, st: statutType(t, vs, today) };
  }), [types, verifs, docs, today]);

  const alertes = lignes
    .filter(l => ["non_conforme", "retard", "jamais", "bientot"].includes(l.st.etat))
    .sort((a, b) => ETAT_RANG[a.st.etat] - ETAT_RANG[b.st.etat]);

  async function run(label, fn) {
    try {
      setStatus(label + "…");
      await fn();
      await charger(fs, false);
      setStatus("Enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  const actions = {
    addType: (nom, mois) => run("Enregistrement", async () => {
      const ordre = Math.max(0, ...types.map(t => t.ordre || 0)) + 1;
      const id = nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "controle-" + Date.now();
      await fs.setDoc(fs.doc(fs.db, COL_TYPES, types.some(t => t.id === id) ? id + "-" + Date.now() : id), { nom, ordre, periodiciteMois: mois });
    }),
    savePeriodicite: (t, mois) => run("Enregistrement", () => fs.updateDoc(fs.doc(fs.db, COL_TYPES, t.id), { periodiciteMois: mois })),
    addVerif: (payload) => run("Enregistrement", async () => {
      const { doc: docData, ...v } = payload;
      const ref = await fs.addDoc(fs.collection(fs.db, COL_VERIFS), { ...v, createdAt: new Date().toISOString() });
      if (docData) {
        await fs.addDoc(fs.collection(fs.db, COL_DOCS), {
          ...docData, typeId: v.typeId, verificationId: ref.id, date: v.date,
          nature: docData.nature || "Rapport de vérification", fournisseur: v.organisme || "",
          createdAt: new Date().toISOString(),
        });
      }
    }),
    addDocument: (payload) => run("Enregistrement", () => fs.addDoc(fs.collection(fs.db, COL_DOCS), { ...payload, createdAt: new Date().toISOString() })),
    deleteVerif: (v) => requestCode(() => run("Suppression", async () => {
      await fs.deleteDoc(fs.doc(fs.db, COL_VERIFS, v.id));
      // Les documents restent consultables, détachés de la vérification supprimée.
      await Promise.all(docs.filter(d => d.verificationId === v.id).map(d => fs.updateDoc(fs.doc(fs.db, COL_DOCS, d.id), { verificationId: null })));
    })),
    addFacture: (payload) => run("Enregistrement", () => fs.addDoc(fs.collection(fs.db, COL_FACTURES), { ...payload, createdAt: new Date().toISOString() })),
    deleteFacture: (f) => requestCode(() => run("Suppression", () => fs.deleteDoc(fs.doc(fs.db, COL_FACTURES, f.id)))),
    deleteDocument: (d) => requestCode(() => run("Suppression", () => fs.deleteDoc(fs.doc(fs.db, COL_DOCS, d.id)))),
    importer: (file) => importer(file),
  };

  async function importer(file) {
    try {
      const data = JSON.parse(await file.text());
      const existV = new Set(verifs.map(v => v.id));
      const existD = new Set(docs.map(d => d.id));
      const nv = (data.verifications || []).filter(v => v.id && !existV.has(v.id));
      const existF = new Set(factures.map(f => f.id));
      const nd = (data.documents || []).filter(d => d.id && !existD.has(d.id));
      const nf = (data.factures || []).filter(f => f.id && !existF.has(f.id));
      if (!nv.length && !nd.length && !nf.length) { setStatus("Rien de nouveau à importer."); return; }
      if (!window.confirm(`Importer ${nv.length} vérification(s), ${nd.length} document(s) et ${nf.length} facture(s) ?`)) return;
      setStatus("Import en cours…");
      const ops = [
        ...nv.map(({ id, ...v }) => [COL_VERIFS, id, v]),
        ...nd.map(({ id, ...d }) => [COL_DOCS, id, d]),
        ...nf.map(({ id, ...f }) => [COL_FACTURES, id, f]),
      ];
      for (let i = 0; i < ops.length; i += 400) {
        const batch = fs.writeBatch(fs.db);
        ops.slice(i, i + 400).forEach(([col, id, d]) => batch.set(fs.doc(fs.db, col, id), { ...d, importeLe: new Date().toISOString() }));
        await batch.commit();
      }
      await charger(fs, false);
      setStatus(`Import terminé : ${nv.length} vérification(s), ${nd.length} document(s), ${nf.length} facture(s).`);
    } catch (err) { setStatus("Import impossible : " + err.message); }
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <>
        <div className="toolbar"><h1>Sécurité incendie</h1></div>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "#666", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
        </div></div>
      </>
    );
  }

  const vide = verifs.length === 0 && docs.length === 0;

  return (
    <>
      <Head>
        <title>Sécurité incendie</title>
        <style>{"@page { size: A4 landscape; margin: 6mm; }"}</style>
      </Head>
      <div className="toolbar">
        <h1>Sécurité incendie</h1>
        <div className="quick">
          <button onClick={() => setVue("verifications")} className={vue === "verifications" ? "primary" : ""}>Vérifications incendie</button>
          <button onClick={() => setVue("factures")} className={vue === "factures" ? "primary" : ""}>Factures et coûts</button>
        </div>
        {vue === "verifications" && <button className="primary" onClick={() => setNouveau(n => !n)}>+ Nouveau contrôle</button>}
        <button onClick={() => window.print()}>Imprimer</button>
        <label className="inc-import">
          Importer l&apos;historique
          <input type="file" accept="application/json,.json" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) actions.importer(f); }} />
        </label>
        {changerCode && <button className="ghost" onClick={changerCode}>Changer le code</button>}
        {verrouiller && <button className="ghost" onClick={verrouiller}>Verrouiller</button>}
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        {vue === "factures" ? (
          <Factures factures={factures} types={types} actions={actions} today={today} />
        ) : (
        <div className="recap inc-page">
          <div className="recap-head">
            <div>
              <div className="recap-title">Suivi des vérifications de sécurité incendie</div>
              <div className="recap-sub">Au {fmtFr(today)} · une vérification n&apos;est « à jour » que si elle est sans réserve</div>
            </div>
          </div>

          {vide && (
            <div className="inc-alert inc-alert-info no-print">
              Aucun historique pour l&apos;instant. Utilise « Importer l&apos;historique » (fichier incendie-import.json) ou ajoute une vérification dans chaque type.
            </div>
          )}

          {nouveau && <TypeForm onCancel={() => setNouveau(false)} onSave={(n, m) => { actions.addType(n, m); setNouveau(false); }} />}

          <Bandeau alertes={alertes} onOpen={setOuvert} />

          <div className="tbl-wrap">
            <table className="tbl inc-tbl">
              <thead>
                <tr>
                  <th>Vérification</th><th>Périodicité</th><th>Dernière sans réserve</th>
                  <th>Prochaine échéance</th><th>État</th><th className="no-print"></th>
                </tr>
              </thead>
              <tbody>
                {lignes.map(l => (
                  <LigneType key={l.type.id} l={l} ouvert={ouvert === l.type.id}
                    onToggle={() => setOuvert(ouvert === l.type.id ? null : l.type.id)} actions={actions} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="inc-print-only">
            {lignes.filter(l => l.verifs.length).map(l => (
              <div key={l.type.id} className="inc-print-block">
                <div className="inc-print-title">{l.type.nom} — {periodiciteLabel(l.type.periodiciteMois)}</div>
                <HistoriqueTable l={l} readOnly />
              </div>
            ))}
          </div>
        </div>
        )}
      </div>
      <CodeModal {...codeModalProps} />
    </>
  );
}

// ---- Création d'un contrôle (type + périodicité) ----
function TypeForm({ onSave, onCancel }) {
  const [nom, setNom] = useState("");
  const [mois, setMois] = useState(12);
  const [err, setErr] = useState("");
  return (
    <div className="linen-form inc-form no-print">
      <div className="inc-form-title">Nouveau contrôle</div>
      <div className="linen-form-row">
        <label style={{ flex: 1 }}>Nom du contrôle <input type="text" value={nom} onChange={e => setNom(e.target.value)} placeholder="ex. Ascenseurs" style={{ width: "100%" }} /></label>
        <label>Périodicité
          <select value={mois} onChange={e => setMois(Number(e.target.value))}>
            <option value={0}>Sans échéance</option>
            {PERIODES.map(m => <option key={m} value={m}>{periodiciteLabel(m)}</option>)}
          </select>
        </label>
      </div>
      {err && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{err}</div>}
      <button onClick={() => nom.trim() ? onSave(nom.trim(), mois || null) : setErr("Le nom est obligatoire.")} style={{ background: "#1f3a5f", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 5, cursor: "pointer" }}>Créer le contrôle</button>
      <button onClick={onCancel} className="ghost" style={{ marginLeft: 8 }}>Annuler</button>
    </div>
  );
}

// ---- Bandeau d'alertes ----
function Bandeau({ alertes, onOpen }) {
  if (!alertes.length) {
    return <div className="inc-alert inc-alert-ok">Tout est à jour : aucune échéance sous {SEUIL_BIENTOT_JOURS} jours, aucune réserve à lever.</div>;
  }
  return (
    <div className="inc-alert inc-alert-warn">
      <strong>À traiter :</strong>
      {alertes.map(l => (
        <button key={l.type.id} className={`inc-chip inc-${l.st.etat}`} onClick={() => onOpen(l.type.id)}>
          {l.type.nom} — {chipTexte(l.st)}
        </button>
      ))}
    </div>
  );
}
function chipTexte(st) {
  if (st.etat === "non_conforme") return "réserves à lever (" + st.ouvertes.length + ")";
  if (st.etat === "jamais") return "jamais vérifié";
  if (st.etat === "retard") return "en retard de " + (-st.jours) + " j (échéance " + fmtFr(st.echeance) + ")";
  return "échéance dans " + st.jours + " j (" + fmtFr(st.echeance) + ")";
}

// ---- Ligne du tableau + détail déplié ----
function LigneType({ l, ouvert, onToggle, actions }) {
  const { type, st } = l;
  return (
    <>
      <tr className={`inc-row inc-row-${st.etat}`} onClick={onToggle}>
        <td data-label="Vérification" className="apt">{type.nom}{st.trous.length > 0 && <span className="inc-trou-tag"> · {st.trous.length} trou(s)</span>}</td>
        <td data-label="Périodicité">{periodiciteLabel(type.periodiciteMois)}</td>
        <td data-label="Dernière sans réserve">
          {st.derniere ? <>{fmtFr(st.derniere.date)}{st.derniere.dateAConfirmer && <span className="inc-conf"> (date à confirmer)</span>}</> : "—"}
        </td>
        <td data-label="Prochaine échéance">{st.echeance ? fmtFr(st.echeance) : "—"}</td>
        <td data-label="État"><span className={`inc-badge inc-${st.etat}`}>{ETAT_LABEL[st.etat]}</span></td>
        <td className="no-print inc-open">{ouvert ? "▲" : "▼"}</td>
      </tr>
      {ouvert && (
        <tr className="inc-detail-row no-print">
          <td colSpan={6}><Detail l={l} actions={actions} /></td>
        </tr>
      )}
    </>
  );
}

function Detail({ l, actions }) {
  const { type, st } = l;
  const [form, setForm] = useState(null); // "verif" | "doc"
  const autres = l.docs.filter(d => !d.verificationId);

  return (
    <div className="inc-detail" onClick={e => e.stopPropagation()}>
      {st.ouvertes.length > 0 && (
        <div className="inc-alert inc-alert-bad">
          Non conforme : {st.ouvertes.map(v => `réserves du ${fmtFr(v.date)}`).join(", ")}. Ajoute une vérification SANS réserve (contre-visite) liée à celle-ci pour lever.
        </div>
      )}

      <div className="inc-line">
        <label>Périodicité{" "}
          <select value={type.periodiciteMois || 0} onChange={e => actions.savePeriodicite(type, Number(e.target.value) || null)}>
            <option value={0}>Sans échéance</option>
            {PERIODES.map(m => <option key={m} value={m}>{periodiciteLabel(m)}</option>)}
            {type.periodiciteMois && !PERIODES.includes(type.periodiciteMois) && <option value={type.periodiciteMois}>{periodiciteLabel(type.periodiciteMois)}</option>}
          </select>
        </label>
        <button className="primary" onClick={() => setForm(form === "verif" ? null : "verif")}>+ Ajouter une vérification</button>
        <button onClick={() => setForm(form === "doc" ? null : "doc")}>+ Autre document (devis, facture…)</button>
      </div>

      {form === "verif" && <VerifForm type={type} ouvertes={st.ouvertes} onCancel={() => setForm(null)}
        onSave={p => { actions.addVerif(p); setForm(null); }} />}
      {form === "doc" && <DocForm type={type} onCancel={() => setForm(null)}
        onSave={p => { actions.addDocument(p); setForm(null); }} />}

      <div className="inc-h">Historique des vérifications</div>
      {l.verifs.length === 0 ? <div className="inc-empty">Aucune vérification enregistrée.</div> : (
        <HistoriqueTable l={l} actions={actions} />
      )}
      {st.trous.map((t, i) => (
        <div key={i} className="inc-alert inc-alert-warn">Trou de suivi : rien entre le {fmtFr(t.de)} et le {fmtFr(t.a)} (échéance du {fmtFr(t.echeance)} dépassée).</div>
      ))}

      {autres.length > 0 && (
        <>
          <div className="inc-h">Autres documents</div>
          {autres.map(d => <DocLine key={d.id} d={d} onDelete={() => actions.deleteDocument(d)} />)}
        </>
      )}
    </div>
  );
}

function HistoriqueTable({ l, actions, readOnly }) {
  const byId = Object.fromEntries(l.verifs.map(v => [v.id, v]));
  return (
    <table className="tbl inc-hist">
      <thead><tr><th>Date</th><th>Organisme</th><th>Résultat</th><th>Documents</th>{!readOnly && <th className="no-print"></th>}</tr></thead>
      <tbody>
        {l.verifs.map(v => {
          const ouverte = l.st.ouvertes.some(o => o.id === v.id);
          const ds = l.docs.filter(d => d.verificationId === v.id);
          return (
            <tr key={v.id}>
              <td data-label="Date">{fmtFr(v.date)}{v.dateAConfirmer && <span className="inc-conf"> (à confirmer)</span>}</td>
              <td data-label="Organisme">{v.organisme || "—"}</td>
              <td data-label="Résultat">
                <span className={`inc-badge ${v.resultat === "sans_reserve" ? "inc-conforme" : ouverte ? "inc-non_conforme" : "inc-bientot"}`}>
                  {RESULTATS[v.resultat]}{v.resultat === "avec_reserves" && (ouverte ? " – non levées" : " – levées")}
                </span>
                {v.reserves && <div className="inc-sub">{v.reserves}</div>}
                {v.contreVisiteDe && byId[v.contreVisiteDe] && <div className="inc-sub">Contre-visite des réserves du {fmtFr(byId[v.contreVisiteDe].date)}</div>}
                {v.note && <div className="inc-sub">{v.note}</div>}
              </td>
              <td data-label="Documents">{ds.length ? ds.map(d => <DocLine key={d.id} d={d} compact readOnly={readOnly} onDelete={() => actions?.deleteDocument(d)} />) : "—"}</td>
              {!readOnly && <td className="no-print"><button className="ghost" style={{ color: "#e74c3c" }} onClick={() => actions.deleteVerif(v)}>✕</button></td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DocLine({ d, compact, readOnly, onDelete }) {
  return (
    <div className="inc-doc">
      <span>{!compact && d.date && fmtFr(d.date) + " · "}<strong>{d.nature || "Document"}</strong>{d.reference && d.reference !== "—" ? " " + d.reference : ""}</span>
      {d.objet && !compact && <span className="inc-sub"> — {d.objet}</span>}
      {d.fichierUrl && <a className="inc-link no-print" href={d.fichierUrl} target="_blank" rel="noreferrer">Fichier</a>}
      {d.lienGmail && <a className="inc-link no-print" href={d.lienGmail} target="_blank" rel="noreferrer">Ouvrir le mail</a>}
      {d.lien && <a className="inc-link no-print" href={d.lien} target="_blank" rel="noreferrer">Ouvrir</a>}
      {!readOnly && onDelete && <button className="ghost no-print" style={{ color: "#e74c3c" }} onClick={onDelete}>✕</button>}
    </div>
  );
}

// ---- Envoi d'un fichier vers Firebase Storage ----
async function televerser(file, typeId) {
  if (file.size > MAX_FICHIER) throw new Error("Fichier trop gros (10 Mo maximum).");
  const { app } = await import("../lib/firebase");
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import("firebase/storage");
  const nom = file.name.replace(/[^\w.\-]+/g, "_");
  const r = ref(getStorage(app), `incendie/${typeId}/${Date.now()}_${nom}`);
  await uploadBytes(r, file);
  return { fichierUrl: await getDownloadURL(r), fichierNom: file.name };
}

function PieceJointe({ typeId, value, onChange, setErr }) {
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true); setErr("");
    try { onChange({ ...value, ...(await televerser(f, typeId)) }); }
    catch (err) { setErr("Envoi du fichier impossible (" + err.message + "). Colle plutôt un lien Drive/Gmail."); }
    setBusy(false);
  }
  return (
    <>
      <label style={{ flex: 1, minWidth: 240 }}>Lien vers le document (Gmail, Drive…)
        <input type="url" value={value.lien || ""} onChange={e => onChange({ ...value, lien: e.target.value.trim() })} placeholder="https://…" />
      </label>
      <label>Ou fichier (PDF, photo)
        <input type="file" accept="application/pdf,image/*" onChange={pick} disabled={busy} />
        {busy && <span className="inc-sub">Envoi…</span>}
        {value.fichierNom && <span className="inc-sub">✓ {value.fichierNom}</span>}
      </label>
    </>
  );
}

// ---- Ajout d'une vérification : le résultat est obligatoire ----
function VerifForm({ type, ouvertes, onSave, onCancel }) {
  const [date, setDate] = useState(isoDay(new Date()));
  const [organisme, setOrganisme] = useState("");
  const [resultat, setResultat] = useState(""); // aucun choix par défaut
  const [reserves, setReserves] = useState("");
  const [contre, setContre] = useState(ouvertes[0]?.id || "");
  const [note, setNote] = useState("");
  const [pj, setPj] = useState({});
  const [err, setErr] = useState("");

  function submit() {
    if (!date) return setErr("La date de la vérification est obligatoire.");
    if (!resultat) return setErr("Indique s'il y a des réserves ou non.");
    if (resultat === "avec_reserves" && !reserves.trim()) return setErr("Décris les réserves.");
    const temoin = pj.lien || pj.fichierUrl;
    onSave({
      typeId: type.id, date, organisme: organisme.trim(), resultat,
      reserves: resultat === "avec_reserves" ? reserves.trim() : "",
      contreVisiteDe: resultat === "sans_reserve" && contre ? contre : null,
      note: note.trim(),
      doc: temoin ? { lien: pj.lien || "", fichierUrl: pj.fichierUrl || "", fichierNom: pj.fichierNom || "", nature: "Rapport de vérification" } : null,
    });
  }

  return (
    <div className="linen-form inc-form">
      <div className="inc-form-title">Nouvelle vérification — {type.nom}</div>
      <div className="linen-form-row">
        <label>Date de la vérification <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Organisme <input type="text" value={organisme} onChange={e => setOrganisme(e.target.value)} placeholder="ex. CASI, FINSECUR, SOCOTEC" /></label>
      </div>
      <div className="linen-form-row">
        <PieceJointe typeId={type.id} value={pj} onChange={setPj} setErr={setErr} />
      </div>
      <div className="linen-form-row inc-radios">
        <strong>Le rapport comporte-t-il des réserves ? (obligatoire)</strong>
        <label className="inc-radio"><input type="radio" name="res" checked={resultat === "sans_reserve"} onChange={() => setResultat("sans_reserve")} /> Sans réserve</label>
        <label className="inc-radio"><input type="radio" name="res" checked={resultat === "avec_reserves"} onChange={() => setResultat("avec_reserves")} /> Avec réserves</label>
      </div>
      {resultat === "avec_reserves" && (
        <div className="linen-form-row">
          <label style={{ flex: 1 }}>Description des réserves
            <textarea rows={3} value={reserves} onChange={e => setReserves(e.target.value)} style={{ width: "100%" }} />
          </label>
          <div className="inc-sub" style={{ flexBasis: "100%" }}>Le contrôle restera « non conforme » jusqu&apos;à une contre-visite sans réserve.</div>
        </div>
      )}
      {resultat === "sans_reserve" && ouvertes.length > 0 && (
        <div className="linen-form-row">
          <label>Cette vérification lève les réserves du…
            <select value={contre} onChange={e => setContre(e.target.value)}>
              {ouvertes.map(v => <option key={v.id} value={v.id}>{fmtFr(v.date)} — {v.reserves?.slice(0, 50)}</option>)}
              <option value="">Aucune (vérification indépendante)</option>
            </select>
          </label>
        </div>
      )}
      <div className="linen-form-row">
        <label style={{ flex: 1 }}>Note (optionnel) <input type="text" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%" }} /></label>
      </div>
      {err && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{err}</div>}
      <button className="primary" onClick={submit} style={{ background: "#1f3a5f", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 5, cursor: "pointer" }}>Enregistrer la vérification</button>
      <button onClick={onCancel} className="ghost" style={{ marginLeft: 8 }}>Annuler</button>
    </div>
  );
}

// ---- Document sans résultat (devis, facture, échange…) ----
function DocForm({ type, onSave, onCancel }) {
  const [date, setDate] = useState(isoDay(new Date()));
  const [nature, setNature] = useState("Devis");
  const [reference, setReference] = useState("");
  const [objet, setObjet] = useState("");
  const [pj, setPj] = useState({});
  const [err, setErr] = useState("");
  function submit() {
    if (!pj.lien && !pj.fichierUrl) return setErr("Ajoute un lien ou un fichier.");
    onSave({ typeId: type.id, verificationId: null, date, nature: nature.trim(), reference: reference.trim(), objet: objet.trim(),
      lienGmail: "", lien: pj.lien || "", fichierUrl: pj.fichierUrl || "", fichierNom: pj.fichierNom || "" });
  }
  return (
    <div className="linen-form inc-form">
      <div className="inc-form-title">Nouveau document — {type.nom}</div>
      <div className="inc-sub" style={{ marginBottom: 8 }}>Pour un rapport de vérification, utilise plutôt « Ajouter une vérification » (réserves obligatoires).</div>
      <div className="linen-form-row">
        <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Nature <input type="text" value={nature} onChange={e => setNature(e.target.value)} /></label>
        <label>Référence <input type="text" value={reference} onChange={e => setReference(e.target.value)} /></label>
      </div>
      <div className="linen-form-row"><label style={{ flex: 1 }}>Objet <input type="text" value={objet} onChange={e => setObjet(e.target.value)} style={{ width: "100%" }} /></label></div>
      <div className="linen-form-row"><PieceJointe typeId={type.id} value={pj} onChange={setPj} setErr={setErr} /></div>
      {err && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{err}</div>}
      <button onClick={submit} style={{ background: "#1f3a5f", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 5, cursor: "pointer" }}>Enregistrer le document</button>
      <button onClick={onCancel} className="ghost" style={{ marginLeft: 8 }}>Annuler</button>
    </div>
  );
}

// ---- Factures et coûts ----
function euros(n) {
  return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function Factures({ factures, types, actions, today }) {
  const annees = [...new Set(factures.map(f => (f.date || "").slice(0, 4)).filter(Boolean).concat(today.slice(0, 4)))].sort().reverse();
  const [annee, setAnnee] = useState("toutes");
  const [form, setForm] = useState(false);
  const nomType = id => types.find(t => t.id === id)?.nom || "Hors contrôle";
  const liste = factures.filter(f => annee === "toutes" || (f.date || "").startsWith(annee)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const total = liste.reduce((s, f) => s + Number(f.montantTTC || 0), 0);
  const totalHT = liste.reduce((s, f) => s + Number(f.montantHT || 0), 0);
  const somme = (cle) => {
    const m = {};
    liste.forEach(f => { const k = cle(f); m[k] = (m[k] || 0) + Number(f.montantTTC || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  return (
    <div className="recap inc-page">
      <div className="recap-head">
        <div>
          <div className="recap-title">Factures de sécurité incendie</div>
          <div className="recap-sub">Vérifications, contrats et interventions (même hors contrôle obligatoire)</div>
        </div>
        <div className="recap-total"><div className="n">{euros(total)}</div><div className="l">TTC · {annee === "toutes" ? "toutes années" : annee}</div></div>
      </div>

      <div className="inc-line no-print">
        <label>Année{" "}
          <select value={annee} onChange={e => setAnnee(e.target.value)}>
            <option value="toutes">Toutes</option>
            {annees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <button className="primary" onClick={() => setForm(f => !f)}>{form ? "Annuler" : "+ Ajouter une facture"}</button>
      </div>
      {form && <FactureForm types={types} onCancel={() => setForm(false)} onSave={p => { actions.addFacture(p); setForm(false); }} />}

      {liste.length > 0 && (
        <div className="inc-cout-grid">
          <CoutBloc titre="Par contrôle" lignes={somme(f => nomType(f.typeId))} />
          <CoutBloc titre="Par nature" lignes={somme(f => CATEGORIES_FACTURE[f.categorie] || "Autre")} />
          <CoutBloc titre="Par fournisseur" lignes={somme(f => f.fournisseur || "—")} />
        </div>
      )}

      <div className="tbl-wrap">
        <table className="tbl inc-tbl inc-fact">
          <thead><tr><th>Date</th><th>Fournisseur</th><th>Contrôle</th><th>Nature</th><th>Objet</th><th>HT</th><th>TTC</th><th className="no-print"></th></tr></thead>
          <tbody>
            {liste.length === 0 && <tr><td colSpan={8} className="inc-empty">Aucune facture sur cette période.</td></tr>}
            {liste.map(f => (
              <tr key={f.id}>
                <td data-label="Date">{fmtFr(f.date)}</td>
                <td data-label="Fournisseur">{f.fournisseur || "—"}</td>
                <td data-label="Contrôle">{nomType(f.typeId)}</td>
                <td data-label="Nature">{CATEGORIES_FACTURE[f.categorie] || "—"}</td>
                <td data-label="Objet">{f.objet}{f.reference ? <span className="inc-sub"> · {f.reference}</span> : null}
                  {f.fichierUrl && <a className="inc-link no-print" href={f.fichierUrl} target="_blank" rel="noreferrer"> Fichier</a>}
                  {f.lien && <a className="inc-link no-print" href={f.lien} target="_blank" rel="noreferrer"> Ouvrir</a>}
                  {f.lienGmail && <a className="inc-link no-print" href={f.lienGmail} target="_blank" rel="noreferrer"> Ouvrir le mail</a>}
                  {f.note && <div className="inc-sub">{f.note}</div>}
                </td>
                <td data-label="HT">{f.montantHT != null && f.montantHT !== "" ? euros(f.montantHT) : "—"}</td>
                <td data-label="TTC"><strong>{euros(f.montantTTC)}</strong></td>
                <td className="no-print"><button className="ghost" style={{ color: "#e74c3c" }} onClick={() => actions.deleteFacture(f)}>✕</button></td>
              </tr>
            ))}
          </tbody>
          {liste.length > 0 && <tfoot><tr><td colSpan={5}><strong>Total</strong></td><td>{totalHT ? euros(totalHT) : ""}</td><td><strong>{euros(total)}</strong></td><td className="no-print"></td></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

function CoutBloc({ titre, lignes }) {
  return (
    <div className="inc-cout">
      <div className="inc-h" style={{ marginTop: 0 }}>{titre}</div>
      {lignes.map(([k, v]) => <div key={k} className="inc-cout-ligne"><span>{k}</span><strong>{euros(v)}</strong></div>)}
    </div>
  );
}

function FactureForm({ types, onSave, onCancel }) {
  const [date, setDate] = useState(isoDay(new Date()));
  const [fournisseur, setFournisseur] = useState("");
  const [typeId, setTypeId] = useState("");
  const [categorie, setCategorie] = useState("intervention");
  const [objet, setObjet] = useState("");
  const [reference, setReference] = useState("");
  const [ttc, setTtc] = useState("");
  const [ht, setHt] = useState("");
  const [pj, setPj] = useState({});
  const [err, setErr] = useState("");

  function submit() {
    if (!date) return setErr("La date est obligatoire.");
    if (!objet.trim()) return setErr("Indique l'objet de la facture.");
    if (ttc === "" || isNaN(Number(ttc))) return setErr("Le montant TTC est obligatoire.");
    onSave({
      date, fournisseur: fournisseur.trim(), typeId: typeId || null, categorie, objet: objet.trim(), reference: reference.trim(),
      montantTTC: Number(ttc), montantHT: ht === "" ? null : Number(ht),
      lien: pj.lien || "", fichierUrl: pj.fichierUrl || "", fichierNom: pj.fichierNom || "",
    });
  }

  return (
    <div className="linen-form inc-form no-print">
      <div className="inc-form-title">Nouvelle facture</div>
      <div className="linen-form-row">
        <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Fournisseur <input type="text" value={fournisseur} onChange={e => setFournisseur(e.target.value)} placeholder="ex. FINSECUR" /></label>
        <label>Contrôle concerné
          <select value={typeId} onChange={e => setTypeId(e.target.value)}>
            <option value="">Aucun (hors contrôle)</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </label>
        <label>Nature
          <select value={categorie} onChange={e => setCategorie(e.target.value)}>
            {Object.entries(CATEGORIES_FACTURE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <div className="linen-form-row">
        <label style={{ flex: 1 }}>Objet <input type="text" value={objet} onChange={e => setObjet(e.target.value)} placeholder="ex. Détecteur remplacé 1er étage" style={{ width: "100%" }} /></label>
        <label>N° de facture <input type="text" value={reference} onChange={e => setReference(e.target.value)} /></label>
        <label>Montant TTC € <input type="number" min="0" step="0.01" value={ttc} onChange={e => setTtc(e.target.value)} style={{ width: 120 }} /></label>
        <label>Montant HT € <input type="number" min="0" step="0.01" value={ht} onChange={e => setHt(e.target.value)} style={{ width: 120 }} /></label>
      </div>
      <div className="linen-form-row"><PieceJointe typeId="factures" value={pj} onChange={setPj} setErr={setErr} /></div>
      {err && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{err}</div>}
      <button onClick={submit} style={{ background: "#1f3a5f", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 5, cursor: "pointer" }}>Enregistrer la facture</button>
      <button onClick={onCancel} className="ghost" style={{ marginLeft: 8 }}>Annuler</button>
    </div>
  );
}

export default function IncendiePage() {
  return <IncendieAcces>{props => <Incendie {...props} />}</IncendieAcces>;
}
