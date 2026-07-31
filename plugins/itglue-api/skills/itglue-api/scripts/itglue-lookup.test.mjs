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
  igFetch,
  fetchAllItGlue,
  resolveOrg,
  formatTabel,
  runSubcommand,
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

test("assertPathAllowed: een percent-gecodeerde letter in het pad wordt geweigerd", () => {
  // Zelfde premisse als bij de gecodeerde slash: een server die percent-decodeert voordat hij
  // routeert, decodeert "%77" net zo goed naar "w" en komt dus alsnog op /passwords/12345 uit. De
  // vaste string-replaces voor %2F en %5C kunnen dat principieel niet zien, dus dekt de
  // teken-whitelist op de geparseerde pathname dit af.
  assert.throws(() => assertPathAllowed("/pass%77ords/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/%70asswords/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/passw%6Frds/12345"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/PASSWORD%53/12345"), /Geblokkeerd/);
  // Ook de gecodeerde vorm van een heel onschuldig lijkend pad gaat eruit: geen enkel legitiem
  // IT Glue-pad heeft een percent-escape in het pad nodig, dus we hoeven hier niet te gokken.
  assert.throws(() => assertPathAllowed("/configu%72ations"), /Geblokkeerd/);
  assert.throws(() => assertPathAllowed("/pass%\t77ords/12345"), /Geblokkeerd/);
});

test("assertPathAllowed: de query valt buiten de padwhitelist", () => {
  // De whitelist loopt over url.pathname, en de parser stopt alles na de "?" in url.search. Eerst
  // dat feit zelf vastleggen, zodat duidelijk is waarom een spatie of een losse "%" in een
  // filterwaarde de whitelist niet raakt.
  assert.equal(new URL("/organizations?filter[name]=JUICT B.V.", BASE_URL).pathname, "/organizations");
  assert.equal(new URL("/configurations?filter[name]=100%", BASE_URL).pathname, "/configurations");
  // En dan het gedrag: byte-identiek terug, zonder decodeerfout.
  for (const pad of [
    "/organizations?filter[name]=JUICT B.V.",
    "/configurations?filter[name]=100%",
    "/configurations?filter[name]=a&b",
    "/configurations?filter[name]=a:b",
    "/configurations?filter[name]=100% korting",
  ]) {
    assert.equal(assertPathAllowed(pad), pad, `${JSON.stringify(pad)} moet toegestaan blijven`);
  }
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
    // ronde 5: percent-gecodeerde letters binnen het woord "passwords". De oracle vindt deze
    // onschuldig (de parser decodeert %77 niet), maar een percent-decoderende server routeert ze
    // alsnog naar /passwords/12345.
    "/pass%77ords/12345",
    "/%70asswords/12345",
    "/passw%6Frds/12345",
    "/PASSWORD%53/12345",
    "/pass%\t77ords/12345",
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

// Minimale nep-Response die genoeg lijkt op het echte object voor deze tests.
function nepRespons({ status = 200, body = {}, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (naam) => headers[naam.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("igFetch: zet de auth-header en bouwt de volledige URL", async () => {
  const gezien = [];
  const fetchImpl = async (url, init) => {
    gezien.push({ url, init });
    return nepRespons({ body: { data: [] } });
  };
  await igFetch("/organizations?page[size]=1", { key: "ITG.geheim", fetchImpl });
  assert.equal(gezien[0].url, "https://api.eu.itglue.com/organizations?page[size]=1");
  assert.equal(gezien[0].init.headers["x-api-key"], "ITG.geheim");
  assert.equal(gezien[0].init.headers["Content-Type"], "application/vnd.api+json");
});

test("igFetch: pad zonder leidende slash werkt ook", async () => {
  let gezienUrl = null;
  const fetchImpl = async (url) => {
    gezienUrl = url;
    return nepRespons({ body: { data: [] } });
  };
  await igFetch("organizations", { key: "k", fetchImpl });
  assert.equal(gezienUrl, "https://api.eu.itglue.com/organizations");
});

test("igFetch: verboden pad doet geen enkele request", async () => {
  let aangeroepen = false;
  const fetchImpl = async () => {
    aangeroepen = true;
    return nepRespons();
  };
  await assert.rejects(() => igFetch("/passwords/42", { key: "k", fetchImpl }), /Geblokkeerd/);
  assert.equal(aangeroepen, false, "er mag geen request uitgaan bij een verboden pad");
});

test("igFetch: 429 wordt opnieuw geprobeerd volgens retry-after", async () => {
  const wachttijden = [];
  let poging = 0;
  const fetchImpl = async () => {
    poging++;
    if (poging === 1) return nepRespons({ status: 429, headers: { "retry-after": "3" } });
    return nepRespons({ body: { data: [{ id: "1" }] } });
  };
  const body = await igFetch("/organizations", {
    key: "k",
    fetchImpl,
    sleepImpl: async (ms) => wachttijden.push(ms),
  });
  assert.equal(poging, 2);
  assert.deepEqual(wachttijden, [3000]);
  assert.equal(body.data[0].id, "1");
});

test("igFetch: fout bevat status en redacteert de key", async () => {
  const fetchImpl = async () =>
    nepRespons({ status: 401, body: { errors: [{ detail: "key ITG.geheim ongeldig" }] } });
  await assert.rejects(
    () => igFetch("/organizations", { key: "ITG.geheim", fetchImpl }),
    (err) => {
      assert.match(err.message, /IT Glue API fout 401/);
      assert.ok(!err.message.includes("ITG.geheim"));
      assert.match(err.message, /\[REDACTED\]/);
      return true;
    }
  );
});

test("igFetch: 429 blijft niet eeuwig doorgaan", async () => {
  let pogingen = 0;
  const fetchImpl = async () => {
    pogingen++;
    return nepRespons({ status: 429 });
  };
  await assert.rejects(
    () => igFetch("/organizations", { key: "k", fetchImpl, retries: 2, sleepImpl: async () => {} }),
    /IT Glue API fout 429/
  );
  assert.equal(pogingen, 3, "1 poging plus 2 retries");
});

test("fetchAllItGlue: loopt pagina's door tot next-page leeg is", async () => {
  const opgevraagd = [];
  const fetchImpl = async (url) => {
    opgevraagd.push(url);
    const nummer = new URL(url).searchParams.get("page[number]");
    if (nummer === "1") {
      return nepRespons({ body: { data: [{ id: "1" }], meta: { "next-page": 2 } } });
    }
    return nepRespons({ body: { data: [{ id: "2" }], meta: { "next-page": null } } });
  };
  const alles = await fetchAllItGlue("configurations", {
    key: "k",
    filters: { organization_id: 7 },
    pageSize: 1,
    fetchImpl,
  });
  assert.deepEqual(alles.map((d) => d.id), ["1", "2"]);
  assert.equal(opgevraagd.length, 2);
  assert.ok(opgevraagd[0].includes("filter%5Borganization_id%5D=7"));
});

test("fetchAllItGlue: stopt bij maxPages en meldt dat", async () => {
  const fetchImpl = async () => nepRespons({ body: { data: [{ id: "x" }], meta: { "next-page": 99 } } });
  await assert.rejects(
    () => fetchAllItGlue("configurations", { key: "k", maxPages: 3, fetchImpl }),
    /maxPages/
  );
});

const ORG_RESPONS = { data: [{ id: "7", attributes: { name: "JUICT B.V." } }], meta: { "next-page": null } };

function fakeApi(routes) {
  return async (url) => {
    const pad = url.replace("https://api.eu.itglue.com", "");
    for (const [patroon, body] of Object.entries(routes)) {
      if (pad.startsWith(patroon)) return nepRespons({ body });
    }
    return nepRespons({ status: 404, body: { errors: [{ detail: `geen route voor ${pad}` }] } });
  };
}

test("resolveOrg: vindt de organisatie op genormaliseerde naam", async () => {
  const org = await resolveOrg("juict bv", { key: "k", fetchImpl: fakeApi({ "/organizations": ORG_RESPONS }) });
  assert.equal(org.id, "7");
});

test("resolveOrg: numerieke input wordt als id gebruikt zonder zoekcall", async () => {
  const fetchImpl = async () => {
    throw new Error("er had geen request mogen uitgaan");
  };
  const org = await resolveOrg("7", { key: "k", fetchImpl });
  assert.equal(org.id, "7");
});

test("resolveOrg: geen unieke match geeft een fout met de kandidaten", async () => {
  const respons = {
    data: [
      { id: "1", attributes: { name: "Jansen Techniek" } },
      { id: "2", attributes: { name: "Jansen Bouw" } },
    ],
    meta: { "next-page": null },
  };
  await assert.rejects(
    () => resolveOrg("jansen", { key: "k", fetchImpl: fakeApi({ "/organizations": respons }) }),
    (err) => {
      assert.match(err.message, /Jansen Techniek/);
      assert.match(err.message, /Jansen Bouw/);
      return true;
    }
  );
});

test("runSubcommand: configs geeft naam, type, ip en status", async () => {
  const configs = {
    data: [
      {
        id: "100",
        attributes: {
          name: "SRV-DC01",
          "configuration-type-name": "Server",
          "primary-ip": "10.0.0.5",
          "configuration-status-name": "Active",
          "operating-system-name": "Windows Server 2022",
        },
      },
    ],
    meta: { "next-page": null },
  };
  const { soort, rijen } = await runSubcommand(["configs", "juict bv"], {
    key: "k",
    fetchImpl: fakeApi({ "/organizations": ORG_RESPONS, "/configurations": configs }),
  });
  assert.equal(soort, "configs");
  assert.equal(rijen[0].naam, "SRV-DC01");
  assert.equal(rijen[0].type, "Server");
  assert.equal(rijen[0].ip, "10.0.0.5");
});

test("runSubcommand: password-link geeft uitsluitend naam en link", async () => {
  const passwords = {
    data: [
      {
        id: "42",
        attributes: {
          name: "Firewall beheerder",
          username: "admin",
          password: "GeheimNietTonen",
          "organization-id": 7,
        },
      },
    ],
    meta: { "next-page": null },
  };
  const { soort, rijen } = await runSubcommand(["password-link", "juict bv", "firewall"], {
    key: "k",
    fetchImpl: fakeApi({ "/organizations": ORG_RESPONS, "/passwords": passwords }),
  });
  assert.equal(soort, "password-link");
  assert.deepEqual(rijen, [{ naam: "Firewall beheerder", link: "https://juict.eu.itglue.com/7/passwords/42" }]);
  assert.ok(!JSON.stringify(rijen).includes("GeheimNietTonen"));
});

test("runSubcommand: onbekend subcommando geeft een fout met de geldige opties", async () => {
  await assert.rejects(
    () => runSubcommand(["wachtwoord-ophalen", "juict"], { key: "k", fetchImpl: async () => nepRespons() }),
    /Onbekend subcommando/
  );
});

test("runSubcommand: ontbrekend argument geeft een duidelijke fout", async () => {
  await assert.rejects(() => runSubcommand(["configs"], { key: "k" }), /organisatie/i);
});

test("formatTabel: lijnt kolommen uit en zet een kop", () => {
  const uit = formatTabel([{ naam: "A", type: "Server" }, { naam: "BBBB", type: "Switch" }], ["naam", "type"]);
  const regels = uit.split("\n");
  assert.match(regels[0], /^naam\s+type$/);
  assert.equal(regels.length, 3);
});

test("formatTabel: lege invoer geeft een nette melding", () => {
  assert.match(formatTabel([], ["naam"]), /geen resultaten/i);
});

// Extra t.o.v. de brief: assets en docs gebruiken resources (flexible_assets, documents) die nog
// niet tegen de echte API geverifieerd zijn. Een 404 daarop moet een begrijpelijke fout geven in
// plaats van stil een lege lijst, zodat een latere verificatieronde meteen ziet wat er mis is.
test("runSubcommand: 404 op assets geeft een duidelijke fout, geen lege lijst", async () => {
  await assert.rejects(
    () =>
      runSubcommand(["assets", "juict bv"], {
        key: "k",
        fetchImpl: fakeApi({ "/organizations": ORG_RESPONS }),
      }),
    /IT Glue API fout 404/
  );
});

test("runSubcommand: 404 op docs geeft een duidelijke fout, geen lege lijst", async () => {
  await assert.rejects(
    () =>
      runSubcommand(["docs", "juict bv"], {
        key: "k",
        fetchImpl: fakeApi({ "/organizations": ORG_RESPONS }),
      }),
    /IT Glue API fout 404/
  );
});
