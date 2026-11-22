// components/Gate.js
// Verrou d'accès partagé. Vérification du code CÔTÉ SERVEUR (/api/auth).
// Le code n'est jamais présent dans le bundle navigateur.
// La session dure 5 h après la saisie du code : passé ce délai, le verrou se referme
// tout seul (même si la page est restée ouverte) et il faut retaper le code.
import { useState, useEffect } from "react";
import { useEcheance, echeanceDepuisServeur } from "../hooks/useEcheance";

export default function Gate({ children }) {
  const [state, setState] = useState("checking"); // checking | locked | unlocked
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [echeance, setEcheance] = useState(null);
  const [expiree, setExpiree] = useState(false);

  useEcheance(echeance, () => {
    setEcheance(null); setCode(""); setErr(""); setExpiree(true); setState("locked");
  });

  // L'horloge locale ne suffit pas (veille de l'ordinateur, onglet resté ouvert,
  // cookie effacé) : au retour sur l'onglet, on redemande au serveur si la session
  // du code d'accès est toujours valide, et on referme le verrou sinon.
  useEffect(() => {
    if (state !== "unlocked") return undefined;
    let enCours = false;
    const reverifier = () => {
      if (enCours || document.visibilityState === "hidden") return;
      enCours = true;
      fetch("/api/auth", { method: "GET", cache: "no-store" })
        .then(r => r.json())
        .then(d => {
          if (d.authenticated) setEcheance(echeanceDepuisServeur(d.expiresAt, d.serverNowMs));
          else { setEcheance(null); setCode(""); setErr(""); setExpiree(true); setState("locked"); }
        })
        .catch(() => { /* réseau coupé : on garde l'état, le minuteur reste actif */ })
        .finally(() => { enCours = false; });
    };
    document.addEventListener("visibilitychange", reverifier);
    window.addEventListener("focus", reverifier);
    return () => {
      document.removeEventListener("visibilitychange", reverifier);
      window.removeEventListener("focus", reverifier);
    };
  }, [state]);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth", { method: "GET", cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        setEcheance(d.authenticated ? echeanceDepuisServeur(d.expiresAt, d.serverNowMs) : null);
        setState(d.authenticated ? "unlocked" : "locked");
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
        setEcheance(echeanceDepuisServeur(d.expiresAt, d.serverNowMs));
        setExpiree(false); setCode("");
        setState("unlocked");
      }
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
        <div className="gate-sub">{expiree ? "Session terminée (5 h) : retape le code" : "Code d\u2019accès requis"}</div>
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
