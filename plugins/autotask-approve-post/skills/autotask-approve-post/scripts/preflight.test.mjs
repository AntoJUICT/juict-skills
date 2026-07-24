// preflight.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, checkLabour, checkCharge, groupItems, renderReport } from "./preflight.mjs";

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
test("renderReport toont klant/ticket/schoon/te-fixen + samenvatting", () => {
  const groups = groupItems([checkCharge(ch({ billingCodeID: null, productID: null }), "ticketCharge", cfg)], new Map([[999, "Acme BV"]]));
  const md = renderReport(groups, "juni 2026");
  assert.ok(md.includes("## Klant: Acme BV"));
  assert.ok(md.includes("Ticket 100"));
  assert.ok(md.includes("⚠️"));
  assert.match(md, /1 klant/);
});
