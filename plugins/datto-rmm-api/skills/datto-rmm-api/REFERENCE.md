# Datto RMM API v2 — referentie

Alles hieronder gaat over het JUICT-account op het **merlot**-platform.

## Verificatiestatus: wat de markers betekenen

| Marker | Betekenis |
|---|---|
| ✅ | Zelf aangeroepen tegen ons eigen account op 2026-08-25 en de respons gezien |
| 📄 | Staat in de OpenAPI-spec van onze eigen merlot-instantie, maar nog niet zelf aangeroepen |

📄 is hier sterker onderbouwd dan in de meeste van onze skills: de lijst komt niet uit geheugen of
uit een blogpost, maar uit `GET /api/v3/api-docs` op precies de server waar wij tegenaan praten. De
paden en de queryparameters kloppen dus met de draaiende build. Wat 📄 níet zegt, is hoe de respons
er in de praktijk uitziet, of het endpoint rechten heeft die onze API-user mist, en of er quirks in
zitten. Doe bij een 📄-endpoint eerst een losse call voordat je er iets op bouwt.

## Base URL en platform

De API-URL hangt af van het platform waar je account op staat; die staat in de portal-URL. Voor
JUICT is dat **merlot**:

```
https://merlot-api.centrastage.net
```

Let op de opbouw, want die is niet uniform:

| Onderdeel | URL |
|---|---|
| OAuth-token | `https://merlot-api.centrastage.net/auth/oauth/token` |
| API-calls | `https://merlot-api.centrastage.net/api/v2/...` |
| Swagger UI | `https://merlot-api.centrastage.net/api/swagger-ui/index.html` |
| OpenAPI-spec (JSON) | `https://merlot-api.centrastage.net/api/v3/api-docs` ✅ |

De token-endpoint zit dus **buiten** `/api`, de rest erbinnen. De spec is publiek opvraagbaar
zonder token; `/api/swagger.json` en `/api/v2/api-docs` geven een 401 en `/v2/api-docs` een 404.

## Authenticatie

OAuth2 password grant. De API key en het secret maak je in de portal aan onder
**Setup → Users → API access**; ze horen bij een gebruiker, niet bij het account.

```http
POST https://merlot-api.centrastage.net/auth/oauth/token
Authorization: Basic base64("public-client:public")
Content-Type: application/x-www-form-urlencoded

grant_type=password&username=<API key>&password=<API secret key>
```

`public-client` / `public` is de vaste, publieke OAuth-client van Datto en voor elk account
gelijk. Dat is geen geheim en hoort niet in de Key Vault; de echte credentials zijn de key en het
secret. De respons bevat `access_token`, `refresh_token` en `expires_in`; daarna gaat elke call met
`Authorization: Bearer <access_token>`. ✅

### Waar de credentials staan

| Omgeving | Bron |
|---|---|
| Productie (Container Apps) | Key Vault `juict-shared-kv`, secrets `datto-rmm-api-url`, `datto-rmm-api-key`, `datto-rmm-api-secret`, via managed identity en `AZURE_KEYVAULT_URL` |
| Lokaal in een project | `DATTO_API_URL`, `DATTO_API_KEY`, `DATTO_API_SECRET`, alleen als `AZURE_KEYVAULT_URL` níet gezet is: die heeft voorrang |
| CLI | Dezelfde env vars, en anders `az keyvault secret show` op `juict-shared-kv` |

`juict-shared-kv` werkt met access policies en niet met RBAC. Een nieuwe managed identity koppel je
met `az keyvault set-policy --secret-permissions get list`, anders faalt de keyvaultref bij het
starten van de container terwijl een RBAC-rol er wel op lijkt te staan.

## Paginatie

Elke collectie-respons heeft dezelfde vorm: één `pageDetails`-object en één array waarvan de naam
per endpoint verschilt (`sites`, `devices`, `alerts`, `components`, `activities`, ...). ✅

```json
{
  "pageDetails": {
    "count": 2,
    "totalCount": 280,
    "prevPageUrl": null,
    "nextPageUrl": "https://merlot-api.centrastage.net/api/v2/account/sites?max=2&page=1"
  },
  "sites": [ ... ]
}
```

- Paginagrootte is `max`, met **250 als maximum én default**. Bevestigd met
  `GET /v2/system/pagination`, die `{"max":250}` teruggeeft. ✅
- `page` is **nul-geïndexeerd**: de tweede pagina is `page=1`. ✅
- Volg `nextPageUrl` in plaats van zelf `page` op te hogen; die URL is absoluut en wijst naar onze
  eigen host. Controleer de origin voordat je hem volgt, want de netwerklaag plakt het bearer token
  op elk request. ✅
- `totalCount` is er niet altijd: sites hebben hem wel, open alerts niet. Bouw geen
  voortgangsindicator of "klaar?"-check op dat veld. ✅
- `activity-logs` wijkt af, zie hieronder.

## Rate limits

`GET /v2/system/request_rate` geeft de actuele stand. Gemeten op ons account: ✅

| Grens | Waarde |
|---|---|
| Venster | 60 seconden, sliding |
| Leesverzoeken | 600 per venster |
| Schrijfverzoeken | 600 per venster |
| Cut-off ratio | 0.9 |
| Per schrijfoperatie | eigen limiet, bijv. `site-update` 100, `device-udf-set` 600 |

Bij overschrijding volgt een 429 met `Retry-After`. Een volledige uitdraai van alle devices
(1249 stuks, 5 pagina's) kost 5 calls en duurt ongeveer 12 seconden; je zit dus niet snel aan de
grens, maar een loop per device wel.

## Endpoints

Alle paden hieronder staan relatief aan `https://merlot-api.centrastage.net/api`.

### Account

| Endpoint | Queryparameters | Wat het doet |
|---|---|---|
| ✅ `GET /v2/account` | — | Accountgegevens, inclusief `devicesStatus` en `descriptor.deviceLimit` |
| ✅ `GET /v2/account/sites` | page, max, siteName | Alle sites |
| ✅ `GET /v2/account/devices` | page, max, filterId, hostname, deviceType, operatingSystem, siteName | Alle devices van het account |
| ✅ `GET /v2/account/alerts/open` | page, max, muted | Open alerts |
| 📄 `GET /v2/account/alerts/resolved` | page, max, muted | Opgeloste alerts |
| ✅ `GET /v2/account/components` | page, max | Componenten (nodig voor een quick job) |
| 📄 `GET /v2/account/users` | page, max | API-gebruikers van het account |
| 📄 `GET /v2/account/variables` | page, max | Accountvariabelen |
| 📄 `GET /v2/account/dnet-site-mappings` | page, max | Sites met hun dnet-netwerk-id |
| 📄 `PUT /v2/account/variable` | — | **Schrijft.** Maakt een accountvariabele |
| 📄 `POST /v2/account/variable/{variableId}` | — | **Schrijft.** Wijzigt een accountvariabele |
| 📄 `DELETE /v2/account/variable/{variableId}` | — | **Schrijft.** Verwijdert een accountvariabele |

### Sites

| Endpoint | Queryparameters | Wat het doet |
|---|---|---|
| ✅ `GET /v2/site/{siteUid}` | — | Eén site, inclusief aantal devices |
| ✅ `GET /v2/site/{siteUid}/devices` | page, max, filterId | Devices van een site |
| 📄 `GET /v2/site/{siteUid}/devices/network-interface` | page, max | Devices met netwerkinterface-info |
| 📄 `GET /v2/site/{siteUid}/alerts/open` | page, max, muted | Open alerts van een site |
| 📄 `GET /v2/site/{siteUid}/alerts/resolved` | page, max, muted | Opgeloste alerts van een site |
| 📄 `GET /v2/site/{siteUid}/settings` | — | Site-instellingen |
| 📄 `GET /v2/site/{siteUid}/variables` | page, max | Sitevariabelen |
| 📄 `GET /v2/site/{siteUid}/filters` | page, max | Device-filters van de site |
| 📄 `PUT /v2/site` | — | **Schrijft.** Maakt een site (`name` verplicht) |
| 📄 `POST /v2/site/{siteUid}` | — | **Schrijft.** Wijzigt een site |
| 📄 `POST /v2/site/{siteUid}/settings/proxy` | — | **Schrijft.** Zet proxy-instellingen |
| 📄 `DELETE /v2/site/{siteUid}/settings/proxy` | — | **Schrijft.** Verwijdert proxy-instellingen |
| 📄 `PUT /v2/site/{siteUid}/variable` | — | **Schrijft.** Maakt een sitevariabele |
| 📄 `POST /v2/site/{siteUid}/variable/{variableId}` | — | **Schrijft.** Wijzigt een sitevariabele |
| 📄 `DELETE /v2/site/{siteUid}/variable/{variableId}` | — | **Schrijft.** Verwijdert een sitevariabele |

### Devices

| Endpoint | Queryparameters | Wat het doet |
|---|---|---|
| ✅ `GET /v2/device/{deviceUid}` | — | Eén device met alle velden, inclusief `udf` |
| 📄 `GET /v2/device/id/{deviceId}` | — | Device op numeriek id |
| 📄 `GET /v2/device/macAddress/{macAddress}` | — | Device op MAC, formaat `XXXXXXXXXXXX` |
| 📄 `GET /v2/device/{deviceUid}/alerts/open` | page, max, muted | Open alerts van een device |
| 📄 `GET /v2/device/{deviceUid}/alerts/resolved` | page, max, muted | Opgeloste alerts van een device |
| ✅ `POST /v2/device/{deviceUid}/udf` | — | **Schrijft.** Zet user defined fields (udf1–udf300); gerichte update, wist niet-genoemde velden niet |
| 📄 `PUT /v2/device/{deviceUid}/quickjob` | — | **Schrijft. Draait code op de machine.** Start een quick job |
| 📄 `PUT /v2/device/{deviceUid}/site/{siteUid}` | — | **Schrijft.** Verplaatst een device naar een andere site |
| 📄 `POST /v2/device/{deviceUid}/warranty` | — | **Schrijft.** Zet de garantiedatum |

### Audit

| Endpoint | Queryparameters | Wat het doet |
|---|---|---|
| ✅ `GET /v2/audit/device/{deviceUid}` | — | Hardware- en systeemaudit |
| ✅ `GET /v2/audit/device/{deviceUid}/software` | page, max | Geïnstalleerde software |
| 📄 `GET /v2/audit/device/macAddress/{macAddress}` | — | Audit op MAC-adres |
| 📄 `GET /v2/audit/printer/{deviceUid}` | — | Printeraudit |
| 📄 `GET /v2/audit/esxihost/{deviceUid}` | — | ESXi-hostaudit |

### Alerts

| Endpoint | Queryparameters | Wat het doet |
|---|---|---|
| 📄 `GET /v2/alert/{alertUid}` | — | Eén alert |
| 📄 `POST /v2/alert/{alertUid}/resolve` | — | **Schrijft.** Zet een alert op opgelost |
| ⛔ `POST /v2/alert/{alertUid}/mute` | — | Werkt niet meer sinds Datto RMM 8.9.0 (staat zo in de spec) |
| ⛔ `POST /v2/alert/{alertUid}/unmute` | — | Idem |

### Jobs

| Endpoint | Queryparameters | Wat het doet |
|---|---|---|
| 📄 `GET /v2/job/{jobUid}` | — | Status van een job |
| 📄 `GET /v2/job/{jobUid}/components` | page, max | Componenten van een job |
| 📄 `GET /v2/job/{jobUid}/results/{deviceUid}` | — | Resultaat per device |
| 📄 `GET /v2/job/{jobUid}/results/{deviceUid}/stdout` | — | Standaarduitvoer |
| 📄 `GET /v2/job/{jobUid}/results/{deviceUid}/stderr` | — | Foutuitvoer |

### Filters, systeem en overig

| Endpoint | Queryparameters | Wat het doet |
|---|---|---|
| ✅ `GET /v2/activity-logs` | **size**, order, searchAfter, page, from, until, entities, categories, actions, siteIds, userIds, searchQuery | Activiteitenlog; wijkt af, zie LESSONS.md |
| 📄 `GET /v2/filter/default-filters` | page, max | Standaard device-filters |
| 📄 `GET /v2/filter/custom-filters` | page, max | Eigen device-filters (vereist administrator-rol) |
| ✅ `GET /v2/system/pagination` | — | Geeft de maximale paginagrootte (250) |
| ✅ `GET /v2/system/request_rate` | — | Actuele rate-limit-stand |
| ✅ `GET /v2/system/status` | — | Versie en status van de API |
| 🚫 `POST /v2/user/resetApiKeys` | — | **Geblokkeerd in deze skill.** Trekt onze eigen API-keys in |

## Data structures

### Site (relevante velden) ✅

```json
{
  "id": 218140,
  "uid": "11111111-2222-3333-4444-555555555555",
  "accountUid": "ab1c0002",
  "name": "Voorbeeld Klant B.V.",
  "description": "",
  "onDemand": false,
  "autotaskCompanyId": "1234",
  "autotaskCompanyName": "Voorbeeld Klant B.V.",
  "devicesStatus": { "numberOfDevices": 26, "numberOfOnlineDevices": 18 },
  "portalUrl": "https://merlot.centrastage.net/csm/search/..."
}
```

`autotaskCompanyId` en `autotaskCompanyName` komen uit de Autotask-koppeling en staan direct op de
site. Je hebt dus geen eigen mappingtabel nodig om een Datto-site aan een Autotask-klant te
koppelen. Niet elke site heeft ze ingevuld.

### Device (relevante velden) ✅

```json
{
  "uid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "siteUid": "11111111-...",
  "siteName": "JUICT",
  "hostname": "SRV-VOORBEELD-01",
  "operatingSystem": "Microsoft Windows Server 2022 Standard",
  "online": true,
  "suspended": false,
  "deleted": false,
  "lastSeen": "2026-08-25T07:26:00Z",
  "lastLoggedInUser": "DOMEIN\\gebruiker",
  "rebootRequired": false,
  "deviceClass": "device",
  "udf": { "udf9": "Ping (Lowest): 10.83 ms | ..." },
  "antivirus": { },
  "patchManagement": { },
  "portalUrl": "..."
}
```

`deviceClass` is een van `device`, `printer`, `esxihost`, `rmmnetworkdevice`, `unknown`. Voor
printers en ESXi-hosts zijn er aparte audit-endpoints.

### Alert ✅

```json
{
  "alertUid": "e001f43c-...",
  "priority": "Moderate",
  "resolved": false,
  "muted": false,
  "ticketNumber": null,
  "timestamp": 1787643495000,
  "alertMonitorInfo": { "sendsEmails": false, "createsTicket": false },
  "alertContext": {
    "@class": "comp_script_ctx",
    "samples": { "Alert": "BSODView Command has Failed: ..." }
  },
  "alertSourceInfo": {
    "deviceUid": "...", "deviceName": "LAPTOP-VOORBEELD",
    "siteUid": "...", "siteName": "Voorbeeld Klant B.V."
  },
  "autoresolveMins": 1
}
```

De soort alert zit in `alertContext["@class"]` (bijvoorbeeld `comp_script_ctx`,
`perf_disk_usage_ctx`, `eventlog_ctx`), niet in `alertMonitorInfo`. De leesbare tekst staat in
`alertContext.samples`, maar de sleutels daarin verschillen per alerttype en bij sommige types is
het object leeg.

### Quick job (request) 📄

```json
{
  "jobName": "Herstart printer spooler",
  "jobComponent": {
    "componentUid": "3534b3e9-048f-4308-bf60-49d4f0defba4",
    "variables": [{ "name": "Force", "value": "true" }]
  }
}
```

`jobName` en `jobComponent` zijn allebei verplicht. Componentnamen en hun variabelen haal je op met
`GET /v2/account/components`; een variabelenaam moet exact overeenkomen met een variabele van het
component.

### UDF ✅

`POST /v2/device/{uid}/udf` met `{"udf3": "waarde"}`. Het bereik is **udf1 tot en met udf300**,
aaneengesloten; een device-respons levert alle 300 sleutels terug, ook de lege (als `null`).

Het schrijfgedrag is gemeten op 2026-08-25 met een testdevice waarvan alle UDF's leeg waren:

| Vraag | Antwoord |
|---|---|
| Wist een POST met één veld de andere UDF's? | **Nee.** Niet-meegestuurde velden blijven ongemoeid |
| Wordt een meegestuurd veld overschreven? | Ja, zonder waarschuwing |
| Kun je een veld leegmaken? | Ja, met een lege string; het veld komt daarna als `null` terug |

De POST is dus een gerichte update en geen volledige vervanging. Dat scheelt: een tagging-script dat
alleen `udf20` zet, laat een speedtest-waarde in `udf9` met rust. Let wel op de tweede regel — het
veld dat je noemt gaat er zonder meer overheen, dus lees het device eerst als je niet zeker weet of
er al iets in staat. De CLI toont dat in de preview onder "Overschrijft".

## Wat nog niet gemeten is

| Openstaand punt | Waarom het uitmaakt | Hoe je het afvinkt |
|---|---|---|
| Vorm van de quick job-respons en de jobUid | Zonder jobUid kun je het resultaat niet ophalen | `quickjob ... --confirm` op een testdevice, dan `job <jobUid>` |
| Rechten van de API-user op `custom-filters` | Vereist administrator-rol; onduidelijk of onze user die heeft | `get "v2/filter/custom-filters"` |
| Gedrag van `muted` als queryparameter op alerts | Onbekend of het filtert of alleen meta toevoegt | `get "v2/account/alerts/open?muted=true&max=2"` |
| Of `POST /v2/alert/{uid}/resolve` een body verwacht | Een lege POST kan een 400 geven | Op een eigen, onschuldige alert proberen |
| Foutvorm bij een 4xx | Bepaalt hoe we fouten netjes tonen | Een bewust verkeerde uid opvragen en de body bekijken |

## Bronnen

- OpenAPI-spec van onze eigen instantie: `https://merlot-api.centrastage.net/api/v3/api-docs`
- Swagger UI: `https://merlot-api.centrastage.net/api/swagger-ui/index.html`
- Datto RMM API-documentatie: <https://rmm.datto.com/help/en/Content/4WEBPORTAL/APIv2.htm>
