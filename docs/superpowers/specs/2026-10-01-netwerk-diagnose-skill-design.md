# Ontwerp: `netwerk-diagnose` skill (fase 1: UniFi)

Datum: 2026-10-01
Repo: `AntoJUICT/juict-skills` (publieke marketplace)
Branch: `feature/1040-netwerk-diagnose-skill`
Work item: Azure Boards #1040 (project JUICT-Scripts)

## Doel

Bij een netwerkmelding van een klant snel en klantspecifiek alle relevante UniFi-data ophalen (actuele stand, historie en gebeurtenissen) zodat Claude een onderbouwde diagnose kan geven: wat speelt er, wat is de oorzaak, is het een storing of normaal gedrag, en wat is het advies met de eerlijke afweging.

Twee soorten gebruik, met ticket-diagnose als standaard:

1. **Ticket-diagnose:** de gebruiker noemt een Autotask-ticketnummer of een klant; de skill haalt alles op en levert een analyse.
2. **Gerichte vragen:** losse vragen zoals "wanneer viel toestel X van de wifi" of "welke wifi-instellingen staan er bij klant Y".

Fase 1 dekt alleen UniFi. Sophos (configuratie via XML-API, logs via syslog) volgt in een latere fase binnen dezelfde plugin; de naam `netwerk-diagnose` laat daar ruimte voor.

## Randvoorwaarden

- **Alleen lezen.** De skill wijzigt nooit iets in UniFi. Dit is in code afgedwongen, niet alleen in de tekst.
- **Geheimen nooit in de uitvoer.** `rest/wlanconf` geeft het wifi-wachtwoord terug (`x_passphrase`). Alle `x_*`-velden en radius-secrets worden verwijderd voordat iets wordt geprint of als JSON wordt teruggegeven.
- **TLS altijd verifiëren.** Het controllercertificaat is geldig; er is geen optie om verificatie uit te zetten.
- **Geen klantdata in de repo.** De repo is publiek: geen klantnamen, site-ID's, IT Glue-ID's of de controller-URL in documentatie, tests of voorbeelden. Testdata is verzonnen.
- **Uitkomst in de chat.** Na een diagnose biedt de skill aan om de bevindingen als interne notitie in het Autotask-ticket te zetten (plus een voorstel voor tijdregistratie en status). Schrijven naar Autotask gebeurt alleen na expliciet akkoord, via de `autotask-api` skill.

## Plek en structuur

```
plugins/netwerk-diagnose/
  .claude-plugin/plugin.json
  skills/netwerk-diagnose/
    SKILL.md                    workflow, diagnose-checklist met drempels, harde regels
    REFERENCE.md                geverifieerde UniFi-endpoints met datum, velden, eenheden
    LESSONS.md                  valkuilen en lessons learned
    scripts/
      unifi-lookup.mjs          standalone read-only CLI, geen npm-deps, Node 18+
      unifi-lookup.test.mjs     unit-tests (node:test), zonder netwerk
      kv-secret.py              Key Vault-fallback via de Azure SDK
      plugin-structuur.test.mjs structuurcheck zoals bij de andere plugins
```

Plus een entry in `.claude-plugin/marketplace.json` (`"source": "./plugins/netwerk-diagnose"`) en een regel in de plugin-tabel van `README.md`.

## Authenticatie

Secrets in Key Vault `juict-shared-kv`:

| Secret | Inhoud |
|---|---|
| `UNIFI-URL` | basis-URL van de controller (incl. poort) |
| `UNIFI-USER` | lokaal controller-account, rol View Only, zonder 2FA |
| `UNIFI-PASS` | wachtwoord van dat account |

Volgorde waarin de CLI de waarden ophaalt, per secret:

1. `az keyvault secret show --vault-name juict-shared-kv --name <secret>` (zoals de andere skills);
2. env vars `UNIFI_URL`, `UNIFI_USER`, `UNIFI_PASS`;
3. `python kv-secret.py <secret>` (Azure SDK, `DefaultAzureCredential`). Nodig in omgevingen waar de `az keyvault`-CLI-route geblokkeerd is.

Slaagt geen van de drie, dan noemt de foutmelding alle drie de routes. Secret-waarden worden nooit gelogd of geprint; `kv-secret.py` schrijft de waarde alleen naar stdout van het aanroepende proces.

Login via `POST /api/login` (cookie-sessie), afsluiten met `POST /api/logout`. Geverifieerd 2026-10-01 op UniFi Network 10.5.67: het account heeft rol `readonly` op alle sites.

## Koppeling klant naar UniFi-site

UniFi-sitenamen hebben het formaat `<Klantnaam> (<IT Glue-organisatie-ID>)`. Het IT Glue-ID is de betrouwbare sleutel; Autotask-bedrijven zijn dat niet (sommige klanten hebben per vestiging een eigen Autotask-bedrijf, andere hebben twee Autotask-bedrijven met één netwerk).

De UniFi-CLI kent geen Autotask of IT Glue. Claude koppelt in stappen:

1. Ticket naar Autotask-bedrijf (`autotask-api`);
2. Autotask-bedrijf naar IT Glue-organisatie (`itglue-api`);
3. `unifi-lookup.mjs site <itglue-id>`:
   - precies één site: door;
   - geen site op ID: terugval op naam (`site "<naam>"`), en Claude vraagt de gebruiker om bevestiging;
   - meerdere sites: lijst tonen, de gebruiker kiest.

De skill gokt nooit stil een site.

## CLI: `unifi-lookup.mjs`

Subcommando's (standaard een compacte tabel, met `--json` gestructureerde, opgeschoonde data):

| Commando | Wat | Endpoints |
|---|---|---|
| `sites [zoekterm]` | sites met naam, IT Glue-ID, site-ID | `GET /api/self/sites` |
| `site <itglue-id\|naam>` | koppelt naar precies één site, of geeft kandidaten | `GET /api/self/sites` |
| `snapshot <site>` | apparaten (model, firmware, upgrade, uptime), radio's (kanaal, breedte, zendvermogen vs. maximum, DFS), clients (signaal, band, AP, uptime), wifi-instellingen per SSID (802.11r/v, roaming assistant, minimum rate, band, PMF) | `GET /api/s/{site}/stat/device`, `GET /api/s/{site}/stat/sta`, `GET /api/s/{site}/rest/wlanconf` |
| `events <site> [--dagen N]` | verbinden, verbreken, roamen; roams met signaal voor en na, band, kanaal, AP van/naar | `POST /v2/api/site/{site}/system-log/all` met `categories: ["CLIENT_DEVICES"]` |
| `client <site> <naam\|mac\|ip>` | één toestel: actuele stand plus zijn gebeurtenissen | combinatie van bovenstaande, plus `GET /api/s/{site}/stat/alluser` |

Toegestane verzoeken (allowlist, op segmentniveau genormaliseerd zodat afwijkende casing, dubbele slashes en `%2F` niet helpen):

- `GET` op de leespaden hierboven;
- `POST /api/login`, `POST /api/logout`;
- `POST /v2/api/site/{site}/system-log/all` (query, leest alleen).

Elk ander verzoek weigert de CLI voordat het verstuurd wordt.

Bekend uit verkenning (2026-10-01, Network 10.5.67): `GET /api/s/{site}/stat/event` en `GET /api/s/{site}/stat/alarm` geven 404; gebeurtenissen lopen via de v2 system-log. Geldige categorieën: `SECURITY, UNIFI_DEVICES, SOFTWARE_UPDATES, VPN, POWER, UNIFI_ETHERNET_PORTS, CLIENT_DEVICES, UNKNOWN, AUDIT, INTERNET_AND_WAN`. Paginering via `pageSize`/`pageNumber`, respons met `total_page_count`.

## Workflow in SKILL.md

Ticket-diagnose:

1. Ticket read-only ophalen (`autotask-api`): omschrijving, notities en tijdregistraties; wat al onderzocht is meenemen.
2. Klant koppelen aan een site (zie hierboven).
3. `snapshot` en `events --dagen 14`; noemt het ticket een persoon of toestel, dan ook `client`.
4. Historie via de Grafana-MCP (Prometheus, unpoller): minimum en gemiddeld signaal per client over 14 dagen, clients per AP, retries. Label `site_name` matcht de UniFi-sitenaam.
5. Analyse volgens de checklist.
6. Aanbieden om het als interne notitie in het ticket te zetten; tijdregistratie en status alleen voorstellen, zetten na akkoord.

Gerichte vraag: direct naar stap 2 of 3 en alleen ophalen wat nodig is.

## Diagnose-checklist (eerste versie)

| Onderwerp | Wat bekijken | Drempel / signaal |
|---|---|---|
| Dekking | signaal per client, minimum en gemiddeld | ≥ -67 dBm goed; -67 tot -75 krap; -75 tot -80 slecht; < -80 onbruikbaar voor spraak |
| Capaciteit | clients per AP, kanaalbezetting | veel clients op één AP terwijl een andere leeg is |
| Radio's | kanaaloverlap, DFS, kanaalbreedte, zendvermogen vs. maximum | 2,4 GHz anders dan 1/6/11; DFS met radar-events; vermogen al ~maximaal betekent geen winst via instellingen |
| Roaming | aantal roams, roams naar zwak signaal, blijven hangen aan verre AP, 802.11r/v, roaming assistant, minimum rate | roam-beslissing naar een signaal < -75 dBm |
| Apparatuur | model en leeftijd, firmware, upgrade beschikbaar, uptime en herstarts | wifi 5-AP's op een plek met hoge eisen |
| Verbreken | verbreek-events per toestel, met tijd, AP en band | patroon op een vaste plek of tijd |

De checklist is richtinggevend; Claude benoemt het als de oorzaak onduidelijk is en verzint geen oorzaak.

## Foutafhandeling

- **Login mislukt:** duidelijke melding met mogelijke oorzaken (verkeerd account, 2FA aan, account geblokkeerd), zonder secret-waarden.
- **Endpoint geeft 404:** melding met verwijzing naar `LESSONS.md` (UniFi wijzigt endpoints tussen versies); de CLI gaat door met de overige onderdelen en meldt welk deel ontbreekt.
- **Key Vault:** zie Authenticatie; foutmelding noemt alle drie de routes.
- **Grote sites:** events worden gepagineerd tot een maximum (standaard 20 pagina's van 200); bij het bereiken van het maximum meldt de CLI dat de lijst is afgekapt.
- **Geen Grafana-data voor een site:** Claude meldt dat en gaat verder met snapshot en events.

## Testen

Unit-tests (`node:test`, zonder netwerk):

- **Geheimen filteren:** `x_passphrase`, alle `x_*`-velden en radius-secrets worden verwijderd, ook genest en in arrays.
- **Allowlist:** elk niet-toegestaan pad of elke niet-toegestane methode wordt geweigerd, ook met afwijkende casing, dubbele slashes, `%2F` of een achtervoegsel.
- **Site koppelen:** IT Glue-ID uit de sitenaam halen; één match, geen match, meerdere matches; terugval op naam.
- **Omrekenen:** kanaal naar DFS ja/nee, zendvermogen vs. maximum, events plat maken tot rijen (tijd, toestel, van-AP, naar-AP, signaal voor/na).
- **Key Vault-volgorde:** `az`, dan env, dan Python-helper, met gemockte aanroepen.
- **Structuur:** `plugin.json`, entry in `marketplace.json`, regel in de README-tabel.

Integratietest (handmatig, read-only, tegen de echte controller): alle subcommando's op één testsite; controleren dat geen wachtwoord in de uitvoer staat; per endpoint ✅ met datum in `REFERENCE.md`.

Acceptatie: een recente wifi/VoIP-diagnose die eerder met de hand is gedaan opnieuw uitvoeren met de skill. De skill moet zelfstandig tot dezelfde conclusie komen, aangevuld met de roam-events.

## Buiten scope (fase 1)

- Sophos (configuratie, logs, QoS-regels): fase 2.
- Schrijfacties in UniFi.
- Automatisch schrijven naar Autotask zonder akkoord.
- Een kopieerbare TypeScript-client voor projecten (kan later, als er vraag naar is).
