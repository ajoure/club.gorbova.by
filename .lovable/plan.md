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
| PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL | **pending** | Hotfix-кандидат |
| PATCH-REMOVE-DECORATIVE-SUBSCRIPTION-FIELDS | **pending** | Ждёт утверждения матрицы |
| DISCOVERY: GRANULAR-MODULE-BINDING | **pending** | Read-only |
| 49 cb_module_ip | **hold** | revoke запрещён |

---

### АРХИТЕКТУРНЫЙ РАЗРЫВ: PATCH-AUTO-RENEW-SOT-GAP

**payment_flow не является надёжным SoT для auto_renew:**
- bepaid-webhook НЕ пишет payment_flow при обновлении order на paid
- 90% старых заказов (1787/1990) имеют NULL payment_flow
- Текущий фикс безопасен для новых путей (checkout/admin)
- Но уязвим, если grant-access-for-order вызовется для legacy order

**Матрица путей создания подписок (subscription_creation_path_matrix.csv):**

| Path | auto_renew source | payment_flow | Gap |
|---|---|---|---|
| grant-access-for-order | order.meta.payment_flow | checkout/admin ставят | OK для новых |
| bepaid-webhook | internal logic | НЕ пишет | GAP: 90% NULL |
| admin/manual | admin choice | admin_subscription | OK |
| bulk_grant | always false | N/A | OK |
| preregistration_auto_charge | hardcoded | НЕ пишет | GAP |

**Требуется:** PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL

---

### FIELD-BINDING MATRIX — КРИТИЧЕСКИЕ НАХОДКИ

Артефакт: `/mnt/documents/field_binding_runtime_matrix_final.csv` (48 полей)

| Поле | Статус | UI action |
|---|---|---|
| tariffs.is_subscription | **dead_field** | must_be_removed_from_ui |
| tariff_offers.auto_charge_delay_days | **misleading_ui_field** | must_be_removed_from_ui |
| tariffs.trial_enabled | display_only | не проверяется runtime |
| tariffs.discount_enabled/percent | display_only | только визуал на лендинге |
| tariff_offers.requires_card_tokenization | runtime_sot | ✅ |
| tariff_offers.auto_charge_after_trial | runtime_sot | ✅ |
| tariffs.access_days | runtime_sot | ✅ |
| products_v2.entitlement_mode | runtime_sot | ✅ |

**Правило:** отсутствие runtime-read = поле нефункционально. Нельзя оставлять в основном UI без предупреждения.

---

### ENTITLEMENT_MODE — ПОЛНАЯ КАРТА (26/26 заполнены)

| Mode | Count | Products |
|---|---|---|
| subscription_based | 7 | club, buh_business, course_close_year, cb_module_ip, prd_0d01a2fdc477, 1769009596189-398a |
| order_based_only | 16 | cb20, cb_module_*, web_*, pn_s_fl, prd_0e5fda1e, prd_49dc33, prd_08a84b |
| legacy_skip | 3 | consultation, prd_3318c30f (тест), prd_88985c67 (предзапись) |

**DoD: NULL entitlement_mode = 0 для всех боевых продуктов.**

---

### СЛЕДУЮЩИЕ ШАГИ (по приоритету)

1. **PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-BACKFILL** — hotfix
   - webhook должен писать payment_flow при paid
   - DoD: новые webhook-paid orders → payment_flow != NULL

2. **PATCH-REMOVE-DECORATIVE-SUBSCRIPTION-FIELDS** — execute
   - Убрать dead_field и misleading_ui_field из admin UI
   - По матрице field_binding_runtime_matrix_final.csv

3. **DISCOVERY: GRANULAR-MODULE-BINDING** — read-only
   - Для каждого модуля: product_id, training_module_id, access_rule_id, parent_id
   - standalone / parent-covered / dual — только по ID

---

### ЧТО НЕ ДЕЛАТЬ

- execute по field binding — только после утверждения матрицы
- execute по auto_renew SoT gap — только после proof
- execute по module visibility — только после discovery
- массовые revoke / cleanup
- считать naming fix архитектурным решением
- использовать вкладку «Доступы» как SoT

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
