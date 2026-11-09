// lib/adminAuth.js
// SERVEUR UNIQUEMENT. Espace admin (onglet Codes d'accès > Espace admin).
//
// Le code d'accès partagé (Gate, cookie fp_session) ne distingue personne :
// le réceptionniste et l'admin ont la même session. L'espace admin ajoute donc
// un second facteur, propre à l'admin :
//   - un mot de passe admin, stocké uniquement sous forme de hash PBKDF2 dans la
//     variable d'environnement ADMIN_PASSWORD_HASH (jamais en clair, jamais dans le dépôt) ;
//   - une session admin distincte : cookie fp_admin signé HMAC, qui expire au bout de 8 h.
//
// La clé de signature de fp_admin est dérivée de SESSION_SECRET et du hash du mot
// de passe : changer le mot de passe invalide immédiatement toutes les sessions admin.
// Sans SESSION_SECRET ou sans ADMIN_PASSWORD_HASH, l'espace admin est fermé (404 partout).
//
// Toute route /api/admin/* et toute page /codes/admin* appelle isAdminRequest()
// AVANT de faire quoi que ce soit. Un non-admin reçoit 404 (l'espace n'existe pas pour lui).

import crypto from "crypto";
import { verifySession } from "./hostaway";

export const ADMIN_COOKIE = "fp_admin";
export const ADMIN_TTL_SECONDS = 8 * 60 * 60;

const PBKDF2_DIGEST = "sha256";

// ---------- Mot de passe ----------

// Format : pbkdf2$sha256$<itérations>$<sel base64>$<hash base64>
// (même format que l'outil de génération du hash, qui utilise WebCrypto dans le navigateur).
export function hashPassword(password, { iterations = 600000, salt } = {}) {
  const s = salt || crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(String(password), s, iterations, 32, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_DIGEST}$${iterations}$${s.toString("base64")}$${h.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== "string" || !password || typeof stored !== "string") return false;
  const parts = stored.trim().split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== PBKDF2_DIGEST) return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 5000000) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[3], "base64");
    expected = Buffer.from(parts[4], "base64");
  } catch { return false; }
  if (salt.length < 8 || expected.length < 16) return false;
  const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length, PBKDF2_DIGEST);
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- Configuration ----------

function passwordHash() {
  return (process.env.ADMIN_PASSWORD_HASH || "").trim();
}

export function isAdminConfigured() {
  return Boolean(process.env.SESSION_SECRET && passwordHash());
}

function signingKey() {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET)
    .update("fp_admin:v1:" + passwordHash())
    .digest();
}

// ---------- Jeton de session admin ----------

// Jeton : "v1.<expiration en secondes epoch>.<HMAC hex>"
export function makeAdminToken(nowMs = Date.now()) {
  if (!isAdminConfigured()) throw new Error("Espace admin non configuré.");
  const exp = Math.floor(nowMs / 1000) + ADMIN_TTL_SECONDS;
  const payload = `v1.${exp}`;
  const sig = crypto.createHmac("sha256", signingKey()).update(payload).digest("hex");
  return { token: `${payload}.${sig}`, exp };
}

// Renvoie la date d'expiration (secondes) si le jeton est valide, sinon 0.
export function verifyAdminToken(token, nowMs = Date.now()) {
  if (!isAdminConfigured() || typeof token !== "string") return 0;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^\d{1,12}$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return 0;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", signingKey()).update(payload).digest();
  const given = Buffer.from(parts[2], "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return 0;
  const exp = Number(parts[1]);
  const now = Math.floor(nowMs / 1000);
  // Expiré, ou expiration plus lointaine que la durée maximale (jeton forgé) : refus.
  if (exp <= now || exp > now + ADMIN_TTL_SECONDS) return 0;
  return exp;
}

function parseCookies(req) {
  const raw = (req && req.headers && req.headers.cookie) || "";
  const out = {};
  raw.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > -1) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* cookie illisible : ignoré */ }
    }
  });
  return out;
}

// ---------- Contrôles ----------

// Admin = session normale valide (code d'accès) ET session admin valide.
// Renvoie l'expiration (secondes epoch) de la session admin, ou 0.
export function adminSessionExpiry(req, nowMs = Date.now()) {
  if (!isAdminConfigured()) return 0;
  if (!verifySession(req)) return 0;
  return verifyAdminToken(parseCookies(req)[ADMIN_COOKIE], nowMs);
}

export function isAdminRequest(req, nowMs = Date.now()) {
  return adminSessionExpiry(req, nowMs) > 0;
}

// Pour les routes /api/admin/* : renvoie true si admin, sinon répond 404 et renvoie false.
export function requireAdminApi(req, res) {
  if (isAdminRequest(req)) {
    res.setHeader("Cache-Control", "no-store");
    return true;
  }
  res.status(404).json({ error: "Introuvable." });
  return false;
}

export function hasAccessSession(req) {
  return verifySession(req);
}

export function adminCookieHeader(token) {
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearAdminCookieHeader() {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

// ---------- Freins contre les essais répétés ----------
// Mémoire de l'instance serveur : limite les essais en rafale, sans prétendre
// bloquer un attaquant distribué (les instances Vercel ne partagent pas cette mémoire).
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(req) {
  const fwd = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || "inconnu";
}

export function loginBlocked(req, nowMs = Date.now()) {
  const a = attempts.get(clientIp(req));
  return Boolean(a && a.resetAt > nowMs && a.count >= MAX_ATTEMPTS);
}

export function recordLoginFailure(req, nowMs = Date.now()) {
  const ip = clientIp(req);
  const a = attempts.get(ip);
  if (!a || a.resetAt <= nowMs) attempts.set(ip, { count: 1, resetAt: nowMs + WINDOW_MS });
  else a.count += 1;
}

export function clearLoginFailures(req) {
  attempts.delete(clientIp(req));
}

export function _resetLoginFailuresForTests() {
  attempts.clear();
}

// ---------- Pages ----------

// getServerSideProps de /codes : indique seulement si le sous-onglet admin doit exister.
export function codesPageProps(ctx) {
  return { props: { isAdmin: isAdminRequest(ctx.req) } };
}

// getServerSideProps des pages de l'espace admin : 404 pour tout non-admin.
export function adminPageProps(ctx) {
  const exp = adminSessionExpiry(ctx.req);
  if (!exp) return { notFound: true };
  ctx.res.setHeader("Cache-Control", "no-store");
  return { props: { isAdmin: true, adminExpiresAt: exp } };
}

// getServerSideProps de la page de connexion admin (adresse non liée dans l'app).
// 404 si l'espace admin n'est pas configuré ; si déjà admin, renvoi vers l'espace admin.
export function adminLoginPageProps(ctx) {
  if (!isAdminConfigured()) return { notFound: true };
  if (isAdminRequest(ctx.req)) return { redirect: { destination: "/codes/admin", permanent: false } };
  ctx.res.setHeader("Cache-Control", "no-store");
  return { props: {} };
}
