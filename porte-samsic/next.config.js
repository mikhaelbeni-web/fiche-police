// porte-samsic/next.config.js
// Site à part (projet Vercel « porte-samsic », dossier racine porte-samsic/).
const securite = [
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Cache-Control", value: "no-store" },
];

module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securite }];
  },
};
