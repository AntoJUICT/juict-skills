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

## Onvolledig overzicht (partial-failure vangnet)

Eén mislukte fetch breekt `summary`/`review` niet meer af. Companies en
Contracts blijven fataal (zonder die twee kan niets aan een klant worden
toegewezen); alle andere ophaalacties (charges, time entries, BillingItems,
tickets, projects, de Remote Support-fetch en de posted-checks) vangen een
fout op en gaan door met de rest. Als er iets is misgelukt, verschijnt
bovenaan de output (bij `summary` op stdout, bij `review` op stderr en in
`ReviewOutput.warnings`) een banner die begint met "LET OP: dit overzicht is
mogelijk ONVOLLEDIG" met daaronder welke ophaalactie(s) faalden. Zie ik die
banner, dan draai ik het commando gewoon opnieuw of check de ontbrekende data
handmatig in Autotask voordat ik het overzicht als volledig behandel.

## Periode als referentie (geen filter) en T&M vs prepaid

`summary` en `review` tonen ALLE nog niet geposte time entries en charges op
afgeronde tickets. Er wordt niets op datum verborgen: een item met een datum
buiten de facturatieperiode blijft gewoon in het overzicht staan, want een
oudere post kan legitiem zijn (bijvoorbeeld een "Buitenbundel mei"-charge die
pas in juli wordt gepost). De periode uit `config.json`
(`periodStart`/`periodEnd`, default vorige maand) dient als referentie: elke
time entry en charge in `review` krijgt een `outsidePeriod`-boolean
(labour op `dateWorked`, charges op `datePurchased` of `createDate` als die
leeg is; een charge zonder beide datumvelden krijgt `outsidePeriod: false`).
Ik gebruik die flag om items ouder dan de periode te markeren als "ouder dan
`<maand>`, controleren of dit klopt", niet om ze te verbergen. Wil je de
referentieperiode veranderen, pas dan `periodStart`/`periodEnd` in
`config.json` aan.

`summary` splitst labour-uren in twee groepen:
- **T&M-uren (te factureren)**: labour op een echt Time & Materials-contract
  (contractType 1). Dit is nieuwe omzet.
- **Prepaid-uren**: labour op Block Hours (4) of Per Ticket (8), al vooraf
  betaald en dus geen nieuwe omzet. Deze staan apart in de tabel als
  `(+Xu prepaid)` en tellen niet mee in de ranking.

De ranglijst in `summary` sorteert op `chargeEUR + T&M-uren * rankHourRate`
(config, default 75), zodat een klant met veel echte T&M-uren niet onterecht
onder een klant met alleen een hoog chargebedrag komt te staan. Pas
`rankHourRate` in `config.json` aan als het effectieve uurtarief afwijkt.

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
   - **Periode-check**: items met `outsidePeriod: true` (datum ouder dan
     `periodStart`) markeer ik als "ouder dan `<maand>`, controleren of dit
     klopt". Dit is een signalering, geen filter: het item stond en blijft
     gewoon in het overzicht.
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

## Remote Support work-type-review (na `summary`)

Remote Support op gedekte (recurring) contracten wordt niet apart
gefactureerd, dus die uren komen niet in de gewone triage-tabel terecht. Het
work type zelf kan alsnog fout gekozen zijn: iemand boekt bijvoorbeeld
Onsite- of projectwerk per ongeluk (of uit gewoonte) als Remote Support. Dat
is een AI-beoordeling, geen script-regel, dus `summary` levert de ruwe data
en ik beoordeel.

- `summary` print naast de triage-tabel ook `remoteSupportReview`: per klant
  het aantal gedekte Remote Support-entries in de periode, de totale uren, en
  per entry de summary-tekst. Dit staat ook in het geretourneerde object onder
  `remoteSupportReview`.
- Ik loop per entry de summary-tekst langs tegen de labour-work-type-lijst:
  Remote Support, Onsite Support, Meerwerk, Project, Projectmanagement, Azure
  consultancy, Minor Change, Major Change, Spoed incident/change, Support
  Buiten Kantooruren 150%/200%.
- **Conservatief flaggen**, alleen bij duidelijke signalen:
  - op locatie/ter plaatse/onsite geweest -> vermoedelijk Onsite Support
  - installatie, migratie, groter traject -> vermoedelijk Project of Meerwerk
  - Azure/cloud-advies of -architectuur -> vermoedelijk Azure consultancy
  - wijziging/change/aanpassing infrastructuur -> vermoedelijk Minor/Major
    Change
  - avond, weekend, buiten kantooruren genoemd -> vermoedelijk Support Buiten
    Kantooruren
  - bij twijfel niet flaggen: liever een gemiste suggestie dan een vals alarm.
- Klanten met geflagde entries zet ik alsnog op de actielijst, met het
  vermoedelijke juiste work type als suggestie erbij. Ik wijzig hier nooit
  automatisch iets: het work type aanpassen is (net als approve & post) iets
  wat Anto zelf in de Autotask UI doet.

## Urennorm-flags per ticket (na `summary` en in `review`)

Veel uren op een ticket op één work type is vaak eigenlijk onsite/project/
meerwerk of verdient anders aandacht: meer dan 1,5u Remote Support of meer
dan 2u Change (Minor Change + Major Change samen) op hetzelfde ticket.

- `summary` print, na de Remote Support-sectie, een extra sectie "Tickets
  boven urennorm:" met per regel de klant, het ticketnummer, de gesommeerde
  uren en het work type dat de drempel overschrijdt. Dit staat ook in het
  geretourneerde object onder `hourFlags`. Deze tickets tonen altijd, ook als
  de klant verder niets te factureren heeft (los van de actionable-filter).
- `review <klant>` zet dezelfde flag op het ticket zelf (`ticket.hourFlags`),
  bijvoorbeeld `"remote 2u > 1.5u"`, zodat hij ook in de per-klant diepe
  review meteen zichtbaar is.
- Beide drempels zijn instelbaar in `config.json`: `remoteSupportHoursThreshold`
  (default 1,5) en `changeHoursThreshold` (default 2).
- Puur signalerend: er wordt niets automatisch gewijzigd of herboekt, net als
  bij de Remote Support work-type-review hierboven.

## Beschikbare commando's

Er zijn drie commando's: `summary` (org-brede triage), `review <klant>`
(per-klant diepe AI-review) en `set-nonbillable <id...> [--dry-run|--confirm]`
(de enige mutatie). Zonder subcommando (of bij een onbekend commando) print
het script alleen een gebruiksregel en doet verder niets; er is geen losse
`verify` of org-brede bulkrapportage meer. Die gebruikten de
approval-timestamp op de bron-entiteit als pending-indicator zonder de
BillingItem-kruisverwijzing en konden daardoor al-gepost werk verkeerd
classificeren, dus zijn ze vervangen door `summary` en `review`, die wel de
betrouwbare BillingItem-check gebruiken.
