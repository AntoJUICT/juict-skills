# Referentie voor projectstart

Geen klantdata in dit bestand: de repo is publiek. Voorbeelden gebruiken de verzonnen klant "Voorbeeld Techniek B.V.".
`<skill>` is de basismap van deze skill, `<it>` die van it-inventarisatie, `<werkmap>` is
`%USERPROFILE%\.claude\projectstart\<projectId>\` en `<scratch>` de scratchpad van de sessie.

## Scripts

Node 22 of hoger, geen npm-dependencies. Opties met een spatie, niet met `=`. Exit 0 is gelukt, 1 is een gebruiks- of
controlefout, 2 is mislukt (Autotask, Word, bestand). Geen enkel script schrijft naar Autotask zonder `--toepassen`.

| Script | Gebruik | Uitkomst |
|---|---|---|
| `scripts/bronnen.mjs` | `--project <id> [--uit <map>]` | Bijlagen naar `<map>/bronnen/<id>-<naam>`, manifest `<map>/bronnen.json` (bijlagen, `overgeslagen` met id, titel en reden voor links en lege bijlagen, notities met tekst, bedrijfsnaam, companyId). Print het manifest zonder notitietekst. Standaardmap: `<werkmap>`. Alleen lezen. |
| `scripts/tekst.mjs` | `<bronnenmap>` | Schrijft `<bestand>.txt` naast elke `.eml`, `.msg` en `.docx`. PDF wordt overgeslagen: lees die met de Read-tool. `.msg` gaat via `msg-naar-tekst.ps1` (Outlook-COM). |
| `scripts/dossier.mjs` | `controleer <pad>` | "Dossier is geldig." of de fouten per veld (exit 1). |
| | `laad --project <id> --uit <pad>` | Hoogste versie van `projectstart-dossier-v<N>.json` naar `<pad>`, of "Nog geen dossier op project <id>." |
| | `bewaar --project <id> --dossier <pad> [--toepassen]` | Valideert, filtert geheimen en zet `projectstart-dossier-v<N+1>.json` op het project. Geen wijziging: er wordt niets geschreven. |
| | `nieuw --dossier <pad> --bronnen <bronnen.json>` | JSON met `aantal` en de bijlagen en notities die nog niet in `verwerkt` staan (zonder inhoud). De eigen uitvoer van de skill telt niet mee: `projectstart-dossier-v<N>.json`, `Mini PVA <klant> v<N>.docx`, `IT-inventarisatie <klant> v<N>.docx` en notities die met "Projectstart:" beginnen. |
| `scripts/presentatie/bouw.mjs` | `--dossier <pad> --uit <map> [--datum jjjj-mm-dd]` | `<map>/Kick-off <klant>.html` en `<map>/files.json`. `--datum` gaat voor `kickoffDatum`. |
| `scripts/pva/vul.mjs` | `--dossier <pad> --uit <docx>` | Mini PVA uit `assets/mini-pva-template.docx`. Exit 2 als er een plaatshouder overblijft. |
| `scripts/pva/afronden.ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/pva/afronden.ps1 -Bron <docx> -Doel <docx> [-Pdf <pdf>]` | Werkt via Word-COM de inhoudsopgave bij, slaat op en maakt eventueel een PDF. Print het aantal pagina's. |
| `scripts/teksten.mjs` | `briefing --dossier <pad> [--presentatie <url>] [--rapport <url>] [--plan <pad>]` | Interne briefing, titel "Projectstart: briefing kick-off". |
| | `wijzigingen --oud <pad> --nieuw <pad> [--plan <pad>]` | Alleen wat veranderd is, titel "Projectstart: aanvulling <dd-mm-jjjj hh:mm>". Niets veranderd: geen notitie en het plan blijft ongemoeid. |
| | `mail --dossier <pad> [--zonder-rapport] [--json <pad>] [--plan <pad>]` | Aan, cc, onderwerp en tekst van de korte opvolgmail: bedankje, rapport als PDF-bijlage met het verzoek het zorgvuldig door te nemen, en kort de open besluiten, het aanleveren, de technische vragen en de afspraken (`intern: false`, plus het overlegritme). Nooit een url: `--rapport <url>` wordt genegeerd. `--zonder-rapport`: de tekst zegt dat het rapport later komt. `--json` schrijft `{aan, cc (met "; "), onderwerp, html, tekst}` voor `outlook-concept.ps1`. Als notitie: titel "Projectstart: uitvraag-mail", zonder `**`. Weigert bij een bedrag (`€`, euro, `EUR`, `500,-`), em-dash, BC, M365, MFA zonder "multifactor" of wachtwoordachtige tekst. |
| `scripts/outlook-concept.ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/outlook-concept.ps1 -Json <mail.json> [-Bijlage <pdf>]` | Maakt via Outlook desktop (COM) een concept uit de json van `teksten.mjs mail --json`, met de PDF als bijlage, en slaat het op in Concepten. Print de mapnaam en de bijlagen. Verstuurt nooit. |
| `scripts/autotask-schrijf.mjs` | `--project <id> --plan <pad> [--toepassen]` | Voorvertoning of plaatsing van notities, bestandsbijlagen en link-bijlagen. De voorvertoning toont de volledige notitietekst en per bijlage het lokale pad en de grootte in bytes. Wat er al staat wordt overgeslagen. Exit 2 als iets mislukt. |
| `scripts/samenhang.mjs` | `--dossier <pad> --rapport <rapport.json>` | "Dossier en rapport passen bij elkaar." of de afwijkingen (exit 1). |
| `<it>/scripts/dns-lookup.mjs` | `<domein> [<domein>...]` | MX, NS en tenant-ID per domein. |
| `<it>/scripts/werkbestand.mjs` | `van-dossier <dossierpad>` | Werkbestand van it-inventarisatie uit het dossier. Weigert als het al bestaat. |
| `<it>/scripts/rapport/word.mjs` | `--rapport <rapport.json> --uit <rapport.html> [--logo <svg>]` | Zet het rapport om in Word-vriendelijke HTML. Exit 2 zonder argumenten, 1 bij een ongeldig rapport. |
| `<it>/scripts/rapport/naar-word.ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <it>/scripts/rapport/naar-word.ps1 -Bron <html> -Doel <docx> [-Pdf <pdf>]` | Word-COM maakt er een A4-`.docx` van met ingebedde afbeeldingen. Zelfde Git Bash- en Word-valkuilen als `afronden.ps1`. |
| `<it>/scripts/rapport/bouw.mjs` | `--rapport <pad> --uit <map> --logo-pos <url> --logo-dia <url> [--fit]` | Zie REFERENCE.md van it-inventarisatie. |

**`--plan` en `plan.json`.** `teksten.mjs` voegt de notitie toe aan het plan en maakt het bestand aan als het er nog
niet is; een notitie met dezelfde titel wordt vervangen. De vorm:

```json
{
  "notities": [{ "titel": "Projectstart: briefing kick-off", "tekst": "..." }],
  "bijlagen": [{ "titel": "Mini PVA Voorbeeld Techniek v1", "bestandsnaam": "Mini PVA Voorbeeld Techniek v1.docx", "pad": "C:\\...\\Mini PVA Voorbeeld Techniek v1.docx" },
    { "titel": "IT-inventarisatie Voorbeeld Techniek v1", "bestandsnaam": "IT-inventarisatie Voorbeeld Techniek v1.docx", "pad": "C:\...\IT-inventarisatie Voorbeeld Techniek v1.docx" },
    { "titel": "Kick-off presentatie Voorbeeld Techniek", "url": "https://claude.ai/artifact/..." }
  ]
}
```

Een bijlage is een bestand (`titel`, `bestandsnaam`, `pad`) of een link (`titel`, `url`). Een link moet met `https://`
beginnen, anders weigert `autotask-schrijf.mjs` hem. `teksten.mjs briefing --presentatie <url> --rapport <url> --plan <pad>`
zet de links zelf in het plan, met de titels `Kick-off presentatie <klant.weergave>` en `IT-inventarisatie <klant.autotask>`;
een url die al in het plan staat wordt niet verdubbeld.

De bijlage zet je zelf in het plan. Dubbelcontrole: notities op titel, bijlagen op bestandsnaam (`fullPath`),
hoofdletters en spaties genegeerd. Links op `fullPath` = de url, exact (na trim, hoofdlettergevoelig). De aanvullingsnotitie heeft de tijd in de titel, dus een tweede aanvulling op
dezelfde dag wordt niet overgeslagen.

**Bestandsnamen op het project.** `projectstart-dossier-v<N>.json`, `Mini PVA <klant> v<N>.docx` (`klant.weergave`) en
`IT-inventarisatie <klant.autotask> v<N>.docx` (Word-versie van het rapport, bestandsbijlage naast de link) en
`Kick-off <klant>.pdf` alleen als de projectleider zelf een PDF aanlevert. Volgende PVA-versie: de hoogste N van de
bijlagen `Mini PVA <klant> v<N>.docx` op het project plus 1, of 1 als er nog geen staat; voor het Word-rapport geldt hetzelfde met `IT-inventarisatie <klant.autotask> v<N>.docx`.

## Dossierschema (`dossier.json`, schema 1)

Bron van waarheid: `valideerDossier` in `scripts/dossier.mjs`. Tekst is een niet-lege string. "Open" betekent `null`
of afwezig; dat blijft in de documenten zichtbaar open. In alle tekst: geen em-dash, geen BC of M365, geen MFA zonder
"multifactor", geen bedrag (`€`, euro, `EUR`, `500,-`; behalve in `afspraken[].tekst` met `intern: true`), geen geheime sleutelnamen of
wachtwoordachtige tekst.

| Veld | Vorm | Verplicht |
|---|---|---|
| `schema` | `1` | ja |
| `projectId`, `companyId` | geheel getal | ja |
| `klant.autotask`, `klant.weergave` | tekst: naam in Autotask, naam die de klant gebruikt | ja |
| `kickoffDatum` | `jjjj-mm-dd` of `null` | nee |
| `contacten[]` | `naam`, `rol`, `organisatie` (tekst), `beslisser`, `aanspreekpunt` (boolean), `mail` (e-mailadres of `null`, optioneel) | ja (lijst) |
| `team[]` | `naam`, `rol` (tekst). De rol "Projectleider" wordt de afzender van de mail | ja (lijst) |
| `externePartijen[]` | `naam`, `rol` (tekst), `aangestuurdDoor` (tekst of `null`) | nee |
| `doel` | tekst, één zin | ja |
| `hardeDatum` | `datum`, `watKlaar`, `watNiet` (tekst) | ja |
| `scope` | `inbegrepen[]`, `buiten[]` (tekst) | ja |
| `fases[]` | `code`, `naam` (tekst), `route` (`"01"` of `"02"`), `start`, `eind` (`jjjj-mm`, start niet na eind); minimaal 1 | ja |
| `migratieplan` | `{ datum: tekst of null }` | nee |
| `vervolgOfferte` | tekst of `null` | nee |
| `gebruikersimpact` | tekst of `null` | nee |
| `overgangBeheer` | tekst of `null` | nee |
| `besluiten[]` | `vraag`, `alsNiet` (tekst), `beslisser`, `uiterlijk` (tekst of `null`), `besluit` (tekst of `null`, optioneel: ingevuld = genomen) | ja (lijst) |
| `aanleveren[]` | `wat` (tekst), `wie`, `datum`, `tijd` (tekst of `null`) | ja (lijst) |
| `afspraken[]` | `tekst`, `bron` (tekst), `intern` (boolean) | ja (lijst) |
| `technischeVragen[]` | `vraag`, `aan`, `bron` (tekst) | ja (lijst) |
| `extraOnderwerpen[]` | `soort` (`"beveiliging"`), `geregeld[]`, `controleren[]`, `later[]`, `optioneel` (boolean, optioneel) | ja (lijst) |
| `overleg` | `ritme`, `aanspreekpunt`, `escalatie` (tekst); `kanaal`, `volgende`, `verzoekenControle` (tekst of `null`, optioneel) | ja |
| `artifacts` | `presentatie`, `rapport` (url of `null`) | ja |
| `verwerkt` | `bijlagen[]`, `notities[]` (Autotask-ids) | ja |
| `versie` | geheel getal, minimaal 1; `bewaar` zet de nieuwe versie | ja |

- `contacten` bevat alleen wie van de klant bij de kick-off is, plus contacten van externe partijen. Het contact met
  `aanspreekpunt: true` krijgt de uitvraag-mail, beslissers staan in de cc.
- Een beveiligingsonderwerp maakt slide 5. Staat beveiliging in het rapport als keuze, zet dan `optioneel: true`.
- `werkbestand.mjs van-dossier` zet beveiliging in het werkbestand als `antwoorden.beveiliging.bekend` (uit
  `geregeld`) en `antwoorden.beveiliging.nogControleren` (uit `controleren`). `nogControleren` is een eigen sleutel die
  de interviewchecklist van it-inventarisatie niet kent: vraag die punten uit en verwerk ze in het rapport.

## Presentatie publiceren

- Basis is Marts verkoopdeck `MART_DECK` (`https://claude.ai/artifact/ErU9wG7ZhrGkS655Nz2zrB`), steeds de actuele
  versie. `MART_BESTANDEN` in `scripts/presentatie/mart-bestanden.mjs` noemt de bestanden die de kick-off nodig heeft:
  stylesheets, `present.js`, designsysteem met fonts, logo, achtergrond en de teamfoto's.
- `publicatiePad(bron)` bepaalt waar een bestand naast de pagina komt: zonder `project/`, en de twee fonts uit
  `project/_ds/...` naar `assets/fonts/` (daar zoekt `assets/colors_and_type.css` ze). `compat.json` en de overige
  `_ds`-bestanden gaan niet mee.
- `files.json` is de `files`-map voor het Artifact-tool: per pad `{ "artifact": MART_DECK, "path": "project/..." }`,
  server-side gekopieerd, niets gedownload. Publish met `file_path` = `<scratch>/kickoff/Kick-off <klant>.html`,
  `files` = de inhoud van `files.json`, `icon: "presentation"`, zonder `url` (eerste run).
- JUICT-teamleden met een foto in `assets/teamfull/` (op voornaam) krijgen die foto, anderen een cirkel met initialen.
- Een tweede run publiceert de presentatie nooit opnieuw. Correcties doet de projectleider met de hand.

## Autotask

Credentials en zone: zie REFERENCE.md van it-inventarisatie (Key Vault `juict-shared-kv`, dan `ju-hermes-emmanuel`,
zone 19). Verwijderen kan niet, ook geen notities en bijlagen.

**Lezen, geverifieerd in zone 19 op 12 november 2026:**

- `GET /Projects/{id}` geeft `{ item }` met o.a. `companyID`, `projectName`, `projectNumber`, `status`, `projectType`.
- `GET /Companies/{id}` geeft `{ item }` met `companyName`.
- `GET /Projects/{id}/Attachments` geeft `{ items, pageDetails }`; `data` is in de lijst altijd `null`. Velden o.a.
  `id`, `title`, `fullPath`, `contentType`, `attachDate`, `publish`. Eén pagina, geen paginering.
- `GET /Projects/{id}/Attachments/{attachmentId}` geeft `{ items: [één rij] }` met `data` als base64.
- `POST /ProjectNotes/query` op `projectID` geeft `id`, `createDateTime`, `createdByContactID`, `creatorResourceID`,
  `description`, `impersonatorCreatorResourceID`, `impersonatorUpdaterResourceID`, `isAnnouncement`,
  `lastActivityDate`, `noteType`, `projectID`, `publish`, `title`. Bestaande notities: `noteType` 5, `publish` 2.

**Schrijven:**

- `POST /Projects/{id}/Attachments` met `{ parentID, attachmentType: "FILE_ATTACHMENT", publish, title, fullPath, data }`:
  geverifieerd op 4 november 2026 (it-inventarisatie, met `publish: 1`). `fullPath` komt exact terug, dus de
  dubbelcontrole werkt. Dossier en PVA zijn intern en gaan met `publish: 2` (intern projectteam): **bevestig in de
  proefrun** dat de bijlage daarmee geplaatst wordt en zichtbaar is voor het projectteam.
- `POST /Projects/{id}/Attachments` voor een link met `{ parentID, attachmentType: "URL", publish: 2, title, fullPath: <url> }`:
  geverifieerd in zone 19 op 17 november 2026. De bijlagenlijst geeft `attachmentType: "URL"` en `fullPath` precies
  als de url terug, dus de dubbelcontrole werkt. Er is geen `data`. `bronnen.mjs` slaat zulke bijlagen over
  (`overgeslagen`, reden "geen bestandsbijlage") en `dossier.mjs nieuw` telt ze dus nooit als nieuwe bron.
- `POST /Projects/{id}/Notes` met `{ projectID, title, description, noteType: 5, publish: 2, isAnnouncement: false }`:
  geverifieerd in zone 19 op 17 november 2026. `isAnnouncement` is verplicht (zonder dit veld faalt de POST met
  `Missing Required Field: isAnnouncement.`). De notitie komt terug via `ProjectNotes/query` met dezelfde titel.

## Bekende valkuilen

- **Beheerde Edge headless.** De fit-check van `bouw.mjs` (`--fit`) hangt op JUICT-werkplekken zonder Chrome. Zet
  `IT_INVENTARISATIE_BROWSER` op een werkende browser of bouw zonder `--fit` en controleer de pagina's in Claude Design.
- **Publiceren vanuit de scratchpad.** Het Artifact-tool publiceert alleen uit de werkmap of scratchpad van de sessie,
  niet uit `%USERPROFILE%\.claude\...`. Bouw presentatie en rapport dus met `--uit <scratch>/...`.
- **8.3-paden.** Geef het volledige lange pad (`C:\Users\<naam>\...`), geen kortpad als `C:\Users\VOORBE~1\...`; dat
  weigert het tool. De scratchpad wordt soms als kortpad gemeld: vraag het lange pad op (`cygpath -l` of
  `(Get-Item <pad>).FullName`).
- **Geen paden met `_`.** De artifact-service weigert paden die met een underscore beginnen. Daarom gaan de fonts naar
  `assets/fonts/` en publiceer je niets uit `_ds/`.
- **Geen Design-canvas voor de presentatie.** Een canvas met `compat.json` toont in een nieuw canvas niets. De
  presentatie is een gewone HTML-artifact. Het rapport van it-inventarisatie (`*.dc.html`) blijft wel een canvas.
- **En-dash en spaties in bestandsnamen.** Bijlagenamen bevatten vaak een en-dash. Geef zulke paden alleen via Node
  door of als los argument aan `-File`, nooit geplakt in een PowerShell-string.
- **`$` in Git Bash.** In `powershell -Command "..."` maakt Git Bash van `$var` een lege tekst. Gebruik een `.ps1` met
  `-File` (zoals `afronden.ps1`) of enkele aanhalingstekens. Voor `/_blob/...` in `bouw.mjs`: `MSYS_NO_PATHCONV=1`.
- **Word houdt een bestand vast.** Na een fout in `afronden.ps1` schrijf je naar een nieuwe doelnaam.
- **Tests op Windows.** `node --test <map>` faalt op Windows. Gebruik
  `node --test "plugins/it-inventarisatie/skills/**/*.test.mjs"` vanuit de repo-root. De test "integratie: voorbeeld
  met 60 bijlage-rijen past na --fit" faalt zonder Chrome; dat is de omgeving.
