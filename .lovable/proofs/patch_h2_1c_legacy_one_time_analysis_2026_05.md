# PATCH H2.1c — Legacy one-time path analysis (read-only)

**Дата:** 2026-05-16 (Europe/Minsk)
**Тип:** read-only / code-discovery / data-discovery
**Production DML:** 0 · **Migrations:** 0 · **Secrets:** unchanged · **BEPAID_REBILL_MATERIALIZATION:** `dry_run` · **mode=on:** не включался
**Code changes:** 0 (`bepaid-webhook`, `grant-access-for-order`, `three_ds_writer` не трогались)

---

## 1. Scope (что разбирали)

В `supabase/functions/bepaid-webhook/index.ts`:

| Zone | Строки | Описание |
|------|--------|----------|
| Zone 1 | ≈5015–5269 | `[WEBHOOK-LEGACY]` PATCH P-LEGACY-BEPAID.1 — materialization-only (без `tracking_id`+`subscription_id`, match по card.stamp/email). **НЕ пишет access**, только `payments_v2` + amoCRM. |
| Zone 2 | ≈5274–6285 | Legacy flow (orders table) — содержит прямые access-writes (subscriptions_v2, entitlements, subscriptions v1) и прямые `telegram-grant-access` invokes. |

---

## 2. Что делает Zone 2 (полный профиль)

### Триггер
- В payload есть `tracking_id` (без префиксов `subv2:` / `link:` / `link:order:`) → `orderId = public.orders.id`; ИЛИ только `subscription_id` без tracking → fallback по `orders.meta->>bepaid_subscription_id`.
- Статус транзакции = `successful`.

### Order discovery
- `orders.select * .eq(id, orderId)` (≈5290)
- fallback: `orders.select * .eq(meta->>bepaid_subscription_id, subscriptionId)` (≈5301)
- orphan-create в legacy `orders` (≈4188–4246)

### Прямые access writes (нарушения каноники)

| Строка | Таблица | Операция | Поля |
|--------|---------|----------|------|
| ≈5546 | subscriptions_v2 | SELECT | id, access_end_at, status |
| ≈5561 | subscriptions_v2 | UPDATE | `access_end_at`, `is_trial`, `status`, `trial_end_at`, `payment_token`, `order_id` |
| ≈5576 | subscriptions_v2 | INSERT | `access_start_at`, `access_end_at`, `status`, **`auto_renew=true` (хардкод)**, `trial_end_at`, `next_charge_at`, `payment_token`, `meta.legacy_order_id` |
| ≈5696 | entitlements | UPSERT | `expires_at`, `onConflict: user_id,product_code` (legacy `product_code`-ключ) |
| ≈5721 | subscriptions (v1) | UPDATE | `tier`, `is_active`, `starts_at`, `expires_at` |
| ≈5614 | telegram-grant-access | INVOKE | products_v2 `telegram_club_id` |
| ≈5755 | telegram-grant-access | INVOKE (loop) | `access_rules.grant_target_type='club'` |

Нарушения каноники: **Canonical Write Path** (manual subscriptions_v2/entitlements inserts), **Telegram Auto-Grant Single Path** (direct telegram-grant-access вне writer'а), **ID First Contract** (entitlements `product_code`), **Product Type SOT** (хардкод `auto_renew=true` вместо resolveRenewability).

---

## 3. Discovery (read-only D1–D5)

Все запросы — через `supabase--read_query`, без записи.

### D1: legacy orders за 90 дней (zone 2 потенциальный трафик)

```sql
SELECT count(*) FILTER (WHERE status='paid') AS paid_90d,
       count(*) FILTER (WHERE status='pending') AS pending_90d,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM orders_v2 ov
              WHERE ov.id = orders.id OR ov.meta->>'legacy_order_id' = orders.id::text)) AS without_v2_pair
FROM public.orders WHERE created_at >= now() - interval '90 days';
```

| Метрика | Значение |
|---------|----------|
| total_orders_90d | **87** |
| **paid_90d** | **0** |
| pending_90d | 62 |
| failed_90d | 25 |
| without_v2_pair | 79 (все pending/failed) |

### D1.extended: исторический трафик

| Период | Всего orders | Paid |
|--------|-------------|------|
| 30d | 16 | 0 |
| 90d | 87 | **0** |
| 180d | 329 | 35 |
| Всё время (с 2025-12-29) | 329 | 35 |

`last_paid_at_ever = 2026-02-04` → последний живой платёж через legacy zone 2 был **~101 день назад**.

### D2: mapping confidence (paid orders, все 35)

| Метрика | Значение |
|---------|----------|
| with `product_v2_id` (explicit) | **35 / 35 (100%)** |
| without `product_v2_id` (v1-only) | 0 |
| with `tariff_code` | 35 / 35 |
| mapped_by_explicit_id | 35 |
| mapped_by_code | 0 |
| mapped_by_name | 0 |
| unmapped | 0 |
| ambiguous | 0 |

### D3: v1-only продукты среди paid legacy

```sql
... WHERE status='paid' AND meta->>'product_v2_id' IS NULL ...
```

Результат: **пустой набор**. Ни одного paid legacy order без `product_v2_id` за всю историю.

### D3.b: tariff_code → tariff_id collision check

| Метрика | Значение |
|---------|----------|
| Распределение `0 / 1 / many` matches | **все 1-к-1** |
| Ambiguous mappings | **0** |

### D4: live traffic в bepaid-webhook (30д, audit_logs)

| Action | Count | Last seen |
|--------|-------|-----------|
| `bepaid.webhook.link_order_processed` | 93 | 2026-05-16 |
| `bepaid.webhook.one_time_link_order_routed` | 38 | 2026-05-07 |
| `legacy_payment.materialized` (zone 1) | **0** | — |
| `legacy_payment.unmatched` (zone 1) | **0** | — |

Весь live one-time трафик идёт через canonical `link_order` ветку (которая уже отрефакторена H2.1b-ii). Zone 1 и Zone 2 — мёртвый код.

### D5: G8 false-recurring blocker-таблица

Для каждого из 35 paid legacy orders → найти связанную subscriptions_v2 (±7d) → сравнить `auto_renew` vs `tariff_offers.meta.recurring.is_recurring` (SOT).

| Сводно | Значение |
|--------|----------|
| total_legacy_paid | 35 (38 c учётом дубликатов в join window) |
| with_sub | 23 |
| auto_renew=true | 5 |
| auto_renew=false | 18 |

Полная таблица 5 auto_renew=true:

| legacy_order_id | tariff_code | tariff_name | sub_status | offer.is_recurring (SOT) | gap |
|-----------------|-------------|-------------|------------|--------------------------|-----|
| 5fe801d7… | monthly | Ежемесячный доступ | active | **true** | OK |
| b8cd7f37… | monthly | Ежемесячный доступ | active | **true** | OK |
| e73b55ff… | business | BUSINESS | expired | true | OK |
| ae01ab65… | business | BUSINESS | expired | true | OK |
| **6cc8b4b5…** | business | — (tariff_id missing) | expired | NULL | **FALSE_RECURRING** |

→ **1 исторический false-recurring** (status='expired', `tariff_id` отсутствует у подписки). Не блокирует, но **подтверждает риск G8** при любом будущем bridge — хардкод `auto_renew=true` в zone 2 действительно создавал артефакты. Будущая ретирация — без access write — этот класс закрывает по построению.

### Multi-club check (G6)

| Метрика | Значение |
|---------|----------|
| products with > 1 active `access_rules.grant_target_type='club'` | **0** |

→ G6 (`telegram_multi_target_writer_gap`) **в данных не существует** — приоритет понижен до «информационный, не блокирующий».

---

## 4. Gap-анализ (обновлённый после discovery)

| # | Gap | Статус после D1–D5 | Блокирующий |
|---|-----|--------------------|--------------|
| G1 | Legacy `orders` vs `orders_v2` (нет UUID-пары) | Подтверждено: 79/87 без пары (90д), 100% pending/failed | — (нет paid трафика) |
| G2 | `tariff_id` отсутствует (только `tariff_code`) | Collision-check чистый: все 35/35 → 1-к-1 | — (нет live трафика) |
| G3 | products_v1 без `product_v2_id` | **0 paid за всю историю** | — снято |
| G4 | `entitlements.product_code` legacy upsert | Существует только при будущих writes | — (если retire — снимается) |
| G5 | legacy v1 `subscriptions` (tier/is_active) | Long-term backlog, **не часть H2.1c** | — |
| G6 | Telegram multi-club | **0 продуктов в БД** | — снято в данных |
| G7 | orphan-order через legacy `orders.insert` | Только из мёртвой ветки | — (если retire — снимается) |
| **G8** | Хардкод `auto_renew=true` → false-recurring | **1 исторический FALSE_RECURRING подтверждён** | Critical risk для bridge-подхода |

---

## 5. Сравнение двух вариантов реализации (по amendment #3)

| Аспект | Вариант A (bridge + canonical writer) | Вариант B (writer принимает legacy_order_id) |
|--------|---------------------------------------|----------------------------------------------|
| Чистота writer'а | writer работает только с `orders_v2` UUID — канонично | writer превращается в universal legacy-migrator |
| Сложность | bridge инкапсулирован в webhook (только мёртвая ветка) | writer growth + новые тестовые матрицы |
| Покрытие тестами | writer-тесты неизменны | требует +N writer-тестов для legacy-shapes |
| DML | будущий — `orders_v2.insert` (требует отдельного approve) | то же + новые поля в writer-контракте |
| Регрессия G8 | контролируется на bridge-уровне через recurring snapshot | writer должен учитывать legacy-quirks |

**Рекомендация (если живой трафик существует):** Вариант A — webhook/bridge создаёт `orders_v2`-двойник, затем зовёт `grant-access-for-order(orderId)` как обычно.

**Фактический вывод (см. §7):** живого трафика нет → лучший вариант — **Recommendation A (retire)**, не строить bridge вовсе.

---

## 6. Proposed writer-extension contract (только если решат строить bridge)

Не реализовывать сейчас. Зафиксировано как опциональный артефакт.

```ts
// supabase/functions/grant-access-for-order/legacy_bridge.ts
export interface LegacyBridgeInput {
  legacy_order_id: string;        // public.orders.id
  tracking_id: string | null;
  transaction_uid: string;
  customer_anchors?: {
    email?: string | null;
    card_stamp?: string | null;
  };
}

export interface BridgeOutcome {
  status:
    | 'bridged_orders_v2_created'
    | 'bridged_orders_v2_found'
    | 'manual_review_no_product_v2'
    | 'manual_review_tariff_ambiguous'
    | 'manual_review_v1_only_product';
  orders_v2_id?: string;
  audit: Record<string, unknown>;
}

// resolveTariffByCode(product_v2_id, tariff_code): exactly 1 match, else manual_review
// resolveLegacyOrder(legacy_order_id): SELECT-only; create-orders_v2 — only with explicit allow_create=true,
// и только после отдельного DML-approve.
```

Контракт изолирован: writer-core (`three_ds_writer.ts`) не меняется; bridge — отдельный модуль, вызывается webhook'ом перед `grant-access-for-order`.

---

## 7. Go / No-Go вывод (по amendment #9)

Возможные выводы:

- **A. legacy path не используется → отключить / перевести в manual_review** ← **ВЫБРАН**
- B. legacy path используется и полностью маппится → строить H2.1c-i (bridge + delegate)
- C. legacy path используется, есть unmapped/ambiguous → mapping cleanup сначала
- D. critical (false-recurring/telegram gaps) → отдельный design

### Обоснование выбора A

1. **0 paid orders в legacy zone 2 за 90 дней** (последний 2026-02-04, ~101 день назад).
2. **0 legacy_payment.materialized в zone 1 за 30 дней.**
3. **131 live webhook за 30 дней** идёт исключительно через canonical `link_order` / `link_order_processed` ветки (уже под H2.1b-ii).
4. Любое расширение writer'а для bridge будет покрывать **0 live transactions** → ROI отрицательный, риск регрессии (G8) положительный.
5. Mapping confidence идеальный (35/35 explicit `product_v2_id`, 0 ambiguous tariff_code), но это уже **исторические orders, не нуждающиеся в новом fulfillment**.

### Предлагаемый next-step (H2.1c-i, переопределённый под Recommendation A)

Вместо writer extension + bridge — лёгкий retirement-patch:

1. Удалить direct access writes из Zone 2 (≈5546–5770 в `bepaid-webhook`).
2. Заменить на единый блок: `audit_log('bepaid.webhook.legacy_zone2_blocked', { legacy_order_id, tracking_id, transaction_uid })` + HTTP 200 `{ ok: true, mode: 'legacy_retired', needs_manual_review: true }`.
3. Telegram invokes — удалить (canonical path их не делает в legacy-shape).
4. Legacy v1 `subscriptions` UPDATE (≈5721) — оставить как есть (G5 — long-term backlog, decouple).
5. Live monitoring: если за 30 дней после patch появятся `legacy_zone2_blocked` events — escalate; пока — мёртвый код.

Live admin recovery (если редкий paid pre-2026-02 webhook докатится с retry):
- запись только в `audit_logs` + `provider_webhook_orphans` (без access);
- ручной `grant-access-for-order` через admin-инструмент по `orders_v2.id`.

Преимущества:
- 0 риска G8 (нет writes);
- writer не расширяется (нет новых багов);
- сложность patch'а минимальна, легко покрыть static-check'ом «0 direct access writes / 0 telegram invokes в zone 2».

---

## 8. Тесты для H2.1c-i (retirement variant)

`bepaid-webhook/legacy_zone2_retirement_test.ts`:

1. legacy zone 2 trigger (tracking без префикса, paid status) → возвращает 200 `{ mode: 'legacy_retired' }`, **НЕ пишет** subscriptions_v2/entitlements/telegram.
2. legacy zone 2 trigger без `product_v2_id` → тот же ответ + `reason: 'legacy_v1_only'` в audit.
3. legacy zone 1 (`!orderId && !subscriptionId && successful && uid`) → ответ как раньше (`mode: 'legacy_unmatched'` / `legacy_matched`), без access writes (уже не пишет).
4. Static check (regex по `bepaid-webhook/index.ts`, зона 5274–6285):
   - 0 `.from('subscriptions_v2')` insert/update
   - 0 `.from('entitlements')` insert/upsert/update
   - 0 `telegram-grant-access` invokes
   - SELECT-only допускаются.
5. Идемпотентность: повторный webhook с тем же `tracking_id` → стабильное audit event, без duplicates.

---

## 9. Закрытие artefacts

- ✅ Discovery D1–D5 завершён, данные собраны.
- ✅ G1–G8 проанализированы, приоритеты обновлены.
- ✅ Collision-check (tariff_code) — чистый.
- ✅ Mapping confidence — 100% explicit.
- ✅ G8 blocker-таблица построена, 1 исторический FALSE_RECURRING зафиксирован.
- ✅ Multi-club gap снят в данных.
- ✅ Сравнение Вариант A vs B приведено.
- ✅ Writer-extension contract задокументирован (опциональный).
- ✅ Go/No-Go вывод: **Recommendation A (retire)**.
- ✅ Тестовая матрица для retirement-patch составлена.
- ✅ Production DML = 0, migrations = 0, secrets unchanged, `BEPAID_REBILL_MATERIALIZATION=dry_run`, `mode=on` не включался.
- ✅ Рабчевская / data-repair не трогались.

## 10. Статус в плане

- H2.1c = **analysis_complete**
- H2.1c-i = **pending** (retirement-patch, не bridge)
- H2.1c-ii = **N/A** (не нужен при Recommendation A; снят с roadmap до появления live трафика в zone 2)
- H3 / H4 / PATCH G = unchanged

До закрытия H2.1c-i (retirement) `BEPAID_REBILL_MATERIALIZATION=on` остаётся запрещён.
