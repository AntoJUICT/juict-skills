# autotask-api — Claude Code skill

Deelbare Claude Code skill voor het werken met de **Autotask REST API** in JUICT-projecten. Bundelt authenticatie via Azure Key Vault (met lokale env-var fallback), de geverifieerde endpoints, env vars, data structures en de hard-geleerde valkuilen — zodat geen collega opnieuw het wiel hoeft uit te vinden.

## Installeren

Kloon deze repo in je Claude Code skills-map:

```bash
git clone https://github.com/AntoJUICT/autotask-api-skill.git ~/.claude/skills/autotask-api
```

Claude pikt de skill daarna automatisch op. Roep aan met `/autotask-api` of laat Claude hem zelf laden bij Autotask-werk.

## Inhoud

| Bestand | Inhoud |
|---------|--------|
| `SKILL.md` | Instap: Key Vault-auth, quick start, debugchecklist |
| `REFERENCE.md` | Base URL/zone, headers, env vars, Key Vault secret-namen, geverifieerde endpoints, filters, data structures, retry |
| `LESSONS.md` | Valkuilen: nested endpoints, TimeEntries, dotenv-escaping, rate limiting, data-inconsistenties |
| `scripts/azure-keyvault.ts` | `getSecret()` met `DefaultAzureCredential` + 1u-cache |
| `scripts/autotask-client.ts` | `autotaskFetch` / `fetchAllAutotask` / `buildFilter`, Key Vault + env fallback |

## Bijwerken

Nieuwe les of endpoint geleerd? Gebruik de companion-skill `/autotask-api-update` — die extraheert de les uit je sessie, werkt het juiste bestand bij en pusht naar deze repo. Update daarna lokaal met `git -C ~/.claude/skills/autotask-api pull`.

## Veiligheid

Deze repo bevat **geen secrets** — alleen secret-*namen* (de waarden staan in Azure Key Vault of in een lokale `.env`). Houd de repo private: het betreft JUICT-interne API-kennis.
