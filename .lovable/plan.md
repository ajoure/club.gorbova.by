## Отчёт о выполнении: SYSTEM-WIDE WRITE PATH DISCOVERY + Edge-function canonical migration + Point repairs

### Что НЕ меняется в данном обновлении

- Данные не меняются (никаких INSERT/UPDATE в БД)
- Backfill не выполняется в этом патче — идёт отдельным следующим шагом
- Legacy path в payments-reconcile сохранён без изменений (с audit warning)

### Что изменилось

- **payments-reconcile (active path)**: direct INSERT subscriptions_v2 + UPSERT entitlements + invoke telegram-grant-access → заменены на единый вызов `grant-access-for-order`
- **bepaid-auto-process**: conditional grant-access (только is_subscription) + post-grant direct entitlement writes → заменены на безусловный `grant-access-for-order` для ВСЕХ типов продуктов; post-grant direct writes УДАЛЕНЫ полностью

---

### PHASE 0: SYSTEM-WIDE WRITE PATH DISCOVERY ✅

**Найдено 16 write-paths:**
- 6 canonical (bepaid-webhook, admin-manual-charge, admin-reconcile-processing, GrantAccessFromDealDialog, BulkExtendAccessDialog, useBepaidMappings, public-checkout)
- 4 non-canonical (**ContactDetailSheet**, **CreateDealFromPaymentDialog**, **BulkCreateDealsDialog**, **payments-reconcile**)
- 6 partial/special (bepaid-auto-process, AdminEntitlements, sync-payments, admin-bepaid-full-reconcile, split-multi-module-orders)

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
- **UI/runtime proof = pending** — требуется отдельная проверка:
  - admin card = active
  - cabinet/runtime visibility проверена
  - entitlement/subscription dates согласованы

---

### PHASE 2: GLOBAL SWEEP RESULTS ✅ (как диагностика)

**Sweep 1: Active subscriptions without entitlements**

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

### PHASE 3: SYSTEM ROOT-FIX ⚠️ ЧАСТИЧНО → ПОЧТИ ЗАВЕРШЁН

**UI root-fix — выполнен (4 файла):**

| # | Файл | До | После |
|---|---|---|---|
| 1 | `ContactDetailSheet.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 2 | `CreateDealFromPaymentDialog.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 3 | `BulkCreateDealsDialog.tsx` | Direct INSERT subscriptions_v2 | Вызов `grant-access-for-order` |
| 4 | `AdminEntitlements.tsx` | Голый INSERT без meta/source | INSERT с meta warning + audit. **НЕ является system root-fix**: manual/non-canonical by design, только warning + audit trail |

**Edge-function root-fix — ✅ active paths / ⚠️ legacy path:**

| # | Edge function | Active path | Legacy path | Grep-proof |
|---|---|---|---|---|
| 1 | `payments-reconcile` | ✅ Переведён на `grant-access-for-order` | ⚠️ Сохранён с audit warning (legacy orders не совместимы с canonical) | ZERO direct writes в active path |
| 2 | `bepaid-auto-process` | ✅ Переведён на `grant-access-for-order` (unconditional, все типы продуктов) | N/A | ZERO direct writes к subscriptions/entitlements/entitlement_orders |

**Ключевые изменения в edge functions:**

**payments-reconcile (active path):**
- УДАЛЕНО: Direct INSERT subscriptions_v2 (бывш. строки 532-546)
- УДАЛЕНО: Direct UPSERT entitlements по product_code (бывш. строки 558-569)
- УДАЛЕНО: Дублирующий invoke telegram-grant-access (бывш. строки 574-578)
- ДОБАВЛЕНО: Единый вызов `grant-access-for-order` с orderId
- СОХРАНЕНО: payment creation, queue completion, admin notifications, audit trail

**payments-reconcile (legacy path):**
- СОХРАНЁН без автоматической миграции (legacy orders без FK)
- ДОБАВЛЕНО: `_warning` в meta каждой записи
- ДОБАВЛЕНО: audit_logs запись с action `legacy_direct_write_warning`

**bepaid-auto-process:**
- УДАЛЕНО: Условный вызов grant-access (был только для `is_subscription`)
- УДАЛЕНО: Весь блок direct entitlement INSERT/UPDATE по product_code (бывш. строки 838-900+)
- УДАЛЕНО: Direct entitlement_orders INSERT (бывш. строки 907-920)
- ДОБАВЛЕНО: Безусловный `grant-access-for-order` для ВСЕХ типов продуктов
- СОХРАНЕНО: order creation, payment creation, admin notifications, GC sync, queue management

**Запрет post-grant direct writes:** После вызова grant-access-for-order запрещено выполнять любые direct UPSERT в entitlements — это перетирает canonical access_rule_id.

---

### Victim counts (с дедупликацией)

**UI paths (intra-path dedup, cross-path dedup НЕ завершён):**
| Write path | Total orders | Unique profiles | Missing entitlement | Unique profiles missing |
|---|---|---|---|---|
| ContactDetailSheet (admin_grant) | 19 | 17 | 15 | 14 |
| CreateDealFromPaymentDialog (admin_from_payment) | 211 | 137 | 190 | 126 |
| BulkCreateDealsDialog (admin_bulk) | 431 | 131 | 422 | 129 |
| **ИТОГО UI paths** | **661** | **~250*** | **627** | **~235*** |

*Меж-path дедуп ещё не завершён, итоговое число уникальных жертв будет подтверждено отдельным after-proof*

**Разделение по приоритету:**
- **historical victims total**: 627 orders без entitlement
- **currently active victims**: 17 (10 bulk_grant + 7 unknown source — с активными подписками)
- **currently harmful victims**: 14 (реально broken fulfillment, пользователь не видит купленный контент)

**Edge paths:**
- payments-reconcile: 0 active victims на текущем sweep. Bypass в коде существовал и остаётся риском в legacy path. 3 subscription с source `reconciliation_legacy`.
- bepaid-auto-process: 0 active victims на текущем sweep. Bypass в коде существовал и мог перетереть canonical результаты. Теперь устранён.

**Repaired:** Матук (1 entitlement created). Остальные — 0.

---

### Grep-proof (before/after)

**payments-reconcile:**
- `from("subscriptions_v2").insert` — active path: ❌→✅ REMOVED; legacy path: remains (by design)
- `from("entitlements").upsert` — active path: ❌→✅ REMOVED; legacy path: remains (by design)
- `product_code` in write-side — active path: ❌→✅ REMOVED; legacy path: remains (by design)

**bepaid-auto-process:**
- `from("subscriptions_v2").insert` — ❌→✅ ZERO matches
- `from("entitlements").insert/upsert` — ❌→✅ ZERO matches
- `product_code` in write-side — ❌→✅ ZERO matches (only in comments)
- `entitlement_orders` — ❌→✅ ZERO matches (only in comments)

---

### Финальный статус проекта

| # | Этап | Статус |
|---|---|---|
| 1 | Discovery write-paths | ✅ завершён |
| 2 | Point repairs (Матук/Ярошевич/Абрамович) | ⚠️ условно закрыто (content у Матук, UI-proof у Абрамович) |
| 3 | Global sweep | ✅ завершён как диагностика |
| 4 | Backfill victims (14 real access defect) | ❌ не выполнен |
| 5 | UI root-fix (3 canonical + 1 guard) | ✅ завершён |
| 6 | Edge-function root-fix (active paths) | ✅ завершён (payments-reconcile + bepaid-auto-process) |
| 7 | Edge-function legacy path | ⚠️ сохранён с audit warning, требует отдельного discovery |
| 8 | Полное закрытие дефекта | ❌ не достигнуто |

### DoD (жёсткий)

- **UI root-fix = completed**
- **Edge root-fix (active paths) = completed** — обе функции запатчены, задеплоены, grep-proof подтверждён
- **Edge root-fix (legacy path) = pending** — payments-reconcile legacy path сохранён с audit warnings
- **Full root closure forbidden** until:
  - legacy path discovery завершён
  - backfill historical victims выполнен и доказан (before/after counts 14→0)
  - новые victim-кейсы из UI = 0 (доказано code review ✅)
  - новые victim-кейсы из edge active paths = 0 (доказано grep-proof ✅)
- **Backfill не входит в этот патч** и идёт отдельным следующим шагом

### Финальные цифры

| # | Метрика | Значение |
|---|---|---|
| 1 | Write-paths найдено | **16** |
| 2 | Canonical | **6** |
| 3 | Non-canonical | **4** |
| 4 | Partial/special | **6** |
| 5 | Путей исправлено системно | **6** (3 UI canonical + 1 UI guard + 2 Edge active paths) |
| 6 | Путей остаётся исправить | **1** (payments-reconcile legacy path) |
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

- Нельзя объявлять «исправлено во всей системе» до завершения legacy path discovery в payments-reconcile
- Нельзя считать backfill victims закрытым, пока не получены before/after counts по 14 real access defect (доказуемое уменьшение 14 → 0)
- Нельзя делать массовый backfill до подтверждения, что новые жертвы больше не создаются из active paths (✅ подтверждено grep-proof)
- Нельзя смешивать 14 access-дефектов и 39 content-дефектов в одну метрику
- Нельзя считать Матук полностью закрытой до fix published_at на training roots
- Нельзя считать Абрамович полностью закрытой до UI/runtime proof
- 0 victims на edge sweep ≠ path безопасен; это значит только: «на текущем active sweep не найдено активных жертв, но bypass в коде существовал и оставался риском» (теперь устранён для active paths)

### Нерешённые вопросы (обязательные follow-up)

1. **payments-reconcile legacy path** — требует отдельного discovery по совместимости legacy orders с grant-access-for-order
2. **39 content_not_published** — training roots с `published_at=NULL`, контентный дефект
3. **Backfill 14 real access defect** — план готов, требует исполнения после подтверждения, что новые жертвы не создаются
4. **Матук content visibility** — training roots `682d241e`, `62d09668` published_at = NULL
5. **Абрамович UI/runtime proof** — admin card, cabinet visibility, dates verification
6. **Cross-path dedup** — финальный дедуп по profile_id между admin_grant/admin_from_payment/admin_bulk

### Следующий шаг после этого патча

**Отдельный backfill/discovery sprint по historical victims** — выполняется ПОСЛЕ deploy и подтверждения, что новые жертвы больше не создаются из active paths (✅ подтверждено).

---

### Артефакты

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
18. `write_paths_root_fix_status.csv` ← ОБНОВЛЁН
19. `edge_write_bypass_inventory.csv` ← НОВЫЙ
20. `edge_canonical_migration_proof.csv` ← НОВЫЙ

---

### Финальный вывод

- Discovery — завершён
- UI root-fix — завершён
- Edge root-fix (active paths) — завершён
- Edge legacy path — не завершён (сохранён с audit warning)
- Historical backfill — не выполнен
- **Полное закрытие дефекта не достигнуто**

UI root causes fixed. Edge active paths fixed (payments-reconcile active, bepaid-auto-process). Manual AdminEntitlements remains non-canonical by design. Legacy path in payments-reconcile preserved with audit warnings — requires separate discovery. Full closure forbidden until legacy path discovery + backfill completed.
