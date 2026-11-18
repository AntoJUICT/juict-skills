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
| `scripts/pva/pva.mjs` | `--dossier <pad> --uit <html> [--versie N] [--datum jjjj-mm-dd] [--logo <svg>] [--voorblad <png>]` | Mini PVA als Word-vriendelijke HTML: voorblad, markering `[[INHOUDSOPGAVE]]`, hoofdstukken in de volgorde van de kick-off (lege vallen weg), Financiële afspraken met bron, Open punten, Goedkeuring. Standaard het witte logo `<it>/assets/juict-logo-dia.svg` en de kleurband `assets/pva-voorblad.png`. Exit 1 bij een gebruiksfout, een ongeldig dossier of uitvoer die de regels breekt (instructietekst, lege tabel, em-dash, BC, M365, "raming", "n.t.b.", wachtwoordachtige tekst); exit 2 als een bestand niet te lezen of te schrijven is. Bedragen mogen: het PVA is intern. |
| `scripts/pva/naar-pva.ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/pva/naar-pva.ps1 -Bron <html> -Doel <docx> [-Pdf <pdf>]` | Word-COM: afbeeldingen ingesloten, A4, kleurband achter de tekst op het voorblad, inhoudsopgave (kop 1 en 2) op de markering, paginanummers rechtsonder (niet op het voorblad), opslaan als `.docx` en eventueel PDF. Print het aantal pagina's, en een waarschuwing als een stap niet lukt. |
| `scripts/pva/maak-voorblad.ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/pva/maak-voorblad.ps1` | Maakt eenmalig `assets/pva-voorblad.png` (1240 x 700, het verloop van het deck). Alleen opnieuw als de huisstijl verandert. |
| `scripts/teksten.mjs` | `briefing --dossier <pad> [--presentatie <url>] [--rapport <url>] [--plan <pad>]` | Interne briefing, titel "Projectstart: briefing kick-off". |
| | `wijzigingen --oud <pad> --nieuw <pad> [--plan <pad>]` | Alleen wat veranderd is, titel "Projectstart: aanvulling <dd-mm-jjjj hh:mm>". Niets veranderd: geen notitie en het plan blijft ongemoeid. |
| | `mail --dossier <pad> [--zonder-rapport] [--json <pad>] [--plan <pad>]` | Aan, cc, onderwerp en tekst van de korte opvolgmail: bedankje, rapport als PDF-bijlage met het verzoek het zorgvuldig door te nemen, en kort de open besluiten, het aanleveren, de technische vragen en de afspraken (`intern: false`, plus het overlegritme). Nooit een url: `--rapport <url>` wordt genegeerd. `--zonder-rapport`: de tekst zegt dat het rapport later komt. `--json` schrijft `{aan, cc (met "; "), onderwerp, html, tekst}` voor `outlook-concept.ps1`. Als notitie: titel "Projectstart: uitvraag-mail", zonder `**`. Weigert bij een bedrag (`€`, euro, `EUR`, `500,-`), em-dash, BC, M365, MFA zonder "multifactor" of wachtwoordachtige tekst. |
| `scripts/outlook-concept.ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/outlook-concept.ps1 -Json <mail.json> [-Bijlage <pdf>]` | Maakt via Outlook desktop (COM) een concept uit de json van `teksten.mjs mail --json`, met de PDF als bijlage, en slaat het op in Concepten. Print de mapnaam en de bijlagen. Verstuurt nooit. |
| `scripts/autotask-schrijf.mjs` | `--project <id> --plan <pad> [--toepassen]` | Voorvertoning of plaatsing van notities, bestandsbijlagen, link-bijlagen en taken. De voorvertoning toont de volledige notitietekst, per bijlage het lokale pad en de grootte in bytes, en per taak in logische volgorde `Taak "<titel>" (stap n):` met `omschrijving vullen (N punten, X open)` (plus de tekst), `omschrijving staat er al; notitie "Projectstart: subtaken" toevoegen`, `n.v.t., sluiten met reden`, `nieuwe taak in <fase>`, `sjabloontaak ontbreekt in project; niet aangemaakt`, `staat op Complete in Autotask; niet aangepast` of `staat er al zo; overgeslagen`. Exit 2 als iets mislukt, ook bij een onbekende fase van een eigen taak. Een ontbrekende sjabloontaak is een melding, geen fout. |
| `scripts/taken.mjs` | `zaai --dossier <pad>` | Zet alle sjabloontaken met alle punten uit het draaiboek (`open`) in `dossier.taken`. Staan er al taken, dan blijven die zoals ze zijn en komen alleen ontbrekende sjabloontaken en punten erbij (na een nieuw draaiboek); ontbreekt niets, dan wordt er niets geschreven. |
| | `plan --dossier <pad> --plan <pad>` | Zet de taken in logische volgorde als `taken` in het plan (vervangt de taken die er al stonden, notities en bijlagen blijven). Per taak `titel`, `sjabloon`, `fase`, `status`, `reden`, `uren`, `bron` (eigen taak), `stap`, `punten`, `open` en `omschrijving`. Exit 1 bij een ongeldig dossier. Schrijft niet naar Autotask. |
| | `toon --dossier <pad>` | De volgorde en de volledige tekst per taak, zonder iets te schrijven. |
| `scripts/draaiboek-naar-json.mjs` | `--xlsx <Easywork_Draaiboek.xlsx> --jszip <pad naar node_modules/jszip> --uit <skill>/assets/easywork-draaiboek.json [--datum jjjj-mm-dd]` | Alleen voor beheerders, zie "Easywork-draaiboek". |
| `scripts/samenhang.mjs` | `--dossier <pad> --rapport <rapport.json>` | "Dossier en rapport passen bij elkaar." of de afwijkingen (exit 1). |
| `<it>/scripts/dns-lookup.mjs` | `<domein> [<domein>...]` | MX, NS en tenant-ID per domein. |
| `<it>/scripts/werkbestand.mjs` | `van-dossier <dossierpad>` | Werkbestand van it-inventarisatie uit het dossier. Weigert als het al bestaat. |
| `<it>/scripts/rapport/word.mjs` | `--rapport <rapport.json> --uit <rapport.html> [--logo <svg>]` | Zet het rapport om in Word-vriendelijke HTML. Exit 2 zonder argumenten, 1 bij een ongeldig rapport. |
| `<it>/scripts/rapport/naar-word.ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <it>/scripts/rapport/naar-word.ps1 -Bron <html> -Doel <docx> [-Pdf <pdf>]` | Word-COM maakt er een A4-`.docx` van met ingebedde afbeeldingen. Zelfde Git Bash- en Word-valkuilen als `naar-pva.ps1`. |
| `<it>/scripts/rapport/bouw.mjs` | `--rapport <pad> --uit <map> --logo-pos <url> --logo-dia <url> [--fit]` | Zie REFERENCE.md van it-inventarisatie. |

**`--plan` en `plan.json`.** `teksten.mjs` voegt de notitie toe aan het plan en maakt het bestand aan als het er nog
niet is; een notitie met dezelfde titel wordt vervangen. De vorm:

```json
{
  "notities": [{ "titel": "Projectstart: briefing kick-off", "tekst": "..." }],
  "bijlagen": [{ "titel": "Mini PVA Voorbeeld Techniek v1", "bestandsnaam": "Mini PVA Voorbeeld Techniek v1.docx", "pad": "C:\\...\\Mini PVA Voorbeeld Techniek v1.docx" },
    { "titel": "IT-inventarisatie Voorbeeld Techniek v1", "bestandsnaam": "IT-inventarisatie Voorbeeld Techniek v1.docx", "pad": "C:\...\IT-inventarisatie Voorbeeld Techniek v1.docx" },
    { "titel": "Kick-off presentatie Voorbeeld Techniek", "url": "https://claude.ai/artifact/..." }
  ],
  "taken": [{ "titel": "Setup Microsoft 365", "sjabloon": true, "fase": "Realisatie- en uitvoeringsfase", "status": "nodig", "uren": 16, "stap": 10, "punten": 8, "open": 7, "omschrijving": "Stap 10 van 28. Wacht op: alle taken van Voorbereidings- en planningsfase\n..." }]
}
```

Een bijlage is een bestand (`titel`, `bestandsnaam`, `pad`) of een link (`titel`, `url`). Een link moet met `https://`
beginnen, anders weigert `autotask-schrijf.mjs` hem. `teksten.mjs briefing --presentatie <url> --rapport <url> --plan <pad>`
zet de links zelf in het plan, met de titels `Kick-off presentatie <klant.weergave>` en `IT-inventarisatie <klant.autotask>`;
een url die al in het plan staat wordt niet verdubbeld.

`taken` zet `taken.mjs plan` in het plan. De bijlage zet je zelf in het plan. Dubbelcontrole: notities op titel, bijlagen op bestandsnaam (`fullPath`),
hoofdletters en spaties genegeerd. Taken op titel binnen het project (hoofdletters, accenten en alle spaties genegeerd, dus "Licentieplan maken" vindt "Licentie plan maken"); de fase van een eigen taak op titel. Taaknotities op titel en tekst per taak. Links op `fullPath` = de url, exact (na trim, hoofdlettergevoelig). De aanvullingsnotitie heeft de tijd in de titel, dus een tweede aanvulling op
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
| `projectNaam` | tekst of `null`: naam van het project, voor het voorblad van het PVA | nee |
| `kickoffDatum` | `jjjj-mm-dd` of `null` | nee |
| `contacten[]` | `naam`, `rol`, `organisatie` (tekst), `beslisser`, `aanspreekpunt` (boolean), `mail` (e-mailadres of `null`, optioneel) | ja (lijst) |
| `team[]` | `naam`, `rol` (tekst). De rol "Projectleider" wordt de afzender van de mail | ja (lijst) |
| `externePartijen[]` | `naam`, `rol` (tekst), `aangestuurdDoor` (tekst of `null`) | nee |
| `doel` | tekst, één zin | ja |
| `doelBron` | tekst of `null`: waar het doel bevestigd is. Zonder bron is het een uitgangspunt | nee |
| `hardeDatum` | `datum`, `watKlaar`, `watNiet` (tekst); `bron` (tekst of `null`, optioneel, zelfde regel als `doelBron`) | ja |
| `scope` | `inbegrepen[]`, `buiten[]` (tekst) | ja |
| `fases[]` | `code`, `naam` (tekst), `route` (`"01"` of `"02"`), `start`, `eind` (`jjjj-mm`, start niet na eind); `uren` (getal vanaf 0 of `null`, optioneel: uren uit de offerte voor deze fase); minimaal 1 | ja |
| `migratieplan` | `{ datum: tekst of null }` | nee |
| `vervolgOfferte` | tekst of `null` | nee |
| `gebruikersimpact` | tekst of `null` | nee |
| `overgangBeheer` | tekst of `null` | nee |
| `besluiten[]` | `vraag`, `alsNiet` (tekst), `beslisser`, `uiterlijk` (tekst of `null`), `besluit` (tekst of `null`, optioneel: ingevuld = genomen), `bron` (tekst of `null`, optioneel: waar het besluit staat) | ja (lijst) |
| `aanleveren[]` | `wat` (tekst), `wie`, `datum`, `tijd` (tekst of `null`) | ja (lijst) |
| `afspraken[]` | `tekst`, `bron` (tekst, altijd), `intern` (boolean); `financieel`, `controleren` (boolean, optioneel; `controleren` alleen met `financieel: true`) | ja (lijst) |
| `taken[]` | `titel`, `fase` (tekst), `sjabloon` (boolean), `status` (`"nodig"` of `"nvt"`), `reden` (verplicht bij `nvt`), `uren` (getal vanaf 0 of `null`, alleen uit de offerte), `projectFase` (een `fases[].code`, optioneel), `bron` (verplicht bij `sjabloon: false`), `wachtOp` (lijst met taaktitels, alleen bij `sjabloon: false`, optioneel), `punten[]`: `tekst`, `status` (`"open"`, `"gedaan"`, `"nvt"`, `"extra"`), `onder` (het sub-punt boven een kindpunt), `reden` (verplicht bij `nvt`), `bron` (verplicht bij `extra`), `rol` (`Engineer`, `Projectmanager`, `Verkoop/Administratie`, optioneel bij `extra`; standaard Engineer) | nee |
| `meerwerk[]` | `wat`, `bron` (tekst): werk uit een mail dat niet in de offerte staat | nee |
| `technischeVragen[]` | `vraag`, `aan`, `bron` (tekst) | ja (lijst) |
| `extraOnderwerpen[]` | `soort` (`"beveiliging"`), `geregeld[]`, `controleren[]`, `later[]`, `optioneel` (boolean, optioneel) | ja (lijst) |
| `overleg` | `ritme`, `aanspreekpunt`, `escalatie` (tekst); `kanaal`, `volgende`, `verzoekenControle` (tekst of `null`, optioneel) | ja |
| `artifacts` | `presentatie`, `rapport` (url of `null`) | ja |
| `verwerkt` | `bijlagen[]`, `notities[]` (Autotask-ids) | ja |
| `versie` | geheel getal, minimaal 1; `bewaar` zet de nieuwe versie | ja |

- `contacten` bevat alleen wie van de klant bij de kick-off is, plus contacten van externe partijen. Het contact met
  `aanspreekpunt: true` krijgt de uitvraag-mail, beslissers staan in de cc.
- `financieel: true`: de afspraak komt in het PVA onder Financiële afspraken, met de bron per regel. Alleen wat
  letterlijk in een bron staat; de offerte is leidend. `controleren: true`: de term staat alleen in een mail of wijkt
  af van de offerte. Hij komt dan bij Open punten ("controleren tegen de offerte") en niet in de afspraken of de mail.
- `doelBron`, `hardeDatum.bron` en `besluiten[].bron`: een mail met datum of "kick-off <datum>". Zonder bron zegt
  het PVA "uitgangspunt, nog te bevestigen" en staat het punt bij Open punten.
- Open punten in het PVA: alles wat `null` of open is (besluiten zonder uitkomst, aanleveren zonder wie of datum,
  migratieplan zonder datum, partij zonder aansturing, kanaal, volgend overleg, impact, overgang), plus feiten zonder
  bron en financiële termen met `controleren: true`.
- `taken`: begin met `taken.mjs zaai`. `controleer` eist: staat er een sjabloontaak in, dan alle 29; elke
  sjabloontaak met status `nodig` heeft alle punten uit het draaiboek (`open`, `gedaan` of `nvt` met reden), een punt
  dat niet in het draaiboek staat is `extra` met een `bron`; de fase van een sjabloontaak is die uit het draaiboek;
  een eigen taak (`sjabloon: false`) heeft een `bron` en geen sjabloontitel; geen dubbele titels (ook niet twee
  schrijfwijzen van dezelfde sjabloontaak); `wachtOp` wijst naar een bestaande taak en de volgorde loopt niet rond.
  Heeft een fase `uren`, dan mag de som van de taken met die `projectFase` daar niet boven komen. Een bedrag mag in
  taken (intern; het draaiboek noemt zelf de deelfacturatie).
- Omschrijving in Autotask: "Stap n van m. Wacht op: ..." (een hele fase als "alle taken van <fase>"), een regel
  uitleg, eventueel "Uren volgens de offerte", en daarna per rol (Engineer, Projectmanager, Verkoop/Administratie) de
  punten genummerd: `[x]` gedaan, `[ ]` open, `<tekst>, n.v.t.: <reden>`, `+ <tekst> (bron: ...)` voor extra, een
  kindpunt als `1.1` onder zijn sub-punt (of los met "(onder: ...)" als het sub-punt bij een andere rol hoort) en de
  toelichting uit het draaiboek. Zo ziet de engineer zijn deel ook in administratie- en projectmanagementtaken
  (bijvoorbeeld CPOR, PAL en Azure Accelerate in "Administratieve opstart project"). Langer dan 8000 tekens: de
  volledige tekst komt als notitie "Projectstart: subtaken" en de omschrijving wordt ingekort met een verwijzing.
- Volgorde: uit de kolom "Wacht op" van het draaiboek ("2.2 Project opstart", "Hele fase 3: ..."), over de fases
  heen; bij gelijke stand op fase en dan de volgorde van het draaiboek. Een eigen taak wacht op zijn `wachtOp` of
  standaard op de sjabloontaken van zijn fase. Alleen taken die nodig zijn krijgen een stap; wacht een taak op een
  taak die niet nodig is, dan wacht hij op wat die taak zelf nodig had. Fases en datums in Autotask veranderen niet.
- PVA, Technische uitvoering: tabel Stap, Taak, Fase, Open voor engineer, Uren in volgorde; Niet van toepassing met
  reden; Taken buiten het sjabloon met bron. Open punten: een eigen taak zonder uren, en elk extra punt dat met
  "controleren" begint. De briefing noemt de taken met open punten per rol, in volgorde, en wat niet van toepassing is.
- `meerwerk`: komt in het PVA bij Open punten ("meerwerk, afstemmen") en in de briefing, nooit als taak.
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

- `GET /Projects/{id}/Phases` en `GET /Projects/{id}/Tasks` (geverifieerd volgens de autotask-api skill). Gebruikt
  voor de fase-id op titel en de dubbelcontrole van taken. `POST /TaskNotes/query` op `taskID` voor bestaande
  taaknotities.

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

- **Sjabloontaken bijwerken.** `PATCH /Projects/{id}/Tasks` met `{ id, description }` als de omschrijving leeg is,
  en `{ id, status: 5, estimatedHours: 0 }` voor een taak die niet van toepassing is (eerst de notitie, dan de
  status; faalt de notitie, dan blijft de taak open). PATCH met `id` voor `status`, `estimatedHours` en
  `description` is geverifieerd (autotask-api); `description` maximaal 8000 tekens. Een taak met status 5 (Complete)
  wordt nooit aangeraakt. Een gevulde omschrijving wordt nooit overschreven.
- **Notities bij een taak.** `POST /TaskNotes` met `{ taskID, title, description, noteType: 3, publish: 2 }`
  (geverifieerd, zelfde vorm als it-inventarisatie op 4 november 2026). Titels: "Projectstart: subtaken" (de
  subtaken als de omschrijving al gevuld is, of de volledige tekst als die langer is dan 8000 tekens),
  "Projectstart: niet van toepassing" ("Niet van toepassing: <reden>") en "Projectstart: aanvulling" (afwijking bij
  een bestaande eigen taak). Een notitie met dezelfde titel en tekst op die taak wordt niet opnieuw geplaatst.
- **Eigen taken (buiten het sjabloon).** `POST /Projects/{id}/Tasks` met `{ projectID, phaseID, title, description, taskType: 1, status: 1, estimatedHours }`,
  zonder resource (dan zijn `departmentID` en `billingCodeID` niet nodig; de planner wijst toe via het planbord).
  Het endpoint en de verplichte velden `projectID`, `title`, `taskType` (1 FixedWork) en `status` zijn
  geverifieerd (autotask-api). **Live geverifieerd op 18-11-2026 (zone 19, testproject):** `phaseID` en
  `status: 1` (New) bij het aanmaken (taak kwam in de juiste fase), `PATCH` van `description` op 28 sjabloontaken,
  en het sluiten van een n.v.t.-taak met status 5, 0 uur en een notitie. Lees na een run het resultaat terug met
  `GET /Projects/{id}/Tasks` (fase, status en uren). Een taak kan niet worden verwijderd; een fout sluit je af met
  status 5, 0 uur en een notitie met de reden, of laat de projectleider hem in de webinterface verwijderen.
- **Lezen voor de punten.** De taken van het project (`GET /Projects/{id}/Tasks`), hun notities
  (`POST /TaskNotes/query` op `taskID`) en de tijdregels lees je alleen, via de autotask-api skill. Er is geen script
  in deze skill voor tijdregels: bevestig de velden met de autotask-api skill voordat je erop vertrouwt.

## Easywork-draaiboek

`assets/easywork-draaiboek.json` bevat de subtaken onder de 29 taken van het sjabloon Easywork Basic, gemaakt uit
JUICT's Easywork-draaiboek (xlsx, tabblad "Easywork Basic"): per taak `wbs`, `fase`, `titel` (zoals het draaiboek hem
schrijft), `autotaskTitel` (alleen als Autotask hem anders schrijft, zoals "Licentie plan maken"), `rol`, `wachtOp`,
`toelichting` en `punten[]` met `tekst`, `rol`, `toelichting` en `kinderen[]`. De kolom "Verbeteradvies" (interne
reviewnotities) gaat er nooit in. De suggesties daarin (bijvoorbeeld "Tussentijds voortgangsgesprek" en "Project
afsluitingsgesprek" verplaatsen, of "Huidige documentatie ontvangen" naar fase 1) past de skill niet vanzelf toe: de
volgorde volgt alleen "Wacht op", en fases in Autotask blijven zoals het sjabloon ze heeft.

**Bijwerken (alleen beheerders).** Verandert het sjabloon of het draaiboek, maak de JSON dan opnieuw en commit alleen
de JSON:

```
node <skill>/scripts/draaiboek-naar-json.mjs --xlsx "<pad>/Easywork_Draaiboek.xlsx" --jszip <map>/node_modules/jszip --uit <skill>/assets/easywork-draaiboek.json
```

De repo heeft geen npm-dependencies; `--jszip` wijst naar een lokale installatie van jszip (bijvoorbeeld
`npm install jszip` in een map buiten de repo). Het script stopt bij een fase of taak die niet in `SJABLOON_FASES` of
`SJABLOON_TITELS` staat (bovenin het script) en bij een sjabloontaak die in het draaiboek ontbreekt: pas die lijsten
aan als het sjabloon in Autotask verandert. De datum komt uit de documenteigenschappen van het xlsx-bestand
(`--datum` gaat voor). Het script zet "M365" om in "Microsoft 365" en een em-dash in een komma. Draai daarna de tests
en, op lopende projecten, `taken.mjs zaai` om nieuwe punten aan te vullen.

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
  `-File` (zoals `naar-pva.ps1`) of enkele aanhalingstekens. Voor `/_blob/...` in `bouw.mjs`: `MSYS_NO_PATHCONV=1`.
- **Word houdt een bestand vast.** Na een fout in `naar-pva.ps1` schrijf je naar een nieuwe doelnaam.
- **Tests op Windows.** `node --test <map>` faalt op Windows. Gebruik
  `node --test "plugins/it-inventarisatie/skills/**/*.test.mjs"` vanuit de repo-root. De test "integratie: voorbeeld
  met 60 bijlage-rijen past na --fit" faalt zonder Chrome; dat is de omgeving.
