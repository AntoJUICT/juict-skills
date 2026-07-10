# Azure SaaS DevOps Deploy — Reference

## service-connection

De service connection wordt door een cloud engineer aangemaakt met een **managed identity (manual federation)** — niet WIF-automatic. Geef de volgende informatie door:

```
Automation: {klant}-{automation}
DevOps project: JUICT Automations (https://dev.azure.com/JUICT)
Service connection naam: sc-{klant}-{automation}
Managed identity naam: id-{klant}-{automation}
Automation-subscription: sub-{klant}-{automation}-prod
Automation-subscription ID: {CUSTOMER_SUBSCRIPTION_ID}
Klant tenant ID: {CUSTOMER_TENANT_ID}
```

**Stappen voor de cloud engineer:**

1. Maak een Managed Identity `id-{klant}-{automation}` aan in de automation-subscription (`sub-{klant}-{automation}-prod`).
2. Ga naar `https://dev.azure.com/JUICT/JUICT%20Automations/_settings/adminservices`.
3. **New service connection** → **Azure Resource Manager** → **Next**.
4. Identity type: **Managed identity** (of App registration) → **manual**.
5. Vul Subscription ID en Tenant ID van de klant in.
6. Naam: `sc-{klant}-{automation}`.
7. DevOps toont een **Issuer** en **Subject identifier** — configureer hiermee een **federated credential** op `id-{klant}-{automation}`.
8. Ken `id-{klant}-{automation}` de rol **Contributor** toe op de automation-subscription (`sub-{klant}-{automation}-prod`).
9. Bevestig terug aan de developer dat `sc-{klant}-{automation}` klaar staat.

> De `az acr build`-stap in de pipeline gebruikt de gedeelde `sc-juict-shared` (JUICT subscription), niet deze klant-connection.

### Cross-tenant ACR-pull — app-registratie

De Container App pullt de image cross-tenant uit JUICT's ACR via een multi-tenant app-registratie (geen Managed Identity AcrPull, want die werkt niet over tenants heen):

1. Maak in de **klant-tenant** een multi-tenant app-registratie `app-{klant}-{automation}`. Noteer de **client ID** en maak een **client secret**.
2. Admin-consent in de JUICT-tenant:
   `https://login.microsoftonline.com/751a3a33-5e46-4ef1-ad28-6953162ec45f/oauth2/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri=https://www.microsoft.com`
3. Ken `app-{klant}-{automation}` de rol **`AcrPull`** toe op JUICT's ACR (`juictacrg4fhuo35`).
4. Zet client ID + secret als `ACR_APP_ID` / `ACR_APP_SECRET` in de variable group. Bicep gebruikt ze als registry username/password op de Container App. **Secret nooit printen** — sla op in `juict-shared-kv` als `{klant}-{auto}-acr-app-secret`:
   ```bash
   APPID=$(az ad app create --display-name app-{klant}-{auto} --sign-in-audience AzureADMultipleOrgs --query appId -o tsv)
   SECRET=$(az ad app credential reset --id "$APPID" --append --display-name acr-pull --years 2 --query password -o tsv)
   az account set --subscription 98b5af24-e73f-4640-9d31-d323861f57a4  # JUICT
   az keyvault secret set --vault-name juict-shared-kv --name {klant}-{auto}-acr-app-secret --value "$SECRET" --output none
   az ad sp create --id "$APPID"  # SP in JUICT-tenant (equivalent van admin-consent)
   # AcrPull op de ACR (de `az role assignment`-CLI kan haperen met MissingSubscription;
   # val dan terug op een directe ARM PUT van Microsoft.Authorization/roleAssignments).
   az role assignment create --assignee "$APPID" --role AcrPull \
     --scope /subscriptions/98b5af24-e73f-4640-9d31-d323861f57a4/resourceGroups/juict-shared-rg/providers/Microsoft.ContainerRegistry/registries/juictacrg4fhuo35
   ```

---

## lighthouse

Azure Lighthouse-delegatie van de automation-subscription naar JUICT. **Vraag eerst** of ik (Claude) dit zelf doe of dat de cloud engineer het doet.

**Zelf opzetten (als de delegatie ontbreekt):** vereist een interactieve login als **owner van de automation-subscription in de klant-tenant** (de operator voert die login uit):
```bash
az login --tenant {KLANT_TENANT} --use-device-code --allow-no-subscriptions
az account set --subscription {AUTOMATION_SUBSCRIPTION_ID}
az provider register --namespace Microsoft.ManagedServices   # idempotent
az deployment sub create \
  --name {klant}-{auto}-lighthouse \
  --location westeurope \
  --template-file lighthouse-delegation.json
```
Verifieer: `az rest --method get --uri "https://management.azure.com/subscriptions/{AUTOMATION_SUBSCRIPTION_ID}/providers/Microsoft.ManagedServices/registrationAssignments?api-version=2022-10-01" --query "value[].properties.provisioningState"` → `Succeeded`.

De template (`lighthouse-delegation.json`) delegeert naar JUICT-tenant `751a3a33-5e46-4ef1-ad28-6953162ec45f` met **Contributor + User Access Administrator + Reader** via de standaard GDAP-groepen:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-08-01/subscriptionDeploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "mspOfferName": { "type": "string", "defaultValue": "JUICT - Azure Delegation" },
    "mspOfferDescription": { "type": "string", "defaultValue": "Access for JUICT IT Technicians" }
  },
  "variables": {
    "mspRegistrationName": "[guid(parameters('mspOfferName'))]",
    "mspAssignmentName": "[guid(parameters('mspOfferName'))]",
    "managedByTenantId": "751a3a33-5e46-4ef1-ad28-6953162ec45f",
    "authorizations": [
      { "principalId": "0221e770-559f-4b4e-a7c8-fd05084a47f9", "roleDefinitionId": "b24988ac-6180-42a0-ab88-20f7382dd24c", "principalIdDisplayName": "GDAP Master Group" },
      { "principalId": "67754b34-4b7d-4543-a918-4c4e7cf4871f", "roleDefinitionId": "434105ed-43f6-45c7-a02f-909b2ba83430", "principalIdDisplayName": "M365 GDAP Billing Administrator" },
      { "principalId": "d1ad51ab-4e6d-4512-9250-f46b773a9903", "roleDefinitionId": "b24988ac-6180-42a0-ab88-20f7382dd24c", "principalIdDisplayName": "M365 GDAP Partner Tier2 Support" },
      { "principalId": "b88982e7-8f81-4965-8437-7b1d0ec7f71b", "roleDefinitionId": "acdd72a7-3385-48ef-bd42-f606fba81ae7", "principalIdDisplayName": "M365 GDAP Partner Tier1 Support" }
    ]
  },
  "resources": [
    {
      "type": "Microsoft.ManagedServices/registrationDefinitions",
      "apiVersion": "2020-02-01-preview",
      "name": "[variables('mspRegistrationName')]",
      "properties": {
        "registrationDefinitionName": "[parameters('mspOfferName')]",
        "description": "[parameters('mspOfferDescription')]",
        "managedByTenantId": "[variables('managedByTenantId')]",
        "authorizations": "[variables('authorizations')]"
      }
    },
    {
      "type": "Microsoft.ManagedServices/registrationAssignments",
      "apiVersion": "2020-02-01-preview",
      "name": "[variables('mspAssignmentName')]",
      "dependsOn": [ "[resourceId('Microsoft.ManagedServices/registrationDefinitions/', variables('mspRegistrationName'))]" ],
      "properties": { "registrationDefinitionId": "[resourceId('Microsoft.ManagedServices/registrationDefinitions/', variables('mspRegistrationName'))]" }
    }
  ]
}
```

> De delegatie aan de JUICT-kant kan een paar minuten duren voordat een JUICT-technicus (lid van de GDAP-groepen) de subscription ziet. `Microsoft.ManagedServices/registrationAssignments/write` vereist **Owner** op de subscription — draai de deploy dus als sub-owner in de klant-tenant.

---

## bicep

### infra/main.bicep

> ⚠️ Vervang alle `x.x.x` versienummers door de nieuwste versies via https://azure.github.io/Azure-Verified-Modules/
> ⚠️ Controleer model versies voor gpt-4o en gpt-4o-mini via de Azure portal (deze wijzigen regelmatig)

```bicep
@description('Klant naam (lowercase, geen spaties)')
param customerName string

@description('Automation naam (lowercase, geen spaties)')
param automationName string

@description('Container image tag — gebruik Build.SourceVersion vanuit pipeline')
param imageTag string = 'placeholder'

@description('web = Next.js full-stack, split = Python API + React/Vite frontend, service = achtergrond zonder ingress')
@allowed(['web', 'split', 'service'])
param automationType string = 'split'

@secure()
param postgresAdminPassword string

@secure()
param authSecret string = ''

@description('Client ID van app-{klant}-{auto} voor cross-tenant ACR-pull')
param acrAppId string

@secure()
@description('Client secret van app-{klant}-{auto}')
param acrAppSecret string

param entraClientId string = ''

@secure()
param entraClientSecret string = ''

param customDomain string = ''

var location = 'westeurope'
var locationOpenAI = 'swedencentral'
var nameSuffix = 'prod-weu-001'
var nameSuffixShort = 'prod-001'

var hasIngress = automationType == 'web' || automationType == 'split'

var caeName    = 'cae-${customerName}-${automationName}-${nameSuffix}'
var caName     = 'ca-${customerName}-${automationName}-${nameSuffix}'
var stappName  = 'stapp-${customerName}-${automationName}-${nameSuffix}'
var psqlName   = 'psql-${customerName}-${automationName}-${nameSuffix}'
var kvName     = 'kv-${customerName}-${automationName}-prod-weu'
var stName     = take('st${customerName}${uniqueString(resourceGroup().id)}', 24) // globaal uniek; vaste namen botsen (StorageAccountAlreadyTaken)
var oaiName    = 'oai-${customerName}-${automationName}-prod-swc-001'
var logName    = 'log-${customerName}-${automationName}-${nameSuffix}'
var dbName     = replace('${customerName}_${automationName}', '-', '_')
var blobContainer = '${customerName}-${automationName}-files'

var acrLoginServer = 'juictacrg4fhuo35.azurecr.io'
var usePlaceholder = imageTag == 'placeholder'
var imageName = usePlaceholder
  ? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  : '${acrLoginServer}/${customerName}/${automationName}:${imageTag}'

var appUrl = customDomain != '' ? 'https://${customDomain}' : 'https://${customerName}.juict.nl'

// Log Analytics Workspace
module logAnalytics 'br/public:avm/res/operational-insights/workspace:x.x.x' = {
  name: 'logAnalytics'
  params: {
    name: logName
    location: location
    skuName: 'PerGB2018'
    dataRetention: 30
  }
}

// Container Apps Environment
module containerAppsEnv 'br/public:avm/res/app/managed-environment:x.x.x' = {
  name: 'containerAppsEnv'
  params: {
    name: caeName
    location: location
    logAnalyticsWorkspaceResourceId: logAnalytics.outputs.resourceId
    // AVM-default = Disabled; zonder VNet/private endpoint is de app dan onbereikbaar.
    // Publiek endpoint aan; IP-filtering doet de Container App ingress (ipSecurityRestrictions).
    publicNetworkAccess: 'Enabled'
  }
}

// Key Vault (RBAC-model, geen access policies)
module keyVault 'br/public:avm/res/key-vault/vault:x.x.x' = {
  name: 'keyVault'
  params: {
    name: kvName
    location: location
    sku: 'standard'
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

// Storage Account
module storageAccount 'br/public:avm/res/storage/storage-account:x.x.x' = {
  name: 'storageAccount'
  params: {
    name: stName
    location: location
    skuName: 'Standard_LRS'
    kind: 'StorageV2'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    blobServices: {
      containers: [
        {
          name: blobContainer
          publicAccess: 'None'
        }
      ]
    }
  }
}

// PostgreSQL Flexible Server
module postgresServer 'br/public:avm/res/db-for-postgre-sql/flexible-server:x.x.x' = {
  name: 'postgresServer'
  params: {
    name: psqlName
    location: location
    skuName: 'Standard_B1ms'
    tier: 'Burstable'
    administratorLogin: 'pgadmin'
    administratorLoginPassword: postgresAdminPassword
    version: '16'
    storageSizeGB: 32
    backupRetentionDays: 7
    geoRedundantBackup: 'Disabled'
    highAvailabilityMode: 'Disabled'
    firewallRules: [
      {
        name: 'AllowAzureServices'
        startIpAddress: '0.0.0.0'
        endIpAddress: '0.0.0.0'
      }
    ]
    databases: [
      {
        name: dbName
        charset: 'UTF8'
        collation: 'en_US.utf8'
      }
    ]
  }
}

// Azure OpenAI
module openAI 'br/public:avm/res/cognitive-services/account:x.x.x' = {
  name: 'openAI'
  params: {
    name: oaiName
    location: locationOpenAI
    kind: 'OpenAI'
    sku: 'S0'
    customSubDomainName: oaiName
    publicNetworkAccess: 'Enabled'
    deployments: [
      {
        name: 'gpt-4o'
        model: {
          format: 'OpenAI'
          name: 'gpt-4o'
          version: '2024-11-20'  // Controleer nieuwste versie in swedencentral
        }
        sku: { name: 'GlobalStandard', capacity: 30 }
      }
      {
        name: 'gpt-4o-mini'
        model: {
          format: 'OpenAI'
          name: 'gpt-4o-mini'
          version: '2024-07-18'  // Controleer nieuwste versie in swedencentral
        }
        sku: { name: 'GlobalStandard', capacity: 30 }
      }
      {
        name: 'text-embedding-3-large'
        model: {
          format: 'OpenAI'
          name: 'text-embedding-3-large'
          version: '1'
        }
        sku: { name: 'Standard', capacity: 30 }
      }
    ]
  }
}

// Container App
var databaseUrl = 'postgresql://pgadmin:${postgresAdminPassword}@${postgresServer.outputs.fqdn}/${dbName}?sslmode=require'

var baseSecrets = [
  { name: 'database-url', value: databaseUrl }
  { name: 'acr-password', value: acrAppSecret }
]

var webSecrets = [
  { name: 'auth-secret', value: authSecret }
  { name: 'entra-secret', value: entraClientSecret }
]

var baseEnv = [
  // Next.js standalone bindt aan $HOSTNAME; Container Apps zet die op de pod-naam,
  // waardoor de ingress de container niet bereikt (upstream connect error).
  // Forceer 0.0.0.0 zodat op alle interfaces geluisterd wordt.
  { name: 'HOSTNAME', value: '0.0.0.0' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'AZURE_OPENAI_ENDPOINT', value: openAI.outputs.endpoint }
  { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: stName }
  { name: 'AZURE_STORAGE_CONTAINER_NAME', value: blobContainer }
]

var webEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'AUTH_URL', value: appUrl }
  { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_ID', value: entraClientId }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET', secretRef: 'entra-secret' }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_TENANT_ID', value: 'organizations' }
]

// Cross-tenant ACR-pull via app-registratie (geen MI AcrPull).
// ALTIJD configureren (ook bij placeholder) — anders kan de eerste pipeline-deploy
// (containerapp update --image) de private image niet pullen.
var registries = [
  {
    server: acrLoginServer
    username: acrAppId
    passwordSecretRef: 'acr-password'
  }
]

module containerApp 'br/public:avm/res/app/container-app:x.x.x' = {
  name: 'containerApp'
  params: {
    name: caName
    location: location
    environmentResourceId: containerAppsEnv.outputs.resourceId
    managedIdentities: { systemAssigned: true }
    ingressExternal: hasIngress
    ingressTargetPort: hasIngress ? (automationType == 'web' ? 3000 : 8000) : null
    scaleMinReplicas: 1
    scaleMaxReplicas: 3
    scaleRules: hasIngress ? [
      { name: 'http-scaling', http: { metadata: { concurrentRequests: '10' } } }
    ] : []
    registries: registries
    containers: [
      {
        name: caName
        image: imageName
        resources: { cpu: '0.5', memory: '1Gi' }
        env: automationType == 'web' ? concat(baseEnv, webEnv) : baseEnv
      }
    ]
    secrets: automationType == 'web' ? concat(baseSecrets, webSecrets) : baseSecrets
  }
}

// Static Web App (alleen type split — React/Vite frontend)
module staticWebApp 'br/public:avm/res/web/static-site:x.x.x' = if (automationType == 'split') {
  name: 'staticWebApp'
  params: {
    name: stappName
    location: location
    sku: 'Standard'
  }
}

// Role assignments via MI — geen API keys opslaan
// Container App MI → Cognitive Services OpenAI User
module openAIRoleAssignment 'br/public:avm/res/authorization/role-assignment:x.x.x' = {
  name: 'openAIRoleAssignment'
  params: {
    principalId: containerApp.outputs.systemAssignedMIPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionIdOrName: 'Cognitive Services OpenAI User'
    resourceId: openAI.outputs.resourceId
  }
}

// Container App MI → Key Vault Secrets User
module kvRoleAssignment 'br/public:avm/res/authorization/role-assignment:x.x.x' = {
  name: 'kvRoleAssignment'
  params: {
    principalId: containerApp.outputs.systemAssignedMIPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionIdOrName: 'Key Vault Secrets User'
    resourceId: keyVault.outputs.resourceId
  }
}

// Container App MI → Storage Blob Data Contributor
module storageRoleAssignment 'br/public:avm/res/authorization/role-assignment:x.x.x' = {
  name: 'storageRoleAssignment'
  params: {
    principalId: containerApp.outputs.systemAssignedMIPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionIdOrName: 'Storage Blob Data Contributor'
    resourceId: storageAccount.outputs.resourceId
  }
}

output containerAppFqdn string = containerApp.outputs.fqdn
output containerAppPrincipalId string = containerApp.outputs.systemAssignedMIPrincipalId
output openAIEndpoint string = openAI.outputs.endpoint
output projectUrl string = appUrl
output postgresServerFqdn string = postgresServer.outputs.fqdn
output staticWebAppName string = automationType == 'split' ? stappName : ''
```

### infra/main.bicepparam

```bicep
using './main.bicep'

param customerName = 'contoso'          // Aanpassen per klant
param automationName = 'tickets'        // Aanpassen per automation
param imageTag = 'placeholder'          // deploy.sh gebruikt placeholder; pipeline draait geen Bicep
param automationType = 'split'          // 'web' | 'split' | 'service'
param postgresAdminPassword = ''        // Altijd via deploy.sh parameter — nooit hardcoden
param authSecret = ''                   // Alleen type web — via deploy.sh parameter
param acrAppId = ''                     // Client ID app-{klant}-{auto}
param acrAppSecret = ''                 // Secret app-{klant}-{auto} — via deploy.sh parameter
param entraClientId = ''                // Alleen type web
param entraClientSecret = ''            // Alleen type web — via deploy.sh parameter
param customDomain = ''                 // Leeg = {klant}.juict.nl
```

---

## deploy.sh

Eenmalige Bicep-uitrol in de klant-subscription. **Niet** in de pipeline. Draaien met **Owner of User Access Administrator** (de Bicep maakt RBAC-roltoewijzingen op de Key Vault aan — Contributor alleen is niet genoeg). Daarna lopen updates via de pipeline.

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Aanpassen per automation ---
CUSTOMER="contoso"
AUTOMATION="tickets"
CUSTOMER_SUBSCRIPTION_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
RG="rg-${CUSTOMER}-${AUTOMATION}-prod-weu-001"

# --- Secrets (genereren / invullen) ---
POSTGRES_ADMIN_PASSWORD="$(openssl rand -base64 32)"
AUTH_SECRET="$(openssl rand -base64 32)"   # alleen type web
ACR_APP_ID="<client-id van app-${CUSTOMER}-${AUTOMATION}>"
ACR_APP_SECRET="<secret van app-${CUSTOMER}-${AUTOMATION}>"

az account set --subscription "$CUSTOMER_SUBSCRIPTION_ID"

# Eerste uitrol met placeholder image (Container App + alle infra)
az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters @infra/main.bicepparam \
  --parameters \
    imageTag=placeholder \
    postgresAdminPassword="$POSTGRES_ADMIN_PASSWORD" \
    authSecret="$AUTH_SECRET" \
    acrAppId="$ACR_APP_ID" \
    acrAppSecret="$ACR_APP_SECRET"

echo "Bewaar POSTGRES_ADMIN_PASSWORD en AUTH_SECRET in de variable group vg-${CUSTOMER}-${AUTOMATION}-prod."
echo "Haal de Static Web App deployment token op (type split):"
echo "  az staticwebapp secrets list --name stapp-${CUSTOMER}-${AUTOMATION}-prod-weu-001 --query properties.apiKey -o tsv"
```

> De eerste pipeline-run vervangt de placeholder door de echte image. De Container App pullt die met de `app-{klant}-{auto}` registry-credentials.

---

## azure-pipelines

### pipelines/azure-pipelines.yml

Pas de variabelen bovenaan aan per klant/automation. De rest is generiek. **Infra wordt niet via deze pipeline uitgerold** (zie `deploy.sh`).

```yaml
trigger:
  branches:
    include:
      - main
  paths:
    exclude:
      - README.md
      - CLAUDE.md
      - TODO.md
      - infra/**

variables:
  - group: vg-contoso-tickets-prod          # Aanpassen: vg-{klant}-{automation}-prod
  - name: ACR_NAME
    value: juictacrg4fhuo35
  - name: ACR_LOGIN_SERVER
    value: juictacrg4fhuo35.azurecr.io
  - name: IMAGE_NAME
    value: contoso/tickets                   # Aanpassen: {klant}/{automation}
  - name: CA_NAME
    value: ca-contoso-tickets-prod-weu-001   # Aanpassen
  - name: RG_NAME
    value: rg-contoso-tickets-prod-weu-001   # Aanpassen
  - name: SC_JUICT
    value: sc-juict-shared
  - name: SC_CUSTOMER
    value: sc-contoso-tickets                # Aanpassen: sc-{klant}-{automation}
  - name: BACKEND_DIR
    value: backend                           # Build-context van de image

pool:
  vmImage: ubuntu-latest

stages:
  - stage: ContainerApp
    displayName: Container bouwen en deployen
    jobs:
      - job: BuildAndDeploy
        steps:
          - checkout: self

          - task: AzureCLI@2
            displayName: Image bouwen en pushen naar JUICT ACR (az acr build)
            inputs:
              azureSubscription: $(SC_JUICT)
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: |
                az acr build \
                  --registry $(ACR_NAME) \
                  --image $(IMAGE_NAME):$(Build.SourceVersion) \
                  --image $(IMAGE_NAME):latest \
                  $(BACKEND_DIR)/

          - task: AzureCLI@2
            displayName: Container App updaten met nieuwe image
            inputs:
              azureSubscription: $(SC_CUSTOMER)
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: |
                az containerapp update \
                  --name $(CA_NAME) \
                  --resource-group $(RG_NAME) \
                  --image $(ACR_LOGIN_SERVER)/$(IMAGE_NAME):$(Build.SourceVersion)

          # Alleen type split — frontend deployen naar Static Web App
          - task: AzureStaticWebApp@0
            displayName: Frontend deployen naar Static Web App
            condition: eq(variables['AUTOMATION_TYPE'], 'split')
            inputs:
              app_location: 'frontend/'
              output_location: 'dist'
              azure_static_web_apps_api_token: '$(deploymentToken)'
            env:
              VITE_API_URL: $(VITE_API_URL)   # backend Container App FQDN
```

### Variable group inhoud

Aan te maken als `vg-{klant}-{automation}-prod`:

| Variabele | Type | Waarde |
|-----------|------|--------|
| `CUSTOMER_NAME` | Normaal | `contoso` |
| `AUTOMATION_NAME` | Normaal | `tickets` |
| `CUSTOMER_SUBSCRIPTION_ID` | Normaal | `xxxxxxxx-...` |
| `CUSTOMER_TENANT_ID` | Normaal | `xxxxxxxx-...` |
| `AUTOMATION_TYPE` | Normaal | `web` \| `split` \| `service` |
| `POSTGRES_ADMIN_PASSWORD` | **Secret** | `openssl rand -base64 32` |
| `ACR_APP_ID` | Normaal | Client ID `app-{klant}-{auto}` |
| `ACR_APP_SECRET` | **Secret** | Secret `app-{klant}-{auto}` |
| `AUTH_SECRET` | **Secret** | `openssl rand -base64 32` (alleen type web) |
| `ENTRA_CLIENT_ID` | Normaal | App registration client ID (alleen type web) |
| `ENTRA_CLIENT_SECRET` | **Secret** | App registration secret (alleen type web) |
| `VITE_API_URL` | Normaal | `https://{container-app-fqdn}` (alleen type split) |
| `deploymentToken` | **Secret** | Static Web App token (alleen type split) |

---

## dockerfile-web

### backend/Dockerfile (type web — Next.js/TypeScript)

```dockerfile
FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production=false

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
```

> Vereist `output: 'standalone'` in `next.config.ts`.
> Gebruik altijd de actuele LTS-versie van Node.js als base image — controleer https://nodejs.org/en/download/

**prisma/schema.prisma — binaryTargets voor Alpine:**

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}
```

---

## dockerfile-service

### backend/Dockerfile (type split/service — Python)

> ⚠️ De Python base-image **moet** matchen met de lokale Python-versie waarmee `requirements.txt` is gegenereerd, anders faalt de build in de pipeline. Controleer beschikbare tags op Microsoft Artifact Registry (`mcr.microsoft.com`).

```dockerfile
FROM python:3.13-slim AS base

FROM base AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --gid 1001 appuser
COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .
USER appuser
EXPOSE 8000
CMD ["python", "-u", "main.py"]
```

> Pas het Python-versienummer in álle stappen aan op de lokaal gebruikte versie (base image én de `site-packages`-paden).
> Type `split`: de Python API moet luisteren op poort 8000 (zie `ingressTargetPort` in Bicep) en endpoints aanbieden onder `/api/{resource}` en `/api/{resource}/{id}`.

### requirements.txt — version pinning (verplicht)

```powershell
# In backend/ — exacte versies vastleggen via een venv
python -m venv ./venv
.\venv\Scripts\activate
get-command pip          # moet ...\venv\Scripts\pip.exe zijn
pip install -r requirements.txt
pip freeze > requirements.txt
```

```
# requirements.txt — voorbeeld (exacte versies, nooit open ranges)
openai==1.51.0
azure-identity==1.19.0
azure-storage-blob==12.23.0
httpx==0.27.2
python-dotenv==1.0.1
```

---

## frontend (type split — React + Vite)

De frontend draait op Azure Static Web App en praat met de backend Container App.

- **Backend-URL altijd via** `import.meta.env.VITE_API_URL` — nooit hardcoden. In de pipeline wordt `VITE_API_URL` als build-env meegegeven (de Container App FQDN).
- API-calls strikt naar `/api/{resource}` en `/api/{resource}/{id}`.
- Build-output in `dist/` (Vite default); `output_location: 'dist'` in de pipeline.
- Foutafhandeling: toon altijd een duidelijke foutmelding met context, geen lege catch-blokken.

```ts
// src/api/client.ts
const API_URL = import.meta.env.VITE_API_URL;

export async function getTickets() {
  const res = await fetch(`${API_URL}/api/tickets`);
  if (!res.ok) {
    throw new Error(`Tickets ophalen mislukt (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
```

---

## onboarding-checklist

### Volledige onboarding nieuwe klant-automation

```
[ ]  0. Dedicated subscription sub-{klant}-{auto}-prod aangemaakt door cloud engineer (billing account ->
        management group klant) — nooit hergebruiken voor een andere automation
[ ]  1. Azure Lighthouse-delegatie automation-subscription -> JUICT met Owner of User Access Administrator
        (NIET alleen Contributor — de Bicep maakt RBAC-roltoewijzingen) + lid "JUICT Automations Team"
[ ]  2. Resource Group aangemaakt in de automation-subscription (az group create)
[ ]  3. Cross-tenant ACR-auth: app-{klant}-{auto} aangemaakt, admin-consent gegeven, AcrPull op JUICT ACR
[ ]  4. Bestanden gegenereerd (backend/, frontend/ (split), infra/main.bicep, main.bicepparam,
        pipelines/azure-pipelines.yml, deploy.sh, CLAUDE.md)
[ ]  5. requirements.txt version-pinned via venv (Python); Dockerfile base-image matcht lokale versie
[ ]  6. Repo aangemaakt in Azure DevOps (az repos create) + code gepusht
[ ]  7. Pipeline aangemaakt (pad: pipelines/azure-pipelines.yml)
[ ]  8. Variable group aangemaakt met alle variabelen + secrets (incl. ACR_APP_ID/SECRET)
[ ]  9. DevOps Environment aangemaakt (prod-{klant}-{automation})
[ ] 10. Bicep AVM module versies geverifieerd op https://azure.github.io/Azure-Verified-Modules/
[ ] 11. Eenmalige infra-uitrol via deploy.sh (placeholder image) — RG, Container App, PostgreSQL,
        KV, Storage, OpenAI, (split) Static Web App
[ ] 12. (split) Static Web App deployment token opgehaald en als secret deploymentToken in variable group
[ ] 13. (split) VITE_API_URL gezet op de Container App FQDN
[ ] 14. Handoff naar cloud engineer: service connection sc-{klant}-{automation} (managed identity, manual)
        → Cloud engineer bevestigt dat de connection klaar is
[ ] 15. Eerste pipeline-run: echte image gebouwd (az acr build) + Container App geüpdatet (+ SWA bij split)
[ ] 16. Post-deploy: Container App pullt via app-registratie; MI-rollen aanwezig (OpenAI, KV, Storage)
[ ] 17. (web/split) Applicatie bereikbaar via URL
[ ] 18. (custom domain) CNAME doorgeven aan klant
[ ] 19. (juict.nl) cloudflare-dns skill uitvoeren
```

---

## Lessons learned — deploy-valkuilen (serku-afhaaltool, 2026-06)

Concrete dingen die een deploy braken; bicep-fixes zijn hierboven al verwerkt.

### Identiteit & rechten (grootste tijdverlies)
- **Lighthouse kan GÉÉN roltoewijzing maken voor een principal in de klant-tenant** (bijv. de managed identity). `deploy.sh`/`New-Automation.ps1` doen dat (Key Vault Secrets User → MI). Draai die stap als **native klant-tenant-admin**, of zorg dat de toewijzing al bestaat. Via Lighthouse faalt het met `AuthorizationFailed`, óók met Owner/UAA.
- **`az ad` (Graph) volgt het default-account, niet `az account set --subscription`.** Voor klant-tenant-Graph: `az login --tenant <klant-tenant> --use-device-code` (device-code, want gewone login botst vaak op MFA/Conditional Access).
- **Conditional Access blokkeert `az rest` voor de Azure DevOps-token** (`InteractionRequired`), terwijl `az devops` wél werkt. DevOps-REST-acties (bv. service-connection pipeline-autorisatie) dan via de **portal**.
- **Tokens verlopen** in lange sessies → opnieuw `az login --use-device-code` per tenant.

### Deploy-volgorde & pipeline
- **Eerste deploy = via bicep/`deploy.sh`, niet de pipeline.** De pipeline doet alleen `az containerapp update --image` en heeft een al-geconfigureerde registry nodig (zie de `registries`-fix: altijd configureren).
- **Een nieuwe service connection** parkeert de eerste pipeline-run op een permissie-checkpoint → eenmalig **Permit** in de portal (CLI-autorisatie werd door CA geblokkeerd).
- **westeurope Container Apps-capaciteit** (`AKSCapacityHeavyUsage`) kan tijdelijk op zijn → **retry**, nooit naar een andere regio (zie harde regel).

### Prisma migrate in de container-CMD crasht standalone-images (juict-lead-magnet, 2026-07)
- **`prisma migrate deploy` als container-startup-CMD crasht met `Cannot find module 'effect'`** in Next.js standalone-images. De Prisma 6-CLI (`prisma/build/index.js` → `@prisma/config`) vereist o.a. `effect`, dat de standalone-trace niet meeneemt → `MODULE_NOT_FOUND` vóór `server.js` → container crash-loopt en de app is onbereikbaar (504 via ingress).
- **Fix:** haal `migrate deploy` uit de container-CMD (`CMD ["node","server.js"]`) en laat de migratie draaien als **blokkerende MigratieCheck-stage in de pipeline** tegen prod (die bestaat al). De runtime-image heeft de prisma-CLI dan niet nodig; alleen `@prisma/client` + de gegenereerde `.prisma` (met de **Linux**-engine uit de builder — de lokale `.prisma` bevat op Windows de `query_engine-windows.dll.node`, niet de linux-musl-engine).

### Bicep / runtime (fixes hierboven verwerkt)
- **Storage-accountnaam globaal uniek** via `uniqueString()` — vaste namen botsen (`StorageAccountAlreadyTaken`).
- **CAE `publicNetworkAccess: 'Enabled'`** — AVM-default = Disabled → zonder VNet onbereikbaar ("public network access disabled").
- **`HOSTNAME=0.0.0.0` in de container-env** — Next.js standalone bindt anders aan de pod-naam → ingress onbereikbaar ("upstream connect error or disconnect/reset before headers").
- **Azure Files SMB-mount vereist de storage-account-sleutel** in de CAE-storage; AVM vult die niet → `mount error(13) Permission denied` → container blijft in `PodInitializing`. Sleutel expliciet zetten, of het volume vermijden.
- **`az` cp1252-crash** op build-logs met `▲` (Next.js) → `PYTHONUTF8=1` zetten.

### Mail via Microsoft Graph (alternatief voor SMTP)
- App-only `Mail.Send` (application permission) + admin-consent; client secret in de klant-Key Vault.
- **Scopen tot één postvak** via `New-ApplicationAccessPolicy` met een **mail-enabled security group** als `PolicyScopeGroupId` (een los postvak is geen geldige scope). Vereist Exchange Online PowerShell.
- App-code: token via client-credentials + `POST /users/{sender}/sendMail` (geen extra dependency nodig; `fetch` in Node 20).

### Claude via Azure AI Foundry (i.p.v. directe Anthropic API) — juict-lead-magnet, 2026-07
Wanneer een automation Claude gebruikt maar je wilt billing/governance via Azure en géén Anthropic-key: draai Claude via de gedeelde Foundry-resource `aif-juict-shared` (AIServices, swedencentral). Claude-modellen staan daar in de catalogus (`az cognitiveservices account list-models` → `format: Anthropic`, bv. `claude-opus-4-8`).
- **Deployment aanmaken vereist `modelProviderData`** (industry, organizationName, countryCode) én een recente api-versie. De CLI-flag kan dit niet meegeven en faalt met `InvalidModelProviderData`. Doe het via `az rest --method put` op de deployment-resource met **api-version `2026-01-15-preview`** (oudere versies geven `InvalidRequestContent`) en `properties.modelProviderData: { industry, organizationName, countryCode }`. Body: `{ "properties": { "model": { "format": "Anthropic", "name": "claude-opus-4-8", "version": "2" }, "modelProviderData": {...} }, "sku": { "name": "GlobalStandard", "capacity": "3" } }`.
- **Capaciteit 1 is te laag** — al tijdens testen `429 RateLimitReached`. Zet capacity op het model-maximum (bij opus-4-8 was dat 3).
- **Inference-route = native Anthropic Messages API-passthrough**: `POST https://{resource}.services.ai.azure.com/anthropic/v1/messages`. In code: de gewone `@anthropic-ai/sdk` met `baseURL: "https://{resource}.services.ai.azure.com/anthropic"`. Het `model`-veld = de deployment-naam.
- **Auth via managed identity (geen key)**: Entra-token voor scope `https://cognitiveservices.azure.com/.default`, meegeven als `authToken` in de Anthropic-SDK (`apiKey: null`). De MI (of test-user) heeft rol **`Cognitive Services User`** nodig op de resource (dataAction `Microsoft.CognitiveServices/*` dekt de `/anthropic/v1/*`-operatie; `Cognitive Services OpenAI User` dekt alléén OpenAI). Data-plane RBAC-propagatie duurt **enkele minuten** (401 `PermissionDenied` → gewoon retryen). Key-auth (`x-api-key`) werkt direct als je sneller wilt testen.
- **`output_config` structured outputs worden NIET ondersteund** op de Foundry-passthrough ("structured_outputs not supported in your workspace"). Gebruik in plaats daarvan **tool use**: één tool met het JSON-schema als `input_schema` + `tool_choice: { type: "tool", name }`, en valideer de `tool_use.input` met zod. JSON-schema uit zod v4 via `z.toJSONSchema()` (verwijder het `$schema`-veld; het `name`-veld hoort niet in `output_config`/schema).
