import { CanvasTexture, SRGBColorSpace } from "../vendor/three.js";

const embeddedCatalogue = globalThis.__DOODLE_CATALOGUE__;
const embeddedSvgs = globalThis.__DOODLE_SVGS__;
export const isStandalone = Boolean(embeddedSvgs);
const entry = document.getElementById("app-entry");
const root = isStandalone ? null : new URL("../", entry?.src || location.href);
const sourceCache = new Map();
const textureCache = new Map();
const dataUrlCache = new Map();

export async function loadCatalogue() {
  if (embeddedCatalogue) return embeddedCatalogue;
  const response = await fetch(new URL("assets/catalogue.json", root));
  if (!response.ok) throw new Error("The SVG collection could not be loaded.");
  return response.json();
}

export function svgToDataUrl(svg) {
  const bytes = encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return `data:image/svg+xml;base64,${btoa(bytes)}`;
}

export function doodleImageUrl(slug) {
  const source = embeddedSvgs?.[slug];
  if (source) {
    if (!dataUrlCache.has(slug)) dataUrlCache.set(slug, svgToDataUrl(source));
    return dataUrlCache.get(slug);
  }
  return new URL(`doodles/${encodeURIComponent(slug)}.svg`, root).href;
}

export function loadSvg(slug) {
  if (!sourceCache.has(slug)) {
    const source = embeddedSvgs?.[slug];
    const promise = source ? Promise.resolve(source) : fetch(doodleImageUrl(slug)).then((response) => {
      if (!response.ok) throw new Error(`Could not load ${slug}.svg`);
      return response.text();
    });
    sourceCache.set(slug, promise);
    promise.catch(() => sourceCache.delete(slug));
  }
  return sourceCache.get(slug);
}

// Give viewBox-only SVGs a matching intrinsic viewport before rasterising.
// This avoids the browser's default 300×150 letterbox and preserves their full size.
function textureSource(source) {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = document.documentElement;
  const viewBox = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (svg.localName === "svg" && viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    const width = svg.getAttribute("width");
    const height = svg.getAttribute("height");
    const numeric = (value) => Number.parseFloat(value || "");
    const w = numeric(width), h = numeric(height);
    if (!width && !height) {
      svg.setAttribute("width", String(viewBox[2]));
      svg.setAttribute("height", String(viewBox[3]));
    } else if (!width && Number.isFinite(h) && h > 0) {
      svg.setAttribute("width", String(h * viewBox[2] / viewBox[3]));
    } else if (!height && Number.isFinite(w) && w > 0) {
      svg.setAttribute("height", String(w * viewBox[3] / viewBox[2]));
    }
  }
  return new XMLSerializer().serializeToString(svg);
}

export function loadMaskTexture(slug) {
  if (!textureCache.has(slug)) {
    const promise = loadSvg(slug).then((source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const context = canvas.getContext("2d", { alpha: true, willReadFrequently: false });
        if (!context) return reject(new Error("Canvas rendering is unavailable."));
        const width = image.width || 64;
        const height = image.height || 64;
        const fit = Math.min(256 / width, 256 / height);
        const w = width * fit, h = height * fit;
        context.drawImage(image, (256 - w) / 2, (256 - h) / 2, w, h);
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        resolve(texture);
      };
      image.onerror = () => reject(new Error(`Could not render ${slug}.svg`));
      image.src = svgToDataUrl(textureSource(source));
    }));
    textureCache.set(slug, promise);
    promise.catch(() => textureCache.delete(slug));
  }
  return textureCache.get(slug);
}
