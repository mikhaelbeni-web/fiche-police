// tests/admin-auth.test.mjs
// Prouve, sans navigateur, qu'un non-admin ne peut ni charger l'espace admin ni
// appeler ses routes API, y compris en tapant l'URL directement ou en forgeant un cookie.
// Lancer : node --import ./tests/loader.mjs --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_SECRET, ADMIN_PASSWORD, accessCookie, req, res, setCookieValue } from "./helpers.mjs";

process.env.SESSION_SECRET = SESSION_SECRET;
const auth = await import("../lib/adminAuth.js");
process.env.ADMIN_PASSWORD_HASH = auth.hashPassword(ADMIN_PASSWORD, { iterations: 100000 });

const login = (await import("../pages/api/admin/login.js")).default;
const logout = (await import("../pages/api/admin/logout.js")).default;
const session = (await import("../pages/api/admin/session.js")).default;
const igloDevices = (await import("../pages/api/admin/igloohome/devices.js")).default;
const igloActivity = (await import("../pages/api/admin/igloohome/activity.js")).default;

// Toutes les routes /api/admin/* qui exigent l'admin (login/logout exclues : publiques par nature).
const PROTECTED_ROUTES = { session, igloDevices, igloActivity };

async function adminCookie() {
  const r = res();
  await login(req({ method: "POST", cookies: [accessCookie()], body: { password: ADMIN_PASSWORD } }), r);
  assert.equal(r.statusCode, 200);
  return `fp_admin=${encodeURIComponent(setCookieValue(r, "fp_admin"))}`;
}

const ctx = cookies => ({ req: req({ cookies }), res: res() });

test("hash du mot de passe : bon mot de passe accepté, mauvais refusé", () => {
  const h = auth.hashPassword("abc-123", { iterations: 100000 });
  assert.match(h, /^pbkdf2\$sha256\$100000\$/);
  assert.equal(auth.verifyPassword("abc-123", h), true);
  assert.equal(auth.verifyPassword("abc-124", h), false);
  assert.equal(auth.verifyPassword("", h), false);
  assert.equal(auth.verifyPassword("abc-123", "n'importe quoi"), false);
});

test("le hash ne contient pas le mot de passe en clair", () => {
  assert.equal(process.env.ADMIN_PASSWORD_HASH.includes(ADMIN_PASSWORD), false);
});

test("non-admin : la page /codes ne reçoit pas isAdmin (sous-onglet absent)", async () => {
  assert.deepEqual(auth.codesPageProps(ctx([])), { props: { isAdmin: false } });
  assert.deepEqual(auth.codesPageProps(ctx([accessCookie()])), { props: { isAdmin: false } });
  assert.deepEqual(auth.codesPageProps(ctx([accessCookie(), await adminCookie()])), { props: { isAdmin: true } });
});

test("non-admin : l'URL /codes/admin tapée directement répond 404", () => {
  assert.deepEqual(auth.adminPageProps(ctx([])), { notFound: true });
  assert.deepEqual(auth.adminPageProps(ctx([accessCookie()])), { notFound: true }, "réceptionniste (code d'accès seul)");
});

test("admin : /codes/admin est servie", async () => {
  const out = auth.adminPageProps(ctx([accessCookie(), await adminCookie()]));
  assert.equal(out.props.isAdmin, true);
  assert.ok(out.props.adminExpiresAt > Date.now() / 1000);
});

test("non-admin : chaque route API admin répond 404", async () => {
  for (const [name, handler] of Object.entries(PROTECTED_ROUTES)) {
    for (const cookies of [[], [accessCookie()]]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const r = res();
        await handler(req({ method, cookies }), r);
        assert.equal(r.statusCode, 404, `${name} ${method} cookies=${cookies.length}`);
      }
    }
  }
});

test("cookie admin forgé, altéré, sans session normale ou d'une autre clé : refusé", async () => {
  const good = await adminCookie();
  const tok = decodeURIComponent(good.split("=")[1]);
  const [v, exp, sig] = tok.split(".");
  const variants = [
    `fp_admin=ok`,
    `fp_admin=${v}.${Number(exp) + 60}.${sig}`, // expiration rallongée
    `fp_admin=${v}.${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`, // signature modifiée
    `fp_admin=${v}.9999999999.${sig}`,
  ];
  for (const c of variants) {
    const r = res();
    session(req({ cookies: [accessCookie(), c] }), r);
    assert.equal(r.statusCode, 404, c);
  }
  // Cookie admin valide mais sans session normale (code d'accès) : refusé.
  const r1 = res();
  session(req({ cookies: [good] }), r1);
  assert.equal(r1.statusCode, 404);
  // Session normale signée avec un autre secret : refusée.
  const r2 = res();
  session(req({ cookies: [accessCookie("autre-secret"), good] }), r2);
  assert.equal(r2.statusCode, 404);
});

test("admin : la route session répond 200", async () => {
  const r = res();
  session(req({ cookies: [accessCookie(), await adminCookie()] }), r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.admin, true);
});

test("la session admin expire au bout de 8 h", () => {
  const now = Date.now();
  const { token } = auth.makeAdminToken(now);
  assert.ok(auth.verifyAdminToken(token, now + 7.9 * 3600 * 1000) > 0);
  assert.equal(auth.verifyAdminToken(token, now + 8 * 3600 * 1000 + 1000), 0);
});

test("changer le mot de passe admin invalide les sessions admin existantes", async () => {
  const c = await adminCookie();
  const old = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD_HASH = auth.hashPassword("nouveau", { iterations: 100000 });
  try {
    const r = res();
    session(req({ cookies: [accessCookie(), c] }), r);
    assert.equal(r.statusCode, 404);
  } finally {
    process.env.ADMIN_PASSWORD_HASH = old;
  }
});

test("connexion : sans code d'accès 404, mauvais mot de passe 401 sans cookie", async () => {
  const r1 = res();
  await login(req({ method: "POST", body: { password: ADMIN_PASSWORD } }), r1);
  assert.equal(r1.statusCode, 404);
  assert.equal(r1.headers["set-cookie"], undefined);

  const r2 = res();
  await login(req({ method: "POST", cookies: [accessCookie()], body: { password: "faux" } }), r2);
  assert.equal(r2.statusCode, 401);
  assert.equal(r2.headers["set-cookie"], undefined);
});

test("connexion : cookie HttpOnly, Secure, SameSite=Strict, 8 h", async () => {
  const r = res();
  await login(req({ method: "POST", cookies: [accessCookie()], body: { password: ADMIN_PASSWORD } }), r);
  const h = r.headers["set-cookie"];
  assert.match(h, /HttpOnly/);
  assert.match(h, /Secure/);
  assert.match(h, /SameSite=Strict/);
  assert.match(h, /Max-Age=28800/);
});

test("connexion : bloquée après 5 échecs depuis la même adresse", async () => {
  auth._resetLoginFailuresForTests();
  const ip = "192.0.2.77";
  for (let i = 0; i < 5; i++) {
    const r = res();
    await login(req({ method: "POST", cookies: [accessCookie()], body: { password: "faux" }, ip }), r);
    assert.equal(r.statusCode, 401);
  }
  const r = res();
  await login(req({ method: "POST", cookies: [accessCookie()], body: { password: ADMIN_PASSWORD }, ip }), r);
  assert.equal(r.statusCode, 429);
  auth._resetLoginFailuresForTests();
});

test("déconnexion : efface le cookie admin", () => {
  const r = res();
  logout(req({ method: "POST" }), r);
  assert.match(r.headers["set-cookie"], /fp_admin=;.*Max-Age=0/);
});

test("espace admin non configuré : tout est fermé, même avec un ancien cookie", async () => {
  const c = await adminCookie();
  const old = process.env.ADMIN_PASSWORD_HASH;
  delete process.env.ADMIN_PASSWORD_HASH;
  try {
    assert.deepEqual(auth.adminPageProps(ctx([accessCookie(), c])), { notFound: true });
    assert.deepEqual(auth.adminLoginPageProps(ctx([accessCookie()])), { notFound: true });
    const r = res();
    await login(req({ method: "POST", cookies: [accessCookie()], body: { password: ADMIN_PASSWORD } }), r);
    assert.equal(r.statusCode, 404);
  } finally {
    process.env.ADMIN_PASSWORD_HASH = old;
  }
});

test("aucun fichier navigateur n'importe lib/adminAuth.js en dehors de getServerSideProps", async () => {
  // Next.js retire du bundle navigateur les imports utilisés seulement dans
  // getServerSideProps. On vérifie que les pages n'utilisent rien d'autre du module.
  const fs = await import("node:fs");
  for (const f of ["pages/codes.js", "pages/codes/admin/index.js", "pages/codes/admin/connexion.js"]) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const m = src.match(/import \{([^}]*)\} from "[./]*lib\/adminAuth"/);
    assert.ok(m, f);
    for (const name of m[1].split(",").map(s => s.trim()).filter(Boolean)) {
      const uses = src.split(name).length - 1;
      assert.equal(uses, 2, `${f} : ${name} doit servir uniquement dans getServerSideProps`);
    }
  }
});
