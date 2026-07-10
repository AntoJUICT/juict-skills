---
name: azure-saas-devops-deploy
description: Deployt een klant-automation naar een dedicated Azure subscription per automation (sub-{klant}-{auto}-prod) via Azure DevOps Pipelines en Bicep/AVM. Elke automation krijgt altijd een eigen subscription EN een eigen resource group. Broncode blijft altijd in JUICT's private Azure DevOps. ACR bij JUICT (cross-tenant via multi-tenant app-registratie), alle overige infra (Container Apps, Static Web App, PostgreSQL, Key Vault, Storage, Azure OpenAI) in de automation-subscription. Drie types: web (Next.js full-stack), split (Python backend + React/Vite frontend), service (achtergrond). Gebruik bij het aanmaken van een nieuwe automation voor een klant of het opzetten van de bijbehorende pipeline.
---

# Azure SaaS DevOps Deploy — Klant Automations

JUICT beheert de broncode volledig. Klanten zien alleen de draaiende applicatie.

## Isolatie — altijd een eigen subscription én RG per automation

> ⚠️ **Harde regel:** elke automation krijgt een **eigen dedicated Azure subscription** (`sub-{klant}-{auto}-prod`) **én** een eigen resource group (`rg-{klant}-{auto}-prod-weu-001`) daarbinnen. Nooit meerdere automations in één subscription of RG samenvoegen, ook niet voor dezelfde klant. Eén klant met drie automations = drie subscriptions.

Reden: harde billing-, RBAC- en blast-radius-scheiding per automation, en een schone offboarding (subscription kan los worden uitgezet/verwijderd zonder andere automations te raken).

## Automation types

| Type | Backend | Frontend | Auth |
|------|---------|----------|------|
| `web` | Next.js full-stack op Container Apps | (in Next.js) | NextAuth.js + Entra ID multi-tenant |
| `split` | Python API op Container Apps (ingress) | React + Vite op Static Web App | optioneel |
| `service` | Python/Node achtergrondproces, geen ingress | — | — |

`split` is de standaard voor nieuwe automations (per werkinstructie). `web` blijft beschikbaar voor full-stack Next.js gevallen.

## Stack

| Laag | Technologie |
|------|-------------|
| Backend | Python (type `split`/`service`) of Next.js/TypeScript (type `web`) |
| Frontend | React + Vite op Azure Static Web App (type `split`) |
| Database | PostgreSQL Flexible Server v16 |
| Auth | Entra ID multi-tenant + NextAuth.js (alleen type `web`) |
| AI | Azure OpenAI: `gpt-4o`, `gpt-4o-mini`, `text-embedding-3-large` |
| Storage | Azure Blob Storage |
| Container runtime | Azure Container Apps |
| IaC | Bicep + Azure Verified Modules (AVM) — **eenmalig** via `deploy.sh` |
| CI/CD | Azure DevOps Pipelines (`az acr build` + Container App update + Static Web App deploy) |
| Registry | Azure Container Registry (bij JUICT, niet bij klant) — cross-tenant pull via app-registratie |

## Vaste JUICT-waarden (niet vragen)

| Variable | Waarde |
|----------|--------|
| `JUICT_SUBSCRIPTION_ID` | `98b5af24-e73f-4640-9d31-d323861f57a4` |
| `JUICT_TENANT_ID` | `751a3a33-5e46-4ef1-ad28-6953162ec45f` |
| `ACR_NAME` | `juictacrg4fhuo35` |
| `ACR_LOGIN_SERVER` | `juictacrg4fhuo35.azurecr.io` |
| `JUICT_RESOURCE_GROUP` | `juict-shared-rg` |
| `DEVOPS_ORG` | `https://dev.azure.com/JUICT` |
| `DEVOPS_PROJECT` | `JUICT Automations` (let op: met spatie) |
| `SC_JUICT` | `sc-juict-shared` (DevOps service connection naar JUICT subscription, voor `az acr build`) |
| Admin-consent base-URL | `https://login.microsoftonline.com/751a3a33-5e46-4ef1-ad28-6953162ec45f/oauth2/authorize` |

## Naamconventies — Azure Periodic Table

Patroon: `{afkorting}-{klant}-{automation}-{env}-{regio}-{instantie}`
Omgeving: altijd `prod` voor klantomgevingen.
Regio-afkortingen: West Europe = `weu`, Sweden Central = `swc`.

| Resource | Patroon | Voorbeeld (klant=contoso, auto=tickets) | Max |
|----------|---------|----------------------------------------|-----|
| Subscription (dedicated, per automation) | `sub-{klant}-{auto}-prod` | `sub-contoso-tickets-prod` | — |
| Resource Group | `rg-{klant}-{auto}-prod-{regio}-001` | `rg-contoso-tickets-prod-weu-001` | — |
| Container Apps Environment | `cae-{klant}-{auto}-prod-{regio}-001` | `cae-contoso-tickets-prod-weu-001` | — |
| Container App | `ca-{klant}-{auto}-prod-{regio}-001` | `ca-contoso-tickets-prod-weu-001` | — |
| Static Web App (type `split`) | `stapp-{klant}-{auto}-prod-{regio}-001` | `stapp-contoso-tickets-prod-weu-001` | — |
| PostgreSQL Server | `psql-{klant}-{auto}-prod-{regio}-001` | `psql-contoso-tickets-prod-weu-001` | — |
| Key Vault | `kv-{klant}-{auto}-prod-{regio}` | `kv-contoso-tickets-prod-weu` | 24 tekens |
| Storage Account | `st{klant}{auto}prod001` | `stcontosotickprod001` | 24 tekens, geen koppeltekens |
| Azure OpenAI | `oai-{klant}-{auto}-prod-swc-001` | `oai-contoso-tickets-prod-swc-001` | — |
| Log Analytics Workspace | `log-{klant}-{auto}-prod-{regio}-001` | `log-contoso-tickets-prod-weu-001` | — |
| App-registratie (klant-tenant, ACR-pull) | `app-{klant}-{auto}` | `app-contoso-tickets` | — |
| Managed Identity (DevOps service conn.) | `id-{klant}-{auto}` | `id-contoso-tickets` | — |
| DevOps repo | `{klant}-{automation}` | `contoso-tickets` | — |
| DevOps variable group | `vg-{klant}-{auto}-prod` | `vg-contoso-tickets-prod` | — |
| DevOps service connection | `sc-{klant}-{auto}` | `sc-contoso-tickets` | — |
| DevOps environment | `prod-{klant}-{auto}` | `prod-contoso-tickets` | — |
| ACR image repository | `{klant}/{auto}` | `contoso/tickets` | — |

> ⚠️ Key Vault: max 24 tekens, globaal uniek. Laat de instantie (`-001`) weg als naam te lang is.
> ⚠️ Storage Account: max 24 tekens, alleen lowercase alfanumeriek. Afkort de automation naam indien nodig (bijv. `tickets` → `tick`).

## Broncode bescherming & kill-switch — 3 lagen

1. **Geen DevOps-toegang** — Repository staat in JUICT's private Azure DevOps. Klanten ontvangen nooit een uitnodiging of leesrechten.
2. **Geen broncode in container image** — Dockerfile gebruikt multi-stage build. De finale image bevat alleen gecompileerde output / dependencies, nooit source bestanden.
3. **Contractbeëindiging (offboarding)** — De cross-tenant ACR-pull loopt via de multi-tenant app-registratie `app-{klant}-{auto}`. Bij einde contract:
   - **Kill-switch:** stop de Container App in de klant-tenant (`az containerapp update --min-replicas 0` of de revisie deactiveren) → klant heeft geen draaiende automation meer.
   - Verwijder de `acrPull` role assignment van `app-{klant}-{auto}` op JUICT's ACR en/of verwijder de app-registratie → de Container App kan de image niet meer pullen bij een herstart.
   - JUICT verwijdert daarna de image uit de ACR. Klant heeft nooit broncode ontvangen.

> Een geautomatiseerd kill-switch-mechanisme (centraal aan/uit bij offboarding) is nog niet opgezet — voorlopig handmatig via bovenstaande stappen.

## Benodigdheden (eenmalig, vooraf geregeld)

- **Dedicated subscription per automation** (`sub-{klant}-{auto}-prod`), aangemaakt door de cloud engineer (zie stap 1 hieronder).
- **Azure Lighthouse-delegatie** van die automation-subscription naar JUICT, met **Owner of User Access Administrator** (niet alleen Contributor — `deploy.sh` maakt RBAC-roltoewijzingen op de Key Vault aan, wat `Microsoft.Authorization/roleAssignments/write` vereist).
- Lidmaatschap van het team **"JUICT Automations Team"** in Azure DevOps.
- Cross-tenant ACR-auth opgezet (zie hieronder).

## Vereisten per automation (handmatig vooraf)

1. **Dedicated subscription aanmaken + Azure Lighthouse-delegatie naar JUICT.** Elke automation krijgt een **eigen** subscription `sub-{klant}-{auto}-prod` — nooit hergebruiken voor een andere automation. Het **aanmaken** van de subscription (billing account/EA/MCA → management group klant) blijft een handoff naar de cloud engineer.
   - Controleer welk subscription-ID hoort bij de nieuwe sub: `az account list --query "[?name=='sub-{klant}-{auto}-prod'].id" -o tsv`.
   - Controleer de delegatie met `az rest --method get --uri "https://management.azure.com/subscriptions/{AUTOMATION_SUBSCRIPTION_ID}/providers/Microsoft.ManagedServices/registrationDefinitions?api-version=2022-10-01"` — lege lijst = geen delegatie naar JUICT.
   - **Lighthouse-delegatie (Owner/UAA + Contributor + Reader) ontbreekt? Vraag of ik het zelf opzet** of de cloud engineer. Zelf doen kan met de subscription-scope ARM-template `lighthouse-delegation.json` (zie REFERENCE.md#lighthouse) — vereist een interactieve login als **owner van de sub in de klant-tenant** (de operator voert die login uit). Contributor alleen is **niet** genoeg voor `deploy.sh` (dat maakt RBAC-roltoewijzingen aan).
2. **Resource Group aanmaken** (in de automation-subscription):
   ```bash
   az group create \
     --name rg-{klant}-{auto}-prod-weu-001 \
     --location westeurope \
     --subscription {AUTOMATION_SUBSCRIPTION_ID}
   ```
3. **Cross-tenant ACR-auth (multi-tenant app-registratie):**

   > ⚠️ **Eerst vragen — wie doet dit?** Deze stap maakt een app-registratie in de **klant-tenant** (vereist klant-tenant-admin + een interactieve login die langs MFA/Conditional Access komt) en een SP + AcrPull in de JUICT-tenant. Vraag altijd expliciet of:
   > - **(a)** ik (Claude) het zelf doe — dan heb ik een interactieve `az login --tenant {KLANT_TENANT} --use-device-code` als klant-tenant-admin nodig (de operator voert die login uit), of
   > - **(b)** de cloud engineer dit separaat doet — dan lever ik alleen de instructie + waarden aan en wacht ik op `ACR_APP_ID` + de melding dat de secret in `juict-shared-kv` staat.
   >
   > De client **secret** nooit printen/in een bestand zetten: sla hem op in `juict-shared-kv` als `{klant}-{auto}-acr-app-secret` en verwijs daarnaar (de variable group/`deploy.sh` halen hem daar op).

   - Maak in de **klant-tenant** een multi-tenant app-registratie `app-{klant}-{auto}`. Noteer de client ID en maak een client secret.
   - Verleen toestemming in de JUICT-tenant via:
     `https://login.microsoftonline.com/751a3a33-5e46-4ef1-ad28-6953162ec45f/oauth2/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri=https://www.microsoft.com`
   - Ken de app-registratie de rol **`AcrPull`** toe op JUICT's ACR (`juictacrg4fhuo35`).
   - De client ID + secret worden als ACR registry-credentials in de Container App gezet (Bicep), zodat de app cross-tenant kan pullen.
4. **DevOps Service Connection `sc-juict-shared`** — eenmalig voor JUICT's eigen subscription, herbruikbaar voor alle klanten (voor de `az acr build`-stap).
5. **DevOps Environment** — naam `prod-{klant}-{auto}`.

## Vragen per automation (alleen deze vragen stellen)

1. `CUSTOMER_NAME` — lowercase, geen spaties, geen koppeltekens (bijv. `contoso`)
2. `AUTOMATION_NAME` — lowercase, geen spaties (bijv. `tickets`)
3. `CUSTOMER_SUBSCRIPTION_ID` — het ID van de **dedicated automation-subscription** `sub-{klant}-{auto}-prod` (niet een gedeelde klant-subscription; zie "Vereisten per automation" stap 1). Deze waarde wordt overal gebruikt waar de skill `{CUSTOMER_SUBSCRIPTION_ID}` noemt.
4. `CUSTOMER_TENANT_ID` — klant's Entra ID tenant ID
5. `AUTOMATION_TYPE` — `web` (Next.js full-stack), `split` (Python API + React/Vite frontend) of `service` (achtergrond, geen URL)
6. `CUSTOM_DOMAIN` — (optioneel, type `web`/`split`) bijv. `app.contoso.nl`. Leeg laten voor `{klant}.juict.nl`
7. `ACR_APP_ID` / `ACR_APP_SECRET` — client ID en secret van `app-{klant}-{auto}` (uit de cross-tenant ACR-auth stap)

Alle overige waarden zijn afgeleid uit de naamconventie of de vaste waarden.
`POSTGRES_ADMIN_PASSWORD` en `AUTH_SECRET` worden automatisch gegenereerd.

## Workflow A — Nieuwe automation aanmaken

Genereer de volgende projectstructuur in een lokale map `{klant}-{automation}/`:

```
{klant}-{automation}/
├── backend/                # Python API (split/service) of Next.js (web)
│   ├── Dockerfile
│   └── requirements.txt    # version-pinned (split/service)
├── frontend/               # React + Vite (alleen type split)
├── infra/
│   ├── main.bicep
│   └── main.bicepparam
├── pipelines/
│   └── azure-pipelines.yml
├── deploy.sh               # eenmalige Bicep-uitrol
└── CLAUDE.md
```

Zie [REFERENCE.md](REFERENCE.md) voor de volledige inhoud van elk bestand.

**Daarna uitvoeren:**

> Stappen in volgorde. Stap 5 (eenmalige infra) en stap 6 (service connection) zijn handoffs richting de cloud engineer — wacht op bevestiging voordat de eerste pipeline-run start.

```bash
# 1. Repo aanmaken in Azure DevOps
az repos create \
  --name "{klant}-{automation}" \
  --project "JUICT Automations" \
  --org https://dev.azure.com/JUICT

# 2. Pipeline aanmaken (pad: pipelines/azure-pipelines.yml)
az pipelines create \
  --name "{klant}-{automation}-deploy" \
  --repository "{klant}-{automation}" \
  --branch main \
  --yml-path pipelines/azure-pipelines.yml \
  --project "JUICT Automations" \
  --org https://dev.azure.com/JUICT

# 3. Variable group aanmaken
az pipelines variable-group create \
  --name "vg-{klant}-{automation}-prod" \
  --project "JUICT Automations" \
  --org https://dev.azure.com/JUICT \
  --variables \
    CUSTOMER_NAME="{klant}" \
    AUTOMATION_NAME="{automation}" \
    CUSTOMER_SUBSCRIPTION_ID="{CUSTOMER_SUBSCRIPTION_ID}" \
    CUSTOMER_TENANT_ID="{CUSTOMER_TENANT_ID}" \
    AUTOMATION_TYPE="{web|split|service}"

# 4. Secret variabelen toevoegen (interactief via portal of CLI)
#    - POSTGRES_ADMIN_PASSWORD: openssl rand -base64 32
#    - AUTH_SECRET: openssl rand -base64 32 (alleen type web)
#    - ACR_APP_ID / ACR_APP_SECRET (app-{klant}-{auto})
#    - ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET (alleen type web)
#    - deploymentToken (Static Web App, alleen type split — pas beschikbaar na stap 5)
```

**Stap 5 — Eenmalige infra-uitrol (`deploy.sh`):**

Infra wordt **niet** via de pipeline uitgerold. Voer `deploy.sh` één keer uit (door de cloud engineer of met Contributor-rechten) om de Bicep-template in de klant-subscription te deployen. Dit maakt Container App, PostgreSQL, Key Vault, Storage, OpenAI en (type `split`) de Static Web App aan. Daarna `deploy.sh` niet meer gebruiken — verdere updates lopen via de pipeline.

Na de Static Web App-aanmaak (type `split`): haal de deployment token op en voeg die als secret `deploymentToken` toe aan de variable group:
```bash
az staticwebapp secrets list \
  --name stapp-{klant}-{auto}-prod-weu-001 \
  --query "properties.apiKey" -o tsv
```

**Stap 6 — Handoff naar cloud engineer (service connection):**

```
Automation opgezet in Azure DevOps:
- Klant:          {CUSTOMER_NAME}
- Automation:     {AUTOMATION_NAME}
- Repo:           JUICT Automations / {klant}-{automation}
- Pipeline:       {klant}-{automation}-deploy

Aanmaken service connection (managed identity, manual federation):
- Naam:           sc-{klant}-{automation}
- Managed identity: id-{klant}-{automation}
- Subscription:   {CUSTOMER_SUBSCRIPTION_ID}
- Tenant:         {CUSTOMER_TENANT_ID}
- RBAC:           Contributor op de klant-subscription
- Project:        https://dev.azure.com/JUICT/JUICT%20Automations/_settings/adminservices

Zie REFERENCE.md#service-connection voor de stap-voor-stap instructie.
Bevestig als sc-{klant}-{automation} klaar staat zodat de eerste pipeline-run gestart kan worden.
```

## Workflow B — Pipeline (automatisch bij push naar main)

Infra wordt **niet** via de pipeline uitgerold (zie `deploy.sh`). Bij elke push naar `main` voert de pipeline uit:

1. **Build & push** — image bouwen met `az acr build` direct in JUICT's ACR als `juictacrg4fhuo35.azurecr.io/{klant}/{auto}:{commit-sha}` en `:latest` (auth via `sc-juict-shared`).
2. **Deploy backend** — `az containerapp update` met de nieuwe image in de klant-subscription (auth via `sc-{klant}-{auto}`).
3. **Deploy frontend** (type `split`) — `AzureStaticWebApp@0` deployt `frontend/` naar de Static Web App met de `deploymentToken`.

> De Container App pullt de image cross-tenant met de credentials van `app-{klant}-{auto}` (in Bicep ingesteld als registry username/password) — geen AcrPull op een Managed Identity nodig.

Zie [REFERENCE.md](REFERENCE.md#azure-pipelines) voor de volledige pipeline.

## Version pinning — requirements.txt (Python)

Claude kent de laatste dependency-versies niet; open ranges geven onvoorspelbaar gedrag. **Altijd exacte versie-pinning** via een lokale venv:

```powershell
# In de map met requirements.txt
python -m venv ./venv
.\venv\Scripts\activate
get-command pip          # moet verwijzen naar ...\venv\Scripts\pip.exe
pip install -r requirements.txt
pip freeze > requirements.txt   # overschrijft met exacte versies
```

```
# Goed                # Fout
openai==1.51.0         openai
httpx==0.27.2          openai>=1.0
python-dotenv==1.0.1   openai~=1.0
```

## Dockerfile base-image — versie moet matchen

> ⚠️ De Python base-image in de Dockerfile **moet** overeenkomen met de lokale Python-versie waarmee `requirements.txt` is gegenereerd. Anders faalt de build in de pipeline.

Controleer beschikbare image-tags op Microsoft Artifact Registry (`mcr.microsoft.com`). Voorbeeld: niet `...python:4-python3.12` maar `...python:4-python3.14` als lokaal 3.14 is gebruikt. Gebruik altijd de actuele LTS/stabiele versie en check de tag echt bestaat vóór je de Dockerfile aanmaakt.

## Harde regels (code-conventies)

- **Frontend → backend:** altijd `import.meta.env.VITE_API_URL` voor backend-URL's — nooit hardcoden.
- **REST endpoints:** strikt `/api/{resource}` en `/api/{resource}/{id}` — geen afwijkingen.
- **Bicep:** idempotent schrijven; meerdere keren veilig uitvoerbaar.
- **Regio: ALTIJD `westeurope`.** Wijk nooit uit naar een andere regio. Bij capaciteitsfouten op de Container Apps Environment (`AKSCapacityHeavyUsage` / `ManagedEnvironmentCapacityHeavyUsageError` in westeurope) **gewoon opnieuw proberen** tot het lukt (deployment is idempotent) — niet naar northeurope/elders deployen. Zorg dat `location` in de bicepparam óók `westeurope` is, niet `northeurope`.
- **Container App-updates:** uitsluitend via CI/CD, nooit handmatig.
- **Bereikbaarheid (anders is de app dood):** CAE **`publicNetworkAccess: 'Enabled'`** (AVM-default = Disabled), Next.js standalone **`HOSTNAME=0.0.0.0`** in de container-env (anders bindt 'ie aan de pod-naam → ingress-fout), en **`registries` altijd** configureren (anders kan de eerste pipeline-deploy de image niet pullen). IP-whitelisting via `ipSecurityRestrictions` op de ingress.
- **Lighthouse-roltoewijzingen:** een via Lighthouse gedelegeerde identiteit kan géén RBAC-toewijzing maken voor een klant-tenant-principal (de MI). Draai de roltoewijzing-stappen als native klant-admin. Zie REFERENCE.md → "Lessons learned".
- **Eerste deploy via bicep/`deploy.sh`, niet de pipeline** (de pipeline doet alleen `containerapp update --image`).
- **Foutafhandeling:** elke fout in backend én frontend krijgt een duidelijke foutmelding met context. Geen bare `except`, lege catch-blokken of ontbrekende foutmelding.

## Azure OpenAI — altijd deployen

Elke automation krijgt drie model deployments in `swedencentral`:

| Deployment naam | Model | Capaciteit |
|-----------------|-------|------------|
| `gpt-4o` | `gpt-4o` (nieuwste versie) | 30 TPM |
| `gpt-4o-mini` | `gpt-4o-mini` (nieuwste versie) | 30 TPM |
| `text-embedding-3-large` | `text-embedding-3-large` | 30 TPM |

> Controleer altijd de nieuwste model versie in swedencentral via de Azure portal of docs voordat je de Bicep aanmaakt.

De Container App krijgt via Managed Identity de rol `Cognitive Services OpenAI User` op de OpenAI resource — geen API key opslaan. (De Managed Identity wordt dus nog steeds gebruikt voor OpenAI/Key Vault/Storage; alleen de ACR-pull loopt via de app-registratie.)

## Bicep — AVM versies

> ⚠️ Controleer **altijd** de nieuwste module versies op https://azure.github.io/Azure-Verified-Modules/ voordat je de Bicep aanmaakt. Gebruik nooit een gecachte versie.

> ⚠️ Controleer **altijd** de nieuwste service API versies en PostgreSQL/Python/Node.js versies op het moment van aanmaken.

Gebruikte AVM modules:
- `br/public:avm/res/operational-insights/workspace`
- `br/public:avm/res/app/managed-environment`
- `br/public:avm/res/app/container-app`
- `br/public:avm/res/web/static-site` (alleen type `split`)
- `br/public:avm/res/db-for-postgre-sql/flexible-server`
- `br/public:avm/res/key-vault/vault`
- `br/public:avm/res/storage/storage-account`
- `br/public:avm/res/cognitive-services/account`
- `br/public:avm/res/authorization/role-assignment` (voor MI → OpenAI, KV, Storage)

Zie [REFERENCE.md](REFERENCE.md#bicep) voor de volledige templates.

## Post-deploy checklist

- [ ] Container App draait (`az containerapp show --name ca-... --query "properties.runningStatus"`)
- [ ] Container App pullt image via app-registratie credentials (`app-{klant}-{auto}` heeft AcrPull op JUICT's ACR)
- [ ] Azure OpenAI deployments actief (alle drie)
- [ ] Container App MI heeft `Cognitive Services OpenAI User` op OpenAI resource
- [ ] Container App MI heeft `Key Vault Secrets User` op Key Vault
- [ ] Container App MI heeft `Storage Blob Data Contributor` op Storage Account
- [ ] PostgreSQL bereikbaar vanuit Container App (check logs)
- [ ] (Type `split`) Static Web App live, `VITE_API_URL` wijst naar de backend Container App FQDN
- [ ] (Type `web`/`split`) applicatie bereikbaar via URL
- [ ] (Custom domain) klant heeft CNAME ingesteld → Container App / Static Web App FQDN
- [ ] (juict.nl subdomein) `cloudflare-dns` skill uitvoeren voor `{klant}.juict.nl`
