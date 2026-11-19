// components/CodesTabs.js
// Sous-onglets de « Codes d'accès ». Pour un admin : onglets Codes / Espace admin.
// Pour un non-admin : seulement un petit lien discret « 🔒 Admin » vers la page
// de connexion (le mot « Espace admin » et le lien /codes/admin n'existent pas).
// L'accès reste protégé côté serveur (lib/adminAuth.js) : ce lien ne mène qu'au
// formulaire de code. isAdmin vient du serveur (getServerSideProps), jamais du navigateur.
// Écrit sans JSX pour être testable directement avec Node (tests/codes-tabs.test.mjs).
import { createElement as h } from "react";
import Link from "next/link";

export const CODES_TABS = [
  { href: "/codes", label: "Codes" },
  { href: "/codes/admin", label: "Espace admin" },
];

export const ADMIN_LOGIN_HREF = "/codes/admin/connexion";

export default function CodesTabs({ isAdmin, current }) {
  if (isAdmin !== true) {
    return h("div", { className: "codes-admin-discret" },
      h(Link, { href: ADMIN_LOGIN_HREF, title: "Accès administrateur", "aria-label": "Accès administrateur" }, "🔒 Admin"));
  }
  return h("nav", { className: "codes-tabs", "aria-label": "Sous-onglets Codes d'accès" },
    CODES_TABS.map(t => h(Link, {
      key: t.href,
      href: t.href,
      className: `codes-tab${current === t.href ? " active" : ""}`,
      "aria-current": current === t.href ? "page" : undefined,
    }, t.label)));
}
