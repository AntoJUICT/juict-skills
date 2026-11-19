#!/usr/bin/env node
// Verzamelt de bronnen voor een halfjaarlijkse IT Glue-documentatiecheck. Read-only, geen npm-deps, Node 18+.
//
//   node doccheck-verzamel.mjs --org <itglue-org-id> --company <autotask-company-id> --sinds <YYYY-MM-DD> --uit <map>
//
// Schrijft naar <map>:
//   itglue.json    configuraties, flexible assets (alle types, met archived), domeinen, locaties, documenten,
//                  password-items (alleen naam/categorie/archived/datum, nooit een waarde)
//   tickets.json   Autotask-tickets met activiteit sinds --sinds, met notities en time entries
//   overzicht.txt  compacte tekst om de gap-analyse op te doen (assets zonder auto-sync, configuraties, tickets)
//
// Secrets: ITGLUE_API_KEY en AUTOTASK_USERNAME / AUTOTASK_API_KEY / AUTOTASK_INTEGRATION_CODE / AUTOTASK_ZONE
// uit de omgeving, anders via `az keyvault secret show` op juict-shared-kv. Er wordt nooit een secret geprint.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const ITGLUE_BASE = process.env.ITGLUE_BASE_URL ?? "https://api.eu.itglue.com";
const VAULT = process.env.DOCCHECK_KEYVAULT_NAME ?? "juict-shared-kv";

// Flexible asset types die door een sync gevuld worden. Die horen niet in de handmatige gap-analyse:
// afwijkingen daar los je op in de bron (M365, Rewst), niet in IT Glue.
export const AUTO_TYPES = [/\(auto\)/i, /^Office 365 Licenses$/i, /^Rewst Forms$/i];

// Tickets die nooit documentatie raken. Alleen voor overzicht.txt; tickets.json blijft compleet.
export const RUIS_TITELS = /Wachtwoord wijziging|Device went Offline|Monitor RDS|An account failed to log on|documentatiecheck/i;

export function parseArgs(argv) {
  const uit = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Onbekend argument: ${a}`);
    const waarde = argv[i + 1];
    if (waarde === undefined || waarde.startsWith("--")) throw new Error(`${a} mist een waarde`);
    uit[a.slice(2)] = waarde;
    i++;
  }
  for (const verplicht of ["org", "company", "sinds", "uit"]) {
    if (!uit[verplicht]) throw new Error(`--${verplicht} is verplicht`);
  }
  if (!/^\d+$/.test(uit.org)) throw new Error("--org moet het numerieke IT Glue-organisatie-id zijn (filter[name] matcht alleen exact, zoek het id op)");
  if (!/^\d+$/.test(uit.company)) throw new Error("--company moet het numerieke Autotask-company-id zijn");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(uit.sinds)) throw new Error("--sinds moet de vorm YYYY-MM-DD hebben");
  return uit;
}

// Key Vault-namen zijn 3-24 tekens, letters, cijfers en streepjes. Alles daarbuiten weigeren we,
// en we roepen az aan zonder shell, zodat een vreemde waarde in de omgeving geen commando wordt.
export function controleerVaultNaam(naam) {
  if (!/^[A-Za-z0-9-]{3,24}$/.test(naam)) throw new Error(`Ongeldige Key Vault-naam: ${naam}`);
  return naam;
}

function secret(envNaam, kvNaam) {
  if (process.env[envNaam]) return process.env[envNaam];
  try {
    const args = ["keyvault", "secret", "show", "--vault-name", controleerVaultNaam(VAULT), "--name", kvNaam, "--query", "value", "-o", "tsv"];
    // Op Windows is az een .cmd; die start alleen via de shell. De argumenten zijn hierboven gecontroleerd of vast.
    return execFileSync(process.platform === "win32" ? "az.cmd" : "az", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }).trim();
  } catch {
    throw new Error(`Secret '${kvNaam}' niet beschikbaar: zet ${envNaam} of zorg dat 'az keyvault secret show' op ${VAULT} werkt.`);
  }
}

// AUTOTASK-ZONE staat in de vault als kaal nummer (bijv. "19"), soms als host of volledige URL.
export function autotaskBase(zone) {
  const z = String(zone).trim().replace(/\/+$/, "");
  let base = /^https?:\/\//.test(z) ? z : /^\d+$/.test(z) ? `https://webservices${z}.autotask.net` : `https://${z}`;
  if (!base.includes("/ATServicesRest")) base += "/ATServicesRest";
  return `${base}/V1.0`;
}

export function isAutoType(naam) {
  return AUTO_TYPES.some((re) => re.test(naam));
}

// Tag-velden komen terug als {type, values:[...]}: toon de namen. HTML uit textboxes plat maken.
export function kortVeld(v, max = 400) {
  if (v && typeof v === "object" && Array.isArray(v.values)) return v.values.map((x) => x.name).join(", ");
  return String(v).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function itglueAll(pad, params, key) {
  const uit = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const qs = new URLSearchParams({ ...params, "page[size]": "1000", "page[number]": String(pagina) });
    const r = await fetch(`${ITGLUE_BASE}${pad}?${qs}`, { headers: { "x-api-key": key } });
    if (!r.ok) throw new Error(`IT Glue ${r.status} op ${pad}`);
    const j = await r.json();
    uit.push(...(j.data ?? []));
    if (!j.links?.next) break;
  }
  return uit;
}

async function autotaskQuery(base, headers, entiteit, filter) {
  const body = { filter, MaxRecords: 500 };
  const uit = [];
  let url = `${base}/${entiteit}/query`;
  for (let pagina = 0; url && pagina < 50; pagina++) {
    // Vervolgpagina's: POST met dezelfde body op nextPageUrl. Een GET daarop geeft geen items terug.
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Autotask ${r.status} op ${entiteit}`);
    const j = await r.json();
    uit.push(...(j.items ?? []));
    url = volgendePagina(j.pageDetails?.nextPageUrl, base);
  }
  return uit;
}

// nextPageUrl komt uit de response en we sturen er onze credentials heen. Alleen volgen als het
// dezelfde origin is als de base URL; anders stoppen met een fout in plaats van de headers weg te geven.
export function volgendePagina(next, base) {
  if (!next) return null;
  let doel;
  try {
    doel = new URL(next);
  } catch {
    throw new Error("Autotask gaf een onleesbare nextPageUrl terug; gestopt.");
  }
  if (doel.origin !== new URL(base).origin) {
    throw new Error(`Autotask nextPageUrl wijst naar een andere host (${doel.origin}); niet gevolgd.`);
  }
  return doel.href;
}

async function inBlokken(ids, fn, grootte = 200) {
  const uit = [];
  for (let i = 0; i < ids.length; i += grootte) uit.push(...(await fn(ids.slice(i, i + grootte))));
  return uit;
}

export async function verzamel({ org, company, sinds, uit }) {
  mkdirSync(uit, { recursive: true });

  // IT Glue
  const key = secret("ITGLUE_API_KEY", "itglue-api-key");
  const rel = (r) => itglueAll(`/organizations/${org}/relationships/${r}`, {}, key);
  const itglue = {
    configurations: await rel("configurations"),
    domains: await rel("domains"),
    locations: await rel("locations"),
    documents: (await rel("documents")).map((d) => ({ id: d.id, name: d.attributes.name, archived: d.attributes.archived, updated: d.attributes["updated-at"] })),
    passwords: (await rel("passwords")).map((p) => ({
      id: p.id,
      name: p.attributes.name,
      category: p.attributes["password-category-name"],
      archived: p.attributes.archived,
      updated: p.attributes["updated-at"],
    })),
    flexible_assets: [],
  };
  // filter[organization_id] alleen geeft een lege lijst: per type ophalen.
  for (const t of await itglueAll("/flexible_asset_types", { "filter[enabled]": "true" }, key)) {
    const items = await itglueAll("/flexible_assets", { "filter[flexible_asset_type_id]": t.id, "filter[organization_id]": org }, key);
    for (const i of items) {
      itglue.flexible_assets.push({
        type: t.attributes.name,
        typeId: t.id,
        id: i.id,
        name: i.attributes.name,
        archived: i.attributes.archived,
        updated: i.attributes["updated-at"],
        traits: i.attributes.traits,
      });
    }
  }
  writeFileSync(join(uit, "itglue.json"), JSON.stringify(itglue, null, 1));

  // Autotask
  const base = autotaskBase(secret("AUTOTASK_ZONE", "AUTOTASK-ZONE"));
  const headers = {
    UserName: secret("AUTOTASK_USERNAME", "AUTOTASK-USERNAME"),
    Secret: secret("AUTOTASK_API_KEY", "AUTOTASK-API-KEY"),
    ApiIntegrationCode: secret("AUTOTASK_INTEGRATION_CODE", "AUTOTASK-INTEGRATION-CODE"),
    "Content-Type": "application/json",
  };
  const tickets = await autotaskQuery(base, headers, "Tickets", [
    { op: "eq", field: "companyID", value: Number(company) },
    { op: "gte", field: "lastActivityDate", value: `${sinds}T00:00:00Z` },
  ]);
  const ids = tickets.map((t) => t.id);
  const notes = await inBlokken(ids, (blok) => autotaskQuery(base, headers, "TicketNotes", [{ op: "in", field: "ticketID", value: blok }]));
  const tijd = await inBlokken(ids, (blok) => autotaskQuery(base, headers, "TimeEntries", [{ op: "in", field: "ticketID", value: blok }]));
  const ticketsUit = tickets
    .sort((a, b) => a.createDate.localeCompare(b.createDate))
    .map((t) => ({
      nr: t.ticketNumber,
      id: t.id,
      title: t.title,
      status: t.status,
      created: t.createDate.slice(0, 10),
      completed: (t.completedDate ?? "").slice(0, 10),
      description: t.description ?? "",
      resolution: t.resolution ?? "",
      notes: notes.filter((n) => n.ticketID === t.id).map((n) => ({ date: n.createDateTime.slice(0, 10), title: n.title ?? "", text: n.description ?? "" })),
      time: tijd.filter((e) => e.ticketID === t.id).map((e) => ({ date: e.dateWorked.slice(0, 10), summary: e.summaryNotes ?? "", internal: e.internalNotes ?? "" })),
    }));
  writeFileSync(join(uit, "tickets.json"), JSON.stringify(ticketsUit, null, 1));

  writeFileSync(join(uit, "overzicht.txt"), overzicht(itglue, ticketsUit, sinds), "utf8");
  return { assets: itglue.flexible_assets.length, configuraties: itglue.configurations.length, tickets: ticketsUit.length };
}

export function overzicht(itglue, tickets, sinds) {
  const r = [];
  r.push(`# Flexible assets (zonder auto-sync types)`);
  const handmatig = itglue.flexible_assets.filter((f) => !isAutoType(f.type)).sort((a, b) => `${a.type}${a.name}`.localeCompare(`${b.type}${b.name}`));
  for (const f of handmatig) {
    r.push(`## [${f.type}] ${f.name} (id ${f.id}, bijgewerkt ${String(f.updated).slice(0, 10)}${f.archived ? ", GEARCHIVEERD" : ""})`);
    for (const [k, v] of Object.entries(f.traits ?? {})) {
      if (v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
      r.push(`   ${k}: ${kortVeld(v)}`);
    }
  }
  r.push(``, `# Configuraties`);
  for (const c of itglue.configurations) {
    const a = c.attributes;
    r.push(`${a.name} | ${a["configuration-type-name"]} | ${a["configuration-status-name"]} | ${a["primary-ip"] ?? ""} | archived=${a.archived} | bijgewerkt ${String(a["updated-at"]).slice(0, 10)} | id ${c.id}`);
  }
  r.push(``, `# Domeinen`, ...itglue.domains.map((d) => `${d.attributes.name} | verloopt ${d.attributes["expires-on"] ?? "onbekend"}`));
  r.push(``, `# Documenten`, ...itglue.documents.map((d) => `${d.name} | archived=${d.archived} | bijgewerkt ${String(d.updated).slice(0, 10)}`));
  r.push(``, `# Password-items (alleen namen)`, ...itglue.passwords.map((p) => `${p.name} | ${p.category ?? ""} | archived=${p.archived} | bijgewerkt ${String(p.updated).slice(0, 10)}`));
  r.push(``, `# Tickets sinds ${sinds} (ruis weggelaten)`);
  for (const t of tickets) {
    if (RUIS_TITELS.test(t.title)) continue;
    const laatste = t.resolution || t.time.at(-1)?.summary || t.notes.at(-1)?.text || "";
    r.push(`${t.nr} | ${t.created} | ${t.title.slice(0, 90)} || ${laatste.replace(/\s+/g, " ").slice(0, 350)}`);
  }
  return r.join("\n") + "\n";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const opties = parseArgs(process.argv.slice(2));
    const res = await verzamel(opties);
    console.log(`Klaar: ${res.assets} flexible assets, ${res.configuraties} configuraties, ${res.tickets} tickets -> ${opties.uit}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
