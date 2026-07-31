# IT Glue API Reference

Referentie voor de IT Glue REST API zoals JUICT die gebruikt: base URL, auth, JSON:API-vorm, paginatie, filters en de resources die we read-only aanspreken.

Markering per regel:

| Marker | Betekenis |
|---|---|
| ✅ met datum | Live gemeten tegen de EU-API op die datum. |
| 📄 | Uit de documentatie of uit onze eigen code, nog niet live gemeten. |
| 📄 gecorroboreerd | Niet zelf gemeten, maar dezelfde vorm is in gebruik in een ander werkend JUICT-project. De bron staat erbij, en er staat bij wat er dan nog open blijft. |

**Waar de ✅-regels vandaan komen.** Alle metingen in dit bestand komen uit ad-hoc werk van 2026-07-21 en 2026-07-31, buiten deze skill om, met losse calls en letterlijke blokhaken in de query. De CLI en de client in deze skill hebben zelf nog nooit een live call gedaan: de geplande verificatieronde van 2026-07-31 kon niet lopen omdat het ophalen van de API-key in die omgeving geweigerd werd. Twee dingen volgen daaruit. Geen enkele ✅-regel is gemeten in exact de vorm die de CLI verstuurt, want `URLSearchParams` codeert de blokhaken naar `%5B` en `%5D`. En een ✅ zegt dat het endpoint bestond en zich zo gedroeg, niet dat het subcommando dat het gebruikt end-to-end gedraaid heeft.

Werk een regel bij van 📄 naar ✅ zodra je hem zelf hebt gezien, met de datum erbij.

## Base URL en regio

| Regio | Base URL |
|---|---|
| EU (JUICT) | `https://api.eu.itglue.com` ✅ 2026-07-21 |
| US | `https://api.itglue.com` 📄 |

JUICT zit in de EU-regio. Een key uit de EU-tenant werkt niet op de US-base-URL, dus wissel de base URL nooit om bij een onverklaarbare 401.

Override de base URL met `ITGLUE_BASE_URL`. Voor deeplinks naar de portal geldt `https://juict.eu.itglue.com`, te overriden met `ITGLUE_PORTAL_URL`.

## Authenticatie

De API gebruikt een statische API-key in een header, geen OAuth en geen bearer-token.

| Header | Waarde | Status |
|---|---|---|
| `x-api-key` | de key | ✅ 2026-07-21 |
| `Content-Type` | `application/vnd.api+json` | 📄 |

De headernaam is gemeten. Het contenttype sturen we mee omdat JSON:API dat voorschrijft, maar we hebben niet getest of IT Glue een GET zonder dat header weigert.

De key staat in Azure Key Vault `juict-shared-kv` onder de secretnaam `itglue-api-key` (aangelegd 2026-07-31). Key Vault staat geen underscores toe in secretnamen, dus de env-naam `ITGLUE_API_KEY` wordt de secretnaam `itglue-api-key`.

```bash
az keyvault secret show --vault-name juict-shared-kv --name itglue-api-key --query value -o tsv
```

Let op: `juict-shared-kv` werkt met access policies en niet met RBAC. Een managed identity die deze key moet lezen koppel je dus met `az keyvault set-policy`, anders faalt de resolve terwijl de RBAC-rol er wel op lijkt te staan.

Lokaal kun je `ITGLUE_API_KEY` als env var zetten. De CLI pakt die eerst en valt daarna terug op Key Vault via `az`. In de TypeScript-client is de precedentie omgekeerd: staat `AZURE_KEYVAULT_URL` gezet, dan komt de key altijd uit de vault en wordt `ITGLUE_API_KEY` genegeerd, ook als die gevuld is. Zet de key nooit in een `.env` die gecommit wordt, en echo hem nooit naar de console.

| Env var | Betekenis | Default |
|---|---|---|
| `ITGLUE_API_KEY` | API-key, fallback voor Key Vault | leeg |
| `ITGLUE_BASE_URL` | Base URL | `https://api.eu.itglue.com` |
| `ITGLUE_PORTAL_URL` | Portal voor deeplinks | `https://juict.eu.itglue.com` |
| `ITGLUE_TIMEOUT_MS` | Timeout per request in de TypeScript-client | `20000` |

## JSON:API-vorm

IT Glue levert JSON:API. Een collectie komt terug als een `data`-array, waarin elk item een `id`, een `type` en een `attributes`-object heeft. De velden zitten dus altijd een niveau diep, niet op het item zelf.

```json
{
  "data": [
    {
      "id": "12345",
      "type": "configurations",
      "attributes": {
        "name": "SRV-DC01",
        "organization-id": 7,
        "configuration-type-name": "Server",
        "primary-ip": "10.0.0.5"
      }
    }
  ],
  "meta": { "current-page": 1, "total-count": 1 }
}
```

Attribuutsleutels zijn kebab-case (`organization-id`, `password-category-name`, `otp-enabled`), met `username` en `password` als uitzondering: die zijn plain. ✅ 2026-07-21

Belangrijk verschil om te onthouden: attribuutsleutels in de respons zijn kebab-case, maar filternamen in de query zijn snake_case. `filter[organization_id]` is correct, `filter[organization-id]` niet. Dat verschil heeft ons al een keer een stille lege lijst gekost.

`id` is een string in de respons, ook bij numerieke ids. Vergelijk dus niet met `===` tegen een number.

Het `meta`-object in het voorbeeld hierboven is overgenomen uit de documentatie 📄 en niet gemeten. Zie "Paginatie", want de sleutelnamen daarin zijn precies het openstaande risico.

## Paginatie

Paginatie gaat via `page[size]` en `page[number]`.

| Parameter | Wat het doet | Status |
|---|---|---|
| `page[size]` | items per pagina | `1000` werkt op `organizations` ✅ 2026-07-31; gedocumenteerd maximum 1000 📄 |
| `page[number]` | paginanummer | 📄, ook de aanname dat hij 1-based is |

De meegeleverde scripts gebruiken standaard `page[size]=100` en lopen door tot er geen volgende pagina meer is, met een harde stop op `maxPages` (default 50) zodat een verkeerd filter niet duizenden calls veroorzaakt.

De `meta`-sleutel waarop de scripts stoppen is `next-page` 📄. Dit is de belangrijkste openstaande aanname in deze skill: heet die sleutel in werkelijkheid anders, dan stopt het doorpagineren stil na pagina 1 en krijg je een te korte lijst zonder foutmelding.

Controleer dat met `--raw`. Die vlag print de ruwe JSON:API-body van de eerste pagina, inclusief `meta` en `links`, en zet de paginagrootte op 2 zodat er bij een collectie van drie items of meer echt een volgende pagina is:

```bash
node itglue-lookup.mjs configs <org-id> --raw
```

Wat je in die output wilt zien: welke sleutel in `meta` naar de volgende pagina verwijst, en of het aantal items in `data` klopt met wat `meta` als totaal noemt. `--raw` werkt op `org`, `configs`, `contacts`, `docs` en `assets`, en is bewust geblokkeerd op `password-link` en op `get`.

IT Glue stuurt als JSON:API ook een `links`-object mee met een absolute `links.next`. Gebruik die niet. De guard in onze scripts accepteert uitsluitend relatieve paden (zie "Padregels"), dus pagineer altijd zelf met `page[number]`.

De blokhaken in `page[size]` en `filter[...]` worden door `URLSearchParams` percent-gecodeerd naar `%5B` en `%5D`. Of IT Glue die vorm net zo leest als letterlijke haken is een aanname 📄: al onze metingen zijn met letterlijke haken gedaan, terwijl de scripts de gecodeerde vorm versturen.

Let op hoe je die aanname controleert, want een call die slaagt bewijst hier niets. Herkent de server de parameters niet, dan negeert hij ze en krijg je een 200 met de default paginagrootte en een ongefilterde lijst. Het bewijs zit in de inhoud van de `--raw`-uitvoer: `data` moet exact twee items bevatten, want dan is `page[size]=2` gehonoreerd, en elk item moet bij de opgevraagde organisatie horen (`organization-id` in de attributes), want dan is het filter gehonoreerd. Zie je meer dan twee items, of een item van een andere organisatie, dan worden de gecodeerde haken genegeerd. Kies er wel een organisatie bij met minstens drie configuraties, anders zegt een korte `data` niets. Dat weet je vooraf op twee manieren: `meta.total-count` staat in dezelfde `--raw`-uitvoer, of je draait eerst `node itglue-lookup.mjs configs <org-id>` en telt de rijen in de tabel.

## Filters

Filters gaan als `filter[<veld>]=<waarde>` in de querystring, in snake_case.

`filter[organization_id]` is het werkpaard: bijna elke resource die aan een organisatie hangt, filter je daarmee. Gemeten op passwords en op flexible assets ✅ 2026-07-21; voor de andere resources is het dezelfde conventie maar niet apart getest.

`filter[name]` is niet betrouwbaar voor deelstrings. Op 2026-07-31 gaf `?filter[name]=Rouwenhorst` nul resultaten terwijl "Rouwenhorst Installatietechniek B.V." wel bestaat, zonder foutmelding. Op 2026-07-21 gaf een andere zoekterm juist meerdere organisaties terug. Reken er dus niet op dat je met een stuk van de naam iets vindt. Betrouwbaar zoeken doe je door alle organisaties te pagineren met `page[size]=1000` en client-side te matchen (`node itglue-lookup.mjs get "organizations?page[size]=1000"`), of door direct het organisatie-id te gebruiken. De CLI zegt dit ook in de foutmelding: nul treffers op een naam levert geen kandidatenlijst maar deze uitleg plus die twee routes.

Voor flexible assets zijn twee filters nodig: alleen op `organization_id` filteren geeft een lege collectie. Combineer altijd `filter[organization_id]` met `filter[flexible_asset_type_id]`, en haal de type-ids eerst op met `node itglue-lookup.mjs get "flexible_asset_types"`. ✅ 2026-07-21

Namen normaliseren blijft nodig omdat rechtsvormsuffixen per bron verschillen (B.V., BV, Holding). Zie `normalizeOrgName()` en `pickExactOrg()` in `scripts/itglue-lookup.mjs`: die vergelijken eerst strikt en vallen daarna terug op de genormaliseerde naam, zodat "JUICT B.V." en "JUICT Holding B.V." niet per ongeluk als dezelfde organisatie gelden.

## Het organisatie-id vinden

Bijna elk subcommando wil een organisatie. Er zijn twee routes, en het verschil is de moeite waard omdat `filter[name]` geen deelstrings matcht.

Ken je de volledige naam, gebruik dan `org` met die naam tussen quotes. Ken je het id al, geef dat dan direct mee aan `configs`, `contacts`, `docs`, `assets` of `password-link`: een numeriek argument wordt daar als id gebruikt zonder zoekcall (`resolveOrg()`).

```bash
node itglue-lookup.mjs org "Rouwenhorst Installatietechniek B.V."
node itglue-lookup.mjs configs 7
```

Let op dat die numerieke sluiproute niet voor `org` zelf geldt. `org 7` zoekt op de naam "7" en geeft "Geen resultaten.", want `org` doet een naamzoekopdracht en gaat niet via `resolveOrg()`.

Weet je de exacte naam niet, dan is zoeken op een deel van de naam geen optie: `filter[name]` matcht geen deelstrings en `org <deelnaam>` komt leeg terug. Twee routes werken dan wel. Zoek de organisatie op `https://juict.eu.itglue.com` en lees het id uit de URL van de organisatiepagina; met dat id werkt elk subcommando. Of haal de lijst in de terminal op en filter zelf op wat je wel weet:

```bash
node itglue-lookup.mjs get "organizations?page[size]=1000"
```

Dat is precies de melding die `resolveOrg()` geeft bij nul treffers, zodat je niet in een leeg kandidatenlijstje blijft hangen.

## Resources

| Resource | Pad | Status |
|---|---|---|
| Organisatie op naam | `GET /organizations?filter[name]=<naam>` | ✅ 2026-07-21 |
| Alle organisaties | `GET /organizations?page[size]=1000` | ✅ 2026-07-31 |
| Configuraties per organisatie | `GET /configurations?filter[organization_id]=<id>` | 📄 |
| Configuratietypes | `GET /configuration_types` | ✅ 2026-07-31 |
| Configuratiestatussen | `GET /configuration_statuses` | ✅ 2026-07-31 |
| Contacten per organisatie | `GET /contacts?filter[organization_id]=<id>` | 📄 |
| Locaties per organisatie | `GET /locations?filter[organization_id]=<id>` | 📄 |
| Flexible asset types | `GET /flexible_asset_types` | ✅ 2026-07-21 |
| Flexible assets | `GET /flexible_assets?filter[organization_id]=<id>&filter[flexible_asset_type_id]=<id>` | ✅ 2026-07-21 |
| Documenten via de organisatie | `GET /organizations/<id>/relationships/documents` | ✅ 2026-07-21, geeft 200 met nul items |
| Documenten top-level | `GET /documents?filter[organization_id]=<id>` | 📄 |
| Wachtwoorden per organisatie | `GET /passwords?filter[organization_id]=<id>` | ✅ 2026-07-21 |
| Wachtwoorden via de organisatie | `GET /organizations/<id>/relationships/passwords` | ✅ 2026-07-21 |
| Wachtwoordcategorieën | `GET /password_categories` | 📄 |

De resourcenaam voor flexible assets is `flexible_assets` met een underscore, niet `flexible-assets`. Datzelfde geldt voor `flexible_asset_types` (✅ 2026-07-21) en voor `configuration_types` en `configuration_statuses` (✅ 2026-07-31): alle resourcepaden met meerdere woorden gebruiken underscores. Voor `password_categories` is dat dezelfde conventie, maar niet gemeten.

Dat het `configurations`-pad bestaat is een zijproduct van ander werk op 2026-07-31. Niet gemeten is de leesvariant met het org-filter en de vorm van de attributes die daaruit komt, vandaar 📄 op die regel.

Dat een resource bestaat betekent niet dat de inhoud er is. Documenten zijn het duidelijke voorbeeld: het relationships-pad geeft netjes 200, maar de collectie is leeg terwijl er in de portal wel documenten staan. Zie LESSONS.md.

## Een resource zonder subcommando opvragen: `get`

De CLI heeft vaste subcommando's voor de resources die we vaak nodig hebben. Voor de rest is er `get`, met een relatief pad:

```bash
node itglue-lookup.mjs get "flexible_asset_types"
node itglue-lookup.mjs get "locations?filter[organization_id]=7"
node itglue-lookup.mjs get "organizations?page[size]=1000"
```

Zet het pad tussen quotes, anders eet je shell de blokhaken en de `&`. Vijf dingen om te weten:

- Het pad gaat door dezelfde `assertPathAllowed()` als elke andere call, dus een absolute URL wordt geweigerd (zie "Padregels") en de individuele password-resource ook.
- Daarbovenop weigert `get` élk pad dat de passwords-resource raakt, ook de collectie. Een vrij pad zou daar de ruwe attributes van password-items printen en zo de whitelist omzeilen die in de rest van de skill alleen naam en link doorlaat. Zoek je een wachtwoord-item, gebruik `password-link`.
- Die extra grens loopt over het pad én over de `include`-parameter. Elk padsegment wordt zonder punt-suffix vergeleken, dus `passwords.json` of `passwords.` telt als `passwords`: een server die `.json` als formaat leest zou die vorm anders naar dezelfde resource kunnen routeren. En een `include` die de passwords-resource noemt gaat eruit, ook komma-gescheiden tussen andere waarden (`include=passwords,configurations`), als geneste relatie (`include=organization.passwords`) en in andere casing, want een include zet de gerelateerde items in het `included`-deel van de body die `get` ruw print. Andere queryparameters blijven buiten die controle: `configurations?filter[name]=passwords-server` verandert niet welke resource terugkomt en is dus toegestaan.
- De uitvoer is de ruwe body, door dezelfde redactie als `--raw`. `--raw` zelf heeft geen zin op `get` en wordt daar geweigerd.
- Het pad gaat byte-identiek de deur uit, dus met de letterlijke blokhaken die je typt. Daarmee is `get` het gereedschap om de `%5B`/`%5D`-aanname te meten: leg de uitvoer van `get "configurations?filter[organization_id]=<id>&page[size]=2"` naast die van `configs <org-id> --raw`, die de gecodeerde vorm verstuurt.

Deze route is bedoeld voor de openstaande punten hieronder. Blijkt een pad structureel nuttig, geef het dan een eigen subcommando met een nette uitvoer.

## Wachtwoorden

Deze skill haalt geen wachtwoordwaarden op. Dat is beleid en geen technische beperking: password-access staat voor deze toepassing uit, en een wachtwoordwaarde in een transcript of logbestand is een incident. De blokkade geldt dus onafhankelijk van wat de API zou teruggeven.

Wat wel mag: het collectie-endpoint aanspreken om het juiste item te vinden op naam. Wat eruit komt is de naam van het item plus een deeplink naar de portal, zodat de collega zelf inlogt en de waarde daar bekijkt:

```
https://juict.eu.itglue.com/<org-id>/passwords/<password-id>
```

Die vorm is 📄 gecorroboreerd: wij hebben hem niet in de portal nagekeken, maar hij is in gebruik in een ander JUICT-project dat werkt. In `huntress-bulk-onboarding` leest `extractOrgIdFromPasswordUrl()` (`src/itglue.ts`) het organisatie-id uit precies deze vorm, en de bijbehorende test (`test/itglue.test.ts`, regel 172) doet dat met echte 16-cijferige IT Glue-id's. Die URL komt daar uit de `--password-url`-vlag, waar iemand hem uit de portal plakt, dus de vorm komt niet alleen uit onze eigen code. Wat nog open staat: dat een door `password-link` gegenereerde link ook echt op het bedoelde item uitkomt, hebben we zelf niet gezien. Daarom staat het punt nog in de tabel onderaan.

De documenten-deeplink `https://juict.eu.itglue.com/<org-id>/docs/<document-id>` die het `docs`-subcommando per rij meegeeft staat er zwakker voor: die vorm is in dat project niet terug te vinden en blijft een kale 📄.

`password-link` vereist een zoekterm. Dat is een keuze en geen API-beperking: zonder term zou het commando naam en link van élk password-item van de organisatie tonen. Dat is geen waarde, maar itemnamen vertellen zelf al welke systemen en accounts er zijn.

Het collectie-endpoint geeft de waarde ook niet mee. Password-items kwamen terug zonder het `password`-veld, ook met `?show_password=true` erbij. ✅ 2026-07-21

De individuele resource `/passwords/<id>` is codematig geblokkeerd in `scripts/itglue-lookup.mjs` en in de TypeScript-client, en `--raw` is geblokkeerd op `password-link` zodat een ruwe dump de naam-en-link-whitelist niet kan omzeilen. Die blokkades zijn niet met een parameter uit te zetten en dat is de bedoeling.

`otp-enabled` is een boolean en er is geen seedveld. De TOTP-seed is dus niet via de API beschikbaar, en een onbemande TOTP-flow op basis van IT Glue kan niet. ✅ 2026-07-21

## Padregels

Alle IT Glue-calls in deze skill lopen door `assertPathAllowed()`. Die functie keurt een pad goed of gooit; er is geen doorlaatstand. Dit weigert hij:

- Elke vorm die de URL-parser als `/passwords/<id>` ziet. Dat is niet alleen het letterlijke pad, maar ook de varianten met een dubbele slash, met `%2F` of `%5C` als scheidingsteken, met een backslash, met een tab, newline of carriage return ertussen, met percent-gecodeerde letters in het woord zelf (`/pass%77ords/1` decodeert bij de server naar het verboden pad), en met een punt-suffix op het segment (`/passwords.json/1`, `/passwords./1`): padsegmenten worden zonder dat suffix vergeleken, omdat een server die `.json` als formaat leest bij dezelfde resource uit kan komen.
- Elke querystring met `show_password` erin, ook percent-gecodeerd.
- Elke absolute URL, ook als de host onze eigen IT Glue-API is. De netwerklaag plakt de API-key als header op elk request, dus een ingesloten host mag de controle nooit kunnen omleiden.
- Elk pad met tekens buiten `A-Z a-z 0-9 _ - . /` in het padgedeelte. De querystring valt buiten deze controle, dus filterwaarden met een spatie, een `%` of een `&` blijven gewoon werkbaar.
- Elk pad dat niet als URL te parsen is. De guard faalt dicht: wat we niet kunnen beoordelen, laten we niet door.

Toegestaan blijven de collectie en de relationships-variant: `/passwords`, `/passwords/` en `/organizations/<id>/relationships/passwords`. Dat is wat de guard toestaat; het `get`-subcommando is strenger en weigert die drie ook, plus een `include` op de passwords-resource, omdat een vrij pad daar de ruwe attributes zou printen (zie "Een resource zonder subcommando opvragen").

Twee praktische gevolgen:

Lever paden altijd relatief aan, bijvoorbeeld `/configurations?filter[organization_id]=7` of `configurations?page[size]=50`. De base URL komt uit de netwerklaag. Een absolute URL wordt geweigerd, ook de goede.

Pagineer met `page[number]` en nooit met de absolute `links.next` uit de JSON:API-respons. Die door de guard halen geeft een harde fout op elke gepagineerde call.

## Foutresponses en rate limiting

Fouten komen als JSON:API-foutobject terug, met een `errors`-array waarin per fout een `title`, `detail` en `status` staan 📄. De netwerklaag van deze skill gooit bij elke niet-2xx status een `Error` met de statuscode en de responsbody erin, en haalt daarbij eerst de API-key uit de tekst (`redactSecrets`) zodat een foutmelding nooit de key kan bevatten.

Een 200 met een niet-JSON body hoort daar ook bij. Beide netwerklagen lezen de body eerst als tekst en parseren die zelf, zodat een HTML-foutpagina van een proxy geen kale `SyntaxError` oplevert (die noemt geen status en geen resource, en zou een ongeredacteerd stuk body in de melding zetten). Wat je in plaats daarvan krijgt: `IT Glue API gaf geen JSON terug op <pad> (status <status>)`, met de eerste 300 tekens van de body erachter, geredacteerd.

De TypeScript-client geeft elk request een timeout mee (`DEFAULT_TIMEOUT_MS`, 20 seconden, te overrulen per call met `timeoutMs` of globaal met `ITGLUE_TIMEOUT_MS`). Zonder timeout houdt een hangende verbinding een Next.js-route onbeperkt vast. Een retry na een 429 krijgt zijn eigen verse timeout. De CLI heeft die timeout niet: die draait interactief en is met ctrl-C te stoppen.

Bij een 429 wacht de netwerklaag en probeert het opnieuw, maximaal drie keer. Hij gebruikt de `retry-after`-header als die er is en anders exponentiële backoff (1, 2, 4 seconden). Of IT Glue die header daadwerkelijk meestuurt is nog niet gemeten 📄, vandaar de fallback.

De precieze rate limit hebben we niet gemeten. Ga uit van throttling per API-key en vuur geen parallelle bulk af: haal resources sequentieel op, net als bij Autotask.

## Wat nog niet gemeten is

De 📄-markers in de tekst hierboven zijn leidend; deze tabel is niet uitputtend en noemt de punten die je met een concreet commando kunt afvinken. De verificatieronde van 2026-07-31 kon niet lopen omdat het ophalen van de key in die omgeving geweigerd werd.

| Open punt | Commando dat het afvinkt |
|---|---|
| Naam van de meta-sleutel voor de volgende pagina | `node itglue-lookup.mjs configs <org-id> --raw` en kijken welke sleutel in `meta` naar pagina 2 wijst |
| Of `page[number]` bestaat en 1-based is | `node itglue-lookup.mjs configs <org-id> --raw` geeft pagina 1; leg die `data` naast `node itglue-lookup.mjs get "configurations?filter[organization_id]=<id>&page[size]=2&page[number]=2"` |
| Werkt `documents` als top-level resource | `node itglue-lookup.mjs docs <org-id> --raw` |
| Respons-shape van contacts en configurations | `node itglue-lookup.mjs contacts <org-id> --raw` en `configs <org-id> --raw` |
| Klopt het aantal items met `meta` | zit in dezelfde `--raw`-output: `data.length` naast het totaal in `meta` |
| Geeft het passwords-collectie-endpoint items terug of een 403 | `node itglue-lookup.mjs password-link <org-id> "a"`. De zoekterm is verplicht en filtert alleen client-side op de itemnaam, dus de call gaat altijd uit: "IT Glue API fout 403" betekent dat het endpoint weigert, rijen betekenen dat het items levert. Komt er "Geen resultaten.", dan slaagde de call maar bevatte geen naam die term; probeer een andere letter. `--raw` is hier geblokkeerd |
| Vorm van de password-deeplink `https://juict.eu.itglue.com/<org-id>/passwords/<password-id>` 📄 gecorroboreerd | de vorm is in gebruik in `huntress-bulk-onboarding` met echte 16-cijferige id's (zie "Wachtwoorden"), dus dit is geen kale aanname meer. Wat nog open staat is de eigen observatie: open één link uit de uitvoer van `password-link` in de portal en kijk of hij op het juiste wachtwoord-item uitkomt. Het hele antwoord op een wachtwoordvraag hangt hiervan af |
| Vorm van de documenten-deeplink `https://juict.eu.itglue.com/<org-id>/docs/<document-id>` 📄 | open één link uit de uitvoer van `docs <org-id>` in de portal en kijk of hij op het juiste document uitkomt |
| Bestaat `/locations` met het org-filter | `node itglue-lookup.mjs get "locations?filter[organization_id]=<id>"` |
| Bestaat `/password_categories` | `node itglue-lookup.mjs get "password_categories"` |
| Wat er boven `page[size]=1000` gebeurt | `node itglue-lookup.mjs get "organizations?page[size]=2000"`: kapt hij af op 1000, geeft hij een fout, of komt alles terug |
| Accepteert IT Glue `%5B`/`%5D` net als letterlijke haken | `node itglue-lookup.mjs configs <org-id> --raw` op een organisatie met minstens drie configuraties, en dan de inhoud narekenen: `data` moet exact twee items hebben en elk item moet die `organization-id` dragen. Meer items of een vreemde organisatie betekent dat de haken genegeerd worden. Een 200 op zich is geen bewijs. Hoe weet je vooraf dat een organisatie er drie heeft: `meta.total-count` staat in dezelfde `--raw`-uitvoer, of draai eerst `configs <org-id>` en tel de rijen. Tegenproef met de letterlijke haken: `node itglue-lookup.mjs get "configurations?filter[organization_id]=<id>&page[size]=2"` |
| Eist IT Glue het `Content-Type`-header op een GET | niet met deze CLI te doen: die stuurt het header altijd mee. Dit blijft een losse call met bijvoorbeeld curl of Invoke-RestMethod, en dan zonder de key in je shell-history |
| Komt `retry-after` mee bij een 429 | pas zichtbaar onder load; noteer het zodra je een 429 ziet |

## Bronnen

De officiële documentatie staat op `https://api.itglue.com/developer/`. Dat is het startpunt voor resources en velden die hier niet staan.

Een community-OpenAPI-spec staat in `github.com/jmaddington/ITG-Glue-OpenAPI`, bestand `itgapi.yaml` op branch `main`. Die spec is hier niet gebundeld omdat de repo geen licentie heeft en herdistributie in deze publieke repo daarmee niet is toegestaan. Haal hem dus zelf op als je hem nodig hebt.

Onze eigen meetpunten staan in LESSONS.md, met datum. Vul die aan zodra je iets nieuws tegenkomt.
