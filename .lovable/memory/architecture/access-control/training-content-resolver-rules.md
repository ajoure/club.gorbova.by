---
name: Training Content Resolver Rules
description: Resolver priorities for training_content access (cb20-style libraries); entitlement.meta.tariff_id is a first-class match source; synthetic-legacy must not collapse cards when DB rules exist
type: feature
---

# Training Content Resolver Rules

`resolveTrainingContentFilter` (`src/hooks/useTrainingContentRules.ts`) controls which training modules/lessons a user sees inside the in-app library (cb20 + similar product-linked trees).

## Priorities (top wins)

1. **db_tariff** — DB `access_rules` (grant_target_type='training_content') with `tariff_id` matched against `effectiveTariffIds = userTariffIds ∪ entitlementTariffsByProduct[productId]`.
2. **db_product** — DB rule with NULL `tariff_id` and matching `product_id`.
3. **synthetic_bonus** — synthetic rule generated from `entitlement.meta.scope_resolution_mode` (module_scope_only / union_scope / no_scope / manual_review).
4. **synthetic_legacy** — last-resort safe-default `allowed_module_ids=[]` for entitlements with NO `meta.scope_resolution_mode` AND NO `meta.tariff_id` AND product has NO active DB training_content rules.
5. **rule_unresolved** — diagnostic bucket. Triggers when product has DB rules but none matched user's tariff context. Returns `mode='partial', allowed_module_ids=[]` (default-deny). NEVER opens full access.

## Hard rules

- **`entitlement.meta.tariff_id` is a first-class tariff matching source.** It is included in `effectiveTariffIds` for P1 alongside `subscriptions_v2.tariff_id`. An entitlement carrying a valid `meta.tariff_id` is NEVER treated as legacy.
- **synthetic-legacy must NOT be generated for a product that already has any active DB training_content rule.** Default-deny is enforced via P5 (rule_unresolved) instead.
- **No fallback into full access on resolver miss.** If no DB rule matches and no synthetic rule applies but DB rules exist → P5 default-deny, not full access.
- **Diagnostic logging** (`src/lib/trainingContentDiag.ts`) is gated by `localStorage.debug.training_content === '1'`. Never logs PII (no name/email). Fields: user_id (nullable), product_id, training_module_id, entitlement_tariff_id, subscription_tariff_ids, matched_rule_id, rule_source, fallback_reason, allowed_module_count.

## Anti-pattern: collapsing the root card

Phase E STOP-guard in `useTrainingModules` hides root modules whose visible recursive lesson count = 0. Combined with a buggy synthetic-legacy that overrides P1, this previously made entire products (e.g. cb20) disappear for users who DID have valid access. The fix above ensures P1 always wins when entitlement+sub provide a matching tariff.

## cb20 string heuristics — forbidden in runtime

`'cb20'` may appear only in:
- UI display maps (`src/lib/product-names.ts`)
- one-off backfill scripts (resolve code → id once, then operate by id)
- comments / function names (e.g. `repair-cb20-entitlements`, internally universal-by-id)

Runtime business logic must never branch on `product_code === 'cb20'`. Use `product_id` UUID.
