// porte-samsic/pages/api/connexion.js
// POST { motDePasse } → pose le cookie de session (12 h). 401 sinon, 429 après 5 échecs.
import { isConfigure, verifierMotDePasse, creerJeton, enteteCookie, connexionBloquee, noterEchec, effacerEchecs, adresse } from "../../lib/session.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Méthode non permise." }); }
  if (!isConfigure()) return res.status(503).json({ ok: false, error: "Portail non configuré." });
  if (connexionBloquee(req)) return res.status(429).json({ ok: false, error: "Trop d'essais : réessayez dans 15 minutes." });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (!verifierMotDePasse(body.motDePasse, process.env.MOT_DE_PASSE_HASH)) {
    noterEchec(req);
    console.warn(`[portail] mot de passe refusé depuis ${adresse(req)}`);
    return res.status(401).json({ ok: false, error: "Mot de passe incorrect." });
  }
  effacerEchecs(req);
  const { jeton, exp } = creerJeton();
  res.setHeader("Set-Cookie", enteteCookie(jeton));
  console.log(`[portail] connexion depuis ${adresse(req)}`);
  return res.status(200).json({ ok: true, expiresAt: exp });
}
