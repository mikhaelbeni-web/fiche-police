// pages/api/admin/nuki/etat.js
// Serrures Nuki + codes clavier, SANS les valeurs des codes (voir lib/nuki.js).
// Admin uniquement (404 sinon).
import { requireAdminApi } from "../../../../lib/adminAuth";
import { lireTout, isNukiConfigured } from "../../../../lib/nuki";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (!requireAdminApi(req, res)) return;
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  if (!isNukiConfigured()) return res.status(500).json({ ok: false, etape: "configuration", error: "Jeton Nuki absent : créez la variable NUKI_API_TOKEN dans Vercel puis redéployez." });
  const t0 = Date.now();
  try {
    const out = await lireTout();
    return res.status(200).json({ ok: true, dureeMs: Date.now() - t0, lueLe: new Date().toISOString(), ...out });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, etape: e.step || null, error: e.message, detail: e.detail ?? null });
  }
}
