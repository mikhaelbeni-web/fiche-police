// Résolution des imports « à la Next.js » pour Node (tests seulement) :
// - imports relatifs sans extension (« ../lib/hostaway ») → « .js » ;
// - sous-chemins de paquets sans carte d'exports (« next/link ») → « .js ».
export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const pkgSubpath = !relative && !specifier.startsWith("node:") && /^(@[^/]+\/)?[^/]+\/.+/.test(specifier);
  if ((relative || pkgSubpath) && !/\.[cm]?js$/.test(specifier)) {
    try { return await next(specifier + ".js", context); } catch { /* repli ci-dessous */ }
  }
  return next(specifier, context);
}
