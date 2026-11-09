// pages/codes/admin/connexion.js
// Connexion à l'espace admin. Adresse volontairement non liée dans l'application :
// le réceptionniste ne la voit nulle part. Même s'il la trouve, il lui faut le mot
// de passe admin (vérifié côté serveur, /api/admin/login).
import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";
import { adminLoginPageProps } from "../../../lib/adminAuth";

export function getServerSideProps(ctx) {
  return adminLoginPageProps(ctx);
}

export default function ConnexionAdmin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { router.replace("/codes/admin"); return; }
      setErr(d.error || "Connexion refusée.");
      setPassword("");
    } catch {
      setErr("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head><title>Connexion admin</title><meta name="robots" content="noindex" /></Head>
      <div className="menage-page codes-page">
        <div className="recap" style={{ maxWidth: 360 }}>
          <div className="recap-title">Connexion admin</div>
          <form onSubmit={submit} className="linen-form">
            <label>Mot de passe admin
              <input type="password" autoComplete="current-password" autoFocus value={password}
                onChange={e => { setPassword(e.target.value); setErr(""); }} />
            </label>
            {err && <div className="gate-err">{err}</div>}
            <div style={{ marginTop: 10 }}>
              <button className="primary" type="submit" disabled={busy}>{busy ? "…" : "Se connecter"}</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
