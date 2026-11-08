// Audit mobile de /commande-linge : chaque sous-onglet et état, à 360/390/430 px.
// Mesures : débordement horizontal de la page, cibles tactiles < 44 px,
// éléments hors écran, champs < 16 px (zoom iPhone). Captures pleine page.
const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const BASE = "http://localhost:3100";
const OUT = "qa-mobile/out";
const token = "ok." + crypto.createHmac("sha256", process.env.SESSION_SECRET || "audit").update("ok").digest("hex");
const VIEWPORTS = [[360, 740], [390, 844], [430, 932]];
const click = t => async p => { await p.getByRole("button", { name: t, exact: true }).first().click(); await p.waitForTimeout(300); };
const tab = t => click(t);
const STATES = [
  ["position", [tab("Position")]],
  ["position-seuils", [tab("Position"), click("Régler les seuils")]],
  ["stock", [tab("Stock")]],
  ["stock-modifier", [tab("Stock"), click("Modifier le stock de base")]],
  ["commandes", [tab("Commandes")]],
  ["receptions", [tab("Réceptions")]],
  ["receptions-commande", [tab("Réceptions"), async p => { await p.locator("select").first().selectOption({ index: 1 }); await p.waitForTimeout(300); }]],
  ["usage", [tab("Linge utilisé")]],
  ["defects", [tab("Défectueux")]],
  ["cout", [tab("Coût linge")]],
  ["cout-prix", [tab("Coût linge"), click("Modifier les prix unitaires")]],
  ["cout-manuel", [tab("Coût linge"), click("Saisir à la main")]],
  ["cout-resultat", [tab("Coût linge"), async p => { await p.getByRole("button", { name: "Voir le résultat" }).first().click(); await p.waitForTimeout(400); }]],
];
function measure() {
  const vw = window.innerWidth, issues = [];
  const sel = el => { let s = el.tagName.toLowerCase(); if (el.className && typeof el.className === "string") s += "." + el.className.trim().split(/\s+/).join("."); const t = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 30); return t ? `${s} «${t}»` : s; };
  if (document.documentElement.scrollWidth > vw + 1) {
    const wide = [...document.querySelectorAll("body *")].filter(e => { const r = e.getBoundingClientRect(); return r.right > vw + 1 && !e.closest(".tbl-wrap"); }).slice(0, 5).map(sel);
    issues.push(`DÉBORDEMENT page ${document.documentElement.scrollWidth}px > ${vw}px : ${wide.join(" | ")}`);
  }
  for (const el of document.querySelectorAll(".menage-page button, .menage-page input, .menage-page select, .menage-page textarea, .menage-page a")) {
    if (el.closest(".fm-file") || el.type === "file" || el.getAttribute("aria-hidden") === "true") continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const wrap = el.closest(".tbl-wrap");
    const scrolls = wrap && wrap.scrollWidth > wrap.clientWidth + 1;
    if (scrolls) issues.push(`DANS TABLEAU À DÉFILEMENT HORIZONTAL : ${sel(el)}`);
    else if (r.right > vw + 1 || r.left < -1) issues.push(`HORS ÉCRAN ${Math.round(r.left)}→${Math.round(r.right)} : ${sel(el)}`);
    if (r.height < 43.5 || (r.width < 43.5 && el.tagName !== "INPUT")) issues.push(`PETITE CIBLE ${Math.round(r.width)}x${Math.round(r.height)} : ${sel(el)}`);
    if (/INPUT|SELECT|TEXTAREA/.test(el.tagName) && parseFloat(cs.fontSize) < 16) issues.push(`POLICE ${cs.fontSize} (zoom iPhone) : ${sel(el)}`);
  }
  const wraps = [...document.querySelectorAll(".menage-page .tbl-wrap")].filter(w => w.scrollWidth > w.clientWidth + 1).map(w => `${w.scrollWidth}/${w.clientWidth}px`);
  if (wraps.length) issues.push(`TABLEAUX À DÉFILEMENT HORIZONTAL : ${wraps.join(", ")}`);
  return [...new Set(issues)];
}
(async () => {
  const browser = await chromium.launch();
  const rapport = ["# Audit mobile Commande linge", ""];
  let total = 0;
  for (const [w, h] of VIEWPORTS) {
    fs.mkdirSync(`${OUT}/${w}`, { recursive: true });
    for (const [name, steps] of STATES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await ctx.addCookies([{ name: "fp_session", value: token, url: BASE }]);
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", e => errs.push("JS : " + e.message));
      page.on("dialog", d => d.dismiss());
      await page.goto(BASE + "/commande-linge", { waitUntil: "networkidle" });
      await page.waitForSelector(".toolbar .tabs");
      try { for (const s of steps) await s(page); } catch (e) { errs.push("ÉTAPE : " + e.message.split("\n")[0]); }
      const issues = [...errs, ...(await page.evaluate(measure))];
      total += issues.length;
      await page.screenshot({ path: `${OUT}/${w}/${name}.png`, fullPage: true });
      rapport.push(`## ${w}px · ${name} : ${issues.length ? issues.length + " défaut(s)" : "OK"}`, ...issues.map(i => "- " + i), "");
      await ctx.close();
    }
  }
  rapport.splice(1, 0, `Total : ${total} défaut(s) mesuré(s).`);
  fs.writeFileSync(`${OUT}/rapport.md`, rapport.join("\n"));
  await browser.close();
  console.log(rapport.join("\n"));
})();
