

# План: Полная связка подписок + repair данных

## Проблема

1. **`is_orphan`** = `!linkedSubId && !linkedUserId` — не учитывает наличие order/deal. Подписка с контактом, но без сделки показывает зелёный бейдж «Связана».
2. **`bepaid-create-subscription-checkout`** не записывает `order_id` в `subscriptions_v2` (только `meta.checkout_order_id`).
3. **68+ строк** `subscriptions_v2` с пустым `profile_id` или `order_id`, хотя данные для заполнения есть.

---

## Шаг 1: Fix A — остановить создание новых «не связанных»

**Файл:** `supabase/functions/bepaid-create-subscription-checkout/index.ts`

- Строка ~322: в insert `subscriptions_v2` добавить `order_id: order.id`
- STOP-guards:
  - Если `order.id` отсутствует после insert order → стоп, return error + audit_log `checkout_missing_order_stop`
  - Если insert `subscriptions_v2` не вернул `id` → стоп + audit_log `checkout_subscription_insert_failed`
  - Если order создан, но subscription insert упал → audit_log + пометить order в meta `{ orphaned_checkout: true, error: subError.message }` (не удалять order, чтобы repair мог подхватить)

## Шаг 2: Repair B — починить существующие данные

SQL repair через migration tool, строго безопасные случаи:

1. **`subscriptions_v2.profile_id`**: backfill из `profiles` по `user_id` (1:1 матч — один профиль на user_id)
2. **`subscriptions_v2.order_id`**: backfill только из `meta->>'checkout_order_id'` → `orders_v2.id` (строгий 1:1, order должен реально существовать). Запрещено: по user_id, по времени, «последний order».
3. **`provider_subscriptions.subscription_v2_id`**: заполнить только по строгому 1:1 уникальному ключу (provider_subscription_id / external id, tracking ключи в meta). **Запрещено**: «ровно один кандидат по user_id» — опасно, может ошибочно привязать чужую подписку. Если уникального ключа нет → ambiguous, не трогать.

Обязательно:
- batch audit_log: `actor_type='system'`, `actor_user_id=NULL`, `actor_label='repair_linkage_v1'`, totals
- row-level audit_log на каждую изменённую строку (old→new, причина)

## Шаг 3: `is_linked_full` в list function

**Файл:** `supabase/functions/bepaid-list-subscriptions/index.ts`

Строка ~706: заменить:
```typescript
is_orphan: !linkedSubId && !linkedUserId,
```
на:
```typescript
is_linked_full: !!(linkedUserId && linkedSubId && linkedOrderId),
```

`linkedOrderId` уже вычисляется (строка 685). Это ровно те же поля/joins, по которым рисуются колонки «контакт» и «сделка» в таблице.

Stats (строка ~739): заменить `orphans`/`linked` на подсчёт по `is_linked_full`.

## Шаг 4: UI — 2 бейджа

**Файлы:**
- `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`
- `src/components/admin/payments/BepaidSubscriptionsList.tsx`

Замены:
- Интерфейс `BepaidSubscription`: `is_orphan: boolean` → `is_linked_full: boolean`
- Все `is_orphan` → `!is_linked_full` (инвертированная логика)
- Бейдж: `is_linked_full` → зелёный «Связана»; `!is_linked_full` → бледно-красный «Не связана»
- Фильтры: `linked` = `is_linked_full`, `orphan` → `!is_linked_full`
- «Urgent» = скоро списание + `!is_linked_full`

Без новых бейджей/градаций. Детали (контакт/сделка) остаются видны в колонках.

---

## Не затрагивается

- Webhook логика
- Карточка контакта
- Схема БД (миграции не нужны)
- Другие edge functions

## DoD

1. Новые provider-managed подписки создаются с `order_id` NOT NULL
2. Зелёный бейдж = полная цепочка (contact + subscription_v2_id + order); любое отсутствие звена → красный
3. `subv2_missing_profile` = 0 для однозначных
4. `subv2_missing_order` = 0 для строк с валидным `meta.checkout_order_id` и существующим order
5. Ambiguous не затронуты, зафиксированы в audit
6. **Регресс-проверка**: после checkout создать тестовую подписку → `subscriptions_v2.order_id IS NOT NULL`; несвязанные строки не получают зелёный бейдж
7. Audit: batch + row-level, `actor_type='system'`, `actor_user_id=NULL`

## STOP-guards

- Для backfill `order_id` — только из `meta.checkout_order_id`, строго 1:1
- Для `provider_subscriptions.subscription_v2_id` — только по уникальному ключу, не по user_id
- Количество repair-строк соответствует dry-run
- Если order создан, но subscription insert упал → не удалять order, пометить диагностически

