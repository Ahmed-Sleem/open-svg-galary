import { readFile, writeFile, readdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = path.join(root, "doodles");
let previous = [];
try { previous = JSON.parse(await readFile(path.join(root, "assets/catalogue.json"), "utf8")); } catch {}
const metadata = new Map(previous.map((doodle) => [doodle.slug, doodle]));
const files = (await readdir(folder, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.svg$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));
const catalogue = [], assets = [];
const slugs = new Set();
const cssUrls = (source) => [...source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)];

for (let index = 0; index < files.length; index++) {
  const file = files[index];
  const originalStem = file.replace(/\.svg$/i, "");
  const slug = originalStem.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `doodle-${index + 1}`;
  if (slugs.has(slug)) throw new Error(`Two filenames resolve to '${slug}'. Rename one SVG so names are unique.`);
  slugs.add(slug);
  const data = await readFile(path.join(folder, file));
  const source = data.toString("utf8");
  if (data.length > 5 * 1024 * 1024) throw new Error(`${file}: SVGs must be 5 MB or smaller.`);
  if (!/<svg(?:\s|>)/i.test(source)) throw new Error(`${file}: not a valid SVG document.`);
  if (/<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|\son[a-z0-9_-]+\s*=/i.test(source)) {
    throw new Error(`${file}: remove scripts, embedded HTML, event handlers, and active content.`);
  }
  for (const match of source.matchAll(/(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
    if (!match[2].trim().startsWith("#") && !/^data:image\//i.test(match[2].trim())) {
      throw new Error(`${file}: keep SVG references self-contained (no remote URLs).`);
    }
  }
  for (const match of cssUrls(source)) {
    const target = match[2].trim();
    if (!target.startsWith("#") && !/^data:image\//i.test(target)) {
      throw new Error(`${file}: keep CSS/image references self-contained (no remote URLs).`);
    }
  }
  const target = `${slug}.svg`;
  if (file !== target) await rename(path.join(folder, file), path.join(folder, target));
  const old = metadata.get(slug);
  const words = slug.replace(/[-_]+/g, " ");
  const title = words.replace(/\b\w/g, (character) => character.toUpperCase());
  catalogue.push({
    ...(old?.legacyId ? { legacyId: old.legacyId } : {}),
    name: old?.name || title,
    slug,
    category: old?.category || "Your doodles",
    tags: old?.tags || [],
    demo: old?.demo || false,
  });
  assets.push({ slug, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
}
await writeFile(path.join(root, "assets/catalogue.json"), JSON.stringify(catalogue, null, 2) + "\n");
await writeFile(path.join(root, "assets/asset-manifest.json"), JSON.stringify({ count: catalogue.length, assets }, null, 2) + "\n");
console.log(`✓ ${catalogue.length} SVGs catalogued. New filenames become their display names and URL slugs.`);
console.log("✓ Edit assets/catalogue.json to customise display names, categories and tags.");
