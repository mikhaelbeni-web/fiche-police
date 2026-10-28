// components/IncendieImport.js
// Import d'un document de sécurité incendie : lecture du PDF (nom + texte),
// proposition du contrôle, de la date, de l'organisme et de la nature,
// confirmation par l'utilisateur, puis création des lignes Firestore.
// Le statut, la dernière vérification et l'échéance se recalculent seuls.
// Règle : le résultat (avec / sans réserves) est toujours choisi par la
// personne ; le logiciel ne fait que le suggérer d'après le texte.

import { useState, useEffect } from "react";
import { detecterDocument } from "../lib/incendieDetect";
import { lireTextePdf, televerser } from "../lib/incendieFichiers";
import { COL_VERIFS, COL_DOCS, COL_FACTURES, NATURES_DOC, CATEGORIES_FACTURE, reservesOuvertes, fmtFr } from "../lib/incendie";

const STYLE_CARTE = { border: "1px solid #d5dbe3", borderRadius: 8, padding: 12, marginBottom: 12, background: "#fff" };

function initItem(file, texte, types, docs, factures) {
  const det = detecterDocument(file.name, texte);
  const max = det.types.length ? det.types[0].mentions : 0;
  // Contrôles cochés d'emblée : ceux qui pèsent dans le document (la télésurveillance n'a pas d'échéance).
  const choisis = det.types
    .filter(t => types.some(x => x.id === t.typeId) && t.typeId !== "telesurveillance" && t.mentions >= Math.max(2, max * 0.1))
    .map(t => t.typeId);
  if (!choisis.length && det.types.length && types.some(x => x.id === det.types[0].typeId)) choisis.push(det.types[0].typeId);
  const doublon = [...docs, ...factures].some(x => x.nomFichier === file.name);
  return {
    file, det, nature: det.nature, date: det.date, organisme: det.organisme, reference: det.reference,
    typeIds: choisis, resultats: {}, reserves: {}, contre: {}, corrective: {},
    montant: det.montantTTC != null ? String(det.montantTTC) : "", numero: det.numeroFacture || "",
    categorie: det.correctif ? "intervention" : "verification", objet: "",
    ignorer: doublon, doublon,
  };
}

export default function IncendieImport({ fichiers, fs, types, verifs, docs, factures, onCancel, onDone }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      const res = [];
      for (const f of fichiers) res.push(initItem(f, await lireTextePdf(f), types, docs, factures));
      if (!annule) setItems(res);
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fichiers]);

  const maj = (i, patch) => setItems(l => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const majType = (i, champ, typeId, v) => setItems(l => l.map((x, k) => (k === i ? { ...x, [champ]: { ...x[champ], [typeId]: v } } : x)));
  const basculer = (i, typeId) => setItems(l => l.map((x, k) => {
    if (k !== i) return x;
    return { ...x, typeIds: x.typeIds.includes(typeId) ? x.typeIds.filter(t => t !== typeId) : [...x.typeIds, typeId] };
  }));

  function verifier(it) {
    if (it.ignorer) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) return "Date manquante.";
    if (it.nature === "Facture") {
      if (it.montant === "" || isNaN(Number(it.montant))) return "Montant TTC manquant.";
      return "";
    }
    if (!it.typeIds.length) return "Choisis au moins un contrôle.";
    if (it.nature === "Rapport") {
      for (const t of it.typeIds) {
        const nom = types.find(x => x.id === t)?.nom || t;
        if (!it.resultats[t]) return `Indique s'il y a des réserves pour « ${nom} ».`;
        if (it.resultats[t] === "avec_reserves" && !(it.reserves[t] || "").trim()) return `Décris les réserves pour « ${nom} ».`;
      }
    }
    return "";
  }

  async function enregistrer() {
    const actifs = items.filter(x => !x.ignorer);
    if (!actifs.length) return setErr("Rien à importer.");
    for (const it of actifs) { const e = verifier(it); if (e) return setErr(it.file.name + " : " + e); }
    setBusy(true); setErr("");
    const maintenant = new Date().toISOString();
    let sansFichier = 0, nv = 0, nd = 0, nf = 0;
    try {
      for (const it of actifs) {
        let pj = { fichierUrl: "", fichierNom: it.file.name };
        try { pj = await televerser(it.file, it.typeIds[0] || "factures"); } catch { sansFichier++; }
        const commun = { nomFichier: it.file.name, fichierNom: it.file.name, fichierUrl: pj.fichierUrl, source: "import-document", createdAt: maintenant };
        if (it.nature === "Facture") {
          await fs.addDoc(fs.collection(fs.db, COL_FACTURES), {
            ...commun, date: it.date, fournisseur: it.organisme, typeId: it.typeIds[0] || null, categorie: it.categorie,
            objet: it.objet.trim() || it.reference || "Facture", reference: it.numero, montantTTC: Number(it.montant), montantHT: null, lien: "",
          });
          nf++;
        } else if (it.nature === "Rapport") {
          for (const t of it.typeIds) {
            const res = it.resultats[t];
            const ouv = reservesOuvertes(verifs.filter(v => v.typeId === t)).sort((a, b) => a.date.localeCompare(b.date));
            const contre = res === "sans_reserve" ? (it.contre[t] === undefined ? (ouv[0]?.id || null) : (it.contre[t] || null)) : null;
            const ref = await fs.addDoc(fs.collection(fs.db, COL_VERIFS), {
              typeId: t, date: it.date, organisme: it.organisme, resultat: res,
              reserves: res === "avec_reserves" ? it.reserves[t].trim() : "",
              contreVisiteDe: contre, compteEcheance: !(contre && it.corrective[t]), note: "", source: "import-document", createdAt: maintenant,
            });
            nv++;
            await fs.addDoc(fs.collection(fs.db, COL_DOCS), {
              ...commun, typeId: t, verificationId: ref.id, date: it.date, nature: "Rapport de vérification",
              reference: it.reference, fournisseur: it.organisme, lienGmail: "", lien: "",
            });
            nd++;
          }
        } else {
          for (const t of it.typeIds) {
            await fs.addDoc(fs.collection(fs.db, COL_DOCS), {
              ...commun, typeId: t, verificationId: null, date: it.date, nature: it.nature, reference: it.reference,
              objet: it.objet.trim(), fournisseur: it.organisme, lienGmail: "", lien: "",
            });
            nd++;
          }
        }
      }
      onDone(`Import terminé : ${nv} vérification(s), ${nd} document(s), ${nf} facture(s)` + (sansFichier ? ` — ${sansFichier} fichier(s) non envoyé(s) au stockage (Firebase Storage activé ?)` : "") + ". Statuts et échéances mis à jour.");
    } catch (e) {
      setErr("Import interrompu : " + e.message + " (les éléments déjà créés restent enregistrés).");
      setBusy(false);
    }
  }

  if (!items) return <div className="linen-form inc-form no-print">Lecture des documents…</div>;

  return (
    <div className="linen-form inc-form no-print">
      <div className="inc-form-title">Importer un document</div>
      <div className="inc-sub" style={{ marginBottom: 10 }}>
        Contrôle, date et organisme sont proposés d&apos;après le nom et le texte du PDF : vérifie-les. Le résultat (avec ou sans réserves) se choisit toujours à la main.
      </div>
      {items.map((it, i) => {
        const err1 = verifier(it);
        return (
          <div key={i} style={{ ...STYLE_CARTE, opacity: it.ignorer ? 0.55 : 1 }}>
            <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{it.file.name}</div>
            {!it.det.texteLu && <div className="inc-sub">Texte du PDF illisible : détection d&apos;après le nom du fichier seulement.</div>}
            {it.doublon && (
              <label className="inc-radio" style={{ color: "#b9770e" }}>
                <input type="checkbox" checked={it.ignorer} onChange={e => maj(i, { ignorer: e.target.checked })} /> Un fichier du même nom existe déjà : ne pas l&apos;importer
              </label>
            )}
            {!it.ignorer && (
              <>
                <div className="linen-form-row">
                  <label>Nature
                    <select value={it.nature} onChange={e => maj(i, { nature: e.target.value })}>
                      {NATURES_DOC.map(n => <option key={n}>{n}</option>)}
                    </select>
                  </label>
                  <label>Date {it.det.dateSource && it.date === it.det.date ? <span className="inc-sub">(lue : {it.det.dateSource})</span> : null}
                    <input type="date" value={it.date} onChange={e => maj(i, { date: e.target.value })} />
                  </label>
                  <label>{it.nature === "Facture" ? "Fournisseur" : "Organisme"}
                    <input type="text" value={it.organisme} onChange={e => maj(i, { organisme: e.target.value })} />
                  </label>
                  <label>Référence <input type="text" value={it.reference} onChange={e => maj(i, { reference: e.target.value })} /></label>
                </div>

                <div className="linen-form-row">
                  <strong>{it.nature === "Facture" ? "Contrôle concerné (facultatif)" : "Contrôle(s) concerné(s)"}</strong>
                  {types.map(t => {
                    const m = it.det.types.find(x => x.typeId === t.id);
                    return (
                      <label key={t.id} className="inc-radio">
                        <input type="checkbox" checked={it.typeIds.includes(t.id)} onChange={() => basculer(i, t.id)} /> {t.nom}{m ? <span className="inc-sub"> ({m.mentions})</span> : null}
                      </label>
                    );
                  })}
                </div>
                {!it.typeIds.length && it.nature !== "Facture" && <div className="inc-sub" style={{ color: "#c0392b" }}>Aucun contrôle reconnu : coche le bon.</div>}

                {it.nature === "Facture" && (
                  <div className="linen-form-row">
                    <label>Montant TTC € <input type="number" min="0" step="0.01" value={it.montant} onChange={e => maj(i, { montant: e.target.value })} style={{ width: 120 }} /></label>
                    <label>N° de facture <input type="text" value={it.numero} onChange={e => maj(i, { numero: e.target.value })} /></label>
                    <label>Nature
                      <select value={it.categorie} onChange={e => maj(i, { categorie: e.target.value })}>
                        {Object.entries(CATEGORIES_FACTURE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label style={{ flex: 1 }}>Objet <input type="text" value={it.objet} onChange={e => maj(i, { objet: e.target.value })} style={{ width: "100%" }} /></label>
                  </div>
                )}

                {it.nature === "Rapport" && it.typeIds.map(t => {
                  const type = types.find(x => x.id === t);
                  const lignes = it.det.reserves[t] || [];
                  const ouvertes = reservesOuvertes(verifs.filter(v => v.typeId === t)).sort((a, b) => a.date.localeCompare(b.date));
                  const res = it.resultats[t] || "";
                  return (
                    <div key={t} style={{ borderTop: "1px dashed #d5dbe3", paddingTop: 8, marginTop: 8 }}>
                      <div className="linen-form-row inc-radios">
                        <strong>{type?.nom} : le rapport comporte-t-il des réserves ? (obligatoire)</strong>
                        <label className="inc-radio"><input type="radio" name={`res-${i}-${t}`} checked={res === "sans_reserve"} onChange={() => majType(i, "resultats", t, "sans_reserve")} /> Sans réserve</label>
                        <label className="inc-radio"><input type="radio" name={`res-${i}-${t}`} checked={res === "avec_reserves"} onChange={() => majType(i, "resultats", t, "avec_reserves")} /> Avec réserves</label>
                      </div>
                      {lignes.length > 0 && (
                        <div className="inc-sub" style={{ color: "#b9770e" }}>
                          Le texte contient des mots de défaut, à relire :
                          {lignes.slice(0, 4).map((l, k) => <div key={k}>« {l.slice(0, 160)} »</div>)}
                          {lignes.length > 4 && <div>… et {lignes.length - 4} autre(s) ligne(s)</div>}
                          {res === "avec_reserves" && !(it.reserves[t] || "") && (
                            <button className="ghost" onClick={() => majType(i, "reserves", t, lignes.slice(0, 4).join(" ; ").slice(0, 400))}>Reprendre ces lignes comme réserves</button>
                          )}
                        </div>
                      )}
                      {res === "avec_reserves" && (
                        <label style={{ display: "block" }}>Description des réserves
                          <textarea rows={2} value={it.reserves[t] || ""} onChange={e => majType(i, "reserves", t, e.target.value)} style={{ width: "100%" }} />
                        </label>
                      )}
                      {res === "sans_reserve" && ouvertes.length > 0 && (
                        <div className="linen-form-row">
                          <label>Lève les réserves du…
                            <select value={it.contre[t] === undefined ? ouvertes[0].id : it.contre[t]} onChange={e => majType(i, "contre", t, e.target.value)}>
                              {ouvertes.map(v => <option key={v.id} value={v.id}>{fmtFr(v.date)} — {(v.reserves || "").slice(0, 50)}</option>)}
                              <option value="">Aucune (vérification indépendante)</option>
                            </select>
                          </label>
                          {(it.contre[t] === undefined ? ouvertes[0].id : it.contre[t]) && (
                            <label className="inc-radio"><input type="checkbox" checked={!!it.corrective[t]} onChange={e => majType(i, "corrective", t, e.target.checked)} />
                              Simple intervention corrective (la visite d&apos;origine reste la référence)
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {err1 && <div className="inc-sub" style={{ color: "#c0392b", marginTop: 6 }}>{err1}</div>}
              </>
            )}
          </div>
        );
      })}
      {err && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{err}</div>}
      <button className="primary" disabled={busy} onClick={enregistrer} style={{ background: "#1f3a5f", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 5, cursor: "pointer" }}>
        {busy ? "Import…" : "Enregistrer et mettre à jour"}
      </button>
      <button onClick={onCancel} disabled={busy} className="ghost" style={{ marginLeft: 8 }}>Annuler</button>
    </div>
  );
}
