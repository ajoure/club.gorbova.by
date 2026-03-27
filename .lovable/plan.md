# да, согласен, с учетом правок:

&nbsp;

1. DoD-2 (SQL-check) сделать проверяемым и однозначным — добавить 2 запроса (с окном по времени после деплоя/последних webhook’ов):

&nbsp;

-- 1) Есть новые фиксированные ключи

SELECT id, created_at,

       meta->>'bepaid_terminal_at' AS terminal_at,

       meta->>'bepaid_terminal_state' AS terminal_state

FROM subscriptions_v2

WHERE meta ? 'bepaid_terminal_at'

  AND meta ? 'bepaid_terminal_state'

ORDER BY created_at DESC

LIMIT 20;

&nbsp;

-- 2) Нет динамических ключей (как минимум в свежих данных)

SELECT id, created_at, meta

FROM subscriptions_v2

WHERE (meta ? 'bepaid_canceled_at'

    OR meta ? 'bepaid_failed_at'

    OR meta ? 'bepaid_expired_at'

    OR meta ? 'bepaid_redirecting_at')

ORDER BY created_at DESC

LIMIT 20;

&nbsp;

2. Diff-summary в DoD-1 закрепить как “1 файл / 1 блок / 1 место”: явно требовать, что изменена только ветка terminal-states в bepaid-webhook/index.ts и только внутри subV2.meta update (без правок соседних строк/логики).
3. STOP-guard уточнить: если в этом же PR/деплое появляются любые изменения в admin-bepaid-backfill-subscriptions / data-fix SQL / любые другие ветки webhook — стоп (патч должен быть изолированным).

&nbsp;

&nbsp;

План: Кнопка «Отменить в bePaid» + фикс profile_id = NULL

## Проблема

### 1. Нет per-row кнопки отмены подписки

В dropdown-меню списка автопродлений нет кнопки «Отменить подписку в bePaid». Единственные варианты:

- Bulk-cancel через чекбоксы (неудобно для одной подписки)
- Через карточку контакта (невозможно, если контакт не привязан)
- «Аварийная отвязка» — только убирает связь из нашей системы, НЕ отменяет в bePaid (деньги продолжают списываться)

### 2. Данные: `subscriptions_v2.profile_id = NULL`

Для подписки `sbs_757c3e86d3587928`:

- `provider_subscriptions.profile_id` = `d74aeb9b` (Анастасия Бобровник) ✓
- `subscriptions_v2.profile_id` = **NULL** ✗
- `subscriptions_v2.user_id` = `def0faba` ✓

Карточка контакта ищет подписки по `user_id`, поэтому технически подписка должна отображаться. Но `profile_id = NULL` — это несоответствие данных. Всего **68 активных подписок** с `profile_id = NULL` в `subscriptions_v2`.

---

## Изменения

### Часть 1: Кнопка «Отменить в bePaid» (UI)

**Файл:** `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`

1. Добавить state: `cancelSingleId: string | null`, `showCancelSingleDialog: boolean`
2. В dropdown-меню (после «Открыть в bePaid», перед секцией аварийной отвязки) — новый `DropdownMenuItem`:
  - Условие показа: статус ∈ `['active', 'trial', 'past_due', 'pending', 'failed_attempt']`
  - Текст: **«Отменить в bePaid»**
  - Иконка: `Ban`, красный цвет
3. Новый `AlertDialog` для подтверждения:
  - Заголовок: «Отменить подписку в bePaid?»
  - Текст: «Подписка `{id}` будет отменена на стороне платёжного провайдера. Списания прекратятся. Доступ сохранится до конца оплаченного периода.»
  - Кнопки: «Назад» / «Отменить подписку»
4. Handler переиспользует существующий `cancelMutation.mutateAsync([cancelSingleId])`

Никаких новых edge-функций или миграций не нужно.

### Часть 2: Патч данных — заполнение `profile_id` в `subscriptions_v2`

SQL-скрипт (через insert tool) для всех активных подписок с `profile_id IS NULL`:

```sql
UPDATE subscriptions_v2 s
SET profile_id = p.id
FROM profiles p
WHERE p.user_id = s.user_id
  AND s.profile_id IS NULL
  AND s.status = 'active';
```

Это закроет 68 строк, включая `sbs_757c3e86d3587928`.

---

## Не затронуто

- Edge-функции — без изменений
- Миграции схемы — не нужны
- Карточка контакта — уже ищет по `user_id`, дополнительный патч `profile_id` — для консистентности данных