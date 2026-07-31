# IT Glue API Reference

Referentie voor de IT Glue REST API zoals JUICT die gebruikt: base URL, auth, JSON:API-vorm, paginatie, filters en de resources die we read-only aanspreken.

Markering per regel:

| Marker | Betekenis |
|---|---|
| ✅ met datum | Live gemeten tegen de EU-API op die datum. |
| 📄 | Uit de documentatie of uit onze eigen code, nog niet live gemeten. |

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

Wat je in die output wilt zien: welke sleutel in `meta` naar de volgende pagina verwijst, en of het aantal items in `data` klopt met wat `meta` als totaal noemt. `--raw` werkt op `org`, `configs`, `contacts`, `docs` en `assets`, en is bewust geblokkeerd op `password-link`.

IT Glue stuurt als JSON:API ook een `links`-object mee met een absolute `links.next`. Gebruik die niet. De guard in onze scripts accepteert uitsluitend relatieve paden (zie "Padregels"), dus pagineer altijd zelf met `page[number]`.

De blokhaken in `page[size]` en `filter[...]` worden door `URLSearchParams` percent-gecodeerd naar `%5B` en `%5D`. Of IT Glue die vorm net zo leest als letterlijke haken is een aanname 📄: al onze metingen zijn met letterlijke haken gedaan, terwijl de scripts de gecodeerde vorm versturen.

Let op hoe je die aanname controleert, want een call die slaagt bewijst hier niets. Herkent de server de parameters niet, dan negeert hij ze en krijg je een 200 met de default paginagrootte en een ongefilterde lijst. Het bewijs zit in de inhoud van de `--raw`-uitvoer: `data` moet exact twee items bevatten, want dan is `page[size]=2` gehonoreerd, en elk item moet bij de opgevraagde organisatie horen (`organization-id` in de attributes), want dan is het filter gehonoreerd. Zie je meer dan twee items, of een item van een andere organisatie, dan worden de gecodeerde haken genegeerd. Kies er wel een organisatie bij met minstens drie configuraties, anders zegt een korte `data` niets.

## Filters

Filters gaan als `filter[<veld>]=<waarde>` in de querystring, in snake_case.

`filter[organization_id]` is het werkpaard: bijna elke resource die aan een organisatie hangt, filter je daarmee. Gemeten op passwords en op flexible assets ✅ 2026-07-21; voor de andere resources is het dezelfde conventie maar niet apart getest.

`filter[name]` is niet betrouwbaar voor deelstrings. Op 2026-07-31 gaf `?filter[name]=Rouwenhorst` nul resultaten terwijl "Rouwenhorst Installatietechniek B.V." wel bestaat, zonder foutmelding. Op 2026-07-21 gaf een andere zoekterm juist meerdere organisaties terug. Reken er dus niet op dat je met een stuk van de naam iets vindt. Betrouwbaar zoeken doe je door alle organisaties te pagineren met `page[size]=1000` en client-side te matchen, of door direct het organisatie-id te gebruiken.

Voor flexible assets zijn twee filters nodig: alleen op `organization_id` filteren geeft een lege collectie. Combineer altijd `filter[organization_id]` met `filter[flexible_asset_type_id]`, en haal de type-ids eerst op met `GET /flexible_asset_types`. ✅ 2026-07-21

Namen normaliseren blijft nodig omdat rechtsvormsuffixen per bron verschillen (B.V., BV, Holding). Zie `normalizeOrgName()` en `pickExactOrg()` in `scripts/itglue-lookup.mjs`: die vergelijken eerst strikt en vallen daarna terug op de genormaliseerde naam, zodat "JUICT B.V." en "JUICT Holding B.V." niet per ongeluk als dezelfde organisatie gelden.

## Het organisatie-id vinden

Bijna elk subcommando wil een organisatie. Er zijn twee routes, en het verschil is de moeite waard omdat `filter[name]` geen deelstrings matcht.

Ken je de volledige naam, gebruik dan `org` met die naam tussen quotes. Ken je het id al, geef dat dan direct mee aan `configs`, `contacts`, `docs`, `assets` of `password-link`: een numeriek argument wordt daar als id gebruikt zonder zoekcall (`resolveOrg()`).

```bash
node itglue-lookup.mjs org "Rouwenhorst Installatietechniek B.V."
node itglue-lookup.mjs configs 7
```

Let op dat die numerieke sluiproute niet voor `org` zelf geldt. `org 7` zoekt op de naam "7" en geeft "Geen resultaten.", want `org` doet een naamzoekopdracht en gaat niet via `resolveOrg()`.

Weet je de exacte naam niet, dan helpt de CLI je niet verder: er is geen subcommando dat alle organisaties opsomt, en zoeken op een deel van de naam werkt niet. Pak dan de portal. Zoek de organisatie op `https://juict.eu.itglue.com` en lees het id uit de URL van de organisatiepagina; met dat id werkt elk subcommando. Wil je liever een lijst in de terminal, dan is een losse GET op `/organizations?page[size]=1000` de route, met client-side filteren op wat je wel weet.

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

## Wachtwoorden

Deze skill haalt geen wachtwoordwaarden op. Dat is beleid en geen technische beperking: password-access staat voor deze toepassing uit, en een wachtwoordwaarde in een transcript of logbestand is een incident. De blokkade geldt dus onafhankelijk van wat de API zou teruggeven.

Wat wel mag: het collectie-endpoint aanspreken om het juiste item te vinden op naam. Wat eruit komt is de naam van het item plus een deeplink naar de portal, zodat de collega zelf inlogt en de waarde daar bekijkt:

```
https://juict.eu.itglue.com/<org-id>/passwords/<password-id>
```

Het collectie-endpoint geeft de waarde ook niet mee. Password-items kwamen terug zonder het `password`-veld, ook met `?show_password=true` erbij. ✅ 2026-07-21

De individuele resource `/passwords/<id>` is codematig geblokkeerd in `scripts/itglue-lookup.mjs` en in de TypeScript-client, en `--raw` is geblokkeerd op `password-link` zodat een ruwe dump de naam-en-link-whitelist niet kan omzeilen. Die blokkades zijn niet met een parameter uit te zetten en dat is de bedoeling.

`otp-enabled` is een boolean en er is geen seedveld. De TOTP-seed is dus niet via de API beschikbaar, en een onbemande TOTP-flow op basis van IT Glue kan niet. ✅ 2026-07-21

## Padregels

Alle IT Glue-calls in deze skill lopen door `assertPathAllowed()`. Die functie keurt een pad goed of gooit; er is geen doorlaatstand. Dit weigert hij:

- Elke vorm die de URL-parser als `/passwords/<id>` ziet. Dat is niet alleen het letterlijke pad, maar ook de varianten met een dubbele slash, met `%2F` of `%5C` als scheidingsteken, met een backslash, met een tab, newline of carriage return ertussen, en met percent-gecodeerde letters in het woord zelf (`/pass%77ords/1` decodeert bij de server naar het verboden pad).
- Elke querystring met `show_password` erin, ook percent-gecodeerd.
- Elke absolute URL, ook als de host onze eigen IT Glue-API is. De netwerklaag plakt de API-key als header op elk request, dus een ingesloten host mag de controle nooit kunnen omleiden.
- Elk pad met tekens buiten `A-Z a-z 0-9 _ - . /` in het padgedeelte. De querystring valt buiten deze controle, dus filterwaarden met een spatie, een `%` of een `&` blijven gewoon werkbaar.
- Elk pad dat niet als URL te parsen is. De guard faalt dicht: wat we niet kunnen beoordelen, laten we niet door.

Toegestaan blijven de collectie en de relationships-variant: `/passwords`, `/passwords/` en `/organizations/<id>/relationships/passwords`.

Twee praktische gevolgen:

Lever paden altijd relatief aan, bijvoorbeeld `/configurations?filter[organization_id]=7` of `configurations?page[size]=50`. De base URL komt uit de netwerklaag. Een absolute URL wordt geweigerd, ook de goede.

Pagineer met `page[number]` en nooit met de absolute `links.next` uit de JSON:API-respons. Die door de guard halen geeft een harde fout op elke gepagineerde call.

## Foutresponses en rate limiting

Fouten komen als JSON:API-foutobject terug, met een `errors`-array waarin per fout een `title`, `detail` en `status` staan 📄. De netwerklaag van deze skill gooit bij elke niet-2xx status een `Error` met de statuscode en de responsbody erin, en haalt daarbij eerst de API-key uit de tekst (`redactSecrets`) zodat een foutmelding nooit de key kan bevatten.

Bij een 429 wacht de netwerklaag en probeert het opnieuw, maximaal drie keer. Hij gebruikt de `retry-after`-header als die er is en anders exponentiële backoff (1, 2, 4 seconden). Of IT Glue die header daadwerkelijk meestuurt is nog niet gemeten 📄, vandaar de fallback.

De precieze rate limit hebben we niet gemeten. Ga uit van throttling per API-key en vuur geen parallelle bulk af: haal resources sequentieel op, net als bij Autotask.

## Wat nog niet gemeten is

De 📄-markers in de tekst hierboven zijn leidend; deze tabel is niet uitputtend en noemt de punten die je met een concreet commando kunt afvinken. De verificatieronde van 2026-07-31 kon niet lopen omdat het ophalen van de key in die omgeving geweigerd werd.

| Open punt | Commando dat het afvinkt |
|---|---|
| Naam van de meta-sleutel voor de volgende pagina | `node itglue-lookup.mjs configs <org-id> --raw` en kijken welke sleutel in `meta` naar pagina 2 wijst |
| Of `page[number]` bestaat en 1-based is | `node itglue-lookup.mjs configs <org-id> --raw` geeft pagina 1; leg die `data` naast een losse GET met `page[number]=2` |
| Werkt `documents` als top-level resource | `node itglue-lookup.mjs docs <org-id> --raw` |
| Respons-shape van contacts en configurations | `node itglue-lookup.mjs contacts <org-id> --raw` en `configs <org-id> --raw` |
| Klopt het aantal items met `meta` | zit in dezelfde `--raw`-output: `data.length` naast het totaal in `meta` |
| Geeft het passwords-collectie-endpoint items terug of een 403 | `node itglue-lookup.mjs password-link <org-id> ""`, zonder `--raw`, want dat is daar geblokkeerd |
| Bestaat `/locations` met het org-filter | een losse GET op `/locations?filter[organization_id]=<id>` |
| Bestaat `/password_categories` | een losse GET op `/password_categories` |
| Wat er boven `page[size]=1000` gebeurt | een losse GET op `/organizations?page[size]=2000`: kapt hij af op 1000, geeft hij een fout, of komt alles terug |
| Accepteert IT Glue `%5B`/`%5D` net als letterlijke haken | `node itglue-lookup.mjs configs <org-id> --raw` op een organisatie met minstens drie configuraties, en dan de inhoud narekenen: `data` moet exact twee items hebben en elk item moet die `organization-id` dragen. Meer items of een vreemde organisatie betekent dat de haken genegeerd worden. Een 200 op zich is geen bewijs |
| Eist IT Glue het `Content-Type`-header op een GET | een losse GET zonder dat header |
| Komt `retry-after` mee bij een 429 | pas zichtbaar onder load; noteer het zodra je een 429 ziet |

## Bronnen

De officiële documentatie staat op `https://api.itglue.com/developer/`. Dat is het startpunt voor resources en velden die hier niet staan.

Een community-OpenAPI-spec staat in `github.com/jmaddington/ITG-Glue-OpenAPI`, bestand `itgapi.yaml` op branch `main`. Die spec is hier niet gebundeld omdat de repo geen licentie heeft en herdistributie in deze publieke repo daarmee niet is toegestaan. Haal hem dus zelf op als je hem nodig hebt.

Onze eigen meetpunten staan in LESSONS.md, met datum. Vul die aan zodra je iets nieuws tegenkomt.
