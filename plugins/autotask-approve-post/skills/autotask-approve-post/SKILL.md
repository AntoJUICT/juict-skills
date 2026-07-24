---
name: autotask-approve-post
description: Bereidt de maandelijkse Autotask Approve & Post per klant voor. Haalt per klant alle nog niet geposte tickets, time entries en charges op, toont een totaaloverzicht en loopt data-issues en conservatieve AI-checks (ontbrekende charge, work-type-mismatch) langs. Kan op verzoek time entries non-billable zetten, verder blijft alles read-only. Gebruik wanneer Anto /autotask-approve-post typt of vraagt om de maandelijkse billing-review / approve & post-voorbereiding per klant.
---

# Autotask Approve & Post voorbereiding (JUICT)

## Kernbeperking

**Approve & Post zelf kan niet via de API.** Er bestaat geen approve- of
post-endpoint in Autotask. Deze skill vervangt die stap dus niet: ze bereidt
per klant het overzicht voor waarop Anto daarna zelf approvet en post, in de
Autotask UI. De skill mag daarnaast één ding muteren: time entries op
non-billable zetten, en alleen na expliciet akkoord.

## Read-only met een uitzondering

Alle calls zijn `*/query` (dus alleen opvragen), op een uitzondering na:
`PATCH /TimeEntries` met uitsluitend het veld `isNonBillable`, en die PATCH
loopt alleen via `set-nonbillable ... --confirm`. Er wordt geen notitie
gezet, geen impersonatie gebruikt en verder niets in Autotask aangepast. De
actie is omkeerbaar (non-billable kan weer terug). Geposte entries worden
door de Autotask API zelf geweigerd, dus een verkeerde zet op een geposte
entry heeft sowieso geen effect.

## Vereisten

- Ingelogd op Azure CLI (`az login`), secrets komen uit Key Vault `juict-kv-g4fhuo35`.
- Node 18+ (geen npm install nodig).

## Flow

1. **Draai de review voor één klant:**
   `node scripts/preflight.mjs review "<klant>"`
   (of een companyID). Dit is read-only en print een JSON-`ReviewOutput` naar
   stdout plus een eenregelige samenvatting naar stderr. Eén klant per run.
   Levert de klantnaam geen eenduidige match op, dan meldt het script de
   kandidaten op stderr: geef dan het companyID mee in plaats van de naam.

2. **Ik lees de JSON en toon het overzicht per Klant → Ticket.** Bovenaan
   altijd eerst het totaaloverzicht uit `totals`: totale billable uren en
   totaal charge-bedrag, zodat Anto in één oogopslag ziet of de maand hoog
   uitvalt. Daaronder per ticket de time entries en charges.
   - **Labour tonen we in uren**, niet in euro's: het uurtarief zit in het
     contract, niet in de time entry, dus een euro-bedrag op labour zou
     verzonnen zijn.
   - **Euro's tonen we alleen bij charges** (`amountEUR` per charge, en het
     totaal in `totals.chargeAmountEUR`).
   - De totale billable uren in `totals.billableHours` kunnen ook labour
     bevatten die niet aan een getoond ticket hangt (bijvoorbeeld
     projecttaak-uren zonder ticket), dus controleer bij twijfel of het
     totaal en de som van de getoonde tickets overeenkomen.

3. **Ik draai de checks** op wat de review teruggeeft:
   - **Data-issues** uit `issues`/`problems` per item: 0 uur, ontbrekende
     work type of rol, lege summary.
   - **AI-checks** (zie hieronder), conservatief en op basis van
     titel/omschrijving/notities/summary die de review meelevert.
   - **Contract-check** (zie hieronder), op basis van `availableContracts`.

4. **Anto beslist** welke time entries non-billable moeten worden op basis
   van dat overzicht.

5. **Ik voer dat uit in twee stappen:**
   `node scripts/preflight.mjs set-nonbillable <id...> --dry-run`
   Toont de PATCH-payloads zonder iets te wijzigen (dit is ook het gedrag
   zonder vlag). Na akkoord van Anto pas:
   `node scripts/preflight.mjs set-nonbillable <id...> --confirm`
   Dit voert de PATCH's echt uit, één per id.

## AI-check-instructies (conservatief)

Deze checks zijn een suggestie aan Anto, nooit een automatische wijziging.
Bij twijfel niet flaggen: liever een gemiste suggestie dan een vals alarm.

- **Ontbrekende charge:** alleen flaggen bij sterke signalen in de
  omschrijving, titel of notities van het ticket, zoals expliciet genoemde
  aangeschafte of vervangen hardware, een licentie, of een onderdeel/product
  waar in de review geen bijbehorende charge tegenover staat. Een vage
  vermelding ("misschien later een onderdeel nodig") is geen sterk signaal.
- **Work-type-mismatch:** alleen bij een duidelijke discrepantie tussen het
  geboekte work type en wat het ticket of de summary/notitie beschrijft,
  bijvoorbeeld installatie- of projectwerk dat als remote support is
  geboekt. Meld dit altijd als suggestie ("dit lijkt eerder X dan Y, wil je
  dit checken?"), wijzig nooit zelf iets.

## Contract-check (per ticket)

De review levert naast `contractInfo` per item ook `availableContracts` mee:
de volledige actieve contractlijst (id/naam/type) van de klant. Per ticket
vergelijk ik het onderwerp en de omschrijving van het werk met deze lijst,
volgens de vaste mapping:

- Telefonie -> Easyvoice of Teams Phone
- Sim/mobiele data -> Mobiel
- Internet/netwerk -> Connectivity
- Algemene werkplek/support -> Easywork of Managed

Als het werk op een ander contract geboekt staat dan waar het volgens deze
mapping thuishoort, en de klant heeft dat betere contract wel in
`availableContracts`, dan flag ik dat als suggestie om te herboeken. Blijft
de klant zonder het passende contract, dan flag ik niets: er is dan geen
beter alternatief. Belangrijk om hierbij te benoemen: herboeken tussen twee
gedekte (Recurring-)contracten verandert de factuur niet, beide zijn al
gedekt door hun vaste fee. Het gaat puur om de juiste toewijzing per
productlijn, niet om extra of minder factureren.

## Overige commando's (secundair)

- `node scripts/preflight.mjs verify <contractID>` : sanity-check tegen het
  scherm, print het aantal pending ContractCharges en nog-te-approven time
  entries voor één contract. Read-only, handig als losse controle naast de
  klant-review.
- `node scripts/preflight.mjs` (zonder subcommando) : draait de oude
  periode-brede rapportage over alle klanten en schrijft
  `report-<periodStart>_<periodEnd>.md`. Dit is de bulk-variant van vóór de
  per-klant flow en blijft beschikbaar, maar de klant-voor-klant `review` +
  `set-nonbillable`-flow hierboven is de manier waarop we deze skill nu
  gebruiken.
