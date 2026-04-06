## да, согласен, с учетом правок:

&nbsp;

1. Убери из плана любую **специальную хардкод-логику именно для cb20** внутри resolver.
  Это принципиально важно.
  Нельзя писать в коде: “для cb20 direct grant запрещен”, “для cb20 только BUSINESS”, “для cb20 deny по умолчанию отдельной веткой”.
  Правильная формулировка:
  &nbsp;
  - **resolver универсальный**
  - он не знает “особых продуктов”
  - он читает только access_rules
  - если по cb20 в access_rules нет активного grant-правила — значит доступ закрыт
  - если есть правило — значит доступ разрешён
    То есть поведение cb20 определяется **не кодом**, а **данными в правилах продукта**.
  &nbsp;
2. В разделе про cb20 замени фразу
  **«Resolver не может выдавать cb20 из historical order напрямую»**
  на
  **«Resolver не может выдавать доступ ни к одному продукту из history/import/export напрямую, если это не подтверждено действующим access_rule»**.
  Это должно быть общим правилом системы, а не отдельной магией для cb20.
3. В EXECUTE 1 перепиши цель resolver так:
  &nbsp;
  - primary grant, secondary grants, training filters, club grants — всё считается **только из access_rules**
  - никаких продукт-специфичных исключений в коде
  - никаких веток “если product_code === cb20”
  - никаких решений по названию/коду/slug
    Иначе вы просто замените один хардкод другим.
  &nbsp;
4. Сейчас у тебя в плане есть противоречие:
  &nbsp;
  - с одной стороны ты пишешь: **только access_rules**
  - с другой стороны ты оставляешь идею, что direct purchase cb20 обрабатывается отдельно.
    Это надо убрать.
    Должно быть так:
  - если покупка cb20 действительно должна что-то давать — это должно быть оформлено **как правило в access_rules**
  - если не должна — такого правила нет, доступ не выдаётся
  - код не решает это сам
  &nbsp;
5. Добавь отдельный обязательный этап **проверки конфигурации rules для cb20 в админке**:
  &nbsp;
  - какие именно правила сейчас созданы на странице продукта
  - какие из них active/inactive
  - какие rule types там есть (product_access, club, training_content)
  - покрывают ли они бизнес-логику полностью
    Если для нужного поведения правила в UI не хватает — сначала **создать/исправить правило в данных**, а не дописывать поведение в функцию.
  &nbsp;
6. В блоке CB20 — пересборка всех active по правилам продукта добавь:
  &nbsp;
  - если active cb20 нельзя объяснить **текущим active rule из admin UI**, он идёт в repair-list;
  - historical purchase используется только как **condition input** внутри правила, но не как самостоятельное основание.
    Это ключевой момент.
  &nbsp;
7. Убери формулировку:
  **«Для cb20 в системе не существует самостоятельного прямого active доступа»**
  в текущем виде она звучит как отдельное бизнес-правило в коде.
  Замени на:
  **«Для cb20 active доступ допускается только тогда, когда он следует из активной конфигурации access_rules на странице продукта. Вне этих правил доступ запрещён.»**
8. В EXECUTE 2 исправь постановку для grant-access-for-order:
  &nbsp;
  - функция не должна “запрещать primary direct grant для cb20”
  - функция должна **вообще не иметь собственного знания**, что такое cb20
  - она должна только:
    &nbsp;
    1. загрузить order/product/tariff по ID
    2. вызвать resolver
    3. исполнить grants, которые вернул resolver
    4. записать access_rule_id, resolver_path, grant_type
      То есть запрет на выдачу cb20 появляется автоматически, если resolver не нашёл активное правило.
    &nbsp;
  &nbsp;
9. В EXECUTE 3 для repair-cb20-entitlements добавь жёстко:
  &nbsp;
  - функция не имеет права сама классифицировать “valid/invalid” по бизнес-смыслу;
  - она получает только mechanical repair-list, построенный от access_rules;
  - если нет access_rule_id, entitlement выключается или попадает в dry-run disable list.
    Без “умных” исключений.
  &nbsp;
10. Добавь отдельный обязательный артефакт:
  **cb20_rules_from_admin_ui_snapshot.csv**
  Колонки:

&nbsp;

&nbsp;

&nbsp;

- access_rule_id
- product_id
- tariff_id
- grant_target_type
- target_ref
- is_active
- conditions
- is_used_by_resolver
  Это нужно, чтобы потом никто не говорил “мы имели в виду другое правило”.

&nbsp;

&nbsp;

&nbsp;

11. Добавь ещё один обязательный артефакт:
  **cb20_rule_proven_active_only.csv**
  Это финальный список тех, у кого cb20 остаётся active **после** ремонта.
  Для каждой строки:

&nbsp;

&nbsp;

&nbsp;

- user_id
- entitlement_id
- access_rule_id
- rule_source_product_id
- rule_source_tariff_id
- historical_order_id
- supporting_business_subscription_id
- why_allowed_now

&nbsp;

&nbsp;

&nbsp;

12. В STOP-guards добавь:

&nbsp;

&nbsp;

&nbsp;

- если подрядчик реализует особую ветку if product_id == cb20 внутри resolver или executor — спринт провален;
- если поведение cb20 нельзя полностью изменить из admin UI через access_rules, без правки кода — спринт провален.

&nbsp;

&nbsp;

&nbsp;

13. В DoD добавь новый пункт:
  **«Для изменения логики доступа к cb20 достаточно изменить правила на странице продукта; код после спринта не требует дополнительных продукт-специфичных правок.»**
14. Исправь арифметику в артефактах:
  у тебя написано **“11 штук”**, но перечислено **12**. Нужно привести в соответствие.
15. Финальную цель спринта уточни одной строкой:
  **«Не код определяет, кому доступен cb20; это определяется только текущими активными правилами продукта в access_rules, редактируемыми из админки.»**

&nbsp;

&nbsp;

Главная правка: не заменяйте старый хаос новым хардкодом под cb20. Нужно не “запретить cb20 в коде”, а **сделать так, чтобы код вообще не принимал продукт-специфичных решений и исполнял только правила из админки**.

&nbsp;

План: ACCESS-RULES-SOT-UNIFICATION — финальная версия с жёстким default-deny для cb20

---

### Финальная цель спринта (одна строка)

**После спринта в системе существует только один путь принятия решений по доступам: access_rules → access-resolver → executor. Все остальные пути удалены или отключены.**

---

### Принцип SoT

Единственный источник истины по выдаче доступов и видимости контента — правила на странице продукта (`access_rules`) + ID-связи (`product_id`, `tariff_id`, `offer_id`, `order_id`, `training_module_id`).

Запрещено:

- hardcode по `product_code`, `slug`, `name`, `description`
- отдельные скрытые правила в edge functions
- repair-функции со своей бизнес-логикой
- любые fallback-ветки, которых нет в правилах продукта
- легализация active access словами "историческая покупка", "legacy", "когда-то покупал"

### Принцип default-deny для cb20

**Для cb20 старые direct entitlements не доверяются вообще.** Они не "легальны, пока срок не истёк", а подлежат полной ревизии и выключению/пересозданию по правилам.

- У всех active доступ к cb20 считается запрещённым по умолчанию
- Доступ может появиться только если это прямо следует из действующего `access_rule_id`
- legacy/import/export/getcourse/history сами по себе никогда не являются основанием для active access
- Факт старой покупки сам по себе ничего не разрешает
- Дата импорта/экспорта не порождает current active access

**Для cb20 в системе не существует самостоятельного прямого active доступа. Active доступ к cb20 возможен только как результат действующего правила продукта.**

### Принцип по Telegram-клубам

Два клуба: Gorbova Club (чат + канал), Бухгалтерия как бизнес (чат). Выдача доступа в клуб должна работать по той же цепочке: покупка → оплата → access_rules → resolver → telegram-grant-access. Никаких обходных путей.

### Запрещённый bucket

Bucket `valid_direct_purchase_active` — **запрещён навсегда**. Если подрядчик создаёт или использует этот bucket, спринт провален.

---

### Текущие данные из БД

**Ключевая архитектурная находка:**

Для cb20 (`product_id: 7101ed3c`) **НЕТ ни одного access_rule на уровне самого продукта cb20 типа `product_access` или `club`.** Есть только:

- 3 правила `training_content` (partial) для тарифов cb20 — определяют видимость модулей/уроков внутри cb20
- 1 правило `product_access` (`1b497fba`) на Gorbova Club BUSINESS — выдаёт cb20 как бонус при prior_purchase

**Единственное** правило, которое может легально создать active cb20 entitlement:

- Rule `1b497fba`: product = Gorbova Club, tariff = BUSINESS, grant_target_type = product_access, condition = prior_purchase (per_product), target включает `7101ed3c` (cb20)

**121 active cb20 entitlements:**

- 120 имеют `order_id` (привязаны к заказу)
- 1 без `order_id`
- Большинство в meta содержат `source_rule_id: 1b497fba` (repair от BUSINESS rule)
- Некоторые — `historical_backfill` (legacy)

**Telegram-клубы и правила:**

- Gorbova Club (`fa547c41`) — чат + канал. Правило `1a271ea0`: product = Gorbova Club, tariff = null (любой), grant_target_type = club. **Работает.**
- Бухгалтерия как бизнес (`4f8f9d8f`) — только чат. Правило `b58922ab`: product = Бухгалтерия как бизнес, tariff = null (любой), grant_target_type = club. **Работает.**

Обе club rules уже в `access_rules`, legacy fallback к `product_club_mappings` удалён в предыдущем патче.

---

### Допустимые bucket'ы для cb20


| Bucket                              | Определение                                                                |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `valid_rule_based_active`           | active cb20 с доказанным `access_rule_id`, все условия правила выполнены   |
| `invalid_no_rule_found`             | active cb20, для которого не найдено ни одного действующего access_rule    |
| `invalid_legacy_direct_expiry`      | active cb20, возникший из прямой покупки/legacy без подтверждения правилом |
| `invalid_import_export_legacy`      | active cb20 из backfill/import/GetCourse                                   |
| `invalid_wrong_tariff`              | active cb20 при клубе не BUSINESS                                          |
| `invalid_no_active_business`        | active cb20 без active BUSINESS подписки                                   |
| `invalid_expiry_longer_than_rule`   | active cb20 expires > чем позволяет правило                                |
| `historical_expired`                | expired entitlement (не active)                                            |
| `paid_cb20_without_any_entitlement` | paid order без entitlement                                                 |


---

### Блок 0: ACCESS-RULES-SOT GAP AUDIT (read-only)

Полная матрица всех decision paths.

**Артефакт:** `runtime_access_paths_matrix.csv`

---

### Блок 1: CB20 — пересборка всех active по правилам продукта

**Все 121 active cb20 подлежат пересборке по правилам продукта. Пока не доказано rule-based основание, bucket = `invalid_until_rule_proven`.**

Для каждого active cb20 entitlement вывести:

- `entitlement_id`, `user_id`, `access_rule_id`, `rule_source_product_id`, `rule_source_tariff_id`, `why_active_now`, `resolver_path`
- Если `access_rule_id` отсутствует — доступ автоматически `invalid`

**Артефакты:**

- `cb20_business_rule_audit.csv` — все 121 с bucket
- `cb20_invalid_active_access.csv` — полный repair-list
- `cb20_business_crosscheck_matrix.csv`
- `**cb20_active_full_proof.csv**` — колонки: `user_id`, `entitlement_id`, `current_expires_at`, `access_rule_id`, `rule_type`, `historical_order_id`, `active_business_subscription_id`, `active_business_tariff_id`, `is_rule_proven`, `final_verdict`

---

### Блок 1.1: DEFAULT CLOSED FOR CB20

Proof:

- Без срабатывания правила продукта active cb20 нет ни у кого
- historical/import/export/getcourse legacy не считается основанием
- Дата экспорта/импорта не порождает current active access
- Старые "размазанные" сроки выключены, если не подтверждены правилами

---

### Блок 1.2: CLUB GRANT CHAIN VERIFICATION

Проверить, что полная цепочка выдачи клуба работает по правилам:

- Gorbova Club: покупка → оплата → access_rules (rule `1a271ea0`) → resolver → telegram-grant-access → чат + канал
- Бухгалтерия как бизнес: покупка → оплата → access_rules (rule `b58922ab`) → resolver → telegram-grant-access → чат

Для каждого клуба:

- Правило существует и active
- `grant-access-for-order` использует это правило через resolver
- Telegram-grant-access вызывается с правильным `club_id`
- Нет обходных путей

---

### Блок 2: MODULE ACCESS VISIBILITY CHAIN (14/14)

Без изменений. **Артефакт:** `module_access_visibility_chain_14_14.csv`

### Блок 3: CLEANUP TAIL AUDIT

Без изменений. **Артефакт:** `grant_access_tail_cleanup_audit.csv`

### Блок 4: GLOBAL INTEGRITY AUDIT

Без изменений. **Артефакт:** `order_based_only_global_integrity_audit.csv`

### Блок 5: cee45419 FINAL PROOF

Без изменений. **Артефакт:** `grant_access_primary_entitlement_proof_cee45419.csv`

---

### EXECUTE 1: access-resolver.ts — добавить жёсткое правило для cb20

В resolver зафиксировать:

- Resolver не может выдавать cb20 из historical order напрямую
- Resolver может выдать cb20 **только** если найдено действующее правило в `access_rules`
- Если правило требует `prior_purchase` + BUSINESS, должны быть выполнены оба условия
- Без rule match → deny

Для `primary_grant`: если `product_id = cb20`, primary grant допустим **только** если подтверждён resolver'ом как rule-allowed. Прямой primary grant по факту покупки cb20 **запрещён** без подтверждения access_rule.

### EXECUTE 2: grant-access-for-order — cb20 primary grant запрет

Для cb20 primary direct grant запрещён, если он не подтверждён resolver'ом. Функция не должна:

- Сама вычислять secondary grants (получает готовыми из resolver)
- Решать "что выдать" на основании кода продукта, исторической покупки, клуба, текста
- Выдавать cb20 как "первичный fulfillment" без access_rule

Функция должна:

1. Загрузить сущности по ID
2. Вызвать resolver
3. Исполнить результат
4. Записать proof с `access_rule_id`

### EXECUTE 3: repair-cb20-entitlements — mechanical executor

Функция должна быть переведена в mechanical executor repair-list **в этом спринте**. Она не "чинит bucket'ы", а:

1. Собирает полный invalid list
2. Выключает все invalid active cb20
3. Пересоздаёт только те, что подтверждены каноническим правилом
4. Repair идёт от правила, а не от истории покупки

Собственной логики buckets/action остаться не должно.

### EXECUTE 4: Удалить hardcoded fallback sets

В `entitlement-sync.ts`: удалить L18-33 fallback sets. После удаления — **hard fail**, если `products_v2.entitlement_mode` не заполнен. Мягкое поведение запрещено.

### EXECUTE 5: Запрет решений по product_code в write-side

Запретить любые решения по `product_code` в write-side для grant/update/upsert, кроме случаев, где это чисто технический дублирующий атрибут. Lookup/decision — только по `product_id`. `product_code` — только для snapshot/meta.

### EXECUTE 6: Удалить legacy fallbacks

- Убрать runtime fallback к `product_club_mappings` (уже сделано)
- Убрать hardcoded code sets (уже сделано)
- Убрать text matching по description/title
- Убрать secondary/grant lookup по `product_code`
- Убрать hidden branches

### EXECUTE 7: Runtime = access_rules

Runtime должен исполнять только канонические access_rules. UI "Доступы" является редактором правил и proof-представлением, но не отдельным вторым источником логики. После спринта недопустимо:

- В UI правило выключено, а runtime выдаёт доступ
- В UI правила нет, а runtime показывает контент
- В UI одно, а repair/grant делают другое

### EXECUTE 8: Repair active cb20 по итогам dry-run

Отдельный execute-блок:

1. Построить repair-list из блока 1
2. Dry-run: показать что именно будет выключено/укорочено/пересоздано
3. Execute только по этому списку
4. Proof after

**Артефакт:** `cb20_mass_disable_repair_list.csv` — полный список всех active cb20 для отключения, если нет доказанного rule-based основания.

Колонки: `user_id`, `entitlement_id`, `current_state`, `violated_rule`, `planned_action`, `expected_final_state`

### EXECUTE 8.1: Synthetic rules audit

Synthetic rules в `useTrainingContentRules.ts` допустимы только если являются детерминированной проекцией канонического grant result, записанного resolver'ом. Если содержат самостоятельное решение — удалить.

---

### Файлы для изменения

1. `supabase/functions/_shared/access-resolver.ts` — cb20 deny rule + resolver improvements
2. `supabase/functions/grant-access-for-order/index.ts` — executor mode, cb20 primary grant block
3. `supabase/functions/repair-cb20-entitlements/index.ts` — mechanical executor
4. `supabase/functions/_shared/entitlement-sync.ts` — hard fail on missing entitlement_mode

### Что НЕ изменяется

- `cb_module_ip` не трогать
- revoke не делать без отдельного repair-list
- training tree не менять
- bepaid-webhook напрямую не принимает бизнес-решений; если для полного удаления параллельных path потребуется минимальная правка его вызова/контракта с resolver, это допустимо

---

### Обязательные артефакты (11 штук)

1. `runtime_access_paths_matrix.csv`
2. `cb20_business_rule_audit.csv`
3. `cb20_invalid_active_access.csv`
4. `cb20_business_crosscheck_matrix.csv`
5. `cb20_active_full_proof.csv`
6. `cb20_mass_disable_repair_list.csv`
7. `module_access_visibility_chain_14_14.csv`
8. `grant_access_tail_cleanup_audit.csv`
9. `order_based_only_global_integrity_audit.csv`
10. `grant_access_primary_entitlement_proof_cee45419.csv`
11. `access_decision_paths_removed.csv`
12. `access_rules_sot_mapping.csv`

### Финальный proof

5-10 контрольных кейсов: product rule in UI → exact IDs → order/subscription → entitlement → visibility → proof из правила продукта.

---

### STOP-guards

1. Если после спринта остаётся хоть один decision path вне access_rules — спринт провален
2. Если подрядчик пытается легализовать active cb20 по historical order / direct expiry / import date — спринт провален
3. Если появляется bucket `valid_direct_purchase_active` — спринт провален
4. Если grant path принимает решение не по ID и не по resolver — STOP
5. Если legacy функция способна записать entitlement/subscription без ссылки на `access_rule_id` или resolver result — спринт провален
6. Нельзя выпускать execute если остаётся параллельный decision path

### DoD

1. Единый `access-resolver.ts` используется всеми grant/repair paths
2. `grant-access-for-order` не решает сам — только исполняет resolver
3. `repair-cb20-entitlements` не содержит собственной бизнес-модели
4. 0 hardcoded code sets
5. 0 legacy fallback
6. Secondary grants lookup по `product_id`, не `product_code`
7. **После execute не осталось ни одного active cb20 без явного `access_rule_id`, подтверждающего текущее право доступа**
8. **После execute количество active cb20 совпадает только с rule-proven cohort (может быть сильно меньше 121)**
9. Нет ни одного active cb20, возникшего только из legacy/import/export/history
10. Нет ни одного runtime access path вне access_rules
11. Все решения по доступам только по ID и правилам продукта
12. 14/14 visibility chain подтверждена
13. Tail cleanup: 0 мусора или repair-list
14. Club grant chain: оба клуба работают через access_rules → resolver → telegram-grant-access
15. После execute нет ни одной функции, способной выдать доступ без вызова resolver
16. Подрядчик показывает `access_decision_paths_removed.csv`
17. Подрядчик показывает 5-10 контрольных кейсов product→rule→grant→visibility
18. 12 артефактов в `/mnt/documents/`

---

**После спринта в системе существует только один путь принятия решений по доступам: access_rules → access-resolver → executor. Все остальные пути удалены или отключены.**