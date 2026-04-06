## да, согласен, с учетом правок:

&nbsp;

1. **Зафиксировать scope PATCH-REAL-FULFILLMENT-GAPS как immutable по 4 order_id и 1 user_id.**
  В тексте патча явно указать:
  &nbsp;
  - user_id = 8482889a-51f9-4f4b-ac23-6f4b59db51b1
  - profile_id = 3dcf1b28-67a8-4ec2-b7cd-dfff87ebb59f
  - только 8fa2d97d, ab2f4972, 4d00d924, 01b81165
  - любые другие gap-кейсы вне этого execute не трогать
  &nbsp;
2. **Для PATCH-REAL-FULFILLMENT-GAPS добавить жёсткий SoT по полям entitlement.**
  Перед execute явно определить, какие поля заполняем из какого источника:
  &nbsp;
  - user_id → из orders_v2.user_id
  - product_id → из orders_v2.product_id
  - product_code → из products_v2.code
  - order_id → из конкретного заказа
  - profile_id → если колонка реально есть в entitlements, брать из order/profile linkage; если нет — не выдумывать поле
  - expires_at → только по доказуемому правилу; не “из order/subscription на глаз”, а из действующей модели для standalone module purchase
  - meta.source = 'fulfillment_gap_backfill'
  - meta.patch = 'PATCH-REAL-FULFILLMENT-GAPS'
  - meta.order_id = ...
  &nbsp;
3. **Перед execute добавить отдельный guard на business model модулей.**
  Для всех 4 модулей подтвердить:
  &nbsp;
  - это standalone module products
  - доступ к ним должен выдаваться именно entitlement-ом
  - они не должны ждать active parent cb20
    И только после этого делать backfill. Это важно, чтобы не подменить багом нормальную модель.
  &nbsp;
4. **В PATCH-DEALS-SEARCH-BROWSER-PROOF добавить обязательную проверку поиска именно по product name, module name и tariff name отдельно.**
  Не только общие слова, но 3 класса запросов:
  &nbsp;
  - по полному продукту: ценный бухгалтер
  - по модулю: маркетплейсы, общепит, производство, учет у ип
  - по тарифу: премиум, business, чат
    И отдельно фиксировать, что поиск находит по:
  - products_[v2.name](http://v2.name)
  - products_v2.code
  - [tariffs.name](http://tariffs.name)
  &nbsp;
5. **В PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF расширить audit до полного списка полей products / tariffs / offers / payment buttons.**
  Не ограничиваться auto_renew и tokenization. Добавить требование сделать полный inventory:
  &nbsp;
  - все boolean / enum / date / retry / recurring / grace / tokenization поля
  - где редактируются
  - где реально читаются
  - где вообще не читаются
  - какие дублируют друг друга
    Нужен итоговый вывод: какие поля — реальные runtime-поля, а какие “для красоты”.
  &nbsp;
6. **В PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION-PROOF усилить правило: code допустим только как secondary identifier, не как источник бизнес-решения.**
  Отдельно прописать buckets:
  &nbsp;
  - allowed_secondary_identifier — display/search/import support only
  - forbidden_business_identifier — если по нему выдается доступ / создается подписка / определяется продукт
  - legacy_transitional_usage — временно допустимо, но подлежит замене
    И отдельно вынести high-risk места, где сейчас решение принимается по description, includes, product_code set, static map.
  &nbsp;
7. **Добавить отдельный discovery-подпункт: PATCH-PRODUCT-ID-VISIBILITY-AUDIT.**
  Нужно проверить, что в UI и runtime везде, где выбирается/сравнивается продукт:
  &nbsp;
  - после текстового поиска используется именно product_id
  - не происходит fallback на похожее название
  - cb20 и prd_0d01a2fdc477 нигде не попадают в одну ветку логики из-за name/code similarity
  &nbsp;
8. **В блоке “Что НЕ делать” добавить ещё один запрет.**
  Запретить любые execute-правки по:
  &nbsp;
  - field binding
  - auto_renew
  - ID-first normalization
    пока не готов финальный field_binding_runtime_matrix.csv и product_identity_runtime_matrix.csv
  &nbsp;
9. **В общий порядок выполнения добавить обязательный выходной артефакт после каждого discovery-блока.**
  Не просто “прочитать код”, а завершать каждый блок конкретным CSV/таблицей и коротким verdict:
  &nbsp;
  - PATCH-DEALS-SEARCH-BROWSER-PROOF → deals_search_proof.csv
  - PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF → field_binding_runtime_matrix.csv
  - PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION-PROOF → product_identity_runtime_matrix.csv, id_vs_name_conflict_cases.csv
  &nbsp;
10. **Главную нить явно сохранить в самом плане.**
  В начало добавить формулировку:

&nbsp;

&nbsp;

> Цель текущего спринта — не косметика, а окончательная увязка цепочки покупка → выдача → подписка/entitlement → видимость → UI → runtime SoT, без допущений по названиям и без решений по похожести строк.

&nbsp;

Если хочешь, следующим сообщением я соберу тебе уже финальную чистовую версию этого плана целиком, одним копируемым блоком.

&nbsp;

План: PATCH-REAL-FULFILLMENT-GAPS + FIELD-BINDING-PROOF + ID-FIRST-PROOF + DEALS-SEARCH-PROOF

---

### Блок 1: PATCH-REAL-FULFILLMENT-GAPS (execute)

**Подтверждённые данные из БД:**


| order_id | order_number  | product_code           | user_id  | entitlement |
| -------- | ------------- | ---------------------- | -------- | ----------- |
| 8fa2d97d | GC-3830657-M1 | cb_module_retail       | 8482889a | NULL        |
| ab2f4972 | GC-3830657-M2 | cb_module_catering     | 8482889a | NULL        |
| 4d00d924 | GC-3830657-M3 | cb_module_production   | 8482889a | NULL        |
| 01b81165 | GC-3830657-M5 | cb_module_marketplaces | 8482889a | NULL        |


Пользователь: `a.bruylo@ajoure.by`, user_id: `8482889a-51f9-4f4b-ac23-6f4b59db51b1`, profile_id: `3dcf1b28-67a8-4ec2-b7cd-dfff87ebb59f`.

**Шаги:**

1. **Before-snapshot** — SQL-запрос: все entitlements, subscriptions, orders для user_id `8482889a`
2. **Duplicate guard** — подтверждено: 0 активных entitlements для 4 product_code
3. **SQL миграция** — INSERT 4 entitlements:
  - user_id, profile_id, product_code, product_id (из orders_v2), order_id, status='active', expires_at из соответствующего order/subscription, meta: `{source: 'fulfillment_gap_backfill', patch: 'PATCH-REAL-FULFILLMENT-GAPS', order_id}`
4. **Audit_logs** — 4 записи: action='entitlement.backfilled', actor_type='system', actor_label='patch-real-fulfillment-gaps'
5. **After-snapshot** — diff: ровно +4 entitlements, 0 side effects

**STOP-guards:** только user_id `8482889a`, только 4 product_code, без массового backfill, без cb_module_ip, без historical/imported.

**DoD:** 4/4 created, scope leakage=0, duplicate guard=PASS, audit_logs=4.

---

### Блок 2: PATCH-DEALS-SEARCH-BROWSER-PROOF (proof)

Проверить в браузере `/admin/deals` поиск по 9 терминам:

- ценный бухгалтер, маркетплейсы, производство, учет у ип, цб 2, закрой год, премиум, business, чат

Для каждого: результат есть/нет, count в UI, совпадение tabs.

**Артефакт:** `deals_search_proof.csv`

---

### Блок 3: PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF (discovery, read-only)

Полный trace цепочки: UI кнопка → payload → checkout → webhook → grant-access-for-order → subscriptions_v2.

**Уже известно:**

- `grant-access-for-order` L525: `auto_renew: true` hardcoded для всех
- `bepaid-auto-process` L76-96: tariffType определяется через `descLower.includes('клуб')` — text matching

**Файлы для аудита:**

- `grant-access-for-order/index.ts` — L512-535 (subscription creation), все поля
- `bepaid-webhook/index.ts` — обработка `requires_card_tokenization`
- `subscription-charge/index.ts` — `auto_renew`, grace, retries
- `bepaid-create-token/index.ts` — payload для checkout
- `public-checkout/index.ts` — какие offer-поля передаются
- UI: компоненты создания/редактирования tariff_offers (поиск по `auto_renew`, `requires_card_tokenization`, `recurring`)

**Особый кейс course_close_year:** доказать, откуда `auto_renew=true` у 70 подписок — из настроек или из hardcoded default.

**Артефакт:** `field_binding_runtime_matrix.csv` (field_name, stored_in, edited_in_ui, read_by_code, runtime_effect, status).

---

### Блок 4: PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION-PROOF (discovery, read-only)

**Зоны аудита (уже найдены):**


| Зона                 | Файл                                       | Проблема                                         |
| -------------------- | ------------------------------------------ | ------------------------------------------------ |
| Hardcoded code sets  | `_shared/entitlement-sync.ts` L17-29       | SUBSCRIPTION_BASED_CODES, ORDER_BASED_ONLY_CODES |
| Description matching | `bepaid-auto-process` L76-96               | `descLower.includes('клуб')`                     |
| Static name map      | `src/lib/product-names.ts`                 | Hardcoded code→name                              |
| Entitlement by code  | `bepaid-webhook`, `grant-access-for-order` | resolution по product_code                       |
| Description mapping  | `bepaid-raw-transactions`                  | PRODUCT_TARIFF_MAPPINGS                          |
| Report fuzzy match   | `bepaid-report-import`                     | `desc.includes(plan_title)`                      |
| Name hack            | `course-prereg-notify`                     | `product_code === "cb20_predzapis"`              |


Дополнительно: полный grep по `includes(`, `ILIKE`, `.code ===`, `.name ===` в edge functions и src/.

**Артефакты:**

- `product_identity_runtime_matrix.csv` (component, layer, current_id, should_use, name_logic, risk, fix_required)
- `id_vs_name_conflict_cases.csv` (product_id_a, product_id_b, name_a, name_b, confusion_risk)

---

### Порядок выполнения

1. **PATCH-REAL-FULFILLMENT-GAPS** — execute (SQL миграция + audit)
2. **PATCH-DEALS-SEARCH-BROWSER-PROOF** — browser proof
3. **PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF** — code-read discovery → артефакт
4. **PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION-PROOF** — code-read discovery → артефакты
5. По результатам → execute-патчи по auto_renew SoT и ID-first high-risk зон

### Что НЕ делать

- execute по auto_renew / field binding
- массовый cleanup по cb_module_ip
- revoke по бонусам/модулям
- считать naming fix архитектурным решением
- использовать вкладку "Доступы" как SoT