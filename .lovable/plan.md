да, согласен, с учетом правок:

1. В trigger-fix не блокировать все order_id IS NOT NULL. Блокировать только если meta.source IN ('public_link_installment','public_link_subscription') или tracking_id LIKE 'subv2:%:order:%'. Иначе можно задеть легитимные legacy-подписки.
2. Manual grant не должен попадать под антидубль. Условие: если source='manual' / is_manual=true / admin action — разрешить повторную отправку.
3. В telegram-grant-access duplicate guard должен проверять не только telegram_messages, но и telegram_logs/audit с тем же idempotency_key, чтобы не было гонки между двумя параллельными вызовами.
4. В *shared/log-automated-telegram.ts idempotency key лучше писать в meta.idempotency*key, но не делать DB constraint в этом патче.
5. UI-дедуп status='ok' добавить, но failed/skipped оставить видимыми.

Можно выполнять.

&nbsp;

План:

## 1. Проблема

Дубли Telegram-сообщений после оплаты/выдачи доступа не устранены полностью:

- клиент получает два DM «Доступ открыт!»;
- в контакт-центре дополнительно видны системные/служебные карточки типа «Авто-выдача...»;
- по свежему кейсу пользователя `shefska@gmail.com / Валентина Хрущёва` подтверждено два исходящих сообщения:
  - `18:00:00` — `telegram_messages.meta.source_id = order_id`;
  - `18:00:10` — `telegram_messages.meta.source_id = subscription_id`.

## 2. Диагностика

Факты по свежему кейсу:

1. В `telegram_messages` зафиксированы два реальных исходящих Telegram DM:
  - `message_id=17164`, `source_id=3e376279-5ba2-4753-a071-59979d8ef926` — пришло из `grant-access-for-order`;
  - `message_id=17170`, `source_id=085952d5-ef13-41c6-91e3-a49d431b5e7d` — пришло из `telegram_access_queue` через `telegram-process-access-queue`.
2. В `telegram_access_queue` есть строка:
  - `subscription_id=085952d5-ef13-41c6-91e3-a49d431b5e7d`;
  - `status=completed`;
  - создана в момент активации подписки.
3. Текущий trigger `public.trg_subscription_grant_telegram()` уже имеет guard, но он ловит только:
  - `meta.granted_by = 'grant-access-for-order'`;
  - `meta.source = 'grant-access-for-order'`;
  - `meta.initial_order_id`.
4. Для provider-managed public link подписки реальный `subscriptions_v2.meta` другой:
  - `meta.source = 'public_link_subscription'`;
  - `meta.checkout_order_id = order_id`;
  - `meta.tracking_id = subv2:{subscription_id}:order:{order_id}`;
  - `meta.extended_by_orders` содержит order_id после `grant-access-for-order`.

Из-за этого trigger не распознает такую подписку как уже обработанную каноническим order-путём и ставит вторую задачу в `telegram_access_queue`.

5. Дополнительная причина «системных» карточек в UI:
  - `ContactTelegramChat.tsx` скрывает mirror-events только при `status === 'success'`;
  - `telegram-grant-access` пишет `telegram_logs.status = 'ok'`, поэтому даже mirrored `AUTO_GRANT` может отображаться как отдельная системная карточка.
6. Дополнительный обнаруженный дефект наблюдаемости:
  - `telegram-grant-access` формирует ledger key с `Date.now()`;
  - `fulfillment-executor` запрещает timestamp-like значения;
  - в логах есть ошибка ledger write, non-blocking, но это нарушает auditability.

## 3. Предлагаемое решение

### A. Backend: остановить второй реальный DM

Обновить `public.trg_subscription_grant_telegram()` через миграцию.

Новый guard должен считать подписку уже обработанной canonical checkout/order flow, если выполняется хотя бы одно условие:

- текущие старые условия сохраняются;
- `NEW.order_id IS NOT NULL`;
- `NEW.meta ? 'checkout_order_id'`;
- `NEW.meta ? 'tracking_id' AND NEW.meta->>'tracking_id' LIKE 'subv2:%:order:%'`;
- `jsonb_array_length(NEW.meta->'extended_by_orders') > 0`.

Эффект: provider-managed подписка после оплаты не будет ставить вторую queue-задачу, потому что первичная выдача уже прошла через `grant-access-for-order`.

### B. Backend: идемпотентность самого `telegram-grant-access`

Даже если второй вызов всё же придёт из другого legacy-пути, `telegram-grant-access` должен не отправлять второй «Доступ открыт!» по тому же бизнес-событию.

Добавить в `telegram-grant-access` pre-send guard:

- вычислить canonical business id:
  - если `source_id` — это `orders_v2.id`, использовать этот order id;
  - если `source_id` — это `subscriptions_v2.id`, попробовать взять order id из:
    - `subscriptions_v2.order_id`;
    - `meta.checkout_order_id`;
    - `meta.initial_order_id`;
    - `meta.extended_by_orders[0]`;
    - `meta.tracking_id` формата `subv2:{sub}:order:{order}`.
- перед `sendMessage(...)` проверить, нет ли уже `telegram_messages` для `user_id + club_id + event='access_granted_dm'` с тем же canonical order id;
- если есть — не создавать новые invite links и не отправлять DM, а вернуть `skipped_duplicate=true` и записать audit/log без `message_text`.

Важно: это не заменяет trigger-fix, а страхует систему от повторов при retries/legacy queue.

### C. Backend: сделать mirror logging идемпотентным

В `_shared/log-automated-telegram.ts` добавить optional `idempotency_key`/`meta.idempotency_key` support и перед insert проверять existing row по `meta->>'idempotency_key'`.

Для access-granted DM передавать ключ вида:

```text
access_granted_dm:{user_id}:{club_id}:{canonical_order_id_or_source_id}
```

Если запись уже есть — не вставлять второй mirror-row в `telegram_messages`.

### D. UI: убрать лишние системные карточки в контакт-центре

В `src/components/admin/ContactTelegramChat.tsx` поправить `isMirroredEvent`:

- считать успешными не только `status === 'success'`, но и `status === 'ok'`;
- добавить `AUTO_GRANT` и `MANUAL_GRANT` в mirrorable actions;
- если `meta.mirrored_to_telegram_messages === true` или `meta.telegram_message_id` совпадает с исходящим bubble — скрывать event-pill;
- failed/skipped события оставить видимыми для диагностики.

Эффект: реальный bubble остаётся, дублирующая системная карточка «Авто-выдача...» пропадает.

### E. Ledger auditability fix

В `telegram-grant-access` заменить `ledgerSourceEventKey`:

Сейчас:

```text
tg-grant:{user_id}:{club_ids}:{Date.now()}
```

Нужно сделать deterministic:

```text
tg-grant:{source || manual}:{source_id || admin_id || user_id}:{club_ids}
```

Без timestamp-like числа, чтобы `writeLedgerEntry` не падал.

## 4. Изменяемые компоненты

### SQL / DB

- новая миграция для `public.trg_subscription_grant_telegram()`;
- возможно, read-only proof queries по:
  - `telegram_messages`;
  - `telegram_logs`;
  - `telegram_access_queue`;
  - `subscriptions_v2`;
  - `pg_get_functiondef(...)`.

### Edge functions

- `supabase/functions/telegram-grant-access/index.ts`;
- `supabase/functions/_shared/log-automated-telegram.ts`.

### UI

- `src/components/admin/ContactTelegramChat.tsx`.

## 5. Что не будет изменено

- не меняю платежную архитектуру bePaid;
- не меняю `orders_v2`, `subscriptions_v2`, `entitlements` как source of truth;
- не удаляю старые сообщения из Telegram у клиентов;
- не делаю массовый DELETE/UPDATE исторических данных;
- не меняю правила доступа `access_rules`;
- не меняю механику инвайт-ссылок, кроме предотвращения повторной отправки.

## 6. Dry-run

Перед Execute выполнить безопасные проверки:

1. Проверить текущую функцию trigger:

```sql
SELECT pg_get_functiondef('public.trg_subscription_grant_telegram()'::regprocedure);
```

2. Проверить fresh duplicate cohort:

```sql
WITH access_msgs AS (...)
SELECT user_id, canonical_order_id, count(*), array_agg(source_id)
FROM access_msgs
GROUP BY user_id, canonical_order_id
HAVING count(*) > 1;
```

3. Проверить строки queue, созданные для canonical provider-managed подписок:

```sql
SELECT q.*
FROM telegram_access_queue q
JOIN subscriptions_v2 s ON s.id = q.subscription_id
WHERE q.created_at > now() - interval '7 days'
  AND (
    s.order_id IS NOT NULL
    OR s.meta ? 'checkout_order_id'
    OR s.meta->>'tracking_id' LIKE 'subv2:%:order:%'
  );
```

4. Проверить UI-only источник системных карточек — без изменения данных.

## 7. Execute

После approval:

1. Создать миграцию с обновленным `trg_subscription_grant_telegram()`.
2. Обновить `telegram-grant-access`:
  - canonical source resolution;
  - pre-send duplicate guard;
  - deterministic ledger key;
  - audit `telegram.grant.skipped_duplicate_dm` при skip.
3. Обновить `_shared/log-automated-telegram.ts`:
  - idempotency key check;
  - не бросать ошибку при duplicate.
4. Обновить `ContactTelegramChat.tsx`:
  - корректно скрывать mirrored `AUTO_GRANT/MANUAL_GRANT` events со статусом `ok`.
5. Деплой затронутых edge functions.

## 8. STOP-guards

Остановить выполнение и не деплоить, если:

- `subscriptions_v2` не содержит ожидаемых полей `order_id`, `meta`, `status`, `product_id`, `tariff_id`;
- `trg_subscription_grant_telegram()` отличается от прочитанной структуры настолько, что нельзя безопасно внести additive guard;
- duplicate cohort показывает неожиданный источник не из `order/subscription` пары;
- новая проверка может блокировать manual re-issue links без явного `is_manual=true`;
- idempotency guard не может надежно извлечь canonical order id — тогда fallback только на `(user_id, club_id, source_id)`.

## 9. DoD

Задача считается выполненной, если:

1. Для новой оплаты provider-managed public link создаётся только один реальный Telegram DM «Доступ открыт!».
2. `telegram_access_queue` не получает вторую `grant`-задачу для подписки, у которой есть canonical order markers (`order_id`, `checkout_order_id`, `subv2:*:order:*`, `extended_by_orders`).
3. Если legacy queue всё-таки вызовет `telegram-grant-access`, функция вернёт skip и не отправит второй DM.
4. В контакт-центре отображается один bubble с кнопками входа, без лишней системной карточки «Авто-выдача...» рядом с ним.
5. Failed/skipped диагностические events остаются видимыми.
6. `telegram-grant-access` больше не пишет ledger error из-за timestamp-like source_event_key.
7. Proof SQL показывает отсутствие новых дублей после патча.

## 10. Риски и зависимости

- Старые уже отправленные Telegram DM удалить невозможно без отдельной операции удаления сообщений через Telegram API; в рамках этого патча не делаем.
- Если администратор вручную переотправляет доступ (`is_manual=true`), нужно сохранить возможность повторной ручной выдачи; антидубль должен блокировать только автоматические повторные grant-события.
- Если есть legacy direct subscription flow без order id, он должен продолжить работать через queue.

## 11. Требуется дополнительная информация

Дополнительная информация от вас не требуется. Диагностика по свежему кейсу уже подтвердила конкретный источник дублей: canonical order path + legacy subscription queue path.