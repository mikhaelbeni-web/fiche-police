// components/FactureLinge.js
// Factures Elis (blanchisserie de Pantin) dans Commande linge > Coût linge :
// import du PDF (ou saisie manuelle), puis comparaison avec ce qui a été
// réellement reçu (onglet Réceptions) sur le mois facturé, article par
// article, en quantité et en euros. Firestore : `linen_invoices`.

import { useState, useRef } from "react";
import { ELIS_INVOICE_ARTICLES } from "../lib/linen";
import { lireLignesPdf, analyserFactureElis, comparerFactureReceptions, prixDifferents } from "../lib/factureLinge";

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
  const fichierRef = useRef(null);

  function ouvrirManuel() {
    setLecture("");
    setForm({ source: "manuel", numFacture: "", dateFacture: isoDay(new Date()), periodFrom: p.from, periodTo: p.to, lines: lignesVides(), autres: [], participationPerte: 0, avertissements: [] });
  }

  async function importerPdf(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setForm(null);
    setLecture("Lecture du PDF…");
    try {
      const lignes = await lireLignesPdf(f);
      const r = analyserFactureElis(lignes);
      setForm({ source: "pdf", fichierNom: f.name, ...r });
      setLecture("");
    } catch (err) {
      setLecture(`Impossible de lire ce PDF (${err.message}). Utilise la saisie manuelle.`);
    }
  }

  function setChamp(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setLigne(id, k, v) { setForm(f => ({ ...f, lines: { ...f.lines, [id]: { ...f.lines[id], [k]: v } } })); }

  async function enregistrer() {
    if (!form.numFacture.trim()) { setStatus("Le numéro de facture est requis."); return; }
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
      await fs.addDoc(fs.collection(fs.db, "linen_invoices"), doc);
      setForm(null);
      await reload();
      setStatus("Facture enregistrée.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function supprimer(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette facture ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "linen_invoices", id));
    await reload();
  }

  const doublon = form && form.numFacture && invoices.some(i => i.numFacture === form.numFacture.trim());
  const t = form ? totaux(form.lines, form.autres, form.participationPerte) : null;
  const apercu = form ? comparerFactureReceptions(form, receptions) : null;
  const prixChanges = form ? prixDifferents(form.lines, prices) : [];

  return (
    <>
      <div className="recap-head" style={{ marginTop: 28 }}>
        <div>
          <div className="recap-title" style={{ fontSize: 16 }}>Factures Elis : facturé contre reçu</div>
          <div className="recap-sub">Importe le PDF de la facture : chaque article est comparé à ce qui a été enregistré dans Réceptions sur le mois facturé</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input ref={fichierRef} type="file" accept="application/pdf,.pdf" onChange={importerPdf} style={{ display: "none" }} />
          <button className="primary" onClick={() => fichierRef.current?.click()}>Importer le PDF de la facture</button>
          <button onClick={form ? () => setForm(null) : ouvrirManuel}>{form ? "Annuler" : "Saisie manuelle"}</button>
        </div>
      </div>

      {lecture && <p style={{ fontSize: 13, color: lecture.startsWith("Impossible") ? "#c0392b" : "#666" }}>{lecture}</p>}

      {form && (
        <div className="linen-form">
          {form.source === "pdf" && (
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              Lu dans <strong>{form.fichierNom}</strong>. Vérifie les chiffres puis enregistre.
            </div>
          )}
          {(form.avertissements?.length > 0 || doublon || prixChanges.length > 0) && (
            <ul style={{ fontSize: 13, color: "#b9560b", margin: "0 0 12px", paddingLeft: 18 }}>
              {doublon && <li>Cette facture ({form.numFacture}) est déjà enregistrée.</li>}
              {form.avertissements?.map((a, i) => <li key={i}>{a}</li>)}
              {prixChanges.map(c => <li key={c.label}>Prix changé : {c.label} facturé {prix3(c.facture)} au lieu de {prix3(c.attendu)}.</li>)}
            </ul>
          )}

          <div className="linen-form-row">
            <label>N° facture <input type="text" value={form.numFacture} onChange={e => setChamp("numFacture", e.target.value)} placeholder="ex. 2600104-998618" style={{ width: 170 }} /></label>
            <label>Date facture <input type="date" value={form.dateFacture} onChange={e => setChamp("dateFacture", e.target.value)} /></label>
          </div>
          <div className="linen-form-row">
            <label>Mois facturé, du <input type="date" value={form.periodFrom} onChange={e => setChamp("periodFrom", e.target.value)} /></label>
            <label>au <input type="date" value={form.periodTo} onChange={e => setChamp("periodTo", e.target.value)} /></label>
          </div>

          <div className="tbl-wrap"><table className="tbl" style={{ marginBottom: 12 }}>
            <thead>
              <tr><th>Article (Elis)</th><th className="c">Qté facturée</th><th className="c">Prix unit. HT</th><th className="c">Montant HT</th></tr>
            </thead>
            <tbody>
              {ELIS_INVOICE_ARTICLES.map(a => {
                const l = form.lines[a.id];
                const vide = form.source === "pdf" && !(Number(l.qte) > 0);
                if (vide) return null; // gamme absente de la facture (ex. Horizon)
                return (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td className="c"><input type="number" min="0" value={l.qte} onChange={e => setLigne(a.id, "qte", e.target.value)} style={{ width: 70, textAlign: "center" }} /></td>
                    <td className="c"><input type="number" min="0" step="0.001" value={l.prixUnitaire} onChange={e => setLigne(a.id, "prixUnitaire", e.target.value)} style={{ width: 80, textAlign: "center" }} /></td>
                    <td className="c">{eur((Number(l.qte) || 0) * (Number(l.prixUnitaire) || 0))}</td>
                  </tr>
                );
              })}
              {form.autres?.map((a, i) => (
                <tr key={"autre" + i} style={{ color: "#888" }}>
                  <td>{a.label} <em>(non suivi)</em></td><td className="c">{a.qte}</td><td className="c">{prix3(a.prixUnitaire)}</td><td className="c">{eur(a.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>

          <div className="linen-form-row">
            <label>Participation pour perte € <input type="number" min="0" step="0.01" value={form.participationPerte} onChange={e => setChamp("participationPerte", e.target.value)} style={{ width: 100 }} /></label>
          </div>
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            Sous-total HT : <strong>{eur(t.sousTotalHT)}</strong> · Total HT : <strong>{eur(t.totalHT)}</strong> · TVA 20 % : <strong>{eur(t.tva)}</strong> ·{" "}
            <strong style={{ color: "#1f7a3f" }}>Net à payer : {eur(t.netAPayer)}</strong>
            {form.netImprime != null && Math.abs(form.netImprime - t.netAPayer) > 0.05 && <span style={{ color: "#b9560b" }}> (facture : {eur(form.netImprime)})</span>}
          </p>

          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", margin: "6px 0 8px", textTransform: "uppercase" }}>
            Aperçu : facturé contre reçu ({libellePeriode(form.periodFrom, form.periodTo)})
          </div>
          <Comparaison c={apercu} />

          <button className="primary" style={{ marginTop: 12 }} onClick={enregistrer}>Enregistrer la facture</button>
        </div>
      )}

      <div className="tbl-wrap"><table className="tbl" style={{ marginTop: 18 }}>
        <thead>
          <tr><th>N° facture</th><th>Mois facturé</th><th className="c">Net à payer</th><th className="c">Facturé en trop</th><th></th></tr>
        </thead>
        <tbody>
          {invoices.map(inv => <LigneFacture key={inv.id} inv={inv} receptions={receptions} onDelete={() => supprimer(inv.id)} />)}
          {invoices.length === 0 && <tr><td colSpan={5} className="empty-state">Aucune facture enregistrée.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

function LigneFacture({ inv, receptions, onDelete }) {
  const [open, setOpen] = useState(false);
  const c = comparerFactureReceptions(inv, receptions);
  return (
    <>
      <tr>
        <td>{inv.numFacture}<div style={{ fontSize: 11, color: "#999" }}>du {fmtFr(inv.dateFacture)}</div></td>
        <td>{libellePeriode(inv.periodFrom, inv.periodTo)}</td>
        <td className="c" style={{ fontWeight: 700 }}>{eur(inv.netAPayer)}</td>
        <td className="c" style={{ fontWeight: 700, color: c.nbReceptions === 0 ? "#999" : c.enTrop > 0.005 ? "#c0392b" : "#1f7a3f" }}>
          {c.nbReceptions === 0 ? "—" : c.enTrop > 0.005 ? `${eur(c.enTrop)} HT` : "Rien"}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          <button onClick={() => setOpen(!open)} className="ghost" style={{ color: "#2980b9" }}>{open ? "Masquer" : "Comparer"}</button>
          <button onClick={onDelete} className="ghost" style={{ color: "#e74c3c" }}>✕</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: "#f8f9fb", padding: 14 }}>
            <Comparaison c={c} />
          </td>
        </tr>
      )}
    </>
  );
}

function Comparaison({ c }) {
  if (c.nbReceptions === 0) {
    return <p style={{ fontSize: 13, color: "#b9560b" }}>Aucune réception enregistrée sur ce mois : rien à comparer. Vérifie les dates du mois facturé ou l&apos;onglet Réceptions.</p>;
  }
  return (
    <>
      <div className="tbl-wrap"><table className="tbl">
        <thead>
          <tr><th>Article</th><th className="c">Facturé</th><th className="c">Reçu</th><th className="c">Écart</th><th className="c">Prix unit. HT</th><th className="c">Écart €</th></tr>
        </thead>
        <tbody>
          {c.lignes.map(l => {
            const couleur = l.ecart > 0 ? "#c0392b" : l.ecart < 0 ? "#2980b9" : "#1f7a3f";
            return (
              <tr key={l.key}>
                <td>{l.label}</td>
                <td className="c">{l.facture}</td>
                <td className="c">{l.recu}</td>
                <td className="c" style={{ fontWeight: 700, color: couleur }}>{l.ecart === 0 ? "✓" : l.ecart > 0 ? `+${l.ecart}` : l.ecart}</td>
                <td className="c">{l.prix ? prix3(l.prix) : "—"}</td>
                <td className="c" style={{ fontWeight: 700, color: couleur }}>{l.ecart === 0 ? "" : eur(l.ecartEuros)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <div style={{ marginTop: 10, fontSize: 14 }}>
        {c.enTrop > 0.005
          ? <strong style={{ color: "#c0392b" }}>Facturé en trop : {eur(c.enTrop)} HT ({eur(c.enTrop * 1.2)} TTC)</strong>
          : <strong style={{ color: "#1f7a3f" }}>Rien de facturé en trop.</strong>}
        {c.nonFacture > 0.005 && <span style={{ color: "#2980b9" }}> · Reçu mais non facturé : {eur(c.nonFacture)} HT</span>}
      </div>
      <p style={{ fontSize: 11, color: "#999", marginTop: 6 }}>
        Écart = facturé − reçu. En rouge : facturé mais pas enregistré en réception. En bleu : reçu mais pas facturé.
        Reçu = somme des réceptions datées dans le mois facturé ({c.nbReceptions} réception{c.nbReceptions > 1 ? "s" : ""}).
        La participation pour perte (2,5 %) n&apos;est pas comptée dans l&apos;écart.
      </p>
    </>
  );
}
