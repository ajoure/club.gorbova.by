# Dry-run: Светлана Прайс — расследование доступа к ЦБ 1ст 2.0

Дата: 2026-05-22
profile_id: `542568f9-17eb-48f8-b39c-172a8a0a7872`
auth user_id (в entitlements): `4c46900e-5bf9-4c8c-97a1-274283260cf8`

## 1. Paid orders (март–май 2026)

| order_id | created_at | product | tariff | provider | paid |
|---|---|---|---|---|---|
| 0eb27592 | 2026-05-21 | Gorbova Club | BUSINESS | bepaid | 250 |
| 5d5e6975 | 2026-04-21 | Gorbova Club | BUSINESS | bepaid | 250 |
| 7e9eee45 | 2026-03-29 | ЗАКРОЙ ГОД | Стандартный | getcourse | 600 |
| 1eb89648 | 2026-03-29 | ЗАКРОЙ ГОД | Стандартный | getcourse | 245 |
| dac909bc | 2026-03-29 | ЦБ 2 ступень | Премиум | historical_import | 2186.97 (paid=0) |
| 7ae1d21e | 2026-03-28 | **ЦБ 1ст 2.0** | **Бухгалтер** | getcourse | 1690 (paid=0) |
| 48abf063 | 2026-03-22 | Gorbova Club | BUSINESS | bepaid | 250 |

## 2. Соответствующие entitlements — ЕСТЬ (prior report «0 entitlements» был ошибочным)

| entitlement_id | product | order_id | scope | expires_at |
|---|---|---|---|---|
| 9af723d2 | Gorbova Club (11c9f1b8) | 0eb27592 | full | 2026-06-21 |
| 3dd9a510 | ЗАКРОЙ ГОД (73c29914) | 7e9eee45 | full | 2026-05-31 |
| e21b82fd | **ЦБ 1ст 2.0 (7101ed3c)** | **7ae1d21e** | **module_scope_only [Производство]** | 2026-06-21 |
| 96cb5cf6 | prd_0e5fda1e2273 (c153c811) | — | full (retroapply) | 2026-06-21 |
| d8ce597c | (cut) | — | (rule_engine) | 2026-06-21 |

## 3. Root cause «контент не опубликован» для ЦБ 1ст 2.0

Entitlement `e21b82fd-d345-424b-8cf7-6da4226e49ec` для продукта `7101ed3c` («Ценный бухгалтер | 1 ступень 2.0») имеет meta:

```jsonc
{
  "scope_resolution_mode": "module_scope_only",
  "historical_module_product_ids": ["064dd768-de8b-40db-89bc-f8d4a7e442ba"], // Модуль: Производство
  "historical_purchase_type": "module_child_purchase",
  "prior_purchase_match_type": "direct",
  "prior_purchase_order_id": "7ae1d21e-2825-4bb2-a466-8f88b3b40638",
  "business_tariff_id": "7c748940-dcad-4c7c-a92e-76a2344622d3",
  "hpids_outside_target_subtree": true,
  "hpids_outside_target_marker_reason": "business_bonus_parent_legitimate_2026_05_13",
  "source_rule_id": "1b497fba-031a-4318-8d9f-2530f1bac116",
  "source_type": "rule_engine"
}
```

Проблема: `prior_purchase_order_id` указывает на её прямую покупку `7ae1d21e` тарифа `adbe94e8` («Бухгалтер») продукта `7101ed3c` — это **родительская покупка целиком ЦБ 1ст 2.0**, а не модуль. Однако rule_engine retroapply пометил её как `historical_purchase_type: module_child_purchase` и `historical_module_product_ids:[Производство]`, после чего применил `scope_resolution_mode: module_scope_only`.

Так как resolver `getTrainingAccessForProduct` (см. mem `architecture/access-control/training-content-resolver-rules`) обрабатывает `module_scope_only` строго: контент родителя (вне subtree hpids) → default-deny → UI рендерит «контент не опубликован».

### Почему misclassification произошёл
Тариф `adbe94e8` «Бухгалтер» продукта `7101ed3c` в historical schema, видимо, маркировался retroapply как module-child (legacy GetCourse import). Phantom-parent guard в мае 2026 пометил её, но затем сделал revert (`business_bonus_parent_legitimate_2026_05_13`) и оставил `module_scope_only`.

## 4. Repair plan (НЕ ВЫПОЛНЕНО — требуется approval)

Канонического repair-writer для смены `scope_resolution_mode` отдельной записи **нет**. Варианты:

**Вариант A — точечная правка meta (1 row, audit как `manual`)**
```sql
-- DRY-RUN, НЕ исполняется автоматически
UPDATE entitlements
SET meta = meta
  || jsonb_build_object(
       'scope_resolution_mode','full_access',
       'scope_repair_reason','direct_parent_purchase_misclassified_as_module_child_2026_05_22',
       'scope_repair_previous_mode','module_scope_only',
       'scope_repair_previous_hpids', meta->'historical_module_product_ids'
     )
WHERE id = 'e21b82fd-d345-424b-8cf7-6da4226e49ec';
-- rowcount expected: 1
```
+ INSERT audit_logs (actor_type='system', action='entitlement.scope_repair', ...).

**Вариант B — rerun `grant-access-for-order` для order 7ae1d21e**
Риск: order помечен `historical_import` / `paid_amount=0`, grant может skip из-за невалидного платежа или snap на тот же misclassified rule. Не рекомендуется без отдельной защиты.

### Дубль-protection
Других active entitlements на product `7101ed3c` у пользователя нет (см. п.2). Поэтому правка `e21b82fd` не приведёт к дублям.

### Blast radius
- 1 entitlement → расширяется scope с Производство до full ЦБ 1ст 2.0.
- expires_at не меняется (2026-06-21, уже выровнен с Business bonus).
- Telegram / billing не затронуты.
- UI Светланы: исчезает «контент не опубликован» по всем модулям ЦБ 1ст 2.0.

## 5. Решение: STOP до подтверждения
Согласно протоколу «STOP: execute только если rowcount точный и понятно, что не будет дублей» — rowcount 1, дублей не будет, но операция выходит за рамки канонического writer'а. Требуется явное «execute» от владельца.

## 6. Открытые вопросы для P2/P3
- Сколько ещё пользователей имеют такое же misclassified `module_scope_only` поверх прямой parent-покупки? — нужен системный sweep (отдельный proof).
- Заказы Светланы `7ae1d21e`, `1eb89648` (getcourse, paid_amount=0) — нет реального bepaid-платежа → кнопки «Чек»/«Сформировать» по правилам PATCH-A корректно скрыты (provider=getcourse, не в denylist но receipt_url=NULL и paid_amount=0).
