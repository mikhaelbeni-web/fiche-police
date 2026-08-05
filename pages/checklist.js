// pages/checklist.js
// Checklist journalière de réception (planning matin/après-midi + tâches par semaine).
// Chaque case cochée est horodatée et attribuée à la personne identifiée (lib/staff.js).
// Un doc Firestore par jour : daily_checklist/{YYYY-MM-DD}.tasks.{taskId} = {done, by, at}

import { useState, useEffect, useMemo, useCallback } from "react";
import Head from "next/head";
import {
  MORNING as SEED_MORNING, AFTERNOON as SEED_AFTERNOON, WEEKLY as SEED_WEEKLY,
  WEEKDAY_LABELS, isoWeekday,
} from "../lib/checklistTemplate";
import { getCurrentStaff, setCurrentStaff, listStaff, ensureStaff, deleteStaff } from "../lib/staff";
import StaffBar from "../components/StaffBar";

// Code admin pour ajouter/modifier/supprimer une ligne de tâche du planning.
// Distinct du code de suppression 2305 utilisé ailleurs — celui-ci ouvre un vrai
// mode édition du référentiel de tâches, pas juste une confirmation ponctuelle.
const ADMIN_CODE = process.env.NEXT_PUBLIC_CHECKLIST_ADMIN_CODE || "2305";
function checkAdminCode() {
  const entered = prompt("Code admin requis :");
  if (entered === null) return false;
  if (entered !== ADMIN_CODE) { alert("Code incorrect."); return false; }
  return true;
}

function todayISO() {
  // Date locale (pas UTC) : évite le décalage "hier" entre minuit et l'heure UTC.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtFr(dateStr) {
  const x = new Date(dateStr + "T12:00:00");
  return isNaN(x) ? dateStr : x.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}
function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
}
// "08h30" -> minutes depuis minuit, pour savoir si une tâche est en retard
function toMinutes(hm) {
  const m = /^(\d{2})h(\d{2})$/.exec(hm);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function TaskRow({ id, time, task, entry, editable, overdue, onToggle, adminMode, onEdit, onDelete }) {
  const done = !!entry?.done;
  return (
    <tr className={`task-row${done ? " task-done" : ""}${overdue && !done ? " task-overdue" : ""}`}>
      {time && <td className="task-time">{time}</td>}
      <td className="task-text">
        {task}
        {adminMode && (
          <span className="task-admin-btns">
            <button type="button" className="task-admin-btn" title="Modifier" onClick={() => onEdit(id, time, task)}>✎</button>
            <button type="button" className="task-admin-btn del" title="Supprimer" onClick={() => onDelete(id)}>✕</button>
          </span>
        )}
      </td>
      <td className="c task-check-cell">
        <button
          className={`task-check${done ? " checked" : ""}`}
          disabled={!editable}
          onClick={() => onToggle(id, !done)}
          title={editable ? (done ? "Décocher" : "Marquer fait") : "Lecture seule (jour passé)"}
        >
          {done ? "✓" : ""}
        </button>
      </td>
      <td className="task-by">{done && entry?.by ? <span className="task-by-tag">{entry.by} · {entry.at}</span> : ""}</td>
    </tr>
  );
}

function Checklist() {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [api, setApi] = useState(null);
  const [status, setStatus] = useState("");

  const [current, setCurrent] = useState("");
  const [staffList, setStaffList] = useState([]);

  const [dateStr, setDateStr] = useState(todayISO());
  const [tasks, setTasks] = useState({});
  const [showFullWeek, setShowFullWeek] = useState(false);

  // Référentiel de tâches — vit dans Firestore pour être modifiable en mode admin.
  // Au tout premier chargement (collections vides), on le pré-remplit avec la
  // liste statique existante, pour ne rien casser de ce qui tournait déjà.
  const [morning, setMorning] = useState(SEED_MORNING);
  const [afternoon, setAfternoon] = useState(SEED_AFTERNOON);
  const [weekly, setWeekly] = useState(SEED_WEEKLY);
  const [adminMode, setAdminMode] = useState(false);

  const isToday = dateStr === todayISO();
  const weekday = isoWeekday(new Date(dateStr + "T12:00:00"));

  const loadTemplate = useCallback(async (a) => {
    const mSnap = await a.getDocs(a.collection(a.db, "checklist_tasks_morning"));
    if (mSnap.empty) {
      for (const t of SEED_MORNING) await a.setDoc(a.doc(a.db, "checklist_tasks_morning", t.id), { time: t.time, task: t.task });
      setMorning(SEED_MORNING);
    } else {
      setMorning(mSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => (x.time || "").localeCompare(y.time || "")));
    }
    const aSnap = await a.getDocs(a.collection(a.db, "checklist_tasks_afternoon"));
    if (aSnap.empty) {
      for (const t of SEED_AFTERNOON) await a.setDoc(a.doc(a.db, "checklist_tasks_afternoon", t.id), { time: t.time, task: t.task });
      setAfternoon(SEED_AFTERNOON);
    } else {
      setAfternoon(aSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => (x.time || "").localeCompare(y.time || "")));
    }
    const wSnap = await a.getDocs(a.collection(a.db, "checklist_tasks_weekly"));
    if (wSnap.empty) {
      for (const [day, list] of Object.entries(SEED_WEEKLY)) {
        for (const t of list) await a.setDoc(a.doc(a.db, "checklist_tasks_weekly", t.id), { weekday: Number(day), task: t.task });
      }
      setWeekly(SEED_WEEKLY);
    } else {
      const grouped = {};
      wSnap.docs.forEach(d => {
        const data = d.data();
        if (!grouped[data.weekday]) grouped[data.weekday] = [];
        grouped[data.weekday].push({ id: d.id, task: data.task });
      });
      setWeekly(grouped);
    }
  }, []);

  useEffect(() => {
    setCurrent(getCurrentStaff());
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy } = await import("firebase/firestore");
      const a = { db, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy };
      setApi(a);
      try { setStaffList(await listStaff(a)); } catch { /* collection pas encore créée */ }
      try { await loadTemplate(a); } catch (e) { setStatus("Erreur de chargement du planning : " + e.message); }
      setReady(true);
    })();
  }, []);

  const loadDay = useCallback(async (a, d) => {
    setStatus("Chargement…");
    const snap = await a.getDoc(a.doc(a.db, "daily_checklist", d));
    setTasks(snap.exists() ? (snap.data().tasks || {}) : {});
    setStatus("");
  }, []);

  useEffect(() => { if (api) loadDay(api, dateStr); }, [api, dateStr, loadDay]);

  async function pick(name) {
    if (!name) { setCurrent(""); setCurrentStaff(""); return; }
    setCurrent(name);
    setCurrentStaff(name);
  }
  async function addStaff(name) {
    if (api) { try { await ensureStaff(api, name); setStaffList(await listStaff(api)); } catch { /* ignore */ } }
    pick(name);
  }
  async function removeStaff(name) {
    if (!api) return;
    try { await deleteStaff(api, name); setStaffList(await listStaff(api)); } catch { /* ignore */ }
  }

  async function toggle(taskId, newDone) {
    if (!api || !isToday) return;
    if (!current) return; // la barre d'identification s'affiche déjà si besoin
    const entry = newDone ? { done: true, by: current, at: nowHM() } : { done: false, by: current, at: nowHM() };
    setTasks(prev => ({ ...prev, [taskId]: entry })); // optimiste
    const ref = api.doc(api.db, "daily_checklist", dateStr);
    try {
      await api.setDoc(ref, {}, { merge: true }); // garantit l'existence du doc
      await api.updateDoc(ref, { [`tasks.${taskId}`]: entry });
    } catch (e) {
      setStatus("Erreur d'enregistrement : " + e.message);
    }
  }

  // ---- Mode admin : ajouter / modifier / supprimer une ligne du planning ----
  function toggleAdminMode() {
    if (adminMode) { setAdminMode(false); return; }
    if (checkAdminCode()) setAdminMode(true);
  }

  function collectionFor(section) {
    return section === "morning" ? "checklist_tasks_morning"
      : section === "afternoon" ? "checklist_tasks_afternoon"
      : "checklist_tasks_weekly";
  }

  async function addTask(section) {
    if (!api) return;
    const isWeekly = section === "weekly";
    let time = null;
    if (!isWeekly) {
      const t = prompt("Heure de la tâche (format 08h30) :");
      if (t == null) return;
      if (!/^\d{2}h\d{2}$/.test(t.trim())) { alert("Format d'heure invalide (attendu ex. 08h30)."); return; }
      time = t.trim();
    }
    const task = prompt("Texte de la tâche :");
    if (task == null || !task.trim()) return;
    try {
      setStatus("Ajout de la tâche…");
      const ref = api.doc(api.collection(api.db, collectionFor(section)));
      const data = isWeekly ? { weekday, task: task.trim() } : { time, task: task.trim() };
      await api.setDoc(ref, data);
      await loadTemplate(api);
      setStatus("Tâche ajoutée.");
    } catch (e) { setStatus("Erreur : " + e.message); }
  }

  async function editTask(section, id, currentTime, currentTask) {
    if (!api) return;
    const isWeekly = section === "weekly";
    let time = currentTime;
    if (!isWeekly) {
      const t = prompt("Heure de la tâche :", currentTime || "");
      if (t == null) return;
      if (!/^\d{2}h\d{2}$/.test(t.trim())) { alert("Format d'heure invalide (attendu ex. 08h30)."); return; }
      time = t.trim();
    }
    const task = prompt("Texte de la tâche :", currentTask || "");
    if (task == null || !task.trim()) return;
    try {
      setStatus("Modification…");
      const data = isWeekly ? { task: task.trim() } : { time, task: task.trim() };
      await api.updateDoc(api.doc(api.db, collectionFor(section), id), data);
      await loadTemplate(api);
      setStatus("Tâche modifiée.");
    } catch (e) { setStatus("Erreur : " + e.message); }
  }

  async function deleteTask(section, id) {
    if (!api) return;
    if (!confirm("Supprimer définitivement cette tâche du planning ? Elle n'apparaîtra plus, y compris pour les jours déjà passés.")) return;
    try {
      setStatus("Suppression…");
      await api.deleteDoc(api.doc(api.db, collectionFor(section), id));
      await loadTemplate(api);
      setStatus("Tâche supprimée.");
    } catch (e) { setStatus("Erreur : " + e.message); }
  }

  const presentToday = useMemo(() => {
    const names = new Set();
    Object.values(tasks).forEach(t => { if (t?.done && t?.by) names.add(t.by); });
    return [...names];
  }, [tasks]);

  const morningDone = morning.filter(t => tasks[t.id]?.done).length;
  const afternoonDone = afternoon.filter(t => tasks[t.id]?.done).length;
  const todaysWeekly = weekly[weekday] || [];
  const weeklyDone = todaysWeekly.filter(t => tasks[t.id]?.done).length;
  const totalTasks = morning.length + afternoon.length + todaysWeekly.length;
  const totalDone = morningDone + afternoonDone + weeklyDone;
  const pct = totalTasks ? Math.round((totalDone / totalTasks) * 100) : 0;

  const nowMin = isToday ? toMinutes(nowHM()) : null;

  function shiftDate(deltaDays) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + deltaDays);
    setDateStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }

  if (!configured) {
    return (
      <div className="empty-state">
        Firebase non configuré — la checklist a besoin des variables NEXT_PUBLIC_FIREBASE_*
        (voir README-FIREBASE.md).
      </div>
    );
  }
  if (!ready) return null;

  return (
    <>
      <Head><title>Checklist du jour — Résidences</title></Head>

      <div className="toolbar">
        <h1>Checklist du jour</h1>
        <div className="daynav">
          <button className="arrow" onClick={() => shiftDate(-1)}>←</button>
          <span className="daylabel">{fmtFr(dateStr)}</span>
          <button className="arrow" onClick={() => shiftDate(1)} disabled={isToday}>→</button>
          {!isToday && <button className="ghost" onClick={() => setDateStr(todayISO())}>Aujourd&apos;hui</button>}
        </div>
        <div className="progress" title={`${totalDone}/${totalTasks} tâches faites`}>
          <div className="progress-bar" style={{ width: pct + "%" }} />
          <span className="progress-label">{totalDone}/{totalTasks}</span>
        </div>
        <button className={`ghost${adminMode ? " admin-on" : ""}`} onClick={toggleAdminMode}>
          {adminMode ? "✓ Mode admin actif" : "Mode admin"}
        </button>
        <span className="status">{status}</span>
      </div>

      <StaffBar current={current} list={staffList} onPick={pick} onAdd={addStaff} onDelete={removeStaff} />

      {presentToday.length > 0 && (
        <div className="present-bar">
          <span className="staffbar-label">Ont pointé aujourd&apos;hui :</span>
          {presentToday.map(n => <span key={n} className="staff-chip present">{n}</span>)}
        </div>
      )}

      {!isToday && (
        <div className="alert-banner">Jour passé — lecture seule, on ne peut plus cocher rétroactivement.</div>
      )}
      {adminMode && (
        <div className="alert-banner admin-banner">
          Mode admin actif — les tâches ajoutées/modifiées/supprimées changent le planning pour tout le monde, tous les jours.
        </div>
      )}

      <div className="menage-page">
        <div className="recap checklist-recap">
          <div className="resid">
            <div className="resid-head"><span className="resid-name">Planning journalier — Matin</span></div>
            <div className="tbl-wrap"><table className="tbl">
              <tbody>
                {morning.map(t => (
                  <TaskRow key={t.id} {...t} entry={tasks[t.id]} editable={isToday && !!current}
                    overdue={nowMin != null && toMinutes(t.time) != null && nowMin > toMinutes(t.time)}
                    onToggle={toggle} adminMode={adminMode}
                    onEdit={(id, time, task) => editTask("morning", id, time, task)}
                    onDelete={(id) => deleteTask("morning", id)} />
                ))}
              </tbody>
            </table></div>
            {adminMode && <button className="ghost small admin-add" onClick={() => addTask("morning")}>+ Ajouter une tâche (matin)</button>}
          </div>

          <div className="lunch-sep">🍽 13h00 – Pause déjeuner</div>

          <div className="resid">
            <div className="resid-head"><span className="resid-name">Planning journalier — Après-midi</span></div>
            <div className="tbl-wrap"><table className="tbl">
              <tbody>
                {afternoon.map(t => (
                  <TaskRow key={t.id} {...t} entry={tasks[t.id]} editable={isToday && !!current}
                    overdue={nowMin != null && toMinutes(t.time) != null && nowMin > toMinutes(t.time)}
                    onToggle={toggle} adminMode={adminMode}
                    onEdit={(id, time, task) => editTask("afternoon", id, time, task)}
                    onDelete={(id) => deleteTask("afternoon", id)} />
                ))}
              </tbody>
            </table></div>
            {adminMode && <button className="ghost small admin-add" onClick={() => addTask("afternoon")}>+ Ajouter une tâche (après-midi)</button>}
          </div>

          <div className="resid">
            <div className="resid-head">
              <span className="resid-name">Tâches de la semaine — {WEEKDAY_LABELS[weekday]}</span>
              <button className="ghost small" onClick={() => setShowFullWeek(s => !s)}>
                {showFullWeek ? "Masquer le reste de la semaine" : "Voir toute la semaine"}
              </button>
            </div>
            <div className="tbl-wrap"><table className="tbl">
              <tbody>
                {todaysWeekly.map(t => (
                  <TaskRow key={t.id} id={t.id} task={t.task} entry={tasks[t.id]} editable={isToday && !!current}
                    overdue={false} onToggle={toggle} adminMode={adminMode}
                    onEdit={(id, time, task) => editTask("weekly", id, time, task)}
                    onDelete={(id) => deleteTask("weekly", id)} />
                ))}
                {todaysWeekly.length === 0 && (
                  <tr><td className="task-text" colSpan={3}>Aucune tâche hebdomadaire ce jour-là.</td></tr>
                )}
              </tbody>
            </table></div>
            {adminMode && (
              <button className="ghost small admin-add" onClick={() => addTask("weekly")}>
                + Ajouter une tâche ({WEEKDAY_LABELS[weekday]})
              </button>
            )}

            {showFullWeek && (
              <div className="full-week">
                {Object.entries(weekly).filter(([d]) => Number(d) !== weekday).map(([d, list]) => (
                  <div key={d} className="full-week-day">
                    <div className="full-week-day-title">{WEEKDAY_LABELS[d]}</div>
                    <ul>{list.map(t => <li key={t.id}>{t.task}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function ChecklistPage() {
  return <Checklist />;
}
