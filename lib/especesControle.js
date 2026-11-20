// lib/especesControle.js
// Contrôle de cohérence de la caisse, sans dépendance : utilisé par la page
// (Taxes > Gestion des espèces, encadré « Contrôle de caisse ») et par le contrôle
// quotidien (scripts/controle-especes.mjs). Lecture seule : ne modifie rien.
//
// Entrées : lignes (cash_entries) et récupérations (cash_recoveries) telles qu'en base,
// chacune avec son id. Sortie : l'état de la caisse et la liste des anomalies, de la
// plus grave à la moins grave.

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const TOL = 0.009; // tolérance d'arrondi : 1 centime

// Jour calendaire à Paris (AAAA-MM-JJ) d'un instant ; aujourd'hui par défaut.
// toISOString() donne le jour UTC : entre minuit et 1 h (2 h l'été), c'était la veille.
export function jourParis(instant = new Date()) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function ecartJours(a, b) {
  const ta = Date.parse(a + "T12:00:00Z"), tb = Date.parse(b + "T12:00:00Z");
  return Math.round((ta - tb) / 86400000);
}

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
export const estSoldeDepart = r => !(Number(r.amountRecovered) > 0) && (!r.entryIds || r.entryIds.length === 0) && norm(r.note).startsWith("solde de depart");
const signe = e => (e.type === "expense" ? -1 : 1) * (Number(e.amount) || 0);
const libelle = e => [e.type === "client" ? "Paiement" : "Dépense", e.client || e.fournisseur || "", e.designation || "", `${r2(e.amount).toFixed(2)} €`].filter(Boolean).join(" · ");

export function etatCaisse(entrees, recups) {
  const actives = recups.filter(r => !r.deleted).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const derniere = actives[0] || null;
  const baseline = derniere ? r2(derniere.amountLeftInBox) : 0;
  const enCours = entrees.filter(e => !e.deleted && !e.recoveryId);
  const sumClient = r2(enCours.filter(e => e.type === "client").reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const sumExpense = r2(enCours.filter(e => e.type === "expense").reduce((s, e) => s + (Number(e.amount) || 0), 0));
  return { derniere, baseline, enCours, sumClient, sumExpense, total: r2(baseline + sumClient - sumExpense) };
}

// options.periode : "en_cours" (défaut, lignes pas encore récupérées) ou "tout".
// options.maintenant : instant de référence (tests).
export function controlerCaisse(entrees = [], recups = [], options = {}) {
  const periode = options.periode || "en_cours";
  const maintenant = options.maintenant ? new Date(options.maintenant) : new Date();
  const seuilAntidate = options.seuilAntidateJours ?? 3;
  const etat = etatCaisse(entrees, recups);
  const anomalies = [];
  const add = (niveau, code, titre, detail, ids = []) => anomalies.push({ niveau, code, titre, detail, ids });

  const parId = new Map(recups.map(r => [r.id, r]));
  const actives = recups.filter(r => !r.deleted).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const lignesActives = entrees.filter(e => !e.deleted);

  // 1. Chaîne des récupérations : total avant = reliquat précédent + lignes rattachées.
  let prec = 0;
  for (const r of actives) {
    // Un solde de départ remet le compteur à son montant : rien à rapprocher.
    if (estSoldeDepart(r)) { prec = r2(r.amountLeftInBox); continue; }
    const liees = lignesActives.filter(e => e.recoveryId === r.id);
    const attendu = r2(prec + liees.reduce((s, e) => s + signe(e), 0));
    const avant = r2(r.totalAvant);
    if (Math.abs(attendu - avant) > TOL) {
      add("grave", "chaine", `Récupération du ${r.date} : total incohérent`,
        `Le total avant récupération enregistré est ${avant.toFixed(2)} €, alors que le reliquat précédent plus les lignes rattachées donnent ${attendu.toFixed(2)} €.`, [r.id]);
    }
    const somme = r2((Number(r.amountRecovered) || 0) + (Number(r.amountLeftInBox) || 0));
    if (Math.abs(somme - avant) > TOL) {
      add("grave", "repartition", `Récupération du ${r.date} : récupéré + laissé ≠ total`,
        `${r2(r.amountRecovered).toFixed(2)} € + ${r2(r.amountLeftInBox).toFixed(2)} € = ${somme.toFixed(2)} €, pour un total de ${avant.toFixed(2)} €.`, [r.id]);
    }
    if (Array.isArray(r.entryIds) && r.entryIds.length) {
      const ids = new Set(liees.map(e => e.id));
      const manquantes = r.entryIds.filter(id => !ids.has(id));
      if (manquantes.length) {
        add("attention", "rattachement", `Récupération du ${r.date} : ${manquantes.length} ligne(s) prévue(s) mais non rattachée(s)`,
          "Ces lignes figuraient dans la récupération mais ne lui sont plus liées (supprimées ou rattachées ailleurs).", manquantes);
      }
    }
    prec = r2(r.amountLeftInBox);
  }

  // 2. Lignes rattachées à une récupération absente ou annulée : leur argent n'est compté nulle part.
  for (const e of lignesActives) {
    if (!e.recoveryId) continue;
    const r = parId.get(e.recoveryId);
    if (!r || r.deleted) {
      add("grave", "orpheline", "Ligne rattachée à une récupération inexistante",
        `${e.date} · ${libelle(e)} : elle n'entre plus dans le total de la caisse.`, [e.id]);
    }
  }

  // 3. Caisse négative.
  if (etat.total < -TOL) {
    add("grave", "negatif", "La caisse est négative",
      `Le logiciel calcule ${etat.total.toFixed(2)} € : une dépense a été payée avec de l'argent non saisi, ou un encaissement manque.`);
  }

  const cibles = periode === "tout" ? lignesActives : etat.enCours;

  // 4. Doublons probables.
  const vus = new Map();
  for (const e of cibles) {
    let cle;
    if (e.type === "client" && e.reservationId) cle = `res:${e.reservationId}:${norm(e.designation)}`;
    else if (e.type === "client") cle = `cli:${norm(e.client)}:${norm(e.appartement)}:${e.arrivalDate || ""}:${r2(e.amount)}:${norm(e.designation)}`;
    else cle = `dep:${norm(e.fournisseur)}:${e.date}:${r2(e.amount)}:${norm(e.designation)}`;
    if (e.type === "client" && !norm(e.client)) continue; // sans nom : impossible à rapprocher
    if (!vus.has(cle)) vus.set(cle, []);
    vus.get(cle).push(e);
  }
  for (const groupe of vus.values()) {
    if (groupe.length < 2) continue;
    const e = groupe[0];
    add("attention", "doublon", `Saisie en double probable (${groupe.length} fois)`,
      `${libelle(e)}${e.appartement ? ` · appart ${e.appartement}` : ""} : même client, même appartement, même montant. Vérifiez qu'il y a bien eu ${groupe.length} paiements.`,
      groupe.map(x => x.id));
  }

  // 5. Dates : dans le futur, ou très antérieures à la saisie.
  const aujourdHui = jourParis(maintenant);
  for (const e of cibles) {
    if (!e.date) { add("attention", "sans_date", "Ligne sans date", libelle(e), [e.id]); continue; }
    if (e.date > aujourdHui) add("attention", "date_future", `Ligne datée dans le futur (${e.date})`, libelle(e), [e.id]);
    const saisie = e.createdAt ? jourParis(e.createdAt) : "";
    if (saisie) {
      const ecart = ecartJours(saisie, e.date);
      if (ecart > seuilAntidate) {
        add("info", "antidatee", `Saisie ${ecart} jours après la date indiquée`,
          `${libelle(e)} : datée du ${e.date}, saisie le ${saisie}${e.saisiPar ? ` par ${e.saisiPar}` : ""}.`, [e.id]);
      }
    }
  }

  // 6. Lignes sans auteur.
  const sansAuteur = cibles.filter(e => !String(e.saisiPar || "").trim());
  if (sansAuteur.length) add("info", "sans_auteur", `${sansAuteur.length} ligne(s) sans réceptionniste`, "Le nom de la personne qui a saisi manque.", sansAuteur.map(e => e.id));

  // 7. Lignes écrites sans passer par l'application (après l'ouverture du journal).
  const journalisees = entrees.filter(e => e.journalise && e.createdAt).map(e => e.createdAt).sort();
  if (journalisees.length) {
    const debut = journalisees[0];
    const hors = entrees.filter(e => !e.journalise && String(e.createdAt || "") > debut);
    if (hors.length) add("grave", "hors_application", `${hors.length} ligne(s) écrite(s) sans passer par l'application`,
      "Elles ont été ajoutées directement dans la base, sans code personnel ni journal.", hors.map(e => e.id));
  }

  // 8. Suppressions récentes (7 jours) : pour information, avec le motif.
  const il7j = new Date(maintenant.getTime() - 7 * 86400000).toISOString();
  for (const e of entrees.filter(x => x.deleted && String(x.deletedAt || "") >= il7j)) {
    add("info", "suppression", `Ligne supprimée le ${jourParis(e.deletedAt)}`, `${e.date} · ${libelle(e)} · motif : ${e.deleteReason || "—"}`, [e.id]);
  }

  const ordre = { grave: 0, attention: 1, info: 2 };
  anomalies.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
  return { etat: { ...etat, enCours: undefined, nbEnCours: etat.enCours.length }, anomalies, controleLe: maintenant.toISOString() };
}
