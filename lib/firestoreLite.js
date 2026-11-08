// lib/firestoreLite.js
// Firestore « lite » : chaque lecture ou écriture est une simple requête HTTPS
// (pas de canal d'écoute en direct à ouvrir). Environ 3 fois plus léger que le
// SDK complet et sans la poignée de main du canal temps réel, ce qui compte
// beaucoup sur un téléphone en 4G. Réservé aux pages sans onSnapshot :
// Commande linge et Rapport de transition.
//
// loadLite() est mémorisée : le premier appel télécharge le module, les
// suivants réutilisent la même instance.

let litePromise = null;

export function loadLite() {
  if (!litePromise) {
    litePromise = Promise.all([import("./firebaseApp"), import("firebase/firestore/lite")]).then(([appMod, fs]) => {
      const db = fs.getFirestore(appMod.getFirebaseApp());
      const EMU = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR;
      if (EMU && !globalThis.__fsLiteEmu) {
        const [host, port] = EMU.split(":");
        fs.connectFirestoreEmulator(db, host, Number(port));
        globalThis.__fsLiteEmu = true;
      }
      return {
        db,
        collection: fs.collection, doc: fs.doc, getDoc: fs.getDoc, getDocs: fs.getDocs,
        setDoc: fs.setDoc, addDoc: fs.addDoc, updateDoc: fs.updateDoc, deleteDoc: fs.deleteDoc,
        query: fs.query, orderBy: fs.orderBy,
      };
    });
    // En cas d'échec (réseau), permettre un nouvel essai au prochain appel.
    litePromise.catch(() => { litePromise = null; });
  }
  return litePromise;
}

// Lecture anticipée : lancée dès que le code de la page est chargé, pendant
// que le verrou d'accès (Gate) interroge encore /api/auth. Les règles Firestore
// rendent ces données lisibles sans le code : rien n'est affiché avant le
// déverrouillage, on gagne seulement le temps d'attente. Le résultat ne sert
// qu'une fois (premier affichage) ; ensuite chaque visite relit le serveur.
export function makePrefetch(loader) {
  let pending = null;
  return {
    start() {
      if (typeof window === "undefined" || pending) return;
      pending = loadLite().then(loader);
      pending.catch(() => {});
    },
    take() {
      const p = pending;
      pending = null;
      return p || loadLite().then(loader);
    },
  };
}
