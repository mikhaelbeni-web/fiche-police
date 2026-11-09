// pages/api/admin/igloohome/devices.js
// « Tester la connexion igloohome » : jeton (scopes de lecture seulement) + liste des serrures.
// Admin uniquement (404 sinon). Lecture seule : voir lib/igloohome.js.
import { requireAdminApi } from "../../../../lib/adminAuth";
import { apiGet, summarizeDevices, getToken, READ_SCOPES, apiBase } from "../../../../lib/igloohome";

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Lecture seule." });
  }
  const t0 = Date.now();
  try {
    const tok = await getToken();
    const { url, data } = await apiGet("/devices");
    return res.status(200).json({
      ok: true,
      dureeMs: Date.now() - t0,
      api: apiBase(),
      scopesDemandes: READ_SCOPES,
      scopesAccordes: tok.scope,
      requete: url,
      serrures: summarizeDevices(data),
      brut: data,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message, detail: e.detail ?? null, api: apiBase() });
  }
}
