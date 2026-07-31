# itglue-api skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een org-brede Claude Code skill `itglue-api` in de marketplace `AntoJUICT/juict-skills` die de IT Glue REST API documenteert, een kopieerbare TypeScript-client levert en een read-only lookup-CLI biedt, waarbij wachtwoordwaarden codematig onbereikbaar zijn en een wachtwoordvraag alleen een deeplink oplevert.

**Architecture:** Zelfde vorm als de bestaande `autotask-api` plugin: `plugins/itglue-api/{.claude-plugin/plugin.json, skills/itglue-api/}` met SKILL.md als instap, REFERENCE.md en LESSONS.md als kennislagen, en `scripts/` met drie bestanden. De lookup-CLI is een dependency-vrij `.mjs` bestand met pure helpers die los getest worden en een netwerklaag die een injecteerbare `fetchImpl` accepteert, zodat alle tests offline draaien. De TypeScript-client is bedoeld om naar projecten te kopiëren en gebruikt Key Vault via `DefaultAzureCredential`.

**Tech Stack:** Node 18+ (ingebouwde `fetch`, `node:test`, `node:assert/strict`), geen npm-dependencies in de `.mjs` scripts. TypeScript-client vereist `@azure/keyvault-secrets` en `@azure/identity` in het doelproject. Azure CLI (`az`) voor de lokale secret-fallback.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-itglue-api-skill-design.md`. Bij twijfel is de spec leidend.
- Branch: `feature/itglue-api-skill`. Nooit direct op `main` committen, nooit force-pushen. PR naar `main` pas voorstellen na akkoord van de gebruiker.
- **De skill is read-only.** Geen POST, PATCH, PUT of DELETE tegen IT Glue in enige regel code, ook niet uitgecommentarieerd als voorbeeld.
- **Individuele password-resource is verboden.** `GET /passwords/{id}` en elke querystring met `show_password` worden geweigerd door `assertPathAllowed()` vóór er een request uitgaat, in zowel de `.mjs` CLI als de TypeScript-client.
- **Wachtwoord-output is precies twee velden per treffer:** `naam` en `link`. Nooit `username`, `password`, `otp-enabled`, categorie of het url-veld van het onderliggende systeem.
- Deeplink-basis: `https://juict.eu.itglue.com`, override via env var `ITGLUE_PORTAL_URL`.
- API-basis: `https://api.eu.itglue.com`, override via env var `ITGLUE_BASE_URL`. Auth via header `x-api-key`, `Content-Type: application/vnd.api+json`.
- Secret: Key Vault `juict-shared-kv`, secret-naam `itglue-api-key` (lowercase, met streepjes). Lokale env var: `ITGLUE_API_KEY`.
- **Nooit een secretwaarde printen, loggen of naar een bestand schrijven.** Foutmeldingen gaan door `redactSecrets()`.
- Comments en gebruikersuitvoer in het Nederlands, in dezelfde directe toon als de bestaande scripts. Geen em-dashes.
- Tests draaien met `node --test` en mogen geen netwerk of `az` nodig hebben.
- Alle bestandspaden hieronder zijn relatief aan `C:\Users\AntoteLintelo\ClaudeProjects\juict-skills`.

---

### Task 1: Plugin-skelet, marketplace-entry en API-brondocumentatie

**Files:**
- Create: `plugins/itglue-api/.claude-plugin/plugin.json`
- Create: `plugins/itglue-api/skills/itglue-api/SKILL.md` (voorlopige stub, in Task 6 definitief)
- Modify: `.claude-plugin/marketplace.json` (plugins-array uitbreiden)
- Create (voorwaardelijk): `plugins/itglue-api/skills/itglue-api/itglue-openapi.yaml`
- Test: `plugins/itglue-api/skills/itglue-api/scripts/plugin-structuur.test.mjs`

**Interfaces:**
- Consumes: niets.
- Produces: de mapstructuur `plugins/itglue-api/skills/itglue-api/scripts/` waar Task 2 tot 6 in schrijven. Marketplace-entry met `"name": "itglue-api"` en `"source": "./plugins/itglue-api"`.

- [ ] **Step 1: Licentie van de OpenAPI-bron controleren**

De spec wil de OpenAPI-spec meebundelen. `juict-skills` is een publieke repo, dus dat mag alleen als de bron een licentie heeft die herdistributie toestaat.

```bash
gh api repos/jmaddington/ITG-Glue-OpenAPI --jq '{license: .license.spdx_id, default_branch: .default_branch}'
gh api repos/jmaddington/ITG-Glue-OpenAPI/contents --jq '.[].name'
```

Beslisregel:
- Licentie is MIT, Apache-2.0, BSD, CC0 of Unlicense → bundelen mag. Ga naar Step 2.
- Licentie is `null` of onduidelijk → **niet bundelen**. Sla Step 2 over, en noteer in Step 3 van Task 5 een verwijzing naar `https://api.itglue.com/developer/` plus de GitHub-URL in plaats van een gebundeld bestand. Meld dit expliciet aan de gebruiker in het eindrapport van deze taak.

- [ ] **Step 2: OpenAPI-spec ophalen (alleen als Step 1 dat toestaat)**

Gebruik de bestandsnaam die Step 1 opleverde (bijvoorbeeld `openapi.yaml`):

```bash
mkdir -p plugins/itglue-api/skills/itglue-api
curl -sSL -o plugins/itglue-api/skills/itglue-api/itglue-openapi.yaml \
  "https://raw.githubusercontent.com/jmaddington/ITG-Glue-OpenAPI/main/<bestandsnaam-uit-step-1>"
head -5 plugins/itglue-api/skills/itglue-api/itglue-openapi.yaml
wc -c plugins/itglue-api/skills/itglue-api/itglue-openapi.yaml
```

Verwacht: een `openapi:` of `swagger:` sleutel in de eerste regels en een bestand groter dan 10 kB. Krijg je HTML of een bestand kleiner dan 1 kB, dan was de URL fout: corrigeer de bestandsnaam of tak en probeer opnieuw. Voeg bovenaan het bestand geen eigen regels toe; de herkomst en licentie komen in REFERENCE.md (Task 5).

- [ ] **Step 3: Schrijf de falende structuurtest**

Create `plugins/itglue-api/skills/itglue-api/scripts/plugin-structuur.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");

test("plugin.json is geldig en heet itglue-api", () => {
  const pad = resolve(repoRoot, "plugins/itglue-api/.claude-plugin/plugin.json");
  const plugin = JSON.parse(readFileSync(pad, "utf-8"));
  assert.equal(plugin.name, "itglue-api");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20, "description moet inhoudelijk zijn");
});

test("marketplace.json bevat een itglue-api entry die naar de plugin-map wijst", () => {
  const pad = resolve(repoRoot, ".claude-plugin/marketplace.json");
  const markt = JSON.parse(readFileSync(pad, "utf-8"));
  const entry = markt.plugins.find((p) => p.name === "itglue-api");
  assert.ok(entry, "itglue-api ontbreekt in marketplace.json");
  assert.equal(entry.source, "./plugins/itglue-api");
  assert.ok(existsSync(resolve(repoRoot, "plugins/itglue-api")), "plugin-map bestaat niet");
});

test("SKILL.md heeft frontmatter met name en description", () => {
  const pad = resolve(repoRoot, "plugins/itglue-api/skills/itglue-api/SKILL.md");
  const inhoud = readFileSync(pad, "utf-8");
  assert.match(inhoud, /^---\r?\nname: itglue-api\r?\n/);
  assert.match(inhoud, /\ndescription: .{40,}/);
});
```

- [ ] **Step 4: Draai de test en controleer dat hij faalt**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/plugin-structuur.test.mjs`
Expected: FAIL, met `ENOENT` op `plugins/itglue-api/.claude-plugin/plugin.json`.

- [ ] **Step 5: Maak plugin.json**

Create `plugins/itglue-api/.claude-plugin/plugin.json`:

```json
{
  "name": "itglue-api",
  "version": "1.0.0",
  "description": "Werken met de IT Glue REST API in JUICT-projecten — Key Vault-auth, read-only lookups, endpoints en valkuilen. Wachtwoordwaarden worden nooit opgehaald; bij een wachtwoordvraag levert de skill alleen een deeplink.",
  "author": {
    "name": "AntoJUICT",
    "email": "anto@juict.nl"
  },
  "homepage": "https://github.com/AntoJUICT/juict-skills",
  "repository": "https://github.com/AntoJUICT/juict-skills",
  "keywords": ["itglue", "api", "rest", "keyvault", "documentatie", "juict"]
}
```

- [ ] **Step 6: Maak de SKILL.md stub**

Create `plugins/itglue-api/skills/itglue-api/SKILL.md`:

```markdown
---
name: itglue-api
description: Werken met de IT Glue REST API in JUICT-projecten — auth via Azure Key Vault, base URL en regio, read-only endpoints, datastructuren en valkuilen. Gebruik wanneer je IT Glue-organisaties, configuraties, contacten, locaties, documenten of flexible assets opvraagt, een IT Glue-client opzet, of een IT Glue API-fout debugt. Wachtwoordwaarden komen nooit uit de API; bij een wachtwoordvraag levert deze skill alleen een deeplink naar het juiste item.
---

# IT Glue REST API (JUICT)

Definitieve inhoud volgt in Task 6 van het implementatieplan.
```

- [ ] **Step 7: Voeg de marketplace-entry toe**

Modify `.claude-plugin/marketplace.json`: voeg als laatste element van de `plugins`-array toe, na de `site-scraper`-entry (let op de komma achter het accolade-sluit van `site-scraper`):

```json
    {
      "name": "itglue-api",
      "source": "./plugins/itglue-api",
      "description": "Werken met de IT Glue REST API in JUICT-projecten — Key Vault-auth, read-only lookups, endpoints en valkuilen; wachtwoorden alleen als deeplink."
    }
```

- [ ] **Step 8: Draai de test en controleer dat hij slaagt**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/plugin-structuur.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
git add plugins/itglue-api .claude-plugin/marketplace.json
git commit -m "feat(itglue-api): plugin-skelet en marketplace-entry

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers van de lookup-CLI

**Files:**
- Create: `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs`
- Test: `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`

**Interfaces:**
- Consumes: de mapstructuur uit Task 1.
- Produces, allemaal named exports uit `itglue-lookup.mjs`:
  - `normalizeOrgName(naam: string): string`
  - `pickExactOrg(orgs: object[], zoekterm: string): { match: object|null, kandidaten: object[] }`
  - `assertPathAllowed(path: string): string` — gooit `Error` bij een verboden pad, geeft anders het pad terug
  - `passwordDeeplink(orgId: string|number, passwordId: string|number, portal?: string): string`
  - `passwordTreffers(items: object[], orgId: string|number, zoekterm?: string, portal?: string): Array<{ naam: string, link: string }>`
  - `buildQuery(filters?: object, opties?: { pageSize?: number, pageNumber?: number }): string`
  - `redactSecrets(tekst: string, key: string): string`

- [ ] **Step 1: Schrijf de falende tests**

Create `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Draai de tests en controleer dat ze falen**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`
Expected: FAIL met `ERR_MODULE_NOT_FOUND` voor `./itglue-lookup.mjs`.

- [ ] **Step 3: Schrijf de helpers**

Create `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs`:

```javascript
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
    .replace(/[\u2018\u2019']/g, "")
    .replace(RECHTSVORMEN, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function pickExactOrg(orgs, zoekterm) {
  const doel = normalizeOrgName(zoekterm);
  const exact = (orgs ?? []).filter((o) => normalizeOrgName(o?.attributes?.name) === doel);
  if (exact.length === 1) return { match: exact[0], kandidaten: [] };
  return { match: null, kandidaten: exact.length > 1 ? exact : (orgs ?? []) };
}

// Individuele password-resource: /passwords/{id}. Collecties en de relationships-variant
// eindigen op "passwords" en hebben dus geen segment erna.
const VERBODEN_PASSWORD_PAD = /(^|\/)passwords\/[^/#]+/i;

export function assertPathAllowed(path) {
  const p = String(path ?? "");
  const padZonderQuery = p.split("?")[0];
  if (VERBODEN_PASSWORD_PAD.test(padZonderQuery)) {
    throw new Error(
      "Geblokkeerd: de individuele password-resource mag niet opgevraagd worden. " +
        "Onze API-key heeft geen password-access. Gebruik het collectie-endpoint om het " +
        "item te vinden en lever de deeplink via passwordDeeplink()."
    );
  }
  if (/show_password/i.test(p)) {
    throw new Error("Geblokkeerd: de parameter show_password is niet toegestaan.");
  }
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
```

- [ ] **Step 4: Draai de tests en controleer dat ze slagen**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`
Expected: PASS, 17 tests. Faalt `normalizeOrgName("Bvlgari")`, dan staat `\b` verkeerd in `RECHTSVORMEN`: controleer dat het patroon `\b(...)\b` gebruikt en niet een losse alternatie.

- [ ] **Step 5: Commit**

```bash
git add plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs
git commit -m "feat(itglue-api): pure helpers met harde blokkade op password-resource

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Netwerklaag en paginatie van de lookup-CLI

**Files:**
- Modify: `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs` (toevoegen onder de helpers uit Task 2)
- Modify: `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs` (tests toevoegen)

**Interfaces:**
- Consumes: `assertPathAllowed`, `buildQuery`, `redactSecrets`, `BASE_URL` uit Task 2.
- Produces:
  - `igFetch(path: string, opts: { key: string, baseUrl?: string, fetchImpl?: typeof fetch, sleepImpl?: (ms: number) => Promise<void>, retries?: number }): Promise<object>` — geeft de geparseerde JSON:API-body terug
  - `fetchAllItGlue(resource: string, opts: { key: string, filters?: object, pageSize?: number, maxPages?: number, baseUrl?: string, fetchImpl?: typeof fetch, sleepImpl?: (ms: number) => Promise<void> }): Promise<object[]>` — geeft de samengevoegde `data`-array terug

- [ ] **Step 1: Schrijf de falende tests**

Voeg toe aan `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`. Breid de import bovenaan uit met `igFetch` en `fetchAllItGlue`, en zet dit blok onder de bestaande tests:

```javascript
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
```

- [ ] **Step 2: Draai de tests en controleer dat ze falen**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`
Expected: FAIL, `igFetch is not a function` of een `SyntaxError` over een ontbrekende export.

- [ ] **Step 3: Schrijf de netwerklaag**

Voeg toe aan `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs`, onder de helpers:

```javascript
const standaardSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
```

- [ ] **Step 4: Draai de tests en controleer dat ze slagen**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`
Expected: PASS, 25 tests (17 uit Task 2 plus 8 nieuwe). Faalt de `filter%5B`-assertie, dan encodeert `URLSearchParams` de blokhaken anders dan verwacht: pas de assertie aan de werkelijke encoding aan, niet de implementatie.

- [ ] **Step 5: Commit**

```bash
git add plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs
git commit -m "feat(itglue-api): netwerklaag met paginatie en 429-retry

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CLI-subcommands en key-resolutie

**Files:**
- Modify: `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs`
- Modify: `plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`

**Interfaces:**
- Consumes: alles uit Task 2 en 3.
- Produces:
  - `getApiKey(): string` — env var `ITGLUE_API_KEY`, anders `az keyvault secret show --vault-name juict-shared-kv --name itglue-api-key`
  - `resolveOrg(zoekterm: string, opts: object): Promise<object>` — gooit een fout met kandidatenlijst als er geen unieke match is
  - `formatTabel(rijen: object[], kolommen: string[]): string`
  - `runSubcommand(argv: string[], opts: object): Promise<{ soort: string, rijen: object[] }>` — pure dispatch, gebruikt de injecteerbare `fetchImpl`
  - CLI-entry via `import.meta.url`-check, met `--json` vlag

- [ ] **Step 1: Schrijf de falende tests**

Voeg toe aan `itglue-lookup.test.mjs`. Breid de import uit met `resolveOrg`, `formatTabel` en `runSubcommand`:

```javascript
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
```

- [ ] **Step 2: Draai de tests en controleer dat ze falen**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`
Expected: FAIL, `resolveOrg is not a function`.

- [ ] **Step 3: Schrijf de subcommands**

Voeg toe aan `itglue-lookup.mjs`. Zet de `execSync`-import bovenaan bij de andere imports:

```javascript
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

export async function resolveOrg(zoekterm, opts) {
  const term = String(zoekterm ?? "").trim();
  if (!term) throw new Error("Geef een organisatie op (naam of id).");
  if (/^\d+$/.test(term)) return { id: term, attributes: { name: `organisatie ${term}` } };

  const orgs = await fetchAllItGlue("organizations", { ...opts, filters: { name: term } });
  const { match, kandidaten } = pickExactOrg(orgs, term);
  if (match) return match;

  const lijst = kandidaten
    .slice(0, 15)
    .map((o) => `  ${o.id}  ${o.attributes?.name ?? "(naamloos)"}`)
    .join("\n");
  throw new Error(
    `Geen unieke organisatie voor "${term}". Kandidaten:\n${lijst}\n` +
      "Herhaal het commando met het id in plaats van de naam."
  );
}

const SUBCOMMANDS = ["org", "configs", "contacts", "docs", "assets", "password-link"];

export async function runSubcommand(argv, opts) {
  const [subcommando, ...rest] = argv;
  if (!SUBCOMMANDS.includes(subcommando)) {
    throw new Error(`Onbekend subcommando "${subcommando ?? ""}". Geldig: ${SUBCOMMANDS.join(", ")}.`);
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
    const assetFilters = { organization_id: org.id };
    if (rest[1]) assetFilters["flexible-asset-type-id"] = rest[1];
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

  // password-link: collectie ophalen om het item te vinden, daarna alleen naam en link.
  const items = await fetchAllItGlue("passwords", { ...opts, filters });
  return { soort: "password-link", rijen: passwordTreffers(items, org.id, zoekterm) };
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

const GEBRUIK = `Gebruik: node itglue-lookup.mjs <subcommando> <organisatie> [zoekterm] [--json]

  org <naam>                     organisaties zoeken op naam
  configs <org> [zoekterm]       configuraties (servers, netwerk, endpoints)
  contacts <org> [zoekterm]      contacten
  docs <org> [zoekterm]          documenten met deeplink
  assets <org> [asset-type-id]   flexible assets
  password-link <org> <term>     naam en deeplink van een wachtwoord-item

Read-only. Wachtwoordwaarden worden nooit opgehaald: password-link geeft
alleen de naam van het item en een link naar IT Glue.`;

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--json");
  const alsJson = process.argv.includes("--json");
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(GEBRUIK);
    return;
  }
  const { soort, rijen } = await runSubcommand(argv, { key: getApiKey() });
  if (alsJson) {
    console.log(JSON.stringify(rijen, null, 2));
    return;
  }
  console.log(formatTabel(rijen, KOLOMMEN[soort]));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Draai de tests en controleer dat ze slagen**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs`
Expected: PASS, 34 tests (25 uit Task 3 plus 9 nieuwe).

- [ ] **Step 5: Controleer dat de CLI-help werkt zonder key**

Run: `node plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs --help`
Expected: het gebruiksoverzicht, exitcode 0, geen `az`-aanroep en geen foutmelding.

- [ ] **Step 6: Commit**

```bash
git add plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.mjs plugins/itglue-api/skills/itglue-api/scripts/itglue-lookup.test.mjs
git commit -m "feat(itglue-api): read-only lookup-subcommands en CLI-entry

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Kopieerbare TypeScript-client

**Files:**
- Create: `plugins/itglue-api/skills/itglue-api/scripts/azure-keyvault.ts`
- Create: `plugins/itglue-api/skills/itglue-api/scripts/itglue-client.ts`
- Create: `plugins/itglue-api/skills/itglue-api/scripts/itglue-client-guard.test.mjs`

**Interfaces:**
- Consumes: het blokkade-idee en de padregels uit Task 2 (dezelfde regex en dezelfde foutmelding).
- Produces, exports uit `itglue-client.ts`: `itglueFetch<T>(path, options?)`, `fetchAllItGlue<T>(resource, opts?)`, `buildFilterQuery(filters)`, `passwordDeeplink(orgId, passwordId)`, `assertPathAllowed(path)`.

- [ ] **Step 1: Kopieer de Key Vault-helper**

`azure-keyvault.ts` is identiek aan die van `autotask-api` (zelfde `getSecret` met 1u-cache). Kopieer hem in plaats van hem opnieuw te typen:

```bash
cp plugins/autotask-api/skills/autotask-api/scripts/azure-keyvault.ts \
   plugins/itglue-api/skills/itglue-api/scripts/azure-keyvault.ts
```

- [ ] **Step 2: Schrijf de falende guard-test**

De TypeScript-client wordt in deze repo niet gecompileerd, dus de test controleert wat er zonder toolchain te controleren valt: dat de blokkade aanwezig is en dat er geen schrijfmethodes in staan.

Create `plugins/itglue-api/skills/itglue-api/scripts/itglue-client-guard.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(resolve(here, "itglue-client.ts"), "utf-8");

test("client blokkeert de individuele password-resource", () => {
  assert.match(client, /assertPathAllowed/);
  assert.match(client, /Geblokkeerd/);
  assert.match(client, /passwords\\\/\[\^\/#\]\+/);
});

test("client doet geen schrijfacties", () => {
  for (const methode of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.ok(!client.includes(`"${methode}"`), `${methode} hoort niet in een read-only client`);
  }
});

test("client gebruikt de juiste secretnaam en headers", () => {
  assert.match(client, /itglue-api-key/);
  assert.match(client, /x-api-key/);
  assert.match(client, /application\/vnd\.api\+json/);
});

test("client heeft geen hardcoded key of vault-secretwaarde", () => {
  assert.ok(!/ITG\.[A-Za-z0-9]{10,}/.test(client), "lijkt een echte IT Glue key te bevatten");
});
```

- [ ] **Step 3: Draai de test en controleer dat hij faalt**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/itglue-client-guard.test.mjs`
Expected: FAIL met `ENOENT` op `itglue-client.ts`.

- [ ] **Step 4: Schrijf de client**

Create `plugins/itglue-api/skills/itglue-api/scripts/itglue-client.ts`:

```typescript
import { getSecret } from "./azure-keyvault";

// IT Glue REST API client (read-only) met Key Vault-auth in productie en env-var
// fallback lokaal. Zie REFERENCE.md voor endpoints en LESSONS.md voor valkuilen.
//
// Harde regel: wachtwoordwaarden worden niet opgehaald. Onze API-key heeft geen
// password-access, en een wachtwoordwaarde in logs of een transcript is een incident.
// Gebruik passwordDeeplink() en lever een link naar IT Glue.

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
    next(); // slot wordt direct doorgegeven — activeSlots blijft gelijk
  } else {
    activeSlots--;
  }
}

const VERBODEN_PASSWORD_PAD = /(^|\/)passwords\/[^/#]+/i;

export function assertPathAllowed(path: string): string {
  const padZonderQuery = String(path).split("?")[0];
  if (VERBODEN_PASSWORD_PAD.test(padZonderQuery)) {
    throw new Error(
      "Geblokkeerd: de individuele password-resource mag niet opgevraagd worden. " +
        "Onze API-key heeft geen password-access. Gebruik het collectie-endpoint om het " +
        "item te vinden en lever de deeplink via passwordDeeplink()."
    );
  }
  if (/show_password/i.test(String(path))) {
    throw new Error("Geblokkeerd: de parameter show_password is niet toegestaan.");
  }
  return path;
}

export function passwordDeeplink(orgId: string | number, passwordId: string | number): string {
  if (!orgId || !passwordId) throw new Error("passwordDeeplink vereist orgId en passwordId");
  return `${PORTAL_URL.replace(/\/+$/, "")}/${orgId}/passwords/${passwordId}`;
}

let cachedKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  if (process.env.AZURE_KEYVAULT_URL) {
    cachedKey = await getSecret("itglue-api-key");
    return cachedKey;
  }
  const key = process.env.ITGLUE_API_KEY;
  if (!key) {
    throw new Error(
      "IT Glue key ontbreekt: stel AZURE_KEYVAULT_URL in (productie, secret 'itglue-api-key' " +
        "in juict-shared-kv) of ITGLUE_API_KEY (lokaal)."
    );
  }
  cachedKey = key;
  return cachedKey;
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
  filters: Record<string, string | number | undefined>,
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

export async function itglueFetch<T>(path: string, { retries = 3 }: { retries?: number } = {}): Promise<T> {
  assertPathAllowed(path);
  const key = await getApiKey();
  const pad = path.startsWith("/") ? path : `/${path}`;
  const url = `${BASE_URL.replace(/\/+$/, "")}${pad}`;

  for (let poging = 0; ; poging++) {
    await acquireSlot();
    let response: Response;
    try {
      response = await fetch(url, {
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

export async function fetchAllItGlue<A = Record<string, unknown>>(
  resource: string,
  {
    filters = {},
    pageSize = 100,
    maxPages = 50,
  }: {
    filters?: Record<string, string | number | undefined>;
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
```

- [ ] **Step 5: Draai alle tests**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/`
Expected: PASS, alle testbestanden groen: 3 (plugin-structuur) plus 34 (lookup) plus 4 (guard) is 41 tests.

Faalt de regex-assertie in de guard-test, vergelijk dan de exacte tekens: de test zoekt de letterlijke broncode `passwords\/[^/#]+`, dus in de test staat die backslash dubbel ontsnapt. Pas de assertie aan als de client de regex net anders schrijft, zolang de blokkade in gedrag gelijk blijft aan `assertPathAllowed` in de `.mjs`.

- [ ] **Step 6: Commit**

```bash
git add plugins/itglue-api/skills/itglue-api/scripts/azure-keyvault.ts plugins/itglue-api/skills/itglue-api/scripts/itglue-client.ts plugins/itglue-api/skills/itglue-api/scripts/itglue-client-guard.test.mjs
git commit -m "feat(itglue-api): kopieerbare read-only TypeScript-client

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Live verificatieronde, REFERENCE.md en LESSONS.md

**Files:**
- Create: `plugins/itglue-api/skills/itglue-api/REFERENCE.md`
- Create: `plugins/itglue-api/skills/itglue-api/LESSONS.md`

**Interfaces:**
- Consumes: de werkende CLI uit Task 4 (`itglue-lookup.mjs`).
- Produces: de twee kennisbestanden waar SKILL.md in Task 7 naar verwijst.

- [ ] **Step 1: Vraag de gebruiker om de verificatieronde goed te keuren**

De CLI haalt de key via `az keyvault secret show` uit `juict-shared-kv`. Die aanroep kan een permissieprompt geven. Meld voor je begint: "Ik doe nu read-only GET's op organizations, configurations, contacts, locations, flexible_assets en documents om de referentie te verifiëren. `/passwords/{id}` raak ik niet aan en de key komt nergens in beeld." Wacht op akkoord.

- [ ] **Step 2: Voer de read-only verificatieronde uit**

Draai deze commando's en noteer per commando: werkt het endpoint, hoe heet het filter, en welke attribuutsleutels komen terug.

```bash
cd plugins/itglue-api/skills/itglue-api/scripts
node itglue-lookup.mjs org "JUICT" --json
node itglue-lookup.mjs configs <org-id> --json
node itglue-lookup.mjs contacts <org-id> --json
node itglue-lookup.mjs docs <org-id> --json
node itglue-lookup.mjs assets <org-id> --json
node itglue-lookup.mjs password-link <org-id> "" --json
```

Let op deze punten en noteer het feitelijke antwoord:
- Heet de flexible-assets-resource `flexible_assets` of `flexible-assets`? Als `flexible_assets` een 404 geeft, probeer de streepjesvariant en pas `runSubcommand` aan. Datzelfde geldt voor `documents`.
- Geeft `password-link` daadwerkelijk items terug, of blokkeert IT Glue ook het collectie-endpoint? Bij een 403 is dat een belangrijke les voor LESSONS.md, en dan moet SKILL.md vertellen dat de collega het item zelf in de portal moet zoeken via `https://juict.eu.itglue.com`.
- Wat staat er in `meta` bij paginatie (`next-page`, `current-page`, `total-count`)? Als de sleutel anders heet dan `next-page`, werkt `fetchAllItGlue` maar één pagina: repareer dat en voeg een test toe met de echte sleutelnaam.
- Wat is de maximale `page[size]` die geaccepteerd wordt? Test 1000 en noteer wat er gebeurt.

Werkt een subcommando niet, repareer het in `itglue-lookup.mjs`, breid de tests uit met de werkelijke responsvorm, en commit die fix apart voordat je verder gaat.

- [ ] **Step 3: Schrijf REFERENCE.md**

Create `plugins/itglue-api/skills/itglue-api/REFERENCE.md`. Vul de endpoint-tabel met wat Step 2 opleverde. Markeer elke regel met ✅ plus datum (zelf geverifieerd) of 📄 (alleen documentatie). Structuur:

```markdown
# IT Glue API Reference

Referentie voor de IT Glue REST API zoals JUICT die gebruikt: base URL, auth, JSON:API-vorm, paginatie, filters en de resources die we read-only aanspreken.

Markering: ✅ zelf geverifieerd met datum, 📄 alleen uit documentatie of de OpenAPI-spec.

## Base URL en regio

| Regio | Base URL |
|---|---|
| EU (JUICT) | `https://api.eu.itglue.com` |
| US | `https://api.itglue.com` |

Override met `ITGLUE_BASE_URL`. Portal voor deeplinks: `https://juict.eu.itglue.com`, override met `ITGLUE_PORTAL_URL`.

## Authenticatie

...header x-api-key, Content-Type application/vnd.api+json, Key Vault juict-shared-kv / itglue-api-key,
access policies in plaats van RBAC, lokale env var ITGLUE_API_KEY...

## JSON:API-vorm

...data[] met id/type/attributes, attributes in kebab-case, meta met paginatie...

## Paginatie

...page[size], page[number], meta.next-page, gemeten maximum page size...

## Filters

...filter[name] matcht breed, filter[organization_id], filter[flexible-asset-type-id]...

## Resources

| Resource | Pad | Status |
|---|---|---|
| Organisaties | `GET /organizations?filter[name]=` | ✅ 2026-07-21 |
| ... | ... | ... |

## Wachtwoorden

Alleen het collectie-endpoint, uitsluitend om een item te vinden. De individuele
resource is codematig geblokkeerd. Output is naam plus deeplink.

## Bronnen

...api.itglue.com/developer, en de OpenAPI-spec: gebundeld als itglue-openapi.yaml
met herkomst en licentie, of een verwijzing naar github.com/jmaddington/ITG-Glue-OpenAPI
als bundelen niet mocht (zie Task 1, Step 1)...
```

Schrijf de secties uit met de feitelijke waarden uit Step 2. Laat geen sectie als kopje-zonder-inhoud staan.

- [ ] **Step 4: Schrijf LESSONS.md**

Create `plugins/itglue-api/skills/itglue-api/LESSONS.md` met deze lessen, plus wat Step 2 opleverde:

```markdown
# IT Glue API — Lessons Learned

Bekende valkuilen bij de IT Glue REST API. Voeg nieuwe lessen toe na elk project.

---

## Wachtwoorden

**Wachtwoordwaarden zijn niet beschikbaar en worden niet opgehaald.** Collectie-endpoints
(`GET /passwords?filter[organization_id]=`, `GET /organizations/{id}/relationships/passwords`)
geven password-items terug zonder het `password`-veld, ook met `?show_password=true`
(geverifieerd 2026-07-21). De individuele resource `GET /passwords/{id}` leverde die waarde
in juli 2026 nog wel, maar password-access staat inmiddels uit op onze key. De skill
blokkeert dat pad daarom codematig: lever de deeplink
`https://juict.eu.itglue.com/<org-id>/passwords/<id>` en laat de collega zelf inloggen.

**TOTP-seed is niet beschikbaar via de API.** Attributes bevatten alleen `otp-enabled`
(boolean), geen seedveld. Onbemande TOTP-flows op basis van IT Glue kunnen dus niet.

---

## Velden en filters

**Attribuutsleutels zijn JSON:API kebab-case** (`organization-id`, `password-category-name`,
`otp-enabled`), behalve `username` en `password` (plain).

**`filter[name]` matcht breed.** `GET /organizations?filter[name]=jansen` geeft ook
gedeeltelijke treffers. Normaliseer client-side en vergelijk exact op de genormaliseerde
naam: rechtsvormsuffixen (B.V., BV, Holding) verschillen vaak tussen bronnen. Zie
`normalizeOrgName()` in `scripts/itglue-lookup.mjs`.

---

## Paginatie en rate limiting

...vullen met de gemeten waarden uit de verificatieronde: sleutelnaam voor next-page,
maximale page[size], gedrag bij 429 en of retry-after meekomt...
```

- [ ] **Step 5: Controleer dat er geen geheimen in de documentatie staan**

```bash
grep -rniE "ITG\.[A-Za-z0-9]{10,}|api-key: [A-Za-z0-9]{10,}" plugins/itglue-api/ || echo "geen key-achtige strings gevonden"
```

Expected: `geen key-achtige strings gevonden`. Staat er wel iets, verwijder het en controleer of het al gecommit is; in dat geval direct melden aan de gebruiker, want dan moet de key geroteerd worden.

- [ ] **Step 6: Commit**

```bash
git add plugins/itglue-api/skills/itglue-api/REFERENCE.md plugins/itglue-api/skills/itglue-api/LESSONS.md
git commit -m "docs(itglue-api): referentie en lessons learned met verificatiestatus

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: SKILL.md definitief maken en PR voorstellen

**Files:**
- Modify: `plugins/itglue-api/skills/itglue-api/SKILL.md` (stub uit Task 1 vervangen)

**Interfaces:**
- Consumes: alle bestanden uit Task 1 tot 6.
- Produces: de definitieve instap van de skill.

- [ ] **Step 1: Schrijf SKILL.md**

Vervang de inhoud van `plugins/itglue-api/skills/itglue-api/SKILL.md`:

```markdown
---
name: itglue-api
description: Werken met de IT Glue REST API in JUICT-projecten — auth via Azure Key Vault, base URL en regio, read-only endpoints, datastructuren en valkuilen, plus een lookup-CLI voor organisaties, configuraties, contacten, documenten en flexible assets. Gebruik wanneer je IT Glue-data opvraagt, een IT Glue-client opzet, of een IT Glue API-fout debugt. Wachtwoordwaarden komen nooit uit de API: bij een wachtwoordvraag levert deze skill alleen een deeplink naar het juiste item.
---

# IT Glue REST API (JUICT)

Deze skill bundelt alles wat je nodig hebt om IT Glue te gebruiken in een JUICT-project of tijdens een ticket: authenticatie via Azure Key Vault, de geverifieerde endpoints, een read-only lookup-CLI en de valkuilen die we al tegengekomen zijn.

## Harde regel: wachtwoorden

Password-access staat uit op onze API-key. Deze skill haalt daarom **nooit** een wachtwoordwaarde op, ook niet als daar expliciet om gevraagd wordt. Bij een wachtwoordvraag lever je de naam van het item en de deeplink:

```
https://juict.eu.itglue.com/<organization-id>/passwords/<password-id>
```

`GET /passwords/{id}` en elke querystring met `show_password` worden geweigerd door `assertPathAllowed()`, in zowel `scripts/itglue-lookup.mjs` als `scripts/itglue-client.ts`. Bouw daar geen omweg om heen. De reden: een wachtwoordwaarde in een transcript of logbestand is een incident, en de collega die het wachtwoord nodig heeft kan zelf inloggen in IT Glue.

Hetzelfde geldt voor TOTP: de seed is niet via de API beschikbaar, alleen `otp-enabled` als boolean.

De hele skill is read-only. Schrijfacties op IT Glue zijn buiten scope.

## Vóór je begint

1. Lees **[REFERENCE.md](REFERENCE.md)** — base URL en regio, auth, JSON:API-vorm, paginatie, filters, resources met verificatiestatus.
2. Lees **[LESSONS.md](LESSONS.md)** — valkuilen (kebab-case velden, breed matchend `filter[name]`, wachtwoorden, paginatie).
3. Let op de ✅/📄-markering in REFERENCE.md. 📄 betekent: nog niet zelf getest, verifieer met een GET voor je erop bouwt.

## Snel iets opzoeken (tijdens een ticket)

```bash
node scripts/itglue-lookup.mjs org "Lettix"
node scripts/itglue-lookup.mjs configs 1234 "srv"
node scripts/itglue-lookup.mjs contacts 1234
node scripts/itglue-lookup.mjs docs 1234 "handleiding"
node scripts/itglue-lookup.mjs password-link 1234 "firewall"
```

Organisatie mag een naam of een id zijn. Bij een naam zonder unieke match krijg je de kandidaten met hun id terug. Voeg `--json` toe voor machineleesbare output. De key komt uit `juict-shared-kv` via `az`, of uit `ITGLUE_API_KEY`.

## In een project gebruiken

Kopieer `scripts/azure-keyvault.ts` en `scripts/itglue-client.ts` naar je project (bijvoorbeeld `src/lib/`) en installeer `@azure/keyvault-secrets` en `@azure/identity`.

```typescript
import { fetchAllItGlue, passwordDeeplink } from "@/lib/itglue-client";

const configs = await fetchAllItGlue("configurations", { filters: { organization_id: 1234 } });
const naam = configs[0].attributes["name"];

// Wachtwoord nodig? Alleen een link, nooit de waarde.
const link = passwordDeeplink(1234, 42);
```

## Authenticatie

| Omgeving | Bron |
|---|---|
| Productie (Container Apps) | Key Vault `juict-shared-kv`, secret `itglue-api-key`, via managed identity en `AZURE_KEYVAULT_URL` |
| Lokaal / CLI | `ITGLUE_API_KEY`, of `az keyvault secret show` als die env var niet gezet is |

`juict-shared-kv` werkt met access policies, niet met RBAC. Een nieuwe managed identity koppel je met `az keyvault set-policy --secret-permissions get list`, anders faalt de keyvaultref bij het starten van de container.

## Debugchecklist bij API-fouten

1. **401/403** — is de key nog geldig, en heeft de identity `get` op `juict-shared-kv`? Bij een 403 op een resource: onze key heeft die permissie niet, ga niet zoeken naar een omweg.
2. **404** — bestaat de resource-naam echt? Let op underscore versus streepje in resource-paden en check REFERENCE.md op de verificatiestatus.
3. **Leeg resultaat** — `filter[...]` sleutel goed gespeld? Filternamen zijn snake_case, attribuutsleutels kebab-case.
4. **429** — de client doet al retry met backoff. Krijg je er veel, verlaag `page[size]` of serialiseer de calls.
5. **Te weinig records** — loopt de paginatie door? Controleer `meta.next-page`, niet alleen de eerste pagina.

## Bestanden

- `scripts/itglue-lookup.mjs` — read-only lookup-CLI, geen npm-deps, met de password-blokkade.
- `scripts/itglue-lookup.test.mjs` — tests, draaien offline met `node --test`.
- `scripts/itglue-client.ts` — kopieerbare client voor projecten (`itglueFetch`, `fetchAllItGlue`, `buildFilterQuery`, `passwordDeeplink`).
- `scripts/azure-keyvault.ts` — `getSecret()` met 1u-cache en `DefaultAzureCredential`.
- `REFERENCE.md` — endpoint- en datareferentie met verificatiestatus.
- `LESSONS.md` — valkuilen en lessons learned.

## Nieuwe lessen toevoegen

Loop je tegen een nieuwe valkuil of een geverifieerd endpoint aan, werk dan LESSONS.md of REFERENCE.md bij (met datum bij de ✅) en push dat naar `AntoJUICT/juict-skills` via een feature branch en PR.
```

Verwijder de regel over de OpenAPI-spec in de bestandenlijst als Task 1 besloot niet te bundelen, en voeg hem toe als dat wel gebeurd is.

- [ ] **Step 2: Draai alle tests van de plugin**

Run: `node --test plugins/itglue-api/skills/itglue-api/scripts/`
Expected: PASS, alles groen.

- [ ] **Step 3: Controleer de skill-frontmatter en de verwijzingen**

```bash
node --test plugins/itglue-api/skills/itglue-api/scripts/plugin-structuur.test.mjs
grep -c "REFERENCE.md\|LESSONS.md" plugins/itglue-api/skills/itglue-api/SKILL.md
ls plugins/itglue-api/skills/itglue-api/
```

Expected: tests groen, minstens 2 verwijzingen, en elk bestand dat SKILL.md noemt bestaat ook echt.

- [ ] **Step 4: Commit**

```bash
git add plugins/itglue-api/skills/itglue-api/SKILL.md
git commit -m "docs(itglue-api): definitieve SKILL.md met harde password-regel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Push en stel de PR voor**

Push de branch, maar maak de PR **niet** aan zonder akkoord van de gebruiker.

```bash
git push -u origin feature/itglue-api-skill
```

Vraag daarna: "Branch staat op GitHub. Mag ik de PR naar `main` aanmaken?" Bij akkoord:

```bash
gh pr create --base main --head feature/itglue-api-skill \
  --title "feat: itglue-api skill" \
  --body "$(cat <<'EOF'
## Wat

Nieuwe plugin `itglue-api` in de marketplace: referentie voor de IT Glue REST API, een kopieerbare read-only TypeScript-client en een lookup-CLI voor organisaties, configuraties, contacten, documenten en flexible assets.

## Wachtwoorden

Password-access staat uit op onze API-key. `GET /passwords/{id}` en `show_password` worden codematig geweigerd in zowel de CLI als de client. Bij een wachtwoordvraag levert de skill alleen de naam van het item en een deeplink naar IT Glue.

## Test

`node --test plugins/itglue-api/skills/itglue-api/scripts/`

## Na merge

Plugin enablen in de Claude organization managed settings: `itglue-api@juict-skills: true`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Meld de openstaande handeling**

Vertel de gebruiker expliciet dat de plugin na merge nog in de managed settings aan moet (`itglue-api@juict-skills: true`) en dat hij dat zelf doet.

---

## Zelfreview van dit plan

**Spec-dekking:** plugin-structuur (Task 1), auth via Key Vault met env-fallback (Task 4 en 5), password-beleid als codeblokkade plus naam-en-link-output (Task 2, 3, 4, 5), lookup-CLI met alle zes subcommands (Task 4), kopieerbare client (Task 5), verificatiemarkers en de live GET-ronde (Task 6), LESSONS-startinhoud (Task 6), OpenAPI-bundel met licentiecheck (Task 1), uitrol via PR plus managed settings (Task 7). Read-only en "geen `itglue-api-update` companion" zijn constraints, geen taken.

**Openstaand risico dat tijdens uitvoering blijkt:** of `documents` en `flexible_assets` de juiste resource-namen zijn, en of het passwords-collectie-endpoint met onze key nog werkt. Task 6 Step 2 dekt beide en schrijft het antwoord in LESSONS.md.
