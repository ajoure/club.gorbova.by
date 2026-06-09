## да, согласен, с учетом правок:

## **1. План правильный**

Диагноз корректный: `stripe_account_not_test_mode` был временным pre-prod guard и теперь блокирует нормальный live-flow. Его нужно удалить в обоих местах.

Ключевой принцип верный:

```text
SOT режима Stripe = acquiring_connections.test_mode
```

Если connection live (`test_mode=false`) и она активна, checkout должен быть разрешён.

---

## **2. Важная правка: это не Phase L-3, а PATCH перед L-4**

Proof лучше назвать не `phase_L3...`, чтобы не путать с L-3 subscriptions UI.

Заменить:

```text
.lovable/proofs/phase_L3_unblock_live_stripe_guard_v1.md
```

на:

```text
.lovable/proofs/live_stripe_unblock_live_guard_v1.md
```

И статус:

```text
PATCH-LIVE-1 — unblock live Stripe guard
```

---

## **3. Добавить проверку, что удаляется только guard, а не test-mode telemetry**

В proof обязательно показать, что удалён только запрет:

```text
if (!acct.test_mode) return stripe_account_not_test_mode
```

Но сохранены:

- `meta.test_mode`;
- `account_code`;
- `livemode` handling в webhook;
- telemetry/debug fields.

То есть мы не стираем различие test/live, а только разрешаем live checkout.

---

## **4. Subscription checkout тоже обязательно исправить**

План правильно включает:

```text
stripe-create-subscription-checkout/index.ts
```

Это важно, иначе one-time live заработает, а live subscription снова упадёт.

Добавить в DoD:

```text
Live subscription checkout no longer fails with stripe_account_not_test_mode
```

---

## **5. Saved cards — правильно вынести отдельно**

Да, saved card compatibility не блокирует L-4.

Но в backlog формулировка должна быть конкретной:

```text
PATCH Saved Cards / Stripe Live:
- определить источник saved card на /pay/:token;
- если card_profile_links/bePaid token — не показывать как доступную для Stripe;
- если Stripe payment_method — разрешить оплату и SCA/3DS;
- добавить provider badge у сохранённой карты;
- не смешивать bePaid token и Stripe payment_method.
```

---

## **6. После unblock не использовать старую BYN-ссылку как единственный тест**

Текущая ссылка уже создана и может иметь старый state. После деплоя лучше:

1. проверить, что старая ссылка больше не показывает `stripe_account_not_test_mode`;
2. но для L-4 PASS создать **новую live Stripe one-time ссылку** через актуальный flow.

Так proof будет чистым.

---

## **7. Итоговый ответ Lovable**

```md
План принят с правками.

Approve на build.

Что делаем:

1. Удалить pre-prod guard `stripe_account_not_test_mode` в двух местах:
   - `supabase/functions/_shared/create-stripe-checkout.ts`;
   - `supabase/functions/stripe-create-subscription-checkout/index.ts`.

2. Не добавлять env-флаги.
   SOT режима — `acquiring_connections.test_mode`.

3. Не трогать:
   - `stripe-webhook`;
   - bePaid;
   - card_profile_links;
   - saved-card flow;
   - tariff_offers;
   - secrets/Vault;
   - webhook endpoint.

4. Сохранить telemetry:
   - `meta.test_mode`;
   - `account_code`;
   - live/test routing;
   - webhook livemode logging.

5. Proof назвать:

```text
.lovable/proofs/live_stripe_unblock_live_guard_v1.md
```

6. Backlog saved cards обновить:

```text
.lovable/backlog/stripe_saved_pm_followup.md
```

7. После deploy:
  - проверить, что ошибка `stripe_account_not_test_mode` исчезла;
  - создать новую live Stripe one-time ссылку;
  - пользователь оплачивает реальной картой;
  - выполнить SQL verify;
  - закрыть L-2 + L-4.
8. Для L-4 разрешены валюты:

```text
BYN / EUR / PLN / USD
```

Не блокировать BYN на уровне приложения.

9. L-4 PASS только после реального live payment:
  - `provider_events.livemode=true`;
  - `signature_valid=true`;
  - `processing_status='processed'`;
  - `payments_v2.provider='stripe'`;
  - `receipt_url` заполнен;
  - order/contact/profile связаны;
  - entitlement создан один раз;
  - платеж виден в `/admin/payments`;
  - bePaid untouched.

Начинай build.

```
## 8. Контроль следующего отчёта

Не принимать L-4 PASS только по факту удаления guard. Нужно:

- реальная оплата;
- live webhook;
- запись в `payments_v2`;
- receipt;
- доступ;
- отображение в админке.

План: Unblock Live Stripe Guard (L-4 prerequisite)
```

### Diagnose

`rg "stripe_account_not_test_mode"` нашёл guard ровно в двух местах:

1. `supabase/functions/_shared/create-stripe-checkout.ts` — строки 105–119 (one-time checkout через `public-checkout`/`create-payment-checkout` → adapter).
2. `supabase/functions/stripe-create-subscription-checkout/index.ts` — строки 108–112 (admin/super_admin subscription checkout).

Оба guard-а написаны как «pre-prod ограничитель» в момент, когда живых ключей в системе не было:

```ts
if (!acct.test_mode) {
  return { error: 'stripe_account_not_test_mode', ... };
}
```

SOT режима — сама запись в `acquiring_connections` (`provider='stripe'`, `account_code='stripe_poland'`, `status='active'`, `test_mode=false`). После Phase L-1 в проде записана **live** connection, поэтому guard теперь блокирует именно тот flow, ради которого включали live.

`resolveDefaultStripeAccount` возвращает `test_mode` как есть (не зависит от guard). Значение продолжит писаться в `meta` (`create-stripe-checkout.ts:157`, `stripe-create-subscription-checkout/index.ts:202`) — телеметрия не теряется. Никаких других мест, где `test_mode` влияет на бизнес-решение, нет: `stripe-webhook` читает `account_code, status, test_mode` только для логирования/маршрутизации.

### Принцип исправления

Connection — источник истины. Если admin сохранил live connection через UI интеграций (`/admin/integrations/payments`) и поставил её `is_default=true`, то checkout через эту connection разрешён. Если сохранена sandbox connection — checkout идёт в sandbox. Никакого env-флага не нужно: `acquiring_connections.test_mode` уже корректно отделяет два мира.

### Изменения кода (только два места, add-only логика на стороне webhook не трогается)

**1) `supabase/functions/_shared/create-stripe-checkout.ts**` — удалить блок строк 112–119 (guard `if (!acct.test_mode) { ... }`). Комментарий 105 переписать: «Resolve Stripe account (SOT = acquiring_connections; test_mode/live определяется самой connection)». Поле `meta.test_mode = acct.test_mode` (строка 157) остаётся как есть.

**2) `supabase/functions/stripe-create-subscription-checkout/index.ts**` — удалить блок строк 110–112. Комментарий 108 переписать в том же духе. `meta.test_mode` на строке 202 остаётся.

bePaid, `stripe-webhook`, `public-checkout` (resolver), `CustomerProviderChoice`, `card_profile_links`, `tariff_offers.meta.acquiring` — **не трогаем**. Никаких миграций, никаких массовых UPDATE по офферам, никаких изменений секретов.

### Saved cards — вне scope L-4

Карта VISA на `/pay/:token` — отдельный вопрос совместимости (Stripe payment method vs `card_profile_links`/bePaid token). Под этот патч НЕ попадает. Если новая карта проходит live Stripe — L-4 закрывается как PASS. Saved-card compatibility выносится отдельным PATCH в `.lovable/backlog/stripe_saved_pm_followup.md` (файл уже существует) — туда добавлю строку про проверку фильтрации saved cards в UI оплаты.

### Verify (после деплоя двух функций)

1. Открыть существующую ссылку `/pay/:token` (или создать новую — см. ниже). Ошибки `stripe_account_not_test_mode` быть не должно. Кнопка оплаты активна.
2. Если ошибка ещё видна — проверить `supabase--edge_function_logs` для `public-checkout` и `stripe-create-subscription-checkout`.

### Создание live one-time ссылки для теста (после unblock)

Через существующий канон — `admin-create-public-link` с admin override:

```
contact: Федорчук Сергей (7500084@gmail.com)
provider: stripe
account_code: stripe_poland
payment_type: one_time
currency: BYN | EUR | PLN  ← решает админ; default-кандидат EUR 1.00 как минимальная безопасная
amount: minimal
offer: безопасный one-time (вебинар со скрина — если у него есть pay_now offer с stripe в allowed_payment_providers; иначе подобрать другой)
```

Ссылка отдаётся пользователю → оплата **новой** картой (saved card может быть несовместима, это отдельный PATCH).

### SQL verify после реальной оплаты

```sql
-- 1) Webhook принял live event
SELECT event_id, provider, account_code, event_type, livemode, signature_valid,
       processing_status, related_payment_id, processing_error, created_at
FROM provider_events
WHERE provider='stripe'
ORDER BY created_at DESC LIMIT 20;

-- 2) Платёж записан
SELECT id, provider, provider_payment_id, order_id, amount, currency, status,
       receipt_url, meta->'stripe' AS stripe_meta, created_at
FROM payments_v2 WHERE provider='stripe' ORDER BY created_at DESC LIMIT 10;

-- 3) Order + grant
SELECT id, status, contact_id, profile_id, product_id, tariff_id,
       final_price, currency, paid_at, meta
FROM orders_v2 ORDER BY created_at DESC LIMIT 10;

SELECT * FROM entitlements ORDER BY created_at DESC LIMIT 10;
```

### DoD / PASS criteria

**Guard-патч PASS:**

- guard `stripe_account_not_test_mode` удалён в обоих файлах;
- live `/pay/:token` не падает с этой ошибкой;
- sandbox flow (если когда-нибудь снова появится test connection) продолжает работать — мы ничего не запретили, только сняли запрет;
- bePaid не затронут (diff = 0 в bePaid-функциях и таблицах);
- proof: `.lovable/proofs/phase_L3_unblock_live_stripe_guard_v1.md` с diff-выдержкой, SQL-снимком `acquiring_connections` и логом запуска live-чекаута.

**L-4 PASS (после реального платежа):**

- `provider_events.livemode=true`, `signature_valid=true`, `processing_status='processed'`;
- `payments_v2.provider='stripe'`, `status='paid'`, `receipt_url` заполнен;
- order/contact/profile связаны, `entitlement` создан один раз;
- платёж виден в `/admin/payments`;
- bePaid untouched; no дублей в provider_events/orders/payments/access.

### Что НЕ делаем

- env-флаги `STRIPE_LIVE_MODE`/`production_only` — не вводим (SOT = connection).
- Не трогаем `stripe-webhook` (он уже не зависит от guard-а).
- Не делаем массовых UPDATE по `tariff_offers.meta.acquiring`.
- Не меняем bePaid, `card_profile_links`, saved-card flow (отдельный PATCH).
- Никаких `secrets--add_secret`, ручных правок Vault, новых webhook endpoint-ов.
- Не требуем `test_mode=true` для live.
- Не блокируем BYN на уровне приложения — валюту выбирает админ при создании ссылки.

### Файлы

- edit: `supabase/functions/_shared/create-stripe-checkout.ts` (удалить guard, переписать комментарий).
- edit: `supabase/functions/stripe-create-subscription-checkout/index.ts` (удалить guard, переписать комментарий).
- create: `.lovable/proofs/phase_L3_unblock_live_stripe_guard_v1.md` (diff + SQL snapshot + verify-лог).
- edit: `.lovable/backlog/stripe_saved_pm_followup.md` (добавить пункт «фильтрация saved cards на /pay/:token при выборе Stripe live»).

Approve — и переходим в build.