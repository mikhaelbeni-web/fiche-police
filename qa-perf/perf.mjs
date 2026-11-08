// qa-perf/perf.mjs : temps de chargement de Commande linge et Rapport de
// transition, version « avant » (main) contre « après » (cette branche).
// Lecture seule : les pages lisent la vraie base Firestore, aucune écriture.
// Réseau ralenti par tc netem dans le workflow (latence + débit de 4G).
import { chromium, webkit } from "playwright";
import crypto from "node:crypto";

const TARGETS = { avant: "http://127.0.0.1:3001", apres: "http://127.0.0.1:3002" };
const PAGES = ["/commande-linge", "/transition"];
const RUNS = Number(process.env.RUNS || 5);
const token = "ok." + crypto.createHmac("sha256", process.env.SESSION_SECRET).update("ok").digest("hex");

async function measure(browserType, base, path, mode) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: "fp_session", value: token, url: base }]);
  const page = await ctx.newPage();
  let fsReq = 0, fsBytes = 0, jsBytes = 0;
  page.on("response", async r => {
    const u = r.url();
    try {
      if (u.includes("firestore.googleapis.com")) { fsReq++; fsBytes += (await r.body()).length; }
      else if (u.endsWith(".js")) jsBytes += Number(r.headers()["content-length"] || (await r.body()).length);
    } catch {}
  });
  const ready = () => page.waitForFunction(p => {
    const h1 = document.querySelector(".toolbar h1");
    return location.pathname === p && h1 && !document.querySelector(".empty-state")?.textContent.includes("Chargement");
  }, path, { timeout: 60000, polling: 20 });
  let ms;
  if (mode === "direct") {
    const t0 = Date.now();
    await page.goto(base + path);
    await ready();
    ms = Date.now() - t0;
  } else {
    // Navigation par le menu depuis la fiche police (page déjà ouverte).
    await page.goto(base + "/");
    await page.waitForFunction(() => window.next && window.next.router && document.querySelector(".toolbar, nav"), null, { timeout: 60000 });
    await page.waitForTimeout(3000); // le temps d'ouvrir le menu
    fsReq = 0; fsBytes = 0; jsBytes = 0;
    const t0 = Date.now();
    await page.evaluate(p => window.next.router.push(p), path);
    await ready();
    ms = Date.now() - t0;
  }
  await page.waitForTimeout(300);
  await browser.close();
  return { ms, fsReq, fsKo: Math.round(fsBytes / 1024), jsKo: Math.round(jsBytes / 1024) };
}

const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const out = [];
for (const [bname, bt] of [["chromium", chromium], ["webkit", webkit]]) {
  for (const path of PAGES) for (const mode of ["direct", "menu"]) for (const [ver, base] of Object.entries(TARGETS)) {
    const res = [];
    for (let i = 0; i < RUNS; i++) {
      try { res.push(await measure(bt, base, path, mode)); } catch (e) { console.log("échec", bname, path, mode, ver, e.message.split("\n")[0]); }
    }
    if (!res.length) continue;
    const row = { navigateur: bname, page: path, mode, version: ver, mediane_ms: med(res.map(r => r.ms)), essais_ms: res.map(r => r.ms).join(" "), requetes_firestore: med(res.map(r => r.fsReq)), firestore_ko: med(res.map(r => r.fsKo)), js_ko: med(res.map(r => r.jsKo)) };
    console.log(JSON.stringify(row));
    out.push(row);
  }
}
console.log("\n=== RÉSUMÉ ===");
console.table(out.map(({ essais_ms, ...r }) => r));
