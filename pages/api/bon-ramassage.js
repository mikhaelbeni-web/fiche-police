// pages/api/bon-ramassage.js
// Génère le bon de ramassage en copiant FIDÈLEMENT le template .xlsx (converti depuis le .xls original).
// Utilise exceljs (Node.js pur, pas de Python) — fonctionne sur Vercel.
// Seules les cellules variables sont modifiées, tout le formatage est préservé.

import path from "path";
import ExcelJS from "exceljs";

// Ordre exact des articles dans le fichier modèle (lignes 14→20, colonne D)
const ARTICLE_ORDER = [
  "grande_serviette", // R14 : 3244 Drap bain COCOON blc
  "housse",           // R15 : 41115 Housse Stella S
  "petite_serviette", // R16 : 421 Serv Eponge COCOON blc
  "tapis_bain",       // R17 : 76549 Tapis bain
  "torchon",          // R18 : 49110 Torchon carreaux
  "taie",             // R19 : 517 Taie Am Clas
  "drap",             // R20 : 2941 Drap Clas blc
];

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `( ${d}/${m}/${y})`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const { date, expectedReception, quantities } = req.body;
  if (!date || !quantities) {
    return res.status(400).json({ error: "date et quantities requis." });
  }

  try {
    const templatePath = path.join(process.cwd(), "public", "Bon_de_ramassage_14_juillet.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);

    const ws = wb.getWorksheet("RES LE BELLEVILLE") || wb.getWorksheet(1);

    // R4C1 : date de réception prévue (remplace la date du modèle précédent)
    ws.getCell("A4").value = fmtDate(expectedReception);
    // R4C2 : date d'envoi (date de la commande)
    ws.getCell("B4").value = fmtDate(date);

    // R14→R20, colonne D : quantités par article, dans l'ordre exact du modèle
    ARTICLE_ORDER.forEach((key, i) => {
      const row = 14 + i;
      ws.getCell(`D${row}`).value = Number(quantities[key]) || 0;
    });

    // Générer le buffer et l'envoyer
    const buffer = await wb.xlsx.writeBuffer();

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Bon_de_ramassage_${date}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur génération Excel : " + err.message });
  }
}
