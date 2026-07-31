import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";

// Deze test controleert itglue-client.ts, en die wordt in deze repo niet gecompileerd: er is geen
// tsc en geen node_modules, dus de client zelf is niet te importeren (hij importeert
// ./azure-keyvault en daarmee twee @azure-packages).
//
// Een test die alleen zoekt of er ergens de tekst "passwords" in de bron staat, zegt niets: die
// blijft groen terwijl de blokkade in scherven ligt. De guard-logica hier nabouwen is net zo min
// een test, want dan toets je de kopie in de test en niet de client. Daarom twee sporen:
//
// 1. Spiegelcontrole. itglue-lookup.mjs is de maatstaf. Die blokkade is over vijf reviewrondes
//    hard geworden en staat met tests op gedrag vast (itglue-lookup.test.mjs). De TS-client is
//    daar een bewuste spiegel van, want de CLI moet zonder build draaien en de client moet los
//    naar een Next.js-project te kopieren zijn. Deze test leest daarom niet een handmatig
//    lijstje op, maar leidt uit de .mjs af welke constanten, regexes, helpers en aanroep-plekken
//    in de .ts horen te staan. Sloopt iemand een laag uit de .ts, dan mist het bijbehorende
//    fragment en wordt de test rood. Loopt de .mjs weg onder de test, dan valt de extractie zelf
//    om (de fragmentlijst wordt ook tegen de .mjs getoetst).
// 2. Gedragscontrole. Node 22.18+ en 24 strippen types zelf, dus de .ts is uit te voeren zonder
//    build. Twee keer: het guard-blok apart (zelfstandige code zonder imports) tegen de echte
//    aanvalsvectoren, en de hele module met een stub voor ./azure-keyvault en een gemockte fetch,
//    zodat ook de koppeling tussen de netwerklaag en de blokkade onder test staat. Op oudere Node
//    valt alleen dit spoor weg als skip, en uitsluitend op de twee bekende type-stripping-codes:
//    elke andere importfout is een echte fout. Zie importeerTypeScript().

const here = dirname(fileURLToPath(import.meta.url));

// Regeleindes gelijktrekken zodat de patronen hieronder niet op een \r stuklopen.
function lees(bestand) {
  return readFileSync(resolve(here, bestand), "utf-8").replace(/\r\n/g, "\n");
}

const clientBron = lees("itglue-client.ts");
const lookupBron = lees("itglue-lookup.mjs");

// Het guard-blok loopt in beide bestanden van de eerste constante tot passwordDeeplink.
const GUARD_START = "const VERBODEN_PASSWORD_PAD";
const GUARD_EIND = "export function passwordDeeplink";

function guardBlok(bron, naam) {
  const start = bron.indexOf(GUARD_START);
  const eind = bron.indexOf(GUARD_EIND);
  assert.notEqual(start, -1, `${naam}: geen "${GUARD_START}" gevonden, waar is de blokkade?`);
  assert.ok(eind > start, `${naam}: "${GUARD_EIND}" hoort na de blokkade te komen`);
  return bron.slice(start, eind);
}

// Commentaar eruit: een regex die alleen in een comment staat is geen implementatie. Alle comments
// in beide bestanden staan op een eigen regel, dus regel-voor-regel filteren is genoeg en veiliger
// dan een tokenizer die over "https://" struikelt.
function zonderCommentaar(code) {
  return code
    .split("\n")
    .filter((regel) => !/^\s*(\/\/|\*|\/\*)/.test(regel))
    .join("\n");
}

// Witruimte platslaan zodat indentatie en regelafbrekingen niet meetellen bij het vergelijken.
function plat(code) {
  return code.replace(/\s+/g, " ");
}

const lookupGuard = zonderCommentaar(guardBlok(lookupBron, "itglue-lookup.mjs"));
const clientGuard = zonderCommentaar(guardBlok(clientBron, "itglue-client.ts"));
const lookupPlat = plat(lookupGuard);
const clientPlat = plat(clientGuard);

function telVoorkomens(code, naam) {
  return (code.match(new RegExp(`\\b${naam}\\b`, "g")) ?? []).length;
}

// Knipt de tekst van een functie uit de bron: van de kopregel tot de volgende top-level export.
// Genoeg om te toetsen wat er in de body gebeurt en in welke volgorde.
function functieBlok(bron, kop) {
  const start = bron.indexOf(kop);
  assert.notEqual(start, -1, `itglue-client.ts mist "${kop}"`);
  const volgende = bron.indexOf("\nexport ", start + kop.length);
  return bron.slice(start, volgende === -1 ? bron.length : volgende);
}

// Alleen deze twee codes betekenen "deze Node kan geen TypeScript laden". Al het andere hoort de
// test rood te maken. Zonder die scheiding wordt elke reden waarom de code niet laadt (een
// ReferenceError omdat het geextraheerde guard-blok niet zelfstandig is, een verkeerd
// importpad) stil een skip, en dan verdwijnt de gedragscontrole uit een groene CI-run.
const TYPE_STRIPPING_FOUTEN = new Set([
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING",
]);

async function importeerTypeScript(pad) {
  try {
    return { mod: await import(pathToFileURL(pad).href) };
  } catch (err) {
    if (TYPE_STRIPPING_FOUTEN.has(err?.code)) {
      return { skipReden: `deze Node kan een .ts niet laden (${err.code})` };
    }
    throw err;
  }
}

test("guard: elke constante uit de .mjs-blokkade staat identiek in de client", () => {
  const CONSTANTE = /^const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*?);$/gm;
  const constanten = [...lookupGuard.matchAll(CONSTANTE)].map(([, naam, expressie]) => ({
    naam,
    expressie,
  }));
  // Ondergrens: de blokkade heeft een verbodsregex, vijf foutmeldingen, de vaste controle-basis
  // plus origin, de scheme- en authority-check en de tekens-whitelist. Zakt dit aantal, dan is er
  // een laag uit de .mjs verdwenen of pakt de extractie niet meer wat hij hoort te pakken.
  assert.ok(
    constanten.length >= 11,
    `verwachtte minstens 11 guard-constanten in itglue-lookup.mjs, vond ${constanten.length}`
  );
  for (const { naam, expressie } of constanten) {
    assert.ok(
      clientPlat.includes(plat(`${naam} = ${expressie}`)),
      `itglue-client.ts mist de guard-constante ${naam} (of de waarde wijkt af van itglue-lookup.mjs)`
    );
  }
});

test("guard: elke regex uit de .mjs-blokkade staat letterlijk in de client", () => {
  // Regex-literals staan hier altijd achter "=", "(" of ",". Dit haalt ook de inline regexes op
  // die niet in een constante zitten: de %2f/%5c-string-laag, het wegstrippen van tab/newline/CR
  // en de leidende controletekens, en de show_password-check op de ruwe invoer.
  const REGEX_LITERAL = /(?<=[=(,]\s*)\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+\/[a-z]*/g;
  const regexen = [...new Set(lookupGuard.match(REGEX_LITERAL) ?? [])];
  assert.ok(
    regexen.length >= 12,
    `verwachtte minstens 12 regexes in de .mjs-blokkade, vond ${regexen.length}`
  );
  for (const regex of regexen) {
    assert.ok(
      clientPlat.includes(regex),
      `itglue-client.ts mist de guard-regex ${regex} uit itglue-lookup.mjs`
    );
  }
});

test("guard: de helpers uit de .mjs worden in de client even vaak aangeroepen", () => {
  const FUNCTIE = /^function\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  const namen = [...lookupGuard.matchAll(FUNCTIE)].map(([, naam]) => naam);
  assert.ok(namen.length >= 3, `verwachtte minstens 3 guard-helpers, vond ${namen.length}`);
  for (const naam of namen) {
    const inLookup = telVoorkomens(lookupGuard, naam);
    const inClient = telVoorkomens(clientGuard, naam);
    // Definitie plus elke aanroep. Haalt iemand een aanroep-plek weg (bijvoorbeeld de tweede
    // segmentcontrole op de ruwe invoer), dan zakt de telling en valt dit om.
    assert.ok(
      inClient >= inLookup,
      `itglue-client.ts gebruikt ${naam} ${inClient}x, itglue-lookup.mjs ${inLookup}x: er mist een aanroep`
    );
  }
});

test("guard: alle lagen zitten op hun plek in beide implementaties", () => {
  // Aanroep-plekken die geen constante of regex zijn. Elk fragment wordt tegen beide bestanden
  // getoetst: zo kan de lijst niet stilletjes verouderen als de .mjs verandert.
  const LAGEN = {
    "parseren tegen de vaste controle-basis": "new URL(p, CONTROLE_BASIS)",
    "fail closed als het parsen gooit": "catch { throw new Error(GEBLOKKEERD_ONPARSEERBAAR); }",
    "host-controle op scheme en authority":
      "HEEFT_SCHEME.test(invoer) || BEGINT_MET_AUTHORITY.test(invoer)",
    "origin-vergelijking tegen de vaste basis": "url.origin !== CONTROLE_ORIGIN",
    "string-laag op de geparseerde pathname": "padVoorControle(url.pathname)",
    "gezaghebbende segmentcontrole": "heeftVerbodenPasswordSegment(url.pathname)",
    "whitelist op de padtekens": "!TOEGESTANE_PADTEKENS.test(url.pathname)",
    "show_password op de gedecodeerde parameternamen": "url.searchParams.keys()",
    "pad komt byte-identiek terug": "return p;",
  };
  for (const [laag, fragment] of Object.entries(LAGEN)) {
    assert.ok(lookupPlat.includes(fragment), `itglue-lookup.mjs mist de laag "${laag}": ${fragment}`);
    assert.ok(clientPlat.includes(fragment), `itglue-client.ts mist de laag "${laag}": ${fragment}`);
  }
});

test("guard: de blokkade hangt niet van ITGLUE_BASE_URL af", () => {
  // De env var mag de controle niet kunnen verzwakken, dus de basis-URL komt in het guard-blok
  // van geen van beide bestanden voor. De netwerklaag plakt BASE_URL er later zelf voor.
  for (const [naam, blok] of [
    ["itglue-lookup.mjs", lookupGuard],
    ["itglue-client.ts", clientGuard],
  ]) {
    assert.ok(
      !/\bBASE_URL\b/.test(blok),
      `${naam}: de blokkade verwijst naar BASE_URL en is daarmee via de env var te beinvloeden`
    );
    assert.ok(
      !/ITGLUE_BASE_URL/.test(blok),
      `${naam}: de blokkade leest ITGLUE_BASE_URL, dat hoort buiten de controle te blijven`
    );
  }
});

test("guard: het blok voert de aanvalsvectoren uit taak 2 daadwerkelijk uit", async (t) => {
  // Zelfde tekens als in de bypass-pogingen, maar niet als escape in de bronregel: een losse tab
  // of backslash midden in een teststring is bij een volgende edit zo weg.
  const TAB = String.fromCodePoint(9);
  const BACKSLASH = String.fromCodePoint(92);

  const blok = guardBlok(clientBron, "itglue-client.ts");
  const tijdelijk = join(tmpdir(), `itglue-guard-${process.pid}-${Date.now()}.ts`);
  // Het wegschrijven staat buiten de try: dat hoort niet tot het skip-scenario, en een fout daarin
  // is een echte fout.
  writeFileSync(tijdelijk, blok, "utf-8");
  let uitkomst;
  try {
    uitkomst = await importeerTypeScript(tijdelijk);
  } finally {
    rmSync(tijdelijk, { force: true });
  }
  if (uitkomst.skipReden) {
    // Alleen oude Node. De spiegelcontrole hierboven dekt de aanwezigheid van alle lagen dan nog.
    t.skip(`${uitkomst.skipReden}; spiegelcontrole dekt de rest`);
    return;
  }
  const guard = uitkomst.mod;

  assert.equal(typeof guard.assertPathAllowed, "function", "assertPathAllowed wordt niet geexporteerd");

  const MOET_WEIGEREN = [
    "/passwords/12345",
    "/passwords//12345",
    "/passwords%2F12345",
    "/passwords%2f12345",
    `/passwords${BACKSLASH}12345`,
    `/passwords%5C12345`,
    `/passwords${TAB}/12345`,
    `/passwords%${TAB}2F12345`,
    "/pass%77ords/12345",
    "/PASSWORDS/12345",
    "/passwords/../configurations",
    "/organizations/7/relationships/passwords/12345",
    // Punt-suffix: een server die ".json" als format leest routeert dit naar dezelfde individuele
    // resource, terwijl een vergelijking op het hele segment "passwords.json" anders vindt.
    "/passwords.json/12345",
    "/passwords.JSON/12345",
    "/passwords./12345",
    "/organizations/7/relationships/passwords.json/12345",
    "https://api.eu.itglue.com/passwords/12345",
    "https://api.eu.itglue.com/organizations",
    "https://evil.example/organizations",
    "//evil.example/organizations",
    `/${BACKSLASH}evil.example/organizations`,
    `ht${TAB}tps://evil.example/organizations`,
    "/passwords?show_password=true",
    "/passwords?show%5Fpassword=true",
  ];
  for (const pad of MOET_WEIGEREN) {
    assert.throws(
      () => guard.assertPathAllowed(pad),
      /Geblokkeerd/,
      `de blokkade liet ${JSON.stringify(pad)} door`
    );
  }

  const MOET_DOOR = [
    "/organizations",
    "/organizations?filter[name]=JUICT B.V.",
    "/passwords",
    "/passwords/",
    "/passwords?filter[organization_id]=7",
    "configurations?page[size]=50",
    "/organizations/7/relationships/passwords",
    "/flexible_assets?filter[flexible_asset_type_id]=12&page[number]=2",
  ];
  for (const pad of MOET_DOOR) {
    assert.equal(
      guard.assertPathAllowed(pad),
      pad,
      `${JSON.stringify(pad)} is legitiem en moet byte-identiek terugkomen`
    );
  }
});

// De blokkade kan perfect zijn en toch nergens aan hangen. Deze twee controles staan er los van de
// gedragscontrole hieronder, zodat de koppeling ook gedekt blijft als die op oude Node overslaat.
test("itglueFetch roept de blokkade aan voordat er iets over de lijn gaat", () => {
  const body = functieBlok(clientBron, "export async function itglueFetch");
  assert.ok(
    body.includes("assertPathAllowed(path);"),
    "itglueFetch roept assertPathAllowed(path) niet aan: de blokkade hangt dan aan niets"
  );
  const guardOp = body.indexOf("assertPathAllowed(path);");
  const fetchOp = body.indexOf("fetch(url");
  assert.ok(fetchOp !== -1, "itglueFetch doet nergens een fetch(url, ...)");
  assert.ok(guardOp < fetchOp, "de blokkade hoort voor het request te staan, niet erna");
});

test("fetchAllItGlue heeft een rem op het aantal pagina's", () => {
  const body = functieBlok(clientBron, "export async function fetchAllItGlue");
  assert.match(body, /pageNumber > maxPages/, "de maxPages-rem is verdwenen: dit kan eindeloos doorlopen");
  assert.match(body, /throw new Error\(/, "de maxPages-rem moet gooien, niet stil stoppen");
});

test("netwerklaag: verboden pad doet geen enkel request en maxPages remt echt", async (t) => {
  // De hele module uitvoeren kan alleen met een stub voor ./azure-keyvault (die trekt twee
  // @azure-packages binnen die deze repo niet heeft) en met een expliciete .ts-extensie op de
  // import, want Node's type-stripping doet geen extensieloze resolutie. Vindt de test die import
  // niet meer, dan faalt hij hier: stil overslaan is geen optie.
  const werkmap = mkdtempSync(join(tmpdir(), "itglue-client-"));
  const echteFetch = globalThis.fetch;
  const echteVault = process.env.AZURE_KEYVAULT_URL;
  const echteKey = process.env.ITGLUE_API_KEY;
  try {
    writeFileSync(
      join(werkmap, "azure-keyvault.ts"),
      "export async function getSecret(naam: string): Promise<string> {\n  return `stub-${naam}`;\n}\n",
      "utf-8"
    );
    const herschreven = clientBron.replace('from "./azure-keyvault"', 'from "./azure-keyvault.ts"');
    assert.notEqual(herschreven, clientBron, 'de import van "./azure-keyvault" staat niet meer in de client');
    const clientPad = join(werkmap, "itglue-client.ts");
    writeFileSync(clientPad, herschreven, "utf-8");

    const uitkomst = await importeerTypeScript(clientPad);
    if (uitkomst.skipReden) {
      t.skip(`${uitkomst.skipReden}; de brontekst-controles hierboven dekken de koppeling`);
      return;
    }
    const client = uitkomst.mod;

    // Noodrem in de mock: zonder de maxPages-controle zou fetchAllItGlue eindeloos doorlopen en
    // zou deze test blijven hangen in plaats van rood worden.
    const NOODREM = 25;
    let calls = [];
    let inits = [];
    let volgendePagina = null;
    // Op "html" geeft de mock een niet-JSON body terug op status 200: het gateway-geval.
    let bodySoort = "json";
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      inits.push(init);
      if (calls.length > NOODREM) {
        throw new Error(`noodrem: meer dan ${NOODREM} requests, de rem in fetchAllItGlue doet niets`);
      }
      const tekst =
        bodySoort === "html"
          ? "<html>502 Bad Gateway niet-echt-alleen-voor-deze-test</html>"
          : JSON.stringify({ data: [], meta: volgendePagina ? { "next-page": volgendePagina } : {} });
      return {
        status: 200,
        ok: true,
        headers: new Headers(),
        text: async () => tekst,
        json: async () => JSON.parse(tekst),
      };
    };
    delete process.env.AZURE_KEYVAULT_URL;
    process.env.ITGLUE_API_KEY = "niet-echt-alleen-voor-deze-test";

    await assert.rejects(
      () => client.itglueFetch("/passwords/12345"),
      /Geblokkeerd/,
      "itglueFetch hoort een verboden pad te weigeren"
    );
    assert.deepEqual(calls, [], "een verboden pad mag geen enkel request veroorzaken");

    await assert.rejects(() => client.itglueFetch("https://evil.example/organizations"), /Geblokkeerd/);
    assert.deepEqual(calls, [], "een absolute URL naar een vreemde host mag de key niet weglekken");

    // Een paar omzeilingen ook hier, via de echte netwerklaag: zo staat de blokkade niet alleen als
    // los blok onder test maar ook zoals de client hem daadwerkelijk gebruikt.
    for (const pad of ["/pass%77ords/12345", "/passwords%2F12345", "/passwords?show_password=true"]) {
      await assert.rejects(() => client.itglueFetch(pad), /Geblokkeerd/, `${pad} kwam door de netwerklaag`);
    }
    assert.deepEqual(calls, [], "geen van de omzeilingen mag een request veroorzaken");

    // Legitiem pad: wel een request, met de juiste header en zonder muterend verb.
    volgendePagina = null;
    calls = [];
    inits = [];
    await client.itglueFetch("/organizations?filter[name]=JUICT");
    assert.equal(calls.length, 1, "een legitiem pad hoort gewoon opgehaald te worden");
    assert.match(calls[0], /^https:\/\/api\.eu\.itglue\.com\/organizations\?/);

    // Timeout: zonder AbortSignal houdt een hangende IT Glue-verbinding een Next.js-route
    // onbeperkt vast. De signal moet dus echt meegaan met het request.
    assert.ok(inits[0]?.signal, "itglueFetch geeft geen AbortSignal mee: een hangend request loopt nooit af");
    assert.equal(typeof inits[0].signal.aborted, "boolean", "de signal hoort een echte AbortSignal te zijn");
    assert.equal(inits[0].signal.aborted, false, "de signal mag niet al afgebroken zijn bij het versturen");

    // Een 200 met een niet-JSON body (proxy of gateway) mag geen kale SyntaxError worden: de melding
    // hoort status en resource te noemen, en de body-tekst gaat door de redactie.
    bodySoort = "html";
    calls = [];
    await assert.rejects(
      () => client.itglueFetch("/organizations"),
      (err) => {
        assert.ok(!(err instanceof SyntaxError), "een kale SyntaxError zegt niets over status of resource");
        assert.match(err.message, /geen JSON/i);
        assert.match(err.message, /status 200/);
        assert.match(err.message, /organizations/);
        assert.match(err.message, /\[REDACTED\]/, "de key in de body hoort geredacteerd te zijn");
        assert.ok(!err.message.includes("niet-echt-alleen-voor-deze-test"));
        return true;
      }
    );
    bodySoort = "json";

    // maxPages: de mock blijft een volgende pagina beloven, dus alleen de rem stopt dit.
    volgendePagina = 2;
    calls = [];
    await assert.rejects(
      () => client.fetchAllItGlue("organizations", { maxPages: 3 }),
      /maxPages \(3\)/,
      "fetchAllItGlue hoort te stoppen zodra maxPages voorbij is"
    );
    assert.equal(calls.length, 3, `verwachtte 3 requests voor maxPages 3, kreeg ${calls.length}`);
  } finally {
    globalThis.fetch = echteFetch;
    if (echteVault === undefined) delete process.env.AZURE_KEYVAULT_URL;
    else process.env.AZURE_KEYVAULT_URL = echteVault;
    if (echteKey === undefined) delete process.env.ITGLUE_API_KEY;
    else process.env.ITGLUE_API_KEY = echteKey;
    rmSync(werkmap, { recursive: true, force: true });
  }
});

test("client doet geen schrijfacties", () => {
  // Over beide .ts-bestanden, want de constraint gaat over elke regel code, en
  // case-insensitive: 'method: "post"' is net zo goed een schrijfactie.
  const bestanden = { "itglue-client.ts": clientBron, "azure-keyvault.ts": lees("azure-keyvault.ts") };
  for (const [naam, bron] of Object.entries(bestanden)) {
    for (const methode of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.ok(
        !new RegExp(`\\b${methode}\\b`, "i").test(bron),
        `${naam}: ${methode} hoort niet in read-only code, ook niet als voorbeeld in commentaar`
      );
    }
    const methodes = [...bron.matchAll(/method:\s*"([^"]*)"/gi)].map(([, m]) => m);
    for (const m of methodes) {
      assert.equal(m, "GET", `${naam}: alleen GET is toegestaan, vond method: "${m}"`);
    }
  }
  assert.ok(
    clientBron.includes('method: "GET"'),
    "itglueFetch hoort GET expliciet mee te geven, zodat read-only in de code zichtbaar is"
  );
});

test("client haalt nooit een wachtwoordwaarde op", () => {
  assert.ok(!/show_password\s*=/.test(clientBron), "de client zet nergens show_password");
  assert.match(clientBron, /export function passwordDeeplink/, "passwordDeeplink hoort geexporteerd te zijn");
  // Wachtwoorden gaan alleen als deeplink de deur uit, dus een password-attribuut uitlezen hoort
  // hier niet voor te komen.
  assert.ok(
    !/attributes\??\.\[?"?password/i.test(clientBron),
    "de client leest een password-attribuut uit; alleen een deeplink is toegestaan"
  );
});

test("client gebruikt de juiste secretnaam, vault-fallback en headers", () => {
  assert.match(clientBron, /getSecret\("itglue-api-key"\)/);
  assert.match(clientBron, /process\.env\.AZURE_KEYVAULT_URL/);
  assert.match(clientBron, /process\.env\.ITGLUE_API_KEY/);
  assert.match(clientBron, /"x-api-key": key/);
  assert.match(clientBron, /application\/vnd\.api\+json/);
  assert.match(clientBron, /https:\/\/api\.eu\.itglue\.com/);
  assert.match(clientBron, /https:\/\/juict\.eu\.itglue\.com/);
});

test("client heeft geen hardcoded key of vault-secretwaarde", () => {
  assert.ok(!/ITG\.[A-Za-z0-9]{10,}/.test(clientBron), "lijkt een echte IT Glue key te bevatten");
  // Elke key komt uit Key Vault of uit de env var; een andere toekenning is verdacht.
  const toekenningen = [...clientBron.matchAll(/cachedKey\s*=\s*(.+?);/g)].map(([, rechts]) => rechts.trim());
  for (const rechts of toekenningen) {
    assert.ok(
      /^(null|key|uitVault)$/.test(rechts),
      `verdachte toekenning aan cachedKey: ${rechts}`
    );
  }
});

test("client parseert de body zelf, met een vangnet op een niet-JSON respons", () => {
  const body = functieBlok(clientBron, "export async function itglueFetch");
  assert.match(body, /await response\.text\(\)/, "de body hoort als tekst gelezen te worden");
  assert.match(body, /JSON\.parse\(tekst\)/, "de client hoort de tekst zelf te parsen");
  assert.match(body, /geen JSON terug/, "een niet-JSON body hoort een eigen, begrijpelijke fout te geven");
  assert.match(body, /redactKey\(String\(tekst/, "het fragment in die fout hoort geredacteerd te zijn");
});

test("client heeft een timeout per request", () => {
  const body = functieBlok(clientBron, "export async function itglueFetch");
  assert.match(body, /AbortSignal\.timeout\(timeoutMs\)/, "zonder timeout blijft een hangend request hangen");
  assert.match(clientBron, /DEFAULT_TIMEOUT_MS/);
  assert.match(clientBron, /ITGLUE_TIMEOUT_MS/, "de timeout hoort met een env var te overrulen zijn");
  // fetchAllItGlue moet de timeout doorgeven, anders geldt hij niet voor de gepagineerde calls.
  const alles = functieBlok(clientBron, "export async function fetchAllItGlue");
  assert.match(alles, /\{ timeoutMs \}/, "fetchAllItGlue geeft timeoutMs niet door aan itglueFetch");
});

test("client heeft een whitelist voor password-items, net als de CLI", () => {
  // Zonder deze functie krijgt een project dat fetchAllItGlue("passwords", ...) aanroept de ruwe
  // attributes, en leunt de belofte alleen op de padguard en op het gedrag van de API.
  const body = functieBlok(clientBron, "export function passwordTreffers");
  assert.match(body, /passwordDeeplink\(/, "een treffer hoort een deeplink te krijgen");
  // Alleen het object dat de map oplevert telt, niet de parameterlijst erboven.
  const mapBlok = body.slice(body.indexOf(".map("));
  assert.ok(mapBlok.length > 0, "passwordTreffers hoort de items te mappen naar een eigen object");
  const velden = [...mapBlok.matchAll(/^\s+([a-z][a-z-]*):/gm)].map(([, v]) => v);
  assert.deepEqual(
    [...new Set(velden)].sort(),
    ["link", "naam"],
    `passwordTreffers hoort alleen naam en link op te leveren, vond: ${velden.join(", ")}`
  );
});

test("client exporteert de afgesproken functies en legt het pad-contract vast", () => {
  for (const naam of [
    "assertPathAllowed",
    "passwordDeeplink",
    "passwordTreffers",
    "buildFilterQuery",
    "itglueFetch",
    "fetchAllItGlue",
  ]) {
    assert.match(clientBron, new RegExp(`export (async )?function ${naam}\\b`), `${naam} wordt niet geexporteerd`);
  }
  // Het contract hoort in de JSDoc te staan: alleen relatieve paden, en pagineren via page[number]
  // omdat links.next bij IT Glue een absolute URL is en dus geweigerd wordt.
  assert.match(clientBron, /alleen een relatief pad/);
  assert.match(clientBron, /links\.next/);
  assert.match(clientBron, /page\[number\]/);
  assert.match(clientBron, /buildFilterQuery\(filters, \{ pageSize, pageNumber \}\)/);
});

test("client legt de bewuste spiegeling met itglue-lookup.mjs uit", () => {
  assert.match(clientBron, /itglue-lookup\.mjs/, "de duplicatie hoort in commentaar uitgelegd te staan");
  assert.match(clientBron, /duplicatie/i);
});
