# juict-skills

Claude Code plugin-marketplace met de gedeelde skills van JUICT. Eén repo, meerdere plugins: elke skill is een losse plugin die je apart aan of uit zet. Zo werkt iedereen met dezelfde geverifieerde kennis en hoeft niemand het wiel opnieuw uit te vinden.

De repo is public zodat de skills op elke werkplek binnenkomen, ook bij collega's zonder GitHub- of Azure DevOps-account. Er staan geen secrets in (zie [Veiligheid](#veiligheid)).

## Skills in deze marketplace

| Plugin | Waarvoor | Auth nodig |
|--------|----------|------------|
| `autotask-api` | Werken met de Autotask REST API: geverifieerde endpoints, env vars, data structures en lessons learned. | Key Vault |
| `tdsynnex` | Rewst-workflows bouwen tegen de TD Synnex StreamOne Ion API v3: subscriptions, seats, catalog en bekende quirks. | nee |
| `azure-saas-devops-deploy` | Een klant-automation deployen naar een eigen Azure subscription via Azure DevOps Pipelines en Bicep/AVM (types web, split, service). | az login |
| `ticket-aanmaken` | Een Autotask-supportticket aanmaken vanuit vrije tekst. Claude leidt de velden af en maakt het ticket pas na jouw akkoord aan. | Key Vault |
| `ticket-reactie` | Een Autotask-ticket onderzoeken (PDF of live) en een concept klantreactie opstellen in Anto's tone of voice. | Key Vault |
| `site-scraper` | De technische opbouw van een website in kaart brengen (framework, routes, API-endpoints), ook achter een login. | nee |

## Installeren

### Automatisch (JUICT-medewerkers)

Bij JUICT worden de marketplace en de plugins uitgerold via de Claude organization settings. Je hoeft niets te doen. Bij de volgende start staat de marketplace geregistreerd en zijn de plugins actief. Roep een skill aan met de slash-command, bijvoorbeeld `/autotask-api`, of laat Claude hem zelf laden wanneer het werk erom vraagt.

### Handmatig

Wil je de marketplace los toevoegen, of een specifieke plugin installeren op een machine buiten de org-uitrol:

```
/plugin marketplace add AntoJUICT/juict-skills
/plugin install autotask-api@juict-skills
/plugin install tdsynnex@juict-skills
```

Updates ophalen: `/plugin marketplace update juict-skills`. Onder de org-uitrol gebeurt dat automatisch (`autoUpdate`).

## Vereisten

De meeste skills draaien standalone. Skills die Autotask of Azure raken hebben runtime-auth nodig:

- **Key Vault** (`autotask-api`, `ticket-aanmaken`, `ticket-reactie`): credentials komen uit de shared Azure Key Vault via je `az`-login of managed identity. De skills bevatten alleen de secret-namen, nooit de waarden.
- **az login** (`azure-saas-devops-deploy`): een geldige Azure CLI-sessie met toegang tot de betreffende subscription en Azure DevOps.

## Structuur

```
.claude-plugin/
  marketplace.json              catalogus (juict-skills), verwijst naar elke plugin
plugins/
  <plugin>/
    .claude-plugin/
      plugin.json               plugin-manifest (naam, versie, beschrijving)
    skills/
      <plugin>/
        SKILL.md                instappunt van de skill
        ...                     optioneel: REFERENCE.md, LESSONS.md, scripts/, resources
```

Elke plugin heeft dezelfde vorm: een manifest onder `.claude-plugin/` en de skill zelf onder `skills/<plugin>/`. De marketplace verwijst per plugin naar zijn map via `source: "./plugins/<plugin>"`.

## Een skill toevoegen

1. Maak de mapstructuur `plugins/<naam>/.claude-plugin/plugin.json` en `plugins/<naam>/skills/<naam>/SKILL.md`.
2. Vul `plugin.json` met naam, versie en beschrijving (kopieer de vorm van een bestaande plugin).
3. Voeg een entry toe aan `.claude-plugin/marketplace.json` met `"source": "./plugins/<naam>"`.
4. Werk via een feature branch en open een pull request naar `main`.
5. Zet de plugin org-breed aan door hem toe te voegen aan `enabledPlugins` in de Claude organization settings.

## Bijwerken

Nieuwe les, endpoint of quirk geleerd tijdens het werk? Voor `autotask-api` bestaat de maintainer-companion `/autotask-api-update`: die haalt de les uit je sessie, werkt het juiste bestand onder `plugins/autotask-api/skills/autotask-api/` bij en pusht via een feature branch en PR. Collega's krijgen de update automatisch via `autoUpdate`, of handmatig met `/plugin marketplace update juict-skills`.

## Veiligheid

Deze repo is public en bevat geen secrets. Skills verwijzen alleen naar secret-namen; de waarden staan in Azure Key Vault of in een lokale `.env` en worden op runtime opgehaald. Zet hier dus nooit een secret-waarde, token of connection string in. De inhoud is bewust JUICT-interne API- en deploy-kennis die veilig gepubliceerd kan worden, zodat de skills zonder repo-toegang bij elke medewerker uitrollen. Twijfel je of iets gevoelig is, houd het dan uit de repo en verwijs naar de Key Vault-referentie.
