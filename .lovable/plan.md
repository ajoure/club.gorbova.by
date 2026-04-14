# да, согласен, с учетом правок:

&nbsp;

1. **Блок B (merge module pipelines) нужно сделать с жёстким guard на непредвиденные сделки.**
  Перед execute обязательно проверить по 8 module-pipelines:
  &nbsp;
  - есть ли там **что-то кроме paid**;
  - есть ли сделки не в closed_won;
  - есть ли вообще записи, которые не должны уехать в Ценный бухгалтер | 1 ступень 2.0.
    Если в этих pipeline есть не только успешные сделки, не переносить всё SQL-ом “по pipeline_id IN (...)” вслепую. Сначала показать breakdown и только потом выполнять merge.
  &nbsp;
2. **В merge лучше зафиксировать безопасный порядок как idempotent execute.**
  Нужно явно прописать:
  &nbsp;
  - найти target pipeline Ценный бухгалтер | 1 ступень 2.0;
  - найти её stage Успешно;
  - проверить source pipelines;
  - перенести сделки;
  - перепривязать bindings;
  - verify, что source pipelines пусты;
  - только потом удалить stages и pipelines.
    Если pipeline уже удалена/частично перенесена, patch должен отработать повторно безопасно, без дублей и without fail.
  &nbsp;
3. **В delete pipeline UI лучше не “предупреждать”, а реально блокировать удаление непустых/bound pipelines.**
  Сейчас в плане формулировка мягкая. Лучше жёстко:
  &nbsp;
  - если в pipeline есть сделки — delete запрещён;
  - если на pipeline висят crm_pipeline_product_bindings — delete запрещён;
  - сначала cleanup/remap, потом delete.
    Для Основной — delete полностью недоступен.
  &nbsp;
4. **Normalization block в целом верный, но нужен proof по affected rows именно после merge.**
  Так как модули сначала вливаются в ЦБ 1 ступень 2.0, потом идёт normalization, в verify нужно отдельно показать:
  &nbsp;
  - сколько legacy deals нормализовано в ЦБ 1 ступень 2.0;
  - сколько legacy deals нормализовано в ЗАКРОЙ ГОД;
  - что исключённые продукты (Gorbova Club, Платная консультация) не изменились.
  &nbsp;
5. **Для normalization добавить machine-check не только по counts, но и по суммам “до/после” по каждой затронутой pipeline.**
  Минимум:
  &nbsp;
  - Ценный бухгалтер | 1 ступень 2.0
  - ЗАКРОЙ ГОД
  - grand total all successful after normalization
    И отдельно — skipped = 0/не 0, если что-то не обновилось.
  &nbsp;
6. **Блок A по drag fix усилить одним конкретным правилом.**
  Для source card во время drag:
  &nbsp;
  - не просто opacity-30, а проверить, что нет визуального второго полноценного экземпляра карточки;
  - если двоение остаётся, скрывать source card сильнее (opacity-0 или placeholder-only mode) на время drag.
    То есть criterion успеха — не CSS-значение, а отсутствие визуального дубля.
  &nbsp;
7. **В KanbanColumn fix нужен не просто “stable callback”, а реально убрать inline function из map.**
  Это важный пункт. В плане лучше явно написать:
  &nbsp;
  - карточка получает dealId и onOpenDeal,
  - внутри карточки сама вызывает onOpenDeal(dealId),
  - никаких inline lambda в .map() для onOpen.
    Иначе React.memo останется частично бесполезным.
  &nbsp;
8. **В final proof после всех execute обязательно показать selector/pipeline usability.**
  После merge и cleanup должно быть доказано:
  &nbsp;
  - module-pipelines исчезли;
  - осталась одна pipeline Ценный бухгалтер | 1 ступень 2.0;
  - selector не засорён лишними pipeline;
  - rename/delete controls работают.
  &nbsp;
9. **Итоговое дополнение к плану:**

&nbsp;

```
Добавь к плану следующие обязательные правки.

1. Перед merge 8 module-pipelines обязательно сделать dry-run breakdown:
- pipeline_id
- total deals
- paid deals
- non-paid deals
- closed_won / not closed_won
Если в source pipeline есть что-то кроме ожидаемых successful deals — стоп и показать это отдельно.

2. Merge выполнять только в idempotent-safe порядке:
- найти target pipeline + target stage "Успешно"
- проверить source pipelines
- перенести сделки
- перепривязать bindings
- verify source pipelines empty
- только потом удалить source stages и source pipelines

3. Delete pipeline UI:
- delete запрещён для pipeline с сделками
- delete запрещён для pipeline с product bindings
- Основную не удалять вообще
- не ограничиваться просто warning, нужен реальный guard

4. После normalization дать proof:
- affected rows
- totals before/after
- отдельно по `Ценный бухгалтер | 1 ступень 2.0`
- отдельно по `ЗАКРОЙ ГОД`
- исключённые продукты не изменились

5. Drag fix считать успешным только если визуально нет дубля source card.
Если `opacity-30` не решает — перейти на placeholder-only/hidden source state во время drag.

6. В `KanbanColumn` убрать inline onOpen lambda из `map()`.
Карточка должна сама вызывать `onOpenDeal(dealId)` внутри себя.

7. В финальном proof показать selector после cleanup:
- module-pipelines удалены
- target pipeline осталась одна
- selector usable
- rename/delete UI работает
```

После этих правок план можно исполнять.

&nbsp;

План: финальный consolidated patch

## Текущее состояние (из БД)

**Pipelines:** 18 штук (Основная + 17 product-pipelines).
**Module pipelines для merge:** 8 шт (Розничная торговля, Производство, Маркетплейсы, Грузо-/пассажироперевозки, Общепит, Строительство, ПВТ, Учёт у ИП) — итого 51 deal.
**Target pipeline:** `a0000001-...02` «Ценный бухгалтер | 1 ступень 2.0», closed_won stage `b0000001-0002-...03`.

**Normalization dry-run (final_price > 2700, исключая Gorbova Club и Платную консультацию):**


| Продукт                    | Deals   | Total before  | Total after (÷27) | Delta          |
| -------------------------- | ------- | ------------- | ----------------- | -------------- |
| ЗАКРОЙ ГОД                 | 80      | 1 465 451     | 54 276            | -1 411 175     |
| ЦБ 1 ступень 2.0           | 71      | 2 996 121     | 110 968           | -2 885 154     |
| Модуль: Розничная торговля | 2       | 19 210        | 711               | -18 498        |
| Модуль: Маркетплейсы       | 1       | 9 608         | 356               | -9 252         |
| Модуль: Производство       | 1       | 9 602         | 356               | -9 246         |
| Модуль: Строительство      | 1       | 9 608         | 356               | -9 252         |
| **Итого**                  | **156** | **4 509 589** | **166 022**       | **-4 343 567** |


---

## 4 блока изменений

### A. Drag/Move performance final fix

**KanbanDealCard.tsx:**

- Source card при drag: заменить `isDragging && "shadow-xl scale-105 opacity-80"` → `isDragging && "opacity-30 pointer-events-none"` (ghost placeholder)
- Move button: убрать `bg-muted/60 rounded-full`, уменьшить до `h-3 w-3`, иконка `h-2 w-2`, оставить `min-w-[24px] min-h-[24px]` для touch

**KanbanColumn.tsx (строка 149):**

- `onOpen={() => onOpenDeal(deal.id)}` — inline lambda ломает `React.memo`. Исправить: карточка уже знает `deal.id`, нужно передавать `onOpenDeal` напрямую и вызывать `onOpenDeal(deal.id)` внутри карточки (изменить Props карточки: `onOpen` → `onOpenDeal + dealId`)

### B. Merge 8 module pipelines → ЦБ 1 ступень 2.0

**Порядок execute (через insert tool):**

1. `UPDATE orders_v2 SET pipeline_id = 'a0000001-...02', pipeline_stage_id = 'b0000001-0002-...03' WHERE pipeline_id IN (8 module pipeline IDs)`
2. `DELETE FROM crm_pipeline_product_bindings WHERE pipeline_id IN (8 IDs)`
3. Rebind 8 module product_ids к pipeline `a0000001-...02`: `INSERT INTO crm_pipeline_product_bindings (pipeline_id, product_id) VALUES ...`
4. Verify source pipelines empty
5. `DELETE FROM crm_pipeline_stages WHERE pipeline_id IN (8 IDs)`
6. `DELETE FROM crm_pipelines WHERE id IN (8 IDs)`
7. Audit: `pipeline.module_merge`

### C. Pipeline management UI

**AdminDeals.tsx**, pipeline selector (строки 844-868):

- Для каждой pipeline (кроме Основной) добавить inline кнопки: rename + delete
- Для Основной: только rename
- State: `renamePipelineTarget`, `deletePipelineTarget`
- Rename → Dialog с Input
- Delete → guard: если pipeline непустая → AlertDialog с предупреждением; если есть bindings → предупредить; если пустая → подтверждение и удаление
- Переиспользовать `renamePipeline` / `deletePipeline` из `usePipelines` (уже есть и уже с guard на непустые)

### D. Normalization: RUB → BYN (÷27)

**Execute (через insert tool, после merge):**

```sql
UPDATE orders_v2 
SET final_price = round(final_price / 27.0, 2)
WHERE status = 'paid'
  AND final_price > 2700
  AND product_id NOT IN (
    '11c9f1b8-...', -- Gorbova Club
    '9d0d6de8-...'  -- Платная консультация
  )
```

Единый UPDATE — покрывает ЦБ 1 ступень, ЗАКРОЙ ГОД и все модули (156 deals).

**Audit:** `deal.bulk_normalize_rub_to_byn_legacy_amounts` с meta: affected=156, rate=27, threshold=2700, excluded products.

---

## Порядок execute

1. **A** — код: drag fix + move icon
2. **B** — data: merge module pipelines
3. **B verify** — counts
4. **D** — data: normalization ÷27
5. **D verify** — sums before/after
6. **C** — код: pipeline management UI
7. **Final proof** — machine-check

## Изменяемые файлы


| Файл                                  | Что                                                  |
| ------------------------------------- | ---------------------------------------------------- |
| `KanbanDealCard.tsx`                  | Drag opacity fix, move icon уменьшить, stable onOpen |
| `KanbanColumn.tsx`                    | Stable onOpenDeal callback                           |
| `AdminDeals.tsx`                      | Pipeline rename/delete UI                            |
| Data: `orders_v2`                     | Merge deals + normalize amounts                      |
| Data: `crm_pipelines`                 | Delete 8 module pipelines                            |
| Data: `crm_pipeline_stages`           | Delete 32 module stages                              |
| Data: `crm_pipeline_product_bindings` | Rebind modules                                       |
| Data: `audit_logs`                    | merge + normalization audit                          |


## DoD

1. Drag: source card → placeholder (opacity-30), один ghost, без двоения
2. Move icon уменьшена до h-3 w-3
3. 8 module pipelines слиты в ЦБ 1 ступень 2.0
4. Module bindings перепривязаны
5. 156 legacy deals нормализованы (÷27)
6. Исключены: Gorbova Club, Платная консультация
7. Pipeline rename/delete UI в selector
8. Guard для непустых/bound pipelines
9. Основная защищена от удаления
10. Summary/pipeline sums реалистичны
11. Audit записи по merge и normalization
12. Machine-check proof: counts + sums per pipeline