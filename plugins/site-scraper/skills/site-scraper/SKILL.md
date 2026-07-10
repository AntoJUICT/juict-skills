---
name: site-scraper
description: Brengt de technische opbouw van een website in kaart, ook achter een login — framework, volledige sitemap/routes en backend API-endpoints — en schrijft dit naar rapportbestanden. Gebruik wanneer de gebruiker /site-scraper typt, of vraagt om een site te inspecteren, de structuur/architectuur te achterhalen, alle pagina's/routes in kaart te brengen, of een ingelogde site te onderzoeken. NIET voor losse pagina-scrapes (gebruik firecrawl-scrape) of websearch.
---

# Site Scraper

Onderzoekt hoe een website is opgebouwd via een ingelogde browsersessie (Firecrawl). Levert architectuur, sitemap en API-endpoints — de blauwdruk, niet de inhoud/persoonsdata.

## Vooraf altijd checken (verplicht)

1. **Autorisatie:** Is dit de eigen site van de gebruiker of een omgeving waarvoor expliciete toestemming bestaat? Zo niet: stop.
2. **Login-methode:** vraag de URL en het type login (e-mail/wachtwoord, Google/O365/SSO, MFA).
3. **Credentials, veilige optie eerst:** bied aan dat de gebruiker zelf inlogt via de **interactieve live-view** (link komt uit de eerste `interact`-call) i.p.v. credentials in de chat te plakken. Pas als de gebruiker daarvoor kiest credentials via de prompt invullen, en achteraf wachtwoordwissel adviseren.
4. **Scope:** maak onderscheid tussen **structuur** (architectuur/sitemap/API — standaard oké) en **content/persoonsdata** (apart bevestigen, AVG; verwijs naar ingebouwde exports van de app).

## Workflow

Gebruik de `firecrawl interact` CLI. Alle exacte commando's staan in [REFERENCE.md](REFERENCE.md).

1. **Scrape de inlogpagina** met een profiel (sessiebehoud): `firecrawl scrape "<url>" --profile <naam>`
2. **Log in** via een `interact --prompt` (of laat de gebruiker de live-view gebruiken).
3. **Detecteer framework + scripts + interne links** via `interact --node` met `page.evaluate`.
4. **Sitemap — de kerntruc:** bij een SPA staat de complete route-tabel in de JS-bundle. Fetch alle eigen-origin scripts en regex op `path:"..."`. Dit geeft alle routes zonder pagina-voor-pagina crawl. De router-chunk kan een misleidende naam hebben (bij Officient zat hij in `pusher.*.js`).
5. **API-endpoints:** hang een `page.on('request')`-listener op (filter `xhr`/`fetch`), navigeer door enkele hoofdpagina's, verzamel `origin+pathname`.
6. **Schrijf rapporten** naar `<werkdir>/<site>-analyse/`: `ARCHITECTUUR.md`, `SITEMAP.md`, `API-ENDPOINTS.md`.
7. **Sluit de sessie:** `firecrawl interact stop`. Bied aan het profiel op te schonen en herinner aan wachtwoordwissel als credentials gedeeld zijn.

## Valkuilen

- **`waitUntil:'networkidle'` loopt vast** op sites met Pusher/Intercom/websockets. Gebruik `domcontentloaded` + een vaste `waitForTimeout` (≈3500ms).
- **Sandbox-syntax:** `interact --code` verwacht een **expressie**, geen function body met `return`. Gebruik `JSON.stringify(await page.evaluate(() => (...)))`. Flags zijn `--node`/`--python`/`--bash` (niet `--language`).
- **Lange navigaties** kunnen de timeout (max 300s) raken; beperk het aantal routes per call of draai in de achtergrond.

## Wat je niet krijgt

Server-side code en database blijven afgeschermd. Alleen wat de API teruggeeft is zichtbaar. "Alle inhoud" downloaden = grote hoeveelheid (vaak persoons)data via dynamische `:id`-routes; doe dat alleen gericht en met expliciete bevestiging.
