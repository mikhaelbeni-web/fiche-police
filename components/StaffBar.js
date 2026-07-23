// components/StaffBar.js
// Barre d'identification légère ("qui es-tu ?") partagée entre les pages qui ont
// besoin de savoir qui fait l'action (checklist, arrivées…). Voir lib/staff.js.
import { useState } from "react";

export default function StaffBar({ current, list, onPick, onAdd, compact }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (!current) {
    return (
      <div className={`staffbar staffbar-pick${compact ? " compact" : ""}`}>
        <span className="staffbar-label">Qui es-tu ?</span>
        {list.map(n => (
          <button key={n} className="staff-chip" onClick={() => onPick(n)}>{n}</button>
        ))}
        {!adding && <button className="staff-chip ghost" onClick={() => setAdding(true)}>+ Ajouter mon prénom</button>}
        {adding && (
          <span className="staff-add">
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="Prénom" onKeyDown={e => e.key === "Enter" && name.trim() && onAdd(name.trim())} />
            <button onClick={() => name.trim() && onAdd(name.trim())}>OK</button>
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={`staffbar${compact ? " compact" : ""}`}>
      <span className="staffbar-label">Connecté(e) :</span>
      <span className="staff-chip current">{current}</span>
      <button className="staffbar-switch" onClick={() => onPick("")}>Changer</button>
    </div>
  );
}
