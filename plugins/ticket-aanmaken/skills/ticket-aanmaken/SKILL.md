---
name: ticket-aanmaken
description: Maakt een Autotask-supportticket aan vanuit een vrije-tekstomschrijving. Claude leidt de velden af (klant opzoeken, prioriteit/status/queue/work type), stelt een compleet ticketvoorstel op, toont dat ter goedkeuring, en maakt het ticket pas na expliciet akkoord aan. Standalone (Key Vault via az). Gebruik wanneer Anto /ticket-aanmaken typt of vraagt om een ticket in Autotask aan te maken/in te schieten.
---

# Autotask-ticket aanmaken (JUICT)

Deze skill maakt een supportticket aan via de dunne CLI `scripts/at-ticket.mjs`.
Claude doet de redenering; het script doet het API-werk. Aanmaken gebeurt NOOIT
zonder expliciet akkoord van Anto.

## Vereisten

- Ingelogd op Azure CLI (`az login`) — secrets komen uit Key Vault `juict-kv-g4fhuo35`.
- Node 18+ (geen npm install nodig).

## Flow

1. **Lees de melding** die Anto in vrije taal geeft (klant, probleem, evt. prioriteit/toewijzing).
2. **Zoek de klant op:**
   `node scripts/at-ticket.mjs lookup-company "<naam>"`
   - Meerdere matches → vraag welke. Geen match → stop en vraag door (nooit gokken, geen fallback-bedrijf).
3. **Haal picklists op:**
   `node scripts/at-ticket.mjs picklists`
   - Gebruik de LIVE waarden voor `status`, `priority`, `queueID`, `ticketCategory`, `billingCodeID` (work type).
   - `ticketCategory`: zet ALTIJD expliciet mee — anders valt Autotask terug op de default
     `3=Standard`. Voor een gewoon support-ticket is `113=Incident` de juiste keuze.
4. **Bepaal de toewijzing** (default Anto). Zoek diens resource + rol:
   `node scripts/at-ticket.mjs resources "anto"`
   - Elke resource komt terug met `roleID`, `roleIDs` en `queueRoles` ([{queueID, roleID}]).
   - Kies `assignedResourceRoleID` zó: neem de `roleID` uit `queueRoles` die matcht met de
     gekozen `queueID` van het ticket. De rol is queue-afhankelijk — pak dus niet zomaar
     de eerste. Als `roleID` (eenduidig) gevuld is, mag je die gebruiken. Als er meerdere
     rollen zijn én geen enkele matcht met de queue, vraag welke rol.
   - Neem `assignedResourceID` én de gekozen `assignedResourceRoleID` samen mee.
5. **Stel het voorstel samen** en toon het als leesbaar overzicht:
   titel, omschrijving, klant (naam + id), status (default New), prioriteit,
   queue, ticketCategory, work type, toegewezen aan. Vraag om akkoord. Anto kan elk veld wijzigen.
6. **Optioneel eerst dry-run** om de payload te tonen:
   `node scripts/at-ticket.mjs create '<json>' --dry-run`
7. **Na expliciet akkoord** — maak aan, ALTIJD met impersonatie zodat het ticket op naam
   van de opererende medewerker komt (niet het API-account):
   `node scripts/at-ticket.mjs create '<json>' --impersonate <acting-resourceID>`
   - `<acting-resourceID>` = de resource-id van wie het ticket aanmaakt (default Anto,
     29682885). Zonder `--impersonate` staat de creator op het Claude-API-integratieaccount.
   Geef het `ticketNumber` en de id terug. Bouw evt. de portal-link.

## Ticket-JSON

Velden voor `create` (verplicht: `title`, `companyID`, `status`, `priority`):

    {
      "title": "...",
      "description": "...",
      "companyID": 123,
      "status": 1,
      "priority": 2,
      "queueID": 5,
      "ticketCategory": 113,
      "billingCodeID": 29682885,
      "assignedResourceID": 29682902,
      "assignedResourceRoleID": 29682846
    }

Impersonatie is GEEN ticket-veld maar een header — geef die als CLI-flag mee
(`--impersonate <resourceID>`), niet in de JSON.

## Regels & valkuilen

- **Nooit aanmaken zonder expliciet akkoord.** Alle stappen tot 6 zijn read-only.
- **Zone-19 prioriteit is custom:** 1=Prio 2, 2=Prio 3, 4=Prio 1, 5=Spoed. GEEN waarde 3.
  De generieke mapping (Critical/High/Normal/Low) geldt NIET. Gebruik altijd de live picklist.
- **`assignedResourceRoleID` altijd** meegeven zodra `assignedResourceID` gezet is
  (het script weigert anders).
- **Status** default op de "New"-waarde uit de picklist.
- **ticketCategory** ALTIJD expliciet zetten (`113=Incident` voor support). Zonder waarde
  valt Autotask terug op `3=Standard`.
- **Impersonatie**: maak ALTIJD aan met `--impersonate <acting-resourceID>`, anders staat de
  creator op het API-account (Claude API) i.p.v. de medewerker. Vereist "Add" op Resource
  Impersonation (Tickets) in de Autotask API-security-level; faalt de create daarop, meld het.
- **Work type**: alleen codes uit `picklists.workType` (billingCodeType 0 + useType 1).
- **401 bij een call:** verkeerde header-case of API-user gelockt — herhaal niet blind
  (herhaalde 401's locken de user). Meld het en laat Anto de API-user checken.
- **Secrets nooit printen of loggen.**

## Nieuwe lessen

Duikt er een nieuwe Autotask-valkuil op (endpoint bestaat niet, veldnaam anders,
picklist-verschuiving)? Stel voor om de `autotask-api` skill bij te werken via
`/autotask-api-update`.
