// pages/api/receptions-mois.js
// Relevé Excel de toutes les réceptions de linge d'un mois, à envoyer à Elis
// pour justifier le linge manquant. Reçoit le relevé déjà calculé côté page
// (monthReceptionReport dans lib/linen.js) et ne fait que la mise en forme.

import ExcelJS from "exceljs";
import { LINEN_ARTICLES, PANTIN_CODES, PANTIN_CLIENT, moisLabel } from "../../lib/linen";

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

function fr(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function frJour(iso) {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  return `${JOURS[d.getDay()]} ${fr(iso)}`;
}
const libelle = key => `${PANTIN_CODES[key]?.code || ""} ${PANTIN_CODES[key]?.libelle || key}`.trim();

const GRIS = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9ECEF" } };
const ROUGE = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E1" } };
const BORD = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };

function entete(ws, row) {
  row.eachCell(c => { c.font = { bold: true }; c.fill = GRIS; c.border = BORD; c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });
  row.height = 32;
}
function cadre(row) { row.eachCell({ includeEmpty: false }, c => { c.border = BORD; }); }

export function construireClasseur(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = PANTIN_CLIENT.residence;
  const titre = `Réceptions de linge – ${PANTIN_CLIENT.residence} – ${moisLabel(report.month)}`;
  const sousTitre = `Client Elis n° ${PANTIN_CLIENT.nClient} · ${PANTIN_CLIENT.adresse}, ${PANTIN_CLIENT.ville}`;

  // ---- Feuille 1 : synthèse par article
  const s = wb.addWorksheet("Synthèse", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  s.addRow([titre]).font = { bold: true, size: 14 };
  s.addRow([sousTitre]);
  s.addRow([`${report.rows.length} livraison(s) enregistrée(s) dans le mois.`]);
  s.addRow([]);
  s.columns = [{ width: 44 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  entete(s, s.addRow(["Article", "Attendu (commandes + défectueux renvoyés)", "Reçu (total)", "dont livré sans commande", "Manque constaté aux livraisons", "Complété ensuite", "Toujours manquant en fin de mois"]));
  for (const a of LINEN_ARTICLES) {
    const k = a.key;
    const r = s.addRow([libelle(k), report.totalAttendu[k], report.totalRecu[k], report.totalRecuLibre[k], report.manqueOuvert[k], report.comble[k], report.manquant[k]]);
    cadre(r);
    r.getCell(7).font = { bold: true };
    if (report.manquant[k] > 0) r.getCell(7).fill = ROUGE;
  }
  s.addRow([]);
  s.addRow(["Manque constaté = écarts négatifs des livraisons (détail dans la feuille « Détail par livraison »)."]).font = { italic: true };
  s.addRow(["Complété ensuite = rattrapé plus tard dans le mois par une livraison sans commande ou un excédent."]).font = { italic: true };
  if (report.sansReception.length) {
    s.addRow([]);
    s.addRow(["Commandes dont la livraison était prévue ce mois-ci, sans réception enregistrée :"]).font = { bold: true };
    for (const o of report.sansReception) {
      const q = LINEN_ARTICLES.filter(a => Number(o.quantities?.[a.key]) > 0).map(a => `${Number(o.quantities[a.key])} × ${PANTIN_CODES[a.key]?.libelle || a.label}`).join(", ");
      s.addRow([`Commande du ${o.type || ""} ${fr(o.date)}, livraison prévue le ${fr(o.expectedReception)} : ${q || "—"}`]);
    }
  }

  // ---- Feuille 2 : détail par livraison et par article
  const d = wb.addWorksheet("Détail par livraison", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }, views: [{ state: "frozen", ySplit: 1 }] });
  d.columns = [{ width: 18 }, { width: 30 }, { width: 44 }, { width: 12 }, { width: 12 }, { width: 12 }];
  entete(d, d.addRow(["Reçu le", "Commande", "Article", "Attendu", "Reçu", "Écart"]));
  for (const row of report.rows) {
    const cmd = row.libre ? "Livraison sans commande" : `${row.orderType || ""} ${fr(row.orderDate)}`.trim();
    for (const a of LINEN_ARTICLES) {
      if (!row.recu[a.key] && !(row.attendu && row.attendu[a.key])) continue;
      const r = d.addRow([frJour(row.date), cmd, libelle(a.key), row.attendu ? row.attendu[a.key] : "—", row.recu[a.key], row.ecart ? row.ecart[a.key] : "—"]);
      cadre(r);
      if (row.ecart && row.ecart[a.key] < 0) { r.getCell(6).fill = ROUGE; r.getCell(6).font = { bold: true }; }
    }
  }

  // ---- Feuille 3 : quantités reçues par date (vue d'ensemble)
  const g = wb.addWorksheet("Reçu par date", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  g.columns = [{ width: 18 }, { width: 26 }, ...LINEN_ARTICLES.map(() => ({ width: 14 }))];
  entete(g, g.addRow(["Reçu le", "Commande", ...LINEN_ARTICLES.map(a => `${PANTIN_CODES[a.key]?.code}\n${PANTIN_CODES[a.key]?.libelle}`)]));
  for (const row of report.rows) {
    cadre(g.addRow([frJour(row.date), row.libre ? "Sans commande" : `${row.orderType || ""} ${fr(row.orderDate)}`.trim(), ...LINEN_ARTICLES.map(a => row.recu[a.key])]));
  }
  const tot = g.addRow(["Total reçu", "", ...LINEN_ARTICLES.map(a => report.totalRecu[a.key])]);
  cadre(tot); tot.font = { bold: true };

  return wb;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  const report = req.body?.report;
  if (!report || !/^\d{4}-\d{2}$/.test(report.month || "") || !Array.isArray(report.rows)) {
    return res.status(400).json({ error: "Relevé du mois manquant ou invalide." });
  }
  try {
    const buffer = await construireClasseur(report).xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Receptions_linge_${report.month}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur génération Excel : " + err.message });
  }
}
