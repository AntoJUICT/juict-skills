#!/usr/bin/env python3
"""Key Vault-fallback voor unifi-lookup.mjs.

Schrijft de waarde van precies een toegestane secret naar stdout, voor het aanroepende proces.
Nooit zelf aanroepen om een waarde in je terminal te zien: dat is precies wat deze skill vermijdt.
"""
import sys

TOEGESTAAN = {"UNIFI-URL", "UNIFI-USER", "UNIFI-PASS"}
VAULT_URL = "https://juict-shared-kv.vault.azure.net"


def main(argv):
    if len(argv) != 2 or argv[1] not in TOEGESTAAN:
        print("Gebruik: kv-secret.py <UNIFI-URL|UNIFI-USER|UNIFI-PASS>", file=sys.stderr)
        return 2
    try:
        from azure.identity import DefaultAzureCredential
        from azure.keyvault.secrets import SecretClient
    except ImportError:
        print("Installeer azure-identity en azure-keyvault-secrets (pip install azure-identity azure-keyvault-secrets).", file=sys.stderr)
        return 3
    try:
        waarde = SecretClient(VAULT_URL, DefaultAzureCredential()).get_secret(argv[1]).value
    except Exception as fout:  # alleen het type, nooit details die een waarde kunnen bevatten
        print(f"Key Vault-fout: {type(fout).__name__}", file=sys.stderr)
        return 4
    sys.stdout.buffer.write((waarde or "").encode("utf-8"))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
