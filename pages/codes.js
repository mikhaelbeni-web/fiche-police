// pages/codes.js
// Codes des boîtes à clés statiques par résidence (ménage, garde-bagages, portail...).
// Création, consultation, modification, suppression à tout moment. Persistance Firebase.

import { useState, useEffect } from "react";
import Head from "next/head";

function emptyForm() {
  return { residence: "", emplacement: "", code: "" };
}

// Codes connus pour Lantiez (Levloft), extraits du fichier fourni par l'exploitant.
const LANTIEZ_KNOWN_CODES = [
  { residence: "Lantiez", emplacement: "Portail", code: "1406" },
  { residence: "Lantiez", emplacement: "Universel appartements A1 à A8", code: "141995" },
  { residence: "Lantiez", emplacement: "Accès sous-sol (boîte à clé)", code: "3817" },
  { residence: "Lantiez", emplacement: "Accès local staff sous-sol (boîte à clé)", code: "1814" },
  { residence: "Lantiez", emplacement: "Consigne bagages — Cabine 1 (deux compartiments)", code: "1112" },
  { residence: "Lantiez", emplacement: "Consigne bagages — Cabine 2", code: "2223" },
  { residence: "Lantiez", emplacement: "Consigne bagages — Cabine 3", code: "3334" },
  { residence: "Lantiez", emplacement: "Consigne bagages — Cabine 4", code: "4445" },
  { residence: "Lantiez", emplacement: "Consigne bagages — Cabine 5 (livraisons Amazon)", code: "5551" },
];

function Codes() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [codes, setCodes] = useState([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadAll(api);
      setReady(true);
    })();
  }, []);

  async function loadAll(api) {
    setStatus("Chargement…");
    const snap = await api.getDocs(api.query(api.collection(api.db, "access_codes"), api.orderBy("residence", "asc")));
    setCodes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setStatus("");
  }

  function openNew() {
    setEditId(null);
    setForm(emptyForm());
    setShowForm(true);
  }
  function openEdit(c) {
    setEditId(c.id);
    setForm({ residence: c.residence || "", emplacement: c.emplacement || "", code: c.code || "" });
    setShowForm(true);
  }

  async function save() {
    if (!form.residence.trim() || !form.emplacement.trim() || !form.code.trim()) {
      setStatus("Résidence, emplacement et code sont requis.");
      return;
    }
    try {
      setStatus("Enregistrement…");
      const payload = { residence: form.residence.trim(), emplacement: form.emplacement.trim(), code: form.code.trim() };
      if (editId) await fs.updateDoc(fs.doc(fs.db, "access_codes", editId), payload);
      else await fs.addDoc(fs.collection(fs.db, "access_codes"), { ...payload, createdAt: new Date().toISOString() });
      setShowForm(false);
      await loadAll(fs);
      setStatus("Code enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function del(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce code ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "access_codes", id));
    await loadAll(fs);
  }

  async function importLantiez() {
    const existing = new Set(codes.filter(c => c.residence === "Lantiez").map(c => c.emplacement));
    const toAdd = LANTIEZ_KNOWN_CODES.filter(c => !existing.has(c.emplacement));
    if (toAdd.length === 0) { setStatus("Les codes Lantiez connus sont déjà tous présents."); return; }
    if (!confirm(`Importer ${toAdd.length} code(s) Lantiez connu(s) ?`)) return;
    try {
      setStatus("Import…");
      for (const c of toAdd) {
        await fs.addDoc(fs.collection(fs.db, "access_codes"), { ...c, createdAt: new Date().toISOString() });
      }
      await loadAll(fs);
      setStatus(`${toAdd.length} code(s) importé(s).`);
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <>
        <div className="toolbar"><h1>Codes</h1></div>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "#666", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
        </div></div>
      </>
    );
  }

  const filtered = codes.filter(c => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (c.residence || "").toLowerCase().includes(s)
      || (c.emplacement || "").toLowerCase().includes(s)
      || (c.code || "").includes(search);
  });

  const byResidence = {};
  for (const c of filtered) {
    if (!byResidence[c.residence]) byResidence[c.residence] = [];
    byResidence[c.residence].push(c);
  }
  const residences = Object.keys(byResidence).sort((a, b) => a.localeCompare(b));

  return (
    <>
      <Head><title>Codes d&apos;accès</title></Head>
      <div className="toolbar">
        <h1>Codes</h1>
        <div className="field">
          <label>Rechercher</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="résidence, emplacement, code…" style={{ minWidth: 200 }} />
        </div>
        <button className="primary" onClick={openNew}>+ Nouveau code</button>
        <button onClick={importLantiez}>Importer codes Lantiez connus</button>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page">
        <div className="recap">
          {showForm && (
            <div className="linen-form" style={{ marginBottom: 18 }}>
              <div className="recap-title" style={{ fontSize: 15, marginBottom: 10 }}>
                {editId ? "Modifier le code" : "Nouveau code"}
              </div>
              <div className="linen-form-row">
                <label>Résidence <input type="text" value={form.residence} onChange={e => setForm({ ...form, residence: e.target.value })} placeholder="ex. Lantiez, Villiers, Belleville" style={{ width: 180 }} /></label>
                <label>Emplacement <input type="text" value={form.emplacement} onChange={e => setForm({ ...form, emplacement: e.target.value })} placeholder="ex. boîte à clé ménage, portail…" style={{ width: 260 }} /></label>
                <label>Code <input type="text" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} style={{ width: 120 }} /></label>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="primary" onClick={save}>Enregistrer</button>
                <button onClick={() => setShowForm(false)}>Annuler</button>
              </div>
            </div>
          )}

          {residences.map(r => (
            <div className="resid" key={r}>
              <div className="resid-head"><span className="resid-name">{r}</span><span className="resid-count">{byResidence[r].length} code(s)</span></div>
              <table className="tbl">
                <thead><tr><th>Emplacement</th><th>Code</th><th></th></tr></thead>
                <tbody>
                  {byResidence[r].map(c => (
                    <tr key={c.id}>
                      <td>{c.emplacement}</td>
                      <td style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 14 }}>{c.code}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button onClick={() => openEdit(c)} className="ghost" style={{ color: "#2980b9" }}>Modifier</button>
                        <button onClick={() => del(c.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {residences.length === 0 && <div className="empty-state">Aucun code enregistré.</div>}
        </div>
      </div>
    </>
  );
}

export default function CodesPage() {
  return <Codes />;
}
