// components/Gate.js
// Verrou d'accès partagé. Vérification du code CÔTÉ SERVEUR (/api/auth).
// Le code n'est jamais présent dans le bundle navigateur.
// Une fois le code validé, le serveur délivre aussi un jeton Firebase (compte de
// service) : on s'y connecte avant d'afficher l'app, pour que les règles Firestore
// puissent exiger request.auth != null (accès direct à la base impossible sans
// être passé par ce gate, même en connaissant les clés Firebase publiques).
import { useState, useEffect } from "react";

async function signInToFirebase(firebaseToken) {
  if (!firebaseToken) { console.warn("[Gate] Pas de firebaseToken reçu depuis /api/auth (compte de service absent/mal configuré côté serveur)."); return; }
  try {
    const { isFirebaseConfigured, getAppAuth } = await import("../lib/firebase");
    if (!isFirebaseConfigured()) return;
    const { signInWithCustomToken } = await import("firebase/auth");
    await signInWithCustomToken(getAppAuth(), firebaseToken);
    console.info("[Gate] Connexion Firebase OK.");
  } catch (e) {
    // Pas bloquant : si le compte de service n'est pas encore configuré côté
    // Vercel, l'app reste utilisable, seules les règles Firestore doivent alors
    // rester provisoirement ouvertes (voir README-FIREBASE.md).
    console.error("[Gate] Échec de connexion Firebase :", e?.code || e?.message || e);
  }
}

export default function Gate({ children }) {
  const [state, setState] = useState("checking"); // checking | locked | unlocked
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth", { method: "GET" })
      .then(r => r.json())
      .then(async d => {
        if (!alive) return;
        if (d.authenticated) {
          await signInToFirebase(d.firebaseToken);
          if (alive) setState("unlocked");
        } else {
          setState("locked");
        }
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
      if (d.authenticated) {
        await signInToFirebase(d.firebaseToken);
        setState("unlocked");
      } else {
        setErr(d.error || "Code incorrect"); setCode("");
      }
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
