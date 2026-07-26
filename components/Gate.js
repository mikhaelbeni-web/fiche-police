// components/Gate.js
// Verrou d'accès partagé. Vérification du code CÔTÉ SERVEUR (/api/auth).
// Le code n'est jamais présent dans le bundle navigateur.
import { useState, useEffect } from "react";

export default function Gate({ children }) {
  const [state, setState] = useState("checking"); // checking | locked | unlocked
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth", { method: "GET" })
      .then(r => r.json())
      .then(d => { if (alive) setState(d.authenticated ? "unlocked" : "locked"); })
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
      if (d.authenticated) setState("unlocked");
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
