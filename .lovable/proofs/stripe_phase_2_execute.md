# Stripe Integration v1.1 — Фаза 2: Execute Proof

Дата: 2026-06-03
Статус: ✅ Выполнено (sandbox infrastructure ready; ожидается фактическое подключение Stripe-аккаунта super_admin'ом через UI).

## 1. Миграции

| Миграция | Артефакты |
|---|---|
| `acquiring_connections` + `provider_events` + RPC `admin_save_acquiring_secret` / `admin_delete_acquiring_secrets` | tables + RLS + GRANT + indexes + triggers |
| RPC `get_acquiring_secret` (service_role only) | service-role reader из `vault.decrypted_secrets` |

Vault availability check (dry-run перед миграцией):
```
SELECT extname, extversion FROM pg_extension WHERE extname='supabase_vault';
 supabase_vault | 0.3.1
```

Proof таблиц:
```
SELECT to_regclass('public.acquiring_connections'), to_regclass('public.provider_events');
 acquiring_connections | provider_events
```

## 2. Zero-diff bePaid (denylist verifier)

```
rg -l "acquiring/index|stripe-adapter|vault\.ts|stripe-client|stripe-signature|stripe-metadata" \
   supabase/functions/bepaid-webhook \
   supabase/functions/_shared/create-payment-checkout.ts \
   supabase/functions/_shared/acquiring/bepaid-adapter.ts
# (no matches → exit=1) ✓
```

Все 106 существующих `payment_links` остались `provider='bepaid'`:
```
SELECT count(*) AS pl_total, count(*) FILTER (WHERE provider='bepaid') AS pl_bepaid FROM payment_links;
 106 | 106
```

## 3. Edge-функции self-service слоя (4)

| Function | verify_jwt | Назначение |
|---|---|---|
| `acquiring-list-connections` | true | Read connections + has_secret_key / has_webhook_secret booleans |
| `acquiring-save-connection`  | true | UPSERT metadata + admin_save_acquiring_secret RPC |
| `acquiring-test-connection`  | true | balance + account + mode + webhook + currencies |
| `acquiring-disable-connection` | true | status=disabled + admin_delete_acquiring_secrets |

## 4. Stripe write-path edge-функции (4)

| Function | verify_jwt | Notes |
|---|---|---|
| `stripe-create-checkout` | true | Checkout Session mode=payment, client_reference_id=order_id, metadata enforced |
| `stripe-webhook`         | **false** | Raw body, Stripe-Signature HMAC-SHA256 verify, idempotency через provider_events UNIQUE |
| `stripe-get-session`     | true | Read-only debug |
| `stripe-list-events`     | true | UI feed для provider_events |

## 5. Shared-слой (новые add-only файлы)

```
supabase/functions/_shared/acquiring/
  vault.ts             # readAcquiringSecret / hasAcquiringVaultSecret (via RPC)
  stripe-metadata.ts   # buildStripeMetadata + metadataToFormPairs
  stripe-signature.ts  # verifyStripeSignature (HMAC-SHA256, 5min tolerance)
  stripe-client.ts     # stripeFetch + балансы/аккаунты/сессии helpers
  stripe-adapter.ts    # AcquiringAdapter for 'stripe' (replaces Phase-1 placeholder)
  auth-guard.ts        # requireSuperAdmin / actorSupabase
  index.ts             # registry update: 'stripe' → stripeAdapter (was placeholder)
```

## 6. UI

- `/admin/integrations/acquiring` rebuilt:
  - Tabs: **Подключения** + **Stripe events**.
  - bePaid карточка — read-only «Активен», направляет в существующий раздел Интеграции → Платежи.
  - Stripe карточка → кнопки **Настройки** / **Проверить подключение** / **Отключить**.
- `StripeConnectionDialog`:
  - Поля: account_name, account_code (readonly=`stripe_poland`), publishable_key, secret_key (write-only password), webhook_signing_secret (write-only password), success_url, cancel_url, is_default, locale.
  - Test mode заблокирован в ON (Фаза 2 запрещает live).
  - Validation префиксов: pk_/sk_/rk_/whsec_; mode_mismatch если sk_test_* + test_mode=false.
  - **Никогда** не загружает значения secret_key/webhook_secret в форму — отображает только бейдж «сохранён».
- `StripeEventsTab`: таблица из provider_events (provider='stripe').

## 7. Security model (резюме)

| Артефакт | Где хранится | Кто читает |
|---|---|---|
| publishable_key | `acquiring_connections.publishable_key` (открытый) | super_admin via API; edge service_role |
| secret_key | `vault.secrets` (pgsodium-зашифровано) под именем `acq:stripe:stripe_poland:secret_key` | edge через RPC `get_acquiring_secret` (service_role only) |
| webhook_signing_secret | `vault.secrets` под именем `acq:stripe:stripe_poland:webhook_signing_secret` | edge через тот же RPC |
| Audit | `audit_logs` action=`acquiring.connection.secret_updated` (без значения) | стандартный admin audit feed |

## 8. config.toml

Добавлен блок:
```toml
[functions.stripe-webhook]
  verify_jwt = false
```

## 9. Что НЕ сделано в Фазе 2 (явно)

- Реальная регистрация webhook в Stripe Dashboard — должно быть выполнено super_admin'ом после сохранения test ключей.
- Sandbox checkout UI (кнопка тестовой оплаты внутри Stripe card) — задел на Phase 2.x; пока сквозной тест выполняется вручную создавая `orders_v2` и вызывая `stripe-create-checkout`.
- Restricted API Key, IP allowlist, ротация — security backlog.
- Subscription mode, saved cards, customer_choice, public `payment_links` с `provider='stripe'` — Phase 3.

## 10. DoD статус

| # | Пункт | Статус |
|---|---|---|
| 1 | Миграции acquiring_connections + provider_events + RPCs применены, RLS включена, доступ только super_admin | ✅ |
| 2 | RPC admin_save_acquiring_secret пишет в Vault + audit | ✅ |
| 3 | 4 self-service + 4 stripe write-path edge-функции созданы | ✅ |
| 4 | UI Dialog принимает ключи; secret_key/webhook_secret никогда не возвращаются в браузер | ✅ |
| 5 | acquiring-test-connection реализует balance/account/mode/webhook/currency check | ✅ |
| 6 | Webhook signature verifier работает на raw body | ✅ |
| 7 | Идемпотентность через UNIQUE(idempotency_key) | ✅ |
| 8 | Metadata contract enforced до отправки в Stripe | ✅ |
| 9 | Mismatch account_code → manual_review | ✅ |
| 10 | Zero-diff bePaid (denylist verifier) | ✅ |
| 11 | Build green | ⏳ авто-проверка lovable |
| 12 | Proof file | ✅ (этот документ) |
| — | End-to-end sandbox оплата 4242 | ⏳ ожидает ввода test-ключей super_admin'ом через UI и регистрации webhook в Stripe Dashboard |
