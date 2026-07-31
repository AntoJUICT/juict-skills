---
name: itglue-api
description: Werken met de IT Glue REST API in JUICT-projecten: auth via Azure Key Vault met env-var fallback, base URL en EU-regio, read-only endpoints met verificatiestatus, JSON:API-datastructuren, valkuilen, en een lookup-CLI voor organisaties, configuraties, contacten, documenten en flexible assets. Gebruik wanneer je IT Glue-data opvraagt, een IT Glue-client opzet, of een IT Glue API-fout debugt. Wachtwoordwaarden levert deze skill nooit: bij een wachtwoordvraag krijg je alleen de naam van het item en een deeplink naar IT Glue.
---

# IT Glue REST API (JUICT)

Deze skill bundelt wat je nodig hebt om IT Glue te gebruiken in een JUICT-project of tijdens een ticket: authenticatie via Azure Key Vault, de endpoints die we aangesproken hebben, een read-only lookup-CLI, een kopieerbare TypeScript-client en de valkuilen die we al tegengekomen zijn.

De hele skill is read-only. De netwerklaag doet uitsluitend GET; schrijfacties op IT Glue vallen buiten scope, want IT Glue is de bron van waarheid voor het hele team.

## Harde regel: wachtwoorden

Wachtwoordwaarden haalt deze skill niet op. Dat is beleid en geen technische claim. De opdrachtgever heeft vastgelegd dat password-access voor deze toepassing uit staat, en een wachtwoordwaarde in een transcript of logbestand is een incident. De blokkade geldt daarom onafhankelijk van wat de API zou teruggeven: `assertPathAllowed()` weigert de individuele password-resource in zowel `scripts/itglue-lookup.mjs` als `scripts/itglue-client.ts`, en er is geen flag, env var of "alleen deze keer" die dat opent. LESSONS.md legt vast dat de waarde in juli 2026 wel terugkwam op dat pad; dat staat er als historie, niet als iets om op te bouwen.

Bij een wachtwoordvraag lever je de naam van het item en de deeplink:

```
https://juict.eu.itglue.com/<organization-id>/passwords/<password-id>
```

Die vorm is 📄 gecorroboreerd en niet zelf gemeten: hij is in gebruik in het JUICT-project `huntress-bulk-onboarding`, dat het organisatie-id uit zo'n portal-URL haalt en dat in een test met echte 16-cijferige IT Glue-id's vastlegt. Dat is onderbouwing van buiten deze skill, geen kale aanname, maar een eigen observatie in de portal is het niet. Klopt de vorm niet, dan is het antwoord op elke wachtwoordvraag een dode link, dus hij staat nog als openstaand punt in de tabel onderaan REFERENCE.md. Vink hem af door één zo'n link in de portal te openen. De documenten-deeplink `https://juict.eu.itglue.com/<org-id>/docs/<document-id>` heeft die onderbouwing niet en blijft een kale 📄.

Het collectie-endpoint mag je wel gebruiken om het juiste item op naam te vinden; dat is precies wat `password-link` doet. Daar hoort een zoekterm bij en die is verplicht: zonder term zou het commando naam en link van élk password-item van de organisatie tonen, en itemnamen vertellen zelf al genoeg. `--raw` is om dezelfde reden geblokkeerd op `password-link`, en het vrije `get`-subcommando mag de passwords-resource helemaal niet aanspreken, niet in het pad en niet via een `include`-parameter: allebei zouden ze de whitelist omzeilen die alleen naam en link doorlaat.

Voor TOTP geldt hetzelfde eindresultaat om een andere reden: de seed zit niet in de API, alleen `otp-enabled` als boolean. Een onbemande TOTP-flow op basis van IT Glue kan dus niet.

## Verificatiestatus van deze skill

Lees dit voordat je op een endpoint bouwt. De CLI en de client in deze skill hebben zelf nog nooit een live call gedaan: de geplande verificatieronde kon niet lopen omdat het ophalen van de API-key in die omgeving geweigerd werd. De ✅-markers in REFERENCE.md komen uit ad-hoc metingen van 2026-07-21 en 2026-07-31, buiten deze skill om, met losse calls en letterlijke blokhaken in de query terwijl de scripts `%5B` en `%5D` versturen. De tabel "Wat nog niet gemeten is" onderaan REFERENCE.md noemt per openstaand punt het commando dat het afvinkt. Het grootste risico staat bovenaan: heet de paginatie-sleutel `next-page` in werkelijkheid anders, dan levert `fetchAllItGlue` stil één pagina op zonder foutmelding. Vink dat als eerste af met `--raw`.

## Vóór je begint

1. Lees **[REFERENCE.md](REFERENCE.md)** voor base URL en regio, auth, JSON:API-vorm, paginatie, filters, resources met verificatiestatus, padregels en de externe bronnen (officiële docs en de community-OpenAPI-spec, die hier niet gebundeld is).
2. Lees **[LESSONS.md](LESSONS.md)** voor de valkuilen: kebab-case attributen tegenover snake_case filters, `filter[name]` dat geen deelstrings matcht, stille lege responses, paginatie en Key Vault.
3. Let op de ✅/📄-markering in REFERENCE.md. 📄 betekent: niet zelf gemeten, doe een GET voordat je erop bouwt. Bij IT Glue doet een niet-werkend pad zich voor als een lege lijst met status 200, niet als een 404.

## Hoe je begint

Voor de CLI heb je Node 18 of hoger nodig (hij gebruikt de ingebouwde `fetch` en heeft geen npm-dependencies) en een geldige key. Wil je de tests draaien, dan is Node 22.18 of hoger nodig: de gedragscontrole op de TypeScript-client voert `itglue-client.ts` uit via de ingebouwde type-stripping, en die bestaat pas vanaf die versie. Op oudere Node slaat die ene test over en blijft alleen de brontekstvergelijking van de guard staan. De key komt uit Key Vault via `az`, dus zorg dat `az login` gedaan is en dat `az account show` op de JUICT-subscription staat; als alternatief zet je `ITGLUE_API_KEY` in je omgeving, dan gaat de CLI niet langs de vault.

Start de CLI vanuit de `scripts`-map van deze skill, dan werken de commando's hieronder letterlijk:

```bash
cd plugins/itglue-api/skills/itglue-api/scripts
node itglue-lookup.mjs --help
```

Vanuit een andere directory geef je gewoon het volledige pad naar `itglue-lookup.mjs` mee.

## De lookup-CLI

```bash
node itglue-lookup.mjs org "Rouwenhorst Installatietechniek B.V."   # organisaties zoeken op naam
node itglue-lookup.mjs configs 7 "srv"                              # configuraties, optioneel gefilterd op naam
node itglue-lookup.mjs contacts 7 "jansen"                          # contacten, optioneel gefilterd op naam
node itglue-lookup.mjs docs 7 "handleiding"                         # documenten met deeplink
node itglue-lookup.mjs assets 7 12345                               # flexible assets, tweede argument is een asset-type-id
node itglue-lookup.mjs password-link 7 "firewall"                   # naam en deeplink van een wachtwoord-item
node itglue-lookup.mjs get "flexible_asset_types"                   # ruwe GET op een relatief pad
```

Bij `configs`, `contacts`, `docs`, `assets` en `password-link` mag de organisatie een naam of een id zijn: een getal wordt direct als id gebruikt zonder zoekcall. Bij een naam zijn er twee uitkomsten die verschillen, en dat verschil is de moeite waard omdat `filter[name]` geen deelstrings matcht. Levert de zoekopdracht meerdere organisaties op, dan krijg je die kandidaten met hun id terug en herhaal je het commando met het juiste id. Levert hij er nul op, dan is er geen kandidatenlijst en zegt de melding waarom: `filter[name]` wil de volledige naam. Je komt dan verder via de portal (zoek de organisatie op en lees het id uit de URL) of met `get "organizations?page[size]=1000"` en zelf zoeken in die lijst. Dat geldt allemaal niet voor `org` zelf, dat altijd op naam zoekt, dus `org 7` levert niets op.

Let op dat het tweede argument van `assets` een asset-type-id is en geen zoekterm. IT Glue geeft een lege collectie als je alleen op organisatie filtert, dus haal de type-ids eerst op met `node itglue-lookup.mjs get "flexible_asset_types"`.

De deeplink die `docs` per document meegeeft heeft de vorm `https://juict.eu.itglue.com/<org-id>/docs/<document-id>`. Die vorm is een kale 📄: anders dan de password-deeplink komt hij alleen uit onze eigen code en is er geen ander project dat hem gebruikt. Hij staat als openstaand punt in REFERENCE.md.

Drie vlaggen en een vrij pad:

- `--json` geeft de verwerkte rijen als JSON in plaats van een tabel.
- `--raw` print de ruwe JSON:API-body van de eerste pagina, inclusief `meta` en `links`, met paginagrootte 2 zodat er bij drie items of meer echt een volgende pagina bestaat. Dit is de manier om de responsvorm en de paginatie-sleutel te controleren. `--raw` werkt op `org`, `configs`, `contacts`, `docs` en `assets`, en is geblokkeerd op `password-link` en op `get`.
- `get "<relatief-pad>"` doet een GET op een pad zonder eigen subcommando en print de geredacteerde body. Dit is het gereedschap voor de openstaande punten in REFERENCE.md die om "een losse GET" vragen, bijvoorbeeld `get "locations?filter[organization_id]=7"` of `get "password_categories"`. Zet het pad tussen quotes, anders eet je shell de blokhaken en de `&`. Het pad gaat door `assertPathAllowed()` en daarna door een extra grens: elk pad dat de passwords-resource raakt wordt geweigerd, ook de collectie, want een vrij pad zou daar de ruwe attributes printen en de naam-en-link-whitelist omzeilen. Die grens loopt over het pad en over de `include`-parameter. Elk padsegment gaat zonder punt-suffix door de vergelijking (`passwords.json` telt dus als `passwords`), en een `include` die de passwords-resource noemt wordt geweigerd, ook komma-gescheiden tussen andere waarden (`include=passwords,configurations`), als geneste relatie (`include=organization.passwords`) en met andere casing. De rest van de query blijft buiten die controle: een filterwaarde waarin het woord voorkomt (`filter[name]=passwords-server`) verandert niet welke resource terugkomt en blijft gewoon werken. Het pad gaat byte-identiek de deur uit, dus met letterlijke blokhaken; daarmee is `get` ook de manier om te meten of IT Glue `%5B`/`%5D` net zo leest als letterlijke haken.

## In een project gebruiken

Kopieer `scripts/azure-keyvault.ts` en `scripts/itglue-client.ts` naar je project (bijvoorbeeld `src/lib/`) en installeer `@azure/keyvault-secrets` en `@azure/identity`.

```typescript
import { fetchAllItGlue, passwordDeeplink, passwordTreffers } from "@/lib/itglue-client";

const configs = await fetchAllItGlue("configurations", { filters: { organization_id: 7 } });
const naam = configs[0].attributes["name"];

// Wachtwoord nodig? Alleen een link, nooit de waarde.
const link = passwordDeeplink(7, 42);

// Zoeken in de passwords-collectie? Haal de items altijd langs passwordTreffers: die laat
// uitsluitend naam en deeplink door, net als de CLI, wat er ook in de attributes staat.
const items = await fetchAllItGlue("passwords", { filters: { organization_id: 7 } });
const treffers = passwordTreffers(items, 7, "firewall"); // [{ naam, link }]
```

`fetchAllItGlue` pagineert zelf met `page[size]` (default 100) en `page[number]`, en stopt hard na `maxPages` (default 50) zodat een verkeerd filter geen honderden calls veroorzaakt. Filternamen zijn snake_case, attribuutsleutels in de respons zijn kebab-case, en `id` is altijd een string.

Elk request heeft een timeout van 20 seconden (`DEFAULT_TIMEOUT_MS`), per call te overrulen met de optie `timeoutMs` en globaal met de env var `ITGLUE_TIMEOUT_MS`. Zonder timeout houdt een hangende IT Glue-verbinding een Next.js-route onbeperkt vast. Een retry na een 429 krijgt zijn eigen, verse timeout.

De harde grens in de client is de padguard: die weigert de individuele password-resource. `passwordTreffers` is de tweede laag, en die is niet automatisch: roep je `fetchAllItGlue("passwords", ...)` aan en geef je die items rechtstreeks door, dan houd je zelf de ruwe attributes in handen. Doe dat niet.

## Authenticatie

| Omgeving | Bron |
|---|---|
| Productie (Container Apps) | Key Vault `juict-shared-kv`, secret `itglue-api-key`, via managed identity en `AZURE_KEYVAULT_URL` |
| Lokaal in een project | `ITGLUE_API_KEY`, alleen als `AZURE_KEYVAULT_URL` níet gezet is: die env var heeft voorrang |
| CLI | `ITGLUE_API_KEY`, en anders `az keyvault secret show` op `juict-shared-kv` |

`juict-shared-kv` werkt met access policies en niet met RBAC. Een nieuwe managed identity koppel je met `az keyvault set-policy --secret-permissions get list`, anders faalt de keyvaultref bij het starten van de container terwijl de RBAC-rol er wel op lijkt te staan.

Zet de key nooit in een `.env` die gecommit wordt en echo hem nooit naar de console. De netwerklaag haalt de key met `redactSecrets()` uit elke responsbody voordat die in een `Error` terechtkomt, ook als die body geen JSON is: de body wordt eerst als tekst gelezen en daarna zelf geparseerd, zodat een HTML-foutpagina op status 200 geen kale `SyntaxError` met een ongeredacteerd fragment oplevert. `--raw` en `get` doen hetzelfde met de body die ze printen.

## Padregels

Alle calls lopen door `assertPathAllowed()`. Die functie keurt goed of gooit, zonder doorlaatstand. Geweigerd worden: elke vorm die de URL-parser als `/passwords/<id>` ziet (ook met dubbele slash, `%2F`, backslash, tab, newline, carriage return of percent-gecodeerde letters in het woord), elke querystring met `show_password`, elke absolute URL (ook op onze eigen host, want de netwerklaag plakt de API-key op elk request), elk pad met tekens buiten `A-Za-z0-9_-./` in het padgedeelte, en elk pad dat niet als URL te parsen is.

Twee praktische gevolgen. Lever paden altijd relatief aan, bijvoorbeeld `configurations?filter[organization_id]=7`; de base URL komt uit de netwerklaag en een absolute URL wordt geweigerd, ook de goede. En pagineer met `page[number]`, nooit met de absolute `links.next` die IT Glue als JSON:API meestuurt: die door de guard halen geeft een harde fout op elke gepagineerde call.

## Debugchecklist bij API-fouten

1. **401 of 403.** Is de key nog geldig, en staat de base URL op de EU-regio? Een EU-key tegen de US-URL geeft geen behulpzame melding. Bij een 401 op de `az keyvault`-call: check `az account show`, een andere sessie kan de default subscription naar een klanttenant hebben gezet.
2. **404.** Bestaat de resourcenaam echt? Resourcepaden met meerdere woorden gebruiken underscores (`flexible_assets`, `configuration_types`), nooit streepjes. Check de verificatiestatus in REFERENCE.md.
3. **Leeg resultaat.** Staat de filternaam in snake_case, is dat filter op zichzelf voldoende (flexible assets hebben er twee nodig), en klopt het aantal items met `meta`? Dat laatste zie je met `--raw`.
4. **429.** De netwerklaag doet al retry met backoff, maximaal drie keer. Krijg je er veel, verlaag `page[size]` of serialiseer de calls; haal resources nooit parallel op.
5. **Te weinig records.** Loopt de paginatie door? Controleer met `--raw` welke sleutel in `meta` naar de volgende pagina wijst en of dat `next-page` is.
6. **"IT Glue API gaf geen JSON terug".** Status 200 met een niet-JSON body komt van een proxy of gateway ertussen, niet van IT Glue zelf. De melding noemt de status, het pad en het begin van de body; probeer het opnieuw en check of je via een proxy werkt.

Een geslaagde call is bij IT Glue geen bewijs. Herkent de server een parameter niet, dan negeert hij hem en krijg je een 200 met een ongefilterde lijst op de default paginagrootte. Reken de inhoud dus na.

## Bestanden

- `scripts/itglue-lookup.mjs`: read-only lookup-CLI, geen npm-deps, Node 18+, met de password-blokkade.
- `scripts/itglue-lookup.test.mjs`: tests van de CLI, draaien offline.
- `scripts/itglue-client.ts`: kopieerbare client voor projecten (`itglueFetch`, `fetchAllItGlue`, `buildFilterQuery`, `passwordDeeplink`, `passwordTreffers`, `assertPathAllowed`).
- `scripts/itglue-client-guard.test.mjs`: vergelijkt de blokkade in de client met die in de CLI en wordt rood zodra ze uit elkaar lopen of er een laag verdwijnt.
- `scripts/azure-keyvault.ts`: `getSecret()` met 1u-cache en `DefaultAzureCredential`.
- `scripts/plugin-structuur.test.mjs`: controleert plugin.json, de marketplace-entry, de frontmatter van dit bestand en of elke plugin uit marketplace.json een tabelrij heeft in de README van de repo.
- `REFERENCE.md`: endpoint- en datareferentie met verificatiestatus en de tabel met openstaande punten.
- `LESSONS.md`: valkuilen en lessons learned, met datum.

Alle tests draai je met:

```bash
node --test "plugins/itglue-api/skills/itglue-api/scripts/*.test.mjs"
```

Geef het glob-patroon tussen quotes mee. Een kale map als argument werkt niet in deze omgeving en faalt met MODULE_NOT_FOUND. Draai ze op Node 22.18 of hoger, anders slaat de gedragscontrole op de TypeScript-client over.

## Nieuwe lessen toevoegen

Loop je tegen een nieuwe valkuil aan of vink je een openstaand punt af, werk dan LESSONS.md of REFERENCE.md bij, met datum bij een nieuwe ✅, en breng dat via een feature branch en PR naar `AntoJUICT/juict-skills`. Wijzig je iets in de password-blokkade, doe dat dan in `itglue-lookup.mjs` én `itglue-client.ts`: de guard-test vergelijkt de twee.
