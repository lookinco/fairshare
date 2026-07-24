// FairShare PWA — front-end shell wired to the real split engine.
// State lives in localStorage for now (no backend yet); balances are computed
// per-currency because expenses can be in different currencies (Boss decision
// 2026-07-24: multi-currency, no silent FX conversion).

import { netBalances, settleUp } from "./split.mjs";

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "MXN"];
const SYM = { CAD: "$", USD: "$", EUR: "€", GBP: "£", MXN: "$" };

// ---- state ----
const DEFAULT = {
  name: "The Ng Trip",
  currencyDefault: "CAD",
  members: [
    { id: "clement", name: "Clement", weight: 1.0 },
    { id: "cici", name: "Cici", weight: 1.0 },
    { id: "caylee", name: "Caylee", weight: 0.5 },
    { id: "colby", name: "Colby", weight: 0.0 },
    { id: "larry", name: "Larry", weight: 1.0 },
  ],
  expenses: [], // {id, payerId, amount, currency, shareIds, note, ts, items?}
  settledPaid: [], // marked-as-paid settlements {from,to,amount,currency,ts}
};

const load = () => { try { return JSON.parse(localStorage.getItem("fairshare")) || DEFAULT; } catch { return DEFAULT; } };
const save = (s) => localStorage.setItem("fairshare", JSON.stringify(s));
let S = load();

const $ = (id) => document.getElementById(id);
const money = (n, c) => `${SYM[c] || ""}${Number(n).toFixed(2)}`;
const initials = (name) => name.slice(0, 2).toUpperCase();
const memberById = (id) => S.members.find((m) => m.id === id);
const uid = () => Math.random().toString(36).slice(2, 9);

// ---- balances, held per currency ----
function balancesByCurrency() {
  const byCur = {};
  for (const e of S.expenses) (byCur[e.currency] ||= []).push(e);
  const out = {};
  for (const [cur, exps] of Object.entries(byCur)) {
    const net = netBalances(exps.map((e) => ({
      payerId: e.payerId, amount: e.amount, members: S.members,
      shareIds: e.shareIds && e.shareIds.length ? e.shareIds : null,
      items: e.items, taxTip: e.taxTip || 0,
    })));
    // apply marked-paid settlements (honor system) for this currency
    for (const p of S.settledPaid.filter((x) => x.currency === cur)) {
      net[p.from] = (net[p.from] || 0) + p.amount; // payer of debt reduces what they owe
      net[p.to] = (net[p.to] || 0) - p.amount;
    }
    out[cur] = net;
  }
  return out;
}

// ---- render ----
function render() {
  $("groupline").textContent = `${S.name} · tally mode`;
  const byCur = balancesByCurrency();

  // balances
  const bWrap = $("balances");
  bWrap.innerHTML = "";
  if (!Object.keys(byCur).length) bWrap.innerHTML = `<div class="empty">No expenses yet. Tap “I paid” after dinner.</div>`;
  for (const [cur, net] of Object.entries(byCur)) {
    for (const m of S.members) {
      const v = Math.round((net[m.id] || 0) * 100) / 100;
      if (Math.abs(v) < 0.01 && S.expenses.length) continue; // hide the settled
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="name"><div class="dot">${initials(m.name)}</div>
        <div>${m.name} <span class="w">w ${m.weight.toFixed(1)}</span></div></div>
        <div class="amt ${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : "−"}${money(Math.abs(v), cur)}<span class="cur-tag">${cur}</span></div>`;
      bWrap.appendChild(row);
    }
  }

  // settle-up
  const sWrap = $("settle");
  sWrap.innerHTML = "";
  let anySettle = false;
  for (const [cur, net] of Object.entries(byCur)) {
    for (const t of settleUp(net)) {
      anySettle = true;
      const d = document.createElement("div");
      d.className = "settle";
      d.innerHTML = `<b>${memberById(t.from).name}</b> → <b>${memberById(t.to).name}</b>
        &nbsp; <span class="amt">${money(t.amount, cur)}</span> <span class="cur-tag">${cur}</span>
        &nbsp; <button class="chip" data-pay="${t.from}|${t.to}|${t.amount}|${cur}">mark paid</button>
        <button class="chip" data-link="${t.from}|${t.to}|${t.amount}|${cur}">send link</button>`;
      sWrap.appendChild(d);
    }
  }
  if (!anySettle) sWrap.innerHTML = `<div class="empty">All square. 🎉</div>`;

  // feed
  const fWrap = $("feed");
  fWrap.innerHTML = S.expenses.length ? "" : `<div class="empty">Nothing yet.</div>`;
  for (const e of [...S.expenses].reverse().slice(0, 8)) {
    const who = memberById(e.payerId)?.name || "?";
    const d = document.createElement("div");
    d.className = "row";
    d.innerHTML = `<div class="name"><div>${who} paid ${e.items ? "🧾" : ""}<br><span class="muted" style="font-size:12px">${e.note || (e.items ? "receipt" : "dinner")}</span></div></div>
      <div class="amt">${money(e.amount, e.currency)}<span class="cur-tag">${e.currency}</span></div>`;
    fWrap.appendChild(d);
  }

  // people
  const pWrap = $("people");
  pWrap.innerHTML = "";
  for (const m of S.members) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="name"><div class="dot">${initials(m.name)}</div>${m.name}</div>
      <div class="amt muted">weight ${m.weight.toFixed(1)}</div>`;
    pWrap.appendChild(row);
  }

  save(S);
}

// ---- I paid sheet ----
function openPaid() {
  $("amt").value = "";
  $("cur").innerHTML = CURRENCIES.map((c) => `<option ${c === S.currencyDefault ? "selected" : ""}>${c}</option>`).join("");
  $("payer").innerHTML = S.members.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  const chips = $("sharers");
  chips.innerHTML = S.members.map((m) => `<div class="chip on" data-share="${m.id}">${m.name}</div>`).join("");
  chips.querySelectorAll(".chip").forEach((c) => c.onclick = () => c.classList.toggle("on"));
  $("paidDlg").showModal();
}
$("ipaid").onclick = openPaid;
$("savePaid").onclick = () => {
  const amount = parseFloat($("amt").value);
  if (!(amount > 0)) return;
  const shareIds = [...$("sharers").querySelectorAll(".chip.on")].map((c) => c.dataset.share);
  S.expenses.push({ id: uid(), payerId: $("payer").value, amount: Math.round(amount * 100) / 100,
    currency: $("cur").value, shareIds, note: "dinner", ts: Date.now() });
  $("paidDlg").close();
  render();
};

// ---- receipt capture: camera OR upload from library, same handler ----
$("snap").onclick = () => $("camera").click();
$("upload").onclick = () => $("picker").click();
const onPick = async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  await handleReceipt(file);
  ev.target.value = ""; // allow re-selecting the same file
};
$("camera").onchange = onPick;
$("picker").onchange = onPick;

async function handleReceipt(file) {
  // POST the photo to the parse endpoint. If no backend is wired yet, fall back
  // to an empty editable receipt so the flow still works offline.
  showLoading("Reading receipt…");
  let parsed = null;
  try {
    const { b64, mime } = await downscaleImage(file, 1600, 0.7);
    const r = await fetch("/api/parse-receipt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: b64, mime }),
    });
    if (r.ok) parsed = await r.json();
  } catch {}
  finally { hideLoading(); }
  const hint = parsed ? "" : "Couldn’t read that one — enter the total manually below.";
  parsed ||= { merchant: "", currency: S.currencyDefault, items: [], total: 0 };
  showReceipt(parsed, hint, file);
}

let _loadEl;
function showLoading(msg) {
  if (!_loadEl) {
    _loadEl = document.createElement("div");
    _loadEl.id = "loading";
    _loadEl.innerHTML = `<div class="spinner"></div><div class="lmsg"></div>`;
    document.body.appendChild(_loadEl);
  }
  _loadEl.querySelector(".lmsg").textContent = msg || "Working…";
  _loadEl.style.display = "flex";
}
function hideLoading() { if (_loadEl) _loadEl.style.display = "none"; }

function showReceipt(p, hint, file) {
  $("rMerchant").textContent = p.merchant ? `· ${p.merchant}` : "";
  $("rLines").innerHTML = (p.items || []).map((it) =>
    `<div class="receipt-line"><span>${it.qty > 1 ? it.qty + "× " : ""}${it.name}</span><span>${money(it.price, p.currency)}</span></div>`).join("")
    || `<div class="receipt-line"><span class="muted">No line items</span><span></span></div>`;
  // Amount is derived from items + tax + tip so the split always reconciles
  // (the payer credit must equal the sum of everyone's shares, or net won't zero).
  const itemsSum = (p.items || []).reduce((s, it) => s + Number(it.price || 0), 0);
  const subtotal = Number(p.subtotal) || itemsSum;   // tip % is on the pre-tax subtotal
  const tax = Number(p.tax || 0);

  // Tip is editable and often NOT on the receipt (added on top later).
  $("rTip").value = p.tip ? Number(p.tip).toFixed(2) : "";
  const currentTip = () => { const v = parseFloat($("rTip").value); return v > 0 ? v : 0; };
  const total = () => Math.round((itemsSum + tax + currentTip()) * 100) / 100;

  // Default the currency picker to CAD (Boss decision) — editable before saving.
  // USD is the model's own fallback, so we don't trust it over the CAD default.
  const preCur = (p.currency && p.currency !== "USD") ? p.currency : "CAD";
  $("rCur").innerHTML = CURRENCIES.map((c) => `<option ${c === preCur ? "selected" : ""}>${c}</option>`).join("");

  const rerenderTotal = () => { $("rTotal").textContent = money(total(), $("rCur").value); };
  $("tipQuick").innerHTML = [15, 18, 20].map((pct) => `<div class="chip" data-tippct="${pct}">${pct}%</div>`).join("");
  $("tipQuick").querySelectorAll(".chip").forEach((c) => c.onclick = () => {
    $("rTip").value = (subtotal * (Number(c.dataset.tippct) / 100)).toFixed(2);
    rerenderTotal();
  });
  $("rTip").oninput = rerenderTotal;
  $("rCur").onchange = rerenderTotal;
  rerenderTotal();

  $("rPayer").innerHTML = S.members.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  $("rHint").textContent = hint;
  $("saveReceipt").onclick = () => {
    S.expenses.push({ id: uid(), payerId: $("rPayer").value, amount: total(),
      currency: $("rCur").value, shareIds: [], note: p.merchant || "receipt",
      items: (p.items || []).map((it) => ({ price: Number(it.price) || 0 })),
      taxTip: Math.round((tax + currentTip()) * 100) / 100, ts: Date.now() });
    $("receiptDlg").close();
    render();
  };
  $("receiptDlg").showModal();
}

// ---- settle actions (event delegation) ----
document.addEventListener("click", (ev) => {
  const pay = ev.target.dataset?.pay;
  const link = ev.target.dataset?.link;
  if (pay) {
    const [from, to, amount, currency] = pay.split("|");
    S.settledPaid.push({ from, to, amount: parseFloat(amount), currency, ts: Date.now() });
    render();
  }
  if (link) {
    const [from, to, amount, currency] = link.split("|");
    // Interac/Venmo deep links are just a formatted request for now (prototype).
    const note = encodeURIComponent(`${S.name} — settle up`);
    const venmo = `https://venmo.com/?txn=pay&note=${note}&amount=${amount}`;
    alert(`Send ${money(amount, currency)} from ${memberById(from).name} to ${memberById(to).name}\n\nVenmo: ${venmo}\n(Interac e-transfer link → TODO: generate from email)`);
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]); // strip data: prefix
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Shrink a phone photo (often 3–8MB) before upload: cap the long edge and
// re-encode as JPEG. Cuts upload time + OpenAI cost; text stays legible at 1600px.
// Falls back to the raw file if the canvas path fails for any reason.
async function downscaleImage(file, maxEdge = 1600, quality = 0.7) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return { b64: dataUrl.split(",")[1], mime: "jpeg" };
  } catch {
    return { b64: await fileToBase64(file), mime: (file.type.split("/")[1] || "jpeg").toLowerCase() };
  }
}

// ---- service worker ----
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

render();
