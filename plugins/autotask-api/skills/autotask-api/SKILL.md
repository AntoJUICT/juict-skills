---
name: autotask-api
description: Werken met de Autotask REST API in JUICT-projecten — authenticatie via Azure Key Vault (met lokale env-var fallback), base URL/zone, geverifieerde endpoints, env vars, data structures en bekende valkuilen. Gebruik wanneer je Autotask-tickets, time entries, companies, contacts, contracts of projects opvraagt/aanmaakt, een Autotask-client opzet, of een Autotask API-fout debugt.
---

# Autotask REST API (JUICT)

Deze skill bundelt alles wat je nodig hebt om de Autotask REST API te gebruiken in een JUICT-project: authenticatie via Azure Key Vault, de geverifieerde endpoints, en de hard-geleerde valkuilen. Bedoeld om te delen tussen collega's zodat niemand opnieuw het wiel hoeft uit te vinden.

## Vóór je begint

1. Lees **[REFERENCE.md](REFERENCE.md)** — base URL, auth headers, env vars, endpoints, data structures, response-formaten.
2. Lees **[LESSONS.md](LESSONS.md)** — bekende valkuilen (nested endpoints, TimeEntries-velden, dotenv-escaping, rate limiting).
3. Verifieer ALTIJD of een endpoint bestaat vóór implementatie (GET-test of Swagger). Schrijf nooit een Autotask-endpoint zonder werkend voorbeeld — `/ProjectTemplates` en `/ProjectPhases/query` bestaan bijvoorbeeld niet.

## Quick start

Kopieer `scripts/azure-keyvault.ts` en `scripts/autotask-client.ts` naar je project (bijv. `src/lib/`). De client kiest automatisch Key Vault (productie) of env vars (lokaal).

```typescript
import { autotaskFetch, fetchAllAutotask } from "@/lib/autotask-client";

// Enkel ticket ophalen
const { item } = await autotaskFetch<{ item: AutotaskTicket }>("Tickets/12345");

// Gefilterd zoeken (alle pagina's, sequentieel — Autotask rate-limt agressief)
const actieveKlanten = await fetchAllAutotask<AutotaskCompany>("Companies/query", [
  { field: "isActive", op: "eq", value: true },
]);
```

## Authenticatie via Key Vault

De client (`scripts/autotask-client.ts`) schakelt op `AZURE_KEYVAULT_URL`:

- **Productie:** secrets uit Azure Key Vault via `getSecret()` (gecachet 1u). Secret-namen met streepjes:
  `AUTOTASK-USERNAME`, `AUTOTASK-API-KEY`, `AUTOTASK-INTEGRATION-CODE`, `AUTOTASK-ZONE`.
- **Lokaal:** env vars met underscores (`AUTOTASK_USERNAME`, etc.). Zie [REFERENCE.md](REFERENCE.md).

Waarom Key Vault: het Autotask-secret kan `$` en `#` bevatten die de Next.js dotenv-parser kapotmaken. In Key Vault speelt dit niet. Lokaal: gebruik `AUTOTASK_API_KEY_B64` (base64) om dotenv-interpolatie te omzeilen.

`getSecret()` gebruikt `DefaultAzureCredential` — in Azure Container Apps werkt dit via de managed identity die leesrechten op de vault heeft. Geen extra config nodig.

## Debugchecklist bij API-fouten (in volgorde)

1. `.env` speciale tekens (`$`, `#`) correct ge-escaped? (of gebruik `AUTOTASK_API_KEY_B64`)
2. Account geblokkeerd? Vraag de gebruiker dit te verifiëren in Autotask.
3. Endpoint-pad correct en bestaat het? (nested vs top-level — zie LESSONS.md)
4. Vereiste scopes/permissies aanwezig? (o.a. Resource Impersonation per entity)

## Bestanden

- `scripts/azure-keyvault.ts` — `getSecret(naam)` helper met 1u-cache en `DefaultAzureCredential`.
- `scripts/autotask-client.ts` — `autotaskFetch`, `fetchAllAutotask`, `buildFilter`; Key Vault + env fallback, semafoor (max 2 gelijktijdig), AND-filter-wrapper, paginatie.
- `REFERENCE.md` — volledige endpoint- en datareferentie.
- `LESSONS.md` — valkuilen en lessons learned.

## Nieuwe lessen toevoegen

Na een Autotask-project: gebruik `/wrap-up` en voeg nieuwe lessen toe aan `LESSONS.md` onder de juiste categorie. Houd `REFERENCE.md` bij wanneer je een nieuw endpoint geverifieerd hebt.
