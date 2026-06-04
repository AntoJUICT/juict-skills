# autotask-api — Claude Code skill

Deelbare Claude Code skill voor het werken met de **Autotask REST API** in JUICT-projecten. Bundelt authenticatie via Azure Key Vault (met lokale env-var fallback), de geverifieerde endpoints, env vars, data structures en de hard-geleerde valkuilen — zodat geen collega opnieuw het wiel hoeft uit te vinden.

## Installeren (Claude Code plugin)

Deze repo is een Claude Code **plugin marketplace**. Voeg hem toe en installeer de plugin:

```
/plugin marketplace add AntoJUICT/autotask-api-skill
/plugin install autotask-api@juict-skills
```

Claude pikt de skill daarna automatisch op. Roep aan met `/autotask-api` of laat Claude hem zelf laden bij Autotask-werk. Updaten van de marketplace: `/plugin marketplace update juict-skills`.

## Structuur

```
.claude-plugin/
  marketplace.json     # marktplaats-catalogus (juict-skills) → verwijst naar deze plugin
  plugin.json          # plugin-manifest (autotask-api)
skills/autotask-api/
  SKILL.md             # Instap: Key Vault-auth, quick start, debugchecklist
  REFERENCE.md         # Base URL/zone, headers, env vars, Key Vault secret-namen, endpoints, data structures
  LESSONS.md           # Valkuilen: nested endpoints, TimeEntries, dotenv-escaping, rate limiting
  scripts/
    azure-keyvault.ts  # getSecret() met DefaultAzureCredential + 1u-cache
    autotask-client.ts # autotaskFetch / fetchAllAutotask / buildFilter, Key Vault + env fallback
```

## Bijwerken

Nieuwe les of endpoint geleerd? Gebruik (als maintainer) de companion-skill `/autotask-api-update` — die extraheert de les uit je sessie, werkt het juiste bestand bij in `skills/autotask-api/` en pusht naar deze repo. Collega's halen de update op met `/plugin marketplace update juict-skills`.

## Veiligheid

Deze repo bevat **geen secrets** — alleen secret-*namen* (de waarden staan in Azure Key Vault of in een lokale `.env`). Houd de repo private: het betreft JUICT-interne API-kennis.
