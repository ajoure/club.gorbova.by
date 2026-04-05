## да, согласен, с учетом правок:

&nbsp;

1. В valid_rule_based_bonus добавить обязательную проверку **срока** parent-basis:
  &nbsp;
  - parent subscription/status must be active/trial
  - parent access_end_at must be > now() или NULL
  - если parent найден, но истёк/отменён, это не valid_rule_based_bonus, а отдельный bucket illegal_bonus_access
  &nbsp;
2. Для 18 entitlements ЦБ 1 ступени без active Gorbova Club sub не называть их сразу bonus_access_without_parent_trace. Сначала разделить:
  &nbsp;
  - есть paid order на сам target product → это отдельный сценарий
  - нет paid order target product, но есть historical parent trace
  - нет ни target paid order, ни parent trace
    И только после этого классифицировать.
  &nbsp;
3. В 02_should_vs_actual_global.csv добавить ещё поля:
  &nbsp;
  - classification_status
  - basis_confidence
  - parent_product_id
  - parent_subscription_id
  - required_order_id
  - required_order_status
  - duration_source
  - duration_expected_end_at
    Чтобы было видно не только basis, но и почему именно срок считается корректным или нет.
  &nbsp;
4. В 05_bonus_child_drift_global.csv сравнивать не только child_ent.expires_at > parent_sub.access_end_at, но и:
  &nbsp;
  - child_ent.expires_at < parent_sub.access_end_at
  - child_ent.expires_at IS NULL
  - parent_sub.access_end_at IS NULL
    Нужен полный drift-profile, а не только one-sided overflow.
  &nbsp;
5. В 07_product_binding_audit.csv добавить:
  &nbsp;
  - product_code
  - has_active_rule
  - has_bonus_rule
  - has_training_binding
  - has_ui_visibility_path
  - binding_gap_type
    Это поможет быстро увидеть, где продукт вообще не подключён к выдаче/библиотеке.
  &nbsp;
6. В 04_ui_vs_library_reconciliation_global.csv не ограничиваться только training_modules. Нужно отдельно проверить:
  &nbsp;
  - library visibility через product/group/module
  - доступы во вкладке «Доступы»
  - фактическую выдачу entitlement
    И добавить поля:
  - visible_in_access_tab
  - visible_in_library
  - visible_in_products_page
  - ui_reconciliation_status
  &nbsp;
7. Для NULL product_id добавить обязательный dry-run resolver:
  &nbsp;
  - resolved_product_id_by_code
  - resolved_confidence
  - resolver_method
    Чтобы потом remediation plan можно было строить на доказуемом mapping, а не вручную.
  &nbsp;
8. В финальном отчёте отдельным блоком зафиксировать:
  &nbsp;
  - какие предыдущие утверждения были ошибочны
  - что именно оказалось ложным:
    &nbsp;
    - вывод “не привязан к продукту” по ЗАКРОЙ ГОД
    - смешение product rule issue и expired subscription issue
    - локальная проверка вместо системной
      Это нужно написать прямо и без смягчения.
    &nbsp;
  &nbsp;
9. Добавить отдельный артефакт:
  &nbsp;
  - 11_remediation_candidates_dry_run.csv
    Но только для категорий, где basis_confidence = high и нет риска false positive.
    Категории bonus/unknown туда не включать.
  &nbsp;
10. В remediation plan явно запретить auto-fix не только для:

&nbsp;

&nbsp;

&nbsp;

- valid_rule_based_bonus
- bonus_access_without_parent_trace
- system_false_positive_risk
  но и для:
- illegal_bonus_access
- unknown_needs_manual_review
- любых записей с basis_confidence != high

&nbsp;

&nbsp;

&nbsp;

11. В DoD добавить:

&nbsp;

&nbsp;

&nbsp;

- по каждому active subscription тоже должен быть статус:
  &nbsp;
  - covered_by_entitlement
  - missing_entitlement
  - covered_by_ui_only
  - unknown_needs_manual_review
    Иначе ревизия будет односторонней только по entitlements.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

12. Любовь Пилецкая оставить как example case в отчёте, но в summary сверху явно написать: **scope = вся система, не один клиент**.

&nbsp;

&nbsp;

Копируемый блок для Lovable:

```
Дополни план правками:

1. В valid_rule_based_bonus обязательно проверять срок parent-basis:
- parent sub status in ('active','trial')
- parent access_end_at > now() or NULL
- если parent expired/canceled -> это illegal_bonus_access, а не valid_rule_based_bonus

2. Для 18 cb20 entitlements без active Gorbova Club sub не делать преждевременный вывод bonus_access_without_parent_trace. Сначала разделить:
- есть paid order на target product
- есть historical parent trace
- нет ни target paid order, ни parent trace

3. В 02_should_vs_actual_global.csv добавить поля:
classification_status, basis_confidence, parent_product_id, parent_subscription_id, required_order_id, required_order_status, duration_source, duration_expected_end_at.

4. В 05_bonus_child_drift_global.csv считать полный drift-profile:
- child > parent
- child < parent
- child NULL
- parent NULL
Не только overflow.

5. В 07_product_binding_audit.csv добавить:
product_code, has_active_rule, has_bonus_rule, has_training_binding, has_ui_visibility_path, binding_gap_type.

6. В 04_ui_vs_library_reconciliation_global.csv добавить:
visible_in_access_tab, visible_in_library, visible_in_products_page, ui_reconciliation_status.
Проверять не только training_modules, но весь UI path.

7. Для NULL product_id добавить resolver-поля:
resolved_product_id_by_code, resolved_confidence, resolver_method.

8. В финальном отчёте отдельным блоком прямо перечислить ошибочные прошлые выводы:
- “ЗАКРОЙ ГОД не привязан” — неверный вывод
- была смешана проблема rule linkage и expired subscription
- локальная проверка вместо системной дала ложную картину

9. Добавить новый CSV:
11_remediation_candidates_dry_run.csv
Только для high-confidence кейсов без false positive risk.

10. Запретить auto-fix для категорий:
- valid_rule_based_bonus
- bonus_access_without_parent_trace
- system_false_positive_risk
- illegal_bonus_access
- unknown_needs_manual_review
- любых записей с basis_confidence != high

11. Добавить двустороннюю ревизию:
каждый active subscription тоже должен получить статус:
- covered_by_entitlement
- missing_entitlement
- covered_by_ui_only
- unknown_needs_manual_review

12. В начале отчёта явно написать:
scope = глобальная ревизия всей системы доступов, а не кейс одного клиента.
Любовь Пилецкая — только example case.

STOP-GUARD:
никаких UPDATE/INSERT/DELETE, не менять rules/UI/data. Только SELECT, CSV, dry-run classification, финальный отчёт.

План: PATCH-GLOBAL-ACCESS-AUDIT — Полная системная ревизия доступов
```

### Обнаруженные данные (discovery)


| Метрика                        | Значение                                           |
| ------------------------------ | -------------------------------------------------- |
| Active entitlements            | 515                                                |
| Active subscriptions           | 405                                                |
| Entitlements без order_id      | 95                                                 |
| Entitlements с NULL product_id | 13                                                 |
| Entitlements без meta          | 30                                                 |
| ЦБ 1 ступень entitlements      | 121 (из них 103 с active Gorbova Club sub, 18 без) |
| Продуктов в products_v2        | 25                                                 |
| Active access_rules            | 21                                                 |


**Критическое наблюдение**: 18 entitlements ЦБ 1 ступень без active Gorbova Club sub — все из batch `BACKFILL-ENT-v23.1.9B`, имеют order_id. Это потенциальные кандидаты в `bonus_access_without_parent_trace`.

**Бонусная связь подтверждена**: правило `1b497fba` (Gorbova Club, tariff `7c748940`, rule_purpose=bonus, match_mode=per_product) выдаёт product_access к 10 продуктам при условии prior_purchase. 103 из 121 cb20 entitlements легально обоснованы этим правилом.

**NULL product_id**: 13 active — это 8 `course_close_year` + 2 `buh_business` + 3 модуля (без product_id но с order_id). Все resolvable через product_code.

### Что будет сделано

Один Python-скрипт, SELECT-only, генерирует **10 CSV + 1 MD отчёт** в `/mnt/documents/access_audit/`.

#### Классификация каждого active entitlement (обязательная)

Каждый из 515 active entitlements получит ровно один статус:


| Статус                        | Логика определения                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `valid_subscription_based`    | Есть active sub на тот же product_id у того же user_id                                                                                                                                       |
| `valid_rule_based_bonus`      | Нет sub на тот же product, но есть active sub на parent product (Gorbova Club) + active access_rule с rule_purpose=bonus + условие per_product выполнено (есть paid order на target product) |
| `invalid_orphan`              | Нет ни active sub, ни parent rule basis, ни paid order                                                                                                                                       |
| `invalid_wrong_product`       | product_id entitlement не совпадает с product_id order                                                                                                                                       |
| `invalid_wrong_end_date`      | expires_at отличается от subscription.access_end_at > 1 день                                                                                                                                 |
| `unknown_needs_manual_review` | Не удалось однозначно классифицировать                                                                                                                                                       |


#### Алгоритм определения bonus basis

```text
1. Найти все active access_rules с grant_target_type=product_access и rule_purpose=bonus
2. Для каждого entitlement без direct sub:
   a. Проверить: product_id entitlement входит в target_product_ids правила?
   b. Проверить: user имеет active sub на product_id правила (parent)?
   c. Проверить: user имеет paid order на required_product_id (match_mode=per_product)?
   d. Если a+b+c = true → valid_rule_based_bonus
   e. Если a+b = true, c = false → illegal_bonus_access
   f. Если только a = true → bonus_access_without_parent_trace
```

#### 10 CSV артефактов

1. **01_global_access_inventory.csv** — все 515 active entitlements + all active subs, с трассировкой и classification_status
2. **02_should_vs_actual_global.csv** — с полями: `basis_type, basis_entity_id, basis_product_id, basis_expires_at, resolver_layer, is_bonus_access, is_parent_child_linked, mismatch_type`
3. **03_access_source_trace_global.csv** — плоская таблица всех сущностей (rules, orders, subs, entitlements) для cross-reference
4. **04_ui_vs_library_reconciliation_global.csv** — сверка: entitlement есть → training_modules с тем же product_id существуют? → visible_in_library
5. **05_bonus_child_drift_global.csv** — drift ТОЛЬКО по доказанной parent→child связи через access_rules (rule `1b497fba` и аналогичные). Поля: parent_sub.access_end_at vs child_ent.expires_at
6. **06_root_cause_summary_global.csv** — агрегация по типам проблем с count и рекомендациями
7. **07_product_binding_audit.csv** — по каждому продукту: training_count, module_count, rule_count, orders_count, active_subscriptions_count, active_entitlements_count, binding_diagnosis
8. **08_null_or_orphan_accesses.csv** — NULL product_id с субклассификацией: `null_product_but_resolvable` (product_code → products_v2.id match exists), `null_product_and_unresolvable`, `null_product_legacy_import`
9. **09_parent_child_basis_matrix.csv** — все bonus-связи из access_rules: parent_product, child_product, rule_id, scope_mode, expected_duration_logic, actual_active_count
10. **10_system_false_positive_risk.csv** — кейсы, где однозначная классификация невозможна без ручной трассировки

#### Финальный отчёт (11_final_report.md)

Секции:

1. Масштаб проблем по каждому bucket
2. Root cause для каждого типа
3. **Почему предыдущая ревизия была недостаточной** (single-case reasoning, отсутствие global diff, смешение subscription-based и rule-based, отсутствие parent/child matrix)
4. На каком слое ломается логика
5. Dry-run remediation plan (без выполнения)
6. Категории, запрещённые к auto-fix: `valid_rule_based_bonus`, `bonus_access_without_parent_trace`, `system_false_positive_risk`
7. Backlog: PATCH-ACCESS-DURATION-ALIGNMENT

### Buckets классификации


| Bucket                              | Описание                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `legal_bonus_access`                | Бонус через active rule + active parent sub + prior purchase confirmed |
| `illegal_bonus_access`              | Бонус rule match, но parent sub expired/canceled                       |
| `bonus_access_without_parent_trace` | Product в target_product_ids правила, но нет traceable parent sub      |
| `extra_access`                      | Active entitlement без любого basis                                    |
| `missing_access`                    | Paid order + active rule, но нет entitlement                           |
| `orphan_entitlement`                | Нет order, нет sub, нет rule match                                     |
| `null_product_id`                   | product_id IS NULL                                                     |
| `wrong_end_date`                    | Drift > 1 day между ent.expires_at и sub.access_end_at                 |
| `child_bonus_drift`                 | Бонусный ent.expires_at > parent sub.access_end_at                     |


### STOP-guards

- Никаких UPDATE/INSERT/DELETE
- Не менять код, UI, rules, entitlements, subscriptions
- Только SELECT + генерация CSV/отчёта
- Любовь Пилецкая — один из примеров в отчёте

### Технические детали

- Python3 + psycopg2 (pg env vars уже настроены)
- Все файлы в `/mnt/documents/access_audit/`
- Все тексты на русском
- Один скрипт ~400 строк, запуск через `code--exec`

### DoD

1. Каждый из 515 active entitlements классифицирован ровно в один статус
2. 10 CSV + 1 MD отчёт сгенерированы
3. Глобальный should-vs-actual diff построен с basis_type
4. Parent/child matrix построена из access_rules
5. Drift считается только по доказанной связи
6. False positive risk вынесен отдельно
7. Remediation plan запрещает auto-fix для bonus/unknown категорий
8. Честный ответ о недостатках предыдущих проверок