# IT-inventarisatie skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een Claude Code-plugin `it-inventarisatie` waarmee een JUICT-engineer vanuit de offerte, bronnen en een interview een IT-inventarisatierapport in Claude Design maakt en het onboardingproject in Autotask invult.

**Architecture:** `SKILL.md` stuurt het proces (offerte, bronnen, interview, uitvraag-mail, rapport, Autotask). Deterministische delen zitten in standalone Node-scripts zonder npm-deps: een werkbestand per klant, DNS- en M365-lookups (alleen lezen), een rapportgenerator die uit `rapport.json` vaste A4-artboards voor het Claude Design-type maakt met een fit-check in headless Edge/Chrome, en een Autotask-script dat taakwijzigingen eerst als voorvertoning plant en pas na akkoord toepast. IT Glue en de basis-Autotask-lookups lopen via de bestaande skills `itglue-api` en `autotask-api`.

**Tech Stack:** Node 18+ (ingebouwde `fetch`, `node:dns`, `node:test`), Azure CLI (`az account get-access-token`, `az keyvault secret show`), Microsoft Graph v1.0/beta, Autotask REST zone 19, Microsoft Edge of Chrome headless, Claude Design-artifacttype via het Artifact-tool.

**Spec:** `docs/superpowers/specs/2026-11-04-it-inventarisatie-skill-design.md`

## Global Constraints

- Node 18+; geen npm-dependencies; tests met `node --test plugins/it-inventarisatie/skills/it-inventarisatie/scripts/*.test.mjs plugins/it-inventarisatie/skills/it-inventarisatie/scripts/rapport/*.test.mjs` (Node 24 accepteert geen mapnaam als argument), zonder netwerk, zonder `az`, zonder browser. Tests die een browser nodig hebben gebruiken `{ skip: !browserPad() }`.
- Node staat in `C:/Program Files/nodejs`; zet in een shell zo nodig eerst `export PATH="/c/Program Files/nodejs:$PATH"`.
- Publieke repo: geen klantnamen, tenant-ID's, Autotask- of IT Glue-ID's van klanten, e-mailadressen van klanten of personen in code, tests, fixtures of docs. Testdata is verzonnen ("Voorbeeld Techniek B.V.", domein `voorbeeldtechniek.nl`). Het Autotask-sjabloon "Easywork Basic" (id 14) en zijn taaknamen zijn JUICT-intern en mogen erin.
- Geheimen: elk object dat het werkbestand, `rapport.json`, een Autotask-notitie of stdout bereikt, gaat eerst door `scrubSecrets`. Een sleutel wordt in woorden gesplitst (camelCase, `_`, `-`, spatie) en verwijderd als een woord voorkomt in `pass`, `password`, `passwd`, `wachtwoord`, `ww`, `secret`, `psk`, `pin`, `puk`, `token`, `apikey`, `wpa`, of als de sleutel `licensekey`, `licencekey` of `productkey` bevat. Secret-waarden uit Key Vault nooit printen of loggen.
- Alleen lezen in Microsoft 365, DNS en IT Glue. Schrijven alleen in Autotask (`PATCH /Projects/{id}/Tasks`, `POST /TaskNotes`, `POST /Projects/{id}/Attachments`) en alleen met `--toepassen` na een voorvertoning; zonder die vlag is elk Autotask-commando een dry-run.
- Key Vault: probeer `juict-shared-kv`, dan `ju-hermes-emmanuel`; secrets `AUTOTASK-USERNAME`, `AUTOTASK-API-KEY`, `AUTOTASK-INTEGRATION-CODE`, `AUTOTASK-ZONE` (standaard 19). Env-fallback `AUTOTASK_USERNAME`, `AUTOTASK_API_KEY`, `AUTOTASK_INTEGRATION_CODE`, `AUTOTASK_ZONE`.
- Autotask zone 19: `Task.status` 1 New, 5 Complete; `Task.description` max 8000 tekens; tasks, projects, phases en TaskNotes zijn niet te verwijderen (`canDelete: false`); `ProjectAttachments` mag aanmaken; TaskNote `noteType` 3 (Task Notes), `publish` 2 (Internal Project Team). Sjabloon "Easywork Basic" = project 14, `projectType` 3; klantprojecten `projectType` 5.
- Rapport: A4 794 × 1123 px, vaste artboards, footer-top op 1065 px, inhoud moet minstens 12 px boven de footer eindigen. Kleuren navy `#002345`, roze `#ff3862`, tekst `#1a1f36`, muted `#5d6577`, border `#d5dae3`, achtergrond `#f4f6fb`. Gradient alleen op het voorblad: `linear-gradient(25deg, #002345 25%, #b33259 50%, #ff3862 75%)`. Font Libre Franklin via Google Fonts. Kaarten radius 15px. Geen em-dashes, geen `{{` in tekst.
- Geen prijzen of bedragen in het rapport; alleen uren.
- Werkbestand: `%USERPROFILE%\.claude\it-inventarisatie\<slug>\inventarisatie.json` (slug: kleine letters, `[a-z0-9-]`), schemaversie 1. Nooit in een repo.
- Alle tekst (meldingen, docs, rapport) in het Nederlands, volgens de JUICT-schrijfregels.
- Commits eindigen met de regel `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Geen work item.

## Review Focus

1. **Overdrachtsdocument vol wachtwoorden:** een bron met wachtwoorden in vrije tekst (niet in een veld met een geheime naam). Verwacht: `scrubSecrets` vangt sleutelnamen, en `SKILL.md` verbiedt overnemen van vrije-tekstgeheimen; `bouw.mjs` weigert een rapport waarin een string matcht op `/(wachtwoord|password)\s*[:=]/i`. Test in Task 6.
2. **Lange tabellen in de bijlage:** 60 accounts of lange adressen. Verwacht: de fit-loop splitst de tabel over vervolgpagina's tot alles past, maximaal 6 rondes, en meldt anders welke pagina te vol is. Test in Task 7.
3. **Geen GDAP-relatie:** `az account get-access-token --tenant` faalt. Verwacht: `m365-lookup` geeft `{ ok: false, reden }` en exit-code 2 zonder stacktrace, zodat het interview het M365-deel overneemt. Test in Task 4.
4. **Project niet van het sjabloon:** het klantproject mist taken uit Easywork Basic of heeft extra taken. Verwacht: `planTaskUpdates` raakt onbekende taken niet aan en meldt welke sjabloontaken ontbreken. Test in Task 8.
5. **Opnieuw draaien:** de Autotask-stap twee keer toepassen. Verwacht: geen dubbele notities (een notitie met dezelfde titel op dezelfde taak wordt overgeslagen) en geen tweede bijlage met dezelfde `fullPath`. Test in Task 8.

---

## Bestandsstructuur

```
plugins/it-inventarisatie/
  .claude-plugin/plugin.json                         Task 1
  skills/it-inventarisatie/
    SKILL.md                                         Task 1 (stub), Task 9
    REFERENCE.md                                     Task 9  (interview, schema's, taakkoppeling, publiceren)
    assets/juict-logo-pos.svg, juict-logo-dia.svg     Task 6
    voorbeeld/rapport.voorbeeld.json                 Task 5
    voorbeeld/inventarisatie.voorbeeld.json          Task 2
    scripts/
      plugin-structuur.test.mjs                      Task 1
      geheimen.mjs / geheimen.test.mjs               Task 2
      werkbestand.mjs / werkbestand.test.mjs         Task 2
      dns-lookup.mjs / dns-lookup.test.mjs           Task 3
      m365-lookup.mjs / m365-lookup.test.mjs         Task 4
      autotask-project.mjs / autotask-project.test.mjs  Task 8
      rapport/
        schema.mjs / schema.test.mjs                 Task 5
        onderdelen.mjs                               Task 6 (html-bouwstenen)
        bouw.mjs / bouw.test.mjs                     Task 6, Task 7
        fit-check.mjs / fit-check.test.mjs           Task 7
.claude-plugin/marketplace.json                      Task 1
README.md                                            Task 1, Task 9
```

Alle commando's draaien vanuit de root van de worktree.

---

### Task 1: Plugin-skelet en structuurtest

**Files:**
- Create: `plugins/it-inventarisatie/.claude-plugin/plugin.json`, `plugins/it-inventarisatie/skills/it-inventarisatie/SKILL.md` (stub), `.../scripts/plugin-structuur.test.mjs`
- Modify: `.claude-plugin/marketplace.json`, `README.md`

**Interfaces:**
- Produces: de pluginmap en de tests die elke volgende task groen moet houden.

- [ ] **Step 1: Write the failing test** `plugin-structuur.test.mjs`, kopie van de itglue-api-versie met `it-inventarisatie`: plugin.json naam + semver-versie + beschrijving > 20 tekens; marketplace-entry met `source: "./plugins/it-inventarisatie"`; README heeft `| \`it-inventarisatie\` |`; README noemt `it-inventarisatie` onder Vereisten bij Key Vault én az login; SKILL.md frontmatter `name: it-inventarisatie` en `description` ≥ 40 tekens.
- [ ] **Step 2: Run** `node --test plugins/it-inventarisatie/skills/it-inventarisatie/scripts/plugin-structuur.test.mjs` → FAIL (bestanden ontbreken).
- [ ] **Step 3: Implement** plugin.json (versie `0.1.0`, keywords `inventarisatie`, `onboarding`, `autotask`, `m365`, `claude-design`, `juict`), marketplace-entry, README-tabelrij ("Vanuit de offerte, bronnen en een interview een IT-inventarisatierapport in Claude Design maken en het Easywork Basic-onboardingproject in Autotask invullen.", Auth: "Key Vault, az login"), Vereisten-lijst bijwerken, SKILL.md-stub met frontmatter. Description: "Maakt met een engineer een IT-inventarisatie van één klantomgeving: leest eerst de offerte, haalt mail, Microsoft 365 (GDAP), IT Glue, Autotask en DNS op, vraagt de gaten uit en levert een rapport in Claude Design op, plus een ingevuld Easywork Basic-project in Autotask. Gebruik bij /it-inventarisatie, een nieuwe klant, een onboarding, een migratie of een opname van een bestaande IT-omgeving."
- [ ] **Step 4: Run** dezelfde test → PASS.
- [ ] **Step 5: Commit** `feat(it-inventarisatie): plugin-skelet en structuurtest`.

### Task 2: Geheimenfilter en werkbestand

**Files:** Create `scripts/geheimen.mjs`, `scripts/geheimen.test.mjs`, `scripts/werkbestand.mjs`, `scripts/werkbestand.test.mjs`, `voorbeeld/inventarisatie.voorbeeld.json`.

**Interfaces:**
- Produces: `isSecretKey(name: string): boolean`; `scrubSecrets<T>(value: T): T` (diepe kopie, verwijdert geheime sleutels, laat arrays en volgorde intact); `findSecretText(value): string[]` (paden van strings die matchen op `/(wachtwoord|password|ww)\s*[:=]\s*\S+/i`).
- Produces: `slugify(klant: string): string`; `werkmap(slug: string, root = process.env.IT_INVENTARISATIE_ROOT ?? join(homedir(), ".claude", "it-inventarisatie")): string`; `laad(slug, root?): Werkbestand | null`; `bewaar(slug, data, root?): string` (pad; schrijft via `scrubSecrets`, zet `bijgewerkt` op ISO-tijd); `nieuw(klant: string): Werkbestand`.
- Werkbestand-schema v1: `{ schema: 1, klant, slug, aangemaakt, bijgewerkt, stap: "offerte"|"bronnen"|"interview"|"uitvraag"|"rapport"|"autotask"|"klaar", offerte: { bestand, scope: { m365, werkplekken, server, netwerk, printers, applicaties, telefonie, beveiliging }, uren: [{ fase, uren }] }, bronnen: { mail: [], m365: null, itglue: null, autotask: null, dns: [] }, antwoorden: { <onderdeel>: {...} }, openVragen: [{ aan, vraag }], laatsteMailcheck, rapport: { artifactUrl, pdfPad }, autotask: { companyId, projectId, toegepast } }`.
- CLI `werkbestand.mjs nieuw <klant> | toon <slug> | stap <slug> <stap>`.

- [ ] **Step 1: Write failing tests** `isSecretKey` true voor `password`, `WiFi_PSK`, `adminPin`, `puk`, `apiKey`, `licenseKey`, `wachtwoord`; false voor `passive`, `pinned`, `spinner`, `typeName`; `scrubSecrets({ a: 1, ww: { password: "x" }, lijst: [{ secret: "y", naam: "n" }] })` → `{ a: 1, ww: {}, lijst: [{ naam: "n" }] }`; `findSecretText({ notitie: "Firewall wachtwoord: abc123" })` → `["notitie"]`. Werkbestand: `slugify("Voorbeeld Techniek B.V.") === "voorbeeld-techniek-bv"`; `bewaar` + `laad` round-trip in `mkdtemp`-map; `bewaar` stript `{ antwoorden: { netwerk: { adminPassword: "x" } } }`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** beide modules en `voorbeeld/inventarisatie.voorbeeld.json` (verzonnen klant, stap "interview").
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(it-inventarisatie): geheimenfilter en werkbestand`.

### Task 3: DNS-lookup

**Files:** Create `scripts/dns-lookup.mjs`, `scripts/dns-lookup.test.mjs`.

**Interfaces:**
- Consumes: `scrubSecrets` (Task 2).
- Produces: `lookupDomein(domein: string, deps = { resolveMx, resolveNs, fetch }): Promise<{ domein, mx: [{ exchange, priority }], ns: string[], m365Mail: boolean, tenantId: string|null }>`; `tenantIdUitOpenId(json): string|null` (pakt de GUID uit `token_endpoint` `https://login.microsoftonline.com/<guid>/oauth2/...`); CLI `dns-lookup.mjs <domein> [<domein>...]` print JSON. `m365Mail` = een MX eindigt op `.mail.protection.outlook.com`. `mx` bevat altijd alle records, gesorteerd op prioriteit, nooit afgekapt. Extra velden: `reserveMx: string[]` (MX-hosts met een lagere prioriteit dan Exchange Online die niet bij Microsoft horen, bijvoorbeeld een eigen mailserver) en `verificatieMx: string[]` (hosts die eindigen op `.msv1.invalid`, oude verificatierecords van Microsoft). Openid-URL: `https://login.microsoftonline.com/<domein>/v2.0/.well-known/openid-configuration`. Een resolver-fout per domein geeft lege lijst plus `fout`, nooit een crash.

- [ ] **Step 1: Write failing tests** met nep-resolvers: domein met MX `voorbeeldtechniek-nl.mail.protection.outlook.com` → `m365Mail: true`; domein met MX `mail.voorbeeldtechniek.nl` → false; domein met MX 0 `voorbeeldtechniek-nl.mail.protection.outlook.com`, 10 `mail.voorbeeldtechniek.nl` en 50 `ms12345678.msv1.invalid` → `m365Mail: true`, `reserveMx: ["mail.voorbeeldtechniek.nl"]`, `verificatieMx: ["ms12345678.msv1.invalid"]` en `mx` heeft drie records; `tenantIdUitOpenId({ token_endpoint: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token" })` → die GUID; openid 400 → `tenantId: null`; `resolveMx` gooit ENOTFOUND → `mx: [], fout: "ENOTFOUND"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(it-inventarisatie): DNS- en tenant-lookup`.

### Task 4: Microsoft 365-lookup via GDAP (alleen lezen)

**Files:** Create `scripts/m365-lookup.mjs`, `scripts/m365-lookup.test.mjs`, `scripts/fixtures/m365-raw.voorbeeld.json`.

**Interfaces:**
- Consumes: `scrubSecrets` (Task 2).
- Produces: `GRAPH_CALLS` (constante lijst `{ naam, url }`): `organization`, `domains`, `subscribedSkus`, `users` (`$select=displayName,userPrincipalName,accountEnabled,userType,assignedLicenses,createdDateTime&$top=999`), `signins` (beta `users?$select=userPrincipalName,signInActivity`), `mfa` (beta `reports/authenticationMethods/userRegistrationDetails`), `groups`, `devices`, `conditionalAccess`, `directoryRoles?$expand=members`; `haalToken(tenantId, exec = execSync): string` (`az account get-access-token --tenant <id> --resource-type ms-graph --query accessToken -o tsv`, nooit loggen); `haalRuw(tenantId, { fetch, token }): Promise<Record<naam, any|{ fout }>>` (volgt `@odata.nextLink`; een fout per call wordt `{ fout: "<status>" }`, de rest gaat door); `vatSamen(ruw): M365Samenvatting` met `{ organisatie, domeinen: [{ naam, standaard }], licenties: [{ sku, naam, totaal, inGebruik }], gebruikers: [{ naam, upn, actief, licenties: string[], laatsteAanmelding: "dd-mm-jjjj"|null, mfa: boolean|null }], apparaten: { totaal, entraJoined, compliant, verouderd }, conditionalAccess: [{ naam, staat }], beheerders: [{ rol, leden }], nietOpgehaald: string[] }`; `SKU_NAMEN` (o.a. `SPB` Business Premium, `O365_BUSINESS_PREMIUM` Business Standard, `O365_BUSINESS_ESSENTIALS` Business Basic, `ENTERPRISEPACK` Office 365 E3, `EXCHANGESTANDARD` Exchange Online Plan 1, `EXCHANGEENTERPRISE` Exchange Online Plan 2, `SPE_F1` Microsoft 365 F3, `INTUNE_A_D` Intune-apparaat, `Microsoft_365_Copilot` Copilot); gratis SKU's (`FLOW_FREE`, `POWER_BI_STANDARD`, `WINDOWS_STORE`, `RMSBASIC`) tellen niet mee. "Verouderd" = laatste aanmelding apparaat > 180 dagen of nooit.
- CLI `m365-lookup.mjs --tenant <guid|domein> [--uit <pad>]`: lost een domein op via `lookupDomein` (Task 3), print `vatSamen` als JSON. Token-fout → stdout `{ "ok": false, "reden": "Geen GDAP-toegang of az-login voor deze tenant" }`, exit 2.

- [ ] **Step 1: Write failing tests** met de fixture (verzonnen tenant, 4 gebruikers, 1 uitgeschakeld, SKU's `SPB` 3/3 en `FLOW_FREE`): licenties bevat alleen Business Premium; gebruiker met `signInActivity.lastSignInDateTime: "2026-10-30T08:00:00Z"` → `"30-10-2026"`; `ruw.managedDevices = { fout: "400" }` → `nietOpgehaald` bevat `managedDevices`; `haalToken` met een exec die gooit → CLI-pad geeft `{ ok: false }` en exit 2 (test via geëxporteerde `hoofd(argv, deps)` die `{ code, uitvoer }` teruggeeft); `haalRuw` volgt twee pagina's `@odata.nextLink`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(it-inventarisatie): M365-lookup via GDAP`.

### Task 5: Rapportschema en voorbeeldrapport

**Files:** Create `scripts/rapport/schema.mjs`, `scripts/rapport/schema.test.mjs`, `voorbeeld/rapport.voorbeeld.json`.

**Interfaces:**
- Consumes: `findSecretText` (Task 2).
- Produces: `validateRapport(r): string[]` (lege array = geldig). `rapport.json`:
  ```
  { klant, datum: "november 2026", opsteller: { naam, mail, telefoon }, lezers: [{ naam, organisatie }],
    samenvatting: { besluit?: { label, tekst }, zagen: string, adviseren: string, kerncijfers: [{ label, waarde, toelichting }], stappen: [{ stap, wie }] },
    stand: [{ titel, kicker, blokken: Blok[] }],          // 1..n pagina's huidige stand
    opvalt: [{ punt, zien, doen }],
    doel: { intro, principes: [{ titel, tekst }], kaarten?: [{ titel, tekst }] },
    stappenplan: { maanden: string[], fases: [{ code, naam, omschrijving, start, eind }|{ code, naam, omschrijving, pm: true }], toelichting },
    uren: { blokken: [{ titel, soort: "nodig"|"keuze", fases: [{ fase, resultaat, rekenbasis, uren }] }], projectmanagementPct: 10, nietInbegrepen: string[], toelichting: [string, string, string] },
    openVragen: [{ aan, rol, vragen: string[] }],
    bijlage: { intro, secties: [{ titel, kolom5: "ja/nee"|string[], rijen: [{ naam, adres, licentie, voorstel }] }] } }
  Blok = { type: "h2", tekst } | { type: "p", tekst } | { type: "tabel", kolommen: string[], rijen: string[][], breedtes?: string[] } | { type: "kaarten", items: [{ titel, tekst }] }
  ```
  Regels: verplichte velden aanwezig; `uren.blokken` heeft minstens één blok met `soort: "nodig"` en `toelichting` precies drie zinnen; `stappenplan.fases[].start/eind` zijn indexen binnen `maanden` met `start < eind`; geen string met `—` of `{{`; `findSecretText` leeg; geen `€` of `EUR` in het hele document.

- [ ] **Step 1: Write failing tests** `validateRapport(voorbeeld)` → `[]`; `uren.blokken` zonder "nodig"-blok → fout; `uren.toelichting` met twee zinnen → fout; zonder `klant` → bevat "klant ontbreekt"; tekst met `—` → fout met het pad; `"Switch wachtwoord: x"` → fout; `"€ 100"` → fout "geen bedragen"; fase met `start: 3, eind: 2` → fout.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** schema plus een verzonnen voorbeeldrapport (Voorbeeld Techniek B.V., 14 accounts, telefonie in scope) dat alle bloktypes gebruikt. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(it-inventarisatie): rapportschema en voorbeeld`.

### Task 6: Rapportgenerator (artboards voor Claude Design)

**Files:** Create `scripts/rapport/onderdelen.mjs`, `scripts/rapport/bouw.mjs`, `scripts/rapport/bouw.test.mjs`, `assets/juict-logo-pos.svg`, `assets/juict-logo-dia.svg`.

**Interfaces:**
- Consumes: `validateRapport` (Task 5).
- Produces: `bouwPaginas(rapport, { logoPos, logoDia }): Pagina[]` met `Pagina = { bestand: "Main.dc.html"|"NN-<naam>.dc.html", titel, html }`, in leesvolgorde: voorblad (`Main.dc.html`), samenvatting, stand-pagina's, opvalt, doelinrichting, stappenplan, uren (twee blokken "nodig" en "keuze, kan later" met kolommen Fase, Wat jullie daarna hebben, Rekenbasis, Uren; subtotaal per blok; daaronder een kaart met projectmanagement = `round(projecturen * pct / 100)`, totaal, totaal van alleen de "nodig"-blokken plus hun aandeel projectmanagement, en `nietInbegrepen`; en een kaart "Zo komen we tot deze uren" met de drie `toelichting`-zinnen), open vragen, bijlage-pagina's. `canvasJson(paginas, nu = new Date()): object` (v3, `createdOnFiles`, 4 per rij, `x = kolom * 874`, `y = rij * 1243`, `paper: "a4"`, titel per board "<n>. <titel>"). `schrijf(paginas, root): string[]` schrijft `<root>/project/...` en `canvas.json`. CLI `bouw.mjs --rapport <pad> --uit <map> --logo-pos <url> --logo-dia <url> [--fit]` (`--fit` in Task 7); weigert bij `validateRapport`-fouten met exit 1.
- `onderdelen.mjs` (overgenomen uit het voorbeeldscript): `doc(titel, inner, rootStyle)` (dc-skelet met `<script src="./support.js">`, `<helmet>` met Libre Franklin-link, `data-props` met `$preview` 794×1123, `class Component extends DCLogic`), `pagina(nr, kicker, titel, body)`, `h2`, `p`, `tabel(kolommen, rijen, { breedtes, fs, uitlijning, vast })`, `kaart`, `label(tekst, soort)`, `raster(n, items)`, `vakjes(opties)`, `tijdlijn(maanden, fases)`; alle tekst gaat door `esc()` (escape `&`, `<`, `>` behalve in velden die als HTML zijn gemarkeerd: `<b>` en `<br>` in rapporttekst toegestaan via `veiligeHtml()` die alleen die twee tags doorlaat).
- Logo's: kopie van de JUICT-SVG zonder `<style>`, met `fill`-attributen (navy `#002345` of wit, roze `#ff3862`).

- [ ] **Step 1: Write failing tests** met `rapport.voorbeeld.json`: eerste pagina is `Main.dc.html`; aantal pagina's = 1 + 1 + stand.length + 6 + bijlage-pagina's; elke html bevat `<script src="./support.js"></script>` en `class Component extends DCLogic`; geen html bevat `—`; `<script>` in een rapporttekst wordt `&lt;script&gt;`; `<b>` blijft `<b>`; footer bevat het paginanummer; `canvasJson` heeft voor elke pagina een board en `order` in leesvolgorde; lege secties leveren geen pagina op (`openVragen: []` → geen open-vragenpagina); urenpagina van het voorbeeld (nodig 105 + keuze 26 uur, pct 10) toont subtotalen 105 en 26, projectmanagement 13 (`Math.round(131 * 0.1)`), totaal 144 en "alleen nodig" 116 (`105 + Math.round(105 * 0.1)` = 105 + 11), en bevat geen `€`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** door de Python-generator uit het voorbeeld te porten (zelfde stijlen en maten, zie Global Constraints). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(it-inventarisatie): rapportgenerator voor Claude Design`.

### Task 7: Fit-check en automatisch splitsen

**Files:** Create `scripts/rapport/fit-check.mjs`, `scripts/rapport/fit-check.test.mjs`; Modify `scripts/rapport/bouw.mjs`.

**Interfaces:**
- Consumes: `bouwPaginas`, `schrijf` (Task 6).
- Produces: `browserPad(): string|null` (Edge `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`, dan Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`, dan env `IT_INVENTARISATIE_BROWSER`); `meetHtml(paginaHtml): string` (maakt een losse meet-html: inhoud tussen `<x-dc>` en `</x-dc>`, zonder `<helmet>`-tags, `/_blob`-bronnen leeg, plus het meetscript dat `content=<px> footer=<px>` in `<pre id="RESULT">` zet); `meet(paginas, browser): Promise<[{ bestand, inhoud, footer, over }]>` (`--headless=new --disable-gpu --window-size=794,1123 --virtual-time-budget=4000 --dump-dom`); `over = inhoud > footer - 12`.
- `bouw.mjs --fit`: maximaal 6 rondes; per te volle pagina met een tabel: verplaats de laatste `ceil(rijen * (over / tabelhoogte)) + 1` rijen naar een vervolgpagina met kicker "<kicker>, vervolg" en dezelfde kolommen; pagina zonder tabel die te vol blijft → stop met melding `Pagina <bestand> is <n>px te vol; maak de tekst korter`. Zuivere functie `splitsTabel(blokken, aantalRijen): { hier, vervolg }`.

- [ ] **Step 1: Write failing tests** `splitsTabel` met 10 rijen en 3 → hier 7, vervolg 3 met dezelfde kolommen; `meetHtml` bevat `id="RESULT"` en geen `<helmet>`; integratietest (skip zonder browser): voorbeeldrapport met 60 bijlage-rijen → na `--fit` alle pagina's `over: false` en minstens twee bijlage-pagina's.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (integratietest draait op deze machine; Edge is aanwezig).
- [ ] **Step 5: Commit** `feat(it-inventarisatie): fit-check en tabellen splitsen`.

### Task 8: Autotask-project invullen

**Files:** Create `scripts/autotask-project.mjs`, `scripts/autotask-project.test.mjs`, `scripts/fixtures/autotask-taken.voorbeeld.json`.

**Interfaces:**
- Consumes: `scrubSecrets` (Task 2), werkbestand-schema (Task 2).
- Produces:
  - `SJABLOON_TAKEN`: de 29 taaktitels van Easywork Basic (zoals gelezen op 4-11-2026), en `TAAK_KOPPELING`: `{ "<taaktitel>": { onderdelen: string[], scope?: keyof Scope } }` volgens de tabel in de spec (bijv. `"Setup telefonie": { onderdelen: ["telefonie"], scope: "telefonie" }`, `"Telefonie oplevering op locatie"` idem, `"Setup netwerk": { onderdelen: ["netwerk"], scope: "netwerk" }`, `"Initiële datamigratie"` en `"Definitieve datamigratie": { onderdelen: ["server"], scope: "server" }`, `"Mailmigratie Microsoft 365": { onderdelen: ["mail"], scope: "m365" }`).
  - `planTaskUpdates(taken, werkbestand, { datum, engineer }): Plan` met `Plan = { projectId, wijzigingen: [{ taskId, titel, actie: "nvt"|"aanvullen", status?: 5, estimatedHours?: number, omschrijving?: string, notitie?: { titel, tekst } }], ontbrekend: string[], onbekend: string[] }`. `nvt` als `scope` op false staat: status 5, uren 0, notitie "Niet van toepassing volgens de inventarisatie van <datum> (<engineer>): <onderdeel> valt niet in de offerte." `aanvullen`: omschrijving = korte samenvatting (max 1000 tekens, bestaande omschrijving blijft vooraan), notitie titel "Inventarisatie <datum>" met de details van de gekoppelde onderdelen (via `scrubSecrets`, max 32000 tekens); uren uit `offerte.uren` als de fasenaam overeenkomt met de taaktitel (hoofdletterongevoelig), anders ongewijzigd. Taken met status 5 worden overgeslagen.
  - `toonPlan(plan): string` (leesbare voorvertoning per taak).
  - `pasToe(plan, { at, bestaandeNotities }): Promise<Resultaat>` met `at` = `{ patchTask(projectId, body), postTaskNote(body), postProjectAttachment(projectId, body) }`; slaat een notitie over als er al een notitie met dezelfde titel op die taak staat.
  - CLI: `zoek --company <id>` (open klantprojecten: `projectType` 5, status ≠ 5), `plan --project <id> --werkbestand <pad> [--uit plan.json]`, `toepassen --plan plan.json --toepassen`, `bijlage --project <id> --pdf <pad> [--toepassen]` (`attachmentType: "FILE_ATTACHMENT"`, `publish: 1`, `title: "IT-inventarisatie <klant>"`, `fullPath: "it-inventarisatie-<slug>.pdf"`, `data` base64; slaat over als die `fullPath` al op het project staat). Zonder `--toepassen` alleen voorvertoning.

- [ ] **Step 1: Verifieer de schrijf-endpoints (geen code, wel bewijs).** Lees met een GET `Projects/{id}/Attachments` en `Tasks/entityInformation/fields` op een intern testproject. Maak voor het schrijven met Anto's akkoord één intern testproject aan (`projectType` 4, naam "TEST it-inventarisatie skill") met één taak, en test daarop `PATCH /Projects/{id}/Tasks` (status, estimatedHours, description), `POST /TaskNotes` en `POST /Projects/{id}/Attachments`. Leg de uitkomst vast in `REFERENCE.md` en stel daarna `/autotask-api-update` voor. Zet het testproject op status 5.
- [ ] **Step 2: Write failing tests** met de fixture (verzonnen project met 6 sjabloontaken + 1 eigen taak): telefonie `false` → "Setup telefonie" actie `nvt`, status 5, uren 0, notitie bevat "Niet van toepassing"; netwerk `true` met antwoorden → "Setup netwerk" actie `aanvullen`, notitie bevat het aantal switches; antwoord met `adminPassword` → komt niet in de notitie; eigen taak → in `onbekend` en niet in `wijzigingen`; sjabloontaak die ontbreekt → in `ontbrekend`; `offerte.uren: [{ fase: "setup netwerk", uren: 6 }]` → `estimatedHours: 6`; `pasToe` met een bestaande notitie "Inventarisatie 04-11-2026" → geen tweede `postTaskNote`.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** (HTTP-laag met injecteerbare `fetch`, Key Vault-volgorde uit Global Constraints, semafoor max 2 gelijktijdig). **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(it-inventarisatie): Autotask-project plannen en invullen`.

### Task 9: SKILL.md, REFERENCE.md en README

**Files:** Modify `SKILL.md`, `README.md`; Create `REFERENCE.md`.

**Interfaces:**
- Consumes: alle CLI's uit Task 2 t/m 8.

- [ ] **Step 1: Schrijf SKILL.md** (onder 100 regels): harde regels (offerte eerst; alleen lezen behalve concept-mail en Autotask na voorvertoning; nooit geheimen, ook niet uit vrije tekst; geen prijzen; technische claims alleen na controle in de documentatie; schrijfregels via `juict-vault` als die er is, anders de korte regels in REFERENCE.md), en de werkwijze in stappen: 0 hervatten (werkbestand + nieuwe mails sinds `laatsteMailcheck`), 1 offerte lezen en scope bevestigen, 2 bronnen (`dns-lookup`, `m365-lookup`, `itglue-api`, `autotask-api`, mail), 3 interview van de gaten met AskUserQuestion per onderdeel, 4 uitvraag-mail als Outlook-concept, 5 `rapport.json` vullen en `bouw.mjs --fit`, 6 publiceren in Claude Design (Artifact quickstart `intent: design`, type maken met de klantnaam als titel, logo's als asset uploaden en de `/_blob`-urls aan `bouw.mjs` geven, eerst `canvas.json` + `Main.dc.html`, daarna de rest), 7 PDF-export door de engineer, daarna `autotask-project.mjs bijlage`, 8 `plan` → voorvertoning → akkoord → `toepassen`.
- [ ] **Step 2: Schrijf REFERENCE.md**: interviewchecklist per onderdeel (de tien onderdelen uit de spec met de concrete vragen, inclusief telefonie: gebruikers, nummerplan, provider, toestellen, looptijd contract; telefoons: aantal en Apple ID's, standaard niet in Intune), de vaste VoIP-fase "Telefonie overnemen" (4 + 4 uur) als telefonie in scope is, de regel dat afspraken uit overleg of offerte als afspraak worden beschreven en niet als tekortkoming, werkbestand- en rapportschema, taakkoppeling-tabel, sjabloon voor de uitvraag-mail (genummerde vragen per onderdeel, "Wachtwoorden hoef je niet te sturen"), korte schrijfregels (geen em-dashes, geen buzzwords, Easywork/Microsoft 365/Microsoft Entra ID correct gespeld), bekende M365-beperkingen van de az-token (managedDevices 400, sites 401, security defaults 403), Autotask-feiten uit Global Constraints.
- [ ] **Step 3: Run** alle tests → PASS.
- [ ] **Step 4: Commit** `docs(it-inventarisatie): SKILL.md en REFERENCE.md`.

### Task 10: Eind-tot-eind-proef met de voorbeeldklant

**Files:** geen nieuwe bestanden in de repo.

- [ ] **Step 1:** `bouw.mjs --rapport voorbeeld/rapport.voorbeeld.json --uit <scratchpad>/proef --fit` → alle pagina's passen.
- [ ] **Step 2:** Publiceer als privé Claude Design-artifact "TEST it-inventarisatie" volgens SKILL.md stap 6 en laat Anto het bekijken.
- [ ] **Step 3:** `autotask-project.mjs plan` tegen het testproject uit Task 8 Step 1 met `voorbeeld/inventarisatie.voorbeeld.json` → voorvertoning klopt; met akkoord `toepassen` en daarna opnieuw `toepassen` → geen dubbele notities.
- [ ] **Step 4:** Alle tests groen, branch pushen, PR naar `main` voorstellen (na akkoord openen).
