import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const host = option("--host", process.env.HOST || "0.0.0.0");
const port = Number(option("--port", process.env.PORT || 3000));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }
  try {
    let pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
    if (pathname.includes("\0")) throw new Error("Invalid path");
    // Canonical hash links also work on static hosts such as GitHub Pages.
    const legacyRoute = pathname.match(/^\/doodles\/([^/.]+)\/?$/);
    if (legacyRoute) {
      response.writeHead(302, { Location: `/#${encodeURIComponent(legacyRoute[1])}` });
      response.end();
      return;
    }
    if (pathname === "/") pathname = "/index.html";
    let filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root + path.sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, "index.html");
    const data = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": mime[path.extname(filename)] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch (error) {
    const status = ["ENOENT", "ENOTDIR"].includes(error.code) ? 404 : 400;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(status === 404 ? "Not found" : "Invalid request");
  }
});

server.listen(port, host, () => {
  console.log(`Doodle Universe is ready at http://localhost:${port}`);
  console.log("Your own collection · light glass inspector · SVG downloads · local assets");
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
