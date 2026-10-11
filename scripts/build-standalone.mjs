import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The optional build tool is not needed to run the site.
const { build } = await import(process.env.ESBUILD_PATH || "esbuild");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogue = JSON.parse(await readFile(path.join(root, "assets/catalogue.json"), "utf8"));
const svgs = Object.fromEntries(await Promise.all(catalogue.map(async ({ slug }) => [
  slug, await readFile(path.join(root, `doodles/${slug}.svg`), "utf8"),
])));
let css = await readFile(path.join(root, "src/styles.css"), "utf8");
for (const filename of ["inter-latin.woff2", "geist-mono-latin.woff2"]) {
  const data = await readFile(path.join(root, `assets/fonts/${filename}`));
  css = css.replace(`../assets/fonts/${filename}`, () => `data:font/woff2;base64,${data.toString("base64")}`);
}
const favicon = (await readFile(path.join(root, "assets/favicon.svg"))).toString("base64");
const result = await build({
  entryPoints: [path.join(root, "src/app.js")], bundle: true, format: "iife",
  platform: "browser", target: "es2020", minify: true, write: false, legalComments: "inline",
});
const code = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
let html = await readFile(path.join(root, "index.html"), "utf8");
html = html.replace('<link rel="stylesheet" href="./src/styles.css" />', () => `<style>${css}</style>`);
html = html.replace('./assets/favicon.svg', () => `data:image/svg+xml;base64,${favicon}`);
// A replacer avoids interpreting $&, $` and $' inside bundled code.
html = html.replace('<script id="app-entry" type="module" src="./src/app.js"></script>',
  () => `<script>globalThis.__DOODLE_CATALOGUE__=${safeJson(catalogue)};globalThis.__DOODLE_SVGS__=${safeJson(svgs)};</script>\n<script id="app-entry">${code}</script>`);
await writeFile(path.join(root, "doodle-website.html"), html);
console.log(`✓ Offline website: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, ${catalogue.length} SVGs embedded.`);
console.log("✓ No server, installation or external asset requests required.");
