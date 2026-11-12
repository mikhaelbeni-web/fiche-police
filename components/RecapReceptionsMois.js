// components/RecapReceptionsMois.js
// Commande linge > Réceptions : relevé de toutes les réceptions d'un mois choisi,
// à envoyer à Elis pour justifier le linge manquant (« les trous »).
// Même principe que le bon de ramassage : Gmail de l'hôtel pré-rempli +
// téléchargement de l'Excel à glisser dans le mail (un lien web ne peut pas
// joindre de fichier). Destinataires : linen_settings/belleville.bonDestinataires
// (le dépôt est public, aucune adresse dans le code).

import { useState, useEffect } from "react";
import { LINEN_ARTICLES, PANTIN_CODES, PANTIN_CLIENT, monthReceptionReport, moisLabel } from "../lib/linen";

const HOTEL_GMAIL = "residencelebelleville@gmail.com";
const court = label => label.split(" (")[0];
function fr(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function moisPrecedent() {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
}
const nomElis = key => PANTIN_CODES[key]?.libelle || key;

export function corpsMail(report) {
  const lignesLivraisons = report.rows.map(row => {
    const q = LINEN_ARTICLES.filter(a => row.recu[a.key] > 0).map(a => `${row.recu[a.key]} ${nomElis(a.key)}`).join(", ");
    const origine = row.libre ? "complément sans commande" : `commande du ${fr(row.orderDate)}`;
    const manque = row.ecart ? LINEN_ARTICLES.filter(a => row.ecart[a.key] < 0).map(a => `${-row.ecart[a.key]} ${nomElis(a.key)}`) : [];
    return `- ${fr(row.date)} (${origine}) : ${q || "rien"}` + (manque.length ? `\n   manquant : ${manque.join(", ")}` : "");
  });
  const manquants = LINEN_ARTICLES.filter(a => report.difference[a.key] < 0)
    .map(a => `- ${nomElis(a.key)} : ${-report.difference[a.key]}`);
  return [
    "Bonjour,",
    "",
    `Comme demandé, voici le relevé de toutes les livraisons de linge reçues à la ${PANTIN_CLIENT.residence} (client ${PANTIN_CLIENT.nClient}) en ${moisLabel(report.month)}. Le détail article par article est dans le fichier Excel joint.`,
    "",
    `Livraisons reçues (${report.rows.length}) :`,
    ...lignesLivraisons,
    "",
    ...(manquants.length
      ? ["Linge attendu et non reçu sur le mois (compléments déjà déduits) :", ...manquants]
      : ["Sur le mois, tout le linge attendu a été reçu (compléments compris)."]),
    "",
    "Bien cordialement,",
    "Résidence Le Belleville",
  ].join("\n");
}

export default function RecapReceptionsMois({ fs, orders, receptions, setStatus }) {
  const [month, setMonth] = useState(moisPrecedent());
  const [destinataires, setDestinataires] = useState([]);
  useEffect(() => {
    if (!fs) return;
    fs.getDoc(fs.doc(fs.db, "linen_settings", "belleville"))
      .then(snap => { if (snap.exists()) setDestinataires(snap.data().bonDestinataires || []); })
      .catch(() => {});
  }, [fs]);

  const report = monthReceptionReport(receptions, orders, month);
  const vide = report.rows.length === 0;

  async function telecharger() {
    try {
      const res = await fetch("/api/receptions-mois", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert("Erreur : " + (e.error || res.status)); return null; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Receptions_linge_${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      return a.download;
    } catch (err) { alert("Erreur : " + err.message); return null; }
  }

  async function preparerMail() {
    let to = destinataires;
    if (!to.length) {
      const v = prompt("Adresses e-mail Elis (séparées par des virgules) :", "");
      if (v === null) return;
      to = v.split(/[,;\s]+/).map(x => x.trim()).filter(x => x.includes("@"));
      if (!to.length) return;
      setDestinataires(to);
      fs.setDoc(fs.doc(fs.db, "linen_settings", "belleville"), { bonDestinataires: to }, { merge: true })
        .catch(err => setStatus("Erreur enregistrement destinataires : " + err.message));
    }
    // Gmail ouvert d'abord (dans le clic, sinon le navigateur bloque la fenêtre).
    const url = "https://mail.google.com/mail/?" + new URLSearchParams({
      authuser: HOTEL_GMAIL, view: "cm", fs: "1",
      to: to.join(","), su: `Réceptions de linge ${moisLabel(month)} – ${PANTIN_CLIENT.residence} (client ${PANTIN_CLIENT.nClient})`,
      body: corpsMail(report),
    }).toString();
    window.open(url, "_blank");
    const fichier = await telecharger();
    if (fichier) setStatus(`Excel téléchargé (${fichier}) : glisse-le dans le mail Gmail ouvert, relis puis envoie.`);
  }

  const manquants = LINEN_ARTICLES.filter(a => report.difference[a.key] < 0);

  return (
    <div className="linen-form" style={{ marginTop: 18 }}>
      <div className="recap-title" style={{ fontSize: 16 }}>Relevé du mois pour Elis</div>
      <p className="note" style={{ marginTop: 4 }}>
        Toutes les réceptions du mois choisi, avec l&apos;attendu, le reçu et l&apos;écart de chaque livraison, pour justifier le linge manquant.
      </p>
      <div className="linen-form-row">
        <label>Mois <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <button onClick={telecharger} disabled={vide}>📥 Excel du mois</button>
        <button className="primary" onClick={preparerMail} disabled={vide}>✉️ Préparer le mail à Elis</button>
      </div>
      {vide ? (
        <div className="msg warn">Aucune réception enregistrée en {moisLabel(month)}.</div>
      ) : (
        <>
          <div className="tbl-wrap"><table className="tbl cl-cards cl-saisie" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Article</th>
                <th className="c">Attendu</th>
                <th className="c">Reçu</th>
                <th className="c">dont complément</th>
                <th className="c">Différence</th>
              </tr>
            </thead>
            <tbody>
              {LINEN_ARTICLES.map(a => {
                const diff = report.difference[a.key];
                return (
                  <tr key={a.key}>
                    <td className="apt cl-head">{court(a.label)}</td>
                    <td className="c" data-label="Attendu">{report.totalAttendu[a.key]}</td>
                    <td className="c" data-label="Reçu">{report.totalRecu[a.key]}</td>
                    <td className="c" data-label="dont complément">{report.totalRecuLibre[a.key] || "—"}</td>
                    <td className="c" data-label="Différence" style={{ fontWeight: 700, color: diff < 0 ? "var(--bad)" : (diff > 0 ? "var(--warn)" : "var(--ok)") }}>
                      {diff === 0 ? "✓" : (diff > 0 ? `+${diff}` : diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <p className="note">
            {report.rows.length} livraison(s) en {moisLabel(month)}.
            {manquants.length ? " Différence négative = linge attendu jamais reçu (les compléments livrés sans commande sont déjà déduits)." : " Tout le linge attendu a été reçu."}
            {report.sansReception.length > 0 && ` ${report.sansReception.length} commande(s) prévue(s) ce mois-ci sans réception enregistrée (listée(s) dans l'Excel).`}
            {" "}Destinataires : {destinataires.length ? destinataires.join(", ") : "aucun (demandés au premier envoi)"}.
          </p>
        </>
      )}
    </div>
  );
}
