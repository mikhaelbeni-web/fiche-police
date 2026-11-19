// components/admin/useAdminExpiry.js
// Déconnexion automatique de l'espace admin à l'heure d'expiration de la session
// (5 h après la connexion, voir lib/adminAuth.js). Le serveur refuse déjà tout appel
// après l'expiration ; ce hook ferme aussi la page restée ouverte, sans attendre un clic.
//
// Le temps restant est calculé à partir de l'heure du SERVEUR au chargement
// (serverNowMs), pour ne pas dépendre d'une horloge d'appareil fausse.
// Un minuteur seul ne suffit pas : un ordinateur en veille ou un onglet en arrière-plan
// le retarde. On revérifie donc aussi au retour sur l'onglet et toutes les 30 s.
import { useEffect } from "react";

export const ADMIN_EXPIRED_URL = "/codes/admin/connexion?expiree=1";

export function useAdminExpiry(router, adminExpiresAt, serverNowMs) {
  useEffect(() => {
    if (!adminExpiresAt) return undefined;
    const restantMs = adminExpiresAt * 1000 - (serverNowMs || Date.now());
    const echeance = Date.now() + restantMs;
    let fini = false;

    async function expirer() {
      if (fini) return;
      fini = true;
      try { await fetch("/api/admin/logout", { method: "POST" }); } catch { /* le cookie expire de toute façon */ }
      router.replace(ADMIN_EXPIRED_URL);
    }
    function verifier() {
      if (Date.now() >= echeance) expirer();
    }

    const minuteur = setTimeout(expirer, Math.max(0, Math.min(restantMs, 2147483647)));
    const intervalle = setInterval(verifier, 30000);
    const auRetour = () => { if (document.visibilityState !== "hidden") verifier(); };
    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("focus", verifier);
    verifier();
    return () => {
      fini = true;
      clearTimeout(minuteur);
      clearInterval(intervalle);
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("focus", verifier);
    };
  }, [router, adminExpiresAt, serverNowMs]);
}
