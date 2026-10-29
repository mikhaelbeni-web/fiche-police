// components/IncendieAcces.js
// Code d'accès de l'onglet Sécurité incendie. Le code est choisi par le
// gérant à la première ouverture ; seule son empreinte (SHA-256) est stockée
// dans Firestore (incendie_config/acces). Une fois saisi, il est retenu pour
// la session du navigateur. Depuis l'écran du code, « Importer un document »
// permet d'importer un fichier sans ouvrir le suivi : le code est demandé,
// seul le formulaire d'import s'affiche, puis l'onglet se reverrouille.
// Barrière d'usage côté client : les règles
// Firestore étant ouvertes, ce n'est pas une protection forte des données.

import { useState, useEffect, useCallback } from "react";

const SESSION_KEY = "incendie_acces_ok";
const CONFIG = ["incendie_config", "acces"];

async function empreinte(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("incendie:" + code));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function lireSession() { try { return window.sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; } }
function ecrireSession(v) { try { v ? window.sessionStorage.setItem(SESSION_KEY, "1") : window.sessionStorage.removeItem(SESSION_KEY); } catch {} }

export default function IncendieAcces({ children }) {
  const [etat, setEtat] = useState("chargement"); // chargement | creation | verrou | ouvert | import | hors_firebase
  const [hash, setHash] = useState(null);
  const [fs, setFs] = useState(null);
  const [code, setCode] = useState("");
  const [code2, setCode2] = useState("");
  const [err, setErr] = useState("");
  const [changer, setChanger] = useState(false);
  const [fichiers, setFichiers] = useState(null); // import rapide depuis l'écran du code
  const [info, setInfo] = useState("");

  useEffect(() => {
    (async () => {
      const { isFirebaseConfigured, db } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setEtat("hors_firebase"); return; }
      const f = await import("firebase/firestore");
      setFs({ db, ...f });
      const snap = await f.getDoc(f.doc(db, ...CONFIG));
      if (!snap.exists() || !snap.data().hash) { setEtat("creation"); return; }
      setHash(snap.data().hash);
      setEtat(lireSession() ? "ouvert" : "verrou");
    })().catch(e => { setErr("Erreur : " + e.message); setEtat("verrou"); });
  }, []);

  async function creer() {
    if (code.length < 4) return setErr("Le code doit faire au moins 4 caractères.");
    if (code !== code2) return setErr("Les deux codes ne correspondent pas.");
    const h = await empreinte(code);
    await fs.setDoc(fs.doc(fs.db, ...CONFIG), { hash: h, majLe: new Date().toISOString() });
    setHash(h); ecrireSession(true); setCode(""); setCode2(""); setErr(""); setChanger(false); setEtat("ouvert");
  }

  async function verifier() {
    if ((await empreinte(code)) !== hash) { setErr("Code incorrect."); return; }
    setCode(""); setErr(""); setInfo("");
    if (fichiers) { setEtat("import"); return; } // sans retenir le code : l'onglet reste verrouillé après l'import
    ecrireSession(true); setEtat("ouvert");
  }

  const finImport = useCallback(msg => { setFichiers(null); setInfo(msg || ""); setEtat("verrou"); }, []);

  const verrouiller = useCallback(() => { ecrireSession(false); setEtat("verrou"); }, []);

  if (etat === "hors_firebase") return children({ verrouiller: null, changerCode: null });
  if (etat === "chargement") return <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>;

  if (etat === "import") return children({ verrouiller: null, changerCode: null, importRapide: fichiers, finImport });

  if (etat === "ouvert" && !changer) {
    return children({ verrouiller, changerCode: () => { setCode(""); setCode2(""); setErr(""); setChanger(true); } });
  }

  const creation = etat === "creation" || changer;
  return (
    <>
      <div className="toolbar">
        <h1>Sécurité incendie</h1>
        {!creation && (
          <label className="inc-import">
            Importer un document
            <input type="file" multiple accept="application/pdf,image/*" style={{ display: "none" }}
              onChange={e => { const f = e.target.files; if (f && f.length) { setFichiers(Array.from(f)); setInfo(""); setErr(""); } e.target.value = ""; }} />
          </label>
        )}
      </div>
      <div className="menage-page">
        <div className="recap" style={{ maxWidth: 420 }}>
          {info && <div style={{ fontSize: 13, color: "#1e7e34", marginBottom: 10 }}>{info}</div>}
          <div className="recap-title">{changer ? "Changer le code d'accès" : creation ? "Créer le code d'accès" : fichiers ? "Code requis pour importer" : "Code d'accès requis"}</div>
          {fichiers && !creation && (
            <div style={{ fontSize: 13, margin: "6px 0", wordBreak: "break-all" }}>
              {fichiers.length === 1 ? fichiers[0].name : `${fichiers.length} fichiers : ${fichiers.map(f => f.name).join(", ")}`}
              <button type="button" className="ghost" onClick={() => setFichiers(null)} style={{ marginLeft: 8 }}>Retirer</button>
            </div>
          )}
          <p style={{ color: "#666", fontSize: 13 }}>
            {creation ? "Choisis le code qui sera demandé pour ouvrir cet onglet."
              : fichiers ? "Saisis le code : seul le formulaire d'import s'ouvrira, puis l'onglet se reverrouillera."
              : "Saisis le code pour ouvrir le suivi de sécurité incendie, ou « Importer un document » en haut pour ajouter un fichier sans ouvrir le suivi."}
          </p>
          <form onSubmit={e => { e.preventDefault(); (creation ? creer : verifier)().catch(x => setErr(x.message)); }}>
            <input type="password" autoFocus value={code} onChange={e => setCode(e.target.value)} placeholder={creation ? "Nouveau code" : "Code"}
              style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 6, fontSize: 16, marginBottom: 10 }} />
            {creation && (
              <input type="password" value={code2} onChange={e => setCode2(e.target.value)} placeholder="Confirmer le code"
                style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 6, fontSize: 16, marginBottom: 10 }} />
            )}
            {err && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>{err}</div>}
            <button type="submit" style={{ background: "#1f3a5f", color: "#fff", border: "none", padding: "10px 18px", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
              {creation ? "Enregistrer le code" : fichiers ? "Importer" : "Ouvrir"}
            </button>
            {changer && <button type="button" onClick={() => { setChanger(false); setErr(""); }} className="ghost" style={{ marginLeft: 8 }}>Annuler</button>}
          </form>
        </div>
      </div>
    </>
  );
}
