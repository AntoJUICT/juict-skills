# Autotask API — Lessons Learned

Bekende valkuilen, fouten en hard-geleerde lessen bij werken met de Autotask REST API. Voeg nieuwe lessen na elk project toe via `/wrap-up`, onder de juiste categorie.

---

## Endpoints

**`/ProjectTemplates` bestaat niet.** Nooit gebruiken. Ontdekt na mislukte requests.

**`/ProjectPhases/query` geeft 404 in zone 19.** Gebruik `/Projects/{id}/Phases` (GET, niet query).

**Notes en Attachments AANMAKEN kan alleen genest — lezen mag wel top-level.**
- Aanmaken: `POST /Tickets/{id}/Notes` en `POST /Tickets/{id}/Attachments`. Top-level `/TicketNotes` en `/TicketNoteAttachments` gaven daarvoor 404 in productie; Swagger toonde de geneste structuur.
- Lezen: `POST /TicketNotes/query` werkt wél top-level (200, geverifieerd 09-08-2026) en is de manier om notities van veel tickets tegelijk op te halen (filter `ticketID in [...]`, chunk op ~200 ids).
- How to apply: lees de regel als "creates zijn genest", niet als "dit entity bestaat niet top-level". De oude, absolute formulering sprak REFERENCE.md tegen en kostte een omweg.

**Company To-Dos zijn óók een geneste resource — `POST /Companies/{id}/ToDos`.** Zowel top-level `/CompanyToDos` als `/ToDos` geven 404; alleen de nested variant onder Companies werkt. Let op: `GET /CompanyToDos/entityInformation/fields` geeft wél 200 — dat een entity-metadata endpoint bestaat betekent dus niet dat het top-level CRUD-pad bestaat.

**Verifieer altijd of een endpoint bestaat voor implementatie.** Test met een GET of check Swagger. Schrijf nooit een Autotask endpoint zonder verificatie als er geen werkend voorbeeld in de codebase staat.

**Bereken response- en resolutietijd nooit zelf uit `createDate`/`completedDate`.** Dat is wall-clock inclusief nachten, weekenden en wachtstatussen — onvergelijkbaar met welke norm dan ook. Gebruik `ServiceLevelAgreementResults/query`; Autotask verrekent kantooruren en pauzes al. Zone 19 gaf 141,84 u wall-clock tegen 33,84 u op de SLA-klok voor hetzelfde ticket.
- How to apply: onderscheid de SLA-**klok** (het meetinstrument, altijd bruikbaar) van de SLA-**norm** (`isResolutionMet`, de due-datums). De norm is de contractuele ondergrens en kan orden van grootte ruimer zijn dan een intern doel — bij JUICT een mediaan van 311 u tegen een doel van 30 min. Hang nooit een efficiency-KPI aan `isResolutionMet`.

**Drie SLA-velden op het Ticket-entity lijken bruikbaar maar zijn leeg in zone 19.** `serviceLevelAgreementHasBeenMet`, `serviceLevelAgreementPausedNextEventHours` en `resolutionPlanDueDateTime` waren 0/713 gevuld. Gebruik `ServiceLevelAgreementResults` in plaats daarvan. `firstResponseDateTime`/`DueDateTime` en `resolvedDateTime`/`DueDateTime` zijn wél gevuld.

**Autotask levert geen status- of queue-historie via REST.** Je ziet alleen de huidige stand per ticket. Een "hoeveel tickets zijn geëscaleerd"-vraag beantwoord je dus met een eindstand (in welke queue staat het ticket nu), niet met een overgang. Benoem dat verschil in rapportages; een ticket dat meteen in de tweede lijn is aangemaakt telt anders mee als escalatie.

---

## Filters / query-operators

**Een platte filter-array gedroeg zich als AND, niet als OR.** Geverifieerd zone 19 op 05-08-2026 over negen endpoints (Tickets, Contacts, Resources, TicketNotes, TimeEntries, AttachmentInfo, TicketAdditionalContacts, Invoices, BillingItems): `[companyID eq 0, status noteq 5, status noteq 16]` gaf exact dezelfde 14 records als de `and`-wrapper, allemaal companyID 0.
- How to apply: leun er niet op, in geen van beide richtingen. Wikkel condities expliciet in `{ op: "and", items: [...] }` overal waar een gemiste conditie een tenant-lek of een verkeerde dataset oplevert. Het is één regel code en haalt de aanname weg.

**De `noteExist`-operator is onbetrouwbaar in zone 19.** `{ field: "rmmAlertID", op: "noteExist" }` gaf álle records terug i.p.v. alleen de tickets zónder rmmAlertID, terwijl `op: "exist"` wél correct de RMM-tickets (rmmAlertID gezet) teruggaf. Filter "veld is leeg"-condities client-side (in JS) i.p.v. op `noteExist` te vertrouwen — het is een stille datafout (200 met te véél records, geen foutmelding).

---

## TimeEntries (meest foutgevoelig)

POST /TimeEntries vereist altijd drie velden — ontbrekend = 500 error:

| Veld | Ontbreekt → fout |
|---|---|
| `resourceID` | "Value does not exist for the required field resourceID" |
| `roleID` | "TimeEntries for Tickets must have a roleID" |
| `hoursWorked > 0` | "Must have at least one of hoursWorked or startDateTime/endDateTime" |

Verkeerde resource+role combinatie → "The specified AssignedResourceID and AssignedRoleID combination is not currently defined" (500).

**Service tickets vereisen een expliciet start/stop-venster.** POST /TimeEntries met alleen `hoursWorked` geeft 500 "TimeEntries for Service tickets require a start and stop time." Geef altijd `startDateTime` en `endDateTime` mee (en optioneel `hoursWorked` erbij).

**Zonder start/stop-venster is `dateWorked` verplicht.** POST /TimeEntries met alleen `hoursWorked` (geen `startDateTime`) geeft 500 "dateWorked is required when no value is supplied for startDateTime". Geef `dateWorked` (ISO, bv. `2026-07-24T09:00:00`) altijd mee; voor Service tickets combineer je het met `startDateTime`/`endDateTime` (zie hierboven).

**How to apply:**
- Sla standaard IDs op in `AUTOTASK_DEFAULT_RESOURCE_ID` en `AUTOTASK_DEFAULT_ROLE_ID`
- Guard altijd: `durationHours > 0 ? durationHours : 0.01`
- Gebruik: `params.resourceId ?? Number(process.env.AUTOTASK_DEFAULT_RESOURCE_ID)`

**`billingCodeID` accepteert alleen "general allocation codes".** Een code uit `/BillingCodes/query` met `billingCodeType: 0` is niet automatisch geldig — materiaal/contract-codes geven 500 "The given allocation code is not an active general allocation code". Alleen als general allocation code geconfigureerde labor-codes werken.
- How to apply: filter de work-type-lijst óók op `useType: 1`. Combineer dus `isActive: true` + `billingCodeType: 0` + `useType: 1`; dat levert exact de bruikbare work types.

---

## Tickets

**Nooit `assignedResourceID` meegeven zonder `assignedResourceRoleID`.** Geeft 500 error.
- Why: `assignedResourceID` werd automatisch ingevuld vanuit SSO-profiel en veroorzaakte validatiefout.
- How to apply: Gebruik `ImpersonationResourceId` header voor creator-attribuering, zet `assignedResourceID` niet in de ticket POST payload.

**Work type op een ticket heet `billingCodeID`, niet `workType`.** Het Ticket entity heeft een `billingCodeID`-veld; zet het op de ticket body om de "Work Type" in de ticketkop te vullen (geverifieerd: blijft staan). `workType` als veldnaam doet niets.
- How to apply: zet de gekozen work type op BEIDE — de ticket body (`billingCodeID`) én de TimeEntry (`billingCodeID`).

**Priority-picklist in zone 19 is custom — er is GEEN value 3.** `priority: 3` geeft 500 "Picklist value [3] does not exist for priority". De value-IDs matchen niet met de labels: 1=Prio 2, 2=Prio 3, 4=Prio 1, 5=Spoed. Haal de echte waarden op via `GET /Tickets/entityInformation/fields` en map portal-prioriteit expliciet.

**`queueID` wordt verplicht zodra `ticketCategory` = Incident (113).** Bij de default category "Standard" (3) is queueID niet nodig; bij Incident geeft een ontbrekende queueID 500 "queueID is required". Autotask maakt velden dynamisch verplicht op basis van ticketCategory.

**`POST /Tickets/{id}/Attachments` vereist `attachmentType`, `publish`, `title` en `fullPath`.** Zet `attachmentType: "FILE_ATTACHMENT"`, `publish: 1` (All Autotask Users), `data` = base64. Het top-level `/AttachmentInfo` met `attachedObjectType`/`attachedObjectID` werkt NIET — die velden bestaan niet.

**Ticket-bijlagen ophalen = `GET /Tickets/{id}/Attachments` (nested GET, 200).** De top-level `POST /AttachmentInfo/query` met `attachedObjectID`/`attachedObjectType` geeft 500 "Unable to find attachedObjectID in the AttachmentInfo Entity" — die velden bestaan niet; de echte koppelvelden zijn `parentID`/`ticketID`/`parentType`. Nested `/query` (`POST /Tickets/{id}/Attachments/query`) geeft 404 — nested ondersteunt alleen GET.
- Wil je wél `AttachmentInfo/query` gebruiken, dan is de werkende combinatie voor klant-zichtbare ticketbijlagen: `ticketID` eq + `parentType` eq 4 ("Task Or Ticket") + `publish` eq 1. Zonder `parentType` komen ook time-entry- (18) en notitiebijlagen (23) mee; zonder `publish` komen interne bijlagen mee (op JUICT-tickets stond 18 van 121 op `publish` 2).
- `AttachmentInfo.publish`: 1 All Autotask Users, 2 Internal Users Only, 4 Internal & Co-Managed. Het datumveld heet **`attachDate`**, er is géén `createDate` — een mapping op `createDate` levert stil `undefined`.

**De bestandsinhoud van een bijlage komt WEL via REST, maar alleen via de geneste single-GET.** Geverifieerd zone 19 op 05-08-2026: `GET /Tickets/{ticketId}/Attachments/{attachmentId}` levert `data` als base64 (50.606 bytes → 67.476 tekens, byte-voor-byte identiek aan de upload). `GET /AttachmentInfo/{id}` geeft géén `data`, ook niet met `?includeData=true`, en de geneste lijst-GET zonder id geeft `data: null`. SOAP of een sync is dus niet nodig.
- How to apply: dit endpoint antwoordt met een **collectie** (`{ items, pageDetails }`), niet met `{ item }` — ook bij één id. Lees `items[0]`; wie `.item` uitleest krijgt `undefined` en concludeert onterecht dat er geen data is. Het `ticketId` in het pad dwingt bovendien af dat de bijlage bij dát ticket hoort, wat een gratis tweede laag is naast je eigen eigendomscheck.

**`PATCH /Tickets` bevestigt soms een statuswijziging die niet landt.** Twee keer los van elkaar vastgesteld in zone 19 op 05-08-2026: de PATCH gaf 200 met `itemId`, maar het ticket bleef op de oude status staan (na `status: 5` bleef het op 19 met `completedDate` null; na `status: 19` bleef het op 1). Dezelfde PATCH kort daarna werkte wél. Vermoedelijke oorzaak: workflow rules die vanuit een net toegevoegde notitie of bijlage in de wachtrij staan en de status terugzetten.
- How to apply: lees na élke statuswijziging die ergens op vertrouwt (een klant die "gesloten" te zien krijgt, een engineer die een signaal moet krijgen) de status terug met `cache: "no-store"`, herkans één keer na ~1,5 s, en meld daarna eerlijk dat het niet gelukt is. Een 200 op deze PATCH is geen bewijs.

**Tickets kunnen niet via `DELETE /Tickets/{id}` verwijderd worden — geeft 405.** Opruimen kan alleen door te sluiten: `PATCH /Tickets` met `status: 5` (Complete), of handmatig in de UI.

**Bij het afronden van een ticket hoort een `resolution` én een check op service calls.** `PATCH /Tickets` met `{ id, status: 5, resolution }` werkt ook op een change-ticket met `changeApprovalStatus` gezet. Service calls hangen als losse entity aan het ticket, dus controleer expliciet of ze dicht staan.
- How to apply: `POST /ServiceCallTickets/query` op `ticketID`, dan per `serviceCallID` een `GET /ServiceCalls/{id}` en kijk naar `status` (2 = Complete). Een vaak herplande change heeft er meerdere; meld de stand voordat je zegt dat het ticket dicht is.

**Zet altijd `ticketType` én `ticketCategory` bij het aanmaken van een ticket.** JUICT-conventie (zone 19): een change krijgt `ticketType: 4` (Change Request) met `ticketCategory: 117` (Minor Change) of `119` (Major Change); een incident `ticketType: 2` met `ticketCategory: 113`. De categorie bepaalt welke velden verplicht worden (zie de queueID-les hierboven) — laat je ze weg dan valt het ticket op "Standard" en klopt de layout in de UI niet. Volledige categorie-picklist zone 19: 2 Datto RMM Alert, 3 Standard, 4 Datto Alert, 5 RMA, 6 Datto Networking Alert, 112 Standard Change, 113 Incident, 115 Problem, 117 Minor Change, 119 Major Change, 121 SaaS Alerts.

**Ticket-descriptions volgen een vaste template per type** (JUICT-conventie, patroon uit xelion-transcriptie `src/lib/openai.ts`). Change:

```
Wat betreft de change?
• [antwoord]

Bij hoeveel gebruikers is de change van toepassing?
• [antwoord]

Hoe hoog is de impact van de change?
• [antwoord]

Aandachtspunten van change?
• [antwoord]
```

Incident:

```
Wat is het incident?
• [antwoord]

Hoeveel gebruikers worden getroffen?
• [antwoord]

Wat is de impact?
• [antwoord]

Troubleshooting stappen / aandachtspunten?
• [antwoord]
```

---

## Impersonation

Twee vereisten voor `ImpersonationResourceId` header:
1. **Autotask Admin** → Web Services API security level → "Add" aanvinken per entity (Ticket Notes, Tickets, Attachments)
2. **API call** → header `ImpersonationResourceId: {resourceId}` meegeven

Why: Eerste poging gaf 500 "does not have adequate permissions" omdat de API security level geen Add-rechten had.

**Zet de `ImpersonationResourceId`-header NOOIT op query/GET-endpoints.** Op `*/query` geeft de header "The logged in Resource does not have the adequate permissions to query this entity type." Gebruik twee header-sets: één zonder impersonatie voor lezen, één mét voor creates (POST Tickets/Notes).

**Impersonatie is per entity — `POST /TimeEntries` kan falen terwijl `POST /Tickets` slaagt.** Zonder "Add" voor TimeEntries geeft de header 500 "does not have adequate permissions to create this entity", ook al werkt impersonatie op Tickets. Workaround: laat de `ImpersonationResourceId`-header weg bij `/TimeEntries` — `resourceID` in de body wijst de tijd al toe aan de medewerker.

---

## Authenticatie / .env

**Speciale tekens (`$`, `#`) in AUTOTASK_SECRET breken de Next.js dotenv parser (`@next/env`).**

`@next/env` expandt `$xyz` als variabele, ook in single-quoted waarden. `SECRET='abc$def'` → wordt `abc` (rest verdwijnt). `#` buiten quotes = commentaar.

Correcte aanpak in `.env`:
```
AUTOTASK_SECRET='abc\$def'   # \$ = literal dollarteken
AUTOTASK_SECRET='abc#def'    # # binnen single quotes = literal hekje
```

- Escape elke `$` als `\$` in de waarde
- Gebruik single quotes om `#` als literal te behandelen
- Beter: gebruik `AUTOTASK_API_KEY_B64` (base64-encoded secret) — omzeilt dotenv volledig
- Beste langetermijnoplossing: kies API-wachtwoorden zonder `$` en `#`
- Productie: secrets via Azure Key Vault — daar speelt dit niet

**Diagnose:** voeg `secretLength` toe aan de debug response. Als die korter is dan verwacht, is er een parse-probleem.

**Debugchecklist bij Autotask API-fouten (in volgorde):**
1. `.env` speciale tekens correct ge-escaped? (of `AUTOTASK_API_KEY_B64` gebruiken)
2. Account geblokkeerd? (vraag gebruiker te verifiëren)
3. Endpoint pad correct / bestaat het?
4. Vereiste scopes/permissies aanwezig?

**Plotselinge 401/S2S17001 bij het ophalen van Key Vault-secrets via `az`: check `az account show`.** Een andere sessie kan de default subscription naar een klanttenant hebben gezet, waardoor de JUICT-vault onbereikbaar is en de Autotask-headers leeg blijven. Fix: `az account set --subscription JUICTAzure`.

---

## Rate limiting

- Autotask thread-limiet = 3. Houd marge: gebruik een semafoor van max 2 gelijktijdige calls (zie `scripts/autotask-client.ts`).
- Gebruik exponential backoff: `Math.pow(2, attempt) * 500` ms, max 3 pogingen
- Retry op 429 en 5xx, NIET op 4xx (client errors)
- Fetch resources altijd sequentieel (for-loop), NOOIT parallel met `Promise.all`

**Een `UND_ERR_CONNECT_TIMEOUT` op de eerste call is meestal geen storing.** Node/undici hanteert 10s connect-timeout; een koude DNS/TLS-handshake naar `webservices19.autotask.net` duurde vanaf een werkplek 11,4s en faalde, waarna dezelfde verbinding 0,2s nam. Draai de call gewoon opnieuw voordat je aan credentials of firewalls gaat sleutelen — een `curl -sI` op de base-URL is de snelste bevestiging.

---

## Data-inconsistenties in API-responses

**`Resources` heeft geen `departmentID` in zone 19, en `title` is vrije tekst.** Wie een medewerker aan een team of supportlijn wil koppelen, kan dat niet op de resource doen: `title` heeft geen picklist (waarden als "Support Engineer", "System Engineer" zonder lijnaanduiding) en een afdelingsveld ontbreekt. Gebruik de **ticket-queue** als as, niet de resource.

**Filteren op `ticketType` vangt niet al het machineverkeer.** In zone 19 stonden 214 tickets met `source` 16 (SaaS Alerts) geregistreerd als `ticketType` 2 (Incident). Wil je alerts uitsluiten, filter dan op `ticketType === 5` **of** `source` in {8 Monitoring Alert, 15 Datto RMM, 16 SaaS Alerts}.

**`showOnInvoice` en `isNonBillable` op TimeEntries zijn in zone 19 constant en dus waardeloos als filter.** Steekproef van alle 595 time entries op de 277 JUICT-tickets (05-08-2026): `showOnInvoice` was `false` op 595/595 en `isNonBillable` `true` op 595/595. Wie hierop filtert om "klant mag dit zien" te bepalen, houdt niets over. Het bruikbare onderscheid is het véld: `summaryNotes` is de klant-zichtbare samenvatting, `internalNotes` de interne aantekening (13 entries hadden alléén internalNotes, 75 hadden beide).

**Tasks missen `completedPercentage` en `isCompleted` velden.** Bereken zelf: `estimatedHours - remainingHours`. Gebruik `status === 5` voor completed-check.

**Gantt-volgorde is niet beschikbaar via de API.** Sla handmatig op in `config/autotask-sort.json`.

**Phase `phaseNumber` is een string** (bijv. `"T20260120.0026"`), geen number.

**Query-responses bevatten soms minder velden dan `GET /{id}`-responses.** Controleer altijd of een veld ook aanwezig is bij query-gebruik.

---

## Notes

Notes hebben een `Publish` veld: `1` = zichtbaar voor klant, `2` = intern, `4` = Internal & Co-Managed. Filter bij weergave aan klanten.

**`publish` alléén is niet genoeg om notities aan een klant te tonen — filter óók op `noteType`.** In zone 19 stonden op 470 klant-zichtbare (`publish: 1`) notities van JUICT-tickets 336 RMM-notities (`noteType` 99, titels als "DEVICE SNAPSHOT" en "OPEN ALERTS") en 59 workflow-rule-notities (13 en 91, op naam van "Autotask Administrator", resource-id 4). Filteren op de creator vangt de RMM-dumps niet.
- How to apply: gebruik een allowlist van menselijke communicatie in plaats van een blocklist: `noteType` 1 Task Summary, 2 Task Detail, 3 Task Notes, 18 Client Portal Note, 101 Email Note. Uitsluiten: 13 en 91 (workflow rule), 99 (RMM), 100 (BDR), 15/92/93/94/95 (duplicaat-, forward- en merge-ruis).

**`createdByContactID` op een ticketnotitie is niet schrijfbaar, ondanks `isReadOnly: false` in de metadata.** `GET /TicketNotes/entityInformation/fields` meldt het veld als schrijfbaar, maar `POST /Tickets/{id}/Notes` negeert de waarde: getest met `createdByContactID` én `CreatedByContactID`, beide keren 200 en beide keren bleef het veld `null` terwijl `creatorResourceID` op het API-account werd gezet. Autotask vult dit veld alleen zelf, wanneer een contact de notitie via zijn eigen clientportaal plaatst.
- How to apply: wil je vastleggen wie een notitie schreef, zet het in de **titel** met een marker die een mens niet per ongeluk typt (bv. `Reactie van {naam} (via klantportaal)`) en lees die bij weergave terug. Strip de marker uit de naam vóór je hem in de titel zet, anders kan een naam die de marker zelf bevat de terugleesregex misleiden.

**Vertrouw het `publish`-label uit de metadata NIET.** `GET /TicketNotes/entityInformation/fields` noemt `1 = All Autotask Users`, maar in zone 19 rendert `publish: 1` als een EXTERNE, klant-zichtbare note — gebruik `2` voor intern (leidend blijft: 1 = klant, 2 = intern). Een per ongeluk externe note corrigeer je met `PATCH /Tickets/{id}/Notes` en body `{ id, noteType, publish: 2 }` (DELETE geeft 405).

**Een ticketnotitie hoort ALTIJD op een TimeEntry, nooit als losse Ticket Note.** Elke `POST /TimeEntries` krijgt zowel `summaryNotes` (klant-zichtbare samenvatting) als `internalNotes` (interne notitie voor engineers, CATA-vorm) — zo staan notitie en bestede tijd altijd samen. Losse Ticket Notes alleen voor communicatie zonder bestede tijd (patroon uit xelion-transcriptie, `src/lib/autotask.ts`).

**Notes zonder impersonatie komen op naam van de API-user te staan.** Stuur bij het plaatsen van notes ALTIJD beide mee: de `ImpersonationResourceId`-header én `creatorResourceID` in de payload. Corrigeren achteraf: DELETE op een note geeft 405; `PATCH /Tickets/{id}/Notes` werkt wél, maar alleen met `noteType` en `publish` in de body (anders 500).

**Ticketnotities schrijf je altijd als CATA: Concrete Aanzet Tot Actie.** Geen samenvatting achteraf, maar een actiegerichte notitie: korte context (1-2 zinnen), daarna genummerde concrete acties met wie, wat en wanneer. Afgeronde punten benoem je expliciet als afgerond ("niets meer mee doen") zodat een collega het ticket direct kan oppakken zonder de historie te lezen. Geldt voor interne notities (publish 2) én klant-zichtbare notities (publish 1, in de taal van de klant).

**Autotask (zone 19) rendert geen HTML via de API — niet in `description` en niet in Ticket Notes.** Losse tags (`<strong>`, `<ul><li>`) worden als platte tekst getoond; de API bewaart ze wel maar de UI rendert ze niet. Opmaak die je handmatig in de rich-text-editor typt is een ander mechanisme en is niet via de API te reproduceren. Gebruik voor API-aangemaakte tekst dus platte tekst (vraag op eigen regel, antwoord eronder, witregel tussen blokken).
