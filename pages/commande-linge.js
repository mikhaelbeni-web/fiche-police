// pages/commande-linge.js
// Onglet commande & suivi du linge (Belleville). Données persistées dans Firestore.
// 4 sous-sections : Stock réel, Commandes, Réceptions, Linge utilisé (saisie ménage).

import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { LINEN_ARTICLES, emptyQuantities, expectedReception, orderWindow, sumUsage, computeDefectSettlements, PANTIN_CODES, PANTIN_CLIENT, ELIS_INVOICE_ARTICLES } from "../lib/linen";
import { isFirebaseConfigured } from "../lib/firebase";

function isoDay(d) {
  // Date locale (pas UTC) : evite le decalage "hier" observe entre minuit
  // et l'heure UTC en France (ete/hiver), car toISOString() est en UTC.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtFr(d) {
  if (!d) return "";
  const x = new Date(d + "T12:00:00");
  return isNaN(x) ? d : x.toLocaleDateString("fr-FR");
}
function euros(n) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

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

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setConfigured(false);
      setReady(true);
      return;
    }
    let alive = true;
    (async () => {
      const { db } = await import("../lib/firebase");
      const {
        collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy,
      } = await import("firebase/firestore");
      if (!alive) return;
      const api = { db, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy };
      setFs(api);
      await loadAll(api);
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, []);

  async function loadAll(api) {
    try {
      setStatus("Chargement…");
      // Stock : document unique "belleville"
      const stockSnap = await api.getDoc(api.doc(api.db, "linen_stock", "belleville"));
      if (stockSnap.exists()) setStock({ ...emptyQuantities(), ...stockSnap.data() });

      const thrSnap = await api.getDoc(api.doc(api.db, "linen_thresholds", "belleville"));
      if (thrSnap.exists()) setThresholds(thrSnap.data());

      const ordSnap = await api.getDocs(api.query(api.collection(api.db, "linen_orders"), api.orderBy("date", "desc")));
      setOrders(ordSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const recSnap = await api.getDocs(api.query(api.collection(api.db, "linen_receptions"), api.orderBy("date", "desc")));
      setReceptions(recSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const useSnap = await api.getDocs(api.query(api.collection(api.db, "linen_used"), api.orderBy("date", "desc")));
      setUsage(useSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const defSnap = await api.getDocs(api.query(api.collection(api.db, "linen_defects"), api.orderBy("date", "desc")));
      setDefects(defSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const invSnap = await api.getDocs(api.query(api.collection(api.db, "linen_invoices"), api.orderBy("periodFrom", "desc")));
      setInvoices(invSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const priceSnap = await api.getDoc(api.doc(api.db, "linen_prices", "belleville"));
      if (priceSnap.exists()) setPrices(priceSnap.data());
      else {
        // Prix par défaut, extraits de la facture Elis (identiques pour les
        // variantes Cocoon/Horizon, donc un seul prix par catégorie suffit).
        setPrices({ drap: 1.804, grande_serviette: 1.157, housse: 3.788, petite_serviette: 0.545, taie: 0.558, tapis_bain: 0.759, torchon: 0.651 });
      }
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
          <p style={{ color: "#666", fontSize: 14, lineHeight: 1.6 }}>
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
        <div className="quick">
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

      <div className="menage-page">
        <div className="recap">
          {tab === "position" && <PositionTab fs={fs} stock={stock} orders={orders} receptions={receptions} usage={usage} defects={defects} thresholds={thresholds} setThresholds={setThresholds} setStatus={setStatus} />}
          {tab === "stock" && <StockTab fs={fs} stock={stock} setStock={setStock} orders={orders} receptions={receptions} usage={usage} defects={defects} setStatus={setStatus} />}
          {tab === "commandes" && <OrdersTab fs={fs} orders={orders} usage={usage} reload={() => loadAll(fs)} setStatus={setStatus} />}
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

      <table className="tbl">
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
                <td className="apt">{a.label}</td>
                <td className="c">
                  {edit
                    ? <input type="number" value={draft[a.key] ?? 0} onChange={e => setDraft({ ...draft, [a.key]: e.target.value })} style={{ width: 70, textAlign: "center" }} />
                    : base}
                </td>
                <td className="c">{totalReceived[a.key]}</td>
                <td className="c">{totalUsed[a.key]}</td>
                <td className="c" style={{ color: totalDefectOut[a.key] > 0 ? "#e67e22" : "inherit" }}>{totalDefectOut[a.key] || "—"}</td>
                <td className="c" style={{ fontWeight: 700, color: low ? "#e74c3c" : "inherit" }}>
                  {est}{low ? " ⚠" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "#666", marginTop: 10 }}>
        ⚠ = stock estimé bas (≤ 10). « Défectueux (en cours) » = linge propre arrivé sale, renvoyé et pas encore revenu : retiré du stock jusqu&apos;à son retour.
      </p>
    </>
  );
}

// ---------- COMMANDES ----------
function OrdersTab({ fs, orders, usage, reload, setStatus }) {
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
            <div style={{ padding: "7px 9px", fontWeight: 600, color: dateValide ? "inherit" : "#e74c3c" }}>
              {dateValide ? (type === "mardi" ? "Mardi" : "Jeudi") : "⚠ Ni mardi ni jeudi"}
            </div>
          </label>
          <span style={{ fontSize: 12, color: "#666" }}>Réception prévue : {fmtFr(expectedReception(date))}</span>
          <button onClick={calculerDepuisUsage} disabled={!dateValide} style={{ background: dateValide ? "#2ecc71" : "#ccc", color: dateValide ? "#073" : "#666", fontWeight: 600 }}>
            Calculer depuis le linge utilisé
          </button>
        </div>
        {!dateValide && (
          <div style={{ fontSize: 12, color: "#e74c3c", marginBottom: 10 }}>
            Les commandes ne se font que le mardi ou le jeudi. Choisis une date correspondant à l&apos;un de ces deux jours.
          </div>
        )}
        {calcInfo && <div style={{ fontSize: 12, color: "#1f7a3f", marginBottom: 10 }}>{calcInfo}</div>}
        {dateValide && orders.some(o => o.date === date && o.type === type) && (
          <div style={{ fontSize: 12, color: "#e67e22", marginBottom: 10 }}>
            ⚠ Une commande existe déjà pour ce {type === "mardi" ? "mardi" : "jeudi"} ({fmtFr(date)}) — vérifie la liste ci-dessous avant d&apos;en ajouter une nouvelle.
          </div>
        )}
        <div className="linen-qty-grid">
          {LINEN_ARTICLES.map(a => (
            <label key={a.key} className="qty-cell">
              <span>{a.label}</span>
              <input type="number" min="0" value={q[a.key]} onChange={e => setQ({ ...q, [a.key]: e.target.value })} />
            </label>
          ))}
        </div>
        <button className="primary" onClick={addOrder} disabled={!dateValide}>Ajouter la commande</button>
      </div>

      <table className="tbl" style={{ marginTop: 18 }}>
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
              <td>{fmtFr(o.date)}</td>
              <td style={{ textTransform: "capitalize" }}>{o.type}</td>
              {LINEN_ARTICLES.map(a => <td key={a.key} className="c">{o.quantities?.[a.key] || 0}</td>)}
              <td>{fmtFr(o.expectedReception)}</td>
              <td>{(() => {
                const s = o.status;
                if (s === "recue") return <span style={{ color: "#1f7a3f" }}>✓ Reçue</span>;
                if (s === "commandee" || !s) return <span style={{ color: "#e67e22" }}>En attente</span>;
                return <span style={{ color: "#999" }}>{s}</span>;
              })()}</td>
              <td>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button onClick={() => exportExcel(o)} className="ghost" style={{ color: "#1f7a3f", padding: "4px 6px", fontSize: 12 }}>📥</button>
                  {o.status === "recue" && (
                    <button onClick={async () => {
                      if (!confirm("Remettre cette commande en 'En attente livraison' ?")) return;
                      await fs.updateDoc(fs.doc(fs.db, "linen_orders", o.id), { status: "commandee" });
                      await reload();
                    }} className="ghost" style={{ color: "#e67e22", padding: "4px 6px", fontSize: 12 }}>↩</button>
                  )}
                  <button onClick={() => del(o.id)} className="ghost" style={{ color: "#e74c3c", padding: "4px 6px", fontSize: 12 }}>✕</button>
                </div>
              </td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={LINEN_ARTICLES.length + 5} className="empty-state">Aucune commande.</td></tr>}
        </tbody>
      </table>
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
            <span style={{ fontSize: 12, color: "#e67e22" }}>
              {totalDefectAttendu} défectueux renvoyé(s) attendu(s) en retour
            </span>
          )}
        </div>

        <table className="tbl" style={{ marginBottom: 12 }}>
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
                  <td className="apt">{a.label}</td>
                  <td className="c">{commande[a.key]}</td>
                  <td className="c" style={{ color: defectEnAttente[a.key] > 0 ? "#e67e22" : "inherit" }}>{defectEnAttente[a.key] || "—"}</td>
                  <td className="c" style={{ fontWeight: 600 }}>{attendu}</td>
                  <td className="c">
                    <input type="number" min="0" value={q[a.key]} onChange={e => setQ({ ...q, [a.key]: e.target.value })} style={{ width: 64, textAlign: "center" }} />
                  </td>
                  <td className="c" style={{ fontWeight: 700, color: ecart < 0 ? "#e74c3c" : (ecart > 0 ? "#e67e22" : "#1f7a3f") }}>
                    {ecart === 0 ? "✓" : (ecart > 0 ? `+${ecart}` : ecart)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="primary" onClick={addReception}>Enregistrer la réception</button>
        <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
          Écart <span style={{ color: "#e74c3c", fontWeight: 700 }}>négatif</span> = il manque du linge (défectueux non rendu ou commande incomplète).
          <span style={{ color: "#1f7a3f", fontWeight: 700 }}> ✓</span> = commande + défectueux bien reçus. Marque ensuite dans Défectueux ceux réellement revenus.
        </p>
      </div>

      <table className="tbl" style={{ marginTop: 18 }}>
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
              <td>{fmtFr(r.date)}</td>
              <td>{r.orderDate ? `${fmtFr(r.orderDate)} ${r.orderType || ""}` : "libre"}</td>
              {LINEN_ARTICLES.map(a => {
                const val = r.quantities?.[a.key] || 0;
                const ec = r.ecart?.[a.key];
                const manque = ec != null && ec < 0;
                return (
                  <td key={a.key} className="c" style={{ color: manque ? "#e74c3c" : "inherit", fontWeight: manque ? 700 : 400 }}>
                    {val}{manque ? ` (${ec})` : ""}
                  </td>
                );
              })}
              <td><button onClick={() => del(r.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button></td>
            </tr>
          ))}
          {receptions.length === 0 && <tr><td colSpan={LINEN_ARTICLES.length + 3} className="empty-state">Aucune réception.</td></tr>}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "#666", marginTop: 10 }}>
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
            <label key={a.key} className="qty-cell">
              <span>{a.label}</span>
              <input type="number" min="0" value={q[a.key]} onChange={e => setQ({ ...q, [a.key]: e.target.value })} />
            </label>
          ))}
        </div>
        <button className="primary" onClick={addUsage}>Enregistrer</button>
      </div>

      <table className="tbl" style={{ marginTop: 18 }}>
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
              <td>{fmtFr(u.date)}</td>
              {LINEN_ARTICLES.map(a => <td key={a.key} className="c">{u.quantities?.[a.key] || 0}</td>)}
              <td><button onClick={() => del(u.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button></td>
            </tr>
          ))}
          {usage.length === 0 && <tr><td colSpan={LINEN_ARTICLES.length + 2} className="empty-state">Aucune saisie.</td></tr>}
        </tbody>
      </table>
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
    if (d.status === "revenu") return <span style={{ color: "#1f7a3f" }}>✓ Revenu {d.returnedDate ? fmtFr(d.returnedDate) : ""}</span>;
    if (d.status === "renvoye") return <span style={{ color: "#2980b9" }}>Renvoyé {d.sentDate ? fmtFr(d.sentDate) : ""}</span>;
    return <span style={{ color: "#e67e22" }}>Accumulé</span>;
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
            <label key={a.key} className="qty-cell">
              <span>{a.label}</span>
              <input type="number" min="0" value={q[a.key]} onChange={e => setQ({ ...q, [a.key]: e.target.value })} />
            </label>
          ))}
        </div>
        <button className="primary" onClick={addDefect}>Mettre de côté (accumuler)</button>
      </div>

      <table className="tbl" style={{ marginTop: 18 }}>
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
              <td>{fmtFr(d.date)}</td>
              {LINEN_ARTICLES.map(a => <td key={a.key} className="c">{d.quantities?.[a.key] || 0}</td>)}
              <td>{d.note || "—"}</td>
              <td>{statutLabel(d)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {d.status === "accumule" &&
                  <button onClick={() => marquerRenvoye(d.id)} className="ghost" style={{ color: "#2980b9" }}>Renvoyer</button>}
                {d.status === "renvoye" && (() => {
                  const rest = d.remaining ? Object.values(d.remaining).reduce((s, n) => s + (Number(n) || 0), 0) : null;
                  const init = Object.values(d.quantities || {}).reduce((s, n) => s + (Number(n) || 0), 0);
                  const partiel = rest != null && rest < init;
                  return <span style={{ fontSize: 11, color: "#999" }}>
                    {partiel ? `reste ${rest} à récupérer` : "soldé auto par réception"}
                  </span>;
                })()}
                <button onClick={() => del(d.id)} className="ghost" style={{ color: "#e74c3c" }}>✕</button>
              </td>
            </tr>
          ))}
          {defects.length === 0 && <tr><td colSpan={LINEN_ARTICLES.length + 4} className="empty-state">Aucun linge défectueux.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// ---------- POSITION (compte courant cumulé) ----------
// Deux blocs distincts de manquant, tous deux déduits du stock réel :
//  1) Manquant commande = somme, par commande, de (commandé - reçu affecté) non livré.
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

  // Manquant commande : par commande marquée "recue", ce qui n'a pas été livré.
  // Pour chaque commande reçue, on prend l'écart négatif enregistré sur sa réception liée.
  // Une commande sans écart négatif ne contribue pas.
  for (const r of receptions) {
    if (!r.commande) continue; // réceptions liées à une commande seulement
    for (const a of LINEN_ARTICLES) {
      const cmd = Number(r.commande[a.key]) || 0;
      const recu = Number(r.quantities?.[a.key]) || 0;
      const defAtt = Number(r.defectAttendu?.[a.key]) || 0;
      // Manquant sur la partie COMMANDE uniquement : ce qui manque au-delà de ce que
      // les défectueux attendus expliquent. reçu couvre d'abord la commande.
      const manqueCommande = Math.max(0, cmd - recu);
      manquantCmd[a.key] += manqueCommande;
    }
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

      <table className="tbl">
        <thead>
          <tr>
            <th>Article</th>
            <th className="c">Commandé</th>
            <th className="c">Reçu</th>
            <th className="c">Utilisé</th>
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
                <td className="apt">{a.label}</td>
                <td className="c">{totOrdered[a.key]}</td>
                <td className="c">{totReceived[a.key]}</td>
                <td className="c">{totUsed[a.key]}</td>
                <td className="c" style={{ fontWeight: mc > 0 ? 700 : 400, color: mc > 0 ? "#e74c3c" : "#999", background: "#fdf9f3" }}>{mc || "—"}</td>
                <td className="c" style={{ fontWeight: df > 0 ? 700 : 400, color: df > 0 ? "#e67e22" : "#999", background: "#fdf9f3" }}>{df || "—"}</td>
                <td className="c" style={{ fontWeight: 700, color: bas ? "#e74c3c" : "inherit" }}>{estime}{bas ? " ⚠" : ""}</td>
                <td className="c">
                  {editThr
                    ? <input type="number" min="0" value={draftThr[a.key] ?? 0} onChange={e => setDraftThr({ ...draftThr, [a.key]: e.target.value })} style={{ width: 60, textAlign: "center" }} />
                    : (seuil || "—")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "#666", marginTop: 10 }}>
        <strong style={{ color: "#e74c3c" }}>Manquant commande</strong> = commandé mais jamais livré.
        <strong style={{ color: "#e67e22" }}> Défectueux non rendu</strong> = renvoyé à Pantin, pas encore revenu.
        Les deux sont déduits du <strong>stock réel</strong>. Le tableau roule en continu et ne se remet jamais à zéro.
      </p>
    </>
  );
}

// ---------- COÛT LINGE (pointage des factures Elis) ----------
// Reproduit exactement la structure de la facture Elis (9 lignes réelles, dont
// deux variantes Cocoon/Horizon pour draps de bain et serviettes éponge) et
// rapproche automatiquement les quantités facturées avec ce qui a été
// réceptionné dans l'app sur la même période, pour pointer les écarts.
function emptyInvoiceLines() {
  const l = {};
  for (const a of ELIS_INVOICE_ARTICLES) l[a.id] = { qte: 0, prixUnitaire: 0 };
  return l;
}

function CostTab({ fs, invoices, receptions, prices, setPrices, reload, setStatus }) {
  const [showForm, setShowForm] = useState(false);
  const [numFacture, setNumFacture] = useState("");
  const [dateFacture, setDateFacture] = useState(isoDay(new Date()));
  const [periodFrom, setPeriodFrom] = useState(isoDay(new Date()));
  const [periodTo, setPeriodTo] = useState(isoDay(new Date()));
  const [lines, setLines] = useState(emptyInvoiceLines());
  const [participationPerte, setParticipationPerte] = useState(0);

  // ---- Estimation automatique : Du/Au -> total anticipé à partir des
  // réceptions déjà enregistrées, sans ressaisie. C'est la réponse directe à
  // "combien vais-je être facturé par Elis sur cette période ?".
  const today = isoDay(new Date());
  const [estFrom, setEstFrom] = useState(today);
  const [estTo, setEstTo] = useState(today);
  const [editPrices, setEditPrices] = useState(false);
  const [draftPrices, setDraftPrices] = useState(prices);
  useEffect(() => { setDraftPrices(prices); }, [prices]);

  const estReceived = {};
  for (const a of LINEN_ARTICLES) estReceived[a.key] = 0;
  for (const r of receptions) {
    const d = (r.date || "").slice(0, 10);
    if (d < estFrom || d > estTo) continue;
    for (const a of LINEN_ARTICLES) estReceived[a.key] += Number(r.quantities?.[a.key]) || 0;
  }
  const estTotal = LINEN_ARTICLES.reduce((s, a) => s + estReceived[a.key] * (Number(prices[a.key]) || 0), 0);

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

  function setLine(id, field, value) {
    setLines(l => ({ ...l, [id]: { ...l[id], [field]: value } }));
  }

  // Référence en direct : total déjà reçu (app) par catégorie sur la période
  // choisie, pour aider à saisir des quantités réalistes avant l'arrivée de
  // la vraie facture. Les gammes Cocoon/Horizon partagent la même référence
  // (l'app ne distingue pas la gamme reçue), affichée sur chacune des 2 lignes.
  const receivedRef = {};
  for (const a of LINEN_ARTICLES) receivedRef[a.key] = 0;
  for (const r of receptions) {
    const d = (r.date || "").slice(0, 10);
    if (d < periodFrom || d > periodTo) continue;
    for (const a of LINEN_ARTICLES) receivedRef[a.key] += Number(r.quantities?.[a.key]) || 0;
  }

  const sousTotalHT = ELIS_INVOICE_ARTICLES.reduce((s, a) => {
    const l = lines[a.id];
    return s + (Number(l.qte) || 0) * (Number(l.prixUnitaire) || 0);
  }, 0);
  const totalHT = sousTotalHT + (Number(participationPerte) || 0);
  const tva = totalHT * 0.20;
  const netAPayer = totalHT + tva;

  async function saveInvoice() {
    if (!numFacture.trim()) { setStatus("Le numéro de facture est requis."); return; }
    try {
      setStatus("Enregistrement…");
      const cleanLines = {};
      for (const a of ELIS_INVOICE_ARTICLES) {
        cleanLines[a.id] = { qte: Number(lines[a.id].qte) || 0, prixUnitaire: Number(lines[a.id].prixUnitaire) || 0 };
      }
      await fs.addDoc(fs.collection(fs.db, "linen_invoices"), {
        numFacture: numFacture.trim(), dateFacture, periodFrom, periodTo,
        lines: cleanLines, sousTotalHT, participationPerte: Number(participationPerte) || 0,
        totalHT, tva, netAPayer, createdAt: new Date().toISOString(),
      });
      setNumFacture(""); setLines(emptyInvoiceLines()); setParticipationPerte(0);
      setShowForm(false);
      await reload();
      setStatus("Facture enregistrée.");
    } catch (err) { setStatus("Erreur : " + err.message); }
  }

  async function delInvoice(id) {
    if (!confirm("Êtes-vous sûr de vouloir supprimer cette facture ?")) return;
    await fs.deleteDoc(fs.doc(fs.db, "linen_invoices", id));
    await reload();
  }

  return (
    <>
      <div className="recap-head">
        <div>
          <div className="recap-title">Coût linge anticipé</div>
          <div className="recap-sub">Calculé automatiquement à partir des réceptions déjà enregistrées — aucune ressaisie</div>
        </div>
        <button onClick={() => setEditPrices(!editPrices)} style={{ fontSize: 12 }}>{editPrices ? "Annuler" : "Modifier les prix unitaires"}</button>
      </div>

      <div className="linen-form" style={{ background: "#eef7ee", borderColor: "#bfe3bf" }}>
        <div className="linen-form-row">
          <label>Du <input type="date" value={estFrom} onChange={e => setEstFrom(e.target.value)} /></label>
          <label>Au <input type="date" value={estTo} onChange={e => setEstTo(e.target.value)} /></label>
        </div>

        <table className="tbl" style={{ marginBottom: 10 }}>
          <thead>
            <tr><th>Article</th><th className="c">Reçu (app)</th><th className="c">Prix unit. HT</th><th className="c">Montant estimé</th></tr>
          </thead>
          <tbody>
            {LINEN_ARTICLES.map(a => {
              const qte = estReceived[a.key] || 0;
              const prix = editPrices ? (draftPrices[a.key] ?? 0) : (prices[a.key] ?? 0);
              const montant = qte * (Number(prix) || 0);
              return (
                <tr key={a.key}>
                  <td>{a.label}</td>
                  <td className="c">{qte}</td>
                  <td className="c">
                    {editPrices
                      ? <input type="number" min="0" step="0.001" value={draftPrices[a.key] ?? 0}
                          onChange={e => setDraftPrices({ ...draftPrices, [a.key]: e.target.value })}
                          style={{ width: 80, textAlign: "center" }} />
                      : `${euros(prix)}`}
                  </td>
                  <td className="c" style={{ fontWeight: 600 }}>{euros(montant)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {editPrices
          ? <button className="primary" onClick={savePrices}>Enregistrer les prix</button>
          : (
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1f7a3f" }}>
              Total HT estimé sur la période : {euros(estTotal)}
            </div>
          )}
        <p style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
          Cocoon et Horizon partagent le même prix unitaire chez Elis — un seul prix par catégorie suffit pour cette estimation.
          Ce montant est une anticipation, pas la facture officielle (hors TVA et participation perte éventuelle).
        </p>
      </div>

      <div className="recap-head" style={{ marginTop: 28 }}>
        <div>
          <div className="recap-title" style={{ fontSize: 16 }}>Factures Elis reçues</div>
          <div className="recap-sub">Pour comparer le montant estimé ci-dessus à la vraie facture, une fois reçue</div>
        </div>
        <button className="primary" onClick={() => setShowForm(!showForm)}>{showForm ? "Annuler" : "+ Nouvelle facture"}</button>
      </div>

      {showForm && (
        <div className="linen-form">
          <div className="linen-form-row">
            <label>N° facture <input type="text" value={numFacture} onChange={e => setNumFacture(e.target.value)} placeholder="ex. 2600104-997498" style={{ width: 180 }} /></label>
            <label>Date facture <input type="date" value={dateFacture} onChange={e => setDateFacture(e.target.value)} /></label>
          </div>
          <div className="linen-form-row">
            <label>Période du <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} /></label>
            <label>au <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} /></label>
            <button type="button" onClick={() => {
              // Pré-remplit chaque ligne avec le reçu (app) de sa catégorie ; pour les
              // paires Cocoon/Horizon, met tout sur la première ligne — à répartir
              // manuellement selon ce qui a réellement été livré dans chaque gamme.
              const seen = new Set();
              setLines(l => {
                const next = { ...l };
                for (const a of ELIS_INVOICE_ARTICLES) {
                  if (seen.has(a.key)) { next[a.id] = { ...next[a.id], qte: 0 }; continue; }
                  seen.add(a.key);
                  next[a.id] = { ...next[a.id], qte: receivedRef[a.key] || 0 };
                }
                return next;
              });
            }} style={{ fontSize: 12 }}>Pré-remplir depuis les réceptions</button>
          </div>

          <table className="tbl" style={{ marginBottom: 12 }}>
            <thead>
              <tr><th>Article (Elis)</th><th className="c">Reçu (app, réf.)</th><th className="c">Qté livrée</th><th className="c">Prix unit. HT</th><th className="c">Montant HT</th></tr>
            </thead>
            <tbody>
              {ELIS_INVOICE_ARTICLES.map(a => {
                const l = lines[a.id];
                const montant = (Number(l.qte) || 0) * (Number(l.prixUnitaire) || 0);
                return (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td className="c" style={{ color: "#999" }}>{receivedRef[a.key] || 0}</td>
                    <td className="c"><input type="number" min="0" value={l.qte} onChange={e => setLine(a.id, "qte", e.target.value)} style={{ width: 70, textAlign: "center" }} /></td>
                    <td className="c"><input type="number" min="0" step="0.001" value={l.prixUnitaire} onChange={e => setLine(a.id, "prixUnitaire", e.target.value)} style={{ width: 80, textAlign: "center" }} /></td>
                    <td className="c">{euros(montant)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: "#666", marginTop: -6, marginBottom: 12 }}>
            « Reçu (app, réf.) » = total déjà enregistré dans Réceptions sur la période choisie, pour t&apos;aider à estimer avant l&apos;arrivée de la vraie facture. Les lignes Cocoon/Horizon partagent la même référence (l&apos;app ne distingue pas la gamme reçue).
          </p>

          <div className="linen-form-row">
            <label>Participation pour perte € <input type="number" min="0" step="0.01" value={participationPerte} onChange={e => setParticipationPerte(e.target.value)} style={{ width: 100 }} /></label>
          </div>
          <p style={{ fontSize: 13, marginBottom: 12 }}>
            Sous-total HT : <strong>{euros(sousTotalHT)}</strong> · + Participation perte : <strong>{euros(participationPerte)}</strong> ·
            Total HT : <strong>{euros(totalHT)}</strong> · TVA (20%) : <strong>{euros(tva)}</strong> · <strong style={{ color: "#1f7a3f" }}>Net à payer : {euros(netAPayer)}</strong>
          </p>
          <button className="primary" onClick={saveInvoice}>Enregistrer la facture</button>
        </div>
      )}

      <table className="tbl" style={{ marginTop: 18 }}>
        <thead>
          <tr><th>N° facture</th><th>Date</th><th>Période</th><th className="c">Net à payer</th><th></th></tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <InvoiceRow key={inv.id} inv={inv} receptions={receptions} onDelete={() => delInvoice(inv.id)} />
          ))}
          {invoices.length === 0 && <tr><td colSpan={5} className="empty-state">Aucune facture enregistrée.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// Une ligne de facture, dépliable pour voir le rapprochement avec les
// réceptions de la période (par catégorie suivie dans l'app).
function InvoiceRow({ inv, receptions, onDelete }) {
  const [open, setOpen] = useState(false);

  // Quantités reçues (app) par catégorie, sur la période de la facture
  const receivedByKey = {};
  for (const a of LINEN_ARTICLES) receivedByKey[a.key] = 0;
  for (const r of receptions) {
    const d = (r.date || "").slice(0, 10);
    if (d < inv.periodFrom || d > inv.periodTo) continue;
    for (const a of LINEN_ARTICLES) receivedByKey[a.key] += Number(r.quantities?.[a.key]) || 0;
  }
  // Quantités facturées par catégorie (somme des variantes Cocoon+Horizon le cas échéant)
  const invoicedByKey = {};
  for (const a of LINEN_ARTICLES) invoicedByKey[a.key] = 0;
  for (const line of ELIS_INVOICE_ARTICLES) {
    invoicedByKey[line.key] += Number(inv.lines?.[line.id]?.qte) || 0;
  }

  return (
    <>
      <tr>
        <td>{inv.numFacture}</td>
        <td>{fmtFr(inv.dateFacture)}</td>
        <td>{fmtFr(inv.periodFrom)} → {fmtFr(inv.periodTo)}</td>
        <td className="c" style={{ fontWeight: 700 }}>{euros(inv.netAPayer)}</td>
        <td style={{ whiteSpace: "nowrap" }}>
          <button onClick={() => setOpen(!open)} className="ghost" style={{ color: "#2980b9" }}>{open ? "Masquer" : "Pointer"}</button>
          <button onClick={onDelete} className="ghost" style={{ color: "#e74c3c" }}>✕</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ background: "#f8f9fb", padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase" }}>
              Rapprochement : facturé vs réceptionné dans l&apos;app sur la période
            </div>
            <table className="tbl">
              <thead>
                <tr><th>Catégorie</th><th className="c">Facturé (Elis)</th><th className="c">Réceptionné (app)</th><th className="c">Écart</th></tr>
              </thead>
              <tbody>
                {LINEN_ARTICLES.map(a => {
                  const fact = invoicedByKey[a.key];
                  const recu = receivedByKey[a.key];
                  const ecart = recu - fact;
                  if (fact === 0 && recu === 0) return null;
                  return (
                    <tr key={a.key}>
                      <td>{a.label}</td>
                      <td className="c">{fact}</td>
                      <td className="c">{recu}</td>
                      <td className="c" style={{ fontWeight: 700, color: ecart === 0 ? "#1f7a3f" : "#e67e22" }}>
                        {ecart === 0 ? "✓" : (ecart > 0 ? `+${ecart}` : ecart)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
              Écart = réceptionné dans l&apos;app − facturé par Elis. Un écart peut venir d&apos;une réception non liée
              à cette période exacte, d&apos;un décalage de livraison, ou d&apos;une facture partielle.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

export default function CommandeLingePage() {
  return <CommandeLinge />;
}
