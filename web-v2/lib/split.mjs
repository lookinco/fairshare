#!/usr/bin/env node
// FairShare split engine — the brain. Pure functions, no I/O, no deps.
//
// Core idea: people carry a WEIGHT (adult 1.0, kid 0.5, toddler 0.0). Every
// split divides a cost by summed weight of whoever shares it, never by
// headcount — that's what makes different family sizes/ages fair.
//
// Run the self-test:  ./split.mjs
//
// Two things it computes:
//   1. splitExpense() — how one bill (even OR itemized) breaks down per person.
//   2. netBalances()  — fold a list of expenses into a running "who owes whom".

// ---- weighted even split -------------------------------------------------
// members: [{id, weight}]  shareIds: which members share this cost (default all)
export function splitEven(amount, members, shareIds = null) {
  const sharers = shareIds ? members.filter(m => shareIds.includes(m.id)) : members;
  const totalW = sharers.reduce((s, m) => s + m.weight, 0);
  if (totalW <= 0) throw new Error("total weight is zero — nobody to split across");
  const shares = {};
  for (const m of sharers) shares[m.id] = round2(amount * (m.weight / totalW));
  return reconcilePennies(shares, amount, sharers);
}

// ---- itemized split ------------------------------------------------------
// items: [{ price, sharedBy?: [memberId...] }]  — sharedBy omitted = whole group
// taxTip: added on top, allocated proportionally to each person's item subtotal.
export function splitItemized(items, members, taxTip = 0) {
  const subtotal = {};
  for (const m of members) subtotal[m.id] = 0;
  for (const it of items) {
    const line = splitEven(it.price, members, it.sharedBy || null);
    for (const id of Object.keys(line)) subtotal[id] += line[id];
  }
  const itemsTotal = Object.values(subtotal).reduce((a, b) => a + b, 0);
  const out = {};
  for (const m of members) {
    const share = itemsTotal > 0 ? subtotal[m.id] / itemsTotal : 0;
    out[m.id] = round2(subtotal[m.id] + taxTip * share);
  }
  return reconcilePennies(out, round2(itemsTotal + taxTip), members);
}

// ---- running balances ----------------------------------------------------
// expenses: [{ payerId, amount, members, shareIds?, items?, taxTip? }]
// Returns { memberId: net } where +ve = they are owed, -ve = they owe.
export function netBalances(expenses) {
  const net = {};
  const bump = (id, v) => { net[id] = round2((net[id] || 0) + v); };
  for (const e of expenses) {
    const shares = e.items
      ? splitItemized(e.items, e.members, e.taxTip || 0)
      : splitEven(e.amount, e.members, e.shareIds || null);
    for (const id of Object.keys(shares)) bump(id, -shares[id]); // everyone owes their share
    bump(e.payerId, e.amount);                                   // payer fronted the whole thing
  }
  return net;
}

// Greedy settle-up: fewest transfers to zero everyone out.
export function settleUp(net) {
  const debtors = [], creditors = [];
  for (const [id, v] of Object.entries(net)) {
    if (v < -0.005) debtors.push({ id, v: -v });
    else if (v > 0.005) creditors.push({ id, v });
  }
  debtors.sort((a, b) => b.v - a.v); creditors.sort((a, b) => b.v - a.v);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].v, creditors[j].v);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: round2(pay) });
    debtors[i].v -= pay; creditors[j].v -= pay;
    if (debtors[i].v < 0.005) i++;
    if (creditors[j].v < 0.005) j++;
  }
  return transfers;
}

// ---- cross-group smart-settle -------------------------------------------
// A user/family is in many groups. Instead of settling each group separately,
// aggregate every SETTLING ENTITY's net across all opted-in groups, then run
// the same greedy min-transfer once on the global vector → fewest payments
// network-wide (owe Larry $50 in group A, he owes $30 in group B → one $20).
//
// groups: [{
//   id, includeInSmartSettle (default true),
//   net:      { participantId: cadAmount },   // per-group net, in the CAD base
//   entityOf: { participantId: entityId },    // which settling entity owns it
// }]
// A settling entity = a user account OR a family (its designated payer). Every
// participant resolves to exactly one entity — that's the netting key.
//
// Currency: operates on the single CAD base only (v2 locked CAD as source of
// truth). Never mix currencies here.
export function smartSettle(groups) {
  const global = {};
  const included = [];
  for (const g of groups) {
    if (g.includeInSmartSettle === false) continue;
    included.push(g.id);
    for (const [pid, v] of Object.entries(g.net || {})) {
      const entity = g.entityOf?.[pid];
      if (!entity) throw new Error(`participant "${pid}" in group "${g.id}" has no settling entity`);
      global[entity] = round2((global[entity] || 0) + v);
    }
  }
  const transfers = settleUp(global);
  // How many payments per-group settling would have needed, for the "saved" pitch.
  const perGroup = groups
    .filter(g => g.includeInSmartSettle !== false)
    .reduce((n, g) => n + settleUp(rekeyToEntities(g)).length, 0);
  return { net: global, transfers, includedGroups: included, perGroupTransfers: perGroup, saved: perGroup - transfers.length };
}

// A group's per-group settle should also net at the entity level (two members
// of one family cancel out), so count it the same way smart-settle does.
function rekeyToEntities(g) {
  const byEntity = {};
  for (const [pid, v] of Object.entries(g.net || {})) {
    const e = g.entityOf?.[pid] || pid;
    byEntity[e] = round2((byEntity[e] || 0) + v);
  }
  return byEntity;
}

// ---- helpers -------------------------------------------------------------
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
// Rounding can lose/gain a penny vs the true total; drop the diff on the
// largest-weight sharer so the parts always sum to the whole.
function reconcilePennies(shares, target, sharers) {
  const sum = Object.values(shares).reduce((a, b) => a + b, 0);
  const diff = round2(target - sum);
  if (Math.abs(diff) >= 0.01) {
    const big = sharers.slice().sort((a, b) => b.weight - a.weight)[0];
    shares[big.id] = round2(shares[big.id] + diff);
  }
  return shares;
}

// ---- self-test -----------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok  ", msg); };

  // Two families at dinner: Clement's (2 adults, 1 kid, 1 toddler) + Larry's (1 adult).
  const members = [
    { id: "clement", weight: 1.0 }, { id: "cici", weight: 1.0 },
    { id: "caylee", weight: 0.5 }, { id: "colby", weight: 0.0 },
    { id: "larry", weight: 1.0 },
  ]; // total weight = 3.5

  const s = splitEven(350, members);
  assert(s.clement === 100 && s.larry === 100, "adult pays 1.0/3.5 * 350 = 100");
  assert(s.caylee === 50, "kid pays 0.5/3.5 * 350 = 50");
  assert(s.colby === 0, "toddler pays 0");
  assert(Object.values(s).reduce((a, b) => a + b, 0) === 350, "even split sums to total");

  const items = [
    { price: 60, sharedBy: ["clement", "cici"] }, // a shared plate for 2 adults
    { price: 20, sharedBy: ["caylee"] },           // kid's meal
    { price: 30, sharedBy: ["larry"] },
  ];
  const it = splitItemized(items, members, 22); // +$22 tax/tip
  assert(Math.abs(Object.values(it).reduce((a, b) => a + b, 0) - 132) < 0.001, "itemized+taxtip sums to 132");
  assert(it.colby === 0, "toddler shared no items → owes 0");

  const bal = netBalances([
    { payerId: "clement", amount: 350, members },          // Clement pays dinner 1
    { payerId: "larry", amount: 140, members, shareIds: ["clement", "larry"] }, // Larry buys drinks for the 2 of them
  ]);
  assert(Math.abs(Object.values(bal).reduce((a, b) => a + b, 0)) < 0.001, "net balances sum to zero");
  console.log("\nnet balances:", bal);
  console.log("settle-up:", settleUp(bal));

  // ---- cross-group smart-settle ----
  // Spec example: in group A Clement owes Larry $50; in group B Larry owes
  // Clement $30. Net across both → one $20 payment, not two.
  const ss = smartSettle([
    { id: "A", net: { clement: -50, larry: 50 }, entityOf: { clement: "clement", larry: "larry" } },
    { id: "B", net: { clement: 30, larry: -30 }, entityOf: { clement: "clement", larry: "larry" } },
  ]);
  assert(ss.transfers.length === 1, "smart-settle collapses A+B into ONE payment");
  assert(ss.transfers[0].from === "clement" && ss.transfers[0].to === "larry" && ss.transfers[0].amount === 20,
    "smart-settle nets to Clement→Larry $20");
  assert(ss.perGroupTransfers === 2 && ss.saved === 1, "smart-settle saves 1 payment vs per-group");

  // Two members of one family net out to their family entity (family = wallet).
  const ss2 = smartSettle([
    { id: "trip", net: { cici: -40, caylee: -10, larry: 50 },
      entityOf: { cici: "fam_clement", caylee: "fam_clement", larry: "larry" } },
  ]);
  assert(ss2.transfers.length === 1 && ss2.transfers[0].from === "fam_clement" &&
    ss2.transfers[0].to === "larry" && ss2.transfers[0].amount === 50,
    "family members roll up to one family wallet → single $50 payment");

  // Opt-out excludes a group from the global net.
  const ss3 = smartSettle([
    { id: "A", net: { clement: -50, larry: 50 }, entityOf: { clement: "clement", larry: "larry" } },
    { id: "B", includeInSmartSettle: false, net: { clement: 30, larry: -30 }, entityOf: { clement: "clement", larry: "larry" } },
  ]);
  assert(ss3.transfers.length === 1 && ss3.transfers[0].amount === 50 && ss3.includedGroups.length === 1,
    "opted-out group B is excluded → full $50 still owed");

  console.log("\nsmart-settle (A+B):", ss.transfers, `| saved ${ss.saved} payment(s)`);
}
