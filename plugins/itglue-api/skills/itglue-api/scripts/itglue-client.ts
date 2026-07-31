import { getSecret } from "./azure-keyvault";

// IT Glue REST API client (read-only) met Key Vault-auth in productie en env-var
// fallback lokaal. Zie REFERENCE.md voor endpoints en LESSONS.md voor valkuilen.
//
// Harde regel: wachtwoordwaarden worden niet opgehaald. Onze API-key heeft geen
// password-access, en een wachtwoordwaarde in logs of een transcript is een incident.
// Gebruik passwordDeeplink() en lever een link naar IT Glue.
//
// Dit bestand is bedoeld om te kopieren naar een Next.js-project: geen import buiten
// ./azure-keyvault, zodat het zelfstandig werkt.
//
// LET OP, bewuste duplicatie: de blokkade hieronder (assertPathAllowed met alle helpers en
// meldingen) is een exacte spiegel van dezelfde code in itglue-lookup.mjs. Dat is geen
// vergissing en geen restant. De CLI moet standalone draaien zonder build, deze client moet
// los naar een ander project te kopieren zijn, dus een gedeelde module zou een van de twee
// breken. Wijzig je hier iets, wijzig het dan ook in itglue-lookup.mjs (en omgekeerd).
// itglue-client-guard.test.mjs vergelijkt de twee bestanden en wordt rood zodra ze uit elkaar
// lopen of zodra er een laag uit de blokkade verdwijnt.

const BASE_URL = process.env.ITGLUE_BASE_URL ?? "https://api.eu.itglue.com";
const PORTAL_URL = process.env.ITGLUE_PORTAL_URL ?? "https://juict.eu.itglue.com";

// IT Glue rate-limit: houd het rustig en serieel bij bulkwerk.
const MAX_CONCURRENT = 2;
let activeSlots = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeSlots < MAX_CONCURRENT) {
    activeSlots++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waitQueue.push(resolve));
}

function releaseSlot(): void {
  const next = waitQueue.shift();
  if (next) {
    next(); // slot wordt direct doorgegeven, activeSlots blijft gelijk
  } else {
    activeSlots--;
  }
}

// Individuele password-resource: /passwords/{id}. Collecties en de relationships-variant
// eindigen op "passwords" en hebben dus geen segment erna.
const VERBODEN_PASSWORD_PAD = /(^|\/)passwords\/[^/#]+/i;

const GEBLOKKEERD_PASSWORD =
  "Geblokkeerd: de individuele password-resource mag niet opgevraagd worden. " +
  "Onze API-key heeft geen password-access. Gebruik het collectie-endpoint om het " +
  "item te vinden en lever de deeplink via passwordDeeplink().";
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
// nooit kunnen gooien. Backslash wordt eerst omgezet, voor de slash-samenvoeging, anders
// glipt "/passwords\/12345" er nog tussendoor.
function padVoorControle(pad: string): string {
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
function invoerZoalsParserDieZiet(pad: string): string {
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
function heeftVerbodenPasswordSegment(pathname: string): boolean {
  const segmenten = pathname.toLowerCase().split("/").filter(Boolean);
  const index = segmenten.indexOf("passwords");
  // Alleen een segment na "passwords" is verboden: "/passwords", "/passwords/" (collectie) en
  // ".../relationships/passwords" (passwords is dan het laatste segment) blijven toegestaan.
  return index !== -1 && index < segmenten.length - 1;
}

// Fail closed als aparte functie in plaats van "let url" met een try/catch eromheen: TypeScript
// ziet dan zonder trucs dat er altijd een URL uitkomt of dat er gegooid wordt.
function parseerControleUrl(p: string): URL {
  try {
    return new URL(p, CONTROLE_BASIS);
  } catch {
    throw new Error(GEBLOKKEERD_ONPARSEERBAAR);
  }
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
 * daarom met "page[number]" (zie buildFilterQuery) in plaats van met een doorgegeven links.next.
 */
export function assertPathAllowed(path: string): string {
  const p = String(path ?? "");

  // Eerst parsen, want de parser bepaalt wat de netwerklaag straks werkelijk opvraagt. Fail closed:
  // een pad dat niet te parsen is, keuren we niet goed.
  const url = parseerControleUrl(p);

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

// orgId en passwordId mogen ook null/undefined zijn in het type: de aanroeper haalt ze vaak
// rechtstreeks uit een API-respons of uit Prisma, en dan wil je dat de runtime-controle hieronder
// nog steeds typecheckt in plaats van dat TypeScript de vergelijking als zinloos afkeurt.
export function passwordDeeplink(
  orgId: string | number | null | undefined,
  passwordId: string | number | null | undefined
): string {
  if (orgId === null || orgId === undefined || orgId === "") {
    throw new Error("passwordDeeplink vereist een orgId");
  }
  if (passwordId === null || passwordId === undefined || passwordId === "") {
    throw new Error("passwordDeeplink vereist een passwordId");
  }
  return `${PORTAL_URL.replace(/\/+$/, "")}/${orgId}/passwords/${passwordId}`;
}

let cachedKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  if (process.env.AZURE_KEYVAULT_URL) {
    const uitVault = await getSecret("itglue-api-key");
    cachedKey = uitVault;
    return uitVault;
  }
  const key = process.env.ITGLUE_API_KEY;
  if (!key) {
    throw new Error(
      "IT Glue key ontbreekt: stel AZURE_KEYVAULT_URL in (productie, secret 'itglue-api-key' " +
        "in juict-shared-kv) of ITGLUE_API_KEY (lokaal)."
    );
  }
  cachedKey = key;
  return key;
}

function redactKey(tekst: string, key: string): string {
  return key ? tekst.split(key).join("[REDACTED]") : tekst;
}

export interface ItGlueResource<A = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: A;
}

interface ItGlueListBody<T> {
  data?: T[];
  meta?: Record<string, unknown>;
}

export function buildFilterQuery(
  filters: Record<string, string | number | null | undefined>,
  paging: { pageSize?: number; pageNumber?: number } = {}
): string {
  const params = new URLSearchParams();
  for (const [sleutel, waarde] of Object.entries(filters)) {
    if (waarde === undefined || waarde === null || waarde === "") continue;
    params.append(`filter[${sleutel}]`, String(waarde));
  }
  if (paging.pageSize) params.append("page[size]", String(paging.pageSize));
  if (paging.pageNumber) params.append("page[number]", String(paging.pageNumber));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// Netwerklaag: enige plek die daadwerkelijk fetch aanroept. Alleen lezen, nooit een muterend
// HTTP-verb, want onze API-key is bewust read-only tegen IT Glue.
export async function itglueFetch<T>(
  path: string,
  { retries = 3 }: { retries?: number } = {}
): Promise<T> {
  assertPathAllowed(path);
  const key = await getApiKey();
  const pad = path.startsWith("/") ? path : `/${path}`;
  const url = `${BASE_URL.replace(/\/+$/, "")}${pad}`;

  for (let poging = 0; ; poging++) {
    await acquireSlot();
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "x-api-key": key,
          "Content-Type": "application/vnd.api+json",
        },
      });
    } finally {
      releaseSlot();
    }

    if (response.status === 429 && poging < retries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const seconden = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** poging;
      await new Promise((resolve) => setTimeout(resolve, seconden * 1000));
      continue;
    }

    if (!response.ok) {
      const tekst = redactKey(await response.text(), key);
      throw new Error(`IT Glue API fout ${response.status}: ${tekst}`);
    }

    return (await response.json()) as T;
  }
}

// Pagineert via page[number]/page[size] (buildFilterQuery), nooit via een doorgegeven links.next:
// die is bij IT Glue een absolute URL en assertPathAllowed accepteert alleen relatieve paden.
export async function fetchAllItGlue<A = Record<string, unknown>>(
  resource: string,
  {
    filters = {},
    pageSize = 100,
    maxPages = 50,
  }: {
    filters?: Record<string, string | number | null | undefined>;
    pageSize?: number;
    maxPages?: number;
  } = {}
): Promise<Array<ItGlueResource<A>>> {
  const alles: Array<ItGlueResource<A>> = [];
  for (let pageNumber = 1; ; pageNumber++) {
    if (pageNumber > maxPages) {
      throw new Error(
        `fetchAllItGlue stopte op ${resource}: meer dan maxPages (${maxPages}) pagina's. ` +
          "Verklein het resultaat met een filter of verhoog maxPages bewust."
      );
    }
    const body = await itglueFetch<ItGlueListBody<ItGlueResource<A>>>(
      `${resource}${buildFilterQuery(filters, { pageSize, pageNumber })}`
    );
    alles.push(...(body.data ?? []));
    if (!body.meta?.["next-page"]) return alles;
  }
}
