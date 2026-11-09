// pages/codes/admin/index.js
// Espace admin (sous-onglet de « Codes d'accès »). Espace de développement et de
// test : il servira à construire et valider le croisement serrures igloohome ×
// réservations Hostaway avant toute mise en production.
// Protection CÔTÉ SERVEUR : getServerSideProps renvoie 404 à tout non-admin
// (voir lib/adminAuth.js) ; la page n'est jamais envoyée sans session admin.
import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";
import CodesTabs from "../../../components/CodesTabs";
import { adminPageProps } from "../../../lib/adminAuth";

export function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

function heure(sec) {
  return new Date(sec * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
}

export default function EspaceAdmin({ adminExpiresAt }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try { await fetch("/api/admin/logout", { method: "POST" }); } catch { /* le cookie expire de toute façon */ }
    router.replace("/codes");
  }

  return (
    <>
      <Head><title>Espace admin</title></Head>
      <div className="toolbar codes-toolbar">
        <h1>Codes</h1>
        <span className="status">Session admin jusqu&apos;à {heure(adminExpiresAt)}</span>
        <button className="ghost" onClick={logout} disabled={busy}>Se déconnecter</button>
      </div>
      <CodesTabs isAdmin current="/codes/admin" />
      <div className="menage-page codes-page">
        <div className="recap">
          <div className="recap-title">Espace admin</div>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Espace de test réservé à l&apos;administrateur. Prochaine étape : connexion à igloohome
            (liste des serrures et historique, en lecture seule).
          </p>
        </div>
      </div>
    </>
  );
}
