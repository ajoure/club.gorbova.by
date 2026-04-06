## Отчет о выполнении: Ремонт кейсов Ярошевич и Абрамович

---

### Блок 1: YAROSHEVICH — SOURCE ORDER SELECTION PROOF + RUNTIME VERIFICATION

**Установленные факты:**

| Поле | Значение |
|---|---|
| profile_id | fc91c05e-40e8-4837-ae39-59943cd765fd |
| user_id | 5432fd69-c34b-44f7-a62d-6654fadf1956 |
| cb20 entitlement | 09641160-3e3f-4f53-a7e8-d525b61cd6f7 |
| source order | 327b7f05 = GC-3811003 (полный курс, тариф Бухгалтер) |
| модульный order | d06f7acd = GC-3818463 (Грузо- и пассажироперевозки, 550 BYN) |

**SOURCE ORDER SELECTION PROOF:** ✅
- `order_id` в entitlement = `327b7f05` = GC-3811003 = **полная покупка курса**. Корректный приоритетный source.

**RUNTIME SCOPE PROOF:** ✅
- `union_scope` → `accessMode = "full"` (useTrainingContentRules.ts, строка 330-331). Полный доступ ко всем 22 модулям.
- Все модули дерева ЦБ 1 (root `c9f7e9b8` + 21 child) привязаны к product_id `7101ed3c` и видны при scope=full.

**DRY-RUN DISCOVERY (meta fields):** ✅
- `historical_module_product_ids` читается в 3 файлах: `useTrainingContentRules.ts` (runtime), `access-resolver.ts` и `grant-access-for-order/index.ts` (write-only при создании).
- При `union_scope` → `full`, массив `historical_module_product_ids` **не используется** runtime-резолвером (строка 330-331 перескакивает на `accessMode = "full"`).

**КРИТИЧЕСКАЯ НАХОДКА:** `full_tariff_scope` НЕ БЫЛ обработан в if/else chain (строки 326-332). Если бы мы сменили union_scope → full_tariff_scope без патча кода, доступ бы **упал** до partial.

**ИСПРАВЛЕНИЕ КОДА:** Добавлен `full_tariff_scope` и `full_access` в тот же branch, что `union_scope` (accessMode = "full"). Файл: `useTrainingContentRules.ts`, строка 330.

**META NORMALIZATION:** ✅ (after code fix)
- `scope_resolution_mode`: `union_scope` → `full_tariff_scope`
- `historical_purchase_type`: `base_tariff_plus_standalone` → `base_tariff_purchase`
- `historical_module_product_ids`: оставлен как аудитная история
- `primary_source_note`: добавлен
- `previous_scope_resolution_mode` и `previous_historical_purchase_type`: зафиксированы

**НЕ ИЗМЕНЕНО:** order_id, source_rule_id, expires_at, status.

**DEAL → ACCESS OBJECT MAPPING:**

| order | тип | expected access | current access | verdict |
|---|---|---|---|---|
| GC-3811003 | full_course | entitlement cb20 full | entitlement 09641160 full_tariff_scope | ✅ CORRECT |
| GC-3818463 | standalone_module | covered by full course | covered by 09641160 | ✅ OK |

---

### Блок 2: ABRAMOVICH — SUBSCRIPTION STATUS RESTORATION

**STOP-guard check (дубль):** ✅ Нет второй активной подписки того же тарифа — запрос вернул 0 строк.

**Ремонт:** ✅
- `d2710b58` status: `expired` → `active`
- Verified: `access_end_at = 2026-04-20` (в будущем), repair applied.
- Audit log записан с batch_id `REPAIR-CLUB-STATUS-2026-04-06`.

**WHY ACCESS PERSISTED:**
Entitlement `1c375d53` (product=club, status=active, expires=2026-04-20) обеспечивал доступ через путь entitlement, независимо от статуса подписки. Подписка `d2710b58` использовалась как SoT для клуба, но entitlement маскировал дефект.

**CANONICAL CHAIN AFTER REPAIR:**

| Слой | ID | Статус | Дата |
|---|---|---|---|
| Order | b368fe0e | paid | 2026-02-19 |
| Subscription | d2710b58 | **active** ✅ | 2026-04-20 |
| Entitlement | 1c375d53 | active | 2026-04-20 |

---

### Блок 3: Глобальный аудит модульных покупок cb20

**Результаты:**
- 284 orders base_tariff_purchase / 179 users
- 105 orders module_only_standalone / 70 users
- 55 orders module_child_purchase / 40 users

**Пользователи с full_purchase + standalone module, active entitlement:**
- Большинство: `union_scope` или `full_tariff_scope` → runtime full ✅
- **1 RUNTIME DOWNGRADE:** profile `378b1166-d5c3-4812-b28c-d4c19d0929f2` — `scope_resolution_mode = module_scope_only` при наличии полной покупки. **ТРЕБУЕТ ОТДЕЛЬНОГО РЕМОНТА.**

**Итоговые флаги:**
- `full_purchase_has_priority = true` для всех, кроме 1 кейса ✅
- `runtime_matches_max_purchased_scope = false` для 1 кейса (378b1166) ❌

---

### Изменения в коде

1 файл изменён:
- `src/hooks/useTrainingContentRules.ts` строка 330: добавлены `full_tariff_scope` и `full_access` в branch `accessMode = "full"`.

### Изменения в данных

- 1 UPDATE subscriptions_v2 (Абрамович: expired → active) ✅
- 1 UPDATE entitlements meta (Ярошевич: scope/purchase_type нормализация) ✅
- 2 INSERT audit_logs ✅

### Артефакты

1. `yaroshevich_cb20_purchase_precedence_trace.csv` ✅
2. `yaroshevich_runtime_visibility_trace.csv` ✅
3. `yaroshevich_module_reconciliation.csv` ✅
4. `yaroshevich_deal_to_access_mapping.csv` ✅
5. `abramovich_payment_to_access_trace.csv` ✅
6. `cb20_module_purchases_global_audit.csv` ✅

### DoD

| # | Критерий | Статус |
|---|---|---|
| 1 | Ярошевич: полная покупка ЦБ 1 доказана (GC-3811003, Бухгалтер) | ✅ |
| 2 | Ярошевич: source order = GC-3811003 (полный курс) — приоритетный | ✅ |
| 3 | Ярошевич: runtime-доступ = full | ✅ |
| 4 | Ярошевич: meta нормализована (full_tariff_scope, base_tariff_purchase) | ✅ |
| 5 | Ярошевич: каждая сделка классифицирована | ✅ |
| 6 | Ярошевич: runtime соответствует максимальному купленному объёму | ✅ |
| 7 | Абрамович: subscription active, каноническая цепочка согласована | ✅ |
| 8 | Глобальный аудит: 1 user с runtime downgrade найден (378b1166) | ⚠️ требует отдельного ремонта |

### Нерешённые вопросы

1. **Profile 378b1166** — `module_scope_only` при наличии полной покупки cb20. Требуется отдельный ремонт meta (аналогично Ярошевич). Вынесен как отдельный кейс.
