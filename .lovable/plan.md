# да, согласен, с учетом правок:

&nbsp;

&nbsp;

## **1. Убрать неопределённость по scope v23**

&nbsp;

&nbsp;

В текущем виде план смешивает **новую продуктовую функцию** и **технический cleanup**. Это снова создаст расползание scope.

&nbsp;

Зафиксировать:

&nbsp;

&nbsp;

### **В v23 включить как основной scope:**

&nbsp;

&nbsp;

1. **Access Rules UI**
2. **Mapping Rules consolidation**
3. **Visual controls**

&nbsp;

&nbsp;

&nbsp;

### **Вынести из основного scope v23 в follow-up sprint:**

&nbsp;

&nbsp;

4. **Semantic cleanup: grant vs extend**
5. **Dead code cleanup in subscription-charge**

&nbsp;

&nbsp;

Причина:

&nbsp;

- блоки 1/2/5 дают пользователю видимый результат;
- блоки 3/4 — это уже техническая семаника/рефакторинг backend, они легко опять затянут спринт и вернут нас в бесконечную backend-пересборку.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **2. Уточнить, что именно должен дать v23 пользователю**

&nbsp;

&nbsp;

Нужен не абстрактный “UI / access rules”, а конкретный пользовательский результат.

&nbsp;

Добавить в цель спринта:

&nbsp;

&nbsp;

### **Цель v23**

&nbsp;

&nbsp;

Сделать так, чтобы админ **визуально управлял тем, что получает покупатель** при покупке продукта/тарифа, без ручного чтения edge functions и без SQL.

&nbsp;

&nbsp;

### **Пользовательский результат после v23**

&nbsp;

&nbsp;

Админ в интерфейсе должен уметь:

&nbsp;

- открыть продукт / тариф;
- увидеть, какие доступы сейчас будут выданы покупателю;
- добавить / убрать правила выдачи;
- выбрать тип выдачи:
  &nbsp;
  - entitlement
  - telegram club
  - email/domain access
  - subscription tier / product-level grant
  &nbsp;
- видеть источник правила: product-level / tariff-level / legacy mapping;
- понимать, что сработает при покупке конкретного тарифа.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **3. Зафиксировать основной UI-модуль, а не распылять правки**

&nbsp;

&nbsp;

Сейчас в плане нет решения, **где именно** будет главный экран управления rules.

&nbsp;

Нужно явно выбрать один SoT-экран:

&nbsp;

&nbsp;

### **Основной экран v23**

&nbsp;

&nbsp;

**/admin/products-v2 → Product editor → вкладка Access Rules**

&nbsp;

И только как вспомогательные:

&nbsp;

- entitlements
- club mappings
- email/domain mappings

&nbsp;

&nbsp;

Правило:

&nbsp;

- **не делать 3–4 равноправных места настройки одной и той же логики**;
- основной UX — через карточку продукта/тарифа;
- старые экраны пока остаются, но либо:
  &nbsp;
  - становятся read-only / diagnostic,
  - либо получают ссылки “открыть в Access Rules”.
  &nbsp;

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **4. Нужен единый SoT для правил выдачи**

&nbsp;

&nbsp;

Сейчас в плане сказано, что offer_grant_rules отсутствует, но не зафиксировано, вводим ли мы его как новый SoT.

&nbsp;

Это нужно решить прямо в плане.

&nbsp;

Добавить:

&nbsp;

&nbsp;

### **Новый источник истины**

&nbsp;

&nbsp;

Ввести единый слой правил, например:

&nbsp;

- offer_grant_rules или
- access_rules

&nbsp;

&nbsp;

С чётким контрактом:

&nbsp;

- rule scope: product_id или tariff_id
- grant target type:
  &nbsp;
  - entitlement
  - club
  - domain
  - email_template / email_access
  - subscription_tier / product access
  &nbsp;
- target_ref / target_key
- is_active
- priority / evaluation_order
- conditions (если нужны)
- meta / notes
- created_by / updated_by

&nbsp;

&nbsp;

&nbsp;

### **Правило приоритета**

&nbsp;

&nbsp;

- tariff-level rule имеет приоритет над product-level
- legacy mappings не удаляем сразу, а читаем как fallback на переходный период

&nbsp;

&nbsp;

Без этого UI будет просто красивой обёрткой над разрозненными таблицами.

&nbsp;

---

&nbsp;

&nbsp;

## **5. Добавить migration strategy, иначе сломаем текущую логику**

&nbsp;

&nbsp;

Сейчас план не говорит, как жить со старыми таблицами:

&nbsp;

- product_club_mappings
- bepaid_product_mappings
- product_email_mappings

&nbsp;

&nbsp;

Нужно добавить переходную модель:

&nbsp;

&nbsp;

### **Переходный режим v23**

&nbsp;

&nbsp;

1. Новые правила сохраняются в новом rule-layer
2. Legacy tables пока не удаляются
3. Runtime сначала читает новый rule-layer
4. Если rules не найдены — использует legacy mappings fallback
5. В UI показывать происхождение:
  &nbsp;
  - new_rule
  - legacy_mapping
  - mixed
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

### **Отдельный DoD**

&nbsp;

&nbsp;

Для каждого legacy mapping должно быть видно:

&nbsp;

- мигрирован он в новый rules-layer или ещё нет.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **6. Нужен конкретный runtime-contract**

&nbsp;

&nbsp;

Сейчас план про UI, но не описано, **кто именно** будет читать rules в runtime.

&nbsp;

Добавить явный scope runtime integration:

&nbsp;

&nbsp;

### **В v23 должны читать новый rules-layer:**

&nbsp;

&nbsp;

- grant-access-for-order
- импортные пути, где создаются доступы
- admin grant flows, если они реально выдают доступ
- telegram grant path — через уже разрешённую логику downstream

&nbsp;

&nbsp;

&nbsp;

### **Вне scope v23:**

&nbsp;

&nbsp;

- менять ledger-архитектуру;
- делать новый cutover;
- пересобирать phase1 backend;
- чистить dead code.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **7. Добавить конкретные UI-сценарии, которые должны заработать**

&nbsp;

&nbsp;

Сейчас нет ни одного user-story с проверяемым результатом.

&nbsp;

Добавить минимум 5 сценариев:

&nbsp;

&nbsp;

### **Сценарий 1**

&nbsp;

&nbsp;

Админ открывает продукт **«Ценная бухгалтер 2.0»** и видит список всех текущих grants.

&nbsp;

&nbsp;

### **Сценарий 2**

&nbsp;

&nbsp;

Админ добавляет rule на тариф **Business**:

&nbsp;

- при покупке выдать доступ в **Gorbova Club**

&nbsp;

&nbsp;

&nbsp;

### **Сценарий 3**

&nbsp;

&nbsp;

Админ добавляет domain access:

&nbsp;

- при покупке открыть доступ к определённому домену / разделу платформы

&nbsp;

&nbsp;

&nbsp;

### **Сценарий 4**

&nbsp;

&nbsp;

Админ видит preview:

&nbsp;

- что получит покупатель по конкретному тарифу после применения всех rules

&nbsp;

&nbsp;

&nbsp;

### **Сценарий 5**

&nbsp;

&nbsp;

Админ отключает rule и понимает, что legacy fallback всё ещё активен или уже нет.

&nbsp;

---

&nbsp;

&nbsp;

## **8. Обязательно нужен Preview / Explain Mode**

&nbsp;

&nbsp;

Без этого админ не поймёт, что реально сработает.

&nbsp;

Добавить в v23:

&nbsp;

&nbsp;

### **Preview / Explain panel**

&nbsp;

&nbsp;

Для выбранного продукта / тарифа показывать:

&nbsp;

- итоговый список grants;
- откуда взялся каждый grant;
- какой rule победил;
- какие legacy mappings ещё участвуют;
- что будет выдано новому покупателю.

&nbsp;

&nbsp;

Это один из самых важных пунктов спринта.

&nbsp;

---

&nbsp;

&nbsp;

## **9. Visual controls нужно конкретизировать**

&nbsp;

&nbsp;

Сейчас блок “Visual controls” слишком общий.

&nbsp;

Уточнить, что именно входит:

&nbsp;

&nbsp;

### **Входит**

&nbsp;

&nbsp;

- таблица правил
- фильтры по типу rule
- фильтр active/inactive
- поиск
- inline badges:
  &nbsp;
  - product-level
  - tariff-level
  - legacy
  - fallback
  &nbsp;
- drawer/modal для создания и редактирования rule
- preview panel
- warning badges для конфликтов

&nbsp;

&nbsp;

&nbsp;

### **Не входит**

&nbsp;

&nbsp;

- большой UI-рефактор всей админки
- drag&drop-конструктор
- массовый bulk-edit всех продуктов сразу

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **10. Нужен conflict model**

&nbsp;

&nbsp;

Если не описать конфликты, правила начнут дублироваться.

&nbsp;

Добавить:

&nbsp;

&nbsp;

### **Конфликтные случаи**

&nbsp;

&nbsp;

- одинаковый target выдается и на product-level, и на tariff-level
- legacy mapping и new rule дублируют друг друга
- inactive rule перекрывается active fallback
- один тариф выдаёт 2 несовместимых grants

&nbsp;

&nbsp;

&nbsp;

### **Что должен делать UI**

&nbsp;

&nbsp;

- показывать conflict badge
- показывать effective winner
- не молча применять конфликтную конфигурацию

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **11. Semantic cleanup и dead code вынести в отдельный follow-up sprint явно**

&nbsp;

&nbsp;

Не просто “отложить”, а зафиксировать отдельным блоком:

&nbsp;

&nbsp;

### **Follow-up sprint after v23**

&nbsp;

&nbsp;

1. grant vs extend semantic refactor
2. dead code cleanup in subscription-charge
3. semantic analytics/reporting alignment
4. optional cutover of legacy mappings → rules-only mode

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **12. Нужен переписанный итоговый порядок v23**

&nbsp;

&nbsp;

Добавить в план такой порядок:

&nbsp;

&nbsp;

### **Фаза A — Rule model + runtime read path**

&nbsp;

&nbsp;

- новый rules-layer
- read-path integration
- legacy fallback

&nbsp;

&nbsp;

&nbsp;

### **Фаза B — Product UI**

&nbsp;

&nbsp;

- вкладка Access Rules в /admin/products-v2
- список / create / edit / disable
- preview / explain

&nbsp;

&nbsp;

&nbsp;

### **Фаза C — Mapping consolidation**

&nbsp;

&nbsp;

- связывание legacy mappings с новым rules-layer
- indicators source-of-truth / fallback / migrated

&nbsp;

&nbsp;

&nbsp;

### **Фаза D — Visual polish + proof**

&nbsp;

&nbsp;

- фильтры
- badges
- conflict states
- proof / DoD / runtime examples

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **13. DoD нужно усилить**

&nbsp;

&nbsp;

Сейчас DoD отсутствует как проверяемый результат.

&nbsp;

Добавить:

&nbsp;

&nbsp;

### **DoD v23**

&nbsp;

&nbsp;

1. У продукта и тарифа есть экран Access Rules
2. Можно создать минимум 4 типа grants через UI
3. Preview показывает effective grants до покупки
4. Runtime умеет читать новый rules-layer
5. Legacy mappings не ломаются и видны как fallback
6. Для тарифа Business можно настроить выдачу Gorbova Club без SQL
7. Для домена / раздела платформы можно создать rule без ручного кода
8. Конфликты отображаются явно
9. Есть минимум один proof сценарий на реальном продукте
10. Старый backend sprint не переоткрывается

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **14. Итог: что именно запускать в работу**

&nbsp;

&nbsp;

Не оставлять вопрос “какие из 5 блоков входят”, а зафиксировать сразу:

&nbsp;

&nbsp;

### **Запускаем в v23:**

&nbsp;

&nbsp;

- Access Rules UI
- Mapping Rules consolidation
- Visual controls
- Preview / Explain
- New rules-layer + legacy fallback

&nbsp;

&nbsp;

&nbsp;

### **Не включаем в v23:**

&nbsp;

&nbsp;

- grant vs extend semantic refactor
- dead code cleanup
- cutover
- новый backend sprint по ledger

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

План: Sprint v23 — UI / Access Rules / Semantic Cleanup

## Фиксация закрытия v22.6–v22.8

```
IMPLEMENTATION = COMPLETE
READINESS = COMPLETE  
CUTOVER = DEFERRED MANUALLY
phase1_ledger_cutover_at = NOT SET
RETURN_TO_BACKEND = only on critical new fact
```

Спринты v22.6 / v22.7 / v22.8 закрыты. Backend не дробим и не пересогласовываем.

---

## Scope следующего спринта (v23)

На основе анализа кодовой базы — уже существуют:

- `AdminProductsV2` — каталог продуктов (766 строк)
- `AdminEntitlements` — управление entitlements (548 строк)
- `ProductClubMappings` — маппинг продукт → клуб (369 строк)
- `bepaid_product_mappings` — маппинг bePaid → продукт
- `product_email_mappings` — маппинг продукт → email
- `has_valid_access_for_club()` — RPC проверки доступа через маппинги

Отсутствует: `offer_grant_rules` / универсальные access rules / semantic extend path.

### Предлагаемые блоки (для уточнения приоритетов)


| #   | Блок                                  | Описание                                                                                                                                |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Access Rules UI**                   | Визуальный редактор правил "продукт/оффер → что выдаётся" (entitlement, telegram club, tier). Сейчас логика размазана по edge functions |
| 2   | **Mapping Rules consolidation**       | Объединить разрозненные маппинги (product_club, bepaid_product, product_email) в единый UI или хотя бы единую навигацию                 |
| 3   | **Semantic cleanup: grant vs extend** | Добавить `action_type='extend'` в `grant-access-for-order` при повторной покупке/продлении                                              |
| 4   | **Dead code cleanup**                 | Удалить ~1200 строк unreachable кода в `subscription-charge`                                                                            |
| 5   | **Visual controls**                   | Улучшения UI: фильтры, статусы, batch-операции в admin-панели                                                                           |


---

## Вопрос перед стартом

Нужно определить приоритет и порядок блоков. Предлагаю уточнить:

- какие из 5 блоков входят в первый спринт, а какие откладываются
- есть ли конкретные UI-задачи, которые нужны прямо сейчас (пользователь на странице `/admin/products-v2`)

После уточнения — разобью выбранные блоки на конкретные задачи с DoD.