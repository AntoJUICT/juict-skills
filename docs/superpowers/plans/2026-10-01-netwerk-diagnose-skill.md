# Netwerk-diagnose skill (fase 1: UniFi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een read-only Claude Code-skill `netwerk-diagnose` met een UniFi-lookup-CLI waarmee Claude per klant de actuele stand, gebeurtenissen en (via Grafana) historie ophaalt en een netwerkdiagnose geeft.

**Architecture:** Eén standalone Node-CLI (`unifi-lookup.mjs`, geen npm-deps) met zuivere, testbare functies (filteren, allowlist, site-koppeling, samenvattingen) plus een dunne HTTP-laag met injecteerbare `fetch`. Secrets uit Key Vault via `az`, env vars of een Python-SDK-helper. `SKILL.md` beschrijft de workflow en de diagnose-checklist; Claude koppelt klant naar site via de bestaande `autotask-api`- en `itglue-api`-skills en haalt historie via de Grafana-MCP.

**Tech Stack:** Node 18+ (ingebouwde `fetch`, `node:test`), Python 3 met `azure-identity` + `azure-keyvault-secrets` (alleen fallback), UniFi Network 10.5.x classic API + v2 system-log.

**Spec:** `docs/superpowers/specs/2026-10-01-netwerk-diagnose-skill-design.md`

## Global Constraints

- Node 18+; geen npm-dependencies; tests met `node --test <glob>` (op Node 24 faalt een mapnaam; gebruik `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/*.test.mjs`), zonder netwerk, zonder `az`, zonder Python.
- Alleen lezen: toegestaan zijn uitsluitend `GET /api/self/sites`, `GET /api/s/{site}/stat/device|sta|alluser`, `GET /api/s/{site}/rest/wlanconf`, `POST /api/login`, `POST /api/logout`, `POST /v2/api/site/{site}/system-log/all`.
- Alle `x_*`-velden en geheime velden (`password`, `passphrase`, `secret`, `psk`, `wpa_psk`, `radius_secret`, `shared_secret`, `private_preshared_keys`, `*_secret`, `*_password`) worden uit elke respons verwijderd voordat iets wordt teruggegeven of geprint.
- TLS altijd verifiëren; geen optie om dat uit te zetten.
- Key Vault `juict-shared-kv`, secrets `UNIFI-URL`, `UNIFI-USER`, `UNIFI-PASS`; env vars `UNIFI_URL`, `UNIFI_USER`, `UNIFI_PASS`. Volgorde: `az`, dan env, dan `kv-secret.py`. Met `--kv python` wordt `az` overgeslagen (env, dan `kv-secret.py`); waarden `auto` (standaard) en `python`. Secret-waarden nooit printen of loggen.
- Node staat op deze machine in `C:/Program Files/nodejs`; zet in elke shell eerst `export PATH="/c/Program Files/nodejs:$PATH"` als `node` niet gevonden wordt.
- Publieke repo: geen klantnamen, site-ID's, IT Glue-ID's of de controller-URL in code, tests of docs. Testdata is verzonnen.
- Tijden voor mensen in Europe/Amsterdam (`dd-mm-jjjj uu:mm:ss`).
- Signaaldrempels: ≥ -67 dBm goed; -67 tot -75 krap; -75 tot -80 slecht; < -80 onbruikbaar.
- Events: categorie `CLIENT_DEVICES`, pagina's van 200, maximaal 20 pagina's; `--dagen` 1 t/m 90, standaard 14.
- Alle tekst (meldingen, docs) in het Nederlands. Commits eindigen met `AB#1040` en de regel `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Afgekapte sitenaam:** UniFi kapt `desc` af op 64 tekens, waardoor het IT Glue-ID half of helemaal wegvalt (bv. `Naam B.V.(12345`). Verwacht: geen gedeeltelijke ID-match op een andere site; zoeken op het volledige ID geeft "geen site", en de naamroute vindt hem wel. Test in Task 3.
2. **Toestel zonder naam of met MAC in hoofdletters:** clients met alleen een MAC, of een zoekterm `AA:BB:...` tegen `aa:bb:...`. Verwacht: tabel toont de MAC als naam, en `client` vindt het toestel hoofdletterongevoelig. Test in Task 4.
3. **Eén endpoint geeft 404:** bv. `rest/wlanconf` bestaat niet op een oudere/nieuwere controller. Verwacht: `snapshot` levert apparaten en clients toch, en meldt welk deel ontbreekt. Test in Task 6.
4. **Login mislukt:** 401 bij verkeerd wachtwoord of 2FA. Verwacht: duidelijke melding zonder het wachtwoord erin, en geen verdere verzoeken. Test in Task 6.
5. **Veel events:** meer dan 20 pagina's in de periode. Verwacht: maximaal 20 verzoeken en een duidelijke melding dat de lijst is afgekapt. Test in Task 6.

---

## Bestandsstructuur

```
plugins/netwerk-diagnose/
  .claude-plugin/plugin.json                       Task 1
  skills/netwerk-diagnose/
    SKILL.md                                       Task 1 (stub), Task 7 (volledig)
    REFERENCE.md                                   Task 7
    LESSONS.md                                     Task 7
    scripts/
      plugin-structuur.test.mjs                    Task 1
      unifi-lookup.mjs                             Task 2 t/m 6
      unifi-lookup.test.mjs                        Task 2 t/m 6
      kv-secret.py                                 Task 5
.claude-plugin/marketplace.json                    Task 1 (entry toevoegen)
README.md                                          Task 1 (tabelrij + Vereisten)
```

Alle commando's draaien vanuit de repo-root van de worktree.

---

### Task 1: Plugin-skelet en structuurtest

**Files:**
- Create: `plugins/netwerk-diagnose/.claude-plugin/plugin.json`
- Create: `plugins/netwerk-diagnose/skills/netwerk-diagnose/SKILL.md` (stub, wordt in Task 7 volledig)
- Create: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/plugin-structuur.test.mjs`
- Modify: `.claude-plugin/marketplace.json` (entry toevoegen aan `plugins`)
- Modify: `README.md` (tabelrij in "Skills in deze marketplace", plus `netwerk-diagnose` in de Key Vault-regel onder "Vereisten")

**Interfaces:**
- Consumes: niets.
- Produces: pluginmap en een groene structuurtest waar latere taken op voortbouwen.

- [ ] **Step 1: Schrijf de falende structuurtest**

`plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/plugin-structuur.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");

test("plugin.json is geldig en heet netwerk-diagnose", () => {
  const pad = resolve(repoRoot, "plugins/netwerk-diagnose/.claude-plugin/plugin.json");
  const plugin = JSON.parse(readFileSync(pad, "utf-8"));
  assert.equal(plugin.name, "netwerk-diagnose");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20, "description moet inhoudelijk zijn");
});

test("marketplace.json bevat een netwerk-diagnose entry die naar de plugin-map wijst", () => {
  const markt = JSON.parse(readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf-8"));
  const entry = markt.plugins.find((p) => p.name === "netwerk-diagnose");
  assert.ok(entry, "netwerk-diagnose ontbreekt in marketplace.json");
  assert.equal(entry.source, "./plugins/netwerk-diagnose");
  assert.ok(existsSync(resolve(repoRoot, "plugins/netwerk-diagnose")), "plugin-map bestaat niet");
});

// Op de tabelrij en niet op de naam ergens in het bestand: de naam staat ook in de Vereisten-lijst.
test("README heeft een tabelrij voor elke plugin uit marketplace.json", () => {
  const markt = JSON.parse(readFileSync(resolve(repoRoot, ".claude-plugin/marketplace.json"), "utf-8"));
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf-8");
  for (const plugin of markt.plugins) {
    assert.ok(
      readme.includes(`| \`${plugin.name}\` |`),
      `${plugin.name} staat in marketplace.json maar heeft geen tabelrij in README.md`
    );
  }
});

test("SKILL.md heeft frontmatter met name en description", () => {
  const inhoud = readFileSync(resolve(repoRoot, "plugins/netwerk-diagnose/skills/netwerk-diagnose/SKILL.md"), "utf-8");
  assert.match(inhoud, /^---\r?\nname: netwerk-diagnose\r?\n/);
  assert.match(inhoud, /\ndescription: .{40,}/);
});

// Publieke repo: geen controller-hostnaam en geen IT Glue-ID's (16 cijfers) in de plugin, spec of plan.
// Een allowlist van generieke hosts in plaats van een blocklist: zo hoeft de echte hostnaam nergens te staan.
const TOEGESTANE_HOSTS = new Set([
  "example.local",
  "controller.voorbeeld",
  "juict-shared-kv.vault.azure.net",
  "github.com",
  "json.schemastore.org",
]);

function bestandenIn(map) {
  return readdirSync(map, { withFileTypes: true }).flatMap((d) => {
    const pad = resolve(map, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : bestandenIn(pad);
    return /\.(md|mjs|py|json)$/.test(d.name) ? [pad] : [];
  });
}

test("plugin, spec en plan bevatten alleen toegestane URL-hosts en geen echte organisatie-ID's", () => {
  const bestanden = [
    ...bestandenIn(resolve(repoRoot, "plugins/netwerk-diagnose")),
    resolve(repoRoot, "docs/superpowers/specs/2026-10-01-netwerk-diagnose-skill-design.md"),
    resolve(repoRoot, "docs/superpowers/plans/2026-10-01-netwerk-diagnose-skill.md"),
  ].filter((pad) => existsSync(pad));
  assert.ok(bestanden.length >= 8, "te weinig bestanden gescand");
  for (const pad of bestanden) {
    const rel = pad.slice(repoRoot.length + 1);
    const inhoud = readFileSync(pad, "utf-8");
    for (const m of inhoud.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      assert.ok(TOEGESTANE_HOSTS.has(m[1].toLowerCase()), `${rel} bevat een URL-host die niet op de allowlist staat (${m[1].length} tekens): voeg alleen generieke hosts toe`);
    }
    assert.doesNotMatch(inhoud, /\b(?!1234567890123456\b)(?!(\d)\1{15}\b)\d{16}\b/, `${rel} bevat een 16-cijferig ID dat geen testwaarde is (toegestaan: 1234567890123456 en herhaalde cijfers)`);
  }
});
```

- [ ] **Step 2: Draai de test en zie hem falen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/plugin-structuur.test.mjs`
Expected: FAIL, `ENOENT` op `plugin.json`.

- [ ] **Step 3: Maak het skelet**

`plugins/netwerk-diagnose/.claude-plugin/plugin.json`:

```json
{
  "name": "netwerk-diagnose",
  "version": "0.1.0",
  "description": "Netwerkproblemen bij klanten diagnosticeren: read-only UniFi-lookup (sites, apparaten, radio's, clients, wifi-instellingen en gebeurtenissen) plus historie via Grafana, met een diagnose-checklist. Wifi-wachtwoorden worden nooit getoond.",
  "author": {
    "name": "AntoJUICT",
    "email": "anto@juict.nl"
  },
  "homepage": "https://github.com/AntoJUICT/juict-skills",
  "repository": "https://github.com/AntoJUICT/juict-skills",
  "keywords": ["unifi", "wifi", "netwerk", "diagnose", "voip", "keyvault", "juict"]
}
```

`plugins/netwerk-diagnose/skills/netwerk-diagnose/SKILL.md` (stub):

```markdown
---
name: netwerk-diagnose
description: Netwerkproblemen bij een klant diagnosticeren met read-only UniFi-data (sites, apparaten, radio's, clients, wifi-instellingen, verbind-, verbreek- en roam-events) plus historie via Grafana. Gebruik bij een netwerk- of wifiticket, wegvallende verbindingen, slechte VoIP-kwaliteit, of een vraag over de wifi-instellingen van een klant.
---

# Netwerk-diagnose

Wordt in Task 7 aangevuld.
```

In `.claude-plugin/marketplace.json`, voeg aan het einde van de `plugins`-array toe (komma achter de vorige entry):

```json
    {
      "name": "netwerk-diagnose",
      "source": "./plugins/netwerk-diagnose",
      "description": "Netwerkproblemen diagnosticeren: read-only UniFi-lookup (apparaten, clients, wifi-instellingen, events) plus Grafana-historie en een diagnose-checklist."
    }
```

In `README.md`, voeg onder de laatste rij van de tabel "Skills in deze marketplace" toe:

```markdown
| `netwerk-diagnose` | Netwerkproblemen bij een klant diagnosticeren: read-only UniFi-lookup voor apparaten, radio's, clients, wifi-instellingen en verbind/verbreek/roam-events, plus historie via Grafana en een diagnose-checklist. Wifi-wachtwoorden worden nooit getoond. | Key Vault |
```

En in de regel `- **Key Vault** (...)` onder "Vereisten": voeg `` `netwerk-diagnose` `` toe aan de lijst tussen haakjes.

- [ ] **Step 4: Draai de test en zie hem slagen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/plugin-structuur.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/netwerk-diagnose .claude-plugin/marketplace.json README.md
git commit -m "feat(netwerk-diagnose): plugin-skelet en structuurtest

AB#1040

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Geheimen filteren en read-only allowlist

**Files:**
- Create: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.mjs`
- Create: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`

**Interfaces:**
- Consumes: niets.
- Produces:
  - `isGeheimeSleutel(sleutel: string): boolean`
  - `redactUnifi(waarde: any): any` (diepe kopie zonder geheime sleutels)
  - `normaliseerPad(pad: string): string` (zonder query, gedecodeerd, lowercase, dubbele en afsluitende slashes weg; gooit bij `.`/`..`-segment of ongeldige codering)
  - `assertVerzoekToegestaan(methode: string, pad: string): string` (geeft genormaliseerd pad terug of gooit `Error` met "Geweigerd")
  - `SITE_ID_RE: RegExp` = `/^[a-z0-9]{1,64}$/`

- [ ] **Step 1: Schrijf de falende tests**

`unifi-lookup.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGeheimeSleutel,
  redactUnifi,
  normaliseerPad,
  assertVerzoekToegestaan,
} from "./unifi-lookup.mjs";

test("isGeheimeSleutel: x_-velden en bekende geheime namen", () => {
  for (const k of ["x_passphrase", "X_Passphrase", "x_authkey", "password", "passphrase", "radius_secret", "private_preshared_keys", "wpa_psk", "mgmt_password", "ldap_secret"]) {
    assert.equal(isGeheimeSleutel(k), true, k);
  }
  for (const k of ["name", "group_rekey", "security", "wpa_mode", "bss_transition", "secretary"]) {
    assert.equal(isGeheimeSleutel(k), false, k);
  }
});

test("redactUnifi: verwijdert geheimen, ook genest en in arrays, zonder de invoer te muteren", () => {
  const invoer = {
    meta: { rc: "ok" },
    data: [
      { name: "Kantoor", x_passphrase: "geheim1", radius_profile: { x_secret: "geheim2", host: "10.0.0.1" } },
      { name: "Gast", private_preshared_keys: [{ password: "geheim3" }], nested: [[{ x_iapp_key: "geheim4", ok: 1 }]] },
    ],
  };
  const uit = redactUnifi(invoer);
  const tekst = JSON.stringify(uit);
  for (const g of ["geheim1", "geheim2", "geheim3", "geheim4"]) assert.ok(!tekst.includes(g), g);
  assert.equal(uit.data[0].name, "Kantoor");
  assert.equal(uit.data[0].radius_profile.host, "10.0.0.1");
  assert.equal(uit.data[1].nested[0][0].ok, 1);
  assert.equal(invoer.data[0].x_passphrase, "geheim1", "invoer mag niet gemuteerd worden");
});

test("redactUnifi: laat primitieven en null ongemoeid", () => {
  assert.equal(redactUnifi(null), null);
  assert.equal(redactUnifi(5), 5);
  assert.equal(redactUnifi("x_passphrase"), "x_passphrase");
});

test("normaliseerPad: query weg, decodering, lowercase, slashes", () => {
  assert.equal(normaliseerPad("/api/s/abc123/stat/alluser?within=72"), "/api/s/abc123/stat/alluser");
  assert.equal(normaliseerPad("//API//Self//Sites/"), "/api/self/sites");
  assert.equal(normaliseerPad("/api/s/abc%2Fstat/device"), "/api/s/abc/stat/device");
  assert.equal(normaliseerPad("/api/s/abc%252Fstat/device"), "/api/s/abc/stat/device");
  assert.throws(() => normaliseerPad("/api/s/abc/../rest/user"), /\.\./);
  assert.throws(() => normaliseerPad("/api/s/%E0%A4%A"), /Ongeldig pad/);
});

test("assertVerzoekToegestaan: alle toegestane verzoeken", () => {
  assert.equal(assertVerzoekToegestaan("GET", "/api/self/sites"), "/api/self/sites");
  for (const p of ["stat/device", "stat/sta", "stat/alluser?within=24", "rest/wlanconf"]) {
    assertVerzoekToegestaan("get", `/api/s/abc123/${p}`);
  }
  assertVerzoekToegestaan("POST", "/api/login");
  assertVerzoekToegestaan("POST", "/api/logout");
  assertVerzoekToegestaan("POST", "/v2/api/site/abc123/system-log/all");
});

test("assertVerzoekToegestaan: weigert schrijfacties en omwegen", () => {
  const geweigerd = [
    ["PUT", "/api/s/abc123/rest/wlanconf/1"],
    ["POST", "/api/s/abc123/rest/wlanconf"],
    ["DELETE", "/api/s/abc123/rest/wlanconf"],
    ["POST", "/api/s/abc123/cmd/devmgr"],
    ["GET", "/api/s/abc123/rest/wlanconf/1"],
    ["GET", "/api/s/abc123/rest/wlanconf.json"],
    ["GET", "/api/s/abc123/rest/user"],
    ["GET", "/api/s/abc123%2F..%2Fdefault/cmd/devmgr"],
    ["GET", "/api/s/ABC123/stat/device/../../cmd/devmgr"],
    ["GET", "/api/s/abc-123/stat/device"],
    ["POST", "/v2/api/site/abc123/system-log/all/delete"],
    ["GET", "/v2/api/site/abc123/system-log/all"],
  ];
  for (const [m, p] of geweigerd) {
    assert.throws(() => assertVerzoekToegestaan(m, p), /Geweigerd|\.\./, `${m} ${p}`);
  }
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: FAIL, `Cannot find module ... unifi-lookup.mjs`.

- [ ] **Step 3: Implementeer**

`unifi-lookup.mjs`:

```js
#!/usr/bin/env node
// Standalone read-only UniFi-lookup voor netwerkdiagnose. Geen npm-deps; Node 18+ (fetch ingebouwd).
// Secrets uit Key Vault (az, env, of de Python-SDK-helper). Nooit een secret of wifi-wachtwoord loggen.
//
// Twee harde regels, in code afgedwongen:
// 1. Alleen lezen. Elk verzoek gaat langs assertVerzoekToegestaan(); wat niet op de allowlist staat,
//    wordt geweigerd voordat het verstuurd wordt.
// 2. Geheimen eruit. Elke respons gaat door redactUnifi() voordat iets wordt teruggegeven of geprint.
//    Een readonly-account krijgt x_passphrase nu niet terug, maar een ander account of een andere
//    controllerversie wel; daar rekenen we niet op.

export const SITE_ID_RE = /^[a-z0-9]{1,64}$/;

const GEHEIME_SLEUTELS = new Set([
  "password",
  "passphrase",
  "secret",
  "psk",
  "wpa_psk",
  "radius_secret",
  "shared_secret",
  "private_preshared_keys",
]);

export function isGeheimeSleutel(sleutel) {
  const k = String(sleutel).toLowerCase();
  return k.startsWith("x_") || GEHEIME_SLEUTELS.has(k) || k.endsWith("_secret") || k.endsWith("_password");
}

export function redactUnifi(waarde) {
  if (Array.isArray(waarde)) return waarde.map(redactUnifi);
  if (waarde && typeof waarde === "object") {
    const uit = {};
    for (const [k, v] of Object.entries(waarde)) {
      if (!isGeheimeSleutel(k)) uit[k] = redactUnifi(v);
    }
    return uit;
  }
  return waarde;
}

export function normaliseerPad(pad) {
  let p = String(pad ?? "");
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  // Herhaald decoderen tot het pad niet meer verandert, zodat %252F niet als omweg werkt.
  let vorige;
  do {
    vorige = p;
    try {
      p = decodeURIComponent(p);
    } catch {
      throw new Error(`Ongeldig pad (codering): ${pad}`);
    }
  } while (p !== vorige);
  p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (p.split("/").some((s) => s === ".." || s === ".")) {
    throw new Error(`Pad met '..' of '.' geweigerd: ${pad}`);
  }
  return p;
}

const SITE = "[a-z0-9]{1,64}";
const TOEGESTAAN = [
  ["GET", new RegExp("^/api/self/sites$")],
  ["GET", new RegExp(`^/api/s/${SITE}/stat/(device|sta|alluser)$`)],
  ["GET", new RegExp(`^/api/s/${SITE}/rest/wlanconf$`)],
  ["POST", new RegExp("^/api/login$")],
  ["POST", new RegExp("^/api/logout$")],
  ["POST", new RegExp(`^/v2/api/site/${SITE}/system-log/all$`)],
];

export function assertVerzoekToegestaan(methode, pad) {
  const m = String(methode ?? "").toUpperCase();
  const p = normaliseerPad(pad);
  if (!TOEGESTAAN.some(([tm, re]) => tm === m && re.test(p))) {
    throw new Error(`Geweigerd: ${m} ${pad} staat niet op de read-only allowlist van unifi-lookup.`);
  }
  return p;
}
```

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.mjs plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs
git commit -m "feat(netwerk-diagnose): geheimen filteren en read-only allowlist

AB#1040

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Klant koppelen aan een UniFi-site

**Files:**
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.mjs` (functies toevoegen onder Task 2-code)
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs` (tests toevoegen, import uitbreiden)

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces:
  - `parseItglueId(desc: string): string | null` (laatste volledige `(cijfers≥6)` in de omschrijving)
  - `siteNaam(desc: string): string` (omschrijving zonder ID's en zonder afgekapt `(cijfers` aan het eind)
  - `normaliseerNaam(naam: string): string`
  - `siteRij(site: {name, desc, device_count?}): {site: string, naam: string, itglueId: string|null, apparaten: number|null}`
  - `resolveSite(sites: Array<{name, desc}>, zoekterm: string): {via: "itglue-id"|"site-id"|"naam", match: SiteRij|null, kandidaten: SiteRij[]}`

- [ ] **Step 1: Schrijf de falende tests**

Voeg toe aan de import: `parseItglueId, siteNaam, normaliseerNaam, siteRij, resolveSite`. Voeg toe aan het testbestand:

```js
const SITES = [
  { name: "aaa11111", desc: "Bakkerij Voorbeeld (1234567890123456)", device_count: 4 },
  { name: "bbb22222", desc: "Voorbeeld Makelaars Almelo B.V. (9999999999999999)", device_count: 2 },
  { name: "ccc33333", desc: "Voorbeeld Makelaars Hengelo B.V. (5555555555555555)", device_count: 3 },
  { name: "ddd44444", desc: "Garage Test(4444444444444444)", device_count: 1 },
  { name: "eee55555", desc: "Heel Lange Klantnaam Met Vestiging Oost Nederland B.V.(12345678", device_count: 5 },
  { name: "default", desc: "Default", device_count: 0 },
];

test("parseItglueId: haalt het ID uit de sitenaam, ook zonder spatie; afgekapt geeft null", () => {
  assert.equal(parseItglueId("Bakkerij Voorbeeld (1234567890123456)"), "1234567890123456");
  assert.equal(parseItglueId("Garage Test(4444444444444444)"), "4444444444444444");
  assert.equal(parseItglueId("Naam (12345) (1234567890123456)"), "1234567890123456");
  assert.equal(parseItglueId("Heel Lange Klantnaam B.V.(12345678"), null);
  assert.equal(parseItglueId("Default"), null);
  assert.equal(parseItglueId(undefined), null);
});

test("siteNaam: verwijdert volledige en afgekapte ID's", () => {
  assert.equal(siteNaam("Bakkerij Voorbeeld (1234567890123456)"), "Bakkerij Voorbeeld");
  assert.equal(siteNaam("Garage Test(4444444444444444)"), "Garage Test");
  assert.equal(siteNaam("Heel Lange Klantnaam B.V.(12345678"), "Heel Lange Klantnaam B.V.");
});

test("normaliseerNaam: rechtsvorm en leestekens weg", () => {
  assert.equal(normaliseerNaam("Voorbeeld Makelaars Almelo B.V."), "voorbeeld makelaars almelo");
  assert.equal(normaliseerNaam("Bakkerij  Voorbeeld"), "bakkerij voorbeeld");
  assert.equal(normaliseerNaam("Test V.O.F."), "test");
});

test("resolveSite: op IT Glue-ID, exact één", () => {
  const r = resolveSite(SITES, "1234567890123456");
  assert.equal(r.via, "itglue-id");
  assert.equal(r.match.site, "aaa11111");
  assert.equal(r.match.naam, "Bakkerij Voorbeeld");
});

test("resolveSite: IT Glue-ID zonder site geeft geen match en geen kandidaten", () => {
  const r = resolveSite(SITES, "7777777777777777");
  assert.equal(r.via, "itglue-id");
  assert.equal(r.match, null);
  assert.deepEqual(r.kandidaten, []);
});

test("resolveSite: afgekapt ID matcht niet gedeeltelijk, de naamroute vindt hem wel", () => {
  assert.equal(resolveSite(SITES, "12345678").match, null);
  assert.equal(resolveSite(SITES, "123456789012345").match, null);
  const r = resolveSite(SITES, "Heel Lange Klantnaam");
  assert.equal(r.via, "naam");
  assert.equal(r.match.site, "eee55555");
});

test("resolveSite: op korte site-ID", () => {
  const r = resolveSite(SITES, "ddd44444");
  assert.equal(r.via, "site-id");
  assert.equal(r.match.naam, "Garage Test");
});

test("resolveSite: naam met meerdere vestigingen geeft kandidaten, geen gok", () => {
  const r = resolveSite(SITES, "Voorbeeld Makelaars");
  assert.equal(r.via, "naam");
  assert.equal(r.match, null);
  assert.deepEqual(r.kandidaten.map((k) => k.site).sort(), ["bbb22222", "ccc33333"]);
});

test("resolveSite: exacte naam wint van deelmatches", () => {
  const r = resolveSite(SITES, "voorbeeld makelaars almelo bv");
  assert.equal(r.match.site, "bbb22222");
});

test("resolveSite: lege zoekterm gooit", () => {
  assert.throws(() => resolveSite(SITES, "  "), /Geef een site op/);
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: FAIL, `parseItglueId` is geen export.

- [ ] **Step 3: Implementeer**

Voeg toe aan `unifi-lookup.mjs`:

```js
// Sitenamen hebben het formaat "<Klantnaam> (<IT Glue-organisatie-ID>)". UniFi kapt de omschrijving af
// op 64 tekens; dan valt het ID (deels) weg en is alleen de naamroute bruikbaar. Een afgekapt ID mag
// nooit gedeeltelijk matchen, daarom alleen volledige "(cijfers)" met sluithaakje.
export function parseItglueId(desc) {
  const treffers = [...String(desc ?? "").matchAll(/\((\d{6,})\)/g)];
  return treffers.length ? treffers[treffers.length - 1][1] : null;
}

export function siteNaam(desc) {
  return String(desc ?? "")
    .replace(/\s*\(\d{6,}\)/g, "")
    .replace(/\s*\(\d*$/, "")
    .trim();
}

const RECHTSVORMEN = /(^|\s)(b\.?\s?v\.?|n\.?\s?v\.?|v\.?\s?o\.?\s?f\.?)(?=\s|$)/g;

export function normaliseerNaam(naam) {
  return String(naam ?? "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(RECHTSVORMEN, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function siteRij(site) {
  return {
    site: site.name,
    naam: siteNaam(site.desc),
    itglueId: parseItglueId(site.desc),
    apparaten: site.device_count ?? null,
  };
}

export function resolveSite(sites, zoekterm) {
  const term = String(zoekterm ?? "").trim();
  if (!term) throw new Error("Geef een site op: IT Glue-organisatie-ID, korte site-ID of (deel van de) naam.");
  const lijst = (sites ?? []).map(siteRij);

  if (/^\d+$/.test(term)) {
    const m = lijst.filter((s) => s.itglueId === term);
    return { via: "itglue-id", match: m.length === 1 ? m[0] : null, kandidaten: m.length > 1 ? m : [] };
  }

  const opId = lijst.filter((s) => s.site === term.toLowerCase());
  if (opId.length === 1) return { via: "site-id", match: opId[0], kandidaten: [] };

  const doel = normaliseerNaam(term);
  const exact = lijst.filter((s) => normaliseerNaam(s.naam) === doel);
  if (exact.length === 1) return { via: "naam", match: exact[0], kandidaten: [] };
  if (exact.length > 1) return { via: "naam", match: null, kandidaten: exact };

  const deel = lijst.filter((s) => normaliseerNaam(s.naam).includes(doel));
  if (deel.length === 1) return { via: "naam", match: deel[0], kandidaten: [] };
  return { via: "naam", match: null, kandidaten: deel };
}
```

Let op: `normaliseerNaam("voorbeeld makelaars almelo bv")` en `normaliseerNaam("Voorbeeld Makelaars Almelo B.V.")` moeten beide `"voorbeeld makelaars almelo"` geven; de test "exacte naam wint" dekt dat.

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts
git commit -m "feat(netwerk-diagnose): klant koppelen aan UniFi-site via IT Glue-ID of naam

AB#1040

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Samenvattingen van apparaten, clients, wifi-instellingen en events

**Files:**
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.mjs`
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces:
  - `tijdNL(ms: number): string` → `"dd-mm-jjjj uu:mm:ss"` in Europe/Amsterdam
  - `isDfsKanaal(kanaal: number): boolean` (52 t/m 144)
  - `beoordeelSignaal(dbm: number|null): "goed"|"krap"|"slecht"|"onbruikbaar"|"onbekend"`
  - `samenvattingApparaten(devices: object[]): Apparaat[]` met `{naam, type, model, mac, firmware, upgradeBeschikbaar, uptimeDagen, online, clients, radios: [{radio, band, kanaal, breedte, dfs, zendvermogen, maxZendvermogen, ruimte, clients, kanaalbezetting, retriesPct, minRssi}]}`
  - `samenvattingClients(stas: object[], devices: object[]): Client[]` met `{naam, mac, ip, ap, band, kanaal, signaal, beoordeling, ssid, uptimeMin, roams, retriesPct, satisfaction}` (alleen wifi-clients)
  - `samenvattingWlans(wlans: object[]): Wlan[]` met `{ssid, aan, beveiliging, band, fastRoaming80211r, bssTransition80211v, roamingAssistant5, minRate24, minRate5, pmf, uapsd}`
  - `eventsPlat(events: object[]): Event[]` met `{ts, tijd, soort, toestel, mac, vanAp, naarAp, signaalVoor, signaal, band, ssid, duur}`, oplopend op `ts`
  - `matchToestel(rijen: Array<{naam, mac, ip}>, zoek: string): rijen` (hoofdletterongevoelig; exact op naam/mac/ip of deel van de naam)

- [ ] **Step 1: Schrijf de falende tests**

Voeg toe aan de import: `tijdNL, isDfsKanaal, beoordeelSignaal, samenvattingApparaten, samenvattingClients, samenvattingWlans, eventsPlat, matchToestel`. Voeg toe:

```js
const DEVICES = [
  {
    type: "uap", name: "AP-01", model: "U7PG2", mac: "aa:aa:aa:00:00:01", version: "6.8.2", upgradable: false,
    uptime: 8035200, state: 1, num_sta: 3,
    radio_table: [
      { name: "wifi0", radio: "ng", ht: "20", max_txpower: 22, min_txpower: 6 },
      { name: "wifi1", radio: "na", ht: "40", max_txpower: 22, min_txpower: 6, min_rssi_enabled: true, min_rssi: -75 },
    ],
    radio_table_stats: [
      { name: "wifi0", radio: "ng", channel: 1, tx_power: 17, num_sta: 1, cu_total: 14, bw: 20, tx_retries_pct: 3.5 },
      { name: "wifi1", radio: "na", channel: 100, tx_power: 20, num_sta: 2, cu_total: 9, bw: 40, tx_retries_pct: 1.2 },
    ],
  },
  { type: "usw", name: "SW-01", model: "USL8LP", mac: "aa:aa:aa:00:00:09", version: "7.5", upgradable: true, uptime: 86400, state: 1, num_sta: 0 },
];

test("tijdNL: Europe/Amsterdam, zomer- en wintertijd", () => {
  assert.equal(tijdNL(Date.UTC(2026, 9, 1, 6, 55, 30)), "01-10-2026 08:55:30");
  assert.equal(tijdNL(Date.UTC(2026, 11, 1, 6, 55, 30)), "01-12-2026 07:55:30");
});

test("isDfsKanaal", () => {
  for (const k of [52, 100, 144]) assert.equal(isDfsKanaal(k), true, String(k));
  for (const k of [1, 6, 11, 36, 48, 149, 165, null]) assert.equal(isDfsKanaal(k), false, String(k));
});

test("beoordeelSignaal: drempels uit de spec", () => {
  assert.equal(beoordeelSignaal(-60), "goed");
  assert.equal(beoordeelSignaal(-67), "goed");
  assert.equal(beoordeelSignaal(-68), "krap");
  assert.equal(beoordeelSignaal(-75), "krap");
  assert.equal(beoordeelSignaal(-76), "slecht");
  assert.equal(beoordeelSignaal(-80), "slecht");
  assert.equal(beoordeelSignaal(-81), "onbruikbaar");
  assert.equal(beoordeelSignaal(null), "onbekend");
});

test("samenvattingApparaten: radio's met breedte, DFS en ruimte in zendvermogen", () => {
  const [ap, sw] = samenvattingApparaten(DEVICES);
  assert.equal(ap.naam, "AP-01");
  assert.equal(ap.uptimeDagen, 93);
  assert.equal(ap.online, true);
  assert.deepEqual(ap.radios[0], {
    radio: "ng", band: "2,4 GHz", kanaal: 1, breedte: 20, dfs: false, zendvermogen: 17, maxZendvermogen: 22,
    ruimte: 5, clients: 1, kanaalbezetting: 14, retriesPct: 3.5, minRssi: null,
  });
  assert.equal(ap.radios[1].dfs, true);
  assert.equal(ap.radios[1].minRssi, -75);
  assert.equal(sw.upgradeBeschikbaar, true);
  assert.deepEqual(sw.radios, []);
});

test("samenvattingClients: alleen wifi, AP-naam, MAC als naam als er niets anders is", () => {
  const stas = [
    { mac: "bb:bb:bb:00:00:01", hostname: "Telefoon-A", ip: "10.0.0.5", ap_mac: "aa:aa:aa:00:00:01", radio: "na", channel: 100, signal: -82, essid: "Kantoor", uptime: 3600, roam_count: 4, wifi_tx_retries_percentage: 12.5, satisfaction: 40, is_wired: false },
    { mac: "bb:bb:bb:00:00:02", ip: "10.0.0.6", ap_mac: "ff:ff:ff:ff:ff:ff", radio: "ng", signal: -60, is_wired: false },
    { mac: "bb:bb:bb:00:00:03", hostname: "Printer", is_wired: true },
  ];
  const rijen = samenvattingClients(stas, DEVICES);
  assert.equal(rijen.length, 2);
  assert.equal(rijen[0].naam, "Telefoon-A");
  assert.equal(rijen[0].ap, "AP-01");
  assert.equal(rijen[0].band, "5 GHz");
  assert.equal(rijen[0].beoordeling, "onbruikbaar");
  assert.equal(rijen[0].uptimeMin, 60);
  assert.equal(rijen[1].naam, "bb:bb:bb:00:00:02");
  assert.equal(rijen[1].ap, "ff:ff:ff:ff:ff:ff");
});

test("samenvattingWlans: alleen een whitelist van velden, nooit het wachtwoord", () => {
  const [w] = samenvattingWlans([{
    name: "Kantoor", enabled: true, security: "wpapsk", wpa_mode: "wpa2", wlan_band: "both", x_passphrase: "geheim",
    bss_transition: true, roaming_assistant_na_enabled: false, roaming_assistant_na_rssi: -75,
    minrate_ng_enabled: true, minrate_ng_data_rate_kbps: 6000, minrate_na_enabled: false, minrate_na_data_rate_kbps: 12000, pmf_mode: "disabled",
  }]);
  assert.deepEqual(w, {
    ssid: "Kantoor", aan: true, beveiliging: "wpapsk/wpa2", band: "both", fastRoaming80211r: false, bssTransition80211v: true,
    roamingAssistant5: null, minRate24: 6, minRate5: null, pmf: "disabled", uapsd: false,
  });
  assert.ok(!JSON.stringify(w).includes("geheim"));
});

test("eventsPlat: roam, verbreken en verbinden worden rijen, gesorteerd op tijd", () => {
  const events = [
    { event: "CLIENT_ROAMED", timestamp: Date.UTC(2026, 9, 1, 7, 0, 0), parameters: {
      CLIENT: { id: "bb:bb:bb:00:00:01", name: "Telefoon-A", hostname: "tel-a" },
      DEVICE_FROM: { name: "AP-01" }, DEVICE_TO: { name: "AP-02" },
      PREVIOUS_SIGNAL_STRENGTH: { name: "-84" }, SIGNAL_STRENGTH: { name: "-71" }, RADIO_BAND: { name: "5 GHz" }, WLAN: { name: "Kantoor" } } },
    { event: "CLIENT_DISCONNECTED_WIRELESS", timestamp: Date.UTC(2026, 9, 1, 6, 0, 0), parameters: {
      CLIENT: { id: "bb:bb:bb:00:00:02", hostname: "tel-b" }, DEVICE: { name: "AP-01" },
      SIGNAL_STRENGTH: { name: "-88 dBm" }, DURATION: { name: "2h 3m" }, WLAN: { name: "Kantoor" } } },
    { event: "IETS_ONBEKENDS", timestamp: Date.UTC(2026, 9, 1, 8, 0, 0), parameters: {} },
  ];
  const rijen = eventsPlat(events);
  assert.deepEqual(rijen.map((r) => r.soort), ["verbroken", "roam", "IETS_ONBEKENDS"]);
  assert.equal(rijen[0].toestel, "tel-b");
  assert.equal(rijen[0].signaal, -88);
  assert.equal(rijen[0].naarAp, "AP-01");
  assert.equal(rijen[0].duur, "2h 3m");
  assert.equal(rijen[1].tijd, "01-10-2026 09:00:00");
  assert.equal(rijen[1].vanAp, "AP-01");
  assert.equal(rijen[1].naarAp, "AP-02");
  assert.equal(rijen[1].signaalVoor, -84);
  assert.equal(rijen[1].signaal, -71);
  assert.equal(rijen[2].toestel, null);
});

test("matchToestel: hoofdletterongevoelig op naam, MAC, IP en deel van de naam", () => {
  const rijen = [
    { naam: "S23-van-Yvonne", mac: "bb:bb:bb:00:00:01", ip: "10.0.0.5" },
    { naam: "bb:bb:bb:00:00:02", mac: "bb:bb:bb:00:00:02", ip: null },
  ];
  assert.equal(matchToestel(rijen, "BB:BB:BB:00:00:02").length, 1);
  assert.equal(matchToestel(rijen, "yvonne")[0].mac, "bb:bb:bb:00:00:01");
  assert.equal(matchToestel(rijen, "10.0.0.5").length, 1);
  assert.equal(matchToestel(rijen, "10.0.0.50").length, 0);
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: FAIL, `tijdNL` is geen export.

- [ ] **Step 3: Implementeer**

Voeg toe aan `unifi-lookup.mjs`:

```js
const NL_TIJD = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

export function tijdNL(ms) {
  return NL_TIJD.format(new Date(ms)).replace(",", "");
}

export function isDfsKanaal(kanaal) {
  const k = Number(kanaal);
  return Number.isFinite(k) && k >= 52 && k <= 144;
}

export function beoordeelSignaal(dbm) {
  if (dbm === null || dbm === undefined || !Number.isFinite(Number(dbm))) return "onbekend";
  const s = Number(dbm);
  if (s >= -67) return "goed";
  if (s >= -75) return "krap";
  if (s >= -80) return "slecht";
  return "onbruikbaar";
}

const BAND = { ng: "2,4 GHz", na: "5 GHz", "6e": "6 GHz" };

function breedte(stat, radio) {
  if (Number.isFinite(stat?.bw)) return stat.bw;
  const n = Number(String(radio?.ht ?? "").replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function samenvattingApparaten(devices) {
  return (devices ?? []).map((d) => {
    const radios = (d.radio_table_stats ?? []).map((st) => {
      const rt = (d.radio_table ?? []).find((r) => r.name === st.name) ?? {};
      const max = rt.max_txpower ?? null;
      const tx = st.tx_power ?? null;
      return {
        radio: st.radio,
        band: BAND[st.radio] ?? st.radio,
        kanaal: st.channel ?? null,
        breedte: breedte(st, rt),
        dfs: isDfsKanaal(st.channel),
        zendvermogen: tx,
        maxZendvermogen: max,
        ruimte: max !== null && tx !== null ? max - tx : null,
        clients: st.num_sta ?? null,
        kanaalbezetting: st.cu_total ?? null,
        retriesPct: st.tx_retries_pct ?? null,
        minRssi: rt.min_rssi_enabled ? rt.min_rssi ?? null : null,
      };
    });
    return {
      naam: d.name ?? d.mac,
      type: d.type ?? null,
      model: d.model ?? null,
      mac: d.mac ?? null,
      firmware: d.version ?? null,
      upgradeBeschikbaar: Boolean(d.upgradable),
      uptimeDagen: Number.isFinite(d.uptime) ? Math.round(d.uptime / 86400) : null,
      online: d.state === 1,
      clients: d.num_sta ?? 0,
      radios,
    };
  });
}

export function samenvattingClients(stas, devices) {
  const apNaam = new Map((devices ?? []).map((d) => [d.mac, d.name]));
  return (stas ?? [])
    .filter((c) => !c.is_wired)
    .map((c) => ({
      naam: c.name || c.hostname || c.mac,
      mac: c.mac ?? null,
      ip: c.ip ?? null,
      ap: apNaam.get(c.ap_mac) ?? c.ap_mac ?? null,
      band: BAND[c.radio] ?? c.radio ?? null,
      kanaal: c.channel ?? null,
      signaal: c.signal ?? null,
      beoordeling: beoordeelSignaal(c.signal),
      ssid: c.essid ?? null,
      uptimeMin: Number.isFinite(c.uptime) ? Math.round(c.uptime / 60) : null,
      roams: c.roam_count ?? null,
      retriesPct: c.wifi_tx_retries_percentage ?? null,
      satisfaction: c.satisfaction ?? null,
    }));
}

// Bewust een whitelist van velden: wat hier niet genoemd wordt, komt ook niet in de uitvoer.
export function samenvattingWlans(wlans) {
  return (wlans ?? []).map((w) => ({
    ssid: w.name ?? null,
    aan: w.enabled !== false,
    beveiliging: [w.security, w.wpa_mode].filter(Boolean).join("/") || null,
    band: w.wlan_band ?? null,
    fastRoaming80211r: Boolean(w.fast_roaming_enabled),
    bssTransition80211v: Boolean(w.bss_transition),
    roamingAssistant5: w.roaming_assistant_na_enabled ? w.roaming_assistant_na_rssi ?? null : null,
    minRate24: w.minrate_ng_enabled ? w.minrate_ng_data_rate_kbps / 1000 : null,
    minRate5: w.minrate_na_enabled ? w.minrate_na_data_rate_kbps / 1000 : null,
    pmf: w.pmf_mode ?? null,
    uapsd: Boolean(w.uapsd_enabled),
  }));
}

const EVENT_SOORT = {
  CLIENT_ROAMED: "roam",
  CLIENT_CONNECTED_WIRELESS: "verbonden",
  CLIENT_DISCONNECTED_WIRELESS: "verbroken",
  CLIENT_CONNECTED_WIRED: "verbonden (kabel)",
  CLIENT_DISCONNECTED_WIRED: "verbroken (kabel)",
};

function getal(param) {
  const n = parseFloat(String(param?.name ?? ""));
  return Number.isFinite(n) ? n : null;
}

export function eventsPlat(events) {
  return (events ?? [])
    .map((e) => {
      const p = e.parameters ?? {};
      const roam = e.event === "CLIENT_ROAMED";
      return {
        ts: e.timestamp,
        tijd: tijdNL(e.timestamp),
        soort: EVENT_SOORT[e.event] ?? e.event,
        toestel: p.CLIENT?.name || p.CLIENT?.hostname || p.CLIENT?.id || null,
        mac: p.CLIENT?.id ?? null,
        vanAp: roam ? p.DEVICE_FROM?.name ?? null : null,
        naarAp: roam ? p.DEVICE_TO?.name ?? null : p.DEVICE?.name ?? null,
        signaalVoor: roam ? getal(p.PREVIOUS_SIGNAL_STRENGTH) : null,
        signaal: getal(p.SIGNAL_STRENGTH),
        band: p.RADIO_BAND?.name ?? null,
        ssid: p.WLAN?.name ?? null,
        duur: p.DURATION?.name ?? null,
      };
    })
    .sort((a, b) => a.ts - b.ts);
}

export function matchToestel(rijen, zoek) {
  const z = String(zoek ?? "").trim().toLowerCase();
  if (!z) return [];
  return (rijen ?? []).filter(
    (r) =>
      [r.naam, r.mac, r.ip].some((v) => v != null && String(v).toLowerCase() === z) ||
      String(r.naam ?? "").toLowerCase().includes(z)
  );
}
```

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts
git commit -m "feat(netwerk-diagnose): samenvattingen van apparaten, clients, wifi en events

AB#1040

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Secrets ophalen (az, env, Python-SDK)

**Files:**
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.mjs`
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
- Create: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/kv-secret.py`

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces:
  - `VAULT = "juict-shared-kv"`, `SECRETS = {url: "UNIFI-URL", user: "UNIFI-USER", pass: "UNIFI-PASS"}`, `ENV_VARS = {url: "UNIFI_URL", user: "UNIFI_USER", pass: "UNIFI_PASS"}`
  - `KV_ROUTES = ["auto", "python"]`
  - `haalSecretOp(soort: "url"|"user"|"pass", {env?, run?, python?, route?: "auto"|"python"}): string` (`run` heeft de signatuur van `execFileSync(cmd, args, opts)`; `route: "python"` slaat `az` over)
  - `haalAlleSecrets(opts?): {url, user, pass}`

- [ ] **Step 1: Schrijf de falende tests**

Voeg toe aan de import: `VAULT, SECRETS, ENV_VARS, KV_ROUTES, haalSecretOp, haalAlleSecrets`. Voeg toe:

```js
function nepRun(antwoorden) {
  const aanroepen = [];
  const run = (cmd, args) => {
    aanroepen.push([cmd, ...args].join(" "));
    const a = antwoorden[cmd];
    if (a instanceof Error) throw a;
    return a ?? "";
  };
  return { run, aanroepen };
}

test("haalSecretOp: az eerst, met vaste vault en secretnaam", () => {
  const { run, aanroepen } = nepRun({ az: "https://controller.voorbeeld:8443\n" });
  assert.equal(haalSecretOp("url", { env: {}, run, python: "python" }), "https://controller.voorbeeld:8443");
  assert.equal(aanroepen.length, 1);
  assert.match(aanroepen[0], new RegExp(`^az keyvault secret show --vault-name ${VAULT} --name ${SECRETS.url} `));
});

test("haalSecretOp: zonder az valt hij terug op de env var", () => {
  const { run, aanroepen } = nepRun({ az: new Error("geweigerd") });
  assert.equal(haalSecretOp("user", { env: { [ENV_VARS.user]: "lezer" }, run, python: "python" }), "lezer");
  assert.equal(aanroepen.length, 1);
});

test("haalSecretOp: zonder az en env valt hij terug op kv-secret.py", () => {
  const { run, aanroepen } = nepRun({ az: new Error("geweigerd"), python: "waarde-uit-sdk" });
  assert.equal(haalSecretOp("pass", { env: {}, run, python: "python" }), "waarde-uit-sdk");
  assert.match(aanroepen[1], /^python .*kv-secret\.py UNIFI-PASS$/);
});

test("haalSecretOp: alles mislukt geeft een melding met alle drie de routes en geen waarden", () => {
  const { run } = nepRun({ az: new Error("geweigerd"), python: new Error("geen module") });
  assert.throws(
    () => haalSecretOp("pass", { env: {}, run, python: "python" }),
    (e) => /az login/.test(e.message) && /UNIFI_PASS/.test(e.message) && /kv-secret\.py/.test(e.message)
  );
});

test("haalSecretOp: lege az-uitvoer telt als mislukt", () => {
  const { run } = nepRun({ az: "  \n", python: "" });
  assert.throws(() => haalSecretOp("url", { env: {}, run, python: "python" }), /UNIFI-URL/);
});

test("haalSecretOp: route python slaat az over", () => {
  const { run, aanroepen } = nepRun({ az: "mag-niet", python: "uit-sdk" });
  assert.equal(haalSecretOp("url", { env: {}, run, python: "python", route: "python" }), "uit-sdk");
  assert.equal(aanroepen.length, 1);
  assert.doesNotMatch(aanroepen[0], /^az /);
  assert.deepEqual(KV_ROUTES, ["auto", "python"]);
});

test("haalSecretOp: onbekende route gooit", () => {
  assert.throws(() => haalSecretOp("url", { env: {}, run: () => "x", route: "cli" }), /--kv/);
});

test("haalAlleSecrets: haalt alle drie op", () => {
  const { run } = nepRun({ az: "x" });
  assert.deepEqual(haalAlleSecrets({ env: {}, run, python: "python" }), { url: "x", user: "x", pass: "x" });
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: FAIL, `haalSecretOp` is geen export.

- [ ] **Step 3: Implementeer**

Bovenaan `unifi-lookup.mjs`, onder het commentaarblok:

```js
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
```

En verder:

```js
export const VAULT = "juict-shared-kv";
export const SECRETS = { url: "UNIFI-URL", user: "UNIFI-USER", pass: "UNIFI-PASS" };
export const ENV_VARS = { url: "UNIFI_URL", user: "UNIFI_USER", pass: "UNIFI_PASS" };
const KV_HELPER = resolve(dirname(fileURLToPath(import.meta.url)), "kv-secret.py");
const STANDAARD_PYTHON = process.platform === "win32" ? "python" : "python3";
const STIL = { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] };

// Volgorde: az (zoals de andere juict-skills), dan env var, dan de Python-SDK-helper voor omgevingen
// waar de az keyvault-route niet beschikbaar is. Foutmeldingen bevatten nooit een waarde, alleen welke
// route faalde.
export const KV_ROUTES = ["auto", "python"];

// route "python" slaat az over. Bedoeld voor omgevingen waar de az keyvault-opdracht bewust geblokkeerd
// is: dan roepen we hem ook niet via een subproces aan.
export function haalSecretOp(soort, { env = process.env, run = execFileSync, python = STANDAARD_PYTHON, route = "auto" } = {}) {
  const naam = SECRETS[soort];
  const envNaam = ENV_VARS[soort];
  if (!naam) throw new Error(`Onbekend secret-soort: ${soort}`);
  if (!KV_ROUTES.includes(route)) throw new Error(`--kv moet een van ${KV_ROUTES.join(", ")} zijn.`);
  const fouten = [];

  if (route === "auto") {
    try {
      const v = String(run("az", ["keyvault", "secret", "show", "--vault-name", VAULT, "--name", naam, "--query", "value", "-o", "tsv"], STIL)).trim();
      if (v) return v;
      fouten.push("az gaf een lege waarde");
    } catch {
      fouten.push("az keyvault lukte niet");
    }
  }

  if (env[envNaam]) return env[envNaam];
  fouten.push(`env var ${envNaam} is niet gezet`);

  try {
    const v = String(run(python, [KV_HELPER, naam], STIL)).trim();
    if (v) return v;
    fouten.push("kv-secret.py gaf een lege waarde");
  } catch {
    fouten.push("kv-secret.py lukte niet");
  }

  throw new Error(
    `Secret ${naam} niet op te halen (${fouten.join("; ")}). Routes: ` +
      `(1) az login met leesrechten op Key Vault ${VAULT}; ` +
      `(2) env var ${envNaam}; ` +
      `(3) Python 3 met azure-identity en azure-keyvault-secrets voor scripts/kv-secret.py.`
  );
}

export function haalAlleSecrets(opts) {
  return { url: haalSecretOp("url", opts), user: haalSecretOp("user", opts), pass: haalSecretOp("pass", opts) };
}
```

`kv-secret.py`:

```python
#!/usr/bin/env python3
"""Key Vault-fallback voor unifi-lookup.mjs.

Schrijft de waarde van precies een toegestane secret naar stdout, voor het aanroepende proces.
Nooit zelf aanroepen om een waarde in je terminal te zien: dat is precies wat deze skill vermijdt.
"""
import sys

TOEGESTAAN = {"UNIFI-URL", "UNIFI-USER", "UNIFI-PASS"}
VAULT_URL = "https://juict-shared-kv.vault.azure.net"


def main(argv):
    if len(argv) != 2 or argv[1] not in TOEGESTAAN:
        print("Gebruik: kv-secret.py <UNIFI-URL|UNIFI-USER|UNIFI-PASS>", file=sys.stderr)
        return 2
    try:
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.secrets import SecretClient
    except ImportError:
        print("Installeer azure-identity en azure-keyvault-secrets (pip install azure-identity azure-keyvault-secrets).", file=sys.stderr)
        return 3
    try:
        waarde = SecretClient(VAULT_URL, DefaultAzureCredential()).get_secret(argv[1]).value
    except Exception as fout:  # alleen het type, nooit details die een waarde kunnen bevatten
        print(f"Key Vault-fout: {type(fout).__name__}", file=sys.stderr)
        return 4
    sys.stdout.write(waarde or "")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: PASS, 32 tests.

Run ook: `python plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/kv-secret.py ONGELDIG; echo "exit=$?"`
Expected: gebruiksmelding op stderr, `exit=2`, geen Key Vault-aanroep.

- [ ] **Step 5: Commit**

```bash
git add plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts
git commit -m "feat(netwerk-diagnose): secrets via az, env of Python-SDK-helper

AB#1040

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: HTTP-client, subcommando's en CLI

**Files:**
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.mjs`
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`

**Interfaces:**
- Consumes: `assertVerzoekToegestaan`, `redactUnifi`, `SITE_ID_RE` (Task 2); `resolveSite`, `siteRij` (Task 3); `samenvattingApparaten`, `samenvattingClients`, `samenvattingWlans`, `eventsPlat`, `matchToestel`, `tijdNL` (Task 4); `haalAlleSecrets` (Task 5).
- Produces:
  - `class EndpointOntbreekt extends Error` met `.pad`
  - `maakClient({baseUrl, user, pass, fetchFn}): {login(), logout(), get(pad), post(pad, body)}`
  - `EVENTS_PAGE_SIZE = 200`, `EVENTS_MAX_PAGES = 20`
  - `haalSites(client): object[]`
  - `snapshot(client, site): {apparaten, clients, wifi, ontbreekt: string[]}`
  - `haalEvents(client, site, {dagen, nu, pageSize, maxPaginas}): {events, afgekapt: boolean}`
  - `clientInfo(client, site, zoek, {dagen, nu}): {actueel, bekend, events, afgekapt, ontbreekt}`
  - `SUBCOMMANDS = ["sites", "site", "snapshot", "events", "client"]`
  - `runCli(argv: string[], {secrets, fetchFn, log}): Promise<void>` (`secrets` wordt aangeroepen met `{route}` uit `--kv`)

- [ ] **Step 1: Schrijf de falende tests**

Voeg toe aan de import: `EndpointOntbreekt, maakClient, haalSites, snapshot, haalEvents, clientInfo, runCli, SUBCOMMANDS, EVENTS_MAX_PAGES`. Voeg toe:

```js
// Nep-controller: routes "METHODE /pad" → (body, verzoek) => [status, json]. Houdt alle verzoeken bij.
function nepController(routes) {
  const verzoeken = [];
  const fetchFn = async (url, init = {}) => {
    const pad = new URL(url).pathname + new URL(url).search;
    const sleutel = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    verzoeken.push({ sleutel, pad, body, headers: init.headers ?? {} });
    const route = routes[sleutel];
    const [status, json, headers] = route ? route(body) : [404, { fout: "niet gevonden" }];
    // Een eigen object i.p.v. new Response(): zo hangt de test niet af van hoe de runtime set-cookie filtert.
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers({ "content-type": "application/json", ...(headers ?? {}) }),
      json: async () => json,
    };
  };
  return { fetchFn, verzoeken };
}

const BASIS = "https://controller.voorbeeld:8443";
const LOGIN_OK = { "POST /api/login": () => [200, { meta: { rc: "ok" } }, { "set-cookie": "unifises=abc; Path=/; HttpOnly", "x-csrf-token": "tok" }], "POST /api/logout": () => [200, {}] };
const SITE_API = {
  "GET /api/self/sites": () => [200, { data: [
    { name: "aaa11111", desc: "Bakkerij Voorbeeld (1234567890123456)", device_count: 2 },
    { name: "bbb22222", desc: "Voorbeeld Makelaars Almelo B.V. (9999999999999999)", device_count: 2 },
  ] }],
  "GET /api/s/aaa11111/stat/device": () => [200, { data: DEVICES }],
  "GET /api/s/aaa11111/stat/sta": () => [200, { data: [
    { mac: "bb:bb:bb:00:00:01", hostname: "Telefoon-A", ap_mac: "aa:aa:aa:00:00:01", radio: "na", signal: -82, is_wired: false },
  ] }],
  "GET /api/s/aaa11111/rest/wlanconf": () => [200, { data: [{ name: "Kantoor", x_passphrase: "geheim", bss_transition: true }] }],
  "GET /api/s/aaa11111/stat/alluser": () => [200, { data: [{ mac: "bb:bb:bb:00:00:01", hostname: "Telefoon-A", last_ip: "10.0.0.5", last_seen: 1790841600, is_wired: false }] }],
};
const geenSecrets = () => ({ url: BASIS, user: "lezer", pass: "GeheimWachtwoord!" });

test("maakClient: login zet cookie en csrf, verzoeken buiten de allowlist worden niet verstuurd", async () => {
  const { fetchFn, verzoeken } = nepController({ ...LOGIN_OK, ...SITE_API });
  const c = maakClient({ baseUrl: BASIS + "/", user: "lezer", pass: "pw", fetchFn });
  await c.login();
  await c.get("/api/self/sites");
  assert.equal(verzoeken[1].headers.Cookie, "unifises=abc");
  assert.equal(verzoeken[1].headers["X-Csrf-Token"], "tok");
  await assert.rejects(() => c.post("/api/s/aaa11111/cmd/devmgr", { cmd: "restart" }), /Geweigerd/);
  assert.equal(verzoeken.length, 2, "geweigerd verzoek mag niet verstuurd zijn");
});

test("maakClient: respons gaat door redactUnifi", async () => {
  const { fetchFn } = nepController({ ...LOGIN_OK, ...SITE_API });
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const j = await c.get("/api/s/aaa11111/rest/wlanconf");
  assert.ok(!JSON.stringify(j).includes("geheim"));
});

test("maakClient: mislukte login geeft melding zonder wachtwoord", async () => {
  const { fetchFn, verzoeken } = nepController({ "POST /api/login": () => [401, { meta: { rc: "error", msg: "api.err.Invalid" } }] });
  const c = maakClient({ baseUrl: BASIS, user: "lezer", pass: "GeheimWachtwoord!", fetchFn });
  await assert.rejects(
    () => c.login(),
    (e) => /Inloggen .* mislukt \(HTTP 401\)/.test(e.message) && /2FA/.test(e.message) && !e.message.includes("GeheimWachtwoord!")
  );
  assert.equal(verzoeken.length, 1);
});

test("maakClient: 404 wordt EndpointOntbreekt", async () => {
  const { fetchFn } = nepController({ ...LOGIN_OK });
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  await assert.rejects(() => c.get("/api/s/aaa11111/stat/device"), EndpointOntbreekt);
});

test("snapshot: ontbrekend wlanconf-endpoint levert de rest wel en meldt wat ontbreekt", async () => {
  const routes = { ...LOGIN_OK, ...SITE_API };
  delete routes["GET /api/s/aaa11111/rest/wlanconf"];
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const s = await snapshot(c, "aaa11111");
  assert.equal(s.apparaten.length, 2);
  assert.equal(s.clients[0].ap, "AP-01");
  assert.deepEqual(s.wifi, []);
  assert.equal(s.ontbreekt.length, 1);
  assert.match(s.ontbreekt[0], /wifi.*rest\/wlanconf.*LESSONS\.md/);
});

test("haalEvents: pagineert, stopt bij het maximum en meldt afkappen", async () => {
  let paginas = 0;
  const routes = { ...LOGIN_OK, "POST /v2/api/site/aaa11111/system-log/all": (body) => {
    paginas++;
    assert.deepEqual(body.categories, ["CLIENT_DEVICES"]);
    return [200, { data: [{ event: "CLIENT_ROAMED", timestamp: 1790841600000 + body.pageNumber, parameters: {} }], total_page_count: 50 }];
  } };
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const r = await haalEvents(c, "aaa11111", { dagen: 14, nu: 1790841600000 });
  assert.equal(paginas, EVENTS_MAX_PAGES);
  assert.equal(r.events.length, EVENTS_MAX_PAGES);
  assert.equal(r.afgekapt, true);
});

test("haalEvents: periode loopt van nu min dagen tot nu", async () => {
  let gezien;
  const routes = { ...LOGIN_OK, "POST /v2/api/site/aaa11111/system-log/all": (body) => { gezien = body; return [200, { data: [], total_page_count: 0 }]; } };
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const r = await haalEvents(c, "aaa11111", { dagen: 3, nu: 1000 * 86400000 });
  assert.equal(gezien.timestampTo - gezien.timestampFrom, 3 * 86400000);
  assert.equal(r.afgekapt, false);
});

test("clientInfo: vindt toestel op MAC in hoofdletters, met events van dat toestel", async () => {
  const routes = { ...LOGIN_OK, ...SITE_API, "POST /v2/api/site/aaa11111/system-log/all": () => [200, { data: [
    { event: "CLIENT_DISCONNECTED_WIRELESS", timestamp: 1790841600000, parameters: { CLIENT: { id: "bb:bb:bb:00:00:01", hostname: "Telefoon-A" } } },
    { event: "CLIENT_DISCONNECTED_WIRELESS", timestamp: 1790841600001, parameters: { CLIENT: { id: "cc:cc:cc:00:00:09", hostname: "Ander" } } },
  ], total_page_count: 1 }] };
  const { fetchFn } = nepController(routes);
  const c = maakClient({ baseUrl: BASIS, user: "u", pass: "p", fetchFn });
  await c.login();
  const r = await clientInfo(c, "aaa11111", "BB:BB:BB:00:00:01", { dagen: 14, nu: 1790841700000 });
  assert.equal(r.actueel.length, 1);
  assert.equal(r.bekend[0].ip, "10.0.0.5");
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].mac, "bb:bb:bb:00:00:01");
});

test("runCli: onbekend subcommando faalt vóór het ophalen van secrets", async () => {
  let opgehaald = false;
  await assert.rejects(() => runCli(["bogus"], { secrets: () => { opgehaald = true; return geenSecrets(); }, log: () => {} }), /Onbekend subcommando/);
  assert.equal(opgehaald, false);
});

test("runCli: ongeldige site-ID en --dagen worden geweigerd vóór login", async () => {
  await assert.rejects(() => runCli(["snapshot", "Bakkerij Voorbeeld"], { secrets: geenSecrets, log: () => {} }), /korte site-ID/);
  await assert.rejects(() => runCli(["events", "aaa11111", "--dagen", "0"], { secrets: geenSecrets, log: () => {} }), /--dagen/);
  await assert.rejects(() => runCli(["client", "aaa11111"], { secrets: geenSecrets, log: () => {} }), /toestel/);
});

test("runCli: site op naam meldt dat bevestiging nodig is; logout volgt altijd", async () => {
  const { fetchFn, verzoeken } = nepController({ ...LOGIN_OK, ...SITE_API });
  const uit = [];
  await runCli(["site", "Bakkerij Voorbeeld"], { secrets: geenSecrets, fetchFn, log: (s) => uit.push(s) });
  const tekst = uit.join("\n");
  assert.match(tekst, /aaa11111/);
  assert.match(tekst, /op naam gevonden.*bevestig/i);
  assert.equal(verzoeken.at(-1).sleutel, "POST /api/logout");
});

test("runCli: snapshot --json bevat geen wifi-wachtwoord en geen login-wachtwoord", async () => {
  const { fetchFn } = nepController({ ...LOGIN_OK, ...SITE_API });
  const uit = [];
  await runCli(["snapshot", "aaa11111", "--json"], { secrets: geenSecrets, fetchFn, log: (s) => uit.push(s) });
  const tekst = uit.join("\n");
  const j = JSON.parse(tekst);
  assert.equal(j.apparaten[0].naam, "AP-01");
  assert.ok(!tekst.includes("geheim"));
  assert.ok(!tekst.includes("GeheimWachtwoord!"));
});

test("runCli: --kv python wordt doorgegeven aan secrets; ongeldige waarde faalt vóór secrets", async () => {
  const { fetchFn } = nepController({ ...LOGIN_OK, ...SITE_API });
  let gekregen;
  await runCli(["sites", "--kv", "python"], { secrets: (o) => { gekregen = o; return geenSecrets(); }, fetchFn, log: () => {} });
  assert.deepEqual(gekregen, { route: "python" });
  let opgehaald = false;
  await assert.rejects(() => runCli(["sites", "--kv", "cli"], { secrets: () => { opgehaald = true; return geenSecrets(); }, log: () => {} }), /--kv/);
  assert.equal(opgehaald, false);
});

test("runCli: zonder argumenten toont gebruik; SUBCOMMANDS klopt", async () => {
  const uit = [];
  await runCli([], { secrets: geenSecrets, log: (s) => uit.push(s) });
  assert.match(uit.join("\n"), /Gebruik/);
  assert.deepEqual(SUBCOMMANDS, ["sites", "site", "snapshot", "events", "client"]);
});
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/unifi-lookup.test.mjs`
Expected: FAIL, `maakClient` is geen export.

- [ ] **Step 3: Implementeer**

Voeg toe aan `unifi-lookup.mjs`:

```js
export class EndpointOntbreekt extends Error {
  constructor(pad) {
    super(`Endpoint ${pad} geeft 404 op deze controller. UniFi wijzigt endpoints tussen versies; zie LESSONS.md.`);
    this.name = "EndpointOntbreekt";
    this.pad = pad;
  }
}

async function leesJson(r, pad) {
  if (r.status === 404) throw new EndpointOntbreekt(pad);
  if (!r.ok) throw new Error(`HTTP ${r.status} op ${pad}`);
  return redactUnifi(await r.json());
}

function lijst(j) {
  if (Array.isArray(j)) return j;
  return Array.isArray(j?.data) ? j.data : [];
}

function cookiesUit(headers) {
  const ruw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return ruw.map((c) => c.split(";")[0]).join("; ");
}

// TLS-verificatie staat aan via de standaard fetch; er is bewust geen optie om dat uit te zetten.
export function maakClient({ baseUrl, user, pass, fetchFn = fetch }) {
  const basis = String(baseUrl ?? "").replace(/\/+$/, "");
  let cookie = null;
  let csrf = null;

  async function verzoek(methode, pad, body) {
    assertVerzoekToegestaan(methode, pad);
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers["X-Csrf-Token"] = csrf;
    return fetchFn(basis + pad, {
      method: methode,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "error",
    });
  }

  return {
    async login() {
      const r = await verzoek("POST", "/api/login", { username: user, password: pass });
      if (!r.ok) {
        throw new Error(
          `Inloggen bij de UniFi-controller mislukt (HTTP ${r.status}). Mogelijke oorzaken: verkeerde ` +
            `gebruikersnaam of wachtwoord in Key Vault, 2FA aan op het account, of account geblokkeerd.`
        );
      }
      cookie = cookiesUit(r.headers);
      csrf = r.headers.get("x-csrf-token");
    },
    async logout() {
      try {
        await verzoek("POST", "/api/logout", {});
      } catch {
        // afmelden is beleefdheid; een fout hier mag de uitkomst niet verpesten
      }
    },
    async get(pad) {
      return leesJson(await verzoek("GET", pad), pad);
    },
    async post(pad, body) {
      return leesJson(await verzoek("POST", pad, body), pad);
    },
  };
}

export const EVENTS_PAGE_SIZE = 200;
export const EVENTS_MAX_PAGES = 20;

export async function haalSites(client) {
  return lijst(await client.get("/api/self/sites"));
}

export async function snapshot(client, site) {
  const ruw = {};
  const ontbreekt = [];
  const onderdelen = [
    ["apparaten", `/api/s/${site}/stat/device`],
    ["clients", `/api/s/${site}/stat/sta`],
    ["wifi", `/api/s/${site}/rest/wlanconf`],
  ];
  for (const [naam, pad] of onderdelen) {
    try {
      ruw[naam] = lijst(await client.get(pad));
    } catch (e) {
      if (!(e instanceof EndpointOntbreekt)) throw e;
      ruw[naam] = [];
      ontbreekt.push(`${naam}: ${e.message}`);
    }
  }
  return {
    apparaten: samenvattingApparaten(ruw.apparaten),
    clients: samenvattingClients(ruw.clients, ruw.apparaten),
    wifi: samenvattingWlans(ruw.wifi),
    ontbreekt,
  };
}

export async function haalEvents(client, site, { dagen = 14, nu = Date.now(), pageSize = EVENTS_PAGE_SIZE, maxPaginas = EVENTS_MAX_PAGES } = {}) {
  const van = nu - dagen * 86400000;
  const alle = [];
  let pagina = 0;
  let totaal = 1;
  while (pagina < totaal && pagina < maxPaginas) {
    const j = await client.post(`/v2/api/site/${site}/system-log/all`, {
      timestampFrom: van,
      timestampTo: nu,
      pageSize,
      pageNumber: pagina,
      categories: ["CLIENT_DEVICES"],
    });
    alle.push(...lijst(j));
    totaal = Number(j?.total_page_count ?? 0);
    pagina++;
  }
  return { events: eventsPlat(alle), afgekapt: totaal > maxPaginas };
}

export async function clientInfo(client, site, zoek, opts = {}) {
  const dagen = opts.dagen ?? 14;
  const snap = await snapshot(client, site);
  const { events, afgekapt } = await haalEvents(client, site, opts);
  let bekendRuw = [];
  const ontbreekt = [...snap.ontbreekt];
  try {
    bekendRuw = lijst(await client.get(`/api/s/${site}/stat/alluser?within=${dagen * 24}`));
  } catch (e) {
    if (!(e instanceof EndpointOntbreekt)) throw e;
    ontbreekt.push(`bekende toestellen: ${e.message}`);
  }
  const bekendAlle = bekendRuw.map((u) => ({
    naam: u.name || u.hostname || u.mac,
    mac: u.mac ?? null,
    ip: u.last_ip ?? null,
    laatstGezien: Number.isFinite(u.last_seen) ? tijdNL(u.last_seen * 1000) : null,
    bekabeld: Boolean(u.is_wired),
  }));
  const actueel = matchToestel(snap.clients, zoek);
  const bekend = matchToestel(bekendAlle, zoek);
  const macs = new Set([...actueel, ...bekend].map((r) => String(r.mac).toLowerCase()));
  const z = String(zoek).toLowerCase();
  return {
    actueel,
    bekend,
    events: events.filter((e) => macs.has(String(e.mac).toLowerCase()) || String(e.toestel ?? "").toLowerCase().includes(z)),
    afgekapt,
    ontbreekt,
  };
}

export const SUBCOMMANDS = ["sites", "site", "snapshot", "events", "client"];

const GEBRUIK = `Gebruik: node unifi-lookup.mjs <subcommando> [argumenten] [--json] [--dagen N]

  sites [zoekterm]                  Sites met naam, IT Glue-ID en korte site-ID
  site <itglue-id|site-id|naam>     Koppelt naar precies één site, of toont kandidaten
  snapshot <site-id>                Apparaten, radio's, wifi-clients en wifi-instellingen
  events <site-id> [--dagen N]      Verbinden, verbreken en roamen (standaard 14 dagen, max 90)
  client <site-id> <naam|mac|ip>    Eén toestel: actuele stand, laatst gezien en zijn events

  --json         gestructureerde uitvoer voor verdere analyse
  --kv python    secrets zonder az ophalen (env var, dan scripts/kv-secret.py)

Read-only. Wifi-wachtwoorden en andere geheimen worden nooit getoond. Tijden in Europe/Amsterdam.
snapshot, events en client verwachten de korte site-ID uit "site"; zo wordt er nooit stil een site gegokt.`;

export function formatTabel(rijen, kolommen) {
  if (!rijen?.length) return "Geen resultaten.";
  const cel = (v) => (v === null || v === undefined ? "-" : typeof v === "boolean" ? (v ? "ja" : "nee") : String(v));
  const breedtes = kolommen.map((k) => Math.max(k.length, ...rijen.map((r) => cel(r[k]).length)));
  const regel = (vals) => vals.map((v, i) => v.padEnd(breedtes[i])).join("  ").trimEnd();
  return [regel(kolommen), regel(breedtes.map((b) => "-".repeat(b))), ...rijen.map((r) => regel(kolommen.map((k) => cel(r[k]))))].join("\n");
}

function radioRijen(apparaten) {
  return apparaten.flatMap((a) => a.radios.map((r) => ({ ap: a.naam, ...r })));
}

function formatteer(cmd, u) {
  if (cmd === "sites") return formatTabel(u, ["naam", "itglueId", "site", "apparaten"]);
  if (cmd === "site") {
    if (u.match) {
      const regel = `Site: ${u.match.naam} (site-id ${u.match.site}, IT Glue ${u.match.itglueId ?? "-"})`;
      return u.via === "naam" ? `${regel}\nOp naam gevonden: laat de gebruiker bevestigen dat dit de juiste site is.` : regel;
    }
    if (u.kandidaten.length) return `Meerdere sites gevonden, laat de gebruiker kiezen:\n${formatTabel(u.kandidaten, ["naam", "itglueId", "site", "apparaten"])}`;
    return u.via === "itglue-id"
      ? "Geen site met dit IT Glue-ID. Probeer de naam (de sitenaam kan zijn afgekapt) en laat de gebruiker bevestigen."
      : "Geen site gevonden op deze naam.";
  }
  const ontbreekt = (u.ontbreekt ?? []).map((o) => `Let op, ontbreekt: ${o}`);
  const afgekapt = u.afgekapt ? [`Let op: meer dan ${EVENTS_MAX_PAGES} pagina's events; de lijst is afgekapt. Kies minder dagen.`] : [];
  if (cmd === "snapshot") {
    return [
      "APPARATEN", formatTabel(u.apparaten, ["naam", "type", "model", "firmware", "upgradeBeschikbaar", "uptimeDagen", "online", "clients"]),
      "", "RADIO'S", formatTabel(radioRijen(u.apparaten), ["ap", "band", "kanaal", "breedte", "dfs", "zendvermogen", "maxZendvermogen", "ruimte", "clients", "kanaalbezetting", "retriesPct", "minRssi"]),
      "", "WIFI-CLIENTS", formatTabel(u.clients, ["naam", "mac", "ip", "ap", "band", "kanaal", "signaal", "beoordeling", "uptimeMin", "roams", "retriesPct"]),
      "", "WIFI-INSTELLINGEN", formatTabel(u.wifi, ["ssid", "aan", "beveiliging", "band", "fastRoaming80211r", "bssTransition80211v", "roamingAssistant5", "minRate24", "minRate5", "pmf", "uapsd"]),
      ...ontbreekt,
    ].join("\n");
  }
  const eventKolommen = ["tijd", "soort", "toestel", "vanAp", "naarAp", "signaalVoor", "signaal", "band", "duur"];
  if (cmd === "events") return [formatTabel(u.events, eventKolommen), ...afgekapt].join("\n");
  return [
    "ACTUEEL", formatTabel(u.actueel, ["naam", "mac", "ip", "ap", "band", "signaal", "beoordeling", "uptimeMin", "roams"]),
    "", "BEKEND (LAATST GEZIEN)", formatTabel(u.bekend, ["naam", "mac", "ip", "laatstGezien", "bekabeld"]),
    "", "EVENTS", formatTabel(u.events, eventKolommen),
    ...afgekapt, ...ontbreekt,
  ].join("\n");
}

function leesOpties(argvIn) {
  const alsJson = argvIn.includes("--json");
  let dagen = 14;
  const i = argvIn.indexOf("--dagen");
  if (i >= 0) {
    dagen = Number(argvIn[i + 1]);
    if (!Number.isInteger(dagen) || dagen < 1 || dagen > 90) throw new Error("--dagen moet een geheel getal van 1 t/m 90 zijn.");
  }
  let route = "auto";
  const k = argvIn.indexOf("--kv");
  if (k >= 0) {
    route = argvIn[k + 1];
    if (!KV_ROUTES.includes(route)) throw new Error(`--kv moet een van ${KV_ROUTES.join(", ")} zijn.`);
  }
  const overslaan = new Set([i, i + 1, k, k + 1].filter((n, idx) => (idx < 2 ? i >= 0 : k >= 0)));
  const argv = argvIn.filter((a, j) => a !== "--json" && !overslaan.has(j));
  return { argv, alsJson, dagen, route };
}

function eisSiteId(site) {
  if (!SITE_ID_RE.test(String(site ?? ""))) {
    throw new Error(`"${site ?? ""}" is geen korte site-ID. Zoek die eerst op met: node unifi-lookup.mjs site <itglue-id|naam>`);
  }
  return site;
}

// Validatie staat vóór het ophalen van secrets en het inloggen: een tikfout kost dan geen Key
// Vault-aanroep en geen sessie op de controller.
export async function runCli(argvIn, { secrets = haalAlleSecrets, fetchFn = fetch, log = console.log } = {}) {
  const { argv, alsJson, dagen, route } = leesOpties(argvIn);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    log(GEBRUIK);
    return;
  }
  const [cmd, a1, a2] = argv;
  if (!SUBCOMMANDS.includes(cmd)) throw new Error(`Onbekend subcommando "${cmd}". Kies uit: ${SUBCOMMANDS.join(", ")}.`);
  if (cmd === "site" && !a1) throw new Error("Geef een IT Glue-ID, site-ID of naam op.");
  if (["snapshot", "events", "client"].includes(cmd)) eisSiteId(a1);
  if (cmd === "client" && !a2) throw new Error("Geef een toestel op: naam, MAC of IP.");

  const { url, user, pass } = await secrets({ route });
  const client = maakClient({ baseUrl: url, user, pass, fetchFn });
  await client.login();
  try {
    let uitkomst;
    if (cmd === "sites") {
      const rijen = (await haalSites(client)).map(siteRij);
      uitkomst = a1 ? rijen.filter((r) => `${r.naam} ${r.itglueId ?? ""} ${r.site}`.toLowerCase().includes(String(a1).toLowerCase())) : rijen;
    } else if (cmd === "site") {
      uitkomst = resolveSite(await haalSites(client), argv.slice(1).join(" "));
    } else if (cmd === "snapshot") {
      uitkomst = await snapshot(client, a1);
    } else if (cmd === "events") {
      uitkomst = await haalEvents(client, a1, { dagen });
    } else {
      uitkomst = await clientInfo(client, a1, argv.slice(2).join(" "), { dagen });
    }
    log(alsJson ? JSON.stringify(uitkomst, null, 2) : formatteer(cmd, uitkomst));
  } finally {
    await client.logout();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/*.test.mjs`
Expected: PASS, alle tests in beide bestanden (46 in `unifi-lookup.test.mjs`, 5 in `plugin-structuur.test.mjs`).

- [ ] **Step 5: Commit**

```bash
git add plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts
git commit -m "feat(netwerk-diagnose): HTTP-client, subcommando's en CLI

AB#1040

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: SKILL.md, REFERENCE.md en LESSONS.md

**Files:**
- Modify: `plugins/netwerk-diagnose/skills/netwerk-diagnose/SKILL.md` (stub vervangen)
- Create: `plugins/netwerk-diagnose/skills/netwerk-diagnose/REFERENCE.md`
- Create: `plugins/netwerk-diagnose/skills/netwerk-diagnose/LESSONS.md`

**Interfaces:**
- Consumes: subcommando's en uitvoervelden uit Task 6; drempels uit Task 4.
- Produces: de documentatie waarmee Claude de skill gebruikt.

- [ ] **Step 1: Schrijf SKILL.md**

```markdown
---
name: netwerk-diagnose
description: Netwerkproblemen bij een klant diagnosticeren met read-only UniFi-data (sites, apparaten, radio's, clients, wifi-instellingen, verbind-, verbreek- en roam-events) plus historie via Grafana. Gebruik bij een netwerk- of wifiticket, wegvallende verbindingen, slechte VoIP-kwaliteit, of een vraag over de wifi-instellingen van een klant.
---

# Netwerk-diagnose

Deze skill helpt bij het uitzoeken van netwerkproblemen bij een klant. Fase 1 dekt UniFi; Sophos volgt later.
De CLI `scripts/unifi-lookup.mjs` haalt de actuele stand en de gebeurtenissen op; de historie komt uit Grafana.
Claude maakt daar de diagnose van.

## Harde regels

1. **Alleen lezen.** De CLI weigert elk verzoek dat niet op de allowlist staat. Wijzig nooit iets in UniFi, ook
   niet via een andere route.
2. **Geen geheimen tonen.** Wifi-wachtwoorden en andere geheime velden worden door de CLI weggefilterd. Haal ze
   nooit op een andere manier op en zet ze nooit in een ticket of chat.
3. **Nooit stil een site gokken.** Gevonden op naam of meerdere kandidaten: laat de gebruiker kiezen of bevestigen.
4. **Pas schrijven naar Autotask na akkoord.** De uitkomst komt in de chat; een interne notitie, tijdregistratie of
   statuswijziging alleen na expliciet akkoord, via de `autotask-api` skill.

## Workflow: ticket-diagnose (standaard)

1. **Ticket lezen** met `autotask-api` (read-only): omschrijving, notities en de Summary Notes van de time entries.
   Neem mee wat al onderzocht is.
2. **Klant koppelen aan een site.** Autotask-bedrijf naar IT Glue-organisatie met `itglue-api`, daarna:
   `node scripts/unifi-lookup.mjs site <itglue-id>`.
   - Eén site: door.
   - "Geen site met dit IT Glue-ID": probeer `site "<klantnaam>"` (sitenamen worden op 64 tekens afgekapt, en
     sommige klanten hebben twee Autotask-bedrijven met één netwerk) en laat de gebruiker bevestigen.
   - Meerdere sites: toon ze en laat de gebruiker kiezen.
3. **Actuele stand en gebeurtenissen:**
   - `node scripts/unifi-lookup.mjs snapshot <site-id> --json`
   - `node scripts/unifi-lookup.mjs events <site-id> --dagen 14 --json`
   - Noemt het ticket een persoon of toestel: `node scripts/unifi-lookup.mjs client <site-id> "<naam|mac|ip>" --json`
4. **Historie via de Grafana-MCP** (Prometheus-datasource, unpoller). Het label `site_name` begint met de
   sitenaam; filter met `site_name=~"<sitenaam>.*"`. Nuttige queries:
   - `min_over_time(unpoller_client_radio_signal_db{site_name=~"<sitenaam>.*"}[14d])` en `avg_over_time(...)`
   - `sum by (name, radio) (unpoller_device_radio_stations{site_name=~"<sitenaam>.*"})` als range-query
   - `unpoller_device_radio_transmit_retries` en `unpoller_client_transmit_retries_total` voor retries
   Geen data voor de site: meld dat en ga door met snapshot en events.
5. **Analyse volgens de checklist hieronder.** Lever in de chat: wat speelt er, de oorzaak (of eerlijk: onduidelijk),
   is het een storing of normaal gedrag, en het advies met de afweging.
6. **Aanbieden:** "Zal ik dit als interne notitie in het ticket zetten?" Stel ook een tijdregistratie en status voor.

## Workflow: gerichte vraag

Spring direct naar stap 2 of 3 en haal alleen op wat nodig is. Voorbeelden: "wanneer viel toestel X weg" is
`client`; "welke wifi-instellingen heeft klant Y" is `snapshot` (sectie wifi-instellingen).

## Diagnose-checklist

| Onderwerp | Wat bekijken | Drempel / signaal |
|---|---|---|
| Dekking | `signaal` en `beoordeling` per client; minimum en gemiddelde uit Grafana | ≥ -67 dBm goed; -67 tot -75 krap; -75 tot -80 slecht; < -80 onbruikbaar voor spraak |
| Capaciteit | `clients` per radio, `kanaalbezetting` | veel clients op één AP terwijl een andere leeg is; bezetting structureel hoog |
| Radio's | `kanaal`, `breedte`, `dfs`, `zendvermogen` vs. `maxZendvermogen` (`ruimte`) | 2,4 GHz buiten 1/6/11 of op 40 MHz; DFS-kanaal plus verbreek-events tegelijk op alle clients; `ruimte` ≤ 3 dB betekent dat hoger zetten niets oplevert |
| Roaming | roam-events (`signaalVoor` → `signaal`), `roams` per client, wifi-instellingen (`bssTransition80211v`, `fastRoaming80211r`, `roamingAssistant5`, `minRate24/5`) | roam naar een signaal < -75 dBm; toestel blijft hangen op een zwakke AP |
| Apparatuur | `model`, `firmware`, `upgradeBeschikbaar`, `uptimeDagen` | wifi 5-AP's (bv. UAP-AC-Pro, modelcode U7PG2) waar spraak over wifi gaat; korte uptime wijst op herstarts |
| Verbreken | `verbroken`-events met tijd, AP, band en signaal | patroon op een vaste plek, AP of tijd (bv. lunch: magnetron op 2,4 GHz) |

Benoem het als de oorzaak onduidelijk is. Verzin geen oorzaak. QoS of tuning helpt pas als het signaal goed is;
bij een dekkingsgat is een extra of betere AP de echte oplossing. Benoem dan ook de afweging (kosten, meting nodig).

## Debugchecklist

1. Secret niet op te halen: de melding noemt de drie routes (az, env var, `kv-secret.py`). Is `az keyvault`
   in jouw omgeving geblokkeerd, gebruik dan `--kv python`: de CLI slaat az dan helemaal over.
2. Inloggen mislukt: controleer het account in de controller (View Only, lokaal, geen 2FA).
3. "Endpoint geeft 404": zie LESSONS.md; UniFi wijzigt endpoints tussen versies.
4. "Geweigerd": het verzoek staat niet op de allowlist. Dat is opzet; breid de allowlist alleen uit met een
   leesendpoint, met test, via een PR.

Zie [REFERENCE.md](REFERENCE.md) voor endpoints en velden, [LESSONS.md](LESSONS.md) voor valkuilen.
```

- [ ] **Step 2: Schrijf REFERENCE.md**

```markdown
# UniFi-referentie voor netwerk-diagnose

Geverifieerd tegen UniFi Network 10.5.67 (self-hosted controller), met een lokaal View Only-account.
✅ = getest met datum. Geen klantdata in dit bestand: de repo is publiek.

## Auth

| Wat | Waarde |
|---|---|
| Key Vault | `juict-shared-kv` |
| Secrets | `UNIFI-URL` (basis-URL incl. poort), `UNIFI-USER`, `UNIFI-PASS` |
| Env vars (fallback) | `UNIFI_URL`, `UNIFI_USER`, `UNIFI_PASS` |
| Login | `POST /api/login` met `{username, password}`; sessie via cookie `unifises`, plus header `X-Csrf-Token` uit de login-respons ✅ 2026-10-01 |
| Logout | `POST /api/logout` ✅ 2026-10-01 |
| Rol | `readonly` op alle sites ✅ 2026-10-01 |

## Endpoints

| Doel | Endpoint | Status |
|---|---|---|
| Sites | `GET /api/self/sites` (velden `name` = korte site-ID, `desc` = "Klantnaam (IT Glue-ID)", `device_count`) | ✅ 2026-10-01 |
| Apparaten en radio's | `GET /api/s/{site}/stat/device` | ✅ 2026-10-01 |
| Actuele clients | `GET /api/s/{site}/stat/sta` | ✅ 2026-10-01 |
| Bekende clients | `GET /api/s/{site}/stat/alluser?within=<uren>` | ✅ 2026-10-01 |
| Wifi-instellingen | `GET /api/s/{site}/rest/wlanconf` | ✅ 2026-10-01 |
| Gebeurtenissen | `POST /v2/api/site/{site}/system-log/all` | ✅ 2026-10-01 |
| Oude gebeurtenissen | `GET /api/s/{site}/stat/event`, `GET /api/s/{site}/stat/alarm` | ❌ 404 op 10.5.67 |

## Velden die de CLI gebruikt

**`stat/device`:** `name`, `type` (`uap`/`usw`/...), `model`, `mac`, `version`, `upgradable`, `uptime` (seconden),
`state` (1 = online), `num_sta`. Per radio in `radio_table`: `name` (`wifi0`/`wifi1`), `radio` (`ng` = 2,4 GHz,
`na` = 5 GHz, `6e` = 6 GHz), `ht`, `max_txpower`, `min_txpower`, `min_rssi_enabled`, `min_rssi`. In
`radio_table_stats`: `channel`, `tx_power` (dBm), `bw`, `num_sta`, `cu_total` (kanaalbezetting %), `tx_retries_pct`.

**`stat/sta`:** `hostname`, `name`, `mac`, `ip`, `ap_mac`, `radio`, `channel`, `signal` (dBm), `essid`, `uptime`,
`is_wired`, `roam_count`, `wifi_tx_retries_percentage`, `satisfaction`.

**`stat/alluser`:** `hostname`, `name`, `mac`, `last_ip`, `last_seen` (Unix-seconden), `is_wired`.

**`rest/wlanconf`:** `name`, `enabled`, `security`, `wpa_mode`, `wlan_band`, `fast_roaming_enabled` (802.11r),
`bss_transition` (802.11v), `roaming_assistant_na_enabled` + `roaming_assistant_na_rssi`, `minrate_ng_enabled` +
`minrate_ng_data_rate_kbps`, `minrate_na_enabled` + `minrate_na_data_rate_kbps`, `pmf_mode`, `uapsd_enabled`.

**`system-log/all`:** body `{timestampFrom, timestampTo, pageSize, pageNumber, categories}` (ms sinds epoch).
Geldige categorieën: `SECURITY, UNIFI_DEVICES, SOFTWARE_UPDATES, VPN, POWER, UNIFI_ETHERNET_PORTS, CLIENT_DEVICES,
UNKNOWN, AUDIT, INTERNET_AND_WAN`. Respons: `{data, page_number, total_element_count, total_page_count}`.
Events in `CLIENT_DEVICES`: `CLIENT_ROAMED`, `CLIENT_CONNECTED_WIRELESS`, `CLIENT_DISCONNECTED_WIRELESS`,
`CLIENT_CONNECTED_WIRED`, `CLIENT_DISCONNECTED_WIRED`. Parameters zijn objecten met `name` (de waarde als tekst):
`CLIENT` (`id` = MAC, `name`, `hostname`, `ip`), `DEVICE_FROM`/`DEVICE_TO`/`DEVICE` (`name`, `model`),
`SIGNAL_STRENGTH`, `PREVIOUS_SIGNAL_STRENGTH`, `RADIO_BAND`, `CHANNEL`, `WLAN`, `DURATION`.

## Grafana (Prometheus, unpoller)

Label `site_name` = `<desc> (<site-id>)`. Metrics: `unpoller_client_radio_signal_db`, `unpoller_client_rssi_db`
(signaal boven ruis, niet in dBm), `unpoller_device_radio_stations`, `unpoller_device_radio_channel`,
`unpoller_device_radio_transmit_power`, `unpoller_device_info`, `unpoller_device_uptime_seconds`,
`unpoller_client_transmit_retries_total`, `unpoller_client_roam_count_total`.
```

- [ ] **Step 3: Schrijf LESSONS.md**

```markdown
# Lessons learned: netwerk-diagnose

## UniFi API

**`stat/event` en `stat/alarm` bestaan niet meer.** Op Network 10.5.67 geven ze 404. Gebeurtenissen lopen via
`POST /v2/api/site/{site}/system-log/all` met een categorie. ✅ 2026-10-01
- How to apply: krijg je een 404 op een klassiek endpoint, zoek eerst de v2-tegenhanger voordat je concludeert dat
  de data er niet is.

**De categorie heet `CLIENT_DEVICES`, niet `CLIENT_CONNECTION`.** Een onbekende categorie geeft 400 met de lijst
geldige waarden in de foutmelding. Het veld `type` in een event (`CLIENT_CONNECTION`) is iets anders dan de
categorie. ✅ 2026-10-01

**`rest/wlanconf` kan het wifi-wachtwoord bevatten (`x_passphrase`).** Met het readonly-account kwam het veld niet
mee, maar met een beheerdersaccount of een andere versie wel. De CLI filtert alle `x_*`- en geheime velden altijd.
✅ 2026-10-01
- How to apply: vertrouw nooit op de rol van het account om geheimen buiten de uitvoer te houden.

**Sitenamen worden op 64 tekens afgekapt.** Bij lange klantnamen valt het IT Glue-ID (deels) weg, bv.
`Naam B.V.(12345`. Zoeken op ID vindt die site dan niet; de naamroute wel. ✅ 2026-10-01

**Klant, Autotask-bedrijf en netwerk zijn niet één-op-één.** Sommige klanten hebben per vestiging een eigen
Autotask-bedrijf en een eigen site; andere hebben twee Autotask-bedrijven met één netwerk. Koppel via het IT Glue-ID
en vraag bij twijfel de gebruiker.

**`unpoller_client_rssi_db` is niet het signaal in dBm.** Het is signaal boven de ruisvloer (bv. 7 bij -89 dBm).
Gebruik `unpoller_client_radio_signal_db` voor dBm. ✅ 2026-10-01

**Modelcode U7PG2 is een UAP-AC-Pro (wifi 5), geen U7 Pro.** De gelijkenis verwart makkelijk in een advies.

## Omgeving

**`az keyvault secret show` kan geblokkeerd zijn voor Claude.** Daarom de fallback naar `kv-secret.py` (Azure SDK
met `DefaultAzureCredential`). Zet secrets nooit in een `.env`-bestand.
```

- [ ] **Step 4: Draai alle tests**

Run: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/*.test.mjs`
Expected: PASS. De structuurtest controleert nu ook dat SKILL.md, REFERENCE.md en LESSONS.md geen controller-URL of echt 16-cijferig ID bevatten.

- [ ] **Step 5: Commit**

```bash
git add plugins/netwerk-diagnose/skills/netwerk-diagnose
git commit -m "docs(netwerk-diagnose): SKILL.md, REFERENCE.md en LESSONS.md

AB#1040

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Integratietest en acceptatie (handmatig, read-only)

**Files:**
- Modify (alleen als iets afwijkt): `plugins/netwerk-diagnose/skills/netwerk-diagnose/REFERENCE.md`, `LESSONS.md`

**Interfaces:**
- Consumes: de volledige CLI.
- Produces: bevestiging dat alles tegen de echte controller werkt; eventuele correcties in REFERENCE/LESSONS.

Draai vanuit `plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts`. Gebruik een testsite die de gebruiker aanwijst. Kopieer geen klantdata naar de repo. In de omgeving waar `az keyvault` voor Claude geblokkeerd is: voeg aan elke opdracht hieronder `--kv python` toe.

- [ ] **Step 1: Sites en koppeling**

Run: `node unifi-lookup.mjs sites | head -5` en `node unifi-lookup.mjs site <itglue-id-van-testsite>`
Expected: tabel met naam, IT Glue-ID en site-ID; daarna precies één site.

- [ ] **Step 2: Snapshot, events en client**

Run:
```bash
node unifi-lookup.mjs snapshot <site-id>
node unifi-lookup.mjs events <site-id> --dagen 14
node unifi-lookup.mjs client <site-id> "<toestelnaam>"
```
Expected: vier secties in de snapshot (apparaten, radio's, wifi-clients, wifi-instellingen) zonder "ontbreekt"-regels; events met NL-tijden; client met actueel, bekend en events.

- [ ] **Step 3: Geheimencontrole**

Run: `node unifi-lookup.mjs snapshot <site-id> --json | grep -Eic 'x_passphrase|"password"|passphrase|x_[a-z]'`
Expected: `0`.

- [ ] **Step 4: Weigering en foutpaden**

Run: `node unifi-lookup.mjs snapshot "Een Naam"; node unifi-lookup.mjs bogus; node unifi-lookup.mjs events <site-id> --dagen 500`
Expected: drie duidelijke meldingen, exitcode 1, geen login (geen netwerkverkeer nodig).

- [ ] **Step 5: Acceptatie**

Voer met de skill een eerder handmatig gedane wifi/VoIP-diagnose opnieuw uit (de gebruiker wijst het ticket aan).
Expected: de skill komt zelfstandig tot dezelfde conclusie en vult die aan met de roam- en verbreek-events.

- [ ] **Step 6: Commit eventuele correcties**

```bash
git add plugins/netwerk-diagnose/skills/netwerk-diagnose/REFERENCE.md plugins/netwerk-diagnose/skills/netwerk-diagnose/LESSONS.md
git commit -m "docs(netwerk-diagnose): correcties na integratietest

AB#1040

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Sla deze commit over als er niets te corrigeren was.
