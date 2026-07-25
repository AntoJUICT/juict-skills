// preflight.mjs: pure logica bovenaan; I/O + main() onderaan (Task 3/4).
// charge.neverBillCode is intentionally NOT in ALL_RULES: it fires independently whenever billingCodeID is in neverBillBillingCodeIDs, irrespective of enabledRules.
export const ALL_RULES = ["labour.missingWorkType","labour.zeroHours","labour.missingRole","labour.emptySummary","labour.outsidePeriod","charge.missingWorkType","charge.zeroAmount","charge.negativeAmount","charge.notBillableFlag"];

// Task 10: werk op nog lopende tickets hoort nog niet in approve & post. Een
// ticket is "afgerond" bij status 5 (Complete) of 16 (Autocomplete RMM).
export const COMPLETE_TICKET_STATUSES = new Set([5, 16]);

// PURE: hou een item als het GEEN ticketID heeft (niet ticket-gebonden, dus
// deze regel raakt het niet: contract-/project-charges, taak-uren zonder
// ticket) OF als completeTicketIds.has(item.ticketID) (ticket-gebonden en het
// ticket is afgerond). Ticket-gebonden items op een niet-afgerond ticket
// vallen weg.
export function keepIfTicketComplete(items, completeTicketIds) {
  return items.filter((item) => item.ticketID == null || completeTicketIds.has(item.ticketID));
}

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
    // Task 12 (N3): weegt uren mee in de summary-ranking (chargeEUR + billableHours*rankHourRate).
    rankHourRate: typeof r.rankHourRate === "number" ? r.rankHourRate : 75,
  };
}
// null/ontbrekende datum -> null (onbeslist); anders true/false op basis van [periodStart, periodEnd].
function dateInRange(date, cfg) { if (!date) return null; const d = date.slice(0, 10); return d >= cfg.periodStart && d <= cfg.periodEnd; }
// Task 12.1: periode-check voor de `outsidePeriod`-FLAG in buildReview (niet meer als
// fetch-filter gebruikt: dat verborg legitieme nog-te-posten items met een datum buiten de
// maand). Anders dan dateInRange hierboven (die checkLabour een ontbrekende dateWorked laat
// signaleren als "buiten periode"), telt hier een lege/ontbrekende datum als "in periode":
// een dateless charge (geen datePurchased/createDate) krijgt zo geen valse outsidePeriod-flag.
export function inPeriod(dateStr, cfg) { const r = dateInRange(dateStr, cfg); return r === null ? true : r; }

export function checkLabour(t, cfg) {
  const problems = [], on = (r) => cfg.enabledRules.includes(r);
  const hours = t.hoursToBill ?? t.hoursWorked ?? 0;
  if (on("labour.missingWorkType") && !t.billingCodeID) problems.push({ code: "labour.missingWorkType", message: "geen work type (billingCodeID)" });
  if (on("labour.zeroHours") && hours <= 0) problems.push({ code: "labour.zeroHours", message: "0 uur te factureren" });
  if (on("labour.missingRole") && !t.roleID) problems.push({ code: "labour.missingRole", message: "geen roleID" });
  if (on("labour.emptySummary") && (!t.summaryNotes || t.summaryNotes.trim() === "")) problems.push({ code: "labour.emptySummary", message: "lege summary (wordt factuurregel)" });
  if (on("labour.outsidePeriod") && dateInRange(t.dateWorked, cfg) !== true) problems.push({ code: "labour.outsidePeriod", message: `dateWorked buiten periode (${t.dateWorked ?? "leeg"})` });
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

// ─────────────────────────────────────────────────────────────────────
// review-subcommand: pure kern (buildReview), groepeert per ticket,
// past checkLabour/checkCharge toe, berekent totalen.
// ─────────────────────────────────────────────────────────────────────

function mapGet(mapLike, key) {
  if (mapLike == null) return undefined;
  if (typeof mapLike.get === "function") return mapLike.get(key);
  return mapLike[key];
}

// Gedekt-vs-gefactureerd classificatie (zone 19, 2026-07-24): labour op een
// Recurring-contract (bv. Easywork Basic, type 7) post historisch op totalAmount
// €0 = gedekt door de vaste fee, niet apart gefactureerd (bevestigd op 138
// Easywork-contracten). T&M (type 1) factureert labour wel (>0). Detectie:
// heeft een historische BillingItem voor dat contract + work type ooit een
// bedrag > 0 gehad. ContractExclusionBillingCodes is leeg en dus niet bruikbaar.
export function buildBilledMap(billingItems) {
  const map = new Map();
  for (const b of billingItems ?? []) {
    if (b.timeEntryID == null) continue; // alleen labour, geen charges
    const amount = b.totalAmount ?? b.extendedPrice ?? 0;
    if (!(amount > 0)) continue;
    if (!map.has(b.contractID)) map.set(b.contractID, new Set());
    map.get(b.contractID).add(b.billingCodeID);
  }
  return map;
}

// Fallback per contractType als er geen historie is voor het contract:
// 1 = Time & Materials, 4 = Block Hours, 8 = Per Ticket -> gefactureerd.
// 3/6/7/9 (o.a. Recurring/Retainer) -> gedekt. Onbekend type -> gedekt (conservatief).
const INVOICED_CONTRACT_TYPES = new Set([1, 4, 8]);
export function isInvoiced(contractID, billingCodeID, contractType, billedMap) {
  const codes = billedMap?.get(contractID);
  if (codes && codes.has(billingCodeID)) return true; // historisch >0 gefactureerd
  return INVOICED_CONTRACT_TYPES.has(contractType); // fallback: geen historie voor dit work type -> contracttype beslist
}

export function buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg, billedMap = new Map(), contractInfo = new Map(), availableContracts = []) {
  const byTicket = new Map(); // ticketID -> { timeEntries: [], charges: [] }
  const ensure = (ticketID) => {
    if (!byTicket.has(ticketID)) byTicket.set(ticketID, { timeEntries: [], charges: [] });
    return byTicket.get(ticketID);
  };

  let billableHours = 0, invoicedHours = 0, coveredHours = 0;
  for (const t of timeEntries) {
    const checked = checkLabour(t, cfg);
    billableHours += checked.hours;
    const workTypeName = t.billingCodeID != null ? mapGet(workTypeNames, t.billingCodeID) ?? null : null;
    const info = mapGet(contractInfo, t.contractID);
    const contractType = info?.type ?? null;
    const invoiced = isInvoiced(t.contractID, t.billingCodeID, contractType, billedMap);
    if (invoiced) invoicedHours += checked.hours; else coveredHours += checked.hours;
    // Task 12.1: outsidePeriod is een informatieve flag ("ouder dan <maand>"), geen filter.
    // Losstaand van enabledRules/problems zodat hij altijd meekomt, ook als de
    // labour.outsidePeriod-regel voor review is uitgeschakeld (zie fetchReview).
    const outsidePeriod = !inPeriod(t.dateWorked, cfg);
    const item = { id: t.id, hours: checked.hours, workType: workTypeName, summary: t.summaryNotes ?? null, problems: checked.problems, contractId: t.contractID ?? null, contractName: info?.name ?? null, contractType, invoiced, outsidePeriod };
    if (t.ticketID != null) ensure(t.ticketID).timeEntries.push(item);
  }

  let chargeAmountEUR = 0;
  const looseCharges = [];
  for (const c of charges) {
    const kind = c.kind ?? "ticketCharge";
    const checked = checkCharge(c, kind, cfg);
    const amountEUR = checked.amountEUR ?? 0;
    chargeAmountEUR += amountEUR;
    const outsidePeriod = !inPeriod(c.datePurchased ?? c.createDate, cfg);
    const item = { id: c.id, name: c.name ?? null, amountEUR, kind, problems: checked.problems, outsidePeriod };
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
      invoicedHours,
      coveredHours,
      chargeAmountEUR,
      ticketCount: reviewTickets.length,
      timeEntryCount: timeEntries.length,
      chargeCount: charges.length,
    },
    tickets: reviewTickets,
    looseCharges,
    availableContracts,
  };
}

// ─────────────────────────────────────────────────────────────────────
// summary-subcommand: pure kern (buildSummary), org-brede triage-ranglijst.
// Aggregeert pending items per klant zonder AI/per-ticket detail; "review
// <klant>" blijft de plek voor de diepe, per-ticket AI-inspectie.
// ─────────────────────────────────────────────────────────────────────

const CHARGE_KINDS = new Set(["ticketCharge", "contractCharge", "projectCharge"]);

// Task 12 (N4/N3): alleen echte T&M-uren (contractType 1, prepaid=false) tellen als
// "te factureren" billableHours. Block Hours (4) en Per Ticket (8) zijn vooruitbetaald,
// tonen we apart als prepaidHours, en tellen niet mee in de ranking (rankHourRate) --
// anders zakt een klant met veel echte T&M-uren onterecht onder een prepaid-zware klant.
export function buildSummary(items, rankHourRate) {
  const byCompany = new Map();
  for (const item of items) {
    if (!byCompany.has(item.companyId)) {
      byCompany.set(item.companyId, { companyId: item.companyId, companyName: item.companyName, chargeEUR: 0, billableHours: 0, prepaidHours: 0, signalCount: 0 });
    }
    const agg = byCompany.get(item.companyId);
    if (CHARGE_KINDS.has(item.kind)) agg.chargeEUR += item.amountEUR ?? 0;
    if (item.kind === "labour") {
      if (item.prepaid) agg.prepaidHours += item.hours ?? 0;
      else agg.billableHours += item.hours ?? 0;
    }
    agg.signalCount += item.problems?.length ?? 0;
  }
  const all = [...byCompany.values()];
  const actionable = all.filter((r) => r.chargeEUR > 0 || r.billableHours > 0 || r.prepaidHours > 0 || r.signalCount > 0);
  const rank = (r) => r.chargeEUR + r.billableHours * rankHourRate;
  actionable.sort((a, b) => rank(b) - rank(a) || b.billableHours - a.billableHours);
  return { rows: actionable, hidden: all.length - actionable.length };
}

// ─────────────────────────────────────────────────────────────────────
// summary-subcommand: Remote Support work-type-review digest (Task 9).
// Gedekte Remote Support-uren op recurring contracten worden niet gefactureerd
// en dus niet gesignaleerd door de gewone triage, maar het work type zelf kan
// fout gekozen zijn (bv. eigenlijk Onsite/Meerwerk/Project/Change/buiten
// kantooruren). Die beoordeling is AI-werk (Claude leest de summary-tekst),
// dus buildRemoteSupportReview groepeert alleen de data per klant; er wordt
// hier niets automatisch geclassificeerd of gewijzigd.
export function buildRemoteSupportReview(items) {
  const byCompany = new Map();
  for (const item of items) {
    if (!byCompany.has(item.companyId)) {
      byCompany.set(item.companyId, { companyId: item.companyId, companyName: item.companyName, count: 0, hours: 0, entries: [] });
    }
    const agg = byCompany.get(item.companyId);
    agg.count += 1;
    agg.hours += item.hours ?? 0;
    agg.entries.push({ id: item.id, hours: item.hours, dateWorked: item.dateWorked, summary: item.summary });
  }
  const result = [...byCompany.values()];
  for (const company of result) {
    company.entries.sort((a, b) => {
      const aDate = a.dateWorked?.slice(0, 10) ?? "";
      const bDate = b.dateWorked?.slice(0, 10) ?? "";
      if (aDate === "" && bDate === "") return 0;
      if (aDate === "") return 1;
      if (bDate === "") return -1;
      return aDate.localeCompare(bDate);
    });
  }
  return result.sort((a, b) => b.count - a.count);
}

// ─────────────────────────────────────────────────────────────────────
// TASK 3: I/O-laag (read-only)
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

// PURE: zet BillingItem-rijen om naar de set geposte bron-ids op het gevraagde veld.
// Matcht uitsluitend op billingItemField (bv. timeEntryID); andere velden op de rij
// (zoals contractID) spelen bewust geen rol, precies om de posted-exclusie exact op
// de kandidaat-ids te houden en niet afhankelijk te maken van bredere/afwijkende data.
export function postedIdsFromRows(rows, billingItemField) {
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
  const contractInfo = new Map(contracts.map((c) => [c.id, { name: c.contractName ?? null, type: c.contractType ?? null }]));
  // Volledige actieve contractlijst van de klant (status 1), meegegeven aan buildReview
  // zodat Claude kan vergelijken of werk op het juiste (productlijn-specifieke) contract
  // staat. Reuse van de al-opgehaalde Contracts hierboven, geen extra API-call.
  const availableContracts = contracts
    .filter((c) => c.status === 1)
    .map((c) => ({ id: c.id, name: c.contractName ?? null, type: c.contractType ?? null }));

  const ticketsRaw = await atFetchAll("Tickets", [{ field: "companyID", op: "eq", value: company.id }]);
  const tickets = ticketsRaw.map((t) => ({ id: t.id, ticketNumber: t.ticketNumber ?? null, title: t.title ?? null, description: t.description ?? null, status: t.status ?? null }));
  const ticketIds = tickets.map((t) => t.id);
  // Task 10: alleen afgeronde tickets (status 5/16) horen in het overzicht.
  // De company-tickets zijn hierboven al opgehaald incl. status, dus geen
  // extra fetch nodig.
  const completeTicketIds = new Set(tickets.filter((t) => COMPLETE_TICKET_STATUSES.has(t.status)).map((t) => t.id));

  const projects = await atFetchAll("Projects", [{ field: "companyID", op: "eq", value: company.id }]);
  const projectIds = projects.map((p) => p.id);

  // Task 12.1: GEEN periode-filter meer op de fetch (verborg legitieme nog-te-posten
  // items met een datum buiten de maand, bv. "Buitenbundel mei"). review toont weer ALLE
  // nog-niet-geposte items; outsidePeriod wordt als informatieve flag per item meegegeven
  // door buildReview (zie daar), niet als drop-filter hier.
  const labourRaw = await fetchBatchedIn("TimeEntries", "contractID", contractIds, [{ field: "isNonBillable", op: "eq", value: false }]);
  const ticketChargesRaw = await fetchBatchedIn("TicketCharges", "ticketID", ticketIds, [{ field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }]);
  const contractChargesRaw = await fetchBatchedIn("ContractCharges", "contractID", contractIds, [{ field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }]);
  const projectChargesRaw = await fetchBatchedIn("ProjectCharges", "projectID", projectIds, [{ field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }]);

  // Precieze posted-detectie op labour: BillingItems met timeEntryID in de kandidaat-ids
  // zelf, niet via de bredere contract-fetch. Als BillingItem.contractID bij afwijkende/
  // legacy data niet exact matcht met de bron-time-entry, zou een al-geposte entry anders
  // ten onrechte als "pending" kunnen terugkomen -> risico op dubbel factureren. Gebatcht
  // (net als summary) om 500's bij klanten met veel tickets/time entries te voorkomen.
  const postedTimeEntryIds = await postedIdsBatched("timeEntryID", labourRaw.map((t) => t.id));
  // Aparte, bredere BillingItems-fetch op contractID: uitsluitend input voor buildBilledMap
  // (historische gefactureerd/gedekt-classificatie), niet voor de posted-exclusie hierboven.
  const billingItemsRaw = await fetchBatchedIn("BillingItems", "contractID", contractIds, []);
  const billedMap = buildBilledMap(billingItemsRaw);
  const postedTicketChargeIds = await postedIdsBatched("ticketChargeID", ticketChargesRaw.map((c) => c.id));
  const postedContractChargeIds = await postedIdsBatched("contractChargeID", contractChargesRaw.map((c) => c.id));
  const postedProjectChargeIds = await postedIdsBatched("projectChargeID", projectChargesRaw.map((c) => c.id));

  const timeEntriesAll = labourRaw
    .filter((t) => !postedTimeEntryIds.has(t.id))
    .map((t) => ({ id: t.id, ticketID: t.ticketID ?? null, taskID: t.taskID ?? null, contractID: t.contractID ?? null, roleID: t.roleID ?? null, billingCodeID: t.billingCodeID ?? null, hoursWorked: t.hoursWorked ?? null, hoursToBill: t.hoursToBill ?? null, dateWorked: t.dateWorked ?? null, summaryNotes: t.summaryNotes ?? null }));

  const chargesAll = [
    ...ticketChargesRaw.filter((c) => !postedTicketChargeIds.has(c.id)).map((c) => ({ ...mapCharge(c), kind: "ticketCharge" })),
    ...contractChargesRaw.filter((c) => !postedContractChargeIds.has(c.id)).map((c) => ({ ...mapCharge(c), kind: "contractCharge" })),
    // ProjectCharges hangen niet aan een ticket (ticketID blijft null via mapCharge), dus
    // deze landen via buildReview altijd in looseCharges, ook al is de klant zonder
    // projecten gewoon een lege lijst hier.
    ...projectChargesRaw.filter((c) => !postedProjectChargeIds.has(c.id)).map((c) => ({ ...mapCharge(c), kind: "projectCharge" })),
  ];

  // Task 10: alleen afgeronde tickets (status 5/16) mogen in het overzicht.
  // Raakt uitsluitend ticket-gebonden items (labour met ticketID, ticket-charges);
  // contract-/project-charges en labour zonder ticketID hebben ticketID == null
  // en blijven dus altijd staan via keepIfTicketComplete.
  const timeEntries = keepIfTicketComplete(timeEntriesAll, completeTicketIds);
  const charges = keepIfTicketComplete(chargesAll, completeTicketIds);
  const reviewTicketsList = tickets.filter((t) => completeTicketIds.has(t.id));

  const ticketsWithItems = [...new Set([...timeEntries.map((t) => t.ticketID), ...charges.map((c) => c.ticketID)].filter((x) => x != null))];
  const notesByTicket = await fetchNotesByTicket(ticketsWithItems);
  const workTypeNames = await fetchWorkTypeNames();

  // review toont ALLE nog-niet-geposte items ongeacht datum, dus labour.outsidePeriod
  // zou hier valse "problemen" opleveren op legitiem oude, nog niet geposte entries.
  const reviewCfg = { ...cfg, enabledRules: cfg.enabledRules.filter((r) => r !== "labour.outsidePeriod") };
  const reviewOutput = buildReview(company, reviewTicketsList, timeEntries, charges, notesByTicket, workTypeNames, reviewCfg, billedMap, contractInfo, availableContracts);

  console.log(JSON.stringify(reviewOutput, null, 2));
  console.error(`Klant ${company.name} (${company.id}): ${reviewOutput.totals.ticketCount} tickets, ${reviewOutput.totals.timeEntryCount} time entries (${reviewOutput.totals.billableHours}u), ${reviewOutput.totals.chargeCount} charges (€${reviewOutput.totals.chargeAmountEUR.toFixed(2)}), ${reviewOutput.looseCharges.length} losse charges.`);
  return reviewOutput;
}

// ─────────────────────────────────────────────────────────────────────
// TASK 3: set-nonbillable: gated write (enige toegestane mutatie)
// ─────────────────────────────────────────────────────────────────────

export function shouldConfirm(args) {
  return args.includes("--confirm") && !args.includes("--dry-run");
}

export function buildNonBillablePatches(ids) {
  return ids.map((id) => ({ id, isNonBillable: true }));
}

async function realPatchTimeEntry(patch) {
  const res = await fetch(`${BASE}/TimeEntries`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(patch) });
  if (res.ok) return { id: patch.id, status: res.status, ok: true };
  const raw = await res.text().catch(() => "");
  let error;
  try { error = JSON.parse(raw)?.errors?.[0] ?? raw ?? String(res.status); } catch { error = raw || String(res.status); }
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
// summary-subcommand: I/O-laag (fetchSummary), org-brede snel-triage.
// Bulk-fetch Companies/Contracts/BillingCodes elk EEN keer en join in-memory,
// GEEN per-ticket/contract/project losse query (dat was de 6m47s org-run via
// run()). Posted-exclusie en company-attributie gebeuren via gebatchte
// `id op:in`-fetches (BillingItems/Tickets/Projects), nooit per losse id.
// ─────────────────────────────────────────────────────────────────────

async function fetchBatchedIn(entity, field, ids, extraFilters = [], batchSize = 300) {
  const unique = [...new Set(ids)].filter((x) => x != null);
  const out = [];
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    out.push(...(await atFetchAll(entity, [{ field, op: "in", value: batch }, ...extraFilters])));
  }
  return out;
}

// Levert de set opgehaalde-id's die al een BillingItem hebben (dus al gepost zijn).
// De approval-timestamp op de bron-entiteit is NIET betrouwbaar als pending-indicator
// (24/31 bleek al gepost bij testklant 251), de BillingItem-kruisverwijzing is de
// autoritatieve check.
// Precieze id-query (timeEntryID/ticketChargeID/... op:in de kandidaat-ids), niet via
// een bredere contract-brede fetch, om dubbel factureren door mismatchende contractID's
// op legacy/afwijkende BillingItem-rijen te voorkomen. Gebatcht (~300/call) zodat dit
// ook bij klanten met veel tickets/time entries niet op een 500 loopt.
async function postedIdsBatched(field, ids, batchSize = 300) {
  const rows = await fetchBatchedIn("BillingItems", field, ids, [], batchSize);
  return postedIdsFromRows(rows, field);
}

const unassignedName = (companyId, names) => companyId === 0 ? "⚠️ Niet toegewezen (controleer handmatig)" : names.get(companyId) ?? `Company ${companyId}`;

// Resolveert de "Remote Support"-billingCode op naam (id 29682801 op zone 19,
// maar hier op naam opgelost voor robuustheid tegen id-drift tussen zones).
// Levert de code geen match op dan degradeert de digest gracieus naar leeg
// (geen harde fout), zodat summary altijd blijft draaien.
async function resolveRemoteSupportCodeId() {
  const rows = await atFetchAll("BillingCodes", [{ field: "isActive", op: "eq", value: true }, { field: "billingCodeType", op: "eq", value: 0 }]);
  const match = rows.find((r) => r.name === "Remote Support");
  return match ? match.id : null;
}

export async function fetchSummary(cfg) {
  // labour.outsidePeriod zou hier valse signalen geven: summary kijkt (net als
  // review) naar ALLE nog-niet-geposte items, ongeacht datum.
  const summaryCfg = { ...cfg, enabledRules: cfg.enabledRules.filter((r) => r !== "labour.outsidePeriod") };

  // Bulk-fetch #1: Companies (id -> naam), EEN keer voor de hele org.
  const companies = await atFetchAll("Companies", [{ field: "isActive", op: "eq", value: true }]);
  const names = new Map(companies.map((c) => [c.id, c.companyName]));

  // Bulk-fetch #2: ALLE Contracts (id -> {companyID, naam, type}), EEN keer, zonder
  // status-filter. De contractID -> companyID-attributie moet ook gesloten/afgelopen
  // contracten kunnen herleiden (anders belandt labour/charges op een inmiddels
  // gesloten contract onterecht in de "Niet toegewezen"-bak). Het active + billable
  // type-filter (1/4/8) wordt hieronder apart toegepast, alleen voor de vraag welke
  // contracten factureerbare labour opleveren.
  const contracts = await atFetchAll("Contracts", [{ field: "id", op: "gte", value: 0 }]);
  const contractInfo = new Map(contracts.map((c) => [c.id, { companyID: c.companyID, name: c.contractName ?? null, type: c.contractType ?? null }]));

  // BillingCodes (work-type namen) wordt bewust NIET gebulkfetcht: checkLabour/
  // checkCharge signaleren alleen op de aanwezigheid van billingCodeID zelf
  // (labour.missingWorkType/charge.missingWorkType), niet op de naam. Namen zijn
  // dus geen input voor de signalCount-aggregatie hier; die extra call zou puur
  // onbenutte netwerklatency toevoegen aan een command dat juist snelheid als
  // doel heeft. (fetchWorkTypeNames() blijft beschikbaar voor `review`.)

  // Alleen ACTIEVE contracten (status 1) met een facturabel contracttype (1 T&M,
  // 4 Block Hours, 8 Per Ticket) leveren te-factureren labour; gedekte contracttypes
  // (Recurring e.d.) en gesloten contracten tellen niet mee. Dit filter raakt alleen
  // de labour-query hieronder, niet de contractInfo-attributiekaart hierboven.
  const billableContractIds = contracts.filter((c) => c.status === 1 && INVOICED_CONTRACT_TYPES.has(c.contractType)).map((c) => c.id);
  // Task 12.1: GEEN periode-filter meer (zie fetchReview hierboven voor de reden). summary
  // toont weer ALLE nog-niet-geposte labour/charges op afgeronde tickets, ongeacht datum.
  const labourRaw = await fetchBatchedIn("TimeEntries", "contractID", billableContractIds, [{ field: "isNonBillable", op: "eq", value: false }], 200);

  const chargeFilter = [{ field: "isBillableToCompany", op: "eq", value: true }, { field: "isBilled", op: "eq", value: false }];
  const ticketChargesRaw = await atFetchAll("TicketCharges", chargeFilter);
  const contractChargesRaw = await atFetchAll("ContractCharges", chargeFilter);
  const projectChargesRaw = await atFetchAll("ProjectCharges", chargeFilter);

  // Posted-exclusie via BillingItem-kruisverwijzing, gebatcht (~300/call). Sequentieel
  // (niet Promise.all) om binnen Autotask' rate-limit van 3 gelijktijdige threads te
  // blijven; deze codebase houdt zich aan sequentieel/max ~2 parallel, dus 4 losse
  // parallelle requests hier zou een 429-risico zijn.
  const postedTimeEntryIds = await postedIdsBatched("timeEntryID", labourRaw.map((t) => t.id));
  const postedTicketChargeIds = await postedIdsBatched("ticketChargeID", ticketChargesRaw.map((c) => c.id));
  const postedContractChargeIds = await postedIdsBatched("contractChargeID", contractChargesRaw.map((c) => c.id));
  const postedProjectChargeIds = await postedIdsBatched("projectChargeID", projectChargesRaw.map((c) => c.id));

  const labour = labourRaw.filter((t) => !postedTimeEntryIds.has(t.id));
  const ticketCharges = ticketChargesRaw.filter((c) => !postedTicketChargeIds.has(c.id)).map(mapCharge);
  const contractCharges = contractChargesRaw.filter((c) => !postedContractChargeIds.has(c.id)).map(mapCharge);
  const projectCharges = projectChargesRaw.filter((c) => !postedProjectChargeIds.has(c.id)).map(mapCharge);

  // Remote Support work-type-review digest (Task 9): Remote Support op gedekte
  // (niet-facturabele) contracten wordt door de triage hierboven genegeerd,
  // want die kijkt alleen naar billableContractIds. Toch kan het work type zelf
  // fout gekozen zijn (bv. eigenlijk Onsite/Meerwerk/Project/Change/buiten
  // kantooruren). Dat is AI-werk (Claude beoordeelt de summary-tekst later),
  // dus hier alleen bounded ophalen + groeperen per klant, geen classificatie.
  // Bounded: alleen de Remote Support-billingCode, binnen de periode, niet
  // non-billable; posted-exclusie via dezelfde gebatchte BillingItem-lookup.
  // rsRaw wordt hier alvast opgehaald (ongefilterd) zodat de ticket-ids ervan
  // meekunnen in de EEN gebatchte Tickets-fetch hieronder; de eigenlijke
  // rsItems-classificatie/filtering gebeurt verderop, na completeTicketIds.
  const remoteSupportCodeId = await resolveRemoteSupportCodeId();
  // Task 12 (N5): stil leeg overslaan verbergt een kapotte work-type-lookup; een expliciete
  // waarschuwing maakt dat zichtbaar in plaats van dat de RS-digest gewoon leeg lijkt.
  if (remoteSupportCodeId == null) console.error("Waarschuwing: work type 'Remote Support' niet gevonden; RS-digest overgeslagen.");
  const rsRaw = remoteSupportCodeId != null ? await atFetchAll("TimeEntries", [
    { field: "billingCodeID", op: "eq", value: remoteSupportCodeId },
    { field: "isNonBillable", op: "eq", value: false },
    { field: "dateWorked", op: "gte", value: `${cfg.periodStart}T00:00:00` },
    { field: "dateWorked", op: "lte", value: `${cfg.periodEnd}T23:59:59` },
  ]) : [];

  // Company-attributie EN Task-10 ticket-status in EEN gebatchte Tickets-fetch
  // (id op:in), op de unie van alle ticket-ids uit ticketCharges, billable
  // labour en RS-entries. Geen aparte per-onderdeel fetch, geen per-id lookups.
  // ticketCharges/projectCharges attribution via gebatchte Tickets/Projects
  // id op:in-fetches (alleen de betrokken ids, niet de hele klantenbasis);
  // labour/contractCharges via de al opgehaalde bulk-Contracts.
  const ticketIdsForLookup = [
    ...ticketCharges.map((c) => c.ticketID),
    ...labour.map((t) => t.ticketID),
    ...rsRaw.map((t) => t.ticketID),
  ];
  const ticketsRows = await fetchBatchedIn("Tickets", "id", ticketIdsForLookup, [], 300);
  const ticketCompany = new Map(ticketsRows.map((t) => [t.id, t.companyID]));
  // Task 10: een ticket is "afgerond" bij status 5 (Complete) of 16 (Autocomplete
  // RMM). Alleen ticket-gebonden items op een afgerond ticket blijven staan.
  const completeTicketIds = new Set(ticketsRows.filter((t) => COMPLETE_TICKET_STATUSES.has(t.status)).map((t) => t.id));

  const postedRsIds = await postedIdsBatched("timeEntryID", rsRaw.map((t) => t.id));
  const rsItemsAll = rsRaw
    .filter((t) => !postedRsIds.has(t.id))
    // Alleen gedekte contracten (niet al facturabel meegeteld hierboven):
    // dezelfde INVOICED_CONTRACT_TYPES-classificatie als de rest van summary.
    .filter((t) => !INVOICED_CONTRACT_TYPES.has(contractInfo.get(t.contractID)?.type))
    .map((t) => {
      const companyId = contractInfo.get(t.contractID)?.companyID ?? 0;
      return { companyId, companyName: unassignedName(companyId, names), id: t.id, ticketID: t.ticketID ?? null, hours: t.hoursToBill ?? t.hoursWorked ?? 0, dateWorked: t.dateWorked ?? null, summary: t.summaryNotes ?? null };
    });
  // Task 10: RS-entries met een ticketID alleen meenemen als dat ticket afgerond
  // is; ticketloze RS-entries (ticketID null) zijn niet ticket-gebonden en blijven.
  const rsItems = keepIfTicketComplete(rsItemsAll, completeTicketIds);
  const remoteSupportReview = buildRemoteSupportReview(rsItems);

  const projectIds = projectCharges.map((c) => c.projectID);
  const projectsRows = await fetchBatchedIn("Projects", "id", projectIds, [], 300);
  const projectCompany = new Map(projectsRows.map((p) => [p.id, p.companyID]));

  // Task 10: ticket-gebonden items (labour met ticketID, ticket-charges) alleen
  // houden als hun ticket afgerond is. Contract-/project-charges en labour
  // zonder ticketID hebben ticketID == null en blijven dus altijd staan.
  const labourFiltered = keepIfTicketComplete(labour, completeTicketIds);
  const ticketChargesFiltered = keepIfTicketComplete(ticketCharges, completeTicketIds);

  const items = [];
  for (const t of labourFiltered) {
    const companyId = contractInfo.get(t.contractID)?.companyID ?? 0;
    const checked = checkLabour(t, summaryCfg);
    // Task 12 (N4): Block Hours (4) en Per Ticket (8) zijn vooruitbetaald -> prepaid.
    const contractType = contractInfo.get(t.contractID)?.type ?? null;
    const prepaid = contractType === 4 || contractType === 8;
    items.push({ companyId, companyName: unassignedName(companyId, names), kind: "labour", amountEUR: 0, hours: checked.hours, problems: checked.problems, prepaid });
  }
  for (const c of contractCharges) {
    const companyId = contractInfo.get(c.contractID)?.companyID ?? 0;
    const checked = checkCharge(c, "contractCharge", summaryCfg);
    items.push({ companyId, companyName: unassignedName(companyId, names), kind: "contractCharge", amountEUR: checked.amountEUR ?? 0, hours: null, problems: checked.problems });
  }
  for (const c of ticketChargesFiltered) {
    const companyId = ticketCompany.get(c.ticketID) ?? 0;
    const checked = checkCharge(c, "ticketCharge", summaryCfg);
    items.push({ companyId, companyName: unassignedName(companyId, names), kind: "ticketCharge", amountEUR: checked.amountEUR ?? 0, hours: null, problems: checked.problems });
  }
  for (const c of projectCharges) {
    const companyId = projectCompany.get(c.projectID) ?? 0;
    const checked = checkCharge(c, "projectCharge", summaryCfg);
    items.push({ companyId, companyName: unassignedName(companyId, names), kind: "projectCharge", amountEUR: checked.amountEUR ?? 0, hours: null, problems: checked.problems });
  }

  const { rows, hidden } = buildSummary(items, cfg.rankHourRate);

  console.log("KLANT | TE FACTUREREN | SIGNALEN");
  for (const r of rows) {
    const parts = [];
    if (r.chargeEUR > 0) parts.push(`EUR${r.chargeEUR.toFixed(0)}`);
    if (r.billableHours > 0) parts.push(`${r.billableHours}u T&M`);
    let line = parts.join(" + ") || "-";
    if (r.prepaidHours > 0) line += ` (+${r.prepaidHours}u prepaid)`;
    console.log(`${r.companyName} | ${line} | ${r.signalCount}`);
  }
  console.log(`(${hidden} klanten zonder te factureren verborgen)`);

  if (remoteSupportReview.length) {
    console.log("");
    console.log("Remote Support te AI-checken:");
    for (const r of remoteSupportReview) {
      console.log(`${r.companyName} (${r.count} entries, ${r.hours}u)`);
      for (const e of r.entries) console.log(`  - #${e.id} ${(e.dateWorked ?? "").slice(0, 10)} ${e.hours}u: ${e.summary ?? "(geen summary)"}`);
    }
  }

  return { rows, hidden, remoteSupportReview };
}

// ─────────────────────────────────────────────────────────────────────
// main()/CLI-dispatch
// ─────────────────────────────────────────────────────────────────────

async function readCfg() {
  const raw = fs.existsSync("config.json") ? JSON.parse(fs.readFileSync("config.json", "utf8")) : {};
  return loadConfig(raw, new Date());
}
const USAGE = "Gebruik: preflight.mjs summary | review <klant> | set-nonbillable <id...> [--dry-run|--confirm]";
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "summary") {
    const cfg = await readCfg();
    await fetchSummary(cfg);
  }
  else if (cmd === "review") {
    const arg = rest[0];
    if (!arg) { console.error("Gebruik: preflight.mjs review <companyID of klantnaam>"); process.exit(1); return; }
    const cfg = await readCfg();
    await fetchReview(arg, cfg);
  }
  else if (cmd === "set-nonbillable") {
    const confirm = shouldConfirm(rest);
    const ids = rest.filter((a) => /^\d+$/.test(a)).map(Number);
    if (ids.length === 0) { console.error("Gebruik: preflight.mjs set-nonbillable <id...> [--dry-run|--confirm]"); process.exit(1); return; }
    await setNonBillable(ids, { confirm });
  }
  else console.log(USAGE);
}
// Alleen draaien als direct aangeroepen (niet bij import in de test):
if (process.argv[1] && process.argv[1].endsWith("preflight.mjs")) main().catch((e) => { console.error(String(e)); process.exit(1); });
