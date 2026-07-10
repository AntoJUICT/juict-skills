---
name: tdsynnex
description: Build Rewst workflows that interact with the TD Synnex StreamOne Ion API v3. Covers customer ID resolution, NCE subscription creation and seat updates, catalog lookup, and known API quirks. Use when building or debugging Rewst workflows that use TD Synnex StreamOne Ion actions (create subscription, add seat, list subscriptions, list products).
---

# TD Synnex StreamOne Ion — Rewst Workflow Guide

## Customer ID resolution

TD Synnex API calls require the **numeric customer number** (e.g. `49957`), not the uid.
`ORG.VARIABLES.streamone_customer_uid` contains the uid (e.g. `"UG6xwNqBPoRp5K"`).

**Step 1 — list_customers:**
```
Action: TD Synnex StreamOne Ion — List Customers
Data alias: list_customers = {{ RESULT.result }}
```
Note: `RESULT.result` is the array directly — no `.data.value` wrapper.

**Step 2 — resolve_customer_id (Noop):**
```
td_customer_id = {{ ([c.name.split('/')[-1] for c in CTX.list_customers if c.uid == ORG.VARIABLES.streamone_customer_uid] + [''])[0] }}
```
Extracts the number from `c.name` path (e.g. `"accounts/5212/customers/49957"` → `"49957"`).

---

## RESULT paths

| Integration | Path |
|-------------|------|
| TD Synnex (all actions) | `RESULT.result` — array or object directly, **no** `.data.value` |
| Microsoft Graph | `RESULT.result.data.value` |

---

## List Customer Subscriptions

```
Action: TD Synnex StreamOne Ion — List Customer Subscriptions
Parameter: customerId = {{ CTX.td_customer_id }}

Data aliases:
all_subscriptions = {{ RESULT.result }}

matching_sub = {{ ([sub for sub in CTX.all_subscriptions
  if CTX.product_name_contains | lower in (sub.subscriptionName | default('') | lower)
  or CTX.product_name_contains | lower in (sub.get('ccpProductInfo', {}).get('skuDisplayName', '') | lower)
  ] + [{}])[0] }}

has_existing_sub = {{ CTX.matching_sub != {} and CTX.matching_sub.get('subscriptionStatus') == 'active' }}
```

Key subscription field names (confirmed from test runs):
- `subscriptionName` — display name (not `productName`)
- `subscriptionTotalLicenses` — current quantity as string (not `quantity`)
- `subscriptionStatus` — `"active"` or `"deleted"` (only active counts)
- `id` — numeric TD Synnex ID used as `subscriptionId` in update calls
- `subscriptionId` — GUID from Microsoft
- `ccpProductId`, `ccpSkuId`, `ccpPlanId` — catalog IDs for update calls

---

## Add Seat (Update Subscription)

```
Action: TD Synnex StreamOne Ion — Update Subscription (or similar name)
Parameters:
  customerId     = {{ CTX.td_customer_id }}
  referenceId    = {{ CTX.matching_sub.id }}   ← top-level field, not in orderItem

orderItems:
  action         = UPDATE
  productId      = {{ CTX.matching_sub.ccpProductId }}
  skuId          = {{ CTX.matching_sub.ccpSkuId }}
  planId         = {{ CTX.matching_sub.ccpPlanId }}
  resourceId     = {{ CTX.matching_sub.subscriptionId }}
  quantity       = {{ (CTX.matching_sub.subscriptionTotalLicenses | default('1') | int) + CTX.quantity }}

attributes:
  operations     = updatesubscription
```

---

## Create Subscription (NCE)

```
Action: TD Synnex StreamOne Ion — Create Subscription (or similar name)
Parameters:
  customerId = {{ CTX.td_customer_id }}

orderItems:
  action         = CREATE
  productId      = {{ CTX.td_product_ids.product_id }}
  skuId          = {{ CTX.td_product_ids.sku_id }}
  planId         = {{ CTX.td_product_ids.plan_id }}
  quantity       = {{ CTX.quantity }}

attributes:
  billingTerm    = Y
  billingCycle   = M
  coterm         = true
  renewalSetting = auto-on    ← REQUIRED for NCE — error MSFT_CR_033 without this
```

**Critical:** attribuutnaam is `renewalSetting` met waarde `auto-on` — **niet** `autoRenew: true`.
Bevestigd via TD Synnex officiële API spec + Postman collection. `autoRenew` wordt genegeerd.

For Microsoft 365 Business Premium Y:M (confirmed values):
- `productId` = `"Microsoft365EandFNCE-isvnlnce"`
- `skuId`     = `"USCFQ7TTC0LCHC0002"`
- `planId`    = `"Monthly---Annual-Commit-n15"`

---

## NCE Catalog Lookup

When no active subscription exists, look up product/sku/plan IDs from the full catalog:

```
Action: TD Synnex StreamOne Ion — List Products
Leave all filter fields empty (filter.skuDisplayName does exact match only — won't work for partial names)

Data aliases:
td_products = {{ RESULT.result }}

td_product_ids = {{ ([{
  "product_id": p.id,
  "sku_id": s.id,
  "plan_id": ([pl.id for pl in s.get("plans", []) if "P1Y:M" in pl.get("mpnId", "")] + [""])[0]
  } for p in CTX.td_products
    for s in p.get("definition", {}).get("skus", [])
    if CTX.product_name_contains | lower in s.get("displayName", "") | lower
    and "NCE" in p.id
  ] + [{}])[0] }}
```

Filter on `"NCE" in p.id` to exclude legacy non-NCE products that share the same display name
but lack a P1Y:M plan. NCE product IDs contain `"NCE"` (e.g. `"Microsoft365EandFNCE-isvnlnce"`).

---

## Known Quirks

- Rewst UI may show empty second orderItem — always check for and remove duplicate empty orderItems before testing
- `domainName` attribute is required by TD Synnex validation (COMM-VL-004) for AZURE provider CREATE, but Rewst's integration fills this automatically for existing tenants
- `renewalSetting: auto-off` disables auto-renew on UPDATE; `auto-on` enables it on CREATE/UPDATE
- Agreement fields (`agreementDateAgreed`, `agreementEmail`, etc.) are only needed for first-time customers without an existing Microsoft Customer Agreement on file
- To toggle auto-renew OFF on UPDATE: add `operations: updatesubscription` + `renewalSetting: auto-off`

---

## Reference

**Official API spec** is bundled in this skill directory: `ccp-mp-apidocs-v2.yaml` (897KB, 20.980 regels).
Te groot om volledig te lezen — gebruik Grep om specifieke secties op te zoeken:

```bash
# Endpoint of schema opzoeken
grep -n -A 20 "Create Order\|renewalSetting\|autoRenew\|ProvisioningReference" \
  ~/.claude/skills/tdsynnex/ccp-mp-apidocs-v2.yaml | head -60

# Validatieregels opzoeken
grep -n -A 10 "COMM-VL\|MSFT_CR" \
  ~/.claude/skills/tdsynnex/ccp-mp-apidocs-v2.yaml
```

Postman voorbeelden (CREATE/UPDATE order, toggle renewal):
https://github.com/cloudmindsab/td-synnex/tree/main/streamone-ion/api-v3

Relevante secties in de YAML (regelnummers):
- Create Order: ~5419
- Validatieregels (COMM-VL-004 domainName, UPDATE resourceId): ~19903
- ProvisioningReference schema: ~17867
- Subscription schema (autoRenew field): ~15283
