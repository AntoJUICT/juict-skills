---
name: datto-rmm-api
description: Werken met de Datto RMM REST API v2 in JUICT-projecten: OAuth2-auth via Azure Key Vault met env-var fallback, het merlot-platform, geverifieerde endpoints voor sites, devices, alerts, audit en jobs, paginatie en rate limits, een lookup-CLI en een kopieerbare TypeScript-client. Gebruik wanneer je Datto RMM-data opvraagt, devices of alerts uitleest, een UDF zet of een quick job start, een Datto-client opzet, of een Datto RMM API-fout debugt. Schrijfacties zijn altijd eerst een dry-run.
---

# Datto RMM REST API v2 (JUICT)

Deze skill bundelt wat je nodig hebt om Datto RMM te gebruiken in een JUICT-project of tijdens een
ticket: authenticatie via Azure Key Vault, de endpoints van ons eigen merlot-platform met hun
verificatiestatus, een lookup-CLI, een kopieerbare TypeScript-client en de valkuilen die we al
tegengekomen zijn.

Ons account draait op het **merlot**-platform en telt op het moment van schrijven 280 sites en
1249 devices.

## Twee harde regels

**1. `POST /v2/user/resetApiKeys` is onvoorwaardelijk geblokkeerd.** Dat endpoint trekt de
API-keys van ons account in. Eén aanroep breekt elke integratie die erop draait, deze skill
inbegrepen, en herstellen kan alleen door in de portal handmatig nieuwe keys aan te maken en de
Key Vault bij te werken. De blokkade zit in zowel `scripts/datto-lookup.mjs` als
`scripts/datto-client.ts`, werkt op segmentniveau (dus ook bij andere casing, dubbele slashes,
een `.json`-suffix of `%2F`), en er is geen vlag, env var of "alleen deze keer" die hem opent.

**2. Elke schrijfactie is een dry-run tenzij je `--confirm` meegeeft.** Datto RMM stuurt echte
machines van klanten aan: een quick job draait code op een endpoint, en een UDF-schrijfactie
overschrijft een veld dat automatisering elders uitleest. Zonder `--confirm` toont de CLI het
device, de site, de online-status, het volledige request en de body, en verstuurt niets. Dat is
geen formaliteit: bij de eerste dry-run op onze eigen server bleek `udf9` al een speedtest-resultaat
te bevatten, en of een POST met één veld de rest wist, is nog niet gemeten.

## Vóór je begint

1. Lees **[REFERENCE.md](REFERENCE.md)** voor base URL en platform, de OAuth-flow, alle 53
   endpoints met verificatiestatus, paginatie, rate limits en data structures.
2. Lees **[LESSONS.md](LESSONS.md)** voor de valkuilen: nul-geïndexeerde paginatie, `activity-logs`
   dat `size` wil in plaats van `max`, drie verschillende tijdstempelformaten, het alerttype dat
   niet in `alertMonitorInfo` staat, en transient netwerkfouten.
3. Let op de ✅/📄-markering in REFERENCE.md. ✅ betekent: zelf aangeroepen en de respons gezien.
   📄 betekent: staat in de OpenAPI-spec van onze eigen instantie, maar nog niet aangeroepen. Dat
   is sterker dan een aanname uit geheugen (de paden en parameters kloppen met de draaiende build),
   maar het zegt niets over rechten of quirks. Doe eerst een losse GET.

## Hoe je begint

Voor de CLI heb je Node 18 of hoger nodig; er zijn geen npm-dependencies. De credentials komen uit
Key Vault via `az`, dus zorg dat `az login` gedaan is en dat `az account show` op de
JUICT-subscription staat. Als alternatief zet je `DATTO_API_URL`, `DATTO_API_KEY` en
`DATTO_API_SECRET` in je omgeving, dan gaat de CLI niet langs de vault.

Start vanuit de `scripts`-map van deze skill, dan werken de commando's hieronder letterlijk:

```bash
cd plugins/datto-rmm-api/skills/datto-rmm-api/scripts
node datto-lookup.mjs --help
node datto-lookup.mjs account      # goede eerste smoke test
```

## De lookup-CLI

```bash
node datto-lookup.mjs account                              # accountgegevens en devicetelling
node datto-lookup.mjs sites                                # alle sites
node datto-lookup.mjs sites "Voorbeeld Klant"              # sites op naam
node datto-lookup.mjs devices "Voorbeeld Klant"            # devices van een site (naam of uid)
node datto-lookup.mjs devices --all                        # alle devices van het account
node datto-lookup.mjs devices "Voorbeeld Klant" "WS-01"    # devices van een site op hostname
node datto-lookup.mjs device <deviceUid>                   # één device, alle velden
node datto-lookup.mjs alerts                               # open alerts, account-breed
node datto-lookup.mjs alerts "Voorbeeld Klant" --resolved  # opgeloste alerts van een site
node datto-lookup.mjs audit <deviceUid>                    # hardware- en systeemaudit
node datto-lookup.mjs software <deviceUid>                 # geïnstalleerde software
node datto-lookup.mjs components                           # componenten (nodig voor quickjob)
node datto-lookup.mjs job <jobUid>                         # status van een job
node datto-lookup.mjs rate                                 # actuele rate-limit-stand
node datto-lookup.mjs get "v2/system/pagination"           # vrije GET op een relatief pad
```

Bij `devices` en `alerts` mag de site een naam of een uid zijn. Een uid herkent de CLI aan de
uuid-vorm en gebruikt hij direct; een naam wordt als deelstring gezocht. Levert dat meerdere sites
op, dan krijg je de kandidaten met hun uid terug en herhaal je het commando met het juiste uid.

Schrijven, altijd eerst zonder `--confirm`:

```bash
node datto-lookup.mjs udf <deviceUid> udf5="Aangeschaft 2026"
node datto-lookup.mjs quickjob <deviceUid> <componentUid> "Herstart spooler" --var Force=true
```

Vlaggen:

- `--json` geeft de verwerkte rijen als JSON in plaats van een tabel.
- `--raw` print de ruwe eerste pagina inclusief `pageDetails`, met paginagrootte 2 zodat er echt
  een volgende pagina bestaat. Dit is de manier om de responsvorm en de paginatie te controleren.
- `--confirm` voert een schrijfactie daadwerkelijk uit.
- `--max <n>` zet de paginagrootte (default en maximum 250).
- `--var naam=waarde` geeft een variabele mee aan een quick job, herhaalbaar.

## In een project gebruiken

Kopieer `scripts/azure-keyvault.ts` en `scripts/datto-client.ts` naar je project (bijvoorbeeld
`src/lib/`) en installeer `@azure/keyvault-secrets` en `@azure/identity`.

```typescript
import { getSites, getSiteDevices, getOpenAlerts, dattoRequest } from "@/lib/datto-client";

const sites = await getSites();                       // pagineert zelf
const devices = await getSiteDevices(sites[0].uid);
const alerts = await getOpenAlerts();

// Een endpoint zonder wrapper:
const status = await dattoRequest("v2/system/status");
```

`fetchAllDatto` pagineert zelf via `pageDetails.nextPageUrl` en stopt hard na `maxPages` (default
50) zodat een verkeerd filter geen honderden calls veroorzaakt. Elk request heeft een timeout van
20 seconden (`DATTO_TIMEOUT_MS`), en transportfouten worden tot drie keer geprobeerd omdat de API
af en toe een losse call laat stranden.

De schrijffuncties `setDeviceUdf` en `createQuickJob` hebben in de client geen dry-run: die rail
zit in de CLI. Zet er in een applicatie zelf een even bewuste bevestiging voor.

## Authenticatie

| Omgeving | Bron |
|---|---|
| Productie (Container Apps) | Key Vault `juict-shared-kv`, secrets `datto-rmm-api-url`, `datto-rmm-api-key`, `datto-rmm-api-secret`, via managed identity en `AZURE_KEYVAULT_URL` |
| Lokaal in een project | `DATTO_API_URL`, `DATTO_API_KEY`, `DATTO_API_SECRET`, alleen als `AZURE_KEYVAULT_URL` níet gezet is: die heeft voorrang |
| CLI | Dezelfde env vars, en anders `az keyvault secret show` op `juict-shared-kv` |

De flow is een OAuth2 password grant: de API key is de `username`, het secret de `password`, en de
Basic-header bevat de vaste publieke client `public-client:public`. Dat laatste is geen geheim en
hoort niet in de vault. Het access token wordt gecachet tot een minuut voor de vervaltijd; bij een
401 haalt de netwerklaag eenmalig een vers token op voordat hij de fout doorgeeft.

`juict-shared-kv` werkt met access policies en niet met RBAC. Een nieuwe managed identity koppel je
met `az keyvault set-policy --secret-permissions get list`.

Zet de key of het secret nooit in een `.env` die gecommit wordt en echo hem nooit naar de console.
Alles wat deze skill print of in een `Error` stopt, gaat langs `redactSecrets()`: die haalt de key,
het secret en het bearer token eruit, en vangt daarnaast `access_token`- en `Bearer`-patronen die
we zelf niet in de hand hebben.

## Padregels

Alle calls lopen door `assertPathAllowed()`. Die keurt goed of gooit, zonder doorlaatstand.
Geweigerd worden: elke vorm die als `/user/resetApiKeys` te lezen is, elke absolute URL (ook op onze
eigen host, want de netwerklaag plakt het token op elk request), en elk pad met tekens buiten
`A-Za-z0-9_-./` in het padgedeelte.

Twee praktische gevolgen. Lever paden altijd relatief aan, bijvoorbeeld
`v2/site/<uid>/devices?max=250`. En volg de paginatie via `pageDetails.nextPageUrl`, die apart door
`assertSameOrigin()` gaat: absolute URL's worden geweigerd door de padguard, maar de paginatie-URL
mag wel, mits hij naar dezelfde host wijst als onze base URL.

## Debugchecklist bij API-fouten

1. **401 bij het ophalen van een token.** Klopt het platform in `datto-rmm-api-url`? Een key van
   ons merlot-account werkt niet tegen `vidal` of `pinotage`, en de foutmelding zegt dat niet.
   Zit er een trailing newline in de secretwaarde? Die komt gewoon mee en oogt als een foute key.
2. **404 op een endpoint.** Controleer of het pad bestaat in de spec:
   `curl https://merlot-api.centrastage.net/api/v3/api-docs`. Let op dat de token-endpoint buiten
   `/api` valt en de rest erbinnen.
3. **429.** Kijk met `node datto-lookup.mjs rate` wat je verbruikt hebt. 600 per 60 seconden,
   glijdend, met een eigen limiet per schrijfoperatie.
4. **"fetch failed" zonder status.** Transient; de ingebouwde retry vangt dit meestal. Blijft het
   terugkomen, dan is het geen Datto-probleem maar je verbinding.
5. **Minder resultaten dan verwacht.** Pagineer je via `nextPageUrl`? `page` is nul-geïndexeerd, en
   `activity-logs` negeert `max` en wil `size`.
6. **Een datum in 1970.** Je leest een stempel in seconden als milliseconden. Zie LESSONS.md.
7. **401 op de `az keyvault`-call zelf.** Check `az account show`: een andere sessie kan de default
   subscription naar een klanttenant hebben gezet.

## Tests

```bash
node --test "plugins/datto-rmm-api/skills/datto-rmm-api/scripts/*.test.mjs"
```

Zet het patroon tussen quotes: een kale mapnaam geeft op Windows MODULE_NOT_FOUND. De tests raken
het netwerk en de Key Vault niet; ze dekken de padguard, de origin-controle op paginatie, redactie,
de bodies voor schrijfacties, de responsverwerking en de CLI-parsing. `plugin-structuur.test.mjs`
bewaakt daarnaast dat de blokkade en de dry-run-poort in de broncode blijven staan.
