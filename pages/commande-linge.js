// pages/commande-linge.js
// Onglet commande & suivi du linge (Belleville). Données persistées dans Firestore.
// 4 sous-sections : Stock réel, Commandes, Réceptions, Linge utilisé (saisie ménage).

import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { LINEN_ARTICLES, emptyQuantities, expectedReception, orderWindow, sumUsage, computeDefectSettlements, PANTIN_CODES, PANTIN_CLIENT, ELIS_INVOICE_ARTICLES } from "../lib/linen";
import FactureLinge from "../components/FactureLinge";
import { isFirebaseConfigured } from "../lib/firebaseApp";
import { loadLite, makePrefetch } from "../lib/firestoreLite";

// « Grande serviette (Drap bain) » -> « Grande serviette » (fiches sur téléphone).
const court = label => label.split(" (")[0];
function isoDay(d) { return d.toISOString().slice(0, 10); }
function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
const HOTEL_GMAIL = "residencelebelleville@gmail.com";
function euros(n) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// Saisie d'une quantité au pouce : − et + de 44 px autour du champ (visibles
// sur téléphone seulement, voir .qty-step dans globals.css).
function QtyInput({ value, onChange, label, className = "", style }) {
  const n = Number(value) || 0;
  return (
    <div className={"qty-step " + className} style={style}>
      <button type="button" className="qty-btn" tabIndex={-1} aria-label={`Moins ${label}`} onClick={() => onChange(String(Math.max(0, n - 1)))}>−</button>
      <input type="number" min="0" inputMode="numeric" value={value} aria-label={label}
        onFocus={e => e.target.select()} onChange={e => onChange(e.target.value)} />
      <button type="button" className="qty-btn" tabIndex={-1} aria-label={`Plus ${label}`} onClick={() => onChange(String(n + 1))}>+</button>
    </div>
  );
}

// Les 8 lectures du chargement, lancées EN PARALLÈLE (avant : l'une après
// l'autre, 8 allers-retours réseau à la suite).
const DEFAULT_PRICES = { drap: 1.804, grande_serviette: 1.157, housse: 3.788, petite_serviette: 0.545, taie: 0.558, tapis_bain: 0.759, torchon: 0.651 };
async function fetchLinenData(api) {
  const list = (col, field) => api.getDocs(api.query(api.collection(api.db, col), api.orderBy(field, "desc")))
    .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
  const one = (col, id) => api.getDoc(api.doc(api.db, col, id)).then(snap => (snap.exists() ? snap.data() : null));
  const [stock, thresholds, orders, receptions, usage, defects, invoices, prices] = await Promise.all([
    one("linen_stock", "belleville"),
    one("linen_thresholds", "belleville"),
    list("linen_orders", "date"),
    list("linen_receptions", "date"),
    list("linen_used", "date"),
    list("linen_defects", "date"),
    list("linen_invoices", "periodFrom"),
    one("linen_prices", "belleville"),
  ]);
  return { stock, thresholds, orders, receptions, usage, defects, invoices, prices };
}
const prefetch = makePrefetch(fetchLinenData);
if (isFirebaseConfigured()) prefetch.start();

function CommandeLinge() {
  const [tab, setTab] = useState("position");
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);

  // Données
  const [stock, setStock] = useState(emptyQuantities());
  const [orders, setOrders] = useState([]);
  const [receptions, setReceptions] = useState([]);
  const [usage, setUsage] = useState([]);
  const [defects, setDefects] = useState([]);
  const [thresholds, setThresholds] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [prices, setPrices] = useState({});
  const [status, setStatus] = useState("");

  // Firestore helpers chargés dynamiquement (évite le SSR sur firebase)
  const [fs, setFs] = useState(null);

  function apply(data) {
    setStock(data.stock ? { ...emptyQuantities(), ...data.stock } : emptyQuantities());
    setThresholds(data.thresholds || {});
    setOrders(data.orders);
    setReceptions(data.receptions);
    setUsage(data.usage);
    setDefects(data.defects);
    setInvoices(data.invoices);
    // Prix par défaut, extraits de la facture Elis (identiques pour les
    // variantes Cocoon/Horizon, donc un seul prix par catégorie suffit).
    setPrices(data.prices || DEFAULT_PRICES);
  }

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setConfigured(false);
      setReady(true);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const dataP = prefetch.take();
        const api = await loadLite();
        if (!alive) return;
        setFs(api);
        const data = await dataP;
        if (!alive) return;
        apply(data);
      } catch (err) {
        if (alive) setStatus("Erreur Firestore : " + err.message);
      }
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  async function loadAll(api) {
    try {
      setStatus("Chargement…");
      apply(await fetchLinenData(api));
      setStatus("");
    } catch (err) {
      setStatus("Erreur Firestore : " + err.message);
    }
  }

  if (!ready) {
    return (
      <div className="menage-page"><div className="recap"><div className="empty-state">Chargement…</div></div></div>
    );
  }

  if (!configured) {
    return (
      <>
        <Head><title>Commande linge</title></Head>
        <div className="menage-page"><div className="recap">
          <div className="recap-title">Configuration Firebase requise</div>
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
            Cet onglet stocke les données (stock, commandes, réceptions) dans Firebase.
            Ajoute les variables d&apos;environnement Firebase sur Vercel (voir README-FIREBASE),
            puis redéploie. Les autres onglets fonctionnent sans Firebase.
          </p>
        </div></div>
      </>
    );
  }

  return (
    <>
      <Head><title>Commande & suivi linge</title></Head>
      <div className="toolbar">
        <h1>Commande linge</h1>
        <div className="quick tabs">
          <button onClick={() => setTab("position")} className={tab === "position" ? "primary" : ""}>Position</button>
          <button onClick={() => setTab("stock")} className={tab === "stock" ? "primary" : ""}>Stock</button>
          <button onClick={() => setTab("commandes")} className={tab === "commandes" ? "primary" : ""}>Commandes</button>
          <button onClick={() => setTab("receptions")} className={tab === "receptions" ? "primary" : ""}>Réceptions</button>
          <button onClick={() => setTab("usage")} className={tab === "usage" ? "primary" : ""}>Linge utilisé</button>
          <button onClick={() => setTab("defects")} className={tab === "defects" ? "primary" : ""}>Défectueux</button>
          <button onClick={() => setTab("cout")} className={tab === "cout" ? "primary" : ""}>Coût linge</button>
        </div>
        <span className="status">{status}</span>
      </div>

      <div className="menage-page cl-page">
        <div className="recap">
          {tab === "position" && <PositionTab fs={fs} stock={stock} orders={orders} receptions={receptions} usage={usage} defects={defects} thresholds={thresholds} setThresholds={setThresholds} setStatus={setStatus} />}
          {tab === "stock" && <StockTab fs={fs} stock={stock} setStock={setStock} orders={orders} receptions={receptions} usage={usage} defects={defects} setStatus={setStatus} />}
          {tab === "commandes" && <OrdersTab fs={fs} orders={orders} usage={usage} receptions={receptions} reload={() => loadAll(fs)} setStatus={setStatus} />}
          {tab === "receptions" && <ReceptionsTab fs={fs} orders={orders} receptions={receptions} defects={defects} reload={() => loadAll(fs)} setStatus={setStatus} />}
          {tab === "usage" && <UsageTab fs={fs} usage={usage} reload={() => loadAll(fs)} setStatus={setStatus} />}
          {tab === "defects" && <DefectsTab fs={fs} defects={defects} reload={() => loadAll(fs)} setStatus={setStatus} />}
          {tab === "cout" && <CostTab fs={fs} invoices={invoices} receptions={receptions} prices={prices} setPrices={setPrices} reload={() => loadAll(fs)} setStatus={setStatus} />}
        </div>
      </div>
    </>
  );
}

// ---------- STOCK ----------
function StockTab({ fs, stock, setStock, orders, receptions, usage, defects, setStatus }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(stock);

  useEffect(() => { setDraft(stock); }, [stock]);

  // Stock réel théorique = stock saisi + total reçu - total utilisé - défectueux en cours
  const totalReceived = {}, totalUsed = {}, totalDefectOut = {};
  for (const a of LINEN_ARTICLES) { totalReceived[a.key] = 0; totalUsed[a.key] = 0; totalDefectOut[a.key] = 0; }
  for (const r of receptions) for (const a of LINEN_ARTICLES) totalReceived[a.key] += Number(r.quantities?.[a.key]) || 0;
  for (const u of usage) for (const a of LINEN_ARTICLES) totalUsed[a.key] += Number(u.quantities?.[a.key]) || 0;
  // Défectueux : retiré du stock tant qu'il n'est pas revenu. Pour un lot partiellement
  // rendu, on ne compte que ce qui reste dehors (remaining). Accumulé = quantité pleine.
  for (const d of defects) {
    if (d.status === "revenu") continue;
    for (const a of LINEN_ARTICLES) {
      const out = d.remaining ? (Number(d.remaining[a.key]) || 0) : (Number(d.quantities?.[a.key]) || 0);
      totalDefectOut[a.key] += out;
    }
  }

  async function save() {
    try {
      setStatus("Enregistrement…");
      const clean = {};
      for (const a of LINEN_ARTICLES) clean[a.key] = Number(draft[a.key]) || 0;
      await fs.setDoc(fs.doc(fs.db, "linen_stock", "belleville"), clean);
      setStock(clean);
      setEdit(false);
      setStatus("Stock enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Stock réel — Belleville</div>
          <div className="recap-sub">Stock de base saisi, ajusté par réceptions et linge utilisé</div>
        </div>
        {!edit
          ? <button className="primary" onClick={() => setEdit(true)}>Modifier le stock de base</button>
          : <button className="primary" onClick={save}>Enregistrer</button>}
      </div>

      <div className="tbl-wrap"><table className="tbl cl-cards">
        <thead>
          <tr>
            <th>Article</th>
            <th className="c">Stock de base</th>
            <th className="c">Reçu (total)</th>
            <th className="c">Utilisé (total)</th>
            <th className="c">Défectueux (en cours)</th>
            <th className="c">Stock estimé</th>
          </tr>
        </thead>
        <tbody>
          {LINEN_ARTICLES.map(a => {
            const base = Number((edit ? draft : stock)[a.key]) || 0;
            const est = base + totalReceived[a.key] - totalUsed[a.key] - totalDefectOut[a.key];
            const low = est <= 10;
            return (
              <tr key={a.key}>
                <td className="apt cl-head">{a.label}</td>
                <td className={"c" + (edit ? " cl-full" : "")} data-label="Stock de base">
                  {edit
                    ? <QtyInput value={draft[a.key] ?? 0} label={`Stock de base ${a.label}`} className="qty-tbl" onChange={v => setDraft({ ...draft, [a.key]: v })} />
                    : base}
                </td>
                <td className="c" data-label="Reçu (total)">{totalReceived[a.key]}</td>
                <td className="c" data-label="Utilisé (total)">{totalUsed[a.key]}</td>
                <td className="c" data-label="Défectueux" style={{ color: totalDefectOut[a.key] > 0 ? "var(--warn)" : "inherit" }}>{totalDefectOut[a.key] || "—"}</td>
                <td className="c cl-key" data-label="Stock estimé" style={{ fontWeight: 700, color: low ? "var(--bad)" : "inherit" }}>
                  {est}{low ? " ⚠" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p className="note">
        ⚠ = stock estimé bas (≤ 10). « Défectueux (en cours) » = linge propre arrivé sale, renvoyé et pas encore revenu : retiré du stock jusqu&apos;à son retour.
      </p>
    </>
  );
}

// ---------- COMMANDES ----------
function OrdersTab({ fs, orders, usage, receptions, reload, setStatus }) {
  const [date, setDate] = useState(isoDay(new Date()));
  const [q, setQ] = useState(emptyQuantities());
  const [calcInfo, setCalcInfo] = useState("");

  // Le type (mardi/jeudi) est déduit du jour réel de la date choisie, jamais
  // sélectionné à la main : un décalage date/type causait un mauvais calcul de
  // fenêtre (chevauchement avec une commande déjà passée, double comptage).
  const weekday = new Date(date + "T12:00:00").getDay(); // 0=dim..6=sam
  const type = weekday === 2 ? "mardi" : weekday === 4 ? "jeudi" : null;
  const dateValide = type !== null;

  // Calcule la commande = linge utilisé exactement sur la fenêtre correspondante.
  function calculerDepuisUsage() {
    if (!dateValide) { setCalcInfo(""); setStatus("La date doit être un mardi ou un jeudi."); return; }
    const win = orderWindow(date, type); // { from, toExclusive }
    // Entrées de linge utilisé dont la date est dans [from, toExclusive[
    const entries = usage.filter(u => {
      const d = (u.date || "").slice(0, 10);
      return d >= win.from && d < win.toExclusive;
    });
    const totals = sumUsage(entries);
    setQ(totals);
    setCalcInfo(
      `Calculé sur ${entries.length} saisie(s) de linge utilisé, du ${fmtFr(win.from)} au ${fmtFr(win.toExclusive)} (exclu).`
    );
  }

  async function addOrder() {
    if (!dateValide) { setStatus("La date doit être un mardi ou un jeudi."); return; }
    try {
      setStatus("Ajout commande…");
      const clean = {};
      for (const a of LINEN_ARTICLES) clean[a.key] = Number(q[a.key]) || 0;
      await fs.addDoc(fs.collection(fs.db, "linen_orders"), {
        date, type, quantities: clean,
        expectedReception: expectedReception(date),
        status: "commandee",
        createdAt: new Date().toISOString(),
      });
      setQ(emptyQuantities());
      await reload();
      setStatus("Commande ajoutée.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function del(id) {
    if (!confirm("Supprimer cette commande ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "linen_orders", id));
    await reload();
  }

  // Destinataires Elis du mail de bon de ramassage : stockés dans Firestore
  // (le dépôt est public, on n'y met pas les adresses).
  const [destinataires, setDestinataires] = useState([]);
  useEffect(() => {
    if (!fs) return;
    fs.getDoc(fs.doc(fs.db, "linen_settings", "belleville"))
      .then(snap => { if (snap.exists()) setDestinataires(snap.data().bonDestinataires || []); })
      .catch(() => {});
  }, [fs]);

  // Demande les adresses (synchrone, pour pouvoir ouvrir Gmail juste après sans
  // blocage de pop-up) et les enregistre en arrière-plan.
  function demanderDestinataires() {
    const v = prompt("Adresses e-mail des destinataires du bon de ramassage (séparées par des virgules) :", destinataires.join(", "));
    if (v === null) return null;
    const list = v.split(/[,;\s]+/).map(x => x.trim()).filter(x => x.includes("@"));
    setDestinataires(list);
    fs.setDoc(fs.doc(fs.db, "linen_settings", "belleville"), { bonDestinataires: list }, { merge: true })
      .catch(err => setStatus("Erreur enregistrement destinataires : " + err.message));
    return list;
  }

  // Ouvre un mail Gmail pré-rempli (boîte de l'hôtel) et télécharge l'Excel.
  // Un lien web ne peut pas joindre de fichier : il faut glisser l'Excel téléchargé dans le mail.
  async function preparerMail(order) {
    const to = destinataires.length ? destinataires : demanderDestinataires();
    if (!to || !to.length) return;
    // Pas de récap de la commande : seulement le linge manquant dans la ou les
    // réceptions faites le jour de l'envoi du bon (écart négatif).
    const manque = {};
    for (const r of receptions.filter(r => r.date === order.date)) {
      for (const a of LINEN_ARTICLES) {
        const ec = Number(r.ecart?.[a.key]) || 0;
        if (ec < 0) manque[a.key] = (manque[a.key] || 0) - ec;
      }
    }
    const lignes = LINEN_ARTICLES
      .filter(a => manque[a.key] > 0)
      .map(a => `- ${ELIS_INVOICE_ARTICLES.find(x => x.key === a.key)?.label || a.label} : ${manque[a.key]}`);
    const body = [
      "Bonjour,",
      "",
      `Vous trouverez ci-joint le bon de ramassage du ${order.type} ${fmtFr(order.date)}.`,
      "",
      ...(lignes.length ? ["Il manque dans la livraison reçue ce jour :", ...lignes, ""] : []),
      "Bien cordialement,",
      "Résidence Le Belleville",
    ].join("\n");
    const url = "https://mail.google.com/mail/?" + new URLSearchParams({
      authuser: HOTEL_GMAIL, view: "cm", fs: "1",
      to: to.join(","), su: `Bon de ramassage ${fmtFr(order.date)}`, body,
    }).toString();
    window.open(url, "_blank");
    const fichier = await exportExcel(order);
    if (fichier) setStatus(`Excel téléchargé (${fichier}) : glisse-le dans le mail Gmail ouvert, relis puis envoie.`);
  }

  // Génère le bon de ramassage via la route serveur (copie fidèle du template Pantin).
  async function exportExcel(order) {
    try {
      const res = await fetch("/api/bon-ramassage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: order.date,
          expectedReception: order.expectedReception,
          quantities: order.quantities,
        }),
      });
      if (!res.ok) { const e = await res.json(); alert("Erreur : " + e.error); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bon_de_ramassage_${order.type}_${order.date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      return a.download;
    } catch (err) { alert("Erreur : " + err.message); }
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Commandes</div>
          <div className="recap-sub">Mardi et jeudi · réception prévue une semaine plus tard</div>
        </div>
      </div>

      <div className="linen-form">
        <div className="linen-form-row">
          <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Type
            <div style={{ padding: "7px 9px", fontWeight: 600, color: dateValide ? "inherit" : "var(--bad)" }}>
              {dateValide ? (type === "mardi" ? "Mardi" : "Jeudi") : "⚠ Ni mardi ni jeudi"}
            </div>
          </label>
          <span className="pill info">Réception prévue : {fmtFr(expectedReception(date))}</span>
          <button onClick={calculerDepuisUsage} disabled={!dateValide}>
            Calculer depuis le linge utilisé
          </button>
        </div>
        {!dateValide && (
          <div className="msg bad">
            Les commandes ne se font que le mardi ou le jeudi. Choisis une date correspondant à l&apos;un de ces deux jours.
          </div>
        )}
        {calcInfo && <div className="msg ok">{calcInfo}</div>}
        {dateValide && orders.some(o => o.date === date && o.type === type) && (
          <div className="msg warn">
            ⚠ Une commande existe déjà pour ce {type === "mardi" ? "mardi" : "jeudi"} ({fmtFr(date)}) — vérifie la liste ci-dessous avant d&apos;en ajouter une nouvelle.
          </div>
        )}
        <div className="linen-qty-grid">
          {LINEN_ARTICLES.map(a => (
            <div key={a.key} className="qty-cell">
              <span>{a.label}</span>
              <QtyInput value={q[a.key]} label={a.label} onChange={v => setQ({ ...q, [a.key]: v })} />
            </div>
          ))}
        </div>
        <button className="primary" onClick={addOrder} disabled={!dateValide}>Ajouter la commande</button>
      </div>

      <div className="tbl-wrap"><table className="tbl cl-cards cl-hist" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>Date</th><th>Type</th>
            {LINEN_ARTICLES.map(a => <th key={a.key} className="c">{a.label}</th>)}
            <th>Réception prévue</th><th>Statut</th><th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id}>
              <td className="cl-head cl-date">{fmtFr(o.date)}</td>
              <td className="cl-head cl-type" style={{ textTransform: "capitalize" }}>{o.type}</td>
              {LINEN_ARTICLES.map(a => <td key={a.key} className="c cl-art" data-label={court(a.label)}>{o.quantities?.[a.key] || 0}</td>)}
              <td className="cl-full" data-label="Réception prévue">{fmtFr(o.expectedReception)}</td>
              <td className="cl-status">{(() => {
                const s = o.status;
                if (s === "recue") return <span className="pill ok">✓ Reçue</span>;
                if (s === "commandee" || !s) return <span className="pill warn">En attente</span>;
                return <span className="pill">{s}</span>;
              })()}</td>
              <td className="cl-actions">
                <div className="row-actions">
                  <button onClick={() => exportExcel(o)} className="ghost icon-btn" title="Télécharger l'Excel" aria-label="Télécharger l'Excel">📥</button>
                  <button onClick={() => preparerMail(o)} className="ghost icon-btn" title="Préparer le mail du bon de ramassage à Elis (Gmail) et télécharger l'Excel à joindre" aria-label="Préparer le mail du bon de ramassage">✉️</button>
                  {o.status === "recue" && (
                    <button onClick={async () => {
                      if (!confirm("Remettre cette commande en 'En attente livraison' ?")) return;
                      await fs.updateDoc(fs.doc(fs.db, "linen_orders", o.id), { status: "commandee" });
                      await reload();
                    }} className="ghost icon-btn" title="Remettre en attente de livraison" aria-label="Remettre en attente de livraison">↩</button>
                  )}
                  <button onClick={() => del(o.id)} className="ghost icon-btn danger" title="Supprimer" aria-label="Supprimer">✕</button>
                </div>
              </td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={LINEN_ARTICLES.length + 5} className="empty-state">Aucune commande.</td></tr>}
        </tbody>
      </table></div>
      <p className="note">
        ✉️ ouvre le mail du bon de ramassage dans Gmail et télécharge l&apos;Excel : glisse le fichier dans le mail, relis, puis envoie.
        {" "}Destinataires : {destinataires.length ? destinataires.join(", ") : "aucun"}
        {" "}<button onClick={demanderDestinataires} className="ghost">Modifier</button>
      </p>
    </>
  );
}

// ---------- RÉCEPTIONS ----------
function ReceptionsTab({ fs, orders, receptions, defects, reload, setStatus }) {
  const [orderId, setOrderId] = useState("");
  const [date, setDate] = useState(isoDay(new Date()));
  const [q, setQ] = useState(emptyQuantities());

  const pending = orders.filter(o => o.status !== "recue");

  // Défectueux renvoyés à Pantin et pas encore revenus = attendus en retour dans la livraison
  const defectEnAttente = {};
  for (const a of LINEN_ARTICLES) defectEnAttente[a.key] = 0;
  for (const d of (defects || [])) {
    if (d.status === "renvoye") {
      for (const a of LINEN_ARTICLES) {
        const rest = d.remaining ? (Number(d.remaining[a.key]) || 0) : (Number(d.quantities?.[a.key]) || 0);
        defectEnAttente[a.key] += rest;
      }
    }
  }
  const totalDefectAttendu = Object.values(defectEnAttente).reduce((s, n) => s + n, 0);

  const order = orders.find(x => x.id === orderId);
  const commande = {};
  for (const a of LINEN_ARTICLES) commande[a.key] = Number(order?.quantities?.[a.key]) || 0;

  // Pré-remplit avec le total attendu (commande + défectueux renvoyés) quand on choisit une commande
  useEffect(() => {
    if (order) {
      const attendu = {};
      for (const a of LINEN_ARTICLES) attendu[a.key] = (Number(order.quantities?.[a.key]) || 0) + defectEnAttente[a.key];
      setQ(attendu);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function addReception() {
    try {
      setStatus("Enregistrement réception…");
      const clean = {};
      for (const a of LINEN_ARTICLES) clean[a.key] = Number(q[a.key]) || 0;
      const ecart = {};
      for (const a of LINEN_ARTICLES) ecart[a.key] = clean[a.key] - (commande[a.key] + defectEnAttente[a.key]);
      await fs.addDoc(fs.collection(fs.db, "linen_receptions"), {
        date, orderId: orderId || null,
        orderDate: order?.date || null, orderType: order?.type || null,
        quantities: clean, commande: { ...commande }, defectAttendu: { ...defectEnAttente }, ecart,
        createdAt: new Date().toISOString(),
      });
      if (orderId) await fs.updateDoc(fs.doc(fs.db, "linen_orders", orderId), { status: "recue" });

      // Solde automatique des défectueux : l'excédent (reçu - commande) rembourse
      // les défectueux renvoyés les plus anciens, s'ils sont entièrement couverts.
      const settlements = computeDefectSettlements(clean, commande, defects || []);
      for (const s of settlements) {
        await fs.updateDoc(fs.doc(fs.db, "linen_defects", s.id), {
          ...s.fields, returnedDate: date,
        });
      }

      setQ(emptyQuantities()); setOrderId("");
      await reload();
      const n = settlements.length;
      setStatus(n
        ? `Réception enregistrée. ${n} lot(s) défectueux soldé(s) par l'excédent.`
        : "Réception enregistrée. Aucun excédent : les défectueux restent en attente.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function del(id) {
    if (!confirm("Supprimer cette réception ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "linen_receptions", id));
    await reload();
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Réceptions</div>
          <div className="recap-sub">Contrôle : attendu = commande + défectueux renvoyés. Un écart négatif révèle un défectueux non rendu.</div>
        </div>
      </div>

      <div className="linen-form">
        <div className="linen-form-row">
          <label>Commande liée
            <select value={orderId} onChange={e => setOrderId(e.target.value)}>
              <option value="">— (réception libre) —</option>
              {pending.map(o => (
                <option key={o.id} value={o.id}>
                  {fmtFr(o.date)} · {o.type} (réception prévue {fmtFr(o.expectedReception)})
                </option>
              ))}
            </select>
          </label>
          <label>Date réception <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          {totalDefectAttendu > 0 && (
            <span style={{ fontSize: 12, color: "var(--warn)" }}>
              {totalDefectAttendu} défectueux renvoyé(s) attendu(s) en retour
            </span>
          )}
        </div>

        <div className="tbl-wrap"><table className="tbl cl-cards cl-saisie" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th>Article</th>
              <th className="c">Commandé</th>
              <th className="c">Défect. attendu</th>
              <th className="c">Total attendu</th>
              <th className="c">Reçu</th>
              <th className="c">Écart</th>
            </tr>
          </thead>
          <tbody>
            {LINEN_ARTICLES.map(a => {
              const attendu = commande[a.key] + defectEnAttente[a.key];
              const recu = Number(q[a.key]) || 0;
              const ecart = recu - attendu;
              return (
                <tr key={a.key}>
                  <td className="apt cl-head">{a.label}</td>
                  <td className="c" data-label="Commandé">{commande[a.key]}</td>
                  <td className="c" data-label="Défect. attendu" style={{ color: defectEnAttente[a.key] > 0 ? "var(--warn)" : "inherit" }}>{defectEnAttente[a.key] || "—"}</td>
                  <td className="c" data-label="Total attendu" style={{ fontWeight: 600 }}>{attendu}</td>
                  <td className="c cl-recu" data-label="Reçu">
                    <QtyInput value={q[a.key]} label={`Reçu ${a.label}`} className="qty-tbl" onChange={v => setQ({ ...q, [a.key]: v })} />
                  </td>
                  <td className="c cl-ecart" data-label="Écart" style={{ fontWeight: 700, color: ecart < 0 ? "var(--bad)" : (ecart > 0 ? "var(--warn)" : "var(--ok)") }}>
                    {ecart === 0 ? "✓" : (ecart > 0 ? `+${ecart}` : ecart)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <button className="primary" onClick={addReception}>Enregistrer la réception</button>
        <p className="note">
          Écart <span style={{ color: "var(--bad)", fontWeight: 700 }}>négatif</span> = il manque du linge (défectueux non rendu ou commande incomplète).
          <span style={{ color: "var(--ok)", fontWeight: 700 }}> ✓</span> = commande + défectueux bien reçus. Marque ensuite dans Défectueux ceux réellement revenus.
        </p>
      </div>

      <div className="tbl-wrap"><table className="tbl cl-cards cl-hist" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>Reçu le</th><th>Commande</th>
            {LINEN_ARTICLES.map(a => <th key={a.key} className="c">{a.label}</th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {receptions.map(r => (
            <tr key={r.id}>
              <td className="cl-head cl-date">{fmtFr(r.date)}</td>
              <td className="cl-head cl-type" title="Commande">{r.orderDate ? `${fmtFr(r.orderDate)} ${r.orderType || ""}` : "libre"}</td>
              {LINEN_ARTICLES.map(a => {
                const val = r.quantities?.[a.key] || 0;
                const ec = r.ecart?.[a.key];
                const manque = ec != null && ec < 0;
                return (
                  <td key={a.key} className="c cl-art" data-label={court(a.label)} style={{ color: manque ? "var(--bad)" : "inherit", fontWeight: manque ? 700 : 400 }}>
                    {val}{manque ? ` (${ec})` : ""}
                  </td>
                );
              })}
              <td className="cl-actions"><button onClick={() => del(r.id)} className="ghost icon-btn danger" title="Supprimer" aria-label="Supprimer">✕</button></td>
            </tr>
          ))}
          {receptions.length === 0 && <tr><td colSpan={LINEN_ARTICLES.length + 3} className="empty-state">Aucune réception.</td></tr>}
        </tbody>
      </table></div>
      <p className="note">
        Un nombre rouge entre parenthèses = quantité manquante par rapport à la commande (non livrée).
      </p>
    </>
  );
}

// ---------- LINGE UTILISÉ ----------
function UsageTab({ fs, usage, reload, setStatus }) {
  const [date, setDate] = useState(isoDay(new Date()));
  const [q, setQ] = useState(emptyQuantities());

  async function addUsage() {
    try {
      setStatus("Enregistrement…");
      const clean = {};
      for (const a of LINEN_ARTICLES) clean[a.key] = Number(q[a.key]) || 0;
      await fs.addDoc(fs.collection(fs.db, "linen_used"), {
        date, quantities: clean, createdAt: new Date().toISOString(),
      });
      setQ(emptyQuantities());
      await reload();
      setStatus("Linge utilisé enregistré.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function del(id) {
    if (!confirm("Supprimer cette saisie ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "linen_used", id));
    await reload();
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Linge utilisé (rapporté par le ménage)</div>
          <div className="recap-sub">Saisir ce qui a été changé/utilisé, sert au calcul du stock et des commandes</div>
        </div>
      </div>

      <div className="linen-form">
        <div className="linen-form-row">
          <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        <div className="linen-qty-grid">
          {LINEN_ARTICLES.map(a => (
            <div key={a.key} className="qty-cell">
              <span>{a.label}</span>
              <QtyInput value={q[a.key]} label={a.label} onChange={v => setQ({ ...q, [a.key]: v })} />
            </div>
          ))}
        </div>
        <button className="primary" onClick={addUsage}>Enregistrer</button>
      </div>

      <div className="tbl-wrap"><table className="tbl cl-cards cl-hist" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>Date</th>
            {LINEN_ARTICLES.map(a => <th key={a.key} className="c">{a.label}</th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {usage.map(u => (
            <tr key={u.id}>
              <td className="cl-head cl-date">{fmtFr(u.date)}</td>
              {LINEN_ARTICLES.map(a => <td key={a.key} className="c cl-art" data-label={court(a.label)}>{u.quantities?.[a.key] || 0}</td>)}
              <td className="cl-actions"><button onClick={() => del(u.id)} className="ghost icon-btn danger" title="Supprimer" aria-label="Supprimer">✕</button></td>
            </tr>
          ))}
          {usage.length === 0 && <tr><td colSpan={LINEN_ARTICLES.length + 2} className="empty-state">Aucune saisie.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

// ---------- DÉFECTUEUX (propre arrivé sale) ----------
// Cycle : accumulé (mis de côté, déjà hors stock) -> renvoyé (parti à Pantin) -> revenu (réintégré).
// Le stock est déduit dès l'accumulation. On attend d'avoir assez pour un sac avant de renvoyer.
function DefectsTab({ fs, defects, reload, setStatus }) {
  const [date, setDate] = useState(isoDay(new Date()));
  const [q, setQ] = useState(emptyQuantities());
  const [note, setNote] = useState("");

  async function addDefect() {
    try {
      setStatus("Enregistrement…");
      const clean = {};
      for (const a of LINEN_ARTICLES) clean[a.key] = Number(q[a.key]) || 0;
      await fs.addDoc(fs.collection(fs.db, "linen_defects"), {
        date, quantities: clean, remaining: { ...clean }, note: note || "",
        status: "accumule", // accumule -> renvoye -> revenu
        sentDate: null, returnedDate: null,
        createdAt: new Date().toISOString(),
      });
      setQ(emptyQuantities()); setNote("");
      await reload();
      setStatus("Linge défectueux mis de côté.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function marquerRenvoye(id) {
    await fs.updateDoc(fs.doc(fs.db, "linen_defects", id), {
      status: "renvoye", sentDate: isoDay(new Date()),
    });
    await reload();
  }

  async function renvoyerTout() {
    const accus = defects.filter(d => d.status === "accumule");
    if (!accus.length) return;
    if (!confirm(`Marquer ${accus.length} lot(s) accumulé(s) comme renvoyés à Pantin ?`)) return;
    setStatus("Mise à jour…");
    for (const d of accus) {
      await fs.updateDoc(fs.doc(fs.db, "linen_defects", d.id), { status: "renvoye", sentDate: isoDay(new Date()) });
    }
    await reload();
    setStatus("Lots renvoyés.");
  }

  async function del(id) {
    if (!confirm("Supprimer cette ligne ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "linen_defects", id));
    await reload();
  }

  const accumule = defects.filter(d => d.status === "accumule");
  const renvoye = defects.filter(d => d.status === "renvoye");

  // Total accumulé par article (le "contenu du sac" en attente de renvoi)
  const totalAccu = {};
  for (const a of LINEN_ARTICLES) totalAccu[a.key] = 0;
  for (const d of accumule) for (const a of LINEN_ARTICLES) totalAccu[a.key] += Number(d.quantities?.[a.key]) || 0;
  const totalAccuSum = Object.values(totalAccu).reduce((s, n) => s + n, 0);

  function statutLabel(d) {
    if (d.status === "revenu") return <span className="pill ok">✓ Revenu {d.returnedDate ? fmtFr(d.returnedDate) : ""}</span>;
    if (d.status === "renvoye") return <span className="pill info">Renvoyé {d.sentDate ? fmtFr(d.sentDate) : ""}</span>;
    return <span className="pill warn">Accumulé</span>;
  }
  function rowBg(d) {
    if (d.status === "revenu") return "#f2fbf4";
    if (d.status === "renvoye") return "#eef5fb";
    return "#fff9f0";
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Linge défectueux</div>
          <div className="recap-sub">Mis de côté au fil de l&apos;eau (déjà retiré du stock) · renvoyé à Pantin quand le sac est plein · réintégré au retour</div>
        </div>
        <div className="recap-total">
          <div className="n">{totalAccuSum}</div>
          <div className="l">accumulé (dans le sac)</div>
        </div>
      </div>

      {/* Récap du sac en cours */}
      {totalAccuSum > 0 && (
        <div className="linen-form" style={{ background: "#fff9f0", borderColor: "#f0d9b8" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 13 }}>
              <strong>Sac en cours :</strong>{" "}
              {LINEN_ARTICLES.filter(a => totalAccu[a.key] > 0).map(a => `${a.label} ×${totalAccu[a.key]}`).join(" · ") || "vide"}
            </div>
            <button className="primary" onClick={renvoyerTout}>Tout renvoyer à Pantin</button>
          </div>
        </div>
      )}

      <div className="linen-form">
        <div className="linen-form-row">
          <label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label style={{ flex: 1 }}>Note (optionnel)
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="ex. taché, déchiré…" style={{ width: "100%" }} />
          </label>
        </div>
        <div className="linen-qty-grid">
          {LINEN_ARTICLES.map(a => (
            <div key={a.key} className="qty-cell">
              <span>{a.label}</span>
              <QtyInput value={q[a.key]} label={a.label} onChange={v => setQ({ ...q, [a.key]: v })} />
            </div>
          ))}
        </div>
        <button className="primary" onClick={addDefect}>Mettre de côté (accumuler)</button>
      </div>

      <div className="tbl-wrap"><table className="tbl cl-cards cl-hist" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>Date</th>
            {LINEN_ARTICLES.map(a => <th key={a.key} className="c">{a.label}</th>)}
            <th>Note</th><th>Statut</th><th></th>
          </tr>
        </thead>
        <tbody>
          {defects.map(d => (
            <tr key={d.id} style={{ background: rowBg(d) }}>
              <td className="cl-head cl-date">{fmtFr(d.date)}</td>
              {LINEN_ARTICLES.map(a => <td key={a.key} className="c cl-art" data-label={court(a.label)}>{d.quantities?.[a.key] || 0}</td>)}
              <td className="cl-full cl-note" data-label="Note">{d.note || "—"}</td>
              <td className="cl-status">{statutLabel(d)}</td>
              <td className="cl-actions"><div className="row-actions">
                {d.status === "accumule" &&
                  <button onClick={() => marquerRenvoye(d.id)}>Renvoyer</button>}
                {d.status === "renvoye" && (() => {
                  const rest = d.remaining ? Object.values(d.remaining).reduce((s, n) => s + (Number(n) || 0), 0) : null;
                  const init = Object.values(d.quantities || {}).reduce((s, n) => s + (Number(n) || 0), 0);
                  const partiel = rest != null && rest < init;
                  return <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    {partiel ? `reste ${rest} à récupérer` : "soldé auto par réception"}
                  </span>;
                })()}
                <button onClick={() => del(d.id)} className="ghost icon-btn danger" title="Supprimer" aria-label="Supprimer">✕</button>
              </div></td>
            </tr>
          ))}
          {defects.length === 0 && <tr><td colSpan={LINEN_ARTICLES.length + 4} className="empty-state">Aucun linge défectueux.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

// ---------- POSITION (compte courant cumulé) ----------
// Deux blocs distincts de manquant, tous deux déduits du stock réel :
//  1) Manquant commande = (commandé sur commandes reçues - reçu sur ces commandes),
//     que les réceptions de rattrapage (même "libres") viennent éponger. Se solde
//     donc automatiquement dès que le linge manquant est renvoyé, peu importe où
//     il est saisi.
//  2) Défectueux jamais rendu = restant des défectueux renvoyés non encore revenus.
// Stock réel = base + reçu - utilisé - manquant commande - défectueux dehors.
function PositionTab({ fs, stock, orders, receptions, usage, defects, thresholds, setThresholds, setStatus }) {
  const [editThr, setEditThr] = useState(false);
  const [draftThr, setDraftThr] = useState(thresholds);

  useEffect(() => { setDraftThr(thresholds); }, [thresholds]);

  const totOrdered = {}, totReceived = {}, totUsed = {}, defectOut = {}, manquantCmd = {};
  for (const a of LINEN_ARTICLES) {
    totOrdered[a.key] = 0; totReceived[a.key] = 0; totUsed[a.key] = 0; defectOut[a.key] = 0; manquantCmd[a.key] = 0;
  }
  for (const o of orders) for (const a of LINEN_ARTICLES) totOrdered[a.key] += Number(o.quantities?.[a.key]) || 0;
  for (const r of receptions) for (const a of LINEN_ARTICLES) totReceived[a.key] += Number(r.quantities?.[a.key]) || 0;
  for (const u of usage) for (const a of LINEN_ARTICLES) totUsed[a.key] += Number(u.quantities?.[a.key]) || 0;

  // Défectueux encore dehors (restant non revenu)
  for (const d of defects) {
    if (d.status === "revenu") continue;
    for (const a of LINEN_ARTICLES) {
      const out = d.remaining ? (Number(d.remaining[a.key]) || 0) : (Number(d.quantities?.[a.key]) || 0);
      defectOut[a.key] += out;
    }
  }

  // EN ATTENTE DE LIVRAISON — commandes passées mais pas encore reçues (statut
  // != "recue"). Ce n'est PAS un manquant : c'est du linge en route, normal.
  // Jamais déduit du stock réel, affiché dans sa propre colonne à titre indicatif.
  const enAttente = {};
  for (const a of LINEN_ARTICLES) enAttente[a.key] = 0;
  for (const o of orders) {
    if (o.status === "recue") continue;
    for (const a of LINEN_ARTICLES) enAttente[a.key] += Number(o.quantities?.[a.key]) || 0;
  }

  // Manquant commande — logique GLOBALE qui se solde automatiquement :
  // Sur les seules commandes déjà marquées "reçue" (donc dont la livraison est
  // censée être terminée), on cumule ce qui était commandé et ce qui a été reçu
  // AU TITRE de ces commandes. Puis le manquant = commandé - reçu affecté, MAIS
  // les réceptions de rattrapage (y compris "libres", non liées à une commande)
  // viennent éponger ce manquant. Résultat : dès que le rattrapage arrive, le
  // manquant retombe à zéro, quelle que soit la réception où il a été saisi.
  const cmdRecue = {}, recuSurCmd = {}, recuLibre = {};
  for (const a of LINEN_ARTICLES) { cmdRecue[a.key] = 0; recuSurCmd[a.key] = 0; recuLibre[a.key] = 0; }
  for (const r of receptions) {
    for (const a of LINEN_ARTICLES) {
      const recu = Number(r.quantities?.[a.key]) || 0;
      if (r.commande) {
        cmdRecue[a.key] += Number(r.commande[a.key]) || 0;
        recuSurCmd[a.key] += recu;
      } else {
        // Réception libre = rattrapage / livraison hors commande : sert à combler
        recuLibre[a.key] += recu;
      }
    }
  }
  for (const a of LINEN_ARTICLES) {
    const manqueBrut = Math.max(0, cmdRecue[a.key] - recuSurCmd[a.key]);
    // Le linge reçu en réception libre éponge le manquant en priorité
    manquantCmd[a.key] = Math.max(0, manqueBrut - recuLibre[a.key]);
  }

  async function saveThresholds() {
    try {
      setStatus("Enregistrement seuils…");
      const clean = {};
      for (const a of LINEN_ARTICLES) clean[a.key] = Number(draftThr[a.key]) || 0;
      await fs.setDoc(fs.doc(fs.db, "linen_thresholds", "belleville"), clean);
      setThresholds(clean);
      setEditThr(false);
      setStatus("Seuils enregistrés.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  const alerts = [];
  for (const a of LINEN_ARTICLES) {
    const base = Number(stock[a.key]) || 0;
    const estime = base + totReceived[a.key] - totUsed[a.key] - manquantCmd[a.key] - defectOut[a.key];
    const seuil = Number((editThr ? draftThr : thresholds)[a.key]) || 0;
    if (manquantCmd[a.key] > 0) alerts.push({ article: a.label, type: "cmd", val: manquantCmd[a.key] });
    if (defectOut[a.key] > 0) alerts.push({ article: a.label, type: "def", val: defectOut[a.key] });
    if (seuil > 0 && estime <= seuil) alerts.push({ article: a.label, type: "seuil", val: estime });
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Position cumulée — Belleville</div>
          <div className="recap-sub">Deux sources de manquant séparées, déduites du stock réel · roule en continu</div>
        </div>
        {!editThr
          ? <button onClick={() => setEditThr(true)}>Régler les seuils</button>
          : <button className="primary" onClick={saveThresholds}>Enregistrer seuils</button>}
      </div>

      {alerts.length > 0 && (
        <div className="alert-banner">
          <strong>⚠ {alerts.length} alerte(s) :</strong>{" "}
          {alerts.map((al, i) => (
            <span key={i} className="alert-chip">
              {al.article} — {al.type === "cmd" ? `${al.val} manquant commande` : al.type === "def" ? `${al.val} défectueux non rendu` : `stock bas (${al.val})`}
            </span>
          ))}
        </div>
      )}

      <div className="tbl-wrap"><table className="tbl cl-cards cl-pos">
        <thead>
          <tr>
            <th>Article</th>
            <th className="c">Commandé</th>
            <th className="c">Reçu</th>
            <th className="c">Utilisé</th>
            <th className="c" style={{ background: "#eef4fb" }}>En attente livraison</th>
            <th className="c" style={{ background: "#fdf3e6" }}>Manquant commande</th>
            <th className="c" style={{ background: "#fdf3e6" }}>Défectueux non rendu</th>
            <th className="c">Stock réel</th>
            <th className="c">Seuil</th>
          </tr>
        </thead>
        <tbody>
          {LINEN_ARTICLES.map(a => {
            const base = Number(stock[a.key]) || 0;
            const estime = base + totReceived[a.key] - totUsed[a.key] - manquantCmd[a.key] - defectOut[a.key];
            const seuil = Number((editThr ? draftThr : thresholds)[a.key]) || 0;
            const bas = seuil > 0 && estime <= seuil;
            const mc = manquantCmd[a.key], df = defectOut[a.key];
            const probleme = mc > 0 || df > 0 || bas;
            return (
              <tr key={a.key} style={{ background: probleme ? "#fdf0ef" : "transparent" }}>
                <td className="apt cl-head">{a.label}</td>
                <td className="c" data-label="Commandé">{totOrdered[a.key]}</td>
                <td className="c" data-label="Reçu">{totReceived[a.key]}</td>
                <td className="c" data-label="Utilisé">{totUsed[a.key]}</td>
                <td className="c" data-label="En attente livraison" style={{ fontWeight: enAttente[a.key] > 0 ? 600 : 400, color: enAttente[a.key] > 0 ? "var(--info)" : "var(--muted)", background: "#f5f9fd" }}>{enAttente[a.key] || "—"}</td>
                <td className="c" data-label="Manquant commande" style={{ fontWeight: mc > 0 ? 700 : 400, color: mc > 0 ? "var(--bad)" : "var(--muted)", background: "#fdf9f3" }}>{mc || "—"}</td>
                <td className="c" data-label="Défectueux non rendu" style={{ fontWeight: df > 0 ? 700 : 400, color: df > 0 ? "var(--warn)" : "var(--muted)", background: "#fdf9f3" }}>{df || "—"}</td>
                <td className="c cl-key" data-label="Stock réel" style={{ fontWeight: 700, color: bas ? "var(--bad)" : "inherit" }}>{estime}{bas ? " ⚠" : ""}</td>
                <td className={"c" + (editThr ? " cl-full" : "")} data-label="Seuil">
                  {editThr
                    ? <QtyInput value={draftThr[a.key] ?? 0} label={`Seuil ${a.label}`} className="qty-tbl" onChange={v => setDraftThr({ ...draftThr, [a.key]: v })} />
                    : (seuil || "—")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p className="note">
        <strong style={{ color: "var(--info)" }}>En attente livraison</strong> = commande passée, pas encore reçue (normal, en route) — <em>pas</em> déduit du stock.
        <strong style={{ color: "var(--bad)" }}> Manquant commande</strong> = commande <em>déjà reçue</em> mais dont il manquait des pièces jamais livrées (vraie anomalie).
        <strong style={{ color: "var(--warn)" }}> Défectueux non rendu</strong> = renvoyé à Pantin, pas encore revenu.
        Manquant et défectueux sont déduits du <strong>stock réel</strong>. Un manquant se solde automatiquement dès que le linge est renvoyé par Elis.
      </p>
    </>
  );
}

// ---------- COÛT LINGE ----------
// Parcours en 3 étapes : 1. estimation à partir des réceptions, 2. import de
// la facture Elis, 3. résultat (facturé en trop) et mail de réclamation.
// Les étapes 2 et 3 vivent dans components/FactureLinge.js.
function CostTab({ fs, invoices, receptions, prices, setPrices, reload, setStatus }) {
  // ---- Estimation automatique : Du/Au -> total anticipé à partir des
  // réceptions déjà enregistrées, sans ressaisie. C'est la réponse directe à
  // "combien vais-je être facturé par Elis sur cette période ?".
  const today = isoDay(new Date());
  // Prix unitaire affiché au millième (ex. 1,804 €) ; montants et totaux à 2 décimales.
  const prixUnit = n => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + " €");
  const [estFrom, setEstFrom] = useState(today);
  const [estTo, setEstTo] = useState(today);
  const [editPrices, setEditPrices] = useState(false);
  const [draftPrices, setDraftPrices] = useState(prices);
  useEffect(() => { setDraftPrices(prices); }, [prices]);

  const estReceived = {};
  for (const a of LINEN_ARTICLES) estReceived[a.key] = 0;
  let nbRecep = 0;
  for (const r of receptions) {
    const d = (r.date || "").slice(0, 10);
    if (d < estFrom || d > estTo) continue;
    nbRecep++;
    for (const a of LINEN_ARTICLES) estReceived[a.key] += Number(r.quantities?.[a.key]) || 0;
  }
  // Pendant la modification des prix, le total suit les prix en cours de saisie.
  const prixAffiches = editPrices ? draftPrices : prices;
  const estTotal = LINEN_ARTICLES.reduce((s, a) => s + estReceived[a.key] * (Number(prixAffiches[a.key]) || 0), 0);
  const nbPieces = LINEN_ARTICLES.reduce((s, a) => s + estReceived[a.key], 0);

  // Raccourcis de période (le Du/Au reste modifiable à la main).
  function choisirMois(decalage) {
    const d = new Date();
    const from = new Date(Date.UTC(d.getFullYear(), d.getMonth() + decalage, 1));
    const to = new Date(Date.UTC(d.getFullYear(), d.getMonth() + decalage + 1, 0));
    setEstFrom(isoDay(from));
    setEstTo(decalage === 0 ? today : isoDay(to));
  }

  async function savePrices() {
    try {
      setStatus("Enregistrement des prix…");
      const clean = {};
      for (const a of LINEN_ARTICLES) clean[a.key] = Number(draftPrices[a.key]) || 0;
      await fs.setDoc(fs.doc(fs.db, "linen_prices", "belleville"), clean);
      setPrices(clean);
      setEditPrices(false);
      setStatus("Prix enregistrés.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  return (
    <div className="facture-menage facture-linge">
      <div className="recap-head">
        <div>
          <div className="recap-title">Coût linge Elis</div>
          <div className="recap-sub">Combien vous allez payer, puis vérification de la facture Elis en 3 étapes.</div>
        </div>
      </div>

      <div className="fm-step">
        <div className="fm-step-title"><span className="fm-num">1</span>Estimation : combien je vais payer</div>
        <p className="fm-note">Calcul fait avec le linge reçu (onglet Réceptions). Choisissez les dates.</p>

        <div className="fl-periode">
          <div className="fl-raccourcis">
            <button type="button" className="fm-btn" onClick={() => choisirMois(0)}>Ce mois-ci</button>
            <button type="button" className="fm-btn" onClick={() => choisirMois(-1)}>Mois dernier</button>
          </div>
          <div className="linen-form-row">
            <label>Du <input type="date" value={estFrom} onChange={e => setEstFrom(e.target.value)} /></label>
            <label>Au <input type="date" value={estTo} onChange={e => setEstTo(e.target.value)} /></label>
          </div>
        </div>

        <div className="fm-res-grid">
          <div className="fm-net big bleu">
            <span className="fm-net-l">{editPrices ? "Total avec les nouveaux prix" : "Total estimé"}</span>
            <span className="fm-net-v">{euros(estTotal)} HT</span>
            <span className="fm-net-sub">soit {euros(estTotal * 1.2)} TTC</span>
            <span className="fm-net-sub">{nbPieces} pièce{nbPieces > 1 ? "s" : ""} reçue{nbPieces > 1 ? "s" : ""} en {nbRecep} réception{nbRecep > 1 ? "s" : ""}</span>
          </div>
          <div>
            <div className="tbl-wrap"><table className="tbl cl-cards cl-cout">
              <thead>
                <tr><th>Article</th><th className="c">Reçu</th><th className="c">Prix unitaire HT</th><th className="r">Montant HT</th></tr>
              </thead>
              <tbody>
                {LINEN_ARTICLES.map(a => {
                  const qte = estReceived[a.key] || 0;
                  const prix = prixAffiches[a.key] ?? 0;
                  const montant = qte * (Number(prix) || 0);
                  return (
                    <tr key={a.key}>
                      <td className="cl-head">{a.label}</td>
                      <td className="c" data-label="Reçu">{qte}</td>
                      <td className={"c" + (editPrices ? " cl-full" : "")} data-label="Prix unitaire HT">
                        {editPrices
                          ? <input type="number" min="0" step="0.001" inputMode="decimal" className="fl-input fl-input-prix"
                              value={draftPrices[a.key] ?? 0} aria-label={`Prix unitaire ${a.label}`}
                              onChange={e => setDraftPrices({ ...draftPrices, [a.key]: e.target.value })} />
                          : prixUnit(prix)}
                      </td>
                      <td className="r fl-gras" data-label="Montant HT">{euros(montant)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <div className="fm-actions">
              {editPrices ? (
                <>
                  <button type="button" className="fm-btn primary" onClick={savePrices}>Enregistrer les prix</button>
                  <button type="button" className="fm-btn fm-btn-light" onClick={() => { setDraftPrices(prices); setEditPrices(false); }}>Annuler</button>
                </>
              ) : (
                <button type="button" className="fm-btn" onClick={() => setEditPrices(true)}>Modifier les prix unitaires</button>
              )}
            </div>
          </div>
        </div>
        <p className="fm-note">
          C&apos;est une estimation, pas la facture officielle. La participation pour perte n&apos;est pas comptée.
          Cocoon et Horizon ont le même prix chez Elis : un seul prix par article suffit.
        </p>
      </div>

      <FactureLinge fs={fs} invoices={invoices} receptions={receptions} prices={prices} reload={reload} setStatus={setStatus} />
    </div>
  );
}

export default function CommandeLingePage() {
  return <CommandeLinge />;
}
