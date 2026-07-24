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
