// components/Nav.js
// Navigation principale partagée entre toutes les pages.
// Tous les onglets essaient de tenir sur la barre du haut, dans l'ordre de
// priorité ci-dessous ; dès qu'il n'y a plus de place, les suivants basculent
// automatiquement dans le menu "Plus". Recalculé à chaque redimensionnement
// (rotation d'écran, fenêtre redimensionnée, etc.) — plus de liste figée à la
// main entre "toujours visible" et "toujours dans Plus".
import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect, useRef, useCallback } from "react";

const ALL_ITEMS = [
  { href: "/", label: "Fiches de police" },
  { href: "/arrivees", label: "Arrivées" },
  { href: "/menage", label: "Ménages" },
  { href: "/checklist", label: "Check-list" },
  { href: "/commande-linge", label: "Commande linge" },
  { href: "/linge", label: "Linge Belleville" },
  { href: "/transition", label: "Rapport transition" },
  { href: "/couts", label: "Coûts ménage" },
  { href: "/taxes", label: "Taxes de séjour / Espèces" },
  { href: "/sinistres", label: "Sinistres" },
  { href: "/consignes", label: "Consignes à bagages" },
  { href: "/contacts", label: "Contacts" },
  { href: "/codes", label: "Codes d'accès" },
];

const MORE_BTN_WIDTH = 70; // place réservée pour le bouton "Plus ▾" quand il est affiché

export default function Nav() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Par défaut tout visible : évite un "Plus" vide qui clignoterait avant le
  // premier calcul (le calcul réel arrive dès le montage, sur écran normal
  // ça ne se voit jamais).
  const [visibleCount, setVisibleCount] = useState(ALL_ITEMS.length);
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const current = router.pathname;

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const available = container.offsetWidth;
    const itemNodes = Array.from(measure.children);
    let used = 0;
    let count = 0;
    for (let i = 0; i < itemNodes.length; i++) {
      const w = itemNodes[i].offsetWidth;
      const isLast = i === itemNodes.length - 1;
      // Tant qu'il reste des items après celui-ci, on réserve la place du
      // bouton "Plus" ; pour le tout dernier, s'il rentre seul, pas besoin.
      const reserve = isLast ? 0 : MORE_BTN_WIDTH;
      if (used + w + reserve > available) break;
      used += w;
      count = i + 1;
    }
    setVisibleCount(count);
  }, []);

  useEffect(() => {
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [recompute]);

  const visible = ALL_ITEMS.slice(0, visibleCount);
  const overflow = ALL_ITEMS.slice(visibleCount);

  return (
    <nav className="main-nav" ref={containerRef}>
      {/* Copie invisible, hors écran, de TOUS les items — sert uniquement à
          mesurer leur largeur réelle (même police, même padding puisque même
          classe) pour savoir combien en tiennent dans la barre. */}
      <div ref={measureRef} className="main-nav-measure" aria-hidden="true">
        {ALL_ITEMS.map(m => (
          <span key={m.href} className="main-nav-item">{m.label}</span>
        ))}
      </div>

      {visible.map(m => (
        <Link key={m.href} href={m.href}
          className={`main-nav-item${current === m.href ? " active" : ""}`}>
          {m.label}
        </Link>
      ))}
      {overflow.length > 0 && (
        <div className="more-menu">
          <button className="main-nav-item more-btn" onClick={() => setOpen(!open)}>
            Plus ▾
          </button>
          {open && (
            <div className="more-dropdown">
              {overflow.map(m => (
                <Link key={m.href} href={m.href} className="more-link"
                  onClick={() => setOpen(false)}>
                  {m.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
