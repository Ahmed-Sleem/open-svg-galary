import { loadSvg, doodleImageUrl } from "./assets.js";
import { formats, exportDoodle } from "./export.js";

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
    this.trigger = byId("format-trigger");
    this.menu = byId("format-menu");
    this.copyButton = byId("copy-doodle");
    this.downloadButton = byId("download-doodle");
    this.format = "svg";
    this.requestToken = 0;
    this.exports = new Map();
    this.buildMenu();
    byId("close-card").addEventListener("click", onClose);
    this.trigger.addEventListener("click", () => this.menu.hidden ? this.openMenu() : this.closeMenu());
    this.trigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); this.openMenu(); }
    });
    this.copyButton.addEventListener("click", () => this.copy());
    this.downloadButton.addEventListener("click", () => this.download());
    document.addEventListener("pointerdown", (event) => {
      if (!this.menu.hidden && !this.menu.contains(event.target) && !this.trigger.contains(event.target)) this.closeMenu(false);
    });
    document.addEventListener("keydown", (event) => this.onKey(event));
    window.addEventListener("resize", () => { if (!this.menu.hidden) this.positionMenu(); });
    byId("close-manual-copy").addEventListener("click", () => byId("manual-copy-dialog").close());
  }

  buildMenu() {
    this.options = formats.map((format) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "format-option";
      option.setAttribute("role", "option");
      option.dataset.value = format.value;
      option.id = `format-${format.value}`;
      const label = document.createElement("span");
      label.textContent = format.label;
      option.appendChild(label);
      option.addEventListener("click", () => {
        this.format = format.value;
        byId("format-label").textContent = format.label;
        this.updateOptions();
        this.closeMenu();
        this.resetCopied();
      });
      this.menu.appendChild(option);
      return option;
    });
    this.updateOptions();
  }

  updateOptions() {
    for (const option of this.options) {
      const selected = option.dataset.value === this.format;
      option.setAttribute("aria-selected", String(selected));
      option.querySelector("svg")?.remove();
      if (selected) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        for (const [attribute, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(attribute, value);
        svg.innerHTML = checkPath;
        option.appendChild(svg);
      }
    }
  }

  async show(doodle) {
    const token = ++this.requestToken;
    this.doodle = doodle;
    this.svg = null;
    this.exports.clear();
    this.copyButton.disabled = this.downloadButton.disabled = true;
    this.closeMenu(false);
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
    this.closeMenu(false);
    this.element.hidden = true;
    this.previewElement.replaceChildren();
    this.doodle = null;
    this.svg = null;
    this.exports.clear();
    this.resetCopied();
    this.format = "svg";
    byId("format-label").textContent = "SVG";
    this.updateOptions();
  }

  positionMenu() {
    const bounds = this.trigger.getBoundingClientRect();
    const width = this.menu.offsetWidth || 180;
    const height = Math.min(this.menu.scrollHeight, 288);
    const available = window.innerHeight - bounds.bottom - 16;
    const below = available >= height || bounds.top < height;
    this.menu.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`;
    this.menu.style.top = `${below ? bounds.bottom + 8 : Math.max(8, bounds.top - height - 8)}px`;
    this.menu.style.maxHeight = `${below ? Math.min(288, Math.max(56, available)) : 288}px`;
  }

  openMenu() {
    this.menu.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    this.positionMenu();
    this.options.find((option) => option.dataset.value === this.format)?.focus({ preventScroll: true });
  }

  closeMenu(focus = true) {
    const wasOpen = !this.menu.hidden;
    this.menu.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    if (wasOpen && focus && !this.element.hidden) this.trigger.focus({ preventScroll: true });
  }

  onKey(event) {
    if (byId("manual-copy-dialog").open) return;
    if (event.key === "Escape") {
      if (!this.menu.hidden) { event.preventDefault(); this.closeMenu(); }
      else if (!this.element.hidden) { event.preventDefault(); this.onClose(); }
      return;
    }
    if (this.menu.hidden) return;
    const index = this.options.indexOf(document.activeElement);
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % this.options.length;
    else if (event.key === "ArrowUp") next = (index - 1 + this.options.length) % this.options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.options.length - 1;
    else if (/^[a-z]$/i.test(event.key)) next = formats.findIndex((format) => format.label.toLowerCase().startsWith(event.key.toLowerCase()));
    else return;
    event.preventDefault();
    if (next >= 0) this.options[next].focus();
  }

  export(format = this.format) {
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
      byId("copy-feedback").textContent = `Copied ${this.doodle.name} as ${this.format}.`;
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
