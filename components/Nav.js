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
];

const MORE = [
  { href: "/couts", label: "Coûts ménage" },
  { href: "/linge", label: "Linge Belleville" },
  { href: "/taxes", label: "Taxes de séjour" },
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
