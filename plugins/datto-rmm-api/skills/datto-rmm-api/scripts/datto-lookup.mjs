#!/usr/bin/env node
// Standalone Datto RMM API v2 CLI. Geen npm-deps; Node 18+ (fetch ingebouwd).
// Credentials uit Azure Key Vault via `az`, met env-var fallback. Nooit de key, het secret of
// het access token loggen: elke uitvoer gaat langs redactSecrets().
//
// Twee harde regels, allebei beleid en niet slechts een technische aanname:
//
// 1. /v2/user/resetApiKeys wordt onvoorwaardelijk geweigerd. Dat endpoint trekt de API-keys van
//    dit account in. Eén losse aanroep breekt elke integratie die op deze keys draait, inclusief
//    deze skill zelf, en er is geen weg terug zonder handmatig nieuwe keys aan te maken in de
//    portal. Geen vlag, geen env var en geen "alleen deze keer" opent dit.
// 2. Elk verzoek dat niet GET is, is een dry-run tenzij --confirm meegegeven wordt. Datto RMM
//    stuurt aan op echte machines van klanten: een quick job draait code op een endpoint en een
//    UDF-schrijfactie overschrijft een veld dat automatisering elders leest. Dat willen we zien
//    voordat het gebeurt, niet erna.

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const VAULT_NAAM = process.env.DATTO_KEYVAULT_NAME ?? "juict-shared-kv";
export const DEFAULT_TIMEOUT_MS = Number(process.env.DATTO_TIMEOUT_MS ?? 20000);
export const DEFAULT_PAGE_SIZE = Number(process.env.DATTO_PAGE_SIZE ?? 250);
export const MAX_PAGES = Number(process.env.DATTO_MAX_PAGES ?? 50);

// Datto's OAuth2 password grant gebruikt een vaste, publieke client. Dit zijn geen geheimen:
// ze staan zo in de officiële documentatie en zijn voor elk account gelijk. De echte
// credentials zijn de API key (username) en het API secret key (password).
export const OAUTH_CLIENT_ID = "public-client";
export const OAUTH_CLIENT_SECRET = "public";

// ---------------------------------------------------------------------------
// Padguard
// ---------------------------------------------------------------------------

export const GEBLOKKEERD_RESET =
  "Geblokkeerd: /v2/user/resetApiKeys trekt de API-keys van dit Datto RMM-account in. Dat breekt " +
  "elke integratie die op deze keys draait, inclusief deze skill, en is alleen te herstellen door " +
  "in de portal handmatig nieuwe keys aan te maken en de Key Vault bij te werken. Dit endpoint is " +
  "onvoorwaardelijk geblokkeerd; er is geen vlag die het opent.";
export const GEBLOKKEERD_ONPARSEERBAAR =
  "Geblokkeerd: het pad kon niet als URL geïnterpreteerd worden en wordt daarom geweigerd " +
  "(fail closed): een pad dat we niet kunnen beoordelen laten we niet door.";
export const GEBLOKKEERD_HOST =
  "Geblokkeerd: alleen een relatief pad op onze eigen Datto RMM API is toegestaan. Dit pad bevat " +
  "een scheme of een host, en de netwerklaag stuurt het bearer token als header mee: een request " +
  "naar een andere host zou dat token weggeven.";
export const GEBLOKKEERD_TEKENS =
  "Geblokkeerd: het pad bevat tekens die we niet vertrouwen. In het pad zelf zijn alleen letters, " +
  "cijfers, underscore, streepje, punt en slash toegestaan. Een percent-escape in het pad kan bij " +
  "de server naar een heel ander endpoint decoderen. Queryparameters vallen buiten deze controle.";

const CONTROLE_BASIS = "https://datto-guard.invalid/";
const CONTROLE_ORIGIN = new URL(CONTROLE_BASIS).origin;
const HEEFT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BEGINT_MET_AUTHORITY = /^[/\\]{2}/;
const TOEGESTANE_PADTEKENS = /^[A-Za-z0-9_\-./]*$/;

// De WHATWG URL-parser verwijdert tab, newline en carriage return overal uit de invoer en negeert
// leidende controletekens. Voor de scheme/host-controle moeten we naar de invoer kijken zoals de
// parser die ziet, anders verstopt "ht<tab>tps://evil.example/x" zich achter een tab.
function invoerZoalsParserDieZiet(pad) {
  const zonderWit = String(pad ?? "").replace(/[\t\n\r]/g, "");
  // Leidende controletekens en spaties (charcode 0x00 tot en met 0x20) negeert de parser.
  let i = 0;
  while (i < zonderWit.length && zonderWit.charCodeAt(i) <= 0x20) i += 1;
  return zonderWit.slice(i);
}

// Gecodeerde scheidingstekens die de parser niet decodeert maar een server mogelijk wel als "/"
// leest, plus opeenvolgende slashes. Alleen voor de controle, nooit voor het pad dat we versturen.
function padVoorControle(pad) {
  return String(pad ?? "")
    .replace(/\\/g, "/")
    .replace(/%5c/gi, "/")
    .replace(/%2f/gi, "/")
    .replace(/\/{2,}/g, "/");
}

// Segmentvergelijking met punt-suffix eraf, zodat "resetApiKeys.json" net zo hard geweigerd wordt
// als "resetApiKeys". Datto-paden hebben geen punt in een segment, dus dit knipt nooit iets nuttigs.
function heeftVerbodenSegmentPaar(pathname, eerste, tweede) {
  const segmenten = pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .map((s) => s.split(".")[0]);
  for (let i = 0; i < segmenten.length - 1; i += 1) {
    if (segmenten[i] === eerste && segmenten[i + 1] === tweede) return true;
  }
  return false;
}

/**
 * Keurt een relatief API-pad goed of gooit. Bij goedkeuring komt het pad byte-identiek terug,
 * zodat de netwerklaag exact verstuurt wat er gecontroleerd is.
 */
export function assertPathAllowed(pad) {
  const ruw = String(pad ?? "");
  const zoalsParser = invoerZoalsParserDieZiet(ruw);

  if (HEEFT_SCHEME.test(zoalsParser) || BEGINT_MET_AUTHORITY.test(zoalsParser)) {
    throw new Error(GEBLOKKEERD_HOST);
  }

  let url;
  try {
    url = new URL(padVoorControle(zoalsParser), CONTROLE_BASIS);
  } catch {
    throw new Error(GEBLOKKEERD_ONPARSEERBAAR);
  }
  if (url.origin !== CONTROLE_ORIGIN) throw new Error(GEBLOKKEERD_HOST);
  if (!TOEGESTANE_PADTEKENS.test(url.pathname)) throw new Error(GEBLOKKEERD_TEKENS);
  if (heeftVerbodenSegmentPaar(url.pathname, "user", "resetapikeys")) {
    throw new Error(GEBLOKKEERD_RESET);
  }
  return ruw;
}

/**
 * Datto pagineert met een absolute nextPageUrl in de response. Die volgen we alleen als hij naar
 * dezelfde host wijst als onze eigen base URL: anders stuurt een gemanipuleerde of verkeerd
 * geconfigureerde response ons bearer token naar een vreemde server.
 */
export function assertSameOrigin(kandidaat, baseUrl) {
  let doel;
  let basis;
  try {
    doel = new URL(String(kandidaat));
    basis = new URL(String(baseUrl));
  } catch {
    throw new Error(`Geblokkeerd: nextPageUrl '${kandidaat}' is geen geldige URL.`);
  }
  if (doel.origin !== basis.origin) {
    throw new Error(
      `Geblokkeerd: nextPageUrl wijst naar ${doel.origin} en niet naar ${basis.origin}. ` +
        "Paginatie volgt alleen URL's op onze eigen API-host.",
    );
  }
  return doel.toString();
}

// ---------------------------------------------------------------------------
// Redactie
// ---------------------------------------------------------------------------

/**
 * Haalt bekende geheimen uit een stuk tekst. Wordt toegepast op alles wat naar stdout of in een
 * Error gaat: een foutbody van Datto kan meegestuurde parameters terugecho'en.
 */
export function redactSecrets(tekst, geheimen = []) {
  let uit = String(tekst ?? "");
  for (const geheim of geheimen) {
    const g = String(geheim ?? "");
    if (g.length < 8) continue; // te kort om veilig te vervangen zonder gewone tekst te slopen
    uit = uit.split(g).join("[REDACTED]");
  }
  // Vang ook tokens die we zelf niet in de hand hebben (bijv. uit een geneste foutmelding).
  uit = uit.replace(/("access_token"\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2");
  uit = uit.replace(/("refresh_token"\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2");
  uit = uit.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, "$1[REDACTED]");
  return uit;
}

// ---------------------------------------------------------------------------
// Configuratie en authenticatie
// ---------------------------------------------------------------------------

function uitKeyVault(naam) {
  try {
    return execSync(
      `az keyvault secret show --vault-name ${VAULT_NAAM} --name ${naam} --query value -o tsv`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (err) {
    const melding = String(err?.stderr || err?.message || err).trim();
    throw new Error(
      `Kon secret '${naam}' niet uit Key Vault '${VAULT_NAAM}' halen. Is 'az login' gedaan en ` +
        `staat 'az account show' op de JUICT-subscription?\n${melding}`,
    );
  }
}

let configCache = null;

export function getConfig() {
  if (configCache) return configCache;
  const apiUrl = process.env.DATTO_API_URL ?? uitKeyVault("datto-rmm-api-url");
  const apiKey = process.env.DATTO_API_KEY ?? uitKeyVault("datto-rmm-api-key");
  const apiSecret = process.env.DATTO_API_SECRET ?? uitKeyVault("datto-rmm-api-secret");
  if (!apiUrl || !apiKey || !apiSecret) {
    throw new Error("API-URL, key of secret ontbreekt (leeg uit Key Vault en niet in de omgeving).");
  }
  configCache = { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey, apiSecret };
  return configCache;
}

let tokenCache = null;

async function eenmaligFetch(url, opties, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opties, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch met een korte retry op netwerkfouten. Gemeten: de API laat af en toe een losse call
 * stranden op "fetch failed" (TypeError uit undici) terwijl dezelfde call er direct daarna wel
 * doorkomt. Zonder retry breekt zoiets een paginatieloop halverwege af, en dan mis je stil een
 * deel van de resultaten. Alleen echte transportfouten worden herhaald: een HTTP-antwoord komt
 * ongewijzigd terug, want een 4xx of 5xx is geen transportprobleem en hoort in de foutafhandeling
 * thuis. Een afgebroken timeout (AbortError) herhalen we evenmin: die duurde al te lang.
 */
async function fetchMetTimeout(url, opties, timeoutMs, pogingen = 3) {
  let laatsteFout;
  for (let poging = 1; poging <= pogingen; poging += 1) {
    try {
      return await eenmaligFetch(url, opties, timeoutMs);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      laatsteFout = err;
      if (poging < pogingen) {
        await new Promise((r) => setTimeout(r, 500 * poging));
      }
    }
  }
  throw laatsteFout;
}

/**
 * Haalt een bearer token via de OAuth2 password grant. Het token wordt gecachet tot 60 seconden
 * voor de vervaltijd, zodat een lange paginatieloop niet halverwege op een 401 stukloopt.
 */
export async function getToken({ ververs = false } = {}) {
  const { apiUrl, apiKey, apiSecret } = getConfig();
  const nu = Date.now();
  if (!ververs && tokenCache && tokenCache.verlooptOp > nu) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: "password",
    username: apiKey,
    password: apiSecret,
  });
  const basic = Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}`).toString("base64");

  const resp = await fetchMetTimeout(
    `${apiUrl}/auth/oauth/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    DEFAULT_TIMEOUT_MS,
  );

  const tekst = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `OAuth-token ophalen mislukt (HTTP ${resp.status}). ` +
        `Controleer key en secret in Key Vault '${VAULT_NAAM}'.\n` +
        redactSecrets(tekst, [apiKey, apiSecret]),
    );
  }

  let data;
  try {
    data = JSON.parse(tekst);
  } catch {
    throw new Error(
      "OAuth-endpoint gaf geen JSON terug. Klopt de API-URL (platform) in de Key Vault?\n" +
        redactSecrets(tekst.slice(0, 400), [apiKey, apiSecret]),
    );
  }
  if (!data.access_token) {
    throw new Error(
      "OAuth-respons bevat geen access_token.\n" +
        redactSecrets(JSON.stringify(data), [apiKey, apiSecret]),
    );
  }

  const levensduurMs = (Number(data.expires_in) || 3600) * 1000;
  tokenCache = {
    token: data.access_token,
    verlooptOp: nu + Math.max(levensduurMs - 60_000, 30_000),
  };
  return tokenCache.token;
}

// ---------------------------------------------------------------------------
// Netwerklaag
// ---------------------------------------------------------------------------

function geheimenVoorRedactie() {
  const c = configCache ?? {};
  return [c.apiKey, c.apiSecret, tokenCache?.token].filter(Boolean);
}

/**
 * Doet één request tegen de API. `pad` is relatief en begint met "v2/", of het is een absolute
 * nextPageUrl die al door assertSameOrigin is gekomen.
 */
export async function dattoRequest(pad, { method = "GET", body = null, absoluteUrl = null } = {}) {
  const { apiUrl } = getConfig();
  let url;
  if (absoluteUrl) {
    url = assertSameOrigin(absoluteUrl, apiUrl);
  } else {
    const schoon = assertPathAllowed(pad).replace(/^\/+/, "");
    url = `${apiUrl}/api/${schoon}`;
  }

  const doeRequest = async (token) =>
    fetchMetTimeout(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      DEFAULT_TIMEOUT_MS,
    );

  let resp = await doeRequest(await getToken());

  // Eén keer opnieuw met een vers token: een token dat net verlopen is, is geen echte fout.
  if (resp.status === 401) {
    resp = await doeRequest(await getToken({ ververs: true }));
  }

  // Rate limit: Datto hanteert een sliding window. Respecteer Retry-After, met een plafond zodat
  // een absurde waarde de CLI niet minutenlang laat hangen.
  if (resp.status === 429) {
    const retryNa = Math.min(Number(resp.headers.get("retry-after")) || 5, 60);
    process.stderr.write(`Rate limit geraakt, wacht ${retryNa}s en probeer opnieuw...\n`);
    await new Promise((r) => setTimeout(r, retryNa * 1000));
    resp = await doeRequest(await getToken());
  }

  const tekst = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `Datto RMM ${method} ${pad || url} gaf HTTP ${resp.status}.\n` +
        redactSecrets(tekst.slice(0, 1200), geheimenVoorRedactie()),
    );
  }
  if (!tekst.trim()) return null; // sommige schrijfacties geven 204 zonder body

  try {
    return JSON.parse(tekst);
  } catch {
    throw new Error(
      `Datto RMM gaf geen JSON terug op ${method} ${pad || url}.\n` +
        redactSecrets(tekst.slice(0, 400), geheimenVoorRedactie()),
    );
  }
}

/**
 * Vindt de collectie-array in een pagineerde respons. Datto noemt die array per endpoint anders
 * (sites, devices, alerts, components, ...), maar er is er altijd precies één naast pageDetails.
 */
export function kiesCollectie(body) {
  if (!body || typeof body !== "object") return [];
  for (const [sleutel, waarde] of Object.entries(body)) {
    if (sleutel === "pageDetails") continue;
    if (Array.isArray(waarde)) return waarde;
  }
  return [];
}

/**
 * Haalt alle pagina's op door nextPageUrl te volgen. Stopt hard na maxPages zodat een verkeerd
 * filter geen honderden calls veroorzaakt.
 */
export async function fetchAlles(pad, { max = DEFAULT_PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  const scheiding = pad.includes("?") ? "&" : "?";
  let body = await dattoRequest(`${pad}${scheiding}max=${max}`);
  const alles = kiesCollectie(body);
  let paginas = 1;

  while (body?.pageDetails?.nextPageUrl && paginas < maxPages) {
    body = await dattoRequest(null, { absoluteUrl: body.pageDetails.nextPageUrl });
    alles.push(...kiesCollectie(body));
    paginas += 1;
  }
  if (body?.pageDetails?.nextPageUrl) {
    process.stderr.write(
      `Let op: gestopt na ${maxPages} pagina's, er zijn nog meer resultaten. ` +
        "Verhoog DATTO_MAX_PAGES of filter scherper.\n",
    );
  }
  return alles;
}

// ---------------------------------------------------------------------------
// Body-opbouw voor schrijfacties
// ---------------------------------------------------------------------------

/** Zet ["naam=waarde", "x=1"] om naar het variables-formaat van een quick job. */
export function parseVars(paren) {
  return (paren ?? []).map((paar) => {
    const idx = String(paar).indexOf("=");
    if (idx <= 0) {
      throw new Error(`Variabele '${paar}' moet de vorm naam=waarde hebben.`);
    }
    return { name: String(paar).slice(0, idx), value: String(paar).slice(idx + 1) };
  });
}

export function buildQuickJobBody(jobName, componentUid, varParen = []) {
  if (!jobName) throw new Error("Een quick job heeft een jobName nodig.");
  if (!componentUid) throw new Error("Een quick job heeft een componentUid nodig.");
  const variables = parseVars(varParen);
  return {
    jobName,
    jobComponent: { componentUid, ...(variables.length ? { variables } : {}) },
  };
}

export function buildUdfBody(paren) {
  const body = {};
  for (const paar of paren ?? []) {
    const idx = String(paar).indexOf("=");
    if (idx <= 0) throw new Error(`UDF '${paar}' moet de vorm udf3=waarde hebben.`);
    const veld = String(paar).slice(0, idx).trim();
    if (!/^udf([1-9]|[12][0-9]|30)$/i.test(veld)) {
      throw new Error(`'${veld}' is geen geldig UDF-veld. Gebruik udf1 tot en met udf30.`);
    }
    body[veld.toLowerCase()] = String(paar).slice(idx + 1);
  }
  if (!Object.keys(body).length) throw new Error("Geef minstens één udfN=waarde mee.");
  return body;
}

// ---------------------------------------------------------------------------
// Presentatie
// ---------------------------------------------------------------------------

function kort(waarde, lengte) {
  const s = waarde === null || waarde === undefined ? "" : String(waarde);
  return s.length > lengte ? `${s.slice(0, lengte - 1)}~` : s;
}

export function formatTabel(rijen, kolommen) {
  if (!rijen.length) return "(geen resultaten)";
  const breedtes = kolommen.map((k) =>
    Math.max(k.kop.length, ...rijen.map((r) => kort(r[k.sleutel], k.breedte).length)),
  );
  const regel = (cellen) => cellen.map((c, i) => String(c).padEnd(breedtes[i])).join("  ");
  const uit = [regel(kolommen.map((k) => k.kop)), regel(breedtes.map((b) => "-".repeat(b)))];
  for (const r of rijen) uit.push(regel(kolommen.map((k, i) => kort(r[k.sleutel], k.breedte))));
  return uit.join("\n");
}

function print(tekst) {
  process.stdout.write(`${redactSecrets(tekst, geheimenVoorRedactie())}\n`);
}

function printJson(data) {
  print(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Schrijfacties: dry-run tenzij --confirm
// ---------------------------------------------------------------------------

async function voerSchrijfactieUit({ omschrijving, context, method, pad, body, vlaggen }) {
  const regels = [
    "",
    `Actie:   ${omschrijving}`,
    ...context.map((c) => `         ${c}`),
    `Request: ${method} ${pad}`,
    `Body:    ${JSON.stringify(body)}`,
    "",
  ];

  if (!vlaggen.confirm) {
    print(
      [
        ...regels,
        "DRY-RUN. Er is niets gewijzigd.",
        "Voeg --confirm toe om dit daadwerkelijk uit te voeren.",
      ].join("\n"),
    );
    return null;
  }

  print([...regels, "UITVOEREN (--confirm meegegeven)..."].join("\n"));
  const resultaat = await dattoRequest(pad, { method, body });
  print("Klaar.");
  if (resultaat) printJson(resultaat);
  return resultaat;
}

// ---------------------------------------------------------------------------
// Hulpfuncties voor lookups
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zoekt een site op naam en geeft de uid terug, of een kandidatenlijst als het er meerdere zijn. */
export async function vindSite(zoekterm) {
  if (UUID.test(String(zoekterm))) return { uid: String(zoekterm), kandidaten: [] };

  const sites = await fetchAlles("v2/account/sites");
  const term = String(zoekterm).toLowerCase();
  const treffers = sites.filter((s) => String(s.name ?? "").toLowerCase().includes(term));
  if (treffers.length === 1) return { uid: treffers[0].uid, site: treffers[0], kandidaten: [] };
  return { uid: null, kandidaten: treffers.length ? treffers : sites };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `
Datto RMM API v2 lookup-CLI (JUICT)

Lezen:
  account                          Accountgegevens (goede eerste smoke test)
  sites [zoekterm]                 Sites, optioneel gefilterd op naam
  devices <site> [hostname]        Devices van een site (naam of uid), optioneel op hostname
  devices --all [hostname]         Devices van het hele account
  device <deviceUid>               Eén device met alle velden
  alerts [site] [--resolved]       Open (of opgeloste) alerts, account-breed of per site
  audit <deviceUid>                Auditgegevens van een device
  software <deviceUid>             Geauditeerde software van een device
  components                       Beschikbare componenten (nodig voor quickjob)
  job <jobUid>                     Status van een job
  rate                             Huidige rate-limit-status van het account
  get "<relatief-pad>"             Vrije GET, bijv. get "v2/system/pagination"

Schrijven (dry-run tenzij --confirm):
  udf <deviceUid> udf3=waarde ...  Zet user defined fields op een device
  quickjob <deviceUid> <componentUid> "<jobnaam>" [--var naam=waarde ...]
                                   Start een quick job op een device

Vlaggen:
  --json        Ruwe JSON in plaats van een tabel
  --raw         Ongefilterde eerste pagina inclusief pageDetails (om de responsvorm te checken)
  --confirm     Voer een schrijfactie echt uit
  --max <n>     Paginagrootte (default ${DEFAULT_PAGE_SIZE})
  --var k=v     Variabele voor een quick job (herhaalbaar)

Credentials komen uit Key Vault '${VAULT_NAAM}' (datto-rmm-api-url / -key / -secret), of uit de
env vars DATTO_API_URL, DATTO_API_KEY en DATTO_API_SECRET als die gezet zijn.
`.trim();

export function parseArgv(argv) {
  const vlaggen = {
    json: false,
    raw: false,
    confirm: false,
    resolved: false,
    all: false,
    help: false,
    max: null,
    vars: [],
  };
  const positioneel = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") vlaggen.json = true;
    else if (a === "--raw") vlaggen.raw = true;
    else if (a === "--confirm") vlaggen.confirm = true;
    else if (a === "--resolved") vlaggen.resolved = true;
    else if (a === "--all") vlaggen.all = true;
    else if (a === "--max") {
      vlaggen.max = Number(argv[i + 1]);
      i += 1;
    } else if (a === "--var") {
      vlaggen.vars.push(argv[i + 1]);
      i += 1;
    } else if (a === "--help" || a === "-h") vlaggen.help = true;
    else positioneel.push(a);
  }
  return { vlaggen, positioneel };
}

const KOLOMMEN_SITES = [
  { kop: "UID", sleutel: "uid", breedte: 38 },
  { kop: "NAAM", sleutel: "name", breedte: 40 },
  { kop: "DEVICES", sleutel: "_devices", breedte: 8 },
  { kop: "AUTOTASK", sleutel: "autotaskCompanyName", breedte: 30 },
];

const KOLOMMEN_DEVICES = [
  { kop: "UID", sleutel: "uid", breedte: 38 },
  { kop: "HOSTNAME", sleutel: "hostname", breedte: 24 },
  { kop: "SITE", sleutel: "siteName", breedte: 24 },
  { kop: "OS", sleutel: "operatingSystem", breedte: 30 },
  { kop: "ONLINE", sleutel: "_online", breedte: 7 },
  { kop: "LAATST GEZIEN", sleutel: "_lastSeen", breedte: 17 },
];

const KOLOMMEN_ALERTS = [
  { kop: "UID", sleutel: "alertUid", breedte: 38 },
  { kop: "PRIO", sleutel: "priority", breedte: 8 },
  { kop: "DEVICE", sleutel: "_device", breedte: 22 },
  { kop: "SITE", sleutel: "_site", breedte: 24 },
  { kop: "TYPE", sleutel: "_type", breedte: 20 },
  { kop: "ONTSTAAN", sleutel: "_ontstaan", breedte: 17 },
  { kop: "MELDING", sleutel: "_melding", breedte: 60 },
];

/**
 * De soort alert staat niet in alertMonitorInfo (dat bevat alleen sendsEmails/createsTicket) maar
 * in alertContext["@class"], bijvoorbeeld "comp_script_ctx" of "perf_resource_usage_ctx". De
 * leesbare tekst zit in alertContext.samples, waarvan de sleutels per alerttype verschillen; we
 * pakken daarom de eerste waarde in plaats van een vaste sleutel te veronderstellen.
 */
export function alertSamenvatting(alert) {
  const klasse = String(alert?.alertContext?.["@class"] ?? "").replace(/_ctx$/, "");
  const samples = alert?.alertContext?.samples;
  const eerste = samples && typeof samples === "object" ? Object.values(samples)[0] : null;
  return { type: klasse, melding: eerste == null ? "" : String(eerste).replace(/\s+/g, " ") };
}

/**
 * Datto is niet consistent in tijdstempels: alerts leveren `timestamp` in milliseconden
 * (1787643495000), activity-logs leveren `date` in seconden met decimalen (1787645215.44), en
 * device-velden als lastSeen zijn ISO-strings. Een getal onder 1e12 kan geen millisecondenstempel
 * van deze eeuw zijn (1e12 ms is september 2001), dus dat lezen we als seconden. Zonder die
 * omrekening landt een activity-log in 1970 zonder dat er iets misgaat wat je zou opvallen.
 */
export function datum(waarde) {
  if (!waarde) return "";
  let d;
  if (typeof waarde === "number") {
    d = new Date(waarde < 1e12 ? waarde * 1000 : waarde);
  } else {
    d = new Date(String(waarde));
  }
  return Number.isNaN(d.getTime()) ? String(waarde) : d.toISOString().slice(0, 16).replace("T", " ");
}

function siteRijen(sites) {
  return sites.map((s) => ({ ...s, _devices: s?.devicesStatus?.numberOfDevices ?? "" }));
}

async function toonPagineerd(pad, kolommen, vlaggen) {
  if (vlaggen.raw) {
    printJson(await dattoRequest(`${pad}${pad.includes("?") ? "&" : "?"}max=2`));
    return;
  }
  const rijen = await fetchAlles(pad, { max: vlaggen.max ?? DEFAULT_PAGE_SIZE });
  if (vlaggen.json) printJson(rijen);
  else print(`${formatTabel(rijen, kolommen)}\n\n${rijen.length} resultaten`);
}

/** Lost een site-argument op naar een uid, of print de kandidaten en geeft null terug. */
async function siteUidOfKandidaten(argument) {
  const { uid, kandidaten } = await vindSite(argument);
  if (uid) return uid;
  print(`Geen eenduidige site voor '${argument}'. Kandidaten:\n`);
  print(formatTabel(siteRijen(kandidaten), KOLOMMEN_SITES));
  return null;
}

async function main() {
  const { vlaggen, positioneel } = parseArgv(process.argv.slice(2));
  const [commando, ...rest] = positioneel;

  if (!commando || vlaggen.help) {
    print(HELP);
    return;
  }

  switch (commando) {
    case "account": {
      const data = await dattoRequest("v2/account");
      if (vlaggen.json || vlaggen.raw) printJson(data);
      else {
        const status = data?.devicesStatus ?? {};
        const limiet = data?.descriptor?.deviceLimit;
        const aantal = status.numberOfDevices;
        print(
          [
            `Account:  ${data?.name ?? "?"} (uid ${data?.uid ?? "?"}, id ${data?.id ?? "?"})`,
            `Tijdzone: ${data?.descriptor?.timeZone ?? "?"}   Valuta: ${data?.currency ?? "?"}`,
            `Devices:  ${aantal ?? "?"} totaal, ${status.numberOfOnlineDevices ?? "?"} online, ` +
              `${status.numberOfOfflineDevices ?? "?"} offline`,
            `Limiet:   ${limiet ?? "?"}` +
              (Number.isFinite(limiet) && Number.isFinite(aantal) && aantal > limiet
                ? `  LET OP: ${aantal - limiet} devices boven de licentielimiet`
                : ""),
          ].join("\n"),
        );
      }
      return;
    }

    case "sites": {
      const zoekterm = rest[0];
      const pad = zoekterm
        ? `v2/account/sites?siteName=${encodeURIComponent(zoekterm)}`
        : "v2/account/sites";
      if (vlaggen.raw) {
        printJson(await dattoRequest(`${pad}${pad.includes("?") ? "&" : "?"}max=2`));
        return;
      }
      const sites = await fetchAlles(pad, { max: vlaggen.max ?? DEFAULT_PAGE_SIZE });
      if (vlaggen.json) {
        printJson(sites);
        return;
      }
      print(`${formatTabel(siteRijen(sites), KOLOMMEN_SITES)}\n\n${sites.length} sites`);
      return;
    }

    case "devices": {
      let pad;
      const hostname = vlaggen.all ? rest[0] : rest[1];
      if (vlaggen.all) {
        pad = "v2/account/devices";
      } else {
        if (!rest[0]) throw new Error("Geef een site (naam of uid) mee, of gebruik --all.");
        const uid = await siteUidOfKandidaten(rest[0]);
        if (!uid) return;
        pad = `v2/site/${uid}/devices`;
      }
      if (hostname) {
        pad += `${pad.includes("?") ? "&" : "?"}hostname=${encodeURIComponent(hostname)}`;
      }
      if (vlaggen.raw) {
        printJson(await dattoRequest(`${pad}${pad.includes("?") ? "&" : "?"}max=2`));
        return;
      }
      const devices = await fetchAlles(pad, { max: vlaggen.max ?? DEFAULT_PAGE_SIZE });
      if (vlaggen.json) {
        printJson(devices);
        return;
      }
      const rijen = devices.map((d) => ({
        ...d,
        _online: d.online ? "ja" : "nee",
        _lastSeen: datum(d.lastSeen),
      }));
      print(`${formatTabel(rijen, KOLOMMEN_DEVICES)}\n\n${rijen.length} devices`);
      return;
    }

    case "device": {
      if (!rest[0]) throw new Error("Geef een device-uid mee.");
      printJson(await dattoRequest(`v2/device/${encodeURIComponent(rest[0])}`));
      return;
    }

    case "alerts": {
      const soort = vlaggen.resolved ? "resolved" : "open";
      let pad = `v2/account/alerts/${soort}`;
      if (rest[0]) {
        const uid = await siteUidOfKandidaten(rest[0]);
        if (!uid) return;
        pad = `v2/site/${uid}/alerts/${soort}`;
      }
      if (vlaggen.raw) {
        printJson(await dattoRequest(`${pad}?max=2`));
        return;
      }
      const alerts = await fetchAlles(pad, { max: vlaggen.max ?? DEFAULT_PAGE_SIZE });
      if (vlaggen.json) {
        printJson(alerts);
        return;
      }
      const rijen = alerts.map((a) => {
        const { type, melding } = alertSamenvatting(a);
        return {
          ...a,
          _device: a?.alertSourceInfo?.deviceName ?? "",
          _site: a?.alertSourceInfo?.siteName ?? "",
          _type: type,
          _melding: melding,
          _ontstaan: datum(a.timestamp),
        };
      });
      print(`${formatTabel(rijen, KOLOMMEN_ALERTS)}\n\n${rijen.length} ${soort} alerts`);
      return;
    }

    case "audit": {
      if (!rest[0]) throw new Error("Geef een device-uid mee.");
      printJson(await dattoRequest(`v2/audit/device/${encodeURIComponent(rest[0])}`));
      return;
    }

    case "software": {
      if (!rest[0]) throw new Error("Geef een device-uid mee.");
      await toonPagineerd(
        `v2/audit/device/${encodeURIComponent(rest[0])}/software`,
        [
          { kop: "NAAM", sleutel: "name", breedte: 50 },
          { kop: "VERSIE", sleutel: "version", breedte: 20 },
        ],
        vlaggen,
      );
      return;
    }

    case "components": {
      await toonPagineerd(
        "v2/account/components",
        [
          { kop: "UID", sleutel: "uid", breedte: 38 },
          { kop: "NAAM", sleutel: "name", breedte: 45 },
          { kop: "CATEGORIE", sleutel: "categoryCode", breedte: 20 },
        ],
        vlaggen,
      );
      return;
    }

    case "job": {
      if (!rest[0]) throw new Error("Geef een job-uid mee.");
      printJson(await dattoRequest(`v2/job/${encodeURIComponent(rest[0])}`));
      return;
    }

    case "rate": {
      printJson(await dattoRequest("v2/system/request_rate"));
      return;
    }

    case "get": {
      if (!rest[0]) throw new Error('Geef een relatief pad mee, bijv. get "v2/system/pagination".');
      printJson(await dattoRequest(rest[0]));
      return;
    }

    case "udf": {
      const uid = rest[0];
      if (!uid) throw new Error("Geef een device-uid mee.");
      const body = buildUdfBody(rest.slice(1));

      // Toon eerst wat er nu staat. Of een POST met een deelverzameling de overige UDF's laat
      // staan of leegmaakt, is nog niet gemeten (zie REFERENCE.md); daarom is de huidige stand
      // onderdeel van de preview, zodat zichtbaar is wat er op het spel staat.
      const device = await dattoRequest(`v2/device/${encodeURIComponent(uid)}`);
      const huidig = Object.entries(device?.udf ?? {}).filter(([, v]) => v !== null && v !== "");

      await voerSchrijfactieUit({
        omschrijving: "User defined fields zetten",
        context: [
          `Device:   ${device?.hostname ?? "?"} (${device?.siteName ?? "?"})`,
          `Nu gezet: ${huidig.length ? huidig.map(([k, v]) => `${k}=${v}`).join(", ") : "(geen)"}`,
          "Let op: of niet-meegestuurde UDF's blijven staan is niet geverifieerd.",
        ],
        method: "POST",
        pad: `v2/device/${encodeURIComponent(uid)}/udf`,
        body,
        vlaggen,
      });
      return;
    }

    case "quickjob": {
      const [uid, componentUid, jobnaam] = rest;
      if (!uid || !componentUid || !jobnaam) {
        throw new Error(
          'Gebruik: quickjob <deviceUid> <componentUid> "<jobnaam>" [--var naam=waarde]',
        );
      }
      const body = buildQuickJobBody(jobnaam, componentUid, vlaggen.vars);
      const device = await dattoRequest(`v2/device/${encodeURIComponent(uid)}`);

      await voerSchrijfactieUit({
        omschrijving: "Quick job starten (draait code op een endpoint)",
        context: [
          `Device:    ${device?.hostname ?? "?"} (${device?.siteName ?? "?"})`,
          `Online:    ${device?.online ? "ja" : "nee"}`,
          `Component: ${componentUid}`,
        ],
        method: "PUT",
        pad: `v2/device/${encodeURIComponent(uid)}/quickjob`,
        body,
        vlaggen,
      });
      return;
    }

    default:
      throw new Error(`Onbekend commando '${commando}'. Gebruik --help voor de lijst.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    process.stderr.write(`${redactSecrets(err?.message ?? String(err), geheimenVoorRedactie())}\n`);
    process.exit(1);
  });
}
