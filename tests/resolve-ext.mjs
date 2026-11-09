// Ajoute « .js » aux imports relatifs sans extension (tests seulement).
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?js$/.test(specifier)) {
    try { return await next(specifier + ".js", context); } catch { /* repli ci-dessous */ }
  }
  return next(specifier, context);
}
