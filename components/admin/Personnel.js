// components/admin/Personnel.js
// Codes du personnel (ménage, maintenance, propriétaire) : leurs ouvertures de journée
// sont classées « Personnel ». La nuit (19 h - 8 h) sans réservation, c'est quand même
// une ALERTE, avec le nom de la personne. Stockage privé et chiffré, admin seulement.
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";

const CATEGORIES = ["Ménage", "Maintenance", "Propriétaire", "Réception", "Autre"];

export default function Personnel() {
  const router = useRouter();
  const [config, setConfig] = useState(null);
  const [list, setList] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("load");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    adminCall(router, "/api/admin/igloohome/config")
      .then(c => { setConfig(c.config); setList(c.config.personnel); })
      .catch(setErr).finally(() => setBusy(""));
  }, [router]);

  const set = (i, patch) => { setSaved(""); setList(l => l.map((p, j) => j === i ? { ...p, ...patch } : p)); };

  async function save() {
    setBusy("save"); setErr(null); setSaved("");
    try {
      const personnel = list.filter(p => p.nom.trim() || p.code.trim());
      const out = await adminCall(router, "/api/admin/igloohome/config", { method: "PUT", body: JSON.stringify({ config: { ...config, personnel } }) });
      setConfig(out.config); setList(out.config.personnel); setSaved("Codes du personnel enregistrés.");
    } catch (e) { setErr(e); }
    finally { setBusy(""); }
  }

  if (busy === "load") return <div className="admin-note">Lecture…</div>;
  if (!config) return <Erreur e={err} />;

  return (
    <div className="admin-block">
      <p className="admin-note">
        Code = le PIN ou le nom de la clé tel qu&apos;il apparaît dans l&apos;historique igloohome. Si igloohome
        n&apos;indique pas le code utilisé, ces lignes ne pourront rien reconnaître.
      </p>
      <div className="tbl-wrap"><table className="tbl admin-tbl">
        <thead><tr><th>Nom</th><th>Catégorie</th><th>Code ou nom de clé</th><th></th></tr></thead>
        <tbody>
          {list.map((p, i) => (
            <tr key={i}>
              <td><input value={p.nom} maxLength={60} onChange={e => set(i, { nom: e.target.value })} /></td>
              <td>
                <select value={p.categorie} onChange={e => set(i, { categorie: e.target.value })}>
                  <option value="">—</option>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </td>
              <td><input value={p.code} maxLength={40} autoComplete="off" onChange={e => set(i, { code: e.target.value })} /></td>
              <td><button className="ghost" onClick={() => { setSaved(""); setList(l => l.filter((_, j) => j !== i)); }}>Retirer</button></td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={4} className="admin-note">Aucun code enregistré.</td></tr>}
        </tbody>
      </table></div>
      <div className="admin-actions">
        <button onClick={() => { setSaved(""); setList(l => [...l, { nom: "", categorie: "", code: "" }]); }}>Ajouter un code</button>
        <button className="primary" onClick={save} disabled={!!busy}>{busy === "save" ? "Enregistrement…" : "Enregistrer"}</button>
      </div>
      {saved && <div className="admin-ok">{saved}</div>}
      <Erreur e={err} />
    </div>
  );
}
