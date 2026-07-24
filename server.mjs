#!/usr/bin/env node
// FairShare server — zero deps. Serves the PWA from web/ and exposes
// POST /api/parse-receipt  { image: <base64>, mime: "jpeg" } -> receipt JSON.
//
//   ./server.mjs [port]        (default 8791; PORT env also honored)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReceiptDataUrl } from "./lib/receipt.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, "web");
const PORT = Number(process.argv[2] || process.env.PORT || 8791);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".css": "text/css",
};

function readBody(req, limitBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => { n += c.length; if (n > limitBytes) { reject(new Error("payload too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // --- API ---
  if (url.pathname === "/api/parse-receipt" && req.method === "POST") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!body.image) { console.log("[parse] 400 image_required"); return json(res, 400, { error: "image_required" }); }
      const mime = (body.mime || "jpeg").replace(/[^a-z0-9]/gi, "") || "jpeg";
      console.log(`[parse] received ${Math.round(body.image.length * 0.75 / 1024)}KB mime=${mime}`);
      const dataUrl = `data:image/${mime};base64,${body.image}`;
      const parsed = await parseReceiptDataUrl(dataUrl);
      console.log(`[parse] ok merchant="${parsed.merchant}" items=${parsed.items.length} total=${parsed.total} ${parsed.currency}`);
      return json(res, 200, parsed);
    } catch (e) {
      console.log(`[parse] 500 ${e.message}`);
      return json(res, 500, { error: e.message });
    }
  }
  if (url.pathname === "/api/health") return json(res, 200, { ok: true });

  // --- static (GET only) ---
  if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" });
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = path.join(WEB, path.normalize(rel));
  if (!filePath.startsWith(WEB)) return json(res, 403, { error: "forbidden" }); // path traversal guard
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

server.listen(PORT, () => console.log(`FairShare on http://127.0.0.1:${PORT}`));
