// preflight.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, checkLabour, checkCharge, groupItems, buildReview, buildNonBillablePatches, setNonBillable, shouldConfirm, buildBilledMap, isInvoiced, postedIdsFromRows, buildSummary, buildRemoteSupportReview, buildHourFlags, keepIfTicketComplete, COMPLETE_TICKET_STATUSES, inPeriod, safeFetch, renderWarnings, fetchBatchedIn, postedIdsBatched } from "./preflight.mjs";

const cfg = loadConfig({ periodStart: "2026-06-01", periodEnd: "2026-06-30" }, new Date("2026-07-24T00:00:00Z"));
const te = (o = {}) => ({ id: 1, ticketID: 100, taskID: null, contractID: 5, resourceID: 7, roleID: 3, billingCodeID: 20, hoursWorked: 2, hoursToBill: 2, isNonBillable: false, billingApprovalDateTime: null, dateWorked: "2026-06-15T09:00:00", summaryNotes: "Werk", companyID: 999, ...o });
const ch = (o = {}) => ({ id: 50, billingCodeID: 30, status: 1, isBillableToCompany: true, isBilled: false, name: "Licentie", description: "x", productID: 11, unitPrice: 10, unitQuantity: 2, billableAmount: 20, datePurchased: "2026-06-10T00:00:00", createDate: "2026-06-10T00:00:00", companyID: 999, contractID: 5, ticketID: 100, projectID: null, ...o });

test("loadConfig valt terug op vorige maand", () => {
  const c = loadConfig({}, new Date("2026-07-24T10:00:00Z"));
  assert.equal(c.periodStart, "2026-06-01");
  assert.equal(c.periodEnd, "2026-06-30");
});
test("loadConfig: rankHourRate default 75", () => {
  assert.equal(loadConfig({}, new Date("2026-07-24T10:00:00Z")).rankHourRate, 75);
});
test("loadConfig: rankHourRate overneembaar uit raw config als getal", () => {
  assert.equal(loadConfig({ rankHourRate: 100 }, new Date("2026-07-24T10:00:00Z")).rankHourRate, 100);
});
test("loadConfig: rankHourRate negeert niet-getal en valt terug op 75", () => {
  assert.equal(loadConfig({ rankHourRate: "100" }, new Date("2026-07-24T10:00:00Z")).rankHourRate, 75);
});

// ─── urennorm-drempels (Task 14: Remote Support >1.5u, Change >2u per ticket) ──

test("loadConfig: remoteSupportHoursThreshold default 1.5", () => {
  assert.equal(loadConfig({}, new Date("2026-07-24T10:00:00Z")).remoteSupportHoursThreshold, 1.5);
});
test("loadConfig: remoteSupportHoursThreshold overneembaar uit raw config als getal", () => {
  assert.equal(loadConfig({ remoteSupportHoursThreshold: 2.5 }, new Date("2026-07-24T10:00:00Z")).remoteSupportHoursThreshold, 2.5);
});
test("loadConfig: remoteSupportHoursThreshold negeert niet-getal en valt terug op 1.5", () => {
  assert.equal(loadConfig({ remoteSupportHoursThreshold: "2.5" }, new Date("2026-07-24T10:00:00Z")).remoteSupportHoursThreshold, 1.5);
});
test("loadConfig: changeHoursThreshold default 2", () => {
  assert.equal(loadConfig({}, new Date("2026-07-24T10:00:00Z")).changeHoursThreshold, 2);
});
test("loadConfig: changeHoursThreshold overneembaar uit raw config als getal", () => {
  assert.equal(loadConfig({ changeHoursThreshold: 3 }, new Date("2026-07-24T10:00:00Z")).changeHoursThreshold, 3);
});
test("loadConfig: changeHoursThreshold negeert niet-getal en valt terug op 2", () => {
  assert.equal(loadConfig({ changeHoursThreshold: "3" }, new Date("2026-07-24T10:00:00Z")).changeHoursThreshold, 2);
});

// ─── inPeriod (Task 12.1: bron voor de outsidePeriod-FLAG in buildReview, geen fetch-filter meer) ───

test("inPeriod: datum binnen periode is true", () => {
  assert.equal(inPeriod("2026-06-15T09:00:00", cfg), true);
});
test("inPeriod: datum buiten periode is false", () => {
  assert.equal(inPeriod("2026-05-30T09:00:00", cfg), false);
  assert.equal(inPeriod("2026-07-01T09:00:00", cfg), false);
});
test("inPeriod: grenswaarden periodStart/periodEnd zijn inclusief", () => {
  assert.equal(inPeriod("2026-06-01T00:00:00", cfg), true);
  assert.equal(inPeriod("2026-06-30T23:59:59", cfg), true);
});
test("inPeriod: null of lege datum is true (dateloos item niet stilzwijgend laten vallen)", () => {
  assert.equal(inPeriod(null, cfg), true);
  assert.equal(inPeriod("", cfg), true);
  assert.equal(inPeriod(undefined, cfg), true);
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
// ─── buildReview (review-subcommand, pure kern) ─────────────────────────

const company = { id: 999, name: "Acme BV" };
const tickets = [
  { id: 100, ticketNumber: "T20260601.0001", title: "Ticket A", description: "Desc A" },
  { id: 101, ticketNumber: "T20260601.0002", title: "Ticket B", description: "Desc B" },
];
const workTypeNames = new Map([[20, "Onsite Support"], [21, "Remote Support"], [22, "Minor Change"], [23, "Major Change"]]);

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

// ─── outsidePeriod (Task 12.1: FLAG i.p.v. filter, item blijft altijd staan) ──

test("buildReview: time entry met dateWorked vóór periodStart krijgt outsidePeriod:true en wordt NIET weggefilterd", () => {
  const { charges, notesByTicket } = reviewFixtures();
  const timeEntries = [
    te({ id: 1, ticketID: 100, dateWorked: "2026-05-20T09:00:00" }), // vóór periodStart 2026-06-01
    te({ id: 2, ticketID: 101, dateWorked: "2026-06-15T09:00:00" }), // binnen periode
  ];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  const t101 = out.tickets.find((t) => t.ticketID === 101);
  const oud = t100.timeEntries.find((i) => i.id === 1);
  const binnen = t101.timeEntries.find((i) => i.id === 2);
  assert.equal(oud.outsidePeriod, true); // geflagd, niet gedropt
  assert.equal(binnen.outsidePeriod, false);
  assert.equal(out.totals.timeEntryCount, 2); // beide blijven staan
});

test("buildReview: charge met datePurchased vóór periodStart krijgt outsidePeriod:true en wordt NIET weggefilterd", () => {
  const { timeEntries, notesByTicket } = reviewFixtures();
  const charges = [
    { ...ch({ id: 50, ticketID: 100, datePurchased: "2026-05-10T00:00:00", createDate: "2026-05-10T00:00:00" }), kind: "ticketCharge" }, // "Buitenbundel mei"
  ];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  const item = t100.charges.find((i) => i.id === 50);
  assert.equal(item.outsidePeriod, true);
  assert.equal(out.totals.chargeCount, 1); // blijft staan, wordt niet gedropt
});

test("buildReview: charge zonder datePurchased/createDate krijgt outsidePeriod:false (niet valselijk geflagd)", () => {
  const { timeEntries, notesByTicket } = reviewFixtures();
  const charges = [
    { ...ch({ id: 50, ticketID: 100, datePurchased: null, createDate: null }), kind: "ticketCharge" },
  ];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  assert.equal(t100.charges.find((i) => i.id === 50).outsidePeriod, false);
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

test("isInvoiced: billedMap-hit (contract+code historisch >0 gefactureerd) geeft true", () => {
  const billedMap = new Map([[5, new Set([20])]]);
  assert.equal(isInvoiced(5, 20, 7, billedMap), true);
});

test("isInvoiced: contract bekend maar code niet in billedMap valt terug op contractType (T&M true, recurring false)", () => {
  const billedMap = new Map([[5, new Set([20])]]);
  assert.equal(isInvoiced(5, 21, 1, billedMap), true); // T&M: eerste-keer work type toch gefactureerd, niet gedekt
  assert.equal(isInvoiced(5, 21, 7, billedMap), false); // Recurring: geen historie -> gedekt
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

test("buildReview: availableContracts wordt ongewijzigd doorgegeven in de output", () => {
  const { timeEntries, charges, notesByTicket } = reviewFixtures();
  const availableContracts = [
    { id: 5, name: "Acme BV - Easywork Basic", type: 7 },
    { id: 6, name: "Acme BV - Easyvoice", type: 7 },
  ];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg, new Map(), new Map(), availableContracts);
  assert.deepEqual(out.availableContracts, availableContracts);
});

test("buildReview: availableContracts default naar lege array als niet meegegeven", () => {
  const { timeEntries, charges, notesByTicket } = reviewFixtures();
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  assert.deepEqual(out.availableContracts, []);
});

// ─── ticket.hourFlags (Task 14: Remote Support >1.5u, Change >2u per ticket) ──

test("buildReview: ticket.hourFlags bij Remote Support-som boven drempel (2u > 1.5u)", () => {
  const { charges, notesByTicket } = reviewFixtures();
  const timeEntries = [
    te({ id: 1, ticketID: 100, billingCodeID: 21, hoursToBill: 1, hoursWorked: 1, summaryNotes: "werk 1" }),
    te({ id: 2, ticketID: 100, billingCodeID: 21, hoursToBill: 1, hoursWorked: 1, summaryNotes: "werk 2" }),
  ];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  assert.deepEqual(t100.hourFlags, ["remote 2u > 1.5u"]);
});

test("buildReview: geen ticket.hourFlags onder de Remote Support-drempel (1u)", () => {
  const { charges, notesByTicket } = reviewFixtures();
  const timeEntries = [te({ id: 1, ticketID: 100, billingCodeID: 21, hoursToBill: 1, hoursWorked: 1, summaryNotes: "werk 1" })];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  assert.deepEqual(t100.hourFlags, []);
});

test("buildReview: ticket.hourFlags bij Change-som (Minor+Major) boven drempel (2.5u > 2u)", () => {
  const { charges, notesByTicket } = reviewFixtures();
  const timeEntries = [
    te({ id: 1, ticketID: 100, billingCodeID: 22, hoursToBill: 1.5, hoursWorked: 1.5, summaryNotes: "minor change" }),
    te({ id: 2, ticketID: 100, billingCodeID: 23, hoursToBill: 1, hoursWorked: 1, summaryNotes: "major change" }),
  ];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  assert.deepEqual(t100.hourFlags, ["change 2.5u > 2u"]);
});

test("buildReview: ticket kan zowel remote als change hourFlag hebben", () => {
  const { charges, notesByTicket } = reviewFixtures();
  const timeEntries = [
    te({ id: 1, ticketID: 100, billingCodeID: 21, hoursToBill: 2, hoursWorked: 2, summaryNotes: "remote" }),
    te({ id: 2, ticketID: 100, billingCodeID: 22, hoursToBill: 2.5, hoursWorked: 2.5, summaryNotes: "change" }),
  ];
  const out = buildReview(company, tickets, timeEntries, charges, notesByTicket, workTypeNames, cfg);
  const t100 = out.tickets.find((t) => t.ticketID === 100);
  assert.deepEqual(t100.hourFlags.sort(), ["change 2.5u > 2u", "remote 2u > 1.5u"]);
});

// ─── buildHourFlags (pure kern van de urennorm-flags, Task 14) ──────────

const hf = (o = {}) => ({ ticketID: 100, companyId: 1, companyName: "Acme BV", hours: 1, category: "remote", ...o });
const hfCfg = { remoteSupportHoursThreshold: 1.5, changeHoursThreshold: 2 };

test("buildHourFlags: twee remote entries samen 2u (boven 1.5u drempel) geeft een flag", () => {
  const entries = [
    hf({ ticketID: 100, hours: 1, category: "remote" }),
    hf({ ticketID: 100, hours: 1, category: "remote" }),
  ];
  const out = buildHourFlags(entries, hfCfg);
  assert.deepEqual(out, [{ ticketID: 100, companyName: "Acme BV", category: "remote", hours: 2, threshold: 1.5 }]);
});

test("buildHourFlags: 1u remote (onder drempel) geeft geen flag", () => {
  const entries = [hf({ ticketID: 100, hours: 1, category: "remote" })];
  assert.deepEqual(buildHourFlags(entries, hfCfg), []);
});

test("buildHourFlags: change entries samen 2.5u (boven 2u drempel) geeft een flag", () => {
  const entries = [
    hf({ ticketID: 200, hours: 1.5, category: "change" }),
    hf({ ticketID: 200, hours: 1, category: "change" }),
  ];
  const out = buildHourFlags(entries, hfCfg);
  assert.deepEqual(out, [{ ticketID: 200, companyName: "Acme BV", category: "change", hours: 2.5, threshold: 2 }]);
});

test("buildHourFlags: 1.5u change (op de drempel, niet erboven) geeft geen flag", () => {
  const entries = [hf({ ticketID: 200, hours: 1.5, category: "change" })];
  assert.deepEqual(buildHourFlags(entries, hfCfg), []);
});

test("buildHourFlags: category other wordt genegeerd, ook bij veel uren", () => {
  const entries = [hf({ ticketID: 300, hours: 10, category: "other" })];
  assert.deepEqual(buildHourFlags(entries, hfCfg), []);
});

test("buildHourFlags: sortering op hours desc over meerdere tickets/categorieen", () => {
  const entries = [
    hf({ ticketID: 100, hours: 1, category: "remote" }),
    hf({ ticketID: 100, hours: 1, category: "remote" }), // 2u remote
    hf({ ticketID: 200, hours: 1.5, category: "change" }),
    hf({ ticketID: 200, hours: 2, category: "change" }), // 3.5u change
  ];
  const out = buildHourFlags(entries, hfCfg);
  assert.deepEqual(out.map((f) => f.ticketID), [200, 100]);
  assert.deepEqual(out.map((f) => f.hours), [3.5, 2]);
});

test("buildHourFlags: eenzelfde ticket kan zowel een remote- als change-flag opleveren (twee rows)", () => {
  const entries = [
    hf({ ticketID: 100, hours: 2, category: "remote" }),
    hf({ ticketID: 100, hours: 2.5, category: "change" }),
  ];
  const out = buildHourFlags(entries, hfCfg);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((f) => f.category).sort(), ["change", "remote"]);
});

test("buildHourFlags: per-ticket sommatie werkt over meerdere entries, andere ticket blijft gescheiden", () => {
  const entries = [
    hf({ ticketID: 100, companyName: "Acme BV", hours: 1, category: "remote" }),
    hf({ ticketID: 100, companyName: "Acme BV", hours: 0.6, category: "remote" }),
    hf({ ticketID: 101, companyId: 2, companyName: "Contoso", hours: 1, category: "remote" }),
  ];
  const out = buildHourFlags(entries, hfCfg);
  assert.equal(out.length, 1);
  assert.equal(out[0].ticketID, 100);
  assert.equal(Math.round(out[0].hours * 10) / 10, 1.6);
});

test("buildHourFlags: lege input geeft lege array", () => {
  assert.deepEqual(buildHourFlags([], hfCfg), []);
});

// ─── postedIdsFromRows (precieze posted-detectie, los van contract-brede historie) ──

test("postedIdsFromRows: een BillingItem op timeEntryID sluit die entry uit, ongeacht (afwijkend/ontbrekend) contractID", () => {
  const rows = [
    { timeEntryID: 111, contractID: 999 }, // contractID wijkt af van de bron-contract, mag geen rol spelen
    { timeEntryID: 112, contractID: null }, // contractID zelfs afwezig
    { timeEntryID: null, contractID: 5 }, // geen timeEntryID -> genegeerd
  ];
  const posted = postedIdsFromRows(rows, "timeEntryID");
  assert.ok(posted.has(111));
  assert.ok(posted.has(112));
  assert.equal(posted.size, 2);
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

// ─── buildSummary (org-brede triage, pure aggregatie) ───────────────────

const si = (o = {}) => ({ companyId: 1, companyName: "Acme BV", kind: "labour", amountEUR: 0, hours: 0, problems: [], ...o });
const RANK = 75;

test("buildSummary: sommeert chargeEUR over charge-kinds per klant", () => {
  const items = [
    si({ companyId: 1, kind: "ticketCharge", amountEUR: 100 }),
    si({ companyId: 1, kind: "contractCharge", amountEUR: 50 }),
    si({ companyId: 1, kind: "projectCharge", amountEUR: 25 }),
  ];
  const { rows } = buildSummary(items, RANK);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyId, 1);
  assert.equal(rows[0].chargeEUR, 175);
});

test("buildSummary: sommeert billableHours alleen over niet-prepaid labour-items", () => {
  const items = [
    si({ companyId: 1, kind: "labour", hours: 2 }),
    si({ companyId: 1, kind: "labour", hours: 3.5 }),
    si({ companyId: 1, kind: "ticketCharge", amountEUR: 10, hours: 999 }), // hours op een charge telt niet mee
  ];
  const { rows } = buildSummary(items, RANK);
  assert.equal(rows[0].billableHours, 5.5);
  assert.equal(rows[0].prepaidHours, 0);
});

test("buildSummary: prepaid labour (Block Hours/Per Ticket) telt apart mee als prepaidHours, niet als billableHours", () => {
  const items = [
    si({ companyId: 1, kind: "labour", hours: 4, prepaid: false }),
    si({ companyId: 1, kind: "labour", hours: 10, prepaid: true }),
  ];
  const { rows } = buildSummary(items, RANK);
  assert.equal(rows[0].billableHours, 4);
  assert.equal(rows[0].prepaidHours, 10);
});

test("buildSummary: signalCount is de som van problems.length over alle items van de klant", () => {
  const items = [
    si({ companyId: 1, kind: "labour", hours: 1, problems: [{ code: "labour.zeroHours" }] }),
    si({ companyId: 1, kind: "ticketCharge", amountEUR: 10, problems: [{ code: "charge.zeroAmount" }, { code: "charge.missingWorkType" }] }),
  ];
  const { rows } = buildSummary(items, RANK);
  assert.equal(rows[0].signalCount, 3);
});

test("buildSummary: aggregeert per companyId, niet cross-klant", () => {
  const items = [
    si({ companyId: 1, companyName: "Acme BV", kind: "ticketCharge", amountEUR: 100 }),
    si({ companyId: 2, companyName: "Contoso", kind: "ticketCharge", amountEUR: 50 }),
  ];
  const { rows } = buildSummary(items, RANK);
  assert.equal(rows.length, 2);
  const acme = rows.find((r) => r.companyId === 1), contoso = rows.find((r) => r.companyId === 2);
  assert.equal(acme.companyName, "Acme BV");
  assert.equal(acme.chargeEUR, 100);
  assert.equal(contoso.companyName, "Contoso");
  assert.equal(contoso.chargeEUR, 50);
});

test("buildSummary: klant zonder te-factureren en zonder signalen wordt verborgen en meegeteld in hidden", () => {
  const items = [
    si({ companyId: 1, kind: "ticketCharge", amountEUR: 0, hours: 0, problems: [] }), // niets actiehoudend
    si({ companyId: 2, kind: "ticketCharge", amountEUR: 10 }), // wel actiehoudend
  ];
  const { rows, hidden } = buildSummary(items, RANK);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyId, 2);
  assert.equal(hidden, 1);
});

test("buildSummary: signalCount>0 alleen is ook actiehoudend (0 charge, 0 uur, wel signalen)", () => {
  const items = [
    si({ companyId: 1, kind: "labour", hours: 0, problems: [{ code: "labour.zeroHours" }] }),
  ];
  const { rows, hidden } = buildSummary(items, RANK);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].signalCount, 1);
  assert.equal(hidden, 0);
});

test("buildSummary: prepaidHours>0 alleen (0 charge, 0 T&M-uren, geen signalen) is ook actiehoudend", () => {
  const items = [
    si({ companyId: 1, companyName: "Alleen prepaid", kind: "labour", hours: 8, prepaid: true }),
  ];
  const { rows, hidden } = buildSummary(items, RANK);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].companyId, 1);
  assert.equal(rows[0].prepaidHours, 8);
  assert.equal(rows[0].billableHours, 0);
  assert.equal(hidden, 0);
});

test("buildSummary: rangeert op chargeEUR + billableHours*rankHourRate desc (uren-zware klant boven charge-zware klant met lager rankHourRate-gewogen totaal)", () => {
  const items = [
    si({ companyId: 1, companyName: "Laag bedrag", kind: "ticketCharge", amountEUR: 10 }),
    si({ companyId: 2, companyName: "Hoog bedrag", kind: "ticketCharge", amountEUR: 500 }),
    si({ companyId: 3, companyName: "Alleen uren hoog", kind: "labour", hours: 20 }), // 20*75 = 1500
    si({ companyId: 4, companyName: "Alleen uren laag", kind: "labour", hours: 2 }), // 2*75 = 150
  ];
  const { rows } = buildSummary(items, RANK);
  // rank: 3=1500, 2=500, 4=150, 1=10 -> uren-zware klant (3) staat nu boven de charge-zware klant (2)
  assert.deepEqual(rows.map((r) => r.companyId), [3, 2, 4, 1]);
});

test("buildSummary: prepaidHours telt niet mee in de rank, alleen billableHours (T&M)", () => {
  const items = [
    si({ companyId: 1, companyName: "T&M uren", kind: "labour", hours: 10, prepaid: false }), // rank 10*75=750
    si({ companyId: 2, companyName: "Prepaid uren", kind: "labour", hours: 1000, prepaid: true }), // rank blijft 0
  ];
  const { rows } = buildSummary(items, RANK);
  assert.deepEqual(rows.map((r) => r.companyId), [1, 2]);
});

test("buildSummary: bij gelijke chargeEUR+billableHours*rankHourRate wint hogere billableHours (tie-break)", () => {
  const items = [
    si({ companyId: 1, kind: "ticketCharge", amountEUR: 100 }),
    si({ companyId: 1, kind: "labour", hours: 1 }),
    si({ companyId: 2, kind: "ticketCharge", amountEUR: 100 }),
    si({ companyId: 2, kind: "labour", hours: 5 }),
  ];
  const { rows } = buildSummary(items, RANK);
  assert.deepEqual(rows.map((r) => r.companyId), [2, 1]);
});

test("buildSummary: lege input geeft lege rows en hidden 0", () => {
  const { rows, hidden } = buildSummary([], RANK);
  assert.deepEqual(rows, []);
  assert.equal(hidden, 0);
});

// ─── buildRemoteSupportReview (gedekte Remote Support, AI-work-type-review) ──

const rs = (o = {}) => ({ companyId: 1, companyName: "Acme BV", id: 1, hours: 1, dateWorked: "2026-06-01T09:00:00", summary: "werk", ...o });

test("buildRemoteSupportReview: groepeert per klant met count/hours/entries", () => {
  const items = [
    rs({ companyId: 1, companyName: "Acme BV", id: 10, hours: 2, dateWorked: "2026-06-01T09:00:00", summary: "Onsite geweest bij klant" }),
    rs({ companyId: 1, companyName: "Acme BV", id: 11, hours: 1.5, dateWorked: "2026-06-03T09:00:00", summary: "Telefonisch geholpen" }),
    rs({ companyId: 2, companyName: "Contoso", id: 20, hours: 3, dateWorked: "2026-06-05T09:00:00", summary: "Remote reboot" }),
  ];
  const out = buildRemoteSupportReview(items);
  assert.equal(out.length, 2);
  const acme = out.find((r) => r.companyId === 1);
  assert.equal(acme.companyName, "Acme BV");
  assert.equal(acme.count, 2);
  assert.equal(acme.hours, 3.5);
  assert.deepEqual(acme.entries.map((e) => e.id).sort(), [10, 11]);
  assert.deepEqual(acme.entries.find((e) => e.id === 10), { id: 10, hours: 2, dateWorked: "2026-06-01T09:00:00", summary: "Onsite geweest bij klant" });
  const contoso = out.find((r) => r.companyId === 2);
  assert.equal(contoso.count, 1);
  assert.equal(contoso.hours, 3);
});

test("buildRemoteSupportReview: sorteert op count desc", () => {
  const items = [
    rs({ companyId: 1, companyName: "Weinig", id: 1 }),
    rs({ companyId: 2, companyName: "Veel", id: 2 }),
    rs({ companyId: 2, companyName: "Veel", id: 3 }),
    rs({ companyId: 2, companyName: "Veel", id: 4 }),
  ];
  const out = buildRemoteSupportReview(items);
  assert.deepEqual(out.map((r) => r.companyId), [2, 1]);
});

test("buildRemoteSupportReview: lege input geeft lege array", () => {
  assert.deepEqual(buildRemoteSupportReview([]), []);
});

test("buildRemoteSupportReview: sorteert entries per bedrijf op dateWorked ascending (null/empty last)", () => {
  const items = [
    rs({ companyId: 1, id: 10, dateWorked: "2026-06-03T09:00:00" }),
    rs({ companyId: 1, id: 11, dateWorked: "2026-06-01T09:00:00" }),
    rs({ companyId: 1, id: 12, dateWorked: null }),
    rs({ companyId: 1, id: 13, dateWorked: "2026-06-02T09:00:00" }),
  ];
  const out = buildRemoteSupportReview(items);
  const acme = out.find((r) => r.companyId === 1);
  assert.deepEqual(acme.entries.map((e) => e.id), [11, 13, 10, 12]);
});

// ─── keepIfTicketComplete (alleen afgeronde tickets in review/summary/RS) ──

test("keepIfTicketComplete: item zonder ticketID (niet ticket-gebonden) blijft altijd", () => {
  const items = [{ id: 1, ticketID: null }];
  const out = keepIfTicketComplete(items, new Set([5]));
  assert.deepEqual(out, items);
});

test("keepIfTicketComplete: item op een afgerond ticket (id in completeTicketIds) blijft", () => {
  const items = [{ id: 1, ticketID: 100 }];
  const out = keepIfTicketComplete(items, new Set([100]));
  assert.deepEqual(out, items);
});

test("keepIfTicketComplete: item op een niet-afgerond ticket (id niet in completeTicketIds) valt weg", () => {
  const items = [{ id: 1, ticketID: 100 }];
  const out = keepIfTicketComplete(items, new Set([200]));
  assert.deepEqual(out, []);
});

test("keepIfTicketComplete: mix van ticketloos, afgerond en lopend", () => {
  const items = [
    { id: 1, ticketID: null },
    { id: 2, ticketID: 100 },
    { id: 3, ticketID: 200 },
  ];
  const out = keepIfTicketComplete(items, new Set([100]));
  assert.deepEqual(out.map((i) => i.id), [1, 2]);
});

test("COMPLETE_TICKET_STATUSES bevat 5 (Complete) en 16 (Autocomplete RMM)", () => {
  assert.ok(COMPLETE_TICKET_STATUSES.has(5));
  assert.ok(COMPLETE_TICKET_STATUSES.has(16));
  assert.equal(COMPLETE_TICKET_STATUSES.size, 2);
});

// ─── safeFetch / renderWarnings (Task 13: partial-failure vangnet) ──────

test("safeFetch: fn slaagt -> geeft data terug, warnings blijft leeg", async () => {
  const warnings = [];
  const result = await safeFetch(warnings, "X", async () => [1, 2]);
  assert.deepEqual(result, [1, 2]);
  assert.deepEqual(warnings, []);
});

test("safeFetch: fn gooit -> geeft fallback terug en noteert een warning met label+foutmelding", async () => {
  const warnings = [];
  const result = await safeFetch(warnings, "X", async () => { throw new Error("boom"); });
  assert.deepEqual(result, []);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("X"));
  assert.ok(warnings[0].includes("boom"));
});

test("safeFetch: custom fallback wordt teruggegeven bij een fout", async () => {
  const warnings = [];
  const result = await safeFetch(warnings, "X", async () => { throw new Error("boom"); }, null);
  assert.equal(result, null);
});

test("renderWarnings: lege array geeft lege string", () => {
  assert.equal(renderWarnings([]), "");
});

test("renderWarnings: met items geeft een banner met ONVOLLEDIG en de warning-tekst", () => {
  const out = renderWarnings(["a: b"]);
  assert.ok(out.includes("ONVOLLEDIG"));
  assert.ok(out.includes("a: b"));
});

// ─── fetchBatchedIn / postedIdsBatched skip-continue (Task 13 follow-up: ──
// injecteerbare queryFn maakt de batch-lus zelf testbaar zonder netwerk) ────

test("fetchBatchedIn: mét warnings slaat een mislukte batch over en gaat door (partial resultaat, 1 warning)", async () => {
  let call = 0;
  const queryFn = async (entity, filterItems) => {
    call++;
    if (call === 2) throw new Error("batch2 boom");
    const batch = filterItems[0].value;
    return batch.map((id) => ({ id }));
  };
  const warnings = [];
  const out = await fetchBatchedIn("TimeEntries", "contractID", [1, 2, 3, 4, 5, 6], [], 2, warnings, queryFn);
  assert.deepEqual(out.map((r) => r.id).sort((a, b) => a - b), [1, 2, 5, 6]); // batch 2 ([3,4]) ontbreekt
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("TimeEntries/contractID"));
});

test("fetchBatchedIn: zonder warnings gooit een mislukte batch nog steeds door (oud strikt gedrag)", async () => {
  const queryFn = async () => { throw new Error("boom"); };
  await assert.rejects(
    () => fetchBatchedIn("TimeEntries", "contractID", [1, 2, 3, 4], [], 2, undefined, queryFn),
    /boom/
  );
});

test("postedIdsBatched: mét warnings slaat een mislukte batch over, geslaagde batches blijven in de set, 1 warning, geen throw", async () => {
  let call = 0;
  const queryFn = async (entity, filterItems) => {
    call++;
    if (call === 2) throw new Error("posted batch boom");
    const batch = filterItems[0].value;
    return batch.map((id) => ({ timeEntryID: id }));
  };
  const warnings = [];
  const result = await postedIdsBatched("timeEntryID", [10, 20, 30, 40, 50, 60], 2, warnings, queryFn);
  assert.equal(result.has(10), true);
  assert.equal(result.has(20), true);
  assert.equal(result.has(30), false); // mislukte batch: niet in de set
  assert.equal(result.has(40), false);
  assert.equal(result.has(50), true);
  assert.equal(result.has(60), true);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("onvolledig"));
});
