import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogue = JSON.parse(await readFile(path.join(root, "assets/catalogue.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "assets/asset-manifest.json"), "utf8"));
const files = (await readdir(path.join(root, "doodles"))).filter((file) => /\.svg$/i.test(file));
assert.equal(files.length, catalogue.length, "Run npm run catalogue after changing your SVG files.");
assert.equal(new Set(catalogue.map((doodle) => doodle.slug)).size, catalogue.length, "Slugs must be unique.");
assert.equal(manifest.count, catalogue.length, "The manifest must match the collection.");
for (const doodle of catalogue) {
  assert(doodle.name && doodle.slug && Array.isArray(doodle.tags));
  const data = await readFile(path.join(root, `doodles/${doodle.slug}.svg`));
  const asset = manifest.assets.find((entry) => entry.slug === doodle.slug);
  assert(asset, `Missing manifest entry: ${doodle.slug}`);
  assert.equal(data.length, asset.bytes, `Unexpected asset size: ${doodle.slug}`);
  assert.equal(createHash("sha256").update(data).digest("hex"), asset.sha256, `Asset changed: ${doodle.slug}. Run npm run catalogue.`);
  assert(/<svg(?:\s|>)/i.test(data.toString()), `Invalid SVG: ${doodle.slug}`);
  assert(!/<script|<foreignObject|\son\w+=|(?:href|src)=["']https?:/i.test(data.toString()), `Unexpected active/remote content: ${doodle.slug}`);
}
for (const file of ["vendor/three.js", "assets/fonts/geist-latin.woff2", "assets/fonts/bricolage-latin.woff2", "assets/favicon.svg"]) {
  assert((await readFile(path.join(root, file))).length > 0, `Missing local dependency: ${file}`);
}
console.log(`✓ ${catalogue.length} SVGs, catalogue entries, file sizes and SHA-256 hashes verified.`);
console.log("✓ Fonts, renderer and favicon are local. No external SVG resources.");
