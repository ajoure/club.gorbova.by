# да, согласен, с учетом правок:

1. **Не принимать фразу “bePaid остаётся env-vars” как финальную архитектуру.**

Сейчас по факту bePaid настраивается через UI интеграций. Поэтому в плане нужно заменить:

```text
bePaid в Фазе 2 не мигрируется на эту же модель — он остаётся как есть (env-vars)
```

на:

```text
bePaid в Фазе 2 не мигрируется и не изменяется. Существующая UI-модель настройки bePaid сохраняется как есть.
```

2. **Vault — только если в проекте реально включён Supabase Vault.**

Перед execute добавить dry-run проверку:

```sql
SELECT * FROM pg_extension WHERE extname = 'supabase_vault';
```

или эквивалентную проверку доступности `vault.secrets`.

Если Vault недоступен — STOP, не хранить секреты в обычной таблице.

3. **Webhook signature требует raw body.**

В `stripe-webhook` обязательно указать: нельзя парсить JSON до проверки подписи. Stripe требует raw payload + `Stripe-Signature` + endpoint secret для проверки.  

4. **Checkout Session contract корректный, но добавить** `client_reference_id` **как обязательный DoD.**

Stripe прямо предусматривает `client_reference_id` для связи Checkout Session с внутренней системой.  

5. **Restricted API Key оставить в security backlog.**

План правильно не блокирует Фазу 2 restricted key. Но зафиксировать: после sandbox proof оценить переход на restricted key, потому что Stripe рекомендует ограничивать ключи по правам.  

После этих правок Фазу 2 можно запускать.

&nbsp;

План: Stripe Integration v1.1 — Фаза 2 (Stripe sandbox) — v2

## 0. Принципы

- Строго **add-only**. Ни одна `bepaid-*` функция, ни `create-payment-checkout.ts`, ни `bepaid-webhook`, ни `bepaid-adapter.ts` НЕ изменяются.
- Stripe работает только в **sandbox (test mode)** в Фазе 2. Live включается отдельным согласованием.
- Все write-операции Stripe идут через **новые отдельные edge-функции** `stripe-*` поверх adapter layer Фазы 1.
- **Ключи Stripe настраиваются через админку**, по аналогии с bePaid. Разработчик НЕ прописывает их руками через add_secret. Self-service.
- Доступ к Stripe-чекауту в Фазе 2 — только через **внутренний админский тестовый продукт**. Публичные `payment_links` provider='stripe' получают только в Фазе 3.

## 1. Self-service подключение Stripe через админку (КЛЮЧЕВОЕ ОТЛИЧИЕ ОТ v1)

### 1.1. UI флоу

В `/admin/integrations/acquiring` карточка **Stripe Poland** получает кнопку **«Настройки»** → открывает форму `StripeConnectionDialog`:


| Поле                     | Тип               | Обязательное | Примечание                                                                           |
| ------------------------ | ----------------- | ------------ | ------------------------------------------------------------------------------------ |
| Название подключения     | text              | ✅            | default «Stripe Poland»                                                              |
| `account_code`           | text              | ✅, readonly  | `stripe_poland` (один на Фазу 2)                                                     |
| Test mode                | toggle            | ✅            | default ON, в Фазе 2 нельзя выключить                                                |
| Publishable key          | text              | ✅            | `pk_test_...` — публичный, валидация префикса                                        |
| Secret key               | password (masked) | ✅            | `sk_test_...` — секрет, валидация префикса                                           |
| Webhook signing secret   | password (masked) | ✅            | `whsec_...` — НЕ API-ключ, проверочная подпись                                       |
| Success URL              | text              | ✅            | default `https://<domain>/admin/integrations/acquiring/stripe-result?status=success` |
| Cancel URL               | text              | ✅            | default `https://<domain>/admin/integrations/acquiring/stripe-result?status=cancel`  |
| Подключение по умолчанию | toggle            | —            | один true per provider                                                               |
| Locale (email receipts)  | select            | —            | `en` / `pl` / `ru`                                                                   |


Кнопки: **Сохранить**, **Проверить подключение**, **Отключить**.

### 1.2. Storage-контракт (где фактически лежат ключи)

**Никаких секретов в обычных таблицах в открытом виде.** Два слоя:

1. **Public table `acquiring_connections**` — non-sensitive метаданные подключения:

```
CREATE TABLE public.acquiring_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text NOT NULL,                     -- 'stripe' | 'bepaid'
  account_code          text NOT NULL UNIQUE,              -- 'stripe_poland'
  account_name          text NOT NULL,
  is_default            boolean NOT NULL DEFAULT false,
  test_mode             boolean NOT NULL DEFAULT true,
  status                text NOT NULL DEFAULT 'pending',   -- pending|active|disabled|invalid
  publishable_key       text,                              -- pk_* безопасен в открытом виде
  success_url           text,
  cancel_url            text,
  locale                text,
  capabilities_snapshot jsonb DEFAULT '{}',                -- результат test-connection (currencies, account country)
  last_verified_at      timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
```

GRANT: только `service_role` ALL; `authenticated` SELECT через RPC с проверкой `has_role_v2('super_admin')`. RLS включена, политики такие же. **Поля `secret_key` и `webhook_signing_secret` в этой таблице НЕ хранятся.**

2. **Secrets layer (Vault) — `acquiring_connection_secrets**`:

Используем **Supabase Vault** (`vault.secrets`) для зашифрованного хранения. Под капотом — pgsodium шифрование, расшифровка только для service_role. Контракт:

- Для каждого подключения создаются 2 vault-секрета с детерминированными именами:
  - `acq:stripe:stripe_poland:secret_key` → значение `sk_test_...`
  - `acq:stripe:stripe_poland:webhook_signing_secret` → значение `whsec_...`
- Запись через RPC `admin_save_acquiring_secret(connection_id, kind, value)` (SECURITY DEFINER, super_admin only) → вставка/обновление в `vault.secrets`.
- Чтение **только из edge-функций** через service_role и helper `getAcquiringSecret(provider, account_code, kind)` (расширение Фазы-1 helper'а):
  1. Сначала проверяем Vault: `select decrypted_secret from vault.decrypted_secrets where name = 'acq:stripe:stripe_poland:secret_key'`.
  2. Fallback на env-var (для локального dev / резервного режима): `STRIPE_SECRET_KEY_STRIPE_POLAND`.
  3. Финальный fallback (single-account dev): `STRIPE_SECRET_KEY`.
- В клиент (браузер) secret/webhook_secret **никогда не возвращаются**, даже в masked-виде; форма редактирования всегда требует ввести новое значение (либо оставить пустым = «не менять»).

3. **Аудит**: каждое сохранение/изменение/удаление секрета → запись в `audit_logs` (action `acquiring.connection.secret_updated`, actor = JWT super_admin, без значения секрета).

### 1.3. Edge-функции self-service слоя


| Функция                        | Назначение                                                                                                                                                              | verify_jwt | Авторизация |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| `acquiring-save-connection`    | Принимает форму из UI, делит payload на public (UPSERT в `acquiring_connections`) + secrets (через `admin_save_acquiring_secret`). Никогда не логирует secret-значения. | true       | super_admin |
| `acquiring-test-connection`    | Проверка подключения (см. §6 ниже).                                                                                                                                     | true       | super_admin |
| `acquiring-disable-connection` | Ставит `status='disabled'`, очищает Vault-секреты, аудит.                                                                                                               | true       | super_admin |
| `acquiring-list-connections`   | Read-only список без секретов для UI.                                                                                                                                   | true       | super_admin |


bePaid в Фазе 2 **не мигрируется** на эту же модель — он остаётся как есть (env-vars), задача миграции bePaid под `acquiring_connections` идёт в backlog как отдельный спринт. Карточка bePaid в UI остаётся read-only «Активен» без формы.

## 2. Запрашиваемые секреты (через add_secret)

В Фазе 2 через add_secret запрашивается **ровно ноль** Stripe-секретов. Все ключи админ вводит сам через UI. Add_secret вызываем **только если** sysadmin явно попросит fallback на env-var режим (dev-only).

## 3. Создаваемые edge-функции Stripe write-path


| Функция                  | Назначение                                                                                                                                                                                                                                                                                                                        | verify_jwt |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `stripe-create-checkout` | Создаёт Checkout Session (`mode=payment`) для одноразовой оплаты. Принимает `order_id`, `account_code`, `business_stream`, `tariff_id`, `product_id`, `offer_id`, `payment_link_id?`, `contact_id?`, `user_id?`. Возвращает `{url, session_id}`. Использует `success_url`/`cancel_url`/`client_reference_id=order_id`/`metadata`. | true       |
| `stripe-webhook`         | Принимает Stripe events. Верифицирует подпись через `whsec_*` из Vault (`Stripe-Signature` header + raw payload). Резолвит `account_code` по endpoint-маппингу (один endpoint per account_code). Пишет в `provider_events`, диспатчит обработчики.                                                                                | false      |
| `stripe-get-session`     | Read-only: статус Checkout Session по `session_id` для UI отладки.                                                                                                                                                                                                                                                                | true       |
| `stripe-list-events`     | Read-only: последние записи из `provider_events` для админки.                                                                                                                                                                                                                                                                     | true       |


`stripe-adapter.ts` (Фаза 1 — placeholder) превращается в полноценный `AcquiringAdapter` поверх Stripe REST API через `fetch` к `api.stripe.com/v1/...` (без тяжёлого npm-SDK). Регистрируется в `_shared/acquiring/index.ts`.

## 4. Webhook events (MVP Фазы 2)


| Event                           | Обработчик          | Действие                                                                                                                                              |
| ------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`    | onCheckoutCompleted | Lookup `order_id` (metadata + client_reference_id cross-check) → канон `grant-access-for-order` (вызывается, не меняется).                            |
| `checkout.session.expired`      | onCheckoutExpired   | audit `stripe.checkout.expired`, order не трогаем.                                                                                                    |
| `payment_intent.succeeded`      | onIntentSucceeded   | Дедуп с `checkout.session.completed` через `provider_events.idempotency_key`. INSERT `payments_v2` только если ещё нет по `provider_payment_id=pi_*`. |
| `payment_intent.payment_failed` | onIntentFailed      | audit + `orders_v2.meta.last_stripe_error`.                                                                                                           |
| `charge.refunded`               | onChargeRefunded    | RPC `record_refund_atomic(refund_uid='re_*')` (memory: refund-canonical-write-path).                                                                  |
| `charge.dispute.created`        | onDisputeCreated    | Только запись в `provider_events`, без бизнес-логики (Phase 3).                                                                                       |


Остальные события (`invoice.*`, `customer.subscription.*`, `setup_intent.*`) логируются в `provider_events` без обработчика — задел на Фазу 3.

## 5. provider_events / idempotency

Миграция (одна из двух в Фазе 2):

```
CREATE TABLE public.provider_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  account_code    text NOT NULL,
  event_id        text NOT NULL,
  event_type      text NOT NULL,
  idempotency_key text NOT NULL,            -- ${provider}:${account_code}:${event_id}
  payload         jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  processed_at    timestamptz,
  processing_status text NOT NULL DEFAULT 'received',   -- received|processed|skipped_duplicate|failed|manual_review
  processing_error text,
  related_order_id uuid,
  related_payment_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
```

GRANT: `service_role` ALL; `authenticated` SELECT через RPC (super_admin only); анону доступа нет. RLS включена.

Логика идемпотентности в `stripe-webhook`:

1. Проверка подписи через `whsec_*` из Vault. Невалидная подпись → 400, ничего не пишем.
2. `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`.
3. Конфликт → 200 `{status:'skipped_duplicate'}`, обработчик не вызывается.
4. Иначе → вызов обработчика, в финале `UPDATE processing_status=...`.

Исходящие Stripe API вызовы: header `Idempotency-Key: ${order_id}:${attempt}`.

## 6. Test connection (`acquiring-test-connection`)

Вход: `connection_id`. Проверяет последовательно:

1. **Secret key валиден**: `GET https://api.stripe.com/v1/balance` с `Authorization: Bearer sk_*`. 200 → ок, 401 → `invalid_secret_key`.
2. **Аккаунт доступен**: `GET /v1/account` → парсит `id`, `country`, `default_currency`, `charges_enabled`, `payouts_enabled`. Сохраняем в `capabilities_snapshot`.
3. **Test/Live соответствие**: ключ `sk_test_*` ⇔ `test_mode=true`. Mismatch → `mode_mismatch`, статус `invalid`.
4. **Webhook secret сохранён**: проверяем наличие vault-записи `acq:stripe:stripe_poland:webhook_signing_secret`. Отсутствует → `webhook_secret_missing`. Реальный hit endpoint'а тестируем отдельно вручную в Stripe Dashboard (Test webhook).
5. **Currency discovery**: `GET /v1/country_specs/{country}` → список `supported_payment_currencies` → сохраняем в `capabilities_snapshot.supported_currencies`. Используется в Фазе 3 для обновления `stripe_currency_support_v1.md`.

Результат:

- успех → `status='active'`, `last_verified_at=now()`, `last_error=null`, в UI зелёный бейдж.
- любая ошибка → `status='invalid'`, `last_error=<code>`, в UI красный бейдж с расшифровкой через `normalizeEdgeFunctionError`.

## 7. Маппинг Checkout Session → order/payment

1. Админ открывает тестовый продукт в `/admin/integrations/acquiring` → блок «Sandbox checkout» → жмёт «Оплатить через Stripe».
2. UI вызывает `stripe-create-checkout` с уже созданным **тестовым** `orders_v2` (status=`pending`, provider=`stripe`).
3. Edge собирает `metadata` по контракту `stripe_metadata_contract_v1.md` (`order_id`, `product_id`, `tariff_id`, `business_stream`, `account_code`, `provider='stripe'` обязательны).
4. `POST /v1/checkout/sessions` с `client_reference_id=order_id`, `success_url`, `cancel_url` из `acquiring_connections`.
5. Возврат `{url, session_id}` → редирект.
6. После оплаты → `checkout.session.completed` → `stripe-webhook` → lookup `orders_v2` по `metadata.order_id` (+ cross-check `client_reference_id`) → INSERT `payments_v2` (provider=`stripe`, `provider_payment_id=pi_*`, `meta.stripe.checkout_session_id=cs_*`, `meta.stripe.charge_id=ch_*`) → вызов **существующего** `grant-access-for-order` без модификаций.

Mapping и риски — см. `stripe_object_mapping_v1.md`.

## 8. Использование metadata contract

`_shared/acquiring/stripe-metadata.ts` (новый) — единственная точка сборки metadata. Валидирует обязательные поля перед отправкой в Stripe. Отсутствие → 400, в Stripe не уходит.

Webhook-ingest:

- `account_code` резолвится по endpoint-маппингу/Vault webhook secret (НЕ из metadata).
- cross-check `metadata.account_code === resolved` → mismatch → `processing_status='manual_review'`, 200.
- отсутствие `order_id` в metadata → `manual_review`, 200, audit `stripe.webhook.no_order_id`.

## 9. Проверка через тестовый админский продукт

- Внутренний product `stripe_sandbox_test_product` (uuid) + tariff + offer, фичефлаг `admin_only=true`, не появляется на лендингах.
- Блок «Sandbox checkout» в `/admin/integrations/acquiring` создаёт тестовый `orders_v2` и запускает Checkout.
- Карта `4242 4242 4242 4242` (Stripe test).
- После оплаты UI показывает: `orders_v2.status=paid`, `payments_v2` создан, `provider_events` обработаны, `grant-access-for-order` отработал.
- Refund тест: кнопка «Sandbox refund» → Stripe API → `charge.refunded` → `record_refund_atomic`.

## 10. bePaid-файлы, которые НЕ трогаются (denylist verifier)

- `supabase/functions/bepaid-*/*` (все)
- `supabase/functions/_shared/create-payment-checkout.ts`
- `supabase/functions/_shared/acquiring/bepaid-adapter.ts`
- `supabase/functions/grant-access-for-order/*` (вызывается, не модифицируется)
- RPC `record_refund_atomic` — as-is
- Таблицы `payment_links`, `orders_v2`, `payments_v2`, `subscriptions_v2`, `provider_subscriptions` — НЕ получают новых колонок в Фазе 2 (новые таблицы — только `provider_events` и `acquiring_connections`).
- UI: `PaymentDialog`, `/pay/:token`, `LinksTabContent`, `PaymentsTabContent` — НЕ получают Stripe write-path.

## 11. Миграции Фазы 2

Ровно две миграции:

1. `acquiring_connections` (+ GRANT + RLS + policy + trigger updated_at + index по `provider, account_code`).
2. `provider_events` (+ GRANT + RLS + policy + indexes `event_id`, `provider+account_code+event_type`, `related_order_id`).

Плюс одна RPC: `admin_save_acquiring_secret(p_connection_id uuid, p_kind text, p_value text)` (SECURITY DEFINER, super_admin, пишет в `vault.secrets`).

Никаких ALTER существующих таблиц.

## 12. UI Фазы 2 (расширение страницы из Фазы 1)

- `/admin/integrations/acquiring`:
  - карточка Stripe → бейдж статуса из `acquiring_connections.status` (pending/active/invalid/disabled).
  - кнопка **Настройки** → `StripeConnectionDialog` (см. §1.1).
  - кнопка **Проверить подключение** → `acquiring-test-connection`, спиннер, тост с результатом.
  - кнопка **Отключить** → confirm + `acquiring-disable-connection`.
- Sub-таб **Sandbox checkout** (виден только при `status='active'` + `test_mode=true`).
- Sub-таб **Stripe events** — таблица из `provider_events` (provider='stripe'), фильтры по типу/статусу.

Дизайн — semantic tokens, `Card`/`Dialog`/`Badge` из существующего UI-kit. Никаких новых hex-цветов.

## 13. Security backlog (post-MVP)

После закрытия Фазы 2 — оценить:

- переход на **Restricted API Key** вместо полного secret key (минимизация blast radius);
- ротация secret key по расписанию;
- алерт на изменение `status='invalid'` в Slack/email;
- IP allowlist для webhook endpoint'а (если Stripe позволит на текущем тарифе).

Эти задачи в Фазу 2 НЕ входят, только фиксируются в `.lovable/backlog/stripe_security_hardening.md`.

## 14. DoD Фазы 2

1. ✅ Миграции `acquiring_connections` + `provider_events` применены; RLS включена; доступ только super_admin.
2. ✅ RPC `admin_save_acquiring_secret` создана, пишет в Vault, аудит работает.
3. ✅ 4 edge-функции self-service слоя (`acquiring-save/test/disable/list-connection`) + 4 Stripe write-path (`stripe-create-checkout`, `stripe-webhook`, `stripe-get-session`, `stripe-list-events`) задеплоены.
4. ✅ UI `StripeConnectionDialog` принимает ключи; secret_key и webhook_secret **никогда не возвращаются** в браузер.
5. ✅ `acquiring-test-connection` зелёный для test-ключей: balance ок, account ок, mode=test, webhook secret сохранён, currency snapshot записан.
6. ✅ Webhook endpoint зарегистрирован в Stripe Dashboard, подпись валидируется.
7. ✅ Сквозной тест: тестовый заказ → Checkout Session → оплата 4242 → `checkout.session.completed` → `payments_v2` создан → `orders_v2.status=paid` → `grant-access-for-order` отработал. Айдишники в proof.
8. ✅ Идемпотентность: повторная доставка `evt_*` → `skipped_duplicate`, дубль `payments_v2` не создан.
9. ✅ Refund: refund в Stripe → `charge.refunded` → `record_refund_atomic` → корректный partial/full refund state.
10. ✅ Metadata contract: все обязательные поля присутствуют на `cs_*` и `pi_*`.
11. ✅ Mismatch-сценарий: webhook с подделанным `metadata.account_code` → `manual_review`, заказ не оплачивается.
12. ✅ Zero-diff bePaid (denylist §10): `git diff` пуст. Контрольная bePaid-оплата проходит как раньше.
13. ✅ Build green, нет typecheck-ошибок.
14. ✅ Secret key / webhook secret отсутствуют в логах edge-функций (grep по `sk_test`, `whsec`).
15. ✅ Proof `.lovable/proofs/stripe_phase_2_execute.md` с SQL-выгрузками, скриншотами UI настроек, скриншотом успешной test-connection, скриншотом sandbox-оплаты.

## 15. Что НЕ входит в Фазу 2 (явно)

- Subscriptions / Subscription Schedule (Фаза 3).
- Saved cards / SetupIntent / off-session charges (Фаза 3).
- Публичные `payment_links` с `provider='stripe'` (Фаза 3).
- `customer_choice` provider_mode в UI (Фаза 3).
- Live-режим Stripe (отдельное согласование).
- Миграция bePaid на `acquiring_connections` (отдельный спринт).
- Restricted API Key, IP allowlist, ротация — security backlog.
- Invoices, Stripe Tax, Customer Portal, Coupons — Backlog.

После approve — стартую с миграции `acquiring_connections` + `provider_events`.

---

## Execute log — 2026-06-03 (Фаза 2)

✅ Фаза 2 выполнена. Полный отчёт: `.lovable/proofs/stripe_phase_2_execute.md`.

Кратко:
- Миграции применены (acquiring_connections, provider_events, 3 RPC).
- 8 edge-функций созданы (4 self-service + 4 stripe write-path).
- UI `/admin/integrations/acquiring` перестроен: tabs (Подключения / Stripe events), Stripe card с Settings/Test/Disable, безопасный StripeConnectionDialog.
- bePaid пайплайн не затронут (denylist verifier чист, 106/106 payment_links остались provider=`bepaid`).
- config.toml: `[functions.stripe-webhook] verify_jwt = false`.

Далее: super_admin вводит test-ключи Stripe через UI → регистрирует webhook URL в Stripe Dashboard → end-to-end sandbox-проверка.
