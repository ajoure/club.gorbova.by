
# Business → ЦБ 2.0 Bonus Access Normalization
## Утверждённое бизнес-решение: Variant B

### Каноническое правило (обязательно для всех фаз)
- **historical full tariff purchase** → `full_tariff_scope`
- **historical standalone module purchase** → `module_scope_only` (только если mapping в training subtree доказан)
- **historical full tariff + standalone modules** → `union_scope`
- **no historical purchase** → `no_scope` (доступ к ЦБ через Business НЕ выдаётся)
- `module_only_standalone` НИКОГДА не является основанием для `full_cb20_access`
- Спорные кейсы → только `manual_review`, без массовой выдачи

---

## PHASE A: Discovery & Proof

### A.1 Канонический join-path (proof)
```
subscriptions_v2.user_id → profiles.user_id → profiles.id → orders_v2.profile_id
entitlements.user_id → subscriptions_v2.user_id
```
- Доказать отсутствие ложных совпадений при OR (profile_id OR user_id)
- Зафиксировать: join по `user_id` приоритетен, join по `profile_id` — вспомогательный

### A.2 Business effective end — Source of Truth
- Канонический источник: `subscriptions_v2.access_end_at` для BUSINESS подписки
- Единственный источник для align во всех фазах

### A.3 Historical purchase validity matrix
| historical_purchase_type | valid_for_full_cb20 | valid_for_module_scope | requires_manual_review | why |
|---|---|---|---|---|
| base_tariff_purchase | true | true | false | Полный тариф = полный scope |
| module_only_standalone | false | true* | if mapping unconfirmed | *Только при доказанном mapping |
| module_child_purchase | false | true* | if mapping unconfirmed | Аналогично standalone |
| no_purchase | false | false | false | Нет покупки = нет доступа |

### A.4 module_list_mapped → training subtree mapping (proof)
| module_product_id | module_product_name | matched_training_module_id | match_type | confidence |
|---|---|---|---|---|
Все `inferred_name` и `no_match` → `manual_review`, не участвуют в execute.

### A.5 Target products reality check (9 products из rule 1b497fba)
| product_id | product_name | paid_orders_count | active_entitlements | linked_training_modules | has_training_content_rules | usable_now | why |

### A.6 Runtime read-path приоритет (proof)
1. entitlement/product path (каноническиий)
2. training_content rules path
3. module_access legacy path
Доказать текущий порядок в коде. Зафиксировать, что legacy не должен расширять доступ для cb20.

### A.7 Business users classification
| class | count_users | with_active_ent_cb20 | without_ent | expires_mismatch |
|---|---|---|---|---|
| base_only | | | | |
| base+standalone | | | | |
| standalone_only | | | | |
| no_cb_purchase | | | | |
| other | | | | |

### A.8 Подтверждённые факты discovery
- Основной продукт ЦБ 2.0: `7101ed3c`
- Root training module: `c9f7e9b8`
- 8 target products без training_modules и training_content rules
- Runtime при bonus entitlement без tariff context → full access = **доказанный дефект**
- `module_only_standalone` хранится в `purchase_snapshot.module_list_mapped`

### A.9 Нормативное решение по scope бонуса
**Утверждён Variant B:**
- Business + standalone history → открыть только mapped modules
- Business + full tariff history → открыть по матрице тарифа
- Business + no cb purchase → не открывать
- PHASE D execute запрещён без этого решения ✅ Решение принято

---

## PHASE B: Historical Normalization

### Proof-матрица по каждому historical типу
| purchase_type | valid_for_full_cb20 | valid_for_module_scope | why |
|---|---|---|---|
- `module_only_standalone` НЕ считается valid prior_purchase for full cb20
- `module_child_purchase` НЕ считается valid prior_purchase for full cb20

---

## PHASE C: Duration & Metadata Fix

### C.1 align_with_source mechanism
- `bonus_expires_at = business_effective_end_at` (из `subscriptions_v2.access_end_at`)
- Повторный rerun → align, не extend
- `current expires_at > business_effective_end_at` → `manual_review` (не резать молча)
- `current expires_at < business_effective_end_at` → `align_to_business`
- Применяется при create И при repair existing entitlement

### C.2 Обязательные поля entitlement.meta
```json
{
  "business_subscription_id": "uuid",
  "business_tariff_id": "uuid",
  "source_access_end_at": "iso_date",
  "historical_purchase_type": "base_tariff|module_standalone|module_child",
  "historical_tariff_id": "uuid|null",
  "historical_module_product_ids": ["uuid"],
  "scope_resolution_mode": "full_tariff|module_only|union|no_scope"
}
```

### C.3 Source alignment context
Хранение: в `entitlement.meta` (поля выше). Дополнительно в `access_grant_ledger.result`.

### C.4 Правило для existing entitlements
Если cb20 entitlement существует, но в meta нет `historical_purchase_type` / `scope_resolution_mode` / `business_subscription_id`:
- НЕ считается нормализованным → bucket `repair_metadata_only` или `repair_metadata_and_align`
- НЕ попадает в `noop`

### C.5 Правило для недоказуемых entitlements
Entitlement без `scope_resolution_mode` и без `historical_*` metadata → `manual_review/backfill_repair`

---

## PHASE D: Batch Repair

### D.1 Action buckets (6 состояний)
1. `create` — новый entitlement
2. `align_to_business` — выровнять expires_at
3. `repair_metadata_only` — дополнить meta без изменения срока
4. `repair_metadata_and_align` — дополнить meta + выровнять срок
5. `noop` — полностью нормализован
6. `manual_review` — требует ручного решения

### D.2 Scope buckets (5 состояний)
1. `full_tariff_scope`
2. `module_scope_only`
3. `union_scope`
4. `no_scope`
5. `manual_review`

### D.3 Dry-run output (обязательные поля)
| profile_id | user_id | business_sub_id | business_access_end_at | historical_class | historical_basis | current_ent_expires_at | planned_action | scope_bucket | reason |

### D.4 STOP-guards
- Staff/internal users (`@ajoure.by`) → не трогать автоматически
- Спорные imported/manual/ghost history → только `manual_review`
- Без уверенного `profile_id + product_id` match → только `manual_review`
- `standalone_only` с неподтверждённым mapping → только `manual_review` (не create)

### D.5 Denylist / protected list
Явный список исключений из автоматического execute.

### D.6 Post-check proof (обязателен после execute)
- Всего Business users
- С нормализованным cb20 entitlement
- В manual_review
- expires_mismatch осталось
- Без обязательной meta
- standalone_only с module_scope_only (не full scope) ✅

### D.7 Правило execute
Execute разрешён ТОЛЬКО после:
1. Корректный dry-run по action и scope buckets
2. standalone_only не получают full access
3. Спорные кейсы не в массовой выдаче
4. Runtime после фикса открывает только разрешённый scope

---

## PHASE E: "0 уроков" Fix

### E.1 Разделение двух проблем
- **count bug**: UI считает direct lessons вместо recursive
- **scope bug**: runtime доступ режет children из-за отсутствия tariff/historical scope
- Доказать отдельно: что ломает count, что ломает access, что первично, какой фикс первым

### E.2 Proof-блок по root-модулю ЦБ
| root_module_id | direct_lesson_count | recursive_lesson_count | visible_recursive | visible_child_modules | hidden_due_to_scope | hidden_due_to_is_active |

### E.3 Proof "почему раньше показывало 0 уроков"
| metric | value | reason |
Отдельно: count bug, scope bug, или оба.

### E.4 Runtime proof после фикса (4 класса пользователей)
| user_class | db_state | resolver_result | ui_visible |
|---|---|---|---|
| base_only | | | |
| base+standalone | | | |
| standalone_only | | | |
| no_cb_purchase | | | |

### E.5 Proof: lesson count = effective scope
| effective_scope_module_ids | visible_module_ids | visible_lesson_count_recursive | hidden_module_ids_due_to_scope |

### E.6 STOP-guard: пустой scope
- effective scope пустой → root НЕ показывается как "0 уроков", а как "нет доступа"
- Различать: 0 уроков (scope пустой) vs 0 уроков (дерево реально пустое)

### E.7 STOP-guard: root без children
- Root-модуль НЕ становится "видимым", если ни к одному child нет доступа

---

## PHASE F: Self-Rules & Legacy Audit

### F.1 Impact matrix по access_rules
| rule_id | target_product | trigger | creates | duplicates_paid | can_create_perpetual | recommended_action |

### F.2 Legacy module_access: итоговое решение
Для product-linked модулей cb20:
- **Либо** исключить module_access из baseAccess path
- **Либо** оставить как secondary fallback только для модулей без product_id
- Оставлять в текущем OR-виде **запрещено**

### F.3 Legacy contour audit
| path | active_read_path | deprecated_read_path | conflict |
|---|---|---|---|

---

## PHASE G: Документация

### G.1 Обновление после каждой фазы
- После A: карта SoT и proof boundaries
- После C: новая модель срока и runtime scope
- После D: batch dry-run/execute proof
- После E: runtime/UI proof по урокам

### G.2 Обязательные матрицы в документации
1. Historical purchase validity matrix
2. Target products reality check
3. Business → historical type → effective scope matrix

### G.3 Разделение по доказанности
- Подтверждено SQL/FK
- Подтверждено runtime
- Inference
- Pending proof

---

## Definition of Done (19 пунктов)

1. Бонусный доступ к ЦБ выдаётся только при наличии исторической покупки
2. Срок бонуса = сроку BUSINESS подписки
3. Scope определяется строго по Variant B
4. Все 4 класса пользователей проверены runtime proof
5. Count bug и scope bug исправлены раздельно с доказательством
6. Документация содержит proof-матрицы, а не только narrative
7. Legacy module_access не расширяет доступ для cb20 path
8. 8 target products rule 1b497fba объяснены архитектурно
9. module_only_standalone не смешивается с full cb20 purchase
10. Runtime не даёт full cb20 access из-за entitlement без tariff context
11. Документ trainings_access содержит матрицу BUSINESS → cb20 → historical type → scope
12. module_list_mapped доказанно маппится в training subtree ИЛИ спорные исключены
13. Каждый repaired entitlement трассируется до business_subscription_id и historical_purchase_type
14. standalone_only не получают full cb20 access ни при каком fallback
15. Канонический join-path доказан и не создаёт ложных совпадений
16. Source of truth для business_effective_end_at один и используется везде
17. Existing cb20 entitlements нормализованы по meta-трассировке
18. После execute не осталось cb20 bonus entitlements без scope_resolution_mode
19. Документация содержит секцию «Подтверждено / Inference / Pending proof»
