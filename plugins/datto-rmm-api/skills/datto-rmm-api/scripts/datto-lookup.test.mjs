// Gedragstests voor de pure functies van datto-lookup.mjs.
// Draaien: node --test "plugins/datto-rmm-api/skills/datto-rmm-api/scripts/*.test.mjs"
// (met quotes: een kale mapnaam geeft op Windows MODULE_NOT_FOUND).
//
// Deze tests doen geen netwerkcalls en raken de Key Vault niet: het importeren van de module
// bouwt geen client op, want getConfig() wordt pas bij het eerste request aangeroepen.

import test from "node:test";
import assert from "node:assert/strict";

import {
  alertSamenvatting,
  assertPathAllowed,
  assertSameOrigin,
  buildQuickJobBody,
  buildUdfBody,
  datum,
  formatTabel,
  GEBLOKKEERD_HOST,
  GEBLOKKEERD_RESET,
  GEBLOKKEERD_TEKENS,
  kiesCollectie,
  parseArgv,
  parseVars,
  redactSecrets,
} from "./datto-lookup.mjs";

// ---------------------------------------------------------------------------
// Padguard: resetApiKeys
// ---------------------------------------------------------------------------

test("resetApiKeys wordt geweigerd, ook in varianten", () => {
  const varianten = [
    "v2/user/resetApiKeys",
    "/v2/user/resetApiKeys",
    "v2/USER/RESETAPIKEYS",
    "v2/user/resetApiKeys.json",
    "v2//user//resetApiKeys",
    "v2/user/resetApiKeys?x=1",
    "v2/user\\resetApiKeys",
    "v2/user%2FresetApiKeys",
  ];
  for (const pad of varianten) {
    assert.throws(() => assertPathAllowed(pad), /resetApiKeys/, `niet geweigerd: ${pad}`);
  }
});

test("een pad dat toevallig het woord user bevat blijft toegestaan", () => {
  assert.equal(assertPathAllowed("v2/account/users"), "v2/account/users");
  assert.equal(assertPathAllowed("v2/user"), "v2/user");
});

// ---------------------------------------------------------------------------
// Padguard: hosts en tekens
// ---------------------------------------------------------------------------

test("absolute URL's worden geweigerd, ook naar de eigen host", () => {
  for (const pad of [
    "https://evil.example/v2/account",
    "http://merlot-api.centrastage.net/api/v2/account",
    "//evil.example/v2/account",
    "\\\\evil.example/v2/account",
  ]) {
    assert.throws(() => assertPathAllowed(pad), new RegExp(GEBLOKKEERD_HOST.slice(0, 40)));
  }
});

test("een scheme verstopt achter een tab wordt alsnog gezien", () => {
  assert.throws(() => assertPathAllowed("ht\ttps://evil.example/x"), /Geblokkeerd/);
});

test("percent-escapes in het pad worden geweigerd", () => {
  // %77 decodeert bij een server naar "w": /v2/user/reset%41piKeys zou anders langs de guard glippen.
  assert.throws(() => assertPathAllowed("v2/us%65r/resetApiKeys"), new RegExp(GEBLOKKEERD_TEKENS.slice(0, 40)));
});

test("queryparameters mogen tekens bevatten die in het pad verboden zijn", () => {
  const pad = "v2/account/devices?hostname=JUICT WS&deviceType=Desktop";
  assert.equal(assertPathAllowed(pad), pad);
});

test("het goedgekeurde pad komt byte-identiek terug", () => {
  const pad = "v2/site/abc-123/devices?max=250";
  assert.equal(assertPathAllowed(pad), pad);
});

// ---------------------------------------------------------------------------
// Paginatie-origin
// ---------------------------------------------------------------------------

test("nextPageUrl op de eigen host wordt gevolgd", () => {
  const url = "https://merlot-api.centrastage.net/api/v2/account/sites?max=2&page=1";
  assert.equal(assertSameOrigin(url, "https://merlot-api.centrastage.net"), url);
});

test("nextPageUrl naar een andere host wordt geweigerd", () => {
  assert.throws(
    () => assertSameOrigin("https://evil.example/api/v2/account/sites", "https://merlot-api.centrastage.net"),
    /wijst naar https:\/\/evil.example/,
  );
});

test("een onparseerbare nextPageUrl wordt geweigerd in plaats van genegeerd", () => {
  assert.throws(() => assertSameOrigin("niet-een-url", "https://merlot-api.centrastage.net"), /geen geldige URL/);
});

// ---------------------------------------------------------------------------
// Redactie
// ---------------------------------------------------------------------------

test("bekende geheimen verdwijnen uit de uitvoer", () => {
  const key = "0123456789abcdef0123456789abcdef";
  const tekst = `Fout bij username=${key} op de API`;
  const uit = redactSecrets(tekst, [key]);
  assert.ok(!uit.includes(key));
  assert.ok(uit.includes("[REDACTED]"));
});

test("een access_token in een geneste body wordt geredigeerd zonder dat we hem kennen", () => {
  const body = '{"access_token":"eyJhbGciOiJIUzI1NiJ9.abc","token_type":"bearer"}';
  const uit = redactSecrets(body, []);
  assert.ok(!uit.includes("eyJhbGciOiJIUzI1NiJ9"));
  assert.ok(uit.includes('"access_token":"[REDACTED]"'));
});

test("een Bearer-header in een foutmelding wordt geredigeerd", () => {
  const uit = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", []);
  assert.ok(uit.includes("Bearer [REDACTED]"));
});

test("een te korte waarde wordt niet vervangen, anders sloopt redactie gewone tekst", () => {
  assert.equal(redactSecrets("de site heet abc", ["abc"]), "de site heet abc");
});

// ---------------------------------------------------------------------------
// Bodies voor schrijfacties
// ---------------------------------------------------------------------------

test("quick job body krijgt de vorm die de API verwacht", () => {
  const body = buildQuickJobBody("Herstart spooler", "comp-uid-1", ["Force=true", "Wachttijd=30"]);
  assert.deepEqual(body, {
    jobName: "Herstart spooler",
    jobComponent: {
      componentUid: "comp-uid-1",
      variables: [
        { name: "Force", value: "true" },
        { name: "Wachttijd", value: "30" },
      ],
    },
  });
});

test("een quick job zonder variabelen laat het variables-veld weg", () => {
  const body = buildQuickJobBody("Reboot", "comp-uid-2");
  assert.deepEqual(body.jobComponent, { componentUid: "comp-uid-2" });
});

test("een quick job zonder naam of component wordt geweigerd", () => {
  assert.throws(() => buildQuickJobBody("", "comp"), /jobName/);
  assert.throws(() => buildQuickJobBody("naam", ""), /componentUid/);
});

test("een variabelewaarde met een isgelijkteken blijft heel", () => {
  assert.deepEqual(parseVars(["Query=a=b"]), [{ name: "Query", value: "a=b" }]);
});

test("een variabele zonder isgelijkteken wordt geweigerd", () => {
  assert.throws(() => parseVars(["kaputt"]), /naam=waarde/);
});

test("UDF-body accepteert udf1 tot en met udf30 en normaliseert de casing", () => {
  assert.deepEqual(buildUdfBody(["UDF3=hallo", "udf30=x"]), { udf3: "hallo", udf30: "x" });
});

test("een UDF buiten het bereik wordt geweigerd", () => {
  assert.throws(() => buildUdfBody(["udf31=x"]), /geldig UDF-veld/);
  assert.throws(() => buildUdfBody(["udf0=x"]), /geldig UDF-veld/);
  assert.throws(() => buildUdfBody(["naam=x"]), /geldig UDF-veld/);
});

test("een lege UDF-opdracht wordt geweigerd in plaats van een lege POST te sturen", () => {
  assert.throws(() => buildUdfBody([]), /minstens een|minstens één/);
});

test("een lege waarde is toegestaan: zo maak je een UDF juist leeg", () => {
  assert.deepEqual(buildUdfBody(["udf5="]), { udf5: "" });
});

// ---------------------------------------------------------------------------
// Responsverwerking
// ---------------------------------------------------------------------------

test("kiesCollectie vindt de array ongeacht hoe die heet", () => {
  assert.deepEqual(kiesCollectie({ pageDetails: {}, sites: [1, 2] }), [1, 2]);
  assert.deepEqual(kiesCollectie({ pageDetails: {}, devices: [3] }), [3]);
  assert.deepEqual(kiesCollectie({ pageDetails: {} }), []);
  assert.deepEqual(kiesCollectie(null), []);
});

test("alertSamenvatting haalt type en melding uit alertContext", () => {
  const alert = {
    alertContext: { "@class": "comp_script_ctx", samples: { Alert: "Command  has\nfailed" } },
  };
  assert.deepEqual(alertSamenvatting(alert), { type: "comp_script", melding: "Command has failed" });
});

test("alertSamenvatting valt netjes terug als de context ontbreekt", () => {
  assert.deepEqual(alertSamenvatting({}), { type: "", melding: "" });
});

test("datum zet Datto's epoch-millis om naar een leesbare stempel", () => {
  assert.equal(datum(1787643495000), new Date(1787643495000).toISOString().slice(0, 16).replace("T", " "));
  assert.equal(datum(null), "");
});

test("datum leest een stempel in seconden ook goed, want activity-logs leveren die vorm", () => {
  // Alerts geven milliseconden, activity-logs seconden met decimalen. Zonder onderscheid zou
  // deze waarde in 1970 landen en dat valt in een tabel nauwelijks op.
  const inSeconden = 1787645215.44;
  const inMillis = 1787645215440;
  assert.equal(datum(inSeconden), datum(inMillis));
  assert.ok(datum(inSeconden).startsWith("2026-"), `onverwachte datum: ${datum(inSeconden)}`);
});

test("datum laat een ISO-string met rust", () => {
  assert.equal(datum("2026-08-25T07:26:00Z"), "2026-08-25 07:26");
});

// ---------------------------------------------------------------------------
// CLI-parsing
// ---------------------------------------------------------------------------

test("vlaggen en positionele argumenten worden gescheiden", () => {
  const { vlaggen, positioneel } = parseArgv([
    "quickjob",
    "dev-uid",
    "comp-uid",
    "Mijn job",
    "--var",
    "A=1",
    "--var",
    "B=2",
    "--confirm",
  ]);
  assert.deepEqual(positioneel, ["quickjob", "dev-uid", "comp-uid", "Mijn job"]);
  assert.equal(vlaggen.confirm, true);
  assert.deepEqual(vlaggen.vars, ["A=1", "B=2"]);
});

test("confirm staat standaard uit: een schrijfactie is een dry-run tenzij je het zegt", () => {
  assert.equal(parseArgv(["udf", "dev", "udf1=x"]).vlaggen.confirm, false);
});

test("--max leest de volgende waarde als getal", () => {
  assert.equal(parseArgv(["sites", "--max", "50"]).vlaggen.max, 50);
});

// ---------------------------------------------------------------------------
// Presentatie
// ---------------------------------------------------------------------------

test("formatTabel meldt expliciet dat er niets is in plaats van een lege tabel", () => {
  assert.equal(formatTabel([], [{ kop: "A", sleutel: "a", breedte: 5 }]), "(geen resultaten)");
});

test("formatTabel kort te lange waarden af zodat kolommen niet uitlopen", () => {
  const uit = formatTabel([{ a: "abcdefghij" }], [{ kop: "A", sleutel: "a", breedte: 5 }]);
  assert.ok(uit.includes("abcd~"));
});
