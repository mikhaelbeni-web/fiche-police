// pages/linge.js
// Linge à commander — Résidence Le Belleville uniquement.
// Ligne 1 : nombre de personnes attendues. Ligne 2 : numéro d'appartement.
// Lignes suivantes : types de linge, cases vides à remplir par le personnel.

import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { listApartments, isDepartureMoved } from "../lib/apartments";
import CodeModal from "../components/CodeModal";
import { useCodeGate } from "../hooks/useCodeGate";

const KEY_KEY = "hostaway_api_key";
const ACCOUNT_KEY = "hostaway_account";

// Même code que pour les suppressions sensibles de Gestion des espèces (solde
// de départ / lignes taxe de séjour). Frein volontaire côté navigateur, pas
// une vraie sécurité. Changeable via NEXT_PUBLIC_DELETE_PASSWORD sur Vercel.
const DELETE_PASSWORD = process.env.NEXT_PUBLIC_DELETE_PASSWORD || "2305";

const LINEN_ROWS = [
  "Grande serviette",
  "Housse",
  "Petite serviette",
  "Tapis de bain",
  "Torchon à carreaux",
  "Taie d'oreiller",
  "Drap",
];

function isoDay(d) { return d.toISOString().slice(0, 10); }
function fmtFr(d) {
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function euros(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function Linge() {
  const { requestCode, codeModalProps } = useCodeGate(DELETE_PASSWORD, "Code requis");
  const [day, setDay] = useState(isoDay(new Date()));
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [creds, setCreds] = useState({ account: "", key: "" });

  // Ménages supplémentaires (Firebase)
  const [fs, setFs] = useState(null);
  const [fbConfigured, setFbConfigured] = useState(true);
  const [extraMenages, setExtraMenages] = useState([]);
  const [extraStatus, setExtraStatus] = useState("");
  const [extraApt, setExtraApt] = useState("");
  const [extraDate, setExtraDate] = useState(isoDay(new Date()));
  const [extraMotif, setExtraMotif] = useState("");
  const [extraType, setExtraType] = useState("supplement"); // supplement | decale
  const [extraDatePrevue, setExtraDatePrevue] = useState(isoDay(new Date(Date.now() - 86400000)));
  const apartments = listApartments();

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setFbConfigured(false); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const api = { db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadExtras(api);
    })();
  }, []);

  async function loadExtras(api) {
    const snap = await api.getDocs(api.query(api.collection(api.db, "extra_menages"), api.orderBy("date", "desc")));
    setExtraMenages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  async function addExtraMenage() {
    if (!extraApt) { setExtraStatus("Choisis un appartement."); return; }
    if (!extraMotif.trim()) { setExtraStatus("Le motif est obligatoire."); return; }
    const info = apartments.find(a => a.id === extraApt);
    // Un ménage décalé est le MÊME ménage, simplement reporté à une autre date :
    // il porte donc le vrai coût, et le départ d'origine est masqué + décompté
    // ailleurs (voir isDepartureMoved). Une seule facturation au total, rattachée
    // au jour où le ménage est réellement fait.
    // Le marqueur movesDeparture distingue ces nouveaux décalés des anciens
    // (enregistrés à 0 €), repris uniquement via le bouton dédié ci-dessous.
    const isDecale = extraType === "decale";
    try {
      setExtraStatus("Enregistrement…");
      await fs.addDoc(fs.collection(fs.db, "extra_menages"), {
        listingId: extraApt, residence: info.residence, appartement: info.appartement,
        unitNumber: info.unitNumber,
        menageHT: info.menageHT,
        amenitiesHT: info.amenitiesHT,
        date: extraDate, motif: extraMotif.trim(),
        type: extraType, datePrevue: isDecale ? extraDatePrevue : null,
        movesDeparture: isDecale ? true : null,
        createdAt: new Date().toISOString(),
      });
      setExtraMotif("");
      await loadExtras(fs);
      setExtraStatus(isDecale ? "Ménage décalé — déplacé et facturé à la nouvelle date." : "Ménage supplémentaire ajouté.");
    } catch (err) { setExtraStatus("Erreur : " + err.message); }
  }

  // ---- Reprise des anciens décalés (avant ce correctif, enregistrés à 0 €) ----
  // Ne traite QUE les décalés sans le marqueur movesDeparture — donc jamais les
  // nouveaux, et jamais deux fois le même : une fois repris, un décalé porte le
  // marqueur et n'est plus jamais retouché par ce bouton, même si on le reclique.
  const oldDecales = extraMenages.filter(e => e.type === "decale" && e.movesDeparture !== true);

  async function migrateOldDecales() {
    if (oldDecales.length === 0) return;
    if (!confirm(`Reprendre ${oldDecales.length} ancien(s) ménage(s) décalé(s) ? Ils passeront de 0 € au vrai coût, et leur départ d'origine sera masqué du planning de sa date.`)) return;
    requestCode(async () => {
      try {
        setExtraStatus("Reprise des anciens décalés…");
        let done = 0;
        for (const e of oldDecales) {
          const info = apartments.find(a => a.id === e.listingId)
            || apartments.find(a => a.unitNumber === e.unitNumber && a.residence === e.residence);
          if (!info) continue; // appartement introuvable : on laisse tel quel plutôt que de deviner un montant
          await fs.updateDoc(fs.doc(fs.db, "extra_menages", e.id), {
            menageHT: info.menageHT, amenitiesHT: info.amenitiesHT, movesDeparture: true,
          });
          done += 1;
        }
        await loadExtras(fs);
        setExtraStatus(`${done} ancien(s) décalé(s) repris — coût réel appliqué, départs d'origine masqués.`);
      } catch (err) { setExtraStatus("Erreur : " + err.message); }
    });
  }

  async function delExtraMenage(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce ménage supplémentaire ?")) return;
    requestCode(async () => {
      await fs.deleteDoc(fs.doc(fs.db, "extra_menages", id));
      await loadExtras(fs);
    });
  }

  useEffect(() => {
    setCreds({
      account: window.localStorage.getItem(ACCOUNT_KEY) || "",
      key: window.localStorage.getItem(KEY_KEY) || "",
    });
  }, []);

  const load = useCallback(async (d, acc, key) => {
    if (!acc || !key) { setStatus("Identifiants Hostaway manquants — configure-les sur la page Fiches."); return; }
    setLoading(true);
    setStatus("Chargement…");
    try {
      const res = await fetch(`/api/linen?day=${d}`, {
        headers: { "x-hostaway-account": acc, "x-hostaway-key": key },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Erreur");
      setItems(j.items || []);
      const n = j.items?.length || 0;
      const u = j.unresolved?.length || 0;
      setStatus(
        (n ? `${n} appartement(s) à faire` : "Aucun appartement à faire") +
        (u ? ` · ⚠ ${u} départ(s) non identifié(s), vérifie manuellement` : "")
      );
    } catch (err) {
      setStatus("Erreur : " + err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (creds.account && creds.key) load(day, creds.account, creds.key);
  }, [day, creds, load]);

  function shiftDay(n) {
    const d = new Date(day + "T12:00:00");
    d.setDate(d.getDate() + n);
    setDay(isoDay(d));
  }

  // Ménages supplémentaires Belleville du jour affiché : ajoutés comme colonnes
  // supplémentaires sur la feuille de linge, pour que le personnel sache qu'il
  // faut aussi passer dans cet appartement (même sans check-out réel ce jour-là).
  // Si l'appartement a DÉJÀ sa colonne (un vrai départ ce jour-là), on fusionne
  // le décalé dedans au lieu d'en créer une seconde colonne pour le même logement.
  const extraToday = extraMenages.filter(e => e.residence === "Belleville" && e.date === day);
  // Un départ dont le ménage a été décalé à une autre date ne doit plus figurer
  // sur la feuille de ce jour : il est déplacé, pas dupliqué. Les items de la
  // feuille n'ont pas de champ `depart` (leur date est celle affichée), d'où
  // l'item synthétique passé au helper.
  const sheetItems = items.filter(
    it => !isDepartureMoved({ ...it, depart: day }, extraMenages)
  );
  for (const e of extraToday) {
    const existing = sheetItems.find(it => it.unitNumber === e.unitNumber);
    if (existing) {
      existing.extra = true;
      existing.motif = e.motif;
      existing.extraType = e.type;
      existing.datePrevue = e.datePrevue;
    } else {
      sheetItems.push({
        unitNumber: e.unitNumber, appartement: e.appartement, attendu: null,
        extra: true, motif: e.motif, extraType: e.type, datePrevue: e.datePrevue,
      });
    }
  }

  return (
    <>
      <Head><title>Linge à commander — {fmtFr(day)}</title></Head>

      <div className="toolbar">
        <h1>Linge à commander</h1>
        <div className="daynav">
          <button className="arrow" onClick={() => shiftDay(-1)}>‹</button>
          <div className="daylabel">{fmtFr(day)}</div>
          <button className="arrow" onClick={() => shiftDay(1)}>›</button>
        </div>
        <button onClick={() => setDay(isoDay(new Date()))}>Aujourd&apos;hui</button>
        <button onClick={() => load(day, creds.account, creds.key)} disabled={loading} title="Actualiser">↻</button>
        <button className="primary" onClick={() => window.print()} disabled={!sheetItems.length}>Imprimer</button>
        <span className="status">{status}</span>
      </div>

      <div className="linge-page">
        {fbConfigured && (
          <div className="linen-form" style={{ marginBottom: 18 }}>
            <div className="recap-title" style={{ fontSize: 15, marginBottom: 10 }}>Ajouter un ménage supplémentaire</div>
            <div className="linen-form-row">
              <label>Type
                <select value={extraType} onChange={e => setExtraType(e.target.value)}>
                  <option value="supplement">Supplément payant</option>
                  <option value="decale">Ménage décalé (déplacé à une autre date)</option>
                </select>
              </label>
              <label>Appartement
                <select value={extraApt} onChange={e => setExtraApt(e.target.value)} style={{ minWidth: 220 }}>
                  <option value="">— Choisir —</option>
                  {["Belleville", "Lantiez", "Villiers"].map(res => (
                    <optgroup key={res} label={res}>
                      {apartments.filter(a => a.residence === res).map(a => (
                        <option key={a.id} value={a.id}>{a.appartement} ({euros(a.menageHT + (a.amenitiesHT || 0))} = ménage {euros(a.menageHT)} + amenities {euros(a.amenitiesHT || 0)})</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>{extraType === "decale" ? "Date où le ménage sera réellement fait" : "Date"} <input type="date" value={extraDate} onChange={e => setExtraDate(e.target.value)} /></label>
              {extraType === "decale" && (
                <label>Date normalement prévue <input type="date" value={extraDatePrevue} onChange={e => setExtraDatePrevue(e.target.value)} /></label>
              )}
            </div>
            <div className="linen-form-row">
              <label style={{ flex: 1 }}>Motif (obligatoire)
                <input type="text" value={extraMotif} onChange={e => setExtraMotif(e.target.value)}
                  placeholder={extraType === "decale" ? "ex. reporté au lendemain, ou avancé car appartement libéré plus tôt" : "ex. technicien est intervenu et a fait du désordre"} style={{ width: "100%" }} />
              </label>
            </div>
            {extraType === "decale" && (
              <p style={{ fontSize: 12, color: "#2980b9", marginTop: -6, marginBottom: 10 }}>
                Le ménage est <strong>déplacé</strong> — dans un sens ou dans l&apos;autre (avancé ou reporté) : il disparaît du planning de la date normalement prévue et n&apos;apparaît qu&apos;à la date où il sera réellement fait. Une seule facturation, comptée à cette date réelle.
              </p>
            )}

            {oldDecales.length > 0 && (
              <div style={{ background: "#fdf3e6", border: "1px solid #f0d9b5", borderRadius: 6, padding: "10px 14px", marginTop: 4, marginBottom: 12 }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <strong>{oldDecales.length} ancien(s) ménage(s) décalé(s)</strong> enregistré(s) avant ce correctif, toujours à 0 € et sans masquer leur départ d&apos;origine.
                </div>
                <button onClick={migrateOldDecales} className="ghost" style={{ fontSize: 12, color: "#b8860b" }}>
                  Reprendre ces {oldDecales.length} ancien(s) décalé(s) (code requis)
                </button>
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                  Sûr à recliquer : une fois repris, un décalé ne réapparaît plus jamais dans cette liste.
                </div>
              </div>
            )}

            <button className="primary" onClick={addExtraMenage}>Ajouter</button>
            {extraStatus && <span style={{ marginLeft: 10, fontSize: 12, color: "#666" }}>{extraStatus}</span>}

            {extraMenages.length > 0 && (
              <div className="tbl-wrap"><table className="tbl" style={{ marginTop: 14 }}>
                <thead>
                  <tr><th>Date</th><th>Résidence</th><th>Appartement</th><th>Motif</th><th>Type</th><th className="c">Coût</th><th></th></tr>
                </thead>
                <tbody>
                  {extraMenages.map(e => (
                    <tr key={e.id}>
                      <td>{fmtFr(e.date)}</td>
                      <td>{e.residence}</td>
                      <td>{e.appartement}</td>
                      <td>
                        {e.motif}
                        {e.type === "decale" && e.datePrevue && (
                          <div style={{ fontSize: 11, color: "#2980b9" }}>Prévu le {fmtFr(e.datePrevue)}</div>
                        )}
                      </td>
                      <td>{e.type === "decale" ? <span style={{ color: "#2980b9" }}>Décalé</span> : "Supplément"}</td>
                      <td className="c">{euros((e.menageHT || 0) + (e.amenitiesHT || 0))}</td>
                      <td><button onClick={() => delExtraMenage(e.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        )}

        {sheetItems.length === 0 && !loading && (
          <div className="empty-state">Aucun appartement Belleville à faire ce jour.</div>
        )}

        {sheetItems.length > 0 && (
          <div className="linge-sheet">
            <div className="linge-title">LINGE SALE — Résidence Le Belleville</div>
            <div className="linge-date">Date : <strong>{fmtFr(day)}</strong></div>

            <div className="tbl-wrap"><table className="linge-tbl">
              <thead>
                <tr>
                  <th className="rowlabel">Nombre de personnes</th>
                  {sheetItems.map((it, i) => {
                    // Lits doubles : arrondir au pair supérieur pour le linge.
                    // 1 -> 2, 3 -> 4, 2 -> 2, 4 -> 4, 5 -> 6...
                    const n = it.attendu;
                    const affiche = (n != null && n > 0) ? (n % 2 === 0 ? n : n + 1) : null;
                    return (
                      <th key={i} className="pax">
                        {it.extra
                          ? <span style={{ color: it.extraType === "decale" ? "#2980b9" : "#b8860b" }}>{it.extraType === "decale" ? "DÉCALÉ" : "SUPPL."}</span>
                          : (affiche != null ? `${affiche}P` : "—")}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  <th className="rowlabel">N° Appartement</th>
                  {sheetItems.map((it, i) => (
                    <th key={i} className="aptnum" title={it.extra ? (it.extraType === "decale" ? `${it.motif} (prévu le ${fmtFr(it.datePrevue)})` : it.motif) : undefined}>{it.unitNumber}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LINEN_ROWS.map(row => (
                  <tr key={row}>
                    <td className="rowlabel">{row}</td>
                    {sheetItems.map((_, i) => <td key={i} className="blank" />)}
                  </tr>
                ))}
              </tbody>
            </table></div>

            <div className="linge-footer">
              <div className="linge-signature">Prénom (personnel de ménage) : ____________________</div>
            </div>
          </div>
        )}
      </div>
      <CodeModal {...codeModalProps} />
    </>
  );
}

export default function LingePage() {
  return <Linge />;
}
