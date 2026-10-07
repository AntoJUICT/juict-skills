# UniFi-referentie voor netwerk-diagnose

Geverifieerd tegen UniFi Network 10.5.67 (self-hosted controller), met een lokaal View Only-account.
✅ = getest met datum. Geen klantdata in dit bestand: de repo is publiek.

## Auth

| Wat | Waarde |
|---|---|
| Key Vault | `juict-shared-kv` |
| Secrets | `UNIFI-URL` (basis-URL incl. poort), `UNIFI-USER`, `UNIFI-PASS` |
| Env vars (fallback) | `UNIFI_URL`, `UNIFI_USER`, `UNIFI_PASS` |
| Login | `POST /api/login` met `{username, password}`; sessie via cookie `unifises`, plus header `X-Csrf-Token` uit de login-respons ✅ 2026-10-01 |
| Logout | `POST /api/logout` ✅ 2026-10-01 |
| Rol | `readonly` op alle sites ✅ 2026-10-01 |

## Endpoints

| Doel | Endpoint | Status |
|---|---|---|
| Sites | `GET /api/self/sites` (velden `name` = korte site-ID, `desc` = "Klantnaam (IT Glue-ID)", `device_count`) | ✅ 2026-10-01 |
| Apparaten en radio's | `GET /api/s/{site}/stat/device` | ✅ 2026-10-01 |
| Actuele clients | `GET /api/s/{site}/stat/sta` | ✅ 2026-10-01 |
| Bekende clients | `GET /api/s/{site}/stat/alluser?within=<uren>` | ✅ 2026-10-01 |
| Wifi-instellingen | `GET /api/s/{site}/rest/wlanconf` | ✅ 2026-10-01 |
| Gebeurtenissen | `POST /v2/api/site/{site}/system-log/all` | ✅ 2026-10-01 |
| Oude gebeurtenissen | `GET /api/s/{site}/stat/event`, `GET /api/s/{site}/stat/alarm` | ❌ 404 op 10.5.67 |

## Velden die de CLI gebruikt

**`stat/device`:** `name`, `type` (`uap`/`usw`/...), `model`, `mac`, `version`, `upgradable`, `uptime` (seconden),
`state` (1 = online), `num_sta`. Per radio in `radio_table`: `name` (`wifi0`/`wifi1`), `radio` (`ng` = 2,4 GHz,
`na` = 5 GHz, `6e` = 6 GHz), `ht`, `max_txpower`, `min_txpower`, `min_rssi_enabled`, `min_rssi`. In
`radio_table_stats`: `channel`, `tx_power` (dBm), `bw`, `num_sta`, `cu_total` (kanaalbezetting %), `tx_retries_pct`.

**`stat/sta`:** `hostname`, `name`, `mac`, `ip`, `ap_mac`, `radio`, `channel`, `signal` (dBm), `essid`, `uptime`,
`is_wired`, `roam_count`, `wifi_tx_retries_percentage`, `satisfaction`.

**`stat/alluser`:** `hostname`, `name`, `mac`, `last_ip`, `last_seen` (Unix-seconden), `is_wired`.

**`rest/wlanconf`:** `name`, `enabled`, `security`, `wpa_mode`, `wlan_band`, `fast_roaming_enabled` (802.11r),
`bss_transition` (802.11v), `roaming_assistant_na_enabled` + `roaming_assistant_na_rssi`, `minrate_ng_enabled` +
`minrate_ng_data_rate_kbps`, `minrate_na_enabled` + `minrate_na_data_rate_kbps`, `pmf_mode`, `uapsd_enabled`.

**`system-log/all`:** body `{timestampFrom, timestampTo, pageSize, pageNumber, categories}` (ms sinds epoch). De system-log bewaart events kort (vaak slechts uren); lege of korte uitkomsten bij `--dagen 14` zijn normaal.
Geldige categorieën: `SECURITY, UNIFI_DEVICES, SOFTWARE_UPDATES, VPN, POWER, UNIFI_ETHERNET_PORTS, CLIENT_DEVICES,
UNKNOWN, AUDIT, INTERNET_AND_WAN`. Respons: `{data, page_number, total_element_count, total_page_count}`.
Events in `CLIENT_DEVICES`: `CLIENT_ROAMED`, `CLIENT_CONNECTED_WIRELESS`, `CLIENT_DISCONNECTED_WIRELESS`,
`CLIENT_CONNECTED_WIRED`, `CLIENT_DISCONNECTED_WIRED`. Parameters zijn objecten met `name` (de waarde als tekst):
`CLIENT` (`id` = MAC, `name`, `hostname`, `ip`), `DEVICE_FROM`/`DEVICE_TO`/`DEVICE` (`name`, `model`),
`SIGNAL_STRENGTH`, `PREVIOUS_SIGNAL_STRENGTH`, `RADIO_BAND`, `CHANNEL`, `WLAN`, `DURATION`.

