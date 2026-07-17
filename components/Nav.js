// components/Nav.js
// Navigation principale partagée entre toutes les pages.
// 4 onglets principaux au même niveau : Fiches · Arrivées · Ménages · Commande linge
// Sous-liens secondaires accessibles via un menu "Plus".
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";

const MAIN = [
  { href: "/", label: "Fiches de police" },
  { href: "/arrivees", label: "Arrivées" },
  { href: "/menage", label: "Ménages" },
  { href: "/commande-linge", label: "Commande linge" },
  { href: "/linge", label: "Linge Belleville" },
];

const MORE = [
  { href: "/couts", label: "Coûts ménage" },
  { href: "/taxes", label: "Taxes de séjour / Espèces" },
  { href: "/consignes", label: "Consignes à bagages" },
  { href: "/contacts", label: "Contacts" },
  { href: "/codes", label: "Codes d'accès" },
];

export default function Nav() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const current = router.pathname;

  return (
    <nav className="main-nav">
      {MAIN.map(m => (
        <Link key={m.href} href={m.href}
          className={`main-nav-item${current === m.href ? " active" : ""}`}>
          {m.label}
        </Link>
      ))}
      <div className="more-menu">
        <button className="main-nav-item more-btn" onClick={() => setOpen(!open)}>
          Plus ▾
        </button>
        {open && (
          <div className="more-dropdown">
            {MORE.map(m => (
              <Link key={m.href} href={m.href} className="more-link"
                onClick={() => setOpen(false)}>
                {m.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
