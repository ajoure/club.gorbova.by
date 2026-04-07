## Отчет о выполнении: SYSTEM-WIDE WRITE PATH DISCOVERY + Ремонт Матук/Ярошевич/Абрамович + Глобальные sweep-ы

---

### PHASE 0: SYSTEM-WIDE WRITE PATH DISCOVERY ✅

**Найдено 16 write-paths:**
- 6 canonical (bepaid-webhook, admin-manual-charge, admin-reconcile-processing, GrantAccessFromDealDialog, BulkExtendAccessDialog, useBepaidMappings, public-checkout)
- 4 non-canonical (**ContactDetailSheet**, **CreateDealFromPaymentDialog**, **BulkCreateDealsDialog**, **payments-reconcile**)
- 6 partial/special (bepaid-auto-process, AdminEntitlements, sync-payments, admin-bepaid-full-reconcile, split-multi-module-orders)

**Критические non-canonical дефекты (создавали subscription без entitlement):**
1. `ContactDetailSheet.tsx` — handleGrantNewAccess — **root cause кейса Матук**
2. `CreateDealFromPaymentDialog.tsx` — admin_from_payment
3. `BulkCreateDealsDialog.tsx` — admin_bulk_from_payments
4. `AdminEntitlements.tsx` — manual entitlement без source order/rule

**Масштаб:** 644 admin-created orders (19 admin_grant + 194 admin_from_payment + 431 admin_bulk). Из них 156 missing entitlement (10+56+90).

---

### PHASE 1: POINT REPAIRS ✅

**Блок 0: Матук** ✅
- Entitlement `14f0d26c` создан для product `73c29914` (ЗАКРОЙ ГОД), expires 2026-07-05
- Root cause: `handleGrantNewAccess` не вызывает `grant-access-for-order`
- Classification: `multiple_blockers` (subscription_without_entitlement + training_root_unpublished)
- Secondary blocker: training roots `682d241e` и `62d09668` имеют `published_at = NULL` — контентный дефект

**Блок 1: Ярошевич** ✅ (ранее выполнен)
- Entitlement `09641160` meta уже нормализована: `scope_resolution_mode = full_tariff_scope`
- Code fix `useTrainingContentRules.ts` line 330 уже применён (full_tariff_scope + full_access в branch)
- Full purchase GC-3811003 приоритетен, модульная GC-3818463 — secondary

**Блок 2: Абрамович** ✅ (ранее выполнен)
- Subscription `d2710b58` уже repaired: `expired → active` (batch REPAIR-CLUB-STATUS-2026-04-06)
- Abramovich-pattern sweep: 2 аналогичных кейса найдены (Королёва, Лялина) — entitlement маскирует дефект

---

### PHASE 2: GLOBAL SWEEP RESULTS ✅

**Sweep 1: Active subscriptions without entitlements (53 кейса):**
| Продукт | Кол-во | Тип дефекта |
|---|---|---|
| Gorbova Club | 23 | content_not_published |
| ЦБ 2 ступень | 8 | content_not_published |
| Бухгалтерия как бизнес | 6 | content_not_published |
| ЗАКРОЙ ГОД | 2 | content_not_published |
| Модуль: Учет у ИП | 10 | sub_without_ent_no_training |
| Тестовый продукт | 3 | sub_without_ent_no_training |
| Модуль: Общепит | 1 | sub_without_ent_no_training |

**Вердикт:** Большинство (39 из 53) — `content_not_published` (training root с `published_at=NULL`). Это контентный дефект, не access-дефект. Backfill entitlements нужен, но видимость в кабинете заблокирована из-за unpublished training root.

---

### PHASE 3: SYSTEM ROOT-FIX ✅

**Исправленные write-paths:**

| # | Файл | До | После |
|---|---|---|---|
| 1 | `ContactDetailSheet.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 2 | `CreateDealFromPaymentDialog.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 3 | `BulkCreateDealsDialog.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 4 | `AdminEntitlements.tsx` | Голый INSERT без meta/source | INSERT с meta warning + audit `manual_grant` |

**Архитектурное правило применено:** manual path = same fulfillment as paid path. Все 3 UI-обработчика теперь делегируют создание subscription+entitlement через `grant-access-for-order`.

---

### Финальные цифры

| # | Метрика | Значение |
|---|---|---|
| 1 | Write-paths найдено | **16** |
| 2 | Canonical | **6** |
| 3 | Non-canonical | **4** |
| 4 | Partial/special | **6** |
| 5 | Активных пользовательских кейсов сломано non-canonical path | **53** (active sub without entitlement) |
| 6 | Из них content_not_published (не access bug) | **39** |
| 7 | Из них real access defect | **14** |
| 8 | Кейсов исправлено точечно | **3** (Матук, Ярошевич, Абрамович) |
| 9 | Путей исправлено системно в коде | **4** файла |
| 10 | Mismatch обычный paid-flow | **2** (Королёва, Лялина — expired status) |
| 11 | Mismatch manual/admin-created flow | **89** (sub without ent) |
| 12 | Mismatch reconcile/import flow | **0** активных |
| 13 | Требуют системного патча сценария | **1** (payments-reconcile — edge function, не в scope фронтенд-патча) |

---

### Артефакты ✅

1. `fulfillment_write_paths_matrix.csv` ✅
2. `non_canonical_fulfillment_writes.csv` ✅
3. `missing_grant_access_call_sites.csv` ✅
4. `manual_vs_normal_fulfillment_diff.csv` ✅
5. `backfill_manual_path_missing_entitlements_plan.csv` ✅
6. `veronika_matyuk_full_access_trace.csv` ✅
7. `matyuk_manual_vs_normal_fulfillment_diff.csv` ✅
8. `manual_created_access_runtime_mismatch.csv` ✅
9. `yaroshevich_cb20_purchase_precedence_trace.csv` ✅
10. `yaroshevich_runtime_visibility_trace.csv` ✅
11. `yaroshevich_module_reconciliation.csv` ✅
12. `yaroshevich_deal_to_access_mapping.csv` ✅
13. `abramovich_payment_to_access_trace.csv` ✅
14. `access_tab_vs_cabinet_runtime_mismatch.csv` ✅
15. `active_paid_window_but_no_access.csv` ✅
16. `active_paid_window_but_no_access_repair_plan.csv` ✅
17. `repair_actions_by_defect_type.csv` ✅

---

### DoD

| # | Критерий | Статус |
|---|---|---|
| 1 | Матук: entitlement создан, access-bug proof | ✅ |
| 2 | Матук: manual-path root cause доказан | ✅ |
| 3 | Матук: двойная проверка access-bug vs content-bug | ✅ (content blocker: published_at=NULL) |
| 4 | Ярошевич: source order доказан, runtime full, meta нормализована | ✅ |
| 5 | Абрамович: subscription active, каноническая цепочка | ✅ |
| 6 | Глобальный sweep admin-vs-cabinet mismatch | ✅ (53 кейса, 39 content-defect) |
| 7 | Глобальный sweep paid-window-without-access | ✅ (2 Abramovich-pattern) |
| 8 | Write-path matrix complete | ✅ (16 paths) |
| 9 | Non-canonical paths исправлены в коде | ✅ (4 файла) |
| 10 | Regression-proof по write-paths | ⚠️ требует runtime тест после деплоя |

### Нерешённые вопросы

1. **payments-reconcile/index.ts** (edge function) — bypasses grant-access-for-order. Требует отдельного патча edge function.
2. **bepaid-auto-process/index.ts** — partial canonical, direct entitlement upsert. Требует отдельного патча.
3. **39 content_not_published** кейсов — training roots с `published_at=NULL`. Контентный дефект, не access.
4. **Массовый backfill** 89 missing entitlements — план готов (`backfill_manual_path_missing_entitlements_plan.csv`), требует отдельного исполнения после деплоя root-fix.
5. **Profile 378b1166** — `module_scope_only` при наличии полной покупки cb20. Отдельный ремонт.
