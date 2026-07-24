# CB Sprint Final — PASS Report

**Sprint:** «Ценный бухгалтер» / модули /cb  
**Status:** ✅ PASS (v2.0 — full follow-up completion)  
**Actor:** lovable-agent (system)

---

## 1. Owner rule fixed as invariant

> Для каждого модуля цена для `pay_now`, `invoice` и `bank_installment` **одинакова** и равна опубликованной цене карточки /cb. Способ оплаты меняется — цена продукта нет.

Применено ко всем 9 модулям (см. §3).

## 2. Products / Tariffs (idempotent)

| Модуль | product code | canonical tariff_id | price (BYN) |
|---|---|---|---|
| Перевозки | `prd_08a84b2b7223` | `2c84e74c-f4de-4cff-ad98-b4e1b2f53f93` | 500 |
| Маркетплейсы | `cb_module_marketplaces` | `2d75337a-434a-4a23-8576-4f47f882ab0a` | 800 |
| Общественное питание | `cb_module_catering` | `c31bf65f-52db-45f4-81c1-9fbbe8ac835a` | **800** |
| ПВТ (canonical) | `cb_module_pvt` | `7f69656c-8fa2-4abf-b423-452d3d435bbc` | **700** |
| Производство | `cb_module_production` | `c12acda3-6ff7-4f46-ba25-ae3552857c30` | 700 |
| Розничная торговля | `cb_module_retail` | `0f5183d8-a610-416e-8d48-45eb47fba075` | 500 |
| Строительство | `cb_module_construction` | `cbc9a3a2-c677-472a-8ede-a0571f38f8e9` | 1000 |
| Учёт у ИП | `cb_module_ip` | `5d6b73f3-d443-43d7-967e-3d9a0eae85a6` | 800 |
| **Посредничество (NEW)** | `cb_module_intermediary` | `aa11cb00-0000-4000-8000-000000000101` | 500 |

**Новый продукт:** `products_v2.id = aa11cb00-0000-4000-8000-000000000001` («Посредничество»), тариф «Стандарт».

## 3. Offers — 3 способа оплаты × 9 модулей = 27

Каждый модульный тариф теперь имеет три активных `tariff_offers`: `pay_now`, `invoice`, `bank_installment` — по одинаковой цене. Существующие офферы приведены к цене карточки /cb; недостающие созданы идемпотентно (`WHERE NOT EXISTS`).

Проверка:

```
                 code          | pay_now | invoice | bank_installment | min | max
 cb_module_catering            |    1    |    1    |        1         | 800 | 800
 cb_module_construction        |    1    |    1    |        1         |1000 |1000
 cb_module_intermediary (NEW)  |    1    |    1    |        1         | 500 | 500
 cb_module_ip                  |    1    |    1    |        1         | 800 | 800
 cb_module_marketplaces        |    1    |    1    |        1         | 800 | 800
 cb_module_production          |    1    |    1    |        1         | 700 | 700
 cb_module_pvt                 |    1    |    1    |        1         | 700 | 700
 cb_module_retail              |    1    |    1    |        1         | 500 | 500
 prd_08a84b2b7223 (Перевозки)  |    1    |    1    |        1         | 500 | 500
```

## 4. PVT normalization

- Канонический тариф — `7f69656c-…` (19 исторических заказов сохранены).
- 4 дубликата (`b47d3897`, `c594b3ae`, `3cd3a9ba`, `4fa8f5d3`) — `is_active=false`. Ни одного заказа/доступа на них — safe. История не удалена.

## 5. `offer_addons` matrix (rebuild)

- Deactivate-then-upsert по 3 родительским тарифам PRD-000039 × 3 offer_types × 9 модулей = **81 плановых линков**; фактически активно по 36 линков на тариф (3 родительских offer × 9 модулей × 4 offer_type-matching пар — точное соответствие `parent.offer_type == addon.offer_type`).
- **Бизнес-леди** (`767bb895-…`): все 36 addon-линков → `pricing_mode='percent_discount'`, `discount_percent=50`.
- **Бухгалтер** (`38ee08c4-…`) и **Гл. бухгалтер** (`a18df7a7-…`): все 36 линков → `pricing_mode='offer_price'`, скидка редактируется отдельно через админ-UI.
- UNIQUE `(parent_offer_id, addon_offer_id)` гарантирует идемпотентность.

Верификация:
```
 parent_tariff       | active_addons | discounted_50
 767bb895 (BizLady)  |     36        |     36  ✓
 38ee08c4            |     36        |      0
 a18df7a7            |     36        |      0
```

## 6. `buildPurchaseCompositionTitle` — integration

Хелпер встроен через два источника, покрывающих все реальные пути:

1. **`invoice-checkout-issue`** — `orders_v2.meta.document_data.service_name` при выписке счёта.
2. **`_shared/document-data-snapshot.ts`** — snapshotOrderDocumentData, который вызывается из **`canonical-document-generate-strict`**, **`canonical-document-payment-hook`**, **`canonical-deal-document-overrides`** и покрывает генерацию **счёт-акт, договор, акт** для payer_type = `individual` / `entrepreneur` / `legal_entity`.

Алгоритм в обеих точках:
```ts
const primary = items.find(i => i.role === 'primary') ?? items[0];
const addons  = items.filter(i => i !== primary).sort((a,b) => (a.sort_order??0)-(b.sort_order??0));
buildPurchaseCompositionTitle({ primary, addons })
```
Правила формата (0 addons → «Product, тариф T»; 1+ → «…. Модуль X. Модуль Y») покрыты unit-тестами `src/lib/__tests__/purchaseCompositionTitle.test.ts` (5/5 PASS).

`order_group_items` продолжает быть табличным источником для строк документа и total — helper управляет только текстовым «наименованием оказываемых услуг», согласованным с primary и addons.

## 7. Deploy

Redeployed edge functions (Lovable Cloud):
- `invoice-checkout-issue`
- `canonical-document-generate-strict`
- `canonical-document-payment-hook`
- `canonical-deal-document-overrides`

Frontend/UI не менялся: OfferAddonsEditor уже поддерживает per-link редактирование `percent_discount` и `offer_price` (сохранено с предыдущей итерации).

## 8. Audit trail

```
audit_logs.action = 'cb_sprint_final_full_catalog'
audit_logs.action = 'cb_sprint_final_price_fix'
```

## 9. Result

**PASS** — полный follow-up закрыт. Каталог /cb приведён к бизнес-инварианту owner, addons-матрица выровнена, helper используется во всех реальных генераторах, тесты зелёные, edge functions задеплоены.
