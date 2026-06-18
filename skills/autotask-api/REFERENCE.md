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

### Ticket Notes (NESTED — zie LESSONS.md)
- `POST /Tickets/{ticketId}/Notes` — note toevoegen
- `GET /TicketNotes/query` — notes opzoeken

### Time Entries
- `POST /TimeEntries` — tijdsregistratie aanmaken

### Companies
- `GET /Companies/{id}`
- `GET /Companies/query` — filter op `companyName`, `isActive`

### Contacts
- `GET /Contacts/{id}`
- `GET /Contacts/query` — filter op `firstName`, `lastName`, `phone`, `mobilePhone`, `companyID`, `isActive`
- `PATCH /Contacts/{id}`

### Resources
- `GET /Resources/query` — zoek op email

### Contracts & Services
- `GET /Contracts/query` — filter op `companyID`, `status`
- `GET /ContractServices/query` — filter op `contractID`
- `GET /Services/query`

### Billing Codes / Work Types
- `GET /BillingCodes/query` — filter op `isActive` (NIET `active`) en `billingCodeType`. Work types (labor) = `billingCodeType` 0.

### Projects
- `POST /Projects` — aanmaken project
- `GET /Projects/{id}/Phases` — fases ophalen (NIET `/ProjectPhases/query` — bestaat niet in zone 19)

### Metadata / picklists
- `GET /Tickets/entityInformation/fields` — picklist-waarden voor status, priority, issueType, subIssueType, etc.

## Response-formaten

| Situatie | Response structuur |
|---|---|
| Enkele resource ophalen | `{ item: { ...velden } }` |
| Resource aanmaken | `{ itemId: number }` |
| Query (meerdere) | `{ items: [...] }` |

Query-responses bevatten soms minder velden dan `GET /{entity}/{id}`. Controleer altijd of een veld ook aanwezig is in query-context.

## Filters

De REST API gebruikt POST met een `filter`-array op `*/query` endpoints. Meerdere condities moeten in een `and`-wrapper — een platte array wordt als OR geïnterpreteerd:

```json
{ "filter": [{ "op": "and", "items": [
  { "field": "isActive", "op": "eq", "value": true },
  { "field": "companyID", "op": "eq", "value": 123 }
]}], "maxRecords": 500 }
```

Paginatie via `pageDetails.nextPageUrl` in de response — blijf volgen tot `null`.

## Data structures (TypeScript)

```typescript
interface AutotaskTicket {
  id: number;
  ticketNumber?: string;       // bijv. "T20260407.0037"
  title: string;
  description?: string;
  status: number;              // 1=New, 5=Complete
  priority: number;            // 1=Critical, 2=High, 3=Normal, 4=Low
  companyID: number;
  contactID?: number;
  source?: number;             // 8=Portal, telefoon=eigen ID
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

interface PicklistField {
  field: string;    // "status" | "priority" | "issueType" | ...
  id: number;
  name: string;
  parentId?: number;  // Voor hiërarchische velden zoals subIssueType
  isActive: boolean;
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
