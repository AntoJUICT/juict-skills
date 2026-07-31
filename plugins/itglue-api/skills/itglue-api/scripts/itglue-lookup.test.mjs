import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOrgName,
  pickExactOrg,
  assertPathAllowed,
  passwordDeeplink,
  passwordTreffers,
  buildQuery,
  redactSecrets,
} from "./itglue-lookup.mjs";

test("normalizeOrgName: strippt rechtsvorm, leestekens en dubbele spaties", () => {
  assert.equal(normalizeOrgName("JUICT B.V."), "juict");
  assert.equal(normalizeOrgName("juict bv"), "juict");
  assert.equal(normalizeOrgName("  Lettix   Holding B.V. "), "lettix");
  assert.equal(normalizeOrgName("Van der Meer & Zn"), "van der meer zn");
});

test("normalizeOrgName: raakt bv midden in een woord niet aan", () => {
  assert.equal(normalizeOrgName("Bvlgari"), "bvlgari");
});

test("pickExactOrg: één exacte match op genormaliseerde naam", () => {
  const orgs = [
    { id: "1", attributes: { name: "JUICT B.V." } },
    { id: "2", attributes: { name: "JUICT Holding B.V." } },
  ];
  const { match, kandidaten } = pickExactOrg(orgs, "juict bv");
  assert.equal(match.id, "1");
  assert.deepEqual(kandidaten, []);
});

test("pickExactOrg: geen exacte match geeft alle kandidaten terug", () => {
  const orgs = [
    { id: "1", attributes: { name: "Jansen Techniek" } },
    { id: "2", attributes: { name: "Jansen Bouw" } },
  ];
  const { match, kandidaten } = pickExactOrg(orgs, "jansen");
  assert.equal(match, null);
  assert.equal(kandidaten.length, 2);
});

test("pickExactOrg: meerdere exacte matches geeft alleen die matches als kandidaten", () => {
  const orgs = [
    { id: "1", attributes: { name: "Jansen B.V." } },
    { id: "2", attributes: { name: "Jansen BV" } },
    { id: "3", attributes: { name: "Pietersen" } },
  ];
  const { match, kandidaten } = pickExactOrg(orgs, "Jansen");
  assert.equal(match, null);
  assert.deepEqual(kandidaten.map((o) => o.id), ["1", "2"]);
});

test("assertPathAllowed: individuele password-resource wordt geweigerd", () => {
  assert.throws(() => assertPathAllowed("/passwords/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("passwords/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords/12345?include=related"), /Geblokkeerd/);
});

test("assertPathAllowed: show_password wordt geweigerd", () => {
  assert.throws(() => assertPathAllowed("/passwords?show_password=true"), /Geblokkeerd/);
});

test("assertPathAllowed: collectie-endpoints mogen wel", () => {
  assert.equal(assertPathAllowed("/passwords?filter[organization_id]=7"), "/passwords?filter[organization_id]=7");
  assert.equal(
    assertPathAllowed("/organizations/7/relationships/passwords"),
    "/organizations/7/relationships/passwords"
  );
  assert.equal(assertPathAllowed("/configurations?page[size]=50"), "/configurations?page[size]=50");
});

test("assertPathAllowed: dubbele/drievoudige slash omzeilt de blokkade niet", () => {
  assert.throws(() => assertPathAllowed("/passwords//12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords///12345"), /Geblokkeerd/);
});

test("assertPathAllowed: gecodeerde slash (%2F) omzeilt de blokkade niet", () => {
  assert.throws(() => assertPathAllowed("/passwords%2F12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords%2f12345"), /Geblokkeerd/);
});

test("assertPathAllowed: toegestane paden komen ongewijzigd terug, ook na normalisatie-controle", () => {
  assert.equal(assertPathAllowed("/passwords?filter[organization_id]=7"), "/passwords?filter[organization_id]=7");
  assert.equal(
    assertPathAllowed("/organizations/7/relationships/passwords"),
    "/organizations/7/relationships/passwords"
  );
});

test("assertPathAllowed: een losse % in de query gooit geen decodeerfout", () => {
  assert.equal(
    assertPathAllowed("/configurations?filter[name]=100%"),
    "/configurations?filter[name]=100%"
  );
});

test("passwordDeeplink: bouwt de portal-URL en slikt dubbele slashes", () => {
  assert.equal(passwordDeeplink(7, 42), "https://juict.eu.itglue.com/7/passwords/42");
  assert.equal(passwordDeeplink(7, 42, "https://juict.eu.itglue.com/"), "https://juict.eu.itglue.com/7/passwords/42");
});

test("passwordDeeplink: ontbrekende ids geven een fout", () => {
  assert.throws(() => passwordDeeplink(null, 42), /vereist/);
  assert.throws(() => passwordDeeplink(7, undefined), /vereist/);
});

test("passwordTreffers: geeft uitsluitend naam en link terug, ook als de input geheimen bevat", () => {
  const items = [
    {
      id: "42",
      attributes: {
        name: "Beheerder firewall",
        username: "admin",
        password: "GeheimNietTonen",
        "organization-id": 7,
        "otp-enabled": true,
        "password-category-name": "Netwerk",
      },
    },
  ];
  const out = passwordTreffers(items, 7, "firewall");
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]), ["naam", "link"]);
  assert.equal(out[0].naam, "Beheerder firewall");
  assert.equal(out[0].link, "https://juict.eu.itglue.com/7/passwords/42");
  assert.ok(!JSON.stringify(out).includes("GeheimNietTonen"));
  assert.ok(!JSON.stringify(out).includes("admin"));
});

test("passwordTreffers: filtert op zoekterm en valt terug op de meegegeven orgId", () => {
  const items = [
    { id: "1", attributes: { name: "Firewall admin" } },
    { id: "2", attributes: { name: "Wifi gast" } },
  ];
  const out = passwordTreffers(items, 9, "wifi");
  assert.deepEqual(out, [{ naam: "Wifi gast", link: "https://juict.eu.itglue.com/9/passwords/2" }]);
});

test("passwordTreffers: zonder zoekterm komt alles mee", () => {
  const items = [
    { id: "1", attributes: { name: "A" } },
    { id: "2", attributes: { name: "B" } },
  ];
  assert.equal(passwordTreffers(items, 9).length, 2);
});

test("buildQuery: bouwt filter-, page-size- en page-number-parameters", () => {
  const qs = buildQuery({ organization_id: 7, name: "srv" }, { pageSize: 50, pageNumber: 2 });
  const params = new URLSearchParams(qs.slice(1));
  assert.equal(params.get("filter[organization_id]"), "7");
  assert.equal(params.get("filter[name]"), "srv");
  assert.equal(params.get("page[size]"), "50");
  assert.equal(params.get("page[number]"), "2");
});

test("buildQuery: lege of onbekende waarden vallen weg", () => {
  assert.equal(buildQuery({}), "");
  assert.equal(buildQuery({ name: undefined, id: null, q: "" }), "");
});

test("redactSecrets: vervangt de key door [REDACTED]", () => {
  const out = redactSecrets("fout met key ITG.abc123 in url", "ITG.abc123");
  assert.equal(out, "fout met key [REDACTED] in url");
});

test("redactSecrets: lege key laat de tekst ongemoeid", () => {
  assert.equal(redactSecrets("gewone tekst", ""), "gewone tekst");
});
