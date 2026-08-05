# Autotask API Reference

Complete referentie voor de Autotask REST API: auth, base URL, endpoints, env vars, data structures en response-formaten — gebruikt in alle JUICT-projecten.

## Base URL

```
https://webservices{ZONE}.autotask.net/ATServicesRest/V1.0
```

Zone 19 = JUICT productie. Zone 24 = soms gebruikt als default fallback.

## Authenticatie headers

Elke request vereist deze headers:

```typescript
{
  "UserName": process.env.AUTOTASK_USERNAME,         // Email van de API-gebruiker
  "Secret": process.env.AUTOTASK_SECRET,             // Wachtwoord / API key
  "ApiIntegrationCode": process.env.AUTOTASK_INTEGRATION_CODE,
  "Content-Type": "application/json",
  "Accept": "application/json",
}
```

Voor creator-attribuering (optioneel):
```typescript
"ImpersonationResourceId": resourceId   // Resource ID van de medewerker die de actie uitvoert
```

Let op: `ImpersonationResourceId` vereist "Add" permissie voor Resource Impersonation per entity in Autotask Admin → Web Services API security level.

## Environment variables (lokaal)

```env
# Verplicht
AUTOTASK_USERNAME=              # Email van API-gebruiker
AUTOTASK_SECRET=                # Wachtwoord/secret (opgelet: speciale tekens breken Next.js dotenv)
AUTOTASK_INTEGRATION_CODE=      # Integratiecode uit Autotask
AUTOTASK_ZONE=19                # Zonenummer (19 = JUICT)

# Aanbevolen voor lokale dev: base64-variant omzeilt dotenv $-interpolatie
AUTOTASK_API_KEY_B64=          # base64(secret) — gebruikt i.p.v. AUTOTASK_SECRET als gezet

# Optioneel maar aanbevolen
AUTOTASK_DEFAULT_RESOURCE_ID=   # Resource ID voor TimeEntries en ticket-aanmaak
AUTOTASK_DEFAULT_ROLE_ID=       # Role ID voor TimeEntries
AUTOTASK_INTERNAL_COMPANY_ID=   # Bedrijfs-ID voor interne projecten
AUTOTASK_UNKNOWN_COMPANY_ID=    # Fallback bedrijf voor onbekende bellers
```

## Key Vault secret-namen (productie)

Key Vault staat geen underscores toe in secret-namen — gebruik streepjes:

| Lokale env var | Key Vault secret-naam |
|---|---|
| `AUTOTASK_USERNAME` | `AUTOTASK-USERNAME` |
| `AUTOTASK_SECRET` / `AUTOTASK_API_KEY` | `AUTOTASK-API-KEY` |
| `AUTOTASK_INTEGRATION_CODE` | `AUTOTASK-INTEGRATION-CODE` |
| `AUTOTASK_ZONE` | `AUTOTASK-ZONE` |

De client gebruikt Key Vault zodra `AZURE_KEYVAULT_URL` gezet is, anders env vars.

## Verified working endpoints

### Tickets
- `GET /Tickets/{id}` — ophalen enkel ticket
- `POST /Tickets` — aanmaken, response: `{ itemId: number }`
- `PATCH /Tickets` — bijwerken status/velden
- `GET /Tickets/query` — zoeken op velden

Actieve status-picklist (zone 19, geverifieerd 31-07-2026): 1 New, 5 Complete, 7 Waiting Customer, 8 In behandeling, 10 Afspraak gepland, 12 Wacht op leverancier, 13 Wacht op planning, 16 Autocomplete (RMM), 17 In de wacht, 19 Klantnotitie toegevoegd, 20 Notitie Toegevoegd (RMM), 21 Wacht op klant, 22 Wachten op goedkeuring, 23 Goedgekeurd, 24 Afgekeurd, 25 Wacht op administratie, 26 Werkzaamheden gepland, 27 Notitie toegevoegd.

Queue-picklist (zone 19, geverifieerd 31-07-2026): `29682833` Eerste lijn support, `29682969` Tweede lijn support, `29683488` Derde lijn support, `29683378` Administratie, `29683482` Verkoop, `29683487` Offboarding, `5` Het JUICT portaal, `6` Post Sale, `8` Monitoring Alert. De support-lijnen zijn de enige betrouwbare as om eerste- van tweedelijnswerk te scheiden — zie de Resources-les in LESSONS.md.

Overige ticket-picklists (zone 19): `ticketType` 1 Service Request, 2 Incident, 3 Problem, 4 Change Request, 5 Alert. `source` -2 Insourced, -1 Client Portal, 2 Telefoon, 4 Email, 8 Monitoring Alert, 11 Mondeling, 13 Herhalend, 14 Intern, 15 Datto RMM, 16 SaaS Alerts. Let op: er is geen waarde "Portal" — een melding uit een eigen klantportaal hoort op `-1`; `8` is Monitoring Alert en vervuilt de alert-rapportage.

Veldlengtes (zone 19, geverifieerd 05-08-2026): `Ticket.title` 255 (verplicht), `Ticket.description` 8000, `Ticket.resolution` 32000, `TicketNote.description` 32000 (verplicht), `TicketNote.title` 250. Autotask kapt te lange waarden stil af — valideer aan je eigen kant.

### Ticket Notes (NESTED — zie LESSONS.md)
- `POST /Tickets/{ticketId}/Notes` — note toevoegen
- `GET /TicketNotes/query` — notes opzoeken
- `noteType`-picklist (zone 19): 1 Task Summary, 2 Task Detail, 3 Task Notes, 13 Workflow Rule Note - Task, 15 Duplicate Ticket Note, 16 Outsource Workflow Note, 17 Surveys, 18 Client Portal Note, 19 Taskfire Note, 91 Workflow Rule Action Note, 92 Forward/Modify Note, 93 Merged Into Ticket, 94 Absorbed Another Ticket, 95 Copied to Project, 99 RMM Note, 100 BDR Note, 101 Email Note
- `publish`: 1 All Autotask Users, 2 Internal Project Team, 4 Internal & Co-Managed

### Ticket Attachments (NESTED — zie LESSONS.md)
- `POST /Tickets/{ticketId}/Attachments` — bijlage toevoegen (`attachmentType`, `publish`, `title`, `fullPath`, `data` base64)
- `GET /Tickets/{ticketId}/Attachments` — metadata van alle bijlagen (`data` is hier null)
- `GET /Tickets/{ticketId}/Attachments/{attachmentId}` — **mét** base64 `data`; antwoordt als collectie (`items[0]`)
- `POST /AttachmentInfo/query` — filter op `ticketID` + `parentType` (4 = Task Or Ticket) + `publish`; datumveld is `attachDate`

### Time Entries
- `POST /TimeEntries` — tijdsregistratie aanmaken

### Service Calls
- `POST /ServiceCallTickets/query` — filter op `ticketID`, geeft per koppeling een `serviceCallID` (een herpland ticket heeft er meerdere)
- `GET /ServiceCalls/{id}` — `startDateTime`, `endDateTime`, `duration`, `status`, `isComplete`
- Status-picklist (zone 19): `1 = New`, `2 = Complete`, `101 = Canceled`, `102 = Canceled by Company`, `103 = Missed`

### Companies
- `GET /Companies/{id}`
- `GET /Companies/query` — filter op `companyName`, `isActive`

### Company To-Dos (NESTED — zie LESSONS.md)
- `POST /Companies/{companyID}/ToDos` — CRM to-do aanmaken (top-level `/CompanyToDos` en `/ToDos` geven 404)
- `GET /Companies/{companyID}/ToDos` en `GET /Companies/{companyID}/ToDos/{id}` — ophalen
- Verplichte velden: `companyID`, `assignedToResourceID`, `actionType`, `startDateTime`, `endDateTime`. Optioneel o.a. `activityDescription`, `ticketID` (koppelt de to-do aan een ticket), `creatorResourceID`.
- `actionType` is een picklist; zone 19 heeft o.a. `29682841 = Administratie` (handig voor facturatie-to-do's), naast standaardwaarden als `3 = Algemeen` en `1 = Telefoongesprek`.

### Contacts
- `GET /Contacts/{id}`
- `GET /Contacts/query` — filter op `firstName`, `lastName`, `phone`, `mobilePhone`, `companyID`, `isActive`
- `PATCH /Contacts/{id}`

### Resources
- `GET /Resources/query` — filter op `email` (het primaire e-mailveld). Let op: Resources gebruikt `email`, NIET `emailAddress` zoals Contacts — geverifieerd in zone 19.
- Filter op `isActive: true` voor actieve medewerkers. Let op: de lijst bevat ook API-integratieaccounts (Claude API, Rewst API, Xelion API, enz.). Die hebben `licenseType` 7 (API User); echte collega's hebben 1 of 3. Voor een "Toewijzen aan collega"-dropdown filter je ze weg met `{ field: "licenseType", op: "noteq", value: 7 }`.
- Beschikbare velden (zone 19): o.a. `email`, `firstName`, `lastName`, `title`, `resourceType`, `licenseType`, `locationID`, `defaultServiceDeskRoleID`, `hireDate`, `payrollType`. Er is **geen** `departmentID`.

### SLA-resultaten per ticket
- `POST /ServiceLevelAgreementResults/query` — filter op `ticketID` (`op: "in"` met een array werkt, chunk op ~200 ids). **Dit is de enige bron voor SLA-klokuren.**
- Velden: `firstResponseElapsedHours`, `resolutionElapsedHours`, `resolutionPlanElapsedHours`, `isFirstResponseMet`, `isResolutionMet`, `isResolutionPlanMet`, `serviceLevelAgreementName`, `ticketID` en drie resource-ids.
- De verstreken uren lopen op een **gepauzeerde kantoorurenklok**: Autotask verrekent business hours én wachtstatussen zelf. Voorbeeld zone 19: een ticket met 141,84 u wall-clock kwam uit op 33,84 u — exact 108 u aan nachten en weekend eruit. De kalender is ma–vr 08:00–17:00 (narekening klopt op 0,01 u).
- Autotask start de resolutieklok bij **ticketcreatie**; wil je de tijd ná de eerste reactie, trek dan af: `resolutionElapsedHours − firstResponseElapsedHours`.
- `GET /ServiceLevelAgreements/...` bestaat NIET (404). De SLA-definitie (toegestane doorlooptijd) is via REST niet op te halen.

### Contracts & Services
- `GET /Contracts/query` — filter op `companyID`, `status`
- `GET /ContractServices/query` — filter op `contractID`
- `GET /Services/query`

### Billing Codes / Work Types
- `GET /BillingCodes/query` — filter op `isActive` (NIET `active`) en `billingCodeType`. Work types (labor) = `billingCodeType` 0.
- Voor een Work Type-dropdown: filter óók op `useType` 1 (general allocation codes) — alleen die zijn geldig als `billingCodeID`. `billingCodeType: 0` alléén bevat ook material/contract-codes die 500 geven.

### Projects
- `POST /Projects` — aanmaken project
- `GET /Projects/{id}/Phases` — fases ophalen (NIET `/ProjectPhases/query` — bestaat niet in zone 19)

### Metadata / picklists
- `GET /Tickets/entityInformation/fields` — picklist-waarden voor status, priority, issueType, subIssueType, etc.

Response-structuur (geverifieerd zone 19): top-level `{ fields: [...] }`, elk veld met `name` + `picklistValues`. Let op: `value` is een **string**, niet een number — cast naar `Number()` voordat je tegen een numeriek ticketveld (`status`, `priority`) mapt.

```json
{ "fields": [
  { "name": "status", "isPickList": true, "picklistValues": [
    { "value": "1", "label": "New", "isActive": true, "sortOrder": 1, "parentValue": "", "isSystem": true }
  ]}
]}
```

## Response-formaten

| Situatie | Response structuur |
|---|---|
| Enkele resource ophalen | `{ item: { ...velden } }` |
| Resource aanmaken | `{ itemId: number }` |
| Query (meerdere) | `{ items: [...] }` |

Query-responses bevatten soms minder velden dan `GET /{entity}/{id}`. Controleer altijd of een veld ook aanwezig is in query-context.

## Filters

De REST API gebruikt POST met een `filter`-array op `*/query` endpoints. Wikkel meerdere condities altijd in een `and`-wrapper:

```json
{ "filter": [{ "op": "and", "items": [
  { "field": "isActive", "op": "eq", "value": true },
  { "field": "companyID", "op": "eq", "value": 123 }
]}], "maxRecords": 500 }
```

Een platte array gedroeg zich in zone 19 óók als AND (geverifieerd op negen endpoints, 05-08-2026), maar leun daar niet op — zie de filter-les in LESSONS.md.

Beperk de respons met `includeFields` naast `filter`; geverifieerd op `/TimeEntries/query` dat de respons dan alleen de opgegeven velden bevat. Handig om gevoelige velden (zoals `internalNotes`) niet eens op te halen.

Paginatie via `pageDetails.nextPageUrl` in de response — blijf volgen tot `null`. **Die URL wil een POST met dezelfde body**; een GET geeft 405 "The requested resource does not support http method 'GET'". Pagina 2 sluit exact aan op pagina 1 zonder overlap.

## Data structures (TypeScript)

```typescript
interface AutotaskTicket {
  id: number;
  ticketNumber?: string;       // bijv. "T20260407.0037"
  title: string;
  description?: string;
  status: number;              // 1=New, 5=Complete
  priority: number;            // ZONE 19: custom picklist — 1=Prio 2, 2=Prio 3, 4=Prio 1, 5=Spoed. GEEN waarde 3! De generieke 1=Critical/2=High/3=Normal/4=Low geldt NIET.
  companyID: number;
  contactID?: number;
  source?: number;             // ZONE 19: -1=Client Portal, 2=Telefoon, 4=Email, 8=Monitoring Alert, 15=Datto RMM, 16=SaaS Alerts (volledige lijst hierboven)
  issueType?: number;
  subIssueType?: number;
  ticketType?: number;
  ticketCategory?: number;
  queueID?: number;
  billingCodeID?: number;      // work type op het ticket (zelfde codes als TimeEntry.billingCodeID)
  assignedResourceID?: number;
  assignedResourceRoleID?: number;  // ALTIJD meegeven als assignedResourceID aanwezig is
  estimatedHours?: number;
  dueDateTime?: string;        // ISO-formaat
  lastActivityDate?: string;   // ISO-formaat — handig om "mijn tickets" op te sorteren
}

interface AutotaskContact {
  id: number;
  firstName: string;
  middleName?: string;
  lastName: string;
  emailAddress?: string;
  phone?: string;
  mobilePhone?: string;
  companyID: number;
  isActive: boolean;
}

interface AutotaskCompany {
  id: number;
  companyName: string;
  phone?: string;
  address1?: string;
  city?: string;
  postalCode?: string;
  isActive?: boolean;
}

// Eén veld uit GET /Tickets/entityInformation/fields. Picklist-waarden zitten genest;
// `value` is een string (cast naar Number voor numerieke ticketvelden).
interface EntityField {
  name: string;       // "status" | "priority" | "issueType" | ...
  isPickList: boolean;
  picklistValues?: Array<{
    value: string;    // STRING, niet number
    label: string;
    isActive: boolean;
    parentValue?: string;  // voor hiërarchische velden zoals subIssueType
  }>;
}
```

## Retry-patroon (best practice)

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  if (attempt > 0) await sleep(Math.pow(2, attempt) * 500); // 500ms, 1s, 2s
  const res = await fetch(...);
  if (res.status === 429 || res.status >= 500) continue;  // retry
  if (!res.ok) throw new Error(`...`);                    // 4xx: niet retrien
  return await res.json();
}
```

Fetch resources altijd **sequentieel** (for-loop), niet parallel met `Promise.all` — Autotask rate-limt agressief.

## Picklist-caching

Haal metadata (picklists) maximaal één keer per dag op via een cron-endpoint. Sla op in database (bijv. `PicklistCache` Prisma-model). Gebruik hardcoded fallbacks voor status/priority als de API faalt.
