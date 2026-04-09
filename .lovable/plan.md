# Да, согласен, с учетом правок:

&nbsp;

&nbsp;

# **План: исправление отображения модульных сделок по** 

# **Демко Людмиле**

#  **и унификация display-layer**

&nbsp;

&nbsp;

&nbsp;

## **Важное уточнение по кейсам**

&nbsp;

&nbsp;

Не путать клиентов:

&nbsp;

- **Демко Людмила** — это один конкретный клиент, по которому уже подтверждены:
  &nbsp;
  - модуль **Розничная торговля**
  - модуль **Производство**
  &nbsp;
- **Зимко** — это **другой** клиент и отдельный кейс, его в этот план не смешивать.
- В этом плане основной proof-case №1 — **Демко Людмила**.
- Proof-case №2 можно оставить отдельным клиентом позже, но **не называть его Демко / Земко** и не смешивать данные.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Проблема**

&nbsp;

&nbsp;

Для исторических сделок типа module_only_standalone система до сих пор показывает:

&nbsp;

- название **родительского курса** вместо названия купленного модуля;
- PRD **родительского продукта** вместо PRD самого модуля;
- в ряде мест display зависит от legacy snapshot/parent FK, а не от фактического UUID модуля.

&nbsp;

&nbsp;

Из-за этого по **Демко Людмиле** модульные сделки отображаются некорректно, хотя доступы на модули уже выданы правильно.

&nbsp;

---

&nbsp;

&nbsp;

## **Подтвержденный scope этого плана**

&nbsp;

&nbsp;

&nbsp;

### **Клиент:** 

### **Демко Людмила**

&nbsp;

&nbsp;

Нужно доказуемо привести в порядок:

&nbsp;

1. сделки по **Розничной торговле**;
2. сделки по **Производству**;
3. отображение этих сделок во всех user-facing местах;
4. корректный PRD именно модулей;
5. отсутствие показа PRD родительского курса там, где куплен модуль.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Корневая причина**

&nbsp;

&nbsp;

У исторических module_only_standalone сделок:

&nbsp;

- orders_v2.product_id часто указывает на **родительский курс**;
- фактический купленный модуль лежит в:
  &nbsp;
  - purchase_snapshot.module_list_mapped
  &nbsp;
- display-name часто берётся:
  &nbsp;
  - либо из purchase_snapshot.display_purchase_name,
  - либо из FK на родителя,
  - но не из реального продукта-модуля по UUID.
  &nbsp;

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Целевое правило display-layer**

&nbsp;

&nbsp;

&nbsp;

### **Для single-module сделки:**

&nbsp;

&nbsp;

Если:

&nbsp;

- historical_purchase_type = module_only_standalone
- module_list_mapped.length === 1
- UUID валиден
- продукт найден в products_v2

&nbsp;

&nbsp;

то отображать нужно:

&nbsp;

- **display name** = products_[v2.name](http://v2.name) модуля
- **public id** = products_v2.public_id модуля
- **resolved module product id** = UUID модуля из module_list_mapped

&nbsp;

&nbsp;

&nbsp;

### **Для multi-module сделки:**

&nbsp;

&nbsp;

Если:

&nbsp;

- module_list_mapped.length > 1

&nbsp;

&nbsp;

то:

&nbsp;

- не выбирать “первый модуль”;
- не показывать ложный PRD родителя;
- использовать:
  &nbsp;
  - snapshot name как fallback,
  - либо маркер несколько модулей,
  - либо manual review.
  &nbsp;

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Жесткое правило по идентификаторам**

&nbsp;

&nbsp;

Новая логика должна работать только так:

&nbsp;

- **runtime-логика** → только через product_id
- **UI-идентификатор** → через public_id
- **человекочитаемое имя** → через products_[v2.name](http://v2.name)

&nbsp;

&nbsp;

&nbsp;

### **Запрещено**

&nbsp;

&nbsp;

- строить новую логику на cb20, ЦБ 2.0, cb_module_*, slug, буквенных кодах;
- использовать product_code как основу display/runtime;
- использовать родительский PRD, если реально куплен модуль.

&nbsp;

&nbsp;

product_code и legacy-коды остаются только как legacy read-only reference, не как SoT.

&nbsp;

---

&nbsp;

&nbsp;

## **Решение**

&nbsp;

&nbsp;

&nbsp;

## **PATCH 1 — единый helper для display meta**

&nbsp;

&nbsp;

Создать единый resolver, а не размазывать логику по компонентам.

&nbsp;

&nbsp;

### **Новый helper**

&nbsp;

&nbsp;

Например:

&nbsp;

- buildDealDisplayMeta(...)
  или
- resolveModuleDealDisplayMeta(...)

&nbsp;

&nbsp;

&nbsp;

### **Он должен возвращать:**

&nbsp;

&nbsp;

- resolvedDisplayName
- resolvedPublicId
- resolvedModuleProductId
- resolutionType

&nbsp;

&nbsp;

&nbsp;

### **Возможные** 

### **resolutionType**

### **:**

&nbsp;

&nbsp;

- direct_module
- multi_module
- snapshot_fallback
- parent_fallback

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **PATCH 2 — исправить приоритет display name**

&nbsp;

&nbsp;

&nbsp;

### **Для** 

### **module_only_standalone**

###  **+ single-module:**

&nbsp;

&nbsp;

Приоритет должен быть таким:

&nbsp;

1. [moduleProduct.name](http://moduleProduct.name)
2. purchase_snapshot.display_purchase_name
3. [productsV2.name](http://productsV2.name)
4. fallback

&nbsp;

&nbsp;

&nbsp;

### **Почему именно так**

&nbsp;

&nbsp;

- [moduleProduct.name](http://moduleProduct.name) — актуальное каноническое имя модуля;
- snapshot — приемлемый fallback;
- [productsV2.name](http://productsV2.name) у сделки часто имя родительского курса;
- parent name нельзя ставить выше snapshot.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **PATCH 3 — исправить** 

## **public_id**

&nbsp;

&nbsp;

&nbsp;

### **Для single-module:**

&nbsp;

&nbsp;

Показывать:

&nbsp;

- moduleProduct.public_id

&nbsp;

&nbsp;

&nbsp;

### **Для multi-module:**

&nbsp;

&nbsp;

Не показывать PRD родителя как будто это PRD модуля.

&nbsp;

Разрешённые варианты:

&nbsp;

- скрыть PRD;
- показать несколько модулей;
- отправить кейс в manual review.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **PATCH 4 — batch-resolve модульных продуктов**

&nbsp;

&nbsp;

Во всех user-facing местах нужен единый паттерн:

&nbsp;

1. собрать UUID модулей из module_list_mapped;
2. сделать один batch-query в products_v2;
3. собрать map;
4. передать map в единый helper display/meta.

&nbsp;

&nbsp;

&nbsp;

### **Не делать**

&nbsp;

&nbsp;

- по одному локальному резолву в каждом файле своей логикой;
- 5 разных реализаций одного и того же.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **PATCH 5 — покрыть все user-facing потребители**

&nbsp;

&nbsp;

Проверить и привести к единому helper все места, где показываются сделки.

&nbsp;

&nbsp;

### **Обязательные файлы**

&nbsp;

&nbsp;

- src/components/admin/ContactDetailSheet.tsx
- src/pages/admin/AdminDeals.tsx
- src/components/admin/DealDetailSheet.tsx
- src/components/admin/ContactPaymentsTab.tsx
- src/components/admin/bepaid/ContactDealsDialog.tsx

&nbsp;

&nbsp;

При необходимости также:

&nbsp;

- src/components/admin/payments/LinkDealDialog.tsx
- src/components/admin/payments/LinkSubscriptionDealDialog.tsx

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **PATCH 6 — grep-proof по обходным display-путям**

&nbsp;

&nbsp;

Нужно проверить и устранить user-facing места, где модульные сделки показываются напрямую через:

&nbsp;

- deal.products_[v2.name](http://v2.name)
- deal.product_name
- deal.products_v2.public_id

&nbsp;

&nbsp;

Если это user-facing display для сделок — должно идти только через unified helper.

&nbsp;

&nbsp;

### **Допустимые исключения**

&nbsp;

&nbsp;

Только если это:

&nbsp;

- сортировка;
- техническая диагностика;
- внутренний не-user-facing текст.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **PATCH 7 — data cleanup по snapshot только как follow-up**

&nbsp;

&nbsp;

&nbsp;

### **Не делать это основным фиксом**

&nbsp;

&nbsp;

Массовое переписывание purchase_snapshot.display_purchase_name — не основной путь.

&nbsp;

&nbsp;

### **Допускается только как отдельный follow-up cleanup:**

&nbsp;

&nbsp;

- только для single-module сделок;
- только если UUID валиден;
- только если продукт найден в products_v2;
- только после dry-run отчёта;
- без влияния на runtime-логику.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Proof-case №1 —** 

## **Демко Людмила**

&nbsp;

&nbsp;

&nbsp;

### **Обязательно проверить:**

&nbsp;

&nbsp;

1. сделка по **Розничной торговле** показывает имя модуля;
2. сделки по **Производству** показывают имя модуля;
3. везде показывается PRD модуля, а не PRD родителя;
4. в “Доступах” одновременно видны:
  &nbsp;
  - курс,
  - Розничная торговля,
  - Производство;
  &nbsp;
5. суммы и даты остаются правильными;
6. ничего не ломается в уже выданных доступах.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Proof-case №2**

&nbsp;

&nbsp;

Второй клиент проверяется отдельно, но:

&nbsp;

- не называть его Демко;
- не смешивать с Людмилой;
- не подменять данные Людмилы его кейсом.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **Что не меняется**

&nbsp;

&nbsp;

- доступы, уже корректно выданные по rule engine;
- orders_v2.product_id у исторических сделок массово не переписывается;
- логика rules / entitlements в этом плане не является основным объектом правки;
- legacy product_code не используется для новой display-логики.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **STOP-guards**

&nbsp;

&nbsp;

1. Не путать **Демко Людмилу** с другими клиентами.
2. Не показывать PRD родителя для single-module сделки.
3. Не выбирать “первый модуль” для multi-module сделки.
4. Не строить новую логику на cb20, ЦБ 2.0, product_code, slug.
5. Не считать задачу закрытой, пока по **Демко Людмиле** не будет browser-proof.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **DoD**

&nbsp;

&nbsp;

1. По **Демко Людмиле**:
  &nbsp;
  - Розничная торговля отображается как модуль;
  - Производство отображается как модуль.
  &nbsp;
2. Для этих сделок показывается public_id именно модуля.
3. Ни один экран больше не показывает PRD родительского курса для single-module standalone сделки.
4. Все user-facing display-path используют unified helper/meta-resolver.
5. Multi-module сделки не показывают ложный PRD.
6. Browser-proof по **Демко Людмиле** приложен.
7. В новом патче нет новой логики на cb20 / legacy codes.

&nbsp;

&nbsp;

Если пришлёшь следующий план/отчёт подрядчика, я уже проверю его именно на предмет того, чтобы он снова не смешал Демко Людмилу с другими клиентами и не полез обратно в legacy-коды.

&nbsp;

План: Исправление отображения модульных сделок + ответы на вопросы

## Ответы на вопросы

### Откуда берутся названия "ЦБ 2.0: Производство"?

Это **закэшированные названия из `purchase_snapshot.display_purchase_name**` — поле в JSONB, записанное при импорте из GetCourse. На момент импорта модули назывались "ЦБ 2.0: Производство", "ЦБ 2.0: Розничная торговля" и т.д. Сейчас в `products_v2` они уже переименованы в "Ценный бухгалтер | 1 ступень 2.0 | Модуль: Производство", но **snapshot не обновляется при переименовании продукта** — это замороженный снимок.

Хелпер `getDealDisplayName` для модульных сделок (`module_only_standalone`) **приоритизирует snapshot name над текущим именем продукта**. Это сделано потому, что `product_id` у этих сделок указывает на родительский курс (`7101ed3c`, PRD-000003), а не на сам модуль. Если бы мы взяли имя из FK join, показалось бы "Ценный бухгалтер | 1 ступень 2.0" (родитель) — ещё хуже.

### Почему public_id у модулей = PRD-000003 (родительский)?

Потому что `orders_v2.product_id` у всех 126 модульных сделок = `7101ed3c` (родительский курс). FK join на `products_v2` возвращает данные родителя, включая его `public_id = PRD-000003`. Реальные модули (`064dd768` = PRD-000005, `abee24cd` = PRD-000015) хранятся только в `purchase_snapshot.module_list_mapped`.

### Как был выдан доступ?

Доступ выдан через **rule engine** (`rules-retroapply`), правило `1b497fba`. Shared resolver `check-prior-purchase.ts` нашёл модульные покупки через fallback: `purchase_snapshot.module_list_mapped` содержит UUID модуля → match. Entitlements созданы с правильным `product_id` = UUID модуля (не родителя), `product_code` = `cb_module_production` / `cb_module_retail`.

---

## Корневая проблема

Для `module_only_standalone` сделок UI показывает:

- **Имя**: стale snapshot name ("ЦБ 2.0: ...") вместо текущего имени модуля из `products_v2`
- **Public ID**: PRD-000003 (родитель) вместо PRD-000005/PRD-000015 (модуль)

Всего затронуто **126 сделок** (120 single-module + 6 multi-module).

## Исправление

### 1. Изменить `getDealDisplayName` — убрать приоритет snapshot name

Для `module_only_standalone` с одним модулем в `module_list_mapped`: использовать **текущее имя модуля из `products_v2**`, переданное через новый параметр `moduleProduct`. Snapshot name использовать только как последний fallback.

Файл: `src/lib/deals/getDealDisplayName.ts`

Добавить в `DealDisplayNameInput`:

```typescript
/** Resolved module product (from module_list_mapped UUID) */
moduleProduct?: { name?: string | null; publicId?: string | null } | null;
```

Изменить приоритет для `module_only_standalone`:

1. `moduleProduct.name` (текущее имя модуля из БД)
2. `productsV2.name` (FK join — это родитель, но хотя бы актуальное)
3. `snapshotName` (fallback — стale)
4. `fallback`

### 2. Резолвить модульный продукт на уровне потребителей

В каждом месте, где рендерятся сделки, для `module_only_standalone` сделок с `module_list_mapped` = 1 UUID — подгружать продукт модуля из `products_v2` по этому UUID.

Подход: собрать все уникальные module UUIDs из snapshot'ов, сделать один batch-запрос к `products_v2`, создать map, передать в `getDealDisplayName`.

Затронутые файлы:

- `src/components/admin/ContactDetailSheet.tsx` — deals tab (строки 3131-3230)
- `src/pages/admin/AdminDeals.tsx` — список сделок
- `src/components/admin/DealDetailSheet.tsx`
- `src/components/admin/ContactPaymentsTab.tsx`
- `src/components/admin/bepaid/ContactDealsDialog.tsx`

### 3. Показывать public_id модуля, а не родителя

В `ContactDetailSheet.tsx` (строка 3162) и аналогичных местах: для `module_only_standalone` показывать `moduleProduct.publicId` вместо `(deal.products_v2 as any)?.public_id`.

### 4. Обновить snapshot names в БД (data migration)

Обновить `purchase_snapshot.display_purchase_name` у всех 126 сделок, заменив "ЦБ 2.0: X" на актуальное имя модуля из `products_v2`. Это не критично для логики (после фикса п.1-3 snapshot name станет fallback), но убирает стale data.

## Изменяемые компоненты


| Файл                                                 | Действие                                              |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `src/lib/deals/getDealDisplayName.ts`                | Добавить `moduleProduct` параметр, изменить приоритет |
| `src/components/admin/ContactDetailSheet.tsx`        | Резолвить module products, передать в helper          |
| `src/pages/admin/AdminDeals.tsx`                     | Аналогично                                            |
| `src/components/admin/DealDetailSheet.tsx`           | Аналогично                                            |
| `src/components/admin/ContactPaymentsTab.tsx`        | Аналогично                                            |
| `src/components/admin/bepaid/ContactDealsDialog.tsx` | Аналогично                                            |
| DB migration                                         | UPDATE snapshot names на актуальные                   |


## DoD

1. Модульные сделки показывают текущее имя модуля из `products_v2`, а не стale snapshot
2. Public ID модульных сделок = PRD модуля, а не PRD родителя
3. При переименовании продукта в админке — имя автоматически обновляется в сделках (т.к. FK join)
4. Multi-module сделки (6 шт.) показывают snapshot name как fallback (т.к. нельзя однозначно выбрать один модуль)
5. Grep-proof: все потребители передают `moduleProduct`