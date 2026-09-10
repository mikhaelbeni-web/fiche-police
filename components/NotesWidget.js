// components/NotesWidget.js
// Petit logo notes discret, présent sur TOUTES les pages (monté une fois dans
// _app.js). Une seule note, partagée par toute l'équipe — tout le monde voit
// et modifie la même. S'ouvre dans un panneau sur le côté, sans jamais fermer
// ni recharger la page en cours.
import { useState, useEffect, useRef } from "react";

export default function NotesWidget() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [fs, setFs] = useState(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [status, setStatus] = useState("");
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { doc, getDoc, setDoc, onSnapshot } = await import("firebase/firestore");
      const api = { db, doc, getDoc, setDoc };
      setFs(api);
      const ref = api.doc(api.db, "shared_notes", "main");
      const snap = await api.getDoc(ref);
      if (snap.exists()) { setContent(snap.data().content || ""); setSavedContent(snap.data().content || ""); }
      setReady(true);
      // Live : si quelqu'un d'autre modifie la note pendant qu'elle est ouverte,
      // ça se met à jour tout seul.
      onSnapshot(ref, s => {
        if (!s.exists()) return;
        const c = s.data().content || "";
        setSavedContent(c);
        setContent(prev => (document.activeElement?.id === "shared-note-textarea" ? prev : c));
      });
    })();
  }, []);

  function onChange(v) {
    setContent(v);
    setStatus("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(v), 700); // auto-sauvegarde après une pause de frappe
  }

  async function save(v) {
    if (!fs) return;
    try {
      await fs.setDoc(fs.doc(fs.db, "shared_notes", "main"), { content: v, updatedAt: new Date().toISOString() });
      setSavedContent(v);
      setStatus("Enregistré");
      setTimeout(() => setStatus(""), 1500);
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  if (!ready) return null;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notes"
        className="notes-fab"
        title="Notes de l'équipe"
      >
        📝
      </button>

      {open && (
        <div className="notes-panel">
          <div className="notes-panel-head">
            <span>Notes de l&apos;équipe</span>
            <button onClick={() => setOpen(false)} className="notes-panel-close" aria-label="Fermer">✕</button>
          </div>
          <div className="notes-panel-sub">Partagées par toute l&apos;équipe — visibles sur toutes les pages</div>
          <textarea
            id="shared-note-textarea"
            className="notes-panel-textarea"
            value={content}
            onChange={e => onChange(e.target.value)}
            placeholder="Petites notes, rappels du jour à ne pas oublier…"
          />
          <div className="notes-panel-status">{status}</div>
        </div>
      )}
    </>
  );
}
