import { loadSvg, doodleImageUrl } from "./assets.js";
import { exportDoodle } from "./export.js";

const copyPath = '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>';
const checkPath = '<path d="m20 6-11 11-5-5"/>';
const byId = (id) => document.getElementById(id);

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* Try the offline-compatible fallback. */ }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { /* Offer manual copy. */ }
  area.remove();
  return copied;
}

export class DoodleCard {
  constructor({ onClose, onError }) {
    this.onClose = onClose;
    this.onError = onError;
    this.element = byId("doodle-card");
    this.previewElement = byId("doodle-preview");
    this.copyButton = byId("copy-doodle");
    this.downloadButton = byId("download-doodle");
    this.requestToken = 0;
    this.exports = new Map();
    byId("close-card").addEventListener("click", onClose);
    this.copyButton.addEventListener("click", () => this.copy());
    this.downloadButton.addEventListener("click", () => this.download());
    document.addEventListener("keydown", (event) => this.onKey(event));
    byId("close-manual-copy").addEventListener("click", () => byId("manual-copy-dialog").close());
  }


  async show(doodle) {
    const token = ++this.requestToken;
    this.doodle = doodle;
    this.svg = null;
    this.exports.clear();
    this.copyButton.disabled = this.downloadButton.disabled = true;
    this.resetCopied();
    const title = byId("card-title");
    title.textContent = title.title = doodle.name;
    title.style.fontSize = doodle.name.length > 22 ? "19px" : "22px";
    byId("card-category").textContent = doodle.category || "Your doodles";
    byId("card-size").textContent = "Editable vector";
    this.element.dataset.slug = doodle.slug;
    this.element.hidden = false;
    // Native SVG preview: sharp at any size, no extra renderer, textures, or RAF.
    const image = new Image();
    image.src = doodleImageUrl(doodle.slug);
    image.alt = "";
    image.draggable = false;
    this.previewElement.replaceChildren(image);
    try {
      const svg = await loadSvg(doodle.slug);
      if (token !== this.requestToken) return;
      this.svg = svg;
      const bytes = new Blob([svg]).size;
      byId("card-size").textContent = `${bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`} · vector`;
      this.copyButton.disabled = this.downloadButton.disabled = false;
    } catch (error) {
      if (token === this.requestToken) this.onError?.(error.message);
    }
  }

  hide() {
    this.requestToken++;
    this.element.hidden = true;
    this.previewElement.replaceChildren();
    this.doodle = null;
    this.svg = null;
    this.exports.clear();
    this.resetCopied();
  }

  onKey(event) {
    if (byId("manual-copy-dialog").open) return;
    if (event.key === "Escape" && !this.element.hidden) {
      event.preventDefault();
      this.onClose();
    }
  }

  export(format = "svg") {
    if (!this.svg || !this.doodle) return "";
    if (!this.exports.has(format)) this.exports.set(format, exportDoodle(this.svg, this.doodle, format));
    return this.exports.get(format);
  }

  resetCopied() {
    clearTimeout(this.copiedTimeout);
    byId("copy-label").textContent = "Copy";
    byId("copy-icon").innerHTML = copyPath;
    this.copyButton.dataset.copied = "false";
  }

  manualCode(text, downloading = false) {
    byId("manual-copy-heading").textContent = downloading ? "Your SVG file" : "Copy your doodle";
    byId("manual-copy-help").textContent = downloading
      ? "This embedded preview blocks file downloads. Open the HTML directly in your browser to download, or copy this code into a .svg file."
      : "Your browser blocked automatic copying. Select the code below and press Ctrl+C or ⌘C.";
    const dialog = byId("manual-copy-dialog");
    const code = byId("manual-copy-code");
    code.value = text;
    dialog.showModal();
    code.focus();
    code.select();
  }

  async copy() {
    const text = this.export();
    if (!text) return;
    const token = this.requestToken;
    if (await writeClipboard(text)) {
      if (token !== this.requestToken) return;
      byId("copy-label").textContent = "Copied";
      byId("copy-icon").innerHTML = checkPath;
      this.copyButton.dataset.copied = "true";
      byId("copy-feedback").textContent = `Copied ${this.doodle.name} as SVG.`;
      this.copiedTimeout = setTimeout(() => this.resetCopied(), 1600);
      this.copyButton.focus({ preventScroll: true });
    } else this.manualCode(text);
  }

  download() {
    if (!this.svg || !this.doodle) return;
    if (window.parent !== window && globalThis.origin === "null") {
      this.manualCode(this.svg, true);
      return;
    }
    // Download the ORIGINAL vector: preserve its colours, viewBox and precision.
    const blob = new Blob([this.svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${this.doodle.slug}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    byId("copy-feedback").textContent = `SVG download started for ${this.doodle.name}.`;
  }
}
