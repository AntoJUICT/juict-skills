# IT Glue API — Lessons Learned

Bekende valkuilen bij de IT Glue REST API. Voeg nieuwe lessen toe na elk project, met datum, zodat een volgende collega weet hoe hard een uitspraak is.

**Waar deze lessen vandaan komen.** Alles met een datum is gemeten tijdens ad-hoc werk op 2026-07-21 en 2026-07-31, buiten deze skill om, met losse calls en letterlijke blokhaken in de query. De CLI en de client in deze skill hebben zelf nog nooit een live call gedaan: de geplande verificatieronde van 2026-07-31 kon niet lopen omdat het ophalen van de API-key in die omgeving geweigerd werd. Geen enkele les is dus geverifieerd in exact de vorm die de scripts versturen, want die coderen de blokhaken naar `%5B` en `%5D`. Zonder datum betekent: overgenomen uit de documentatie of uit onze eigen code. REFERENCE.md heeft onderaan een tabel met de openstaande punten en het commando dat ze afvinkt.

---

## Wachtwoorden

**Wachtwoordwaarden halen we niet op. Dat is beleid, geen technische aanname.** Password-access staat voor deze toepassing uit en een wachtwoordwaarde in een transcript of logbestand is een incident. De skill blokkeert de individuele password-resource daarom codematig, onafhankelijk van wat de API zou teruggeven: er is geen flag, geen env var en geen "alleen deze keer". Vraagt iemand toch om een wachtwoordwaarde, dan is het antwoord de deeplink `https://juict.eu.itglue.com/<org-id>/passwords/<id>`, en zoekt de collega het daar zelf op.

`--raw` is om dezelfde reden geblokkeerd op `password-link`. Een ruwe dump van password-items zou precies de whitelist omzeilen die alleen naam en deeplink doorlaat.

**Het collectie-endpoint geeft de waarde niet mee.** `GET /passwords?filter[organization_id]=` en `GET /organizations/{id}/relationships/passwords` gaven password-items terug zonder het `password`-veld, ook met `?show_password=true` erbij (gemeten 2026-07-21). Het collectie-endpoint is dus bruikbaar om een item te vinden, niet om iets te lezen wat er niet hoort te staan.

**Wat we in juli 2026 zagen, als geschiedenis.** Op 2026-07-21 leverde de individuele resource `GET /passwords/{id}` de waarde wel. Dat staat hier als historie en niet als iets om op te bouwen: het pad is geblokkeerd, en of het vandaag nog zo werkt weten we niet en gaan we niet nakijken.

**TOTP-seed is niet beschikbaar via de API.** De attributes bevatten alleen `otp-enabled` (boolean), geen seedveld (`otp_secret`, `otp-secret` en `otpSecret` ontbreken), gemeten 2026-07-21. Onbemande TOTP-flows op basis van IT Glue kunnen dus niet.

**Onze key mag password-items niet opruimen.** Een verwijderpoging gaf 401 "Unauthorized resource access", ook in de bulkvorm (gemeten 2026-07-31). Opruimen is handwerk in de UI. Let op dat PowerShell hierbij geen zichtbare exception gooide: het item bleef simpelweg bestaan.

---

## Velden en filters

**Attribuutsleutels zijn kebab-case, filternamen zijn snake_case.** In de respons heet het `organization-id` en `flexible-asset-type-name`; in de query heet het `filter[organization_id]` en `filter[flexible_asset_type_id]`. Die twee conventies door elkaar halen geeft geen foutmelding maar een lege lijst. Dat is precies wat er in het `assets`-subcommando misging: de filternaam stond in kebab-case, waardoor het type-filter niets deed (gevonden en gefixt 2026-07-31, vastgelegd met een regressietest op de opgevraagde URL).

**`username` en `password` zijn plain, niet kebab-case.** De enige twee uitzonderingen op de kebab-case-regel in de attributes (gemeten 2026-07-21).

**`filter[name]` is geen zoekfunctie.** Op 2026-07-31 gaf `?filter[name]=Rouwenhorst` nul resultaten terwijl "Rouwenhorst Installatietechniek B.V." wel bestaat. Geen error, gewoon een lege `data`-array. Op 2026-07-21 gaf een andere term juist meerdere organisaties terug, dus reken ook niet op precies één treffer. Betrouwbaar zoeken doe je zo: alle organisaties pagineren met `page[size]=1000` en client-side matchen, of direct het organisatie-id gebruiken.

**Het numerieke organisatie-id is een sluiproute, maar niet bij `org`.** Geef je een getal aan `configs`, `contacts`, `docs`, `assets` of `password-link`, dan gebruikt `resolveOrg()` dat direct als id en gaat er geen zoekcall uit. Het `org`-subcommando doet dat níet: dat gaat niet via `resolveOrg()` maar zoekt altijd op naam, dus `org 7` zoekt naar een organisatie die "7" heet en geeft "Geen resultaten.".

Gevolg: `org <deelnaam>` kan leeg terugkomen terwijl de organisatie bestaat, en er is geen subcommando dat alle organisaties opsomt. Ken je de exacte naam niet, zoek de organisatie dan op `https://juict.eu.itglue.com` en lees het id uit de URL; daarna werkt elk ander subcommando met dat id. Wil je het in de terminal, dan is een losse GET op `/organizations?page[size]=1000` met client-side filteren de route.

**Normaliseer organisatienamen voordat je ze vergelijkt.** Rechtsvormsuffixen verschillen per bron (B.V. tegenover BV tegenover Holding B.V.). `normalizeOrgName()` in `scripts/itglue-lookup.mjs` strips die woorden voor het fuzzy zoeken, maar `pickExactOrg()` vergelijkt eerst strikt mét die woorden. Dat is nodig omdat "JUICT B.V." en "JUICT Holding B.V." anders identiek normaliseren en de verkeerde organisatie als exacte match zou gelden.

**Flexible assets hebben twee filters nodig.** Alleen op `filter[organization_id]` filteren geeft een lege collectie. Combineer altijd met `filter[flexible_asset_type_id]`, en haal de type-ids eerst op met `GET /flexible_asset_types` (gemeten 2026-07-21). Dus: eerst de types, dan per type de assets van de organisatie.

**Resourcepaden met meerdere woorden gebruiken underscores.** `flexible_assets` en `flexible_asset_types` (gemeten 2026-07-21), `configuration_types` en `configuration_statuses` (gemeten 2026-07-31). De streepjesvariant is nergens correct. Voor `password_categories` volgen we dezelfde conventie, maar dat pad is niet gemeten.

---

## Stille lege responses

Dit is de rode draad bij IT Glue: fouten komen vaak als een lege lijst met status 200, niet als een foutcode. Een lege lijst is dus geen bewijs dat er niets is.

Diezelfde stilte werkt ook de andere kant op. Herkent de server een parameter niet, dan negeert hij hem en krijg je een 200 met een ongefilterde lijst op de default paginagrootte. Een geslaagde call is daarom nooit op zichzelf bewijs dat je filter of je paginagrootte is aangekomen; reken de inhoud na.

**Documenten komen leeg terug via het relationships-pad.** `GET /organizations/{id}/relationships/documents` gaf 200 met nul items, ook terwijl er documenten in de portal stonden (gemeten 2026-07-21). Of de top-level variant `GET /documents?filter[organization_id]=` het beter doet is niet gemeten; die gebruikt het `docs`-subcommando en staat in REFERENCE.md nog als openstaand punt. Ga er tot die tijd van uit dat handleidingen uitlezen via de API niet werkt, maar schrijf het niet af zonder de tweede route te hebben geprobeerd.

**Controleer bij een verdacht lege of korte lijst altijd drie dingen:** staat de filternaam in snake_case, is dat filter op zichzelf voldoende (zie flexible assets), en klopt het aantal items met wat `meta` zegt. Dat laatste zie je met `--raw`. Pas als die drie kloppen is "leeg" echt leeg.

---

## Paginatie en rate limiting

**Pagineer met `page[number]`, nooit met `links.next`.** IT Glue is JSON:API en stuurt een absolute URL mee in `links.next`. De guard `assertPathAllowed()` accepteert alleen relatieve paden, dus die URL erdoorheen halen geeft een harde fout op elke gepagineerde call. `fetchAllItGlue()` bouwt de query daarom zelf met `page[size]` en `page[number]`.

**De meta-sleutel `next-page` is nog niet gemeten.** `fetchAllItGlue()` stopt zodra `meta["next-page"]` leeg is. Heet die sleutel bij IT Glue anders, dan stopt het doorpagineren stil na de eerste pagina en krijg je een te korte lijst zonder foutmelding. Dit is het enige openstaande punt dat een stille datafout kan geven in plaats van een zichtbare fout, dus vink het als eerste af:

```bash
node itglue-lookup.mjs configs <org-id> --raw
```

`--raw` print de ruwe body van de eerste pagina met `meta` en `links` erin, en gebruikt paginagrootte 2 zodat er bij drie items of meer echt een volgende pagina bestaat. Zie je een andere sleutelnaam, pas dan `fetchAllItGlue()` aan in beide bestanden (`itglue-lookup.mjs` en `itglue-client.ts`) en werk deze regel bij.

**`page[size]=1000` werkt op organizations** (gebruikt op 2026-07-31 om alle organisaties op te halen). De documentatie noemt 1000 als maximum; wat er boven die waarde gebeurt hebben we niet gemeten. Of `page[number]` 1-based is, is óók niet gemeten, alleen aangenomen.

**Zet een bovengrens op het aantal pagina's.** `fetchAllItGlue()` stopt na `maxPages` (default 50) met een expliciete fout in plaats van door te blijven pagineren. Een verkeerd of ontbrekend filter zou anders honderden calls veroorzaken voordat iemand het merkt.

**Haal resources sequentieel op.** De precieze rate limit is niet gemeten, dus ga uit van throttling per API-key en vuur geen parallelle bulk af. Bij een 429 wacht de netwerklaag en probeert het maximaal drie keer opnieuw, met `retry-after` als die header meekomt en anders exponentiële backoff. Of IT Glue die header stuurt weten we nog niet; noteer het zodra je een 429 in het echt ziet.

---

## Auth en Key Vault

**De key is een statische header, geen token.** `x-api-key` is gemeten (2026-07-21). `Content-Type: application/vnd.api+json` sturen we mee omdat JSON:API dat voorschrijft, maar of IT Glue een GET zonder dat header weigert is niet getest. Er is geen refresh en geen expiry-flow, dus een 401 betekent bijna altijd een verkeerde key, een verkeerde regio, of een intrekking.

**Check bij een onverklaarbare 401 eerst de regio.** JUICT zit op `https://api.eu.itglue.com`. Een EU-key tegen de US-base-URL geeft geen behulpzame foutmelding.

**`juict-shared-kv` werkt met access policies, niet met RBAC.** Een managed identity die `itglue-api-key` moet lezen koppel je met `az keyvault set-policy`. Alleen een RBAC-rol toekennen lijkt te werken maar de resolve faalt dan alsnog.

**Bij een 401 of S2S17001 op de `az keyvault`-call: controleer `az account show`.** Een andere sessie kan de default subscription naar een klanttenant hebben gezet, waardoor de JUICT-vault onbereikbaar is. Fix: `az account set --subscription JUICTAzure`.

**Nooit de key echoën.** Niet in een debugregel, niet in een testfixture, niet in een foutmelding. De netwerklaag haalt de key met `redactSecrets()` uit elke responsbody voordat die in een `Error` terechtkomt, en `--raw` doet hetzelfde met de body die hij print. Houd dat zo als je daar iets aanpast.

---

## Grenzen van deze skill

**Deze skill is read-only.** De netwerklaag doet uitsluitend GET. Dat is een keuze, niet een beperking van de API: schrijven op IT Glue raakt de bron van waarheid voor het hele team en hoort een bewuste, apart gereviewde actie te zijn.

Twee dingen om te weten mocht je ooit buiten deze skill wel gaan schrijven. Een update op een flexible asset wist elke trait die je niet meestuurt, anders dan bij configuraties waar niet-meegestuurde velden ongemoeid blijven. En tag-velden zijn asymmetrisch: bij lezen komt een tag-trait terug als object met `.values`, bij schrijven verwacht IT Glue een array van resource-ids, en items met `resource-deleted: true` moet je eruit filteren om geen dode referentie terug te schrijven. Beide waargenomen op 2026-07-21.

**Verifieer een endpoint voordat je erop bouwt.** Doe een losse GET en kijk naar de echte respons. Bij IT Glue is dat extra belangrijk omdat een niet-werkend pad zich als een lege lijst voordoet in plaats van als een 404.
