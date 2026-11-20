// lib/especesEcritures.js
// Écritures de la caisse (Taxes > Gestion des espèces), faites depuis le navigateur
// avec le SDK Firestore, comme avant. Ce module ajoute ce qui manquait :
//   - une saisie envoyée deux fois (double-clic, réseau lent) ne crée qu'une ligne :
//     l'identifiant du document est la clé d'envoi tirée par le formulaire ;
//   - date au jour de Paris, date future refusée, montant contrôlé ;
//   - récupération en une seule transaction (la récupération et le rattachement des
//     lignes réussissent ou échouent ensemble), refusée si une ligne a changé entre-temps ;
//   - rien n'est plus effacé : une ligne supprimée ou une récupération annulée reste
//     en base, marquée (deleted, deletedAt, deleteReason) ;
//   - seule la dernière récupération peut être annulée.
//
// `api` regroupe les fonctions du SDK : { db, collection, doc, runTransaction }.

import { jourParis } from "./especesControle.js";

export const C_ENTREES = "cash_entries";
export const C_RECUPS = "cash_recoveries";

export class EspecesError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Clé d'envoi : une par saisie, gardée tant que la saisie n'a pas réussi.
export function nouvelleCle() {
  const c = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : "";
  return "s" + (c || (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)));
}

export function validerLigne(l, maintenant = new Date()) {
  const type = l?.type;
  if (type !== "client" && type !== "expense") throw new EspecesError("Type invalide.");
  if (!DATE.test(String(l.date || ""))) throw new EspecesError("Date invalide.");
  if (l.date > jourParis(maintenant)) throw new EspecesError("La date ne peut pas être dans le futur.");
  const amount = r2(l.amount);
  if (!Number.isFinite(Number(l.amount)) || amount <= 0 || amount > 100000) throw new EspecesError("Montant invalide.");
  const saisiPar = txt(l.saisiPar, 60);
  if (!saisiPar) throw new EspecesError("Choisis d'abord qui saisit.");
  const out = { type, date: l.date, amount, designation: txt(l.designation), saisiPar };
  if (type === "client") {
    out.client = txt(l.client, 120);
    out.appartement = txt(l.appartement, 60);
    out.arrivalDate = l.arrivalDate && DATE.test(String(l.arrivalDate)) ? l.arrivalDate : "";
    // Réservation Hostaway quand le client a été choisi dans une liste : sert à
    // repérer un même paiement saisi deux fois.
    const res = txt(l.reservationId, 40);
    if (/^[A-Za-z0-9_-]+$/.test(res)) out.reservationId = res;
  } else {
    if (!out.designation) throw new EspecesError("Indique la raison de la dépense.");
    out.fournisseur = txt(l.fournisseur, 120);
  }
  return out;
}

export function motifValide(m) {
  const s = txt(m, 500);
  if (s.length < 5) throw new EspecesError("Motif obligatoire (au moins 5 caractères).");
  return s;
}

const actives = recups => recups.filter(r => !r.deleted)
  .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

export function derniereRecuperation(recups) { return actives(recups)[0] || null; }

// createdAt strictement postérieur à la dernière récupération : l'ordre des
// récupérations ne dépend pas de l'horloge (parfois fausse) de l'appareil.
export function horodatageApres(recups, instant = new Date()) {
  const d = derniereRecuperation(recups);
  let t = instant.getTime();
  const td = d ? Date.parse(d.createdAt || "") : NaN;
  if (Number.isFinite(td) && t <= td) t = td + 1;
  return new Date(t).toISOString();
}

// Nouvelle ligne. Renvoie { id, dejaEnregistree }.
export async function ajouterLigne(api, ligne, cle, maintenant = new Date()) {
  const base = validerLigne(ligne, maintenant);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(cle || ""))) throw new EspecesError("Clé d'envoi manquante : recharge la page.");
  const ref = api.doc(api.db, C_ENTREES, cle);
  return api.runTransaction(api.db, async tx => {
    const deja = await tx.get(ref);
    if (deja.exists()) return { id: cle, dejaEnregistree: true };
    tx.set(ref, { ...base, recoveryId: null, createdAt: maintenant.toISOString() });
    return { id: cle, dejaEnregistree: false };
  });
}

// Suppression logique d'une ligne pas encore récupérée.
export async function supprimerLigne(api, id, motif, maintenant = new Date()) {
  const raison = motifValide(motif);
  const ref = api.doc(api.db, C_ENTREES, id);
  return api.runTransaction(api.db, async tx => {
    const s = await tx.get(ref);
    if (!s.exists()) throw new EspecesError("Ligne introuvable.");
    const e = s.data();
    if (e.deleted) throw new EspecesError("Ligne déjà supprimée.");
    if (e.recoveryId) throw new EspecesError("Ligne déjà récupérée : annule d'abord la récupération.");
    tx.update(ref, { deleted: true, deletedAt: maintenant.toISOString(), deleteReason: raison });
  });
}

// Récupération : enregistre la récupération et rattache les lignes en cours, en une fois.
// `entrees` et `recups` = l'état lu par la page ; la transaction vérifie qu'il n'a pas
// changé (ligne ajoutée, supprimée ou déjà récupérée sur un autre appareil).
export async function recuperer(api, { montant, note, entrees, recups, faitPar }, maintenant = new Date()) {
  const enCours = entrees.filter(e => !e.deleted && !e.recoveryId);
  const derniere = derniereRecuperation(recups);
  const baseline = derniere ? r2(derniere.amountLeftInBox) : 0;
  const total = r2(baseline + enCours.reduce((s, e) => s + (e.type === "expense" ? -1 : 1) * (Number(e.amount) || 0), 0));
  const rec = r2(montant);
  if (!(total > 0)) throw new EspecesError("La caisse est vide ou négative, rien à récupérer.");
  if (!(rec >= 0) || rec > total + 0.001) throw new EspecesError("Le montant récupéré ne peut pas dépasser le total en caisse.");
  const left = r2(total - rec);
  const recRef = api.doc(api.collection(api.db, C_RECUPS));
  const doc = {
    date: jourParis(maintenant), amountRecovered: rec, amountLeftInBox: left, note: txt(note, 300),
    totalAvant: total, entryIds: enCours.map(e => e.id), createdAt: horodatageApres(recups, maintenant),
  };
  if (txt(faitPar, 60)) doc.faitPar = txt(faitPar, 60);
  await api.runTransaction(api.db, async tx => {
    const refs = enCours.map(e => api.doc(api.db, C_ENTREES, e.id));
    const lus = await Promise.all(refs.map(r => tx.get(r)));
    if (derniere) {
      const d = await tx.get(api.doc(api.db, C_RECUPS, derniere.id));
      if (!d.exists() || d.data().deleted) throw new EspecesError("La caisse a changé sur un autre appareil : actualise la page.");
    }
    lus.forEach((s, i) => {
      const e = s.exists() ? s.data() : null;
      if (!e || e.deleted || e.recoveryId || r2(e.amount) !== r2(enCours[i].amount)) {
        throw new EspecesError("La caisse a changé sur un autre appareil : actualise la page.");
      }
    });
    tx.set(recRef, doc);
    refs.forEach(r => tx.update(r, { recoveryId: recRef.id }));
  });
  return { id: recRef.id, ...doc };
}

// Annule la dernière récupération : elle reste en base (deleted), ses lignes
// redeviennent « en cours ».
export async function annulerRecuperation(api, { id, motif, entrees, recups }, maintenant = new Date()) {
  const raison = motifValide(motif);
  const derniere = derniereRecuperation(recups);
  if (!derniere || derniere.id !== id) throw new EspecesError("Seule la dernière récupération peut être annulée.");
  const liees = entrees.filter(e => e.recoveryId === id);
  await api.runTransaction(api.db, async tx => {
    const ref = api.doc(api.db, C_RECUPS, id);
    const s = await tx.get(ref);
    if (!s.exists() || s.data().deleted) throw new EspecesError("Récupération introuvable ou déjà annulée.");
    tx.update(ref, { deleted: true, deletedAt: maintenant.toISOString(), deleteReason: raison });
    for (const e of liees) tx.update(api.doc(api.db, C_ENTREES, e.id), { recoveryId: null });
  });
}

// Solde de départ : une « récupération » à 0 récupéré dont le reliquat sert de base.
export async function soldeDepart(api, { date, montant, recups }, maintenant = new Date()) {
  if (!DATE.test(String(date || ""))) throw new EspecesError("Date invalide.");
  if (date > jourParis(maintenant)) throw new EspecesError("La date ne peut pas être dans le futur.");
  const amt = r2(montant);
  if (!(amt > 0)) throw new EspecesError("Montant de départ invalide.");
  const ref = api.doc(api.collection(api.db, C_RECUPS));
  const doc = {
    date, amountRecovered: 0, amountLeftInBox: amt, note: "Solde de départ", totalAvant: amt,
    entryIds: [], createdAt: horodatageApres(recups, maintenant),
  };
  await api.runTransaction(api.db, async tx => { tx.set(ref, doc); });
  return { id: ref.id, ...doc };
}
