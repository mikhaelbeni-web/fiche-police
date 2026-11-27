// porte-samsic/pages/index.js
// Page unique du portail : mot de passe, puis état de la porte, trois actions avec
// confirmation, et les derniers événements de la serrure. La session (cookie signé,
// 12 h) est vérifiée côté serveur à chaque chargement et à chaque appel /api/*.
import Head from "next/head";
import { useCallback, useEffect, useRef, useState } from "react";
import { isConfigure, manques, expirationSession } from "../lib/session.js";

export function getServerSideProps(ctx) {
  ctx.res.setHeader("Cache-Control", "no-store");
  const nom = (process.env.PORTE_NOM || "").trim() || "Porte du bureau — Résidence Le Belleville";
  const contact = (process.env.PORTE_CONTACT || "").trim();
  if (!isConfigure()) return { props: { nom, contact, configure: false, manques: manques(), connecte: false, expiresAt: 0 } };
  const exp = expirationSession(ctx.req);
  return { props: { nom, contact, configure: true, manques: [], connecte: exp > 0, expiresAt: exp } };
}

const TZ = "Europe/Paris";
const ACTIONS = [
  { id: "ouvrir", bouton: "Ouvrir la porte", confirme: "Confirmer l'ouverture", classe: "ouvrir", aide: "Déverrouille et tire le loquet : la porte peut être poussée pendant quelques secondes." },
  { id: "verrouiller", bouton: "Verrouiller", confirme: "Confirmer le verrouillage", classe: "verrouiller", aide: "Referme la serrure à clé." },
  { id: "deverrouiller", bouton: "Déverrouiller seulement", confirme: "Confirmer le déverrouillage", classe: "deverrouiller", aide: "Tourne la clé sans tirer le loquet." },
];
const DELAI_CONFIRMATION_MS = 12000;

function quand(iso, avecDate) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { timeZone: TZ, ...(avecDate ? { day: "2-digit", month: "2-digit" } : {}), hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Connexion({ nom, onConnecte }) {
  const [motDePasse, setMotDePasse] = useState("");
  const [err, setErr] = useState("");
  const [occupe, setOccupe] = useState(false);

  async function envoyer() {
    if (occupe || !motDePasse) return;
    setOccupe(true); setErr("");
    try {
      const r = await fetch("/api/connexion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motDePasse }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) { setMotDePasse(""); onConnecte(d.expiresAt); }
      else { setErr(d.error || `Erreur ${r.status}`); setMotDePasse(""); }
    } catch { setErr("Erreur réseau."); }
    finally { setOccupe(false); }
  }

  return (
    <div className="porte porte-connexion">
      <div className="porte-boite">
        <div className="porte-titre">{nom}</div>
        <div className="porte-sous">Accès à distance réservé à la télésurveillance. Chaque action est enregistrée.</div>
        <label className="porte-champ">
          <span>Mot de passe</span>
          <input type="password" autoFocus autoComplete="current-password" value={motDePasse} onChange={e => { setMotDePasse(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && envoyer()} className={err ? "err" : ""} />
        </label>
        {err && <div className="porte-alerte bad" role="alert">{err}</div>}
        <button type="button" className="porte-btn verrouiller" disabled={occupe || !motDePasse} onClick={envoyer}>{occupe ? "…" : "Entrer"}</button>
      </div>
    </div>
  );
}

function Portail({ nom, contact, onDeconnecte }) {
  const [etat, setEtat] = useState(null);
  const [erreurEtat, setErreurEtat] = useState("");
  const [chargement, setChargement] = useState(true);
  const [enAttente, setEnAttente] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [resultat, setResultat] = useState(null);
  const minuteur = useRef(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch("/api/etat", { cache: "no-store" });
      if (r.status === 401) { onDeconnecte(true); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || `Erreur ${r.status}`);
      setEtat(d); setErreurEtat("");
    } catch (e) {
      setErreurEtat(e.message || "Erreur réseau");
    } finally {
      setChargement(false);
    }
  }, [onDeconnecte]);

  useEffect(() => { charger(); }, [charger]);

  // Rafraîchit l'état toutes les 30 s tant que la page est visible.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") charger(); }, 30000);
    const onVisible = () => { if (document.visibilityState === "visible") charger(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [charger]);

  function demander(id) {
    setResultat(null); setEnAttente(id);
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setEnAttente(null), DELAI_CONFIRMATION_MS);
  }

  function annuler() { clearTimeout(minuteur.current); setEnAttente(null); }

  async function confirmer(id) {
    if (occupe) return;
    clearTimeout(minuteur.current);
    setOccupe(true); setResultat(null);
    try {
      const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: id }) });
      if (r.status === 401) { onDeconnecte(true); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) setResultat({ ok: false, texte: d.error || `Erreur ${r.status}` });
      else {
        setResultat({ ok: true, texte: `${d.libelle} transmise à la serrure à ${quand(d.a)}. La serrure réagit en quelques secondes : vérifiez l'état ci-dessous.` });
        setTimeout(charger, 4000);
        setTimeout(charger, 12000);
      }
    } catch { setResultat({ ok: false, texte: "Erreur réseau : l'action n'a pas pu être envoyée." }); }
    finally { setOccupe(false); setEnAttente(null); }
  }

  async function deconnecter() {
    try { await fetch("/api/deconnexion", { method: "POST" }); } catch { /* le cookie expire de lui-même */ }
    onDeconnecte(false);
  }

  const porte = etat && etat.porte;

  return (
    <div className="porte">
      <header className="porte-tete">
        <div>
          <div className="porte-titre">{nom}</div>
          <div className="porte-sous">Accès à distance réservé à la télésurveillance. Chaque action est enregistrée.</div>
        </div>
        <button type="button" className="porte-lien" onClick={deconnecter}>Se déconnecter</button>
      </header>

      <section className="porte-carte">
        {chargement && <div className="porte-muted">Lecture de l'état de la serrure…</div>}
        {!chargement && erreurEtat && <div className="porte-alerte bad">État indisponible : {erreurEtat} <button type="button" className="porte-lien" onClick={charger}>Réessayer</button></div>}
        {porte && (
          <div className="porte-etat">
            <div className={"porte-pastille " + (porte.enLigne ? "ok" : "bad")} aria-hidden="true" />
            <div>
              <div className="porte-etat-principal">Serrure {porte.etat}</div>
              <div className="porte-muted">
                {porte.enLigne ? "En ligne" : `Hors ligne (${porte.etatServeur})`}
                {porte.batterie !== null && porte.batterie !== undefined ? ` · pile ${porte.batterie} %` : ""}
                {porte.batterieFaible ? " · pile faible" : ""}
                {" · lu à "}{quand(etat.lueLe)}
              </div>
            </div>
            <button type="button" className="porte-lien" onClick={charger}>Actualiser</button>
          </div>
        )}
      </section>

      <section className="porte-carte">
        <div className="porte-actions">
          {ACTIONS.map(a => (
            <div key={a.id} className="porte-action">
              {enAttente === a.id ? (
                <div className="porte-confirmation">
                  <button type="button" className={"porte-btn confirme " + a.classe} disabled={occupe} onClick={() => confirmer(a.id)}>{occupe ? "Envoi…" : a.confirme}</button>
                  <button type="button" className="porte-btn annuler" disabled={occupe} onClick={annuler}>Annuler</button>
                </div>
              ) : (
                <button type="button" className={"porte-btn " + a.classe} disabled={occupe || !porte || !porte.enLigne} onClick={() => demander(a.id)}>{a.bouton}</button>
              )}
              <div className="porte-aide">{a.aide}</div>
            </div>
          ))}
        </div>
        {resultat && <div className={"porte-alerte " + (resultat.ok ? "ok" : "bad")} role="status">{resultat.texte}</div>}
      </section>

      <section className="porte-carte">
        <div className="porte-section-titre">Derniers événements de cette porte (7 jours)</div>
        {etat && etat.evenements === null && <div className="porte-muted">Historique indisponible pour le moment.</div>}
        {etat && Array.isArray(etat.evenements) && etat.evenements.length === 0 && <div className="porte-muted">Aucun événement sur 7 jours.</div>}
        {etat && Array.isArray(etat.evenements) && etat.evenements.length > 0 && (
          <ul className="porte-journal">
            {etat.evenements.map((e, i) => (
              <li key={i} className={e.reussi ? "" : "echec"}>
                <span className="porte-journal-date">{quand(e.date, true)}</span>
                <span className="porte-journal-action">{e.action}</span>
                <span className="porte-muted">{[e.qui, e.declencheur].filter(Boolean).join(" · ")}{e.reussi ? "" : ` · ${e.resultat}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {contact && <footer className="porte-pied">En cas d'anomalie : {contact}</footer>}
    </div>
  );
}

export default function Page({ nom, contact, configure, manques: manquants, connecte, expiresAt }) {
  const [session, setSession] = useState(connecte ? expiresAt : 0);
  const [expiree, setExpiree] = useState(false);

  // La session se referme d'elle-même à l'heure d'expiration, même page ouverte.
  useEffect(() => {
    if (!session) return undefined;
    const ms = session * 1000 - Date.now();
    const t = setTimeout(() => { setSession(0); setExpiree(true); }, Math.max(0, ms));
    return () => clearTimeout(t);
  }, [session]);

  const onDeconnecte = useCallback((parExpiration) => { setSession(0); setExpiree(Boolean(parExpiration)); }, []);

  if (!configure) {
    return (
      <div className="porte">
        <Head><title>{nom}</title></Head>
        <div className="porte-carte"><div className="porte-alerte bad">Portail non configuré : variables manquantes {manquants.join(", ")}.</div></div>
      </div>
    );
  }
  return (
    <>
      <Head><title>{nom}</title></Head>
      {session
        ? <Portail nom={nom} contact={contact} onDeconnecte={onDeconnecte} />
        : <Connexion nom={nom} onConnecte={exp => { setSession(exp); setExpiree(false); }} />}
      {!session && expiree && <div className="porte porte-muted porte-centre">Session terminée (12 h) : saisissez de nouveau le mot de passe.</div>}
    </>
  );
}
