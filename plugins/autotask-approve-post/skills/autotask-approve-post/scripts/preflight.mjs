// preflight.mjs: pure logica bovenaan; I/O + main() onderaan (Task 3/4).
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
  return { kind: "labour", id: t.id, companyID: t.companyID, contractID: t.contractID, ticketID: t.ticketID, label: `TimeEntry ${t.id} - ${hours}u`, amountEUR: null, hours, problems };
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
  return { kind, id: c.id, companyID: c.companyID, contractID: c.contractID, ticketID: c.ticketID, label: `${kindLabel} ${c.id} - ${c.name ?? "(geen naam)"}`, amountEUR: amount, hours: null, problems };
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
    const companyName = companyID === 0 ? "⚠️ Niet toegewezen (controleer handmatig)" : names.get(companyID) ?? `Company ${companyID}`;
    result.push({ companyID, companyName, contracts: list });
  }
  return result.sort((a, b) => a.companyName.localeCompare(b.companyName));
}

const money = (n) => n === null ? "" : `€${n.toFixed(2)}`;
function itemLine(i) {
  if (i.problems.length === 0) return `  - ${i.label} ${money(i.amountEUR)}`.trimEnd();
  return `  - ⚠️ ${i.label} - ${i.problems.map((p) => p.message).join("; ")}`;
}
export function renderReport(groups, periodLabel) {
  const all = [];
  for (const g of groups) for (const c of g.contracts) { for (const t of c.tickets) all.push(...t.items); all.push(...c.looseItems); }
  const withProblems = all.filter((i) => i.problems.length > 0);
  const totalEUR = all.reduce((s, i) => s + (i.amountEUR ?? 0), 0);
  const lines = [`# Approve & Post pre-flight - ${periodLabel}`, ""];
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
// review-subcommand: pure kern (buildReview), groepeert per ticket,
// past checkLabour/checkCharge toe, berekent totalen.
// ─────────────────────────────────────────────────────────────────────

function mapGet(mapLike, key) {
  if (mapLike == null) return undefined;
  if (typeof mapLike.get === "function") return mapLike.get(key);
  return mapLike[key];
}

export function buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg) {
  const byTicket = new Map(); // ticketID -> { timeEntries: [], charges: [] }
  const ensure = (ticketID) => {
    if (!byTicket.has(ticketID)) byTicket.set(ticketID, { timeEntries: [], charges: [] });
    return byTicket.get(ticketID);
  };

  let billableHours = 0;
  for (const t of timeEntries) {
    const checked = checkLabour(t, cfg);
    billableHours += checked.hours;
    const workTypeName = t.billingCodeID != null ? mapGet(workTypeNames, t.billingCodeID) ?? null : null;
    const item = { id: t.id, hours: checked.hours, workType: workTypeName, summary: t.summaryNotes ?? null, problems: checked.problems };
    if (t.ticketID != null) ensure(t.ticketID).timeEntries.push(item);
  }

  let chargeAmountEUR = 0;
  const looseCharges = [];
  for (const c of charges) {
    const kind = c.kind ?? "ticketCharge";
    const checked = checkCharge(c, kind, cfg);
    const amountEUR = checked.amountEUR ?? 0;
    chargeAmountEUR += amountEUR;
    const item = { id: c.id, name: c.name ?? null, amountEUR, kind, problems: checked.problems };
    if (c.ticketID != null) ensure(c.ticketID).charges.push(item);
    else looseCharges.push(item);
  }

  const reviewTickets = [];
  for (const ticket of tickets) {
    const grouped = byTicket.get(ticket.id);
    if (!grouped || (grouped.timeEntries.length === 0 && grouped.charges.length === 0)) continue;
    const issues = [
      ...grouped.timeEntries.flatMap((i) => i.problems.map((p) => ({ ...p, source: `timeEntry:${i.id}` }))),
      ...grouped.charges.flatMap((i) => i.problems.map((p) => ({ ...p, source: `${i.kind}:${i.id}` }))),
    ];
    reviewTickets.push({
      ticketID: ticket.id,
      title: ticket.title ?? null,
      description: ticket.description ?? null,
      notes: mapGet(notesByTicket, ticket.id) ?? [],
      billableHours: grouped.timeEntries.reduce((s, i) => s + i.hours, 0),
      timeEntries: grouped.timeEntries,
      charges: grouped.charges,
      issues,
    });
  }

  return {
    company,
    period: { start: cfg.periodStart, end: cfg.periodEnd },
    totals: {
      billableHours,
      chargeAmountEUR,
      ticketCount: reviewTickets.length,
      timeEntryCount: timeEntries.length,
      chargeCount: charges.length,
    },
    tickets: reviewTickets,
    looseCharges,
  };
}

// ─────────────────────────────────────────────────────────────────────
// TASK 3: I/O-laag + verify-subcommand (read-only)
// ─────────────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
import fs from "node:fs";

const VAULT = "juict-kv-g4fhuo35";
const BASE = "https://webservices19.autotask.net/ATServicesRest/V1.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getSecret(name) {
  return execSync(`az keyvault secret show --vault-name ${VAULT} --name ${name} --query value -o tsv`, { encoding: "utf8" }).trim();
}
let _headers = null;
function authHeaders() {
  if (!_headers) _headers = { UserName: getSecret("AUTOTASK-USERNAME"), Secret: getSecret("AUTOTASK-API-KEY"), ApiIntegrationCode: getSecret("AUTOTASK-INTEGRATION-CODE"), "Content-Type": "application/json", Accept: "application/json" };
  return _headers;
}
async function atFetchAll(entity, filterItems) {
  const headers = authHeaders();
  const body = JSON.stringify({ filter: [{ op: "and", items: filterItems }], maxRecords: 500 });
  let url = `${BASE}/${entity}/query`, out = [];
  while (url) {
    let res, ok = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(Math.pow(2, attempt) * 500);
      res = await fetch(url, { method: "POST", headers, body });
      if (res.status === 429 || res.status >= 500) continue;
      ok = true; break;
    }
    if (!ok || !res.ok) throw new Error(`${entity} query ${res?.status}`);
    const json = await res.json();
    out.push(...(json.items ?? []));
    url = json.pageDetails?.nextPageUrl ?? null;
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

// ─────────────────────────────────────────────────────────────────────
// review-subcommand: I/O-laag (resolveCompany, fetchReview)
// ─────────────────────────────────────────────────────────────────────

export async function resolveCompany(input) {
  const trimmed = String(input).trim();
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    const rows = await atFetchAll("Companies", [{ field: "id", op: "eq", value: id }]);
    if (!rows[0]) throw new Error(`Company ${id} niet gevonden`);
    return { id: rows[0].id, name: rows[0].companyName };
  }
  const rows = await atFetchAll("Companies", [{ field: "companyName", op: "contains", value: trimmed }]);
  if (rows.length === 0) throw new Error(`Geen company gevonden voor "${trimmed}"`);
  if (rows.length > 1) return { candidates: rows.map((r) => ({ id: r.id, name: r.companyName })) };
  return { id: rows[0].id, name: rows[0].companyName };
}

// Levert de set opgehaalde-id's die al een BillingItem hebben (dus al gepost zijn).
// billingApprovalDateTime is NIET betrouwbaar als pending-indicator (24/31 bleek al
// gepost bij testklant 251), de BillingItem-kruisverwijzing is de autoritatieve check.
async function postedIds(billingItemField, ids) {
  if (ids.length === 0) return new Set();
  const rows = await atFetchAll("BillingItems", [{ field: billingItemField, op: "in", value: ids }]);
  return new Set(rows.map((r) => r[billingItemField]).filter((x) => x != null));
}

async function fetchWorkTypeNames() {
  const rows = await atFetchAll("BillingCodes", [{ field: "isActive", op: "eq", value: true }, { field: "billingCodeType", op: "eq", value: 0 }, { field: "useType", op: "eq", value: 1 }]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function fetchNotesByTicket(ticketIds) {
  const notesByTicket = new Map();
  for (const ticketID of ticketIds) {
    const notes = await atFetchAll("TicketNotes", [{ field: "ticketID", op: "eq", value: ticketID }]);
    notesByTicket.set(ticketID, notes.map((n) => ({ date: n.lastActivityDate ?? null, text: n.description ?? n.title ?? null, publish: n.publish ?? null })));
  }
  return notesByTicket;
}

export async function fetchReview(companyInput, cfg) {
  const resolved = await resolveCompany(companyInput);
  if (resolved.candidates) {
    console.error(`Meerdere klanten gevonden voor "${companyInput}", geef een companyID mee:`);
    for (const c of resolved.candidates) console.error(`  ${c.id}: ${c.name}`);
    return resolved;
  }
  const company = { id: resolved.id, name: resolved.name };

  const contracts = await atFetchAll("Contracts", [{ field: "companyID", op: "eq", value: company.id }]);
  const contractIds = contracts.map((c) => c.id);

  const ticketsRaw = await atFetchAll("Tickets", [{ field: "companyID", op: "eq", value: company.id }]);
  const tickets = ticketsRaw.map((t) => ({ id: t.id, ticketNumber: t.ticketNumber ?? null, title: t.title ?? null, description: t.description ?? null }));
  const ticketIds = tickets.map((t) => t.id);

  const projects = await atFetchAll("Projects", [{ field: "companyID", op: "eq", value: company.id }]);
  const projectIds = projects.map((p) => p.id);

  const labourRaw = contractIds.length ? await atFetchAll("TimeEntries", [{ field: "contractID", op: "in", value: contractIds }, { field: "isNonBillable", op: "eq", value: false }]) : [];
  const ticketChargesRaw = ticketIds.length ? await atFetchAll("TicketCharges", [{ field: "ticketID", op: "in", value: ticketIds }, { field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }]) : [];
  const contractChargesRaw = contractIds.length ? await atFetchAll("ContractCharges", [{ field: "contractID", op: "in", value: contractIds }, { field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }]) : [];
  const projectChargesRaw = projectIds.length ? await atFetchAll("ProjectCharges", [{ field: "projectID", op: "in", value: projectIds }, { field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }]) : [];

  const postedTimeEntryIds = await postedIds("timeEntryID", labourRaw.map((t) => t.id));
  const postedTicketChargeIds = await postedIds("ticketChargeID", ticketChargesRaw.map((c) => c.id));
  const postedContractChargeIds = await postedIds("contractChargeID", contractChargesRaw.map((c) => c.id));
  const postedProjectChargeIds = await postedIds("projectChargeID", projectChargesRaw.map((c) => c.id));

  const timeEntries = labourRaw
    .filter((t) => !postedTimeEntryIds.has(t.id))
    .map((t) => ({ id: t.id, ticketID: t.ticketID ?? null, taskID: t.taskID ?? null, contractID: t.contractID ?? null, roleID: t.roleID ?? null, billingCodeID: t.billingCodeID ?? null, hoursWorked: t.hoursWorked ?? null, hoursToBill: t.hoursToBill ?? null, dateWorked: t.dateWorked ?? null, summaryNotes: t.summaryNotes ?? null }));

  const charges = [
    ...ticketChargesRaw.filter((c) => !postedTicketChargeIds.has(c.id)).map((c) => ({ ...mapCharge(c), kind: "ticketCharge" })),
    ...contractChargesRaw.filter((c) => !postedContractChargeIds.has(c.id)).map((c) => ({ ...mapCharge(c), kind: "contractCharge" })),
    // ProjectCharges hangen niet aan een ticket (ticketID blijft null via mapCharge), dus
    // deze landen via buildReview altijd in looseCharges, ook al is de klant zonder
    // projecten gewoon een lege lijst hier.
    ...projectChargesRaw.filter((c) => !postedProjectChargeIds.has(c.id)).map((c) => ({ ...mapCharge(c), kind: "projectCharge" })),
  ];

  const ticketsWithItems = [...new Set([...timeEntries.map((t) => t.ticketID), ...charges.map((c) => c.ticketID)].filter((x) => x != null))];
  const notesByTicket = await fetchNotesByTicket(ticketsWithItems);
  const workTypeNames = await fetchWorkTypeNames();

  const reviewOutput = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);

  console.log(JSON.stringify(reviewOutput, null, 2));
  console.error(`Klant ${company.name} (${company.id}): ${reviewOutput.totals.ticketCount} tickets, ${reviewOutput.totals.timeEntryCount} time entries (${reviewOutput.totals.billableHours}u), ${reviewOutput.totals.chargeCount} charges (€${reviewOutput.totals.chargeAmountEUR.toFixed(2)}), ${reviewOutput.looseCharges.length} losse charges.`);
  return reviewOutput;
}

// ─────────────────────────────────────────────────────────────────────
// TASK 3: set-nonbillable: gated write (enige toegestane mutatie)
// ─────────────────────────────────────────────────────────────────────

export function buildNonBillablePatches(ids) {
  return ids.map((id) => ({ id, isNonBillable: true }));
}

async function realPatchTimeEntry(patch) {
  const res = await fetch(`${BASE}/TimeEntries`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(patch) });
  if (res.ok) return { id: patch.id, status: res.status, ok: true };
  let error;
  try { const body = await res.json(); error = body?.errors?.[0] ?? JSON.stringify(body); } catch { error = await res.text().catch(() => String(res.status)); }
  return { id: patch.id, status: res.status, ok: false, error };
}

export async function setNonBillable(ids, { confirm } = {}, patchFn = realPatchTimeEntry) {
  const patches = buildNonBillablePatches(ids);
  if (!confirm) {
    for (const patch of patches) console.log("[dry-run] PATCH TimeEntries", JSON.stringify(patch));
    return { dryRun: true, patches };
  }
  const results = [];
  for (const patch of patches) {
    const result = await patchFn(patch);
    console.log(`TimeEntry ${patch.id}: ${result.ok ? "OK" : `FOUT (${result.status}) ${result.error ?? ""}`}`);
    results.push(result);
  }
  return { dryRun: false, results };
}

// ─────────────────────────────────────────────────────────────────────
// TASK 4: run-orchestratie + company-verrijking + main()/CLI-dispatch
// ─────────────────────────────────────────────────────────────────────

async function idToCompany(entity, ids) {
  const map = new Map();
  for (const id of [...new Set(ids)].filter((x) => x > 0)) {
    const rows = await atFetchAll(entity, [{ field: "id", op: "eq", value: id }]);
    if (rows[0]) map.set(id, rows[0].companyID);
  }
  return map;
}
async function enrichCompanyIDs(labour, charges) {
  const ticketIDs = [...labour, ...charges.ticket].map((x) => x.ticketID).filter(Boolean);
  const contractIDs = charges.contract.map((c) => c.contractID).filter(Boolean).concat(labour.map((t) => t.contractID).filter(Boolean));
  const projectIDs = charges.project.map((c) => c.projectID).filter(Boolean);
  const tC = await idToCompany("Tickets", ticketIDs), cC = await idToCompany("Contracts", contractIDs), pC = await idToCompany("Projects", projectIDs);
  for (const t of labour) t.companyID = (t.ticketID && tC.get(t.ticketID)) || (t.contractID && cC.get(t.contractID)) || 0;
  for (const c of charges.ticket) c.companyID = (c.ticketID && tC.get(c.ticketID)) || 0;
  for (const c of charges.contract) c.companyID = (c.contractID && cC.get(c.contractID)) || 0;
  for (const c of charges.project) c.companyID = (c.projectID && pC.get(c.projectID)) || 0;
}
async function companyNames(ids) {
  const map = new Map();
  for (const id of [...new Set(ids)].filter((x) => x > 0)) {
    const rows = await atFetchAll("Companies", [{ field: "id", op: "eq", value: id }]);
    if (rows[0]) map.set(id, rows[0].companyName);
  }
  return map;
}
async function readCfg() {
  const raw = fs.existsSync("config.json") ? JSON.parse(fs.readFileSync("config.json", "utf8")) : {};
  return loadConfig(raw, new Date());
}
async function run() {
  const cfg = await readCfg();
  const labour = await fetchPendingLabour(cfg);
  const charges = await fetchPendingCharges(cfg);
  await enrichCompanyIDs(labour, charges);
  const checked = [...labour.map((t) => checkLabour(t, cfg)), ...charges.ticket.map((c) => checkCharge(c, "ticketCharge", cfg)), ...charges.contract.map((c) => checkCharge(c, "contractCharge", cfg)), ...charges.project.map((c) => checkCharge(c, "projectCharge", cfg))];
  const names = await companyNames(checked.map((i) => i.companyID));
  const md = renderReport(groupItems(checked, names), `${cfg.periodStart} t/m ${cfg.periodEnd}`);
  const out = `report-${cfg.periodStart}_${cfg.periodEnd}.md`;
  fs.writeFileSync(out, md, "utf8");
  console.log(`Rapport: ${out} (${checked.length} items)`);
}
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "verify") await verify(rest[0]);
  else if (cmd === "review") {
    const arg = rest[0];
    if (!arg) { console.error("Gebruik: preflight.mjs review <companyID of klantnaam>"); process.exit(1); return; }
    const cfg = await readCfg();
    await fetchReview(arg, cfg);
  }
  else if (cmd === "set-nonbillable") {
    const confirm = rest.includes("--confirm");
    const ids = rest.filter((a) => /^\d+$/.test(a)).map(Number);
    if (ids.length === 0) { console.error("Gebruik: preflight.mjs set-nonbillable <id...> [--dry-run|--confirm]"); process.exit(1); return; }
    await setNonBillable(ids, { confirm });
  }
  else await run();
}
// Alleen draaien als direct aangeroepen (niet bij import in de test):
if (process.argv[1] && process.argv[1].endsWith("preflight.mjs")) main().catch((e) => { console.error(String(e)); process.exit(1); });
