# Ontwerp: skill "projectstart"

Datum: 12 november 2026
Opdrachtgever: Mike Witbreuk (JUICT)
Status: concept, ter goedkeuring

## 1. Waarom

Na akkoord op een offerte zit tussen de verkoop (Mart Koppelman) en de projectstart een gat. Op 12 november 2026 kostte het een ochtend handwerk om voor klant X de kick-off voor te bereiden: offerte en doorgestuurde mails lezen, afspraken uit de onderhandeling halen, een briefing maken, het Mini PVA invullen, een kick-off-presentatie maken, een uitvraag-mail schrijven en een inventarisatierapport bouwen.

Daarnaast sloot de kick-off-presentatie niet aan op de verkoop. Mart heeft een nieuwe verkooppresentatie in Claude Design gemaakt, in de nieuwe JUICT-stijl (artifact `https://claude.ai/artifact/ErU9wG7ZhrGkS655Nz2zrB`, bestand `project/JUICT Salespresentatie.html`). Het oude kick-off-template (`Werkprocessen\Projecten\Project kick-off precentatie.pptx`) heeft een oude stijl en een ander verhaal.

De skill moet ervoor zorgen dat **de kick-off vloeiend doorloopt vanuit de verkoop**: in dezelfde stijl en met hetzelfde verhaal. Ook moet alles wat Mart met de klant heeft besproken vanaf dag één terugkomen in de projectdocumenten.

## 2. Wat het is

Een Claude Code-skill voor JUICT. Je start hem met één Autotask-projectnummer. Hij zet klaar wat nodig is voor de eerste meeting na akkoord op de offerte. Die meeting is meteen de kick-off van het project.

### Wanneer en door wie

- **Starten.** Na akkoord maakt iemand het Autotask-project aan en zet alle communicatie met de klant als bijlage op dat project: getekende offerte, mailwisselingen (.eml/.msg), notities en eventuele documenten. Daarna start de projectleider (meestal Mike) de skill met het projectnummer.
- **Aanvullen.** Een engineer of de projectleider zet later een nieuwe afspraak, notitie of het antwoord van de klant als notitie of bijlage op hetzelfde project, en draait de skill opnieuw. De skill verwerkt wat nieuw is en werkt de documenten bij.

### Wat er na een eerste run klaarligt

1. **Kick-off-presentatie** in Claude Design, in de stijl van Marts verkooppresentatie (zie 5.2).
2. **Inventarisatierapport** in Claude Design, volgens het rapportschema van de skill it-inventarisatie, al gevuld met alles uit de contactmomenten (zie 5.3).
3. **Mini PVA** (Word), ingevuld (zie 5.4).
4. **Interne briefing**, gesplitst in "voor de projectleider" en "voor de techniek", als notitie op het Autotask-project, met de links naar de presentatie en het rapport (zie 5.5).
5. **Uitvraag-mail** aan de IT-contactpersoon van de klant, als concept en nooit verstuurd (zie 5.6).

Alles komt terecht in het Autotask-project, als bijlage of notitie. Er komt geen kopie in een OneDrive-klantmap.

## 3. Doelen, niet-doelen, anti-doelen

### Doelen

- De projectleider draait de skill één keer en gaat de kick-off in met presentatie, rapport, PVA en briefing, zonder handwerk naast het nalezen.
- De klant herkent in de kick-off het verhaal en de stijl van de verkoop.
- Na de kick-off weet de klant **in grote lijnen** wat er gaat gebeuren, en **precies wat er van hem wordt verwacht om aan te leveren**.
- Elke engineer kan aanvullen. De stand staat in Autotask en niet op één pc.
- Afspraken uit de onderhandeling (korting, contractduur, facturatie, wat buiten scope valt) gaan niet verloren tussen sales en project.

### Niet-doelen

- Geen vervanging van de skill it-inventarisatie. Die blijft bestaan en wordt hergebruikt (rapportschema, bouwscript, Autotask-taken).
- Geen projectplanning in uren per engineer en geen inplanning op het planbord.
- Geen mail versturen, geen gebruiker of tenant aanpassen, niets schrijven in de omgeving van de klant.
- Geen aanpassing van Marts verkooppresentatie zelf.

### Anti-doelen (wat het een mislukking maakt, ook als het technisch werkt)

- **Een te technische kick-off.** Bij de kick-off horen hoofdlijnen, geen relay-servers, DNS-records of licentie-SKU's. Technische details gaan naar het rapport en de briefing voor de techniek.
- **Een klant die na de kick-off niet weet wat hij moet aanleveren.** De presentatie heeft altijd een duidelijke slide "Wat we van jullie nodig hebben", met per punt wie het doet.
- **Een presentatie in de oude stijl** of met een ander verhaal dan dat van de verkoop.
- Prijzen of bedragen in iets wat de klant ziet (presentatie, rapport, uitvraag-mail).
- Iets schrijven in Autotask of Outlook zonder voorvertoning en akkoord.
- Dubbele bijlagen of notities in Autotask bij een tweede run. Verwijderen kan via de API niet, dus een fout blijft staan.
- Een stand die alleen lokaal op de pc van één persoon staat.

## 4. Randvoorwaarden

- **Omgeving.** Een JUICT-werkplek met Windows 11. Aanwezig: Node 24 (jszip in `C:\Claude\node_modules`, maar reken daar niet op), PowerShell, Microsoft Office (Word en PowerPoint via COM), Azure CLI, Git Bash. **Niet** aanwezig: Python, pandoc, LibreOffice, Chrome, pdftoppm. De beheerde Edge blijft headless hangen (bekend probleem uit it-inventarisatie). PowerShell-scripts draaien alleen met `-ExecutionPolicy Bypass`. In Git Bash moet `$` in `powershell -Command` geëscaped worden, dus beter `.ps1`-bestanden gebruiken.
- **Secrets.** Volgens het secretsbeleid van JUICT komen API-keys uitsluitend uit de Key Vault (`juict-shared-kv`, daarna `ju-hermes-emmanuel`). Ze worden nooit geprint, gelogd of in bestanden of documenten gezet. Voor Autotask zijn er dezelfde credentials en dezelfde fallback als in it-inventarisatie.
- **Autotask.** Zone 19. Verwijderen kan niet (`canDelete: false` op taken, projecten, notities). Bijlagen kunnen via `POST /Projects/{id}/Attachments`; zie REFERENCE.md van it-inventarisatie voor de geverifieerde endpoints. Ook bijlagen lezen is nodig: `GET /Projects/{id}/Attachments` en de inhoud per bijlage. De builder moet het ophalen van de inhoud van een bijlage nog verifiëren.
- **Claude Design.** Artifacts zijn privé tot iemand ze deelt via Share. Delen kan de skill niet zelf. Publiceren mag alleen vanuit de werkmap of scratchpad van de sessie, dus niet vanuit `%USERPROFILE%\.claude\...`; bij it-inventarisatie liep dat vandaag mis.
- **Schrijfregels.** Nederlands, jij/jullie, actief en concreet. Geen em-dashes. Geen buzzwords (ontzorgen, naadloos, robuust, synergie). **Geen afkortingen**: "Business Central" en niet "BC", "Microsoft 365" en niet "M365". Een afkorting alleen als de klant die zelf gebruikt en hij eerder voluit is genoemd. Afspraken uit de offerte of het overleg beschrijf je als afspraak, niet als tekortkoming. Een vorige partij wijs je nooit aan. Woorden die een klant niet kent vermijden (dus "offerte" en geen "raming").
- **Git.** De skill komt in de JUICT-skills-marketplace (`juict-skills`), op een feature branch met een pull request naar main volgens de JUICT-gitworkflow. De bestaande plugins it-inventarisatie en autotask-api staan in dezelfde marketplace.

## 5. Hoe: wat al besloten is

### 5.1 Bronnen en projectdossier

- De enige invoer van de gebruiker is het Autotask-projectnummer. Bedrijf, contacten en bijlagen haalt de skill uit Autotask.
- De skill leest alle projectbijlagen en projectnotities: de offerte (PDF), mails (.eml, ook met base64 of quoted-printable in Windows-1252, en .msg), Word-documenten en notities.
- Alles komt samen in één **projectdossier**: per feit wat het is, uit welke bron (bijlage en datum) en of het een afspraak, een open besluit of een open vraag is. Daaruit worden alle documenten gemaakt, zodat ze elkaar niet tegenspreken.
- **Klantnaam.** Er zijn twee namen: de naam in Autotask (voor rapport en Autotask) en de naam die de klant gebruikt (voor de presentatie). Bij klant X verschilden die twee namen. De skill laat beide bevestigen.
- **De stand staat in Autotask.** Het dossier en de links naar de artifacts worden bij elke run in Autotask bewaard, zodat een tweede engineer verder kan. Een lokale cache mag, maar is nooit de bron.

### 5.2 Kick-off-presentatie

- **Basis is de verkooppresentatie van Mart**: Claude Design, het JUICT-designsystem (Libre Franklin, Uniwars, navy `#13345C`, rood `#DA3543`, kleurverlopen per dienst, achtergrond met ruis), `deck.css`, `present.js` en de assets (teamfoto's in `assets/teamfull/`, logo, pictogrammen). Bestanden worden gekopieerd vanuit die artifact, niet nagetekend.
- **Het verhaal gaat verder waar de verkoop stopte.** Marts slide "Zo werken we samen" heeft een genummerde route: 01 Nulmeting & scan en 02 Fundament bouwen als eenmalige start, daarna de cyclus 03 Beheer, 04 Data & intelligentie en 05 Doorontwikkelen. De kick-off begint met "hier staan we", met dezelfde nummering en dezelfde kleurverlopen per stap, en koppelt de fases uit de offerte aan die stappen.
- **Hoofdlijnen, niet technisch.** Ongeveer 8 tot 10 slides met 3 of 4 korte punten per slide. Details vertelt de projectleider of staan in het rapport.
- **Opzet** (uitkomst van de rondetafel van 12 november 2026 met een projectmanager, een klant, een expert in de flow van presentaties en een sales- en merkexpert). Maximaal 10 slides. Er is geen agendaslide, want de route is de agenda. De titels zijn stellingen met één accentwoord, in een nuchtere toon:

  | # | Eyebrow | Titel (voorbeeld) | Inhoud | Layout uit Marts deck |
  |---|---|---|---|---|
  | 1 | De eerste stap | Vandaag beginnen we *samen*. | Klantnaam, datum, teamfoto | 01 Hook |
  | 2 | Zo werken we samen | We staan bij stap *01*. | Marts route 01 tot 05 met "hier staan we". Fase 0 tot en met 2 is stap 01, de vervolgfases zijn 02. Stap 03 tot 05 staan gedimd en zijn geen toezegging | 07 route |
  | 3 | Vast team | Korte lijnen, *vaste* gezichten. | JUICT-team met foto's, contactpersonen van de klant met hun rol (wie beslist, wie is het dagelijkse aanspreekpunt), externe partijen en wie die aanstuurt | 02 teamfoto's |
  | 4 | Waar we voor gaan | Twee bedrijven, *één* werkplek. | Doel in één zin. Wat de vaste prijs dekt, wat buiten scope valt en dat de vervolgfases een eigen offerte krijgen. Letterlijk wat er op de harde datum wel en niet klaar is | 03/04 eyebrow + titel + lead |
  | 5 | Veilig vanaf dag één | Wat er gebeurd is, nemen we *mee*. | **Alleen als de bronnen erom vragen.** Kort: wat al geregeld is, wat we controleren, wat later komt | 05 compact, 3 kaarten |
  | 6 | De route in maanden | Van besluit naar plan in *drie* maanden. | Fases met maanden, de datum van het migratieplan en de offerte voor de vervolgfases | 07 route |
  | 7 | Fase 0 | Drie keuzes bepalen het *tempo*. | Elk besluit in klanttaal ("welke omgeving wordt de basis", niet "tenant"), met wie beslist, de uiterste datum en wat er gebeurt als het vandaag niet lukt | 08 drie stappen |
  | 8 | Jullie aandeel | Dit hebben we van *jullie* nodig. | Per punt een naam, een datum en een inschatting van de tijd. Technische vragen worden niet in de zaal behandeld; die gaan dezelfde dag per uitvraag-mail naar de IT-contactpersoon | 05 compact, kaarten |
  | 9 | Altijd op de hoogte | Je weet altijd waar we *staan*. | Overlegritme, vast aanspreekpunt, escalatie, en waar nodig de afspraak hoe we verzoeken controleren | 07 band "Wat je aan JUICT hebt" |
  | 10 | Afgesproken | Dit doen we *samen*. | De besluiten en acties van vandaag met eigenaar, de datum van het volgende overleg, "Tot snel." en het telefoonnummer | 08 slot |

- **Interactie:** de klant bevestigt kort de rollen (3) en de scope (4). Het hoofdmoment is de besluiten (7, ongeveer 15 minuten), daarna de eigen bijdrage (8, ongeveer 10 minuten). Slide 9 is het rustpunt. Slide 10 laat de klant zijn eigen afspraken terugzien.
- **Geen schijnzekerheid.** Wat nog open is, blijft zichtbaar open ("eigenaar bepalen we vandaag"). De skill verzint geen namen, datums of besluiten.
- **Niet overnemen uit Marts deck:** de hook-vraag, de tijdlijn, de awards, de klantlogo's, de deep dive, de calculator, "Plan je nulmeting", verkooptaal ("vrijblijvend", "méér") en em-dashes. Ook geen beloftes die groter zijn dan in de verkoop of de offerte.
- **Wel overnemen:** de route met dezelfde nummers en kleurverlopen, de vier beloftes (Eén partner, Proactief, Meedenkend, Vast team) met echte namen erbij, de teamfoto's, het accentwoord per titel en de slotzin "Tot snel.".
- Het inventarisatierapport is leidend. De presentatie spreekt het rapport nergens tegen (bij klant X ging dat mis met de status van de beveiligingsreview en met de planning).

### 5.3 Inventarisatierapport

- Gebruikt het rapportschema, `bouw.mjs` en de regels van it-inventarisatie (geen prijzen, alleen uren, verwijzen naar hoofdstukken, neutraal schrijven).
- **Samenwerking met it-inventarisatie (mijn call).** Projectstart maakt de eerste versie van het rapport uit de contactmomenten, plus de DNS-lookup. Daarvoor is geen toegang tot de klant nodig. Microsoft 365 via GDAP, IT Glue en het interview blijven bij it-inventarisatie. Er is één rapport en één stand, en die stand staat in Autotask. it-inventarisatie wordt aangepast zodat hij die stand uit Autotask leest en daarin bijwerkt, in plaats van alleen een lokaal werkbestand te gebruiken.
- Het rapport is vanaf de eerste run gevuld met alles uit het dossier. Wat nog onbekend is staat bij de open vragen en in de bijlage met `nogOpen`.
- Bij het aanvullen wordt het hele rapport bijgewerkt, zoals it-inventarisatie dat bij antwoordrondes doet: datum, samenvatting, stappen, uren, open vragen en bijlage.
- De Autotask-taken van het Easywork Basic-sjabloon worden ingevuld zoals bij it-inventarisatie, alleen na voorvertoning en akkoord.

### 5.4 Mini PVA

- Word-document volgens de opbouw van het huidige Mini PVA: inleiding, doelstellingen, scope plus out of scope, impactanalyse, planningstabel (onderdeel / deadline / verantwoordelijke), voorbereidingen, communicatie, uitvoering, overzicht configuratie servers, afronding, goedkeuring met handtekeningregel.
- Het PVA is intern. Financiële afspraken (korting, uurtarief, contractduur) mogen erin.
- De planningstabel bevat de fases uit de offerte en de besluiten, met PM, Techniek of Klant als verantwoordelijke.
- Opmaak, inhoudsopgave (bijgewerkt via Word-COM), bladwijzers en handtekeningregel blijven behouden.
- Komt als bijlage op het Autotask-project. Bij aanvullen komt er een nieuwe versie met een versienummer in de bestandsnaam erbij, want de oude kan niet verwijderd worden.
- Bron van de opbouw: `OneDrive - JUICT B.V\Bureaublad\Mike\Belangrijke documenten\Werkprocessen\Projecten\Mini PVA Template.docx`. Let op: dat bestand is in feite een ingevuld PVA van een eerdere klant, geen leeg template. Een gevuld voorbeeld voor klant X staat in de klantmap op OneDrive.

### 5.5 Interne briefing

- Eén notitie op het Autotask-project, intern (publish 2).
- Twee delen: **voor de projectleider** (besluiten uitlokken, scope bewaken, financiële afspraken, budget, rolverdeling, eigenaarschap van acties) en **voor de techniek** (technische vragen, openstaande punten, afhankelijkheden).
- Bevat de links naar de presentatie en het rapport, en een lijst met punten om tijdens de kick-off verder uit te vragen.
- Bij aanvullen komt er een nieuwe notitie met alleen wat er veranderd is.

### 5.6 Uitvraag-mail

- Volgens het mailsjabloon van it-inventarisatie, aan de IT-contactpersoon van de klant. Per onderdeel een vet kopje en één zin, en een urgent punt los bovenaan.
- Eerst de volledige tekst in de chat. Na akkoord als concept via de Microsoft 365-connector, als die er is. Is er geen connector, dan blijft de tekst in de chat staan om te kopiëren en komt hij ook als notitie op het project. De skill verstuurt nooit zelf.

### 5.7 Schrijfacties en veiligheid

- Elke schrijfactie naar Autotask, Outlook of Claude Design gaat via een voorvertoning en een akkoord. Autotask-schrijfacties alleen met een expliciete vlag, zoals `--toepassen` bij it-inventarisatie.
- Een tweede run maakt niets dubbel: notities en bijlagen worden herkend aan titel en bestandsnaam.
- Geen geheimen in een document, notitie, artifact of de chat. Een overdrachtsdocument vol wachtwoorden wordt gelezen maar niet overgenomen; schrijf "staat in IT Glue".

## 6. Aan de builder

- Of het een nieuwe plugin wordt die it-inventarisatie aanroept, of een uitbreiding van it-inventarisatie. De scripts en het rapportschema moeten hoe dan ook gedeeld worden, niet gekopieerd.
- De vorm van het dossier en waar precies in Autotask de stand staat (bijvoorbeeld een JSON-bijlage of een vaste notitie), zolang het gedeeld is en een tweede run het vindt.
- Hoe de bijlagen worden gelezen (PDF, .eml, .msg, .docx) met wat er op de werkplek staat.
- Hoe de slides technisch worden opgebouwd uit Marts deck: welke bestanden gekopieerd worden en welke slide-layouts hergebruikt worden.
- Hoe het PVA wordt ingevuld. Vandaag lukte het met jszip, door per alinea en tabelcel te vervangen, plus Word-COM voor de inhoudsopgave en de PDF-controle. Een schoon PVA-template met plaatshouders in de plugin mag ook.
- Controle van de opmaak. Zonder Chrome werkt de fit-check van `bouw.mjs` niet. Een PDF-export via Office-COM werkt wel voor Word en PowerPoint.

## 7. Besluiten van Mike (12 november 2026)

- **Doel van de skill:** IT-overnames en migraties, zoals bij klant X. Andere soorten projecten (AI, applicaties) vallen erbuiten.
- **Marts verkooppresentatie** is één algemene presentatie. De skill neemt bij elke run de nieuwste versie van `https://claude.ai/artifact/ErU9wG7ZhrGkS655Nz2zrB` als basis voor stijl en route.
- **Delen:** wie de skill start, deelt de presentatie en het rapport direct met de JUICT-organisatie met bewerkrechten. De skill herinnert eraan na de eerste run en zet het als actie in de briefing.
- **Handwerk en een tweede run:** de presentatie wordt alleen bij de eerste run gemaakt en daarna nooit overschreven. Het rapport en het PVA worden bij elke run opnieuw opgebouwd uit Autotask. Wie iets blijvend wil vastleggen, zet het als notitie op het Autotask-project. De skill zegt dat ook na elke run.

## 8. Calls die ik zelf heb gemaakt

- De presentatie en het rapport worden aparte Claude Design-artifacts, net als het werk van Mart en het rapport van it-inventarisatie.
- De briefing en de uitvraagpunten komen als notitie in Autotask en niet als los document.
- Het PVA blijft een Word-document, omdat het huidige werkproces met Word en een handtekeningregel werkt.
- Een nieuwe versie van het PVA komt als extra bijlage met een versienummer, omdat verwijderen in Autotask niet kan.
