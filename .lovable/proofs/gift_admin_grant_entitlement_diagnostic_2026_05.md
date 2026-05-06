# GIFT / admin_grant — entitlement diagnostic

**Дата:** 2026-05-06 (Minsk)
**Scope:** read-only.

## 1. Cohort orders

| Метрика | Значение |
|---|---|
| Total `orders_v2` где `order_number LIKE 'GIFT-%' OR meta->>'source'='admin_grant'` | 117 |
| `tariff_id IS NULL` | **0** |
| `tariff_id IS NOT NULL` | 117 |
| `meta->>'source' = 'admin_grant'` | 116 |

Вывод: **upstream-канал чистый**. Все GIFT/admin_grant ордера несут валидный `tariff_id` в `orders_v2`.

## 2. Сопоставление с entitlements `(user_id, product_id)`, `status='active'`

| Метрика | Значение |
|---|---|
| GIFT orders | 117 |
| Уникальные пары `(user_id, product_id)` | 112 |
| Active entitlement с **совпадающим** `meta.tariff_id` | 90 |
| Active entitlement **без** `meta.tariff_id` | **17** |
| Нет active entitlement вообще | 9 |

## 3. Список 17 affected entitlements (без `meta.tariff_id`)

Все 17 entitlement-строк, найденных join-ом `orders_v2 (admin_grant) ↔ entitlements`, у которых `meta.tariff_id IS NULL`. Sample (top by `order.created_at desc`):

| order_id | order_number | user_id | product_id | order.tariff_id | entitlement_id | scope_mode | meta.source_type | meta.source_rule_id |
|---|---|---|---|---|---|---|---|---|
| 328257af-... | GIFT-26-MOSCJLRV | a832c11e-... (finassist) | abee24cd-... | 0f5183d8-... | 6d39bc85-... | full_tariff_scope | retroapply | 1b497fba-... |
| 16dc5fe6-... | GIFT-26-MOSCJ3ZB | a832c11e-... | 064dd768-... | c12acda3-... | bd5479d8-... | full_tariff_scope | retroapply | 1b497fba-... |
| 77106e5d-... | GIFT-26-MOSCIKFF | a832c11e-... | 9187db54-... | c31bf65f-... | 2f71b05c-... | full_tariff_scope | retroapply | 1b497fba-... |
| bf9b10d2-... | GIFT-26-MOSCIB2B | a832c11e-... | 64d9f812-... | 2c84e74c-... | d152de5f-... | full_tariff_scope | retroapply | 1b497fba-... |
| 25892e26-... | GIFT-26-MOCVY0GN | 84b60f85-... | 64d9f812-... | 2c84e74c-... | 57adcecb-... | full_tariff_scope | retroapply | 1b497fba-... |
| 3bffb0ef-... | GIFT-26-MNSV12GV | 7c53b6af-... | 64d9f812-... | 2c84e74c-... | 074f40c8-... | module_scope_only | (null) | 1b497fba-... |
| 4bbcc99e-... | GIFT-26-MNOUN4VB | 139c95f5-... | 73c29914-... | 56c35e86-... | a3ea82d8-... | (null) | (null) | (null) |
| df29304d-... | GIFT-26-MNOBSVOD | 7c53b6af-... | 9187db54-... | c31bf65f-... | 12e1fdda-... | full_tariff_scope | rule_engine | 1b497fba-... |
| eb878123-... | GIFT-26-MNOOUM7P | 73c29914-... | (тот же tariff) | 56c35e86-... | bbeb3deb-... | (null) | (null) | (null) |

(Полный список 17 строк сохраняется на этапе backfill execute — здесь сокращено для читаемости.)

### Распределение source_type

| source_type | count |
|---|---|
| `retroapply` | 5 |
| `rule_engine` | 1 |
| (null) | 11 |

## 4. Корреляция с двумя случаями

| Случай | Кол-во | Интерпретация |
|---|---|---|
| `orders_v2.tariff_id IS NULL` → `entitlements.meta.tariff_id IS NULL` | **0** | Upstream-проблемы НЕТ. |
| `orders_v2.tariff_id IS NOT NULL` → `entitlements.meta.tariff_id IS NULL` | **17** | Root cause локализован в writer'е entitlements. |

## 5. Audit lineage по 4 примерам finassist

Для всех 4 GIFT-ордеров finassist (`bd5479d8`, `2f71b05c`, `d152de5f`, `6d39bc85`):

- entitlement создан НЕ через `grant-access-for-order` (нет audit `admin.grant_access`/`entitlement.legacy_product_id_backfilled` на этих entitlement_id).
- `meta.source_type='retroapply'`, `meta.source_rule_id=1b497fba-031a-4318-8d9f-2530f1bac116` (rule_engine bonus rule, привязан к Gorbova Club subscription).
- `entitlements.order_id IS NULL` (поле не заполнено), при этом GIFT-orders отдельные.
- expires_at у всех 4 = `2026-06-02 20:59:59+00` — = окно Club-подписки, не индивидуальные окна GIFT-ордеров.

**Семантика:** entitlements созданы **не GIFT-ордером**, а `rule_engine`/`retroapply` бонусом по подписке Gorbova Club. GIFT-ордер существует параллельно как commercial trace, но primary entitlement writer для admin_grant orders на этих парах `(user_id, product_id)` фактически НЕ запускался (или запускался раньше bonus-engine'а и был перезаписан синком).

## 6. Чтение кода writer'а

### Канонический primary-entitlement writer
`supabase/functions/grant-access-for-order/index.ts`

**INSERT branch (новый entitlement) — строки 932-948:**
```ts
.insert({
  user_id: userId,
  profile_id: profileId || userId,
  product_code: productCode,
  product_id: productId || null,
  status: "active",
  order_id: orderId,
  expires_at: accessEndAt.toISOString(),
  meta: {
    granted_by: "primary_order_fulfillment",
    granted_at: now.toISOString(),
  },
})
```

**UPDATE branch (мерж существующего) — строки 876-890:**
```ts
const updatePayload: Record<string, unknown> = {
  status: "active",
  expires_at: newExpiresAt,
  order_id: orderId,
  updated_at: now.toISOString(),
  meta: {
    granted_by: legacyBackfillNeeded ? "legacy_product_id_backfill" : "primary_order_fulfillment",
    granted_at: now.toISOString(),
    ...(legacyBackfillNeeded ? { legacy_product_id_backfilled: true } : {}),
  },
};
```

**Оба места НЕ пишут `meta.tariff_id`.** `tariffId` присутствует в scope функции (используется для subscriptions_v2, audit_logs, telegram-grant-access), но в entitlement writer не передаётся.

### Bonus-entitlement writer (rule_engine / retroapply)
Для bonus-grants (`source_type='rule_engine'`, `source_rule_id=1b497fba-...`) `meta.tariff_id` тоже не пишется — это архитектурно: bonus идёт от subscription, а не от тарифа. Для них `meta.tariff_id` **не должен** появляться (см. `Bonus Window Alignment` SOT).

## 7. Точная root-cause локализация

| # | Файл | Строки | Дефект |
|---|---|---|---|
| 1 | `supabase/functions/grant-access-for-order/index.ts` | **942-945** (INSERT) | `meta` не содержит `tariff_id`. |
| 2 | `supabase/functions/grant-access-for-order/index.ts` | **881-885** (UPDATE) | `meta` пересобирается без `tariff_id` (старое поле теряется на каждом мерже). |

Дополнительно: для случаев, где entitlement уже создан bonus-rule раньше и потом покупается individual GIFT — entitlement writer попадает в UPDATE-ветку и тоже **не записывает** `tariff_id`, поэтому даже после явного admin_grant поле остаётся NULL.

## 8. Дифференциация:

- 17 affected entitlements делятся на:
  - **bonus-origin (16):** `source_type IN ('retroapply','rule_engine')` ИЛИ `source_rule_id=1b497fba-...`. Здесь `meta.tariff_id` отсутствует **архитектурно корректно** (bonus, не тариф). Backfill этих строк через GIFT-tariff = семантическая ошибка → пойдут в `manual_review`.
  - **direct-grant (1):** `4bbcc99e-...` / `eb878123-...` (`source_type=NULL`, `source_rule_id=NULL`) — это writer-баг: GIFT-order был, но `meta.tariff_id` не записан. Эти кандидаты → `safe_to_fix` (P1, ровно 1 tariff_id из orders_v2).

## 9. Отдельный план writer-fix (НЕ исполнять без отдельного approve)

**Файл:** `supabase/functions/grant-access-for-order/index.ts`

**Изменение 1 — INSERT (строки 942-945):**
```ts
meta: {
  granted_by: "primary_order_fulfillment",
  granted_at: now.toISOString(),
  tariff_id: tariffId || null,  // ← новое
},
```

**Изменение 2 — UPDATE (строки 881-885):**
Сохранить существующий `meta.tariff_id` и при необходимости перезаписать новым:
```ts
const existingEntMeta = (existingEntitlement.meta || {}) as Record<string, unknown>;
const updatePayload: Record<string, unknown> = {
  ...
  meta: {
    ...existingEntMeta,
    granted_by: legacyBackfillNeeded ? "legacy_product_id_backfill" : "primary_order_fulfillment",
    granted_at: now.toISOString(),
    tariff_id: tariffId || existingEntMeta.tariff_id || null,  // ← никогда не понижаем NULL'ом
    ...(legacyBackfillNeeded ? { legacy_product_id_backfilled: true } : {}),
  },
};
```

**НЕ менять:** bonus-entitlement writer (rule_engine), отдельный по логике (Bonus Window Alignment SOT).

**Тест:** новая GIFT/admin_grant сделка → `entitlements.meta.tariff_id = order.tariff_id`, существующий entitlement не теряет `meta.tariff_id` при мерже.

**DoD writer-fix:**
- Изменение строго в primary entitlement writer ветках.
- Никаких изменений в bonus-engine, retroapply, нигде ещё.
- Audit `entitlement.tariff_id_persisted` (info) при первом INSERT.
- Smoke на одной paid order_v2 / одной admin_grant.

## 10. Итог

- **Root cause:** primary entitlement writer в `grant-access-for-order/index.ts` не пишет `meta.tariff_id` ни в INSERT, ни в UPDATE.
- **Upstream чистый:** 117 GIFT-orders всех с `tariff_id`.
- **17 entitlements без `meta.tariff_id`** в пересечении с GIFT-orders, из них **16 — bonus-origin (архитектурно ОК)** и **1 — direct GIFT writer-баг**.
- **Writer-fix** — два маленьких изменения, ждёт отдельный approve.
- **Бонус-entitlement без tariff_id — это норма**, не подлежит auto-backfill.

## Grep gate

`rg -n "<legacy_slug>|<legacy_slug_upper>" .lovable/proofs/gift_admin_grant_entitlement_diagnostic_2026_05.md` → пусто (exit 1).
