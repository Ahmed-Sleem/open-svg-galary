import { loadCatalogue, doodleImageUrl } from "./assets.js";
import { DoodleUniverse } from "./universe.js";
import { DoodleCard } from "./card.js";

const universeElement = document.getElementById("universe");
const tooltip = document.getElementById("hover-tooltip");
const loading = document.getElementById("loading");
const modeToggle = document.getElementById("render-mode-toggle");
const modeLabel = document.getElementById("mode-label");
let catalogue = [], universe, card, toastTimer;
let displayMode = "shine";
try {
  if (["shine", "color"].includes(localStorage.getItem("open-svg-galary-render-mode"))) {
    displayMode = localStorage.getItem("open-svg-galary-render-mode");
  }
} catch { /* Private browsing and opaque file previews can disable local storage. */ }

function toast(message) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 5000);
}

function setRenderMode(mode, persist = true) {
  displayMode = mode === "color" ? "color" : "shine";
  const trueColor = displayMode === "color";
  universeElement.dataset.renderMode = displayMode;
  modeToggle.setAttribute("aria-checked", String(trueColor));
  modeToggle.setAttribute("aria-label", `SVG appearance: ${trueColor ? "True colors" : "Shine"}`);
  modeLabel.textContent = trueColor ? "True colors" : "Shine";
  universe?.setMode(displayMode);
  if (persist) {
    try { localStorage.setItem("open-svg-galary-render-mode", displayMode); } catch { /* Optional preference only. */ }
  }
}
modeToggle.addEventListener("click", () => setRenderMode(displayMode === "shine" ? "color" : "shine"));
setRenderMode(displayMode, false);

// Hash links work offline and on GitHub Pages, including /repository/ sites.
function updateRoute(doodle) {
  try {
    const url = new URL(location.href);
    url.hash = doodle ? doodle.slug : "";
    url.search = "";
    history.replaceState({}, "", url);
  } catch { /* An opaque file-viewer sandbox can restrict history changes. */ }
}

function selectDoodle(doodle, updateUrl = true) {
  card.show(doodle);
  if (updateUrl) updateRoute(doodle);
}

function closeDoodle() {
  card.hide();
  updateRoute(null);
  universeElement.focus({ preventScroll: true });
}

function initialDoodle() {
  try {
    const slug = decodeURIComponent(location.hash.slice(1));
    if (slug) return catalogue.find((doodle) => doodle.slug === slug);
    const id = new URLSearchParams(location.search).get("icon");
    return id ? catalogue.find((doodle) => doodle.legacyId === id.trim()) : null;
  } catch { return null; }
}

function renderTooltip(item, point) {
  if (!item) { tooltip.hidden = true; return; }
  tooltip.textContent = item.doodle.name;
  tooltip.style.left = `${point.x}px`;
  tooltip.style.top = `${point.y + 22}px`;
  tooltip.hidden = false;
}

function updateAccessibleCatalogue() {
  const section = document.getElementById("accessible-catalogue");
  section.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Explore the SVG doodle collection";
  section.appendChild(heading);
  for (const doodle of catalogue) {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.textContent = `${doodle.name} — ${doodle.category || "Doodles"}`;
    button.dataset.slug = doodle.slug;
    button.addEventListener("click", () => selectDoodle(doodle));
    section.appendChild(button);
  }
}

function showFallback(error) {
  universe?.destroy();
  universe = null;
  tooltip.hidden = true;
  loading.hidden = true;
  universeElement.style.cursor = "default";
  universeElement.style.touchAction = "auto";
  const grid = document.createElement("div");
  grid.className = "fallback-grid";
  const note = document.createElement("p");
  note.className = "fallback-note";
  note.textContent = "WebGL isn't available. You can still inspect, copy, and download the original SVGs.";
  grid.appendChild(note);
  for (const doodle of catalogue) {
    const button = document.createElement("button");
    button.className = "fallback-item";
    button.type = "button";
    const image = new Image();
    image.src = doodleImageUrl(doodle.slug);
    image.alt = "";
    image.loading = "lazy";
    const label = document.createElement("span");
    label.textContent = doodle.name;
    button.append(image, label);
    button.addEventListener("click", () => selectDoodle(doodle));
    grid.appendChild(button);
  }
  universeElement.appendChild(grid);
  universeElement.dataset.loaded = "true";
  universeElement.dataset.doodleCount = String(catalogue.length);
  console.warn("Doodle universe fallback:", error?.message || error);
}

async function renderCollection(selected = null) {
  universeElement.dataset.loaded = "false";
  loading.hidden = false;
  document.getElementById("loading-text").textContent = "Loading your universe";
  updateAccessibleCatalogue();
  try {
    universeElement.style.touchAction = "none";
    universe = new DoodleUniverse(universeElement, catalogue, {
      onSelect: selectDoodle,
      onHover: renderTooltip,
      onProgress: (count, total) => {
        document.getElementById("loading-text").textContent = `Loading doodles · ${count}/${total}`;
      },
      displayMode,
    });
    await universe.ready;
    loading.hidden = true;
  } catch (error) { showFallback(error); }
  if (selected) selectDoodle(selected);
  document.dispatchEvent(new CustomEvent("doodles:ready", { detail: { count: catalogue.length } }));
}

async function start() {
  try {
    catalogue = await loadCatalogue();
    card = new DoodleCard({ onClose: closeDoodle, onError: toast });
    globalThis.doodleApp = Object.freeze({
      get count() { return catalogue.length; },
      select: (slug) => {
        const doodle = catalogue.find((entry) => entry.slug === slug);
        if (!doodle) return false;
        selectDoodle(doodle);
        return true;
      },
      setMode: setRenderMode,
      export: (format) => card.export(format),
      selected: () => card.doodle?.slug || null,
    });
    const selected = initialDoodle() || catalogue[0] || null;
    await renderCollection(selected);
  } catch (error) {
    loading.hidden = true;
    toast(`${error.message} Use npm start, or open doodle-website.html for the offline edition.`);
    console.error(error);
  }
}

for (const event of ["popstate", "hashchange"]) window.addEventListener(event, () => {
  const doodle = initialDoodle();
  if (doodle) selectDoodle(doodle, false);
  else card?.hide();
});

start();
