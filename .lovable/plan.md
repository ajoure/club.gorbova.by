да, согласен, с учетом правок:

&nbsp;

1. **Верни и явно зафиксируй все ранее согласованные SoT-правила, которые в этом плане потерялись.**
  Сейчас план фокусируется только на детерминизме, но выпал старый обязательный контракт:
  &nbsp;
  - getcourse-import-deals должен использовать **DB SoT** по tariffs.getcourse_offer_id, а не hardcoded OFFER_TARIFF_MAP;
  - bepaid-report-import должен использовать **DB SoT** по bepaid_product_mappings, а не “любой первый product_id” через limit 1.
    Это надо вернуть в execute и verify, иначе мы теряем часть уже утвержденного плана.
  &nbsp;
2. **Не ставь id: deal.externalId || 0.**
  Это создаёт повторяющееся значение 0 для всех строк без externalId и может сломать внутреннюю логику/мета-идентификацию.
  Правило:
  &nbsp;
  - id оставить исходным, если есть;
  - если нет externalId, не подменять его общим 0;
  - детерминизм обеспечивать через отдельный stable identity: canonicalHash, rowSourceEventKey, source_subject_ref, deal_number/order_number.
  &nbsp;
3. **Убери зависимость identity от операторских настроек.**
  canonicalHash нельзя строить из полей, которые меняются из-за normalizeNames / mergeEmailDuplicates или других runtime-опций.
  Нужно прямо зафиксировать:
  &nbsp;
  - hash строится из **сырого бизнес-пэйлоада** + стабильной нормализации строк;
  - настройки UI/импорта на identity не влияют.
    Иначе одна и та же строка при разных настройках получит другой deal_number/order_number.
  &nbsp;
4. **Добавь явный контракт для одинаковых строк без externalId.**
  После удаления index у тебя остаётся неописанный случай: две полностью одинаковые строки в одном файле дадут один и тот же hash.
  Нужно прямо выбрать и зафиксировать одно из двух:
  &nbsp;
  - либо это **осознанный dedup** и вторая строка считается duplicate по тому же canonical identity;
  - либо нужен отдельный стабильный источник различения из сырой строки/внешнего файла.
    Без этого план неполный.
  &nbsp;
5. **bepaid-report-import: исправь не только .single(), но и неоднозначный match-контракт целиком.**
  Нужно явно прописать:
  &nbsp;
  - 0 rows → normal create path;
  - 1 row → duplicate skip path;
  - >1 rows → это не обычный skip, а **ambiguous duplicate state** с отдельной фиксацией в ledger (status='failed', failed_at_step='order_lookup', error_message='multiple_existing_orders' или эквивалент).
    И verify должен подтверждать именно этот branch contract.
  &nbsp;
6. **failed_at_step зафиксируй через единый currentStep contract и одинаковую дисциплину в обоих файлах.**
  Не просто список шагов в тексте, а правило реализации:
  &nbsp;
  - перед каждым критическим этапом обновляется currentStep;
  - в catch пишется именно текущее значение;
  - ledger_write используется только когда реально падает запись ledger, а не как общий финальный ярлык.
    Для bepaid и getcourse перечисли точные допустимые шаги в proof.
  &nbsp;
7. **Archive semantics опиши как временный sanctioned contract с обязательным switch-rule.**
  Сейчас идея правильная, но нужно жёстче:
  &nbsp;
  - пока нет canonical archive product id → target_type='product', target_key='{userId}:archive';
  - если canonical archive product id появится → pseudo-target запрещён;
  - это переключение должно быть отдельно отражено в proof как change of contract.
    И добавь verify, что сейчас canonical archive product id действительно отсутствует, иначе pseudo-target нельзя оставлять.
  &nbsp;
8. **Для machine-check добавь фактическую формулу и изоляцию подсчёта.**
  Недостаточно написать “before/after/diff”. Нужно зафиксировать:
  &nbsp;
  - proof_started_at;
  - префикс конкретного batch;
  - ожидаемый execute delta = 1 batch_start + N row-level, где N включает grant + skip + failed.
    И отдельно указать, что batch/meta и access rows считаются раздельно.
  &nbsp;
9. **Добавь двухуровневую проверку отсутствия entropy именно в identity/order path.**
  Не только общий grep по файлу, но и точечный verify для мест формирования:
  &nbsp;
  - rowSourceEventKey
  - source_subject_ref
  - deal_number
  - order_number
  - fallback identity
    Потому что общий grep может быть формально “0”, а недетерминизм останется в другой форме.
  &nbsp;
10. **Зафиксируй byte-identical drift guard для stableRowHash.**
  Нужно прямо в DoD/Verify:
  &nbsp;
  - реализация helper в двух файлах должна быть побайтно одинаковой;
  - одинаковы sorting rule, serialization rule и slice length;
  - любое расхождение = патч не принят.
  &nbsp;
11. **Добавь verify, что getcourse duplicate-check реально использует новый стабильный order_number, а не старую логику.**
  Сейчас в плане есть идея про GC-HASH-*, но этого мало.
  Нужно прямо проверить:
  &nbsp;
  - в createOrder нет двойного префикса GC-GC-HASH-*;
  - повторный импорт одной и той же строки без externalId идёт в duplicate path, а не создаёт новый order.
  &nbsp;
12. **Сохрани статус-последовательность спринта и не открывай новые code-идеи сверх этого scope.**
  В конце плана явно зафиксируй:
  &nbsp;
  - это **consolidated final code patch** по Sub-patch C;
  - после него допустим только один follow-up на proof/coverage/runtime finalization;
  - новые code-правки возможны только при новых фактах из verify/runtime, а не по новой серии микро-ревизий.
  &nbsp;

&nbsp;

&nbsp;

В остальном каркас плана уже нормальный: проблема, dry-run, execute, verify, stop-guards и DoD собраны правильно.

&nbsp;

# План: PATCH v22.6 Sub-patch C — Доработка по сверке (9 пунктов)

## Статус

```
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
CUTOVER_ALLOWED = NO
```

## Диагностика: текущее состояние кода

### Подтверждённые дефекты


| #   | Пункт                           | Файл                                       | Строки  | Проблема                                                                                                       |
| --- | ------------------------------- | ------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Date.now/Math.random            | getcourse-import-deals                     | 866-867 | `id: deal.externalId || Date.now() + Math.random()`, `deal_number: deal.externalId || \`IMP-${Date.now()}-...` |
| 2   | index в fallback identity       | bepaid (425), gc-file (816), gc-api (1279) | —       | `row:${index}:${hash}` — index в ключе делает identity зависимой от порядка строк                              |
| 3   | .single() в bepaid              | bepaid 544                                 | —       | `.single()` для existing order check — падает при 0 rows                                                       |
| 4   | archive semantics               | gc-file 910, 940                           | —       | `productId || 'archive'` без switch-rule                                                                       |
| 5   | failed_at_step                  | bepaid 947, gc-file 1045, gc-api 1418      | —       | везде `'row_processing'` — не детализирован                                                                    |
| 6-7 | machine-check dryRun/preview    | proof                                      | —       | числа заявлены, реальные before/after не приведены                                                             |
| 8   | Section A/B                     | proof                                      | —       | уже внесено ✅                                                                                                  |
| 9   | grep на entropy в identity path | —                                          | —       | не было                                                                                                        |


---

## Реализация

### 1. Убрать Date.now/Math.random + убрать index из identity

`**getcourse-import-deals/index.ts` line 865-867:**

Заменить:

```ts
id: deal.externalId || Date.now() + Math.random(),
deal_number: deal.externalId || `IMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
```

На:

```ts
const canonicalHash = await stableRowHash({
  source: 'gc_file',
  email: (deal.user_email || '').toLowerCase().trim(),
  phone: (deal.user_phone || '').trim(),
  first_name: (deal.user_first_name || '').trim(),
  last_name: (deal.user_last_name || '').trim(),
  amount: String(deal.amount || 0),
  paid_at: deal.paidAt || deal.createdAt || '',
  tariff_code: deal.tariffCode || '',
  access_start: deal.accessStartAt || '',
  access_end: deal.accessEndAt || '',
});
// ...
id: deal.externalId || 0,  // 0 = no external id, createOrder uses meta.gc_deal_id for dedup
deal_number: deal.externalId || `GC-HASH-${canonicalHash}`,
```

**Canonical payload для hash — явный список полей:**


| Поле                   | bepaid              | gc_file                 | gc_api                 |
| ---------------------- | ------------------- | ----------------------- | ---------------------- |
| source                 | `'bepaid'`          | `'gc_file'`             | `'gc_api'`             |
| email                  | payment.email       | deal.user_email         | deal.user_email        |
| phone                  | —                   | deal.user_phone         | deal.user_phone        |
| full_name / first+last | cardHolder          | first_name + last_name  | first_name + last_name |
| amount                 | payment.amount      | deal.amount             | deal.deal_cost         |
| currency               | payment.currency    | —                       | —                      |
| paid_at                | payment.paymentDate | deal.paidAt / createdAt | deal.deal_payed_at     |
| tariff_code / offer_id | description-based   | deal.tariffCode         | deal.offer_id          |
| access_start           | —                   | deal.accessStartAt      | —                      |
| access_end             | —                   | deal.accessEndAt        | —                      |


**Не входят в hash**: Date.now, Math.random, runtime UUID, index, время выполнения.

**Fallback identity (все 3 пути) — убрать index из ключа:**

Было: `{prefix}:row:${index}:${hash}` → Стало: `{prefix}:row:hash:${canonicalHash}`

`source_subject_ref` fallback: `hash:${canonicalHash}` (не `row:${index}`)

`index` допустим только в `result.row_index` как debug/trace.

**order_number contract для rows без externalId:**

- `deal_number = GC-HASH-${canonicalHash}` (тот же canonical hash)
- `createOrder` уже проверяет по `order_number` (`GC-${deal.deal_number}` → `GC-GC-HASH-${hash}`)
- Нужно упростить: если deal_number уже содержит `GC-HASH-`, то `order_number = deal_number` (без второго `GC-` prefix)

### 2. .single() → .maybeSingle() + multiple match handling в bepaid

`**bepaid-report-import/index.ts` line 540-544:**

Заменить `.single()` на `.maybeSingle()`. Но сначала — добавить count check:

```ts
const { data: existingOrders, error: orderCheckError } = await supabase
  .from('orders_v2')
  .select('id')
  .eq('order_number', orderNumber);

if (existingOrders && existingOrders.length > 1) {
  // Multiple matches — ambiguous, write diagnostic ledger
  // failed_at_step = 'order_lookup', error_message = 'multiple_existing_orders'
  // continue to next row
}
const existingOrder = existingOrders?.[0] || null;
```

Правило:

- 0 rows → normal create path
- 1 row → duplicate path (skip)
- > 1 row → failed/skip с `failed_at_step: 'order_lookup'`, `error_message: 'multiple_existing_orders'`

### 3. Archive semantics — временный sanctioned contract + switch-rule

Зафиксировать в коде комментарием и в proof:

```ts
// ARCHIVE PSEUDO-TARGET CONTRACT (sanctioned temporary):
// While no canonical archive product_id exists in products_v2:
//   target_type = 'product', target_key = '{userId}:archive'
// When canonical archive product_id is added:
//   switch to target_key = '{userId}:{archiveProductId}'
//   document change as "archive_target_contract_v2" in proof
```

### 4. failed_at_step через currentStep marker

Ввести stage-tracking переменную в каждом row handler:

```ts
let currentStep = 'row_parse';
try {
  currentStep = 'profile_resolve';
  // ... profile logic
  currentStep = 'order_lookup';
  // ... order check
  currentStep = 'order_create';
  // ... order insert
  currentStep = 'subscription_apply';
  // ... subscription
  currentStep = 'downstream_sync';
  // ... telegram call
  currentStep = 'ledger_write';
  // ... ledger
} catch (err) {
  // failed_at_step: currentStep ← автоматически текущий этап
}
```

**Списки этапов:**

getcourse (file + API):
`row_parse` → `profile_resolve` → `order_lookup` → `order_create` → `subscription_apply` → `downstream_sync` → `ledger_write`

bepaid:
`row_parse` → `profile_match` → `auth_user_resolve` → `order_lookup` → `order_create` → `payment_create` → `subscription_apply` → `profile_update` → `ledger_write`

### 5. Machine-check по watermark

В proof зафиксировать формат:

```sql
-- before
SELECT count(*) FROM access_grant_ledger
WHERE source_event_key LIKE 'bepaid-import%'
  AND created_at >= '{proof_started_at}';
-- result: 0

-- dryRun invocation
-- ...

-- after
SELECT count(*) FROM access_grant_ledger
WHERE source_event_key LIKE 'bepaid-import%'
  AND created_at >= '{proof_started_at}';
-- result: 0
-- diff = 0 ✅
```

Для execute check — ожидаемая формула:

```
+1 batch_start
+N row-level (grant + skip + failed = N)
total delta = 1 + N, где N = processed rows
```

### 6. Verify — двухуровневая проверка entropy

- Глобальный grep: `Date.now\(` и `Math.random\(` по обоим файлам
- Точечная проверка мест: `normalizedDeal.id`, `normalizedDeal.deal_number`, `rowSourceEventKey`, `source_subject_ref`, `orderNumber` — ни одно не содержит runtime entropy

### 7. stableRowHash drift guard

Подтвердить byte-identical реализацию в обоих файлах. Если sort/serialization отличается — STOP.

### 8. maybeSingle() verify — не только grep

Подтвердить:

- existence check в bepaid для order duplicate → уже не `.single()`
- нет второго `.single()` в той же логике

---

## dryRun / preview non-write contract (code level)

- bepaid: `dryRun=true` → ни batch_start, ни row-level ledger; guard: `if (!dryRun)` оборачивает batch_start; `if (batchId && batchSourceEventKey)` guards row-level
- getcourse preview: `action === 'preview'` → return до batch_start и import loop; ни одной ledger row

---

## Файлы


| Действие | Файл                                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Изменить | `supabase/functions/getcourse-import-deals/index.ts` (entropy, index, failed_at_step, archive contract, order_number)                                     |
| Изменить | `supabase/functions/bepaid-report-import/index.ts` (.single→select+length, index, failed_at_step)                                                         |
| Обновить | `.lovable/proofs/p0_batch_import_tree_proof.txt` (machine-check watermark, canonical hash fields, archive switch-rule, failed_at_step stages, grep proof) |
| Обновить | `.lovable/proofs/p0_ledger_contract_validation_proof.txt` (add-only: entropy elimination, maybeSingle, deterministic order_number)                        |


## Что НЕ изменяется

- frozen shared helpers
- Sub-patch A/B code
- UI, DDL
- batch_start / lineage / volume guard / downstream propagation logic (уже корректны)

## Scope

Sub-patch C = последний основной code patch по v22.6 main scope. Далее только consolidated follow-up на proof/coverage/runtime validation. Новые code-идеи допустимы только при новых фактах.

## DoD

1. `Date.now()` / `Math.random()` удалены из identity/order path в getcourse
2. `index` убран из source_event_key, source_subject_ref, deal_number fallback — только canonical hash
3. `.single()` заменён на select+length check с обработкой multiple matches
4. Archive semantics зафиксированы как sanctioned temporary contract с switch-rule
5. `failed_at_step` определяется через `currentStep` marker, список этапов зафиксирован per-import
6. Machine-check dryRun/preview с watermark `created_at >= proof_started_at`, формула `delta = 1 + N`
7. stableRowHash byte-identical в обоих файлах
8. Двухуровневый grep: глобальный + точечный по identity path
9. `phase1_ledger_cutover_at = NOT SET`