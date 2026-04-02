# да, согласен, с учетом правок:

&nbsp;

1. **Зафиксировать главную цель в начале плана.**
  Первым абзацем указать, что основная задача — починить цепочку
  **продукт → тариф → тренинг → сделка → доступ → срок доступа**.
  PATCH G делать параллельно как нормализацию historical standalone orders, но не как замену PATCH E/F/C/B.
2. **Не допускать повторного ухода в root product после split.**
  В PATCH G явно закрепить:
  &nbsp;
  - у каждого child order product_id = module_product_id;
  - использовать root CB20 в child order **запрещено**;
  - иначе split не решает ни отображение, ни выдачу доступов.
  &nbsp;
3. **PATCH G делать строго в 3 шага.**
  Оставить и явно выделить:
  &nbsp;
  - dry_run
  - execute_children_only
  - post_check
  - finalize_parents
    Parent orders не cancel до успешного post-check.
  &nbsp;
4. **В PATCH G добавить стоп-гард на scope.**
  Split применять только к заказам:
  &nbsp;
  - historical_purchase_type = 'module_only_standalone'
  - jsonb_array_length(module_list_mapped) > 1
  - status = 'paid'
  - reconcile_source = 'getcourse_historical'
  - только к 7 конкретным parent order IDs из dry-run.
  &nbsp;
5. **Для PATCH G price fields не описывать общими словами.**
  Перед execute обязателен discovery по existing single-module historical orders и таблица:
  &nbsp;
  - base_price
  - final_price
  - paid_amount
  - status
  - reconcile_source
  - структура purchase_snapshot
  - структура meta
    Child orders создавать строго по этой эталонной модели, без догадок.
  &nbsp;
6. **В PATCH G добавить явную двустороннюю связь parent/child.**
  У child:
  &nbsp;
  - split_from_order_id
  - split_from_order_number
  - split_batch_id
  - split_module_product_id
    У parent после finalize:
  - split_child_order_ids
  - split_child_order_numbers
  - split_status
  - canceled_reason = 'split_into_modules'
  &nbsp;
7. **PATCH F расширить на все места, где админ видит сделки/заказы.**
  В плане уже добавлены дополнительные файлы, но зафиксировать явно:
  сначала делается grep/discovery всех мест, где рендерится product_name, и только потом правки.
  Source of truth:
  &nbsp;
  - purchase_snapshot.display_purchase_name
  - fallback: products_[v2.name](http://v2.name)
  &nbsp;
8. **PATCH F — warning badge обязателен.**
  Если historical_purchase_type = 'module_only_standalone', но display_purchase_name пустой, показывать заметный warning Historical name missing.
9. **PATCH E не привязывать жестко к завершению PATCH G.**
  Отдельно зафиксировать:
  &nbsp;
  - repair logic должна работать **и до split, и после split**;
  - PATCH G упрощает данные, но не является обязательным единственным условием для выдачи entitlement.
  &nbsp;
10. **В PATCH E явно указать рекомендуемый режим execute.**
  Зафиксировать в плане:

&nbsp;

&nbsp;

&nbsp;

- default recommendation: partial_safe
- когда допускается partial_safe
- когда обязателен strict_hold
  Сейчас это надо оставить не как рассуждение, а как решение плана.

&nbsp;

&nbsp;

&nbsp;

11. **Для PATCH E добавить отдельный output по кандидатам до и после split.**
  Обязательные разделы dry-run:

&nbsp;

&nbsp;

&nbsp;

- pre_split_candidates
- post_split_candidates
- standalone_safe_candidates
- hold_candidates
  Чтобы было видно, как PATCH G реально улучшает PATCH E.

&nbsp;

&nbsp;

&nbsp;

12. **Царёву выделить как reference case в отдельный подпункт плана.**
  Не просто упоминание в тексте, а отдельный mini-DoD:

&nbsp;

&nbsp;

&nbsp;

- до фикса: 2 multi-module orders, неверный display в UI, нет entitlement
- после PATCH G/F/E: child orders, корректные module names, entitlement module_scope_only, expires_at = business_access_end_at, корректная видимость модулей

&nbsp;

&nbsp;

&nbsp;

13. **Таблица 4 standalone users — обязательный deliverable.**
  Оставить отдельным артефактом:
  | user_id | email | staff | business_sub_id | business_end | standalone_modules | root_cb20_entitlement | planned_fix |
14. **PATCH C дополнить деталями rule selector.**
  Для multi-rule selector показывать не только id, но и:

&nbsp;

&nbsp;

&nbsp;

- rule id
- tariff name
- access_mode
- is_active
- target_label

&nbsp;

&nbsp;

&nbsp;

15. **PATCH C — confirmation modal на delete сделать информативнее.**
  Добавить в impact preview:

&nbsp;

&nbsp;

&nbsp;

- rule id
- tariff
- access_mode
- target_label
- предупреждение, что owner тренинга не изменится, удаляется только rule-link

&nbsp;

&nbsp;

&nbsp;

16. **PATCH C — разделение owner-link и rule-link закрепить в плане жестко.**
  Указать отдельно:

&nbsp;

&nbsp;

&nbsp;

- rule-linked delete/edit не меняет owner
- owner нельзя отвязать из rule-linked меню
- для owned + rule-linked карточка одна, но действия строго разделены

&nbsp;

&nbsp;

&nbsp;

17. **PATCH B не оставлять как “проверим потом”.**
  Обязательный результат:

&nbsp;

&nbsp;

&nbsp;

- browser proof под admin
- browser proof под superadmin
- если не работает — fix в этом же спринте, а не отдельное будущее исследование

&nbsp;

&nbsp;

&nbsp;

18. **PATCH D proof tables привязать к главной бизнес-цепочке.**
  Оставить только load-bearing таблицы:

&nbsp;

&nbsp;

&nbsp;

- deal_display_resolution_table
- mapping_proof_table
- standalone_dry_run_table
- runtime_access_table
- lesson_edit_admin_proof
- standalone_4_users_table

&nbsp;

&nbsp;

&nbsp;

19. **DoD перестроить по приоритетам.**
  Первыми пунктами DoD должны идти:

&nbsp;

&nbsp;

&nbsp;

- в UI сделка показывает реальный модульный продукт
- entitlement создается/ремонтируется с правильным сроком
- training visibility соответствует покупке
- standalone/root inconsistencies устранены
  А split мультимодульных parent orders — отдельным supporting block ниже.

&nbsp;

&nbsp;

&nbsp;

20. **В конце плана добавить явное правило: ничего не удалять из текущего scope.**
  PATCH C/E/F/B остаются обязательными.
  PATCH G добавляется поверх них и не может вытеснить основную задачу.
21. **Итоговый execution order оставить именно таким:**
22. PATCH F — display names на всех UI
23. PATCH D — proof tables
24. PATCH G — dry-run split
25. PATCH G — execute_children_only
26. PATCH G — post-check
27. PATCH G — finalize_parents
28. PATCH E — dry-run repair
29. PATCH E — execute approved cohort
30. PATCH C — rule-linked management
31. PATCH B — browser proof admin/superadmin
32. **Убрать любые формулировки, которые звучат как отдельный новый проект.**
  Split historical multi-module orders — это supporting patch внутри основной задачи по доступам и корректному отображению сделок, а не новая самостоятельная ветка.

&nbsp;

&nbsp;

План: PATCH C + E + F + G + B — полная цепочка доступа + нормализация standalone orders

## Главная цель

Исправить цепочку **продукт → тариф → тренинг → сделка → доступ → срок доступа**. PATCH G (split мультимодульных) — параллельная нормализация исторических данных, не замена основных патчей.

**Add-only:** PATCH C/E/F/B остаются, G добавляется параллельно.

---

## Порядок выполнения

```text
1. PATCH F — display names на всех UI экранах
2. PATCH D — proof tables
3. PATCH G — dry-run → execute_children_only → post-check → finalize_parents
4. PATCH E — dry-run repair → execute approved cohort
5. PATCH C — rule-linked management (impact preview)
6. PATCH B — browser proof admin/superadmin
```

---

## PATCH F — Отображение модульных покупок на ВСЕХ экранах

### Проблема

Экраны, использующие только `products_v2.name` без проверки `purchase_snapshot.display_purchase_name`:


| Файл                                     | Как сейчас                       | Что исправить                                                            |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `DealDetailSheet.tsx` (552)              | ✅ Уже исправлен                  | —                                                                        |
| `AdminDeals.tsx` (409, 958)              | ✅ Уже исправлен                  | —                                                                        |
| `ContactPaymentsTab.tsx` (192-196)       | `products_v2.name` через FK join | Добавить `purchase_snapshot` в select, приоритет `display_purchase_name` |
| `LinkDealDialog.tsx` (71-110)            | `products_v2(name)` через FK     | Добавить `purchase_snapshot` в select, приоритет `display_purchase_name` |
| `LinkSubscriptionDealDialog.tsx` (62-91) | `products_v2(name)` через FK     | Аналогично                                                               |
| `ContactDealsDialog.tsx` (89-104)        | `productsMap.get(product_id)`    | Добавить `purchase_snapshot` в select, приоритет `display_purchase_name` |


### Source of truth

```text
1. purchase_snapshot.display_purchase_name → использовать
2. fallback → products_v2.name
3. IF historical_purchase_type = 'module_only_standalone' AND display_purchase_name IS NULL
   → warning badge "Historical name missing"
```

### Файлы для изменения

- `src/components/admin/ContactPaymentsTab.tsx` — добавить `purchase_snapshot` в query, resolution
- `src/components/admin/payments/LinkDealDialog.tsx` — добавить `purchase_snapshot` в query, resolution
- `src/components/admin/payments/LinkSubscriptionDealDialog.tsx` — аналогично
- `src/components/admin/bepaid/ContactDealsDialog.tsx` — добавить `purchase_snapshot` в query, resolution

---

## PATCH G — Split 7 мультимодульных standalone orders

### Критическое исправление плана

**product_id у child = module_product_id**, НЕ корневой CB20. Это ключевое отличие от предыдущей версии плана. Иначе split теряет смысл.

### Guards

- `historical_purchase_type = 'module_only_standalone'`
- `jsonb_array_length(module_list_mapped) > 1`
- `status = 'paid'`
- `reconcile_source = 'getcourse_historical'`
- Только 7 конкретных parent order IDs

### Двойная идемпотентность

1. По `order_number` (unique constraint)
2. По `meta.split_from_order_id + meta.split_module_product_id`

### Discovery: эталон single-module historical order

Перед execute обязательный discovery-запрос по existing single-module orders для копирования структуры 1:1:

- `status`, `reconcile_source`, `base_price`, `final_price`, `paid_amount`
- `purchase_snapshot` structure, `meta` structure

Child orders создаются по этой модели, но с `product_id = module_product_id`.

### Алгоритм (2 этапа)

**Файл: `supabase/functions/split-multi-module-orders/index.ts**` (новый)

**Этап 1: execute_children_only**

- Для каждого parent, для каждого module из `module_list_mapped`:
  - Child order: `product_id = module_product_id`, `order_number = {parent}-M{idx}`
  - `deal_date` = parent deal_date, `display_purchase_name = "ЦБ 2.0: {module_short_name}"`
  - Meta: `split_from_order_id, split_from_order_number, split_batch_id, split_module_product_id`
  - Price fields: копия из эталона single-module (discovery, не хардкод)
- Parent: обновить `meta.split_status = 'children_created'`, `meta.split_child_order_ids = [...]`

**Этап 2: finalize_parents** (отдельный вызов, только после post-check)

- Parent: `status = 'canceled'`, `meta.canceled_reason = 'split_into_modules'`, `meta.split_status = 'finalized'`

### Обязательные таблицы

**Dry-run:**
| parent_order_id | parent_order_number | profile_email | deal_date | module_product_id | module_name | proposed_child_order_number | existing_child_conflict | will_create |

**Post-check:**
| parent_order_number | expected_children | actual_children | all_module_ids_preserved | child_product_ids_valid | display_names_valid | parent_finalized |

---

## PATCH E — Standalone cohort repair + entitlements

### Независимость от PATCH G

Repair logic обязана работать и до split, и после split — через `module_list_mapped` из `purchase_snapshot`.

### Два блока в dry-run

- `pre_split_candidates` — на текущих данных
- `post_split_candidates` — после PATCH G

### Режимы (рекомендация по умолчанию)

**Рекомендуемый default: `partial_safe**`, потому что:

- Реальных кандидатов ≤ 2 (Царёва + katerina5515530)
- Большинство модулей маппятся 1:1 по children CB20 root
- `strict_hold` заблокирует ВСЕХ если хотя бы 1 модуль unmapped (Строительство может не сматчиться)
- `partial_safe` даёт доступ к доказанным модулям, unmapped фиксируется в meta

**Критерии:**

- `partial_safe` разрешён: если ≥1 модуль proven mapped, business_access_end_at NOT NULL
- `strict_hold` обязателен: если mapping_confidence = 'no_match' для ВСЕХ модулей

### Meta для entitlement (обязательные поля)

```text
scope_resolution_mode: 'module_scope_only'
historical_module_product_ids: [...]
mapped_training_module_ids: [...]
unmapped_historical_module_product_ids: [...]
mapping_version: 'v2_children_match'
mapping_confidence_summary: {...}
business_subscription_id: ...
source_access_end_at: business_access_end_at
```

### Proof по Царёвой (reference case)

**До фикса:**
| orders | deal_UI_name | entitlement |
| 2 multi-module | "Ценный бухгалтер 2.0" | ОТСУТСТВУЕТ |

**После фикса:**
| child_orders | mapped_training | entitlement | expires_at | visible_modules |

### Deliverable: standalone users table

| user_id | email | staff | business_sub_id | business_end | standalone_modules | root_cb20_entitlement | planned_fix |

---

## PATCH C — Rule-linked training management

### Текущее состояние

Уже реализовано (строки 574-700 `ProductLinkedTrainingsBlock.tsx`):

- Dropdown: Редактировать / Удалить связь / К правилам
- Multi-rule selection dialog
- Soft-disable через `is_active = false`
- Owner/rule-linked badges

### Что дополнить

1. **Impact preview перед удалением**: показать rule id, тариф, access_mode, target_label в confirmation dialog
2. **Details в multi-rule selector** (строки 677-696): сейчас только `Правило {idx}` и `ruleId.slice(0,8)` — добавить tariff name, access_mode, is_active
3. **Чёткое разделение**: owner-link actions нельзя вызвать через rule-linked меню, и наоборот

### Файлы

- `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` — impact preview + rule details в selector
- Загрузка деталей правил: добавить в `useRuleLinkedTrainings` или inline query для tariff/access_mode

---

## PATCH B — Admin lesson editing proof

Browser proof:

1. Открыть тренинг → уроки под admin
2. Edit урок → сохранить
3. Block editor → изменить → сохранить
4. Повторить под superadmin
5. Если не работает — конкретный fix в том же спринте

---

## PATCH D — Proof tables


| Таблица                         | Закрывает риск                       |
| ------------------------------- | ------------------------------------ |
| `deal_display_resolution_table` | UI показывает правильный модуль      |
| `mapping_proof_table`           | Модули Царёвой корректно маппятся    |
| `standalone_dry_run_table`      | Pre/post split кандидаты видны       |
| `standalone_users_table`        | 4 пользователя для ручной проверки   |
| `runtime_access_table`          | 3 кейса: full/partial/no             |
| `lesson_edit_admin_proof`       | Admin/superadmin может редактировать |


---

## Итоговый DoD

### Основная цепочка (первый приоритет)

- Сделка показывает правильный модульный продукт на ВСЕХ экранах
- Тариф/покупка дают корректный access
- Entitlement создаётся/ремонтируется с `expires_at = business_access_end_at`
- Training visibility соответствует покупке
- Warning badge при пустом `display_purchase_name` для standalone

### PATCH G (supporting)

- 7 parent → ~22 child orders, `product_id = module_product_id`
- `deal_date` сохранена, display_purchase_name = конкретный модуль
- Children created без финализации parent → post-check → finalize
- Двойная идемпотентность (order_number + meta split keys)
- 98 single-module orders не затронуты

### PATCH C

- Rule-linked edit/delete с impact preview и details
- Owner не меняется через rule-linked actions

### PATCH B

- Browser proof admin + superadmin lesson editing

### Scope boundary

- Никаких новых products/tariffs/training_modules не создаётся
- PATCH E repair работает и до, и после PATCH G
- DB schema не меняем (кроме insert/update orders и entitlements)