## Да, согласен, с учетом правок:

&nbsp;

1. **Блок 2 не только proof, но и обязательно execute-backfill для entitlement_mode.**
  Нельзя оставлять 19 из 26 продуктов на fallback. Это ломает сам смысл ID-first.
  Добавь:
  &nbsp;
  - PATCH-ENTITLEMENT-MODE-BACKFILL-EXECUTE
  - заполнить products_v2.entitlement_mode **для всех активных продуктов**
  - после этого второй шаг: доказать, что fallback больше не используется для production-продуктов
  - отдельный артефакт: entitlement_mode_post_backfill_proof.csv
  - DoD: NULL entitlement_mode = 0 для всех боевых продуктов, fallback допустим только для legacy/test
  &nbsp;
2. **По auto_renew зафиксируй прямо в плане: найден не просто risk, а архитектурный разрыв SoT.**
  Сейчас:
  &nbsp;
  - grant-access-for-order читает order.meta.payment_flow
  - bepaid-webhook этот payment_flow массово не пишет
  - значит логика auto_renew опирается на поле, которое не является гарантированным SoT
    Это надо назвать прямо:
  - PATCH-AUTO-RENEW-SOT-GAP
  - SoT для автопродления должен определяться не из случайного meta.payment_flow, а из **нормализованного runtime-источника**: order/offer/provider mapping
  - если для части путей источник не записывается, это баг модели, а не просто пробел в proof
  &nbsp;
3. **В Блок 1 добавь обязательную классификацию всех путей создания подписки.**
  Не просто “проверить после деплоя”, а построить матрицу:
  &nbsp;
  - grant-access-for-order
  - bepaid-webhook
  - admin/manual path
  - migrate/import/backfill
  - extension path
    Для каждого пути:
  - откуда берётся auto_renew
  - откуда берётся payment_flow
  - обязателен ли payment_method_id
  - какой источник истины используется
    Артефакт:
  - subscription_creation_path_matrix.csv
  &nbsp;
4. **Добавь отдельный hotfix-кандидат, если подтвердится NULL payment_flow на новых заказах webhook-пути.**
  Это не просто “зафиксировать gap”, а сразу подготовить:
  &nbsp;
  - PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL
  - при paid/update order webhook должен явно писать в orders_v2.meta.payment_flow
  - DoD: новые webhook-paid orders больше не имеют NULL payment_flow
  &nbsp;
5. **В field-binding matrix обязательно раздели 5 статусов, не 3-4.**
  Для каждого поля нужен один из статусов:
  &nbsp;
  - runtime_sot
  - runtime_used_secondary
  - display_only
  - dead_field
  - misleading_ui_field
    И отдельно колонка:
  - must_be_removed_from_ui
  - must_be_moved_to_advanced_settings
  - must_become_sot
  &nbsp;
6. **По tariff_offers, tariffs, products_v2 добавь правило “ни одно поле не считается рабочим, пока не доказан runtime-read”.**
  Это важно из-за твоего комментария: часть кнопок и настроек сейчас декоративные.
  Прямо зафиксируй в плане:
  &nbsp;
  - отсутствие runtime-read = поле считается нефункциональным
  - нефункциональные поля нельзя оставлять в основном UI без предупреждения
  &nbsp;
7. **В discovery по granular-module-binding добавь обязательную связку с ID-first.**
  Для каждого модуля надо фиксировать:
  &nbsp;
  - product_id
  - training_module_id
  - access_rule_id
  - parent training module id
  - standalone / parent-covered / dual
    Никаких классификаций по имени модуля, slug или похожести текста.
  &nbsp;
8. **Порядок выполнения уточни так:**
  &nbsp;
  - сначала POST-FIX PROOF auto_renew
  - параллельно subscription_creation_path_matrix
  - затем PATCH-ENTITLEMENT-MODE-BACKFILL-EXECUTE
  - затем entitlement_mode_post_backfill_proof
  - затем field_binding_runtime_matrix_final
  - затем решение по hotfix webhook
  - только после этого discovery по granular module binding считать следующей основной веткой
  &nbsp;
9. **Что не упустить:**
  В план надо добавить явный вывод:
  &nbsp;
  - payment_flow сейчас не может считаться надёжным SoT, пока не доказана его обязательная запись во всех путях
  - entitlement_mode сейчас ещё не завершён как migration-to-SoT, потому что часть продуктов сидит на fallback
  - следовательно, execute по следующим access-патчам нельзя строить на недоведённой SoT-модели
  &nbsp;

&nbsp;

&nbsp;

Если коротко, то твой план правильный по направлению, но его надо ужесточить:

**сначала закрыть SoT для auto_renew и entitlement_mode, потом двигаться дальше.**

&nbsp;

План: POST-FIX PROOF + FIELD-BINDING FINALIZATION

---

### Критическая находка перед планом

**auto_renew fix имеет gap в webhook-пути.**

Текущая логика в `grant-access-for-order`:

```
paymentFlow = order.meta.payment_flow || ''
isSubscriptionFlow = paymentFlow.includes('subscription') || paymentFlow === 'provider_managed_checkout'
shouldAutoRenew = isSubscriptionFlow && hasPaymentMethod
```

Проблема: `bepaid-webhook` НЕ ставит `payment_flow` в `order.meta` при обновлении заказа на `paid` (L1474-1486). Из 1990 paid-заказов 1787 (90%) имеют `payment_flow = NULL`.

**Однако**: это НЕ regression прямо сейчас, потому что:

- Заказы из `bepaid-webhook` (provider-managed) обрабатывают подписки ВНУТРИ webhook, не через `grant-access-for-order`
- `grant-access-for-order` вызывается из `create-payment-checkout` и admin-paths, которые УЖЕ ставят `payment_flow`
- Новые заказы с 5 апреля все имеют `payment_flow` заполненный

Но есть edge case: если `grant-access-for-order` когда-нибудь вызовется для старого заказа без `payment_flow` → `auto_renew` будет `false`. Это нужно зафиксировать как known risk.

---

### Блок 1: POST-FIX PROOF — auto_renew (execute)

**Что сделать:**

1. SQL-запрос: все подписки, созданные после деплоя (2026-04-06 14:40+), с join на orders_v2 для `payment_flow`
2. Для каждой: сравнить `auto_renew` с ожидаемым значением по `payment_flow`
3. Отдельно: все заказы за последние 48ч с NULL `payment_flow` — подтвердить, что они НЕ прошли через `grant-access-for-order`
4. Проверить extend-ветку: подписки, где `auto_renew` обновился при extend

**Артефакт:** `/mnt/documents/auto_renew_post_fix_proof.csv`

Колонки: order_id, created_at, product_code, payment_flow, has_payment_method, subscription_id, auto_renew, expected_auto_renew, verdict

**STOP-check:** если обнаружатся новые подписки (после деплоя), где `payment_flow` NULL → зафиксировать как gap и подготовить hotfix для `bepaid-webhook` (добавить `payment_flow` в meta при обновлении order).

---

### Блок 2: POST-FIX PROOF — entitlement_mode / ID-first (execute)

**Что сделать:**

1. Полный список products_v2 с `entitlement_mode`: заполненные vs NULL
2. Для каждого NULL — определить, попадает ли в fallback set, и какой mode должен быть
3. SQL миграция: backfill `entitlement_mode` для оставшихся 19 продуктов
4. Проверить, что `resolveEntitlementMode()` больше не падает в fallback

**Артефакт:** `/mnt/documents/entitlement_mode_backfill_audit.csv`

Колонки: product_id, code, name, current_mode, fallback_mode, should_be, action

**Для bepaid-auto-process:** проверить логи — используется ли новый ID-first path или всё ещё fallback на text matching.

**Артефакт:** `/mnt/documents/bepaid_auto_process_resolution_proof.csv` (из логов edge function)

---

### Блок 3: FIELD-BINDING RUNTIME MATRIX — финальный вердикт (discovery → артефакт)

Полный inventory всех полей из 3 таблиц с вердиктом:

**tariff_offers (27 колонок):**

- `requires_card_tokenization` — читается в `bepaid-webhook` L3600, `direct-charge` L338 → **used_runtime**
- `auto_charge_after_trial` — читается в webhook → **used_runtime**
- `auto_charge_delay_days` — НЕ читается нигде → **dead_field**
- `auto_charge_amount` — проверить → verdict
- `reentry_amount` — проверить → verdict
- `reject_virtual_cards` — проверить → verdict
- И т.д. по каждому полю

**tariffs (31 колонка):**

- `trial_enabled`, `trial_days`, `trial_price`, `trial_auto_charge` — проверить
- `is_popular`, `badge`, `subtitle`, `period_label` — скорее всего display_only
- `discount_enabled`, `discount_percent`, `original_price` — display_only
- `access_days` — **used_runtime** (в webhook, grant-access)

**products_v2:**

- `category` — display_only (badge)
- `entitlement_mode` — **used_runtime** (entitlement-sync)
- Остальные — проверить

**Артефакт:** `/mnt/documents/field_binding_runtime_matrix_final.csv`

Колонки: table, field_name, edited_in_ui, read_by_code (function:line), runtime_effect, status (used_runtime / display_only / dead_field / misleading / duplicated), notes

---

### Блок 4: DISCOVERY — GRANULAR-MODULE-BINDING (параллельно, read-only)

Только discovery, без execute. Зафиксировать для каждого модульного продукта:

- standalone vs parent-covered
- текущая привязка в training_modules
- текущие access_rules
- есть ли dual-model (и standalone, и часть программы)

---

### Порядок выполнения

1. **POST-FIX PROOF auto_renew** — SQL + артефакт + STOP-check
2. **POST-FIX PROOF entitlement_mode** — SQL + backfill migration + артефакт
3. **FIELD-BINDING MATRIX финальный** — code-read + артефакт
4. **DISCOVERY GRANULAR-MODULE-BINDING** — параллельно, read-only

### Что НЕ делать

- execute по field binding (удаление dead fields) — только после утверждения матрицы
- execute по auto_renew gap в webhook — только после proof
- execute по module visibility — только после discovery
- массовые revoke / cleanup