---
name: netwerk-diagnose
description: Netwerkproblemen bij een klant diagnosticeren met read-only UniFi-data (sites, apparaten, radio's, clients, wifi-instellingen, verbind-, verbreek- en roam-events) plus historie via Grafana. Gebruik bij een netwerk- of wifiticket, wegvallende verbindingen, slechte VoIP-kwaliteit, of een vraag over de wifi-instellingen van een klant.
---

# Netwerk-diagnose

Deze skill helpt bij het uitzoeken van netwerkproblemen bij een klant. Fase 1 dekt UniFi; Sophos volgt later.
De CLI `scripts/unifi-lookup.mjs` haalt de actuele stand en de gebeurtenissen op; de historie komt uit Grafana.
Claude maakt daar de diagnose van.

## Harde regels

1. **Alleen lezen.** De CLI weigert elk verzoek dat niet op de allowlist staat. Wijzig nooit iets in UniFi, ook
   niet via een andere route.
2. **Geen geheimen tonen.** Wifi-wachtwoorden en andere geheime velden worden door de CLI weggefilterd. Haal ze
   nooit op een andere manier op en zet ze nooit in een ticket of chat.
3. **Nooit stil een site gokken.** Gevonden op naam of meerdere kandidaten: laat de gebruiker kiezen of bevestigen.
4. **Pas schrijven naar Autotask na akkoord.** De uitkomst komt in de chat; een interne notitie, tijdregistratie of
   statuswijziging alleen na expliciet akkoord, via de `autotask-api` skill.
5. **De controller-URL moet https zijn.** De CLI weigert http-verbindingen.

## Workflow: ticket-diagnose (standaard)

1. **Ticket lezen** met `autotask-api` (read-only): omschrijving, notities en de Summary Notes van de time entries.
   Neem mee wat al onderzocht is.
2. **Klant koppelen aan een site.** Autotask-bedrijf naar IT Glue-organisatie met `itglue-api`, daarna:
   `node scripts/unifi-lookup.mjs site <itglue-id>`.
   - Eén site: door.
   - "Geen site met dit IT Glue-ID": probeer `site "<klantnaam>"` (sitenamen worden op 64 tekens afgekapt, en
     sommige klanten hebben twee Autotask-bedrijven met één netwerk) en laat de gebruiker bevestigen.
   - Meerdere sites: toon ze en laat de gebruiker kiezen.
3. **Actuele stand en gebeurtenissen:**
   - `node scripts/unifi-lookup.mjs snapshot <site-id> --json`
   - `node scripts/unifi-lookup.mjs events <site-id> --dagen 14 --json`
   - Noemt het ticket een persoon of toestel: `node scripts/unifi-lookup.mjs client <site-id> "<naam|mac|ip>" --json`
   - De system-log van UniFi bewaart events kort: vaak slechts de laatste uren, ook bij `--dagen 14`. Historie komt
     uit Grafana; draai `events` kort na een incident en noem altijd de oudste event-tijd (de regel "Events
     beschikbaar vanaf") in de analyse. `--dagen` accepteert 1 t/m 90 (standaard 14); er worden maximaal 20
     pagina's van 200 events opgehaald, daarna meldt de CLI dat de lijst is afgekapt.
   - Gebruik opties met spatie, niet met `=` (bijv. `--dagen 7`, niet `--dagen=7`); onbekende opties worden geweigerd.
4. **Historie via de Grafana-MCP** (Prometheus-datasource, unpoller). Het label `site_name` begint met de
   sitenaam; filter met `site_name=~"<sitenaam>.*"`. Nuttige queries:
   - `min_over_time(unpoller_client_radio_signal_db{site_name=~"<sitenaam>.*"}[14d])` en `avg_over_time(...)`
   - `sum by (name, radio) (unpoller_device_radio_stations{site_name=~"<sitenaam>.*"})` als range-query
   - `unpoller_client_transmit_retries_total` voor retries (niet geverifieerd)
   - Sitenamen in `site_name=~"..."` zijn een regex: escape tekens als `+ ( ) .` met `\`.
   Geen data voor de site: meld dat en ga door met snapshot en events.
5. **Analyse volgens de checklist hieronder.** Lever in de chat: wat speelt er, de oorzaak (of eerlijk: onduidelijk),
   is het een storing of normaal gedrag, en het advies met de afweging.
6. **Aanbieden:** "Zal ik dit als interne notitie in het ticket zetten?" Stel ook een tijdregistratie en status voor.

## Workflow: gerichte vraag

Spring direct naar stap 2 of 3 en haal alleen op wat nodig is. Voorbeelden: "wanneer viel toestel X weg" is
`client`; "welke wifi-instellingen heeft klant Y" is `snapshot` (sectie wifi-instellingen).

## Diagnose-checklist

| Onderwerp | Wat bekijken | Drempel / signaal |
|---|---|---|
| Dekking | `signaal` en `beoordeling` per client; minimum en gemiddelde uit Grafana | ≥ -67 dBm goed; -67 tot -75 krap; -75 tot -80 slecht; < -80 onbruikbaar voor spraak |
| Capaciteit | `clients` per radio, `kanaalbezetting` | veel clients op één AP terwijl een andere leeg is; bezetting structureel hoog |
| Radio's | `kanaal`, `breedte`, `dfs`, `zendvermogen` vs. `maxZendvermogen` (`ruimte`) | 2,4 GHz buiten 1/6/11 of op 40 MHz; DFS-kanaal plus verbreek-events tegelijk op alle clients; `ruimte` ≤ 3 dB betekent dat hoger zetten niets oplevert |
| Roaming | roam-events (`signaalVoor` → `signaal`), `roams` per client, wifi-instellingen (`bssTransition80211v`, `fastRoaming80211r`, `roamingAssistant5`, `minRate24/5`) | roam naar een signaal < -75 dBm; toestel blijft hangen op een zwakke AP |
| Apparatuur | `model`, `firmware`, `upgradeBeschikbaar`, `uptimeDagen` | wifi 5-AP's (bv. UAP-AC-Pro, modelcode U7PG2) waar spraak over wifi gaat; korte uptime wijst op herstarts |
| Verbreken | `verbroken`-events met tijd, AP, band en signaal | patroon op een vaste plek, AP of tijd (bv. lunch: magnetron op 2,4 GHz) |

Benoem het als de oorzaak onduidelijk is. Verzin geen oorzaak. QoS of tuning helpt pas als het signaal goed is;
bij een dekkingsgat is een extra of betere AP de echte oplossing. Benoem dan ook de afweging (kosten, meting nodig).

## Debugchecklist

1. Secret niet op te halen: de melding noemt de drie routes (az, env var, `kv-secret.py`). Is `az keyvault`
   in jouw omgeving geblokkeerd, gebruik dan `--kv python`: de CLI slaat az dan helemaal over.
2. Inloggen mislukt: controleer het account in de controller (View Only, lokaal, geen 2FA).
3. "Endpoint geeft 404": zie LESSONS.md; UniFi wijzigt endpoints tussen versies.
4. "Geweigerd": het verzoek staat niet op de allowlist. Dat is opzet; breid de allowlist alleen uit met een
   leesendpoint, met test, via een PR.

Zie [REFERENCE.md](REFERENCE.md) voor endpoints en velden, [LESSONS.md](LESSONS.md) voor valkuilen.
