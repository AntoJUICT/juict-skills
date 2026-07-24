---
name: autotask-approve-post
description: Read-only pre-flight review vóór de maandelijkse Autotask Approve & Post, vindt nog-niet-geposte ContractCharges/TicketCharges/ProjectCharges en niet-approved TimeEntries, markeert problemen per item en groepeert per klant/contract/ticket. Gebruik wanneer Anto /autotask-approve-post typt of vraagt om de maandelijkse approve & post-review te doen.
---

# Autotask Approve & Post pre-flight (JUICT)

**Approve & Post zelf kan niet via de API.** `BillingItem` heeft `canCreate: false`
en er bestaat geen approve- of post-endpoint. Deze skill vervangt die stap dus niet:
hij doet uitsluitend de read-only controle vooraf. Anto approvet en post daarna zelf
in de Autotask UI, per klant/contract, op basis van het rapport dat deze skill maakt.

## Vereisten

- Ingelogd op Azure CLI (`az login`), secrets komen uit Key Vault `juict-kv-g4fhuo35`.
- Node 18+ (geen npm install nodig).

## Flow

1. **Optioneel `config.json`** in de werkmap voor periode/regels/never-bill codes
   (zie hieronder). Zonder config: vorige kalendermaand, alle regels aan.
2. **Sanity-check tegen het scherm** voor één contract:
   `node scripts/preflight.mjs verify <contractID>`
   Print het aantal pending ContractCharges en nog-te-approven time entries voor dat
   contract. Vergelijk dit met wat het Approve & Post-scherm in Autotask toont voordat
   je het volledige rapport vertrouwt.
3. **Draai de volledige periode:**
   `node scripts/preflight.mjs`
   Schrijft `report-<periodStart>_<periodEnd>.md` in de werkmap met alle pending
   labour en charges, gegroepeerd en met problemen gemarkeerd.
4. **Claude leest het rapport en loopt het door**, per Klant → Contract → Ticket:
   - Noem eerst de **⚠️ EERST FIXEN**-items per groep, met de concrete fix
     (bijv. "TimeEntry 12345, 0u te factureren: hoursToBill zetten of op
     non-billable markeren").
   - Noem daarna de **✅ SCHOON**-totalen per groep, zodat Anto weet welke
     klant/contract/ticket hij direct kan posten in de UI.
   - Werk het rapport groep voor groep af, niet als platte lijst: Anto post per
     contract/ticket, niet in één keer voor de hele maand.

## config.json (optioneel)

```json
{
  "periodStart": "2026-06-01",
  "periodEnd": "2026-06-30",
  "enabledRules": ["labour.missingWorkType", "labour.zeroHours"],
  "minChargeAmount": 0,
  "neverBillBillingCodeIDs": [12345]
}
```

- `periodStart` / `periodEnd`: default = vorige kalendermaand.
- `enabledRules`: default = alle regels (zie hieronder). Beperk als je een deel van
  de controle tijdelijk wilt uitzetten. Let op: dit stuurt alleen de gewone
  regels, niet `neverBillCode` (zie hieronder).
- `neverBillBillingCodeIDs`: work types die altijd als "nooit factureren" gelden,
  ongeacht de billable-vlag. Deze check wordt uitsluitend door
  `neverBillBillingCodeIDs` gestuurd, niet door `enabledRules`: staat een
  billingCodeID in deze lijst, dan vuurt de melding altijd, ook als je alle
  regels in `enabledRules` hebt uitgezet.
- `minChargeAmount`: wordt geaccepteerd in de config maar is nog niet aangesloten
  op een check in het script (dead config voor nu, geen effect op het rapport).

## Checkregels

**Labour (TimeEntries, nog niet approved):**
- `missingWorkType`: geen `billingCodeID`
- `zeroHours`: 0 uur te factureren
- `missingRole`: geen `roleID`
- `emptySummary`: lege `summaryNotes` (wordt de factuurregel)
- `outsidePeriod`: `dateWorked` valt buiten de gekozen periode

**Charges (Ticket-, Contract- en ProjectCharges, billable + nog niet gefactureerd):**
- `missingWorkType`: geen `billingCodeID` én geen `productID`
- `zeroAmount`: bedrag is €0
- `negativeAmount`: negatief bedrag
- `notBillableFlag`: `isBillableToCompany` staat uit terwijl het item toch meekomt
- `neverBillCode`: work type staat in `neverBillBillingCodeIDs` (altijd actief,
  onafhankelijk van `enabledRules`)

## Read-only garantie

Het script doet uitsluitend `*/query`-calls (GET/POST-query, nooit een echte create,
update of delete). Er wordt niets geapproved, gepost of anderszins gewijzigd in
Autotask. De skill is puur een controle vooraf, het posten blijft altijd een
handmatige stap van Anto in de UI.
