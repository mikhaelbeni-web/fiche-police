// components/admin/Nuki.js — onglet « Serrures Nuki » de l'Espace admin (Villiers, Lantiez, Deep 02).
// Ordinateur d'abord ; sur téléphone, les lignes passent en cartes.
//
// Principes (audit ui-ux-pro-max) :
//   - les codes sont regroupés par nom (« admin menage » = 1 ligne, 7 serrures) ;
//   - les valeurs des codes ne sont jamais chargées avec la liste : « Afficher » lit UN code,
//     masqué de nouveau au bout de 20 s ;
//   - toute action en masse passe par 3 étapes : saisie → récapitulatif serrure par serrure
//     → confirmation, puis un compte rendu par serrure (succès / échec, réessai des échecs) ;
//   - suppression : couleur danger, séparée des autres boutons, case « définitif » à cocher.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";

const TZ = "Europe/Paris";
const RESIDENCES = ["Villiers", "Lantiez", "Belleville"];
const PAQUET = 10;

function quand(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function jour(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
}
function cle(nom) { return String(nom || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr"); }
function pluriel(n, un, plusieurs) { return `${n} ${n > 1 ? (plusieurs || un + "s") : un}`; }

// Mêmes règles que le serveur (lib/nuki.js) : retour immédiat sous le champ.
export function erreurCode(c) {
  const s = String(c || "");
  if (!s) return "";
  if (!/^\d+$/.test(s)) return "Chiffres seulement.";
  if (s.includes("0")) return "Pas de 0 sur le clavier Nuki : chiffres 1 à 9.";
  if (s.startsWith("12")) return "Nuki interdit les codes qui commencent par 12.";
  if (s.length !== 6) return "6 chiffres exactement.";
  return "";
}

const LIBELLES = {
  code: { titre: "Changer le code", verbe: "Changer le code", bouton: n => `Changer le code sur ${pluriel(n, "serrure")}` },
  renommer: { titre: "Renommer", verbe: "Renommer", bouton: n => `Renommer ${pluriel(n, "code")}` },
  desactiver: { titre: "Désactiver", verbe: "Désactiver", bouton: n => `Désactiver ${pluriel(n, "code")}` },
  activer: { titre: "Réactiver", verbe: "Réactiver", bouton: n => `Réactiver ${pluriel(n, "code")}` },
  supprimer: { titre: "Supprimer", verbe: "Supprimer", bouton: n => `Supprimer définitivement ${pluriel(n, "code")}` },
  creer: { titre: "Nouveau code", verbe: "Créer", bouton: n => `Créer le code sur ${pluriel(n, "serrure")}` },
};

// ---------------------------------------------------------------------------

export default function Nuki() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [vue, setVue] = useState("codes");
  const [historiqueDe, setHistoriqueDe] = useState("");

  async function charger() {
    setChargement(true); setErr(null);
    try { setData(await adminCall(router, "/api/admin/nuki/etat")); }
    catch (e) { setErr(e); }
    finally { setChargement(false); }
  }
  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const serrures = data?.serrures || [];
  const parId = useMemo(() => new Map(serrures.map(s => [String(s.id), s])), [serrures]);
  const horsLigne = serrures.filter(s => !s.enLigne);

  return (
    <div className="nk">
      <div className="nk-top">
        <nav className="sv-seg" aria-label="Vue Nuki">
          {[["codes", "Codes clavier"], ["serrures", "Serrures"], ["historique", "Historique"]].map(([k, l]) => (
            <button key={k} className={vue === k ? "on" : ""} aria-pressed={vue === k} onClick={() => setVue(k)}>{l}</button>
          ))}
        </nav>
        <div className="nk-lu">
          {data && <span>Lu à {new Date(data.lueLe).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}</span>}
          <button className="ghost" onClick={charger} disabled={chargement}>{chargement ? "Lecture…" : "Relire"}</button>
        </div>
      </div>

      <Erreur e={err} />
      {chargement && !data && <div className="sv-empty"><b>Lecture des serrures Nuki…</b><span>Quelques secondes.</span></div>}

      {data && horsLigne.length > 0 && (
        <div className="sv-banner warn" role="status">
          <span>
            <b>{pluriel(horsLigne.length, "serrure hors ligne")}</b> : {horsLigne.map(s => s.nom).join(", ")}.
            {" "}Nuki y appliquera les changements dès qu&apos;elles seront de nouveau jointes : relisez ensuite pour vérifier.
          </span>
        </div>
      )}

      {data && vue === "codes" && <Codes data={data} parId={parId} router={router} recharger={charger} />}
      {data && vue === "serrures" && <Serrures data={data} onHistorique={id => { setHistoriqueDe(String(id)); setVue("historique"); }} />}
      {data && vue === "historique" && <Historique serrures={serrures} parId={parId} router={router} initial={historiqueDe} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Codes clavier

function Codes({ data, parId, router, recharger }) {
  const [residences, setResidences] = useState(["Villiers", "Lantiez"]);
  const [portee, setPortee] = useState("permanents");
  const [recherche, setRecherche] = useState("");
  const [ouverts, setOuverts] = useState(() => new Set());
  const [sel, setSel] = useState(() => new Set());
  const [action, setAction] = useState(null); // { type, items }

  const codes = useMemo(() => data.codes.map(c => ({ ...c, serrure: parId.get(String(c.smartlockId)) }))
    .filter(c => c.serrure), [data, parId]);

  const visibles = useMemo(() => {
    const q = cle(recherche);
    return codes.filter(c => residences.includes(c.serrure.residence))
      .filter(c => portee === "tous" || (portee === "permanents" ? !c.fin : Boolean(c.fin)))
      .filter(c => !q || cle(c.nom).includes(q) || cle(c.serrure.nom).includes(q));
  }, [codes, residences, portee, recherche]);

  const groupes = useMemo(() => {
    const m = new Map();
    for (const c of visibles) {
      const k = cle(c.nom) || "(sans nom)";
      if (!m.has(k)) m.set(k, { cle: k, nom: c.nom || "(sans nom)", items: [] });
      m.get(k).items.push(c);
    }
    const out = [...m.values()].map(g => {
      g.items.sort((a, b) => a.serrure.nom.localeCompare(b.serrure.nom, "fr", { numeric: true }));
      g.variantes = new Set(g.items.map(i => i.variante).filter(Boolean));
      g.inactifs = g.items.filter(i => !i.actif).length;
      g.derniere = g.items.reduce((m2, i) => (i.derniereUtilisation && i.derniereUtilisation > m2 ? i.derniereUtilisation : m2), "");
      g.residences = [...new Set(g.items.map(i => i.serrure.residence))];
      g.horsLigne = g.items.filter(i => !i.serrure.enLigne).length;
      return g;
    });
    // Les codes utilisés récemment d'abord (le code du ménage sert tous les jours).
    out.sort((a, b) => String(b.derniere).localeCompare(String(a.derniere)) || (b.items.length - a.items.length) || a.nom.localeCompare(b.nom, "fr"));
    return out;
  }, [visibles]);

  const parIdCode = useMemo(() => new Map(codes.map(c => [c.id, c])), [codes]);
  const selection = [...sel].map(id => parIdCode.get(id)).filter(Boolean);
  const nbSerruresSel = new Set(selection.map(c => c.smartlockId)).size;

  function basculer(ids, on) {
    setSel(s => { const n = new Set(s); ids.forEach(id => (on ? n.add(id) : n.delete(id))); return n; });
  }
  function basculerOuvert(k) {
    setOuverts(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function toggleResidence(r) {
    setResidences(rs => (rs.includes(r) ? rs.filter(x => x !== r) : [...rs, r]));
  }

  const totalVisibles = visibles.length;
  const toutCoche = totalVisibles > 0 && visibles.every(c => sel.has(c.id));

  return (
    <>
      <div className="sv-kpis nk-kpis">
        <div className="sv-kpi static"><b>{data.serrures.filter(s => residences.includes(s.residence)).length}</b><span>serrures ({residences.join(", ") || "aucune résidence"})</span></div>
        <div className="sv-kpi static"><b>{groupes.length}</b><span>noms de code affichés</span></div>
        <div className="sv-kpi static"><b>{totalVisibles}</b><span>codes clavier affichés</span></div>
        <div className={"sv-kpi static" + (selection.length ? " sel" : "")}><b>{selection.length}</b><span>sélectionné(s){selection.length ? ` · ${pluriel(nbSerruresSel, "serrure")}` : ""}</span></div>
      </div>

      <div className="sv-filters nk-filters">
        <div className="nk-chips" role="group" aria-label="Résidences">
          {RESIDENCES.map(r => (
            <button key={r} className={"nk-chip" + (residences.includes(r) ? " on" : "")} aria-pressed={residences.includes(r)} onClick={() => toggleResidence(r)}>
              {r}{r === "Belleville" ? " (Deep 02)" : ""}
            </button>
          ))}
        </div>
        <div className="sv-seg small" role="group" aria-label="Durée des codes">
          {[["permanents", "Permanents"], ["temporaires", "Avec date de fin"], ["tous", "Tous"]].map(([k, l]) => (
            <button key={k} className={portee === k ? "on" : ""} aria-pressed={portee === k} onClick={() => setPortee(k)}>{l}</button>
          ))}
        </div>
        <label className="nk-search">
          <span className="sr-only">Rechercher un nom de code ou une serrure</span>
          <input type="search" placeholder="Rechercher : admin menage, Villiers II…" value={recherche} onChange={e => setRecherche(e.target.value)} />
        </label>
        <button className="primary" onClick={() => setAction({ type: "creer", items: [] })}>+ Nouveau code</button>
      </div>

      {groupes.length === 0 ? (
        <div className="sv-empty"><b>Aucun code avec ces filtres.</b><span>Changez de résidence ou de durée, ou videz la recherche.</span></div>
      ) : (
        <div className="nk-list" role="table" aria-label="Codes clavier Nuki">
          <div className="nk-row nk-head" role="row">
            <span role="columnheader">
              <input type="checkbox" aria-label="Tout sélectionner" checked={toutCoche} onChange={e => basculer(visibles.map(c => c.id), e.target.checked)} />
            </span>
            <span role="columnheader">Nom du code</span>
            <span role="columnheader">Serrures</span>
            <span role="columnheader">Valeur</span>
            <span role="columnheader">Dernière utilisation</span>
            <span role="columnheader"></span>
          </div>
          {groupes.map(g => {
            const ids = g.items.map(i => i.id);
            const n = ids.filter(id => sel.has(id)).length;
            const ouvert = ouverts.has(g.cle);
            return (
              <div key={g.cle} className={"nk-group" + (n ? " sel" : "")}>
                <div className="nk-row" role="row">
                  <span role="cell">
                    <input type="checkbox" aria-label={`Sélectionner « ${g.nom} » sur ${g.items.length} serrure(s)`} checked={n === ids.length}
                      ref={el => { if (el) el.indeterminate = n > 0 && n < ids.length; }}
                      onChange={e => basculer(ids, e.target.checked)} />
                  </span>
                  <span role="cell" className="nk-nom">
                    <button className="nk-link" onClick={() => basculerOuvert(g.cle)} aria-expanded={ouvert}>{g.nom}</button>
                    {g.inactifs > 0 && <span className="vf-badge jour">{g.inactifs === g.items.length ? "désactivé" : `${g.inactifs} désactivé(s)`}</span>}
                  </span>
                  <span role="cell" className="nk-serr">
                    <b>{pluriel(g.items.length, "serrure")}</b>
                    <span className="vf-muted"> · {g.residences.join(", ")}</span>
                    <span className="nk-noms">{g.items.map(i => i.serrure.nom).join(" · ")}</span>
                  </span>
                  <span role="cell">
                    {g.variantes.size <= 1
                      ? <span className="nk-same">{g.items.length > 1 ? "Même code partout" : "••••••"}</span>
                      : <span className="nk-diff">{g.variantes.size} codes différents</span>}
                  </span>
                  <span role="cell" className="vf-muted">{quand(g.derniere)}</span>
                  <span role="cell">
                    <button className="ghost nk-detail" onClick={() => basculerOuvert(g.cle)} aria-expanded={ouvert}>{ouvert ? "Masquer" : "Détail"}</button>
                  </span>
                </div>
                {ouvert && (
                  <div className="nk-items">
                    {g.items.map(i => (
                      <div key={i.id} className={"nk-item" + (sel.has(i.id) ? " sel" : "")}>
                        <input type="checkbox" aria-label={`Sélectionner « ${g.nom} » sur ${i.serrure.nom}`} checked={sel.has(i.id)} onChange={e => basculer([i.id], e.target.checked)} />
                        <span className="nk-item-serr"><b>{i.serrure.nom}</b> <span className="vf-muted">{i.serrure.residence}</span>
                          {!i.serrure.enLigne && <span className="vf-badge nk-warn">hors ligne</span>}</span>
                        <span>{i.actif ? "Actif" : <span className="vf-muted">Désactivé</span>}
                          {i.enCours && <span className="vf-badge nk-warn">synchro en cours</span>}
                          {i.erreur && <span className="vf-badge alerte" title={i.erreur}>erreur Nuki</span>}</span>
                        <span className="vf-muted">{i.fin ? `jusqu'au ${jour(i.fin)}` : "permanent"}</span>
                        <span className="vf-muted">{i.derniereUtilisation ? `utilisé ${quand(i.derniereUtilisation)}` : "jamais utilisé"}</span>
                        <Valeur router={router} item={i} lettre={g.variantes.size > 1 ? i.variante : null} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selection.length > 0 && (
        <div className="nk-bar" role="region" aria-label="Actions sur la sélection">
          <span className="nk-bar-n"><b>{pluriel(selection.length, "code")}</b> sur {pluriel(nbSerruresSel, "serrure")}</span>
          <button className="primary" onClick={() => setAction({ type: "code", items: selection })}>Changer le code…</button>
          <button onClick={() => setAction({ type: "renommer", items: selection })}>Renommer…</button>
          <button onClick={() => setAction({ type: "desactiver", items: selection })}>Désactiver</button>
          <button onClick={() => setAction({ type: "activer", items: selection })}>Réactiver</button>
          <span className="nk-sep" aria-hidden="true" />
          <button className="nk-danger" onClick={() => setAction({ type: "supprimer", items: selection })}>Supprimer…</button>
          <button className="ghost" onClick={() => setSel(new Set())}>Vider</button>
        </div>
      )}

      {action && (
        <Assistant
          action={action}
          serrures={data.serrures}
          router={router}
          onFermer={changed => { setAction(null); if (changed) recharger(); }}
          onReessayer={ids => { setSel(new Set(ids)); }}
        />
      )}
    </>
  );
}

function Valeur({ router, item, lettre }) {
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [e, setE] = useState("");
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  async function afficher() {
    setBusy(true); setE("");
    try {
      const d = await adminCall(router, `/api/admin/nuki/code?smartlockId=${encodeURIComponent(item.smartlockId)}&id=${encodeURIComponent(item.id)}`);
      setV(d.code || "—");
      clearTimeout(t.current);
      t.current = setTimeout(() => setV(null), 20000);
    } catch (x) { setE(x.error || "Erreur"); }
    finally { setBusy(false); }
  }
  return (
    <span className="nk-val">
      {lettre && <span className="nk-lettre" title="Les codes de même lettre ont la même valeur">{lettre}</span>}
      {v ? <code className="nk-pin" aria-live="polite">{v}</code> : <span className="nk-mask" aria-label="code masqué">••••••</span>}
      {v
        ? <button className="nk-link" onClick={() => { clearTimeout(t.current); setV(null); }}>Masquer</button>
        : <button className="nk-link" onClick={afficher} disabled={busy}>{busy ? "…" : "Afficher"}</button>}
      {e && <span className="nk-err">{e}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Assistant : saisie → récapitulatif → exécution → compte rendu

function Assistant({ action, serrures, router, onFermer, onReessayer }) {
  const { type, items } = action;
  const L = LIBELLES[type];
  const [etape, setEtape] = useState(type === "desactiver" || type === "activer" ? "recap" : "saisie");
  const [code, setCode] = useState("");
  const [code2, setCode2] = useState("");
  const [voir, setVoir] = useState(false);
  const [nom, setNom] = useState(type === "renommer" && items.length ? items[0].nom : "");
  const [renommerAussi, setRenommerAussi] = useState(false);
  const [cibles, setCibles] = useState(() => new Set());
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [definitif, setDefinitif] = useState(false);
  const [avance, setAvance] = useState({ fait: 0, total: 0 });
  const [resultats, setResultats] = useState([]);
  const [errGlobale, setErrGlobale] = useState(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const onKey = e => { if (e.key === "Escape" && etape !== "execution") onFermer(etape === "rendu"); };
    window.addEventListener("keydown", onKey);
    (dialogRef.current?.querySelector(".nk-dlg-body input") || dialogRef.current?.querySelector(".nk-dlg-foot .primary, .nk-dlg-foot button"))?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [etape]); // eslint-disable-line react-hooks/exhaustive-deps

  const parId = useMemo(() => new Map(serrures.map(s => [String(s.id), s])), [serrures]);
  const lignes = type === "creer"
    ? serrures.filter(s => cibles.has(String(s.id))).map(s => ({ key: String(s.id), serrure: s, nom: nom.trim() }))
    : items.map(i => ({ key: i.id, serrure: parId.get(String(i.smartlockId)), nom: i.nom, item: i }));

  // Deux codes de la même serrure ne peuvent pas recevoir la même valeur.
  const doublonsSerrure = useMemo(() => {
    if (type !== "code") return new Set();
    const vu = new Map(); const d = new Set();
    for (const i of items) { const k = String(i.smartlockId); if (vu.has(k)) d.add(i.id); else vu.set(k, i.id); }
    return d;
  }, [type, items]);

  // Une serrure ne peut pas porter deux fois la même valeur : changer le code de plusieurs
  // codes d'une même serrure n'a pas de sens (un seul passerait). On bloque et on explique.
  const bloque = type === "code" && doublonsSerrure.size > 0;
  const serruresMultiples = useMemo(() => {
    if (!bloque) return [];
    const n = new Map();
    items.forEach(i => n.set(String(i.smartlockId), (n.get(String(i.smartlockId)) || 0) + 1));
    return [...n.entries()].filter(([, k]) => k > 1).map(([id, k]) => `${parId.get(id)?.nom || id} (${k})`);
  }, [bloque, items, parId]);
  const nomsSel = [...new Set(items.map(i => i.nom || "(sans nom)"))];
  const eCode = code.length < 6 ? erreurCode(code + "1".repeat(6 - code.length)) : erreurCode(code); // pas d'alerte de longueur pendant la frappe
  const eCode2 = code2 && code2 !== code ? "Les deux saisies sont différentes." : "";
  const besoinCode = type === "code" || type === "creer";
  const besoinNom = type === "renommer" || type === "creer" || (type === "code" && renommerAussi);
  const eNom = besoinNom && (!nom.trim() ? "Nom obligatoire." : nom.trim().length > 32 ? "32 caractères au maximum." : "");
  const saisieOk = (!besoinCode || (code.length === 6 && !eCode && code2 === code)) && (!besoinNom || !eNom)
    && (type !== "creer" || cibles.size > 0) && (type !== "creer" || !(debut && fin && fin <= debut));

  async function executer() {
    setEtape("execution"); setErrGlobale(null);
    const out = [];
    if (type === "creer") {
      const ids = [...cibles];
      setAvance({ fait: 0, total: ids.length });
      for (let k = 0; k < ids.length; k += PAQUET) {
        const paquet = ids.slice(k, k + PAQUET);
        try {
          const d = await adminCall(router, "/api/admin/nuki/creer", { method: "POST", body: JSON.stringify({ confirme: true, nom: nom.trim(), code, smartlockIds: paquet, debut: debut || null, fin: fin || null }) });
          out.push(...d.resultats);
        } catch (e) {
          paquet.forEach(s => out.push({ smartlockId: Number(s), ok: false, erreur: e.error || "Envoi impossible" }));
          setErrGlobale(e);
        }
        setAvance({ fait: Math.min(ids.length, k + PAQUET), total: ids.length });
        setResultats([...out]);
      }
    } else {
      const envoi = items.filter(i => !doublonsSerrure.has(i.id));
      items.filter(i => doublonsSerrure.has(i.id)).forEach(i => out.push({ smartlockId: i.smartlockId, id: i.id, nom: i.nom, ok: false, erreur: "Non envoyé : un autre code de cette serrure reçoit déjà cette valeur." }));
      setAvance({ fait: 0, total: envoi.length });
      for (let k = 0; k < envoi.length; k += PAQUET) {
        const paquet = envoi.slice(k, k + PAQUET);
        const body = { confirme: true, action: type, items: paquet.map(i => ({ smartlockId: i.smartlockId, id: i.id })) };
        if (type === "code") { body.code = code; if (renommerAussi) body.nom = nom.trim(); }
        if (type === "renommer") body.nom = nom.trim();
        try {
          const d = await adminCall(router, "/api/admin/nuki/masse", { method: "POST", body: JSON.stringify(body) });
          out.push(...d.resultats);
        } catch (e) {
          paquet.forEach(i => out.push({ smartlockId: i.smartlockId, id: i.id, nom: i.nom, ok: false, erreur: e.error || "Envoi impossible" }));
          setErrGlobale(e);
        }
        setAvance({ fait: Math.min(envoi.length, k + PAQUET), total: envoi.length });
        setResultats([...out]);
      }
    }
    setCode(""); setCode2(""); // le code ne reste pas en mémoire de la page
    setResultats(out);
    setEtape("rendu");
  }

  const reussis = resultats.filter(r => r.ok).length;
  const echecs = resultats.filter(r => !r.ok);

  return (
    <div className="nk-overlay" onMouseDown={e => { if (e.target === e.currentTarget && etape !== "execution") onFermer(etape === "rendu"); }}>
      <div className="nk-dialog" role="dialog" aria-modal="true" aria-labelledby="nk-dlg-titre" ref={dialogRef}>
        <div className="nk-dlg-head">
          <h3 id="nk-dlg-titre">{L.titre}</h3>
          <ol className="nk-steps" aria-label="Étapes">
            {(type === "desactiver" || type === "activer" ? ["Vérifier", "Compte rendu"] : ["Saisir", "Vérifier", "Compte rendu"]).map((s, k, arr) => {
              const cur = etape === "saisie" ? 0 : etape === "recap" ? arr.length - 2 : arr.length - 1;
              return <li key={s} className={k === cur ? "on" : k < cur ? "fait" : ""}>{s}</li>;
            })}
          </ol>
          {etape !== "execution" && <button className="ghost nk-close" aria-label="Fermer" onClick={() => onFermer(etape === "rendu")}>✕</button>}
        </div>

        {etape === "saisie" && bloque && (
          <div className="nk-dlg-body">
            <div className="sv-banner warn" role="alert">
              <span>
                <b>Impossible : la sélection contient plusieurs codes sur la même serrure.</b> Une serrure ne peut pas avoir deux codes de même valeur, donc un seul passerait par serrure.
              </span>
            </div>
            <p className="rg-help">Sélection : {pluriel(items.length, "code")} ({pluriel(nomsSel.length, "nom")} : {nomsSel.slice(0, 6).join(", ")}{nomsSel.length > 6 ? "…" : ""}). Serrures concernées : {serruresMultiples.slice(0, 10).join(", ")}{serruresMultiples.length > 10 ? "…" : ""}.</p>
            <p className="nk-recap-phrase"><b>Pour changer le code du ménage :</b> sélectionnez un seul nom (par exemple « admin menage ») puis « Changer le code ».</p>
            <p className="nk-recap-phrase"><b>Pour ne garder qu&apos;un seul code :</b> créez-le avec « + Nouveau code » sur toutes les serrures, puis sélectionnez les anciens codes et « Supprimer ». Gardez « Code d&apos;entrée », « sortie villiers » et vos propres accès.</p>
          </div>
        )}

        {etape === "saisie" && !bloque && (
          <div className="nk-dlg-body">
            {type !== "creer" && <p className="rg-help">{pluriel(items.length, "code")} sélectionné(s) sur {pluriel(new Set(items.map(i => i.smartlockId)).size, "serrure")}.</p>}
            {type === "creer" && (
              <label className="nk-field"><span>Nom du code <small>(visible dans l&apos;application Nuki et dans l&apos;historique)</small></span>
                <input value={nom} maxLength={32} onChange={e => setNom(e.target.value)} placeholder="ex. admin menage" />
                {eNom && nom && <span className="nk-err">{eNom}</span>}
              </label>
            )}
            {besoinCode && (
              <div className="nk-codes">
                <label className="nk-field"><span>Nouveau code <small>(6 chiffres de 1 à 9)</small></span>
                  <input inputMode="numeric" autoComplete="off" maxLength={6} type={voir ? "text" : "password"} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} aria-invalid={Boolean(eCode)} />
                  {eCode && <span className="nk-err">{eCode}</span>}
                </label>
                <label className="nk-field">Retaper le code
                  <input inputMode="numeric" autoComplete="off" maxLength={6} type={voir ? "text" : "password"} value={code2} onChange={e => setCode2(e.target.value.replace(/\D/g, ""))} aria-invalid={Boolean(eCode2)} />
                  {eCode2 && <span className="nk-err">{eCode2}</span>}
                </label>
                <label className="nk-check"><input type="checkbox" checked={voir} onChange={e => setVoir(e.target.checked)} /> Afficher les chiffres</label>
              </div>
            )}
            {type === "code" && (
              <>
                <label className="nk-check"><input type="checkbox" checked={renommerAussi} onChange={e => setRenommerAussi(e.target.checked)} /> Renommer aussi ces codes</label>
                {renommerAussi && (
                  <label className="nk-field">Nouveau nom
                    <input value={nom} maxLength={32} onChange={e => setNom(e.target.value)} placeholder="ex. admin menage" />
                    {eNom && <span className="nk-err">{eNom}</span>}
                  </label>
                )}
              </>
            )}
            {type === "renommer" && (
              <label className="nk-field"><span>Nouveau nom <small>(32 caractères au maximum)</small></span>
                <input value={nom} maxLength={32} onChange={e => setNom(e.target.value)} />
                {eNom && <span className="nk-err">{eNom}</span>}
              </label>
            )}
            {type === "creer" && (
              <>
                <ChoixSerrures serrures={serrures} cibles={cibles} setCibles={setCibles} />
                <details className="nk-plage">
                  <summary>Limiter dans le temps (facultatif)</summary>
                  <div className="rg-hours">
                    <label>Début<input type="datetime-local" value={debut} onChange={e => setDebut(e.target.value)} /></label>
                    <label>Fin<input type="datetime-local" value={fin} onChange={e => setFin(e.target.value)} /></label>
                  </div>
                  {debut && fin && fin <= debut && <span className="nk-err">La fin doit être après le début.</span>}
                  <p className="rg-help">Sans dates, le code est permanent.</p>
                </details>
              </>
            )}
            {type === "supprimer" && <p className="rg-help">Passez à l&apos;étape suivante pour vérifier la liste.</p>}
          </div>
        )}

        {etape === "recap" && (
          <div className="nk-dlg-body">
            <p className="nk-recap-phrase">
              {type === "code" && <>Le code <b>{voir ? code : "••••••"}</b>{renommerAussi ? <> (nom « <b>{nom.trim()}</b> »)</> : null} va remplacer l&apos;ancien sur ces serrures :</>}
              {type === "renommer" && <>Ces codes vont s&apos;appeler « <b>{nom.trim()}</b> » :</>}
              {type === "desactiver" && <>Ces codes ne vont plus ouvrir (ils restent enregistrés, réactivables) :</>}
              {type === "activer" && <>Ces codes vont de nouveau ouvrir :</>}
              {type === "supprimer" && <>Ces codes vont être <b>supprimés définitivement</b> :</>}
              {type === "creer" && <>Le code « <b>{nom.trim()}</b> » ({voir ? code : "••••••"}) va être créé sur ces serrures{fin ? `, jusqu'au ${quand(new Date(fin).toISOString())}` : ", sans limite de durée"} :</>}
            </p>
            <div className="nk-recap">
              {lignes.map(l => (
                <div key={l.key} className={"nk-recap-row" + (l.item && doublonsSerrure.has(l.item.id) ? " ko" : "")}>
                  <b>{l.serrure?.nom || "?"}</b>
                  <span className="vf-muted">{l.serrure?.residence}</span>
                  <span>{l.nom}</span>
                  <span>
                    {l.serrure && !l.serrure.enLigne && <span className="vf-badge nk-warn">hors ligne : appliqué à la reconnexion</span>}
                    {l.item && doublonsSerrure.has(l.item.id) && <span className="vf-badge alerte">ignoré : 2 codes de cette serrure dans la sélection</span>}
                  </span>
                </div>
              ))}
            </div>
            {type === "supprimer" && (
              <label className="nk-check nk-danger-check"><input type="checkbox" checked={definitif} onChange={e => setDefinitif(e.target.checked)} /> Je comprends que la suppression est définitive.</label>
            )}
          </div>
        )}

        {(etape === "execution" || etape === "rendu") && (
          <div className="nk-dlg-body">
            {etape === "execution" && (
              <div className="sv-progress" role="status" aria-live="polite">
                <div className="sv-progress-head"><b>Envoi à Nuki…</b><span>{avance.fait} / {avance.total}</span></div>
                <div className="sv-progress-bar"><i style={{ width: `${avance.total ? (100 * avance.fait / avance.total) : 0}%` }} /></div>
                <p className="rg-help">Ne fermez pas la page pendant l&apos;envoi.</p>
              </div>
            )}
            {etape === "rendu" && (
              <div className={"sv-banner" + (echecs.length ? " warn" : "")} role="status">
                <span><b>{reussis} réussi(s)</b>{echecs.length ? <>, <b>{echecs.length} échec(s)</b></> : ""}. Nuki transmet ensuite chaque changement à la serrure (quelques secondes, ou à sa reconnexion si elle est hors ligne).</span>
              </div>
            )}
            <Erreur e={errGlobale} />
            <div className="nk-recap">
              {resultats.map((r, k) => {
                const s = parId.get(String(r.smartlockId));
                return (
                  <div key={(r.id || r.smartlockId) + ":" + k} className={"nk-recap-row " + (r.ok ? "ok" : "ko")}>
                    <b>{r.ok ? "✓" : "✗"} {s?.nom || r.smartlockId}</b>
                    <span className="vf-muted">{s?.residence}</span>
                    <span>{r.nom || ""}</span>
                    <span>{r.ok ? (r.statut || "fait") + (s && !s.enLigne ? " · serrure hors ligne : en attente" : "") : <span className="nk-err">{r.erreur}{r.detailNuki ? ` (${r.detailNuki})` : ""}</span>}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="nk-dlg-foot">
          {etape === "saisie" && <>
            <button className="ghost" onClick={() => onFermer(false)}>Annuler</button>
            <button className="primary" disabled={bloque || !saisieOk || (type !== "creer" && !items.length)} onClick={() => setEtape("recap")}>Vérifier avant d&apos;envoyer</button>
          </>}
          {etape === "recap" && <>
            {type === "desactiver" || type === "activer"
              ? <button className="ghost" onClick={() => onFermer(false)}>Annuler</button>
              : <button className="ghost" onClick={() => setEtape("saisie")}>← Modifier</button>}
            <button className={type === "supprimer" ? "nk-danger solid" : "primary"} disabled={(type === "supprimer" && !definitif) || !lignes.length} onClick={executer}>
              {L.bouton(type === "code" ? lignes.length - doublonsSerrure.size : lignes.length)}
            </button>
          </>}
          {etape === "rendu" && <>
            {echecs.length > 0 && type !== "creer" && <button onClick={() => { onReessayer(echecs.map(r => r.id).filter(Boolean)); onFermer(true); }}>{echecs.length > 1 ? `Sélectionner les ${echecs.length} échecs` : "Sélectionner l'échec"}</button>}
            <button className="primary" onClick={() => onFermer(true)}>Terminer et relire les serrures</button>
          </>}
        </div>
      </div>
    </div>
  );
}

function ChoixSerrures({ serrures, cibles, setCibles }) {
  function bascule(ids, on) { setCibles(s => { const n = new Set(s); ids.forEach(i => (on ? n.add(i) : n.delete(i))); return n; }); }
  return (
    <fieldset className="nk-choix">
      <legend>Serrures</legend>
      {RESIDENCES.map(r => {
        const list = serrures.filter(s => s.residence === r);
        if (!list.length) return null;
        const ids = list.map(s => String(s.id));
        const tout = ids.every(i => cibles.has(i));
        return (
          <div key={r} className="nk-choix-res">
            <label className="nk-check"><input type="checkbox" checked={tout} onChange={e => bascule(ids, e.target.checked)} /> <b>{r}</b> <span className="vf-muted">(toutes, {list.length})</span></label>
            <div className="nk-choix-list">
              {list.map(s => (
                <label key={s.id} className="nk-check">
                  <input type="checkbox" checked={cibles.has(String(s.id))} onChange={e => bascule([String(s.id)], e.target.checked)} /> {s.nom}
                  {!s.enLigne && <span className="vf-badge nk-warn">hors ligne</span>}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Serrures

function Serrures({ data, onHistorique }) {
  const nbCodes = useMemo(() => {
    const m = new Map();
    data.codes.forEach(c => m.set(String(c.smartlockId), (m.get(String(c.smartlockId)) || 0) + 1));
    return m;
  }, [data]);
  return (
    <div className="tbl-wrap nk-serrures">
      <table className="tbl admin-tbl">
        <thead><tr><th>Serrure</th><th>Résidence</th><th>Connexion</th><th>État</th><th>Batterie</th><th>Clavier</th><th>Codes</th><th></th></tr></thead>
        <tbody>
          {data.serrures.map(s => (
            <tr key={s.id}>
              <td><b>{s.nom}</b></td>
              <td>{s.residence}</td>
              <td>{s.enLigne ? <span className="rg-ok">En ligne</span> : <span className="rg-todo">{s.etatServeur}</span>}</td>
              <td>{s.etat}</td>
              <td>{s.batterieFaible ? <span className="rg-todo">Faible{s.batterie != null ? ` (${s.batterie} %)` : ""}</span> : s.batterie != null ? `${s.batterie} %` : "OK"}</td>
              <td>{s.clavier ? (s.clavierBatterieFaible ? <span className="rg-todo">Pile faible</span> : "Oui") : "—"}</td>
              <td>{nbCodes.get(String(s.id)) || 0}</td>
              <td><button className="ghost" onClick={() => onHistorique(s.id)}>Historique</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historique

function Historique({ serrures, parId, router, initial }) {
  const [serrure, setSerrure] = useState(initial || "");
  const [jours, setJours] = useState(7);
  const [q, setQ] = useState("");
  const [evs, setEvs] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function lire() {
    setBusy(true); setErr(null);
    try {
      const d = await adminCall(router, `/api/admin/nuki/historique?jours=${jours}${serrure ? `&smartlockId=${serrure}` : ""}`);
      setEvs(d.evenements);
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  }
  useEffect(() => { lire(); }, [serrure, jours]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = cle(q);
  const liste = (evs || []).filter(e => !k || cle(e.qui).includes(k) || cle(parId.get(String(e.smartlockId))?.nom).includes(k))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return (
    <>
      <div className="sv-filters">
        <select value={serrure} onChange={e => setSerrure(e.target.value)} aria-label="Serrure">
          <option value="">Toutes les serrures</option>
          {serrures.map(s => <option key={s.id} value={String(s.id)}>{s.nom} ({s.residence})</option>)}
        </select>
        <div className="sv-seg small" role="group" aria-label="Période">
          {[[1, "24 h"], [7, "7 jours"], [30, "30 jours"]].map(([v, l]) => (
            <button key={v} className={jours === v ? "on" : ""} aria-pressed={jours === v} onClick={() => setJours(v)}>{l}</button>
          ))}
        </div>
        <label className="nk-search">
          <span className="sr-only">Filtrer par nom</span>
          <input type="search" placeholder="Filtrer : admin menage, Villiers V…" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <button className="ghost" onClick={lire} disabled={busy}>{busy ? "Lecture…" : "Relire"}</button>
      </div>
      <Erreur e={err} />
      {evs && (liste.length === 0
        ? <div className="sv-empty"><b>Aucun événement.</b><span>Essayez une période plus longue.</span></div>
        : (
          <div className="tbl-wrap"><table className="tbl admin-tbl nk-hist">
            <thead><tr><th>Date (Paris)</th><th>Serrure</th><th>Qui</th><th>Action</th><th>Par</th><th>Résultat</th></tr></thead>
            <tbody>
              {liste.map(e => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{quand(e.date)}</td>
                  <td>{parId.get(String(e.smartlockId))?.nom || e.smartlockId}</td>
                  <td>{e.qui || <span className="vf-muted">—</span>}</td>
                  <td>{e.action}</td>
                  <td>{e.source || e.declencheur}</td>
                  <td>{e.reussi ? "Réussi" : <span className="rg-todo">{e.resultat}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ))}
      {evs && <p className="sv-tech">{liste.length} événement(s) affiché(s). Nuki renvoie au plus 1 000 événements pour toutes les serrures, 300 pour une seule.</p>}
    </>
  );
}
