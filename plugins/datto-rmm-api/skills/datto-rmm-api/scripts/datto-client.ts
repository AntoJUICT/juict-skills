// Kopieerbare Datto RMM API v2-client voor JUICT-projecten (Next.js, Container Apps).
// Kopieer dit bestand samen met azure-keyvault.ts naar bijvoorbeeld src/lib/ en installeer
// @azure/keyvault-secrets en @azure/identity.
//
// De credentials komen uit Key Vault (managed identity) of, als AZURE_KEYVAULT_URL niet gezet is,
// uit de env vars DATTO_API_URL, DATTO_API_KEY en DATTO_API_SECRET.

import { getSecret } from "./azure-keyvault";

export const DEFAULT_TIMEOUT_MS = Number(process.env.DATTO_TIMEOUT_MS ?? 20000);
export const DEFAULT_PAGE_SIZE = Number(process.env.DATTO_PAGE_SIZE ?? 250);
export const DEFAULT_MAX_PAGES = Number(process.env.DATTO_MAX_PAGES ?? 50);

// Vaste, publieke OAuth-client van Datto RMM. Geen geheim: staat zo in de officiële documentatie.
const OAUTH_CLIENT_ID = "public-client";
const OAUTH_CLIENT_SECRET = "public";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const GEBLOKKEERD_RESET =
  "Geblokkeerd: /v2/user/resetApiKeys trekt de API-keys van dit Datto RMM-account in en breekt " +
  "elke integratie die erop draait. Dit endpoint is onvoorwaardelijk geblokkeerd.";

const CONTROLE_BASIS = "https://datto-guard.invalid/";
const CONTROLE_ORIGIN = new URL(CONTROLE_BASIS).origin;
const HEEFT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BEGINT_MET_AUTHORITY = /^[/\\]{2}/;
const TOEGESTANE_PADTEKENS = /^[A-Za-z0-9_\-./]*$/;

function invoerZoalsParserDieZiet(pad: string): string {
  const zonderWit = String(pad ?? "").replace(/[\t\n\r]/g, "");
  let i = 0;
  while (i < zonderWit.length && zonderWit.charCodeAt(i) <= 0x20) i += 1;
  return zonderWit.slice(i);
}

function padVoorControle(pad: string): string {
  return String(pad ?? "")
    .replace(/\\/g, "/")
    .replace(/%5c/gi, "/")
    .replace(/%2f/gi, "/")
    .replace(/\/{2,}/g, "/");
}

/** Keurt een relatief API-pad goed of gooit. Bij goedkeuring komt het pad byte-identiek terug. */
export function assertPathAllowed(pad: string): string {
  const ruw = String(pad ?? "");
  const zoalsParser = invoerZoalsParserDieZiet(ruw);

  if (HEEFT_SCHEME.test(zoalsParser) || BEGINT_MET_AUTHORITY.test(zoalsParser)) {
    throw new Error("Geblokkeerd: alleen een relatief pad is toegestaan; het bearer token gaat mee.");
  }

  let url: URL;
  try {
    url = new URL(padVoorControle(zoalsParser), CONTROLE_BASIS);
  } catch {
    throw new Error("Geblokkeerd: pad is niet als URL te interpreteren (fail closed).");
  }
  if (url.origin !== CONTROLE_ORIGIN) {
    throw new Error("Geblokkeerd: alleen een relatief pad is toegestaan.");
  }
  if (!TOEGESTANE_PADTEKENS.test(url.pathname)) {
    throw new Error("Geblokkeerd: het pad bevat tekens die we niet vertrouwen.");
  }

  const segmenten = url.pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .map((s) => s.split(".")[0]);
  for (let i = 0; i < segmenten.length - 1; i += 1) {
    if (segmenten[i] === "user" && segmenten[i + 1] === "resetapikeys") {
      throw new Error(GEBLOKKEERD_RESET);
    }
  }
  return ruw;
}

/** Paginatie volgt alleen absolute URL's op onze eigen API-host. */
export function assertSameOrigin(kandidaat: string, baseUrl: string): string {
  let doel: URL;
  let basis: URL;
  try {
    doel = new URL(String(kandidaat));
    basis = new URL(String(baseUrl));
  } catch {
    throw new Error(`Geblokkeerd: nextPageUrl '${kandidaat}' is geen geldige URL.`);
  }
  if (doel.origin !== basis.origin) {
    throw new Error(`Geblokkeerd: nextPageUrl wijst naar ${doel.origin} in plaats van ${basis.origin}.`);
  }
  return doel.toString();
}

// ---------------------------------------------------------------------------
// Redactie
// ---------------------------------------------------------------------------

export function redactSecrets(tekst: string, geheimen: (string | undefined)[] = []): string {
  let uit = String(tekst ?? "");
  for (const geheim of geheimen) {
    const g = String(geheim ?? "");
    if (g.length < 8) continue;
    uit = uit.split(g).join("[REDACTED]");
  }
  uit = uit.replace(/("access_token"\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2");
  uit = uit.replace(/("refresh_token"\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2");
  uit = uit.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, "$1[REDACTED]");
  return uit;
}

// ---------------------------------------------------------------------------
// Configuratie en token
// ---------------------------------------------------------------------------

interface DattoConfig {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

let configPromise: Promise<DattoConfig> | null = null;

async function laadConfig(): Promise<DattoConfig> {
  // AZURE_KEYVAULT_URL heeft voorrang: in productie moet de vault de bron zijn, ook als er
  // toevallig env vars rondslingeren.
  const uitVault = Boolean(process.env.AZURE_KEYVAULT_URL);
  const apiUrl = uitVault ? await getSecret("datto-rmm-api-url") : process.env.DATTO_API_URL;
  const apiKey = uitVault ? await getSecret("datto-rmm-api-key") : process.env.DATTO_API_KEY;
  const apiSecret = uitVault ? await getSecret("datto-rmm-api-secret") : process.env.DATTO_API_SECRET;

  if (!apiUrl || !apiKey || !apiSecret) {
    throw new Error(
      "Datto RMM-configuratie ontbreekt. Zet AZURE_KEYVAULT_URL (productie) of DATTO_API_URL, " +
        "DATTO_API_KEY en DATTO_API_SECRET (lokaal).",
    );
  }
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey, apiSecret };
}

function getConfig(): Promise<DattoConfig> {
  if (!configPromise) configPromise = laadConfig();
  return configPromise;
}

let tokenCache: { token: string; verlooptOp: number } | null = null;

async function eenmaligFetch(url: string, opties: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opties, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch met retry op transportfouten. De API laat af en toe een losse call stranden op
 * "fetch failed" terwijl dezelfde call er direct daarna wel doorkomt; zonder retry breekt dat
 * een paginatieloop halverwege af. HTTP-antwoorden en timeouts worden niet herhaald.
 */
async function fetchMetTimeout(
  url: string,
  opties: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pogingen = 3,
): Promise<Response> {
  let laatsteFout: unknown;
  for (let poging = 1; poging <= pogingen; poging += 1) {
    try {
      return await eenmaligFetch(url, opties, timeoutMs);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      laatsteFout = err;
      if (poging < pogingen) await new Promise((r) => setTimeout(r, 500 * poging));
    }
  }
  throw laatsteFout;
}

async function getToken(ververs = false): Promise<string> {
  const { apiUrl, apiKey, apiSecret } = await getConfig();
  const nu = Date.now();
  if (!ververs && tokenCache && tokenCache.verlooptOp > nu) return tokenCache.token;

  const basic = Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}`).toString("base64");
  const resp = await fetchMetTimeout(`${apiUrl}/auth/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "password", username: apiKey, password: apiSecret }),
  });

  const tekst = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `Datto OAuth mislukt (HTTP ${resp.status}): ${redactSecrets(tekst, [apiKey, apiSecret])}`,
    );
  }

  let data: { access_token?: string; expires_in?: number };
  try {
    data = JSON.parse(tekst);
  } catch {
    throw new Error("Datto OAuth gaf geen JSON terug. Klopt de API-URL (platform)?");
  }
  if (!data.access_token) throw new Error("Datto OAuth-respons bevat geen access_token.");

  const levensduurMs = (Number(data.expires_in) || 3600) * 1000;
  tokenCache = { token: data.access_token, verlooptOp: nu + Math.max(levensduurMs - 60_000, 30_000) };
  return tokenCache.token;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface PaginationData {
  count?: number;
  totalCount?: number;
  prevPageUrl?: string | null;
  nextPageUrl?: string | null;
}

async function geheimen(): Promise<(string | undefined)[]> {
  const c = await getConfig().catch(() => null);
  return [c?.apiKey, c?.apiSecret, tokenCache?.token];
}

/**
 * Eén request tegen de Datto RMM API. Geef een relatief pad ("v2/account/sites"), of een
 * absoluteUrl die uit pageDetails.nextPageUrl komt.
 */
export async function dattoRequest<T = unknown>(
  pad: string | null,
  opties: { method?: string; body?: unknown; absoluteUrl?: string; timeoutMs?: number } = {},
): Promise<T | null> {
  const { method = "GET", body = null, absoluteUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = opties;
  const { apiUrl } = await getConfig();

  const url = absoluteUrl
    ? assertSameOrigin(absoluteUrl, apiUrl)
    : `${apiUrl}/api/${assertPathAllowed(pad ?? "").replace(/^\/+/, "")}`;

  const doeRequest = async (token: string) =>
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
      timeoutMs,
    );

  let resp = await doeRequest(await getToken());
  if (resp.status === 401) resp = await doeRequest(await getToken(true));

  if (resp.status === 429) {
    const retryNa = Math.min(Number(resp.headers.get("retry-after")) || 5, 60);
    await new Promise((r) => setTimeout(r, retryNa * 1000));
    resp = await doeRequest(await getToken());
  }

  const tekst = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `Datto RMM ${method} ${pad ?? url} gaf HTTP ${resp.status}: ` +
        redactSecrets(tekst.slice(0, 1200), await geheimen()),
    );
  }
  if (!tekst.trim()) return null;

  try {
    return JSON.parse(tekst) as T;
  } catch {
    throw new Error(`Datto RMM gaf geen JSON terug op ${method} ${pad ?? url}.`);
  }
}

/** Vindt de collectie-array in een pagineerde respons; die heet per endpoint anders. */
export function kiesCollectie<T = unknown>(body: unknown): T[] {
  if (!body || typeof body !== "object") return [];
  for (const [sleutel, waarde] of Object.entries(body as Record<string, unknown>)) {
    if (sleutel === "pageDetails") continue;
    if (Array.isArray(waarde)) return waarde as T[];
  }
  return [];
}

/**
 * Haalt alle pagina's op via pageDetails.nextPageUrl. Stopt hard na maxPages zodat een verkeerd
 * filter geen honderden calls veroorzaakt.
 */
export async function fetchAllDatto<T = unknown>(
  pad: string,
  { max = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES }: { max?: number; maxPages?: number } = {},
): Promise<T[]> {
  const scheiding = pad.includes("?") ? "&" : "?";
  let body = await dattoRequest<{ pageDetails?: PaginationData }>(`${pad}${scheiding}max=${max}`);
  const alles = kiesCollectie<T>(body);
  let paginas = 1;

  while (body?.pageDetails?.nextPageUrl && paginas < maxPages) {
    body = await dattoRequest<{ pageDetails?: PaginationData }>(null, {
      absoluteUrl: body.pageDetails.nextPageUrl,
    });
    alles.push(...kiesCollectie<T>(body));
    paginas += 1;
  }
  return alles;
}

// ---------------------------------------------------------------------------
// Handige wrappers
// ---------------------------------------------------------------------------

export interface DattoSite {
  id: number;
  uid: string;
  name: string;
  description?: string;
  autotaskCompanyId?: string;
  autotaskCompanyName?: string;
  devicesStatus?: { numberOfDevices?: number; numberOfOnlineDevices?: number };
  portalUrl?: string;
}

export interface DattoDevice {
  id: number;
  uid: string;
  siteUid: string;
  siteName: string;
  hostname: string;
  operatingSystem?: string;
  online?: boolean;
  lastSeen?: string;
  lastLoggedInUser?: string;
  udf?: Record<string, string>;
  portalUrl?: string;
}

export const getSites = () => fetchAllDatto<DattoSite>("v2/account/sites");
export const getDevices = () => fetchAllDatto<DattoDevice>("v2/account/devices");
export const getSiteDevices = (siteUid: string) =>
  fetchAllDatto<DattoDevice>(`v2/site/${encodeURIComponent(siteUid)}/devices`);
export const getOpenAlerts = () => fetchAllDatto("v2/account/alerts/open");
export const getDevice = (deviceUid: string) =>
  dattoRequest<DattoDevice>(`v2/device/${encodeURIComponent(deviceUid)}`);

/**
 * Zet user defined fields op een device. Dit is een schrijfactie op een klantomgeving: de CLI
 * dwingt daarvoor een expliciete --confirm af, en in een applicatie hoort er een even bewuste
 * bevestiging voor te staan. Of niet-meegestuurde UDF's blijven staan is niet geverifieerd;
 * lees het device eerst als je zeker wilt weten wat je overschrijft.
 */
export const setDeviceUdf = (deviceUid: string, udfs: Record<string, string>) =>
  dattoRequest(`v2/device/${encodeURIComponent(deviceUid)}/udf`, { method: "POST", body: udfs });

/**
 * Start een quick job: dit draait daadwerkelijk een component op de machine van een klant.
 * Nooit aanroepen op basis van niet-gevalideerde invoer.
 */
export const createQuickJob = (
  deviceUid: string,
  jobName: string,
  componentUid: string,
  variables: { name: string; value: string }[] = [],
) =>
  dattoRequest(`v2/device/${encodeURIComponent(deviceUid)}/quickjob`, {
    method: "PUT",
    body: {
      jobName,
      jobComponent: { componentUid, ...(variables.length ? { variables } : {}) },
    },
  });
