// components/Gate.js
// Verrou d'accès partagé. Vérification du code CÔTÉ SERVEUR (/api/auth).
// Le code n'est jamais présent dans le bundle navigateur.
import { useState, useEffect } from "react";
import { ensureFirebaseAuth } from "../lib/firebaseAuth";

// Connexion Firebase avant d'afficher l'app (les règles Firestore l'exigent).
// Ne bloque jamais plus de 8 s : en cas d'échec, l'app s'ouvre quand même.
function connecterFirebase() {
  const delai = new Promise(res => setTimeout(res, 8000));
  return Promise.race([ensureFirebaseAuth().catch(e => console.error("Firebase Auth", e)), delai]);
}

export default function Gate({ children }) {
  const [state, setState] = useState("checking"); // checking | locked | unlocked
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // Lancée en parallèle de la vérification du cookie : sur un poste déjà
    // connecté, la session Firebase est relue localement pendant ce temps.
    const fb = connecterFirebase();
    fetch("/api/auth", { method: "GET" })
      .then(r => r.json())
      .then(async d => {
        if (d.authenticated) await fb;
        if (alive) setState(d.authenticated ? "unlocked" : "locked");
      })
      .catch(() => { if (alive) setState("locked"); });
    return () => { alive = false; };
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await r.json();
      if (d.authenticated) { await connecterFirebase(); setState("unlocked"); }
      else { setErr(d.error || "Code incorrect"); setCode(""); }
    } catch {
      setErr("Erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return null;
  if (state === "unlocked") return children;

  return (
    <div className="gate">
      <div className="gate-box">
        <div className="gate-title">Résidences</div>
        <div className="gate-sub">Code d&apos;accès requis</div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={code}
          onChange={e => { setCode(e.target.value); setErr(""); }}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Code"
          className={err ? "err" : ""}
        />
        {err && <div className="gate-err">{err}</div>}
        <button onClick={submit} disabled={busy}>{busy ? "…" : "Déverrouiller"}</button>
      </div>
    </div>
  );
}
