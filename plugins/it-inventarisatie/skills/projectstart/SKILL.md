---
name: projectstart
description: "Projectstart na akkoord op de offerte. Zet vanuit één Autotask-project een kick-off-presentatie in de stijl van de verkooppresentatie, een inventarisatierapport, een Mini PVA, een interne briefing en een uitvraag-mail klaar, en vult die later aan met nieuwe notities en bijlagen. Gebruik bij /projectstart, een kick-off na akkoord, of een nieuw antwoord van de klant op een lopend project."
---

# Projectstart

Eén run gaat altijd over één Autotask-project. De enige invoer is het projectnummer. De skill leest alle bijlagen en
notities van het project, zet de feiten in één dossier en maakt daaruit de documenten, zodat ze elkaar niet
tegenspreken. De kick-off is de eerste meeting na akkoord en meteen ook de technische kick-off.

**Mappen.** `<skill>` is de basismap van deze skill, `<it>` die van it-inventarisatie (`<skill>/../it-inventarisatie`).
`<werkmap>` is `%USERPROFILE%\.claude\projectstart\<projectId>\`: alleen een cache, de stand staat in Autotask.
`<scratch>` is de scratchpad van de sessie (volledig pad, geen 8.3-kortpad). Alles wat je publiceert, bouw je in
`<scratch>`. Scripts draai je met `node` vanuit de repo of plugin; exacte commando's en valkuilen: [REFERENCE.md](REFERENCE.md).

## Harde regels

1. **Niets verzinnen.** Geen namen, datums of besluiten die niet in de bronnen staan. Een open veld blijft `null` en
   staat in presentatie, PVA en mail zichtbaar open ("bepalen we vandaag", "nog te bepalen").
2. **Secrets alleen uit Key Vault** (`juict-shared-kv`, dan `ju-hermes-emmanuel`, via `haalCredentials`). Nooit printen
   of in dossier, notitie, document, artifact of chat zetten. Een overdrachtsdocument met wachtwoorden lees je, maar je
   neemt niets over: schrijf "staat in IT Glue".
3. **Elke Autotask-schrijfactie eerst als voorvertoning.** Pas na akkoord opnieuw met `--toepassen`. Verwijderen kan
   via de API niet, dus een fout blijft staan. Een tweede run maakt niets dubbel (titel en bestandsnaam).
4. **Geen bedragen** (`€`, euro, `EUR`, `500,-`) in presentatie, rapport of uitvraag-mail. Het PVA en de briefing zijn intern; daar
   mogen financiële afspraken in.
5. **Nooit versturen.** De uitvraag-mail blijft een concept. Niets schrijven in de omgeving van de klant.
6. **Schrijfregels.** Nederlands, jij en jullie, actief en concreet. Geen em-dash. Geen afkortingen: "Business
   Central" en "Microsoft 365" voluit, MFA alleen nadat "multifactor" er al staat. Geen "raming" maar "offerte". Geen
   buzzwords (ontzorgen, naadloos, robuust, synergie). Afspraken als afspraak, niet als tekortkoming. Wijs een vorige
   partij nooit aan. Is de `juict-vault` skill er, lees dan ook `10-JUICT/schrijfregels.md`.
7. **Bron bij elk feit en elke afspraak.** Elke afspraak heeft een `bron`. Financiële afspraken krijgen
   `financieel: true` en staan in het dossier zoals ze letterlijk in een bron staan. De offerte is leidend: een
   financiële term die alleen in een mail staat of afwijkt van de offerte krijgt `controleren: true` en komt in het
   PVA bij Open punten ("controleren tegen de offerte"), niet bij de afspraken. Voeg nooit tarieven, kortingen of
   voorwaarden toe die niet in de offerte staan. Neem over waarop een korting precies geldt (bijvoorbeeld alleen op de
   werkelijk bestede uren, niet op een vaste prijs) en hoe de looptijd er staat ("bestaande overeenkomst N maanden
   verlengd" is iets anders dan "N maanden vanaf de startdatum"). Een feit dat de offerte nog als open vraag had (een
   nieuwe naam van de rechtspersoon, een overstapdatum) is pas bevestigd met een bron: zet die in `doelBron`,
   `hardeDatum.bron` of `besluiten[].bron` (mail met datum of "kick-off <datum>"). Zonder bron toont het PVA het
   als "uitgangspunt, nog te bevestigen" en zet het bij Open punten.
8. **Geen sjabloontekst en geen lege tabellen.** Geen instructies als "Voer een impactanalyse uit" of "Beschrijf hoe"
   in een document, en geen tabel zonder rijen. `pva.mjs` weigert zulke uitvoer. Een onbekende datum is "nog te
   plannen" (nooit "n.t.b.") en staat ook bij Open punten.

## Starten (nog geen dossier op het project)

1. **Ophalen.** `node <skill>/scripts/dossier.mjs laad --project <id> --uit <werkmap>/dossier.json`. Meldt het "Nog
   geen dossier", ga dan verder; anders naar Aanvullen. Daarna `node <skill>/scripts/bronnen.mjs --project <id>` en
   `node <skill>/scripts/tekst.mjs <werkmap>/bronnen`. Bijlagen onder `overgeslagen` in het manifest (een link of
   een bijlage zonder inhoud) zijn niet gelezen: noem ze aan het eind van de run.
2. **Dossier schrijven.** Lees elke bron: de `.txt` naast mails en Word-bestanden, PDF's (de offerte) met de
   Read-tool, notities uit `<werkmap>/bronnen.json`. Schrijf `<werkmap>/dossier.json` volgens het schema in
   REFERENCE.md (voorbeeld: `<skill>/voorbeeld/dossier.voorbeeld.json`). Zet de ids van alle gelezen bronnen in
   `verwerkt`. Laat bevestigen:
   - de klantnaam in Autotask (`klant.autotask`) en de naam die de klant zelf gebruikt (`klant.weergave`);
   - welke mensen van de klant bij de kick-off zijn (alleen zij staan in `contacten`, plus contacten van externe
     partijen) en wie het dagelijkse aanspreekpunt is;
   - wie van JUICT in het projectteam zit (`team`). Neem de accountmanager niet vanzelf op.
3. **GDAP en controleren.** `node <it>/scripts/gdap-check.mjs --tenant <domein>` op het hoofddomein van de klant (of
   de tenant-ID als die in de bronnen staat). Zet `status`, `gecontroleerd`, `ontbreekt` en `domein` in `gdap` van het
   dossier en meld de `melding` in de chat, ook als het `actief` is. Is het niet `actief`, dan komt het vanzelf bij de
   Open punten van het PVA en in de briefing, en bij `geen-toegang` als verzoek om goedkeuring in de opvolgmail. Gaat
   de klant naar een nieuwe tenant, zeg dan dat de controle over de huidige omgeving gaat. Betekenis per status:
   REFERENCE.md van it-inventarisatie, GDAP controleren.
   Daarna `node <skill>/scripts/dossier.mjs controleer <werkmap>/dossier.json`, net zo lang tot het geldig is.
4. **Rapport.** `node <it>/scripts/dns-lookup.mjs <domein>...` op de domeinen uit de bronnen. Dan
   `node <it>/scripts/werkbestand.mjs van-dossier <werkmap>/dossier.json` en verder volgens it-inventarisatie stap 5
   en 6 (`rapport.json`, `bouw.mjs`, publiceren in Claude Design), met `--uit <scratch>/rapport`. Controleer daarna
   `node <skill>/scripts/samenhang.mjs --dossier <werkmap>/dossier.json --rapport <pad naar rapport.json>`. Het rapport
   is leidend: pas het dossier aan tot er geen afwijkingen meer zijn. Zet de url in `artifacts.rapport`.
   **Word-bijlage.** Maak van hetzelfde `rapport.json` ook een Word-bestand, zodat het rapport naast de link ook als
   bijlage op het project staat. Bepaal N zoals bij het PVA (hoogste N van `IT-inventarisatie <klant.autotask> v<N>.docx` in
   `<werkmap>/bronnen.json` of de bijlagelijst, plus 1; anders 1) en draai:
   `node <it>/scripts/rapport/word.mjs --rapport <pad naar rapport.json> --uit <scratch>/rapport.html --logo <it>/assets/juict-logo-pos.svg`, daarna
   `powershell -NoProfile -ExecutionPolicy Bypass -File <it>/scripts/rapport/naar-word.ps1 -Bron <scratch>/rapport.html -Doel "<werkmap>/IT-inventarisatie <klant.autotask> v<N>.docx" -Pdf "<werkmap>/IT-inventarisatie <klant.autotask> v<N>.pdf"`.
   De PDF blijft lokaal in de werkmap (niet naar Autotask): hij gaat als bijlage mee met de opvolgmail (stap 7).
   Zet het .docx-bestand als bijlage in `plan.json` (zelfde vorm als het PVA, stap 7).
5. **Presentatie** (alleen als `artifacts.presentatie` nog leeg is).
   `node <skill>/scripts/presentatie/bouw.mjs --dossier <werkmap>/dossier.json --uit <scratch>/kickoff [--datum jjjj-mm-dd]`.
   Publiceer met het Artifact-tool als gewone HTML-pagina: `file_path` = de gemaakte `Kick-off <klant>.html`, `files`
   = de inhoud van `files.json` (server-side kopieën uit Marts deck), `icon: "presentation"`. Geen Design-canvas.
   Zet de url in `artifacts.presentatie`.
6. **Mini PVA.** Het plan van aanpak in de stijl en opbouw van de kick-off: voorblad met de kleurband van het deck,
   inhoudsopgave, hoofdstukken in de volgorde van de presentatie, Financiële afspraken met bron, Open punten en een
   tabel voor de handtekeningen. Bepaal eerst N: zoek in `<werkmap>/bronnen.json` (of de bijlagelijst van het
   project) de bijlagen `Mini PVA <klant> v<N>.docx`, neem de hoogste N en tel er 1 bij op. Staat er nog geen, dan is N 1.
   `node <skill>/scripts/pva/pva.mjs --dossier <werkmap>/dossier.json --uit <werkmap>/pva.html --versie <N>`, daarna
   `powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/pva/naar-pva.ps1 -Bron <werkmap>/pva.html -Doel "<werkmap>/Mini PVA <klant> v<N>.docx" -Pdf <werkmap>/pva-controle.pdf`.
   Lees de PDF en loop de Open punten na: los op wat je uit de bronnen kunt halen en draai opnieuw.
7. **Briefing en uitvraag-mail.**
   - `node <skill>/scripts/teksten.mjs briefing --dossier <werkmap>/dossier.json --presentatie <url> --rapport <url> --plan <werkmap>/plan.json`
   - Zet het PVA en het Word-rapport als bijlage in `plan.json` (zie REFERENCE.md). Met `--presentatie` en `--rapport` voegt `briefing` zelf
     link-bijlagen toe aan het plan (`Kick-off presentatie <klant>` en `IT-inventarisatie <klant>`), zodat de twee
     artifacts op het project staan naast het PVA. Zonder url voor het rapport of de presentatie komt er geen link.
   - `node <skill>/scripts/teksten.mjs mail --dossier <werkmap>/dossier.json --json <werkmap>/mail.json [--plan <werkmap>/plan.json]`
     en toon de volledige tekst. De mail is kort: bedankt, het rapport als PDF-bijlage met het verzoek het zorgvuldig door te
     nemen, en in een paar punten de open besluiten, wat de klant aanlevert, de technische vragen en de afspraken met
     de klant (`intern: false`). De mail bevat nooit een rapport-url (de klant kan claude.ai niet openen); `--rapport` wordt
     bij `mail` genegeerd. Is er geen rapport, gebruik dan `--zonder-rapport`. Als notitie verdwijnen de `**`.
   - Na akkoord op de tekst maak je het concept met Outlook desktop:
     `powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/outlook-concept.ps1 -Json <werkmap>/mail.json -Bijlage "<werkmap>/IT-inventarisatie <klant.autotask> v<N>.pdf"`.
     Controleer in de uitvoer map Concepten en de bijlage. Is Outlook desktop er niet: Microsoft 365-connector
     (`outlook_create_draft`) zonder bijlage en zeg erbij dat de PDF zelf bijgevoegd moet worden, of laat de tekst in de chat.
     Nooit versturen.
   - `node <skill>/scripts/autotask-schrijf.mjs --project <id> --plan <werkmap>/plan.json`: toon de voorvertoning, en
     na akkoord hetzelfde commando met `--toepassen`.
8. **Stand bewaren.** `node <skill>/scripts/dossier.mjs bewaar --project <id> --dossier <werkmap>/dossier.json`, na
   akkoord met `--toepassen`.

## Aanvullen (er staat al een dossier op het project)

1. `dossier.mjs laad` (zie stap 1), kopieer het naar `<werkmap>/dossier.oud.json`, draai `bronnen.mjs` en `tekst.mjs`
   opnieuw en daarna `node <skill>/scripts/dossier.mjs nieuw --dossier <werkmap>/dossier.json --bronnen <werkmap>/bronnen.json`.
   `nieuw` laat de eigen uitvoer van de skill al weg: dossierbijlagen, `Mini PVA <klant> v<N>.docx`,
   `IT-inventarisatie <klant> v<N>.docx` en notities die met "Projectstart:" beginnen.
   Draai ook `gdap-check.mjs` opnieuw (zie stap 3 van Starten) en werk `gdap` in het dossier bij.
2. **Niets nieuw** (`aantal` is 0 en `gdap.status` is gelijk gebleven): stop en zeg dat er niets nieuws op het
   project staat. Geen nieuwe dossierversie, geen PVA, geen notitie. Is alleen de GDAP-stand veranderd, ga dan door
   naar stap 4.
3. Lees alleen de nieuwe bronnen, zet hun ids in `verwerkt`, werk het dossier bij en draai `controleer`.
   **Na de kick-off:** zet het verslag of de uitkomsten als notitie op het project en draai de skill opnieuw. Verwerk
   besluiten (`besluit`, `beslisser`, `bron` "kick-off <datum>"), nieuwe datums (`uiterlijk`, `datum`, start en eind
   van fases) en bevestigde feiten (`doelBron`, `hardeDatum.bron`) in het dossier, zodat de planning in het PVA
   klopt en de Open punten kleiner worden.
4. `node <skill>/scripts/teksten.mjs wijzigingen --oud <werkmap>/dossier.oud.json --nieuw <werkmap>/dossier.json --plan <werkmap>/plan.json`.
   Meldt het "Geen wijzigingen", dan is de inhoud van het dossier gelijk gebleven: geen nieuw rapport en geen nieuwe
   PVA-versie, ga door naar stap 6.
5. Wel wijzigingen: bouw het rapport opnieuw en publiceer het naar dezelfde url, draai `samenhang.mjs`, maak een
   nieuw Word-rapport (Word-bijlage in stap 4 van Starten, nieuwe versie, met ook de nieuwe PDF via `-Pdf`) en een nieuwe PVA-versie (stap 6 van Starten) en zet beide in het plan. Daarna `autotask-schrijf.mjs` met voorvertoning en
   `--toepassen`. **De presentatie nooit opnieuw:** die maakt alleen de eerste run, daarna past de projectleider hem
   met de hand aan.
6. `dossier.mjs bewaar`, voorvertoning en daarna `--toepassen`. De nieuwe ids in `verwerkt` maken een nieuwe versie.

## Bekende beperking

De stand van het rapport (`rapport.json` en het werkbestand van it-inventarisatie) staat nog lokaal op de pc waarop
het rapport is gebouwd. Een tweede engineer kan dossier, PVA en notities bijwerken, maar het rapport opnieuw
publiceren kan alleen met de oorspronkelijke werkmap. Heb je die niet, laat het rapport dan staan en meld dat.

## Na elke run

- Zeg: "Wil je iets blijvend vastleggen, zet het als notitie op het project." Handwerk in rapport en PVA verdwijnt bij
  de volgende run, een notitie niet.
- Herinner eraan dat de presentatie en het rapport privé zijn tot je ze deelt: Share, met de JUICT-organisatie, met
  bewerkrechten. De skill kan dat niet zelf.
- Noem wat open staat (velden met `null`, open besluiten) en wat je niet hebt kunnen schrijven.

## Wat de presentatie wel en niet is

Maximaal 10 slides in Marts stijl, met dezelfde route (01 tot 05) als de verkoop. Hoofdlijnen, geen technische
details: die staan in het rapport en de briefing voor de techniek. Klantcontacten alleen met naam, plus "dagelijks
aanspreekpunt". Wat de klant moet aanleveren staat er op hoofdlijnen; de details komen in de opvolgmail, en de
presentatie verwijst daarnaar en niet naar het rapport. Support, noodnummer en het overlegkanaal staan erin. De
laatste slide toont alleen de volgende stappen.
