# Lessons learned: netwerk-diagnose

## UniFi API

**`stat/event` en `stat/alarm` bestaan niet meer.** Op Network 10.5.67 geven ze 404. Gebeurtenissen lopen via
`POST /v2/api/site/{site}/system-log/all` met een categorie. ✅ 2026-10-01
- How to apply: krijg je een 404 op een klassiek endpoint, zoek eerst de v2-tegenhanger voordat je concludeert dat
  de data er niet is.

**De categorie heet `CLIENT_DEVICES`, niet `CLIENT_CONNECTION`.** Een onbekende categorie geeft 400 met de lijst
geldige waarden in de foutmelding. Het veld `type` in een event (`CLIENT_CONNECTION`) is iets anders dan de
categorie. ✅ 2026-10-01

**`rest/wlanconf` kan het wifi-wachtwoord bevatten (`x_passphrase`).** Met het readonly-account kwam het veld niet
mee, maar met een beheerdersaccount of een andere versie wel. De CLI filtert alle `x_*`- en geheime velden altijd.
✅ 2026-10-01
- How to apply: vertrouw nooit op de rol van het account om geheimen buiten de uitvoer te houden.

**Sitenamen worden op 64 tekens afgekapt.** Bij lange klantnamen valt het IT Glue-ID (deels) weg, bv.
`Naam B.V.(12345`. Zoeken op ID vindt die site dan niet; de naamroute wel. ✅ 2026-10-01

**De system-log bewaart events maar kort.** Op de echte controller gaf `events --dagen 14` alleen events van de
laatste uren (de oudste was dezelfde ochtend). Een lege of korte lijst betekent dus niet dat er niets gebeurd is.
- How to apply: draai `events` zo snel mogelijk na een incident, noem de oudste event-tijd in de analyse en zeg
  eerlijk als het incident buiten dat venster valt.

**Klant, Autotask-bedrijf en netwerk zijn niet één-op-één.** Sommige klanten hebben per vestiging een eigen
Autotask-bedrijf en een eigen site; andere hebben twee Autotask-bedrijven met één netwerk. Koppel via het IT Glue-ID
en vraag bij twijfel de gebruiker.

**Modelcode U7PG2 is een UAP-AC-Pro (wifi 5), geen U7 Pro.** De gelijkenis verwart makkelijk in een advies.

## Omgeving

**`az keyvault secret show` kan geblokkeerd zijn voor Claude.** Daarom de fallback naar `kv-secret.py` (Azure SDK
met `DefaultAzureCredential`). Zet secrets nooit in een `.env`-bestand.

**Op Windows is `az` eigenlijk `az.cmd`.** De CLI roept het aan via `cmd.exe /d /s /c az ...` omdat Node.js
het rechtstreeks niet kan uitvoeren.

**Op Node 24 faalt `node --test <map>`.** Gebruik de glob: `node --test plugins/netwerk-diagnose/skills/netwerk-diagnose/scripts/*.test.mjs`.
