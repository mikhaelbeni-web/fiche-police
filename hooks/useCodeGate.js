// hooks/useCodeGate.js
// Remplace le pattern "if (!checkDeletePassword()) return; ...suite..." par une
// vraie fenêtre à champ masqué. Usage :
//   const { requestCode, codeModalProps } = useCodeGate("2305");
//   ... requestCode(() => { /* code protégé, exécuté seulement si le code est bon */ });
//   ... <CodeModal {...codeModalProps} /> quelque part dans le rendu du composant
import { useState, useCallback } from "react";

export function useCodeGate(expectedCode, title) {
  const [open, setOpen] = useState(false);
  const pendingRef = useState({ current: null })[0];

  const requestCode = useCallback((action) => {
    pendingRef.current = action;
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(code) {
    setOpen(false);
    const action = pendingRef.current;
    pendingRef.current = null;
    if (code === null || code === "") return; // annulé / vide, ne rien faire
    if (code !== expectedCode) { alert("Code incorrect."); return; }
    if (action) action();
  }
  function handleCancel() {
    setOpen(false);
    pendingRef.current = null;
  }

  return {
    requestCode,
    codeModalProps: { open, title, onSubmit: handleSubmit, onCancel: handleCancel },
  };
}
