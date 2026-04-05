# Да, согласен, с учетом правок:

&nbsp;

&nbsp;

## **PATCH-лист**

&nbsp;

&nbsp;

1. Вынести **связку сделок с продуктами (orders_v2.product_id) в отдельный обязательный PATCH** до reconciliation доступов и до UI bulk-extend. Это не должно остаться “одним из подпунктов”.
2. Разделить весь объём на **3 независимые фазы**:
  &nbsp;
  - A. Discovery/Audit
  - B. Data Reconciliation
  - C. UI Bulk Extend
    Сначала A+B, только потом C.
  &nbsp;
3. Для product mapping ввести **жёсткий dry-run с confidence** и execute только для high-confidence. medium/low — только manual review.
4. Отдельно сегментировать сделки: normal / split_parent / split_child / import / manual / recurring_candidate / one_time_candidate / protected.
5. Для entitlements использовать **unified lookup**: по product_id и fallback по product_code, чтобы не терять legacy записи.
6. Для missing subscriptions не делать массовый create по всем gap-кейсам. Сначала разбить на real recurring / import / manual / one-time / split-derived.
7. Добавить **protected_skip**: staff/admin/test/demo/needs_mapping=true/split_parent/refunded/canceled/failed/ambiguity.
8. В финальный proof включить **before/after по главным метрикам** и отдельный список того, что осталось в manual_review.
9. UI “Продлить доступ” оставить в плане, но явно пометить как **Phase C after data cleanup**, а не параллельную ветку.
10. Обязательно добавить **PATCH по 18 orders без product_id** как часть reconciliation ядра, иначе исходная цель “связать сделки с продуктами” не закрыта.

&nbsp;

&nbsp;

&nbsp;

## **Полный патч**

&nbsp;

```
# PATCH: Глобальная сверка сделок, привязок и доступов + подготовка безопасного bulk extend

## Цель

Привести в порядок полную цепочку:
`orders_v2 -> profiles/user_id -> products -> tariffs -> subscriptions_v2 -> entitlements -> фактический доступ`

Только после этого добавлять UI массового продления доступа.

---

## Жёсткие правила исполнения для Lovable.dev

- add-only
- ничего не ломать вне scope
- discovery/dry-run обязателен перед execute
- никаких массовых execute без CSV proof и batch_id
- split_parent, protected, staff, test/demo не чинить автоматически
- все execute-операции идемпотентны
- все действия логировать в `audit_logs`
- все CSV/скрипты сохранять как proof
- UI bulk-extend делать только после завершения reconciliation
- русский язык во всех планах/отчётах
- финальный отчёт: найдено / исправлено / заблокировано / manual_review

---

# PHASE A — READ-ONLY DISCOVERY AUDIT

## A1. Python audit script

Создать:
- `/tmp/orders_reconciliation_audit.py`
- копия: `/mnt/documents/orders_reconciliation_audit_<batch_id>.py`

Скрипт только читает БД. Никаких write-операций.

## A2. Обязательные CSV-артефакты

### 1. `/mnt/documents/orders_audit_full_<batch_id>.csv`
Все сделки `orders_v2` со статусами:
- paid
- pending
- failed
- refunded
- canceled

Колонки:
- order_id
- order_number
- status
- created_at
- reconcile_source
- order_type (`normal / split_parent / split_child`)
- split_batch_id
- profile_id
- user_id
- email
- product_id
- product_name
- product_code
- tariff_id
- tariff_name
- tariff_access_days
- has_entitlement
- entitlement_id
- entitlement_status
- entitlement_expires_at
- entitlement_match_by (`product_id / product_code / none`)
- entitlement_product_id
- legacy_null_product_id
- duplicate_active_entitlement_count
- has_subscription
- subscription_id
- subscription_status
- subscription_access_end_at
- subscription_billing_type
- source_type
- repair_strategy
- issue_type
- fixable_now
- protected_skip
- manual_review_reason
- duplicate_risk

### 2. `/mnt/documents/issues_by_bucket_<batch_id>.csv`
Сводка по bucket:
- no_product
- no_user_id
- no_entitlement
- no_subscription
- stale_active
- expired_entitlement
- duplicate_entitlement
- protected_skip
- manual_review
- ok

### 3. `/mnt/documents/audit_fixable_user_id_backfill_<batch_id>.csv`
Только fixable cases:
- order_id
- order_number
- profile_id
- current_user_id
- proposed_user_id
- email
- confidence
- ambiguity_reason
- would_update

### 4. `/mnt/documents/audit_fixable_product_mapping_<batch_id>.csv`
Отдельный обязательный CSV по сделкам без `product_id`.

Колонки:
- order_id
- order_number
- profile_id
- user_id
- email
- current_product_id
- proposed_product_id
- proposed_product_name
- mapping_source
- mapping_confidence (`high / medium / low`)
- source_reference
- blocked_reason
- execute_allowed

### 5. `/mnt/documents/audit_fixable_missing_entitlements_<batch_id>.csv`
Только execute-allowed cases:
- source_entity (`order / subscription`)
- source_id
- email
- user_id
- profile_id
- product_id
- product_code
- current_entitlement_id
- current_entitlement_match_by
- action (`create / update / align / backfill`)
- target_expires_at
- duplicate_risk
- execute_allowed

### 6. `/mnt/documents/audit_missing_subscriptions_discovery_only_<batch_id>.csv`
Все `paid + tariff_id`, но без subscription.

Колонки:
- order_id
- order_number
- email
- user_id
- product_id
- tariff_id
- source_type (`provider_managed / one_time / import / manual / split_child / unknown`)
- billing_type_hint
- has_active_entitlement
- discovery_bucket
- execute_allowed

### 7. `/mnt/documents/audit_stale_subscriptions_<batch_id>.csv`
Все subscriptions со `status='active' AND access_end_at < now()`.

Колонки:
- subscription_id
- email
- user_id
- tariff_id
- tariff_name
- access_end_at
- stale_hours
- stale_category (`real_stale / grace_pending / provider_managed_awaiting / manual_review`)
- would_expire

### 8. `/mnt/documents/audit_protected_skip_<batch_id>.csv`
Все cases, исключённые из авто-ремонта.

### 9. `/mnt/documents/audit_manual_review_<batch_id>.csv`
Все remaining cases, не попавшие в auto-fix.

### 10. `/mnt/documents/summary_counts_<batch_id>.csv`
Итоговая summary-таблица по главным метрикам.

---

## A3. Обязательная сегментация заказов

Каждую сделку классифицировать:

- `normal`
- `split_parent` → `meta->>'split_status' in ('children_created','finalized')`
- `split_child` → `meta->>'split_from_order_id' is not null`
- `import` → `reconcile_source in ('bepaid_archive_import','getcourse_historical','csv_active_import')`
- `manual_admin` → `reconcile_source='manual' OR meta->>'source'='admin'`
- `recurring_candidate`
- `one_time_candidate`

## A4. Protected skip rules

Авто-ремонт запрещён, если:
- `meta->>'needs_mapping' = 'true'`
- protected/staff/admin/test/demo
- split_parent
- refunded/canceled/failed
- ambiguity по profile/user
- duplicate_active_entitlement_count > 1

---

# PHASE B — DATA RECONCILIATION (DRY-RUN -> EXECUTE)

Важно: execute только после PHASE A.

---

## B1. PATCH-1 — user_id backfill в orders_v2

### Scope
Чинить только сделки, где:
1. `orders_v2.user_id is null`
2. `orders_v2.profile_id = profiles.id`
3. `profiles.user_id is not null`
4. нет конфликтной альтернативной auth-связки
5. profile не protected / ambiguous

### Execute
Обновить:
- `orders_v2.user_id = profiles.user_id`

### Proof
До/после:
- paid orders with null user_id
- updated count
- blocked/manual count

---

## B2. PATCH-2 — обязательная нормализация product_id у сделок

Это отдельный обязательный patch. Без него задача не считается закрытой.

### Scope
Чинить:
- `orders_v2.product_id is null`
- сделки с отсутствующим/неверным mapping, если есть `high-confidence` source

### Источники маппинга (приоритет)
1. direct historical mapping / import mapping
2. `payments_v2 -> order chain`
3. `bepaid_uid -> payment/order chain`
4. `meta.product_code`
5. `tariff.product_id`
6. historical purchase snapshot
7. split-child metadata

### Execute rule
Обновлять `orders_v2.product_id` только для `mapping_confidence='high'`.

### STOP-guard
Запрещено обновлять:
- split_parent
- protected
- ambiguous
- medium/low confidence
- needs_mapping=true without proof

### Proof
До/после:
- orders without product_id
- high-confidence mapped
- remaining manual_review

---

## B3. PATCH-3 — unified entitlement reconciliation

### Unified lookup
Сначала искать по:
- `(user_id, product_id)`
Потом fallback:
- `(user_id, product_code)`

Сохранять:
- `entitlement_match_by`
- `legacy_null_product_id`

### Scope
Чинить:
1. active subscriptions without entitlement
2. paid orders without entitlement
3. legacy entitlements with null product_id
4. entitlements with expires drift
5. NULL scope cases, если source однозначен

### Execute logic
- missing entitlement → create
- legacy/null product_id → update + backfill product_id
- expires drift → align
- NULL scope + proven source → repair/update
- duplicate active > 1 → manual_review only

### Proof
Колонки:
- old_entitlement_id
- action
- old_expires_at
- new_expires_at
- old_scope
- new_scope
- duplicate_guard_passed

---

## B4. PATCH-4 — subscriptions gap discovery and selective repair

### Важно
Не создавать subscriptions массово по всем gap-кейсам.

Сначала buckets:
- `provider_managed historical/import`
- `manual one_time`
- `real missing recurring`
- `split_child derived`
- `discovery_only`

### Execute allowed только если:
- не protected
- не split_parent
- billing_type доказуем
- нет active/trial subscription по user+tariff
- не import/manual/one-time без явного proof

---

## B5. PATCH-5 — stale active subscriptions

### Scope
`subscriptions_v2.status='active' AND access_end_at < now()`

### Buckets
- `real_stale`
- `grace_pending`
- `provider_managed_awaiting`
- `manual_review`

### Execute
В `expired` переводить только `real_stale`.

---

## B6. PATCH-6 — before/after proof

Обязательный CSV:
`/mnt/documents/reconciliation_before_after_<batch_id>.csv`

Поля:
- metric_name
- before_count
- after_count
- delta
- note

Минимум по метрикам:
- paid_without_product_id
- paid_without_user_id_fixable
- active_subscriptions_without_entitlement
- paid_orders_without_entitlement
- stale_active_subscriptions
- missing_subscriptions_execute_allowed
- duplicate_active_entitlements
- blocked_manual_review
- protected_skip

---

## B7. audit_logs

Каждый execute-патч пишет:
- `action = 'orders_reconciliation.execute'`
- `batch_id`
- `phase`
- `row_count`
- `summary`

Dry-run пишет:
- `action = 'orders_reconciliation.dry_run'`

---

# PHASE C — UI BULK EXTEND ACCESS (только после A+B)

## C1. Новый файл
- `src/components/admin/BulkExtendAccessDialog.tsx`

## C2. Изменяемые файлы
- `src/components/admin/BulkActionsBar.tsx`
- `src/pages/admin/AdminDeals.tsx`

## C3. Preview обязателен
Перед execute по каждой выбранной сделке показать:
- order_number
- email
- product
- current_end
- target_end
- mode (`extend / grant`)
- telegram_action
- result_bucket (`apply / skip / blocked`)
- reason

## C4. Execute
Вызывать существующий `grant-access-for-order` только по строкам `apply`.

## C5. Eligibility
Bulk extend disabled если:
- нет user_id
- нет product_id
- split_parent
- refunded/canceled/failed
- protected
- duplicate_active_entitlement_risk

---

# Порядок выполнения

## Этап 1
Только discovery:
1. Python audit script
2. 10 CSV-артефактов
3. summary counts
4. batch_id
5. short human-readable report

## Этап 2
Reconciliation:
1. PATCH-1 user_id backfill
2. PATCH-2 product_id mapping
3. PATCH-3 entitlement reconciliation
4. PATCH-4 selective subscriptions repair
5. PATCH-5 stale active cleanup
6. PATCH-6 before/after proof

## Этап 3
Только после Этапа 2:
1. BulkExtendAccessDialog
2. BulkActionsBar button
3. AdminDeals integration
4. preview/execute flow

---

# DoD

## Discovery DoD
- 10 CSV в `/mnt/documents/`
- каждая problem-row попала в конкретный bucket
- split_parent / split_child / protected выделены отдельно
- unified entitlement lookup отражён в CSV

## Reconciliation DoD
- 0 fixable paid orders без user_id
- 0 high-confidence orders без product_id
- 0 active subscriptions without entitlement среди execute-allowed
- 0 stale active subscriptions в bucket `real_stale`
- duplicate entitlements не созданы
- before/after proof сохранён
- audit_logs записаны

## UI DoD
- кнопка «Продлить доступ» есть
- preview обязателен
- построчные skip reasons видны
- execute только по eligible deals
- guard: новый срок <= текущего → skip

---

# Scope boundary

Не трогать:
- access_rules
- telegram core revoke/grant logic
- split-parent normalization beyond flags
- payments architecture
- cron jobs
```

Главный ответ на твой вопрос: **нет, в урезанном плане он действительно перепрыгивал к UI bulk-extend слишком рано; здесь я вернул и усилил первоначальную цель — сначала связать сделки с продуктами и вычистить ядро данных, и только потом делать кнопку продления.**

&nbsp;

План: Глобальная сверка сделок + UI массового продления доступа

## Текущее состояние БД


| Метрика                        | Значение                                |
| ------------------------------ | --------------------------------------- |
| Всего сделок                   | 2 708                                   |
| Оплаченных                     | 1 978                                   |
| Paid без product_id            | 18                                      |
| Paid без user_id               | 452 (из них 217 fixable через profiles) |
| Активные подписки              | 336                                     |
| Active subs без entitlement    | 11                                      |
| Paid+tariff без subscription   | 681                                     |
| Stale active subs              | 5                                       |
| Entitlements с null product_id | 5                                       |
| Split parent (paid)            | 7                                       |
| Split child (paid)             | 22                                      |


---

## PHASE A — Read-only Discovery Audit

### Действие

Создать Python-скрипт `/tmp/orders_reconciliation_audit.py` (копия в `/mnt/documents/`).
Скрипт подключается к БД через `psql`/`psycopg2`, читает все нужные таблицы и генерирует 9 CSV.

### Логика классификации

Каждая сделка получает:

- **order_type**: `normal` / `split_parent` / `split_child` (по meta)
- **source_type**: `import` / `manual_admin` / `organic` (по reconcile_source/meta)
- **repair_strategy**: один из 7 значений (backfill_order_user_id, create_entitlement, update_entitlement, manual_review, protected_skip, discovery_only_subscription_gap, needs_product_mapping)
- **fixable_now**: true только если прошли все STOP-guards

### STOP-guards (protected_skip)

- meta.needs_mapping = true
- staff emails (STAFF_EMAILS из grant-access-for-order)
- split_parent
- status in (refunded, canceled, failed)
- duplicate_active_entitlement_count > 1
- ambiguous profile/user linkage

### Entitlement lookup — unified

Поиск по `(user_id, product_id)` + fallback `(user_id, product_code)`. Фиксация `entitlement_match_by` и `legacy_null_product_id`.

### 9 CSV-артефактов

Все с `_<batch_id>` в имени:

1. `orders_audit_full` — все 2708 сделок, ~35 колонок
2. `issues_by_bucket` — сводка по типам проблем
3. `audit_fixable_user_id_backfill` — 217 кандидатов
4. `audit_fixable_product_mapping` — 18 сделок без product_id
5. `audit_fixable_missing_entitlements` — cases с execute_allowed
6. `audit_missing_subscriptions_discovery_only` — 681 gap (discovery only)
7. `audit_stale_subscriptions` — 5 stale active
8. `audit_protected_skip` — все исключения
9. `audit_manual_review` — remaining

---

## PHASE B — Data Reconciliation (последовательные PATCHи)

Каждый PATCH: dry-run CSV → согласование → execute → before/after proof → audit_logs.

### B1. user_id backfill

- Scope: orders_v2.user_id IS NULL, profiles.user_id IS NOT NULL, однозначная связка
- ~217 кандидатов

### B2. product_id mapping

- Scope: 18 orders без product_id, confidence=high
- Маппинг через tariff.product_id, payments chain, meta

### B3. Entitlement reconciliation

- 11 active subs без entitlement → create
- Paid orders без entitlement (из fixable bucket) → create
- 5 entitlements с null product_id → backfill
- expires_at drift → align

### B4. Subscription gap discovery

- 681 paid+tariff без subscription → сегментация на buckets
- Execute только для доказанных recurring-cases

### B5. Stale active cleanup

- 5 stale active subs → bucket (real_stale / grace / provider_managed)
- Expire только real_stale

### B6. Before/after proof CSV

---

## PHASE C — UI Bulk Extend Access

### Файлы


| Файл                                              | Действие                                    |
| ------------------------------------------------- | ------------------------------------------- |
| `src/components/admin/BulkExtendAccessDialog.tsx` | Создать                                     |
| `src/components/admin/BulkActionsBar.tsx`         | Добавить `onBulkExtendAccess` prop + кнопку |
| `src/pages/admin/AdminDeals.tsx`                  | Интеграция диалога, eligibility check       |


### BulkExtendAccessDialog — 3 шага

**Шаг 1 — Настройка:**

- Количество дней (number input)
- Режим: extend (от текущего конца) / grant (от сегодня)
- Apply scope: entitlement_only / entitlement_and_telegram / skip_telegram

**Шаг 2 — Preview (обязательный, блокирующий):**

- Fetch текущий entitlement и subscription для каждой сделки
- Eligibility filter: skip если no_user_id, no_product_id, split_parent, protected, canceled/refunded, duplicate risk, новый срок ≤ текущего
- Таблица: order_number, email, product, current_end, target_end, mode, telegram_action, result_bucket (apply/skip/blocked), reason

**Шаг 3 — Execute:**

- Вызов `grant-access-for-order` для каждой apply-строки с параметрами: `orderId`, `customAccessDays`, `extendFromCurrent`, `grantTelegram`
- Per-row result table: success/skip/fail + ошибки
- Кнопка закрытия только после отображения итога

### BulkActionsBar

- Новый prop `onBulkExtendAccess`
- Кнопка «Продлить доступ» (CalendarPlus icon, зелёный)
- Disabled с tooltip если нет eligible deals

### AdminDeals интеграция

- State: `showBulkExtendDialog`
- Eligibility: хотя бы одна selected deal с status=paid, product_id not null, user_id not null, не split_parent
- Передача selectedIds и deals data в диалог

---

## Порядок выполнения

1. **Phase A**: Python скрипт → 9 CSV → summary
2. **Phase B**: Последовательные PATCHи с dry-run/execute
3. **Phase C**: UI компоненты (после B)

## Scope boundary

Не трогать: access_rules, telegram core logic, split-parent normalization, payments architecture, cron jobs.