import { getSecret } from "./azure-keyvault";

// Autotask REST API client met Key Vault-auth (productie) en env-var fallback (lokaal).
// Zie REFERENCE.md voor endpoints/datastructuren en LESSONS.md voor valkuilen.

// Zone wordt dynamisch bepaald — AUTOTASK-ZONE in Key Vault of AUTOTASK_ZONE env var (default 19)
async function getBaseUrl(zone: string) {
  return `https://webservices${zone}.autotask.net/ATServicesRest/V1.0`;
}

// Autotask thread-limiet = 3. Semafoor van 2 houdt altijd marge voor externe calls.
// JS is single-threaded, dus check+increment zijn atomisch (geen await ertussen).
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
    next(); // slot wordt direct doorgegeven — activeSlots blijft gelijk
  } else {
    activeSlots--;
  }
}

interface AutotaskRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
}

async function getCredentials() {
  // Gebruik Key Vault als AZURE_KEYVAULT_URL beschikbaar is, anders env vars (lokaal).
  // Let op: AUTOTASK_SECRET kan $ en # bevatten die dotenv kapotmaken — in Key Vault is dit geen probleem.
  if (process.env.AZURE_KEYVAULT_URL) {
    const [username, secret, integrationCode, zone] = await Promise.all([
      getSecret("AUTOTASK-USERNAME"),
      getSecret("AUTOTASK-API-KEY"),
      getSecret("AUTOTASK-INTEGRATION-CODE"),
      getSecret("AUTOTASK-ZONE").catch(() => "19"),
    ]);
    return { username, secret, integrationCode, zone };
  }

  const username = process.env.AUTOTASK_USERNAME;
  // AUTOTASK_API_KEY_B64: base64-encoded variant voor lokale dev (omzeilt dotenv $-interpolatie)
  const rawSecret = process.env.AUTOTASK_API_KEY_B64
    ? Buffer.from(process.env.AUTOTASK_API_KEY_B64, "base64").toString("utf-8")
    : (process.env.AUTOTASK_API_KEY ?? process.env.AUTOTASK_SECRET);
  const integrationCode = process.env.AUTOTASK_INTEGRATION_CODE;
  const zone = process.env.AUTOTASK_ZONE ?? "19";
  if (!username || !rawSecret || !integrationCode) {
    throw new Error(
      "Autotask credentials ontbreken: stel AZURE_KEYVAULT_URL in (productie) of AUTOTASK_USERNAME / AUTOTASK_API_KEY_B64 / AUTOTASK_INTEGRATION_CODE env vars (lokaal)."
    );
  }
  return { username, secret: rawSecret, integrationCode, zone };
}

export async function autotaskFetch<T>(
  endpoint: string,
  options: AutotaskRequestOptions = {}
): Promise<T> {
  const { username, secret, integrationCode, zone } = await getCredentials();
  const AUTOTASK_BASE_URL = await getBaseUrl(zone);

  const url = `${AUTOTASK_BASE_URL}/${endpoint}`;
  await acquireSlot();
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        UserName: username,
        Secret: secret,
        ApiIntegrationCode: integrationCode,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Autotask API fout ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  } finally {
    releaseSlot();
  }
}

interface AutotaskListResponse<T> {
  items?: T[];
  pageDetails?: { nextPageUrl?: string };
}

export async function fetchAllAutotask<T>(
  endpoint: string,
  filter: Array<{ field: string; op: string; value: unknown }>
): Promise<T[]> {
  const { username, secret, integrationCode, zone } = await getCredentials();
  const baseUrl = await getBaseUrl(zone);
  const headers = {
    "Content-Type": "application/json",
    UserName: username,
    Secret: secret,
    ApiIntegrationCode: integrationCode,
  };

  // Autotask REST API: meerdere condities moeten in een AND-wrapper — flat arrays zijn OR.
  const andFilter = filter.length > 1 ? [{ op: "and", items: filter }] : filter;

  let items: T[] = [];
  let nextUrl: string | null = `${baseUrl}/${endpoint}`;
  let isFirst = true;

  while (nextUrl) {
    await acquireSlot();
    let data: AutotaskListResponse<T> = {};
    try {
      const response = await fetch(nextUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(isFirst ? { filter: andFilter, maxRecords: 500 } : { filter: andFilter }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Autotask API fout ${response.status}: ${text}`);
      }

      data = await response.json() as AutotaskListResponse<T>;
    } finally {
      releaseSlot();
    }
    items = items.concat(data.items ?? []);
    nextUrl = data.pageDetails?.nextPageUrl ?? null;
    isFirst = false;
  }

  return items;
}

// Utility: bouw filter voor Autotask query
export function buildFilter(items: Array<{ field: string; op: string; value: unknown }>) {
  return {
    filter: items.map((item) => ({
      field: item.field,
      op: item.op,
      value: item.value,
    })),
  };
}
