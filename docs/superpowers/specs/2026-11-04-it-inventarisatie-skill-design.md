# Ontwerp: skill `it-inventarisatie`

Datum: 4 november 2026. Opdrachtgever: Anto te Lintelo (JUICT). Voorbeeld en bron: een IT-inventarisatierapport dat Anto in november 2026 voor een klant maakte in Claude Design, en het generatorscript daarvan (niet in deze repo, want het bevat klantgegevens).

## Bedoeling en waarom

Engineers en consultants van JUICT moeten bij een nieuwe klant of een migratie dezelfde, goede IT-inventarisatie kunnen maken als het voorbeeldrapport, zonder dat Anto erbij zit. Nu kost zo'n rapport veel handwerk en hangt de kwaliteit af van wie het maakt. De skill maakt er een vast proces van: offerte lezen, bronnen ophalen, gaten uitvragen, een rapport in JUICT-huisstijl opleveren, en de PDF op het Autotask-project zetten.

## Gebruikers en lezers

- **Gebruikers van de skill:** engineers en consultants van JUICT.
- **Lezers van het rapport:** de klant, JUICT zelf en de IT-partij die vertrekt. Daarom: neutrale toon, nooit wachtwoorden of andere geheimen, beveiligingspunten als actiepunten voor de overgang, nooit de vorige partij aanwijzen.

## Doelen

- Altijd één bedrijf per inventarisatie.
- Een rapport in Claude Design met dezelfde opbouw en kwaliteit als het voorbeeld.
- Het interview vraagt alleen wat niet al uit de bronnen te halen is.
- Een inventarisatie kan over meerdere dagen lopen en later worden hervat.

## Niet-doelen

- Geen groepsinventarisaties met meerdere bedrijven (geen multitenant-architectuur of B2B-hoofdstuk).
- Geen eigen prijzen bedenken. Uren en bedragen komen alleen uit de offerte.
- Geen schrijfacties in Microsoft 365, IT Glue of DNS.
- Geen offerte maken.

## Anti-doelen

- Er komt een wachtwoord, pincode, PUK, licentiesleutel, WPA-key of token in het rapport, de chat, het werkbestand of de vault. Ook niet uit een overdrachtsdocument van de vorige partij.
- Het rapport leest als AI-tekst of wijkt af van de JUICT-schrijfregels.
- Pagina's lopen over de footer.
- Er wordt iets verstuurd of geüpload zonder akkoord van de engineer.

## Werkwijze (besloten)

### Stap 1: offerte eerst
De skill vraagt als allereerste om de offerte (PDF of ander bestand) toe te voegen. Zonder offerte gaat hij niet verder, tenzij de engineer bewust kiest om zonder te werken. Uit de offerte haalt de skill:
- klantnaam en eventueel Autotask-bedrijf;
- welke onderdelen in scope zijn (bijvoorbeeld Microsoft 365, werkplekken, server, netwerk, telefonie, applicaties);
- de uren en bedragen per fase of onderdeel, zoals ze in de offerte staan.
Wat de skill heeft gelezen, vat hij kort samen en laat hij bevestigen.

### Stap 2: bronnen ophalen (alleen lezen)
Zoveel mogelijk zelf ophalen voordat er vragen komen:
- **Mail en bijlagen** (Microsoft 365-connector): antwoorden van de klant of de vorige IT-partij, exports, overdrachtsdocumenten. Geheimen uit bijlagen worden gelezen maar nooit overgenomen.
- **Microsoft 365 via GDAP** (az CLI, delegated token, alleen lezen): organisatie, domeinen, licenties, gebruikers met licentie en laatste aanmelding, groepen, apparaten, Conditional Access, beheerrollen, MFA-registratie. Lukt GDAP niet (nog geen relatie), dan meldt de skill dat en gaat verder.
- **IT Glue** (via de bestaande `itglue-api` skill): configuraties, netwerken, domeinen, flexible assets, zonder wachtwoordvelden.
- **Autotask** (via de bestaande `autotask-api` skill): bedrijf, contracten, project.
- **Openbare DNS:** tenant-ID, MX en nameservers van elk domein.

### Stap 3: interview van de gaten
De skill legt per onderdeel naast elkaar wat al bekend is en wat ontbreekt, en vraagt alleen het ontbrekende, interactief met klikvragen (AskUserQuestion) waar dat kan. Vaste onderdelen:
1. Gebruikers en licenties (wie werkt er nog, welke licentie, distributeur en einddata)
2. Domeinen en mail (gedeelde mailboxen, doorsturingen, waar de DNS staat)
3. Server en data (rollen, hoeveelheid data, wat weg of naar archief kan)
4. Werkplekken en telefoons (aantallen, beheer, besturingssysteem)
5. Netwerk (firewall, switches met aantal poorten, access points, IP-plan, internet)
6. Printers
7. Applicaties en koppelingen
8. Beveiliging (MFA, antivirus/EDR, back-up, beheeraccounts)
9. **Telefonie, alleen als het in de offerte staat:** huidige gebruikers, nummerplan, provider, toestellen.
10. Documentatie en leverancierscontracten.

### Stap 4: uitvraag-mail (optioneel)
Ontbreken er gegevens die alleen de klant of de vorige partij kan geven, dan stelt de skill een uitvraag-mail op, in de stijl van de uitvraag-mail uit het voorbeeld (oktober 2026): kort, per onderdeel een genummerde vraag, "wachtwoorden hoef je niet te sturen". De mail komt als concept in Outlook van de engineer. Versturen doet de engineer zelf.

### Stap 5: werkbestand en hervatten
Alle gegevens komen in één werkbestand per klant (`inventarisatie.json`, met daarin bronnen, antwoorden, open vragen en status per stap). Bij een volgende sessie leest de skill het werkbestand, zoekt hij naar nieuwe mails sinds de vorige keer en gaat hij verder waar hij was. Het werkbestand bevat persoonsgegevens maar nooit geheimen. Het staat lokaal bij de engineer (zie "aan de bouwer overgelaten" voor de plek).

### Stap 6: rapport maken
Het rapport heeft dezelfde opbouw als het voorbeeld, zonder de groepsonderdelen:
1. Voorblad
2. Samenvatting (wat we zagen, wat we adviseren, de eerstvolgende drie stappen, uren totaal)
3. Huidige stand, verdeeld over zoveel pagina's als nodig (accounts en mail; server, werkplekken en netwerk; printers, applicaties en telefonie)
4. Wat opvalt (tabel: punt, wat we zien, wat we eraan doen)
5. Doelinrichting (principes en wat er verandert, uitgaande van de JUICT-standaard Easywork Basic waar dat in de offerte staat)
6. Stappenplan als tijdlijn per maand
7. Uren en kosten per fase, overgenomen uit de offerte (uren, tarief en bedrag), met het offertenummer; staat iets niet in de offerte, dan schat de engineer de uren en blijft het bedrag leeg
8. Open vragen per persoon
9. Bijlage accounts met de kolommen naam, adres, licentie, voorstel en "Nog nodig?" (vakjes ja/nee)

Hoofdstukken die niet in scope zijn, vallen weg.

### Stap 7: opmaak met een vast sjabloon (besloten)
Het rapport wordt gemaakt door een script dat met de skill meekomt, niet door Claude die elke keer zelf ontwerpt. Claude vult een gegevensbestand (`rapport.json`) volgens een vast schema. Het script maakt daar de Claude Design-pagina's van (A4, 794 × 1123, vaste pagina's) en controleert met een headless browser of de inhoud op elke pagina boven de footer blijft. Past een pagina niet, dan splitst het script tabellen over meer pagina's of meldt het welke pagina te vol is. De opmaak volgt het voorbeeld: JUICT-logo (positief en diapositief), Libre Franklin, navy `#002345`, roze `#ff3862`, de driestops-gradient op 25 graden alleen op het voorblad, kaarten met radius 15px.

Publiceren gebeurt via het Artifact-tool met het Design-type, net als bij het voorbeeld: eerst canvas.json en het voorblad, daarna de rest.

### Stap 8: PDF op het Autotask-project
De engineer exporteert de PDF zelf via Claude Design. Daarna zoekt de skill het Autotask-project van de klant. Bestaat dat, dan zet hij de PDF er na akkoord als bijlage op (via de `autotask-api` skill; het endpoint voor projectbijlagen eerst verifiëren). Bestaat er nog geen project, dan meldt de skill dat en doet hij niets.

### Stap 9: Autotask-project invullen (besloten op 4 november)
Na het rapport vult de skill het onboardingproject in Autotask, zodat de engineer die de onboarding doet alles bij de juiste taak vindt.

- **Alleen het sjabloon Easywork Basic** (Autotask-sjabloon 14, `projectType` 3). Projecten die daarvan gemaakt zijn, hebben dezelfde 29 taken in zeven fasen (gelezen op 4 november 2026; de omschrijvingen in het sjabloon zijn leeg). De skill zoekt het project van de klant (`Projects/query` op `companyID`, `projectType` 5, niet afgerond) en laat het bevestigen. Is er geen project, dan doet hij niets.
- **Niet van toepassing:** verwijderen kan niet (Autotask: `canDelete: false` voor tasks). De skill zet zo'n taak op status 5 (Complete), de geschatte uren op 0, en voegt een notitie toe: "Niet van toepassing volgens de inventarisatie van <datum>: <reden>". Voorbeeld: "Setup telefonie" als telefonie niet in de offerte staat.
- **Wel van toepassing:** een korte samenvatting in de taakomschrijving en de details in een TaskNote (`noteType` 3, intern). Nooit wachtwoorden: daarvoor alleen de verwijzing "staat in IT Glue".
- **Uren:** de geschatte uren per taak worden bijgewerkt als de offerte ze per onderdeel noemt; anders blijven ze zoals in het sjabloon.
- **Rapport:** de PDF komt als bijlage op het project (stap 8).
- **Akkoord:** de skill toont eerst een voorvertoning per taak (wat er verandert: status, uren, omschrijving, notitie) en schrijft pas na akkoord van de engineer.

Koppeling van inventarisatie-onderdelen aan taken (voorstel van de schrijver, de bouwer mag verfijnen):

| Taak in het sjabloon | Informatie uit de inventarisatie |
|---|---|
| Huidige documentatie ontvangen | Welke bronnen er zijn (mail, exports, overdrachtsdocument), wat nog ontbreekt |
| Licentie plan maken | Huidige licenties, distributeur, einddata, voorstel per account |
| Aanschaf benodigde hardware en/of software | Netwerkhardware (aantal switches en poorten, access points), laptops die vervangen moeten |
| Setup Microsoft 365 | Domeinen, DNS-beheer, accounts, gedeelde mailboxen, MFA en beveiliging |
| RBAC Opmaken | Beheeraccounts en rollen, wat weg moet bij de overgang |
| Mailmigratie Microsoft 365 | Mailboxen die moeten verhuizen, mail die niet in M365 binnenkomt, doorsturingen |
| Setup Intune | Werkplekken en telefoons, aantallen, besturingssysteem, huidig beheer |
| Setup standaard applicaties | Applicaties en koppelingen |
| Initiële datamigratie / Definitieve datamigratie | Server, rollen, hoeveelheid data, wat weg of naar archief kan |
| Setup netwerk | Firewall, switches, access points, IP-plan, internet |
| Setup telefonie / Telefonie oplevering op locatie | Alleen als telefonie in scope is: gebruikers, nummerplan, provider, toestellen |
| IT Glue updaten | Wat er in IT Glue moet komen |

Te verifiëren bij de bouw (nog geen werkend voorbeeld): `PATCH /Projects/{id}/Tasks` voor `status`, `estimatedHours` en `description`; de maximale lengte van `Task.description`; en het endpoint voor een projectbijlage (waarschijnlijk `POST /Projects/{id}/Attachments`, naar analogie van ticketbijlagen). `POST /TaskNotes` is geverifieerd volgens de `autotask-api` skill.

## Harde regels (in de skill)

1. Eerst de offerte.
2. Alleen lezen in Microsoft 365, IT Glue en DNS. De enige schrijfacties: de concept-mail in Outlook, en in Autotask het bijwerken van de taken van het onboardingproject plus de PDF als projectbijlage. Allemaal pas na een voorvertoning en akkoord.
3. Nooit geheimen overnemen, tonen of opslaan.
4. Schrijfregels en huisstijl van JUICT volgen (de `juict-vault` skill, `10-JUICT/schrijfregels.md` en `huisstijl.md`, als die beschikbaar is; anders de regels die in de skill zelf staan).
5. Uren en bedragen alleen uit de offerte, nooit zelf bedacht of uit de directie-vault.
6. Uitspraken over wat technisch kan of niet kan (bijvoorbeeld van Microsoft), worden alleen opgenomen als ze zijn nagekeken in de documentatie.

## Plek en vorm (besloten)

- Plugin `it-inventarisatie` in de marketplace `AntoJUICT/juict-skills`, met de standaardvorm: `plugins/it-inventarisatie/.claude-plugin/plugin.json` en `plugins/it-inventarisatie/skills/it-inventarisatie/SKILL.md`, plus een entry in `marketplace.json`, de tabel in de README en de lijst onder Vereisten (Key Vault en az login).
- Scripts in Node (`.mjs`), met tests, zoals de andere plugins (`plugin-structuur.test.mjs`).
- Werken via een feature branch en een pull request naar `main`, gekoppeld aan een work item in Azure Boards.

## Antwoorden op de builder-check

- **Bronscripts.** Het generatorscript van het voorbeeld (Python), de fit-check (headless Chrome) en een M365-uitleesscript (PowerShell) bestaan lokaal bij Anto. Ze worden bij de bouw als referentie gebruikt en naar Node geporteerd, zonder klantgegevens.
- **Claude Design.** Alle engineers hebben het Design-type in hun account (org-breed, besloten door Anto). Geen terugvalroute nodig.
- **Mailbox.** De skill zoekt alleen in de mailbox van de engineer (besloten door Anto). Wat elders binnenkomt, stuurt men door.
- **Voorbeelddata (keuze van de schrijver).** In de publieke repo komt alleen een verzonnen voorbeeldklant voor tests en als referentie. Nooit echte klantgegevens.
- **M365-uitlezen (keuze van de schrijver).** De delegated az CLI-token voor Graph leverde bij een klanttenant wel: organisatie, domeinen, licenties, gebruikers, aanmelddatum (beta), MFA-registratie (beta), groepen, apparaten, Conditional Access en directory-rollen. Niet: Intune managedDevices (400), SharePoint-sites (401), security defaults (403). Wat niet lukt, komt in het interview als "niet opgehaald". Geen eigen app-registratie. Werkt GDAP niet, dan valt het hele M365-deel terug op het interview.

## Aan de bouwer overgelaten

- Waar het werkbestand staat (voorstel: `%USERPROFILE%\.claude\it-inventarisatie\<klant>\`, lokaal en buiten elke repo).
- Het precieze schema van `inventarisatie.json` en `rapport.json`.
- Hoe de M365-uitleesstap wordt gebouwd (eigen `.mjs`-script met az CLI-token, naar het voorbeeld van het bestaande M365-uitleesscript).
- Welke headless browser wordt gebruikt voor de fit-check (Edge staat op elke Windows-werkplek).
- Hoe het logo meekomt (als bestand in de skill, bij elke publicatie als asset geüpload).
- De opdeling van SKILL.md in REFERENCE.md en andere bestanden.

## Wijziging 4 november 2026

Op verzoek van Anto bevat het rapport toch een uren- en kostenindicatie: de uren en bedragen uit de offerte. Eerder stond hier "alleen uren".
