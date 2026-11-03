// components/FactureLinge.js
// Factures Elis (blanchisserie de Pantin) dans Commande linge > Coût linge :
// étape 2 = import du PDF (ou saisie manuelle), étape 3 = comparaison avec ce
// qui a été réellement reçu (onglet Réceptions) sur le mois facturé, article
// par article, montant à réclamer et mail de réclamation.
// Firestore : `linen_invoices`. Styles : classes .fm-* (FactureMenage) + .fl-*.

import { useState, useRef, useEffect } from "react";
import { ELIS_INVOICE_ARTICLES } from "../lib/linen";
import { lireLignesPdf, analyserFactureElis, comparerFactureReceptions, prixDifferents, mailReclamationLinge } from "../lib/factureLinge";

const HOTEL_GMAIL = "residencelebelleville@gmail.com";

function isoDay(d) { return d.toISOString().slice(0, 10); }
const fmtFr = d => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const eur = n => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
const prix3 = n => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + " €");
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function libellePeriode(from, to) {
  if (!from) return "";
  const [y, m, d] = from.split("-").map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  if (d === 1 && to === fin) return `${MOIS[m - 1]} ${y}`;
  return `${fmtFr(from)} → ${fmtFr(to)}`;
}

function lignesVides() {
  const l = {};
  for (const a of ELIS_INVOICE_ARTICLES) l[a.id] = { qte: 0, prixUnitaire: 0 };
  return l;
}

function moisPrecedent() {
  const d = new Date();
  const from = new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1));
  const to = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 0));
  return { from: isoDay(from), to: isoDay(to) };
}

function totaux(lines, autres, participationPerte) {
  const sousTotalHT = ELIS_INVOICE_ARTICLES.reduce((s, a) => s + (Number(lines[a.id]?.qte) || 0) * (Number(lines[a.id]?.prixUnitaire) || 0), 0)
    + (autres || []).reduce((s, a) => s + (Number(a.montant) || 0), 0);
  const totalHT = sousTotalHT + (Number(participationPerte) || 0);
  const tva = totalHT * 0.2;
  return { sousTotalHT, totalHT, tva, netAPayer: totalHT + tva };
}

export default function FactureLinge({ fs, invoices, receptions, prices, reload, setStatus }) {
  const p = moisPrecedent();
  const [form, setForm] = useState(null); // null = fermé
  const [lecture, setLecture] = useState(""); // message pendant / après lecture du PDF
  const [selId, setSelId] = useState(null); // facture enregistrée affichée à l'étape 3
  const [apercuPdf, setApercuPdf] = useState(null); // { url, titre } : fenêtre « Voir la facture »
  const fichierRef = useRef(null);
  // Destinataires Elis : les mêmes que pour le bon de ramassage (Firestore, le dépôt est public).
  const [destinataires, setDestinataires] = useState([]);
  useEffect(() => {
    if (!fs) return;
    fs.getDoc(fs.doc(fs.db, "linen_settings", "belleville"))
      .then(snap => { if (snap.exists()) setDestinataires(snap.data().bonDestinataires || []); })
      .catch(() => {});
  }, [fs]);

  function allerAuResultat() {
    setTimeout(() => document.getElementById("fl-resultat")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function ouvrirManuel() {
    setLecture("");
    setSelId(null);
    setForm({ source: "manuel", numFacture: "", dateFacture: isoDay(new Date()), periodFrom: p.from, periodTo: p.to, lines: lignesVides(), autres: [], participationPerte: 0, avertissements: [] });
  }

  async function importerPdf(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setForm(null);
    setSelId(null);
    setLecture("Lecture du PDF…");
    try {
      const lignes = await lireLignesPdf(f);
      const r = analyserFactureElis(lignes);
      setForm({ source: "pdf", fichierNom: f.name, fichier: f, fichierLocal: URL.createObjectURL(f), ...r });
      setLecture("");
      const deja = r.numFacture && invoices.find(i => (i.numFacture || "").trim() === r.numFacture);
      if (deja) alert(`Vous avez déjà importé cette facture (n° ${deja.numFacture}, ${libellePeriode(deja.periodFrom, deja.periodTo)}). Vous pouvez la consulter, mais elle ne sera pas enregistrée une deuxième fois.`);
    } catch (err) {
      setLecture(`Impossible de lire ce PDF (${err.message}). Utilisez la saisie à la main.`);
    }
  }

  function annulerForm() {
    if (!confirm("Abandonner cette facture ? Les chiffres saisis seront perdus.")) return;
    setForm(null);
  }

  function voirFacture(id) {
    if (form && !confirm("Abandonner la facture en cours de vérification ?")) return;
    setForm(null);
    setSelId(id);
    allerAuResultat();
  }

  // « Voir la facture » sur une facture enregistrée : affiche le PDF gardé, ou
  // (facture enregistrée avant cette fonction) propose de joindre son PDF.
  const joindreRef = useRef(null);
  const [joindreId, setJoindreId] = useState(null);
  function voirOuJoindrePdf(inv) {
    if (inv.fichierUrl) { setApercuPdf({ url: inv.fichierUrl, titre: `Facture ${inv.numFacture}` }); return; }
    if (!confirm(`Le PDF de la facture ${inv.numFacture} n'a pas été gardé (elle a été enregistrée avant). Voulez-vous le joindre maintenant ?`)) return;
    setJoindreId(inv.id);
    joindreRef.current?.click();
  }
  async function joindrePdf(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const inv = invoices.find(i => i.id === joindreId);
    setJoindreId(null);
    if (!f || !inv) return;
    setApercuPdf({ url: URL.createObjectURL(f), titre: `Facture ${inv.numFacture}` });
    try {
      setStatus("Envoi du PDF…");
      const url = await envoyerPdf(f);
      await fs.updateDoc(fs.doc(fs.db, "linen_invoices", inv.id), { fichierUrl: url, fichierNom: f.name });
      await reload();
      setStatus("PDF joint à la facture.");
    } catch (err) {
      setStatus("Le PDF s'affiche, mais n'a pas pu être gardé : " + err.message);
    }
  }

  function setChamp(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setLigne(id, k, v) { setForm(f => ({ ...f, lines: { ...f.lines, [id]: { ...f.lines[id], [k]: v } } })); }

  async function enregistrer() {
    if (!form.numFacture.trim()) { setStatus("Le numéro de facture est requis."); return; }
    // Sécurité anti-doublon : une facture Elis (même n°) ne peut être enregistrée qu'une fois.
    const deja = invoices.find(i => (i.numFacture || "").trim() === form.numFacture.trim());
    if (deja) {
      alert(`Vous avez déjà importé cette facture (n° ${deja.numFacture}, ${libellePeriode(deja.periodFrom, deja.periodTo)}). Elle n'est pas enregistrée une deuxième fois. Pour la remplacer, supprimez d'abord l'ancienne dans « Factures enregistrées ».`);
      return;
    }
    try {
      setStatus("Enregistrement…");
      const lines = {};
      for (const a of ELIS_INVOICE_ARTICLES) lines[a.id] = { qte: Number(form.lines[a.id].qte) || 0, prixUnitaire: Number(form.lines[a.id].prixUnitaire) || 0 };
      const t = totaux(lines, form.autres, form.participationPerte);
      const doc = {
        numFacture: form.numFacture.trim(), dateFacture: form.dateFacture, periodFrom: form.periodFrom, periodTo: form.periodTo,
        lines, sousTotalHT: t.sousTotalHT, participationPerte: Number(form.participationPerte) || 0,
        totalHT: t.totalHT, tva: t.tva, netAPayer: form.netImprime ?? t.netAPayer,
        source: form.source, createdAt: new Date().toISOString(),
      };
      if (form.autres?.length) doc.autres = form.autres;
      if (form.fichierNom) doc.fichierNom = form.fichierNom;
      // Copie du PDF dans Firebase Storage pour pouvoir le revoir plus tard.
      // Si l'envoi échoue, la facture est quand même enregistrée (sans PDF).
      let pdfPerdu = false;
      if (form.fichier) {
        try { doc.fichierUrl = await envoyerPdf(form.fichier); } catch { pdfPerdu = true; }
      }
      const ref = await fs.addDoc(fs.collection(fs.db, "linen_invoices"), doc);
      setForm(null);
      await reload();
      if (ref?.id) setSelId(ref.id);
      setStatus(pdfPerdu ? "Facture enregistrée, mais le PDF n'a pas pu être gardé : « Voir la facture » ne sera pas disponible pour elle." : "Facture enregistrée.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function supprimer(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette facture ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "linen_invoices", id));
    if (selId === id) setSelId(null);
    await reload();
  }

  const doublonInv = form && form.numFacture ? invoices.find(i => (i.numFacture || "").trim() === form.numFacture.trim()) : null;
  const doublon = !!doublonInv;
  const t = form ? totaux(form.lines, form.autres, form.participationPerte) : null;
  const apercu = form ? comparerFactureReceptions(form, receptions) : null;
  const prixChanges = form ? prixDifferents(form.lines, prices) : [];
  const nbAvert = form ? (form.avertissements?.length || 0) + (doublon ? 1 : 0) + prixChanges.length : 0;
  const sel = !form && selId ? invoices.find(i => i.id === selId) : null;
  const selC = sel ? comparerFactureReceptions(sel, receptions) : null;
  const netDiffere = form && form.netImprime != null && Math.abs(form.netImprime - t.netAPayer) > 0.05;

  return (
    <>
      {/* ---------- 2. Importer la facture ---------- */}
      <div className="fm-step">
        <div className="fm-step-title"><span className="fm-num">2</span>Importer la facture Elis</div>
        <p className="fm-note">Choisissez le PDF reçu d&apos;Elis : les chiffres sont lus tout seuls. Sans PDF, saisissez la facture à la main.</p>
        <div className="fm-actions fl-actions">
          <input ref={fichierRef} type="file" accept="application/pdf,.pdf" onChange={importerPdf} className="fm-file" tabIndex={-1} aria-hidden="true" />
          <button type="button" className="fm-btn primary" onClick={() => fichierRef.current?.click()}>Choisir le PDF de la facture</button>
          {!form && <button type="button" className="fm-btn" onClick={ouvrirManuel}>Saisir à la main</button>}
          {form?.fichierLocal && <button type="button" className="fm-btn" onClick={() => setApercuPdf({ url: form.fichierLocal, titre: form.fichierNom })}>Voir la facture</button>}
        </div>

        {lecture && (
          <div className={`fm-status${lecture.startsWith("Impossible") ? " erreur" : ""}`} role="status">
            {!lecture.startsWith("Impossible") && <span className="fm-spin" aria-hidden="true" />}{lecture}
          </div>
        )}

        {form && (
          <div className="linen-form fl-form">
            <div className="fl-form-head">
              <div className="fl-form-title">Vérifiez les chiffres de la facture</div>
              <div className="fm-note">
                {form.source === "pdf" ? <>Lus dans <strong>{form.fichierNom}</strong>. Corrigez si besoin, le résultat se met à jour en dessous.</> : "Recopiez les quantités et prix de la facture. Le résultat se met à jour en dessous."}
              </div>
              {form.fichierLocal && (
                <button type="button" className="fm-btn fl-voir" onClick={() => setApercuPdf({ url: form.fichierLocal, titre: form.fichierNom })}>Voir la facture</button>
              )}
            </div>

            {nbAvert > 0 && (
              <div className="fm-warn fl-warn">
                <div className="fm-warn-title">À vérifier ({nbAvert})</div>
                <ul className="fl-warn-list">
                  {doublon && <li><strong>Vous avez déjà importé cette facture</strong> ({libellePeriode(doublonInv.periodFrom, doublonInv.periodTo)}). Elle ne peut pas être enregistrée deux fois : supprimez l&apos;ancienne pour la remplacer.</li>}
                  {form.avertissements?.map((a, i) => <li key={i}>{a}</li>)}
                  {prixChanges.map(c => <li key={c.label}>Prix changé : {c.label} facturé {prix3(c.facture)} au lieu de {prix3(c.attendu)} (prix enregistré).</li>)}
                </ul>
              </div>
            )}

            <div className="linen-form-row">
              <label>N° de facture <input type="text" value={form.numFacture} onChange={e => setChamp("numFacture", e.target.value)} placeholder="ex. 2600104-998618" /></label>
              <label>Date de la facture <input type="date" value={form.dateFacture} onChange={e => setChamp("dateFacture", e.target.value)} /></label>
            </div>
            <div className="linen-form-row">
              <label>Linge livré du <input type="date" value={form.periodFrom} onChange={e => setChamp("periodFrom", e.target.value)} /></label>
              <label>au <input type="date" value={form.periodTo} onChange={e => setChamp("periodTo", e.target.value)} /></label>
            </div>
            <div className="fm-note">
              La date de la facture sert seulement à la retrouver. Le comparatif utilise les dates du linge (le « Mois de … » de la facture) : ce sont les réceptions de ces jours-là qui sont comparées.
            </div>

            <div className="tbl-wrap"><table className="tbl fl-tbl">
              <thead>
                <tr><th>Article Elis</th><th className="c">Quantité facturée</th><th className="c">Prix unitaire HT</th><th className="r">Montant HT</th></tr>
              </thead>
              <tbody>
                {ELIS_INVOICE_ARTICLES.map(a => {
                  const l = form.lines[a.id];
                  const vide = form.source === "pdf" && !(Number(l.qte) > 0);
                  if (vide) return null; // gamme absente de la facture (ex. Horizon)
                  return (
                    <tr key={a.id}>
                      <td>{a.label}</td>
                      <td className="c"><input type="number" min="0" inputMode="numeric" className="fl-input fl-input-qte" value={l.qte} onChange={e => setLigne(a.id, "qte", e.target.value)} aria-label={`Quantité facturée ${a.label}`} /></td>
                      <td className="c"><input type="number" min="0" step="0.001" inputMode="decimal" className="fl-input fl-input-prix" value={l.prixUnitaire} onChange={e => setLigne(a.id, "prixUnitaire", e.target.value)} aria-label={`Prix unitaire ${a.label}`} /></td>
                      <td className="r">{eur((Number(l.qte) || 0) * (Number(l.prixUnitaire) || 0))}</td>
                    </tr>
                  );
                })}
                {form.autres?.map((a, i) => (
                  <tr key={"autre" + i} className="fl-autre">
                    <td>{a.label} <em>(pas comparé)</em></td><td className="c">{a.qte}</td><td className="c">{prix3(a.prixUnitaire)}</td><td className="r">{eur(a.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>

            <div className="linen-form-row fl-perte">
              <label>Participation pour perte (€ HT) <input type="number" min="0" step="0.01" inputMode="decimal" value={form.participationPerte} onChange={e => setChamp("participationPerte", e.target.value)} /></label>
            </div>

            <table className="tbl fm-calc fl-totaux">
              <tbody>
                <tr><td>Total des articles HT</td><td className="r">{eur(t.sousTotalHT)}</td></tr>
                <tr><td>Total HT (avec participation pour perte)</td><td className="r">{eur(t.totalHT)}</td></tr>
                <tr><td>TVA 20 %</td><td className="r">{eur(t.tva)}</td></tr>
                <tr className="net vert"><td>Net à payer</td><td className="r">{eur(t.netAPayer)}</td></tr>
              </tbody>
            </table>
            {netDiffere && <div className="fm-note fl-orange">Attention : la facture indique {eur(form.netImprime)}. C&apos;est ce montant qui sera enregistré.</div>}

            <div className="fm-actions">
              <button type="button" className="fm-btn primary" onClick={enregistrer} disabled={doublon}>{doublon ? "Déjà importée" : "Enregistrer la facture"}</button>
              <button type="button" className="fm-btn fm-btn-light" onClick={annulerForm}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {/* ---------- 3. Résultat et réclamation ---------- */}
      <div className="fm-step fm-resultat" id="fl-resultat">
        <div className="fm-step-title"><span className="fm-num">3</span>Résultat : facturé en trop ?</div>
        {form ? (
          <>
            <div className="fl-entete">
              <div className="fm-res-title">{form.numFacture ? `Facture ${form.numFacture}` : "Nouvelle facture"} · {libellePeriode(form.periodFrom, form.periodTo)}</div>
              <div className="fm-note">Aperçu : cette facture n&apos;est pas encore enregistrée.</div>
            </div>
            <Comparaison key="form" c={apercu} inv={{ ...form, sousTotalHT: t.sousTotalHT }} destinataires={destinataires} />
          </>
        ) : sel ? (
          <>
            <div className="fl-entete">
              <div className="fm-res-title">Facture {sel.numFacture} · {libellePeriode(sel.periodFrom, sel.periodTo)}</div>
              <div className="fm-note">Datée du {fmtFr(sel.dateFacture)} · net à payer {eur(sel.netAPayer)}</div>
              {sel.fichierUrl && (
                <button type="button" className="fm-btn fl-voir" onClick={() => setApercuPdf({ url: sel.fichierUrl, titre: `Facture ${sel.numFacture}` })}>Voir la facture</button>
              )}
            </div>
            <Comparaison key={sel.id} c={selC} inv={sel} destinataires={destinataires} />
          </>
        ) : (
          <div className="fm-hint">Importez une facture (étape 2) ou touchez « Voir le résultat » sur une facture enregistrée ci-dessous : le résultat s&apos;affiche ici.</div>
        )}
      </div>

      {/* ---------- Factures enregistrées ---------- */}
      <div className="fm-step">
        <div className="fm-step-title">Factures enregistrées <span className="fm-count">{invoices.length}</span></div>
        {invoices.length === 0 ? (
          <div className="fm-hint">Aucune facture enregistrée pour l&apos;instant.</div>
        ) : (
          <div className="fm-cards fl-cards">
            {invoices.map(inv => (
              <CarteFacture key={inv.id} inv={inv} receptions={receptions} actif={sel?.id === inv.id}
                onVoir={() => voirFacture(inv.id)} onDelete={() => supprimer(inv.id)}
                onPdf={() => voirOuJoindrePdf(inv)} />
            ))}
          </div>
        )}
      </div>
      <input ref={joindreRef} type="file" accept="application/pdf,.pdf" onChange={joindrePdf} className="fm-file" tabIndex={-1} aria-hidden="true" />
      {apercuPdf && <FenetrePdf url={apercuPdf.url} titre={apercuPdf.titre} onClose={() => setApercuPdf(null)} />}
    </>
  );
}

// Envoie le PDF dans Firebase Storage et renvoie son adresse de lecture.
async function envoyerPdf(file) {
  const { app } = await import("../lib/firebase");
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import("firebase/storage");
  const nom = file.name.replace(/[^\w.\-]+/g, "_");
  const r = ref(getStorage(app), `linge/factures/${Date.now()}_${nom}`);
  await uploadBytes(r, file, { contentType: "application/pdf" });
  return getDownloadURL(r);
}

// Petite fenêtre qui affiche la facture dans la page, sans la télécharger.
function FenetrePdf({ url, titre, onClose }) {
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fl-pdf-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={titre}>
      <div className="fl-pdf" onClick={e => e.stopPropagation()}>
        <div className="fl-pdf-head">
          <span className="fl-pdf-titre">{titre}</span>
          <a className="fm-btn fm-btn-light" href={url} target="_blank" rel="noreferrer">Ouvrir en grand</a>
          <button type="button" className="fm-btn" onClick={onClose}>Fermer</button>
        </div>
        <iframe className="fl-pdf-cadre" src={url} title={titre} />
      </div>
    </div>
  );
}

function CarteFacture({ inv, receptions, actif, onVoir, onDelete, onPdf }) {
  const c = comparerFactureReceptions(inv, receptions);
  const badge = c.nbReceptions === 0
    ? <span className="fm-badge vide">Pas de réception</span>
    : c.net > 0.005
      ? <span className="fm-badge reclame">À réclamer {eur(c.net)} HT</span>
      : <span className="fm-badge avoir">Rien à réclamer</span>;
  return (
    <div className={`fm-card${actif ? " actif" : ""}`}>
      <div className="fm-card-head">
        <span className="fm-card-name fl-mois">{libellePeriode(inv.periodFrom, inv.periodTo)}</span>
        {badge}
      </div>
      <div className="fm-card-sub">Facture {inv.numFacture} du {fmtFr(inv.dateFacture)}</div>
      <div className="fl-card-net">Net à payer : <strong>{eur(inv.netAPayer)}</strong></div>
      <div className="fm-card-actions">
        <button type="button" className="fm-btn" onClick={onVoir}>{actif ? "Affiché ci-dessus" : "Voir le résultat"}</button>
        <button type="button" className="fm-btn" onClick={onPdf}>{inv.fichierUrl ? "Voir la facture" : "Voir la facture (joindre le PDF)"}</button>
        <button type="button" className="fm-btn fm-btn-danger" onClick={onDelete}>Supprimer</button>
      </div>
    </div>
  );
}

// Le chiffre qui compte, en gros (même principe que NetResume de FactureMenage).
function ResultatNet({ c }) {
  if (c.net > 0.005) {
    return (
      <div className="fm-net big rouge">
        <span className="fm-net-l">Facturé en trop, à réclamer</span>
        <span className="fm-net-v">{eur(c.net)} HT</span>
        <span className="fm-net-sub">soit {eur(c.net * 1.2)} TTC</span>
      </div>
    );
  }
  return (
    <div className="fm-net big vert">
      <span className="fm-net-v">Rien à réclamer</span>
      <span className="fm-net-sub">
        {c.enTrop > 0.005 ? "Les oublis d'Elis compensent ce qui est facturé en trop." : c.nonFacture > 0.005 ? `Elis a oublié de facturer ${eur(c.nonFacture)} HT.` : "La facture correspond au linge reçu."}
      </span>
    </div>
  );
}

function Comparaison({ c, inv, destinataires }) {
  if (c.nbReceptions === 0) {
    return (
      <div className="fm-warn">
        <div className="fm-warn-title">Rien à comparer</div>
        <div className="fm-warn-sub">Aucune réception enregistrée sur {libellePeriode(inv.periodFrom, inv.periodTo)}. Vérifiez les dates du mois facturé ou l&apos;onglet Réceptions.</div>
      </div>
    );
  }
  const valeurFacturee = c.lignes.reduce((s, l) => s + l.facture * l.prix, 0);
  const valeurRecue = c.lignes.reduce((s, l) => s + l.recu * l.prix, 0);
  return (
    <>
      <div className="fm-res-grid">
        <ResultatNet c={c} />
        <table className="tbl fm-calc">
          <tbody>
            <tr><td>Facturé par Elis (articles comparés)</td><td className="r">{eur(valeurFacturee)}</td></tr>
            <tr><td>Linge reçu, au prix de la facture ({c.nbReceptions} réception{c.nbReceptions > 1 ? "s" : ""})</td><td className="r">{eur(valeurRecue)}</td></tr>
            <tr><td>Facturé mais pas reçu</td><td className="r">+ {eur(c.enTrop)}</td></tr>
            <tr><td>Reçu mais pas facturé (déduit)</td><td className="r">− {eur(c.nonFacture)}</td></tr>
            <tr className={`net ${c.net > 0.005 ? "rouge" : "vert"}`}>
              <td>À réclamer</td>
              <td className="r">{c.net > 0.005 ? `${eur(c.net)} HT` : "Rien"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="fl-sous-titre">Détail par article</div>
      <div className="tbl-wrap"><table className="tbl fl-tbl">
        <thead>
          <tr><th>Article</th>{c.avecCommande && <th className="c">Commandé</th>}<th className="c">Facturé</th><th className="c">Reçu</th><th className="c">Différence</th><th className="c">Prix unitaire HT</th><th className="r">Différence €</th></tr>
        </thead>
        <tbody>
          {c.lignes.map(l => {
            const cls = l.ecart > 0 ? "rouge" : l.ecart < 0 ? "bleu" : "vert";
            return (
              <tr key={l.key}>
                <td>{l.label}</td>
                {c.avecCommande && <td className="c fl-gris">{l.commande}</td>}
                <td className="c">{l.facture}</td>
                <td className="c">{l.recu}</td>
                <td className={`c fl-ecart ${cls}`}>{l.ecart === 0 ? "✓" : l.ecart > 0 ? `+${l.ecart}` : l.ecart}</td>
                <td className="c">{l.prix ? prix3(l.prix) : "—"}</td>
                <td className={`r fl-ecart ${cls}`}>{l.ecart === 0 ? "" : eur(l.ecartEuros)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <ul className="fl-legende">
        <li><span className="fl-ecart rouge">+ en rouge</span> : facturé mais pas noté dans Réceptions.</li>
        <li><span className="fl-ecart bleu">− en bleu</span> : reçu mais pas facturé.</li>
        <li>Reçu = total des réceptions datées dans le mois facturé. La participation pour perte (2,5 %) n&apos;est pas comptée dans la différence.</li>
      </ul>
      <MailReclamation inv={inv} c={c} destinataires={destinataires} />
    </>
  );
}

// Mail de réclamation prêt à envoyer (texte modifiable), comme dans Coûts ménage.
// Rien n'est envoyé automatiquement : Gmail s'ouvre pré-rempli, on relit et on envoie.
function MailReclamation({ inv, c, destinataires }) {
  const mail = mailReclamationLinge(inv, c);
  const [texte, setTexte] = useState(null);
  const [copie, setCopie] = useState(false);
  if (!mail) return null;
  const body = texte ?? mail.body;
  function gmail() {
    const url = "https://mail.google.com/mail/?" + new URLSearchParams({
      authuser: HOTEL_GMAIL, view: "cm", fs: "1", to: (destinataires || []).join(","), su: mail.subject, body,
    }).toString();
    window.open(url, "_blank");
  }
  async function copier() {
    try { await navigator.clipboard.writeText(`${mail.subject}\n\n${body}`); setCopie(true); setTimeout(() => setCopie(false), 2000); } catch (e) { /* ignoré */ }
  }
  return (
    <div className="fl-mail">
      <div className="fl-mail-title">Envoyer la réclamation à Elis</div>
      <div className="fm-note">Le mail est prêt. Relisez-le, modifiez-le si besoin, puis ouvrez-le dans Gmail pour l&apos;envoyer.</div>
      <div className="fm-mail">
        <div className="fl-objet">Objet : <strong>{mail.subject}</strong></div>
        <textarea value={body} onChange={e => setTexte(e.target.value)} rows={Math.min(22, body.split("\n").length + 1)} aria-label="Texte du mail" />
      </div>
      <div className="fm-actions fl-actions">
        <button type="button" className="fm-btn primary" onClick={gmail}>Ouvrir dans Gmail</button>
        <button type="button" className="fm-btn" onClick={copier}>{copie ? "Copié ✓" : "Copier le mail"}</button>
        {texte != null && <button type="button" className="fm-btn fm-btn-light" onClick={() => setTexte(null)}>Remettre le texte proposé</button>}
      </div>
      <p className="fm-note">
        {destinataires?.length ? `Destinataires : ceux du bon de ramassage (${destinataires.length} adresse${destinataires.length > 1 ? "s" : ""}). ` : "Aucun destinataire enregistré : ajoutez-les dans Gmail. "}
        Rien n&apos;est envoyé sans vous.
      </p>
    </div>
  );
}
