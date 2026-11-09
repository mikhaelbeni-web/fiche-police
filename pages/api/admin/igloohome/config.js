// pages/api/admin/igloohome/config.js
// Table de correspondance serrure -> appartement, codes du personnel et réglages du
// croisement. Admin uniquement (404 sinon). Stockage privé et chiffré : lib/adminStore.js.
// Ne touche jamais igloohome : c'est notre propre configuration.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { readDoc, writeDoc } from "../../../../lib/adminStore";
import { emptyConfig, sanitizeConfig } from "../../../../lib/croisement";

const DOC = "igloohome_croisement";

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  try {
    if (req.method === "GET") {
      const cfg = (await readDoc(DOC)) || emptyConfig();
      return res.status(200).json({ ok: true, config: sanitizeConfig(cfg) });
    }
    if (req.method === "PUT") {
      let cfg;
      try { cfg = sanitizeConfig(req.body?.config); }
      catch (e) { return res.status(400).json({ ok: false, etape: "validation", error: e.message }); }
      await writeDoc(DOC, { ...cfg, majLe: new Date().toISOString() });
      return res.status(200).json({ ok: true, config: cfg });
    }
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ ok: false, error: "Méthode non autorisée." });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message });
  }
}
