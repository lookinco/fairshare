// Shared receipt-parsing core — used by both the CLI (parse-receipt.mjs) and
// the server (/api/parse-receipt). One implementation, two front doors.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadOpenAIKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFile = path.join(__dirname, "..", "..", "shv-webhook-bridge", ".env");
  try {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*OPENAI_API_KEY\s*=\s*(.*)$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return null;
}

const SCHEMA_PROMPT = `You are a receipt parser. Read this restaurant receipt image and return ONLY a JSON object, no prose, matching:
{
  "merchant": string,
  "currency": string (ISO like "USD","CAD" — infer from symbols/locale, default "USD"),
  "items": [{ "name": string, "qty": number, "price": number }],
  "subtotal": number, "tax": number, "tip": number, "total": number
}
Rules: price = line total for that row, plain numbers (no currency symbol). Missing field -> 0. qty defaults to 1. Do not invent items.`;

// dataUrl: "data:image/<mime>;base64,...."  -> validated receipt object.
export async function parseReceiptDataUrl(dataUrl, opts = {}) {
  const key = opts.key || loadOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY not found");
  const model = opts.model || process.env.FAIRSHARE_VISION_MODEL || "gpt-4o";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: SCHEMA_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`vision API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
  return normalize(obj);
}

export function fileToDataUrl(imgPath) {
  const bytes = fs.readFileSync(imgPath);
  const ext = path.extname(imgPath).slice(1).toLowerCase() || "jpeg";
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${bytes.toString("base64")}`;
}

// Defensive: never trust the model's shape blindly downstream.
function normalize(o) {
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const items = Array.isArray(o.items) ? o.items.map((it) => ({
    name: String(it.name || "item"), qty: num(it.qty) || 1, price: num(it.price),
  })) : [];
  const subtotal = num(o.subtotal) || items.reduce((s, it) => s + it.price, 0);
  const tax = num(o.tax), tip = num(o.tip);
  const total = num(o.total) || subtotal + tax + tip;
  return { merchant: String(o.merchant || ""), currency: String(o.currency || "USD").toUpperCase(), items, subtotal, tax, tip, total };
}
