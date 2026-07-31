# IT Glue API — Lessons Learned

Bekende valkuilen bij de IT Glue REST API. Voeg nieuwe lessen toe na elk project, met datum, zodat een volgende collega weet hoe hard een uitspraak is.

---

## Wachtwoorden

**Wachtwoordwaarden zijn niet beschikbaar en worden niet opgehaald.** De collectie-endpoints (`GET /passwords?filter[organization_id]=` en `GET /organizations/{id}/relationships/passwords`) geven password-items terug zonder het `password`-veld, ook met `?show_password=true` erbij (geverifieerd 2026-07-21). De individuele resource `GET /passwords/{id}` leverde die waarde in juli 2026 nog wel, maar password-access hoort niet bij wat deze skill doet. De skill blokkeert dat pad daarom codematig: lever de deeplink `https://juict.eu.itglue.com/<org-id>/passwords/<id>` en laat de collega zelf inloggen.

De blokkade is bewust niet configureerbaar. Er is geen flag, geen env var en geen "alleen deze keer". Vraagt iemand toch om een wachtwoordwaarde, dan is het antwoord de deeplink.

**TOTP-seed is niet beschikbaar via de API.** De attributes bevatten alleen `otp-enabled` (boolean), geen seedveld (`otp_secret`, `otp-secret` en `otpSecret` bestaan niet). Onbemande TOTP-flows op basis van IT Glue kunnen dus niet, ook niet met een key die wel password-access heeft.

**Onze key mag passwords lezen maar niet opruimen.** Een verwijderpoging op een password-item gaf 401 "Unauthorized resource access", ook in de bulkvorm (geverifieerd 2026-07-31). Opruimen van password-items is handwerk in de UI. Let op dat PowerShell hierbij geen zichtbare exception gooide: het item bleef simpelweg bestaan.

---

## Velden en filters

**Attribuutsleutels zijn kebab-case, filternamen zijn snake_case.** In de respons heet het `organization-id` en `flexible-asset-type-name`; in de query heet het `filter[organization_id]` en `filter[flexible_asset_type_id]`. Die twee conventies door elkaar halen geeft geen foutmelding maar een lege lijst. Dit is precies wat er in het `assets`-subcommando misging: de filternaam stond in kebab-case, waardoor het type-filter niets deed (gevonden en gefixt 2026-07-31, vastgelegd met een regressietest op de opgevraagde URL).

**`username` en `password` zijn plain, niet kebab-case.** De enige twee uitzonderingen op de kebab-case-regel in de attributes (geverifieerd 2026-07-21).

**`filter[name]` is geen zoekfunctie.** Op 2026-07-31 gaf `?filter[name]=Rouwenhorst` nul resultaten terwijl "Rouwenhorst Installatietechniek B.V." wel bestaat. Geen error, gewoon een lege `data`-array. Op 2026-07-21 gaf een andere term juist meerdere organisaties terug, dus reken ook niet op precies één treffer. Betrouwbaar zoeken doe je zo: alle organisaties pagineren met `page[size]=1000` en client-side matchen, of direct het organisatie-id gebruiken.

Gevolg voor de CLI: `org <deelnaam>` kan leeg terugkomen terwijl de organisatie bestaat. Gebruik de volledige naam of het id. Bij een numeriek argument slaat `resolveOrg()` de zoekcall over en gebruikt het de invoer meteen als id.

**Normaliseer organisatienamen voordat je ze vergelijkt.** Rechtsvormsuffixen verschillen per bron (B.V. tegenover BV tegenover Holding B.V.). `normalizeOrgName()` in `scripts/itglue-lookup.mjs` strips die woorden voor het fuzzy zoeken, maar `pickExactOrg()` vergelijkt eerst strikt mét die woorden. Dat is nodig omdat "JUICT B.V." en "JUICT Holding B.V." anders identiek normaliseren en de verkeerde organisatie als exacte match zou gelden.

**Flexible assets hebben twee filters nodig.** Alleen op `filter[organization_id]` filteren geeft een lege collectie. Combineer altijd met `filter[flexible_asset_type_id]`, en haal de type-ids eerst op met `GET /flexible_asset_types` (geverifieerd 2026-07-31). Dus: eerst de types, dan per type de assets van de organisatie.

**Resourcepaden met meerdere woorden gebruiken underscores.** `flexible_assets`, `flexible_asset_types`, `configuration_types`, `configuration_statuses`, `password_categories`. De streepjesvariant is nergens correct (geverifieerd 2026-07-31).

---

## Stille lege responses

Dit is de rode draad bij IT Glue: fouten komen vaak als een lege lijst met status 200, niet als een foutcode. Een lege lijst is dus geen bewijs dat er niets is.

**Documenten zijn niet beschikbaar via de API.** `GET /organizations/{id}/relationships/documents` geeft 200 met nul items, ook als er wel documenten in de portal staan (geverifieerd 2026-07-31). Handleidingen bijwerken of uitlezen is dus handwerk. Het `docs`-subcommando levert daarom vooral deeplinks op, en mogelijk niets.

**Controleer bij een verdacht lege of korte lijst altijd drie dingen:** staat de filternaam in snake_case, is het filter op zichzelf voldoende (zie flexible assets), en klopt het aantal items met wat `meta` zegt. Pas als die drie kloppen is "leeg" echt leeg.

---

## Paginatie en rate limiting

**Pagineer met `page[number]`, nooit met `links.next`.** IT Glue is JSON:API en stuurt een absolute URL mee in `links.next`. De guard `assertPathAllowed()` accepteert alleen relatieve paden, dus die URL erdoorheen halen geeft een harde fout op elke gepagineerde call. `fetchAllItGlue()` bouwt de query daarom zelf met `page[size]` en `page[number]`.

**De meta-sleutel `next-page` is nog niet live geverifieerd.** `fetchAllItGlue()` stopt zodra `meta["next-page"]` leeg is. Heet die sleutel bij IT Glue anders, dan stopt het doorpagineren stil na de eerste pagina en krijg je een te korte lijst zonder foutmelding. Kijk bij een lijst die korter is dan verwacht dus eerst naar de ruwe `meta` van de call, en werk deze regel bij zodra je de echte sleutelnaam hebt gezien.

**`page[size]=1000` werkt op organizations** (gebruikt op 2026-07-31 om alle organisaties op te halen). De documentatie noemt 1000 als maximum; wat er boven die waarde gebeurt hebben we niet gemeten.

**Zet een bovengrens op het aantal pagina's.** `fetchAllItGlue()` stopt na `maxPages` (default 50) met een expliciete fout in plaats van door te blijven pagineren. Een verkeerd of ontbrekend filter zou anders honderden calls veroorzaken voordat iemand het merkt.

**Haal resources sequentieel op.** De precieze rate limit is niet gemeten, dus ga uit van throttling per API-key en vuur geen parallelle bulk af. Bij een 429 wacht de netwerklaag en probeert het maximaal drie keer opnieuw, met `retry-after` als die header meekomt en anders exponentiële backoff. Of IT Glue die header stuurt weten we nog niet; noteer het zodra je een 429 in het echt ziet.

---

## Auth en Key Vault

**De key is een statische header, geen token.** `x-api-key` plus `Content-Type: application/vnd.api+json` (geverifieerd 2026-07-21). Er is geen refresh en geen expiry-flow, dus een 401 betekent bijna altijd een verkeerde key, een verkeerde regio, of een intrekking.

**Check bij een onverklaarbare 401 eerst de regio.** JUICT zit op `https://api.eu.itglue.com`. Een EU-key tegen de US-base-URL geeft geen behulpzame foutmelding.

**`juict-shared-kv` werkt met access policies, niet met RBAC.** Een managed identity die `itglue-api-key` moet lezen koppel je met `az keyvault set-policy`. Alleen een RBAC-rol toekennen lijkt te werken maar de resolve faalt dan alsnog.

**Bij een 401 of S2S17001 op de `az keyvault`-call: controleer `az account show`.** Een andere sessie kan de default subscription naar een klanttenant hebben gezet, waardoor de JUICT-vault onbereikbaar is. Fix: `az account set --subscription JUICTAzure`.

**Nooit de key echoën.** Niet in een debugregel, niet in een testfixture, niet in een foutmelding. De netwerklaag haalt de key met `redactSecrets()` uit elke responsbody voordat die in een `Error` terechtkomt; houd dat zo als je de foutafhandeling aanpast.

---

## Grenzen van deze skill

**Deze skill is read-only.** De netwerklaag doet uitsluitend GET. Dat is een keuze, niet een beperking van de API: schrijven op IT Glue raakt de bron van waarheid voor het hele team en hoort een bewuste, apart gereviewde actie te zijn.

Twee dingen om te weten mocht je ooit buiten deze skill wel gaan schrijven. Een update op een flexible asset wist elke trait die je niet meestuurt, anders dan bij configuraties waar niet-meegestuurde velden ongemoeid blijven. En tag-velden zijn asymmetrisch: bij lezen komt een tag-trait terug als object met `.values`, bij schrijven verwacht IT Glue een array van resource-ids, en items met `resource-deleted: true` moet je eruit filteren om geen dode referentie terug te schrijven. Beide waargenomen op 2026-07-31.

**Verifieer een endpoint voordat je erop bouwt.** Doe een losse GET en kijk naar de echte respons. Bij IT Glue is dat extra belangrijk omdat een niet-werkend pad zich als een lege lijst voordoet in plaats van als een 404.
