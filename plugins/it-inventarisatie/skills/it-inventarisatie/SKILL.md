---
name: it-inventarisatie
description: Maakt met een engineer een IT-inventarisatie van één klantomgeving: leest eerst de offerte, haalt mail, Microsoft 365 (GDAP), IT Glue, Autotask en DNS op, vraagt de gaten uit en levert een rapport in Claude Design op, plus een ingevuld Easywork Basic-project in Autotask. Gebruik bij /it-inventarisatie, een nieuwe klant, een onboarding, een migratie of een opname van een bestaande IT-omgeving.
---

# IT-inventarisatie

Eén inventarisatie gaat altijd over één bedrijf. De skill leest de offerte, haalt zoveel mogelijk zelf op, vraagt
alleen wat ontbreekt en levert een rapport in Claude Design plus een ingevuld onboardingproject in Autotask.
Lezers van het rapport zijn de klant, JUICT en de vertrekkende IT-partij: schrijf neutraal.

**Scripts:** draai ze met `node` vanuit de basismap van deze skill (die krijg je bij het laden van de skill, ook als
de plugin onder `~/.claude/plugins/cache/...` staat). Hieronder staat die map als `<skill>`. De werkmap per klant is
`%USERPROFILE%\.claude\it-inventarisatie\<slug>\` (hieronder `<werkmap>`), nooit een repo.

## Harde regels

1. **Eerst de offerte.** Zonder offerte ga je niet verder, tenzij de engineer bewust kiest om zonder te werken.
2. **Alleen lezen** in Microsoft 365, IT Glue en DNS. De enige schrijfacties: een concept-mail in Outlook (nooit zelf
   versturen) en in Autotask de taken en de PDF-bijlage van het onboardingproject. Allebei pas na een voorvertoning
   en akkoord van de engineer: de mail eerst als volledige tekst in de chat, Autotask eerst als voorvertoning.
3. **Nooit geheimen.** Geen wachtwoord, pincode, PUK, licentiesleutel, WPA-key of token in de chat, het werkbestand,
   `rapport.json`, Autotask of de vault. Ook niet uit vrije tekst, zoals een overdrachtsdocument vol wachtwoorden:
   lees het, neem het niet over, schrijf "staat in IT Glue". De scripts filteren sleutelnamen, niet jouw tekst.
4. **Geen prijzen of bedragen.** Alleen uren.
5. **Technische claims alleen na controle.** Wat een product wel of niet kan (bijvoorbeeld Microsoft) neem je pas op
   als je het in de documentatie hebt nagekeken.
6. **Schrijfregels van JUICT.** Laad de `juict-vault` skill en lees `10-JUICT/schrijfregels.md` en `huisstijl.md` als
   die er is; anders de korte regels in [REFERENCE.md](REFERENCE.md#schrijfregels). Afspraken uit het overleg of de
   offerte beschrijf je als afspraak, niet als tekortkoming. Wijs de vorige partij nooit aan.

## Werkwijze

0. **Hervatten.** `node <skill>/scripts/werkbestand.mjs toon <slug>`. Bestaat het, zoek dan in de mailbox van de
   engineer (Microsoft 365-connector) naar mails sinds `laatsteMailcheck`, werk het werkbestand bij en ga verder bij
   `stap`. De slug is de klantnaam in kleine letters met alleen `[a-z0-9-]` ("Voorbeeld Techniek B.V." wordt
   `voorbeeld-techniek-bv`). Nieuw: `node <skill>/scripts/werkbestand.mjs nieuw "<klantnaam>"`; dat print het pad.
1. **Offerte lezen en scope bevestigen.** Vraag de offerte. Haal klantnaam, Autotask-bedrijf, onderdelen in scope en
   uren per fase eruit. Zet de scope per onderdeel op `true` of `false`; wat de offerte niet noemt blijft `null`.
   Vertaal de uren naar Easywork-taaktitels uit de taakkoppeling in REFERENCE.md, anders zet `plan` geen uren.
   Vat het kort samen, laat het bevestigen en zet het in `offerte`.
2. **Bronnen ophalen**, alleen lezen:
   - DNS en tenant-ID: `node <skill>/scripts/dns-lookup.mjs <domein> [<domein>...]`
   - Microsoft 365 via GDAP: `node <skill>/scripts/m365-lookup.mjs --tenant <guid|domein> --uit <werkmap>/m365.json`.
     Exit 2 met `ok: false` betekent geen GDAP of az-login: meld het en neem M365 mee in het interview. Wat in
     `nietOpgehaald` staat, plus Intune-apparaten, SharePoint en security defaults, hoort in het interview.
   - IT Glue met de `itglue-api` skill (configuraties, netwerken, domeinen, flexible assets, zonder wachtwoorden).
   - Autotask met de `autotask-api` skill (bedrijf, contracten, project).
   - Mail en bijlagen met de Microsoft 365-connector (`outlook_email_search`), alleen in de eigen mailbox.
3. **Interview van de gaten.** Leg per onderdeel naast elkaar wat bekend is en wat ontbreekt, en vraag alleen het
   ontbrekende met AskUserQuestion, één onderdeel tegelijk. Volg de checklist in REFERENCE.md.
4. **Uitvraag-mail.** Wat alleen de klant of de vorige partij weet, gaat in een uitvraag-mail volgens het sjabloon in
   REFERENCE.md. Toon eerst de volledige tekst (onderwerp, aan, inhoud) en maak pas na akkoord het concept via
   `outlook_create_draft`. Versturen doet de engineer.
5. **Rapport vullen.** Schrijf `<werkmap>/rapport.json` volgens het schema (voorbeeld:
   `<skill>/voorbeeld/rapport.voorbeeld.json`). Verwijs naar hoofdstukken, nooit naar paginanummers. Bouwen volgt in
   stap 6, omdat `bouw.mjs` de logo-urls nodig heeft.
6. **Publiceren in Claude Design** met het Artifact-tool:
   1. `quickstart` met `intent: "design"` geeft het Design-type (`type_url`).
   2. Publish met die `type_url`, `title: "IT-inventarisatie <klant>"`, `auto_open: "after_first_write"`, geen bestanden.
   3. Upload `<skill>/assets/juict-logo-pos.svg` en `juict-logo-dia.svg` elk als asset (`url`, `asset: true`,
      `file_path`). Je krijgt per logo een `/_blob/<id>`.
   4. Bouw en controleer de pasvorm:
      `MSYS_NO_PATHCONV=1 node <skill>/scripts/rapport/bouw.mjs --rapport <werkmap>/rapport.json --uit <werkmap>/rapport --logo-pos /_blob/<id-pos> --logo-dia /_blob/<id-dia> --fit`
   5. Publiceer eerst `project/canvas.json` als `file_path` met `files: {"project/Main.dc.html": "project/Main.dc.html"}`
      en `root: "<werkmap>/rapport"` (volledig pad, geen 8.3-kortpad), daarna de overige `project/*.dc.html` in één call.
      Meldt `bouw.mjs` bij een herbouw bestanden die er niet meer zijn, publiceer die met `"project/<bestand>": null`.
   Details, wijzigingen en problemen: REFERENCE.md.
7. **PDF op het project.** De engineer exporteert de PDF in Claude Design (Share, Export, PDF). Zoek het project met
   `node <skill>/scripts/autotask-project.mjs zoek --company <id>` en laat het bevestigen. Geen project: meld het en
   doe niets. Daarna:
   `node <skill>/scripts/autotask-project.mjs bijlage --project <id> --pdf <pad> --werkbestand <werkmap>/inventarisatie.json`
   Toon de voorvertoning, en draai na akkoord opnieuw met `--toepassen`.
8. **Taken invullen.** `node <skill>/scripts/autotask-project.mjs plan --project <id> --werkbestand <werkmap>/inventarisatie.json --uit <werkmap>/plan.json --engineer "<naam>"`
   Toon de voorvertoning. Na akkoord:
   `node <skill>/scripts/autotask-project.mjs toepassen --plan <werkmap>/plan.json --toepassen`
   Zonder `--toepassen` schrijft geen enkel commando naar Autotask.

Werk na elke stap het werkbestand bij en zet de stap met `werkbestand.mjs stap <slug> <stap>`. Dat bewaart het
bestand opnieuw via het geheimenfilter.

Zie [REFERENCE.md](REFERENCE.md) voor de interviewchecklist, de schema's, de taakkoppeling, het mailsjabloon, de
schrijfregels, de M365-beperkingen en de Autotask-feiten.
