// components/admin/Croisement.js
// Croisement sur une période (ou rejeu d'un mois passé) : lit l'historique de chaque
// serrure validée et les réservations Hostaway de Belleville, puis n'affiche QUE les visites
// faites quand l'appartement est sans réservation (départ 11 h → arrivée 15 h), avec entrée,
// sortie et durée (lib/croisement.js). mikhael valide l'interprétation de chaque type
// d'action igloohome. Lecture seule ; export CSV.
import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";
import { visitesHorsReservation, visitesCsv, typesLus, dureeTexte, NATURES, CIBLE_IGNORER, DEFAULT_SETTINGS, addDays } from "../../lib/croisement";

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


// Le code PIN figure en clair dans l'historique igloohome : jamais affiché.
function masque(e) {
  const out = { ...e };
  if ("pin" in out) out.pin = out.pin ? "••••" : out.pin;
  return out;
}

export default function Croisement() {
  const router = useRouter();
  const [from, setFrom] = useState(addDays(today(), -7));
  const [to, setTo] = useState(addDays(today(), -1));
  const [month, setMonth] = useState(prevMonth());
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null);
  const [fPlage, setFPlage] = useState("alerte");
  const [fApt, setFApt] = useState("");
  const [reglages, setReglages] = useState(null);
  const [interps, setInterps] = useState({});
  const [interpsSaved, setInterpsSaved] = useState(true);

  async function run(f = from, t = to) {
    setBusy("run"); setErr(null); setData(null);
    try {
      if (t < f) throw { error: "La date de fin est avant la date de début." };
      setProgress("Lecture de la correspondance…");
      const { config } = await adminCall(router, "/api/admin/igloohome/config");
      setReglages(config.reglages);
      setInterps(config.interpretations || {}); setInterpsSaved(true);
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
      const profondeur = [];
      for (let i = 0; i < locks.length; i++) {
        const l = locks[i];
        const nom = l.nom || l.id;
        events[l.id] = [];
        try {
          let cursor = "", h = null;
          for (let n = 0; n < 10; n++) {
            setProgress(`Historique igloohome : ${nom} (${i + 1}/${locks.length})${n ? `, suite ${n}` : ""}…`);
            h = await adminCall(router, `/api/admin/igloohome/activity?deviceId=${encodeURIComponent(l.id)}&from=${f}&to=${t}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
            events[l.id].push(...h.evenements);
            if (!h.suite) break;
            cursor = h.suite;
          }
          const plusAncien = [h?.plusAncien, ...profondeur.filter(p => p.id === l.id).map(p => p.plusAncien)].filter(Boolean).sort()[0] || null;
          profondeur.push({ id: l.id, nom, plusAncien, complet: !h?.suite, debutAtteint: Boolean(h?.debutAtteint), nb: events[l.id].length });
          if (h?.suite) incidents.push(`${nom} : historique incomplet (lecture trop longue), relancez sur une période plus courte`);
        } catch (e) {
          const d = e.detail ? ` Réponse : ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}` : "";
          incidents.push(`${nom} : ${e.error || "erreur de lecture"}${d}`);
        }
      }
      const pasAssezLoin = profondeur.filter(p => p.complet && !p.debutAtteint && p.plusAncien && p.plusAncien.slice(0, 10) > f);
      for (const p of pasAssezLoin) incidents.push(`${p.nom} : l'historique igloohome ne remonte qu'au ${new Date(p.plusAncien).toLocaleDateString("fr-FR", { timeZone: TZ })}`);

      setData({ from: f, to: t, locks, events, config, resas, incidents, profondeur, lueLe: new Date() });
      setFPlage("alerte"); setFApt("");
    } catch (e) { setErr(e); }
    finally { setBusy(""); setProgress(""); }
  }

  async function saveConfig(patch) {
    const { config } = await adminCall(router, "/api/admin/igloohome/config");
    const out = await adminCall(router, "/api/admin/igloohome/config", { method: "PUT", body: JSON.stringify({ config: { ...config, ...patch } }) });
    return out.config;
  }

  async function saveReglages() {
    setBusy("reglages"); setErr(null);
    try { setReglages((await saveConfig({ reglages })).reglages); }
    catch (e) { setErr(e); }
    finally { setBusy(""); }
  }

  async function saveInterps() {
    setBusy("interps"); setErr(null);
    try { setInterps((await saveConfig({ interpretations: interps })).interpretations || {}); setInterpsSaved(true); }
    catch (e) { setErr(e); }
    finally { setBusy(""); }
  }

  function setInterp(type, patch, proposition) {
    setInterps(prev => ({ ...prev, [type]: { nature: prev[type]?.nature || proposition, valide: false, ...prev[type], ...patch } }));
    setInterpsSaved(false);
  }

  const reg = reglages || DEFAULT_SETTINGS;
  const types = useMemo(() => data ? typesLus(data.events, interps) : [], [data, interps]);
  const visites = useMemo(() => {
    if (!data) return [];
    return visitesHorsReservation({
      devices: data.locks, events: data.events, mapping: data.config.mapping, reservations: data.resas.reservations,
      personnel: data.config.personnel, settings: reg, interpretations: interps,
    }).filter(v => v.date >= data.from && v.date <= data.to);
  }, [data, interps, reg]);
  const counts = useMemo(() => ({ alerte: visites.filter(v => v.nuit).length, jour: visites.filter(v => !v.nuit).length }), [visites]);
  const apts = useMemo(() => [...new Set(visites.map(v => v.appartement))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true })), [visites]);
  const shown = visites.filter(v => (!fPlage || v.classe === fPlage) && (!fApt || v.appartement === fApt));
  const aValider = types.filter(t => !t.valide).length;

  return (
    <div className="admin-block">
      <p className="admin-note">
        Seules les périodes <b>sans réservation</b> sont analysées : du départ ({reg.heureDepart} h) à l&apos;arrivée
        suivante ({reg.heureArrivee} h). Chaque passage est interprété en visite (entrée, sortie, durée). Une visite
        entre <b>{reg.heureDebut} h et {reg.heureFin} h le lendemain</b> est une <b>ALERTE</b> ; en journée, c&apos;est une
        information (ménage, maintenance…). Chaque lecture d&apos;historique est facturée par igloohome (2 $ par serrure
        lue, une fois par mois).
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

      {data && (
        <>
          <div className="admin-ok">
            Du {data.from} au {data.to} · {data.locks.length} serrure(s) · {data.resas.reservations.length} réservation(s) Belleville ·
            lu à {data.lueLe.toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}
          </div>
          {data.incidents.length > 0 && <div className="admin-warn">{data.incidents.map(t => <div key={t}>{t}</div>)}</div>}
          {data.resas.nonResolues.length > 0 && (
            <div className="admin-warn">
              {data.resas.nonResolues.length} réservation(s) Cosy/Confort/Chic sans appartement précis dans Hostaway : elles
              ne couvrent aucune période dans le croisement, vérifiez les visites de ces catégories.
              {data.resas.nonResolues.map(r => <div key={r.id}>{r.client} · {r.arrivee} → {r.depart} · résa {r.id}</div>)}
            </div>
          )}

          <details className="admin-block" open={aValider > 0}>
            <summary><b>Interprétation des types d&apos;action igloohome</b> · {aValider ? `${aValider} à valider` : "tout est validé"}</summary>
            <p className="admin-note">
              Pour chaque type d&apos;action lu, ma proposition d&apos;interprétation. Corrigez-la si besoin, cochez « Validé », puis
              enregistrez. Tant qu&apos;un type n&apos;est pas validé, les visites qui l&apos;utilisent sont marquées « à confirmer ».
            </p>
            <div className="tbl-wrap"><table className="tbl admin-tbl">
              <thead><tr><th>Type igloohome</th><th>Nombre</th><th>Texte de l&apos;événement</th><th>Interprétation</th><th>Validé</th></tr></thead>
              <tbody>
                {types.map(t => (
                  <tr key={t.type}>
                    <td><code>{t.type}</code></td>
                    <td>{t.nombre}</td>
                    <td className="admin-note">{t.exemple}</td>
                    <td><select value={t.nature} onChange={e => setInterp(t.type, { nature: e.target.value, valide: false }, t.proposition)}>
                      {Object.entries(NATURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></td>
                    <td><input type="checkbox" checked={t.valide} onChange={e => setInterp(t.type, { nature: t.nature, valide: e.target.checked }, t.proposition)} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="admin-actions">
              <button className="primary" onClick={saveInterps} disabled={!!busy || interpsSaved}>{busy === "interps" ? "Enregistrement…" : "Enregistrer les interprétations"}</button>
            </div>
          </details>

          <div className="admin-chips">
            <button className={`admin-chip alerte${fPlage === "alerte" ? " on" : ""}`} onClick={() => setFPlage(fPlage === "alerte" ? "" : "alerte")}>ALERTE (nuit) : {counts.alerte}</button>
            <button className={`admin-chip${fPlage === "jour" ? " on" : ""}`} onClick={() => setFPlage(fPlage === "jour" ? "" : "jour")}>Journée : {counts.jour}</button>
          </div>
          <div className="admin-actions">
            <label>Appartement <select value={fApt} onChange={e => setFApt(e.target.value)}>
              <option value="">Tous</option>
              {apts.map(a => <option key={a}>{a}</option>)}
            </select></label>
            <button onClick={() => download(`visites-hors-reservation_${data.from}_${data.to}${fPlage ? "_" + fPlage : ""}.csv`, visitesCsv(shown))} disabled={!shown.length}>
              Exporter en CSV ({shown.length})
            </button>
          </div>

          {shown.length ? (
            <div className="tbl-wrap"><table className="tbl admin-tbl">
              <thead><tr><th>Date</th><th>Appartement</th><th>Entrée</th><th>Sortie</th><th>Durée</th><th>Interprétation</th><th>Réservations autour</th><th>Événements</th></tr></thead>
              <tbody>
                {shown.map((v, i) => (
                  <tr key={i} className={v.nuit ? "admin-alerte" : ""}>
                    <td style={{ whiteSpace: "nowrap" }}>{v.date}{v.nuit && <div><b>ALERTE</b></div>}</td>
                    <td>{v.appartement}<div className="admin-note">{v.serrure}</div></td>
                    <td>{v.entree || "—"}</td>
                    <td>{v.sortie ? <>{v.sortie}{v.dateSortie !== v.date && <div className="admin-note">le {v.dateSortie}</div>}</> : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{dureeTexte(v.dureeMin) || "—"}</td>
                    <td>{v.interpretation}{v.aConfirmer && <div className="admin-note">à confirmer : type d&apos;action non validé</div>}</td>
                    <td className="admin-note">{v.precedent && <div>Avant : {v.precedent}</div>}{v.suivant && <div>Après : {v.suivant}</div>}</td>
                    <td>
                      <details><summary>{v.evenements.length} événement(s)</summary>
                        {v.evenements.map((x, j) => (
                          <div key={j} className="admin-note">
                            {x.date} {x.heure} · {NATURES[x.nature] || x.nature} · <code>{x.type}</code>
                            <details><summary>brut</summary><pre>{JSON.stringify(masque(x.brut), null, 2)}</pre></details>
                          </div>
                        ))}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <div className="empty-state">Aucune visite hors réservation pour ce filtre.</div>}

          <details className="admin-block">
            <summary>Profondeur de l&apos;historique lu</summary>
            {data.profondeur.map(p => (
              <div key={p.id} className="admin-note">
                {p.nom} : {p.nb} événement(s) dans la période · plus ancien lu : {p.plusAncien ? new Date(p.plusAncien).toLocaleString("fr-FR", { timeZone: TZ }) : "aucun"}
                {p.debutAtteint ? " · début de période atteint" : p.complet ? " · fin de l'historique igloohome" : " · lecture incomplète"}
              </div>
            ))}
          </details>
        </>
      )}

      <details className="admin-block">
        <summary>Réglages du croisement</summary>
        {reglages ? (
          <div className="admin-actions">
            <label>Alerte à partir de <input type="number" min={12} max={23} value={reglages.heureDebut} onChange={e => setReglages({ ...reglages, heureDebut: Number(e.target.value) })} /> h</label>
            <label>jusqu&apos;à <input type="number" min={0} max={12} value={reglages.heureFin} onChange={e => setReglages({ ...reglages, heureFin: Number(e.target.value) })} /> h le lendemain</label>
            <label>Arrivée des clients <input type="number" min={10} max={23} value={reglages.heureArrivee} onChange={e => setReglages({ ...reglages, heureArrivee: Number(e.target.value) })} /> h</label>
            <label>Départ des clients <input type="number" min={6} max={14} value={reglages.heureDepart} onChange={e => setReglages({ ...reglages, heureDepart: Number(e.target.value) })} /> h</label>
            <button onClick={saveReglages} disabled={!!busy}>Enregistrer</button>
          </div>
        ) : <div className="admin-note">Lancez un croisement une première fois pour afficher les réglages.</div>}
      </details>
    </div>
  );
}
