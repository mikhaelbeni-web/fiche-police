// hooks/useEcheance.js
// Règle du logiciel : un code saisi n'ouvre l'accès que 5 h. Passé ce délai, il faut
// le retaper, quel que soit l'appareil. L'usage ne prolonge jamais le délai.
//
// useEcheance(echeanceMs, onExpire) appelle onExpire une seule fois quand l'heure
// (horloge de l'appareil, en ms) est atteinte. Un minuteur seul ne suffit pas :
// un ordinateur en veille ou un onglet en arrière-plan le retarde. On revérifie donc
// aussi au retour sur l'onglet et toutes les 30 s.
//
// useInterrupteur5h() : un interrupteur (mode admin, édition de liste…) qui se
// referme de lui-même 5 h après avoir été ouvert.
import { useEffect, useRef, useState, useCallback } from "react";

export const DUREE_CODE_MS = 5 * 60 * 60 * 1000;

// Convertit une expiration serveur (secondes epoch) en échéance sur l'horloge de
// l'appareil, sans dépendre d'une horloge d'appareil fausse.
export function echeanceDepuisServeur(expiresAtSec, serverNowMs) {
  if (!expiresAtSec) return null;
  return Date.now() + (expiresAtSec * 1000 - (serverNowMs || Date.now()));
}

export function useEcheance(echeanceMs, onExpire) {
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => {
    if (!echeanceMs) return undefined;
    let fini = false;
    const expirer = () => { if (!fini) { fini = true; cb.current(); } };
    const verifier = () => { if (Date.now() >= echeanceMs) expirer(); };
    const restant = Math.max(0, Math.min(echeanceMs - Date.now(), 2147483647));
    const minuteur = setTimeout(verifier, restant);
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
  }, [echeanceMs]);
}

export function useInterrupteur5h() {
  const [echeance, setEcheance] = useState(null);
  useEcheance(echeance, () => setEcheance(null));
  const actif = echeance !== null;
  const setActif = useCallback(v => setEcheance(v ? Date.now() + DUREE_CODE_MS : null), []);
  return [actif, setActif];
}
