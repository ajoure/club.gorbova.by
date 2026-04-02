# да, согласен, с учетом правок:

&nbsp;

1. **Не закрывать PATCH H до price truth audit.**
  В плане правильно добавлен PATCH H3, но нужно зафиксировать жестче:
  PATCH H = done только после таблицы price_truth_audit, а не только после sum(children)=parent.
2. **Для Рыштаковой явно указать, что execute возможен только по одному модулю.**
  Сейчас это следует из таблицы, но нужно записать прямо:
  &nbsp;
  - partial_safe execute_scope = [Маркетплейсы]
  - Розничная торговля и Производство в entitlement **не включать**, так как active_lessons = 0.
  &nbsp;
3. **Для Царёвой добавить отдельный вывод, что mapping успешен.**
  Сейчас написано, что она blocked, но важно явно разделить причины:
  &nbsp;
  - mapping_ok = true
  - execute_block_reason = inactive content / zero active lessons
    Это исключает повторные попытки чинить mapping вместо контента.
  &nbsp;
4. **Decision matrix сделать не просто deliverable, а обязательным gate.**
  Добавить строку:
  Без заполненной decision matrix execute PATCH E и finalize PATCH G запрещены.
5. **В PATCH E dry_run обязать подрядчика показать не только edge-function output, но и DB cross-check.**
  Для approved/blocked users отдельно:
  &nbsp;
  - business_access_end_at
  - existing cb20 entitlement
  - target_expires_at
  - mapped_training_module_ids
  - visible_recursive_lesson_count
    Это должно совпасть 1:1 с proof tables.
  &nbsp;
6. **Уточнить PATCH H3 по zero-price кейсам.**
  Для Царёвой и других zero parents записать явно:
  &nbsp;
  - expected_module_price = 0
  - actual_child_price = 0
  - status = trivial_match
    Чтобы потом не возвращаться к этим кейсам.
  &nbsp;
7. **Добавить обязательную таблицу execute payload preview для Рыштаковой.**
  Перед execute подрядчик должен показать финальный payload entitlement:
  &nbsp;
  - user_id
  - product_id
  - product_code
  - scope_resolution_mode
  - mapped_training_module_ids
  - unmapped_historical_module_product_ids
  - expires_at
  - business_subscription_id
  - mapping_version
    Без этого execute не запускать.
  &nbsp;
8. **PATCH G finalize_parents разрешать только после post-execute proof по Рыштаковой.**
  Сейчас написано “после PATCH E”. Нужно точнее:
  &nbsp;
  - execute completed
  - entitlement реально создан
  - expires_at = business_access_end_at
  - UI/runtime proof собран
    Только после этого finalize parents.
  &nbsp;
9. **В reference-case block для Рыштаковой добавить expected runtime result.**
  Не просто “execute candidate”, а:
  &nbsp;
  - после execute пользователь видит только модуль Маркетплейсы
  - другие child orders остаются историей покупки, но не дают доступ к inactive content.
  &nbsp;
10. **В reference-case block для Царёвой добавить expected manual path.**
  Явно записать:
  &nbsp;
  - repair не выполняется в этом спринте
  - следующий шаг только после активации уроков/контента
  - после активации контента требуется повторный dry-run, а не прямой execute.
  &nbsp;
11. **Добавить в план таблицу entitlement_uniqueness_check.**
  Перед и после execute:
  &nbsp;
  - email
  - existing_active_cb20_entitlements_count
  - expected_after_execute
  - duplicate_risk
    Это нужно, чтобы не создать дубль entitlement.
  &nbsp;
12. **Зафиксировать, что PATCH B не должен блокировать G/E finalize-decision по данным.**
  Browser proof уроков важен, но он не должен тормозить решение по entitlement/split, если DB/UI proof по сделкам и доступам уже собран.
  То есть PATCH B оставить в конце, но не делать hard blocker для PATCH E.
13. **В блоке “Файлы для изменения” добавить возможную точечную правку repair function только при расхождении dry-run и proof tables.**
  Иначе подрядчик может начать лишние правки без новых фактов.
14. **Итоговый порядок работ переписать так:**
  &nbsp;
  - PATCH H3 price_truth_audit
  - PATCH E1 pre-execute proof Рыштакова
  - PATCH E2 blocked proof Царёва
  - decision_matrix + entitlement_uniqueness_check
  - PATCH E dry_run + DB cross-check
  - PATCH E execute only approved users
  - post-execute proof
  - PATCH G finalize_parents
  - PATCH B browser proof
  &nbsp;
15. **Финальный expected outcome записать явно:**
  &nbsp;
  - Рыштакова — partial_safe executed
  - Царёва — blocked/manual_review
  - parent multi-module orders — finalized only after execute-proof
  - child orders — prices/truth verified
  - titles consistent across UI
  &nbsp;

&nbsp;

&nbsp;

План: PATCH E dry_run + reference proofs + price truth audit + decision matrix

## Контекст

Данные после PATCH G/H/I/J:

- 22 child orders созданы, цены нормализованы (sum = parent)
- UI badges для split parent/child deployed
- System-wide audit completed (PATCH J)

Фактическое состояние reference-cases:

**Рыштакова ([katerina5515530@gmail.com](mailto:katerina5515530@gmail.com)):**

- 3 child orders: GC-3831920-M1 (83.33), M2 (83.33), M3 (83.34)
- BUSINESS active, access_end_at = 2026-04-18
- Из 3 модулей только **Маркетплейсы** имеет 5 active lessons
- Розничная торговля: 0 active lessons
- Производство: 0 active lessons
- **Статус: partial_safe candidate** (1 из 3 модулей с active content)

**Царёва ([irinkazar@inbox.ru](mailto:irinkazar@inbox.ru)):**

- 3 child orders: GC-1767629483208-M1/M2/M3, все с ценой 0.00
- BUSINESS active, access_end_at = 2026-04-18
- Все 3 matched модуля (Розничная торговля, Грузо, Производство): 0 active lessons
- **Статус: blocked / runtime_preview_zero_visibility**

## Что будет сделано

### 1. PATCH H3 — price truth audit

Генерация таблицы сопоставления цен child orders с бизнес-ожиданием:

| email | parent_order | child_order | module_name | actual_child_price | expected_module_price | price_source | match |

Правило расчёта: `parent_final / module_count`, remainder на последнем child.
Для zero-price parents — trivial match.

Особый кейс Рыштаковой: parent = 250 / 3 модуля = 83.33 per module. Это единственный доступный исторический source цены. Альтернативного source (отдельная цена за модуль) в системе нет.

**Deliverable:** `/mnt/documents/patch_h3_price_truth_audit.csv`

### 2. PATCH E1 — pre-execute proof для Рыштаковой

Обязательная таблица перед execute:


| child_order   | display_purchase_name      | final_price | matched_training_module_id | matched_training_module_title | active_lessons | included_in_entitlement |
| ------------- | -------------------------- | ----------- | -------------------------- | ----------------------------- | -------------- | ----------------------- |
| GC-3831920-M1 | ЦБ 2.0: Розничная торговля | 83.33       | 1ede03b4                   | РОЗНИЧНАЯ ТОРГОВЛЯ            | 0              | ❌ (0 lessons)           |
| GC-3831920-M2 | ЦБ 2.0: Производство       | 83.33       | a4a5102d                   | ПРОИЗВОДСТВО                  | 0              | ❌ (0 lessons)           |
| GC-3831920-M3 | ЦБ 2.0: Маркетплейсы       | 83.34       | 4c97d21c                   | Маркетплейсы                  | 5              | ✅                       |


**Планируемый entitlement:**

- scope_resolution_mode = module_scope_only
- mapped_training_module_ids = [4c97d21c] (только Маркетплейсы)
- expires_at = 2026-04-18 (= business_access_end_at)
- режим: partial_safe

### 3. PATCH E2 — blocked proof для Царёвой


| child_order         | module_name                 | matched_training_module_id | active_lessons | block_reason        |
| ------------------- | --------------------------- | -------------------------- | -------------- | ------------------- |
| GC-1767629483208-M1 | Розничная торговля          | 1ede03b4                   | 0              | zero_active_lessons |
| GC-1767629483208-M2 | Грузо- и пассажироперевозки | 8f71d4a8                   | 0              | zero_active_lessons |
| GC-1767629483208-M3 | Производство                | a4a5102d                   | 0              | zero_active_lessons |


**Итог:** repair blocked by inactive content, not by mapping. Все 3 модуля сматчены, но 0 active lessons.

### 4. Decision matrix (обязательный gate)


| email           | split_normalized | prices_verified | mapping_ok     | active_lessons>0 | execute_allowed | final_action               |
| --------------- | ---------------- | --------------- | -------------- | ---------------- | --------------- | -------------------------- |
| katerina5515530 | ✅                | ✅               | ✅ (1/3)        | ✅ (partial)      | ✅ partial_safe  | execute: Маркетплейсы only |
| irinkazar       | ✅                | ✅ trivial       | ✅ (3/3 mapped) | ❌ (0/3)          | ❌               | blocked: manual_review     |
| a.bruylo        | ✅                | ✅ trivial       | —              | —                | ❌               | staff_skip                 |


### 5. PATCH E dry_run через edge function

Вызов `repair-cb20-entitlements` с `dry_run: true, standalone_mode: "partial_safe"`.
Результат разделить на два блока:

- **post_split_candidates** — пользователи с active lessons > 0
- **still_blocked** — пользователи с 0 visible lessons

### 6. Обновление .lovable/plan.md

Зафиксировать:

- PATCH E разделён на E1 (partial_safe execute candidate) и E2 (blocked/manual_review)
- Reference-case statuses с фактическими данными
- Decision matrix как обязательный deliverable
- PATCH H незакрыт до price_truth_audit

## Порядок работ

```text
1. PATCH H3 — price_truth_audit CSV
2. PATCH E1 — pre-execute proof Рыштакова
3. PATCH E2 — blocked proof Царёва
4. Decision matrix
5. PATCH E dry_run (edge function)
6. Обновление plan.md
```

Далее (после согласования dry_run результатов):

```text
7. PATCH E execute only approved (Рыштакова partial_safe)
8. PATCH G finalize_parents
9. PATCH B browser proof
```

## Ограничения текущего шага

- Не создаются новые продукты/тренинги/уроки
- Не решается контентная проблема inactive lessons у Царёвой
- Для blocked case — proof и manual decision, не автоматический repair
- Execute запрещён без decision matrix
- Finalize parents запрещён до завершения PATCH E

## STOP-guards перед finalize

- Цены подтверждены по business truth (H3)
- Split-parent не мешает child визуально (I)
- Titles consistent across all UI (F/I)
- Reference proofs для Рыштаковой и Царёвой собраны
- Execute/blocked outcome documented per user

## Файлы для изменения

- `.lovable/plan.md` — обновление статусов и reference-case data
- При отклонениях dry-run — точечные правки в `supabase/functions/repair-cb20-entitlements/index.ts`
- Генерация `/mnt/documents/patch_h3_price_truth_audit.csv`