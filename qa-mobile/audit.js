// Contrôles mobiles sur la maquette qa-mobile/fixture.html (structure des
// composants communs + styles/globals.css). Lancer : node qa-mobile/audit.js
const { chromium, webkit } = require('playwright');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, 'fixture.html');
const out = path.resolve(__dirname, 'screenshots');
(async () => {
  const browser = await chromium.launch();
  const defects = [];
  for (const w of [360, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(url);
    const r = await page.evaluate(() => {
      const res = { overflow: document.documentElement.scrollWidth - window.innerWidth, small: [], offscreen: [], tinyInputs: [] };
      const sel = el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' «' + (el.textContent || el.value || '').trim().slice(0, 20) + '»';
      document.querySelectorAll('button, a, input, select, textarea, [role=button]').forEach(el => {
        const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || b.width === 0) return;
        const inScroller = el.closest('.tbl-wrap, .tabs');
        if (!inScroller && (b.right > window.innerWidth + 1 || b.left < -1)) res.offscreen.push(sel(el));
        const isBox = el.type === 'checkbox' || el.type === 'radio';
        const target = isBox ? (el.closest('label') || el).getBoundingClientRect() : b;
        if (target.height < 43.5 || target.width < 43.5) res.small.push(sel(el) + ` ${Math.round(target.width)}x${Math.round(target.height)}`);
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !isBox && parseFloat(cs.fontSize) < 16) res.tinyInputs.push(sel(el) + ' ' + cs.fontSize);
      });
      return res;
    });
    if (r.overflow > 0) defects.push(`${w}px: débordement horizontal de ${r.overflow}px`);
    r.offscreen.forEach(x => defects.push(`${w}px: hors écran ${x}`));
    r.small.forEach(x => defects.push(`${w}px: cible < 44px ${x}`));
    r.tinyInputs.forEach(x => defects.push(`${w}px: champ < 16px ${x}`));
    await page.screenshot({ path: `${out}/fixture-${w}.png`, fullPage: true });
    await ctx.close();
  }
  await browser.close();
  console.log(defects.length ? defects.join('\n') : 'Aucun défaut mesurable.');
})();
