// pages/api/bon-ramassage.js
// Génère le bon de ramassage en copiant FIDÈLEMENT le fichier modèle Pantin.
// Seules les cellules variables sont modifiées :
//   - R4C2 : date d'envoi (la commande)
//   - R4C1 : date du modèle précédent -> remplacé par date de réception prévue
//   - R14-20 col D (index 3) : quantités par article (dans l'ordre du modèle)
// Tout le reste (formatage, structure, bordures, logos) est préservé à l'identique.

import path from "path";
import fs from "fs";

// Ordre exact des lignes d'articles dans le fichier modèle (R14→R20, index 13→19)
// Code Pantin → clé article interne
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
  return `${d}/${m}/${y}`;
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
    // Charger xlrd et xlutils côté serveur
    const { execSync } = await import("child_process");
    const templatePath = path.join(process.cwd(), "public", "bon_de_ramassage_template.xls");
    const outPath = path.join("/tmp", `bon_ramassage_${Date.now()}.xls`);

    // On passe les données via un script Python inline
    const dateEnvoi = fmtDate(date);
    const dateRecep = fmtDate(expectedReception);
    const qtys = ARTICLE_ORDER.map(key => Number(quantities[key]) || 0).join(",");

    const script = `
import sys
from xlrd import open_workbook
from xlutils.copy import copy

wb = open_workbook(${JSON.stringify(templatePath)}, formatting_info=True)
wbc = copy(wb)
ws = wbc.get_sheet(0)

# Date du modèle (R4C1) → date de réception prévue
ws.write(3, 0, "( ${dateRecep})")
# Date d'envoi (R4C2) → date de la commande
ws.write(3, 1, "( ${dateEnvoi})")

# Quantités articles, dans l'ordre du modèle (R14→R20, colonne D = index 3)
qtys = [${qtys}]
for i, q in enumerate(qtys):
    ws.write(13 + i, 3, q)

wbc.save(${JSON.stringify(outPath)})
print("OK")
`;

    execSync(`python3 -c '${script.replace(/'/g, "'\\''")}'`);

    const fileBuffer = fs.readFileSync(outPath);
    fs.unlinkSync(outPath);

    res.setHeader("Content-Type", "application/vnd.ms-excel");
    res.setHeader("Content-Disposition", `attachment; filename="Bon_de_ramassage_${date}.xls"`);
    res.send(fileBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur génération Excel : " + err.message });
  }
}
