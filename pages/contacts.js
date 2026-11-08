// pages/contacts.js
// Répertoire des contacts (sociétés/fournisseurs) : nom, société, un ou plusieurs
// numéros de téléphone. Création, consultation, modification, suppression à tout moment.
// Persistance Firebase.

import { useState, useEffect, useRef } from "react";
import Head from "next/head";

function emptyForm() {
  return { nom: "", societe: "", telephones: [""] };
}

// Lien d'appel pour un numéro affiché (téléphone : appel en un tap).
// Retourne null si la valeur ne ressemble pas à un numéro (ex. un e-mail).
function telHref(t) {
  if (!t || /[@a-z]/i.test(t)) return null;
  const n = t.replace(/[^\d+]/g, "");
  return n.replace(/\D/g, "").length >= 3 ? "tel:" + n : null;
}

function Contacts() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [fs, setFs] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const formRef = useRef(null);

  // Téléphone : le formulaire s'ouvre en haut de la liste — on le ramène à
  // l'écran après « Modifier » sur une ligne basse (présentation seulement).
  useEffect(() => {
    if (!showForm || !formRef.current || typeof window === "undefined") return;
    if (window.matchMedia && window.matchMedia("(max-width: 640px)").matches) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showForm, editId]);

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
    const snap = await api.getDocs(api.query(api.collection(api.db, "contacts"), api.orderBy("nom", "asc")));
    setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    setStatus("");
  }

  function openNew() {
    setEditId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEdit(c) {
    setEditId(c.id);
    setForm({
      nom: c.nom || "", societe: c.societe || "",
      telephones: c.telephones && c.telephones.length ? c.telephones : [""],
    });
    setShowForm(true);
  }

  function updatePhone(i, val) {
    const t = [...form.telephones];
    t[i] = val;
    setForm({ ...form, telephones: t });
  }
  function addPhoneField() {
    setForm({ ...form, telephones: [...form.telephones, ""] });
  }
  function removePhoneField(i) {
    const t = form.telephones.filter((_, idx) => idx !== i);
    setForm({ ...form, telephones: t.length ? t : [""] });
  }

  async function save() {
    if (!form.nom.trim()) { setStatus("Le nom est requis."); return; }
    const cleanTel = form.telephones.map(t => t.trim()).filter(Boolean);
    try {
      setStatus("Enregistrement…");
      const payload = {
        nom: form.nom.trim(), societe: form.societe.trim(), telephones: cleanTel,
      };
      if (editId) {
        await fs.updateDoc(fs.doc(fs.db, "contacts", editId), payload);
      } else {
        await fs.addDoc(fs.collection(fs.db, "contacts"), { ...payload, createdAt: new Date().toISOString() });
      }
      setShowForm(false);
      await loadAll(fs);
      setStatus("Contact enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function del(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce contact ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "contacts", id));
    await loadAll(fs);
  }

  if (!ready) return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;
  if (!configured) {
    return (
      <>
        <div className="toolbar"><h1>Contacts</h1></div>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Voir README-FIREBASE.md pour activer cet onglet.</p>
        </div></div>
      </>
    );
  }

  const filtered = contacts.filter(c => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (c.nom || "").toLowerCase().includes(s)
      || (c.societe || "").toLowerCase().includes(s)
      || (c.telephones || []).some(t => t.includes(search));
  });

  return (
    <>
      <Head><title>Contacts</title></Head>
      <div className="toolbar contacts-toolbar">
        <h1>Contacts</h1>
        <div className="field">
          <label>Rechercher</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="nom, société, numéro…" style={{ minWidth: 200 }} />
        </div>
        <button className="primary" onClick={openNew}>+ Nouveau contact</button>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page contacts-page">
        <div className="recap">
          {showForm && (
            <div className="linen-form contacts-form" ref={formRef} style={{ marginBottom: 18 }}>
              <div className="form-title">
                {editId ? "Modifier le contact" : "Nouveau contact"}
              </div>
              <div className="linen-form-row">
                <label>Nom <input type="text" value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} style={{ width: 200 }} /></label>
                <label>Société <input type="text" value={form.societe} onChange={e => setForm({ ...form, societe: e.target.value })} style={{ width: 220 }} /></label>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div className="panel-title">Numéros de téléphone</div>
                {form.telephones.map((t, i) => (
                  <div key={i} className="phone-row" style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <input type="text" value={t} onChange={e => updatePhone(i, e.target.value)} placeholder="06 12 34 56 78" style={{ width: 180 }} />
                    <button onClick={() => removePhoneField(i)} className="ghost danger icon-btn" title="Supprimer" aria-label="Supprimer">✕</button>
                  </div>
                ))}
                <button onClick={addPhoneField} className="ghost">+ Ajouter un numéro</button>
              </div>
              <div className="contacts-form-actions" style={{ display: "flex", gap: 8 }}>
                <button className="primary" onClick={save}>Enregistrer</button>
                <button onClick={() => setShowForm(false)}>Annuler</button>
              </div>
              {status && <div className="contacts-form-status">{status}</div>}
            </div>
          )}

          <div className="tbl-wrap"><table className="tbl tbl-cards contacts-tbl">
            <thead>
              <tr><th>Nom</th><th>Société</th><th>Téléphone(s)</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td className="apt card-title">{c.nom}</td>
                  <td data-label="Société">{c.societe || "—"}</td>
                  <td data-label="Téléphone(s)" className="card-full contacts-tels">
                    {(c.telephones || []).length ? (
                      <>
                        {/* Ordinateur / impression : texte inchangé. Téléphone : un bouton d'appel par numéro. */}
                        <span className="contacts-tel-plain">{c.telephones.join(" · ")}</span>
                        <span className="contacts-tel-links">
                          {c.telephones.map((t, i) => {
                            const href = telHref(t);
                            return href
                              ? <a key={i} href={href} className="contacts-tel-link">📞 {t}</a>
                              : <span key={i} className="contacts-tel-text">{t}</span>;
                          })}
                        </span>
                      </>
                    ) : "—"}
                  </td>
                  <td className="contacts-actions" style={{ whiteSpace: "nowrap" }}>
                    <button onClick={() => openEdit(c)} className="ghost">Modifier</button>
                    <button onClick={() => del(c.id)} className="ghost danger icon-btn" title="Supprimer" aria-label="Supprimer">✕</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={4} className="empty-state">Aucun contact.</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}

export default function ContactsPage() {
  return <Contacts />;
}
