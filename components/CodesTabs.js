// components/CodesTabs.js
// Sous-onglets de « Codes d'accès ». Rendu UNIQUEMENT pour un admin : pour un
// non-admin, le composant renvoie null, donc ni le lien ni le mot « Espace admin »
// n'existent dans la page (pas un simple masquage CSS). isAdmin vient du serveur
// (getServerSideProps, voir lib/adminAuth.js), jamais d'un état du navigateur.
// Écrit sans JSX pour être testable directement avec Node (tests/codes-tabs.test.mjs).
import { createElement as h } from "react";
import Link from "next/link";

export const CODES_TABS = [
  { href: "/codes", label: "Codes" },
  { href: "/codes/admin", label: "Espace admin" },
];

export default function CodesTabs({ isAdmin, current }) {
  if (isAdmin !== true) return null;
  return h("nav", { className: "codes-tabs", "aria-label": "Sous-onglets Codes d'accès" },
    CODES_TABS.map(t => h(Link, {
      key: t.href,
      href: t.href,
      className: `codes-tab${current === t.href ? " active" : ""}`,
      "aria-current": current === t.href ? "page" : undefined,
    }, t.label)));
}
