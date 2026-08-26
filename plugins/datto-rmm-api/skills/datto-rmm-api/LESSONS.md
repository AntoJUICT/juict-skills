# Datto RMM — valkuilen en lessen

Alles hieronder is gemeten tegen ons eigen merlot-account, tenzij er expliciet bij staat dat het
uit de spec komt.

## URL-opbouw

**De token-endpoint zit buiten `/api`, de rest erbinnen.** Authenticeren doe je op
`https://merlot-api.centrastage.net/auth/oauth/token`, maar een API-call gaat naar
`https://merlot-api.centrastage.net/api/v2/...`. Bouw je de base URL één keer op inclusief `/api`,
dan krijg je bij het inloggen een 404 die eruitziet als een verkeerd platform.

**Het platform staat in de hostnaam en verschilt per account.** Wij zitten op `merlot`. Een
voorbeeld uit de documentatie of van een collega staat vaak op `vidal`, `pinotage` of `syrah`; dat
werkt niet met onze keys. De officiële Swagger UI-link die rondgaat wijst naar `vidal`, en dat is
níet onze omgeving.

**De OpenAPI-spec is publiek opvraagbaar, maar op precies één pad.** `GET /api/v3/api-docs` geeft
zonder token de volledige spec van de draaiende build (53 endpoints). `/api/swagger.json` en
`/api/v2/api-docs` geven een 401, `/v2/api-docs` en `/v3/api-docs` een 404. Dat pad is de snelste
manier om te controleren of een endpoint bestaat voordat je het probeert.

## Paginatie

**`page` is nul-geïndexeerd.** De `nextPageUrl` na de eerste pagina bevat `page=1`, niet `page=2`.
Wie zelf begint te tellen bij 1 slaat de eerste pagina over en merkt dat pas als de aantallen niet
kloppen.

**Volg `nextPageUrl` en tel niet zelf.** Die URL is absoluut en wijst naar onze eigen host.
Controleer de origin voordat je hem volgt: de netwerklaag plakt het bearer token op elk request,
dus een URL naar een andere host zou dat token weggeven.

**`totalCount` is er niet altijd.** Sites leveren hem wel, open alerts niet. Een voortgangsbalk of
een "zijn we er al"-check op dat veld werkt dus voor de ene collectie wel en voor de andere niet.

**250 is zowel de default als het maximum.** Bevestigd met `GET /v2/system/pagination`. Een grotere
`max` meegeven levert geen foutmelding op, je krijgt gewoon 250.

**`activity-logs` doet alles anders.** Dat endpoint gebruikt `size` in plaats van `max`, en het
negeert `max` stil: met `?max=2` kregen we 28 records terug, met `?size=2` netjes 2. De paginatie is
bovendien cursor-gebaseerd via `searchAfter` in plaats van een paginanummer. Een generieke
paginatiefunctie die overal `max=` opplakt, werkt hier dus wel (via `nextPageUrl`) maar met een
paginagrootte die je niet in de hand hebt.

## Data-inconsistenties

**Tijdstempels komen in drie vormen.** Alerts leveren `timestamp` in milliseconden
(`1787643495000`), activity-logs leveren `date` in seconden met decimalen (`1787645215.44`), en
device-velden als `lastSeen` zijn ISO-strings. Gooi je alles door dezelfde `new Date()`, dan landt
een activity-log in 1970 zonder dat er iets faalt. Een getal onder `1e12` kan geen
millisecondenstempel van deze eeuw zijn, dus daarop kun je onderscheiden.

**Het alerttype staat niet waar je het verwacht.** `alertMonitorInfo` bevat alleen `sendsEmails` en
`createsTicket`. De soort alert zit in `alertContext["@class"]` (`comp_script_ctx`,
`perf_disk_usage_ctx`, `eventlog_ctx`, ...) en de leesbare tekst in `alertContext.samples`. De
sleutels in `samples` verschillen per alerttype en bij `perf_disk_usage` is het object vaak leeg,
dus pak de eerste waarde in plaats van een vaste sleutel te veronderstellen.

**Datto's eigen typefout: `bilingEmail`.** In `GET /v2/account` heet het veld onder `descriptor`
`bilingEmail`, met één l. Corrigeer die spelling niet in je code, dan vind je niets.

**`descriptor` is een object, geen string.** In `GET /v2/account` zit daar `deviceLimit`,
`timeZone` en `bilingEmail` in. Rechtstreeks printen geeft `[object Object]`.

## User defined fields

**Er zijn er 300, niet 30.** De spec definieert `udf1` tot en met `udf300`, aaneengesloten, en een
device-respons levert alle 300 sleutels terug (lege velden als `null`). "Dertig" was een aanname uit
het geheugen die de spec meteen weersprak; de eerste versie van deze skill weigerde daardoor
`udf31` en hoger. Als een UDF-schrijfactie afketst op een validatiefout, kijk dan eerst of de
validatie klopt en niet of het veld bestaat.

**Een UDF-POST is een gerichte update, geen volledige vervanging.** Gemeten op 2026-08-25 met een
testdevice waarvan alle UDF's leeg waren: eerst `udf299` en `udf300` samen gezet, daarna een POST
met alleen `udf299`. `udf300` bleef staan. Niet-meegestuurde velden worden dus niet gewist, wat
betekent dat een tagging-script dat alleen `udf20` zet een speedtest-waarde in `udf9` met rust laat.

Wat wél gebeurt: een veld dat je noemt wordt zonder waarschuwing overschreven. Lees het device
eerst als je niet zeker weet of er al iets in staat; de CLI toont dat in de preview onder
"Overschrijft".

**Leegmaken kan met een lege string.** `udf299=` zet het veld leeg, en het komt daarna als `null`
terug in de respons (niet als lege string).

## Sites en Autotask

**Sites dragen hun Autotask-koppeling zelf.** `autotaskCompanyId` en `autotaskCompanyName` staan
direct op het site-object. Je hebt dus geen eigen mappingtabel nodig om een Datto-site aan een
Autotask-klant te koppelen. Niet elke site heeft ze ingevuld, dus val terug op naam-matching en
niet andersom.

## Quick jobs

**Het commando blijft in klare tekst op de machine staan.** De component *Run Ad Hoc Command
(PowerShell 2-5) [WIN]* schrijft alles wat je in `usrInput` meegeeft weg naar
`C:\ProgramData\CentraStage\Temp\AdHocPSCmd-<timestamp>.ps1`, en dat bestand blijft na afloop
staan. Stuur je er een token, wachtwoord of connectiestring doorheen, dan ligt die op de schijf van
de klant, ook nadat de job is afgerond. Overschrijf de bestanden aan het eind van dezelfde job en
controleer dat daarna in een losse job. Let op bij die controle: zoek je op `eyJ` om een JWT te
vinden, dan matcht het controlecommando zichzelf, want ook dat wordt gearchiveerd.

**De jobvariabele is ruimer dan je zou gokken.** 16.195 tekens in `usrInput` kwamen ongeschonden
aan, gemeten door de machine de lengte terug te laten rapporteren. Een ARM-access-token van ruim
16 kB past er dus in; afkapping is niet de eerste verdachte als een lang commando misgaat.

## Netwerk

**De API laat af en toe een losse call stranden op "fetch failed".** Geen HTTP-status, maar een
transportfout uit undici; dezelfde call werkt er direct daarna wel. Bij een paginatieloop van vijf
calls breekt dat de hele uitdraai af en mis je stil een deel van de resultaten. Een korte retry op
transportfouten (niet op HTTP-fouten, niet op timeouts) lost het op.

## Gevaarlijke endpoints

**`POST /v2/user/resetApiKeys` trekt onze eigen API-keys in.** Eén aanroep breekt elke integratie
die op deze keys draait, en herstellen kan alleen door in de portal handmatig nieuwe keys te maken
en de Key Vault bij te werken. Deze skill blokkeert dat endpoint onvoorwaardelijk, in de CLI en in
de client, zonder ontsnappingsvlag.

**Een quick job draait code op de machine van een klant.** `PUT /v2/device/{uid}/quickjob` is geen
metadata-wijziging maar een uitvoeropdracht. Daarom is elke niet-GET in deze skill een dry-run
tenzij `--confirm` meegegeven wordt, en toont de preview eerst hostname, site en online-status.

**Alerts muten kan niet meer.** `POST /v2/alert/{uid}/mute` en `/unmute` staan nog in de spec, maar
de beschrijving zegt letterlijk dat het sinds Datto RMM 8.9.0 niet meer werkt. Bouw er niets op.

## Rate limits

600 lees- en 600 schrijfverzoeken per glijdend venster van 60 seconden, plus een eigen limiet per
schrijfoperatie (`site-update` bijvoorbeeld 100). `GET /v2/system/request_rate` geeft de actuele
stand, inclusief wat je al verbruikt hebt. Alle 1249 devices ophalen kost 5 calls en ongeveer 12
seconden, dus je zit niet snel aan de grens; een loop die per device een call doet wel.

## Key Vault

De secrets heten `datto-rmm-api-url`, `datto-rmm-api-key` en `datto-rmm-api-secret` in
`juict-shared-kv`. Die vault gebruikt access policies en geen RBAC: een nieuwe managed identity
koppel je met `az keyvault set-policy --secret-permissions get list`, anders faalt de keyvaultref
bij het starten van de container terwijl de RBAC-rol er wel op lijkt te staan.

Zet de key of het secret nooit met `--value` op de commandoregel als je het kunt vermijden; met
`az keyvault secret set --file` blijft de waarde uit je shell-historie. Trim het bestand eerst: een
trailing newline uit een teksteditor komt gewoon mee in de secretwaarde en geeft bij het ophalen van
een token een 401 die eruitziet als een verkeerde key.
