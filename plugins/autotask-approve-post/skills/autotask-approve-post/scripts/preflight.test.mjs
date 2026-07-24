// preflight.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, checkLabour, checkCharge, groupItems, renderReport, buildReview, buildNonBillablePatches, setNonBillable, shouldConfirm, buildBilledMap, isInvoiced } from "./preflight.mjs";

const cfg = loadConfig({ periodStart: "2026-06-01", periodEnd: "2026-06-30" }, new Date("2026-07-24T00:00:00Z"));
const te = (o = {}) => ({ id: 1, ticketID: 100, taskID: null, contractID: 5, resourceID: 7, roleID: 3, billingCodeID: 20, hoursWorked: 2, hoursToBill: 2, isNonBillable: false, billingApprovalDateTime: null, dateWorked: "2026-06-15T09:00:00", summaryNotes: "Werk", companyID: 999, ...o });
const ch = (o = {}) => ({ id: 50, billingCodeID: 30, status: 1, isBillableToCompany: true, isBilled: false, name: "Licentie", description: "x", productID: 11, unitPrice: 10, unitQuantity: 2, billableAmount: 20, datePurchased: "2026-06-10T00:00:00", createDate: "2026-06-10T00:00:00", companyID: 999, contractID: 5, ticketID: 100, projectID: null, ...o });

test("loadConfig valt terug op vorige maand", () => {
  const c = loadConfig({}, new Date("2026-07-24T10:00:00Z"));
  assert.equal(c.periodStart, "2026-06-01");
  assert.equal(c.periodEnd, "2026-06-30");
});
test("checkLabour: schone entry = geen problemen", () => {
  assert.deepEqual(checkLabour(te(), cfg).problems, []);
});
test("checkLabour markeert work type/uur/rol/summary/periode", () => {
  const codes = checkLabour(te({ billingCodeID: null, hoursWorked: 0, hoursToBill: 0, roleID: null, summaryNotes: " ", dateWorked: "2026-05-30T09:00:00" }), cfg).problems.map(p => p.code);
  for (const c of ["labour.missingWorkType","labour.zeroHours","labour.missingRole","labour.emptySummary","labour.outsidePeriod"]) assert.ok(codes.includes(c), c);
});
test("checkCharge markeert work type/0-bedrag/negatief", () => {
  assert.deepEqual(checkCharge(ch(), "ticketCharge", cfg).problems, []);
  const zero = checkCharge(ch({ billingCodeID: null, productID: null, unitPrice: 0, billableAmount: 0 }), "ticketCharge", cfg).problems.map(p => p.code);
  assert.ok(zero.includes("charge.missingWorkType") && zero.includes("charge.zeroAmount"));
  const neg = checkCharge(ch({ billableAmount: -5, unitPrice: -5 }), "ticketCharge", cfg).problems.map(p => p.code);
  assert.ok(neg.includes("charge.negativeAmount"));
});
test("checkCharge flags notBillableFlag", () => {
  const notBillable = checkCharge(ch({ isBillableToCompany: false }), "ticketCharge", cfg).problems.map(p => p.code);
  assert.ok(notBillable.includes("charge.notBillableFlag"));
});
test("checkCharge flags neverBillCode", () => {
  const cfg2 = loadConfig({ periodStart: "2026-06-01", periodEnd: "2026-06-30", neverBillBillingCodeIDs: [30] }, new Date("2026-07-24T00:00:00Z"));
  const neverBill = checkCharge(ch(), "ticketCharge", cfg2).problems.map(p => p.code);
  assert.ok(neverBill.includes("charge.neverBillCode"));
});
test("groupItems: ticket-items onder ticket, losse charges onder contract", () => {
  const groups = groupItems([
    checkLabour(te({ id: 1, ticketID: 100 }), cfg),
    checkCharge(ch({ id: 2, ticketID: 100 }), "ticketCharge", cfg),
    checkCharge(ch({ id: 3, ticketID: null, contractID: 5 }), "contractCharge", cfg),
  ], new Map([[999, "Acme BV"]]));
  assert.equal(groups[0].companyName, "Acme BV");
  assert.deepEqual(groups[0].contracts[0].tickets[0].items.map(i => i.id), [1, 2]);
  assert.deepEqual(groups[0].contracts[0].looseItems.map(i => i.id), [3]);
});
test("groupItems: companyID 0 krijgt de niet-toegewezen bucket-naam, andere ID's onaangetast", () => {
  const unresolved = groupItems([checkLabour(te({ companyID: 0 }), cfg)], new Map());
  assert.equal(unresolved[0].companyName, "⚠️ Niet toegewezen (controleer handmatig)");
  const resolved = groupItems([checkLabour(te({ companyID: 1 }), cfg)], new Map());
  assert.equal(resolved[0].companyName, "Company 1");
});
test("renderReport toont klant/ticket/schoon/te-fixen + samenvatting", () => {
  const groups = groupItems([checkCharge(ch({ billingCodeID: null, productID: null }), "ticketCharge", cfg)], new Map([[999, "Acme BV"]]));
  const md = renderReport(groups, "juni 2026");
  assert.ok(md.includes("## Klant: Acme BV"));
  assert.ok(md.includes("Ticket 100"));
  assert.ok(md.includes("⚠️"));
  assert.match(md, /1 klant/);
});

// ─── buildReview (review-subcommand, pure kern) ─────────────────────────

const company = { id: 999, name: "Acme BV" };
const tickets = [
  { id: 100, ticketNumber: "T20260601.0001", title: "Ticket A", description: "Desc A" },
  { id: 101, ticketNumber: "T20260601.0002", title: "Ticket B", description: "Desc B" },
];
const workTypeNames = new Map([[20, "Onsite Support"], [21, "Remote Support"]]);

function reviewFixtures() {
  const timeEntries = [
    te({ id: 1, ticketID: 100, billingCodeID: 20, hoursToBill: 2, hoursWorked: 2, summaryNotes: "werk 1" }),
    te({ id: 2, ticketID: 101, billingCodeID: 21, hoursToBill: null, hoursWorked: 3, summaryNotes: "werk 2" }),
    te({ id: 3, ticketID: 100, billingCodeID: null, hoursToBill: 1, hoursWorked: 1, summaryNotes: "werk 3" }),
  ];
  const charges = [
    { ...ch({ id: 50, ticketID: 100, contractID: 5, billableAmount: 20 }), kind: "ticketCharge" },
    { ...ch({ id: 51, ticketID: null, contractID: 5, billableAmount: 15 }), kind: "contractCharge" },
  ];
  const notesByTicket = new Map([[100, [{ date: "2026-06-05", text: "note1", publish: 2 }]]]);
  return { timeEntries, charges, notesByTicket };
}

test("buildReview: totals.billableHours en chargeAmountEUR tellen correct op", () => {
  const { timeEntries, charges, notesByTicket } = reviewFixtures();
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  assert.equal(out.totals.billableHours, 6); // 2 + 3 + 1
  assert.equal(out.totals.chargeAmountEUR, 35); // 20 + 15
  assert.equal(out.totals.timeEntryCount, 3);
  assert.equal(out.totals.chargeCount, 2);
});

test("buildReview: items gegroepeerd per ticket, alleen tickets met pending items", () => {
  const { timeEntries, charges, notesByTicket } = reviewFixtures();
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  assert.equal(out.totals.ticketCount, 2);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  const t101 = out.tickets.find((t) => t.ticketID === 101);
  assert.equal(t100.title, "Ticket A");
  assert.equal(t100.billableHours, 3); // 2 + 1
  assert.deepEqual(t100.timeEntries.map((i) => i.id).sort(), [1, 3]);
  assert.deepEqual(t100.charges.map((i) => i.id), [50]);
  assert.equal(t101.billableHours, 3);
  assert.deepEqual(t101.timeEntries.map((i) => i.id), [2]);
  assert.deepEqual(t101.charges, []);
});

test("buildReview: losse charges (geen ticket) landen in looseCharges", () => {
  const { timeEntries, charges, notesByTicket } = reviewFixtures();
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  assert.equal(out.looseCharges.length, 1);
  assert.equal(out.looseCharges[0].id, 51);
  assert.equal(out.looseCharges[0].amountEUR, 15);
});

test("buildReview: workType-naam wordt via workTypeNames opgelost, notities aan ticket gehangen", () => {
  const { timeEntries, charges, notesByTicket } = reviewFixtures();
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  const te1 = t100.timeEntries.find((i) => i.id === 1);
  assert.equal(te1.workType, "Onsite Support");
  assert.deepEqual(t100.notes, [{ date: "2026-06-05", text: "note1", publish: 2 }]);
});

test("buildReview: data-issue (ontbrekend work type) landt in ticket.issues", () => {
  const { timeEntries, charges, notesByTicket } = reviewFixtures();
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  const te3 = t100.timeEntries.find((i) => i.id === 3);
  assert.ok(te3.problems.some((p) => p.code === "labour.missingWorkType"));
  assert.ok(t100.issues.some((iss) => iss.code === "labour.missingWorkType" && iss.source === "timeEntry:3"));
});

test("buildReview: projectCharge (geen ticket) landt in looseCharges met kind projectCharge", () => {
  const { timeEntries, notesByTicket } = reviewFixtures();
  const charges = [
    { ...ch({ id: 60, ticketID: null, contractID: null, billableAmount: 40 }), kind: "projectCharge" },
  ];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  assert.equal(out.looseCharges.length, 1);
  assert.equal(out.looseCharges[0].id, 60);
  assert.equal(out.looseCharges[0].kind, "projectCharge");
  assert.equal(out.totals.chargeAmountEUR, 40);
});

// ─── buildBilledMap / isInvoiced (gedekt-vs-gefactureerd classificatie) ──

test("buildBilledMap: labour-item met bedrag>0 en timeEntryID zet workType in contract-set", () => {
  const billingItems = [{ contractID: 5, billingCodeID: 20, timeEntryID: 900, totalAmount: 50 }];
  const map = buildBilledMap(billingItems);
  assert.ok(map.get(5).has(20));
});

test("buildBilledMap: alleen €0 items voegen niets toe", () => {
  const billingItems = [{ contractID: 5, billingCodeID: 20, timeEntryID: 900, totalAmount: 0 }];
  const map = buildBilledMap(billingItems);
  assert.equal(map.get(5), undefined);
});

test("buildBilledMap: items zonder timeEntryID (charges) worden genegeerd", () => {
  const billingItems = [{ contractID: 5, billingCodeID: 20, timeEntryID: null, totalAmount: 100 }];
  const map = buildBilledMap(billingItems);
  assert.equal(map.get(5), undefined);
});

test("buildBilledMap: valt terug op extendedPrice als totalAmount ontbreekt", () => {
  const billingItems = [{ contractID: 5, billingCodeID: 20, timeEntryID: 900, extendedPrice: 50 }];
  const map = buildBilledMap(billingItems);
  assert.ok(map.get(5).has(20));
});

test("isInvoiced: billedMap-hit geeft true, andere workType op zelfde contract geeft false", () => {
  const billedMap = new Map([[5, new Set([20])]]);
  assert.equal(isInvoiced(5, 20, 7, billedMap), true);
  assert.equal(isInvoiced(5, 21, 7, billedMap), false);
});

test("isInvoiced: geen historie voor contract valt terug op contractType (1/4/8 gefactureerd, 3/6/7/9 gedekt)", () => {
  const billedMap = new Map();
  assert.equal(isInvoiced(99, 20, 1, billedMap), true);
  assert.equal(isInvoiced(99, 20, 4, billedMap), true);
  assert.equal(isInvoiced(99, 20, 8, billedMap), true);
  assert.equal(isInvoiced(99, 20, 3, billedMap), false);
  assert.equal(isInvoiced(99, 20, 6, billedMap), false);
  assert.equal(isInvoiced(99, 20, 7, billedMap), false);
  assert.equal(isInvoiced(99, 20, 9, billedMap), false);
});

test("isInvoiced: onbekend contractType default naar false", () => {
  assert.equal(isInvoiced(99, 20, 999, new Map()), false);
});

test("buildReview: billedMap + contractInfo bepalen invoiced per time entry en totals invoicedHours/coveredHours", () => {
  const { timeEntries, charges, notesByTicket } = reviewFixtures();
  const billedMap = new Map([[5, new Set([20])]]); // alleen workType 20 op contract 5 wordt gefactureerd
  const contractInfo = new Map([[5, { name: "Easywork Basic", type: 7 }]]);
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg, billedMap, contractInfo);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  const te1 = t100.timeEntries.find((i) => i.id === 1); // billingCodeID 20 -> invoiced
  const te3 = t100.timeEntries.find((i) => i.id === 3); // billingCodeID null -> covered
  assert.equal(te1.invoiced, true);
  assert.equal(te1.contractId, 5);
  assert.equal(te1.contractName, "Easywork Basic");
  assert.equal(te1.contractType, 7);
  assert.equal(te3.invoiced, false);
  assert.equal(te3.contractId, 5);
  assert.equal(out.totals.invoicedHours, 2); // alleen te1 (2u)
  assert.equal(out.totals.coveredHours, 4); // te2 (3u) + te3 (1u)
  assert.equal(out.totals.billableHours, 6); // bestaand veld blijft ongewijzigd
});

// ─── set-nonbillable (gated write) ──────────────────────────────────────

test("buildNonBillablePatches: mapt ids naar PATCH-payloads", () => {
  assert.deepEqual(buildNonBillablePatches([1, 2]), [
    { id: 1, isNonBillable: true },
    { id: 2, isNonBillable: true },
  ]);
});

test("setNonBillable: default (geen confirm) is dry-run en roept patchFn nooit aan", async () => {
  const calls = [];
  const spyPatch = async (patch) => { calls.push(patch); return { id: patch.id, status: 200, ok: true }; };
  const result = await setNonBillable([1, 2], {}, spyPatch);
  assert.equal(calls.length, 0);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.patches, [
    { id: 1, isNonBillable: true },
    { id: 2, isNonBillable: true },
  ]);
});

test("setNonBillable: met confirm roept patchFn per id aan met het juiste payload", async () => {
  const calls = [];
  const spyPatch = async (patch) => { calls.push(patch); return { id: patch.id, status: 200, ok: true }; };
  const result = await setNonBillable([1, 2], { confirm: true }, spyPatch);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [
    { id: 1, isNonBillable: true },
    { id: 2, isNonBillable: true },
  ]);
  assert.equal(result.dryRun, false);
  assert.equal(result.results.length, 2);
});

test("shouldConfirm: --confirm wint alleen zonder --dry-run", () => {
  assert.equal(shouldConfirm(["--confirm"]), true);
  assert.equal(shouldConfirm(["--dry-run"]), false);
  assert.equal(shouldConfirm([]), false);
  assert.equal(shouldConfirm(["--dry-run", "--confirm"]), false);
});
