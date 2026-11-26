import { test } from "node:test";
import assert from "node:assert/strict";
import { PROEVEN, bepaalStatus, controleer, hoofd } from "./gdap-check.mjs";

const TENANT = "11111111-2222-3333-4444-555555555555";
const NU = new Date("2026-11-26T10:00:00Z");

// fetch die per proef een status teruggeeft; standaard 200.
const nepFetch = (fouten = {}) => async (url) => {
  const proef = PROEVEN.find((p) => url.endsWith(p.url));
  const status = proef && fouten[proef.naam] ? fouten[proef.naam] : 200;
  return { ok: status === 200, status, json: async () => ({ value: [] }) };
};
const metToken = () => "nep-token";
const zonderToken = () => { throw new Error("geen token"); };

test("PROEVEN: organisatie eerst, alleen lezen met kleine pagina's", () => {
  assert.equal(PROEVEN[0].naam, "organisatie");
  for (const p of PROEVEN) {
    assert.ok(p.onderdeel.length > 3, p.naam);
    assert.ok(!/\bMFA\b|\bM365\b/.test(p.onderdeel), `${p.naam}: geen verboden afkorting`);
  }
  // Wat met de az-token nooit lukt, hoort niet in de proef: anders lijkt GDAP altijd beperkt.
  const urls = PROEVEN.map((p) => p.url).join(" ");
  assert.ok(!/deviceManagement|sites|identitySecurityDefaults/.test(urls));
});

test("bepaalStatus: alles goed is actief", () => {
  const r = bepaalStatus(PROEVEN.map((p) => ({ ...p, ok: true })));
  assert.equal(r.status, "actief");
  assert.deepEqual(r.ontbreekt, []);
});

test("bepaalStatus: token wel, maar niets leesbaar is geen-rechten", () => {
  const r = bepaalStatus(PROEVEN.map((p) => ({ ...p, ok: false })));
  assert.equal(r.status, "geen-rechten");
  assert.equal(r.ontbreekt.length, PROEVEN.length);
});

test("bepaalStatus: alleen organisatie niet leesbaar is beperkt", () => {
  const r = bepaalStatus(PROEVEN.map((p) => ({ ...p, ok: p.naam !== "organisatie" })));
  assert.equal(r.status, "beperkt");
  assert.deepEqual(r.ontbreekt, ["Organisatie"]);
});

test("bepaalStatus: een onderdeel mist is beperkt, met de onderdelen", () => {
  const r = bepaalStatus(PROEVEN.map((p) => ({ ...p, ok: p.naam !== "conditionalAccess" })));
  assert.equal(r.status, "beperkt");
  assert.deepEqual(r.ontbreekt, ["Conditional Access"]);
});

test("controleer: alle proeven slagen", async () => {
  const r = await controleer(TENANT, { haalToken: metToken, fetch: nepFetch(), nu: NU });
  assert.equal(r.status, "actief");
  assert.equal(r.tenantId, TENANT);
  assert.equal(r.gecontroleerd, "2026-11-26");
  assert.match(r.melding, /werkt/);
});

test("controleer: 403 op multifactor-registratie geeft beperkt met melding over rollen", async () => {
  const r = await controleer(TENANT, { haalToken: metToken, fetch: nepFetch({ multifactor: 403 }), nu: NU });
  assert.equal(r.status, "beperkt");
  assert.deepEqual(r.ontbreekt, ["Multifactor-registratie"]);
  assert.match(r.melding, /rollen/);
  assert.deepEqual(r.proeven.find((p) => p.naam === "multifactor"), { naam: "multifactor", onderdeel: "Multifactor-registratie", ok: false, fout: "403" });
});

test("controleer: geen token voor de klant-tenant met werkende az-login is geen-toegang", async () => {
  const r = await controleer(TENANT, { haalToken: zonderToken, azIngelogd: () => true, fetch: nepFetch(), nu: NU });
  assert.equal(r.status, "geen-toegang");
  assert.match(r.melding, /goedgekeurd/);
  assert.equal(r.proeven.length, 0);
});

test("controleer: zonder az-login is het niet-gecontroleerd", async () => {
  const r = await controleer(TENANT, { haalToken: zonderToken, azIngelogd: () => false, fetch: nepFetch(), nu: NU });
  assert.equal(r.status, "niet-gecontroleerd");
  assert.match(r.melding, /az login/);
});

test("controleer: overal 403 met een token is geen-rechten, met melding over het eigen account", async () => {
  const alles = Object.fromEntries(PROEVEN.map((p) => [p.naam, 403]));
  const r = await controleer(TENANT, { haalToken: metToken, fetch: nepFetch(alles), nu: NU });
  assert.equal(r.status, "geen-rechten");
  assert.match(r.melding, /account/);
});

test("controleer: netwerkfout telt als niet gelukt", async () => {
  const fetch = async () => { throw new Error("weg"); };
  const r = await controleer(TENANT, { haalToken: metToken, fetch, nu: NU });
  assert.equal(r.status, "geen-rechten");
  assert.equal(r.proeven[0].fout, "netwerk");
});

test("hoofd: zonder --tenant code 1", async () => {
  const { code, uitvoer } = await hoofd([]);
  assert.equal(code, 1);
  assert.equal(JSON.parse(uitvoer).ok, false);
});

test("hoofd: domein zonder tenant geeft geen-tenant met code 0", async () => {
  const { code, uitvoer } = await hoofd(["--tenant", "voorbeeld.nl"], { lookupDomein: async () => ({ tenantId: null }), nu: NU });
  assert.equal(code, 0);
  const r = JSON.parse(uitvoer);
  assert.equal(r.status, "geen-tenant");
  assert.equal(r.domein, "voorbeeld.nl");
  assert.equal(r.gecontroleerd, "2026-11-26");
});

test("hoofd: domein wordt opgelost en gecontroleerd; het token komt nooit in de uitvoer", async () => {
  const { code, uitvoer } = await hoofd(["--tenant", "voorbeeld.nl"], {
    lookupDomein: async () => ({ tenantId: TENANT }),
    haalToken: () => "geheim-token-123",
    fetch: nepFetch(),
    nu: NU,
  });
  assert.equal(code, 0);
  const r = JSON.parse(uitvoer);
  assert.equal(r.ok, true);
  assert.equal(r.status, "actief");
  assert.equal(r.domein, "voorbeeld.nl");
  assert.ok(!uitvoer.includes("geheim-token-123"));
});
