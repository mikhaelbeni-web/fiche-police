// tests/codes-tabs.test.mjs
// Rendu réel du sous-onglet : pour un non-admin, rien n'est produit (pas de
// lien, pas de texte « Espace admin »), donc rien à masquer en CSS.
// Nécessite react, react-dom et next installés (npm ci) ; ignoré sinon.
import test from "node:test";
import assert from "node:assert/strict";

// Ignoré seulement si react n'est pas installé (sandbox sans npm). Si react est
// là, toute erreur d'import du composant fait échouer le test au lieu de l'ignorer.
let deps = null;
let React = null;
try { React = await import("react"); } catch { React = null; }
if (React) {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const CodesTabs = (await import("../components/CodesTabs.js")).default;
  deps = { React: React.default || React, renderToStaticMarkup, CodesTabs };
}

test("non-admin : le sous-onglet « Espace admin » n'existe pas dans le rendu", { skip: !deps && "react non installé" }, () => {
  const { React, renderToStaticMarkup, CodesTabs } = deps;
  for (const isAdmin of [false, undefined, null, "true", 1]) {
    const html = renderToStaticMarkup(React.createElement(CodesTabs, { isAdmin, current: "/codes" }));
    assert.equal(html, "", `isAdmin=${String(isAdmin)}`);
  }
});

test("admin : le sous-onglet pointe vers /codes/admin", { skip: !deps && "react non installé" }, () => {
  const { React, renderToStaticMarkup, CodesTabs } = deps;
  const html = renderToStaticMarkup(React.createElement(CodesTabs, { isAdmin: true, current: "/codes" }));
  assert.match(html, /Espace admin/);
  assert.match(html, /href="\/codes\/admin"/);
});
