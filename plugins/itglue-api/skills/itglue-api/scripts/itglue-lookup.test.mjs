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
  BASE_URL,
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

test("assertPathAllowed: backslash (letterlijk of gecodeerd) omzeilt de blokkade niet", () => {
  // Node's URL-parser normaliseert "\" naar "/" zodra de netwerklaag dit pad tegen
  // BASE_URL plakt, dus elk van deze varianten wordt daar alsnog /passwords/12345.
  assert.throws(() => assertPathAllowed("/passwords\\12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords\\\\12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords/\\12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords\\/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords%5C12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords%5c12345"), /Geblokkeerd/);
});

test("assertPathAllowed: backslash die niets met passwords te maken heeft mag wel", () => {
  // Een backslash in een filterwaarde van een ander endpoint raakt de password-guard niet:
  // "/configurations" bevat geen "passwords"-segment, ongeacht hoe je de backslash normaliseert.
  assert.equal(
    assertPathAllowed("/configurations?filter[name]=a\\b"),
    "/configurations?filter[name]=a\\b"
  );
});

test("assertPathAllowed: tab/newline/CR omzeilen de blokkade niet, ook niet midden in het woord", () => {
  // De WHATWG URL-parser verwijdert ASCII tab, newline en carriage return overal uit de
  // invoer (spec-gedrag), dus "/pass\twords/1" wordt voor fetch()/new URL() gewoon
  // "/passwords/1". De geparseerde controle in assertPathAllowed moet dat zelf ook zien.
  assert.throws(() => assertPathAllowed("/passwords\t/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/pass\twords/1"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords\n/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords\r/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/pass\rwords/12345"), /Geblokkeerd/);
});

test("assertPathAllowed: een control character binnen een escape omzeilt de blokkade niet", () => {
  // Een tab/newline/CR midden in "%2F" breekt de letterlijke string-match, maar de URL-parser
  // stript dat teken weg en levert alsnog "/passwords%2F12345" op. De controle moet daarom op de
  // geparseerde pathname werken, niet op de ruwe invoerstring.
  assert.throws(() => assertPathAllowed("/passwords%\t2F12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords%2\tF12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords%\n2F12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords%\r5c12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passwords%\t5C12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/pass\twords%\t2F12345"), /Geblokkeerd/);
});

test("assertPathAllowed: een pad met scheme of host wordt geweigerd", () => {
  // De netwerklaag stuurt de API-key als header mee op wat dit pad ook oplevert, dus een pad dat
  // naar een andere host wijst is key-exfiltratie. Alleen een zuiver relatief pad op onze eigen
  // API mag door.
  assert.throws(() => assertPathAllowed("https://evil.example/configurations"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("//evil.example/x"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("https://api.eu.itglue.com@evil.example/x"), /Geblokkeerd/);
  // Varianten met backslash, hoofdletters, een tab in het scheme en een leidende spatie: de parser
  // ziet die allemaal alsnog als scheme of authority.
  assert.throws(() => assertPathAllowed("\\\\evil.example\\x"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/\\evil.example/x"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("HTTPS://evil.example/x"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("ht\ttps://evil.example/x"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed(" https://evil.example/x"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("http:/\\evil.example/x"), /Geblokkeerd/);
  // Ook de eigen API als absolute URL is niet toegestaan: de guard heeft alleen een contract over
  // relatieve paden, en zo kan ITGLUE_BASE_URL de controle nooit verzwakken. Bewust een letterlijke
  // URL en niet BASE_URL, zodat deze test niet van een env var afhangt.
  assert.throws(() => assertPathAllowed("https://api.eu.itglue.com/configurations"), /Geblokkeerd/);
});

test("assertPathAllowed: onparseerbare invoer wordt geweigerd (fail closed)", () => {
  // "//" is voor new URL() een network-path reference met een lege host, en dat gooit een
  // Invalid URL-fout. Een pad dat we niet kunnen beoordelen, keuren we niet goed.
  assert.throws(() => new URL("//", BASE_URL));
  assert.throws(() => assertPathAllowed("//"), /Geblokkeerd/);
});

// Onafhankelijke oracle, bewust anders opgeschreven dan de segmentlogica in de implementatie: een
// simpele regex op de pathname die de netwerklaag straks daadwerkelijk zou gebruiken. Geen kopie van
// heeftVerbodenPasswordSegment(), zodat een fout in die ene regel zich hier niet herhaalt.
const RESOLVED_INDIVIDUEEL_PASSWORD = /(^|\/)passwords\/+[^/]/i;

function oraclePathname(pad) {
  try {
    return new URL(pad, BASE_URL).pathname;
  } catch {
    return null;
  }
}

test("oracle-sanity: de regex flagt /passwords/<id> en laat de collectie staan", () => {
  // Als de oracle stilletjes altijd false zou opleveren, was de invariant hieronder leeg. Daarom
  // eerst controleren dat de oracle zelf doet wat hij belooft.
  assert.ok(RESOLVED_INDIVIDUEEL_PASSWORD.test(oraclePathname("/passwords/12345")));
  assert.ok(RESOLVED_INDIVIDUEEL_PASSWORD.test(oraclePathname("/passwords\t/12345")));
  assert.ok(RESOLVED_INDIVIDUEEL_PASSWORD.test(oraclePathname("/passwords//12345")));
  assert.ok(!RESOLVED_INDIVIDUEEL_PASSWORD.test(oraclePathname("/passwords")));
  assert.ok(!RESOLVED_INDIVIDUEEL_PASSWORD.test(oraclePathname("/passwords/")));
  assert.ok(!RESOLVED_INDIVIDUEEL_PASSWORD.test(oraclePathname("/organizations/7/relationships/passwords")));
});

test("assertPathAllowed: elke bekende omzeiling wordt geweigerd", () => {
  // Alle paden in deze lijst zijn omzeilingspogingen uit de opeenvolgende reviewrondes. Ze moeten
  // allemaal geweigerd worden. Alleen deze richting is een harde invariant: er staat bewust GEEN
  // omgekeerde assertie in (oracle vindt iets onschuldig, dus de guard mag het toestaan), want de
  // string-normalisatielaag van de guard is met opzet strenger dan de URL-parser: %2F en %5C komen
  // ongedecodeerd uit de parser, maar een server aan de andere kant leest ze wel als scheidingsteken.
  // Legitieme paden staan daarom in hun eigen, expliciete lijst in de test hieronder.
  const pogingen = [
    // ronde 0: het basisgeval
    "/passwords/12345",
    "passwords/12345",
    "/passwords/12345?include=related",
    "/passwords?show_password=true",
    // ronde 1: dubbele slash en gecodeerde slash
    "/passwords//12345",
    "/passwords///12345",
    "/passwords%2F12345",
    "/passwords%2f12345",
    // ronde 2: backslash, letterlijk en gecodeerd
    "/passwords\\12345",
    "/passwords\\\\12345",
    "/passwords/\\12345",
    "/passwords\\/12345",
    "/passwords%5C12345",
    "/passwords%5c12345",
    // ronde 3: tab, newline en CR, ook midden in het woord
    "/passwords\t/12345",
    "/pass\twords/1",
    "/passwords\n/12345",
    "/passwords\r/12345",
    "/pass\rwords/12345",
    "/passwords?show%5Fpassword=true",
    "//",
    // ronde 4, bevinding 1: control character binnen de escape
    "/passwords%\t2F12345",
    "/passwords%2\tF12345",
    "/passwords%\n2F12345",
    "/passwords%\r5c12345",
    "/passwords%\t5C12345",
    "/pass\twords%\t2F12345",
    // ronde 4, bevinding 2: scheme of host in het pad
    "https://evil.example/configurations",
    "//evil.example/x",
    "https://api.eu.itglue.com@evil.example/x",
    "\\\\evil.example\\x",
    "/\\evil.example/x",
    "HTTPS://evil.example/x",
    "ht\ttps://evil.example/x",
    " https://evil.example/x",
    "http:/\\evil.example/x",
    // eigen extra pogingen van deze ronde
    "/PASSWORDS/12345",
    "/./passwords/12345",
    "/configurations/../passwords/12345",
    "/organizations/7/relationships/passwords/12345",
    "/passwords/12345#x",
    "/passwords%2F%2F12345",
    // Dot-segmenten: de parser rekent die weg, dus de oracle-pathname is hier onschuldig. De guard
    // weigert ze toch, want een pad dat in zijn ruwe vorm de individuele password-resource aanspreekt
    // is nooit legitiem.
    "/passwords/../configurations",
    "/passwords/%2e%2e/configurations",
  ];

  for (const pad of pogingen) {
    const pathname = oraclePathname(pad);
    const oracleFlagt = pathname !== null && RESOLVED_INDIVIDUEEL_PASSWORD.test(pathname);
    assert.throws(
      () => assertPathAllowed(pad),
      /Geblokkeerd/,
      oracleFlagt
        ? `de oracle resolved ${JSON.stringify(pad)} naar ${JSON.stringify(pathname)}, dus de guard MOET blokkeren`
        : `bekende omzeiling ${JSON.stringify(pad)} moet geblokkeerd blijven (oracle-pathname ${JSON.stringify(pathname)})`
    );
  }
});

test("assertPathAllowed: legitieme paden worden toegestaan en byte-identiek teruggegeven", () => {
  // Expliciete lijst in plaats van een omgekeerde assertie op de oracle: dit zijn de paden die de
  // netwerklaag echt gebruikt, en die moeten onveranderd terugkomen zodat de URL er 1-op-1 mee
  // gebouwd kan worden. Een pad zonder leidende slash hoort daar ook bij.
  const legitiem = [
    "/organizations/7/relationships/passwords",
    "/passwords",
    "/passwords/",
    "/passwords?filter[organization_id]=7",
    "/configurations?filter[name]=100%",
    "/configurations?page[size]=50",
    "/flexible_assets?filter[organization_id]=7",
    "/organizations?filter[name]=JUICT B.V.",
    "/password_categories",
    "configurations?page[size]=50",
    "/passwords?page[size]=50&page[number]=2",
  ];

  for (const pad of legitiem) {
    assert.equal(
      assertPathAllowed(pad),
      pad,
      `legitiem pad ${JSON.stringify(pad)} moet toegestaan zijn en byte-identiek terugkomen`
    );
  }
});

test("assertPathAllowed: een losse % in de query gooit geen decodeerfout", () => {
  // Dit pad gaat ook door new URL() (laag 2 van de controle); geverifieerd dat een ongepaarde
  // "%" daar geen fout oplevert, dus dit moet gewoon toegestaan worden, niet via fail-closed.
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
