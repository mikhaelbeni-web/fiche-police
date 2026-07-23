// lib/staff.js
// Identification légère du personnel — PAS un système d'auth : chacun choisit son
// prénom dans une liste partagée (ou l'ajoute) avant de pointer une tâche. Ça suffit
// pour savoir "qui a fait quoi aujourd'hui", cohérent avec le code d'accès partagé
// déjà utilisé par l'app (Gate.js). Une vraie auth nominative (Firebase Auth) pourra
// remplacer ça plus tard sans changer le modèle de données (le champ stocké est
// toujours juste un nom).

const LS_KEY = "checklist_staff_name";

export function getCurrentStaff() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LS_KEY) || "";
}

export function setCurrentStaff(name) {
  if (typeof window === "undefined") return;
  if (name) window.localStorage.setItem(LS_KEY, name);
  else window.localStorage.removeItem(LS_KEY);
}

// Liste partagée des prénoms (collection Firestore "staff_members", doc id = nom).
// Alimentée au fur et à mesure : la première personne qui tape un nouveau prénom
// l'ajoute pour tout le monde.
export async function listStaff(api) {
  const { collection, getDocs, query, orderBy } = api;
  const snap = await getDocs(query(collection(api.db, "staff_members"), orderBy("name", "asc")));
  return snap.docs.map(d => d.id);
}

export async function ensureStaff(api, name) {
  const clean = (name || "").trim();
  if (!clean) return;
  const { doc, setDoc } = api;
  await setDoc(doc(api.db, "staff_members", clean), { name: clean }, { merge: true });
}

export async function deleteStaff(api, name) {
  const clean = (name || "").trim();
  if (!clean) return;
  const { doc, deleteDoc } = api;
  await deleteDoc(doc(api.db, "staff_members", clean));
}
