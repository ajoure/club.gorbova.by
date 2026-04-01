# да, согласен, с учетом правок:

&nbsp;

1. **PATCH B лучше разделить на два результата:**
  &nbsp;
  - B1 — SQL proof по email_logs и корректировка статуса email-proof;
  - B2 — кодовый фикс telegram-process-access-queue для product_name.
    Так будет проще принять отдельно доказательство и отдельно маленький кодовый фикс.
  &nbsp;
2. **В PATCH A явно зафиксируй, что fallback нужен не только для product_name, но и для product_id в meta/log context, если он отсутствует.**
  &nbsp;
  - tariff_name можно честно оставить UNKNOWN, это нормально;
  - но product_id и product_name должны заполняться последовательно из product_club_mappings.
  &nbsp;
3. **Добавь в план post-check для PATCH A.**
  После деплоя нужен proof на новых queue items:
  &nbsp;
  - product_name != 'UNKNOWN';
  - product_resolve_source = 'club_mapping';
  - subscription_id is null при этом не ломает обработку.
    Иначе фикс будет только “по коду”.
  &nbsp;
4. **В SQL proof по email_logs расширь критерии stale.**
  Сейчас у тебя:
  &nbsp;
  - updated_at > sent_at AND access_end_at > sent_at
  - superseded/canceled
    Этого в целом достаточно, но лучше явно разделить verdict на:
  - valid
  - stale_after_renew
  - stale_superseded
  - stale_canceled
    Чтобы итоговая статистика была точнее.
  &nbsp;
5. **Уточни, что именно считается email live proof.**
  Не просто наличие email_logs, а:
  &nbsp;
  - есть реальная запись renewal/grace email;
  - есть subscription_id;
  - verdict не stale.
    Только тогда статус email stale proof можно переводить в done.
  &nbsp;
6. **Статус Email delivery source = done — да, но только после отдельной корректировки прошлого отчета.**
  Надо явно зафиксировать:
  &nbsp;
  - предыдущее заключение “источник отсутствует” было ошибочным;
  - корректный источник — email_logs через send-email.
    Это важно, чтобы в истории не осталось противоречия.
  &nbsp;
7. **В STOP-guards добавь ещё один пункт:**
  если в product_club_mappings на один club_id найдено несколько active mappings, не просто “взять первый”, а:
  &nbsp;
  - логировать warning;
  - писать product_resolve_source = 'club_mapping_ambiguous';
  - при необходимости оставлять product_name = 'UNKNOWN', если нельзя выбрать однозначно.
    Иначе можно тихо подставить неверный продукт.
  &nbsp;
8. **В DoD добавь before/after для статусов.**
  Итог должен быть такой:
  &nbsp;
  - email delivery source → done;
  - email stale proof → done, если SQL покажет 0 stale;
  - pending-live-proof остаётся только для первого реального renew event.
  &nbsp;
9. **Небольшая формулировка:**
  в блоке “Что НЕ будет изменено” добавь ещё:
  &nbsp;
  - product_reentry_pricing не трогаем;
  - pricing logic не трогаем;
  - только proof + fallback для corrective queue.
  &nbsp;

&nbsp;

&nbsp;

В остальном план правильный: scope маленький, логичный и без лишнего рефакторинга.

&nbsp;

План: PATCH-FOLLOW-UP — два follow-up патча + коррекция email proof статуса

---

## Проблема

По итогам PATCH-FINAL-CLEANUP v2 выявлены два follow-up дефекта и одно ошибочное заключение:

1. **Косметический дефект**: `telegram-process-access-queue` показывает `product_name: UNKNOWN` и `tariff_name: UNKNOWN` когда queue item создан без `subscription_id` (corrective batch).
2. **Ошибочное заключение по email audit trail**: ранее зафиксировано, что «email delivery source отсутствует». Это **неверно**. Все renewal/grace email отправки проходят через `send-email` edge function, которая уже пишет в таблицу `email_logs` с `subscription_id`, `event_type`, `user_id`, `profile_id` и `meta`. Значит email audit trail **уже существует**, и статус email proof можно закрыть через `email_logs`.
3. **pending-live-proof** остаётся как есть.

---

## Диагностика

### UNKNOWN в queue

Файл: `telegram-process-access-queue/index.ts`, строки 150-177.

Логика:

- Если `item.subscription_id` задан → fetch из `subscriptions_v2` join `tariffs` + `products_v2` → получает `tariffName`, `productName`
- Если `item.subscription_id` = null → fallback `"UNKNOWN"`

Corrective queue items были созданы без `subscription_id`, поэтому всегда `UNKNOWN`.

**Решение**: добавить fallback-резолв через `product_club_mappings` + `products_v2` по `club_id`, если `subscription_id` отсутствует. Это не создаёт нового source of truth — `product_club_mappings` уже является каноническим маппингом club→product.

### Email audit trail

Цепочка:

- `subscription-charge` → `sendRenewalSuccessEmail()` → `supabase.functions.invoke('send-email', ...)` → `email_logs.insert()`
- `subscription-renewal-reminders` → `supabase.functions.invoke('send-email', { context: { subscription_id, event_type, ... } })` → `email_logs.insert()`
- `subscription-grace-reminders` → `supabase.functions.invoke('send-email', ...)` → `email_logs.insert()`

`send-email/index.ts` строка 435: `await supabase.from('email_logs').insert(...)` с `subscription_id`, `event_type`, `template_code`, `status`, `meta`.

**Вывод**: таблица `email_logs` уже является email audit trail. Статус email proof нужно пересмотреть — живой proof можно построить по `email_logs`.

---

## Предлагаемое решение

### PATCH A: product_name fallback в telegram-process-access-queue

**Файл**: `supabase/functions/telegram-process-access-queue/index.ts`

**Изменение**: после блока `if (item.subscription_id)` (строки 154-174) и перед fallback на строках 176-177, добавить:

```
// Fallback: resolve product via club mapping if no subscription_id
if (!productName && item.club_id) {
  const { data: mapping } = await supabase
    .from("product_club_mappings")
    .select("product_id, products_v2(name)")
    .eq("club_id", item.club_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  
  if (mapping) {
    productName = mapping.products_v2?.name || null;
    subscriptionProductId = subscriptionProductId || mapping.product_id;
  }
}
```

Tariff остаётся `"UNKNOWN"` если нет subscription — это корректно, потому что тариф привязан к подписке, а не к продукту.

**Audit**: запись в meta `product_resolve_source: 'club_mapping'` для трассируемости.

### PATCH B: Email stale proof через email_logs

**Не требует изменения кода** — только SQL proof.

Dry-run запрос по `email_logs` после даты деплоя anti-stale guard:

```sql
SELECT 
  el.subscription_id,
  el.event_type,
  el.created_at as sent_at,
  s.access_end_at,
  s.updated_at as sub_updated_at,
  s.status as sub_status,
  CASE 
    WHEN s.updated_at > el.created_at AND s.access_end_at > el.created_at 
    THEN 'stale_after_renew'
    WHEN s.status IN ('superseded','canceled') 
    THEN 'stale_superseded'
    ELSE 'valid'
  END as verdict
FROM email_logs el
JOIN subscriptions_v2 s ON s.id::text = el.subscription_id
WHERE el.event_type IN ('renewal_reminder', 'grace_started', 'grace_72h', 'grace_24h', 'grace_expired')
  AND el.created_at > '2026-04-01'
ORDER BY el.created_at DESC;
```

### Коррекция статуса


| Пункт                 | Старый статус     | Новый статус                      | Обоснование                                                           |
| --------------------- | ----------------- | --------------------------------- | --------------------------------------------------------------------- |
| Email delivery source | partial / limited | **done**                          | `email_logs` через `send-email` уже логирует все renewal/grace emails |
| Email stale proof     | partial / limited | **можно закрыть после SQL proof** | Источник найден, нужен только запрос                                  |


---

## Изменяемые файлы


| Файл                                     | Изменение                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `telegram-process-access-queue/index.ts` | Добавить fallback через `product_club_mappings` для queue items без `subscription_id` |


### Что НЕ будет изменено

- `send-email` — уже пишет в `email_logs`, не трогаем
- `subscription-charge` — не трогаем
- `subscription-renewal-reminders` — не трогаем
- `subscription-grace-reminders` — не трогаем

---

## Dry-run

1. Проверить, что `product_club_mappings` join `products_v2` отдаёт имя продукта по `club_id`
2. SQL proof по `email_logs` — stale count
3. Code review: fallback не ломает существующий flow (добавляется только если `productName` всё ещё null)

## Execute

1. Добавить fallback в `telegram-process-access-queue/index.ts`
2. Deploy `telegram-process-access-queue`
3. SQL proof по `email_logs` для email stale

## STOP-guards

- Если `product_club_mappings` отдаёт >1 active mapping на один `club_id` → использовать первый, но логировать warning
- Если email_logs stale count > 5 → расширить scope

## DoD

- Queue items без `subscription_id` получают `product_name` через `product_club_mappings` fallback
- Email stale proof построен по `email_logs` (живой proof)
- Статус email delivery source скорректирован на done
- pending-live-proof остаётся pending

## Риски

- Минимальные: fallback читает только существующий mapping, не мутирует данные.