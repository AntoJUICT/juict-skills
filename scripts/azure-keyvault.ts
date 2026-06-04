import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";

// Vereist: npm install @azure/keyvault-secrets @azure/identity
// Stel AZURE_KEYVAULT_URL in (bijv. https://juict-shared-kv.vault.azure.net).
// In Azure Container Apps levert de managed identity de credentials via
// DefaultAzureCredential — die identity heeft "Get"-rechten op de vault nodig.

let client: SecretClient | null = null;

function getClient(): SecretClient {
  if (client) return client;
  const url = process.env.AZURE_KEYVAULT_URL;
  if (!url) throw new Error("AZURE_KEYVAULT_URL is niet ingesteld");
  client = new SecretClient(url, new DefaultAzureCredential());
  return client;
}

interface CacheEntry {
  waarde: string;
  verlooptOp: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 60 * 1000; // 1 uur

export async function getSecret(naam: string): Promise<string> {
  const nu = Date.now();
  const cached = cache.get(naam);
  if (cached && cached.verlooptOp > nu) return cached.waarde;

  const secret = await getClient().getSecret(naam);
  if (!secret.value) throw new Error(`Key Vault secret '${naam}' is leeg`);

  cache.set(naam, { waarde: secret.value, verlooptOp: nu + TTL_MS });
  return secret.value;
}
