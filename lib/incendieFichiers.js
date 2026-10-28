// lib/incendieFichiers.js
// Fichiers de l'onglet Sécurité incendie : envoi vers Firebase Storage et
// lecture du texte d'un PDF (pdf.js chargé à la demande depuis cdnjs, aucune
// dépendance npm). Navigateur uniquement.

export const MAX_FICHIER = 10 * 1024 * 1024;

export async function televerser(file, typeId) {
  if (file.size > MAX_FICHIER) throw new Error("Fichier trop gros (10 Mo maximum).");
  const { app } = await import("./firebase");
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import("firebase/storage");
  const nom = file.name.replace(/[^\w.\-]+/g, "_");
  const r = ref(getStorage(app), `incendie/${typeId}/${Date.now()}_${nom}`);
  await uploadBytes(r, file);
  return { fichierUrl: await getDownloadURL(r), fichierNom: file.name };
}

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
let chargement = null;

function chargerPdfJs() {
  if (typeof window === "undefined") return Promise.reject(new Error("pdf.js : navigateur requis"));
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!chargement) {
    chargement = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDFJS;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { chargement = null; reject(new Error("pdf.js indisponible")); };
      document.head.appendChild(s);
    });
  }
  return chargement;
}

// Texte du PDF, une ligne par rangée de texte. Renvoie "" si la lecture échoue
// (scan sans texte, réseau) : la détection se rabat alors sur le nom du fichier.
export async function lireTextePdf(file) {
  try {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return "";
    const pdfjs = await chargerPdfJs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 40); p++) {
      const contenu = await (await pdf.getPage(p)).getTextContent();
      const lignes = [];
      let y = null, cur = [];
      for (const it of contenu.items) {
        const yy = Math.round(it.transform[5]);
        if (y !== null && Math.abs(yy - y) > 3) { lignes.push(cur.join(" ")); cur = []; }
        y = yy;
        if (it.str) cur.push(it.str);
      }
      if (cur.length) lignes.push(cur.join(" "));
      pages.push(lignes.join("\n"));
    }
    return pages.join("\n");
  } catch {
    return "";
  }
}
