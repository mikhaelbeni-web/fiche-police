// tests/loader.mjs — permet à Node d'importer les fichiers du projet tels que
// Next.js les écrit (imports sans extension « ../lib/hostaway »). Tests seulement.
import { register } from "node:module";
register("./resolve-ext.mjs", import.meta.url);
