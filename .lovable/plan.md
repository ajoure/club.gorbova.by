да, согласен, с учетом правок:

1. **Не удалять subscriptions_v2.payment_token в этом спринте**  
Этап 4 заменить на deferred/backlog:
2. **Helper getSubscriptionToken**  
Добавить порядок источников:  
1. payment_methods.provider_token по payment_method_id
3. 2. subscription_payment_credentials.provider_token
4. 3. legacy subscriptions_v2.payment_token — read-only fallback  
В payment_token больше не писать, только читать как fallback.
5. **Ghost-токены**  
Не делать auto-link без dry-run.  
Добавить:  
Сначала dry-run список 8 ghost-токенов:
6. - subscription_id
7. - user_id
8. - last4/brand
9. - candidate payment_method_id
10. - confidence  
Execute linking — только если confidence высокий.
11. **bePaid-webhook**  
Разделить на два шага:  
A. убрать новые записи в subscriptions_v2.payment_token
12. B. оставить чтение legacy fallback через helper  
Не трогать fulfillment-path в этом же патче.
13. **subscription_payment_credentials**  
Зафиксировать как временный legacy fallback, а не новый основной SOT.  
Основной SOT:
14. **DoD пункт 8 исправить**  
Было:  
Колонка subscriptions_v2.payment_token удалена  
Заменить на:
15. **Мониторинг 7 дней**  
Добавить explicit gate:
16. **Рассрочка**  
Подтверждаю решение:

остаёмся на существующей архитектуре scheduler + installment_payments

bePaid Subscriptions API / billing_cycles не внедряем в этом спринте

После этих правок план можно выполнять с Этапа 1.

&nbsp;

План: Рассрочка (direct-charge) по ID-First + ликвидация места №1 (`subscriptions_v2.payment_token`)

## Ответ на вопрос: можно ли удалить место №1 сразу?

**Нет, не сразу — но в этом же спринте.** Аудит показал:

- **93 подписки** с заполненным `payment_token`, **21 из них активные**, в том числе `provider_managed` с `next_charge_at` от 28.04.2026 до 16.06.2026 — это живые рекурренты Gorbova Club, которые сейчас списываются.
- **8 ghost-токенов** (`token` есть, `payment_method_id` нет) — пользователь не видит карту, но мы можем списать. Это уже зафиксированный риск (миграция `20260116121925`).
- **1 активный MIT** без `payment_method_id` (`9d2eef10…`) — отдельный кейс, ниже.
- Уже существует целевая таблица `**subscription_payment_credentials**` (91 запись, service-role-only) — её создали миграцией `20260206062225`, но миграцию **не доделали**: код продолжает писать и читать из `subscriptions_v2.payment_token`.

«Живые обращения» к месту №1 (production-функции, не тесты):

```
bepaid-webhook                           — пишет (5 мест)
subscription-charge                      — читает (списание подписок)
subscription-actions                     — пишет (привязка карты)
subscription-admin-actions               — пишет/чистит (админ)
direct-charge                            — пишет (4 места)
admin-manual-charge                      — пишет/читает (ручное списание)
payment-method-verify-recurring          — пишет
payments-autolink-by-card                — читает (.eq('payment_token', …))
bepaid-subscription-audit + audit-cron   — читает (мониторинг ghost-токенов)
subscription-renewal-reminders           — читает
preregistration-charge-cron              — читает (но через meta, не колонку)
installment-charge-cron                  — читает
```

Итого 12 production-функций. Поэтому удаление колонки = отдельный финальный шаг, после миграции всех writers/readers на `payment_methods.provider_token` (+ `subscription_payment_credentials` как зашифрованный SOT для legacy).

---

## Архитектурное решение

```text
SOT для токена карты:
   payment_methods.provider_token   ← единственный источник истины
        │
        └── связь с подпиской: subscriptions_v2.payment_method_id (UUID)

LEGACY (помечено DEPRECATED, удаляется в финале):
   subscriptions_v2.payment_token   ← колонка-дубль, удалить
   subscription_payment_credentials ← остаётся для исторических MIT-подписок
                                     без payment_method_id (read-only fallback)
```

Все списания (cron + ручные + рассрочка) читают токен **только** через helper:
`getSubscriptionToken(subscriptionId)` → читает `payment_methods.provider_token` по `payment_method_id`. Если `payment_method_id IS NULL` → fallback на `subscription_payment_credentials` (только для исторических). Если и там нет → **жёсткая ошибка**, никогда не из `subscriptions_v2.payment_token`.

---

## Этапы (объединённый спринт)

### Этап 1 — Подготовка SOT для токена (1 миграция данных + 1 helper)

1.1. Миграция данных (insert-tool, не schema):

- Для всех `subscriptions_v2` с `payment_method_id IS NOT NULL` и `payment_token IS NOT NULL` — сверить, что `payment_methods.provider_token` совпадает; если расходятся — записать аудит-лог `token_mismatch_detected` и оставить `payment_methods` как истину.
- Для **8 ghost-токенов** (`payment_method_id IS NULL`) — попытаться авто-связать через `payments-autolink-by-card` логику (по `provider_token`); те, что не привязались, — пометить в audit `ghost_token_unresolved` и оставить как есть (read-only fallback через `subscription_payment_credentials`).
- Для активного MIT `9d2eef10…` (без PM) — отдельный аудит-кейс, требует ручной проверки (вынесу в отчёт).

1.2. Создать `supabase/functions/_shared/getSubscriptionToken.ts`:

- Вход: `subscriptionId`.
- Логика: `payment_method_id` → `payment_methods.provider_token`. Fallback: `subscription_payment_credentials.payment_token`. Никогда: `subscriptions_v2.payment_token`.
- Возврат: `{ token, source: 'payment_methods' | 'legacy_credentials' }`.

### Этап 2 — Рассрочка по ID-First (основной плановый блок)

2.1. **Конфигурация — только `tariff_offers**`:

- Создать `supabase/functions/_shared/getInstallmentConfig.ts`: вход `offer_id` (UUID), читает `tariff_offers.meta.installment` или выделенные поля (`installment_count`, `installment_period_days`, `installment_amount`).
- Запретить любые fallback на `payment_plans`, slug, name. Работа исключительно по `product_id` / `tariff_id` / `offer_id`.

2.2. `**bepaid-webhook` — старт рассрочки на первой успешной оплате**:

- Идемпотентность: `meta.installment_started === true` → выход.
- Создать `subscriptions_v2` (`billing_type='mit'`, `meta.payment_flow='installment'`, привязка к `payment_method_id`, **не пишем `payment_token**`).
- Снимок плана в `payment_plans` (нормализованная конфигурация, ссылка на `offer_id`).
- Полное расписание в `installment_payments` (N-1 строк после первой оплаты, `payment_number` 2..N, `due_date` = `now + period_days * (k-1)`).
- Audit: `installment_started` (с `subscription_id`, `offer_id`, `total_payments`, `period_days`).

2.3. `**installment-charge-cron` — Overcharge Guard + ID-First + token via helper**:

- Перед списанием: `SELECT count(*) FROM installment_payments WHERE subscription_id=$1 AND status='paid'` → если ≥ `total_payments`, **не списывать**, audit `installment_overcharge_prevented`, статус подписки → `completed`.
- Токен: только через `getSubscriptionToken` (этап 1.2).
- Идемпотентный ключ для bePaid: `installment_${installment_id}_attempt_${charge_attempts+1}` (включая номер попытки → ретраи безопасны).
- При успехе: `installment_payments.status='paid'`, `paid_at=now()`, и **обязательно** вызвать `grant-access-for-order` (он уже идемпотентен — стандарт «Grant Access Idempotency»).
- При финальном успехе (paid_count == total_payments): `subscriptions_v2.status='completed'`, audit `installment_completed`.

2.4. **Аудит (8 событий)** через стандартный `emit → recordExecution → writeAudit`:
   `installment_started`, `installment_payment_received`, `installment_payment_failed`, `installment_payment_retry_scheduled`, `installment_overcharge_prevented`, `installment_completed`, `installment_canceled_early`, `installment_token_missing`.

2.5. **Webhook idempotency**: использовать существующий `webhook_events`-механизм (если есть) или хеш `tracking_id + status` как уникальный ключ.

2.6. **Cron**: зашедулить `installment-charge-cron` через `pg_cron` каждые 30 минут (insert-tool, не миграция, т.к. содержит anon key).

### Этап 3 — Миграция всех writers с `subscriptions_v2.payment_token`

Для каждой функции из списка ниже: убрать запись в `payment_token`, оставить только `payment_method_id`. Чтения заменить на `getSubscriptionToken`.

Порядок (от безопасного к критичному):

1. `test-installment-flow`, `test-payment-complete`, `test-full-trial-flow` — тесты, без риска.
2. `subscription-actions`, `subscription-admin-actions` — UI-привязка карты.
3. `payment-method-verify-recurring`.
4. `direct-charge` (4 места записи).
5. `admin-manual-charge`.
6. `bepaid-webhook` (5 мест записи) — **самое сложное**, делается отдельным коммитом, с тщательной проверкой recurrent-flow.
7. Readers: `subscription-charge`, `subscription-renewal-reminders`, `payments-autolink-by-card`, `installment-charge-cron`, `bepaid-subscription-audit*` — переключить на helper / на `payment_methods`.

После каждого пункта — `grep -n "payment_token" supabase/functions/<name>` должен вернуть 0 совпадений с `subscriptions_v2.payment_token`.

### Этап 4 — Финал: удаление колонки `subscriptions_v2.payment_token`

Только когда:

- `rg "subscriptions_v2.*payment_token|payment_token.*subscriptions_v2"` по всему `supabase/functions/` возвращает **0 живых обращений** (тесты допустимы, если они тоже мигрированы).
- Все 21 активных подписки прошли минимум одно успешное списание через `getSubscriptionToken` без обращения к колонке (проверим по логам).

Тогда миграция (schema):

```sql
-- 1. Обновить subscriptions_v2_safe view (убрать упоминание)
-- 2. DROP FUNCTION subscription_has_payment_token переписать на чтение из payment_methods
-- 3. ALTER TABLE subscriptions_v2 DROP COLUMN payment_token;
```

И обновить `bepaid-subscription-audit` — переключить «ghost token»-детектор на `subscription_payment_credentials` (legacy fallback).

---

## DoD

1. Конфигурация рассрочки читается **только** из `tariff_offers` по `offer_id` (UUID).
2. Никаких string-match по slug/name/code — только UUID (`product_id`, `tariff_id`, `offer_id`).
3. Токен карты для всех списаний берётся **только** через `getSubscriptionToken` helper.
4. `bepaid-webhook` создаёт полное расписание `installment_payments` на первой успешной оплате; повторный webhook не дублирует (idempotency).
5. `installment-charge-cron`: Overcharge Guard активен; идемпотентный ключ `installment_${id}_attempt_${N}`; `grant-access-for-order` вызывается на каждой успешной оплате и остаётся идемпотентным (без выдачи лишних дней).
6. 8 аудит-событий пишутся системно через стандартный lifecycle.
7. Количество циклов контролируется нашим scheduler (`total_payments`), bePaid в этой архитектуре — просто платёжный шлюз для каждого списания.
8. **Колонка `subscriptions_v2.payment_token` удалена** (этап 4); `subscription_payment_credentials` остаётся для read-only legacy fallback.
9. После этапа 3: `rg "subscriptions_v2.payment_token"` по `supabase/functions/` (без тестов) = 0 совпадений.
10. Все 21 активная рекуррентная подписка продолжают списываться без сбоев (мониторинг 7 дней после этапа 3, до этапа 4).

---

## Риски и обработка

- **Ghost-токены (8 шт)**: до миграции попытаемся auto-link, неудачников — задокументируем; после миграции они продолжат жить через `subscription_payment_credentials` (read-only fallback в helper).
- **Активный MIT `9d2eef10…` без PM**: отдельный кейс, до этапа 4 ручная проверка — либо привязать `payment_method_id`, либо мигрировать в `subscription_payment_credentials`.
- **bePaid-webhook (5 мест записи в `payment_token`)**: самый рискованный модуль. Менять отдельным коммитом, после прохождения всех остальных функций; держать колонку как «теневую запись» ещё 1 спринт перед DROP.
- **Race condition на canceled**: использовать pull-state с bePaid API для определения причины (как договорились ранее), не webhook-order.

---

## Что НЕ делаем

- Не мигрируем на bePaid Subscriptions API (`billing_cycles`) — остаёмся на собственном scheduler (решено).
- Не трогаем `payment_plans` как отдельную сущность — она остаётся snapshot’ом, но **не источником конфигурации** (источник — `tariff_offers`).
- Не удаляем `subscription_payment_credentials` — она нужна для legacy-подписок без `payment_method_id`.

---

После одобрения переключаюсь в build mode и начинаю с Этапа 1 (helper + миграция данных по ghost-токенам).