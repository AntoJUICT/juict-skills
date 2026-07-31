#!/usr/bin/env node
// Standalone read-only IT Glue lookup-CLI. Geen npm-deps; Node 18+ (fetch ingebouwd).
// Key uit Key Vault via `az`, met env-var fallback. Nooit de key of een wachtwoord loggen.
//
// Harde regel, en wel als beleid en niet als technische aanname: wachtwoordwaarden worden niet
// opgehaald. De opdrachtgever heeft vastgelegd dat password-access voor deze toepassing uit staat,
// en een wachtwoordwaarde in een transcript of logbestand is een incident. Bij een wachtwoordvraag
// levert dit script alleen de naam van het item en een deeplink. Wat de API zou teruggeven doet
// hier niet toe: de blokkade geldt onvoorwaardelijk.

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const BASE_URL = process.env.ITGLUE_BASE_URL ?? "https://api.eu.itglue.com";
export const PORTAL_URL = process.env.ITGLUE_PORTAL_URL ?? "https://juict.eu.itglue.com";

const RECHTSVORMEN = /\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|holding|group|groep)\b/g;

export function normalizeOrgName(naam) {
  return String(naam ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(RECHTSVORMEN, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Strikte vergelijking: alleen leestekens/hoofdletters weg, rechtsvorm-woorden (bv, holding, ...)
// blijven staan. Nodig omdat normalizeOrgName() die woorden juist wegstript voor fuzzy-zoeken,
// waardoor "JUICT B.V." en "JUICT Holding B.V." anders ten onrechte identiek normaliseren en
// een echte, onderscheidende naam (Holding) als exacte match zou worden gezien.
function strikteNaam(naam) {
  return String(naam ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function pickExactOrg(orgs, zoekterm) {
  const lijst = orgs ?? [];

  // Eerste, strikte poging: naam op naam, zonder rechtsvorm-woorden weg te strippen.
  const doelStrikt = strikteNaam(zoekterm);
  const exactStrikt = lijst.filter((o) => strikteNaam(o?.attributes?.name) === doelStrikt);
  if (exactStrikt.length === 1) return { match: exactStrikt[0], kandidaten: [] };

  // Terugval: losse vergelijking op de volledig genormaliseerde naam (rechtsvorm eraf).
  const doel = normalizeOrgName(zoekterm);
  const exact = lijst.filter((o) => normalizeOrgName(o?.attributes?.name) === doel);
  if (exact.length === 1) return { match: exact[0], kandidaten: [] };
  return { match: null, kandidaten: exact.length > 1 ? exact : lijst };
}

// Individuele password-resource: /passwords/{id}. Collecties en de relationships-variant
// eindigen op "passwords" en hebben dus geen segment erna.
const VERBODEN_PASSWORD_PAD = /(^|\/)passwords\/[^/#]+/i;

const GEBLOKKEERD_PASSWORD =
  "Geblokkeerd: de individuele password-resource mag niet opgevraagd worden. Dit is beleid: " +
  "wachtwoordwaarden halen we niet op, password-access staat voor deze toepassing uit, en een " +
  "wachtwoordwaarde in een transcript of logbestand is een incident. De blokkade geldt dus " +
  "onafhankelijk van wat de API zou teruggeven. Gebruik het collectie-endpoint om het item te " +
  "vinden en lever de deeplink via passwordDeeplink().";
const GEBLOKKEERD_SHOW_PASSWORD = "Geblokkeerd: de parameter show_password is niet toegestaan.";
const GEBLOKKEERD_ONPARSEERBAAR =
  "Geblokkeerd: het pad kon niet als URL geïnterpreteerd worden en wordt daarom geweigerd " +
  "(fail closed): een pad dat we niet kunnen beoordelen laten we niet door.";
const GEBLOKKEERD_HOST =
  "Geblokkeerd: alleen een relatief pad op onze eigen IT Glue API is toegestaan. Dit pad bevat " +
  "een scheme of een host, en de netwerklaag stuurt de API-key als header mee: een request naar " +
  "een andere host zou die key weggeven.";
const GEBLOKKEERD_TEKENS =
  "Geblokkeerd: het pad bevat tekens die we niet vertrouwen. In het pad zelf zijn alleen letters, " +
  "cijfers, underscore, streepje, punt en slash toegestaan. Een percent-escape in het pad kan bij " +
  "de server naar een heel ander endpoint decoderen (%77 wordt w, dus /pass%77ords/1 komt daar uit " +
  "op de verboden /passwords/1). Filterwaarden horen in de query en die valt buiten deze controle.";

// Extra normalisatie bovenop de geparseerde pathname, alleen voor de controle en nooit voor het
// teruggegeven pad: %2f/%2F en %5c/%5C zijn gecodeerde scheidingstekens die de WHATWG URL-parser
// NIET decodeert (die laat percent-encoding in het pad met rust), maar die IT Glue's eigen server
// mogelijk wel als "/" interpreteert. Dubbele/drievoudige letterlijke slashes horen hier ook bij.
// Bewust geen decodeURIComponent() op het hele pad: dat gooit op een losse "%" (bijv. "100%" in een
// filterwaarde). Alle vervangingen hieronder zijn letterlijke, veilige string-replaces die
// nooit kunnen gooien. Backslash wordt eerst omgezet, vóór de slash-samenvoeging, anders
// glipt "/passwords\/12345" er nog tussendoor.
function padVoorControle(pad) {
  return String(pad ?? "")
    .replace(/\\/g, "/")
    .replace(/%5c/gi, "/")
    .replace(/%2f/gi, "/")
    .replace(/\/{2,}/g, "/");
}

// Vaste, veilige basis om de controle-URL te bouwen, expliciet LOS van BASE_URL/ITGLUE_BASE_URL.
// Die env var komt uit configuratie en zou in theorie iets geks kunnen bevatten (een pad, een
// vreemde host); de blokkade mag daar niet van afhangen. Alleen een geldige absolute basis is
// nodig zodat een relatief pad hetzelfde resolved als tegen een root-basis als BASE_URL. ".invalid"
// is gereserveerd (RFC 2606) en resolved bewust nooit ergens naartoe.
const CONTROLE_BASIS = "https://itglue-guard.invalid/";
const CONTROLE_ORIGIN = new URL(CONTROLE_BASIS).origin;

// De URL-parser verwijdert tab, newline en carriage return overal uit de invoer en negeert
// leidende controletekens en spaties. Voor de scheme/host-controle moeten we dus naar de invoer
// kijken zoals de parser die ziet, anders verstopt "ht\ttps://evil.example/x" zich achter een tab.
function invoerZoalsParserDieZiet(pad) {
  return String(pad ?? "")
    .replace(/[\t\n\r]/g, "")
    .replace(/^[\u0000-\u0020]+/, "");
}

// Een zuiver relatief pad heeft geen scheme ("https:", "data:", ...) en begint niet met twee
// scheidingstekens ("//host", "\\host", "/\host"), want dat is een authority. Beide vormen laten
// de netwerklaag naar een vreemde host praten, met onze API-key in de header.
const HEEFT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BEGINT_MET_AUTHORITY = /^[/\\]{2}/;

// Whitelist op de geparseerde pathname, naast de bestaande lagen. De normalisatie in
// padVoorControle() pakt alleen gecodeerde scheidingstekens (%2F, %5C), niet gecodeerde letters,
// terwijl een server die percent-decodeert voor het routeren "%77" net zo goed naar "w" decodeert:
// "/pass%77ords/12345" komt daar dus uit op de verboden /passwords/12345. In plaats van elke
// letter apart op de zwarte lijst te zetten, keuren we het pad alleen goed als het uitsluitend
// tekens bevat die een legitiem IT Glue-pad nodig heeft. Endpointnamen zijn ASCII met underscores,
// ids zijn numeriek (of een uuid met streepjes), dus een percent-escape is in het pad nooit nodig.
// Filterwaarden met een spatie, "%", "&" of ":" staan altijd in de query, en die zit niet in
// url.pathname: geverifieerd dat de parser die volledig in url.search laat.
const TOEGESTANE_PADTEKENS = /^[A-Za-z0-9_\-./]*$/;

// Gezaghebbende controle: bouwt de URL exact zoals de netwerklaag straks doet (new URL(pad, base))
// en toetst op wat fetch() daadwerkelijk gebruikt. Dat vangt automatisch alles wat de WHATWG
// URL-parser normaliseert of stript: tab/newline/CR worden overal uit de invoer verwijderd
// (spec-gedrag, ook midden in "passwords"), en een letterlijke backslash wordt naar "/" omgezet,
// zonder dat wij zelf een zwarte lijst van zulke tekens moeten bijhouden.
function heeftVerbodenPasswordSegment(pathname) {
  const segmenten = pathname.toLowerCase().split("/").filter(Boolean);
  const index = segmenten.indexOf("passwords");
  // Alleen een segment ná "passwords" is verboden: "/passwords", "/passwords/" (collectie) en
  // ".../relationships/passwords" (passwords is dan het laatste segment) blijven toegestaan.
  return index !== -1 && index < segmenten.length - 1;
}

/**
 * Controleert of dit pad opgevraagd mag worden. Bij goedkeuring komt het pad byte-identiek terug.
 *
 * Contract: deze functie accepteert alleen een relatief pad, bijvoorbeeld
 * "/passwords?filter[organization_id]=7". Een absolute URL wordt geweigerd, ook als de host onze
 * eigen API is, zodat een ingesloten host de controle nooit kan omleiden en ITGLUE_BASE_URL de
 * guard niet kan verzwakken. De netwerklaag plakt BASE_URL er zelf voor.
 *
 * Gevolg voor paginatie: IT Glue is JSON:API en levert "links.next" als absolute URL. Die
 * rechtstreeks door deze guard halen geeft een harde fout op elke gepagineerde call. Pagineer
 * daarom met "page[number]" (zie buildQuery) in plaats van met een doorgegeven links.next.
 */
export function assertPathAllowed(path) {
  const p = String(path ?? "");

  // Eerst parsen, want de parser bepaalt wat de netwerklaag straks werkelijk opvraagt. Fail closed:
  // een pad dat niet te parsen is, keuren we niet goed.
  let url;
  try {
    url = new URL(p, CONTROLE_BASIS);
  } catch {
    throw new Error(GEBLOKKEERD_ONPARSEERBAAR);
  }

  // Host-controle: alleen een zuiver relatief pad op onze eigen API mag door. Een scheme of een
  // authority in de invoer stuurt het request naar een vreemde host, en de netwerklaag plakt onze
  // API-key als header op elk request: dat is key-exfiltratie. De origin-vergelijking gebeurt tegen
  // CONTROLE_BASIS en bewust niet tegen BASE_URL, zodat de env var ITGLUE_BASE_URL deze controle
  // nooit kan verzwakken. Een pad zonder leidende slash ("configurations?page[size]=50") is wel
  // legitiem en resolved gewoon binnen dezelfde origin.
  const invoer = invoerZoalsParserDieZiet(p);
  if (HEEFT_SCHEME.test(invoer) || BEGINT_MET_AUTHORITY.test(invoer) || url.origin !== CONTROLE_ORIGIN) {
    throw new Error(GEBLOKKEERD_HOST);
  }

  // Laag 1a: string-normalisatie op de GEPARSEERDE pathname, niet op de ruwe invoerstring. Op de
  // ruwe string breekt een control character binnen een escape ("/passwords%\t2F12345") de
  // letterlijke match, terwijl de parser dat teken juist wegstript en er alsnog
  // "/passwords%2F12345" van maakt. Deze laag blijft nodig omdat de parser %2F/%5C niet decodeert,
  // maar de server aan de andere kant dat wel als scheidingsteken kan lezen.
  const genormaliseerdePad = padVoorControle(url.pathname);
  if (VERBODEN_PASSWORD_PAD.test(genormaliseerdePad) || heeftVerbodenPasswordSegment(genormaliseerdePad)) {
    throw new Error(GEBLOKKEERD_PASSWORD);
  }

  // Laag 1b: dezelfde controle nog een keer op de ruwe invoer, met de query eraf. Dit is puur extra
  // strengheid: de parser rekent dot-segmenten weg, dus "/passwords/../configurations" komt als
  // "/configurations" uit laag 1a. Zo'n pad is nooit legitiem, dus we weigeren het toch. Deze laag
  // kan alleen extra blokkeren, nooit iets goedkeuren dat laag 1a of 2 zou weigeren.
  const ruwePad = padVoorControle(invoer.split(/[?#]/)[0]);
  if (VERBODEN_PASSWORD_PAD.test(ruwePad) || heeftVerbodenPasswordSegment(ruwePad)) {
    throw new Error(GEBLOKKEERD_PASSWORD);
  }

  // Laag 2: de gezaghebbende segmentcontrole op de pathname zoals de parser die oplevert.
  if (heeftVerbodenPasswordSegment(url.pathname)) {
    throw new Error(GEBLOKKEERD_PASSWORD);
  }

  // Laag 3: whitelist op de tekens in de geparseerde pathname. Dit vangt de gecodeerde letter, die
  // de vaste string-replaces van laag 1 principieel niet kunnen zien ("/pass%77ords/12345" leest
  // voor ons niet als passwords, voor een percent-decoderende server wel). De query blijft hier
  // buiten, dus filterwaarden met een spatie of een losse "%" raken deze controle niet.
  if (!TOEGESTANE_PADTEKENS.test(url.pathname)) {
    throw new Error(GEBLOKKEERD_TEKENS);
  }

  // show_password: op de gedecodeerde parameternamen (zodat bijv. show%5Fpassword ook telt) en voor
  // de zekerheid ook op de ruwe invoer, want geen enkel legitiem pad bevat dit woord.
  for (const sleutel of url.searchParams.keys()) {
    if (sleutel.toLowerCase().includes("show_password")) {
      throw new Error(GEBLOKKEERD_SHOW_PASSWORD);
    }
  }
  if (/show_password/i.test(invoer)) {
    throw new Error(GEBLOKKEERD_SHOW_PASSWORD);
  }

  // Alle lagen akkoord: geef het oorspronkelijke, byte-identieke pad terug. De netwerklaag bouwt
  // daar de echte request-URL mee, niet met de genormaliseerde controle-versie.
  return p;
}

export function passwordDeeplink(orgId, passwordId, portal = PORTAL_URL) {
  if (orgId === null || orgId === undefined || orgId === "") {
    throw new Error("passwordDeeplink vereist een orgId");
  }
  if (passwordId === null || passwordId === undefined || passwordId === "") {
    throw new Error("passwordDeeplink vereist een passwordId");
  }
  return `${String(portal).replace(/\/+$/, "")}/${orgId}/passwords/${passwordId}`;
}

// Extra grens bovenop assertPathAllowed, uitsluitend voor het vrije pad van het get-subcommando.
// De rest van deze CLI laat van een password-item alleen naam en deeplink door
// (passwordTreffers). Een vrij pad zou daar langs kunnen: "get passwords?filter[organization_id]=7"
// print de ruwe attributes van elk password-item. Dat omzeilt precies de naam-en-link-whitelist die
// de rest van de skill afdwingt, dezelfde reden dat --raw geblokkeerd is op password-link. Elk pad
// dat de passwords-resource raakt gaat er daarom uit, ongeacht wat er vandaag wel of niet in die
// attributes staat: het beleid hangt niet af van wat de API teruggeeft.
//
// De controle gebruikt dezelfde normalisatie als de guard (padVoorControle op de geparseerde
// pathname en op de ruwe invoer), zodat een gecodeerde of gesplitste vorm hier niet langs glipt.
// assertPathAllowed loopt eerst: die weigert al de absolute URL, de gecodeerde letter in het pad en
// de individuele password-resource, dus wat hier aankomt is een schoon relatief pad.
const GEBLOKKEERD_GET_PASSWORDS =
  "Geblokkeerd: get mag de passwords-resource niet opvragen, ook de collectie niet. Een vrij pad " +
  "zou hier de ruwe attributes van password-items printen en daarmee de whitelist omzeilen die " +
  "alleen naam en deeplink doorlaat (dezelfde reden dat --raw geblokkeerd is op password-link). " +
  "Gebruik password-link als je een wachtwoord-item zoekt.";

export function assertGetPadToegestaan(pad) {
  assertPathAllowed(pad);
  const p = String(pad ?? "");
  const invoer = invoerZoalsParserDieZiet(p);
  const teControleren = [
    padVoorControle(new URL(p, CONTROLE_BASIS).pathname),
    padVoorControle(invoer.split(/[?#]/)[0]),
  ];
  for (const kandidaat of teControleren) {
    if (kandidaat.toLowerCase().split("/").filter(Boolean).includes("passwords")) {
      throw new Error(GEBLOKKEERD_GET_PASSWORDS);
    }
  }
  return p;
}

// Bewust een whitelist: er komen alleen naam en link uit, wat de input ook bevat.
export function passwordTreffers(items, orgId, zoekterm, portal = PORTAL_URL) {
  const term = String(zoekterm ?? "").toLowerCase();
  return (items ?? [])
    .filter((item) => {
      if (!term) return true;
      return String(item?.attributes?.name ?? "").toLowerCase().includes(term);
    })
    .map((item) => ({
      naam: item?.attributes?.name ?? "(naamloos)",
      link: passwordDeeplink(item?.attributes?.["organization-id"] ?? orgId, item?.id, portal),
    }));
}

export function buildQuery(filters = {}, { pageSize, pageNumber } = {}) {
  const params = new URLSearchParams();
  for (const [sleutel, waarde] of Object.entries(filters ?? {})) {
    if (waarde === undefined || waarde === null || waarde === "") continue;
    params.append(`filter[${sleutel}]`, String(waarde));
  }
  if (pageSize) params.append("page[size]", String(pageSize));
  if (pageNumber) params.append("page[number]", String(pageNumber));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function redactSecrets(tekst, key) {
  if (!key) return String(tekst);
  return String(tekst).split(key).join("[REDACTED]");
}

const standaardSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Netwerklaag: enige plek die daadwerkelijk fetch aanroept. Alleen GET, nooit een muterend
// verb, want onze API-key is bewust read-only tegen IT Glue.
export async function igFetch(
  path,
  { key, baseUrl = BASE_URL, fetchImpl = fetch, sleepImpl = standaardSleep, retries = 3 } = {}
) {
  assertPathAllowed(path);
  if (!key) throw new Error("igFetch vereist een API-key");
  const pad = String(path).startsWith("/") ? String(path) : `/${path}`;
  const url = `${String(baseUrl).replace(/\/+$/, "")}${pad}`;

  for (let poging = 0; ; poging++) {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/vnd.api+json",
      },
    });

    if (res.status === 429 && poging < retries) {
      const retryAfter = Number(res.headers?.get?.("retry-after"));
      const seconden = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** poging;
      await sleepImpl(seconden * 1000);
      continue;
    }

    if (!res.ok) {
      const tekst = redactSecrets(await res.text(), key);
      throw new Error(`IT Glue API fout ${res.status}: ${tekst}`);
    }

    // Bewust eerst de tekst lezen en daarna zelf parsen, in plaats van res.json() los te laten. Een
    // 200 met een niet-JSON body komt in het echt voor (een proxy of gateway die een HTML-foutpagina
    // teruggeeft) en res.json() gooit daar een kale SyntaxError op: zonder status, zonder resource,
    // en met een ongeredacteerd fragment van de body in de melding. Dat laatste breekt de belofte dat
    // elke responsbody door redactSecrets gaat voordat hij in een Error terechtkomt.
    const tekst = await res.text();
    try {
      return JSON.parse(tekst);
    } catch {
      const fragment = redactSecrets(String(tekst ?? ""), key).slice(0, 300);
      throw new Error(
        `IT Glue API gaf geen JSON terug op ${pad} (status ${res.status}). Eerste deel van de body: ${fragment}`
      );
    }
  }
}

// Pagineert via page[number]/page[size] (buildQuery), nooit via een doorgegeven links.next: die
// is bij IT Glue een absolute URL en assertPathAllowed accepteert alleen relatieve paden.
export async function fetchAllItGlue(
  resource,
  { key, filters = {}, pageSize = 100, maxPages = 50, ...opts } = {}
) {
  const alles = [];
  for (let pageNumber = 1; ; pageNumber++) {
    if (pageNumber > maxPages) {
      throw new Error(
        `fetchAllItGlue stopte op ${resource}: meer dan maxPages (${maxPages}) pagina's. ` +
          "Verklein het resultaat met een filter of verhoog maxPages bewust."
      );
    }
    const body = await igFetch(`${resource}${buildQuery(filters, { pageSize, pageNumber })}`, {
      key,
      ...opts,
    });
    alles.push(...(body?.data ?? []));
    const volgende = body?.meta?.["next-page"] ?? null;
    if (!volgende) return alles;
  }
}

const VAULT = "juict-shared-kv";
const SECRET = "itglue-api-key";

let _key = null;
export function getApiKey() {
  if (_key) return _key;
  if (process.env.ITGLUE_API_KEY) {
    _key = process.env.ITGLUE_API_KEY;
    return _key;
  }
  // VAULT en SECRET zijn vaste constanten (geen user-input) → geen injectierisico.
  _key = execSync(`az keyvault secret show --vault-name ${VAULT} --name ${SECRET} --query value -o tsv`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!_key) throw new Error(`Key Vault secret '${SECRET}' in '${VAULT}' is leeg of niet leesbaar`);
  return _key;
}

// Numerieke invoer wordt direct als organisatie-id gebruikt, zonder zoekcall: geen unieke naam
// nodig als je het id al weet. Bestaat dat id niet, dan komt dat pas aan het licht bij de
// vervolgcall (configs/contacts/docs/assets/passwords): die filtert op organization_id en IT Glue
// geeft daar gewoon een lege collectie voor terug, geen 404. De uitvoer wordt dan "Geen
// resultaten." zonder expliciete melding dat het organisatie-id niet bestaat. Bewust zo gelaten:
// een extra verificatiecall (GET /organizations/{id}) zou de belofte "numerieke input doet geen
// zoekcall" doorbreken en kost een extra round-trip voor het normale pad (een bestaand id). Wie een
// niet-bestaand id vermoedt, controleert dat met: get "organizations?page[size]=1000".
export async function resolveOrg(zoekterm, opts) {
  const term = String(zoekterm ?? "").trim();
  if (!term) throw new Error("Geef een organisatie op (naam of id).");
  if (/^\d+$/.test(term)) return { id: term, attributes: { name: `organisatie ${term}` } };

  const orgs = await fetchAllItGlue("organizations", { ...opts, filters: { name: term } });
  const { match, kandidaten } = pickExactOrg(orgs, term);
  if (match) return match;

  // Nul treffers is hier het normale pad, niet de uitzondering: filter[name] matcht geen
  // deelstrings, dus wie een deelnaam typt krijgt een lege data-array zonder foutmelding. Een kopje
  // "Kandidaten:" met niets eronder plus het advies "gebruik het id" zou dan verwijzen naar een id
  // dat deze melding zelf niet kan leveren. Daarom een aparte tak met de route die wel werkt.
  if (kandidaten.length === 0) {
    throw new Error(
      `Geen organisatie gevonden voor "${term}". Dat betekent niet dat de organisatie niet bestaat: ` +
        "filter[name] van IT Glue matcht geen deelstrings en wil de volledige naam, en geeft anders " +
        "een lege lijst zonder foutmelding.\n" +
        "Twee routes naar het id:\n" +
        `  1. Zoek de organisatie op ${PORTAL_URL} en lees het id uit de URL van de organisatiepagina.\n` +
        '  2. Haal de lijst op met: node itglue-lookup.mjs get "organizations?page[size]=1000"\n' +
        "Herhaal het commando daarna met dat id in plaats van de naam."
    );
  }

  const lijst = kandidaten
    .slice(0, 15)
    .map((o) => `  ${o.id}  ${o.attributes?.name ?? "(naamloos)"}`)
    .join("\n");
  throw new Error(
    `Geen unieke organisatie voor "${term}". Kandidaten:\n${lijst}\n` +
      "Herhaal het commando met het id in plaats van de naam."
  );
}

export const SUBCOMMANDS = ["org", "configs", "contacts", "docs", "assets", "password-link", "get"];

// Subcommando's waarvoor --raw een resource heeft. Komt er een subcommando bij, dan hoort het hier
// of in GEEN_RAW_SUBCOMMANDS te komen; rawDoel() gooit liever dan te gokken.
export const RAW_SUBCOMMANDS = ["org", "configs", "contacts", "docs", "assets"];

// De tegenhanger: subcommando's die bewust geen --raw hebben, met de reden. password-link omdat een
// ruwe dump van password-items de naam-en-link-whitelist zou omzeilen, get omdat dat al de ruwe body
// print en een tweede ruwe modus daar niets toevoegt. De test die deze twee lijsten naast
// SUBCOMMANDS legt, vangt een nieuw subcommando dat in geen van beide staat.
export const GEEN_RAW_SUBCOMMANDS = ["password-link", "get"];

export function assertSubcommando(subcommando) {
  if (!SUBCOMMANDS.includes(subcommando)) {
    throw new Error(`Onbekend subcommando "${subcommando ?? ""}". Geldig: ${SUBCOMMANDS.join(", ")}.`);
  }
  return subcommando;
}

// Vrije GET op een relatief pad, zodat de afvinkinstructies in REFERENCE.md uitvoerbaar zijn zonder
// zelf een script met de key te schrijven. Het pad gaat door assertPathAllowed én door de extra
// passwords-grens van assertGetPadToegestaan, en de uitvoer gaat in runCli() door redactSecrets.
// Het pad wordt byte-identiek verstuurd, dus met letterlijke blokhaken: daarmee is dit ook de manier
// om de %5B/%5D-aanname te meten tegenover wat --raw verstuurt.
export async function runGet(argv, opts) {
  const [, ...rest] = argv;
  const pad = String(rest[0] ?? "").trim();
  if (!pad) {
    throw new Error(
      'Geef een relatief pad op, bijvoorbeeld: get "flexible_asset_types" of ' +
        'get "locations?filter[organization_id]=7". Zet het pad tussen quotes, anders eet je shell de ' +
        "blokhaken en de &."
    );
  }
  assertGetPadToegestaan(pad);
  return igFetch(pad, opts);
}

export async function runSubcommand(argv, opts) {
  const [subcommando, ...rest] = argv;
  assertSubcommando(subcommando);

  if (subcommando === "get") {
    return { soort: "get", body: await runGet(argv, opts) };
  }

  if (subcommando === "org") {
    const term = String(rest[0] ?? "").trim();
    if (!term) throw new Error("Geef een organisatie op (naam of id).");
    const orgs = await fetchAllItGlue("organizations", { ...opts, filters: { name: term } });
    return {
      soort: "org",
      rijen: orgs.map((o) => ({
        id: o.id,
        naam: o.attributes?.name ?? "(naamloos)",
        type: o.attributes?.["organization-type-name"] ?? "",
        status: o.attributes?.["organization-status-name"] ?? "",
      })),
    };
  }

  // Vóór resolveOrg, zodat een ontbrekende zoekterm geen zoekcall op de organisatie kost.
  if (subcommando === "password-link" && !String(rest[1] ?? "").trim()) {
    throw new Error(
      "password-link vereist een zoekterm. Zonder term zou dit de naam en link van alle " +
        "password-items van deze organisatie tonen, en dat is meer dan nodig om één item te vinden. " +
        'Geef een deel van de itemnaam mee, bijvoorbeeld: password-link 7 "firewall".'
    );
  }

  const org = await resolveOrg(rest[0], opts);
  const zoekterm = String(rest[1] ?? "").toLowerCase();
  const filters = { organization_id: org.id };

  if (subcommando === "configs") {
    const items = await fetchAllItGlue("configurations", { ...opts, filters });
    return { soort: "configs", rijen: filterOpNaam(items, zoekterm).map(configRij) };
  }

  if (subcommando === "contacts") {
    const items = await fetchAllItGlue("contacts", { ...opts, filters });
    return { soort: "contacts", rijen: filterOpNaam(items, zoekterm, contactNaam).map(contactRij) };
  }

  if (subcommando === "docs") {
    const items = await fetchAllItGlue("documents", { ...opts, filters });
    return { soort: "docs", rijen: filterOpNaam(items, zoekterm).map((d) => docRij(d, org.id)) };
  }

  if (subcommando === "assets") {
    // Filternamen zijn snake_case (flexible_asset_type_id), ook al zijn de ATTRIBUUTsleutels in de
    // respons kebab-case (flexible-asset-type-name). De kebab-vorm als filter levert geen treffers.
    // Let op: IT Glue vraagt voor flexible assets om BEIDE filters; alleen op organization_id
    // filteren geeft een lege collectie. Geef dus altijd een asset-type-id mee (zie REFERENCE.md).
    const assetFilters = { organization_id: org.id };
    if (rest[1]) assetFilters["flexible_asset_type_id"] = rest[1];
    const items = await fetchAllItGlue("flexible_assets", { ...opts, filters: assetFilters });
    return {
      soort: "assets",
      rijen: items.map((a) => ({
        id: a.id,
        naam: a.attributes?.name ?? "(naamloos)",
        type: a.attributes?.["flexible-asset-type-name"] ?? "",
      })),
    };
  }

  // password-link: collectie ophalen om het item te vinden, daarna alleen naam en link. De zoekterm
  // is hierboven al verplicht gesteld: zonder term zou dit de naam en link van élk password-item van
  // de organisatie dumpen. Geen waarde, maar itemnamen vertellen zelf al welke systemen en accounts
  // er zijn, en de GEBRUIK-tekst schrijft de term ook als verplicht.
  const items = await fetchAllItGlue("passwords", { ...opts, filters });
  return { soort: "password-link", rijen: passwordTreffers(items, org.id, zoekterm) };
}

// Bewust klein: bij een collectie met meer dan twee items is er dan echt een volgende pagina, en
// alleen dán laat meta zien welke sleutel IT Glue voor "volgende pagina" gebruikt. Dat is het punt
// van --raw: het is de enige manier om die sleutelnaam te controleren zonder de code te wijzigen.
export const RAW_PAGE_SIZE = 2;

// Welke resource en filters horen bij een subcommando. Apart van runSubcommand() zodat --raw
// dezelfde resource en dezelfde filters gebruikt als het subcommando zelf, in plaats van een eigen
// pad te verzinnen. De paginatie wijkt bewust wel af: --raw haalt alleen pagina 1 op met
// page[size]=RAW_PAGE_SIZE, terwijl de subcommando's met 100 per pagina doorpagineren.
export async function rawDoel(argv, opts) {
  const [subcommando, ...rest] = argv;
  assertSubcommando(subcommando);

  // Geen ruwe dump van password-items. De rest van dit script laat van een password-item alleen
  // naam en deeplink door (passwordTreffers), en --raw zou dat filter juist omzeilen: precies de
  // reden dat die whitelist er is. Beleid boven nieuwsgierigheid.
  if (subcommando === "password-link") {
    throw new Error(
      "Geblokkeerd: --raw is niet toegestaan op password-link. Een ruwe dump van password-items " +
        "omzeilt de whitelist die alleen naam en deeplink doorlaat. Gebruik password-link zonder " +
        "--raw, of inspecteer een andere resource."
    );
  }

  // get print zelf al de ruwe body van precies het pad dat je meegeeft. Een --raw eroverheen zou
  // alleen verwarren over welke paginagrootte er dan verstuurd wordt.
  if (subcommando === "get") {
    throw new Error(
      "--raw heeft geen zin op get: get print de ruwe JSON:API-body van het pad dat je meegeeft al. " +
        "Zet page[size] en page[number] desgewenst zelf in het pad."
    );
  }

  if (subcommando === "org") {
    const term = String(rest[0] ?? "").trim();
    if (!term) throw new Error("Geef een organisatie op (naam of id).");
    return { resource: "organizations", filters: { name: term } };
  }

  const org = await resolveOrg(rest[0], opts);
  const filters = { organization_id: org.id };
  if (subcommando === "configs") return { resource: "configurations", filters };
  if (subcommando === "contacts") return { resource: "contacts", filters };
  if (subcommando === "docs") return { resource: "documents", filters };
  if (subcommando === "assets") {
    if (rest[1]) filters["flexible_asset_type_id"] = rest[1];
    return { resource: "flexible_assets", filters };
  }

  // Geen stille doorval. Voorheen viel alles wat hierboven niet matchte door naar flexible_assets,
  // waardoor een toekomstig zevende subcommando ongemerkt de verkeerde resource zou opvragen: een
  // 200 met de verkeerde inhoud in plaats van een fout. Liever hard stoppen.
  throw new Error(
    `Subcommando "${subcommando}" heeft geen resource voor --raw. Geldig met --raw: ${RAW_SUBCOMMANDS.join(", ")}.`
  );
}

// Haalt de ruwe JSON:API-body van de EERSTE pagina op, inclusief meta en links. Geen paginatie:
// hier gaat het om de vorm van de respons, niet om de volledige lijst.
export async function runRaw(argv, opts) {
  const { resource, filters } = await rawDoel(argv, opts);
  const query = buildQuery(filters, { pageSize: RAW_PAGE_SIZE, pageNumber: 1 });
  return igFetch(`${resource}${query}`, opts);
}

function filterOpNaam(items, zoekterm, naamVan = (i) => i?.attributes?.name ?? "") {
  if (!zoekterm) return items;
  return items.filter((i) => String(naamVan(i)).toLowerCase().includes(zoekterm));
}

function contactNaam(contact) {
  const a = contact?.attributes ?? {};
  return a.name ?? [a["first-name"], a["last-name"]].filter(Boolean).join(" ");
}

function configRij(c) {
  const a = c?.attributes ?? {};
  return {
    id: c.id,
    naam: a.name ?? "(naamloos)",
    type: a["configuration-type-name"] ?? "",
    ip: a["primary-ip"] ?? "",
    os: a["operating-system-name"] ?? "",
    status: a["configuration-status-name"] ?? "",
  };
}

function contactRij(c) {
  const a = c?.attributes ?? {};
  const mails = Array.isArray(a["contact-emails"])
    ? a["contact-emails"].map((m) => m.value).filter(Boolean).join(", ")
    : "";
  return {
    id: c.id,
    naam: contactNaam(c) || "(naamloos)",
    functie: a.title ?? "",
    email: mails,
    type: a["contact-type-name"] ?? "",
  };
}

function docRij(d, orgId) {
  return {
    id: d.id,
    naam: d?.attributes?.name ?? "(naamloos)",
    link: `${PORTAL_URL.replace(/\/+$/, "")}/${orgId}/docs/${d.id}`,
  };
}

export function formatTabel(rijen, kolommen) {
  if (!rijen || rijen.length === 0) return "Geen resultaten.";
  const breedtes = kolommen.map((k) =>
    Math.max(k.length, ...rijen.map((r) => String(r[k] ?? "").length))
  );
  const regel = (waarden) =>
    waarden.map((w, i) => String(w ?? "").padEnd(breedtes[i])).join("  ").trimEnd();
  return [regel(kolommen), ...rijen.map((r) => regel(kolommen.map((k) => r[k])))].join("\n");
}

const KOLOMMEN = {
  org: ["id", "naam", "type", "status"],
  configs: ["id", "naam", "type", "ip", "os", "status"],
  contacts: ["id", "naam", "functie", "email", "type"],
  docs: ["id", "naam", "link"],
  assets: ["id", "naam", "type"],
  "password-link": ["naam", "link"],
};

export const GEBRUIK = `Gebruik: node itglue-lookup.mjs <subcommando> <organisatie> [zoekterm] [--json|--raw]

  org <naam>                     organisaties zoeken op naam
  configs <org> [zoekterm]       configuraties (servers, netwerk, endpoints)
  contacts <org> [zoekterm]      contacten
  docs <org> [zoekterm]          documenten met deeplink
  assets <org> [asset-type-id]   flexible assets
  password-link <org> <term>     naam en deeplink van een wachtwoord-item
  get "<relatief-pad>"           ruwe GET op een relatief pad, voor endpoints zonder
                                 eigen subcommando (bijv. get "flexible_asset_types").
                                 Zet het pad tussen quotes vanwege de blokhaken en de &.
                                 De passwords-resource is hier geblokkeerd; gebruik
                                 password-link.

  --json   de verwerkte rijen als JSON in plaats van een tabel
  --raw    de ruwe JSON:API-body van de eerste pagina, inclusief meta en links.
           Voor het verifieren van de responsvorm: welke meta-sleutel de volgende
           pagina aangeeft, hoe de attribuutsleutels heten, hoeveel items er zijn.
           Paginagrootte staat op ${RAW_PAGE_SIZE} zodat er echt een volgende pagina is.
           Niet toegestaan op password-link en niet op get.

Read-only. Wachtwoordwaarden worden nooit opgehaald: password-link geeft
alleen de naam van het item en een link naar IT Glue.`;

// Als aparte functie met injecteerbare key-ophaler en logger, zodat de volgorde van validatie en
// key-ophalen testbaar is zonder az aan te roepen. De subcommando-validatie staat bewust vóór
// keyOphaler(): anders doet "node itglue-lookup.mjs bogus" eerst een az-call en zegt daarna pas dat
// het subcommando niet bestaat.
export async function runCli(meegegeven, { keyOphaler = getApiKey, log = console.log } = {}) {
  const argv = meegegeven.filter((a) => a !== "--json" && a !== "--raw");
  const alsJson = meegegeven.includes("--json");
  const alsRaw = meegegeven.includes("--raw");
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    log(GEBRUIK);
    return;
  }

  assertSubcommando(argv[0]);

  const key = await keyOphaler();

  if (alsRaw) {
    // redactSecrets als vangnet: de key hoort niet in een responsbody te staan, maar een ruwe dump
    // die we ongefilterd naar de console schrijven is precies de plek om dat niet aan te nemen.
    const body = await runRaw(argv, { key });
    log(redactSecrets(JSON.stringify(body, null, 2), key));
    return;
  }

  const { soort, rijen, body } = await runSubcommand(argv, { key });
  if (soort === "get") {
    // get print altijd de ruwe body, ook zonder --json: er zijn geen verwerkte rijen. Zelfde
    // vangnet als bij --raw.
    log(redactSecrets(JSON.stringify(body, null, 2), key));
    return;
  }
  if (alsJson) {
    log(JSON.stringify(rijen, null, 2));
    return;
  }
  log(formatTabel(rijen, KOLOMMEN[soort]));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
