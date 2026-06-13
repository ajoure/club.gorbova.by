# PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve D — Deploy proof

## 1. Pre-deploy verification
- Backend: `supabase--test_edge_functions(["admin-payment-documents-resolve"])` → **56 passed | 0 failed (41ms)**
  - Включая B1.x suite: Stripe factory (mode/account match, secret-unavailable safe error, invalid-resource 0-network, non-2xx body redaction, timeout, fetch-throw network safe error), composition (production stub отсутствует — happy-path реально дергает mock vault+fetch).
- Frontend: `bunx vitest run` → **189 passed | 0 failed** across 11 files
  - `usePaymentDocuments.test.ts` 10/10, `PaymentDocumentsDrawer.test.tsx` 20/20, `paymentDocumentUi.test.ts` 26/26 — RBAC, refund parent, isSafeHttpsUrl, stale-response (seqRef), no auto-refresh, no generation UI, signed URL not persisted.

## 2. Baseline (2026-06-13 05:07:18Z)
| entity | rows |
|---|---|
| payments_v2 | 6011 |
| orders_v2 | 3751 |
| subscriptions_v2 | 1247 |
| provider_subscriptions | 723 |
| entitlements | 964 |
| ai_generated_documents | 101 |
| access_rules | 52 |
| payment_links.current_uses (sum) | 30 |

`baseline_started_at = 2026-06-13 05:07:18.426069+00`

Webhook deploy-inventory: `stripe-webhook` и `bepaid-webhook` НЕ входят в deploy scope и не упоминались в `supabase--deploy_edge_functions` для Approve D.

## 3. Deploy
- `supabase--deploy_edge_functions(["admin-payment-documents-resolve"])` → `Successfully deployed edge functions: admin-payment-documents-resolve`
- Shared layer (`supabase/functions/_shared/payments/documents/*`) включён в bundle вместе с резолвером, отдельно не деплоится.
- `supabase/config.toml` §`[functions.admin-payment-documents-resolve]` → `verify_jwt = true` (без изменений в этом patch).
- Smoke без JWT: `POST /admin-payment-documents-resolve` без `Authorization` → **HTTP 401 `UNAUTHORIZED_NO_AUTH_HEADER`** — verify_jwt-цепочка активна.

Передеплоев `stripe-webhook` / `bepaid-webhook` / `public-checkout` / `grant-access-*` / document-generation функций НЕ выполнялось. Secrets и `acquiring_connections` не менялись.

## 4. Frontend deploy
Frontend bundle (PaymentsTable + PaymentDocumentsDrawer + hook/utils/types) собран и готов; платформенный publish-workflow требует подтверждения владельца через UI «Publish → Update». Lovable-агент не может выполнить publish самостоятельно без действия пользователя.

Статус: **WAITING_FOR_OWNER_PUBLISH_CONFIRMATION**.

## 5. Runtime / RBAC / Security / Regression proof
Все сценарии Этапов 4-8 (Stripe / bePaid / refund / internal docs / empty / audit actor / PCI / lifecycle regression) требуют публикованного frontend и интерактивного сценария в реальном браузере под `7500084@gmail.com`. До нажатия «Update» в publish-диалоге runtime-выводы зафиксированы как **PENDING_FRONTEND_PUBLISH** — выполнение запланировано сразу после публикации в этом же Approve D без расширения scope.

Покрытие до runtime гарантировано тестами:
- backend resolver: 56 Deno тестов (включая RBAC view-only без refresh, refund parent, unsafe URL не возвращается, raw provider body не утечает, secret/connection не в response, generation не вызывается, payments_v2 не пишется);
- frontend: 56 vitest тестов вокруг drawer/hook/utils (isSafeHttpsUrl блокирует non-https, manual-only refresh confirm, capability-driven actions, no generation UI, stale-guard).

## 6. Verdict
- Backend deploy: **DONE**
- Frontend publish: **WAITING_FOR_OWNER_PUBLISH_CONFIRMATION**
- Approve D итог: **PARTIAL** (по §2 утверждённых правок: backend задеплоен и проверен; финальный PASS возможен только после нажатия «Update» владельцем и runtime proof на опубликованной версии).

После публикации frontend выполняется matrix Этапов 4-8 и обновляется этот же файл секцией «Runtime proof» + регресс-сравнение с baseline.
