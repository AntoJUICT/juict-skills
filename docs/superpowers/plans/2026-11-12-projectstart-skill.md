# Projectstart-skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een skill `projectstart` die vanuit één Autotask-projectnummer de kick-off klaarzet: dossier, kick-off-presentatie in de stijl van Marts verkoopdeck, inventarisatierapport, Mini PVA, interne briefing en uitvraag-mail, met de stand in Autotask zodat engineers kunnen aanvullen.

**Architecture:** Een tweede skill binnen de bestaande plugin `it-inventarisatie`, zodat hij de scripts van die skill (Autotask-client, geheimenfilter, rapportbouw) via relatieve imports deelt in plaats van kopieert. Scripts doen alleen deterministische I/O en controles (Autotask lezen/schrijven, bijlagen decoderen, dossier valideren, presentatie- en PVA-bestanden genereren). Claude doet het lezen en samenvatten volgens SKILL.md en schrijft `dossier.json`; alle documenten worden uit dat dossier gegenereerd.

**Tech Stack:** Node ≥ 22 (ESM, `node:test`, `node:zlib` incl. `zlib.crc32`), geen npm-dependencies; PowerShell + Word-COM voor inhoudsopgave en PDF-controle; Claude Design (Artifact-tool) voor presentatie en rapport; Autotask REST zone 19.

**Spec:** `C:\Claude\Projectstart-skill\ontwerp.md` (in de repo: `docs/superpowers/specs/2026-11-12-projectstart-skill-design.md`)

## Global Constraints

- Repo `AntoJUICT/juict-skills` (GitHub). Werk in een worktree buiten de repo-map op branch `feature/<workitem-id>-projectstart-skill`; nooit op main, nooit in `~/.claude/plugins/marketplaces/juict-skills` (die map wordt automatisch bijgewerkt). PR als draft naar main na groene tests en een `/security-scan -quick`.
- Alle nieuwe code in `plugins/it-inventarisatie/skills/projectstart/`. Plugin-versie `0.2.0` → `0.3.0`.
- Node ≥ 22, geen npm-dependencies, alleen `node:`-modules. Tests: `node --test plugins/it-inventarisatie/skills/` vanuit de repo-root.
- Werkplek: Windows 11, PowerShell met `-ExecutionPolicy Bypass`, Word en PowerPoint via COM; geen Python, pandoc, LibreOffice of Chrome. Bestandsnamen met en-dash of spaties alleen via Node-paden, nooit in een PowerShell-string geplakt.
- Secrets alleen uit Key Vault `juict-shared-kv`, dan `ju-hermes-emmanuel` (via `haalCredentials` van it-inventarisatie). Nooit printen, loggen of in dossier, notitie, document of artifact.
- Autotask zone 19. Niets kan verwijderd worden. Elke schrijfactie: zonder `--toepassen` alleen een voorvertoning. Een tweede run maakt niets dubbel (titel/bestandsnaam).
- Schrijfregels in alle gegenereerde tekst: Nederlands, jij/jullie, geen em-dash (`—`), geen `BC`, `M365` of `MFA` zonder dat het eerder voluit staat, geen "raming", geen buzzwords (ontzorgen, naadloos, robuust, synergie).
- Geen `€`, `EUR` of bedragen in presentatie, rapport of uitvraag-mail. In het PVA (intern) wel toegestaan.
- Presentatie: maximaal 10 slides, volgorde en titels volgens spec 5.2. Basis: `https://claude.ai/artifact/ErU9wG7ZhrGkS655Nz2zrB`, steeds de actuele versie.
- Publiceren naar Claude Design alleen vanuit de werkmap of scratchpad van de sessie, met volledig (niet 8.3-) pad.
- Werkmap per project: `%USERPROFILE%\.claude\projectstart\<projectId>\` (alleen cache; de bron is Autotask).

## Review Focus

1. **Doorgestuurde .eml met geneste multipart, Windows-1252 quoted-printable en RFC 2047-onderwerp** (zoals de mails van klant X): de tekst komt correct door met é, ë en –, en de citaten van eerdere mails blijven staan. Test in Task 3.
2. **Bijlagenaam met en-dash en spaties** (`Re_ Voorbeeld _ Planning – ….eml`): downloaden, opslaan en lezen werkt. Test in Task 2.
3. **Tweede run zonder nieuwe bijlagen of notities:** geen nieuwe dossierversie, geen dubbele notitie of bijlage. Test in Task 4 en Task 8.
4. **Open besluit zonder beslisser of datum:** de slide toont "bepalen we vandaag", nooit een verzonnen naam of datum. Test in Task 6.
5. **Klantcontact of teamlid zonder foto in Marts `assets/teamfull/`:** een avatar met initialen, nooit een kapotte afbeelding. Test in Task 6.

---

### Task 1: Skillskelet, plugin-administratie en spec in de repo

**Files:**
- Create: `plugins/it-inventarisatie/skills/projectstart/SKILL.md` (alleen frontmatter + kop; inhoud in Task 10)
- Create: `docs/superpowers/specs/2026-11-12-projectstart-skill-design.md` (kopie van `C:\Claude\Projectstart-skill\ontwerp.md`)
- Create: `docs/superpowers/plans/2026-11-12-projectstart-skill.md` (kopie van dit plan)
- Modify: `plugins/it-inventarisatie/.claude-plugin/plugin.json` (version `0.3.0`, description noemt ook de projectstart)
- Modify: `.claude-plugin/marketplace.json` (description van de it-inventarisatie-entry)
- Modify: `README.md` (tabelrij it-inventarisatie noemt projectstart)
- Test: `plugins/it-inventarisatie/skills/it-inventarisatie/scripts/plugin-structuur.test.mjs`

**Interfaces:**
- Produces: map `plugins/it-inventarisatie/skills/projectstart/scripts/` voor alle volgende taken.

- [ ] **Step 1: Worktree en branch maken**

```bash
git clone https://github.com/AntoJUICT/juict-skills.git C:/Claude/juict-skills
cd C:/Claude/juict-skills
git worktree add -b feature/<workitem-id>-projectstart-skill ../juict-skills-worktrees/<workitem-id>-projectstart-skill
```
Vraag Mike om het Azure Boards-workitemnummer voordat je de branch maakt.

- [ ] **Step 2: Write the failing test** in `plugin-structuur.test.mjs`

```js
test("projectstart-skill bestaat met geldige frontmatter", () => {
  const skill = readFileSync(resolve(repoRoot, "plugins/it-inventarisatie/skills/projectstart/SKILL.md"), "utf-8");
  assert.match(skill, /^---\nname: projectstart\ndescription: .{40,}\n---/);
});
test("plugin-versie is minstens 0.3.0", () => {
  const plugin = JSON.parse(readFileSync(resolve(repoRoot, "plugins/it-inventarisatie/.claude-plugin/plugin.json"), "utf-8"));
  const [maj, min] = plugin.version.split(".").map(Number);
  assert.ok(maj > 0 || min >= 3);
});
```

- [ ] **Step 3: Run** `node --test plugins/it-inventarisatie/skills/` → FAIL op beide tests.
- [ ] **Step 4: Maak SKILL.md-frontmatter** (`name: projectstart`, description: "Projectstart na akkoord op de offerte: vanuit het Autotask-project een kick-off-presentatie in de stijl van de verkooppresentatie, een inventarisatierapport, Mini PVA, interne briefing en uitvraag-mail klaarzetten, en later aanvullen.") en de administratieve wijzigingen; kopieer spec en plan.
- [ ] **Step 5: Run** `node --test plugins/it-inventarisatie/skills/` → PASS (ook de bestaande tests).
- [ ] **Step 6: Commit** `feat(projectstart): skelet, plugin 0.3.0 en ontwerp`

---

### Task 2: Autotask-bronnen ophalen

**Files:**
- Create: `plugins/it-inventarisatie/skills/projectstart/scripts/bronnen.mjs`
- Create: `plugins/it-inventarisatie/skills/projectstart/scripts/bronnen.test.mjs`
- Create: `plugins/it-inventarisatie/skills/projectstart/scripts/fixtures/attachments.voorbeeld.json`
- Modify: `plugins/it-inventarisatie/skills/it-inventarisatie/scripts/autotask-project.mjs` (`maakAt` krijgt `getProjectAttachment(projectId, attachmentId)`, `queryProjectNotes(projectId)`, `postProjectNote(body)`)

**Interfaces:**
- Consumes: `haalCredentials`, `maakAt` uit `../../it-inventarisatie/scripts/autotask-project.mjs`; `scrubSecrets` uit `../../it-inventarisatie/scripts/geheimen.mjs`.
- Produces:
  - `veiligeBestandsnaam(naam: string): string` (behoudt letters incl. accenten en en-dash, vervangt `\/:*?"<>|` door `_`)
  - `async haalBronnen(at, projectId: number, uitMap: string): Promise<Manifest>` waarbij `Manifest = { projectId, companyId, projectNaam, bedrijfsnaam, bijlagen: [{ id, titel, bestand, type, datum }], notities: [{ id, titel, tekst, datum }] }`; schrijft elke bijlage naar `<uitMap>/bronnen/<id>-<veiligeBestandsnaam(titel)>` en `<uitMap>/bronnen.json`.
  - CLI: `node bronnen.mjs --project <id> [--uit <map>]` print het manifest zonder inhoud.

- [ ] **Step 1: Verifieer de lees-endpoints** (alleen lezen, op het proefproject): `GET Projects/<id>/Attachments` en `GET Projects/<id>/Attachments/<attachmentId>` (veld met base64-inhoud) en `POST ProjectNotes/query` met filter op `projectID`. Leg de veldnamen vast in de fixture en in REFERENCE.md (Task 10). Stop en meld het als `GET .../Attachments/<id>` geen inhoud geeft.
- [ ] **Step 2: Write the failing tests**

```js
test("veiligeBestandsnaam behoudt en-dash en accenten", () => {
  assert.equal(veiligeBestandsnaam("Re_ Voorbeeld _ Planning – volgende stappen.eml"), "Re_ Voorbeeld _ Planning – volgende stappen.eml");
  assert.equal(veiligeBestandsnaam('a/b:c*?.pdf'), "a_b_c__.pdf");
});
test("haalBronnen schrijft bijlagen en manifest met een nep-at", async () => { /* nep-at uit fixture; verwacht 2 bestanden op schijf, manifest.bijlagen.length === 2, geen credentials in bronnen.json */ });
```
- [ ] **Step 3: Run** `node --test plugins/it-inventarisatie/skills/projectstart/scripts/bronnen.test.mjs` → FAIL.
- [ ] **Step 4: Implement** `veiligeBestandsnaam`, `haalBronnen` en de drie `maakAt`-uitbreidingen. Bijlagen downloaden met maximaal 2 tegelijk (bestaande semafoor).
- [ ] **Step 5: Run** de test → PASS; draai `node bronnen.mjs --project <id>` op het proefproject en controleer dat alle bijlagen op schijf staan.
- [ ] **Step 6: Commit** `feat(projectstart): bijlagen en notities uit Autotask ophalen`

---

### Task 3: Bijlagen naar tekst (eml, msg, docx)

**Files:**
- Create: `scripts/tekst.mjs`, `scripts/tekst.test.mjs`, `scripts/zip.mjs`, `scripts/zip.test.mjs`, `scripts/msg-naar-tekst.ps1`
- Create: `scripts/fixtures/doorgestuurd-qp-1252.eml`, `scripts/fixtures/base64-utf8.eml` (verzonnen klant "Voorbeeld Techniek B.V.", geen echte data)

(paden relatief aan `plugins/it-inventarisatie/skills/projectstart/`)

**Interfaces:**
- Produces:
  - `leesZip(buf: Buffer): Map<string, Buffer>` en `schrijfZip(bestanden: Map<string, Buffer>): Buffer` (deflate via `zlib.deflateRawSync`, CRC via `zlib.crc32`; geen map-entries)
  - `emlNaarTekst(buf: Buffer): { onderwerp, van, aan, datum, tekst }` (RFC 2047, base64, quoted-printable, charset utf-8/windows-1252/iso-8859-1, multipart recursief, `text/plain` voorkeur boven `text/html`)
  - `docxNaarTekst(buf: Buffer): string` (alinea's uit `word/document.xml`, één per regel)
  - `bronNaarTekst(pad: string): string` — kiest op extensie; `.pdf` geeft `null` (Claude leest PDF zelf met de Read-tool); `.msg` roept `msg-naar-tekst.ps1` aan (Outlook-COM `OpenSharedItem`)
  - CLI: `node tekst.mjs <bronnenmap>` schrijft per bron `<naam>.txt` naast het origineel.

- [ ] **Step 1: Write the failing tests**

```js
test("doorgestuurde qp-1252-mail houdt accenten en en-dash", () => {
  const r = emlNaarTekst(readFileSync(fixture("doorgestuurd-qp-1252.eml")));
  assert.equal(r.onderwerp, "FW: Offerte – integratie");
  assert.match(r.tekst, /één van mijn collega's/);
  assert.match(r.tekst, /Van: .*\nVerzonden:/);
});
test("base64-utf8-mail decodeert", () => { /* tekst bevat "Hi Mart," */ });
test("zip roundtrip", () => { const m = new Map([["a.txt", Buffer.from("x")]]); assert.deepEqual(leesZip(schrijfZip(m)).get("a.txt").toString(), "x"); });
test("docxNaarTekst geeft alinea's", () => { /* docx gemaakt met schrijfZip uit een minimale document.xml */ });
```
- [ ] **Step 2: Run** `node --test .../tekst.test.mjs .../zip.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `zip.mjs` en `tekst.mjs`; `msg-naar-tekst.ps1 -Pad <pad>` schrijft UTF-8 naar stdout.
- [ ] **Step 4: Run** de tests → PASS. Draai `node tekst.mjs` op de bronnen van het proefproject uit Task 2 en vergelijk met de handmatig gedecodeerde tekst van 12 november.
- [ ] **Step 5: Commit** `feat(projectstart): eml, msg en docx naar tekst`

---

### Task 4: Dossier: schema, controles en stand in Autotask

**Files:**
- Create: `scripts/dossier.mjs`, `scripts/dossier.test.mjs`, `voorbeeld/dossier.voorbeeld.json` (Voorbeeld Techniek B.V.)

**Interfaces:**
- Consumes: `scrubSecrets`, `findSecretText` uit it-inventarisatie; `maakAt` (Task 2).
- Produces:
  - Schema `dossier.json` (schema 1):
    `{ schema: 1, projectId, companyId, klant: { autotask, weergave }, contacten: [{ naam, rol, organisatie, beslisser: bool, aanspreekpunt: bool }], team: [{ naam, rol }], doel, hardeDatum: { datum, watKlaar, watNiet }, scope: { inbegrepen: [], buiten: [] }, fases: [{ code, naam, route: "01"|"02", start: "jjjj-mm", eind: "jjjj-mm" }], besluiten: [{ vraag, beslisser: string|null, uiterlijk: string|null, alsNiet }], aanleveren: [{ wat, wie: string|null, datum: string|null, tijd: string|null }], afspraken: [{ tekst, intern: bool, bron }], technischeVragen: [{ vraag, aan, bron }], extraOnderwerpen: [{ soort: "beveiliging", geregeld: [], controleren: [], later: [] }], overleg: { ritme, aanspreekpunt, escalatie }, artifacts: { presentatie: url|null, rapport: url|null }, verwerkt: { bijlagen: [id], notities: [id] }, versie: number }`
  - `valideerDossier(d): string[]` (lege lijst = goed). Fouten met pad: verplichte velden, `fases.length >= 1`, `route` alleen `"01"|"02"`, geen `—`, geen `€|EUR` in velden die niet `intern: true` zijn, verboden afkortingen `\bBC\b|\bM365\b`, `findSecretText`.
  - `nieuweBronnen(d, manifest): { bijlagen: [], notities: [] }` — wat nog niet in `d.verwerkt` staat.
  - `async laadStand(at, projectId): Promise<{ dossier, versie } | null>` — hoogste `projectstart-dossier-v<N>.json` bijlage.
  - `async bewaarStand(at, projectId, dossier, { toepassen }): Promise<{ voorvertoning: string, bijlage?: string }>` — schrijft `projectstart-dossier-v<N+1>.json` alleen als `toepassen` en de inhoud anders is dan versie N.
  - CLI: `node dossier.mjs controleer <pad>`, `node dossier.mjs laad --project <id> --uit <pad>`, `node dossier.mjs bewaar --project <id> --dossier <pad> [--toepassen]`.

- [ ] **Step 1: Write the failing tests**

```js
test("voorbeelddossier is geldig", () => assert.deepEqual(valideerDossier(voorbeeld), []));
test("bedrag in klantgerichte afspraak faalt, intern mag", () => { /* afspraken[0].tekst met een uurtarief: intern:false → fout met pad "afspraken[0].tekst"; intern:true → geen fout */ });
test("afkorting BC faalt", () => { /* scope.inbegrepen ["toegang tot BC"] → fout */ });
test("em-dash faalt", () => {});
test("route 03 faalt", () => {});
test("nieuweBronnen geeft alleen onverwerkte ids", () => {});
test("bewaarStand zonder wijziging schrijft niets", async () => { /* nep-at met v3 gelijk aan dossier → geen postProjectAttachment-aanroep */ });
test("bewaarStand zonder toepassen schrijft niets", async () => {});
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(projectstart): dossier, controles en stand in Autotask`

---

### Task 5: Spike: Marts deckformaat in een nieuw canvas

**Files:**
- Create: `scripts/presentatie/mart-bestanden.mjs` (constante lijst)
- Create: `REFERENCE.md`-sectie "Deck van Mart" (in Task 10 aangevuld)

**Interfaces:**
- Produces: `MART_DECK = "https://claude.ai/artifact/ErU9wG7ZhrGkS655Nz2zrB"` en `MART_BESTANDEN: string[]` — de paden onder `project/` die de kick-off nodig heeft (stylesheets, scripts, `compat.json`, `_ds/...`, fonts, logo, achtergrond, `assets/teamfull/*.jpg`, `assets/img/handshake.jpg`, `assets/img/kantoor-team.jpg`). Geen hook-, calculator- of tunnelbestanden.

- [ ] **Step 1:** Lees de `<head>` van `project/JUICT Salespresentatie.html` (Artifact read) en noteer welke `project/`-bestanden die laadt; zet ze in `MART_BESTANDEN`.
- [ ] **Step 2:** Maak een testcanvas met het Design-type, kopieer `MART_BESTANDEN` server-side (`files: { "<pad>": { artifact: MART_DECK, path: "<pad>" } }`) en publiceer een `project/Kick-off test.html` met één `<section class="slide dark">` die eyebrow, `title` met `<em class="it">` en de route-markup van slide 07 gebruikt.
- [ ] **Step 3: Handmatige controle door Mike:** opent het testcanvas, ziet de slide in Marts stijl (lettertype, achtergrond, route-kleuren) en kan door de slides bladeren. Werkt het niet, stop dan en meld het: dan valt de presentatie terug op `.dc.html`-artboards met het designsystem (beslissing van Mike).
- [ ] **Step 4: Commit** `feat(projectstart): bestandslijst van het verkoopdeck`

---

### Task 6: Kick-off-presentatie genereren

**Files:**
- Create: `scripts/presentatie/bouw.mjs`, `scripts/presentatie/slides.mjs`, `scripts/presentatie/bouw.test.mjs`

**Interfaces:**
- Consumes: `valideerDossier` (Task 4), `MART_BESTANDEN` (Task 5), `esc` uit `../../it-inventarisatie/scripts/rapport/onderdelen.mjs`.
- Produces:
  - `accent(titel: string): string` — `*woord*` wordt `<em class="it">woord</em>`, de rest ge-escaped; precies één accent verplicht.
  - `slides(d): Array<{ id, eyebrow, titel, html }>` — volgorde en titels uit spec 5.2; slide 5 alleen als `d.extraOnderwerpen` een `beveiliging` bevat; daardoor 9 of 10 slides.
  - `persoon(naam, { fotoPaden }): string` — foto `assets/teamfull/<voornaam-lowercase>.jpg` als die in `MART_BESTANDEN` staat, anders een cirkel met initialen.
  - `bouwPresentatie(d, uitMap): { bestand: string, files: Record<string, {artifact, path}> }` — schrijft `<uitMap>/project/Kick-off <klant.weergave>.html` en geeft de `files`-map voor de publish-call.
  - CLI: `node bouw.mjs --dossier <pad> --uit <map>`.

- [ ] **Step 1: Write the failing tests**

```js
test("maximaal 10 slides en vaste volgorde", () => {
  const s = slides(voorbeeldMetBeveiliging);
  assert.equal(s.length, 10);
  assert.deepEqual(s.map((x) => x.id), ["opening","route","team","doel","veilig","planning","besluiten","aanleveren","overleg","afgesproken"]);
});
test("zonder beveiliging 9 slides", () => {});
test("open besluit zonder beslisser toont 'bepalen we vandaag'", () => {
  const html = slides(dossierMetOpenBesluit).find((x) => x.id === "besluiten").html;
  assert.match(html, /bepalen we vandaag/);
});
test("aanleverpunt zonder wie of datum blijft zichtbaar open", () => {});
test("teamlid zonder foto krijgt initialen, geen img", () => {});
test("geen em-dash, geen €, geen BC in de html", () => {});
test("route markeert 01 als 'hier staan we' en dimt 03 tot 05", () => {});
test("accent eist precies één *woord*", () => { assert.throws(() => accent("geen accent")); });
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** de tien slidefuncties met de markup-klassen uit Marts deck (Task 5) en de inhoud uit spec 5.2. **Step 4: Run** → PASS.
- [ ] **Step 5:** Bouw de presentatie van het proefproject uit een met de hand gevuld dossier, publiceer naar een nieuw canvas en laat Mike kijken. Noteer zijn feedback als issues voor Task 10.
- [ ] **Step 6: Commit** `feat(projectstart): kick-off-presentatie uit het dossier`

---

### Task 7: Mini PVA uit het dossier

**Files:**
- Create: `assets/mini-pva-template.docx` (leeg template met plaatshouders `{{inleiding}}`, `{{doelstelling_1}}` … en een planningstabel met 25 lege rijen)
- Create: `scripts/pva/vul.mjs`, `scripts/pva/vul.test.mjs`, `scripts/pva/afronden.ps1`

**Interfaces:**
- Consumes: `leesZip`/`schrijfZip` (Task 3), dossier (Task 4).
- Produces:
  - `vervangAlinea(xml, plaatshouder, tekst | { label, rest }): string` — vervangt de hele alinea met één run (of vet label + run), behoudt `w:pPr`, bladwijzers en `w:pict`/`w:drawing`-runs (zoals vandaag in `build_pva.js`).
  - `vulPlanning(xml, rijen: Array<[onderdeel, deadline, verantwoordelijke]>): string` — vult de eerste `rijen.length` rijen, verwijdert de overige lege rijen (`<w:tr>`), faalt bij meer dan 25 rijen.
  - `pvaUitDossier(d): { velden: Record<string, string|{label,rest}>, planning: [] }`
  - `vulPva(templateBuf, d): Buffer`
  - `afronden.ps1 -Bron <docx> -Doel <docx> [-Pdf <pdf>]` — Word-COM: inhoudsopgave bijwerken, opslaan, optioneel PDF.
  - CLI: `node vul.mjs --dossier <pad> --uit <docx>`.

- [ ] **Step 1:** Maak `mini-pva-template.docx` uit `Werkprocessen\Projecten\Mini PVA Template.docx` door elke inhoudsalinea en planningscel te vervangen door een plaatshouder (eenmalig script, niet opgeslagen). Controleer in Word: opmaak, kopjes, inhoudsopgave en handtekeningregel staan er nog.
- [ ] **Step 2: Write the failing tests**

```js
test("alle plaatshouders zijn ingevuld", () => { const xml = docXml(vulPva(template, voorbeeld)); assert.doesNotMatch(xml, /\{\{/); });
test("bladwijzers en handtekeningregel blijven", () => { /* aantal <w:bookmarkStart en <w:pict gelijk aan template */ });
test("planning: 5 rijen gevuld, rest weg", () => {});
test("meer dan 25 planningsrijen faalt", () => {});
test("PVA mag bedragen bevatten (intern)", () => {});
```
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6:** Vul het PVA voor het dossier van het proefproject, draai `afronden.ps1` met PDF en vergelijk visueel met het met de hand gemaakte PVA van dat project.
- [ ] **Step 7: Commit** `feat(projectstart): Mini PVA uit het dossier`

---

### Task 8: Briefing, uitvraag-mail en schrijfacties in Autotask

**Files:**
- Create: `scripts/autotask-schrijf.mjs`, `scripts/autotask-schrijf.test.mjs`, `scripts/teksten.mjs`, `scripts/teksten.test.mjs`

**Interfaces:**
- Consumes: `maakAt` incl. `postProjectNote`, `queryProjectNotes`, `postProjectAttachment` (Task 2); dossier (Task 4).
- Produces:
  - `briefing(d, { presentatie, rapport }): { titel: "Projectstart: briefing kick-off", tekst }` — kopjes "Voor de projectleider" en "Voor de techniek", links, punten om uit te vragen, actie "Presentatie en rapport delen met JUICT (bewerken)".
  - `wijzigingen(oud, nieuw): { titel: "Projectstart: aanvulling <dd-mm-jjjj>", tekst } | null` — alleen wat veranderd is; `null` als niets veranderd is.
  - `uitvraagMail(d): { aan, onderwerp, tekst }` — sjabloon van it-inventarisatie (REFERENCE.md "Uitvraag-mail"), urgent punt bovenaan, per onderdeel vet kopje en één zin, slotzin over wachtwoorden.
  - `planSchrijfacties(projectId, { notities: [{titel, tekst}], bijlagen: [{titel, bestandsnaam, pad}] }, bestaand): Plan` en `async voerUit(at, plan, { toepassen })` — slaat notities met bestaande titel en bijlagen met bestaande `fullPath` over; notities `publish: 2`.
  - Bijlagenamen: `Mini PVA <klant> v<N>.docx`, `Kick-off <klant>.pdf` (alleen als de gebruiker een PDF aanlevert).
  - CLI: `node autotask-schrijf.mjs --project <id> --plan <pad> [--toepassen]`.

- [ ] **Step 1: Verifieer** `POST ProjectNotes` (of het juiste endpoint) en `POST ProjectNotes/query` op een intern testproject in zone 19; leg velden vast. Niet op het proefproject schrijven.
- [ ] **Step 2: Write the failing tests**

```js
test("briefing heeft beide kopjes en de deel-actie", () => {});
test("uitvraag-mail bevat geen € en geen wachtwoordvraag", () => {});
test("tweede run: bestaande notitie en bijlage worden overgeslagen", () => {});
test("zonder toepassen geen enkele POST", async () => {});
test("wijzigingen zonder verschil geeft null", () => {});
```
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(projectstart): briefing, uitvraag-mail en schrijfacties`

---

### Task 9: Samenhang rapport en presentatie, en overdracht aan it-inventarisatie

**Files:**
- Create: `scripts/samenhang.mjs`, `scripts/samenhang.test.mjs`
- Modify: `plugins/it-inventarisatie/skills/it-inventarisatie/scripts/werkbestand.mjs` (nieuw commando `van-dossier`)
- Modify: `plugins/it-inventarisatie/skills/it-inventarisatie/scripts/werkbestand.test.mjs`
- Modify: `plugins/it-inventarisatie/skills/it-inventarisatie/SKILL.md` (stap 0: bestaat er een projectstart-dossier op het project, begin daarmee)

**Interfaces:**
- Consumes: `validateRapport` uit `rapport/schema.mjs`; dossier (Task 4).
- Produces:
  - `controleerSamenhang(d, rapport): string[]` — het rapport is leidend: fasenamen en maanden in `rapport.stappenplan` horen bij `d.fases`; staat beveiliging in het rapport in een blok `soort: "keuze"`, dan noemt de presentatie het "optioneel"; `rapport.klant === d.klant.autotask`.
  - `werkbestandUitDossier(d): Werkbestand` (schema 1 van it-inventarisatie) en CLI `werkbestand.mjs van-dossier <dossierpad>`.

- [ ] **Step 1: Write the failing tests**

```js
test("planning in rapport en dossier verschillen → fout", () => {});
test("beveiliging keuze in rapport maar niet optioneel in dossier → fout", () => {});
test("werkbestandUitDossier zet klant, scope, antwoorden en openVragen", () => {});
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (alle tests van de plugin).
- [ ] **Step 5: Commit** `feat(projectstart): samenhang rapport en presentatie, overdracht aan it-inventarisatie`

---

### Task 10: SKILL.md, REFERENCE.md en proefrun

**Files:**
- Modify: `plugins/it-inventarisatie/skills/projectstart/SKILL.md`
- Create: `plugins/it-inventarisatie/skills/projectstart/REFERENCE.md`

**Interfaces:**
- Consumes: alle CLI's uit Task 2 t/m 9.

- [ ] **Step 1: Schrijf SKILL.md** met twee werkwijzen.
  - **Starten:**
    1. `dossier laad`, `bronnen`, `tekst`.
    2. Claude leest alles (PDF met de Read-tool) en schrijft `dossier.json`. Bevestig de klantnaam (Autotask en weergave).
    3. `dossier controleer`.
    4. `dns-lookup.mjs` van it-inventarisatie op de domeinen uit de bronnen, daarna het rapport via de regels van it-inventarisatie (schema, `bouw.mjs`, publiceren), daarna `controleerSamenhang`.
    5. Presentatie bouwen en publiceren vanuit de scratchpad (bestanden server-side uit Marts deck).
    6. PVA vullen en afronden.
    7. Briefing en uitvraag-mail: voorvertoning, dan akkoord, dan `--toepassen`. De mail als concept of als tekst.
    8. `dossier bewaar --toepassen`.
    9. Herinner aan delen met de JUICT-organisatie met bewerkrechten.
  - **Aanvullen:**
    1. `dossier laad` en `nieuweBronnen`.
    2. Alleen nieuwe bronnen lezen.
    3. Dossier bijwerken.
    4. Rapport en PVA (nieuwe versie) opnieuw maken. De presentatie nooit opnieuw.
    5. Een notitie `wijzigingen`.
    6. `bewaar`.
  - **Na elke run:** "wil je iets blijvend vastleggen, zet het als notitie op het project".
  - Neem de schrijfregels en harde regels uit de Global Constraints over.
- [ ] **Step 2: Schrijf REFERENCE.md:** scripts-tabel, dossierschema, de geverifieerde Autotask-endpoints uit Task 2 en 8, `MART_BESTANDEN`, bekende valkuilen (beheerde Edge, publiceren vanuit de scratchpad, 8.3-paden, en-dash in PowerShell, `$` in Git Bash).
- [ ] **Step 3: Proefrun** met Mike op het proefproject. Eerst alleen voorvertoningen, daarna op zijn akkoord `--toepassen`. Vergelijk de uitkomst met wat er op 12 november met de hand is gemaakt.
- [ ] **Step 4: Run** `node --test plugins/it-inventarisatie/skills/` → PASS. Daarna `/security-scan -quick` en los de bevindingen op.
- [ ] **Step 5: Commit** `docs(projectstart): SKILL en REFERENCE`, push de branch, open een draft-PR naar main met `gh pr create --draft` (na akkoord van Mike).
