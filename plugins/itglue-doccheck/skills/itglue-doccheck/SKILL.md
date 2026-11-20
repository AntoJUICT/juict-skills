---
name: itglue-doccheck
description: Gebruik bij een Autotask-ticket "Halfjaarlijkse documentatiecheck IT Glue" (door Rewst aangemaakt, nummering .001/.002 per halfjaar), of wanneer gevraagd wordt de IT Glue-documentatie van een klant na te lopen, bij te werken of te vergelijken met wat er sinds de vorige check in tickets is gebeurd.
---

# Halfjaarlijkse IT Glue-documentatiecheck

Grotere klanten krijgen elk halfjaar een Rewst-ticket om hun IT Glue-dossier na te lopen. Deze skill is de werkwijze daarvoor. De tickets van het afgelopen halfjaar zijn de leidraad: daar staat wat er veranderd is. De live omgeving is het bewijs. IT Glue wordt pas aangepast na akkoord, per punt.

Voor de API-details gebruik je de skills `itglue-api` en `autotask-api`. Hier staat de volgorde en wat er in de praktijk misgaat.

## Werkwijze

1. **Scope bepalen.** Haal het checkticket op en het vorige (`.001` bij `.002`). De *sinds*-datum is de datum waarop de vorige check is uitgevoerd (time entry), niet een geschat half jaar. Zoek het IT Glue-organisatie-id op: `filter[name]` matcht alleen exact, dus haal bij twijfel de volledige organisatielijst op en zoek zelf. Is de klant niet eenduidig, vraag het na.
2. **Verzamelen.** Draai `node scripts/doccheck-verzamel.mjs --org <itglue-org-id> --company <autotask-company-id> --sinds <YYYY-MM-DD> --uit <map>` (zie [Verzamelscript](#verzamelscript)). Lees `overzicht.txt`, niet de ruwe JSON.
3. **Gap-analyse, ticketgedreven.** Loop elk niet-ruis-ticket langs en vraag: heeft dit iets veranderd dat in IT Glue hoort (server, share, printer, policy, script, netwerk, licentie, uitzondering)? Zoek het bijbehorende asset en kijk of het daar staat. Kijk daarna nog naar wat achterloopt zonder ticket: actieve assets of configuraties die verwijzen naar gearchiveerde servers, verstreken verloop- of verlengdata, dubbele configuraties, tags die niet meer kloppen. Gearchiveerde assets zijn geen bevinding.
4. **Eerste terugkoppeling.** Geef een genummerde lijst met wat achterloopt, met ticketnummers als bron, en een voorstel hoe verder (zie [Opleveren](#opleveren)). Nog niets wijzigen.
5. **Live verifiëren** wat uit tickets alleen niet zeker is, voordat je een tekst voorstelt:
   - Azure: `az vm list -d --subscription <id>` per klantsubscription (Lighthouse). Bestaat een VM niet meer, dan hoort de configuratie in het archief.
   - Entra/CA/Intune: het `az`-token geeft hier 403/401, ook met GDAP. Zet een read-only `Connect-MgGraph -UseDeviceCode`-script klaar dat naar JSON schrijft, en laat de engineer het in een eigen terminal draaien. Start zo'n login niet zelf op de achtergrond.
   - Wat je niet kunt zien (licentieportalen, firewall-GUI's): vraag het.
6. **Configuraties via de sync, niet met de hand.** Ontbrekende apparaten laat je door de Datto-koppeling in IT Glue aanmaken. Zijn er dubbele configuraties, kijk dan met `GET /configurations/<id>?include=rmm_records` welke een Datto-record heeft: die blijft, de andere gaat naar het archief. Staat een configuratie gearchiveerd terwijl hij live bestaat en een Datto-record heeft, haal hem dan uit het archief. Een configuratie die net door de sync is aangemaakt maar niet meer live bestaat, wijst op een verouderd apparaat in Datto: archiveren en melden dat het daar weg moet.
7. **Voorstel per asset, dan schrijven.** Per punt: welk asset, wat er nu staat, wat het wordt. Schrijf pas na akkoord en alleen de punten waarvoor akkoord is.
8. **Afronden.** Tijdregistratie op het ticket met een klantzichtbare `summaryNotes` en een interne `internalNotes` in CATA-vorm (afgerond / bewust zo gelaten / gesignaleerd buiten scope / volgende check). Daarna de status op Complete en de resolution zetten. Alleen na akkoord op de tijd.

## Schrijven naar IT Glue

- **PATCH op een flexible asset vervangt alle traits.** Wat je niet meestuurt, wordt leeggemaakt. Haal het asset eerst op, zet de tag-velden om naar een lijst ids (`{values:[...]}` → `[id, ...]`), wijzig wat nodig is en stuur de volledige traits terug. Dat geldt ook als je alleen `archived: true` zet.
- **Password-traits** bevatten een id naar een password-item, geen waarde. Stuur ze ongewijzigd mee.
- **Veldlengtes:** een veld van het soort `Text` heeft maximaal 255 tekens (bijvoorbeeld `notes` bij het type MFA). Een 422 met "is too long" betekent inkorten. Langere tekst hoort in een `Textbox`-veld of een document.
- **Configuratie-notes** zijn platte tekst; HTML wordt ge-escaped. Textbox-velden in flexible assets nemen wel HTML.
- **Archiveren in plaats van verwijderen.** Configuraties, flexible assets en documenten kunnen allemaal `archived: true` krijgen en zijn zo terug te halen.
- **Nieuw asset:** `POST /flexible_assets` met `organization-id`, `flexible-asset-type-id` en traits. Bestaat er geen passend type, maak er dan geen aan en meld dat het niet gedocumenteerd is.
- Werk sequentieel en lees na het schrijven terug als je twijfelt of het gelukt is.

## Wat je niet documenteert

- **Tijdelijke toestanden:** een host die door capaciteitsgebrek in Azure tijdelijk op een andere VM-grootte draait, een CA-uitsluiting voor de duur van een vakantie. Die verdwijnen vanzelf; een notitie erover veroudert sneller dan het dossier.
- **Wat automatisch gesynct wordt** (`MS365 Users/Groups (auto)`, licenties, Rewst Forms): afwijkingen daar los je op in de bron.
- **Secrets:** geen wachtwoorden of keys in voorstel, asset of notitie, ook geen licentiesleutels in vrije tekst.

## Bevindingen buiten documentatie

Dubbele CA-policies, noncompliant apparaten, verlopen licenties: meld ze apart in je terugkoppeling en zet ze in de interne notitie onder "gesignaleerd". Maak er niet zelf een ticket of wijziging van. De engineer beslist of het nu wordt opgepakt.

## Opleveren

De eerste terugkoppeling en elk voorstel hebben dezelfde vorm:

1. Eén of twee zinnen stand van zaken.
2. Een genummerde lijst met bevindingen of voorstellen, per punt het asset, wat er staat, wat het wordt en het bronticket.
3. Een aparte, korte lijst "buiten documentatie".
4. Genummerde keuzes voor hoe verder, met advies. Bij schrijfacties een impactregel erboven ("alleen IT Glue, archiveren is omkeerbaar").

Zo kan de engineer met cijfers antwoorden ("1, 2 en 4 akkoord, 3 niet").

## Verzamelscript

`scripts/doccheck-verzamel.mjs` is read-only en heeft geen dependencies (Node 18+). Het schrijft `itglue.json`, `tickets.json` en `overzicht.txt` naar de map die je opgeeft. Kies een tijdelijke map buiten de repo: de uitvoer bevat klantdata.

Het script doet al wat je anders zelf moet uitzoeken:
- flexible assets per type ophalen (alleen op organisatie filteren geeft een lege lijst)
- Autotask-paginering via POST op `nextPageUrl`
- `AUTOTASK-ZONE` als kaal nummer omzetten naar `webservicesNN.autotask.net`
- password-items met alleen naam en metadata
- tickets inclusief notities en time entries: in de `summaryNotes` van de engineers staat vaak de echte wijziging

Secrets komen uit `ITGLUE_API_KEY` en `AUTOTASK_USERNAME`, `AUTOTASK_API_KEY`, `AUTOTASK_INTEGRATION_CODE` en `AUTOTASK_ZONE`. Zijn die niet gezet, dan gebruikt het script `az keyvault secret show` op `juict-shared-kv`. Is dat in je omgeving geblokkeerd, gebruik dan het SDK-pad dat de `autotask-api`-skill beschrijft. Zet de secrets dan alleen in de procesomgeving van die ene run, nooit in een bestand.

Tests (offline):

```bash
node --test "plugins/itglue-doccheck/skills/itglue-doccheck/scripts/*.test.mjs"
```

## Veelgemaakte fouten

| Fout | Gevolg | Goed |
|---|---|---|
| Alleen gewijzigde traits PATCHen | Overige velden leeg | Volledige traits terugsturen |
| Alles breed ophalen (contracten, rollen, groepen) | Uur op, geen gap-analyse | Tickets sinds vorige check als leidraad |
| Graph via `az`-token | 403/401 | Device-code-script in eigen terminal |
| Ontbrekende configuraties handmatig aanmaken | Dubbelen naast de Datto-sync | Sync laten draaien, `rmm_records` checken |
| Verwijderen | Niet terug te halen | Archiveren |
| Zelf vervolgtickets aanmaken voor CA/Intune-bevindingen | Werk dat niemand vroeg | Melden onder "gesignaleerd" |
| Tijdelijke toestand documenteren | Dossier klopt over een week niet meer | Weglaten |
