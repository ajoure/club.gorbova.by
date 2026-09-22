# Отчет о выполнении: PLAN-ONLY / READ-ONLY диагностика инцидента оплаты 22.09.2026

Источник истины: origin/main SHA `6f151ffbb3b05a9a9f4a3cce7c2812f5ce7314ea` (локальный HEAD совпадает).
Никаких изменений кода, БД, deploy, Publish, checkout или сообщений не выполнялось.

## 1. Что подтверждено (confirmed)

- RPC присутствуют с точными сигнатурами:
  - `crm_claim_pending_purchase(p_order jsonb, p_context jsonb, p_provider text, p_account_code text, p_attempt_kind text)`
  - `crm_finish_checkout_attempt(p_attempt_id uuid, p_state text, p_result jsonb)`
  - `crm_reserve_checkout_discounts(p_order jsonb, p_context jsonb, p_credit bigint, p_bonus bigint, p_cycles integer)`
- Миграции `20260913112356` и `20260913124348` есть в репозитории, но в ledger `supabase_migrations.schema_migrations` их версий НЕТ (ближайшие записи: `20260913091746`, `20260913154030`). При этом объекты миграций (RPC, `crm_checkout_attempts`, `crm_checkout_discount_intents`) в production существуют и рабочие. Вывод: функционально применены, ledger-запись отсутствует (расхождение учёта, не причина инцидента).
- Конфигурация тарифа BUSINESS корректна: активный оффер `pay_now` 250.00 BYN, `payment_method=full_payment`, провайдер bePaid (`bepaid_33524`), продукт Gorbova Club.
- Попытки checkout за последние 2 часа: **3**, все со статусом `ready` (успешные): 10:00:13, 10:00:14 и 11:24:06 UTC. Ни одной записи со `state='failed'`/`unknown`.
- За последние 3 часа по BUSINESS 250 BYN у провайдера есть **один успешный платёж**: оплата 250.00 BYN, `succeeded`, 11:27:05 UTC (14:27 Минск), по заказу `SUB-LINK-...` (созданному через административную публичную ссылку в 11:24:06 UTC). Ранее в этот день — ещё один успешный BUSINESS 250 BYN в 09:24 UTC.
- Повторной/двойной оплаты нет. Новых пользователей, профилей и «висящих» заказов за период не создано.

## 2. Точная стадия сбоя

Ошибка произошла **до** `crm_claim_pending_purchase`: эта RPC при вызове создаёт строку в `crm_checkout_attempts`, а в окне инцидента такой строки нет. Значит:

- link resolve — не применим (публичная страница, не ссылка);
- referral discount / `crm_reserve_checkout_discounts` — не задействован (intent-записей за 6 часов нет);
- `crm_claim_pending_purchase` — не достигнут (нет attempt-строки);
- `crm_finish_checkout_attempt` — не достигнут;
- audit — записей `bepaid.subscription.create_blocked` и `public_checkout.*` в окне сбоя нет.

Сбой лежит в ранней части `bepaid-create-subscription-checkout` (клубный BUSINESS идёт по provider-managed подписочному пути) либо на уровне runtime-обёртки функции: буквальный текст «Internal server error» не генерируется ни одной из проверенных функций явно — они возвращают конкретные коды (`BEPAID_CREDS_MISSING`, `INVALID_OFFER`, `EMAIL_COLLISION`, `alumni_eligibility_required`) или `{error: e.message}`. Это характерно для необработанного/boot-уровня отказа edge-runtime.

## 3. Ограничение доказательной базы (UNKNOWN)

Точный exception/error_code **UNKNOWN**. Причина: в аналитическом хранилище доступны логи только с 11:27 UTC (окно ~10 минут); по `public-checkout`, `bepaid-create-token`, `bepaid-create-subscription-checkout` логов за окно инцидента не сохранилось. Runtime-строка ошибки восстановлению по текущим данным не подлежит.

Временная привязка: ближайшее согласованное окно — 11:20–11:22 UTC, сразу после чего оператор в 11:22:12 UTC создал публичную платёжную ссылку (обходной путь), оплаченную в 11:27:05 UTC. Если исходить строго из 13:22 по Минску (10:22 UTC), в этом окне нет вообще никакой активности checkout — что также согласуется с падением до создания attempt.

## 4. Влияние

- Затронутых неуспешных попыток, зафиксированных в БД: **0** (сбой не доходит до журналирования).
- Потерянных денег нет: у провайдера по этому кейсу checkout/платёж возник только по обходной ссылке, он один и успешный.
- Клиент оплатил через ссылку; повторное списание отсутствует.

## 5. Безопасный план исправления (к исполнению не запускается)

1. Наблюдаемость (обязательный шаг 1, без него причина остаётся UNKNOWN):
   - в `bepaid-create-subscription-checkout` и `bepaid-create-token` добавить ранний структурированный лог входа (без PII: только product_id/tariff_code/offer_id/flow) и в финальном `catch` возвращать стабильный `error_code` вместо голого `e.message`;
   - записывать неуспешную попытку в `crm_checkout_attempts` (state `failed`/`unknown`) до выхода по 4xx/5xx, чтобы инциденты становились измеримыми;
   - завести persist-журнал клиентских ошибок checkout (страница + error_code, без PII).
   - Файлы патча: `supabase/functions/bepaid-create-subscription-checkout/index.ts`, `supabase/functions/bepaid-create-token/index.ts`, общий `supabase/functions/_shared/pending-purchase.ts`.
2. UX-защита: на публичной странице не показывать сырой текст провайдера/runtime; выводить понятное сообщение и код обращения.
3. Ledger-гигиена (отдельная задача, не инцидент): выровнять записи `20260913112356` и `20260913124348` в `schema_migrations` после подтверждения байтового соответствия применённых объектов.
4. Миграции БД для устранения инцидента **не требуются**; требуется только deploy изменённых функций после ревизии.
5. Проверки после патча: OPTIONS 200, неавторизованный POST 401, заведомо неверный offer → стабильный `error_code`, отсутствие новых commercial-строк (orders/payments/subscriptions delta = 0), повтор вызова идемпотентен.

## 6. Возник ли у провайдера checkout/платёж

Да, ровно один — и он относится к обходной административной ссылке: 250.00 BYN, `succeeded`, 11:27:05 UTC. По самой упавшей попытке с публичной страницы у провайдера checkout не создавался. Персональные данные, URL и токены не выводились.
