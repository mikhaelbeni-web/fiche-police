// components/BordereauxLinge.js
// Commande linge > Bordereaux : les bordereaux d'expédition Elis (un par
// livraison) importés en PDF, plusieurs à la fois, puis comparés à la facture
// du mois. La facture doit être exactement la somme des bordereaux ; sinon,
// mail à Elis avec chaque bordereau (date de livraison + date et heure de
// saisie) et les quantités en écart.
// Indépendant du coût du linge. Firestore : `linen_bordereaux`
// (factures : `linen_invoices`, importées dans Coût linge).

import { useState, useEffect, useRef } from "react";
import { ELIS_INVOICE_ARTICLES, moisLabel } from "../lib/linen";
import { lireLignesPdf } from "../lib/factureLinge";
import { analyserBordereauElis, comparerFactureBordereaux, controleReception, mailEcartBordereaux } from "../lib/bordereauLinge";

// Un bordereau = date de livraison + date et heure de saisie (Elis n'a pas de numéro fiable).
const cleBordereau = b => `${b.dateLivraison || ""}|${(b.saisieLe || "").slice(0, 16)}`;
const frHeure = iso => (iso ? `${iso.slice(0, 10).split("-").reverse().join("/")} à ${iso.slice(11, 16).replace(":", "h")}` : "—");

const HOTEL_GMAIL = "residencelebelleville@gmail.com";
const fr = iso => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const eur = n => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const court = label => label.split(" (")[0];
// Articles affichés en colonnes : les 7 habituels + Horizon seulement s'ils servent.
function colonnes(bordereaux) {
  return ELIS_INVOICE_ARTICLES.filter(a => !/horizon/.test(a.id) || bordereaux.some(b => Number(b.lines?.[a.id]?.livree) > 0));
}
function moisPrecedent() {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
}

export default function BordereauxLinge({ fs, invoices, receptions, setStatus }) {
  const [bordereaux, setBordereaux] = useState([]);
  const [month, setMonth] = useState(moisPrecedent());
  const [aVerifier, setAVerifier] = useState([]); // bordereaux lus, pas encore enregistrés
  const [lecture, setLecture] = useState("");
  const [destinataires, setDestinataires] = useState([]);
  const fichierRef = useRef(null);

  async function charger() {
    const snap = await fs.getDocs(fs.collection(fs.db, "linen_bordereaux"));
    setBordereaux(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }
  useEffect(() => {
    if (!fs) return;
    charger().catch(err => setStatus("Erreur chargement bordereaux : " + err.message));
    fs.getDoc(fs.doc(fs.db, "linen_settings", "belleville"))
      .then(snap => { if (snap.exists()) setDestinataires(snap.data().bonDestinataires || []); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs]);

  const existe = b => bordereaux.some(x => cleBordereau(x) === cleBordereau(b));

  async function importer(e) {
    const fichiers = Array.from(e.target.files || []);
    e.target.value = "";
    if (!fichiers.length) return;
    const lus = [];
    for (let i = 0; i < fichiers.length; i++) {
      const f = fichiers[i];
      setLecture(`Lecture des bordereaux… ${i + 1}/${fichiers.length}`);
      try {
        const r = analyserBordereauElis(await lireLignesPdf(f));
        lus.push({ cle: `${f.name}-${i}`, fichierNom: f.name, ...r });
      } catch (err) {
        lus.push({ cle: `${f.name}-${i}`, fichierNom: f.name, saisieLe: "", dateLivraison: "", lines: {}, avertissements: [`Impossible de lire ce PDF (${err.message}).`], illisible: true });
      }
    }
    setLecture("");
    setAVerifier(lus);
    const mois = lus.map(b => (b.dateLivraison || "").slice(0, 7)).filter(Boolean);
    if (mois.length) setMonth(mois.sort()[0]);
  }

  function modifier(cle, champ, valeur) {
    setAVerifier(v => v.map(b => (b.cle === cle ? { ...b, [champ]: valeur } : b)));
  }
  function modifierQte(cle, id, valeur) {
    setAVerifier(v => v.map(b => (b.cle === cle ? { ...b, lines: { ...b.lines, [id]: { ...(b.lines[id] || {}), livree: valeur } } } : b)));
  }

  // Doublons : même livraison + même saisie déjà enregistrée, ou deux fois dans le lot.
  const clesLot = aVerifier.map(cleBordereau);
  const probleme = b => {
    if (b.illisible) return "PDF illisible";
    if (!b.dateLivraison) return "Date de livraison manquante";
    if (!b.saisieLe) return "Date de saisie manquante";
    if (existe(b)) return "Déjà importé";
    if (clesLot.filter(x => x === cleBordereau(b)).length > 1) return "En double dans la sélection";
    return null;
  };
  const valides = aVerifier.filter(b => !probleme(b));

  async function enregistrer() {
    try {
      setStatus(`Enregistrement de ${valides.length} bordereau(x)…`);
      for (const b of valides) {
        const lines = {};
        for (const a of ELIS_INVOICE_ARTICLES) {
          const l = b.lines?.[a.id] || {};
          lines[a.id] = { aLivrer: Number(l.aLivrer) || 0, livree: Number(l.livree) || 0 };
        }
        await fs.addDoc(fs.collection(fs.db, "linen_bordereaux"), {
          dateLivraison: b.dateLivraison, saisieLe: b.saisieLe.slice(0, 16), lines,
          fichierNom: b.fichierNom || null, createdAt: new Date().toISOString(),
        });
      }
      const ignores = aVerifier.length - valides.length;
      setAVerifier([]);
      await charger();
      setStatus(`${valides.length} bordereau(x) enregistré(s).${ignores ? ` ${ignores} ignoré(s) (doublon ou incomplet).` : ""}`);
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function supprimer(b) {
    if (!confirm(`Supprimer le bordereau de la livraison du ${fr(b.dateLivraison)} (saisi le ${frHeure(b.saisieLe)}) ?`)) return;
    await fs.deleteDoc(fs.doc(fs.db, "linen_bordereaux", b.id));
    await charger();
  }

  // Facture du mois choisi (importée dans Coût linge) et comparaison.
  const debut = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const inv = (invoices || []).find(i => (i.periodFrom || "").slice(0, 7) === month);
  const periodeInv = inv || { periodFrom: debut, periodTo: fin };
  const c = comparerFactureBordereaux(periodeInv, bordereaux);
  const duMois = c.bordereaux;
  const cols = colonnes(duMois);
  const mail = inv ? mailEcartBordereaux(inv, c) : null;

  async function preparerMail() {
    if (!mail) return;
    let to = destinataires;
    if (!to.length) {
      const v = prompt("Adresses e-mail Elis (séparées par des virgules) :", "");
      if (v === null) return;
      to = v.split(/[,;\s]+/).map(x => x.trim()).filter(x => x.includes("@"));
      if (!to.length) return;
      setDestinataires(to);
      fs.setDoc(fs.doc(fs.db, "linen_settings", "belleville"), { bonDestinataires: to }, { merge: true }).catch(() => {});
    }
    window.open("https://mail.google.com/mail/?" + new URLSearchParams({
      authuser: HOTEL_GMAIL, view: "cm", fs: "1", to: to.join(","), su: mail.subject, body: mail.body,
    }).toString(), "_blank");
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Bordereaux d&apos;expédition Elis</div>
          <div className="recap-sub">Un bordereau par livraison. La facture du mois doit être exactement la somme des bordereaux.</div>
        </div>
      </div>

      <div className="linen-form">
        <div className="linen-form-row">
          <button className="primary" onClick={() => fichierRef.current?.click()}>📄 Importer des bordereaux (PDF)</button>
          <input ref={fichierRef} type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }} onChange={importer} />
          <span className="note" style={{ margin: 0 }}>Sélectionne tous les bordereaux du mois d&apos;un coup (Ctrl ou Maj + clic).</span>
        </div>
        {lecture && <div className="msg warn">{lecture}</div>}

        {aVerifier.length > 0 && (
          <>
            <p className="note">Vérifie avant d&apos;enregistrer : date de livraison, date et heure de saisie (bas du bordereau) et quantités de la colonne « Quantité livrée ».</p>
            <div className="tbl-wrap"><table className="tbl" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Livraison du</th><th>Saisi le</th>
                  {ELIS_INVOICE_ARTICLES.filter(a => !/horizon/.test(a.id) || aVerifier.some(b => Number(b.lines?.[a.id]?.livree) > 0)).map(a => <th key={a.id} className="c">{a.label}</th>)}
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {aVerifier.map(b => {
                  const pb = probleme(b);
                  return (
                    <tr key={b.cle}>
                      <td><input type="date" value={b.dateLivraison} onChange={e => modifier(b.cle, "dateLivraison", e.target.value)} /></td>
                      <td><input type="datetime-local" value={b.saisieLe} onChange={e => modifier(b.cle, "saisieLe", e.target.value)} /></td>
                      {ELIS_INVOICE_ARTICLES.filter(a => !/horizon/.test(a.id) || aVerifier.some(x => Number(x.lines?.[a.id]?.livree) > 0)).map(a => (
                        <td key={a.id} className="c">
                          <input type="number" min="0" inputMode="numeric" value={b.lines?.[a.id]?.livree ?? 0} onChange={e => modifierQte(b.cle, a.id, e.target.value)} style={{ width: 64 }} />
                        </td>
                      ))}
                      <td style={{ fontSize: 12 }}>
                        {pb ? <span className="pill warn">{pb}</span> : <span className="pill ok">OK</span>}
                        {b.avertissements?.map((w, i) => <div key={i} style={{ color: "var(--warn)" }}>{w}</div>)}
                        <div style={{ color: "var(--muted, #888)" }}>{b.fichierNom}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <div className="linen-form-row">
              <button className="primary" onClick={enregistrer} disabled={!valides.length}>Enregistrer {valides.length} bordereau(x)</button>
              <button className="ghost" onClick={() => setAVerifier([])}>Annuler</button>
            </div>
          </>
        )}
      </div>

      <div className="linen-form" style={{ marginTop: 18 }}>
        <div className="linen-form-row">
          <label>Mois <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
          <span className="pill info">{duMois.length} bordereau(x) en {moisLabel(month)}</span>
          {inv ? <span className="pill info">Facture n° {inv.numFacture}</span> : <span className="pill warn">Pas de facture importée pour ce mois (Coût linge)</span>}
        </div>

        {duMois.length > 0 && (
          <div className="tbl-wrap"><table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Livraison</th><th>Saisi le</th>
                {cols.map(a => <th key={a.id} className="c">{a.label}</th>)}
                <th>Réception saisie</th><th></th>
              </tr>
            </thead>
            <tbody>
              {duMois.map(b => {
                const ctl = controleReception(b, receptions);
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{fr(b.dateLivraison)}</td>
                    <td>{frHeure(b.saisieLe)}</td>
                    {cols.map(a => <td key={a.id} className="c">{Number(b.lines?.[a.id]?.livree) || 0}</td>)}
                    <td style={{ fontSize: 12 }}>
                      {ctl.statut === "identique" && <span className="pill ok">✓ identique</span>}
                      {ctl.statut === "aucune" && <span className="pill warn">aucune ce jour-là</span>}
                      {ctl.statut === "different" && (
                        <span className="pill warn" title={ctl.ecarts.map(e => `${court(e.label)} : bordereau ${e.bordereau}, saisi ${e.recu}`).join("\n")}>
                          différente : {ctl.ecarts.map(e => `${court(e.label)} ${e.bordereau}/${e.recu}`).join(", ")}
                        </span>
                      )}
                    </td>
                    <td><button onClick={() => supprimer(b)} className="ghost icon-btn danger" title="Supprimer" aria-label="Supprimer">✕</button></td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={2}>Total bordereaux</td>
                {cols.map(a => <td key={a.id} className="c">{duMois.reduce((s, b) => s + (Number(b.lines?.[a.id]?.livree) || 0), 0)}</td>)}
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table></div>
        )}

        {inv && (
          <>
            <div className="recap-title" style={{ fontSize: 16, marginTop: 16 }}>Facture n° {inv.numFacture} comparée aux bordereaux</div>
            <div className="tbl-wrap"><table className="tbl cl-cards cl-saisie" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Article</th><th className="c">Facturé</th><th className="c">Bordereaux</th><th className="c">Écart</th><th className="c">Montant HT</th></tr>
              </thead>
              <tbody>
                {c.lignes.map(l => (
                  <tr key={l.id}>
                    <td className="apt cl-head">{l.label}</td>
                    <td className="c" data-label="Facturé">{l.facture}</td>
                    <td className="c" data-label="Bordereaux">{l.livre}</td>
                    <td className="c" data-label="Écart" style={{ fontWeight: 700, color: l.ecart > 0 ? "var(--bad)" : (l.ecart < 0 ? "var(--warn)" : "var(--ok)") }}>
                      {l.ecart === 0 ? "✓" : (l.ecart > 0 ? `+${l.ecart} facturé(s) en trop` : `${l.ecart} non facturé(s)`)}
                    </td>
                    <td className="c" data-label="Montant HT">{l.ecart ? eur(l.ecartEuros) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {c.conforme ? (
              <div className="msg ok">La facture correspond exactement aux {duMois.length} bordereau(x) du mois.</div>
            ) : (
              <>
                <div className="msg bad">
                  La facture ne correspond pas aux bordereaux.
                  {c.enTrop > 0.005 && ` Facturé en trop : ${eur(c.enTrop)} HT.`}
                  {c.enMoins > 0.005 && ` Livré non facturé : ${eur(c.enMoins)} HT.`}
                  {" "}Vérifie d&apos;abord que tous les bordereaux du mois sont importés.
                </div>
                <div className="linen-form-row">
                  <button className="primary" onClick={preparerMail}>✉️ Préparer le mail à Elis</button>
                  <span className="note" style={{ margin: 0 }}>Destinataires : {destinataires.length ? destinataires.join(", ") : "demandés au premier envoi"}</span>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
