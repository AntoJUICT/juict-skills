---
name: smart-numbers
description: Vult de maandelijkse TruPeer SMART Numbers (TruMethods) voor JUICT in. Rekent seats, agreements, reactieve tickets en uren, omzet (NRR, MRR, ORR, product, misc), MRR-mutaties en churn uit Autotask, haalt de FTE per rol uit het intranet, vraagt salesactiviteit en kosten uit, en levert een tabel in de volgorde van het TruPeer-formulier (items 1-52). Gebruik wanneer iemand /smart-numbers typt, de SMART Numbers van een maand wil invullen of terugrekenen, of vraagt om de maandcijfers voor TruPeer of de SMART Numbers-meeting. Vereist de directie-vault en de intranet-MCP (juict-intranet).
---

# SMART Numbers (TruPeer)

Elke maand vult JUICT in de TruPeer-portal de SMART Numbers in (items 1-52). Deze skill rekent uit wat uit Autotask komt, vraagt de rest uit en levert een tabel om over te nemen.

## Wat waar staat

Deze skill staat in een publieke repo. Alles wat JUICT-specifiek of gevoelig is staat in de **directie-vault**, map `financien/smart-numbers/`:

| Bestand | Inhoud |
|---|---|
| `besluiten.md` | Alle definities en keuzes per item. **Leidend: lees dit eerst en volg het letterlijk.** |
| `config.json` | Billing codes, indeling MRR/ORR, inkoopprijzen die van MRR naar ORR schuiven, regels voor losse charges, rolverdeling per medewerker |
| `JJJJ-MM.md` | De uitkomst per maand |

Standaardpad van de vault: `%USERPROFILE%\JUICT-Brain\vault-juict-directie` (Mac: `~/JUICT-Brain/vault-juict-directie`). Een afwijkende config geef je mee met de omgevingsvariabele `SMART_NUMBERS_CONFIG`.

**Geen directie-vault? Stop dan.** Meld dat deze skill alleen werkt voor wie toegang heeft tot de directie-vault, en geef geen cijfers of schattingen. Zet nooit codes, prijzen, personeelsgegevens of uitkomsten in deze repo of in een ander bestand buiten de directie-vault.

## Werkwijze

1. **Vault ophalen** met `git -C <directie-vault> pull --ff-only` en `besluiten.md` lezen.
2. **Maand bepalen.** Standaard de vorige kalendermaand. Een eerdere maand mag (terugwerkende kracht).
3. **Autotask draaien** (duurt ruim een minuut, niet parallel draaien voor meerdere maanden):
   ```
   node "<deze skill>/scripts/bereken.mjs" JJJJ-MM --json
   ```
   Credentials komen via `az` uit `juict-shared-kv`; print ze nooit. Faalt het met 401 of een az-fout, controleer `az login`.
4. **Nalopen wat het script meldt** in `details`:
   - `beoordelen`: regels onder "Losse charge overig" die geen regel matchen. Leg ze voor (NRR, Product Sales, Misc of niet meenemen). Bij een terugkerend patroon een regel toevoegen aan `overigRegels` in `config.json`.
   - `onbekendeBillingCodes`: een billing code die nog nergens is ingedeeld. Vraag waar hij hoort, zet hem in `config.json` en reken opnieuw.
   - `nieuw` en `verloren`: noem de klanten. Vraag bij churn of de opzegging klopt.
   - `controle_urenGeregistreerdTotaal`: is dit flink lager dan de beschikbare technische uren, meld dan dat de reactieve uren waarschijnlijk te laag zijn.
5. **FTE uit het intranet** (items 3-9), via de intranet-MCP (`juict-intranet`):
   - Haal met `medewerkers_zoeken` de actieve medewerkers op en per medewerker het dossier met `medewerker_ophalen` (alleen management mag dat). Dossiers zijn groot; Claude Code slaat het antwoord dan op als bestand. Staat het antwoord inline, schrijf het dan als JSON naar de scratchpad. Lees zelf geen loon of persoonsgegevens uit de dossiers voor.
   - Reken uit met `node "<deze skill>/scripts/fte.mjs" JJJJ-MM <dossierbestanden...>`. Het script gebruikt `werkweek` uit het profiel, de rolverdeling uit `config.json` en de regels uit `besluiten.md` (wie meetelt, eigenaren, afronden op 0,25).
   - Leg `signalen` voor: `zonderRol` (nieuwe medewerker: vraag de rol en zet hem in `rolverdeling`), `afwijkingSalarisregel` (uren in profiel en salarisregel verschillen: laten rechtzetten in het intranet), `nietOpgehaald` (in de rolverdeling maar geen dossier: uit dienst of vergeten).
   - Geen intranet-MCP of geen managementrechten? Vraag de FTE dan uit, met de waarden van de vorige maand als voorstel.
   - Het intranet kent alleen de huidige uren. Reken je een oudere maand terug, controleer dan of er sindsdien iemand van uren of rol is gewisseld.
6. **Uitvragen wat niet uit een systeem komt**, in één bericht, met de waarden van de vorige maand (uit de vorige `JJJJ-MM.md`) als voorstel:
   - Telemarketing Dials, First Time Appointments, Prospects to Hit PBR (items 39-41). Mag uit de agenda van de salesverantwoordelijke worden voorgesteld (Microsoft 365-connector, agenda over de maand), altijd laten bevestigen.
   - **Kosten (items 32-37): voorlopig uitvragen**, met de toelichting per post uit `besluiten.md`. Komt later uit Exact Online via de MCP van het intranet.
   - Minimum MRR (item 45): volgens `besluiten.md`.
7. **Tabel opleveren** in de volgorde hieronder, met per regel de bron. Afronden zoals `besluiten.md` voorschrijft. Daaronder de controlegetallen die de portal zelf uitrekent: RHEM (reactieve uren / seats), AISP (MRR / seats), Total Close % (closed / created), reactieve tickets per seat, en Net Profit als de kosten bekend zijn.
8. **Vastleggen** als `financien/smart-numbers/JJJJ-MM.md` in de directie-vault, met de frontmatter van de vault (`type: analyse`), de tabel, de uitgevraagde waarden en de bijzonderheden. Niet committen zonder te vragen.

## Formuliervolgorde

| # | Item | Bron |
|---|---|---|
| 1 | # of Seats Managed | `general.seatsManaged` |
| 2 | # of Managed Services Agreements | `general.managedServicesAgreements` |
| 3 | # of Employees (FTE) | intranet (`fte.mjs`) |
| 4 | # of Support Desk Employees | intranet (`fte.mjs`) |
| 5 | # of Professional Services Employees | intranet (`fte.mjs`) |
| 6 | # of Alignment Engineers | intranet (`fte.mjs`) |
| 7 | # of Centralized Services Employees | intranet (`fte.mjs`) |
| 8 | # of vCIO Employees | intranet (`fte.mjs`) |
| 9 | # of (Other) Technical Resources | intranet (`fte.mjs`) |
| 11 | # of Reactive Tickets Created | `operations.reactiveTicketsCreated` |
| 12 | # of Reactive Tickets Closed | `operations.reactiveTicketsClosed` |
| 13 | Total Time on Reactive Tickets (hrs) | `operations.totalTimeReactiveHours` |
| 21 | Non-recurring Revenue (NRR) | `revenue.NRR` |
| 22 | Monthly Recurring Revenue (MRR) | `revenue.MRR` |
| 24 | Other Recurring Revenue (ORR) | `revenue.ORR` |
| 25 | Product Sales | `revenue.productSales` |
| 26 | Miscellaneous revenue | `revenue.misc` |
| 32 | Total Employee Expense | opgave (later Exact) |
| 33 | Owners Compensation | opgave (later Exact) |
| 34 | Product COGS | opgave (later Exact) |
| 35 | MRR Tools COGS | opgave (later Exact) |
| 36 | ORR Total COGS | opgave (later Exact) |
| 37 | All Other Expenses | opgave (later Exact) |
| 39 | # of Telemarketing Dials | opgave |
| 40 | # of First Time Appointments (FTA) | opgave |
| 41 | # of Prospects to Hit PBR | opgave |
| 42 | # of New Agreements | `sales.newAgreements` |
| 43 | New Logo MRR | `sales.newLogoMRR` |
| 44 | Current 'Go To Market' Seat Price | `sales.goToMarketSeatPrice` |
| 45 | Minimum MRR | `besluiten.md` |
| 49 | Existing MRR Growth | `mrrChanges.existingGrowth` |
| 50 | Existing MRR Decrease | `mrrChanges.existingDecrease` |
| 51 | Lost MRR (Churn) | `mrrChanges.lostMRR` |
| 52 | Lost MRR # of Agreements (Churn) | `mrrChanges.lostAgreements` |

## Valkuilen

- MRR, ORR, seats en agreements zijn **genormaliseerd**: elke abonnementsregel telt naar rato van de dagen van zijn factuurperiode in de maand, zodat kwartaal- en jaarfacturen en credits geen valse groei of churn geven. NRR, Product Sales en Misc zijn **geboekt** in de maand. Vergelijk ze dus niet één op één met de facturatie of met de boekhouding.
- De factuurperiode komt uit `lineItemFullDescription` (`dd-mm-jjjj - dd-mm-jjjj`). Regels zonder periode tellen alleen mee als verbruik (ORR) op hun boekdatum.
- Paginering van een Autotask-query: de `nextPageUrl` moet met POST en dezelfde body, een GET geeft 405.
- Bij een nieuwe prijsronde de inkoopprijzen in `config.json` bijwerken. Voor terugrekenen van oudere maanden horen de prijzen die toen golden.
- Terugrekenen kan per maand, maar codes die toen nog niet bestonden of anders heetten verschijnen als `onbekendeBillingCodes`. Los die eerst op.
