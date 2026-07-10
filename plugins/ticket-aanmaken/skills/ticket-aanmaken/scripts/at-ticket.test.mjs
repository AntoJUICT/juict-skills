import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilter, runCommand, redactSecrets, summarizeRoles, picklistFromFields } from "./at-ticket.mjs";

const TICKET_FIELDS = [
  { name: "status", picklistValues: [
    { value: "1", label: "New", isActive: true },
    { value: "5", label: "Complete", isActive: true },
    { value: "99", label: "Oud", isActive: false },
  ] },
  { name: "ticketCategory", picklistValues: [
    { value: "3", label: "Standard", isActive: true },
    { value: "113", label: "Incident", isActive: true },
  ] },
];

test("picklistFromFields: mapt actieve waarden naar {id,name} en laat inactieve weg", () => {
  const out = picklistFromFields(TICKET_FIELDS, "status");
  assert.deepEqual(out, [{ id: 1, name: "New" }, { id: 5, name: "Complete" }]);
});

test("picklistFromFields: onbekend veld gooit duidelijke fout", () => {
  assert.throws(() => picklistFromFields(TICKET_FIELDS, "bestaatniet"), /niet gevonden/);
});

test("buildFilter: enkele conditie blijft plat", () => {
  const out = buildFilter([{ field: "isActive", op: "eq", value: true }]);
  assert.deepEqual(out, { filter: [{ field: "isActive", op: "eq", value: true }] });
});

test("buildFilter: meerdere condities in and-wrapper", () => {
  const out = buildFilter([
    { field: "isActive", op: "eq", value: true },
    { field: "companyName", op: "contains", value: "Jansen" },
  ]);
  assert.deepEqual(out, {
    filter: [{ op: "and", items: [
      { field: "isActive", op: "eq", value: true },
      { field: "companyName", op: "contains", value: "Jansen" },
    ] }],
  });
});

test("buildFilter: lege array geeft lege filter", () => {
  assert.deepEqual(buildFilter([]), { filter: [] });
});

test("runCommand: onbekend commando gooit duidelijke fout", async () => {
  await assert.rejects(() => runCommand(["bestaat-niet"]), /Onbekend commando/);
});

test("runCommand: lookup-company zonder naam gooit fout", async () => {
  await assert.rejects(() => runCommand(["lookup-company"]), /naam/i);
});

import { cmdCreate } from "./at-ticket.mjs";

const geldig = JSON.stringify({
  title: "Printer werkt niet", description: "Melding via telefoon.",
  companyID: 123, status: 1, priority: 2, queueID: 5,
  billingCodeID: 29682885, assignedResourceID: 29682902, assignedResourceRoleID: 29682846,
});

test("cmdCreate --dry-run POST't niet en geeft de payload terug", async () => {
  const out = await cmdCreate(geldig, { dryRun: true });
  assert.equal(out.dryRun, true);
  assert.equal(out.payload.title, "Printer werkt niet");
  assert.equal(out.payload.companyID, 123);
});

test("cmdCreate weigert zonder title", async () => {
  const bad = JSON.stringify({ companyID: 123, status: 1, priority: 2 });
  await assert.rejects(() => cmdCreate(bad, { dryRun: true }), /title/i);
});

test("cmdCreate weigert assignedResourceID zonder assignedResourceRoleID", async () => {
  const bad = JSON.stringify({ title: "x", companyID: 1, status: 1, priority: 2, assignedResourceID: 5 });
  await assert.rejects(() => cmdCreate(bad, { dryRun: true }), /assignedResourceRoleID/i);
});

test("cmdCreate weigert ongeldige JSON", async () => {
  await assert.rejects(() => cmdCreate("{niet json}", { dryRun: true }), /JSON/i);
});

test("redactSecrets: vervangt username in tekst", () => {
  const out = redactSecrets("Fout: gebruiker jan.jansen@juict.nl bestaat niet", {
    username: "jan.jansen@juict.nl",
    secret: "geheim123",
    integrationCode: "INT-ABC",
  });
  assert.equal(out, "Fout: gebruiker [REDACTED] bestaat niet");
  assert.ok(!out.includes("jan.jansen@juict.nl"));
});

test("redactSecrets: vervangt alle drie credential-waarden defensief", () => {
  const out = redactSecrets("user=jan secret=geheim123 code=INT-ABC", {
    username: "jan",
    secret: "geheim123",
    integrationCode: "INT-ABC",
  });
  assert.equal(out, "user=[REDACTED] secret=[REDACTED] code=[REDACTED]");
});

test("redactSecrets: lege/undefined cred crasht niet en verandert tekst niet", () => {
  const tekst = "Autotask API fout 401: onbekende fout";
  const out = redactSecrets(tekst, { username: undefined, secret: "", integrationCode: null });
  assert.equal(out, tekst);
});

test("runCommand create: meer dan één JSON-argument gooit duidelijke fout", async () => {
  const json = JSON.stringify({ title: "x", companyID: 1, status: 1, priority: 2 });
  await assert.rejects(() => runCommand(["create", json, json]), /precies één/);
});

test("runCommand create: geen JSON-argument gooit duidelijke fout", async () => {
  await assert.rejects(() => runCommand(["create"]), /precies één/);
});

test("runCommand create: precies één geldig JSON-argument met --dry-run werkt", async () => {
  const out = await runCommand(["create", geldig, "--dry-run"]);
  assert.equal(out.dryRun, true);
  assert.equal(out.payload.title, "Printer werkt niet");
});

test("runCommand create: --impersonate geeft het resource-id door (dry-run)", async () => {
  const out = await runCommand(["create", geldig, "--impersonate", "29682885", "--dry-run"]);
  assert.equal(out.dryRun, true);
  assert.equal(out.impersonateResourceID, "29682885");
});

test("runCommand create: --impersonate zonder waarde gooit fout", async () => {
  await assert.rejects(
    () => runCommand(["create", geldig, "--impersonate", "--dry-run"]),
    /impersonate vereist een resource-id/
  );
});

test("runCommand create: --impersonate telt niet als JSON-argument", async () => {
  // met impersonate-id + json is er nog steeds precies één json-argument
  const out = await runCommand(["create", geldig, "--impersonate", "123", "--dry-run"]);
  assert.equal(out.payload.title, "Printer werkt niet");
});

test("summarizeRoles: meerdere rijen met dezelfde rol -> één eenduidige roleID + queue-mapping", () => {
  const out = summarizeRoles([
    { queueID: 8, roleID: 29683461 },
    { queueID: 12, roleID: 29683461 },
    { queueID: 20, roleID: 29683461 },
  ]);
  assert.deepEqual(out.roleIDs, [29683461]);
  assert.equal(out.roleID, 29683461);
  assert.deepEqual(out.queueRoles, [
    { queueID: 8, roleID: 29683461 },
    { queueID: 12, roleID: 29683461 },
    { queueID: 20, roleID: 29683461 },
  ]);
});

test("summarizeRoles: verschillende rollen per queue -> roleID null (ambigu), queue-mapping behouden", () => {
  const out = summarizeRoles([
    { queueID: 8, roleID: 111 },
    { queueID: 9, roleID: 222 },
  ]);
  assert.deepEqual(out.roleIDs, [111, 222]);
  assert.equal(out.roleID, null);
  assert.deepEqual(out.queueRoles, [
    { queueID: 8, roleID: 111 },
    { queueID: 9, roleID: 222 },
  ]);
});

test("summarizeRoles: geen rijen -> roleID null, lege lijsten", () => {
  assert.deepEqual(summarizeRoles([]), { roleIDs: [], roleID: null, queueRoles: [] });
  assert.deepEqual(summarizeRoles(undefined), { roleIDs: [], roleID: null, queueRoles: [] });
});
