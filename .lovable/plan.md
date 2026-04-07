## да, согласен, с учетом правок:

&nbsp;

1. **Не хардкодить бизнес-правило в repair.**
  В каждом шаге явно указать: сначала proof из access_rules/UI-настроек, потом repair. Нельзя чинить даты модулей по предположению.
2. **Добавить отдельный discovery по grant-access-for-order.**
  Нужно доказать, почему сейчас для модулей создаются subscriptions_v2:
  &nbsp;
  - это только из-за entitlement_mode;
  - или ещё из-за write-path logic;
  - или оба фактора сразу.
    Нужен before-proof по коду + по 2–3 реальным order-кейсам.
  &nbsp;
3. **Уточнить критерий для repair модулей.**
  Выравнивать module.expires_at = business.access_end_at только если одновременно доказано:
  &nbsp;
  - модуль входит в rule-matrix BUSINESS;
  - у пользователя есть valid prior purchase именно на этот модуль;
  - модульный доступ сейчас активен/должен быть активен.
    Не делать массовый blind update по всем модульным entitlement.
  &nbsp;
4. **Шаг “Cleanup phantom subscriptions” сделать двухфазным.**
  Сначала dry-run с классификацией:
  &nbsp;
  - true_phantom_order_based_subscription
  - legacy_needs_manual_review
  - config_mismatch_subscription
    Только потом execute.
    Иначе можно снести исторические/пограничные записи без доказательства.
  &nbsp;
5. **Добавить обязательный артефакт по связи order → rule → entitlement.**
  Нужен файл:
  module_order_to_rule_lineage.csv
  Колонки минимум:
  &nbsp;
  - user_id
  - order_id
  - module_product_id
  - order_purchase_type
  - matched_rule_id
  - expected_source_window
  - current_expires_at
  - target_expires_at
  - repair_action
  &nbsp;
6. **Для cb_module_ip не делать UPDATE до proof.**
  Сейчас в плане уже почти как решённый факт, что entitlement_mode должен быть order_based_only.
  Нужно сначала показать:
  &nbsp;
  - текущее значение в БД,
  - где оно используется в runtime,
  - чем именно оно противоречит rule-config для BUSINESS/modules.
    Только потом правка.
  &nbsp;
7. **Metadata lineage не должна подменять историю заказа.**
  В шаге 3 явно дописать:
  &nbsp;
  - не удалять исходные признаки standalone purchase;
  - новые rule-based поля добавлять add-only;
  - исторический order-source сохранять отдельно.
    Иначе потеряется информация, что модуль был куплен отдельно.
  &nbsp;
8. **Финальный proof должен быть не только по датам, но и по UI.**
  Добавить DoD:
  &nbsp;
  - в карточке контакта по модулю нет ложного “автопродление / попытка списания”;
  - бейдж “через BUSINESS” показывается только там, где source доказан rule-based;
  - у order-based модулей UI больше не выглядит как subscription-based продукт.
  &nbsp;
9. **Добавить отдельный STOP-guard на массовость.**
  Если после discovery количество затрагиваемых модульных entitlement/subscription окажется выше текущей оценки (~56 / ~75), stop и пересборка dry-run-отчёта до execute.
10. **Нужен after-proof отдельным блоком.**
  После execute обязательно выгрузить:

&nbsp;

&nbsp;

&nbsp;

- module_expiry_source_after_repair.csv
- phantom_module_subscriptions_after_cleanup.csv
- summary: сколько было / сколько исправлено / сколько осталось exceptions

&nbsp;

&nbsp;

В остальном структура правильная: сначала rules proof, потом config mismatch, потом repair данных, потом UI-proof.

&nbsp;

План: Discovery и repair модулей ЦБ 1 — правила → данные → UI

---

### Базовое бизнес-правило (зафиксировано)

Модули ЦБ 1 — самостоятельные продаваемые продукты, но их срок должен заканчиваться вместе с BUSINESS там, где это задано в product/access rules. Конкретно:

- Модуль — самостоятельный продаваемый продукт
- Купить его может только тот, у кого уже есть ЦБ 1
- После покупки модуль живёт по тому же сроку, что и ЦБ 1 через Gorbova Club / BUSINESS
- Дата окончания модуля синхронизируется с активной BUSINESS-подпиской, а НЕ с cb20 entitlement
- Это определяется исключительно из product/access rules в админке, а не из ручной логики патча

---

### БЛОК 0: Обязательный discovery правил (read-only, до любого repair)

**STOP-guard: если discovery не доказывает правило из UI/БД, repair дат и metadata ЗАПРЕЩЁН.**

Перед любым repair подрядчик обязан доказать:

1. Какие `access_rules` настроены для:
  - cb20
  - каждого модуля cb20 (catering, construction, ip, marketplaces, production, pvt, retail)
  - Gorbova Club / BUSINESS
2. Есть ли в правилах явная связь:
  - BUSINESS → cb20
  - BUSINESS → cb20 modules
3. Одинаково ли настроены сроки (`duration_days`, `align_with_source`) для курса и модулей
4. Не расходятся ли UI-настройки правил с фактическим runtime-поведением
5. **Discovery-вопрос (обязательный):**
  - Модульный entitlement сейчас живёт от standalone order, от cb20 entitlement или от BUSINESS subscription?
  - Какой из этих источников должен быть каноническим по правилам в админке?
  - Ожидаемый ответ: BUSINESS subscription, если так настроено в правилах
  - Если runtime смотрит иначе — это root cause

**Артефакты discovery:**

- `cb20_and_modules_access_rules_snapshot.csv` — полный snapshot всех access_rules
- `business_to_cb20_modules_rule_matrix.csv` — матрица: rule_id → source → target → duration → is_active

---

### БЛОК 1: Разделение Eligibility vs Expiry alignment

**1a. Eligibility (право на модуль):**

- Пользователь имеет право на модуль, если у него есть оплаченный order на этот модуль И активная BUSINESS подписка (rule 1b497fba с condition_type=prior_purchase)
- Это два РАЗНЫХ условия, которые нельзя смешивать

**1b. Expiry alignment (срок модуля):**

- Если право есть, срок модуля = срок BUSINESS подписки (align_with_source, duration_days=NULL)
- Срок модуля НЕ берётся из cb20 entitlement — он берётся из BUSINESS subscription

**Сравнительный proof "курс vs модуль"** (обязательный артефакт):

Для всех пользователей с BUSINESS + cb20 + модули:


| Колонка                    | Описание                                              |
| -------------------------- | ----------------------------------------------------- |
| user_id                    | &nbsp;                                                |
| business_access_end_at     | MAX(access_end_at) WHERE status IN (active, past_due) |
| cb20_expires_at            | entitlement.expires_at для cb20                       |
| module_expires_at          | entitlement.expires_at для каждого модуля             |
| rule_source_for_cb20       | какое правило выдало cb20                             |
| rule_source_for_module     | какое правило выдало модуль                           |
| configured_expected_source | что настроено в access_rules как канонический source  |


Цель: доказать, что курс и модули реально должны заканчиваться в одну дату — по BUSINESS.

**Артефакт:** `module_expiry_source_proof.csv`

---

### БЛОК 2: Configuration mismatch

Если discovery покажет расхождения, подрядчик обязан:

1. Явно показать, какой rule/config неверен
2. Предложить минимальную правку в конфигурации/правиле
3. Только потом строить repair данных

**Известные mismatch (из предыдущего discovery):**


| Дефект                                                            | Детали                                     | Действие           |
| ----------------------------------------------------------------- | ------------------------------------------ | ------------------ |
| cb_module_ip.entitlement_mode = subscription_based                | Должен быть order_based_only как остальные | UPDATE products_v2 |
| grant-access-for-order создаёт subscriptions для order_based_only | Bug в edge function                        | Патч в EF          |


**Фантомные module subscriptions — отдельный дефект:**

Подрядчик обязан доказать:

- Почему для модулей вообще создаются subscriptions_v2?
- Это ошибка entitlement_mode/product config?
- Или ошибка write-path?
- Или исторический legacy-effect?

После discovery:

- Если модуль по настройкам order_based_only → активные subscriptions для него = дефект
- Если модуль по настройкам subscription_based → объяснить, почему это не противоречит бизнес-модели

**Артефакт:** `module_rule_config_mismatch_report.csv`

---

### БЛОК 3: Repair (только после доказанных правил)

**Этап 1: Fix configuration**

- cb_module_ip.entitlement_mode → order_based_only
- Патч grant-access-for-order: пропускать создание subscription для order_based_only products

**Этап 2: Repair expiry alignment**

- Сначала доказать канонический source срока по admin rules
- Потом выровнять expires_at только для тех модулей, где канонический source = BUSINESS
- SET module.expires_at = business.access_end_at (MAX из active/past_due subscriptions)

**Этап 3: Metadata lineage**

- Привести metadata к правилу БЕЗ подмены истории
- source_rule_id, source_window_rule: align_with_source, business_subscription_id
- Бейдж "через BUSINESS" появляется ТОЛЬКО при доказанной rule-based связи, а не как cosmetic patch

**Этап 4: Cleanup phantom subscriptions**

- Для order_based_only модулей: архивировать активные subscriptions (status → archived)
- Удалить billing metadata (recurring_amount, recurring_snapshot)

---

### DoD (в терминах правил)

1. Для каждого модуля cb20 доказан канонический source срока
2. Если канонический source = BUSINESS, то module.expires_at = business.access_end_at
3. Для тех же пользователей cb20.expires_at = business.access_end_at
4. В UI нет ложных billing/subscription сигналов для order-based модулей
5. Курс и модули у одного пользователя заканчиваются одновременно (где задано в правилах)
6. Подрядчик показал, что это следует из настроек продукта/доступа, а не из ручного хардкода
7. cb_module_ip.entitlement_mode = order_based_only
8. 0 active subscriptions для order_based_only modules

---

### Артефакты


| #   | Файл                                       | Содержание                                                                                           |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1   | cb20_and_modules_access_rules_snapshot.csv | Полный snapshot access_rules для cb20, модулей, BUSINESS                                             |
| 2   | business_to_cb20_modules_rule_matrix.csv   | Матрица: rule_id → source → target → duration → is_active                                            |
| 3   | module_expiry_source_proof.csv             | По каждому user: business_end, cb20_expires, module_expires, rule_source, configured_expected_source |
| 4   | module_rule_config_mismatch_report.csv     | Расхождения: entitlement_mode, phantom subs, disabled rules                                          |


---

### Масштаб

- **Config fix:** 1 UPDATE products_v2 + 1 патч grant-access-for-order
- **Data repair:** ~56 module entitlements (expiry alignment) + ~75 phantom subscriptions (archive)
- **Scope:** только модули cb20; другие продукты не затрагиваются

### Порядок исполнения

1. Discovery правил (БЛОК 0) — read-only proof
2. Сравнительный proof курс vs модуль (БЛОК 1) — read-only
3. Configuration mismatch report (БЛОК 2)
4. Fix configuration (БЛОК 3, этап 1)
5. Repair expiry alignment (БЛОК 3, этап 2)
6. Metadata lineage (БЛОК 3, этап 3)
7. Cleanup phantom subscriptions (БЛОК 3, этап 4)
8. Финальный proof: все даты выровнены, 0 phantom subs

### Файлы для изменения

- `supabase/functions/grant-access-for-order/index.ts` — пропуск subscription для order_based_only
- `.lovable/plan.md` — добавить новый раздел
- `/mnt/documents/` — 4 новых артефакта