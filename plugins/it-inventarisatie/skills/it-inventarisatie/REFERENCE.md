# Referentie voor it-inventarisatie

Geen klantdata in dit bestand: de repo is publiek. Voorbeelden gebruiken de verzonnen klant "Voorbeeld Techniek B.V."
(`voorbeeldtechniek.nl`). `<skill>` is de basismap van de skill, `<werkmap>` is
`%USERPROFILE%\.claude\it-inventarisatie\<slug>\`.

## Scripts

Alle scripts zijn Node 18+ zonder npm-dependencies. Opties met een spatie, niet met `=`.

| Script | Gebruik | Uitkomst |
|---|---|---|
| `scripts/werkbestand.mjs` | `nieuw "<klant>"`, `toon <slug>`, `stap <slug> <stap>` | Pad van het werkbestand, of de inhoud. Exit 1 bij een fout. |
| `scripts/dns-lookup.mjs` | `<domein> [<domein>...]` | JSON per domein: `domein`, `mx` (op prioriteit), `ns`, `m365Mail`, `reserveMx`, `verificatieMx`, `tenantId`, eventueel `fout`. |
| `scripts/m365-lookup.mjs` | `--tenant <guid\|domein> [--uit <pad>]` | Samenvatting als JSON. Exit 1 zonder `--tenant`, exit 2 met `{ ok: false, reden }` bij geen GDAP, geen az-login of onbekend domein. |
| `scripts/rapport/bouw.mjs` | `--rapport <pad> --uit <map> --logo-pos <url> --logo-dia <url> [--fit]` | Schrijft `<map>/project/Main.dc.html`, `NN-<naam>.dc.html` en `canvas.json`. Exit 1 bij een ongeldig rapport of een te volle pagina; dan is er niets geschreven. |
| `scripts/autotask-project.mjs` | `zoek --company <id>` | Open klantprojecten (`projectType` 5, status niet 5): id, naam, status. |
| | `plan --project <id> --werkbestand <pad> [--uit plan.json] [--engineer <naam>] [--datum dd-mm-jjjj]` | Voorvertoning per taak, en met `--uit` het plan als JSON. |
| | `toepassen --plan plan.json [--toepassen]` | Zonder vlag de voorvertoning, met vlag de schrijfacties. Exit 2 als een taak mislukt. |
| | `bijlage --project <id> --pdf <pad> (--klant <naam> \| --werkbestand <pad>) [--toepassen]` | Zonder vlag de voorvertoning, met vlag de PDF als projectbijlage. |

- `werkbestand.mjs` kent de stappen `offerte`, `bronnen`, `interview`, `uitvraag`, `rapport`, `autotask`, `klaar`.
  Elke `nieuw` en `stap` bewaart via `scrubSecrets`. Pas je het bestand met de hand aan, draai dan `stap` om het
  opnieuw door het filter te halen. `IT_INVENTARISATIE_ROOT` vervangt de standaardmap (alleen voor tests).
- Geef bij `plan` altijd `--engineer "<naam>"` mee. De API kan op taken niet namens iemand schrijven; de naam staat
  daarom in de notitie. Zonder de optie valt het script terug op `engineer` in het werkbestand of de Windows-gebruiker.
- `bijlage` haalt de klantnaam uit `--klant` of uit `klant` in het werkbestand. Een van beide is verplicht.
  `zoek`, `plan` en de voorvertoning van `bijlage` lezen wel uit Autotask (projecten, taken, bestaande bijlagen),
  dus ook daarvoor zijn de credentials nodig.
- `m365-lookup` haalt het token met `az account get-access-token --tenant <id> --resource-type ms-graph`. Het token
  wordt nooit geprint of bewaard. Een domein wordt eerst via DNS naar een tenant-ID vertaald.

## Werkbestand (`inventarisatie.json`, schema 1)

| Veld | Inhoud |
|---|---|
| `klant`, `slug` | Naam en slug (kleine letters, `[a-z0-9-]`) |
| `stap` | Waar de inventarisatie staat, zie de stappen hierboven |
| `offerte.bestand` | Bestandsnaam van de offerte |
| `offerte.scope` | `m365`, `werkplekken`, `server`, `netwerk`, `printers`, `applicaties`, `telefonie`, `beveiliging`: `true` of `false` |
| `offerte.uren` | `[{ fase, uren }]`. Heet een fase precies als een Autotask-taak, dan zet `plan` die uren op de taak |
| `bronnen` | `mail` (lijst), `m365`, `itglue`, `autotask`, `dns` (lijst): wat de bronnen opleverden, zonder geheimen |
| `antwoorden` | Per onderdeel een object met wat bekend is. Sleutels: zie de checklist hieronder |
| `openVragen` | `[{ aan, vraag }]` |
| `laatsteMailcheck` | ISO-tijd van de laatste zoekactie in de mailbox |
| `rapport` | `artifactUrl`, `pdfPad` |
| `autotask` | `companyId`, `projectId`, `toegepast` |
| `engineer` | Optioneel: naam voor de Autotask-notities |

Voorbeeld: `<skill>/voorbeeld/inventarisatie.voorbeeld.json`.

## Interviewchecklist

Vraag per onderdeel alleen wat de bronnen niet opleverden. Gebruik AskUserQuestion waar de antwoorden vast liggen
(ja/nee, keuze uit een paar opties) en vrije tekst voor aantallen en namen. Tussen haakjes de sleutel in `antwoorden`.

1. **Gebruikers en licenties** (`licenties`): wie werkt er nog en wie niet meer; welke licentie per persoon;
   distributeur; einddatum van de licenties; gedeelde postvakken met een betaalde licentie.
2. **Domeinen en mail** (`mail`): alle domeinen; waar de DNS staat en wie erbij kan; gedeelde mailboxen;
   doorsturingen; mail die niet in Microsoft 365 binnenkomt (een reserve-MX of een ander systeem).
3. **Server en data** (`server`): welke servers en rollen; hoeveel data; wat weg kan of naar een archief.
4. **Werkplekken en telefoons** (`werkplekken`): aantal laptops en desktops; besturingssysteem; hoe ze nu beheerd
   worden; welke vervangen moeten. Telefoons: aantal en of de Apple ID's op naam van het bedrijf staan. Telefoons
   gaan standaard niet in Intune; inventariseren wel, inrichten of begroten alleen als de offerte het noemt.
5. **Netwerk** (`netwerk`): firewall; switches met aantal poorten; access points; IP-plan; internetverbinding en
   provider.
6. **Printers** (`printers`): aantal, merk en type, hoe er geprint wordt, wie het contract heeft.
7. **Applicaties en koppelingen** (`applicaties`): welke applicaties, wie de leverancier is, wat lokaal draait en wat
   in de cloud, koppelingen tussen applicaties.
8. **Beveiliging** (`beveiliging`): MFA; antivirus of EDR; back-up en wanneer er voor het laatst is teruggezet;
   beheeraccounts en wie ze gebruikt.
9. **Telefonie** (`telefonie`), alleen als het in de offerte staat: gebruikers; nummerplan; provider; toestellen;
   looptijd van het huidige contract.
10. **Documentatie en leverancierscontracten** (`documentatie`): welke documentatie er is (mail, exports,
    overdrachtsdocument), wat nog ontbreekt, welke leverancierscontracten lopen en tot wanneer.

**Telefonie in scope:** zet in het stappenplan en bij de uren een vaste fase "Telefonie overnemen" met als
rekenbasis "nummers en toestellen overzetten (4 uur), oplevering op locatie (4 uur)", de twee telefonietaken uit
Easywork Basic. Pas de uren aan naar het aantal nummers en toestellen. Zet een open vraag naar het aantal nummers,
de toestellen en de looptijd van het telefoniecontract er standaard bij.

**Afspraken:** wat in het overleg of de offerte al is afgesproken (bijvoorbeeld een EDR erbij), beschrijf je in
"Wat opvalt" en elders als afspraak ("zoals afgesproken komt er een EDR bij"), niet als tekortkoming.

## Rapportschema (`rapport.json`)

`bouw.mjs` weigert het rapport bij een fout en noemt per fout het pad. Voorbeeld:
`<skill>/voorbeeld/rapport.voorbeeld.json`.

| Veld | Inhoud |
|---|---|
| `klant`, `datum` | Tekst, bijvoorbeeld `"november 2026"` |
| `opsteller` | `naam`, `mail`, `telefoon` |
| `lezers` | `[{ naam, organisatie }]` op het voorblad |
| `samenvatting` | `zagen`, `adviseren`, `kerncijfers: [{ label, waarde, toelichting }]`, `stappen: [{ stap, wie }]` (de eerstvolgende drie), optioneel `besluit: { label, tekst }` |
| `stand` | Pagina's huidige stand: `[{ titel, kicker, blokken }]`. Blokken: `{ type: "h2" \| "p", tekst }`, `{ type: "tabel", kolommen, rijen, breedtes? }` (rijen als lijst teksten, even lang als `kolommen`), `{ type: "kaarten", items: [{ titel, tekst }] }` |
| `opvalt` | `[{ punt, zien, doen }]` |
| `doel` | `intro`, `principes: [{ titel, tekst }]`, optioneel `kaarten: [{ titel, tekst }]` |
| `stappenplan` | `maanden` (namen), `toelichting`, `fases: [{ code, naam, omschrijving, start, eind }]`; `start` en `eind` zijn indexen in `maanden`, `start < eind`. Projectmanagement: `{ code, naam, omschrijving, pm: true }` zonder start en eind |
| `uren` | `blokken: [{ titel, soort: "nodig" \| "keuze", fases: [{ fase, resultaat, rekenbasis, uren }] }]` (minstens één blok `nodig`), `projectmanagementPct`, `nietInbegrepen` (lijst), `toelichting` (precies drie zinnen) |
| `openVragen` | `[{ aan, rol, vragen: [...] }]`, per persoon |
| `bijlage` | `intro`, `secties: [{ titel, kolom5: "ja/nee" of een lijst opties, rijen: [{ naam, adres, licentie, voorstel }] }]` |

In alle tekst: geen em-dash, geen `{{`, geen bedragen (`€` of `EUR`), geen geheimen in vrije tekst
(`wachtwoord:` en dergelijke), en alleen de tags `<b>` en `<br>`. Verwijs naar hoofdstukken ("de bijlage", "de open
vragen"), nooit naar een paginanummer: `--fit` kan pagina's splitsen.

**Urenpagina:** "resultaat" is wat de klant daarna heeft, niet de activiteit. "Rekenbasis" is narekenbaar
("15 laptops × 1,5 uur"). Projectmanagement is ongeveer 10%. Subtotalen, projectmanagement, het totaal en het totaal
van alleen "nodig" rekent `bouw.mjs` zelf uit. De drie zinnen in `toelichting`: we rekenen per apparaat, domein of
account; wat de klant of de vorige partij zelf doet zit er niet in; het is een indicatie die preciezer wordt na de
open vragen.

**Hoofdstukken** die niet in scope zijn, laat je weg uit `stand` en het stappenplan.

## Claude Design

1. `Artifact` met `action: "quickstart"`, `intent: "design"` geeft de `type_url` van het Design-type.
2. Publish met `type_url`, `title: "IT-inventarisatie <klant>"`, `auto_open: "after_first_write"`, zonder bestanden.
   Bewaar de url in `rapport.artifactUrl`. Lees zo nodig `SKILL.md`, `artifact-type/reference/format.md` en
   `print.md` van het type via `Artifact` read met `paths`.
3. Upload beide logo's uit `<skill>/assets/` als asset, één per call: publish met `url`, `asset: true`, `file_path`.
4. Bouw met `--fit` (zie SKILL.md). In Git Bash is `MSYS_NO_PATHCONV=1` nodig, anders maakt Git Bash van
   `/_blob/...` een Windows-pad; `bouw.mjs` weigert dat met een melding.
5. Publiceer eerst `project/canvas.json` als `file_path` met `files: {"project/Main.dc.html": "project/Main.dc.html"}`
   en `root` = `<werkmap>/rapport`. Gebruik het volledige lange pad: met een 8.3-kortpad (zoals `ANTOTE~1`) weigert
   het tool. Daarna de overige `project/*.dc.html` in één call.
6. Bij een wijziging: opnieuw bouwen en alleen de gewijzigde bestanden plus `canvas.json` publiceren. Een pagina die
   is weggevallen (bijvoorbeeld een vervolgpagina) verwijder je met `"project/<bestand>": null`.
7. Delen doet de engineer zelf via het Share-menu. De PDF komt uit Share, Export, PDF.

**Fit-check:** `--fit` meet elke pagina in een headless browser en splitst te lange tabellen over vervolgpagina's,
maximaal 6 rondes. Past het dan nog niet, dan noemt `bouw.mjs` de pagina. De browser: `IT_INVENTARISATIE_BROWSER`
als die naar een bestand wijst, anders Chrome, anders Edge. Een beheerde Edge blijft op JUICT-werkplekken headless
vaak hangen; installeer dan Chrome of zet de variabele.

## Uitvraag-mail

Als concept via de Microsoft 365-connector (`outlook_create_draft`), nooit zelf versturen. Een urgent punt staat los
en bovenaan. Per onderdeel een vet kopje en één zin, alleen de onderdelen waar echt iets ontbreekt.

```
Onderwerp: IT-inventarisatie Voorbeeld Techniek

Hoi Sanne,

Let op: de licenties van Microsoft 365 lopen op 12 november af. Laat je ons weten bij welke partij ze nu lopen?

Na ons gesprek van vorige week brengen we jullie IT-omgeving in kaart, zodat we de overstap goed kunnen plannen.

We willen graag van je weten hoe de omgeving er nu uitziet:

1. **Gebruikers en licenties.** Wie werken er nog en wie niet meer?
2. **Domeinen en mail.** Bij welke partij staat de DNS van voorbeeldtechniek.nl?
3. **Netwerk.** Welke firewall en switches staan er, en wie beheert ze?
4. **Applicaties.** Welke programma's gebruiken jullie dagelijks, en wie is de leverancier?

Wachtwoorden hoef je niet te sturen, het gaat nu alleen om het overzicht.

Groet,
<engineer>
```

Zet `laatsteMailcheck` bij het hervatten op het moment van zoeken, zodat de volgende sessie alleen nieuwe mail leest.

## Schrijfregels

Gebruik de regels uit de `juict-vault` skill als die er is. Anders deze korte versie:

- Geen em-dashes. Geen buzzwords zoals ontzorgen, totaaloplossing, naadloos, synergie of robuust.
- Actief en concreet. Getallen boven bijvoeglijke naamwoorden ("5 van de 12 accounts", niet "veel accounts").
- Spelling: JUICT, Easywork, Microsoft 365, Microsoft Entra ID, ISO 27001.
- Spreek de klant aan met jij en jullie.
- Afspraken uit overleg of offerte als afspraak, niet als tekortkoming.
- Beveiligingspunten neutraal als actiepunt voor de overgang. Wijs de vorige partij nooit aan.
- Nooit wachtwoorden of andere geheimen. Schrijf "staat in IT Glue".

## Taakkoppeling (Easywork Basic)

`plan` raakt alleen deze taken aan. Afgeronde taken (status 5) en taken die niet in het sjabloon staan, blijven
ongemoeid; ontbrekende sjabloontaken worden gemeld. Staat de scope in de offerte op `false`, dan is de taak niet van
toepassing.

| Taak | Onderdelen uit `antwoorden` | Scope |
|---|---|---|
| Huidige documentatie ontvangen | `documentatie` | altijd |
| Licentie plan maken | `licenties` | `m365` |
| Aanschaf benodigde hardware en/of software | `netwerk`, `werkplekken` | altijd |
| Setup Microsoft 365 | `mail`, `licenties`, `beveiliging` | `m365` |
| RBAC Opmaken | `beveiliging` | `m365` |
| Mailmigratie Microsoft 365 | `mail` | `m365` |
| Setup Intune | `werkplekken` | `werkplekken` |
| Setup standaard applicaties | `applicaties` | `applicaties` |
| Initiële datamigratie, Definitieve datamigratie | `server` | `server` |
| Setup netwerk | `netwerk` | `netwerk` |
| Setup telefonie, Telefonie oplevering op locatie | `telefonie` | `telefonie` |
| IT Glue updaten | `documentatie` | altijd |

- **Niet van toepassing:** status 5 (Complete), geschatte uren 0, en een notitie "Niet van toepassing volgens de
  inventarisatie van <datum> (<engineer>): <onderdeel> valt niet in de offerte."
- **Wel van toepassing:** een korte samenvatting (maximaal 1000 tekens) achter de bestaande omschrijving, en de
  details in een notitie "Inventarisatie <datum>". Een waarde die op een wachtwoord lijkt, wordt "staat in IT Glue".
- **Opnieuw draaien:** een notitie met dezelfde titel op dezelfde taak wordt overgeslagen, en een samenvatting van
  dezelfde datum komt er niet nog eens bij.
- **Bijlage:** `fullPath` is `it-inventarisatie-<slug>.pdf`, titel "IT-inventarisatie <klant>". Staat die `fullPath`
  er al, dan komt er geen tweede.

## Microsoft 365 via GDAP

De delegated az-token levert: organisatie, domeinen, licenties, gebruikers, laatste aanmelding (beta),
MFA-registratie (beta), groepen, apparaten in Entra ID, Conditional Access en beheerrollen. Mislukt een van die
opvragingen, dan staat de naam in `nietOpgehaald` en hoort het onderdeel in het interview. Deze drie lukken met de
az-token niet:

| Onderdeel | Graph | Resultaat |
|---|---|---|
| Intune-apparaten | `deviceManagement/managedDevices` | 400 |
| SharePoint-sites | `sites` | 401 |
| Security defaults | `policies/identitySecurityDefaultsEnforcementPolicy` | 403 |

`m365-lookup` vraagt deze drie niet op; vraag ze in het interview. Geen eigen app-registratie. Lukt GDAP helemaal
niet, dan gaat het hele Microsoft 365-deel via het interview.

## Autotask

Credentials via Key Vault (`juict-shared-kv`, dan `ju-hermes-emmanuel`): `AUTOTASK-USERNAME`, `AUTOTASK-API-KEY`,
`AUTOTASK-INTEGRATION-CODE`, `AUTOTASK-ZONE` (standaard 19). Fallback via env: `AUTOTASK_USERNAME`,
`AUTOTASK_API_KEY`, `AUTOTASK_INTEGRATION_CODE`, `AUTOTASK_ZONE`. Secret-waarden nooit printen of loggen. Voor andere
Autotask-vragen: de `autotask-api` skill.

| Feit (zone 19) | Waarde |
|---|---|
| Sjabloon | Easywork Basic, project 14, `projectType` 3, 29 taken in zeven fasen |
| Klantprojecten | `projectType` 5 |
| `Task.status` | 1 New, 5 Complete |
| `Task.description` | maximaal 8000 tekens |
| Verwijderen | kan niet: `canDelete: false` op Tasks, Projects, Phases en TaskNotes. Verwijderen doet een projectmanager in de webinterface |
| TaskNote | `noteType` 3 (Task Notes), `publish` 2 (Internal Project Team) |
| Bijlage | `ProjectAttachments` mag aanmaken |

**Schrijf-endpoints:** `PATCH /Projects/{id}/Tasks`, `POST /TaskNotes` en `POST /Projects/{id}/Attachments` zijn per
4 november 2026 nog niet geverifieerd in zone 19. Draai daarom altijd eerst `plan` of de voorvertoning, en laat bij
twijfel de projectmanager meekijken voordat je `--toepassen` gebruikt. Werkt een endpoint, zet dan hier de datum bij.
