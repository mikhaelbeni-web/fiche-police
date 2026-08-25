// components/CodeModal.js
// Petite fenêtre pour saisir un code de protection (2305, etc.) avec un champ
// masqué (type="password", donc affiché en points) — contrairement à prompt()
// qui affiche toujours le texte en clair et ne peut pas être masqué.
import { useState, useEffect, useRef } from "react";

export default function CodeModal({ open, title, onSubmit, onCancel }) {
  const [code, setCode] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setCode(""); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  if (!open) return null;

  function submit() {
    const c = code;
    setCode("");
    onSubmit(c);
  }

  return (
    <div className="code-modal-overlay" onClick={onCancel}>
      <div className="code-modal" onClick={e => e.stopPropagation()}>
        <div className="code-modal-title">{title || "Code requis"}</div>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          className="code-modal-input"
        />
        <div className="code-modal-actions">
          <button onClick={submit} className="primary">Valider</button>
          <button onClick={onCancel} className="ghost">Annuler</button>
        </div>
      </div>
    </div>
  );
}
