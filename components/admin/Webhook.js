// components/admin/Webhook.js
// Test du webhook igloohome : adresse à coller dans le portail (API Access > Add a new
// webhook) et liste des envois reçus, tels quels.
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";

export default function Webhook() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copie, setCopie] = useState(false);

  async function load() {
    setBusy(true); setErr(null);
    try { setData(await adminCall(router, "/api/admin/igloohome/webhook")); }
    catch (e) { setErr(e); if (e.adresse) setData({ adresse: e.adresse, evenements: [] }); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      {data?.evenements?.length > 0 && (
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
      )}
    </div>
  );
}
