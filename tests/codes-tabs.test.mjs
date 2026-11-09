// tests/codes-tabs.test.mjs
// Rendu réel du sous-onglet : pour un non-admin, rien n'est produit (pas de
// lien, pas de texte « Espace admin »), donc rien à masquer en CSS.
// Nécessite react, react-dom et next installés (npm ci) ; ignoré sinon.
import test from "node:test";
import assert from "node:assert/strict";

let deps = null;
try {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const CodesTabs = (await import("../components/CodesTabs.js")).default;
  deps = { React, renderToStaticMarkup, CodesTabs };
} catch (e) {
  deps = null;
}

test("non-admin : le sous-onglet « Espace admin » n'existe pas dans le rendu", { skip: !deps && "react/next non installés" }, () => {
  const { React, renderToStaticMarkup, CodesTabs } = deps;
  for (const isAdmin of [false, undefined, null, "true", 1]) {
    const html = renderToStaticMarkup(React.createElement(CodesTabs, { isAdmin, current: "/codes" }));
    assert.equal(html, "", `isAdmin=${String(isAdmin)}`);
  }
});

test("admin : le sous-onglet pointe vers /codes/admin", { skip: !deps && "react/next non installés" }, () => {
  const { React, renderToStaticMarkup, CodesTabs } = deps;
  const html = renderToStaticMarkup(React.createElement(CodesTabs, { isAdmin: true, current: "/codes" }));
  assert.match(html, /Espace admin/);
  assert.match(html, /href="\/codes\/admin"/);
});
