// components/admin/Croisement.js
// Croisement sur une période (ou rejeu d'un mois passé) : lit l'historique de chaque
// serrure validée, les réservations Hostaway de Belleville, puis classe chaque ouverture
// (lib/croisement.js). Tout se fait en lecture seule ; les alertes s'exportent en CSV.
import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";
import { classify, toCsv, CLASSES, CIBLE_IGNORER, DEFAULT_SETTINGS, addDays } from "../../lib/croisement";

const TZ = "Europe/Paris";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
function prevMonth() {
  const t = today();
  const [y, m] = t.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ORDER = ["alerte", "ok", "personnel", "jour-vide", "interieur", "autre"];

export default function Croisement() {
  const router = useRouter();
  const [from, setFrom] = useState(addDays(today(), -7));
  const [to, setTo] = useState(addDays(today(), -1));
  const [month, setMonth] = useState(prevMonth());
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);
  const [fClasse, setFClasse] = useState("alerte");
  const [fApt, setFApt] = useState("");
  const [reglages, setReglages] = useState(null);

  async function run(f = from, t = to) {
    setBusy("run"); setErr(null); setResult(null);
    try {
      if (t < f) throw { error: "La date de fin est avant la date de début." };
      setProgress("Lecture de la correspondance…");
      const { config } = await adminCall(router, "/api/admin/igloohome/config");
      setReglages(config.reglages);
      const locks = Object.entries(config.mapping)
        .filter(([, m]) => m.valide && m.cible && m.cible !== CIBLE_IGNORER)
        .map(([id, m]) => ({ id, nom: m.nom }));
      if (!locks.length) throw { error: "Aucune serrure validée dans « Correspondance ». Validez d'abord la table." };

      setProgress("Lecture des réservations Hostaway…");
      const acc = window.localStorage.getItem("hostaway_account") || "";
      const key = window.localStorage.getItem("hostaway_api_key") || "";
      const resas = await adminCall(router, `/api/admin/hostaway/reservations?from=${f}&to=${t}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });

      const events = {};
      const incidents = [];
      for (let i = 0; i < locks.length; i++) {
        const l = locks[i];
        setProgress(`Historique igloohome : ${l.nom || l.id} (${i + 1}/${locks.length})…`);
        try {
          const h = await adminCall(router, `/api/admin/igloohome/activity?deviceId=${encodeURIComponent(l.id)}&from=${f}&to=${t}`);
          events[l.id] = h.evenements;
          if (h.pageSuivanteRestante) incidents.push(`${l.nom || l.id} : historique incomplet (limite de lecture atteinte)`);
        } catch (e) {
          const d = e.detail ? ` Réponse : ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}` : "";
          incidents.push(`${l.nom || l.id} : ${e.error || "erreur de lecture"}${d}`);
        }
      }

      const rows = classify({ devices: locks, events, mapping: config.mapping, reservations: resas.reservations, personnel: config.personnel, settings: config.reglages })
        .filter(r => (r.date >= f && r.date <= t) || (r.nuit && r.nuit >= f && r.nuit <= t));
      setResult({ from: f, to: t, rows, incidents, nonResolues: resas.nonResolues, nbResas: resas.reservations.length, nbSerrures: locks.length, lueLe: new Date() });
      setFClasse("alerte"); setFApt("");
    } catch (e) { setErr(e); }
    finally { setBusy(""); setProgress(""); }
  }

  async function saveReglages() {
    setBusy("reglages"); setErr(null);
    try {
      const { config } = await adminCall(router, "/api/admin/igloohome/config");
      const out = await adminCall(router, "/api/admin/igloohome/config", { method: "PUT", body: JSON.stringify({ config: { ...config, reglages } }) });
      setReglages(out.config.reglages);
    } catch (e) { setErr(e); }
    finally { setBusy(""); }
  }

  const counts = useMemo(() => {
    const c = {};
    for (const r of result?.rows || []) c[r.classe] = (c[r.classe] || 0) + 1;
    return c;
  }, [result]);
  const apts = useMemo(() => [...new Set((result?.rows || []).map(r => r.appartement))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true })), [result]);
  const shown = (result?.rows || []).filter(r => (!fClasse || r.classe === fClasse) && (!fApt || r.appartement === fApt));
  const reg = reglages || DEFAULT_SETTINGS;

  return (
    <div className="admin-block">
      <p className="admin-note">
        Règle : une ouverture entre <b>{reg.heureDebut} h et {reg.heureFin} h le lendemain</b>, une nuit sans réservation
        dans l&apos;appartement, est une <b>ALERTE</b>. Chaque lecture d&apos;historique est facturée par igloohome
        (2 $ par serrure lue, une fois par mois).
      </p>

      <div className="admin-actions">
        <label>Du <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label>au <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <button className="primary" onClick={() => run()} disabled={!!busy}>{busy === "run" ? "Croisement…" : "Lancer le croisement"}</button>
      </div>
      <div className="admin-actions">
        <label>Rejeu d&apos;un mois <input type="month" value={month} max={today().slice(0, 7)} onChange={e => setMonth(e.target.value)} /></label>
        <button onClick={() => { const r = monthRange(month); setFrom(r.from); setTo(r.to); run(r.from, r.to); }} disabled={!!busy || !month}>Rejouer ce mois</button>
      </div>
      {progress && <div className="admin-note">{progress}</div>}
      <Erreur e={err} />

      {result && (
        <>
          <div className="admin-ok">
            Du {result.from} au {result.to} · {result.nbSerrures} serrure(s) · {result.nbResas} réservation(s) Belleville ·
            lu à {result.lueLe.toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}
          </div>
          {result.incidents.length > 0 && <div className="admin-warn">{result.incidents.map(t => <div key={t}>{t}</div>)}</div>}
          {result.nonResolues.length > 0 && (
            <div className="admin-warn">
              {result.nonResolues.length} réservation(s) Cosy/Confort/Chic sans appartement précis dans Hostaway : elles
              ne couvrent aucune nuit dans le croisement, vérifiez les alertes de ces catégories.
              {result.nonResolues.map(r => <div key={r.id}>{r.client} · {r.arrivee} → {r.depart} · résa {r.id}</div>)}
            </div>
          )}

          <div className="admin-chips">
            {ORDER.map(k => (
              <button key={k} className={`admin-chip ${k}${fClasse === k ? " on" : ""}`} onClick={() => setFClasse(fClasse === k ? "" : k)}>
                {CLASSES[k]} : {counts[k] || 0}
              </button>
            ))}
          </div>
          <div className="admin-actions">
            <label>Appartement <select value={fApt} onChange={e => setFApt(e.target.value)}>
              <option value="">Tous</option>
              {apts.map(a => <option key={a}>{a}</option>)}
            </select></label>
            <button onClick={() => download(`croisement-igloohome_${result.from}_${result.to}${fClasse ? "_" + fClasse : ""}.csv`, toCsv(shown))} disabled={!shown.length}>
              Exporter en CSV ({shown.length})
            </button>
          </div>

          {shown.length ? (
            <div className="tbl-wrap"><table className="tbl admin-tbl">
              <thead><tr><th>Date</th><th>Heure</th><th>Classe</th><th>Appartement</th><th>Motif</th><th>Réservation</th><th>Événement igloohome</th></tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className={r.classe === "alerte" ? "admin-alerte" : ""}>
                    <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                    <td>{r.heure}</td>
                    <td><b>{CLASSES[r.classe]}</b></td>
                    <td>{r.appartement}<div className="admin-note">{r.serrure}</div></td>
                    <td>{r.motif}</td>
                    <td>{r.reservation ? <>{r.reservation.client}<div className="admin-note">{r.reservation.arrivee} → {r.reservation.depart} · {r.reservation.canal}</div></> : "—"}</td>
                    <td>
                      {r.type}{r.description ? ` · ${r.description}` : ""}
                      <details><summary>brut</summary><pre>{JSON.stringify(r.brut, null, 2)}</pre></details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty-state">Aucune ligne pour ce filtre.</div>}
        </>
      )}

      <details className="admin-block">
        <summary>Réglages du croisement</summary>
        {reglages ? (
          <div className="admin-actions">
            <label>Alerte à partir de <input type="number" min={12} max={23} value={reglages.heureDebut} onChange={e => setReglages({ ...reglages, heureDebut: Number(e.target.value) })} /> h</label>
            <label>jusqu&apos;à <input type="number" min={0} max={12} value={reglages.heureFin} onChange={e => setReglages({ ...reglages, heureFin: Number(e.target.value) })} /> h le lendemain</label>
            <label>Marge de journée autour du séjour <input type="number" min={0} max={12} value={reglages.margeH} onChange={e => setReglages({ ...reglages, margeH: Number(e.target.value) })} /> h</label>
            <button onClick={saveReglages} disabled={!!busy}>Enregistrer</button>
          </div>
        ) : <div className="admin-note">Lancez un croisement une première fois pour afficher les réglages.</div>}
      </details>
    </div>
  );
}
