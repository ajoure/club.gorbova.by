## да, согласен, с учетом правок:

&nbsp;

1. **Убери логическое противоречие по recalculateExisting = false.**
  Сейчас в тексте написано, что при recalculateExisting = false safe-кейс может попасть в aligned_update_needed. Это нормально для preview, **но execute не должен обновлять такие записи**, если флаг выключен.
  Это нужно явно зафиксировать в плане, иначе получится скрытый update без включённого пересчёта.
2. **Явно измени executeActions:**
  передай туда recalculateExisting и закрепи правило:
  &nbsp;
  - missing_access → create
  - aligned_update_needed → update **только при** recalculateExisting = true
  - aligned_update_needed при recalculateExisting = false → skip без update
  - conflict_existing → skip всегда
    И отдельно зафиксируй: force_execute не превращает конфликт в update, он только разрешает пройти stop-guard и применить безопасные изменения.
  &nbsp;
3. **Safe-кейс надо определять не только по source, но и по lineage правила.**
  Недостаточно проверки source in ('retroapply','fulfillment','batch').
  Нужно добавить:
  &nbsp;
  - safe только если meta.source_rule_id пустой **или совпадает** с текущим [rule.id](http://rule.id), либо lineage доказуемо не противоречит текущему правилу;
  - если meta.source_rule_id заполнен и **не совпадает** с текущим [rule.id](http://rule.id) → это conflict_existing.
  &nbsp;
4. **Проверку дублей сделай явной, а не через existingMap.**
  Нужен отдельный batch-count active entitlements по (user_id, target_product_id).
  Если count > 1 → conflict_multiple_entitlements и запись всегда остаётся в conflict_existing.
5. **Отдельно уточни кейс current_expires_at IS NULL.**
  Это не всегда safe.
  Safe только если одновременно:
  &nbsp;
  - planned_expires_at вычислен,
  - нет дублей,
  - source не manual/admin,
  - нет другого source_rule_id.
    Иначе это тоже конфликт.
  &nbsp;
6. **Добавь недостающий conflict-код:**
  conflict_different_rule_source → «Конфликт: доступ выдан по другому правилу».
  И добавь его в REASON_LABELS на фронте.
7. **Добавь safe-код для preview без пересчёта:**
  safe_recalculate_available_but_disabled →
  «Срок можно безопасно обновить, но пересчёт сроков сейчас выключен».
  Это сделает preview понятным, почему запись не конфликтная, но и не обновляется.
8. **Proof нужно разделить на 2 preview-режима, а не только на один.**
  Обязательно показать:
  &nbsp;
  - preview при recalculate_existing = false
  - preview при recalculate_existing = true
    И сравнить, как часть записей переезжает из conflict_existing в aligned_update_needed.
  &nbsp;
9. **DoD дополни критичным пунктом:**
  при recalculate_existing = false должно быть доказано:
  &nbsp;
  - updated = 0
  - safe-кейсы могут отображаться как требующие обновления, но фактически не применяются.
  &nbsp;
10. **UI-пояснение для aligned_update_needed.**
  В RetroApplyPanel добавь короткий смысл этой категории:
  «Доступ уже есть, будет обновлён только срок».
  И рядом показывай, включён ли сейчас режим пересчёта сроков.
11. **Оставшиеся конфликты в финальном proof нужно разложить по причинам.**
  Не просто “осталось N конфликтов”, а таблицей:
  &nbsp;
  - manual source
  - multiple entitlements
  - different rule source
  - would reduce access
  - no planned expiry
  &nbsp;

&nbsp;

```
ЖЁСТКИЕ ПРАВИЛА ИСПОЛНЕНИЯ ДЛЯ LOVABLE.DEV

- Ничего не ломать и не трогать лишнее.
- Add-only, кроме точечной переклассификации false conflicts.
- Сначала preview-proof, потом execute-proof.
- Не менять другие edge functions, таблицы, RLS и UI-layout сверх указанного.
- Не допустить ни одного update при `recalculateExisting = false`.
- Реальные конфликты не применять автоматически ни при каком режиме.
- Все решения только из канонической модели: `entitlements`, `subscriptions_v2`, `access_rules`, `meta.source_rule_id`, source lineage.
- Финальный отчёт обязателен с before/after proof.

ПАТЧ: RETROAPPLY-CONFLICT-RECLASSIFICATION

1. Файл:
   `supabase/functions/rules-retroapply/index.ts`

2. Изменения:
   - расширить fetch existing entitlements: добавить `meta`, `source`;
   - добавить явную batch-проверку duplicate active entitlements по `(user_id, target_product_id)`;
   - переклассифицировать false conflicts в safe update;
   - но обновлять safe update только при `recalculateExisting = true`.

3. Новая логика:
   - сроки совпадают (±60 сек) → `already_satisfied`
   - safe и `planned > current` при `recalculateExisting = true` → `aligned_update_needed`
   - safe и `planned > current` при `recalculateExisting = false` → preview показывает необходимость обновления, execute не обновляет
   - safe и `current_expires_at IS NULL` при доказуемом lineage → `aligned_update_needed`
   - `manual/admin/unknown source` → `conflict_existing`
   - `meta.source_rule_id != current rule.id` → `conflict_existing`
   - `count(active entitlements) > 1` → `conflict_existing`
   - `planned < current` → `conflict_existing`
   - `planned is null` → `conflict_existing`

4. Новые reason-коды:
   - `safe_recalculate_expires_extended`
   - `safe_recalculate_expires_missing`
   - `safe_recalculate_available_but_disabled`
   - `conflict_manual_source`
   - `conflict_multiple_entitlements`
   - `conflict_would_reduce_access`
   - `conflict_no_planned_expiry`
   - `conflict_different_rule_source`

5. Execute:
   - `missing_access` → create
   - `aligned_update_needed` → update только если `recalculateExisting = true`
   - `aligned_update_needed` при `recalculateExisting = false` → skip
   - `conflict_existing` → skip всегда
   - `force_execute` не должен обновлять конфликтные записи

6. Файл:
   `src/components/admin/product/RetroApplyPanel.tsx`

7. UI:
   - добавить переводы всех новых reason-кодов;
   - для `aligned_update_needed` показать текст: «Доступ уже есть, будет обновлён только срок»;
   - явно показывать, включён ли сейчас пересчёт сроков;
   - при выключенном `recalculateExisting` показывать reason:
     `safe_recalculate_available_but_disabled`.

8. Proof:
   - preview with `recalculate_existing = false`
   - preview with `recalculate_existing = true`
   - execute with `recalculate_existing = true`
   - repeat execute for idempotency
   - отдельно показать breakdown remaining conflicts by reason

9. DoD:
   - false conflicts уменьшились
   - `aligned_update_needed` выросли только за счёт safe-кейсов
   - при `recalculate_existing = false` → `updated = 0`
   - при `recalculate_existing = true` → safe-кейсы реально обновляются
   - repeat execute → `updated = 0`
   - remaining conflicts объяснены поштучно по причине

План: RETROAPPLY-CONFLICT-RECLASSIFICATION
```

### Проблема

В текущей логике (строки 366-383 `index.ts`) любой existing entitlement с несовпадающим сроком при `recalculateExisting = false` попадает в `conflict_existing` с причиной `existing_entitlement_from_different_source`. Это ложный конфликт — если source однозначен и entitlement принадлежит тому же правилу, это безопасное обновление, а не конфликт.

Также: если `current_expires_at IS NULL`, запись тоже падает в conflict, хотя это просто незаполненный срок.

---

### Что меняется

**Файл 1: `supabase/functions/rules-retroapply/index.ts**`

**1a. Расширить fetch entitlements** (строки 329-335): добавить поле `meta` в select, чтобы проверять `meta.source_rule_id` и `source`.

**1b. Переписать классификацию** (строки 366-383) по новой логике:

```text
existing entitlement найден:
├── сроки совпадают (±60с) → already_satisfied
├── recalculateExisting = true AND safe → aligned_update_needed
├── recalculateExisting = false AND safe → already_satisfied (срок уже ≥ planned)
│                                        OR aligned_update_needed (срок < planned, но safe)
└── НЕ safe → conflict_existing
```

Определение "safe" (безопасное обновление):

- Ровно 1 active entitlement на этот target_product_id у пользователя (уже проверено через existingMap — но нужно проверить нет ли дублей)
- source entitlement = `retroapply` или `fulfillment` или `batch` (не `manual`, не `admin`)
- planned_expires_at вычислен
- Обновление НЕ сокращает доступ (planned >= current, или current IS NULL)

Определение "реальный конфликт":

- source = `manual` / `admin` / неизвестный
- Найдено >1 active entitlement на тот же target
- planned_expires_at отсутствует
- planned < current (обновление сократит доступ)

**1c. Добавить новые skip_reason коды:**

- `safe_recalculate_expires_extended` — срок будет продлён по правилу
- `safe_recalculate_expires_missing` — текущий срок отсутствует, будет рассчитан
- `conflict_manual_source` — доступ выдан вручную
- `conflict_multiple_entitlements` — несколько активных доступов на один target
- `conflict_would_reduce_access` — обновление сократит срок
- `conflict_no_planned_expiry` — невозможно вычислить новый срок

**1d. Обновить executeActions** (строки 512-542): `aligned_update_needed` уже обрабатывается — без изменений. Убедиться что force_execute пропускает только `conflict_existing`, а не `aligned_update_needed`.

**1e. Обновить stop-guard** (строки 129-148): `conflict_existing` по-прежнему блокирует, но `aligned_update_needed` НЕ блокирует (уже так).

---

**Файл 2: `src/components/admin/product/RetroApplyPanel.tsx**`

**2a. Обновить `REASON_LABELS**` — добавить русские переводы для новых кодов:

- `safe_recalculate_expires_extended` → «Срок будет выровнен по правилу»
- `safe_recalculate_expires_missing` → «Текущий срок отсутствует, будет рассчитан заново»
- `conflict_manual_source` → «Конфликт: доступ выдан вручную»
- `conflict_multiple_entitlements` → «Конфликт: несколько активных доступов»
- `conflict_would_reduce_access` → «Конфликт: обновление сократит срок доступа»
- `conflict_no_planned_expiry` → «Конфликт: невозможно вычислить новый срок»

**2b. Без изменений:** категории, фильтры, summary, expanded row — всё уже поддерживает `aligned_update_needed` и `conflict_existing`. Новая логика только меняет, в какую категорию попадает запись.

---

### Что НЕ меняется

- Структура ответа edge function (те же категории)
- UI layout / фильтры / пагинация
- execute логика (уже обрабатывает `aligned_update_needed`)
- Другие edge functions / таблицы / RLS

---

### DoD / Proof

После деплоя — вызвать preview на правиле Деньги BY с `recalculate_existing: true`:

1. **before**: число `conflict_existing`
2. **after**: число `conflict_existing` (должно уменьшиться), число `aligned_update_needed` (должно вырасти)
3. Execute на безопасном кейсе → подтвердить что updated > 0
4. Повторный execute → 0 изменений (idempotency)
5. Оставшиеся `conflict_existing` — показать причину каждого