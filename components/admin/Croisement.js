// components/admin/Croisement.js — onglet « Surveillance » de l'Espace admin.
// Lit l'historique de chaque serrure validée et les réservations Hostaway de Belleville,
// puis n'affiche QUE les visites faites quand l'appartement est sans réservation (départ
// 11 h → arrivée 15 h), avec entrée, sortie, durée et une frise (lib/croisement.js).
// L'admin marque chaque visite « Normal » ou « À vérifier » ; ces décisions et le dernier
// résultat sont gardés chiffrés côté serveur (/api/admin/igloohome/suivi), sans aucun
// événement brut (le code PIN y figure en clair). Lecture seule vers igloohome et Hostaway.
import { useEffect, useMemo, useState } from "react";
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
function shiftMonth(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const PRESETS = {
  "7j": { label: "7 derniers jours", range: () => ({ from: addDays(today(), -7), to: addDays(today(), -1) }) },
  "mois-dernier": { label: "Mois dernier", range: () => monthRange(shiftMonth(today().slice(0, 7), -1)) },
  "ce-mois": { label: "Ce mois", range: () => ({ from: today().slice(0, 7) + "-01", to: today() }) },
  autre: { label: "Autre période" },
};

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
function jour(date) {
  const d = new Date(date + "T12:00:00Z");
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
}
function titrePeriode(from, to) {
  const r = monthRange(from.slice(0, 7));
  if (r.from === from && r.to === to) return `${MOIS[Number(from.slice(5, 7)) - 1].replace(/^./, c => c.toUpperCase())} ${from.slice(0, 4)}`;
  return `Du ${jour(from)} au ${jour(to)}`;
}
function ilYa(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(min)) return "";
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 48 * 60) return `il y a ${Math.round(min / 60)} h`;
  return `le ${new Date(iso).toLocaleDateString("fr-FR", { timeZone: TZ })}`;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Signature des interprétations : si elle change, le dernier résultat gardé est à recalculer.
const sig = interps => JSON.stringify(Object.keys(interps || {}).sort().map(k => [k, interps[k].nature, interps[k].valide]));

const ICON = { entree: "🔑", sortie: "🚪", presence: "✋" };

// Frise : réservations (bleu), période vide (hachuré), visite (rouge la nuit, gris le jour).
function Frise({ v }) {
  const H = 3600000;
  const lo = (v.videDebut !== null && v.videDebut !== undefined) ? Math.min(v.videDebut, v.debutWall) - 3 * H : v.debutWall - 18 * H;
  const hiBase = (v.videFin !== null && v.videFin !== undefined) ? Math.max(v.videFin, v.finWall) + 3 * H : v.finWall + 18 * H;
  const hi = Math.min(hiBase, lo + 7 * 24 * H);
  const span = Math.max(hi - lo, H);
  const pct = t => `${Math.max(0, Math.min(100, ((t - lo) / span) * 100))}%`;
  const w = (a, b) => `${Math.max(0.8, ((Math.min(b, hi) - Math.max(a, lo)) / span) * 100)}%`;
  const vd = v.videDebut ?? lo, vf = v.videFin ?? hi;
  return (
    <div className="vf-frise" aria-hidden="true">
      {v.videDebut !== null && v.videDebut !== undefined && <span className="vf-resa" style={{ left: 0, width: pct(v.videDebut) }} />}
      <span className="vf-vide" style={{ left: pct(vd), width: w(vd, vf) }} />
      {v.videFin !== null && v.videFin !== undefined && <span className="vf-resa" style={{ left: pct(v.videFin), right: 0 }} />}
      <span className={`vf-visite${v.nuit ? " nuit" : ""}`} style={{ left: pct(v.debutWall), width: w(v.debutWall, Math.max(v.finWall, v.debutWall + 20 * 60000)) }} />
    </div>
  );
}

function Visite({ v, decision, onDecide, busy }) {
  const [note, setNote] = useState(decision?.note || "");
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => { setNote(decision?.note || ""); }, [decision?.note]);
  const st = decision?.statut || "";
  return (
    <div className={`vf-row${v.nuit ? " nuit" : ""}${st ? " traitee" : ""}`}>
      <div className="vf-when">
        {v.nuit ? <span className="vf-badge alerte">⚠ Alerte de nuit</span> : <span className="vf-badge jour">☀ Journée</span>}
        <div className="vf-date">{jour(v.date)}</div>
        <div className="vf-apt">{v.appartement}</div>
      </div>
      <div className="vf-main">
        <div className="vf-io">
          <span>{v.entree ? <>🔑 Entrée <b>{v.entree}</b></> : <span className="vf-muted">🔑 Entrée non enregistrée</span>}</span>
          <span className="vf-arrow">→</span>
          <span>{v.sortie ? <>🚪 Sortie <b>{v.sortie}</b>{v.dateSortie && v.dateSortie !== v.date ? <span className="vf-muted"> le {jour(v.dateSortie)}</span> : null}</> : <span className="vf-muted">🚪 Sortie non enregistrée</span>}</span>
          <span className="vf-duree">{v.dureeMin !== null && v.dureeMin !== undefined ? dureeTexte(v.dureeMin) : "durée inconnue"}</span>
        </div>
        <Frise v={v} />
        <div className="vf-autour">
          <span>{v.precedent ? `◀ ${v.precedent}` : "◀ aucune réservation avant"}</span>
          <span>{v.suivant ? `${v.suivant} ▶` : "aucune réservation après ▶"}</span>
        </div>
        <div className="vf-interp">{v.interpretation}</div>
        {v.aConfirmer && <div className="vf-confirm">Interprétation à confirmer : un type d&apos;action n&apos;est pas encore validé dans Réglages.</div>}
        <button className="vf-link" onClick={() => setOuvert(!ouvert)}>{ouvert ? "Masquer" : "Voir"} les {v.evenements.length} événement(s)</button>
        {ouvert && (
          <ul className="vf-evs">
            {v.evenements.map((x, j) => (
              <li key={j}>{x.date !== v.date ? `${jour(x.date)} ` : ""}<b>{x.heure}</b> · {ICON[x.nature] || "•"} {NATURES[x.nature] || x.nature} · <code>{x.type}</code></li>
            ))}
          </ul>
        )}
      </div>
      <div className="vf-decide">
        <div className="vf-btns" role="group" aria-label="Décision">
          <button className={st === "normal" ? "on ok" : ""} disabled={busy} onClick={() => onDecide(v.cle, st === "normal" ? "" : "normal", note)}>✓ Normal</button>
          <button className={st === "a-verifier" ? "on warn" : ""} disabled={busy} onClick={() => onDecide(v.cle, st === "a-verifier" ? "" : "a-verifier", note)}>⚑ À vérifier</button>
        </div>
        <input className="vf-note" placeholder="Note (ménage, intervention…)" value={note} maxLength={300}
          onChange={e => setNote(e.target.value)}
          onBlur={() => { if (st && note !== (decision?.note || "")) onDecide(v.cle, st, note); }} />
        {st && <div className="vf-muted vf-small">{st === "normal" ? "Marquée normale" : "À vérifier"}{decision?.le ? ` ${ilYa(decision.le)}` : ""}</div>}
      </div>
    </div>
  );
}

export default function Croisement({ onReglages }) {
  const router = useRouter();
  const [preset, setPreset] = useState("mois-dernier");
  const [from, setFrom] = useState(PRESETS["mois-dernier"].range().from);
  const [to, setTo] = useState(PRESETS["mois-dernier"].range().to);
  const [busy, setBusy] = useState("load");
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState(null);
  const [warn, setWarn] = useState("");
  const [config, setConfig] = useState(null);
  const [live, setLive] = useState(null);      // résultat calculé dans cette session (avec événements)
  const [dernier, setDernier] = useState(null); // dernier résultat gardé côté serveur
  const [decisions, setDecisions] = useState({});
  const [filtre, setFiltre] = useState("a-traiter");
  const [fApt, setFApt] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          adminCall(router, "/api/admin/igloohome/config"),
          adminCall(router, "/api/admin/igloohome/suivi").catch(() => ({ suivi: { decisions: {}, dernier: null } })),
        ]);
        setConfig(c.config);
        setDecisions(s.suivi.decisions || {});
        if (s.suivi.dernier) { setDernier(s.suivi.dernier); setPreset("autre"); setFrom(s.suivi.dernier.from); setTo(s.suivi.dernier.to); }
      } catch (e) { setErr(e); }
      finally { setBusy(""); }
    })();
  }, [router]);

  function choosePreset(k) {
    setPreset(k);
    if (PRESETS[k].range) { const r = PRESETS[k].range(); setFrom(r.from); setTo(r.to); }
  }

  async function run() {
    setBusy("run"); setErr(null); setWarn("");
    try {
      if (to < from) throw { error: "La date de fin est avant la date de début." };
      const { config: cfg } = await adminCall(router, "/api/admin/igloohome/config");
      setConfig(cfg);
      const locks = Object.entries(cfg.mapping)
        .filter(([, m]) => m.valide && m.cible && m.cible !== CIBLE_IGNORER)
        .map(([id, m]) => ({ id, nom: m.nom }));
      if (!locks.length) throw { error: "Aucune serrure validée. Ouvrez Réglages > Serrures et validez la correspondance." };

      setProgress({ etape: "Réservations Hostaway…", i: 0, n: locks.length, lignes: [] });
      const acc = window.localStorage.getItem("hostaway_account") || "";
      const key = window.localStorage.getItem("hostaway_api_key") || "";
      const resas = await adminCall(router, `/api/admin/hostaway/reservations?from=${from}&to=${to}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });

      const events = {};
      const incidents = [];
      const profondeur = [];
      const lignes = [];
      for (let i = 0; i < locks.length; i++) {
        const l = locks[i];
        const nom = l.nom || l.id;
        events[l.id] = [];
        try {
          let cursor = "", h = null;
          for (let n = 0; n < 10; n++) {
            setProgress({ etape: `${nom}${n ? ` · page suivante ${n}` : ""}`, i, n: locks.length, lignes: [...lignes] });
            h = await adminCall(router, `/api/admin/igloohome/activity?deviceId=${encodeURIComponent(l.id)}&from=${from}&to=${to}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
            events[l.id].push(...h.evenements);
            if (!h.suite) break;
            cursor = h.suite;
          }
          profondeur.push({ id: l.id, nom, plusAncien: h?.plusAncien || null, complet: !h?.suite, debutAtteint: Boolean(h?.debutAtteint), nb: events[l.id].length });
          lignes.push({ nom, ok: true, nb: events[l.id].length });
          if (h?.suite) incidents.push(`${nom} : historique incomplet (lecture trop longue), relancez sur une période plus courte.`);
        } catch (e) {
          lignes.push({ nom, ok: false });
          incidents.push(`${nom} : ${e.error || "erreur de lecture"}`);
        }
      }
      setProgress(null);
      for (const p of profondeur) if (p.complet && !p.debutAtteint && p.plusAncien && p.plusAncien.slice(0, 10) > from) {
        incidents.push(`${p.nom} : l'historique igloohome ne remonte qu'au ${new Date(p.plusAncien).toLocaleDateString("fr-FR", { timeZone: TZ })}.`);
      }
      const r = { from, to, locks, events, config: cfg, resas, incidents, profondeur, lueLe: new Date().toISOString() };
      setLive(r);
      setFiltre("a-traiter"); setFApt("");
      // Garder le résultat (visites et résumés seulement).
      const res = resultat(r, cfg.interpretations || {}, cfg.reglages);
      try {
        const out = await adminCall(router, "/api/admin/igloohome/suivi", { method: "PUT", body: JSON.stringify({ dernier: res }) });
        setDernier(out.suivi.dernier);
        if (out.avertissement) setWarn(out.avertissement);
      } catch { setWarn("Le résultat n'a pas pu être gardé : il sera perdu en quittant la page."); }
    } catch (e) { setErr(e); setProgress(null); }
    finally { setBusy(""); }
  }

  async function decide(cle, statut, note) {
    const prev = decisions;
    setDecisions(d => { const n = { ...d }; if (statut) n[cle] = { statut, note, le: new Date().toISOString() }; else delete n[cle]; return n; });
    try {
      const out = await adminCall(router, "/api/admin/igloohome/suivi", { method: "PUT", body: JSON.stringify({ decision: { cle, statut, note } }) });
      setDecisions(out.suivi.decisions || {});
    } catch (e) { setDecisions(prev); setErr(e); }
  }

  const interps = useMemo(() => config?.interpretations || {}, [config]);
  const reg = useMemo(() => ({ ...DEFAULT_SETTINGS, ...(config?.reglages || {}) }), [config]);
  const shown = useMemo(() => (live ? resultat(live, interps, reg) : dernier), [live, dernier, interps, reg]);
  const perime = !live && dernier && dernier.interpretationsAuCalcul && dernier.interpretationsAuCalcul !== sig(interps);
  const visites = useMemo(() => shown?.visites || [], [shown]);
  const aTraiter = visites.filter(v => v.nuit && !decisions[v.cle]);
  const counts = {
    "a-traiter": aTraiter.length,
    nuit: visites.filter(v => v.nuit).length,
    jour: visites.filter(v => !v.nuit).length,
    "a-verifier": visites.filter(v => decisions[v.cle]?.statut === "a-verifier").length,
    tout: visites.length,
  };
  const FILTRES = [["a-traiter", "À traiter"], ["nuit", "Toutes les alertes de nuit"], ["a-verifier", "Marquées à vérifier"], ["jour", "Journée"], ["tout", "Tout"]];
  const apts = [...new Set(visites.map(v => v.appartement))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const liste = visites.filter(v => {
    if (fApt && v.appartement !== fApt) return false;
    if (filtre === "a-traiter") return v.nuit && !decisions[v.cle];
    if (filtre === "nuit") return v.nuit;
    if (filtre === "jour") return !v.nuit;
    if (filtre === "a-verifier") return decisions[v.cle]?.statut === "a-verifier";
    return true;
  });
  const types = shown?.types || [];
  const aValider = types.filter(t => !interps[t.type]?.valide).length;
  const plusAncien = (shown?.profondeur || []).map(p => p.plusAncien).filter(Boolean).sort()[0];
  const lues = (shown?.profondeur || []).length;

  if (busy === "load") return <div className="admin-note">Chargement…</div>;

  return (
    <div className="sv">
      <div className="sv-bar">
        <div className="sv-seg" role="tablist" aria-label="Période">
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} role="tab" aria-selected={preset === k} className={preset === k ? "on" : ""} onClick={() => choosePreset(k)} disabled={!!busy}>{p.label}</button>
          ))}
        </div>
        {preset === "autre" && (
          <div className="sv-dates">
            <label>Du <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
            <label>au <input type="date" value={to} min={from} max={today()} onChange={e => setTo(e.target.value)} /></label>
          </div>
        )}
        <button className="primary sv-run" onClick={run} disabled={!!busy}>{busy === "run" ? "Lecture en cours…" : shown ? "Relancer la lecture" : "Lancer la lecture"}</button>
      </div>
      <div className="sv-regle">
        Alerte de <b>{reg.heureDebut} h</b> à <b>{reg.heureFin} h</b> le lendemain · réservations de <b>{reg.heureArrivee} h</b> (arrivée) à <b>{reg.heureDepart} h</b> (départ)
        {onReglages && <button className="vf-link" onClick={onReglages}>Modifier</button>}
        <span className="sv-cout">igloohome facture 2 $ par serrure lue dans le mois.</span>
      </div>

      <Erreur e={err} />

      {progress && (
        <div className="sv-progress" aria-live="polite">
          <div className="sv-progress-head"><b>Lecture de l&apos;historique · {progress.i}/{progress.n} serrures</b><span>{progress.etape}</span></div>
          <div className="sv-progress-bar"><i style={{ width: `${(progress.i / Math.max(progress.n, 1)) * 100}%` }} /></div>
          {progress.lignes.length > 0 && (
            <div className="sv-progress-list">{progress.lignes.map(l => <span key={l.nom} className={l.ok ? "" : "ko"}>{l.ok ? "✓" : "✕"} {l.nom}{l.ok ? ` · ${l.nb}` : ""}</span>)}</div>
          )}
        </div>
      )}

      {!shown && !progress && (
        <div className="sv-empty">
          <b>Aucune lecture pour l&apos;instant.</b>
          <span>Choisissez une période puis « Lancer la lecture ». Les 19 serrures sont lues l&apos;une après l&apos;autre (une à trois minutes).</span>
        </div>
      )}

      {shown && !progress && (
        <>
          <div className="sv-head">
            <h2>{titrePeriode(shown.from, shown.to)}</h2>
            <span className="sv-lu">{live ? "Lu à l'instant" : `Lu ${ilYa(shown.lueLe)}`}</span>
          </div>

          <div className="sv-kpis">
            <button className={`sv-kpi${counts["a-traiter"] ? " hot" : ""}`} onClick={() => setFiltre("a-traiter")}><b>{counts["a-traiter"]}</b><span>alerte(s) de nuit à traiter</span></button>
            <button className="sv-kpi" onClick={() => setFiltre("nuit")}><b>{counts.nuit}</b><span>alerte(s) de nuit en tout</span></button>
            <button className="sv-kpi" onClick={() => setFiltre("jour")}><b>{counts.jour}</b><span>visite(s) de journée</span></button>
            <div className="sv-kpi static"><b>{lues}/{shown.nbSerrures || lues}</b><span>serrures lues{plusAncien ? ` · historique depuis le ${new Date(plusAncien).toLocaleDateString("fr-FR", { timeZone: TZ })}` : ""}</span></div>
          </div>

          {perime && <div className="sv-banner warn">Les interprétations ont changé depuis cette lecture : relancez la lecture pour recalculer les visites.</div>}
          {aValider > 0 && (
            <div className="sv-banner warn">
              <span><b>{aValider} type(s) d&apos;action à valider.</b> Tant qu&apos;ils ne le sont pas, les visites concernées restent « à confirmer ».</span>
              {onReglages && <button onClick={onReglages}>Valider dans Réglages</button>}
            </div>
          )}
          {warn && <div className="sv-banner">{warn}</div>}
          {(shown.incidents || []).length > 0 && (
            <details className="sv-banner"><summary>{shown.incidents.length} remarque(s) sur la lecture</summary>{shown.incidents.map(t => <div key={t}>{t}</div>)}</details>
          )}
          {(shown.nonResolues || []).length > 0 && (
            <details className="sv-banner warn">
              <summary>{shown.nonResolues.length} réservation(s) Cosy/Confort/Chic sans appartement précis dans Hostaway</summary>
              Elles ne couvrent aucune période : des visites de ces catégories peuvent apparaître à tort.
              {shown.nonResolues.map(r => <div key={r.id}>{r.client} · {r.arrivee} → {r.depart} · résa {r.id}</div>)}
            </details>
          )}

          <div className="sv-filters">
            <div className="sv-seg small">
              {FILTRES.map(([k, l]) => <button key={k} className={filtre === k ? "on" : ""} onClick={() => setFiltre(k)}>{l} <span className="sv-n">{counts[k]}</span></button>)}
            </div>
            <select value={fApt} onChange={e => setFApt(e.target.value)} aria-label="Appartement">
              <option value="">Tous les appartements</option>
              {apts.map(a => <option key={a}>{a}</option>)}
            </select>
            <button onClick={() => download(`visites-hors-reservation_${shown.from}_${shown.to}.csv`, visitesCsv(liste))} disabled={!liste.length}>Exporter ({liste.length})</button>
          </div>

          {liste.length ? (
            <div className="vf-list">
              {liste.map(v => <Visite key={v.cle} v={v} decision={decisions[v.cle]} onDecide={decide} busy={!!busy} />)}
            </div>
          ) : (
            <div className="sv-empty">
              <b>{filtre === "a-traiter" ? "Rien à traiter." : "Aucune visite pour ce filtre."}</b>
              <span>{filtre === "a-traiter" ? "Aucune alerte de nuit sans décision sur cette période." : "Changez de filtre ou d'appartement."}</span>
            </div>
          )}

          <details className="sv-tech">
            <summary>Profondeur de l&apos;historique lu</summary>
            {(shown.profondeur || []).map(p => (
              <div key={p.id}>
                {p.nom} : {p.nb} événement(s) · plus ancien : {p.plusAncien ? new Date(p.plusAncien).toLocaleString("fr-FR", { timeZone: TZ }) : "aucun"}
                {p.debutAtteint ? " · début de période atteint" : p.complet ? " · fin de l'historique igloohome" : " · lecture incomplète"}
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}

// Résultat affichable (et gardé) à partir d'une lecture : visites, types, résumés.
function resultat(r, interps, reglages) {
  const visites = visitesHorsReservation({
    devices: r.locks, events: r.events, mapping: r.config.mapping, reservations: r.resas.reservations,
    personnel: r.config.personnel, settings: reglages, interpretations: interps,
  }).filter(v => v.date >= r.from && v.date <= r.to)
    .map(v => ({ ...v, evenements: v.evenements.map(({ brut, ...x }) => x) })); // eslint-disable-line no-unused-vars
  return {
    from: r.from, to: r.to, lueLe: r.lueLe, nbSerrures: r.locks.length, nbResas: r.resas.reservations.length,
    incidents: r.incidents, nonResolues: r.resas.nonResolues, profondeur: r.profondeur,
    types: typesLus(r.events, interps).map(({ type, libelle, nombre, proposition, exemple }) => ({ type, libelle, nombre, proposition, exemple })),
    interpretationsAuCalcul: sig(interps),
    visites,
  };
}
