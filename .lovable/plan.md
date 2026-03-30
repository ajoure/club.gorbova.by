да, согласен, с учетом правок:

&nbsp;

1. **Не фиксируй заранее, что runtime будет создавать entitlements или subscriptions_v2**
  &nbsp;
  - Это пока недоказанное предположение.
  - Сначала в плане добавь обязательный discovery:
    &nbsp;
    - какой именно объект в системе является фактом “выдан доступ к продукту”;
    - какая таблица/проекция используется сейчас для продуктового доступа;
    - как это связано с тарифом.
    &nbsp;
  - Только после этого описывать конкретный runtime write-path.
  - Иначе есть риск реализовать неверную проекцию и сломать бизнес-логику.
  &nbsp;
2. **Раздели явно два уровня runtime**
  &nbsp;
  - **resolve rules**
  - **execute product access grant**
  - В текущем плане это смешано.
  - Нужен отдельный шаг:
    &nbsp;
    1. собрать effective product_access rules;
    2. развернуть multi-target список;
    3. применить per-product prior purchase filter;
    4. передать прошедшие цели в фактический executor доступа.
    &nbsp;
  - Если executor ещё не существует, это надо честно зафиксировать как часть патча, а не маскировать под “создать entitlement или subscription”.
  &nbsp;
3. **Нужен один явный runtime contract для product_access**
  &nbsp;
  - В плане добавь:
    &nbsp;
    - что считается целевым результатом grant;
    - как это выглядит в данных;
    - как будет доказано, что пользователь реально получил доступ.
    &nbsp;
  - Без этого DoD “access granted” слишком расплывчат.
  &nbsp;
4. **UI multi-select для target products — согласен, но нужен safe UX**
  &nbsp;
  - Добавь:
    &nbsp;
    - поиск;
    - чекбоксы;
    - chips выбранных продуктов;
    - счётчик выбранных;
    - если список длинный — scroll area.
    &nbsp;
  - И отдельно:
    &nbsp;
    - не показывать сырые UUID;
    - только человекочитаемые названия.
    &nbsp;
  &nbsp;
5. **Для condition multi-select добавь режим по умолчанию: “использовать тот же список, что и для выдачи”**
  &nbsp;
  - Это как раз соответствует твоему кейсу с ЦБ и модулями.
  - Иначе администратор будет дважды руками выбирать один и тот же набор.
  - В плане зафиксируй UX:
    &nbsp;
    - toggle:
      &nbsp;
      - Проверять эти же продукты
      - либо Выбрать отдельный список
      &nbsp;
    &nbsp;
  - Это сильно упростит настройку.
  &nbsp;
6. **match_mode = per_product — правильный default, его нужно усилить формулировкой**
  &nbsp;
  - Прямо укажи:
    &nbsp;
    - если из 5 выбранных target products ранее покупались только 2, доступ выдаётся только к этим 2;
    - к остальным — skip.
    &nbsp;
  - Это центральная бизнес-логика патча, её надо выделить отдельно.
  &nbsp;
7. **Нужна отдельная backward-compatible модель хранения**
  &nbsp;
  - Согласен с add-only JSONB.
  - Но в плане добавь явный mapping:
    &nbsp;
    - старое single-target rule:
      &nbsp;
      - target_ref
      &nbsp;
    - новое multi-target rule:
      &nbsp;
      - [conditions.target](http://conditions.target)_product_ids
      &nbsp;
    - старое single condition:
      &nbsp;
      - required_product_id
      &nbsp;
    - новое multi condition:
      &nbsp;
      - conditions.required_product_ids
      &nbsp;
    &nbsp;
  - И явно зафиксируй precedence:
    &nbsp;
    - если есть массив — используем массив;
    - если массива нет — fallback на старое одиночное поле.
    &nbsp;
  &nbsp;
8. **Карточка правила должна показывать не только количество, но и разворачиваемый список**
  &nbsp;
  - Не ограничивайся только:
    &nbsp;
    - Доступ к 4 продуктам
    &nbsp;
  - Нужен:
    &nbsp;
    - collapsed summary,
    - expandable details / tooltip / popover со списком продуктов.
    &nbsp;
  - Аналогично для условия:
    &nbsp;
    - Условие: ранее покупал 4 продукта
    - с возможностью посмотреть полный список.
    &nbsp;
  &nbsp;
9. **Нужно сохранить текущую семантику назначения**
  &nbsp;
  - Согласен: Основной / Бонус / Дополнительный / Служебное не трогаем.
  - Но добавь в план:
    &nbsp;
    - multi-product + prior purchase доступен при любом назначении;
    - для кейса ЦБ обычно используется Служебное или Бонус, но это не влияет на runtime-фильтрацию.
    &nbsp;
  - Чтобы не было скрытой логики, завязанной на rule_purpose.
  &nbsp;
10. **Нужен отдельный discovery по prior purchase evidence**

&nbsp;

&nbsp;

&nbsp;

- В плане сейчас это подразумевается, но не раскрыто.
- Добавь:
  &nbsp;
  - по каким полям и статусам определяется “покупал”;
  - что считается валидной покупкой;
  - как учитывать продукт/тариф.
  &nbsp;
- Даже если для этого патча тарифы пока не используем в condition, нужно явно зафиксировать источник правды по purchase history.

&nbsp;

&nbsp;

&nbsp;

11. **Тарифную часть пока не усложнять, но не потерять**

&nbsp;

&nbsp;

&nbsp;

- С учётом текущего спринта правильно:
  &nbsp;
  - condition по продуктам;
  - тариф-condition пока не развивать.
  &nbsp;
- Но в плане явно вынеси в deferred:
  &nbsp;
  - required_tariff_ids / per-tariff prior purchase.
  &nbsp;
- Иначе позже этот вопрос потеряется.

&nbsp;

&nbsp;

&nbsp;

12. **Ledger/trace per product — согласен, но добавь строгий статусный контракт**

&nbsp;

&nbsp;

&nbsp;

- Для каждого target product нужен итог:
  &nbsp;
  - granted
  - skipped_by_condition
  - при необходимости failed
  &nbsp;
- И это должно быть видно не только в логах, но и в proof-отчёте.
- Если reason_code уже стандартизирован, не вводить новые значения без проверки словаря.

&nbsp;

&nbsp;

&nbsp;

13. **Proof-пакет нужно прописать сразу и детально**

&nbsp;

&nbsp;

&nbsp;

- Добавь обязательные сценарии:
  &nbsp;
  1. multi-rule создан через UI;
  2. выбраны несколько target products;
  3. выбраны продукты для prior purchase;
  4. пользователь ранее покупал только часть из них;
  5. runtime выдал доступ только к совпавшим;
  6. по остальным — skip;
  7. старые single-target rules продолжают работать.
  &nbsp;
- Нужны доказательства:
  &nbsp;
  - UI;
  - runtime logs / DB trace / ledger;
  - итоговый доступ пользователя.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

14. **В плане нужен stop-guard**

&nbsp;

&nbsp;

&nbsp;

- Не переходить к финальному approve, пока не доказано:
  &nbsp;
  - что product_access вообще исполняется runtime;
  - что multi-target не ломает старые single-target rules;
  - что per-product filtering реально работает.
  &nbsp;
- Это должен быть явный gate между “код написан” и “патч закрыт”.

&nbsp;

&nbsp;

&nbsp;

15. **Domain/section access действительно не трогаем в этом патче**

&nbsp;

&nbsp;

&nbsp;

- Зафиксируй это отдельной строкой в scope exclusion:
  &nbsp;
  - disabled/rollback остаётся как есть;
  - не смешивать его с multi-product service rule.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

16. **Порядок выполнения правильный, но добавь discovery первым пунктом**

&nbsp;

&nbsp;

&nbsp;

- Итоговый порядок лучше такой:
  &nbsp;
  1. discovery текущего runtime product_access contract;
  2. UI multi-select target products;
  3. UI condition multi-select + режим “использовать тот же список”;
  4. save/edit restore/backward compatibility;
  5. rule list / preview display;
  6. runtime rule resolution;
  7. per-product filter + executor;
  8. ledger/trace;
  9. proof package.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

17. **Обнови DoD**

&nbsp;

&nbsp;

&nbsp;

- Добавь:
  &nbsp;
  - одно правило может выдавать несколько продуктов;
  - одно правило может проверять prior purchase по нескольким продуктам;
  - по умолчанию можно использовать тот же список, что и для выдачи;
  - runtime выдаёт доступ только по реально купленным продуктам;
  - старые single-target и single-condition rules не ломаются;
  - product_access runtime доказан, а не только настроен в UI.
  &nbsp;

&nbsp;

&nbsp;

# PATCH v23.1.4 — Multi-product access rule + per-product prior purchase filter

## Текущее состояние

### UI (ProductAccessRulesTab.tsx)

- `product_access` target: single-select продукта через `target_ref` (один UUID)
- Condition block: single `condition_required_product_id` + optional `condition_required_tariff_id`
- Save: пишет `target_ref` = один product ID, `conditions.required_product_id` = один ID

### Runtime (grant-access-for-order/index.ts)

- Обрабатывает только `grant_target_type = "club"` из access_rules (строки 626-667)
- `product_access` rules **вообще не обрабатываются** в runtime — нет ни одного запроса к `access_rules` с `grant_target_type = "product_access"`
- `checkPriorPurchaseCondition` — работает, но только в контексте club rules

### Storage (access_rules table)

- `target_ref` — одиночное текстовое поле
- `conditions` — JSONB, свободная структура

---

## Что нужно сделать

### Часть 1: UI — multi-select продуктов для выдачи

**Файл**: `ProductAccessRulesTab.tsx`

Когда `grant_target_type === "product_access"`:

- Заменить single Select на **checkbox-list** с поиском
- Form state: добавить `target_product_ids: string[]` (массив выбранных product IDs)
- При сохранении:
  - `target_ref` = первый product ID (backward-compatible для старых правил)
  - `conditions.target_product_ids` = полный массив (add-only, JSONB)
  - `target_label` = "3 продукта" или перечисление имён
- При редактировании: восстанавливать `target_product_ids` из `conditions.target_product_ids`, fallback на `[target_ref]`

UI компонент multi-select:

- Список продуктов с чекбоксами
- Поиск/фильтр по названию
- Выбранные показываются как chips/badges сверху
- Компактный, помещается в модалку

### Часть 2: UI — multi-select продуктов для prior purchase condition

Когда `has_condition === true`:

- Заменить single Select продукта-условия на аналогичный checkbox-list
- Form state: `condition_required_product_ids: string[]`
- Save: `conditions.required_product_ids` = массив (add-only)
- Backward-compatible: старые правила с `required_product_id` (single) продолжают работать
- Тариф-условие убрать из этого патча (усложнение без пользы при per-product filtering)

### Часть 3: UI — отображение в карточке правила

В списке правил (строки 420-525):

- Для multi-product rules показывать:
  - `"Доступ к 4 продуктам"` вместо одного имени
  - Hover/expand с полным списком
- Condition badge: `"Условие: ранее покупал 4 продукта"` (hover — список)

### Часть 4: Runtime — обработка product_access rules

**Файл**: `grant-access-for-order/index.ts`

Сейчас runtime обрабатывает только club rules. Нужно добавить **новую секцию** после блока Telegram (после строки 709):

```text
// 3b. Process product_access rules — grant access to additional products
```

Логика:

1. Запросить `access_rules` где `product_id = {productId}` AND `grant_target_type = "product_access"` AND `is_active = true`
2. Аналогично tariff-level + product-level с приоритетами
3. Для каждого правила:
  - Получить список target products: `conditions.target_product_ids` || `[target_ref]`
  - Если есть condition `prior_purchase`:
    - Получить `required_product_ids` (или `[required_product_id]` для legacy)
    - Для каждого target product проверить: есть ли у user paid order на этот product
    - Если есть → grant (создать entitlement / subscription)
    - Если нет → skip + ledger entry per product
  - Если нет condition → grant все target products безусловно

### Часть 5: Runtime — per-product grant execution

Для каждого granted product из правила:

- Создать запись в `entitlements` или `subscriptions_v2` (в зависимости от бизнес-модели продукта)
- Написать ledger entry per product:
  - `target_type: "product_access"`
  - `target_key: "{userId}:{targetProductId}"`
  - `status: "granted"` или `"skipped"`
  - `reason_code: "condition_not_met"` для skipped

### Часть 6: Runtime — backward compatibility

- Старые правила с одним `target_ref` и без `target_product_ids` → работают как раньше (массив из одного элемента)
- Старые правила с `required_product_id` (single) → работают как массив из одного
- Club rules → без изменений
- Entitlement rules → без изменений

---

## Storage contract (add-only JSONB)

```json
{
  "rule_purpose": "service",
  "target_product_ids": ["uuid-1", "uuid-2", "uuid-3"],
  "condition_type": "prior_purchase",
  "required_product_ids": ["uuid-1", "uuid-2", "uuid-3"],
  "match_mode": "per_product"
}
```

- `match_mode = "per_product"` — для каждого target product проверяется, покупал ли user **именно этот** product. Выдаётся доступ только к тем, что покупались.
- Backward: `target_product_ids` отсутствует → fallback на `[target_ref]`
- Backward: `required_product_ids` отсутствует → fallback на `[required_product_id]`

---

## Файлы


| Файл                              | Изменения                                                             |
| --------------------------------- | --------------------------------------------------------------------- |
| `ProductAccessRulesTab.tsx`       | Multi-select для targets + conditions, карточка правила, edit restore |
| `useAccessRuleSelectors.ts`       | Без изменений (products query уже есть)                               |
| `grant-access-for-order/index.ts` | Новая секция product_access rules + per-product prior purchase check  |


---

## DoD v23.1.4

1. Одно правило позволяет выбрать несколько продуктов на выдачу (checkbox-list с поиском)
2. Condition prior_purchase поддерживает множественный выбор продуктов
3. Runtime проходит по каждому target product и проверяет prior purchase **per product**
4. Продукт A куплен ранее → access granted; Продукт B не куплен → skipped
5. Ledger entry per product: granted / skipped_by_condition
6. Старые single-target правила не ломаются
7. Club, entitlement rules не затронуты
8. В карточке правила видно количество и список продуктов
9. match_mode = `per_product` зафиксирован как default

---

## Порядок выполнения

1. UI multi-select для target products
2. UI multi-select для condition products
3. Save/edit restore для новой модели
4. Карточка правила — отображение multi-product
5. Runtime product_access rule processing
6. Runtime per-product prior purchase filter
7. Ledger entries per product
8. Proof: создать правило → runtime → granted/skipped per product