#!/usr/bin/env node
// Standalone read-only IT Glue lookup-CLI. Geen npm-deps; Node 18+ (fetch ingebouwd).
// Key uit Key Vault via `az`, met env-var fallback. Nooit de key of een wachtwoord loggen.
//
// Harde regel: wachtwoordwaarden worden niet opgehaald. Onze API-key heeft geen
// password-access, en een wachtwoord in een transcript is een incident. Bij een
// wachtwoordvraag levert dit script alleen de naam van het item en een deeplink.

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

    return res.json();
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
