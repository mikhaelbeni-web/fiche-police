// components/admin/useAdminExpiry.js
// Déconnexion automatique de l'espace admin à l'heure d'expiration de la session
// (5 h après la connexion, voir lib/adminAuth.js). Le serveur refuse déjà tout appel
// après l'expiration ; ce hook ferme aussi la page restée ouverte, sans attendre un clic.
// Le calcul part de l'heure du SERVEUR au chargement (serverNowMs).
import { useMemo } from "react";
import { useEcheance, echeanceDepuisServeur } from "../../hooks/useEcheance";

export const ADMIN_EXPIRED_URL = "/codes/admin/connexion?expiree=1";

export function useAdminExpiry(router, adminExpiresAt, serverNowMs) {
  const echeance = useMemo(() => echeanceDepuisServeur(adminExpiresAt, serverNowMs), [adminExpiresAt, serverNowMs]);
  useEcheance(echeance, async () => {
    try { await fetch("/api/admin/logout", { method: "POST" }); } catch { /* le cookie expire de toute façon */ }
    router.replace(ADMIN_EXPIRED_URL);
  });
}
