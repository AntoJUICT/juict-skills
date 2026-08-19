# Ontwerp: `itglue-api` skill

Datum: 2026-07-31
Repo: `AntoJUICT/juict-skills` (publieke marketplace)
Branch: `feature/itglue-api-skill`

## Doel

Een org-brede Claude Code skill voor de IT Glue REST API, in dezelfde vorm als `autotask-api`. De skill dekt twee soorten gebruik:

1. **Developer-referentie:** auth via Key Vault, base URL, JSON:API-vorm, endpoints, paginatie, filters, valkuilen, plus een kopieerbare client voor JUICT-projecten.
2. **Operationele lookups:** tijdens een ticket direct organisaties, configuraties, contacten, documenten en flexible assets opzoeken via een read-only CLI.

Kernrandvoorwaarde: **password-access staat uit op onze API-key.** De skill haalt nooit wachtwoordwaarden op en geeft bij een wachtwoordvraag alleen een deeplink naar het juiste item in IT Glue.

## Plek en structuur

```
plugins/itglue-api/
  .claude-plugin/plugin.json
  skills/itglue-api/
    SKILL.md              instap: wanneer gebruiken, quick start, password-regel, debugchecklist
    REFERENCE.md          base URL/regio, auth, JSON:API-vorm, paginatie, filters, endpoints, datastructuren
    LESSONS.md            valkuilen en lessons learned
    itglue-openapi.yaml   gebundelde OpenAPI-spec (bron: jmaddington/ITG-Glue-OpenAPI)
    scripts/
      azure-keyvault.ts   getSecret() met DefaultAzureCredential en 1u-cache (uit autotask-api)
      itglue-client.ts    itglueFetch, fetchAllItGlue, buildFilter; Key Vault + env fallback
      itglue-lookup.mjs   standalone read-only CLI met az-fallback voor de key
```

Plus een entry in `.claude-plugin/marketplace.json` met `"source": "./plugins/itglue-api"`.

## Authenticatie

| Omgeving | Bron |
|---|---|
| Productie (Container Apps) | Key Vault `juict-shared-kv`, secret `itglue-api-key`, via managed identity |
| Lokaal / CLI | env var `ITGLUE_API_KEY`, of fallback `az keyvault secret show` |

`juict-shared-kv` gebruikt access policies, geen RBAC. Een nieuwe managed identity moet dus met `az keyvault set-policy --secret-permissions get list` gekoppeld worden, anders faalt de keyvaultref.

Requests:

```
GET https://api.eu.itglue.com/<resource>
x-api-key: <key>
Content-Type: application/vnd.api+json
```

Regio-keuze staat vast op EU (`api.eu.itglue.com`) met `ITGLUE_BASE_URL` als override. Portal-basis voor deeplinks: `https://juict.eu.itglue.com`, override via `ITGLUE_PORTAL_URL`.

## Password-beleid (hard)

1. `GET /passwords/{id}` is een **verboden pad**. Zowel `itglue-client.ts` als `itglue-lookup.mjs` weigeren dit pad met een expliciete error, vóór er een request uitgaat. Dat is een codematige blokkade, geen instructie die een latere sessie kan wegpraten.
2. Collectie-endpoints (`GET /passwords?filter[organization_id]=...`, `GET /organizations/{id}/relationships/passwords`) mogen wel: die zijn nodig om het juiste item-id te vinden en leveren geen wachtwoordwaarde.
3. De output van een wachtwoord-lookup bestaat uit **precies twee dingen per treffer**: de naam van het password-item en de deeplink. Geen username, geen categorie, geen otp-vlag, geen url-veld van het onderliggende systeem.
4. Deeplink-vorm: `https://juict.eu.itglue.com/<organization-id>/passwords/<password-id>`.
5. SKILL.md benoemt expliciet dat een verzoek om "de waarde even op te halen" niet uitgevoerd wordt, met de reden: de key heeft geen password-access, en een wachtwoordwaarde in een transcript is een incident.

Deze regel geldt ook voor de TOTP-seed: die is niet via de API beschikbaar (alleen `otp-enabled` als boolean), dus onbemande TOTP-flows op basis van IT Glue kunnen niet.

## Lookup-CLI

`node itglue-lookup.mjs <subcommand> [args]`, alles read-only:

| Subcommand | Doet |
|---|---|
| `org <naam>` | Organisatie zoeken op naam, met client-side normalisatie van rechtsvormsuffixen (B.V., BV, Holding) omdat `filter[name]` breed matcht |
| `configs <org> [zoekterm]` | Configuraties: naam, type, primair IP, OS, status |
| `contacts <org> [zoekterm]` | Contacten met rol en e-mail |
| `docs <org> [zoekterm]` | Documenten met deeplink |
| `assets <org> [type]` | Flexible assets, optioneel gefilterd op asset-type |
| `password-link <org> <zoekterm>` | Alleen item-naam + deeplink, conform password-beleid |

Elk subcommand accepteert een org op naam of op id. Uitvoer standaard mensleesbaar, met `--json` voor machineleesbaar.

## Kopieerbare client (`itglue-client.ts`)

- `itglueFetch<T>(path, init?)` — voegt auth-header toe, kiest Key Vault of env, parseert JSON:API en gooit op een niet-2xx met status plus foutbody.
- `fetchAllItGlue<T>(path, filters?)` — loopt `page[number]` door tot `meta.next-page` leeg is, sequentieel vanwege rate limiting.
- `buildFilter({...})` — bouwt `filter[key]=value`-querystrings.
- Rate limiting: semafoor met max 2 gelijktijdige requests plus retry met backoff op 429, zelfde aanpak als de Autotask-client.
- Attribuutsleutels zijn kebab-case (`organization-id`, `password-category-name`); `username` en `password` zijn plain. De client normaliseert niet, maar REFERENCE.md documenteert het per resource.

## Verificatiestatus

Elke endpoint in REFERENCE.md krijgt een marker:

- ✅ geverifieerd, met datum
- 📄 alleen uit documentatie of de OpenAPI-spec, nog niet zelf getest

Al geverifieerd (2026-07-21, EU-API): `GET /organizations?filter[name]=`, `GET /organizations/{id}/relationships/passwords`, `GET /passwords?filter[organization_id]=`, en het gegeven dat wachtwoordwaarden niet in collectie-responses zitten. Vóór oplevering volgt een read-only verificatieronde met GET's op organizations, configurations, contacts, locations, flexible-asset-types en flexible-assets, om paginatie-meta, filternamen en foutcodes te bevestigen. Die ronde raakt `/passwords/{id}` niet.

## LESSONS.md startinhoud

- Wachtwoordwaarden: niet via collectie-endpoints, en op onze key ook niet via de individuele resource. Behandel als niet-ophaalbaar; lever de deeplink.
- TOTP-seed niet beschikbaar via de API.
- Attribuutsleutels kebab-case, behalve `username` en `password`.
- `filter[name]` matcht breed: client-side normaliseren en exact vergelijken op genormaliseerde naam.
- Rate limiting en paginatie-gedrag (na de verificatieronde met echte cijfers vullen).

## Buiten scope

- Schrijfacties (POST/PATCH/DELETE) op IT Glue. De skill is read-only; schrijven vraagt eigen ontwerp en toestemming.
- Een `itglue-api-update` companion-skill zoals `autotask-api-update`. Kan later, pas als er genoeg nieuwe lessen zijn om het onderhoud te rechtvaardigen.
- Synchronisatie tussen IT Glue en Autotask.

## Uitrol

1. Branch `feature/itglue-api-skill` met plugin-map, spec en marketplace-entry.
2. PR naar `main` in `AntoJUICT/juict-skills` (voorstellen, niet zelf mergen zonder akkoord).
3. Na merge: plugin enablen in de Claude organization managed settings (`itglue-api@juict-skills: true`). Dat doet Anto zelf.
