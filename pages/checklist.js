// pages/checklist.js
// Checklist journalière de réception (planning matin/après-midi + tâches par semaine).
// Chaque case cochée est horodatée et attribuée à la personne identifiée (lib/staff.js).
// Un doc Firestore par jour : daily_checklist/{YYYY-MM-DD}.tasks.{taskId} = {done, by, at}

import { useState, useEffect, useMemo, useCallback } from "react";
import Head from "next/head";
import {
  MORNING, AFTERNOON, WEEKLY, WEEKDAY_LABELS, isoWeekday,
} from "../lib/checklistTemplate";
import { getCurrentStaff, setCurrentStaff, listStaff, ensureStaff, deleteStaff } from "../lib/staff";
import StaffBar from "../components/StaffBar";

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

function TaskRow({ id, time, task, entry, editable, overdue, onToggle }) {
  const done = !!entry?.done;
  return (
    <tr className={`task-row${done ? " task-done" : ""}${overdue && !done ? " task-overdue" : ""}`}>
      {time && <td className="task-time">{time}</td>}
      <td className="task-text">{task}</td>
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

  const isToday = dateStr === todayISO();
  const weekday = isoWeekday(new Date(dateStr + "T12:00:00"));

  useEffect(() => {
    setCurrent(getCurrentStaff());
    (async () => {
      const { isFirebaseConfigured } = await import("../lib/firebase");
      if (!isFirebaseConfigured()) { setConfigured(false); setReady(true); return; }
      const { db } = await import("../lib/firebase");
      const { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy } = await import("firebase/firestore");
      const a = { db, collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy };
      setApi(a);
      try { setStaffList(await listStaff(a)); } catch { /* collection pas encore créée */ }
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

  const presentToday = useMemo(() => {
    const names = new Set();
    Object.values(tasks).forEach(t => { if (t?.done && t?.by) names.add(t.by); });
    return [...names];
  }, [tasks]);

  const morningDone = MORNING.filter(t => tasks[t.id]?.done).length;
  const afternoonDone = AFTERNOON.filter(t => tasks[t.id]?.done).length;
  const todaysWeekly = WEEKLY[weekday] || [];
  const weeklyDone = todaysWeekly.filter(t => tasks[t.id]?.done).length;
  const totalTasks = MORNING.length + AFTERNOON.length + todaysWeekly.length;
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

      <div className="menage-page">
        <div className="recap checklist-recap">
          <div className="resid">
            <div className="resid-head"><span className="resid-name">Planning journalier — Matin</span></div>
            <table className="tbl">
              <tbody>
                {MORNING.map(t => (
                  <TaskRow key={t.id} {...t} entry={tasks[t.id]} editable={isToday && !!current}
                    overdue={nowMin != null && toMinutes(t.time) != null && nowMin > toMinutes(t.time)}
                    onToggle={toggle} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="lunch-sep">🍽 13h00 – Pause déjeuner</div>

          <div className="resid">
            <div className="resid-head"><span className="resid-name">Planning journalier — Après-midi</span></div>
            <table className="tbl">
              <tbody>
                {AFTERNOON.map(t => (
                  <TaskRow key={t.id} {...t} entry={tasks[t.id]} editable={isToday && !!current}
                    overdue={nowMin != null && toMinutes(t.time) != null && nowMin > toMinutes(t.time)}
                    onToggle={toggle} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="resid">
            <div className="resid-head">
              <span className="resid-name">Tâches de la semaine — {WEEKDAY_LABELS[weekday]}</span>
              <button className="ghost small" onClick={() => setShowFullWeek(s => !s)}>
                {showFullWeek ? "Masquer le reste de la semaine" : "Voir toute la semaine"}
              </button>
            </div>
            <table className="tbl">
              <tbody>
                {todaysWeekly.map(t => (
                  <TaskRow key={t.id} id={t.id} task={t.task} entry={tasks[t.id]} editable={isToday && !!current}
                    overdue={false} onToggle={toggle} />
                ))}
                {todaysWeekly.length === 0 && (
                  <tr><td className="task-text" colSpan={3}>Aucune tâche hebdomadaire ce jour-là.</td></tr>
                )}
              </tbody>
            </table>

            {showFullWeek && (
              <div className="full-week">
                {Object.entries(WEEKLY).filter(([d]) => Number(d) !== weekday).map(([d, list]) => (
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
