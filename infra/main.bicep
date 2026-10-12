// StoreOps platform + app, one resource group per environment (rg-storeops-<env>).
//
// Two-phase by design (see docs/INFRA-SETUP.md):
//   1. deployApp=false -> platform only (logs, registry, key vault, identity, container apps environment)
//   2. deployApp=true  -> adds the Container App once an image exists in the registry
// The app pipeline always re-deploys this template with the new image tag, so infrastructure
// and the running version never drift apart.
targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param environmentName string

param location string = resourceGroup().location
param workload string = 'storeops'

@description('Full image reference, e.g. <acr>.azurecr.io/storeops-api:<git-sha>. Required when deployApp=true.')
param containerImage string = ''

@description('Create the Container App. False for the first (platform-only) deployment.')
param deployApp bool = false

@description('Object id of the pipeline identity; granted AcrPush and Key Vault Secrets Officer on this environment only.')
param deployerPrincipalId string

@description('ServicePrincipal for the pipeline identity (the default). Use User when you deploy from your own laptop with your own sign-in.')
@allowed(['ServicePrincipal', 'User'])
param deployerPrincipalType string = 'ServicePrincipal'

@description('Demo users are allowed in dev only. Prod serves the API with no seeded users (no identity provider is wired in).')
param seedDemoData bool = environmentName == 'dev'

param minReplicas int = environmentName == 'prod' ? 1 : 0
param maxReplicas int = 3
param logRetentionDays int = environmentName == 'prod' ? 90 : 30

var suffix = uniqueString(resourceGroup().id)
var acrName = take('${workload}${environmentName}${suffix}', 50)
var keyVaultName = take('kv-${workload}-${environmentName}-${suffix}', 24)
var tags = {
  workload: workload
  environment: environmentName
  managedBy: 'bicep'
  purpose: 'capstone-reference-do-not-use-in-production'
}

// Built-in role definition ids
var roleAcrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var roleAcrPush = '8311e382-0749-4cb8-b61a-304f252e45ec'
var roleKeyVaultSecretsUser = '4633458b-17de-40a2-b85b-6b2e8ad2cd0e'
var roleKeyVaultSecretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2d0f8d5c'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${workload}-${environmentName}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
    features: { disableLocalAuth: false }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${workload}-${environmentName}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableIpMasking: false
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${workload}-${environmentName}'
  location: location
  tags: tags
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: environmentName == 'prod' ? true : null
    publicNetworkAccess: 'Enabled'
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, roleAcrPull)
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPull)
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, roleKeyVaultSecretsUser)
  scope: keyVault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
  }
}

resource deployerAcrPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, deployerPrincipalId, roleAcrPush)
  scope: acr
  properties: {
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPush)
  }
}

resource deployerKeyVault 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deployerPrincipalId, roleKeyVaultSecretsOfficer)
  scope: keyVault
  properties: {
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsOfficer)
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${workload}-${environmentName}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

var appSecrets = concat(
  [
    {
      name: 'jwt-secret'
      keyVaultUrl: '${keyVault.properties.vaultUri}secrets/jwt-secret'
      identity: identity.id
    }
  ],
  seedDemoData
    ? [
        {
          name: 'demo-password'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/demo-password'
          identity: identity.id
        }
      ]
    : []
)

var appEnvVars = concat(
  [
    { name: 'APP_ENV', value: environmentName }
    { name: 'NODE_ENV', value: 'production' }
    { name: 'HOST', value: '0.0.0.0' }
    { name: 'PORT', value: '3000' }
    { name: 'LOG_LEVEL', value: 'info' }
    // Container Apps terminates TLS at one ingress hop; this makes client IPs (and rate limits) correct.
    { name: 'TRUST_PROXY_HOPS', value: '1' }
    { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
    { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
    { name: 'SEED_DEMO_DATA', value: string(seedDemoData) }
  ],
  seedDemoData ? [{ name: 'DEMO_PASSWORD', secretRef: 'demo-password' }] : []
)

resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: 'ca-${workload}-api-${environmentName}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [{ latestRevision: true, weight: 100 }]
      }
      registries: [{ server: acr.properties.loginServer, identity: identity.id }]
      secrets: appSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: containerImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: appEnvVars
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 15
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 3000 }
              initialDelaySeconds: 3
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }]
      }
    }
  }
  dependsOn: [acrPull, kvSecretsUser]
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output keyVaultName string = keyVault.name
output identityId string = identity.id
output appName string = deployApp ? app!.name : ''
output appUrl string = deployApp ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
