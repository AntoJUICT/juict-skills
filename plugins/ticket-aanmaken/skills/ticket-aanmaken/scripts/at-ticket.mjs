#!/usr/bin/env node
// Standalone Autotask-ticket-CLI. Geen npm-deps; Node 18+ (fetch ingebouwd).
// Secrets uit Key Vault via `az`, met env-var fallback. Nooit secrets loggen.
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const VAULT = "juict-kv-g4fhuo35";

function azSecret(name) {
  // VAULT en name zijn vaste constanten (geen user-input) → geen injectierisico.
  return execSync(
    `az keyvault secret show --vault-name ${VAULT} --name ${name} --query value -o tsv`,
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
}

let _creds = null;
export function getCredentials() {
  if (_creds) return _creds;
  // Env forceert lokale modus wanneer AUTOTASK_USERNAME gezet is.
  if (process.env.AUTOTASK_USERNAME) {
    const secret = process.env.AUTOTASK_API_KEY_B64
      ? Buffer.from(process.env.AUTOTASK_API_KEY_B64, "base64").toString("utf-8")
      : (process.env.AUTOTASK_API_KEY ?? process.env.AUTOTASK_SECRET);
    const integrationCode = process.env.AUTOTASK_INTEGRATION_CODE;
    if (!secret || !integrationCode) {
      throw new Error("Env-modus: AUTOTASK_API_KEY(_B64) en AUTOTASK_INTEGRATION_CODE vereist.");
    }
    _creds = { username: process.env.AUTOTASK_USERNAME, secret, integrationCode, zone: process.env.AUTOTASK_ZONE ?? "19" };
    return _creds;
  }
  // Anders: Key Vault via az.
  let zone = "19";
  try { zone = azSecret("AUTOTASK-ZONE") || "19"; } catch { /* default */ }
  _creds = {
    username: azSecret("AUTOTASK-USERNAME"),
    secret: azSecret("AUTOTASK-API-KEY"),
    integrationCode: azSecret("AUTOTASK-INTEGRATION-CODE"),
    zone,
  };
  return _creds;
}

function baseUrl(zone) {
  return `https://webservices${zone}.autotask.net/ATServicesRest/V1.0`;
}

export function redactSecrets(text, creds) {
  let out = text;
  for (const v of [creds.username, creds.secret, creds.integrationCode]) {
    if (v && v.length > 0) out = out.split(v).join("[REDACTED]");
  }
  return out;
}

export async function atFetch(endpoint, { method = "GET", body, headers = {} } = {}) {
  const { username, secret, integrationCode, zone } = getCredentials();
  const res = await fetch(`${baseUrl(zone)}/${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      UserName: username,
      Secret: secret,
      ApiIntegrationCode: integrationCode,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Autotask API fout ${res.status}: ${redactSecrets(text, { username, secret, integrationCode })}`);
  }
  return res.json();
}

export function buildFilter(conditions) {
  const filter = conditions.length > 1 ? [{ op: "and", items: conditions }] : conditions;
  return { filter };
}

export async function atQuery(entity, conditions, maxRecords = 500) {
  const { filter } = buildFilter(conditions);
  const data = await atFetch(`${entity}/query`, { method: "POST", body: { filter, maxRecords } });
  return data.items ?? [];
}

// Haal de ticket-veldmetadata ÉÉN keer op. cmdPicklists heeft meerdere picklist-velden
// nodig; los ophalen zou N identieke parallelle calls naar hetzelfde endpoint doen en
// Autotask's 3-thread-limiet (429) overschrijden.
async function fetchTicketFields() {
  const data = await atFetch("Tickets/entityInformation/fields");
  return data.fields ?? [];
}

export function picklistFromFields(fields, fieldName) {
  const field = (fields ?? []).find((f) => f.name === fieldName);
  if (!field) throw new Error(`Ticket-veld niet gevonden in entityInformation/fields: ${fieldName}`);
  return (field.picklistValues ?? [])
    .filter((v) => v.isActive)
    .map((v) => ({ id: Number(v.value), name: v.label }));
}

export async function cmdLookupCompany(naam) {
  if (!naam) throw new Error("lookup-company vereist een klantnaam.");
  const items = await atQuery("Companies", [
    { field: "isActive", op: "eq", value: true },
    { field: "companyName", op: "contains", value: naam },
  ]);
  return items.map((c) => ({ id: c.id, companyName: c.companyName, city: c.city ?? null }));
}

export async function cmdPicklists() {
  const fields = await fetchTicketFields();
  const status = picklistFromFields(fields, "status");
  const priority = picklistFromFields(fields, "priority");
  const queue = picklistFromFields(fields, "queueID");
  const ticketCategory = picklistFromFields(fields, "ticketCategory");
  const wt = await atQuery("BillingCodes", [
    { field: "isActive", op: "eq", value: true },
    { field: "billingCodeType", op: "eq", value: 0 },
    { field: "useType", op: "eq", value: 1 },
  ]);
  const workType = wt.map((b) => ({ id: b.id, name: b.name }));
  return { status, priority, queue, ticketCategory, workType };
}

// Vat de ResourceRoles-rijen van één resource samen tot bruikbare rol-id('s).
// Autotask geeft één rij per (queue/department)-koppeling, vaak met dezelfde roleID.
// roleID = de enige eenduidige rol (klaar om als assignedResourceRoleID te gebruiken),
// of null als er 0 of meerdere verschillende rollen zijn (dan moet de skill doorvragen).
export function summarizeRoles(roleRows) {
  const rows = roleRows ?? [];
  const roleIDs = [...new Set(rows.map((x) => x.roleID).filter((v) => v != null))];
  // queueRoles: rol per queue — nodig omdat de geldige assignedResourceRoleID
  // afhangt van de queue waarin het ticket komt.
  const queueRoles = rows
    .filter((x) => x.queueID != null && x.roleID != null)
    .map((x) => ({ queueID: x.queueID, roleID: x.roleID }));
  return { roleIDs, roleID: roleIDs.length === 1 ? roleIDs[0] : null, queueRoles };
}

export async function cmdResources(zoekterm) {
  const conditions = [
    { field: "isActive", op: "eq", value: true },
    { field: "licenseType", op: "noteq", value: 7 },
  ];
  if (zoekterm) conditions.push({ field: "email", op: "contains", value: zoekterm });
  const items = await atQuery("Resources", conditions);
  // Verrijk elke resource met zijn rol-id('s). Sequentieel — Autotask rate-limt agressief.
  const out = [];
  for (const r of items) {
    const roleRows = await atQuery("ResourceRoles", [
      { field: "resourceID", op: "eq", value: r.id },
      { field: "isActive", op: "eq", value: true },
    ]);
    const { roleIDs, roleID, queueRoles } = summarizeRoles(roleRows);
    out.push({ id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email, roleID, roleIDs, queueRoles });
  }
  return out;
}

export async function cmdCreate(jsonStr, { dryRun = false, impersonateResourceID } = {}) {
  let ticket;
  try {
    ticket = JSON.parse(jsonStr);
  } catch {
    throw new Error("create: ongeldige JSON meegegeven.");
  }
  const required = ["title", "companyID", "status", "priority"];
  for (const f of required) {
    if (ticket[f] === undefined || ticket[f] === null || ticket[f] === "") {
      throw new Error(`create: verplicht veld ontbreekt: ${f}`);
    }
  }
  if (ticket.assignedResourceID != null && ticket.assignedResourceRoleID == null) {
    throw new Error("create: assignedResourceRoleID is verplicht zodra assignedResourceID gezet is.");
  }
  // ImpersonationResourceId zorgt dat het ticket op naam van de opererende medewerker
  // komt i.p.v. het API-integratieaccount. Vereist "Add" op Resource Impersonation
  // (Tickets) in de Autotask API-security-level; anders faalt de create.
  const headers = {};
  if (impersonateResourceID != null && impersonateResourceID !== "") {
    headers.ImpersonationResourceId = String(impersonateResourceID);
  }
  if (dryRun) return { dryRun: true, payload: ticket, impersonateResourceID: impersonateResourceID ?? null };

  const { itemId } = await atFetch("Tickets", { method: "POST", body: ticket, headers });
  const { item } = await atFetch(`Tickets/${itemId}`);
  return { id: itemId, ticketNumber: item?.ticketNumber ?? null };
}

export async function runCommand(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "lookup-company": return cmdLookupCompany(rest[0]);
    case "picklists": return cmdPicklists();
    case "resources": return cmdResources(rest[0]);
    case "create": {
      const dryRun = rest.includes("--dry-run");
      let impersonateResourceID;
      const impIdx = rest.indexOf("--impersonate");
      if (impIdx !== -1) {
        impersonateResourceID = rest[impIdx + 1];
        if (impersonateResourceID === undefined || impersonateResourceID.startsWith("--")) {
          throw new Error("--impersonate vereist een resource-id als volgende argument.");
        }
      }
      const jsonArgs = rest.filter(
        (a, i) => a !== "--dry-run" && a !== "--impersonate" && !(impIdx !== -1 && i === impIdx + 1)
      );
      if (jsonArgs.length !== 1) {
        throw new Error(`create verwacht precies één JSON-argument, kreeg er ${jsonArgs.length}.`);
      }
      return cmdCreate(jsonArgs[0], { dryRun, impersonateResourceID });
    }
    default: throw new Error(`Onbekend commando: ${cmd ?? "(geen)"}`);
  }
}

async function main(argv) {
  const result = await runCommand(argv);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
