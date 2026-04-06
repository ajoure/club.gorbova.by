# CONSOLIDATED SPRINT — EXECUTE PHASE

Основная нить: **purchase → subscription → entitlement → visibility → UI label → fact/config SoT**.

Цель текущего спринта — не косметика, а окончательная увязка цепочки покупка → выдача → подписка/entitlement → видимость → UI → runtime SoT, без допущений по названиям и без решений по похожести строк.

---

### ОБЯЗАТЕЛЬНЫЙ ПРИНЦИП

**«Названия могут быть похожими. ID — уникален. Все решения принимает только ID.»**

Во всех runtime-цепочках source of truth:
- product_id
- tariff_id
- offer_id
- training_module_id
- при необходимости order_id / subscription_id

Названия, коды, slug, short label, snapshot text — только для отображения и текстового поиска.

**Зафиксировано:**
- cb20 = отдельный продукт «Ценный бухгалтер | 1 ступень 2.0» (product_id: 7101ed3c)
- prd_0d01a2fdc477 = отдельный продукт «Ценный бухгалтер | 2 ступень» (product_id: 87a8870f)
- Это НЕ parent/child, НЕ версии одного продукта. Любые выводы по похожести названий ошибочны.

**Запрещено:**
- Делать выводы по похожести имён
- Связывать продукты по тексту
- Считать code/name/slug surrogate key
- Принимать execute-решения по доступам без ID и runtime proof
- Если поле можно менять в UI, но runtime на него не смотрит — это SoT mismatch

---

### СТАТУС ПАТЧЕЙ

| Патч | Статус | Примечание |
|---|---|---|
| PATCH 1 | **closed** | |
| PATCH 2 | **closed** | 12 ghost кейсов — не баг |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **closed** | |
| PATCH-DERGELEVA-BROWSER-PROOF | **closed** | Manual proof от пользователя |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | **closed** | Root cause доказан |
| PATCH-KOROLYOVA-REVOKE-GUARD-FIX | **closed** | Guard A: proven, Guard B: code-proved |
| PATCH 3 ACCESS-SCOPE-FORENSICS | **closed** | Все фазы завершены |
| PATCH-DEALS-SEARCH-RESOLVER-FIX | **done** | RPC: поиск по product name, code, tariff name |
| PATCH-NAMING-NORMALIZATION-UI-FIRST | **done** | Badges, short labels, trim pipes |
| PATCH-REAL-FULFILLMENT-GAPS | **done** | 4/4 entitlements created |
| PATCH-DEALS-SEARCH-BROWSER-PROOF | **done** | 9 терминов проверены |
| PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF | **done** | field_binding_runtime_matrix.csv |
| PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION-PROOF | **done** | product_identity_runtime_matrix.csv |
| PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX | **done** | hardcode убран, payment_flow-driven |
| PATCH-ID-FIRST-HIGH-RISK-EXECUTE | **done** | entitlement_mode + DB resolver |
| PATCH-ENTITLEMENT-MODE-BACKFILL-EXECUTE | **done** | 26/26 products, 0 NULL |
| POST-FIX PROOF auto_renew | **done** | CONDITIONAL_PASS, 0 new subs |
| POST-FIX PROOF entitlement_mode | **done** | 0 NULL remaining |
| FIELD-BINDING MATRIX final | **done** | 48 fields, 5 statuses |
| PATCH-AUTO-RENEW-SOT-GAP | **pending** | Архитектурный разрыв |
| PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL | **done (CONDITIONAL_PASS)** | 4 точки в webhook исправлены, live webhook event not observed yet |
| PATCH-REMOVE-DECORATIVE-SUBSCRIPTION-FIELDS | **done** | auto_charge_delay_days убран из формы полностью |
| DISCOVERY: GRANULAR-MODULE-BINDING | **done** | 4 артефакта, forensic по 3 модулям |
| 49 cb_module_ip | **hold** | revoke запрещён, классификация: legacy_backfill_access |

---

### POST-FIX PROOF: BEPAID-WEBHOOK PAYMENT_FLOW

**Статус: CONDITIONAL_PASS — deploy confirmed, live webhook event not observed yet**

**Факты:**
- После деплоя (2026-04-06) все 7 новых paid orders имеют заполненный payment_flow
- 0 новых paid orders с NULL payment_flow после фикса
- Ни одного bepaid-webhook-originated paid order после фикса пока не было
- 1787/1983 paid orders до фикса имеют NULL payment_flow (legacy)

**4 точки записи payment_flow в bepaid-webhook:**

| # | payment_flow значение | Сценарий |
|---|----------------------|----------|
| 1 | `bepaid_subscription_renewal` | Продление подписки |
| 2 | `bepaid_subscription_charge` | Привязка заказа к подписке |
| 3 | `bepaid_link_payment` | Оплата через ссылку |
| 4 | `bepaid_one_time_payment` | Разовая оплата |

**DoD:**
- ✅ 0 новых paid orders с NULL payment_flow после фикса
- ✅ auto_renew у всех новых подписок соответствует SoT (7/7 match)
- ⏳ bepaid-webhook-originated транзакция не наблюдалась — proof условный
- При появлении первой live webhook-транзакции: дозаполнить webhook_payment_flow_post_fix_proof.csv

**Артефакты:**
- webhook_payment_flow_post_fix_proof.csv
- auto_renew_post_fix_proof_v2.csv

---

### UI CLEANUP: auto_charge_delay_days

**Статус: done**

Поле полностью убрано из основной формы оффера в `AdminProductDetailV2.tsx`.
Не заменено текстом, не перенесено в legacy-секцию — просто удалено из UI.
Поле остаётся в БД, но не отображается администратору.

---

### DISCOVERY: GRANULAR-MODULE-BINDING — РЕЗУЛЬТАТЫ

**Архитектура (единая для всех 8 модулей):**
- Все модули — child-узлы root-модуля cb20 (`c9f7e9b8`)
- training_modules.product_id у всех child-узлов = cb20 (`7101ed3c`)
- Доступ для standalone-покупателей: access_rules типа `training_content` с `access_mode: partial` + `allowed_module_ids`
- cb20 имеет 0 active entitlements по product_id (parent coverage = 0)

**Матрица модулей:**

| code | paid_orders | active_ent_pid | active_ent_code | product_access_rule | training_content_rule | classification |
|------|-------------|----------------|-----------------|--------------------|-----------------------|----------------|
| cb_module_catering | 2 | 1 | 1 | inactive | active | dual_model |
| cb_module_construction | 1 | 0 | 0 | inactive | active | orphan_binding |
| cb_module_ip | 0 | 49 | 49 | inactive | active | legacy_backfill_access |
| cb_module_marketplaces | 5 | 1 | 2 | **active** | active | dual_model |
| cb_module_production | 5 | 1 | 2 | inactive | active | dual_model |
| cb_module_pvt | 0 | 0 | 0 | inactive | active | dormant |
| cb_module_retail | 6 | 1 | 2 | нет правила | active | dual_model |
| prd_08a84b2b7223 | 3 | 0 | 0 | нет правила | active | orphan_binding |

**Реально неподтверждённые module gaps (требуют execute-решения):**

1. **cb_module_construction** — 1 paid order (user f278876e), 0 entitlements. User has cb20 ent but no module-specific ent.
2. **prd_08a84b2b7223** — 3 paid orders, 0 entitlements. Ни один из 3 не был закрыт предыдущими патчами:
   - user 2b352bdf (GC-3818307-M2): has cb20 ent, no module ent
   - user 8482889a (GC-3830657-M4): no cb20 ent, no module ent
   - user 5c6e6e0f (GC-1767629483208-M2): has cb20 ent, no module ent

3. **cb_module_ip** — 49 active entitlements, 0 paid orders. Классификация: legacy_backfill_access (batch BACKFILL-ENT-v23.1.9B). Не аномалия — результат конкретного backfill. Revoke запрещён.

4. **Partial fulfillment в dual-model модулях** (catering: 2→1, marketplaces: 5→2, production: 5→2, retail: 6→2) — разница между paid orders и active entitlements может быть historical_expired или real gap. Требует отдельной per-user проверки в следующем спринте.

---

### АРТЕФАКТЫ (все в /mnt/documents/)

1. deals_search_proof.csv
2. field_binding_runtime_matrix.csv
3. product_identity_runtime_matrix.csv
4. id_vs_name_conflict_cases.csv
5. auto_renew_post_fix_proof.csv
6. subscription_creation_path_matrix.csv
7. entitlement_mode_backfill_audit.csv
8. entitlement_mode_post_backfill_proof.csv
9. field_binding_runtime_matrix_final.csv
10. webhook_payment_flow_post_fix_proof.csv
11. auto_renew_post_fix_proof_v2.csv
12. granular_module_binding_matrix.csv
13. module_business_model_classification.csv
14. module_visibility_resolution_chain.csv
15. orphan_or_ambiguous_module_bindings.csv

---

### СЛЕДУЮЩИЕ ШАГИ (по приоритету)

1. **При появлении live webhook-транзакции** — дозаполнить webhook proof
2. **Consolidated execute-план по module gaps** — отдельный спринт:
   - cb_module_construction: 1 fulfillment gap
   - prd_08a84b2b7223: 3 fulfillment gaps
   - partial fulfillment в dual-model модулях: per-user forensic
3. **cb_module_ip** — hold, revoke запрещён

### STOP-GUARDS

- Discovery по модулям НЕ приводит к execute-выводам в этом спринте
- Сначала полная forensic-классификация, потом отдельный consolidated execute-план
- Без UPDATE training_modules.product_id
- Без revoke
- Без изменения access_rules

### ЧТО НЕ ДЕЛАТЬ

- execute по module binding — только после утверждения forensic-матрицы
- execute по auto_renew SoT gap — только после live webhook proof
- массовые revoke / cleanup
- считать naming fix архитектурным решением
- использовать вкладку «Доступы» как SoT

### ОЖИДАЕМЫЙ РЕЗУЛЬТАТ СПРИНТА

- ✅ proof по webhook payment_flow (CONDITIONAL_PASS)
- ✅ удаление декоративного поля из формы
- ✅ 4 forensic-артефакта по module binding
- ✅ список только реально неподтверждённых module gaps, без legacy/backfill шума
