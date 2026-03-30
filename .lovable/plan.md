# да, согласен, с учетом правок:

&nbsp;

1. **v23.1.3A: domain/section тип не просто “скрыть email” — нужен явный rollback из рабочего UI**
  &nbsp;
  - В плане зафиксируй прямо:
    &nbsp;
    - тип **«Доступ к домену / разделу»** сейчас считается **не runtime-ready**;
    - его нельзя оставлять активным вариантом создания нового правила;
    - безопасный вариант: убрать из рабочего выбора **или** показать disabled с подписью Скоро / недоступно.
    &nbsp;
  - Просто “фильтровать email” недостаточно как формулировка. Нужен явный UX-результат, чтобы админ не думал, что функция работает.
  &nbsp;
2. **v23.1.3A: entitlement display model нужно сделать не только label, но и групповую подачу**
  &nbsp;
  - Сейчас проблема не только в raw code, но и в смешении сущностей:
    &nbsp;
    - продукты,
    - клуб,
    - консультации,
    - сервисные/служебные права.
    &nbsp;
  - Добавь в план:
    &nbsp;
    - grouping / category для вариантов в селекте;
    - формат отображения:
      &nbsp;
      - человеческое название
      - вторым слоем технический код
      &nbsp;
    - скрытие совсем непонятных или недопустимых для ручного назначения кодов, если они не должны быть доступны обычному админу.
    &nbsp;
  - Без этого “служебное право доступа” останется частично непонятным.
  &nbsp;
3. **v23.1.3A: numeric fix распространить на все numeric поля Access Rules dialog**
  &nbsp;
  - В плане это упомянуто, но усили:
    &nbsp;
    - один общий паттерн для всех numeric inputs;
    - proof минимум для:
      &nbsp;
      - priority,
      - duration_days,
      - пресеты после ручного ввода.
      &nbsp;
    &nbsp;
  - И отдельно зафиксируй:
    &nbsp;
    - пустое значение допустимо во время ввода;
    - 0 только fallback на save;
    - во время печати не делать автонормализацию.
    &nbsp;
  &nbsp;
4. **v23.1.3B: condition model лучше строить по ID, а не только по product_code**
  &nbsp;
  - В conditions добавь безопасную модель:
    &nbsp;
    - основной ключ: required_product_id
    - опционально display/code для UI/trace
    &nbsp;
  - product_code можно использовать для отображения/совместимости, но не как единственный SoT.
  - В проекте у нас приоритет ID-driven архитектуры, это нужно сохранить. 
  &nbsp;
5. **v23.1.3B: prior purchase condition должна поддерживать как минимум два уровня**
  &nbsp;
  - Не только required_product_code, а:
    &nbsp;
    - required_product_id
    - опционально required_tariff_id
    &nbsp;
  - Потому что твоя бизнес-логика звучит именно как:
    &nbsp;
    - доступ к **тому тарифу/тому ЦБ, который уже был куплен**.
    &nbsp;
  - Только продуктового уровня может быть недостаточно.
  &nbsp;
6. **v23.1.3B: match_mode нужно уточнить и ограничить**
  &nbsp;
  - Сейчас предложены:
    &nbsp;
    - any_paid_order
    - active_entitlement
    &nbsp;
  - Добавь в план, какой именно режим берём **в этом патче по умолчанию**, чтобы не оставлять двусмысленность.
  - Для текущего кейса безопаснее зафиксировать один основной режим:
    &nbsp;
    - any_paid_order
    &nbsp;
  - Остальные режимы — backlog/future.
  &nbsp;
7. **v23.1.3B: UI для условного правила должен быть понятен без технических терминов**
  &nbsp;
  - Не просто condition_type = prior_purchase, а нормальный блок:
    &nbsp;
    - Выдавать только если ранее покупал
    - выбор продукта / тарифа
    &nbsp;
  - И пояснение:
    &nbsp;
    - Проверяется по оплаченным заказам
    &nbsp;
  - Техническое имя condition_type — не показывать как основной UI-текст.
  &nbsp;
8. **v23.1.3B: runtime skip должен быть виден не только в ledger, но и в логике explain/proof**
  &nbsp;
  - Добавь в план:
    &nbsp;
    - как это отразится в preview / proof-отчёте;
    - как будет видно, что правило:
      &nbsp;
      - сработало,
      - не сработало из-за условия.
      &nbsp;
    &nbsp;
  - Иначе это будет видно только в коде/ledger, но не в итоговой проверке.
  &nbsp;
9. **v23.1.3B: proof-пакет нужно прописать сразу**
  &nbsp;
  - Для части B добавь обязательные сценарии:
    &nbsp;
    1. пользователь **без** prior purchase → skipped_by_condition;
    2. пользователь **с** prior purchase → grant выполнен;
    3. legacy и обычные безусловные rules не ломаются;
    4. BUSINESS не даёт ЦБ как безусловный бонус.
    &nbsp;
  - Нужны proof-артефакты:
    &nbsp;
    - UI создания правила;
    - DB/лог/ledger proof;
    - итоговый runtime result.
    &nbsp;
  &nbsp;
10. **Порядок выполнения верный, но добавь stop-condition между A и B**

&nbsp;

&nbsp;

&nbsp;

- После v23.1.3A:
  &nbsp;
  - numeric fix подтверждён,
  - entitlement UX подтверждён,
  - domain rollback подтверждён.
  &nbsp;
- Только после этого переходить к v23.1.3B.
- Не запускать runtime-часть, пока UI-часть не закрыта proof-ом.

&nbsp;

&nbsp;

&nbsp;

11. **DoD для v23.1.3A усили**

&nbsp;

&nbsp;

&nbsp;

- Добавь:
  &nbsp;
  - proof, что 0 удаляется backspace;
  - ввод 3 не даёт 30;
  - служебные права показываются понятными названиями, а не голыми кодами;
  - тип domain/section больше не доступен как рабочая настройка.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

12. **DoD для v23.1.3B усили**

&nbsp;

&nbsp;

&nbsp;

- Добавь:
  &nbsp;
  - правило с condition сохраняется в conditions JSONB;
  - используется ID-based condition;
  - runtime даёт granted / skipped_by_condition;
  - нет безусловной выдачи ЦБ;
  - есть доказуемый proof по двум сценариям: with prior purchase / without prior purchase.
  &nbsp;

&nbsp;

&nbsp;

В остальном разделение на **A = UI-fix** и **B = conditional runtime rule** правильное.

&nbsp;

План: PATCH v23.1.3A + v23.1.3B

Патч разделён на две независимые части. Не смешиваем UI-фикс с runtime/business-logic.

---

## v23.1.3A — Numeric input fix + display model для системных прав

### Scope

- Починить баг numeric inputs (priority залипает на 0, ввод 3 → 30)
- Привести отображение entitlement-кодов к человекочитаемому виду
- Убрать тип «Доступ к домену / разделу» из рабочего выбора (disabled до backend-ready)

### 1. Numeric input — root cause и fix

**Root cause**: поле priority начинается с `"0"`. Курсор встаёт перед нулём → ввод `3` даёт `"30"`. `onBlur` возвращает `"0"` при пустом поле, что блокирует естественное удаление.

**Файл**: `ProductAccessRulesTab.tsx`


| Что                                         | Сейчас                         | Будет                                        |
| ------------------------------------------- | ------------------------------ | -------------------------------------------- |
| Начальное значение priority (стр. 133, 185) | `"0"`                          | `""`                                         |
| openEditDialog (стр. 205)                   | `String(rule.priority)`        | `rule.priority ? String(rule.priority) : ""` |
| onBlur (стр. 906-908)                       | `"" → "0"`                     | **убрать** — пустое допустимо                |
| Input priority                              | без placeholder                | `placeholder="0"`                            |
| handleSave (стр. 227)                       | `parseInt(form.priority) || 0` | без изменений — уже корректно                |


### 2. Entitlement display model

Сейчас в селекторе entitlement (стр. 737) показываются raw-коды: `cb_2_step`, `club`, `consultation`, `premium`, `pro` и т.д. Это непригодно для администратора.

**Решение**:

- В `useAccessRuleSelectors.ts` → `useAvailableEntitlements`: использовать `getProductName(code)` из `src/lib/product-names.ts` для `label`
- В UI (стр. 737): показывать `{e.label}` (человеческое название) + мелким шрифтом `{e.product_code}` как технический код
- Для кодов без маппинга в `PRODUCT_NAMES` — показывать raw code как есть (fallback уже работает в `getProductName`)

### 3. Убрать «Доступ к домену / разделу» из рабочего выбора

**Факт**: тип `email` (domain/section) не имеет реального SoT для пользовательского доступа. `product_email_mappings` — это настройка email-отправки, не grant.

**Решение**:

- В селекторе типа цели (стр. 664-668): фильтровать `email` так же как `entitlement` — но вместо показа с бейджем, **не показывать совсем** или показать disabled с пометкой «Недоступно»
- В `getRuntimeSupport` (стр. 497): `email` → `"disabled"` (или убрать из enum)
- Существующие legacy email-маппинги в preview продолжают отображаться (это данные, не создание новых правил)

### Файлы v23.1.3A


| Файл                                                     | Изменения                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | priority: "" вместо "0", убрать onBlur, placeholder, скрыть email из селектора, entitlement display |
| `src/hooks/useAccessRuleSelectors.ts`                    | entitlement label через getProductName                                                              |


### DoD v23.1.3A

1. Ввод `3` в пустое поле priority → `3`, не `30`
2. Можно оставить priority пустым, при сохранении → 0
3. Системные права показываются человеческими названиями + код мелким шрифтом
4. «Доступ к домену / разделу» не доступен для выбора при создании нового правила
5. Существующие legacy email-маппинги в preview не затронуты

---

## v23.1.3B — Условное служебное правило (conditional service rule)

### Scope

- Добавить модель условного доступа по факту предыдущей покупки
- Использовать существующее JSONB поле `conditions` в `access_rules` — без изменения schema
- Добавить runtime-проверку в `grant-access-for-order`
- Кейс: при покупке Gorbova Club / тариф BUSINESS доступ к «Ценному бухгалтеру» выдаётся **только если** у пользователя уже есть покупка ЦБ

### 1. Condition model в `conditions` JSONB

Структура (add-only, не меняет schema):

```json
{
  "rule_purpose": "service",
  "condition_type": "prior_purchase",
  "required_product_code": "cb20",
  "match_mode": "any_paid_order"
}
```

- `condition_type: "prior_purchase"` — правило активируется только при наличии предыдущей покупки
- `required_product_code` — код продукта, покупка которого является условием
- `match_mode`: `any_paid_order` (есть хотя бы один paid order с этим product_code) или `active_entitlement` (есть активный entitlement)

### 2. Discovery: что считается «покупал»

Проверка по таблице `orders_v2`:

```sql
SELECT 1 FROM orders_v2 o
JOIN products_v2 p ON o.product_id = p.id
WHERE o.user_id = {user_id}
  AND p.code = {required_product_code}
  AND o.status = 'paid'
LIMIT 1
```

Это самый надёжный и простой источник. Альтернатива — проверка `entitlements`, но orders_v2 даёт более явную бизнес-семантику «покупал».

### 3. UI для условного правила

В форме создания/редактирования правила при `rule_purpose = "service"`:

- Показывать дополнительный блок «Условие выдачи»
- Селект: `condition_type = "prior_purchase"`
- Селект продукта-условия (из `products_v2`)
- Подпись: «Доступ будет выдан только если у покупателя уже есть оплаченный заказ на выбранный продукт»

### 4. Runtime в `grant-access-for-order`

В текущем grant flow (стр. 562-640) после чтения `access_rules`:

- Если правило имеет `conditions.condition_type === "prior_purchase"`:
  - Проверить наличие paid order с `required_product_code`
  - Если условие выполнено → grant как обычно
  - Если не выполнено → skip + ledger entry со статусом `skipped_by_condition`
  - Лог: `[grant-access] Conditional rule {rule_id}: prior_purchase check → granted/skipped`

Это add-only логика: существующие правила без conditions продолжают работать как раньше.

### 5. Ledger entry для conditional skip

При пропуске условного правила записать в `access_grant_ledger`:

```json
{
  "status": "skipped",
  "reason_code": "condition_not_met",
  "meta": {
    "condition_type": "prior_purchase",
    "required_product_code": "cb20",
    "check_result": false
  }
}
```

### Файлы v23.1.3B


| Файл                                                     | Изменения                                               |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | UI-блок условия при rule_purpose=service                |
| `src/hooks/useAccessRules.ts`                            | Отображение условия в preview/effective grants          |
| `supabase/functions/grant-access-for-order/index.ts`     | Add-only: проверка prior_purchase condition перед grant |


### DoD v23.1.3B

1. Условное правило можно создать через UI (rule_purpose=service + condition)
2. Условие сохраняется в `conditions` JSONB без изменения schema
3. Runtime проверяет prior_purchase перед выдачей
4. При невыполнении условия → skip + ledger entry `skipped_by_condition`
5. Существующие безусловные правила не затронуты
6. BUSINESS не выдаёт ЦБ как безусловный бонус — только при выполнении условия

---

## Порядок выполнения

1. **Сначала v23.1.3A** — чистый UI-фикс, без backend-изменений
2. **Затем v23.1.3B** — условные правила + runtime

Части не зависят друг от друга и не смешиваются.