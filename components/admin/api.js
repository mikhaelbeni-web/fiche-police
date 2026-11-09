// components/admin/api.js — appels aux routes /api/admin/* depuis l'espace admin.
// Une 404 veut dire « session admin expirée » : retour à Codes d'accès.

export async function adminCall(router, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) } });
  if (r.status === 404) { router.replace("/codes"); throw { error: "Session admin expirée." }; }
  const d = await r.json().catch(() => ({ error: `Réponse illisible (HTTP ${r.status}).` }));
  if (!r.ok || d.ok === false) throw d;
  return d;
}

export function Erreur({ e }) {
  if (!e) return null;
  return (
    <div className="admin-err">
      <div><b>Erreur{e.etape ? ` (étape : ${e.etape})` : ""} :</b> {e.error || e.message || "inconnue"}</div>
      {e.detail != null && (
        <details><summary>Réponse brute</summary><pre>{JSON.stringify(e.detail, null, 2)}</pre></details>
      )}
    </div>
  );
}
