## Отчёт о выполнении: SYSTEM-WIDE WRITE PATH DISCOVERY + Ремонт Матук/Ярошевич/Абрамович + Глобальные sweep-ы

### Что НЕ меняется в данном обновлении

- Код приложения не меняется
- Данные не меняются
- Выполняется только корректировка документации, статусов и CSV-артефакта

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

### PHASE 1: POINT REPAIRS

**Блок 0: Матук** ⚠️ УСЛОВНО ЗАКРЫТ
- Entitlement `14f0d26c` создан для product `73c29914` (ЗАКРОЙ ГОД), expires 2026-07-05
- Root cause: `handleGrantNewAccess` не вызывает `grant-access-for-order`
- Classification: `multiple_blockers` (subscription_without_entitlement + training_root_unpublished)
- **access repair = done** — entitlement создан, access-chain восстановлена
- **content visibility = pending** — training roots `682d241e` и `62d09668` имеют `published_at = NULL`, контентный дефект требует отдельного исправления

**Блок 1: Ярошевич** ✅
- Entitlement `09641160` meta нормализована: `scope_resolution_mode = full_tariff_scope`
- Code fix `useTrainingContentRules.ts` line 330 применён (full_tariff_scope + full_access в branch)
- Full purchase GC-3811003 приоритетен, модульная GC-3818463 — secondary
- Модульная покупка сохранена как исторический факт, не влияет на понижение итогового доступа

**Блок 2: Абрамович** ⚠️ УСЛОВНО ЗАКРЫТ
- Subscription `d2710b58` repaired: `expired → active` (batch REPAIR-CLUB-STATUS-2026-04-06)
- Abramovich-pattern sweep: 2 аналогичных кейса найдены (Королёва, Лялина)
- **Data repair = done** — subscription status восстановлен
- **UI/runtime proof = pending** — требуется отдельная проверка: admin card active, cabinet/runtime visibility, entitlement/subscription dates согласованы

---

### PHASE 2: GLOBAL SWEEP RESULTS ✅ (как диагностика)

**Sweep 1: Active subscriptions without entitlements (53 кейса):**

**Жёсткое разделение:**

**14 real access defect** (broken fulfillment):
| Источник | Кол-во | Тип ремонта |
|---|---|---|
| manual/admin flow (admin_grant) | 10 | create_missing_entitlement |
| manual/admin flow (admin_from_payment) | 3 | create_missing_entitlement |
| unknown / requires deeper trace | 1 | rebuild_full_chain_from_order |

**39 content_not_published** (НЕ access bug):
| Продукт | Кол-во | Причина |
|---|---|---|
| Gorbova Club | 23 | training root published_at = NULL |
| ЦБ 2 ступень | 8 | training root published_at = NULL |
| Бухгалтерия как бизнес | 6 | training root published_at = NULL |
| ЗАКРОЙ ГОД | 2 | training root published_at = NULL |

**Вердикт:** 39 из 53 — контентный дефект. 14 — реальный access-дефект, требующий backfill.

**Backfill victims: ❌ не выполнен (0 из 14)**

---

### PHASE 3: SYSTEM ROOT-FIX ⚠️ ЧАСТИЧНО

**UI root-fix — выполнен (4 файла):**

| # | Файл | До | После |
|---|---|---|---|
| 1 | `ContactDetailSheet.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 2 | `CreateDealFromPaymentDialog.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 3 | `BulkCreateDealsDialog.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 4 | `AdminEntitlements.tsx` | Голый INSERT без meta/source | INSERT с meta warning + audit `manual_grant`. **НЕ является system root-fix**: manual/non-canonical by design, добавлен только warning + audit trail |

**Edge-function root-fix — ❌ НЕ выполнен:**

| # | Edge function | Статус | Причина |
|---|---|---|---|
| 1 | `payments-reconcile/index.ts` | ❌ pending | Прямые INSERT sub + UPSERT entitlement, bypasses grant-access. Требует отдельного патча с dry-run |
| 2 | `bepaid-auto-process/index.ts` | ❌ pending | Direct entitlement upsert by product_code. Требует отдельного патча с dry-run |

**Архитектурное правило:** manual path = same fulfillment as paid path.

---

### Финальный статус проекта

| # | Этап | Статус |
|---|---|---|
| 1 | Discovery write-paths | ✅ завершён |
| 2 | Point repairs (Матук/Ярошевич/Абрамович) | ⚠️ условно закрыто (content у Матук, UI-proof у Абрамович) |
| 3 | Global sweep | ✅ завершён как диагностика |
| 4 | Backfill victims (14 real access defect) | ❌ не выполнен |
| 5 | UI root-fix (3 canonical + 1 guard) | ✅ завершён |
| 6 | Edge-function root-fix | ❌ pending (payments-reconcile, bepaid-auto-process) |
| 7 | Полное закрытие дефекта | ❌ не достигнуто |

### Финальные цифры

| # | Метрика | Значение |
|---|---|---|
| 1 | Write-paths найдено | **16** |
| 2 | Canonical | **6** |
| 3 | Non-canonical | **4** |
| 4 | Partial/special | **6** |
| 5 | Путей исправлено системно | **4** (3 canonical + 1 guard) |
| 6 | Путей остаётся исправить | **2** (payments-reconcile, bepaid-auto-process) |
| 7 | Sweep total | **53** |
| 8 | Real access defect | **14** |
| 9 | Content defect (не access bug) | **39** |
| 10 | Backfill выполнен | **0 из 14** |
| 11 | Кейсов исправлено точечно | **3** (Матук, Ярошевич, Абрамович) |
| 12 | Mismatch paid-flow | **2** (Королёва, Лялина — expired status) |
| 13 | Mismatch manual/admin-created flow | **89** (sub without ent) |
| 14 | Mismatch reconcile/import flow | **0** активных |

---

### STOP-guards на следующий спринт

- Нельзя объявлять «исправлено во всей системе» до перевода payments-reconcile и bepaid-auto-process на canonical fulfillment
- Нельзя считать backfill victims закрытым, пока не получены before/after counts по 14 real access defect (доказуемое уменьшение 14 → 0)
- Нельзя делать массовый backfill до завершения edge-function root-fix
- Нельзя смешивать 14 access-дефектов и 39 content-дефектов в одну метрику
- Нельзя считать Матук полностью закрытой до fix published_at на training roots
- Нельзя считать Абрамович полностью закрытой до UI/runtime proof

### Нерешённые вопросы (обязательные follow-up)

1. **payments-reconcile/index.ts** — перевод на grant-access-for-order с обязательным dry-run
2. **bepaid-auto-process/index.ts** — перевод на grant-access-for-order с обязательным dry-run
3. **39 content_not_published** — training roots с `published_at=NULL`, контентный дефект
4. **Backfill 14 real access defect** — план готов, требует исполнения после edge-function root-fix
5. **Матук content visibility** — training roots `682d241e`, `62d09668` published_at = NULL
6. **Абрамович UI/runtime proof** — admin card, cabinet visibility, dates verification

---

### Артефакты ✅

1. `fulfillment_write_paths_matrix.csv`
2. `non_canonical_fulfillment_writes.csv`
3. `missing_grant_access_call_sites.csv`
4. `manual_vs_normal_fulfillment_diff.csv`
5. `backfill_manual_path_missing_entitlements_plan.csv`
6. `veronika_matyuk_full_access_trace.csv`
7. `matyuk_manual_vs_normal_fulfillment_diff.csv`
8. `manual_created_access_runtime_mismatch.csv`
9. `yaroshevich_cb20_purchase_precedence_trace.csv`
10. `yaroshevich_runtime_visibility_trace.csv`
11. `yaroshevich_module_reconciliation.csv`
12. `yaroshevich_deal_to_access_mapping.csv`
13. `abramovich_payment_to_access_trace.csv`
14. `access_tab_vs_cabinet_runtime_mismatch.csv`
15. `active_paid_window_but_no_access.csv`
16. `active_paid_window_but_no_access_repair_plan.csv`
17. `repair_actions_by_defect_type.csv`
18. `write_paths_root_fix_status.csv` ← НОВЫЙ

---

### Финальный вывод

- Discovery — завершён
- UI root-fix — завершён
- Edge root-fix — не завершён
- Historical backfill — не выполнен
- **Полное закрытие дефекта не достигнуто**

System-wide discovery завершён. UI-пути канонизированы (3 файла) + guard добавлен (AdminEntitlements). 2 edge-function пути (payments-reconcile, bepaid-auto-process) остаются non-canonical. Исторический backfill 14 access-жертв не выполнен. Патч edge-functions и backfill остаются обязательными для полного закрытия дефекта.
