## да, согласен, с учетом правок:

&nbsp;

1. В reactivation-path искать существующую запись нужно не только по user_id + product_id, а по **каноническому ключу уникальности** user_id + product_code. Иначе патч может снова промахнуться мимо строки, которая реально блокирует INSERT по unique constraint.
2. В ветке expired -> UPDATE обязательно обновлять:
  &nbsp;
  - status = 'active'
  - expires_at = planned_expires_at
  - updated_at = now()
  - profile_id — только если он пустой и у пользователя найден актуальный profile_id
    Это нужно явно зафиксировать в плане.
  &nbsp;
3. Meta merge нужно описать жестче:
  &nbsp;
  - merge только поверх объекта meta
  - если meta = null / не object, сначала нормализовать в {}
  - business_subscription_id и source_window_rule не перетирать, если уже есть
  - source_rule_id обновлять только если пустой или совпадает с текущим правилом; при несовпадении не реактивировать молча, а отправлять в skipped_error / conflict
  &nbsp;
4. В execute-статистике зафиксировать, что reactivated не смешивается с updated. Иначе снова будет путаница:
  &nbsp;
  - created = только новый INSERT
  - reactivated = expired → active
  - updated = изменение уже active записи
    Это должно отражаться и в engine, и в UI.
  &nbsp;
5. В DoD добавить отдельный proof по constraint:
  &nbsp;
  - before: показать expired entitlement с тем же user_id + product_code
  - first execute: reactivated = 3
  - after: те же строки уже active
  - repeat execute: reactivated = 0, skipped_idempotent > 0
    Без этого нельзя считать root cause доказанным.
  &nbsp;
6. По Семашкевич в финальном отчете отдельно зафиксировать correction note:
  &nbsp;
  - предыдущий вывод об отсутствии active BUSINESS subscription был ошибочным
  - правильный статус подтвержден dry-run/SQL
    Это не просто комментарий, а обязательная часть честного proof-пакета.
  &nbsp;
7. В UI post-result кроме блока «Реактивировано» добавить явную строку:
  &nbsp;
  - Не вошло в запуск: N
  - Пропущено по идемпотентности: N
  - Не применено из-за ошибки/статуса: N
    И не объединять эти числа в одно «пропущено».
  &nbsp;
8. Если в create/reactivation-path запись найдена в статусе, отличном от active/expired, в errors[] нужно возвращать не общий текст, а конкретный код и статус записи, например unsafe_status_for_reactivation: revoked. Это важно для диагностики.
9. В шаги execute добавить обязательную проверку карточек всех 3 пользователей после реактивации, не только SQL preview_after. Потому что текущая проблема уже проявлялась как расхождение engine/UI.
10. PATCH-H не смешивать с этим патчем в статусе закрытия. В финале писать отдельно: этот патч чинит только RetroApply reactivation-path и truthful execute-result, без повторного открытия темы deal_date.

&nbsp;

&nbsp;

План: Fix RetroApply create-path — реактивация expired entitlements по unique (user_id, product_code)

### Исправление ошибки в предыдущей диагностике

**Мой предыдущий диагноз по Семашкевич был полностью ошибочным.** Я ложно заявил, что у неё нет активной BUSINESS-подписки. Факты:

- Активная подписка `c055cf9d`: status=active, access_end_at=2026-05-07 ✓
- 3 оплаченных заказа на cb20 (product_id `7101ed3c`) ✓
- Условие `prior_purchase` для правила `1b497fba` выполнено ✓
- cb20 entitlement существует, status=`expired`, expires_at=2026-04-07

**Все три пользователя (Кузьменок, Шевченко, Семашкевич) имеют одну и ту же проблему B** (execute/reactivation defect). Проблема A (eligibility) отсутствует.

Правило `6ba9727e` (Деньги BY) — безусловный бонус, без `condition_type`. Правило `1b497fba` (cb20 и ещё 8) — условный бонус с `prior_purchase`, `per_product`. Оба правила одного тарифа BUSINESS. Деньги BY выдан Семашкевич потому что не требует prior_purchase. cb20 не выдан потому что entitlement expired → preview = `missing_access` → execute = duplicate key error.

---

### Корневая причина (подтверждена)

**Preview** (строка 365): ищет entitlements с `status = "active"` → для expired не находит → категория `missing_access` ✓ (корректно)

**Execute** (строки 654-659): idempotent guard ищет только `status = "active"` → не находит expired → пропускает guard → INSERT → `UNIQUE (user_id, product_code)` уже занят expired записью → **duplicate key error**

---

### Решение

#### 1. Engine: `supabase/functions/rules-retroapply/index.ts`

**Create-path (строки 652-718) — расширить idempotent guard:**

Текущий код (строки 654-661):

```
.eq("status", "active")
```

Заменить на: убрать фильтр по статусу, добавить `status, expires_at, meta` в select.

Ветвление по найденному статусу:

- `active` → `skipped_idempotent` (как сейчас)
- `expired` → **UPDATE** (status → active, новый expires_at, meta merge) → считать как `reactivated`
- `revoked` / `cancelled` / любой другой → `skipped_error` с причиной `"unsafe_status_for_reactivation: {status}"`. Закрытый whitelist: реактивация разрешена ТОЛЬКО для `expired`.
- Не найден → INSERT (как сейчас)

**Meta merge при reactivation (strictly add-only):**

```
mergedMeta = {
  ...oldMeta,                          // все старые ключи сохраняются
  source_type: "retroapply",
  source_rule_id: rule.id,
  batch_id: batchId,
  retroapply_reactivated: true,
  retroapply_reactivated_at: new Date().toISOString(),
  previous_status: "expired",
  previous_expires_at: existingRecord.expires_at
}
```

Запрещено перетирать: `business_subscription_id`, `source_window_rule`, `source_rule_id` (если уже есть и совпадает), любые repair/debug поля.

**Новый счётчик `reactivated**` — отдельно от `created`:

```
reactivation_candidates_found  — сколько expired записей найдено
reactivated                    — сколько успешно обновлено
```

Полная статистика execute:

- `targeted`, `created`, `reactivated`, `updated`
- `skipped_idempotent`, `skipped_conflict`, `skipped_error`
- `not_selected`, `reactivation_candidates_found`
- `created_action_ids`, `reactivated_action_ids`, `updated_action_ids`, `skipped_action_ids`
- `errors[]`

#### 2. UI: `src/components/admin/product/RetroApplyPanel.tsx`

Post-result блок (строки 853-895) — добавить:

- Отдельный столбец **«Реактивировано»** (зелёный, как created)
- Строка **«Не применено по статусу записи»** для `skipped_conflict` (отдельно от `skipped_error`)
- Текстовая строка: `Реактивировано expired → active: N.`
- Ошибки execute отображаются как сейчас

#### 3. Что НЕ меняется

- Preview-классификация: `missing_access` для expired entitlements остаётся корректной и без изменений
- Структура таблиц, RLS, другие edge functions
- Данные `deal_date` в БД
- Логика правил access_rules

---

### STOP-guards

1. Реактивация разрешена **только** для `status = expired`. Любой другой статус → `skipped_error`
2. Meta при reactivation — merge, не overwrite. Запрещено удалять существующие ключи
3. Если после фикса `missing_access` не исчезает в preview_after — патч не закрывается
4. Не менять данные `deal_date` в БД
5. Не менять preview-классификацию

---

### DoD

1. Execute по cb20 для всех 3 пользователей: `reactivated = 3`, `errors = 0`
2. Entitlements cb20: `status = active`, `expires_at = MAX(access_end_at)` по active/past_due BUSINESS subscription каждого пользователя
3. Meta после reactivation содержит старые ключи + retroapply-маркеры (proof before/after по одному entitlement)
4. Preview_after: `missing_access` для cb20 у этих 3 пользователей = 0
5. Repeat execute = 0 изменений (skipped_idempotent)
6. Constraint proof: до фикса duplicate key → после фикса reactivated → repeat = 0
7. Дата одной и той же сделки совпадает во всех местах UI (PATCH-H уже в коде)