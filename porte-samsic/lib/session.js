// porte-samsic/lib/session.js
// SERVEUR UNIQUEMENT. Mot de passe du portail et session de l'opérateur.
//
// - Le mot de passe n'existe nulle part en clair : seul son hash PBKDF2-SHA256 est dans la
//   variable Vercel MOT_DE_PASSE_HASH (même format que l'outil generer-hash.html).
// - Une connexion réussie pose le cookie porte_session (HttpOnly, Secure, SameSite=Strict),
//   signé HMAC avec une clé dérivée de SESSION_SECRET et du hash : changer le mot de passe
//   déconnecte tout le monde. Durée : 12 h, jamais prolongée par l'usage.
// - 5 mauvais mots de passe depuis la même adresse bloquent la connexion 15 minutes
//   (mémoire de l'instance serveur : un frein, pas une garantie absolue).

import crypto from "crypto";

export const COOKIE = "porte_session";
export const TTL_SECONDES = 12 * 60 * 60;
const DIGEST = "sha256";
const MAX_ESSAIS = 5;
const FENETRE_MS = 15 * 60 * 1000;

// ---------- Mot de passe ----------

export function hashMotDePasse(motDePasse, { iterations = 600000, sel } = {}) {
  const s = sel || crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(String(motDePasse), s, iterations, 32, DIGEST);
  return `pbkdf2$${DIGEST}$${iterations}$${s.toString("base64")}$${h.toString("base64")}`;
}

export function verifierMotDePasse(motDePasse, stocke) {
  if (typeof motDePasse !== "string" || !motDePasse || motDePasse.length > 200 || typeof stocke !== "string") return false;
  const parts = stocke.trim().split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== DIGEST) return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 5000000) return false;
  let sel, attendu;
  try { sel = Buffer.from(parts[3], "base64"); attendu = Buffer.from(parts[4], "base64"); } catch { return false; }
  if (sel.length < 8 || attendu.length < 16) return false;
  const obtenu = crypto.pbkdf2Sync(motDePasse, sel, iterations, attendu.length, DIGEST);
  return crypto.timingSafeEqual(obtenu, attendu);
}

// ---------- Configuration ----------

function hashConfig() { return (process.env.MOT_DE_PASSE_HASH || "").trim(); }

export function isConfigure() {
  return Boolean(process.env.SESSION_SECRET && hashConfig() && process.env.HOTEL_DESK_URL && process.env.PORTE_SAMSIC_CLE);
}

export function manques() {
  return ["SESSION_SECRET", "MOT_DE_PASSE_HASH", "HOTEL_DESK_URL", "PORTE_SAMSIC_CLE"].filter(k => !(process.env[k] || "").trim());
}

function cleSignature() {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET).update("porte_session:v1:" + hashConfig()).digest();
}

// ---------- Jeton de session ----------

// Jeton : "v1.<expiration en secondes epoch>.<HMAC hex>"
export function creerJeton(nowMs = Date.now()) {
  if (!isConfigure()) throw new Error("Portail non configuré.");
  const exp = Math.floor(nowMs / 1000) + TTL_SECONDES;
  const payload = `v1.${exp}`;
  const sig = crypto.createHmac("sha256", cleSignature()).update(payload).digest("hex");
  return { jeton: `${payload}.${sig}`, exp };
}

// Renvoie l'expiration (secondes) si le jeton est valide, sinon 0.
export function verifierJeton(jeton, nowMs = Date.now()) {
  if (!isConfigure() || typeof jeton !== "string") return 0;
  const parts = jeton.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^\d{1,12}$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return 0;
  const attendu = crypto.createHmac("sha256", cleSignature()).update(`${parts[0]}.${parts[1]}`).digest();
  const donne = Buffer.from(parts[2], "hex");
  if (donne.length !== attendu.length || !crypto.timingSafeEqual(donne, attendu)) return 0;
  const exp = Number(parts[1]);
  const now = Math.floor(nowMs / 1000);
  if (exp <= now || exp > now + TTL_SECONDES) return 0;
  return exp;
}

function cookies(req) {
  const raw = (req && req.headers && req.headers.cookie) || "";
  const out = {};
  raw.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignoré */ } }
  });
  return out;
}

export function expirationSession(req, nowMs = Date.now()) {
  return verifierJeton(cookies(req)[COOKIE], nowMs);
}

export function enteteCookie(jeton) {
  return `${COOKIE}=${encodeURIComponent(jeton)}; Path=/; Max-Age=${TTL_SECONDES}; HttpOnly; Secure; SameSite=Strict`;
}

export function enteteCookieVide() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

// Pour les routes /api/* : renvoie true si la session est valide, sinon répond 401 et renvoie false.
export function exigerSession(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!isConfigure()) { res.status(503).json({ ok: false, error: "Portail non configuré." }); return false; }
  if (expirationSession(req) > 0) return true;
  res.status(401).json({ ok: false, error: "Session expirée : reconnectez-vous." });
  return false;
}

// ---------- Freins ----------

const essais = new Map(); // ip -> { count, resetAt }

export function adresse(req) {
  const fwd = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || "inconnue";
}

export function connexionBloquee(req, nowMs = Date.now()) {
  const a = essais.get(adresse(req));
  return Boolean(a && a.resetAt > nowMs && a.count >= MAX_ESSAIS);
}

export function noterEchec(req, nowMs = Date.now()) {
  const ip = adresse(req);
  const a = essais.get(ip);
  if (!a || a.resetAt <= nowMs) essais.set(ip, { count: 1, resetAt: nowMs + FENETRE_MS });
  else a.count += 1;
}

export function effacerEchecs(req) { essais.delete(adresse(req)); }

export function _resetPourTests() { essais.clear(); }
