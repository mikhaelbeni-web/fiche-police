// lib/firebaseAuth.js
// Connexion Firebase Auth du poste, après le code d'accès.
// Les règles Firestore et Storage n'acceptent que l'utilisateur « reception-gate ».
// Le jeton qui permet de se connecter est délivré par /api/auth?firebase=1,
// seulement si le cookie de session (code d'accès) est valide.
// La connexion est mémorisée par Firebase dans le navigateur (IndexedDB) :
// le jeton n'est demandé qu'une fois par poste, ensuite tout est local.

let pending = null;

// Renvoie true si le poste est connecté, false si le code d'accès n'a pas
// encore été saisi (ou si le serveur ne sait pas délivrer de jeton).
export function ensureFirebaseAuth() {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!pending) {
    pending = (async () => {
      const [{ getFirebaseApp, isFirebaseConfigured }, authMod] = await Promise.all([
        import("./firebaseApp"),
        import("firebase/auth"),
      ]);
      if (!isFirebaseConfigured()) return false;
      const auth = authMod.getAuth(getFirebaseApp());
      await auth.authStateReady();
      if (auth.currentUser) return true;
      const r = await fetch("/api/auth?firebase=1", { method: "GET" });
      const d = await r.json();
      if (!d.authenticated || !d.firebaseToken) return false;
      await authMod.signInWithCustomToken(auth, d.firebaseToken);
      return true;
    })();
    // Échec ou pas encore de code : un prochain appel réessaiera.
    pending.then(ok => { if (!ok) pending = null; }, () => { pending = null; });
  }
  return pending;
}
