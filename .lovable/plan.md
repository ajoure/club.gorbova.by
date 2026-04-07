да, согласен, с учетом правок:

&nbsp;

1. PHASE 1 и PHASE 3 связать жёстким правилом исполнения.  
Точечные ремонты Матук / Абрамович / Ярошевич допустимы только как urgent-fix, но root-fix всех non-canonical write-paths не переносить “на потом”. В плане явно указать: после точечных ремонтов обязательно сразу выполняется системный fix всех найденных bypass-paths, иначе будут появляться новые битые кейсы.
2. Для Матук зафиксировать двойную проверку: access-bug vs content-bug.  
Сейчас уже доказан access-bug: manual path не создал entitlement. Но в плане нужно отдельно оставить обязательную проверку published_at у training root и итоговый verdict по двум осям:  

  - missing_entitlement
  - unpublished_training_root  
  Чтобы не закрыть кейс по entitlement, если потом продукт всё равно не виден из-за контента.
3. &nbsp;
4. По Матук в root-fix добавить не только handleGrantNewAccess, но и правило “manual path = same fulfillment as paid path”.  
Формулировка в плане должна быть жёсткой: любой manual/admin-created access после создания order/payment обязан завершаться тем же canonical flow, что и обычная оплаченная сделка. Не “создать subscription и потом что-то ещё”, а именно единый fulfillment.
5. По Ярошевич запретить лишнюю нормализацию meta без runtime-необходимости.  
В плане уже выявлено критично важное: union_scope сейчас работает корректно и даёт full access, а смена на full_tariff_scope безопасна только после code-fix в runtime resolver. Поэтому добавить правило:  

  - сначала code-fix full_tariff_scope branch,
  - потом before/after proof,
  - только потом менять meta.  
  И отдельно указать: если runtime уже full и meta меняется только ради чистоты, это secondary patch, не блокирующий закрытие access-кейса.
6. &nbsp;
7. По Ярошевич явно зафиксировать бизнес-правило приоритета объёма доступа.  
Если есть полная оплаченная покупка ЦБ1 и отдельный модуль, итоговый объём доступа всегда определяется по максимальному законному объёму, то есть по полной покупке. Модульная покупка не может понизить scope. Это должно быть записано в плане как общее правило, не только для этого кейса.
8. По Абрамович добавить обязательную проверку всех аналогичных кейсов того же тарифа / flow.  
Не ограничиваться одной подпиской d2710b58. После её восстановления план должен требовать sweep по аналогичному паттерну:  

  - subscription.status in (expired,canceled)
  - access_end_at > now()
  - entitlement active или оплаченное окно ещё живо  
  То есть это не только персональный fix, а подтверждение/поиск повторяемого дефекта статуса.
9. &nbsp;
10. В PHASE 0 добавить отдельную колонку runtime_visibility_depends_on_entitlement_only.  
Это критично для training-продуктов. Нужно в матрице write-paths явно отметить, для каких продуктов простой subscription недостаточен и нужен entitlement, иначе root cause manual-path будет трудно доказать по всем категориям продуктов.
11. В PHASE 2 добавить отдельную категорию backfill: subscription_exists_but_entitlement_missing.  
Это именно тот класс дефекта, который обнаружен по manual/admin-created flow. Он должен быть выделен как отдельный repair-type, а не теряться внутри общего rebuild_full_chain_from_order.
12. В PHASE 2 и PHASE 4 потребовать раздельную статистику по источнику дефекта.  
В финальном отчёте цифры нужны не только общие, но и по типам:  

  - обычный paid-flow
  - manual/admin-created flow
  - reconcile/import flow
  - content-not-published  
  Иначе будет непонятно, какой контур реально ломает систему.
13. &nbsp;
14. В DoD добавить обязательный regression-proof по каждому исправленному write-path.  
Не просто “код исправлен”, а для каждого path:  

  - создан тестовый order,
  - создан payment,
  - создан subscription,
  - создан entitlement,
  - продукт виден в admin,
  - продукт виден в cabinet/runtime, если должен быть виден.  
  Без этого root-fix нельзя считать завершённым.
15. &nbsp;
16. Добавить STOP-guard на массовый backfill без дедупликации.  
Перед любым массовым INSERT entitlement / subscription обязательно:  

  - duplicate check по profile_id + product_id
  - проверка существующих active/inactive entitlements
  - проверка, не был ли repair уже сделан ранее  
  Иначе можно насоздавать дублей в исторически грязных кейсах.
17. &nbsp;
18. Добавить ещё один обязательный артефакт:  
repair_actions_by_defect_type.csv  
Поля:  

  - defect_type
  - count_found
  - count_repaired
  - count_skipped
  - skip_reason  
  Это даст итоговую прозрачность по всей системе.
19. &nbsp;
20. По payments-reconcile и bepaid-auto-process потребовать отдельный dry-run с доказательством, что после refactor они не теряют текущие side-effects.  
Потому что там сейчас не просто bypass, а ещё и спецлогика. В плане явно указать: root-fix не должен сломать существующие payment/provider сценарии.
21. По AdminEntitlements.tsx усилить требование.  
Не просто warning/validation, а запрет на “голый” manual entitlement без обязательного указания основания:  

  - source order
  - source rule
  - explicit repair reason + audit trail  
  Иначе этот экран продолжит создавать неканонические состояния.
22. &nbsp;
23. Финальный статус формулировать так:  
проблема считается закрытой только если одновременно выполнено:  

  - точечные кейсы repaired,
  - глобальный sweep проведён,
  - все non-canonical write-paths либо исправлены, либо явно выведены из эксплуатации,
  - after-proof подтверждает отсутствие новых active admin-vs-cabinet mismatch по тем же сценариям.
24. &nbsp;

&nbsp;

&nbsp;

## План: SYSTEM-WIDE WRITE PATH DISCOVERY + Ремонт Матук/Ярошевич/Абрамович + Глобальные sweep-ы

---

### PHASE 0: SYSTEM-WIDE WRITE PATH DISCOVERY

**Цель:** Полная карта всех точек записи orders_v2 / payments_v2 / subscriptions_v2 / entitlements в системе, с классификацией canonical vs non-canonical.

**Предварительные результаты discovery (из кода):**


| #   | path_name                                     | entrypoint                                                        | creates_order                 | creates_payment   | creates_sub     | creates_entitlement                                     | calls grant-access                     | writes audit | canonical                                                     |
| --- | --------------------------------------------- | ----------------------------------------------------------------- | ----------------------------- | ----------------- | --------------- | ------------------------------------------------------- | -------------------------------------- | ------------ | ------------------------------------------------------------- |
| 1   | **bepaid-webhook**                            | `supabase/functions/bepaid-webhook/index.ts`                      | ✅ (update status)             | ✅                 | —               | —                                                       | ✅                                      | ✅            | ✅ CANONICAL                                                   |
| 2   | **admin-manual-charge**                       | `supabase/functions/admin-manual-charge/index.ts`                 | ✅                             | ✅                 | —               | —                                                       | ✅                                      | ✅            | ✅ CANONICAL                                                   |
| 3   | **bepaid-auto-process**                       | `supabase/functions/bepaid-auto-process/index.ts`                 | ✅                             | ✅                 | —               | ⚠️ bypasses (direct entitlement upsert by product_code) | ⚠️ partial (only if `is_subscription`) | ✅            | ⚠️ PARTIAL — direct entitlement write + product_code matching |
| 4   | **payments-reconcile**                        | `supabase/functions/payments-reconcile/index.ts`                  | —                             | ✅                 | ✅ direct INSERT | ✅ direct UPSERT                                         | ❌                                      | —            | ❌ NON-CANONICAL — bypasses grant-access entirely              |
| 5   | **admin-reconcile-processing**                | `supabase/functions/admin-reconcile-processing-payments/index.ts` | — (update status)             | —                 | —               | —                                                       | ✅                                      | —            | ✅ CANONICAL                                                   |
| 6   | **handleGrantNewAccess (ContactDetailSheet)** | `src/components/admin/ContactDetailSheet.tsx:1098`                | ✅                             | ✅                 | ✅ direct INSERT | ❌ **MISSING**                                           | ❌                                      | ✅            | ❌ NON-CANONICAL — **root cause Матук**                        |
| 7   | **CreateDealFromPaymentDialog**               | `src/components/admin/payments/CreateDealFromPaymentDialog.tsx`   | ✅                             | ✅                 | ✅ direct INSERT | ❌ **MISSING**                                           | ❌                                      | ✅            | ❌ NON-CANONICAL                                               |
| 8   | **BulkCreateDealsDialog**                     | `src/components/admin/payments/BulkCreateDealsDialog.tsx`         | ✅                             | —                 | ✅ direct INSERT | ❌ **MISSING**                                           | ❌                                      | ✅            | ❌ NON-CANONICAL                                               |
| 9   | **AdminEntitlements (manual)**                | `src/pages/admin/AdminEntitlements.tsx`                           | —                             | —                 | —               | ✅ direct INSERT                                         | ❌                                      | —            | ⚠️ PARTIAL — entitlement without source order/rule            |
| 10  | **GrantAccessFromDealDialog**                 | `src/components/admin/GrantAccessFromDealDialog.tsx`              | —                             | —                 | —               | —                                                       | ✅                                      | —            | ✅ CANONICAL (delegates to grant-access)                       |
| 11  | **BulkExtendAccessDialog**                    | `src/components/admin/BulkExtendAccessDialog.tsx`                 | —                             | —                 | —               | —                                                       | ✅                                      | —            | ✅ CANONICAL                                                   |
| 12  | **useBepaidMappings (link order)**            | `src/hooks/useBepaidMappings.tsx`                                 | —                             | —                 | —               | —                                                       | ✅                                      | —            | ✅ CANONICAL                                                   |
| 13  | **public-checkout**                           | `supabase/functions/public-checkout/index.ts`                     | ✅ (via createPaymentCheckout) | ✅                 | —               | —                                                       | ✅ (via bepaid-webhook callback)        | ✅            | ✅ CANONICAL                                                   |
| 14  | **sync-payments-with-statement**              | `supabase/functions/sync-payments-with-statement/index.ts`        | —                             | ✅ (INSERT/UPDATE) | —               | —                                                       | —                                      | —            | ⚠️ PARTIAL — payment records only, no fulfillment             |
| 15  | **admin-bepaid-full-reconcile**               | `supabase/functions/admin-bepaid-full-reconcile/index.ts`         | —                             | ✅                 | —               | —                                                       | —                                      | —            | ⚠️ PARTIAL — payment import only                              |
| 16  | **split-multi-module-orders**                 | `supabase/functions/split-multi-module-orders/index.ts`           | ✅ (child orders)              | —                 | —               | —                                                       | —                                      | ✅            | ⚠️ HISTORICAL PATCH                                           |


**Найдено 16 write-paths. 6 canonical, 4 non-canonical, 6 partial/special.**

**Критические non-canonical дефекты (создают subscription без entitlement):**

1. `ContactDetailSheet.tsx` — handleGrantNewAccess — **root cause кейса Матук**
2. `CreateDealFromPaymentDialog.tsx` — admin_from_payment
3. `BulkCreateDealsDialog.tsx` — admin_bulk_from_payments
4. `payments-reconcile/index.ts` — direct sub+entitlement write, bypasses grant-access

**Артефакт:** `fulfillment_write_paths_matrix.csv` — полная матрица со всеми полями.

---

### Действия по PHASE 0

1. **Discovery** (read-only): уже выполнен выше. Финальная матрица генерируется как CSV.
2. **Audit direct writes**: для каждого non-canonical path — SQL-запрос: сколько orders/subscriptions создано через этот path, у скольких отсутствует entitlement.
3. **Артефакты:**
  - `fulfillment_write_paths_matrix.csv`
  - `non_canonical_fulfillment_writes.csv` — все записи, созданные через non-canonical paths
  - `missing_grant_access_call_sites.csv` — конкретные call sites без grant-access-for-order

---

### PHASE 1: POINT REPAIRS (Матук / Ярошевич / Абрамович)

Без изменений от утверждённого плана:

**Блок 0: Матук** — INSERT missing entitlement, proof manual-path root cause.
**Блок 1: Ярошевич** — SOURCE ORDER SELECTION PROOF + META NORMALIZATION. Full purchase precedence.
**Блок 2: Абрамович** — subscription expired→active + canonical chain proof + WHY access persisted.

Матук зафиксирована как **доказанный симптом системного дефекта** (path #6 в матрице), а не изолированный пользовательский баг.

---

### PHASE 2: GLOBAL BACKFILL — ALL NON-CANONICAL PATH VICTIMS

**Порядок:** только после завершения PHASE 0 (полная матрица).

1. SQL-sweep: все orders с `meta->>'source' IN ('admin_grant', 'admin_from_payment', 'admin_bulk_from_payments')` → проверить наличие entitlement для того же profile_id + product_id.
2. Для каждого subscription без entitlement — классифицировать:
  - `create_missing_entitlement` — нужно создать entitlement
  - `create_missing_subscription` — нужно создать subscription
  - `rebuild_full_chain_from_order` — нет ни sub, ни entitlement
  - `restore_wrong_status` — subscription expired при active window
  - `repair_runtime_visibility_only` — entitlement есть, но sidebar не видит
  - `content_not_published_do_not_mask_as_access_bug` — training root unpublished
3. Проверка training-product linkage:
  - Для каждого product с training_modules: есть ли root? published_at?
  - Отдельный verdict: "access exists, root unpublished" — это контентный дефект, не access.
4. **Артефакты:**
  - `backfill_manual_path_missing_entitlements_plan.csv`
  - `access_tab_vs_cabinet_runtime_mismatch.csv`
  - `active_paid_window_but_no_access.csv`
  - `active_paid_window_but_no_access_repair_plan.csv`
  - `manual_created_access_runtime_mismatch.csv`
  - `manual_vs_normal_fulfillment_diff.csv`

---

### PHASE 3: SYSTEM ROOT-FIX — ALL NON-CANONICAL WRITE PATHS

**Правило:** ни один write-path не должен создавать "частичный доступ". Все пути обязаны проходить через canonical fulfillment (grant-access-for-order).

**Code fixes (все найденные entrypoints):**


| #   | File                                            | Fix                                                                                                |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `ContactDetailSheet.tsx` (handleGrantNewAccess) | После создания order+payment → вызвать `grant-access-for-order` вместо прямого INSERT subscription |
| 2   | `CreateDealFromPaymentDialog.tsx`               | После создания order → вызвать `grant-access-for-order` вместо прямого INSERT subscription         |
| 3   | `BulkCreateDealsDialog.tsx`                     | После создания order → вызвать `grant-access-for-order` вместо прямого INSERT subscription         |
| 4   | `payments-reconcile/index.ts`                   | Заменить прямые INSERT sub + UPSERT entitlement на вызов `grant-access-for-order`                  |
| 5   | `bepaid-auto-process/index.ts`                  | Убрать прямой entitlement upsert by product_code; полностью делегировать grant-access-for-order    |
| 6   | `AdminEntitlements.tsx`                         | Добавить предупреждение/валидацию при manual entitlement без source order                          |


**Архитектурное правило:** прямые INSERT/UPDATE в subscriptions_v2 или entitlements допустимы только в repair-патчах с audit trail, а не как рабочий сценарий.

**After-proof:** после root-fix создать тестовый admin-grant и убедиться, что canonical chain (order → payment → subscription → entitlement) создаётся полностью.

---

### PHASE 4: AFTER-PROOF

1. По каждому repaired user — before/after proof
2. По каждому fixed write-path — тест, что canonical chain создаётся
3. По training-products — проверка published_at отдельно от access

---

### Порядок исполнения (жёсткий)

1. **PHASE 0:** полный discovery всех write-paths → матрица
2. **PHASE 1:** точечные ремонты (Матук/Ярошевич/Абрамович)
3. **PHASE 2:** consolidated backfill по всем non-canonical victims
4. **PHASE 3:** system root-fix всех non-canonical paths в коде
5. **PHASE 4:** after-proof по пользователям и по путям

Нельзя перепрыгивать к частичному ремонту одного обработчика без закрытия системной причины.

---

### DoD

1. Матук: entitlement создан, кабинет показывает ЗАКРОЙ ГОД, before/after proof
2. Ярошевич: source order доказан, runtime full, meta нормализована
3. Абрамович: subscription active, каноническая цепочка согласована
4. 0 кейсов active access в карточке без runtime visibility без документированной причины
5. 0 кейсов paid window без access object
6. **После патча не должно остаться ни одного write-path, который может создать order/subscription без canonical entitlement fulfillment, если продукт требует кабинетный доступ**
7. Все 4 non-canonical write-paths исправлены в коде
8. Глобальный backfill всех жертв non-canonical paths выполнен

### STOP-guards

- Нельзя ограничиться фиксами только по Матук/Абрамович/Ярошевич, если discovery показал другие active write-paths с тем же дефектом (показал: 4 non-canonical)
- Нельзя делать массовый backfill до завершения матрицы всех путей создания доступа
- Нельзя считать проблему закрытой, пока не доказано, что новый manual/admin flow создаёт ту же цепочку, что и normal paid flow
- Нельзя закрывать Матук простым INSERT entitlement без proof, что корень — broken manual-path
- Нельзя закрывать sweep без списка всех активных mismatch-кейсов
- Нельзя восстанавливать доступ по старым истёкшим сделкам
- Нельзя закрывать Ярошевич без полной раскладки по модулям
- Нельзя закрывать Абрамович без восстановления канонической subscription-записи

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

### Финальные цифры отчёта

1. Сколько всего write-paths найдено (предв: **16**)
2. Сколько canonical (**6**)
3. Сколько non-canonical (**4**)
4. Сколько partial/special (**6**)
5. Сколько активных пользовательских кейсов сломано из-за non-canonical path
6. Сколько кейсов исправлено backfill'ом
7. Сколько путей исправлено системно в коде
8. Сколько mismatch paid-flow vs manual-flow
9. Сколько content-not-published (не access bug)

### Объём изменений

**Код:**

- `src/components/admin/ContactDetailSheet.tsx` — заменить прямой INSERT sub на grant-access-for-order
- `src/components/admin/payments/CreateDealFromPaymentDialog.tsx` — то же
- `src/components/admin/payments/BulkCreateDealsDialog.tsx` — то же
- `supabase/functions/payments-reconcile/index.ts` — заменить прямые writes на grant-access-for-order
- `supabase/functions/bepaid-auto-process/index.ts` — убрать direct entitlement bypass
- `src/pages/admin/AdminEntitlements.tsx` — валидация/предупреждение
- `src/hooks/useTrainingContentRules.ts` — full_tariff_scope branch (уже утверждён)

**Данные:**

- 1 INSERT entitlement (Матук)
- 1 UPDATE subscription (Абрамович)
- 1 UPDATE entitlement meta (Ярошевич)
- N INSERT entitlements по backfill (количество определится после sweep)
- Audit logs для каждого изменения