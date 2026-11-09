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

// Sur téléphone (≤ 640 px, voir globals.css) la barre d'onglets est remplacée
// par une barre compacte : bouton « Menu » + nom de la page en cours. Le menu
// s'ouvre en panneau plein écran, une page par ligne de 48 px. Les deux
// variantes sont toujours rendues et c'est le CSS qui choisit : pas de
// différence entre le rendu serveur et le navigateur.

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
  { href: "/incendie", label: "Sécurité incendie" },
  { href: "/taches", label: "Tâches" },
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
  const [sheet, setSheet] = useState(false);
  // Une sous-page (ex. /codes/admin) garde son onglet parent actif.
  const isCurrent = href => current === href || (href !== "/" && current.startsWith(href + "/"));
  const currentLabel = (ALL_ITEMS.find(m => isCurrent(m.href)) || {}).label || "Menu";

  // Fermer menus et panneau à chaque changement de page.
  useEffect(() => {
    const close = () => { setOpen(false); setSheet(false); };
    router.events.on("routeChangeStart", close);
    return () => router.events.off("routeChangeStart", close);
  }, [router.events]);

  // Panneau ouvert : la page dessous ne défile plus ; Échap ferme.
  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = e => { if (e.key === "Escape") setSheet(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [sheet]);

  // Menu « Plus » : un clic ailleurs le ferme.
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

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
    <>
    <nav className="mobile-nav" aria-label="Navigation">
      <button className="mobile-nav-btn" aria-expanded={sheet} aria-controls="mobile-nav-sheet"
        onClick={() => setSheet(true)}>
        <span className="mobile-nav-burger" aria-hidden="true"><i /><i /><i /></span>
        Menu
      </button>
      <span className="mobile-nav-title">{currentLabel}</span>
    </nav>
    {sheet && (
      <div className="mobile-nav-overlay" onClick={() => setSheet(false)}>
        <div id="mobile-nav-sheet" className="mobile-nav-sheet" role="dialog" aria-modal="true"
          aria-label="Toutes les pages" onClick={e => e.stopPropagation()}>
          <div className="mobile-nav-sheet-head">
            <span>Toutes les pages</span>
            <button className="mobile-nav-close" onClick={() => setSheet(false)} aria-label="Fermer le menu">✕</button>
          </div>
          {ALL_ITEMS.map(m => (
            <Link key={m.href} href={m.href} onClick={() => setSheet(false)}
              className={`mobile-nav-link${isCurrent(m.href) ? " active" : ""}`}
              aria-current={isCurrent(m.href) ? "page" : undefined}>
              {m.label}
            </Link>
          ))}
        </div>
      </div>
    )}
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
          className={`main-nav-item${isCurrent(m.href) ? " active" : ""}`}>
          {m.label}
        </Link>
      ))}
      {overflow.length > 0 && (
        <div className="more-menu">
          <button className="main-nav-item more-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
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
    </>
  );
}
