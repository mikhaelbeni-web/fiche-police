# notes-widget (mounted on every page via _app.js, inside Gate)
Renders: a fixed round 📝 FAB bottom-right (`button.notes-fab`, aria-label "Notes"); click opens `.notes-panel` (full height side panel) with title, close ✕, subtitle, a single big textarea and a status line. Screenshot it on any light page, e.g. /consignes or /checklist.
Collection: `shared_notes/main` {content (string, multi-line), updatedAt (ISO string)}. Read with getDoc + live onSnapshot. Typing auto-saves after 700 ms (setDoc) -> states must NOT type in the textarea. Fixture content: ~25 lines incl. a very long URL without spaces.
State: "panneau-notes-ouvert" = click the FAB (read-only). Closing = click ✕ (`.notes-panel-close`).
Mobile risks:
- globals.css:681-688 + 707 FAB fixed at bottom:16px/right:16px, 42×42, z-index 900, semi-transparent: it permanently covers the bottom-right corner — on /consignes and /checklist that is exactly where the last table column (✕ delete / check buttons) and the bottom-of-form primary buttons end up when scrolled to the end. No safe-area-inset (iPhone home indicator).
- globals.css:698 `.notes-panel-close`: font-size 16px, background none, no padding/min size -> ~20×20px tap target in the corner; it's the only way to close (no overlay click, no Escape).
- globals.css:708 panel becomes 100vw full screen on mobile (OK) but `top:0; bottom:0` with the on-screen keyboard: textarea flex:1 may be hidden under the iOS keyboard; uses 100vh-like fixed positioning without dvh.
- globals.css:700-703 textarea font 14px but forced to 16px on mobile by globals.css:1107 (no iOS zoom) — fine. Long unbroken URL wraps inside textarea (soft wrap) — OK.
- NotesWidget.js:330 the emoji-only button has aria-label, fine; opacity .55 on dark/blue backgrounds is hard to see.
