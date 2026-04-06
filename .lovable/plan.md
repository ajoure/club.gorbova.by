## да, согласен, с учетом правок:

&nbsp;

1. В блоке **POST-FIX PROOF webhook payment_flow** явно зафиксируй текущий вывод:
  &nbsp;
  - после деплоя все новые **не-webhook** paid orders уже имеют payment_flow;
  - **bepaid-webhook-originated** paid orders после фикса пока не было;
  - поэтому текущий статус не просто CONDITIONAL_PASS, а
    **CONDITIONAL_PASS: deploy confirmed, live webhook event not observed yet**.
  &nbsp;
2. В DoD для блока proof добавь точную формулировку:
  &nbsp;
  - если за окно наблюдения нет новых webhook-paid orders, это **не FAIL**;
  - proof считается условно подтвержденным по коду и по отсутствию regression на новых non-webhook путях;
  - при появлении первой live webhook-транзакции нужно автоматически дозаполнить webhook_payment_flow_post_fix_proof.csv.
  &nbsp;
3. В блоке **UI cleanup** не оставляй текст-пояснение вместо поля в основной форме.
  Нужно:
  &nbsp;
  - полностью убрать auto_charge_delay_days из основной формы;
  - не заменять его новым “полурабочим” текстовым контролом;
  - максимум — короткая read-only справка в отдельной technical/legacy секции, не в основном UX.
  &nbsp;
4. В блоке **GRANULAR-MODULE-BINDING** добавь отдельный forensic-подблок по prd_08a84b2b7223:
  &nbsp;
  - проверить все 3 paid orders поштучно;
  - отдельно указать, какой из них уже закрыт предыдущим patch, а какие ещё нет;
  - не смешивать уже исправленные и неисправленные кейсы в одном bucket.
  &nbsp;
5. В блоке по cb_module_construction и prd_08a84b2b7223 добавь обязательную проверку:
  &nbsp;
  - есть ли у пользователя active entitlement по product_code, даже если нет по product_id;
  - есть ли parent-covered visibility;
  - есть ли historical expired entitlement.
    Только после этого кейс можно относить к direct_order_no_entitlement.
  &nbsp;
6. По cb_module_ip зафиксируй точнее:
  &nbsp;
  - текущая классификация — **legacy_backfill_access**;
  - secondary bucket — bulk_grant_access, только если это доказано отдельным batch/actor;
  - не использовать формулировку “аномалия” до завершения source classification.
  &nbsp;
7. В артефакт granular_module_binding_matrix.csv добавь обязательные колонки:
  &nbsp;
  - has_active_entitlement_by_product_id
  - has_active_entitlement_by_product_code
  - has_historical_entitlement
  - has_parent_cb20_entitlement
  - has_training_content_rule
  - has_product_access_rule
  - final_forensic_bucket
  &nbsp;
8. В orphan_or_ambiguous_module_bindings.csv включай только реально спорные случаи:
  &nbsp;
  - cb_module_ip
  - cb_module_construction
  - prd_08a84b2b7223
  - и любые другие модули, где есть расхождение между order / entitlement / parent coverage.
    Не включать туда уже однозначно классифицированные dual-model кейсы.
  &nbsp;
9. Добавь отдельный STOP-guard:
  &nbsp;
  - discovery по модулям не должен приводить к новым execute-выводам по revoke/backfill в этом же спринте;
  - сначала полная forensic-классификация, потом отдельный consolidated execute-план.
  &nbsp;
10. В финале плана зафиксируй следующий ожидаемый результат спринта:

&nbsp;

&nbsp;

&nbsp;

- proof по webhook payment_flow;
- удаление декоративного поля из формы;
- 4 forensic-артефакта по module binding;
- список **только реально неподтвержденных module gaps**, без legacy/backfill шума.

&nbsp;

&nbsp;

План: POST-FIX PROOF + UI CLEANUP + DISCOVERY GRANULAR-MODULE-BINDING

---

### Данные из БД на момент планирования

**auto_renew / payment_flow:**

- Все 7 paid orders после деплоя (2026-04-06) имеют заполненный `payment_flow` (admin_subscription, provider_managed_checkout, renewal_one_time)
- Ни одного нового webhook-originated paid order пока не было (нет записей с `bepaid_*` payment_flow)
- Общая картина: 1787/1990 paid orders имеют NULL payment_flow (все до фикса)
- **Вердикт: CONDITIONAL_PASS** — фикс деплоен, новые пути работают, но webhook-path ещё не протестирован live-транзакцией

**cb_module_ip:** Все 49 active entitlements — source `historical_backfill`, batch `BACKFILL-ENT-v23.1.9B-2026-03-31T1117Z`, order_id = NULL. Это не аномалия runtime, а результат конкретного backfill-скрипта.

**orphan-risk модули:**

- `cb_module_construction`: 1 paid order (user f278876e), 0 active entitlements → fulfillment gap
- `prd_08a84b2b7223`: 3 paid orders (users 2b352bdf, 8482889a, 5c6e6e0f), 0 active entitlements → fulfillment gaps

---

### Блок 1: POST-FIX PROOF — webhook payment_flow

**Статус:** Деплой подтверждён, но ни одна bepaid-webhook транзакция ещё не прошла.

**Шаги:**

1. SQL-запрос: все orders с `payment_flow LIKE 'bepaid%'` — подтвердить появление после live-транзакции
2. SQL-запрос: все subscriptions, созданные после деплоя — сопоставить `auto_renew` с `payment_flow`
3. Если за 48ч нет ни одного bepaid-webhook paid order → зафиксировать как CONDITIONAL_PASS и перейти дальше

**DoD:**

- 0 новых webhook-paid orders с NULL payment_flow
- auto_renew у новых подписок соответствует SoT
- Если нет новых webhook-транзакций, вердикт = CONDITIONAL_PASS (не FAIL)

**Артефакты:**

- `auto_renew_post_fix_proof.csv` (обновление)
- `webhook_payment_flow_post_fix_proof.csv` (если есть данные)

---

### Блок 2: UI cleanup — auto_charge_delay_days

**Что:** Убрать поле `auto_charge_delay_days` из основной формы оффера полностью. Не warning, не tooltip — убрать.

**Файл:** `src/pages/admin/AdminProductDetailV2.tsx`, строки ~2102-2117.

**Замена:** Вместо Input — короткий текст: «Срок автосписания определяется trial_days тарифа» (если нужно показать, что поле существует в БД, но не функционально).

---

### Блок 3: DISCOVERY — GRANULAR-MODULE-BINDING

**Цель:** По ID доказать бизнес-модель каждого модуля. Без execute, без update, без revoke.

**Для каждого из 8 модульных продуктов собрать:**


| Колонка                            | Источник                                     |
| ---------------------------------- | -------------------------------------------- |
| product_id                         | products_v2                                  |
| product_code                       | products_v2                                  |
| training_module_id                 | access_rules → conditions.allowed_module_ids |
| access_rule_id                     | access_rules                                 |
| grant_target_type                  | access_rules.type                            |
| parent training module             | training_modules parent chain                |
| has standalone paid orders         | orders_v2 count                              |
| has standalone active entitlements | entitlements count                           |
| covered by parent product          | cb20 entitlement check                       |


**Классификация каждого модуля:** `standalone_only` / `parent_only` / `dual_model` / `orphan_binding` / `dormant`

**Отдельная forensic-разбивка для 3 аномальных модулей:**

**cb_module_ip:**

- 49 active entitlements, 0 paid orders
- Все 49 — source `historical_backfill`, batch `BACKFILL-ENT-v23.1.9B-2026-03-31T1117Z`
- Классификация: `bulk_grant_access` (legacy backfill)
- Не формулировать как «аномалия order_based_only» — это forensic bucket, не финальный вывод

**cb_module_construction:**

- 1 paid order (user f278876e, GC-3814251-M3), 0 active entitlements
- Требуется разбивка: `direct_order_no_entitlement` → вероятный fulfillment gap

**prd_08a84b2b7223:**

- 3 paid orders, 0 active entitlements
- 1 из 3 = user 8482889a (уже закрытый в PATCH-REAL-FULFILLMENT-GAPS? нет, это M4, не покрытый)
- Разбивка: `direct_order_no_entitlement` → fulfillment gaps

**Bucket-классификация для каждого кейса:**

- `direct_order_no_entitlement` — оплачен, entitlement не создан
- `subscription_based_access` — доступ через подписку
- `bulk_grant_access` — массовая выдача / backfill
- `legacy_import_no_user` — исторический импорт
- `historical_expired` — истёкший доступ
- `parent_covered_access` — покрыт parent-продуктом

**Артефакты:**

- `granular_module_binding_matrix.csv`
- `module_business_model_classification.csv`
- `module_visibility_resolution_chain.csv`
- `orphan_or_ambiguous_module_bindings.csv`

---

### Порядок выполнения

1. **POST-FIX PROOF** webhook payment_flow → артефакт + вердикт
2. **UI cleanup** → убрать `auto_charge_delay_days` из формы
3. **DISCOVERY** granular-module-binding → 4 артефакта + forensic по 3 модулям

### STOP-guards

- Без execute по модулям
- Без UPDATE training_modules.product_id
- Без revoke
- Без изменения access_rules
- Только discovery + proof + UI cleanup

### Техническая секция

**Файлы для изменения:**

- `src/pages/admin/AdminProductDetailV2.tsx` — удалить блок L2102-2117 (auto_charge_delay_days input)

**SQL-запросы для discovery (read-only):**

- access_rules по product_id для 8 модулей
- training_modules parent chain от cb20 root (c9f7e9b8)
- entitlements group by source/meta для cb_module_ip
- orders_v2 + entitlements cross-check для construction и prd_08a84b