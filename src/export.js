import { svgToDataUrl } from "./assets.js";

export const formats = [
  { value: "svg", label: "SVG" },
  { value: "tsx", label: "TSX" },
  { value: "jsx", label: "JSX" },
  { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" },
  { value: "astro", label: "Astro" },
  { value: "react-native", label: "React Native" },
  { value: "base64", label: "Base64" },
  { value: "css", label: "CSS" },
];

const componentName = (name) => name
  .split(/[^a-zA-Z0-9]+/).filter(Boolean)
  .map((word) => word[0].toUpperCase() + word.slice(1)).join("") || "DoodleIcon";
const indent = (text, spaces = 2) => text.split("\n").map((line) => " ".repeat(spaces) + line).join("\n");

// Preserve masks, clipping paths, white cutouts, and gradient references.
// Black ink can follow the component colour prop; explicit artwork colours stay intact.
function normaliseSvg(source, color = "currentColor", size = 64) {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid SVG source.");
  const svg = document.documentElement;
  svg.removeAttribute("class");
  svg.removeAttribute("style");
  svg.removeAttribute("color");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  if (!svg.hasAttribute("fill")) svg.setAttribute("fill", color);
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of ["fill", "stroke", "stop-color"]) {
      const value = element.getAttribute(attribute);
      if (!value || !/^(currentColor|black|#000(?:000)?)$/i.test(value)) continue;
      element.setAttribute(attribute, color);
    }
  }
  return new XMLSerializer().serializeToString(svg);
}

function prettySvg(source) {
  const lines = source.replace(/>\s*</g, "><").replace(/></g, ">\n<").split("\n");
  let depth = 0;
  return lines.map((line) => {
    line = line.trim();
    if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
    const formatted = "  ".repeat(depth) + line;
    if (/^<[^!?/]/.test(line) && !/\/>$/.test(line) && !/<\/[^>]+>$/.test(line)) depth++;
    return formatted;
  }).join("\n");
}

function camelAttribute(name) {
  if (name === "class") return "className";
  if (name.startsWith("aria-") || name.startsWith("data-")) return name;
  if (name === "xlink:href") return "xlinkHref";
  return name.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function dynamicSvg(source, framework) {
  return source.replace(/<svg([^>]*)>/, (_, attributes) => {
    const clean = attributes.replace(/\swidth="[^"]*"/g, "").replace(/\sheight="[^"]*"/g, "");
    if (framework === "vue") return `<svg${clean} :width="size" :height="size" :style="{ color }">`;
    if (framework === "svelte") return `<svg${clean} width={size} height={size} style:color={color}>`;
    if (framework === "astro") return `<svg${clean} width={size} height={size} style={\`color: \${color}\`}>`;
    return `<svg${clean} width={size} height={size} {...props}>`;
  });
}

function jsxSvg(source) {
  return dynamicSvg(source, "react").replace(/([\w:.-]+)="([^"]*)"/g, (_, attribute, value) => {
    const name = camelAttribute(attribute);
    return value === "currentColor" && ["fill", "stroke", "stopColor"].includes(name)
      ? `${name}={color}` : `${name}="${value}"`;
  });
}

function nativeComponent(name, source) {
  const tagMap = {
    svg: "Svg", path: "Path", g: "G", defs: "Defs", circle: "Circle",
    rect: "Rect", ellipse: "Ellipse", line: "Line", polyline: "Polyline",
    polygon: "Polygon", mask: "Mask", clippath: "ClipPath",
    lineargradient: "LinearGradient", radialgradient: "RadialGradient",
    stop: "Stop", pattern: "Pattern",
  };
  const imports = new Set();
  let body = jsxSvg(source.replace(/\sxmlns="[^"]*"/g, ""));
  body = body.replace(/<(\/?)([a-zA-Z][\w]*)/g, (_, slash, tag) => {
    const mapped = tagMap[tag.toLowerCase()] || tag;
    if (mapped !== "Svg") imports.add(mapped);
    return `<${slash}${mapped}`;
  });
  const namedImports = [...imports].sort();
  const importLine = namedImports.length
    ? `import Svg, { ${namedImports.join(", ")} } from "react-native-svg";`
    : 'import Svg from "react-native-svg";';
  return `${importLine}\n\nexport default function ${name}({ size = 64, color = "currentColor", ...props }) {\n  return (\n${indent(body, 4)}\n  );\n}\n`;
}

export function exportDoodle(source, doodle, format = "svg") {
  const name = componentName(doodle.name);
  const original = prettySvg(source);
  // Raw/vector formats preserve the user's artwork, without a DOM conversion.
  if (format === "svg") return original;
  if (format === "base64") return svgToDataUrl(original);
  if (format === "css") return `background-image: url("data:image/svg+xml,${encodeURIComponent(original.replace(/>\s*</g, "><"))}");`;
  const current = prettySvg(normaliseSvg(source));
  switch (format) {
    case "tsx":
      return `import type { SVGProps } from "react";\n\ntype DoodleProps = SVGProps<SVGSVGElement> & { size?: number; color?: string };\n\nexport function ${name}({ size = 64, color = "currentColor", ...props }: DoodleProps) {\n  return (\n${indent(jsxSvg(current), 4)}\n  );\n}\n`;
    case "jsx":
      return `export default function ${name}({ size = 64, color = "currentColor", ...props }) {\n  return (\n${indent(jsxSvg(current), 4)}\n  );\n}\n`;
    case "vue":
      return `<script setup lang="ts">\nwithDefaults(defineProps<{ size?: number; color?: string }>(), {\n  size: 64,\n  color: "currentColor",\n});\n</script>\n\n<template>\n${indent(dynamicSvg(current, "vue"))}\n</template>\n`;
    case "svelte":
      return `<script>\n  export let size = 64;\n  export let color = "currentColor";\n</script>\n\n${dynamicSvg(current, "svelte")}\n`;
    case "astro":
      return `---\nconst { size = 64, color = "currentColor" } = Astro.props;\n---\n\n${dynamicSvg(current, "astro")}\n`;
    case "react-native":
      return nativeComponent(name, current);
    default:
      throw new Error(`Unknown copy format: ${format}`);
  }
}
