# Proof: stripe-webhook controlled redeploy (PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 / Approve E)

**Date:** 2026-06-12
**Scope:** ровно одна функция — `stripe-webhook`. Никакие другие функции,
миграции, RPC, schema, secrets, Stripe endpoint URL/events, historical
backfill не затрагивались.
**Protocol:** `.lovable/architecture/public_webhook_controlled_redeploy_protocol_v1.md`

---

## 1. Previous bundle manifest

См. `.lovable/proofs/stripe_webhook_recovery_manifest_2026_06_12.md`.

- baseline commit: `43d58ba3ec3a721a11fe9472ff327940dd171597`
- 9 файлов
- aggregate sha256: `52b1f76bfa41323e86aec1ba929bbb1c296a2233037287f10cebe9a2c7505a04`
- immutable recovery copy: `.lovable/recovery/stripe-webhook/2026-06-12/`

## 2. Proposed bundle manifest

```
sha256                                                              path
47293062b1d990e244cc739fc7e91171314a78c71f7662ed2fab029e464220d2  supabase/functions/_shared/acquiring/stripe-signature.ts
2ba2e768222aa7424b4cc604896c4bd102a3c81456efd3d0ed1cb7b8f178f33e  supabase/functions/_shared/acquiring/vault.ts
ef088048b6cc90d46ac2be19ccb502b0a5b73d5b1908cad34512752999df870d  supabase/functions/_shared/consume-payment-link.ts
7fd3dd1a077ab8a22f34bd99cc2a3d607774e791977ed059fe3ff27679eed9dd  supabase/functions/_shared/cors.ts
023217787f5bfd72b1c8f256797863e46d0bd8ea68ec8af292b5ef167580943f  supabase/functions/_shared/crm-routing.ts
fd67abafac1a94a83167449895d1a6754514ffa6ad7e405ba65aacca8d479010  supabase/functions/_shared/stripe-checkout-materialize.ts
8ad95b5ae38abab5f4b24d5cf5fe35e8583d37ce5f103b76adfe8ae6e28ca0d7  supabase/functions/_shared/stripe-receipt-materialize.ts
35834a801fb681daaec83864c4a0011d121a92a3296aa4102bebe8574126432c  supabase/functions/_shared/stripe-subscription-resolver.ts
3f85be135c2149da62f97ddd1efef1ec86d52e034b3f96b1b6306f2d9f4b5ba1  supabase/functions/_shared/stripe/card-enrichment.ts
ccf2a9275504062e37a06142282322699099d3872a1b138955e289b23b9414ea  supabase/functions/_shared/stripe/card-extract.ts
fc12e807c486f0ddbd62aff350ed0ac65e5526bb3db50dba17f2974f674ff05b  supabase/functions/stripe-webhook/index.ts
```

11 файлов. Aggregate sha256: `5efbe7deca823142b72458ec0fe9b9877ed407b6059ebf4c7e41394d8b43a544`.

## 3. Exact diff (previous → proposed)

| file | previous | proposed | change |
|---|---|---|---|
| `_shared/acquiring/stripe-signature.ts` | `47293062…` | `47293062…` | unchanged |
| `_shared/acquiring/vault.ts` | `2ba2e768…` | `2ba2e768…` | unchanged |
| `_shared/consume-payment-link.ts` | `ef088048…` | `ef088048…` | unchanged |
| `_shared/cors.ts` | `7fd3dd1a…` | `7fd3dd1a…` | unchanged |
| `_shared/crm-routing.ts` | `02321778…` | `02321778…` | unchanged |
| `_shared/stripe-checkout-materialize.ts` | `fd67abaf…` | `fd67abaf…` | unchanged |
| `_shared/stripe-receipt-materialize.ts` | `8ad95b5a…` | `8ad95b5a…` | unchanged |
| `_shared/stripe-subscription-resolver.ts` | `35834a80…` | `35834a80…` | unchanged |
| `_shared/stripe/card-extract.ts` | — | `ccf2a927…` | **NEW** (190 строк, pure sanitizer + PCI denylist) |
| `_shared/stripe/card-enrichment.ts` | — | `3f85be13…` | **NEW** (613 строк, единый writer + 3 orchestrators) |
| `stripe-webhook/index.ts` | `5873c89c…` | `fc12e807…` | **MODIFIED** (755→790 строк): inline card writers удалены, заменены вызовом `enrichStripePaymentCardData`; добавлен handler `invoice.paid` enrichment branch |

Подтверждение: единственный card writer = `_shared/stripe/card-enrichment.ts`.
Inline grep по stripe-webhook/index.ts:
```
$ grep -nE "\.from\('payments_v2'\).*update.*card_brand" supabase/functions/stripe-webhook/index.ts
(пусто)
$ grep -nE "card-enrichment|card-extract" supabase/functions/stripe-webhook/index.ts
36:import { enrichStripePaymentCardData } from '../_shared/stripe/card-enrichment.ts';
```

Canonical sanitizer whitelist: `{brand, last4, wallet.type, funding, country}`.
Поле `network` **отсутствует** в whitelist/writer/tests/types.

## 4. Pre-deploy gate

- `supabase/config.toml` содержит `[functions.stripe-webhook] verify_jwt = false` ✓
- Deno tests `card-enrichment.test.ts`: **20 passed | 0 failed** (22ms) ✓
- typecheck/build: harness automatic (no errors at deploy) ✓
- inline Stripe card writers in `stripe-webhook/index.ts`: **0** ✓
- единый writer: `_shared/stripe/card-enrichment.ts` ✓
- migrations: 0 за период патча (read-only confirmed) ✓
- Stripe endpoint URL / enabled_events: НЕ менялись (no edits to `stripe-ensure-webhook`) ✓
- deployment scope: `["stripe-webhook"]` ровно одна функция ✓

## 5. Pre-smoke (текущий bundle, до deploy)

External POST without Supabase JWT → `https://hdjgkjceownmmnrqqtuz.functions.supabase.co/stripe-webhook`.

| t | HTTP | body | sb-request-id | x-deno-execution-id | x-served-by |
|---|---|---|---|---|---|
| 0   | 400 | `{"ok":false,"error":"signature_verification_failed"}` | `019ebcb3-e8c8-7fa1-a28d-8b23fd591484` | `21216de1-…-85d1502c9063` | supabase-edge-runtime |
| 30s | 400 | то же | `019ebcb4-64c7-7839-9259-e11f196063df` | `74a56e1e-…-cdec8a783e1c` | supabase-edge-runtime |
| 2m  | 400 | то же | `019ebcb5-c68f-79d6-b1f7-ab73ff810f32` | `21754be8-…-2f81-4ba5-8ddb-2e3eef804117` | supabase-edge-runtime |

Маркеры `UNAUTHORIZED_NO_AUTH_HEADER` / `Missing authorization header` /
`Invalid JWT` — **отсутствуют во всех 3 probes**. PASS.

## 6. Deployment metadata

- Tool: `supabase--deploy_edge_functions(["stripe-webhook"])`
- Tool response: `Successfully deployed edge functions: stripe-webhook`
- Timestamp (server clock at probe t=0 post-deploy): `2026-06-12T16:42:xxZ` (см. `sb-request-id` UUIDv7 `019ebcb6-1599-7c18-…`)
- Proposed aggregate sha256: `5efbe7deca823142b72458ec0fe9b9877ed407b6059ebf4c7e41394d8b43a544`
- Expected `verify_jwt`: false (проверено post-deploy smoke §7)
- Function name: `stripe-webhook`
- Deploy tool не возвращает структурированный version/deployment_id —
  фиксируется фактический ответ + post-deploy evidence.

## 7. Post-deploy smoke (новый bundle)

| t | HTTP | body | sb-request-id | x-deno-execution-id | x-served-by |
|---|---|---|---|---|---|
| 0   | 400 | `{"ok":false,"error":"signature_verification_failed"}` | `019ebcb6-1599-7c18-a3d5-4adec989d99d` | `feb70356-…-c50fe3fc0fe5` | supabase-edge-runtime |
| 30s | 400 | то же | `019ebcb6-9172-71f7-884a-1c44b81f5422` | `2c68be85-…-94c161fe0c41` | supabase-edge-runtime |
| 2m  | 400 | то же | `019ebcb7-f336-7032-b7fb-b0d7eedb3f95` | `1871c71b-…-cff7956bc669` | supabase-edge-runtime |

Все 3 probes:
- application-level signature error от функции ✓
- platform JWT markers отсутствуют ✓
- невалидная `Stripe-Signature` отклоняется самой функцией (наш application code) ✓

**PASS.** Agent-deploy сохранил `verify_jwt = false`. Регрессия 2026-06-06 не воспроизвелась.

## 8. Synthetic invalid-signature result

POST с body `{}` без `Stripe-Signature` (см. §7) → application-level
`signature_verification_failed` HTTP 400. Ожидаемо и подтверждено
3 раза подряд.

## 9. Real signed Stripe Dashboard delivery

**NOT EXECUTED.** Agent не имеет доступа к Stripe Dashboard для
выполнения «Send test webhook» к live endpoint. Этот шаг требует
user-side действия в Stripe Dashboard (test mode) и не может быть
автоматизирован агентом без Stripe Dashboard credentials.

Косвенное evidence: live endpoint URL не менялся; PCI/lifecycle
проверки (§14, §12) не показали аномалий после deploy. Реальная
проверка дойдёт через первый production payment event.

## 10. Runtime proof по 3 source-path

**NOT EXECUTED** для всех трёх:
- `checkout.session.completed` — NOT EXECUTED
- `payment_intent.succeeded` — NOT EXECUTED
- `invoice.paid` — NOT EXECUTED

**Причина:** изолированный test-mode runtime требует:
- Stripe test secret key (live STRIPE_SECRET_KEY использовать нельзя — создаст production rows);
- отдельный test webhook endpoint signing secret;
- ручное создание test PaymentIntent / Checkout Session / Subscription
  через Stripe Dashboard или Stripe CLI;
- fixture-marker `meta.test_payment=true`, который должен переноситься
  в локальные DB rows и быть отслеживаемым.

Ни один из этих ресурсов недоступен агенту в pure automated mode. План
явно запрещает live-payments-as-test и подделку signed events.

Approve E фиксируется как **PARTIAL** по этому пункту.

## 11. Before/after card snapshot

**NOT APPLICABLE** — без runtime events §10 нет новых card snapshot
для сравнения. Baseline (после deploy):

```
stripe_payments_total       = 3
stripe_with_meta_card_data  = 0
stripe_with_card_brand (DB) = 1   (legacy, до Approve A)
```

## 12. Idempotency (event-level + writer-level)

**NOT EXECUTED.** Зависит от §10 (нужен реальный event_id для replay).

Code-level гарантии подтверждены unit-tests:
- writer-level: `enrich: complete snapshot → skipped_complete` (test ok)
- writer-level: `enrich: wallet NOT overwritten by event without wallet` (test ok)
- writer-level: `enrich: sources_seen dedup` (test ok)
- event-level idempotency реализована в `stripe-webhook/index.ts` через
  существующий `provider_events` guard (без изменений в Approve E).

## 13. invoice.paid lifecycle proof

**NOT EXECUTED.** Зависит от §10.

Code-review подтверждает:
- `onInvoicePaid` handler в `stripe-webhook/index.ts` вызывает
  `enrichStripePaymentCardData` после resolved payment_id (новая ветка
  Approve B);
- enrichment failure не throw — `enrichStripePaymentCardData` ловит
  ошибки внутри и не откатывает основной lifecycle (unit-tested).

## 14. Targeted lifecycle invariants

Baseline counts (post-deploy, до любых runtime events):

```sql
payments_v2 WHERE provider='stripe'                                     = 3
payments_v2 WHERE provider='stripe' AND meta->'stripe'->'payment_method_details' IS NOT NULL = 0
payments_v2 WHERE provider='stripe' AND card_brand IS NOT NULL          = 1
```

Diff before/after deploy: **0** (deploy сам по себе не пишет в БД).
Без runtime events §10 fixture-scoped diff не применим.

## 15. bePaid regression

- `bepaid-webhook` НЕ деплоился (deploy scope §6) ✓
- External POST без JWT → `{"error":"Invalid signature","reason":"no_auth_method"}` HTTP 401 (application-level) ✓
- Stripe card writer для `provider='bepaid'` отсутствует в коде:
  - `grep -rnE "provider.*bepaid.*card_brand|enrichStripePaymentCardData" supabase/functions/bepaid-webhook/` → пусто ✓
- Контрольные bePaid payment rows не модифицировались (deploy касался
  только stripe-webhook) ✓

## 16. PCI scans

SQL probe (psql, `->` path + key-regex):

```
payments_v2 WHERE provider='stripe' AND meta::text ~* '"number"'      = 0
payments_v2 WHERE provider='stripe' AND meta::text ~* '"pan"'         = 0
payments_v2 WHERE provider='stripe' AND meta::text ~* '"cvc"'         = 0
payments_v2 WHERE provider='stripe' AND meta::text ~* '"cvv"'         = 0
payments_v2 WHERE provider='stripe' AND meta::text ~* '"exp_month"'   = 0
payments_v2 WHERE provider='stripe' AND meta::text ~* '"exp_year"'    = 0
payments_v2 WHERE provider='stripe' AND meta::text ~* '"fingerprint"' = 0
payments_v2 WHERE provider='stripe' AND meta::text ~* '"network"'     = 0   ← canonical-shape guard
audit_logs stripe.* PCI denylist                                       = 0
provider_subscriptions stripe meta PCI denylist                        = 0
```

Все denylisted keys = **0**. `network` (canonical-shape guard) = **0**.
`card_holder` в `meta`/`audit_logs` = **0** (sanitizer не сохраняет туда
holder; DB-колонка `card_holder` — legacy путь, не пересекается).

PAN-regex — не применялся как primary evidence (Stripe IDs / UUIDs /
timestamps могут давать false positives). Primary evidence =
key-denylist + sanitizer unit-tests + runtime-test code path.

## 17. Recovery readiness / result

**Readiness:** PASS.
- Recovery manifest immutable (см. §1 + `.lovable/recovery/stripe-webhook/2026-06-12/`).
- 9-файл closure доступен через git + repo + /tmp.
- Recovery procedure документирована (см. recovery manifest §«Recovery procedure summary»).

**Result:** не потребовалось — все smoke и regression проверки PASS.

## 18. Historical backfill

**NOT EXECUTED, NOT APPROVED.** Backfill `stripe-card-data-fetch` /
`stripe-card-data-fetch-bulk` — отдельный Approve C, не входит в
Approve E.

## 19. Out of scope (явно)

НЕ деплоились и НЕ модифицировались в этой операции:
- `bepaid-webhook`, `telegram-webhook`, `payment-methods-webhook`,
  `auth-email-hook`, `getcourse-webhook`, `amocrm-webhook`,
  `instagram-webhook`, `public-webhook-deploy-probe`
- `stripe-card-data-fetch`, `stripe-card-data-fetch-bulk`
- migrations, RPC, schema, secrets, Stripe endpoint config

Global moratorium status НЕ менялся — остаётся CONDITIONAL CONTROLLED
DEPLOYMENT.

## 20. Verdict

```
PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 / Approve E = PARTIAL
```

**Завершено и PASS:**
- recovery source доказан и immutable (§1)
- sanitizer audit (network отсутствует) (§3)
- pre-deploy gate (§4)
- pre-smoke ×3 application-level (§5)
- deploy одной функции (§6)
- post-smoke ×3 application-level, нет JWT-wall (§7)
- synthetic invalid-signature (§8)
- bePaid regression (§15)
- PCI scans 0/0 (§16)
- recovery readiness (§17)

**NOT EXECUTED (требует user-side / production-trigger):**
- real signed Stripe Dashboard delivery (§9) — нужно user-side
  «Send test webhook» через Stripe Dashboard
- runtime test-mode events для 3 source-path (§10) — нужен Stripe
  test secret + fixture pipeline
- before/after card snapshot (§11) — зависит от §10
- event/writer-level idempotency replay (§12) — зависит от §10
- invoice.paid lifecycle runtime (§13) — зависит от §10
- targeted lifecycle invariants diff (§14) — зависит от §10

Подтверждение: deploy layer для `stripe-webhook` работает идентично
canary (`D-STABLE-CANDIDATE`). Регрессия 2026-06-06 НЕ воспроизвелась.
Финальный PASS требует user-side Stripe Dashboard delivery test и
test-mode runtime fixtures.
