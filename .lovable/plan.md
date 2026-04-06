## да, согласен, с учетом правок:

&nbsp;

1. Вынести в начало плана как обязательный принцип:
  **Никаких решений по slug/code/name/similarity. Только ID-first.**
  Во всех runtime-цепочках source of truth:
  &nbsp;
  - product_id
  - tariff_id
  - offer_id
  - training_module_id
  - при необходимости order_id / subscription_id
    Названия, коды, slug, short label, snapshot text — только для отображения и текстового поиска.
  &nbsp;
2. Явно зафиксировать в плане:
  &nbsp;
  - cb20 = отдельный продукт **«Ценный бухгалтер 1 ступень 2.0»**
  - prd_0d01a2fdc477 = отдельный продукт **«Ценный бухгалтер 2 ступень»**
  - это не parent/child, не версии одного продукта, не «один продукт с вариациями».
    Любые прошлые или будущие выводы по похожести названий считать ошибочными.
  &nbsp;
3. Дополнить execute-патч по naming правилом:
  **UI может сокращать название, но не имеет права менять идентичность сущности.**
  Поэтому:
  &nbsp;
  - short label — только display,
  - category badge — только display,
  - canonical DB name — только display/search metadata,
  - логика связки, выдачи, поиска сущности, fulfillment, resolve access — только по ID.
  &nbsp;
4. Добавить новый обязательный discovery-блок:
  **PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION**
  Проверить и зафиксировать все места, где бизнес-логика сейчас опирается на:
  &nbsp;
  - product_code
  - products_[v2.name](http://v2.name)
  - description text
  - slug
  - hardcoded code sets
  - string includes / ilike / prefix / fuzzy match
    И разделить на:
  - допустимо только для поиска/отображения,
  - недопустимо в business logic и требует переделки на ID.
  &nbsp;
5. В этот блок добавить артефакт:
  **product_identity_runtime_matrix.csv**
  Колонки:
  &nbsp;
  - component_or_function
  - layer
  - current_identifier_used
  - should_use_identifier
  - business_logic_affected
  - display_only_or_runtime
  - risk_level
  - fix_required
  &nbsp;
6. Отдельно зафиксировать high-risk зоны, которые уже нельзя описывать как «нормальные»:
  &nbsp;
  - *shared/entitlement-sync.ts — hardcoded product*code sets
  - bepaid-auto-process — text matching по description
  - bepaid-raw-transactions / bepaid-report-import — text-based matching
  - product-names.ts — статическая code→name карта
  - места, где entitlement / access resolution идёт через product_code
    Для них нужен не просто audit, а план замены на ID-driven contract.
  &nbsp;
7. В Часть 1 (PATCH-NAMING-NORMALIZATION-UI-FIRST) добавить правку:
  показывать в detail views и link dialogs не просто secondary text, а **реальный ID продукта** как системный идентификатор, без попытки подменять его PRD-кодом, если PRD-код не является реальным UUID-идентификатором в логике.
  Минимум:
  &nbsp;
  - DealDetailSheet
  - ContactDetailSheet
  - LinkDealDialog
  - LinkSubscriptionDealDialog
  - ContactDealsDialog
  &nbsp;
8. Дополнить DoD naming-патча:
  &nbsp;
  - нигде в UI нельзя перепутать модуль и полный продукт;
  - у каждой сущности в detail/link view виден её системный ID;
  - похожие названия не создают ложного ощущения, что это одна и та же сущность;
  - поиск по тексту после выбора всегда резолвит конкретный product_id, а не имя.
  &nbsp;
9. В PATCH-DEALS-SEARCH-RESOLVER-FIX зафиксировать ограничение:
  поиск по [pr.name](http://pr.name), pr.code, [t.name](http://t.name) — это только UX-level text search.
  После того как пользователь нашёл запись, все дальнейшие действия идут только по:
  &nbsp;
  - order_id
  - product_id
  - tariff_id
    Никаких повторных resolve по тексту.
  &nbsp;
10. В discovery по field binding добавить отдельный обязательный раздел:
  **сверка всех полей продуктов / тарифов / кнопок / офферов на реальное runtime-использование**.
  Не просто “читается ли поле”, а:

&nbsp;

&nbsp;

&nbsp;

- где редактируется в UI,
- в какой payload попадает,
- какая edge function его реально читает,
- влияет ли оно реально на checkout / webhook / grant / subscription / renewal / revoke,
- является ли поле декоративным/мертвым.
  Артефакт:
  **field_binding_runtime_matrix.csv**
  со статусами:
- used_runtime
- display_only
- dead_field
- misleading_ui_field
- duplicated_source_of_truth

&nbsp;

&nbsp;

&nbsp;

11. Дополнить план жёстким выводом по кнопкам оплаты:
  если UI-toggle “Подписка / автопродление” и связанные поля не влияют на runtime, это не «мелкий баг», а **SoT mismatch** между интерфейсом и бизнес-логикой.
  Это оформить как отдельный follow-up патч:
  **PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX**
  но только после discovery matrix.
12. По замечанию про «Закрой год» исправить формулировку в плане:
  нельзя ссылаться на наличие каких-то офферов или tokenization как на доказательство корректности автопродления, пока не доказано, что runtime реально читает именно эти поля.
  Сначала доказать code-proof по цепочке:
  UI кнопка → payload → checkout → webhook → grant-access-for-order → subscriptions_v2/renewal.
  До этого любые выводы про «это подписочная бизнес-настройка» считать недоказанными.
13. Добавить отдельный execute/discovery блок:
  **PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF**
  Scope:

&nbsp;

&nbsp;

&nbsp;

- продукты
- тарифы
- кнопки оплаты
- tariff_offers
- поля автопродления / токенизации / grace / retries
  Цель:
  доказать, какие поля реально работают, а какие «просто для красоты», как вы и указали.

&nbsp;

&nbsp;

&nbsp;

14. В обновлённый порядок работ поставить приоритет так:
15. PATCH-NAMING-NORMALIZATION-UI-FIRST
16. DISCOVERY: PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION
17. DISCOVERY: PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF
18. только потом любые execute-патчи по автопродлению / field binding / module visibility / cleanup
  Иначе снова будет косметика без устранения корневой путаницы.
19. Добавить в план финальный принцип исполнения:
  **Если поле можно менять в UI, но runtime на него не смотрит — это дефект архитектуры и SoT mismatch.**
  Такие поля должны быть либо:

&nbsp;

&nbsp;

&nbsp;

- реально подключены к runtime,
- либо удалены/скрыты из UI,
- либо явно помечены как неиспользуемые до исправления.

&nbsp;

&nbsp;

&nbsp;

16. В общий [plan.md](http://plan.md) добавить отдельный блок “Запрещено”:

&nbsp;

&nbsp;

&nbsp;

- запрещено делать выводы по похожести имён;
- запрещено связывать продукты по тексту;
- запрещено считать code/name/slug surrogate key;
- запрещено принимать execute-решения по доступам, если цепочка не доказана через ID и runtime proof.

&nbsp;

&nbsp;

&nbsp;

17. Дополнительно в naming-патч включить не только badge и short label, но и явное визуальное разделение сущностей:

&nbsp;

&nbsp;

&nbsp;

- **Курс**
- **Модуль**
- **Подписка**
- **Услуга**
  чтобы администратор не делал вывод по одному только названию строки.

&nbsp;

&nbsp;

&nbsp;

18. В качестве отдельного артефакта добавить:
  **id_vs_name_conflict_cases.csv**
  куда собрать все кейсы, где разные product_id выглядят как одна сущность из-за naming pattern.
  Это нужно как контрольный список для будущих UI/logic fixes.

&nbsp;

&nbsp;

План: PATCH-NAMING-NORMALIZATION-UI-FIRST + DISCOVERY: PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION

---

### Архитектурное правило (обязательно для всех последующих патчей)

**«Названия могут быть похожими. ID — уникален. Все решения принимает только ID.»**

- cb20 и prd_0d01a2fdc477 — два независимых продукта. Не parent/child, не версии.
- Никаких выводов по названию, slug, prefix, similarity matching.
- Во всех runtime-цепочках: только product_id, tariff_id, offer_id, training_module_id.
- short label и canonical name — только display metadata, не участвуют в логике доступа, fulfillment, связки.
- Текстовый поиск допустим только для нахождения строки в UI; после выбора — только ID.

---

### Часть 1: PATCH-NAMING-NORMALIZATION-UI-FIRST (execute)

#### 1a. Новый файл: `src/lib/deals/getCategoryBadge.ts`

Маппинг `products_v2.category` в badge:


| category        | label        | цвет   |
| --------------- | ------------ | ------ |
| course          | Курс         | blue   |
| module          | Модуль       | amber  |
| subscription    | Подписка     | purple |
| service         | Услуга       | green  |
| digital_product | Вебинар      | teal   |
| null            | — без бейджа | —      |


Функция: `getCategoryBadge(category: string | null) => { label, className } | null`

#### 1b. Расширение `getDealDisplayName.ts`

Новый экспорт `getShortDisplayName(name: string, category: string | null): string`:

- `module`: убирает префикс родителя (все до последнего `|`), добавляет "Модуль: "
- Остальные: trim trailing `|` и пробелы
- Canonical DB name не меняется — чисто UI-функция

#### 1c. SQL миграция (2 точечных UPDATE)

```sql
UPDATE products_v2 SET name = RTRIM(name, ' |')
WHERE code IN ('cb20', 'prd_0d01a2fdc477') AND name LIKE '%|';
```

Это косметика, не решение корневой проблемы.

#### 1d. UI-интеграция — 8 точек

В каждой: добавить `category` в select, рендерить badge + short label, тариф отдельной строкой.


| #   | Файл                             | Что меняется                                                                  |
| --- | -------------------------------- | ----------------------------------------------------------------------------- |
| 1   | `AdminDeals.tsx` L166            | select: `products_v2(id, name, code, category)`, badge + short label в строке |
| 2   | `AdminDeals.tsx` L430            | CSV export: колонка "Категория"                                               |
| 3   | `DealDetailSheet.tsx` L240       | badge + short label + product_id видимый (secondary)                          |
| 4   | `ContactDetailSheet.tsx` L419    | badge + short label + product_id secondary                                    |
| 5   | `ContactPaymentsTab.tsx` L193    | badge + short label                                                           |
| 6   | `ContactDealsDialog.tsx`         | badge + short label + product_id                                              |
| 7   | `LinkDealDialog.tsx` L75         | badge + short label                                                           |
| 8   | `LinkSubscriptionDealDialog.tsx` | badge + short label                                                           |


Во всех detail views и link dialogs: рядом с названием показывать системный идентификатор (PRD-xxx или uuid fragment) как secondary/muted text.

#### 1e. Guard-правила

- `category = 'module'` → badge "Модуль" обязателен, short label без префикса родителя
- Модуль не выглядит как покупка полного курса
- Тариф не подменяет название продукта
- В списках: short label + badge; в detail views: + product_id secondary

#### DoD

1. Badge виден во всех 8 точках
2. Модули с коротким label, не маскируются под родителя
3. Тариф отдельной строкой
4. Trailing pipes убраны у cb20 / prd_0d01a2fdc477
5. Системный ID виден в detail views и link dialogs
6. Поиск RPC работает по canonical DB name (не затронут)

---

### Часть 2: DISCOVERY — PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION

#### Цель

Найти все места в коде, где бизнес-логика работает по тексту вместо ID, и зафиксировать risk + fix plan.

#### Уже обнаруженные проблемные зоны


| Зона                               | Файл                                                  | Проблема                                                                                      |
| ---------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hardcoded product_code sets        | `_shared/entitlement-sync.ts` L17-29                  | `SUBSCRIPTION_BASED_CODES`, `ORDER_BASED_ONLY_CODES` — бизнес-решения по hardcoded string set |
| Description-based product matching | `bepaid-auto-process` L77-96                          | `descLower.includes('клуб')` для определения tariffType                                       |
| Description-based club fallback    | `bepaid-auto-process` L558-571                        | `descLower.includes('club')` для нахождения mapping                                           |
| Static product name map            | `src/lib/product-names.ts`                            | Hardcoded code→name map, не из БД                                                             |
| Entitlement upsert by product_code | `bepaid-webhook` L3906, `grant-access-for-order` L233 | Entitlement resolution по `product_code`, не по `product_id`                                  |
| Description-based mapping          | `bepaid-raw-transactions` L110-117                    | `PRODUCT_TARIFF_MAPPINGS` — hardcoded description→product map                                 |
| Report import fuzzy match          | `bepaid-report-import` L296-299                       | `desc.includes(m.bepaid_plan_title.toLowerCase())`                                            |
| course-prereg name hack            | `course-prereg-notify` L67                            | `product_code === "cb20_predzapis" ? "«Ценный бухгалтер»"`                                    |


#### Метод аудита

Для каждого обнаруженного места определить:

1. **Это бизнес-решение или display?** Если код решает "что выдать / кому дать / что отозвать" — risk high.
2. **Можно ли заменить на ID?** Где есть product_id рядом — заменить. Где description-matching — зафиксировать как legacy risk.
3. **Два режима**: business resolution = только ID; user search = текст допустим для поиска, после выбора — только ID.

#### Финальный артефакт

`product_identity_runtime_matrix.csv`:


| component_or_function   | layer          | entity_type    | current_identifier_used       | should_use_identifier               | name_based_logic_present | risk_level | fix_required |
| ----------------------- | -------------- | -------------- | ----------------------------- | ----------------------------------- | ------------------------ | ---------- | ------------ |
| entitlement-sync.ts     | edge (_shared) | product        | product_code (hardcoded Set)  | product_id + DB flag                | yes                      | high       | yes          |
| bepaid-auto-process     | edge           | product/tariff | description text matching     | provider_subscription mapping by ID | yes                      | high       | yes (legacy) |
| bepaid-raw-transactions | edge           | product/tariff | description text matching     | ID mapping                          | yes                      | medium     | yes          |
| product-names.ts        | ui (lib)       | product        | product_code → hardcoded name | products_v2 DB query                | yes                      | low        | yes          |
| ...                     | ...            | ...            | ...                           | ...                                 | ...                      | ...        | ...          |


Дополнительный артефакт: `id_vs_name_conflict_cases.csv` — кейсы, где разные product_id имеют визуально похожие имена и могут ввести в заблуждение.

#### DoD для ID-first нормализации

1. Ни один execute-path не принимает решение по похожести названий
2. Ни один access-path не связывает продукты по тексту
3. cb20 и prd_0d01a2fdc477 проходят как независимые сущности во всех audit/proof
4. Модульные продукты не смешиваются с полными курсами по display logic
5. slug/code/name не используются как скрытый surrogate key где должен быть id

---

### Часть 3: PATCH-REMOVE-SLUG-DEPENDENCY-FROM-BUSINESS-LOGIC

Discovery-scope (параллельно с Частью 2):

- Проверить: используются ли slug/code/name как ключ в доступах, training visibility, checkout, bonus rules, module binding
- `public-product-by-slug` — slug допустим как входная точка (public landing), но внутри — только product_id
- `entitlement-sync.ts` — `product_code` как unique key в upsert (это DB constraint, не text matching — допустимо, но зафиксировать)
- `SUBSCRIPTION_BASED_CODES` / `ORDER_BASED_ONLY_CODES` — hardcoded code sets в бизнес-логике → перевести на DB-flag (`is_subscription_based`, `is_order_based_only`)

---

### Обновленный порядок execute

1. **PATCH-NAMING-NORMALIZATION-UI-FIRST** — execute (этот патч)
2. **DISCOVERY: PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION** — параллельно, read-only анализ → артефакты
3. **DISCOVERY: PRODUCT-TARIFF-OFFER-FIELD-BINDING-AUDIT** — параллельно, read-only
4. **PATCH-REAL-FULFILLMENT-GAPS** — следующий execute (4 кейса Бруйло)
5. **DISCOVERY: GRANULAR-MODULE-BINDING** — бизнес-проверка standalone/dual
6. **FOLLOW-UP: 49 cb_module_ip** — hold, без execute

---

### Что НЕ входит

- Массовое переименование модулей в БД
- Auto-renew fix (отдельный патч после field-binding audit)
- Revoke/cleanup по cb_module_ip
- Granular module binding execute (только discovery)