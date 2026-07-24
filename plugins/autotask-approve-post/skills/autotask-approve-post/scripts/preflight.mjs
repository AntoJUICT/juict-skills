// preflight.mjs — pure logica bovenaan; I/O + main() onderaan (Task 3/4).
export const ALL_RULES = ["labour.missingWorkType","labour.zeroHours","labour.missingRole","labour.emptySummary","labour.outsidePeriod","charge.missingWorkType","charge.zeroAmount","charge.negativeAmount","charge.notBillableFlag"];

const iso = (d) => d.toISOString().slice(0, 10);
function prevMonth(now) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return { start: iso(new Date(Date.UTC(y, m - 1, 1))), end: iso(new Date(Date.UTC(y, m, 0))) };
}
export function loadConfig(raw, now) {
  const r = raw ?? {}, pm = prevMonth(now);
  return {
    periodStart: typeof r.periodStart === "string" ? r.periodStart : pm.start,
    periodEnd: typeof r.periodEnd === "string" ? r.periodEnd : pm.end,
    enabledRules: Array.isArray(r.enabledRules) ? r.enabledRules : [...ALL_RULES],
    minChargeAmount: typeof r.minChargeAmount === "number" ? r.minChargeAmount : 0,
    neverBillBillingCodeIDs: Array.isArray(r.neverBillBillingCodeIDs) ? r.neverBillBillingCodeIDs : [],
  };
}
const inPeriod = (date, cfg) => { if (!date) return false; const d = date.slice(0, 10); return d >= cfg.periodStart && d <= cfg.periodEnd; };

export function checkLabour(t, cfg) {
  const problems = [], on = (r) => cfg.enabledRules.includes(r);
  const hours = t.hoursToBill ?? t.hoursWorked ?? 0;
  if (on("labour.missingWorkType") && !t.billingCodeID) problems.push({ code: "labour.missingWorkType", message: "geen work type (billingCodeID)" });
  if (on("labour.zeroHours") && hours <= 0) problems.push({ code: "labour.zeroHours", message: "0 uur te factureren" });
  if (on("labour.missingRole") && !t.roleID) problems.push({ code: "labour.missingRole", message: "geen roleID" });
  if (on("labour.emptySummary") && (!t.summaryNotes || t.summaryNotes.trim() === "")) problems.push({ code: "labour.emptySummary", message: "lege summary (wordt factuurregel)" });
  if (on("labour.outsidePeriod") && !inPeriod(t.dateWorked, cfg)) problems.push({ code: "labour.outsidePeriod", message: `dateWorked buiten periode (${t.dateWorked ?? "leeg"})` });
  return { kind: "labour", id: t.id, companyID: t.companyID, contractID: t.contractID, ticketID: t.ticketID, label: `TimeEntry ${t.id} — ${hours}u`, amountEUR: null, hours, problems };
}

export function checkCharge(c, kind, cfg) {
  const problems = [], on = (r) => cfg.enabledRules.includes(r);
  const amount = c.billableAmount ?? (c.unitPrice ?? 0) * (c.unitQuantity ?? 0);
  if (on("charge.missingWorkType") && !c.billingCodeID && !c.productID) problems.push({ code: "charge.missingWorkType", message: "geen work type en geen product" });
  if (on("charge.zeroAmount") && amount === 0) problems.push({ code: "charge.zeroAmount", message: "bedrag is 0" });
  if (on("charge.negativeAmount") && amount < 0) problems.push({ code: "charge.negativeAmount", message: `negatief bedrag (${amount})` });
  if (on("charge.notBillableFlag") && !c.isBillableToCompany) problems.push({ code: "charge.notBillableFlag", message: "niet-facturabel gemarkeerd" });
  if (cfg.neverBillBillingCodeIDs.includes(c.billingCodeID ?? -1)) problems.push({ code: "charge.neverBillCode", message: "work type staat op nooit-factureren" });
  const kindLabel = kind === "ticketCharge" ? "TicketCharge" : kind === "contractCharge" ? "ContractCharge" : "ProjectCharge";
  return { kind, id: c.id, companyID: c.companyID, contractID: c.contractID, ticketID: c.ticketID, label: `${kindLabel} ${c.id} — ${c.name ?? "(geen naam)"}`, amountEUR: amount, hours: null, problems };
}

export function groupItems(items, names) {
  const companies = new Map();
  for (const item of items) {
    if (!companies.has(item.companyID)) companies.set(item.companyID, new Map());
    const contracts = companies.get(item.companyID);
    const key = item.contractID === null ? "null" : String(item.contractID);
    if (!contracts.has(key)) contracts.set(key, { contractID: item.contractID, tickets: [], looseItems: [] });
    const cg = contracts.get(key);
    if (item.ticketID === null) cg.looseItems.push(item);
    else { let tg = cg.tickets.find((t) => t.ticketID === item.ticketID); if (!tg) { tg = { ticketID: item.ticketID, items: [] }; cg.tickets.push(tg); } tg.items.push(item); }
  }
  const result = [];
  for (const [companyID, contracts] of companies) {
    const list = [...contracts.values()].sort((a, b) => (a.contractID ?? Infinity) - (b.contractID ?? Infinity));
    for (const c of list) c.tickets.sort((a, b) => a.ticketID - b.ticketID);
    result.push({ companyID, companyName: names.get(companyID) ?? `Company ${companyID}`, contracts: list });
  }
  return result.sort((a, b) => a.companyName.localeCompare(b.companyName));
}

const money = (n) => n === null ? "" : `€${n.toFixed(2)}`;
function itemLine(i) {
  if (i.problems.length === 0) return `  - ${i.label} ${money(i.amountEUR)}`.trimEnd();
  return `  - ⚠️ ${i.label} — ${i.problems.map((p) => p.message).join("; ")}`;
}
export function renderReport(groups, periodLabel) {
  const all = [];
  for (const g of groups) for (const c of g.contracts) { for (const t of c.tickets) all.push(...t.items); all.push(...c.looseItems); }
  const withProblems = all.filter((i) => i.problems.length > 0);
  const totalEUR = all.reduce((s, i) => s + (i.amountEUR ?? 0), 0);
  const lines = [`# Approve & Post pre-flight — ${periodLabel}`, ""];
  lines.push(`**${groups.length} klant${groups.length === 1 ? "" : "en"}**, ${all.length} pending items, ${withProblems.length} item${withProblems.length === 1 ? "" : "s"} met problemen, totaal ${money(totalEUR)}.`, "");
  const renderItems = (items) => {
    const clean = items.filter((i) => i.problems.length === 0), bad = items.filter((i) => i.problems.length > 0);
    const cleanEUR = clean.reduce((s, i) => s + (i.amountEUR ?? 0), 0);
    if (clean.length) { lines.push(`✅ SCHOON (${clean.length} items${cleanEUR ? `, ${money(cleanEUR)}` : ""})`); for (const i of clean) lines.push(itemLine(i)); }
    if (bad.length) { lines.push(`⚠️ EERST FIXEN (${bad.length})`); for (const i of bad) lines.push(itemLine(i)); }
  };
  for (const g of groups) {
    lines.push(`## Klant: ${g.companyName}`, "");
    for (const c of g.contracts) {
      lines.push(`### Contract ${c.contractID ?? "(geen contract)"}`);
      for (const t of c.tickets) { lines.push(`#### Ticket ${t.ticketID}`); renderItems(t.items); }
      if (c.looseItems.length) { lines.push(`#### Losse charges (geen ticket)`); renderItems(c.looseItems); }
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// TASK 3: I/O-laag + verify-subcommand (read-only)
// ─────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";

const VAULT = "juict-kv-g4fhuo35";
const BASE = "https://webservices19.autotask.net/ATServicesRest/V1.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getSecret(name) {
  return execFileSync("az", ["keyvault", "secret", "show", "--vault-name", VAULT, "--name", name, "--query", "value", "-o", "tsv"], { encoding: "utf8" }).trim();
}
function authHeaders() {
  return { UserName: getSecret("AUTOTASK-USERNAME"), Secret: getSecret("AUTOTASK-API-KEY"), ApiIntegrationCode: getSecret("AUTOTASK-INTEGRATION-CODE"), "Content-Type": "application/json", Accept: "application/json" };
}
async function atFetchAll(entity, filterItems) {
  const headers = authHeaders();
  const body = JSON.stringify({ filter: [{ op: "and", items: filterItems }], maxRecords: 500 });
  let url = `${BASE}/${entity}/query`, method = "POST", out = [];
  while (url) {
    let res, ok = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(Math.pow(2, attempt) * 500);
      res = await fetch(url, { method, headers, body: method === "POST" ? body : undefined });
      if (res.status === 429 || res.status >= 500) continue;
      ok = true; break;
    }
    if (!ok || !res.ok) throw new Error(`${entity} query ${res?.status}`);
    const json = await res.json();
    out.push(...(json.items ?? []));
    url = json.pageDetails?.nextPageUrl ?? null; method = "GET";
  }
  return out;
}

function mapCharge(c) {
  return { id: c.id, billingCodeID: c.billingCodeID ?? null, status: c.status ?? null, isBillableToCompany: !!c.isBillableToCompany, isBilled: !!c.isBilled, name: c.name ?? null, description: c.description ?? null, productID: c.productID ?? null, unitPrice: c.unitPrice ?? null, unitQuantity: c.unitQuantity ?? null, billableAmount: c.billableAmount ?? null, datePurchased: c.datePurchased ?? null, createDate: c.createDate ?? null, companyID: 0, contractID: c.contractID ?? null, ticketID: c.ticketID ?? null, projectID: c.projectID ?? null };
}
async function fetchChargeEntity(entity, cfg) {
  const rows = await atFetchAll(entity, [{ field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }]);
  return rows.map(mapCharge).filter((c) => { const d = (c.datePurchased ?? c.createDate ?? "").slice(0, 10); return d === "" || (d >= cfg.periodStart && d <= cfg.periodEnd); });
}
export async function fetchPendingCharges(cfg) {
  return { ticket: await fetchChargeEntity("TicketCharges", cfg), contract: await fetchChargeEntity("ContractCharges", cfg), project: await fetchChargeEntity("ProjectCharges", cfg) };
}
export async function fetchPendingLabour(cfg) {
  const rows = await atFetchAll("TimeEntries", [{ field: "isNonBillable", op: "eq", value: false }, { field: "dateWorked", op: "gte", value: `${cfg.periodStart}T00:00:00` }, { field: "dateWorked", op: "lte", value: `${cfg.periodEnd}T23:59:59` }]);
  return rows.filter((t) => t.billingApprovalDateTime == null).map((t) => ({ id: t.id, ticketID: t.ticketID ?? null, taskID: t.taskID ?? null, contractID: t.contractID ?? null, resourceID: t.resourceID ?? null, roleID: t.roleID ?? null, billingCodeID: t.billingCodeID ?? null, hoursWorked: t.hoursWorked ?? null, hoursToBill: t.hoursToBill ?? null, isNonBillable: !!t.isNonBillable, billingApprovalDateTime: t.billingApprovalDateTime ?? null, dateWorked: t.dateWorked ?? null, summaryNotes: t.summaryNotes ?? null, companyID: 0 }));
}

async function verify(contractID) {
  const cfg = loadConfig({}, new Date());
  const charges = await atFetchAll("ContractCharges", [{ field: "contractID", op: "eq", value: Number(contractID) }, { field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }]);
  const labour = (await atFetchAll("TimeEntries", [{ field: "contractID", op: "eq", value: Number(contractID) }, { field: "isNonBillable", op: "eq", value: false }])).filter((t) => t.billingApprovalDateTime == null);
  console.log(`Contract ${contractID}: ${charges.length} pending ContractCharges, ${labour.length} nog-te-approven time entries. Vergelijk met het Approve & Post-scherm.`);
}
