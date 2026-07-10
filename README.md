# juict-skills — Claude Code marketplace

Deelbare Claude Code skills voor JUICT-projecten, gebundeld in één plugin-marketplace. Elke skill is een aparte plugin, zodat je ze los kunt in- en uitschakelen. Zo hoeft geen collega opnieuw het wiel uit te vinden.

## Skills in deze marketplace

| Plugin | Waarvoor |
|--------|----------|
| `autotask-api` | Werken met de Autotask REST API — Key Vault-auth, geverifieerde endpoints, data structures, lessons learned |
| `tdsynnex` | Rewst-workflows tegen de TD Synnex StreamOne Ion API v3 (subscriptions, seats, catalog, quirks) |
| `azure-saas-devops-deploy` | Klant-automation deployen naar een dedicated Azure subscription via Azure DevOps Pipelines en Bicep/AVM |
| `ticket-aanmaken` | Autotask-supportticket aanmaken vanuit vrije tekst, met goedkeuring vooraf |
| `ticket-reactie` | Autotask-ticket onderzoeken en een concept klantreactie opstellen |
| `site-scraper` | Technische opbouw van een website in kaart brengen (framework, routes, API-endpoints), ook achter login |

## Installeren (Claude Code plugin)

Deze repo is een Claude Code **plugin marketplace**. Voeg hem toe en installeer de gewenste plugin(s):

```
/plugin marketplace add AntoJUICT/juict-skills
/plugin install autotask-api@juict-skills
/plugin install tdsynnex@juict-skills
```

Bij JUICT worden de marketplace en de plugins automatisch uitgerold via de organisatie-managed settings — dan hoef je niets handmatig te installeren. Updaten: `/plugin marketplace update juict-skills`.

## Structuur

```
.claude-plugin/
  marketplace.json          # catalogus (juict-skills) → verwijst naar elke plugin
plugins/
  <plugin>/
    .claude-plugin/plugin.json
    skills/<plugin>/
      SKILL.md              # instappunt van de skill
      ...                   # eventuele REFERENCE.md, LESSONS.md, scripts/, resources
```

## Bijwerken

Nieuwe les of endpoint geleerd? De maintainer-companions (bv. `/autotask-api-update`) extraheren de les uit je sessie, werken het juiste bestand bij onder `plugins/<plugin>/skills/<plugin>/` en pushen via een feature branch + PR. Collega's halen de update op met `/plugin marketplace update juict-skills` (of automatisch via `autoUpdate`).

## Veiligheid

Deze repo is **public** en bevat **geen secrets** — alleen secret-*namen* (de waarden staan in Azure Key Vault of in een lokale `.env`). Zet hier nooit een secret-waarde in. De inhoud betreft JUICT-interne API- en deploy-kennis; bewust gepubliceerd zodat de skills zonder repo-toegang bij elke medewerker uitrollen.
