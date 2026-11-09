// lib/firestoreClient.js
// Accès Firestore partagé par Commande linge et Rapport de transition.
// loadFs() est mémorisée : le SDK n'est téléchargé et initialisé qu'une fois,
// et la connexion déjà ouverte par le bloc-notes (NotesWidget) est réutilisée.

let fsPromise = null;

export function loadFs() {
  if (!fsPromise) {
    fsPromise = Promise.all([import("./firebase"), import("firebase/firestore")]).then(([m, fs]) => ({
      db: m.db,
      collection: fs.collection, doc: fs.doc, getDoc: fs.getDoc, getDocs: fs.getDocs,
      setDoc: fs.setDoc, addDoc: fs.addDoc, updateDoc: fs.updateDoc, deleteDoc: fs.deleteDoc,
      query: fs.query, orderBy: fs.orderBy,
    }));
    // En cas d'échec (réseau), permettre un nouvel essai au prochain appel.
    fsPromise.catch(() => { fsPromise = null; });
  }
  return fsPromise;
}

// Lecture anticipée : lancée dès que le code de la page est chargé, pendant
// que le verrou d'accès (Gate) interroge encore /api/auth. Rien n'est affiché
// avant le déverrouillage : on gagne seulement le temps d'attente. Le résultat
// ne sert qu'une fois (premier affichage) ; ensuite chaque visite relit le serveur.
export function makePrefetch(loader) {
  let pending = null;
  return {
    start() {
      if (typeof window === "undefined" || pending) return;
      pending = loadFs().then(loader);
      pending.catch(() => {});
    },
    take() {
      const p = pending;
      pending = null;
      return p || loadFs().then(loader);
    },
  };
}
