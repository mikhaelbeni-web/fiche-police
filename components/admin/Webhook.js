// components/admin/Webhook.js
// Test du webhook igloohome : adresse à coller dans le portail (API Access > Add a new
// webhook), résumé lisible des événements (appartement, heure, type) et envois bruts.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";
import { flattenWebhooks, rowsToText, formatParis } from "../../lib/igloohomeEvents";
import { IGLOO_APARTMENTS } from "../../lib/croisement";

export default function Webhook() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copie, setCopie] = useState(false);
  const [mapping, setMapping] = useState({});
  const [resumeCopie, setResumeCopie] = useState(false);

  async function load() {
    setBusy(true); setErr(null); setResumeCopie(false);
    try {
      setData(await adminCall(router, "/api/admin/igloohome/webhook"));
      try { const { config } = await adminCall(router, "/api/admin/igloohome/config"); setMapping(config?.mapping || {}); }
      catch { /* sans correspondance, on affiche l'identifiant de la serrure */ }
    }
    catch (e) { setErr(e); if (e.adresse) setData({ adresse: e.adresse, evenements: [] }); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => flattenWebhooks(data?.evenements || [], mapping), [data, mapping]);
  const vues = useMemo(() => new Set(rows.filter(r => IGLOO_APARTMENTS.some(a => a.nom === r.appartement)).map(r => r.appartement)), [rows]);

  return (
    <div className="admin-block">
      <p className="admin-note">
        Collez cette adresse dans le portail igloohome : <b>API Access &gt; Add a new webhook</b>. igloohome y
        enverra lui-même les événements des serrures. Gardez-la secrète.
      </p>
      {data?.adresse && (
        <div className="admin-actions">
          <code className="admin-url">{data.adresse}</code>
          <button onClick={() => { navigator.clipboard?.writeText(data.adresse); setCopie(true); }}>{copie ? "Copiée" : "Copier"}</button>
        </div>
      )}
      <div className="admin-actions">
        <button className="primary" onClick={load} disabled={busy}>{busy ? "Lecture…" : "Actualiser les envois reçus"}</button>
        <span className="admin-note">{data ? `${data.evenements.length} envoi(s) reçu(s)` : ""}</span>
      </div>
      <Erreur e={err} />
      {rows.length > 0 && (
        <>
          <div className="admin-ok">
            Résumé : {rows.length} événement(s) · {vues.size} appartement(s) sur {IGLOO_APARTMENTS.length} déjà vu(s)
            {vues.size ? ` (${[...vues].sort((a, b) => a.localeCompare(b, "fr", { numeric: true })).join(", ")})` : ""}
          </div>
          <div className="admin-actions">
            <button onClick={() => { navigator.clipboard?.writeText(rowsToText(rows)); setResumeCopie(true); }}>
              {resumeCopie ? "Résumé copié : collez-le à Claude" : "Copier le résumé"}
            </button>
          </div>
          <div className="tbl-wrap"><table className="tbl admin-tbl">
            <thead><tr><th>Heure (Paris)</th><th>Appartement</th><th>Quoi</th><th>logType</th><th>keyId</th><th>Reçu</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatParis(r.ms)}</td>
                  <td>{r.appartement}<div className="admin-note">{r.serrure}</div></td>
                  <td>{r.quoi}</td>
                  <td>{r.logType ?? ""}</td>
                  <td>{r.keyId ?? ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatParis(r.recuMs)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
      {data?.evenements?.length > 0 && (
        <details><summary>Envois bruts ({data.evenements.length})</summary>
        <div className="tbl-wrap"><table className="tbl admin-tbl">
          <thead><tr><th>Reçu le (Paris)</th><th>Contenu</th></tr></thead>
          <tbody>
            {data.evenements.map((e, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(e.recuLe).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                <td><pre>{JSON.stringify({ corps: e.corps, entetes: e.entetes }, null, 2)}</pre></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        </details>
      )}
    </div>
  );
}
