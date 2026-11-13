// components/admin/Reglages.js — onglet « Réglages » de l'Espace admin.
// Plage d'alerte et heures d'arrivée/départ, interprétation de chaque type d'action
// igloohome (un geste = choisir ET valider), correspondance des serrures, codes du personnel.
// Chaque enregistrement relit la configuration juste avant d'écrire, pour ne rien écraser.
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { adminCall, Erreur } from "./api";
import Correspondance from "./Correspondance";
import Personnel from "./Personnel";
import { NATURES, DEFAULT_SETTINGS, libelleType } from "../../lib/croisement";

const ICON = { entree: "🔑", sortie: "🚪", presence: "✋", ignorer: "⚙" };
const COURT = { entree: "Entrée", sortie: "Sortie", presence: "Présence", ignorer: "Ignorer" };
const AIDE = {
  entree: "ouverture depuis l'extérieur : code, application, carte, clé",
  sortie: "ouverture depuis l'intérieur : quelqu'un sort",
  presence: "verrouillage à la main ou au bouton : quelqu'un est à la porte",
  ignorer: "action du système, sans personne : réglage d'heure, verrouillage automatique…",
};

export default function Reglages() {
  const router = useRouter();
  const [config, setConfig] = useState(null);
  const [reg, setReg] = useState(null);
  const [types, setTypes] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState("load");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          adminCall(router, "/api/admin/igloohome/config"),
          adminCall(router, "/api/admin/igloohome/suivi").catch(() => ({ suivi: {} })),
        ]);
        setConfig(c.config); setReg({ ...DEFAULT_SETTINGS, ...c.config.reglages });
        setTypes(s.suivi?.dernier?.types || []);
      } catch (e) { setErr(e); }
      finally { setBusy(""); }
    })();
  }, [router]);

  async function save(patch, what) {
    setBusy(what); setErr(null); setSaved("");
    try {
      const { config: fresh } = await adminCall(router, "/api/admin/igloohome/config");
      const p = typeof patch === "function" ? patch(fresh) : patch;
      const out = await adminCall(router, "/api/admin/igloohome/config", { method: "PUT", body: JSON.stringify({ config: { ...fresh, ...p } }) });
      setConfig(out.config);
      return out.config;
    } catch (e) { setErr(e); return null; }
    finally { setBusy(""); }
  }

  async function choisir(type, nature) {
    setConfig(c => ({ ...c, interpretations: { ...(c.interpretations || {}), [type]: { nature, valide: true } } })); // retour immédiat
    await save(fresh => ({ interpretations: { ...(fresh.interpretations || {}), [type]: { nature, valide: true } } }), "type:" + type);
  }

  if (busy === "load") return <div className="admin-note">Chargement…</div>;
  if (!config) return <Erreur e={err} />;

  const interps = config.interpretations || {};
  const liste = types.map(t => {
    const v = interps[t.type];
    return { ...t, libelle: t.libelle || libelleType(t.type), nature: v?.nature || t.proposition || "ignorer", valide: Boolean(v?.valide) };
  }).sort((a, b) => Number(a.valide) - Number(b.valide) || b.nombre - a.nombre);
  const aValider = liste.filter(t => !t.valide).length;
  const changed = reg && ["heureDebut", "heureFin", "heureArrivee", "heureDepart"].some(k => Number(reg[k]) !== Number(config.reglages[k]));

  return (
    <div className="rg">
      <Erreur e={err} />

      <section className="rg-card">
        <h3>Horaires</h3>
        <p className="rg-help">Une visite qui touche la plage d&apos;alerte est une <b>alerte de nuit</b>. L&apos;appartement est considéré vide du départ d&apos;un client à l&apos;arrivée du suivant.</p>
        <div className="rg-hours">
          <label>Alerte à partir de<span><input type="number" min={12} max={23} value={reg.heureDebut} onChange={e => setReg({ ...reg, heureDebut: Number(e.target.value) })} /> h</span></label>
          <label>jusqu&apos;à (le lendemain)<span><input type="number" min={0} max={12} value={reg.heureFin} onChange={e => setReg({ ...reg, heureFin: Number(e.target.value) })} /> h</span></label>
          <label>Arrivée des clients<span><input type="number" min={10} max={23} value={reg.heureArrivee} onChange={e => setReg({ ...reg, heureArrivee: Number(e.target.value) })} /> h</span></label>
          <label>Départ des clients<span><input type="number" min={6} max={14} value={reg.heureDepart} onChange={e => setReg({ ...reg, heureDepart: Number(e.target.value) })} /> h</span></label>
          <button className="primary" disabled={!changed || !!busy} onClick={async () => { const c = await save({ reglages: { ...config.reglages, ...reg } }, "reg"); if (c) { setReg({ ...DEFAULT_SETTINGS, ...c.reglages }); setSaved("Horaires enregistrés."); } }}>
            {busy === "reg" ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
        {saved && <div className="admin-ok">{saved}</div>}
      </section>

      <section className="rg-card">
        <h3>Types d&apos;action igloohome {liste.length > 0 && <span className={`rg-count${aValider ? " warn" : ""}`}>{aValider ? `${aValider} à valider` : "tout est validé"}</span>}</h3>
        <p className="rg-help">Pour chaque type lu dans l&apos;historique, choisissez ce qu&apos;il veut dire. <b>Un clic choisit et valide.</b> La proposition automatique est encadrée.</p>
        <div className="rg-legend">{Object.keys(NATURES).map(k => <span key={k}>{ICON[k]} <b>{COURT[k]}</b> : {AIDE[k]}</span>)}</div>
        {liste.length === 0 ? (
          <div className="sv-empty"><b>Aucun type lu pour l&apos;instant.</b><span>Lancez une lecture dans Surveillance : les types rencontrés apparaîtront ici.</span></div>
        ) : (
          <div className="rg-types">
            {liste.map(t => (
              <div key={t.type} className={`rg-type${t.valide ? "" : " todo"}`}>
                <div className="rg-type-name">
                  <b>{t.libelle}</b>
                  <span>{t.valide ? <span className="rg-ok">✓ validé</span> : <span className="rg-todo">à valider</span>} · <code>{t.type}</code> · {t.nombre} fois</span>
                  {t.exemple && t.exemple !== t.type && <span className="rg-ex">« {t.exemple} »</span>}
                </div>
                <div className="rg-choices" role="group" aria-label={`Interprétation de ${t.libelle}`}>
                  {Object.keys(NATURES).map(k => (
                    <button key={k} title={AIDE[k]} disabled={!!busy}
                      className={`${t.nature === k && t.valide ? "on" : ""}${!t.valide && t.proposition === k ? " propose" : ""}`}
                      onClick={() => choisir(t.type, k)}>{ICON[k]} {COURT[k]}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rg-card">
        <h3>Serrures</h3>
        <p className="rg-help">Quelle serrure ouvre quel appartement. Seules les lignes validées sont lues.</p>
        <Correspondance />
      </section>

      <section className="rg-card">
        <h3>Codes du personnel</h3>
        <p className="rg-help">Pour reconnaître le ménage, la maintenance ou le propriétaire dans les visites.</p>
        <Personnel />
      </section>
    </div>
  );
}
