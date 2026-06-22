# Autotask API — Lessons Learned

Bekende valkuilen, fouten en hard-geleerde lessen bij werken met de Autotask REST API. Voeg nieuwe lessen na elk project toe via `/wrap-up`, onder de juiste categorie.

---

## Endpoints

**`/ProjectTemplates` bestaat niet.** Nooit gebruiken. Ontdekt na mislukte requests.

**`/ProjectPhases/query` geeft 404 in zone 19.** Gebruik `/Projects/{id}/Phases` (GET, niet query).

**Notes en Attachments zijn geneste resources — nooit top-level aanspreken.**
- Gebruik: `POST /Tickets/{id}/Notes` en `POST /Tickets/{id}/Attachments`
- Gebruik NOOIT: `/TicketNotes` of `/TicketNoteAttachments` als top-level endpoint
- Why: Beide gaven 404 in productie. Swagger-verificatie toonde de correcte geneste structuur.
- How to apply: Controleer bij elk nieuw endpoint of het een sub-resource is. Verifieer via `GET /Entity/entityInformation` of test in Swagger voor implementatie.

**Verifieer altijd of een endpoint bestaat voor implementatie.** Test met een GET of check Swagger. Schrijf nooit een Autotask endpoint zonder verificatie als er geen werkend voorbeeld in de codebase staat.

---

## TimeEntries (meest foutgevoelig)

POST /TimeEntries vereist altijd drie velden — ontbrekend = 500 error:

| Veld | Ontbreekt → fout |
|---|---|
| `resourceID` | "Value does not exist for the required field resourceID" |
| `roleID` | "TimeEntries for Tickets must have a roleID" |
| `hoursWorked > 0` | "Must have at least one of hoursWorked or startDateTime/endDateTime" |

Verkeerde resource+role combinatie → "The specified AssignedResourceID and AssignedRoleID combination is not currently defined" (500).

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

**Tickets kunnen niet via `DELETE /Tickets/{id}` verwijderd worden — geeft 405.** Opruimen kan alleen door te sluiten: `PATCH /Tickets` met `status: 5` (Complete), of handmatig in de UI.

---

## Impersonation

Twee vereisten voor `ImpersonationResourceId` header:
1. **Autotask Admin** → Web Services API security level → "Add" aanvinken per entity (Ticket Notes, Tickets, Attachments)
2. **API call** → header `ImpersonationResourceId: {resourceId}` meegeven

Why: Eerste poging gaf 500 "does not have adequate permissions" omdat de API security level geen Add-rechten had.

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

---

## Rate limiting

- Autotask thread-limiet = 3. Houd marge: gebruik een semafoor van max 2 gelijktijdige calls (zie `scripts/autotask-client.ts`).
- Gebruik exponential backoff: `Math.pow(2, attempt) * 500` ms, max 3 pogingen
- Retry op 429 en 5xx, NIET op 4xx (client errors)
- Fetch resources altijd sequentieel (for-loop), NOOIT parallel met `Promise.all`

---

## Data-inconsistenties in API-responses

**Tasks missen `completedPercentage` en `isCompleted` velden.** Bereken zelf: `estimatedHours - remainingHours`. Gebruik `status === 5` voor completed-check.

**Gantt-volgorde is niet beschikbaar via de API.** Sla handmatig op in `config/autotask-sort.json`.

**Phase `phaseNumber` is een string** (bijv. `"T20260120.0026"`), geen number.

**Query-responses bevatten soms minder velden dan `GET /{id}`-responses.** Controleer altijd of een veld ook aanwezig is bij query-gebruik.

---

## Notes

Notes hebben een `Publish` veld: `1` = zichtbaar voor klant, `2` = intern. Filter bij weergave aan klanten.

**Autotask (zone 19) rendert geen HTML via de API — niet in `description` en niet in Ticket Notes.** Losse tags (`<strong>`, `<ul><li>`) worden als platte tekst getoond; de API bewaart ze wel maar de UI rendert ze niet. Opmaak die je handmatig in de rich-text-editor typt is een ander mechanisme en is niet via de API te reproduceren. Gebruik voor API-aangemaakte tekst dus platte tekst (vraag op eigen regel, antwoord eronder, witregel tussen blokken).
