import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
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
// 2. Gedragscontrole. Het guard-blok uit de .ts is zelfstandige code zonder imports. Node 22.18+
//    en 24 strippen types zelf, dus we schrijven dat blok naar een tijdelijk .ts-bestand en
//    voeren de echte aanvalsvectoren uit tegen de echte functie. Op oudere Node valt dit stuk
//    weg als skip; de spiegelcontrole blijft dan overeind.

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
  let guard;
  try {
    writeFileSync(tijdelijk, blok, "utf-8");
    guard = await import(pathToFileURL(tijdelijk).href);
  } catch (err) {
    // Node zonder type-stripping (< 22.18) kan een .ts niet laden. Dan blijft alleen de
    // spiegelcontrole hierboven over; die dekt de aanwezigheid van alle lagen al.
    t.skip(`deze Node kan het TS-blok niet laden (${err.code ?? err.message}); spiegelcontrole dekt de rest`);
    return;
  } finally {
    rmSync(tijdelijk, { force: true });
  }

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
    "/flexible_assets?filter[flexible-asset-type-id]=12&page[number]=2",
  ];
  for (const pad of MOET_DOOR) {
    assert.equal(
      guard.assertPathAllowed(pad),
      pad,
      `${JSON.stringify(pad)} is legitiem en moet byte-identiek terugkomen`
    );
  }
});

test("client doet geen schrijfacties", () => {
  for (const methode of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.ok(
      !new RegExp(`\\b${methode}\\b`).test(clientBron),
      `${methode} hoort niet in een read-only client, ook niet als voorbeeld in commentaar`
    );
  }
  const methodes = [...clientBron.matchAll(/method:\s*"([^"]*)"/g)].map(([, m]) => m);
  assert.deepEqual([...new Set(methodes)], ["GET"], "de client mag alleen GET-requests doen");
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

test("client exporteert de afgesproken functies en legt het pad-contract vast", () => {
  for (const naam of ["assertPathAllowed", "passwordDeeplink", "buildFilterQuery", "itglueFetch", "fetchAllItGlue"]) {
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
