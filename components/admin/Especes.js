// components/admin/Especes.js
// Espace admin > Espèces : réceptionnistes (codes personnels) et journal d'audit.
// - Créer une personne donne un code d'activation à 6 chiffres, affiché une seule fois,
//   valable 7 jours ; la personne choisit ensuite elle-même son code personnel dans
//   Taxes > Gestion des espèces > Première utilisation. L'admin ne le connaît jamais.
// - Le journal est relu en entier et contrôlé (chaîne d'empreintes, cohérence avec la base).
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";

const LIBELLES = {
  ouverture_journal: "Ouverture du journal",
  creation: "Saisie",
  suppression: "Suppression",
  recuperation: "Récupération",
  rattachement: "Ligne rattachée à une récupération",
  annulation_recuperation: "Récupération annulée",
  detachement: "Ligne libérée (récupération annulée)",
  solde_depart: "Solde de départ",
  personnel_creation: "Personne créée",
  personnel_reinitialisation: "Code réinitialisé",
  personnel_desactiver: "Personne désactivée",
  personnel_reactiver: "Personne réactivée",
  personnel_activation: "Code personnel choisi",
  echec_code: "Code personnel incorrect",
  echec_activation: "Code d'activation incorrect",
};

function dt(iso) {
  return iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "—";
}

function resume(ev) {
  try {
    const a = ev.apres ? JSON.parse(ev.apres) : null;
    if (!a) return "";
    if (ev.action === "ouverture_journal") return `${a.nbEntrees} lignes et ${a.nbRecups} récupérations existantes scellées`;
    if (a.amount != null) return `${a.type === "client" ? "Paiement client" : "Dépense"} ${a.date} · ${a.client || a.fournisseur || ""} · ${a.designation || ""} · ${a.amount} €`;
    if (a.amountRecovered != null) return `Récupéré ${a.amountRecovered} € · laissé ${a.amountLeftInBox} €`;
    if (a.nom) return a.nom;
  } catch { /* contenu non JSON */ }
  return "";
}

function csv(rows) {
  const t = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + t], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = `journal_especes_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function Especes() {
  const router = useRouter();
  const [personnel, setPersonnel] = useState([]);
  const [nom, setNom] = useState("");
  const [code, setCode] = useState(null);
  const [journal, setJournal] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("load");

  async function charger() {
    try { setPersonnel((await adminCall(router, "/api/admin/especes?vue=personnel")).personnel); }
    catch (e) { setErr(e); }
  }
  useEffect(() => { charger().finally(() => setBusy("")); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function action(body, label) {
    setBusy(label); setErr(null); setCode(null);
    try {
      const out = await adminCall(router, "/api/admin/especes", { method: "POST", body: JSON.stringify(body) });
      if (out.codeActivation) setCode({ nom: out.personne.nom, code: out.codeActivation });
      setNom("");
      await charger();
    } catch (e) { setErr(e); }
    finally { setBusy(""); }
  }

  async function verifier() {
    setBusy("journal"); setErr(null);
    try { setJournal(await adminCall(router, "/api/admin/especes?vue=journal")); }
    catch (e) { setErr(e); }
    finally { setBusy(""); }
  }

  function exporter() {
    const rows = [["N°", "Horodatage serveur (UTC)", "Action", "Cible", "Auteur", "Rôle", "Adresse IP", "Navigateur", "Motif", "Avant", "Après", "Empreinte précédente", "Empreinte"]];
    for (const e of journal.evenements) {
      rows.push([e.seq, e.at, LIBELLES[e.action] || e.action, e.cible, e.acteur, e.role, e.ip, e.navigateur, e.motif, e.avant || "", e.apres || "", e.prevHash, e.hash]);
    }
    rows.push([]);
    rows.push(["Contrôle du", journal.lueLe, journal.ok ? "AUCUNE ANOMALIE" : `${journal.anomalies.length} ANOMALIE(S)`]);
    for (const a of journal.anomalies) rows.push(["Anomalie", a.type, a.cible || "", a.detail]);
    csv(rows);
  }

  if (busy === "load") return <div className="admin-note">Lecture…</div>;

  return (
    <div className="admin-block">
      <div className="recap-title">Réceptionnistes</div>
      <p className="admin-note">
        Chaque saisie d&apos;espèces demande le nom et le code personnel de la personne. Créer une personne
        donne un <b>code d&apos;activation</b> (6 chiffres, 7 jours) à lui remettre : elle choisit ensuite son propre code
        dans Taxes &gt; Gestion des espèces &gt; « Première utilisation ». Vous ne connaissez donc jamais son code.
      </p>
      <div className="tbl-wrap"><table className="tbl admin-tbl">
        <thead><tr><th>Nom</th><th>État</th><th></th></tr></thead>
        <tbody>
          {personnel.map(p => (
            <tr key={p.id}>
              <td>{p.nom}</td>
              <td>{!p.actif ? "Désactivée" : p.codeChoisi ? "Code choisi" : p.activationEnAttente ? "Activation en attente" : "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="ghost" disabled={!!busy} onClick={() => confirm(`Donner un nouveau code d'activation à ${p.nom} ? Son code actuel ne marchera plus.`) && action({ action: "reinitialiser", id: p.id }, "reset")}>Réinitialiser le code</button>
                {" "}
                <button className="ghost" disabled={!!busy} onClick={() => action({ action: p.actif ? "desactiver" : "reactiver", id: p.id }, "actif")}>{p.actif ? "Désactiver" : "Réactiver"}</button>
              </td>
            </tr>
          ))}
          {personnel.length === 0 && <tr><td colSpan={3} className="admin-note">Aucune personne. Ajoutez chaque réceptionniste (et vous-même si vous saisissez).</td></tr>}
        </tbody>
      </table></div>
      <div className="admin-actions">
        <input value={nom} maxLength={40} placeholder="Prénom" onChange={e => setNom(e.target.value)} />
        <button className="primary" disabled={!nom.trim() || !!busy} onClick={() => action({ action: "creer", nom }, "creer")}>Ajouter</button>
      </div>
      {code && (
        <div className="admin-ok">
          Code d&apos;activation de <b>{code.nom}</b> : <b style={{ fontSize: 20, letterSpacing: 2 }}>{code.code}</b>.
          Notez-le et remettez-le en main propre : il ne sera plus jamais affiché.
        </div>
      )}

      <div className="recap-title" style={{ marginTop: 24 }}>Journal d&apos;audit des espèces</div>
      <p className="admin-note">
        Chaque saisie, suppression, récupération et tentative de code est enregistrée par le serveur, avec l&apos;heure,
        l&apos;auteur, l&apos;adresse IP et l&apos;état avant/après. Chaque événement contient l&apos;empreinte du précédent :
        toute retouche ou suppression d&apos;un événement, et toute écriture faite en contournant l&apos;application, apparaît
        ci-dessous comme anomalie.
      </p>
      <div className="admin-actions">
        <button className="primary" onClick={verifier} disabled={!!busy}>{busy === "journal" ? "Contrôle…" : "Lire et contrôler le journal"}</button>
        {journal && <button onClick={exporter}>📥 Exporter le journal (CSV)</button>}
      </div>
      <Erreur e={err} />
      {journal && (
        <>
          {!journal.ouvert ? (
            <div className="admin-note">Journal pas encore ouvert : il démarre à la première écriture (saisie, création d&apos;une personne…).</div>
          ) : journal.ok ? (
            <div className="admin-ok">Aucune anomalie · {journal.nbEvenements} événement(s) · empreinte de tête <code>{journal.tete.hash.slice(0, 16)}…</code> (n° {journal.tete.seq}) · contrôlé le {dt(journal.lueLe)}</div>
          ) : (
            <div className="admin-err">
              <b>{journal.anomalies.length} anomalie(s)</b>
              <ul>{journal.anomalies.map((a, i) => <li key={i}><code>{a.type}</code> {a.cible ? <code>{a.cible}</code> : null} {a.detail}</li>)}</ul>
            </div>
          )}
          <div className="tbl-wrap"><table className="tbl admin-tbl">
            <thead><tr><th>N°</th><th>Heure (Paris)</th><th>Action</th><th>Auteur</th><th>Détail</th><th>Motif</th><th>IP</th></tr></thead>
            <tbody>
              {[...journal.evenements].reverse().map(e => (
                <tr key={e.seq}>
                  <td>{e.seq}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{dt(e.at)}</td>
                  <td>{LIBELLES[e.action] || e.action}</td>
                  <td>{e.acteur}</td>
                  <td>{resume(e)}</td>
                  <td>{e.motif || ""}</td>
                  <td><code>{e.ip}</code></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  );
}
