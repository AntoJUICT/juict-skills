import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GRAPH_CALLS, SKU_NAMEN, haalToken, haalRuw, vatSamen, hoofd } from "./m365-lookup.mjs";

const ruw = () => JSON.parse(readFileSync(new URL("./fixtures/m365-raw.voorbeeld.json", import.meta.url), "utf8"));
const NU = new Date("2026-11-04T10:00:00Z");
const TENANT = "11111111-2222-3333-4444-555555555555";

test("GRAPH_CALLS bevat de verwachte calls", () => {
  const namen = GRAPH_CALLS.map((c) => c.naam);
  for (const n of ["organization", "domains", "subscribedSkus", "users", "signins", "mfa", "groups", "devices", "conditionalAccess", "directoryRoles"]) {
    assert.ok(namen.includes(n), n);
  }
  assert.ok(GRAPH_CALLS.find((c) => c.naam === "users").url.includes("$top=999"));
  assert.ok(GRAPH_CALLS.find((c) => c.naam === "signins").url.startsWith("beta/"));
  assert.equal(SKU_NAMEN.SPB, "Microsoft 365 Business Premium");
});

test("vatSamen: licenties alleen Business Premium, gratis SKU telt niet", () => {
  const s = vatSamen(ruw(), NU);
  assert.deepEqual(s.licenties, [{ sku: "SPB", naam: "Microsoft 365 Business Premium", totaal: 3, inGebruik: 3 }]);
  assert.equal(s.organisatie, "Voorbeeld Techniek B.V.");
  assert.deepEqual(s.domeinen[0], { naam: "voorbeeldtechniek.nl", standaard: true });
});

test("vatSamen: gebruikers met datum, mfa en licenties", () => {
  const s = vatSamen(ruw(), NU);
  assert.equal(s.gebruikers.length, 4);
  const anna = s.gebruikers.find((g) => g.upn.startsWith("anna"));
  assert.equal(anna.laatsteAanmelding, "30-10-2026");
  assert.equal(anna.mfa, true);
  assert.deepEqual(anna.licenties, ["Microsoft 365 Business Premium"]);
  assert.equal(s.gebruikers.find((g) => g.upn.startsWith("bram")).mfa, false);
  assert.equal(s.gebruikers.find((g) => g.upn.startsWith("carla")).laatsteAanmelding, null);
  const oud = s.gebruikers.find((g) => g.upn.startsWith("oud"));
  assert.equal(oud.actief, false);
  assert.equal(oud.mfa, null);
});

test("vatSamen: apparaten, CA en beheerders", () => {
  const s = vatSamen(ruw(), NU);
  assert.deepEqual(s.apparaten, { totaal: 3, entraJoined: 2, compliant: 1, verouderd: 2 });
  assert.deepEqual(s.conditionalAccess[0], { naam: "MFA voor alle gebruikers", staat: "enabled" });
  assert.deepEqual(s.beheerders[0], { rol: "Global Administrator", leden: ["Anna Voorbeeld"] });
  assert.deepEqual(s.nietOpgehaald, []);
});

test("vatSamen: fout per call komt in nietOpgehaald", () => {
  const r = ruw();
  r.managedDevices = { fout: "400" };
  r.mfa = { fout: "403" };
  const s = vatSamen(r, NU);
  assert.ok(s.nietOpgehaald.includes("managedDevices"));
  assert.ok(s.nietOpgehaald.includes("mfa"));
  assert.equal(s.gebruikers[0].mfa, null);
});

test("haalToken roept az aan zonder shell en geeft token terug", () => {
  let aanroep;
  const t = haalToken(TENANT, (cmd, args) => { aanroep = [cmd, args]; return "tok\r\n"; });
  assert.equal(t, "tok");
  assert.equal(aanroep[0], "az");
  assert.ok(Array.isArray(aanroep[1]));
  assert.equal(aanroep[1][aanroep[1].indexOf("--tenant") + 1], TENANT);
});

test("hoofd: token-fout geeft ok:false en code 2 zonder foutdetails", async () => {
  const res = await hoofd(["--tenant", TENANT], {
    exec: () => { throw new Error("az faalde met geheim-xyz"); },
  });
  assert.equal(res.code, 2);
  assert.deepEqual(JSON.parse(res.uitvoer), { ok: false, reden: "Geen GDAP-toegang of az-login voor deze tenant" });
  assert.ok(!res.uitvoer.includes("xyz"));
});

test("hoofd: domein wordt via lookupDomein opgelost", async () => {
  let gebruikteTenant;
  const r = ruw();
  const res = await hoofd(["--tenant", "voorbeeldtechniek.nl"], {
    lookupDomein: async () => ({ tenantId: TENANT }),
    exec: (cmd, args) => { gebruikteTenant = args[args.indexOf("--tenant") + 1]; return "tok"; },
    fetch: async (url) => {
      const pad = url.replace("https://graph.microsoft.com/", "");
      const naam = GRAPH_CALLS.find((c) => c.url === pad)?.naam;
      return { ok: true, status: 200, json: async () => r[naam] };
    },
    nu: NU,
  });
  assert.equal(gebruikteTenant, TENANT);
  assert.equal(res.code, 0);
  assert.equal(JSON.parse(res.uitvoer).organisatie, "Voorbeeld Techniek B.V.");
});

test("haalRuw volgt @odata.nextLink over twee pagina's en vangt fouten", async () => {
  const fetch = async (url, opts) => {
    assert.equal(opts.headers.Authorization, "Bearer T");
    if (url.includes("/users")) {
      if (!url.includes("skip")) return { ok: true, status: 200, json: async () => ({ value: [{ id: 1 }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?skip=1" }) };
      return { ok: true, status: 200, json: async () => ({ value: [{ id: 2 }] }) };
    }
    if (url.includes("/devices")) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ value: [] }) };
  };
  const res = await haalRuw(TENANT, { fetch, token: "T" });
  assert.deepEqual(res.users.value, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(res.devices, { fout: "401" });
  assert.deepEqual(res.groups.value, []);
});

test("hoofd met --uit: volledige samenvatting naar het bestand, op stdout alleen tellingen en nietOpgehaald", async () => {
  const r = ruw();
  r.mfa = { fout: "403" };
  const bestanden = {};
  const res = await hoofd(["--tenant", TENANT, "--uit", "m365.json"], {
    exec: () => "tok",
    fetch: async (url) => {
      const pad = url.replace("https://graph.microsoft.com/", "");
      const naam = GRAPH_CALLS.find((c) => c.url === pad)?.naam;
      if (naam === "mfa") return { ok: false, status: 403, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => r[naam] };
    },
    schrijf: (pad, inhoud) => { bestanden[pad] = inhoud; },
    nu: NU,
  });
  assert.equal(res.code, 0);
  const vol = JSON.parse(bestanden["m365.json"]);
  assert.equal(vol.gebruikers.length, 4);
  const kort = JSON.parse(res.uitvoer);
  assert.equal(kort.ok, true);
  assert.equal(kort.uit, "m365.json");
  assert.deepEqual(kort.aantallen, { domeinen: vol.domeinen.length, licenties: 1, gebruikers: 4, apparaten: 3, conditionalAccess: vol.conditionalAccess.length, beheerrollen: vol.beheerders.length });
  assert.deepEqual(kort.nietOpgehaald, ["mfa"]);
  assert.ok(!res.uitvoer.includes("voorbeeldtechniek.nl"), "geen adressen of domeinen op stdout");
  assert.ok(!res.uitvoer.includes("Anna"), "geen namen op stdout");
});
