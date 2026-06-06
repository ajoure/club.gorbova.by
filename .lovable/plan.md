# да, согласен, с учетом правок:

1. **CI-guard сделать обязательным, если root cause не доказан**

Если по логам нельзя на 100% доказать транзитность 401, добавить обязательный CI/deploy guard:

```text
stripe-webhook must have verify_jwt=false before deploy is accepted
```

Иначе есть риск повторения после следующего redeploy.

2. **Уточнить provider_events при replay**

Если `provider_events_idem_unique` не позволяет создать новый ряд с тем же `event_id`, это нормально.

Тогда proof должен фиксировать:

```text
existing provider_events row reused / duplicate ignored
```

а не требовать именно «два новых ряда».

3. **D1 runtime confirmation**

Проверять не только `meta.stripe.cancel_at`, но и:

```text
meta.stripe.cancel_at_period_end
```

Ожидание:

- G29: `cancel_at` заполнен, effective cancel=true;
- G30: `cancel_at` cleared/null, effective cancel=false.

4. **Audit naming не привязывать жестко**

Допустить фактические названия audit actions, если они эквивалентны:

```text
stripe.portal.cancel_at_period_end.set
stripe.portal.cancel_at_period_end.enabled
stripe.subscription.updated.synced with source=customer_portal
```

Главное — доказать portal-derived cancel/resume.

5. **Добавить smoke после replay**

После replay G29/G30 выполнить новый POST без подписи:

```text
ожидаем 400 signature_verification_failed, не 401
```

Это подтвердит, что endpoint не вернулся в закрытое состояние.

После этих уточнений план можно запускать.

&nbsp;

План: PATCH D2 — Stripe Webhook 401 After Redeploy

## Контекст

Phase 3.3 = PARTIAL PASS. Бизнес-логика Customer Portal подтверждена (G26–G32). Блокер — D2: после redeploy `stripe-webhook` отдавал HTTP 401, из-за чего runtime-доказательство D1 (фикс `cancel_at` vs `cancel_at_period_end`) неполное.

Предварительная проверка сейчас:

- `OPTIONS /functions/v1/stripe-webhook` → **200**
- `POST` без подписи → **400 `signature_verification_failed**`
- `supabase/config.toml` содержит `[functions.stripe-webhook] verify_jwt = false`

То есть на текущий момент 401 не воспроизводится — endpoint публичный и доходит до проверки подписи. Это означает, что 401 был транзитным состоянием (вероятно, окно между redeploy и применением `verify_jwt=false` платформой) либо вызов шёл через `supabase.functions.invoke` с анонимным JWT по другому пути. План должен это зафиксировать, а затем выполнить runtime-доказательство D1.

## Цели

1. Точно установить причину 401 (root cause), а не просто "уже не воспроизводится".
2. Подтвердить, что контур webhook стабильно принимает события от Stripe.
3. Replay событий G29 (cancel at period end через Portal) и G30 (resume через Portal) против текущего кода с фиксом D1.
4. Подтвердить, что фикс D1 фактически отрабатывает в runtime (delta пишется, `meta.stripe.cancel_at` материализуется, audit-записи Portal появляются).
5. Перевести Phase 3.3 в FULL PASS.

## Этапы (Diagnose → Plan → Dry run → Execute → Verify)

### 1. Diagnose — root cause D2

- Снять `edge_function_logs` для `stripe-webhook` за окно redeploy → искать 401 / `Missing authorization header` / `Invalid JWT`.
- Сверить historical `provider_events` за то же окно: были ли реальные Stripe-доставки, помеченные как failed/неполученные.
- Проверить `supabase/config.toml` в git-истории на предмет того, был ли момент, когда `verify_jwt` отсутствовал/был `true` для `stripe-webhook`.
- Зафиксировать гипотезу: транзитное окно после redeploy vs реальная регрессия конфига.

### 2. Verify контура (без вызова Stripe)

- `OPTIONS` и `POST` без подписи на боевой URL — ожидаем `200` и `400 signature_verification_failed`.
- `POST` с фейковой `stripe-signature` — ожидаем `400 signature_verification_failed` (а не 401).
- Снять `curl -i` и приложить к proof.

### 3. Replay G29 / G30 — runtime D1

Без helper-функций, только канонические пути:

- Stripe Dashboard → Developers → Events → найти исходные события G29 (`customer.subscription.updated` с `cancel_at` set) и G30 (`customer.subscription.updated` с `cancel_at` cleared / `resume`).
- Для каждого нажать **Resend** на наш endpoint `stripe-webhook`.
- Альтернатива (если Resend недоступен): Stripe CLI `stripe events resend evt_***` против того же endpoint.

### 4. Verify D1 в runtime

Для `subscription_v2_id = 465ba5c1-626f-4cd0-986b-2a03a791c5cc`:

- `provider_events`: два новых ряда с теми же `event_id`, статус `processed`, `processing_status` ok.
- `subscriptions_v2.meta.stripe.cancel_at` материализован после G29 и снят/обновлён после G30.
- `audit_logs`: `stripe.portal.cancel_at_period_end.set` (G29) и `.cleared` / `subscription.resumed` (G30) — то, чего не хватало в первичном прогоне.
- `subscriptions_v2.status` и `cancel_reason` соответствуют ожиданиям (active + scheduled cancel → active без cancel).
- Δ=0 по `entitlements`, `access_rules`, `telegram_access`, `bepaid_*` (повторно зафиксировать).

### 5. Зафиксировать результат

- Обновить `.lovable/proofs/stripe_phase_3_3_customer_portal_runtime_v1.md`: добавить раздел "D2 root cause", раздел "D1 runtime confirmation", before/after SQL, event_id, ссылки на provider_events / audit_logs.
- Перевести Phase 3.3 → **FULL PASS** в `.lovable/plan.md`.

## Технические детали

- Никаких новых edge functions. Только диагностика + replay через Stripe Dashboard/CLI.
- Никаких изменений в `_shared/stripe-subscription-resolver.ts` сверх уже задеплоенного фикса D1.
- Никаких прямых UPDATE в `subscriptions_v2` / `entitlements` — только через канонический webhook-путь.
- Если diagnose покажет, что `verify_jwt` действительно отсутствовал для `stripe-webhook` в `config.toml` в момент redeploy, добавить CI-guard: проверка, что для всех `stripe-*` и `*-webhook` функций явно стоит `verify_jwt = false`.

## Definition of Done

- Root cause 401 задокументирован (транзитный либо конфиг — с доказательством из логов/истории).
- `OPTIONS=200`, `POST без подписи=400`, `POST с фейковой подписью=400` зафиксированы в proof.
- G29 и G30 события успешно replayed, `provider_events.processing_status='processed'`.
- `meta.stripe.cancel_at` для тестовой подписки корректно меняется по G29/G30.
- Audit Portal-операций (`stripe.portal.cancel_at_period_end.set` / `.cleared`) присутствует.
- Δ=0 по bePaid, entitlements, access_rules, telegram_access.
- `.lovable/proofs/stripe_phase_3_3_customer_portal_runtime_v1.md` обновлён.
- Phase 3.3 переведена в FULL PASS. Phase 3.4 НЕ стартует до этой галочки.

## Что НЕ делаем

- Не создаём helper edge functions для триггера событий (нарушение PCI-стандарта §10.3).
- Не трогаем `bepaid-*`, `grant-access-for-order`, `telegram-*`.
- Не делаем ручных INSERT/UPDATE в `subscriptions_v2` / `entitlements` / `access_rules`.
- Не переходим к Phase 3.4 до FULL PASS Phase 3.3.