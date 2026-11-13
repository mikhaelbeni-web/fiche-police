// qa-mobile/audit.mjs
// Audit smartphone des pages HOTEL DESK : app réelle (next build + start),
// Firestore = émulateur local rempli de données FICTIVES (qa-mobile/fixtures),
// routes /api/* du navigateur interceptées avec des réponses fictives.
// Aucune donnée réelle, aucune écriture hors de l'émulateur.
//
// Usage : BASE_URL=http://127.0.0.1:3000 FS_EMU=127.0.0.1:8080 node qa-mobile/audit.mjs [page...]
import { chromium, webkit } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const FS_EMU = process.env.FS_EMU || "127.0.0.1:8080";
const PROJECT = process.env.FS_PROJECT || "demo-qa";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const FIX = path.join(DIR, "fixtures");
const OUT = path.join(DIR, "out");
const NOW = new Date("2026-11-08T10:00:00+01:00");

// Pages de ce thread (Sinistres et pages hors des autres threads).
const ALL_PAGES = [
  "sinistres", "incendie", "checklist", "linge", "transition",
  "taxes", "taches", "consignes", "contacts", "codes",
];
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ALL_PAGES;

const DEVICES = [
  { name: "android-360", browser: "chromium", viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { name: "iphone-390", browser: "webkit", viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { name: "iphone-430", browser: "webkit", viewport: { width: 430, height: 739 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  // Ordinateur : seulement si QA_PC=1 (captures de contrôle, pas d'audit tactile).
  ...(process.env.QA_PC ? [{ name: "pc-1280", browser: "chromium", viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }] : []),
  { name: "iphone-paysage", browser: "webkit", viewport: { width: 844, height: 340 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, light: true },
];

function readJson(f, dflt) {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; }
}

// ---------- Émulateur Firestore ----------
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "object") {
    if (v.__timestamp) return { timestampValue: new Date(v.__timestamp).toISOString() };
    const fields = {};
    for (const [k, x] of Object.entries(v)) fields[k] = enc(x);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function seedFirestore() {
  const root = `http://${FS_EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  await fetch(root, { method: "DELETE" });
  const merged = {};
  for (const f of fs.readdirSync(FIX).filter(f => f.endsWith(".firestore.json"))) {
    const data = readJson(path.join(FIX, f), {});
    for (const [col, docs] of Object.entries(data)) {
      merged[col] = { ...(merged[col] || {}), ...docs };
    }
  }
  let n = 0;
  for (const [col, docs] of Object.entries(merged)) {
    for (const [id, data] of Object.entries(docs)) {
      const fields = enc(data).mapValue?.fields || {};
      // col peut contenir des sous-collections : "a/b/c"
      const url = `http://${FS_EMU}/v1/projects/${PROJECT}/databases/(default)/documents/${col}/${encodeURIComponent(id)}`;
      const r = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
        body: JSON.stringify({ fields }),
      });
      if (!r.ok) console.error("seed KO", col, id, r.status, (await r.text()).slice(0, 200));
      else n++;
    }
  }
  console.log(`Firestore fictif : ${n} documents`);
}

// ---------- Mesures dans la page ----------
function measure() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sel = (el) => {
    const parts = [];
    let e = el;
    for (let i = 0; e && e.nodeType === 1 && i < 4; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += "#" + e.id;
      const cls = (typeof e.className === "string" ? e.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      parts.unshift(s);
    }
    const t = (el.innerText || el.value || el.getAttribute?.("aria-label") || el.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return parts.join(" > ") + (t ? ` « ${t} »` : "");
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Un élément dans un conteneur à défilement horizontal volontaire ne déborde pas la page.
  const inScroller = (el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const ox = getComputedStyle(e).overflowX;
      if ((ox === "auto" || ox === "scroll" || ox === "hidden") && e.getBoundingClientRect().right <= vw + 1) return true;
    }
    return false;
  };
  const res = { scrollWidth: document.documentElement.scrollWidth, vw, overflow: [], offscreen: [], small: [], covered: [], inputFont: [], clipped: [] };

  // a. Débordement horizontal : éléments les plus hauts qui dépassent.
  if (res.scrollWidth > vw + 1) {
    const all = Array.from(document.body.querySelectorAll("*"));
    const over = all.filter(el => visible(el) && el.getBoundingClientRect().right > vw + 1 && !inScroller(el));
    const top = over.filter(el => !over.includes(el.parentElement));
    res.overflow = top.slice(0, 8).map(el => ({ sel: sel(el), right: Math.round(el.getBoundingClientRect().right) }));
  }

  // b. Éléments interactifs.
  const inter = Array.from(document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary"))
    .filter(el => visible(el) && !el.closest(".main-nav-measure"));
  for (const el of inter) {
    const r = el.getBoundingClientRect();
    const abs = { left: r.left + window.scrollX, right: r.right + window.scrollX };
    if ((abs.right > vw + 1 || abs.left < -1) && !inScroller(el)) res.offscreen.push({ sel: sel(el), left: Math.round(abs.left), right: Math.round(abs.right) });
    const isCheck = el.type === "checkbox" || el.type === "radio";
    // Case à cocher : on mesure son label cliquable s'il existe.
    let box = r;
    if (isCheck) { const lab = el.closest("label"); if (lab) box = lab.getBoundingClientRect(); }
    if (box.width < 44 || box.height < 44) res.small.push({ sel: sel(el), w: Math.round(box.width), h: Math.round(box.height) });
    if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) && !isCheck) {
      const fz = parseFloat(getComputedStyle(el).fontSize);
      if (fz < 16) res.inputFont.push({ sel: sel(el), fontSize: fz });
    }
  }
  // c. Texte coupé sans intention (overflow hidden sans ellipsis).
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (!visible(el) || !el.childNodes.length) continue;
    const cs = getComputedStyle(el);
    if ((cs.overflowX === "hidden" || cs.overflow === "hidden") && cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 2 && el.innerText?.trim()) {
      res.clipped.push({ sel: sel(el), sw: el.scrollWidth, cw: el.clientWidth });
    }
  }
  res.interactiveCount = inter.length;
  return res;
}

// Recouvrement : on centre chaque élément à l'écran et on regarde qui est dessus.
async function coveredCheck(page) {
  return page.evaluate(async () => {
    const out = [];
    const els = Array.from(document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button]"))
      .filter(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !el.closest(".main-nav-measure"); });
    for (const el of els.slice(0, 250)) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(el.labels && Array.from(el.labels).some(l => l.contains(hit)))) {
        const d = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
        out.push({ sel: d(el) + " « " + (el.innerText || el.value || el.placeholder || "").trim().slice(0, 30) + " »", by: d(hit) });
      }
    }
    window.scrollTo(0, 0);
    return out;
  });
}

async function settle(page) {
  // Pas de "networkidle" : Firestore garde une connexion ouverte en permanence.
  await page.waitForTimeout(2500);
}

async function runStep(page, step) {
  if (step.click) await page.locator(step.click).first().click({ timeout: 5000 });
  if (step.fill) {
    const f = typeof step.fill === "string" ? { selector: step.fill, value: step.value } : step.fill;
    await page.locator(f.selector).first().fill(String(f.value ?? ""), { timeout: 5000 });
  }
  if (step.select) await page.locator(step.select).first().selectOption(step.value, { timeout: 5000 });
  if (step.code) {
    // Fenêtre de code (CodeModal) : saisie du code de test puis validation.
    await page.locator(".code-modal input").fill(step.code);
    await page.keyboard.press("Enter");
  }
  if (step.wait) await page.waitForTimeout(step.wait);
  await page.waitForTimeout(500);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(FIX, { recursive: true });
  await seedFirestore();
  const api = {};
  for (const f of fs.readdirSync(FIX).filter(f => f.endsWith(".api.json"))) Object.assign(api, readJson(path.join(FIX, f), {}));
  const ls = {};
  for (const f of fs.readdirSync(FIX).filter(f => f.endsWith(".localstorage.json"))) Object.assign(ls, readJson(path.join(FIX, f), {}));

  const report = [];
  const browsers = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("délai dépassé " + ms + " ms")), ms))]);
  await Promise.all(DEVICES.map(async (dev) => {
    const ctx = await browsers[dev.browser].newContext({
      viewport: dev.viewport, isMobile: dev.browser === "chromium" ? dev.isMobile : undefined,
      hasTouch: dev.hasTouch, deviceScaleFactor: dev.deviceScaleFactor,
      locale: "fr-FR", timezoneId: "Europe/Paris",
    });
    await ctx.addInitScript((items) => { for (const [k, v] of Object.entries(items)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); }, ls);
    // Connexion (code par défaut hors Vercel).
    const auth = await ctx.request.post(BASE + "/api/auth", { data: { code: process.env.ACCESS_CODE || "188" } });
    if (!auth.ok()) console.error("auth KO", auth.status());
    await ctx.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/auth") return route.continue();
      if (api[u.pathname] !== undefined) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(api[u.pathname]) });
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "mock absent : " + u.pathname }) });
    });

    for (const p of PAGES) {
      const states = [{ name: "", steps: [] }, ...(dev.light ? [] : readJson(path.join(FIX, `${p}.states.json`), []))];
      for (const st of states) {
        const page = await ctx.newPage();
        await page.clock.setFixedTime(NOW).catch(() => {});
        const errors = [];
        page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
        page.on("pageerror", e => errors.push("pageerror: " + String(e.message).slice(0, 200)));
        page.on("requestfailed", r => { if (!/google|firestore|8080/.test(r.url())) errors.push("requestfailed: " + r.url().slice(0, 120)); });
        let stepError = null;
        try {
          await withTimeout((async () => {
            await page.goto(BASE + "/" + p, { waitUntil: "domcontentloaded", timeout: 30000 });
            await settle(page);
            // WebKit n'envoie pas le cookie « Secure » en http : connexion par l'écran de code.
            if (await page.locator(".gate input").count()) {
              await page.locator(".gate input").fill(process.env.ACCESS_CODE || "188");
              await page.locator(".gate button").click();
              await settle(page);
            }
            for (const s of st.steps || []) await runStep(page, s);
            if ((st.steps || []).length) await page.waitForTimeout(800);
          })(), 60000);
        } catch (e) { stepError = String(e.message).split("\n")[0].slice(0, 200); }
        const m = await withTimeout(page.evaluate(measure), 30000).catch(e => ({ error: String(e) }));
        m.covered = dev.light ? [] : await withTimeout(coveredCheck(page), 30000).catch(() => []);
        const name = p + (st.name ? "__" + st.name : "");
        const shot = path.join(OUT, "screenshots", dev.name, name + ".png");
        fs.mkdirSync(path.dirname(shot), { recursive: true });
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        report.push({ page: p, state: st.name || "(chargement)", device: dev.name, stepError, errors: errors.filter(e => !/mock absent/.test(e)), ...m });
        console.log(`… ${dev.name} ${name}${stepError ? " (étape KO)" : ""}`);
        await page.close().catch(() => {});
      }
    }
    await ctx.close();
  }));
  await browsers.chromium.close();
  await browsers.webkit.close();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  // Résumé lisible dans les logs.
  let defects = 0;
  report.sort((a, b) => (a.page + a.state + a.device).localeCompare(b.page + b.state + b.device));
  for (const r of report) {
    const n = (r.overflow?.length ? 1 : 0) + (r.offscreen?.length || 0) + (r.covered?.length || 0) + (r.inputFont?.length || 0) + (r.clipped?.length || 0);
    defects += n;
    console.log(`${r.device.padEnd(15)} ${(r.page + " " + r.state).padEnd(40)} sw=${r.scrollWidth}/${r.vw} déb=${r.overflow?.length || 0} hors=${r.offscreen?.length || 0} recouv=${r.covered?.length || 0} input<16=${r.inputFont?.length || 0} coupé=${r.clipped?.length || 0} petits=${r.small?.length || 0}/${r.interactiveCount}${r.stepError ? " ÉTAPE KO: " + r.stepError : ""}${r.errors?.length ? " ERREURS: " + r.errors.length : ""}`);
  }
  console.log(`TOTAL défauts bloquants (hors cibles < 44 px) : ${defects}`);
}

main().catch(e => { console.error(e); process.exit(1); });
