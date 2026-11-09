// components/admin/Correspondance.js
// Table de correspondance serrure igloohome -> appartement Belleville.
// Proposition automatique d'après les noms (lib/croisement.js suggestTarget), jamais
// appliquée sans validation : chaque ligne doit être cochée « Validé » par l'admin.
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";
import { IGLOO_APARTMENTS, CIBLE_COMMUN, CIBLE_IGNORER, isBridgeDevice, suggestTarget, apartmentName } from "../../lib/croisement";

export default function Correspondance() {
  const router = useRouter();
  const [config, setConfig] = useState(null);
  const [devices, setDevices] = useState(null);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("load");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [c, d] = await Promise.all([
          adminCall(router, "/api/admin/igloohome/config"),
          adminCall(router, "/api/admin/igloohome/devices"),
        ]);
        setConfig(c.config);
        setDevices(d.serrures);
        setRows(d.serrures.filter(s => s.id && !isBridgeDevice(s)).map(s => {
          const m = c.config.mapping[s.id];
          const sug = suggestTarget(s.nom);
          return { id: s.id, nom: s.nom, suggestion: sug, cible: m ? m.cible : sug.cible, valide: m ? m.valide : false, enregistre: Boolean(m) };
        }).sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr", { numeric: true })));
      } catch (e) { setErr(e); }
      finally { setBusy(""); }
    })();
  }, [router]);

  const set = (id, patch) => { setSaved(""); setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r)); };

  async function save() {
    setBusy("save"); setErr(null); setSaved("");
    try {
      const mapping = {};
      for (const r of rows) mapping[r.id] = { cible: r.cible, nom: r.nom, valide: r.valide };
      const out = await adminCall(router, "/api/admin/igloohome/config", { method: "PUT", body: JSON.stringify({ config: { ...config, mapping } }) });
      setConfig(out.config);
      setRows(rs => rs.map(r => ({ ...r, enregistre: true })));
      setSaved("Correspondance enregistrée.");
    } catch (e) { setErr(e); }
    finally { setBusy(""); }
  }

  if (busy === "load") return <div className="admin-note">Lecture des serrures et de la correspondance…</div>;
  if (!devices) return <Erreur e={err} />;

  const bridges = devices.filter(isBridgeDevice);
  const counts = new Map();
  for (const r of rows) if (r.cible && r.cible !== CIBLE_COMMUN && r.cible !== CIBLE_IGNORER) counts.set(r.cible, (counts.get(r.cible) || 0) + 1);
  const sansSerrure = IGLOO_APARTMENTS.filter(a => !counts.has(a.id));
  const doublons = [...counts].filter(([, n]) => n > 1).map(([id]) => apartmentName(id));
  const nonValides = rows.filter(r => !r.valide).length;

  return (
    <div className="admin-block">
      <p className="admin-note">
        Une serrure n&apos;est utilisée dans le croisement que si sa ligne est <b>validée</b>. Les propositions
        viennent des noms ; en cas de doute, laissez « à choisir ». Deep 02 n&apos;apparaît pas (serrure Nuki).
      </p>
      <div className="tbl-wrap"><table className="tbl admin-tbl">
        <thead><tr><th>Serrure igloohome</th><th>Proposition</th><th>Appartement Hostaway</th><th>Validé</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className={!r.valide ? "admin-todo" : ""}>
              <td><b>{r.nom || "—"}</b><div><code>{r.id}</code></div></td>
              <td>
                {r.suggestion.cible ? (r.suggestion.cible === CIBLE_COMMUN ? "Porte commune" : apartmentName(r.suggestion.cible)) : "—"}
                <div className={`admin-conf ${r.suggestion.confiance}`}>
                  {r.suggestion.confiance === "sure" ? "Sûr" : r.suggestion.confiance === "a-verifier" ? "À vérifier" : "Aucune"} · {r.suggestion.raison}
                </div>
              </td>
              <td>
                <select value={r.cible} onChange={e => set(r.id, { cible: e.target.value, valide: false })}>
                  <option value="">— à choisir —</option>
                  {IGLOO_APARTMENTS.map(a => <option key={a.id} value={a.id}>{a.nom}</option>)}
                  <option value={CIBLE_COMMUN}>Porte commune de la résidence</option>
                  <option value={CIBLE_IGNORER}>Ignorer cette serrure</option>
                </select>
              </td>
              <td className="c">
                <input type="checkbox" checked={r.valide} disabled={!r.cible} onChange={e => set(r.id, { valide: e.target.checked })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      {doublons.length > 0 && <div className="admin-err">Appartement choisi pour plusieurs serrures : {doublons.join(", ")}.</div>}
      {sansSerrure.length > 0 && <div className="admin-warn">Appartements sans serrure : {sansSerrure.map(a => a.nom).join(", ")}.</div>}
      {bridges.length > 0 && <div className="admin-note">Bridges / étages ignorés : {bridges.map(b => b.nom || b.id).join(", ")}.</div>}

      <div className="admin-actions">
        <button className="primary" onClick={save} disabled={!!busy || doublons.length > 0}>{busy === "save" ? "Enregistrement…" : "Enregistrer la correspondance"}</button>
        <span className="admin-note">{nonValides ? `${nonValides} ligne(s) non validée(s)` : "Toutes les lignes sont validées"}</span>
      </div>
      {saved && <div className="admin-ok">{saved}</div>}
      <Erreur e={err} />
    </div>
  );
}
