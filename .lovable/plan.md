## да, согласен, с учетом правок:

&nbsp;

1. По Ярошевич не делать преждевременный вывод, что кейс уже закрыт только потому, что union_scope в одном месте резолвится как full. Нужно отдельно доказать **runtime visibility фактом**, а не только чтением кода:
  &nbsp;
  - какие именно root/child модули ЦБ 1 ей реально видны;
  - нет ли фильтрации на другом слое;
  - совпадает ли фактическая видимость с полным курсом.
  &nbsp;
2. В блок Ярошевич добавить обязательную таблицу **deal → access object**:
  &nbsp;
  - каждая paid-сделка по ЦБ 1;
  - тип покупки;
  - какой объект доступа она должна порождать;
  - какой объект доступа создан сейчас;
  - есть ли расхождение.
  &nbsp;
  Иначе останется неясно, зачем в карточке одновременно висит модульная история и полный продукт.
3. По Ярошевич meta **не удалять и не упрощать вслепую**.
  Вместо формулировки “убрать historical_module_product_ids” зафиксируй безопаснее:
  &nbsp;
  - сначала dry-run discovery: кто и где читает эти поля;
  - только потом нормализация;
  - если поле нужно для истории/аудита, оставить его, но добавить явный приоритет полной покупки.
  &nbsp;
  То есть задача не “стереть модульную историю”, а “убрать риск неверной интерпретации и зафиксировать приоритет полного курса”.
4. По Ярошевич добавь отдельный пункт **PRIORITY RULE FIX / META NORMALIZATION**:
  &nbsp;
  - если есть base_tariff_purchase по полному ЦБ 1, это должно быть явно отражено как primary source;
  - модульная покупка может оставаться secondary/history;
  - итоговая meta не должна создавать впечатление, что доступ модульный, если runtime и бизнес-правило дают полный курс.
  &nbsp;
5. По Ярошевич добавь STOP-guard:
  &nbsp;
  - нельзя менять scope_resolution_mode, historical_purchase_type и связанные meta-поля без before/after proof, что это не ломает видимость в кабинете и не меняет другие ветки логики;
  - нельзя “нормализовать” только текст меты, если фактический runtime остаётся не до конца доказан.
  &nbsp;
6. По Абрамович добавь обязательный пункт **why access existed despite broken subscription**:
  &nbsp;
  - за счёт чего именно она не выпала из клуба;
  - entitlement / telegram_access / manual_access / другой механизм;
  - после ремонта цепочка должна быть канонической, а не “доступ есть случайно”.
  &nbsp;
7. По Абрамович в DoD добавь:
  &nbsp;
  - в карточке контакта, в доступах, в платежах и в клубной фактической доступности после ремонта показывается одна и та же реальность;
  - нет расхождения “subscription expired, entitlement active, в клубе осталась”.
  &nbsp;
8. В глобальный аудит модульных покупок cb20 добавь отдельный итоговый флаг:
  &nbsp;
  - full_purchase_has_priority = true/false
  - runtime_matches_max_purchased_scope = true/false
  &nbsp;
  Это позволит сразу увидеть, у кого полная покупка есть, но система всё ещё мыслит модулем.
9. В артефакты добавь ещё один файл:
  &nbsp;
  - yaroshevich_deal_to_access_mapping.csv
  &nbsp;
  Там должно быть по каждой её сделке:
  &nbsp;
  - order_id / order_number
  - тип покупки
  - product/tariff/module
  - expected access object
  - current access object
  - verdict
  &nbsp;
  Это закроет основной вопрос пользователя: какие сделки относятся к полному продукту, а какие к модулям.
10. В объёме изменений уточни по Ярошевич:

&nbsp;

&nbsp;

&nbsp;

- если runtime уже корректный, допустим только **metadata normalization** без изменения срока, source_rule_id, order_id и без перевыдачи entitlement;
- если runtime не корректный, тогда это уже не cosmetic/meta fix, а полноценный repair source/scope selection.

&nbsp;

&nbsp;

&nbsp;

11. В финальном expected outcome по Ярошевич сформулируй жёстко:

&nbsp;

&nbsp;

&nbsp;

- при наличии полной покупки ЦБ 1 система обязана показывать и резолвить доступ как минимум на уровне полного курса;
- модульная сделка не может снижать объём доступа ни в кабинете, ни в карточке, ни в rule/meta.

&nbsp;

&nbsp;

&nbsp;

12. Для Абрамович добавь STOP-guard на дубль:

&nbsp;

&nbsp;

&nbsp;

- перед expired → active проверить, что нет второй скрытой активной подписки того же тарифа/периода;
- не создавать новых сущностей, если цепочка уже существует и требует только восстановления статуса.

&nbsp;

&nbsp;

План: Ремонт кейсов Ярошевич и Абрамович (финальная версия)

---

### Блок 1: YAROSHEVICH — SOURCE ORDER SELECTION PROOF + RUNTIME VERIFICATION

**Установленные факты (из БД):**

Татьяна Ярошевич (`user_id: 5432fd69`, `profile_id: fc91c05e`) имеет **две** paid-сделки по ЦБ 1 (product `7101ed3c`):


| order_number | hist_type                | display_name                        | tariff                 | price      |
| ------------ | ------------------------ | ----------------------------------- | ---------------------- | ---------- |
| GC-3811003   | `base_tariff_purchase`   | ЦБ 2.0 — Бухгалтер                  | `adbe94e8` (Бухгалтер) | 16 624 BYN |
| GC-3818463   | `module_only_standalone` | ЦБ 2.0: Грузо- и пассажироперевозки | NULL                   | 550 BYN    |


**Текущий cb20 entitlement** (`09641160`):

- `order_id: 327b7f05` → это ордер **GC-3811003 (полный курс)**
- `source_rule_id: 1b497fba` (BUSINESS bonus rule)
- `scope_resolution_mode: union_scope`
- `historical_purchase_type: base_tariff_plus_standalone`
- `historical_tariff_id: adbe94e8` (Бухгалтер)
- `historical_module_product_ids: ["64d9f812"]`

**SOURCE ORDER SELECTION PROOF:**

- Entitlement `order_id` указывает на `327b7f05` = GC-3811003 = **полная покупка курса**. Это корректный приоритетный source.
- Модульная покупка (GC-3818463) **не** выбрана как source. Source selection — корректный.

**RUNTIME SCOPE PROOF:**

- `scope_resolution_mode: union_scope` в коде (`useTrainingContentRules.ts`, строка 330-331) резолвится как `accessMode = "full"` — **полный доступ ко всем модулям**.
- То есть runtime-доступ уже НЕ занижен. Полная покупка доминирует.

**Проблема (cosmetic/meta):**
Meta содержит `historical_module_product_ids: ["64d9f812"]` и `historical_purchase_type: base_tariff_plus_standalone`. Хотя runtime корректно отдаёт full access, meta вводит в заблуждение: создаёт впечатление, что модульная покупка влияет на scope. Фактически `union_scope` = full access, но название и содержание meta не очевидны.

**Действия:**

1. Подтвердить runtime visibility: запросить дерево модулей ЦБ 1 и проверить, все ли видны Ярошевич (read-only SQL через training_modules + access resolver).
2. Нормализовать meta в entitlement `09641160`:
  - `scope_resolution_mode: full_tariff_scope` (вместо `union_scope`, т.к. есть полная покупка)
  - Убрать `historical_module_product_ids` (не релевантно при полном доступе) или оставить как историческую справку с пометкой
  - `historical_purchase_type: base_tariff_purchase` (приоритет по полной покупке, а не union)
3. Сгенерировать `yaroshevich_cb20_purchase_precedence_trace.csv` со всеми полями.
4. Сгенерировать `yaroshevich_runtime_visibility_trace.csv`: root/child модули, по какому entitlement/rule/scope открыты, расхождение с purchase history.

**Жёсткое правило:** Если есть валидная paid-покупка полного курса ЦБ 1, итоговый доступ не может быть ниже полного курса. Модульная покупка дополняет историю, но не понижает already purchased full access.

**Expected outcome:**

- Runtime уже даёт полный доступ (доказано: `union_scope` → `full`). Кейс закрывается как **корректный по доступу** с **нормализацией meta**.
- Если при проверке visibility обнаружится, что какие-то модули не видны — это баг source/scope selection, требующий починки.

---

### Блок 2: ABRAMOVICH — SUBSCRIPTION STATUS RESTORATION + CANONICAL CHAIN PROOF

**Установленные факты (из БД):**

Алена Абрамович (`user_id: d88295b7`, `profile_id: 4bf96245`):


| Сущность     | ID       | Статус      | Срок           | Тариф             |
| ------------ | -------- | ----------- | -------------- | ----------------- |
| Subscription | d2710b58 | **expired** | **2026-04-20** | CHAT (`31f75673`) |
| Subscription | 4d5de46e | expired     | 2026-03-20     | CHAT              |
| Entitlement  | 1c375d53 | **active**  | 2026-04-20     | club (`11c9f1b8`) |


**Проблема:** Подписка `d2710b58` имеет `status=expired`, но `access_end_at=2026-04-20` — в будущем. Entitlement active до той же даты. Каноническая цепочка разорвана: entitlement active, subscription expired.

**Действия:**

1. Восстановить `d2710b58.status` → `active` (тот же дефект преждевременной экспирации, что у Крац/Босак/Самец/Семенюк).
2. Проверить полную каноническую цепочку: payment → order → subscription → entitlement → UI.
3. Отдельно зафиксировать: почему пользователь фактически оставался в клубе при сломанной подписке (entitlement active был достаточен для доступа, но это маскировало дефект подписки).
4. Audit log с `batch_id: REPAIR-CLUB-STATUS-2026-04-06`.
5. Сгенерировать `abramovich_payment_to_access_trace.csv` с полной цепочкой.

**STOP-guard:** Нельзя закрывать кейс только потому, что entitlement active или пользователь фактически в клубе. Каноническая subscription-запись должна быть восстановлена.

---

### Блок 3: Глобальный аудит модульных покупок cb20

Read-only. Все orders по product `7101ed3c` с `module_only_standalone` в purchase_snapshot. Классификация каждого пользователя:


| Категория                       | Описание                                          |
| ------------------------------- | ------------------------------------------------- |
| `module_only_standalone`        | Только модульная покупка, нет полного курса       |
| `full_purchase_only`            | Только полная покупка, нет модулей                |
| `full_purchase_plus_standalone` | Полная покупка + модуль(и)                        |
| `conflict_wrong_source`         | Неправильный source selection                     |
| `runtime_downgraded`            | Runtime даёт доступ ниже максимального купленного |


**Артефакт:** `cb20_module_purchases_global_audit.csv`

---

### Артефакты

1. `yaroshevich_cb20_purchase_precedence_trace.csv` — все paid orders, тип, tariff, какой source сейчас, какой должен быть
2. `yaroshevich_runtime_visibility_trace.csv` — root/child модули, видимость, расхождения
3. `yaroshevich_module_reconciliation.csv` — итоговая классификация каждой сделки
4. `abramovich_payment_to_access_trace.csv` — полная цепочка payment → UI
5. `cb20_module_purchases_global_audit.csv` — глобальный аудит

### Объём изменений

- 1 UPDATE subscriptions_v2 (Абрамович: `expired` → `active`)
- 1 UPDATE entitlements meta (Ярошевич: нормализация `scope_resolution_mode`, `historical_purchase_type`)
- Read-only аудит модульных покупок
- Audit logs для каждого изменения
- Никаких изменений в коде

### DoD

1. По Ярошевич доказано наличие полной покупки ЦБ 1 (GC-3811003, тариф Бухгалтер) — **установлено**
2. По Ярошевич доказано, что source order приоритетный = GC-3811003 (полный курс) — **установлено**
3. По Ярошевич доказано, что runtime-доступ = full (union_scope → full) — **установлено**
4. По Ярошевич meta нормализована: scope и purchase_type отражают реальный полный доступ
5. По Ярошевич нет «непонятных модульных покупок» — каждая сделка классифицирована
6. По Абрамович subscription восстановлена в active, каноническая цепочка payment → order → subscription → entitlement → UI согласована
7. Глобальный аудит: ни один пользователь с полной покупкой не имеет runtime downgrade до модуля

### STOP-guards

- Нельзя оставлять verdict «модульная покупка» без проверки всех paid-сделок по полному ЦБ 1
- Нельзя чинить meta/entitlement, пока не доказано, какая сделка — приоритетный source
- Нельзя занижать доступ до модуля при наличии валидной полной покупки курса
- Нельзя закрывать Абрамович без восстановления канонической subscription-записи
- Нельзя маскировать gap ручным присутствием в клубе без нормальной записи в системе