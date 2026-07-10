# azure-saas-devops-deploy

Claude Code skill voor het deployen van JUICT klant-automations naar een dedicated Azure subscription per automation (`sub-{klant}-{auto}-prod`) via Azure DevOps Pipelines en Bicep/AVM. Elke automation krijgt altijd een eigen subscription én een eigen resource group.

## Wat doet deze skill

Bij het aanroepen genereert de skill alle benodigde bestanden voor een nieuwe klant-automation en begeleidt de volledige onboarding:

- Bicep-template (AVM-modules) voor infrastructuur in de dedicated automation-subscription
- `deploy.sh` voor de eenmalige infra-uitrol (Bicep draait niet in de pipeline)
- `pipelines/azure-pipelines.yml` voor CI/CD via JUICT's Azure DevOps
- `Dockerfile` (Next.js of Python, afhankelijk van automation type) + version-pinned `requirements.txt`
- React/Vite frontend op Static Web App (type `split`)
- Stap-voor-stap instructie inclusief handoffs naar de cloud engineer

## Automation types

| Type | Backend | Frontend | Auth |
|------|---------|----------|------|
| `web` | Next.js full-stack op Container Apps | (in Next.js) | NextAuth.js + Entra ID multi-tenant |
| `split` | Python API op Container Apps | React + Vite op Static Web App | optioneel |
| `service` | Python/Node achtergrondproces, geen ingress | — | — |

`split` is de standaard voor nieuwe automations; `web` blijft beschikbaar voor full-stack Next.js.

## Architectuurprincipes

**Broncode blijft altijd bij JUICT.** Klanten zien alleen de draaiende applicatie. Drie lagen:

1. Private Azure DevOps repository — klant krijgt nooit toegang
2. Multi-stage Dockerfile — finale image bevat geen broncode
3. Offboarding/kill-switch — Container App stoppen + `acrPull` van de app-registratie intrekken, daarna image verwijderen

**Eén subscription per automation.** Elke automation krijgt een **eigen dedicated subscription** `sub-{klant}-{auto}-prod` (aangemaakt door de cloud engineer, met Lighthouse-delegatie naar JUICT) én een eigen resource group daarbinnen. Nooit meerdere automations in één subscription of RG — ook niet voor dezelfde klant.

**ACR bij JUICT, infra in de automation-subscription.** Het container image wordt met `az acr build` gebouwd en opgeslagen in JUICT's ACR (`juictacrg4fhuo35.azurecr.io`). De Container App pullt het image cross-tenant via een multi-tenant **app-registratie** (`app-{klant}-{auto}`) met `AcrPull` — niet via een Managed Identity (die werkt niet over tenants heen).

**Infra eenmalig, app via CI/CD.** Bicep wordt één keer handmatig uitgerold met `deploy.sh`. De pipeline bouwt daarna alleen de container (`az acr build`), update de Container App en deployt (type `split`) de Static Web App.

## Wat wordt er gedeployed

Elke automation krijgt een dedicated subscription `sub-{klant}-{auto}-prod`, en daarin:

| Resource | Naampatroon | Regio |
|----------|-------------|-------|
| Resource Group | `rg-{klant}-{auto}-prod-weu-001` | West Europe |
| Container Apps Environment | `cae-{klant}-{auto}-prod-weu-001` | West Europe |
| Container App | `ca-{klant}-{auto}-prod-weu-001` | West Europe |
| Static Web App (type `split`) | `stapp-{klant}-{auto}-prod-weu-001` | West Europe |
| PostgreSQL Flexible Server v16 | `psql-{klant}-{auto}-prod-weu-001` | West Europe |
| Key Vault | `kv-{klant}-{auto}-prod-weu` | West Europe |
| Storage Account | `st{klant}{auto}prod001` | West Europe |
| Azure OpenAI (`gpt-4o`, `gpt-4o-mini`, `text-embedding-3-large`) | `oai-{klant}-{auto}-prod-swc-001` | Sweden Central |
| Log Analytics Workspace | `log-{klant}-{auto}-prod-weu-001` | West Europe |

OpenAI, Key Vault en Storage worden via Managed Identity benaderd — geen API keys. Alleen de ACR-pull loopt via de app-registratie-credentials.

## Vereiste informatie per automation

1. `CUSTOMER_NAME` — lowercase, geen spaties (bijv. `contoso`)
2. `AUTOMATION_NAME` — lowercase, geen spaties (bijv. `tickets`)
3. `CUSTOMER_SUBSCRIPTION_ID` — ID van de dedicated automation-subscription `sub-{klant}-{auto}-prod`
4. `CUSTOMER_TENANT_ID` — klant's Entra ID tenant ID
5. `AUTOMATION_TYPE` — `web` | `split` | `service`
6. `CUSTOM_DOMAIN` — optioneel, bijv. `app.contoso.nl`
7. `ACR_APP_ID` / `ACR_APP_SECRET` — client ID + secret van `app-{klant}-{auto}`

## Onboarding flow

```
1. Cross-tenant ACR-auth: app-{klant}-{auto} aanmaken, admin-consent, AcrPull op JUICT ACR
2. Bestanden genereren (SKILL.md Workflow A)
3. Repo + pipeline + variable group aanmaken in Azure DevOps
4. Eenmalige infra-uitrol via deploy.sh (placeholder image)
5. (split) Static Web App deployment token in variable group; VITE_API_URL zetten
6. Handoff naar cloud engineer → service connection sc-{klant}-{automation} (managed identity, manual)
7. Eerste pipeline-run: echte image gebouwd + Container App geüpdatet (+ SWA bij split)
8. Post-deploy checklist doorlopen
```

## Standaarden

- IaC: [Azure Verified Modules (AVM)](https://azure.github.io/Azure-Verified-Modules/) — altijd nieuwste moduleversies, idempotent
- CI/CD: Azure DevOps Pipelines, service connection via managed identity (manual federation)
- Authenticatie: Managed Identity voor OpenAI/Key Vault/Storage; app-registratie voor cross-tenant ACR-pull
- Python: versie-pinning verplicht in `requirements.txt` (via venv + `pip freeze`); Dockerfile base-image matcht de lokale Python-versie
- Node.js/Next.js: altijd actuele LTS-versie als base image
- Frontend: backend-URL altijd via `import.meta.env.VITE_API_URL`; endpoints `/api/{resource}` en `/api/{resource}/{id}`

## Bestanden

| Bestand | Inhoud |
|---------|--------|
| `SKILL.md` | Skill-instructies, workflows, naamconventies, vragen |
| `REFERENCE.md` | Volledige templates: Bicep, deploy.sh, azure-pipelines.yml, Dockerfiles, service-connection instructie |

## Gebruik

```
/azure-saas-devops-deploy
```

Of Claude herkent automatisch wanneer de skill van toepassing is op basis van de beschrijving in `SKILL.md`.
