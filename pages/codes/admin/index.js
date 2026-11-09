// pages/codes/admin/index.js
// Espace admin (sous-onglet de « Codes d'accès »). Espace de développement et de
// test : il sert à construire et valider le croisement serrures igloohome ×
// réservations Hostaway avant toute mise en production.
// Protection CÔTÉ SERVEUR : getServerSideProps renvoie 404 à tout non-admin
// (voir lib/adminAuth.js) ; la page n'est jamais envoyée sans session admin.
// igloohome : LECTURE SEULE (liste des serrures, historique), voir lib/igloohome.js.
import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";
import CodesTabs from "../../../components/CodesTabs";
import Correspondance from "../../../components/admin/Correspondance";
import Personnel from "../../../components/admin/Personnel";
import Croisement from "../../../components/admin/Croisement";
import { adminPageProps } from "../../../lib/adminAuth";

export function getServerSideProps(ctx) {
  return adminPageProps(ctx);
}

const TZ = "Europe/Paris";

function heure(sec) {
  return new Date(sec * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

function dateHeure(ms) {
  if (ms === null || ms === undefined) return "—";
  return new Date(ms).toLocaleString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function toMs(v) {
  if (v === undefined || v === null || v === "") return null;
  const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

const TIME_KEYS = ["activityTimeAt", "activityTime", "timestamp", "time", "createdAt"];
function eventMs(e) {
  for (const k of TIME_KEYS) { const t = toMs(e?.[k]); if (t !== null) return t; }
  return null;
}

// Champ qui pourrait dater l'arrivée de l'événement dans le cloud (pour mesurer le délai).
function arrivalKey(events) {
  const keys = new Set(events.flatMap(e => Object.keys(e || {})));
  return [...keys].find(k => k !== "activityTimeAt" && /(created|upload|sync|receiv|insert|stored|logged)/i.test(k)
    && events.some(e => toMs(e[k]) !== null)) || null;
}

function cell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function duree(ms) {
  if (ms === null) return "";
  const s = Math.round(ms / 1000);
  if (Math.abs(s) < 120) return `${s} s`;
  const m = Math.round(s / 60);
  if (Math.abs(m) < 120) return `${m} min`;
  return `${(m / 60).toFixed(1)} h`;
}

function Erreur({ e }) {
  if (!e) return null;
  return (
    <div className="admin-err">
      <div><b>Erreur{e.etape ? ` (étape : ${e.etape})` : ""} :</b> {e.error || "inconnue"}</div>
      {e.detail != null && (
        <details><summary>Réponse brute d&apos;igloohome</summary><pre>{JSON.stringify(e.detail, null, 2)}</pre></details>
      )}
    </div>
  );
}

export default function EspaceAdmin({ adminExpiresAt }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [devices, setDevices] = useState(null);
  const [devErr, setDevErr] = useState(null);
  const [hist, setHist] = useState(null);
  const [histErr, setHistErr] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("croisement");

  async function logout() {
    setBusy("logout");
    try { await fetch("/api/admin/logout", { method: "POST" }); } catch { /* le cookie expire de toute façon */ }
    router.replace("/codes");
  }

  async function call(url) {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (r.status === 404) { router.replace("/codes"); throw { error: "Session admin expirée." }; }
    const d = await r.json().catch(() => ({ error: `Réponse illisible (HTTP ${r.status}).` }));
    if (!r.ok || d.ok === false) throw d;
    return d;
  }

  async function testConnexion() {
    setBusy("devices"); setDevErr(null); setDevices(null); setHist(null); setHistErr(null); setSelected(null);
    try { setDevices(await call("/api/admin/igloohome/devices")); }
    catch (e) { setDevErr(e); }
    finally { setBusy(""); }
  }

  const [diag, setDiag] = useState(null);
  async function diagnostic(s) {
    setBusy("diag:" + s.id); setSelected(s); setHist(null); setHistErr(null); setDiag(null);
    try { setDiag(await call(`/api/admin/igloohome/diagnostic?deviceId=${encodeURIComponent(s.id)}&idNumerique=${encodeURIComponent(s.idNumerique || "")}`)); }
    catch (e) { setHistErr(e); }
    finally { setBusy(""); }
  }

  async function voirHistorique(s) {
    setDiag(null);
    setBusy("hist:" + s.id); setSelected(s); setHist(null); setHistErr(null);
    try { setHist(await call(`/api/admin/igloohome/activity?deviceId=${encodeURIComponent(s.id)}&days=7`)); }
    catch (e) { setHistErr(e); }
    finally { setBusy(""); }
  }

  const events = hist ? [...hist.evenements].sort((a, b) => (eventMs(b) ?? 0) - (eventMs(a) ?? 0)) : [];
  const columns = [...new Set(events.flatMap(e => Object.keys(e || {})))];
  const arrival = arrivalKey(events);

  return (
    <>
      <Head><title>Espace admin</title></Head>
      <div className="toolbar codes-toolbar">
        <h1>Codes</h1>
      </div>
      <CodesTabs isAdmin current="/codes/admin" />
      <div className="menage-page codes-page admin-page">
        <div className="recap">
          <div className="admin-head">
            <div className="recap-title">Espace admin</div>
            <div className="admin-session">
              Session admin jusqu&apos;à {heure(adminExpiresAt)}
              <button className="ghost" onClick={logout} disabled={busy === "logout"}>Se déconnecter</button>
            </div>
          </div>
          <p className="admin-note">
            igloohome est interrogé en <b>lecture seule</b> : liste des serrures et historique,
            rien d&apos;autre (aucune ouverture, aucun PIN). Hostaway aussi.
          </p>

          <div className="admin-subtabs">
            {[["croisement", "Croisement"], ["correspondance", "Correspondance"], ["personnel", "Codes du personnel"], ["connexion", "Test de connexion"]].map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === "croisement" && <Croisement />}
          {tab === "correspondance" && <Correspondance />}
          {tab === "personnel" && <Personnel />}

          {tab === "connexion" && <>
          <div className="admin-block">
            <button className="primary" onClick={testConnexion} disabled={!!busy}>
              {busy === "devices" ? "Connexion…" : "Tester la connexion igloohome"}
            </button>
            <Erreur e={devErr} />
            {devices && (
              <>
                <div className="admin-ok">
                  Connexion réussie en {devices.dureeMs} ms · {devices.serrures.length} appareil(s) · droits accordés : <code>{devices.scopesAccordes}</code>
                </div>
                <div className="tbl-wrap"><table className="tbl admin-tbl">
                  <thead><tr><th>Nom</th><th>Identifiant</th><th>Type</th><th>Bridge</th><th></th></tr></thead>
                  <tbody>
                    {devices.serrures.map(s => (
                      <tr key={s.id || s.nom} className={selected?.id === s.id ? "sel" : ""}>
                        <td>{s.nom || "—"}</td>
                        <td><code>{s.id}</code></td>
                        <td>{s.type || "—"}</td>
                        <td>
                          {s.estUnBridge ? "C'est un bridge"
                            : s.indicesBridge.length ? s.indicesBridge.map(h => <div key={h.champ}><code>{h.champ}</code> = {cell(h.valeur)}</div>)
                            : "Non indiqué"}
                        </td>
                        <td>
                          {!s.estUnBridge && s.id && (<>
                            <button onClick={() => voirHistorique(s)} disabled={!!busy}>
                              {busy === "hist:" + s.id ? "Lecture…" : "Voir l'historique"}
                            </button>
                            {" "}
                            <button className="ghost" onClick={() => diagnostic(s)} disabled={!!busy}>
                              {busy === "diag:" + s.id ? "Diagnostic…" : "Diagnostic"}
                            </button>
                          </>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <details><summary>JSON brut de la liste des serrures ({devices.requete})</summary><pre>{JSON.stringify(devices.brut, null, 2)}</pre></details>
              </>
            )}
          </div>

          {selected && (
            <div className="admin-block">
              <div className="recap-title">Historique 7 jours : {selected.nom || selected.id}</div>
              <Erreur e={histErr} />
              {diag && (
                <div className="tbl-wrap"><table className="tbl admin-tbl">
                  <thead><tr><th>Variante</th><th>Résultat</th><th>Réponse</th></tr></thead>
                  <tbody>
                    {diag.essais.map(t => (
                      <tr key={t.variante}>
                        <td>{t.variante}</td>
                        <td>{t.ok ? <b>OK</b> : t.erreur}</td>
                        <td><pre>{JSON.stringify(t.extrait, null, 2)?.slice(0, 3000)}</pre></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
              {hist && (
                <>
                  <div className="admin-ok">
                    {events.length} événement(s) depuis le {dateHeure(Date.parse(hist.since))} · lu le {dateHeure(Date.parse(hist.lueLe))} ·
                    {" "}{hist.pagesLues} page(s), {hist.evenementsLus} événement(s) reçus au total
                    {hist.pageSuivanteRestante ? " · d'autres pages existent encore (limite de lecture atteinte)" : ""}
                    {arrival ? ` · délai mesuré avec le champ « ${arrival} »` : " · aucun champ ne date l'arrivée dans le cloud : délai non mesurable directement"}
                  </div>
                  {events.length > 0 ? (
                    <div className="tbl-wrap"><table className="tbl admin-tbl">
                      <thead><tr>
                        <th>Heure (Paris)</th>
                        {arrival && <th>Délai</th>}
                        {columns.map(c => <th key={c}>{c}</th>)}
                      </tr></thead>
                      <tbody>
                        {events.map((e, i) => {
                          const t = eventMs(e);
                          const a = arrival ? toMs(e[arrival]) : null;
                          return (
                            <tr key={i}>
                              <td style={{ whiteSpace: "nowrap" }}>{dateHeure(t)}</td>
                              {arrival && <td>{t !== null && a !== null ? duree(a - t) : ""}</td>}
                              {columns.map(c => <td key={c}>{cell(e[c])}</td>)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table></div>
                  ) : <div className="empty-state">Aucun événement sur 7 jours.</div>}
                  <details><summary>JSON brut ({hist.pagesLues} page(s))</summary><pre>{JSON.stringify(hist.brut, null, 2)}</pre></details>
                </>
              )}
            </div>
          )}
          </>}
        </div>
      </div>
    </>
  );
}
