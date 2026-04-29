да, согласен, с учетом правок:

1. subscription-charge не должен напрямую вызывать telegram-grant-access, если после списания уже вызывается или может вызываться grant-access-for-order. Проверить это до патча. Цель — не создать третий путь.
2. Если subscription-charge сейчас действительно сам продлевает доступ без grant-access-for-order, тогда правильнее сначала перевести его на grant-access-for-order, а не напрямую на Telegram.
3. Для telegram_access_queue оставить только явные ручные/repair источники:
  - reinvite
  - manual_bulk
  - repair
  - admin_backfill
4. Любой queue item без meta.source или с auto-source → skipped, без отправки DM.
5. В DoD добавить:

SELECT count(*)

FROM telegram_access_queue q

JOIN subscriptions_v2 s ON [s.id](http://s.id) = q.subscription_id

WHERE q.created_at > now() - interval '10 minutes'

  AND q.action='grant'

  AND q.status IN ('pending','processing','completed')

  AND (q.meta->>'source' IS NULL OR q.meta->>'source' NOT IN ('reinvite','manual_bulk','repair','admin_backfill'));

Ожидание: 0.

Можно выполнять.

&nbsp;

## Цель

В системе должен остаться **один canonical путь автоматической выдачи Telegram-доступа** — только `grant-access-for-order` после успешного заказа/платежа. Legacy-путь `subscriptions_v2 → trg_subscription_grant_telegram → telegram_access_queue → telegram-process-access-queue → telegram-grant-access` отключается для всех платёжных сценариев.

Дублирующие DM «Доступ открыт!» исчезнут на уровне источника, а не за счёт всё новых пост-фильтров.

## Текущая картина (read-only аудит)

```text
                 ┌─────────────────────────────┐
ПЛАТЁЖ ──┬──►   │ grant-access-for-order      │ ── canonical
         │      │ → telegram-grant-access     │
         │      │ → telegram_messages mirror  │
         │      └─────────────────────────────┘
         │
         └──►   trg_subscription_grant_telegram         ◄── ЛЕГАСИ, отключаем
                  → telegram_access_queue (cron 1/min)
                  → telegram-process-access-queue
                  → telegram-grant-access (СНОВА)       ◄── второй DM
```

Подтверждено в БД:

- триггер `subscription_grant_telegram` на `subscriptions_v2` enabled (`O`), AFTER INSERT OR UPDATE
- cron job `telegram-access-queue-processor` каждую минуту вызывает `telegram-process-access-queue`
- за 14 дней через очередь прошло 99 grant-задач (97 completed + 2 failed) — все они дубли canonical-пути
- наблюдаемый дубликат: sub `085952d5…`, source=`public_link_subscription`, tracking=`subv2:…:order:…` — текущие guards в функции триггера НЕ сработали, потому что триггер AFTER INSERT срабатывает раньше, чем `grant-access-for-order` дописывает `tracking_id` UPDATE-ом

Прочие источники записи в `telegram_access_queue`:

- `subscription-charge` (charge при продлении, юзер не в клубе) — НЕ ходит через `grant-access-for-order`, должен быть переведён на canonical путь (см. шаг 4)
- `telegram-club-members` (reinvite-ghosts) — ручной админский reinvite, оставляем
- legacy RPC `bulk_grant_telegram_access` и backfill-миграции — только по явному вызову админом, оставляем

## Что делаем

### Шаг 1. Отключить триггер `subscription_grant_telegram` (DB migration)

`ALTER TABLE public.subscriptions_v2 DISABLE TRIGGER subscription_grant_telegram;`

Функцию `trg_subscription_grant_telegram()` оставляем в БД (для отката одной строкой), но тело перепишем в безусловный no-op с `RAISE NOTICE` и `RETURN NEW`. Любая попытка повторно ENABLE триггера ничего не сделает — пока кто-то осознанно не восстановит логику из git-истории.

`COMMENT ON FUNCTION public.trg_subscription_grant_telegram()` — описать, что путь намеренно выведен из автозапуска, canonical writer = `grant-access-for-order`.

### Шаг 2. `telegram-process-access-queue` — режим manual-only

Edge function продолжает работать (нужна для ручных reinvite-задач), но добавляем guard на источник:

- Если запись в очереди НЕ помечена как `meta.source IN ('manual_admin', 'reinvite', 'bulk_grant', 'repair')` — обрабатывать её **НЕ** будем: переводим в status=`skipped` с `last_error='legacy_auto_grant_disabled'` и пишем в `audit_logs` (action=`telegram.legacy_queue_skip`, meta содержит `subscription_id`, `user_id`, `club_id`).
- Это страхует от случайных будущих INSERT-ов, не помеченных как ручные.

### Шаг 3. Cron `telegram-access-queue-processor` оставляем

Cron нужен для обслуживания ручных задач (reinvite, bulk, repair). Просто его «корм» теперь почти всегда пустой.

### Шаг 4. Перевести `subscription-charge` (продление) на canonical путь

В `subscription-charge/index.ts` вокруг строки 1858 — INSERT в `telegram_access_queue` для случая «продление подписки + юзер не в клубе» — заменить на прямой вызов `telegram-grant-access` (как делает `grant-access-for-order`), с `source='subscription_renewal'`, `source_id=charge_order_id`, `clubs=[clubId]`. Pre-send guard в `telegram-grant-access` (уже задеплоен) исключит дубликаты.

Это убирает последний автоматический канал «оплата → queue».

### Шаг 5. Помечать ручные источники

В `telegram-club-members` (reinvite-ghosts) и в любом другом ручном INSERT в queue — добавить `meta.source = 'reinvite'` / `'manual_admin'` / `'bulk_grant'` / `'repair'`, чтобы guard из шага 2 их пропускал.

### Шаг 6. UI — `AdminTelegramDiagnostics`

В секцию `TelegramAuditSection` добавить отображение нового события `telegram.legacy_queue_skip`, чтобы видеть «случайных гостей» в queue, если что-то всё-таки попадёт туда автоматически.

### Шаг 7. Memory + DoD

Сохранить новый стандарт памятью `mem://architecture/telegram/canonical-grant-write-path` (Core-rule: «Auto-grant Telegram идёт ТОЛЬКО через `grant-access-for-order → telegram-grant-access`. `telegram_access_queue` — только для ручных reinvite/bulk/repair»).

## DoD

- триггер `subscription_grant_telegram` физически DISABLED, функция = no-op (proof: `pg_trigger.tgenabled = 'D'` и `pg_get_functiondef` тело-no-op)
- новая оплата создаёт **ровно один** Telegram DM (proof: `SELECT count(*) FROM telegram_messages WHERE meta->>'event'='access_granted_dm' AND user_id=:uid AND created_at > now()-interval '10 min'` → 1)
- после новой оплаты в `telegram_access_queue` **нет** ни одной auto-grant записи для этой подписки (proof: `SELECT count(*) FROM telegram_access_queue WHERE subscription_id=:sub_id` → 0)
- продление подписки через `subscription-charge` для юзера не в клубе тоже выдаёт ровно один DM (proof: те же два запроса для charge order)
- ручной reinvite через `telegram-club-members` продолжает работать: запись попадает в queue с `meta.source='reinvite'`, обработчик её принимает, DM отправляется
- любая будущая случайная INSERT в queue без `meta.source` отмечается `skipped` + audit `telegram.legacy_queue_skip`
- обновлена память `mem://index.md` (Core-rule добавлен)

## Технические детали

Файлы, которые меняются:

- новая миграция: `DISABLE TRIGGER subscription_grant_telegram` + `CREATE OR REPLACE FUNCTION public.trg_subscription_grant_telegram()` → no-op + COMMENT
- `supabase/functions/telegram-process-access-queue/index.ts` — guard `meta.source IN (...)` + skip + audit
- `supabase/functions/subscription-charge/index.ts` — заменить INSERT в queue на `supabase.functions.invoke('telegram-grant-access', { body: { user_id, clubs:[clubId], source:'subscription_renewal', source_id: chargeOrderId } })`
- `supabase/functions/telegram-club-members/index.ts` — добавить `meta: { source: 'reinvite' }` в INSERT
- `src/components/admin/telegram/TelegramAuditSection.tsx` — добавить `telegram.legacy_queue_skip` в `or(...)`-фильтр
- новая memory-запись `mem://architecture/telegram/canonical-grant-write-path` + апдейт `mem://index.md`

Откат: одна команда `ALTER TABLE subscriptions_v2 ENABLE TRIGGER subscription_grant_telegram;` + восстановить тело функции из git (предыдущая миграция `20260429181943_*`).