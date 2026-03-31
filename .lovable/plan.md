Да, согласен, с учетом правок:

&nbsp;

1. Критичный фикс обязателен: GREATEST(entitlements.expires_at, EXCLUDED.expires_at) заменить на безопасный вариант с COALESCE, иначе можно занулить expires_at.
2. skipEntitlementRevoke сейчас мёртвый флаг. Его недостаточно “посчитать” — нужно либо:
  &nbsp;
  - реально использовать в revoke-ветке для условного UPDATE entitlements.status, либо
  - явно зафиксировать, что revoke entitlement в этом патче не делается, и удалить лишний guard-код.
  &nbsp;
3. Перед proof нельзя закрывать патч, пока не будет фактического решения по revoke-path. Сейчас guard формально есть, но бизнес-эффекта не даёт.
4. В proof-пакет после фикса обязательно включить 3 отдельных кейса:
  &nbsp;
  - handle_new_user
  - subscription-charge
  - subscription-admin-actions/revoke
    По каждому нужны SQL/лог-факты, а не только описание.
  &nbsp;
5. Отдельно вывести итоговую таблицу состояний:
  &nbsp;
  - resolved_now
  - deferred_missing_user_id
  - deferred_ghost_user_id
  - skipped_legacy_code_mismatch
  &nbsp;
6. Ничего больше не расширять по scope. Сначала закрыть два найденных дефекта, потом только final proof и закрытие патча.

&nbsp;

&nbsp;

# Отчет о проверке: v23.1.9D + v23.1.10 — выявленные дефекты перед proof

## Статус: НУЖНЫ ИСПРАВЛЕНИЯ перед proof-пакетом

---

## Архитектура — подтверждено верно


| Компонент                                                                                  | Статус                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Общий helper `entitlement-sync.ts`                                                         | ✅ Создан, контракт соответствует плану             |
| `syncEntitlement()` вызывается из `subscription-charge`                                    | ✅ Строка 1199, `mode_filter: 'subscription_based'` |
| `syncEntitlement()` вызывается из `subscription-admin-actions` (extend/set_end_date/grant) | ✅ Строки 872, 910, 957                             |
| `syncEntitlement()` вызывается из `subscription-actions` (resume)                          | ✅ Строка 215                                       |
| `hasOtherActiveAccessSource()` вызывается в revoke_access                                  | ✅ Строка 984                                       |
| `handle_new_user` SQL trigger — generic loop по active subs                                | ✅ Строки 130-174                                   |
| cb20 исключён из trigger (`p2.code <> 'cb20'`)                                             | ✅ Строка 143                                       |
| cb_2_step исключён из trigger                                                              | ✅ Строка 145                                       |
| cb20 исключён из helper (mode_filter guard)                                                | ✅ Строка 158                                       |
| Audit log в handle_new_user с entitlements_synced count                                    | ✅ Строки 177-186                                   |


---

## Выявленные дефекты — КРИТИЧНЫЕ

### Дефект 1: `GREATEST(NULL, value)` возвращает NULL в PostgreSQL

**Файл**: `supabase/migrations/20260331113539_...sql`, строка 166

```sql
expires_at = GREATEST(entitlements.expires_at, EXCLUDED.expires_at),
```

PostgreSQL `GREATEST()` возвращает `NULL` если **хотя бы один аргумент NULL**. Это значит:

- Если existing entitlement имеет `expires_at = '2026-12-31'`, а subscription не имеет `access_end_at` (NULL) → `GREATEST('2026-12-31', NULL)` = **NULL** → **затирает корректную дату**
- Нарушает контракт "никогда не уменьшать expires_at"

**Исправление**: `COALESCE(GREATEST(entitlements.expires_at, EXCLUDED.expires_at), entitlements.expires_at, EXCLUDED.expires_at)`

### Дефект 2: `skipEntitlementRevoke` установлен, но НИГДЕ НЕ ЧИТАЕТСЯ

**Файл**: `subscription-admin-actions/index.ts`

- Строка 974: `let skipEntitlementRevoke = false;`
- Строка 991: `skipEntitlementRevoke = true;`
- **Нет ни одного места, где `skipEntitlementRevoke` используется для условного пропуска**

Pre-revoke guard вычисляет результат и пишет audit, но фактически ничего не пропускает. Однако на данный момент revoke path и так **не обновляет entitlement status** (не делает `UPDATE entitlements SET status = 'expired'`), поэтому дефект не приводит к потере данных прямо сейчас. Но guard бесполезен — это "мёртвый код".

**Два варианта**:

1. Если revoke_access ДОЛЖЕН ставить `entitlement.status = 'expired'` → нужно добавить этот UPDATE с проверкой `if (!skipEntitlementRevoke)`
2. Если entitlement revoke не нужен в этом патче → убрать guard и зафиксировать, что entitlement не трогается при revoke (доступ истечёт по `expires_at`)

### Дефект 3: В TS helper `syncEntitlement` NULL handling корректен, но неочевиден

**Файл**: `entitlement-sync.ts`, строки 188-190

```typescript
const existingExpiry = existing.expires_at ? new Date(existing.expires_at).getTime() : 0;
const newExpiry = access_end_at ? new Date(access_end_at).getTime() : 0;
const effectiveExpiry = newExpiry > existingExpiry ? access_end_at : existing.expires_at;
```

Это **корректно**: если `access_end_at` = null → `newExpiry = 0` → всегда берёт existing. Если existing null → `existingExpiry = 0` → берёт new. Если оба null → `effectiveExpiry = existing.expires_at = null`.

TS helper OK. Проблема только в SQL trigger (дефект 1).

---

## Что НЕ реализовано (по плану должно быть)

### Cancel path — entitlement не синхронизируется

В `subscription-admin-actions` case `cancel` (строки 683-770) — **нет вызова syncEntitlement и нет обновления entitlement status**. По плану `cancel` должен не трогать entitlement (access сохраняется до `cancel_at`), что соответствует текущему поведению. Но это нигде явно не задокументировано в коде.

---

## План исправлений

### Шаг 1: SQL migration — fix GREATEST NULL handling

Новая миграция для `handle_new_user`:

```sql
expires_at = COALESCE(
  GREATEST(entitlements.expires_at, EXCLUDED.expires_at),
  entitlements.expires_at,
  EXCLUDED.expires_at
),
```

### Шаг 2: Решение по `skipEntitlementRevoke`

Предлагаемый вариант: при revoke_access, если guard НЕ сработал (нет другого источника), обновить entitlement status на `'expired'`. Если guard сработал → skip.

```typescript
if (!skipEntitlementRevoke && subscription.product_id) {
  await supabase.from('entitlements')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('user_id', subscription.user_id)
    .eq('product_code', productForRevoke.code);
}
```

### Шаг 3: После исправлений — proof-пакет

- 1 proof handle_new_user (через audit_logs query)
- 1 proof subscription-charge (через audit_logs query по `entitlement.synced` + `subscription_renewal`)
- 1 proof subscription-admin-actions (через audit_logs query)
- Таблица resolved/deferred counts

---

## Изменяемые компоненты


| Компонент                             | Изменение                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| SQL migration (новая)                 | Fix GREATEST NULL → COALESCE wrapper                                                              |
| `subscription-admin-actions/index.ts` | Добавить conditional entitlement status update на revoke с использованием `skipEntitlementRevoke` |
| `.lovable/plan.md`                    | Обновить статус                                                                                   |


## DoD

1. `GREATEST` в SQL trigger защищён от NULL через COALESCE
2. `skipEntitlementRevoke` реально используется для conditional logic
3. Proof-пакет из 3 кейсов с audit_logs фактами
4. Таблица: resolved_now / deferred_missing_user_id / deferred_ghost_user_id / skipped_legacy_code_mismatch