#!/usr/bin/env node
// FairShare receipt parser (CLI) — photo -> itemized JSON via a vision LLM.
// Thin wrapper over lib/receipt.mjs so the CLI and server share one impl.
//
//   ./parse-receipt.mjs <image.jpg|png>

import { parseReceiptDataUrl, fileToDataUrl } from "./lib/receipt.mjs";

const imgPath = process.argv[2];
if (!imgPath) { console.error("usage: parse-receipt.mjs <image>"); process.exit(2); }

try {
  const parsed = await parseReceiptDataUrl(fileToDataUrl(imgPath));
  console.log(JSON.stringify(parsed, null, 2));
} catch (e) {
  console.error("error:", e.message);
  process.exit(1);
}
