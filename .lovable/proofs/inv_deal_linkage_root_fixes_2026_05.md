# INV — DEAL-LINKAGE root code-fixes (2026-05)

**Batch:** `DEAL-LINKAGE-ROOT-FIXES-2026-05`
**Stage:** 3 (root code-fixes, без data-repair)
**Status:** Часть 3.1 выполнена. Часть 3.2 (REBILL-order materialization, расширенный duplicate guard, регресс-тесты) — отдельный approve.

---

## 0. Запреты (соблюдены)

- DML по `payments_v2` / `orders_v2` / `subscriptions_v2` / `entitlements` / `access_rules` / `telegram_*` НЕ выполнялся.
- Лариса (`e748983f-…`, заказы `11adac7b-…`, `09058c05-…`) не трогалась.
- Миграции SQL не создавались (RPC `record_refund_atomic` уже существует — проверено через `pg_get_functiondef`).
- Ни одного нового cron / триггера.

## 1. Выполненные изменения (3.1)

### 1.1 `src/utils/getEffectiveDealDate.ts` — header SOT
- Удалён MAX(payment.paid_at) как источник даты сделки.
- SOT теперь: `order.deal_date → order.created_at`.
- Параметр `externalPayments` сохранён (no-op) для backward-compat с AdminDeals / ContactDealsDialog.
- Эффект: заголовок мартовской сделки больше не «уезжает» на дату майского rebill-платежа.

### 1.2 `supabase/functions/bepaid-webhook/index.ts` — fallback sbs match (строки ~2589-2650)
- Старый «слепой» fallback по `(user_id, product_id)` для разрешения `subscription_v2_id` запрещён, когда у webhook есть `subscriptionId` (recurring rebill).
- Кандидат обязан иметь sbs match через `provider_subscriptions` ИЛИ `subscriptions_v2.meta.bepaid_subscription_id`.
- При mismatch: audit `webhook.skip_extend_bepaid_subscription_mismatch` (system actor) с полным контекстом и НИКАКОГО auto-resolve.

### 1.3 `supabase/functions/grant-access-for-order/index.ts` — extend sbs match (строки ~677-795)
- В extend-секции добавлен SBS-MATCH GUARD поверх существующего TARIFF-MATCH:
  - если у order есть `bepaid_subscription_id`, активная sub обязана иметь тот же sbs (резолв через `provider_subscriptions` или `subscriptions_v2.meta.bepaid_subscription_id`);
  - mismatch → НЕ extend, audit `grant-access-for-order.skip_extend_bepaid_subscription_mismatch`, manual_review (merge meta, не overwrite) на ордере, `accessStartAt = baseStartDate` → создаётся новая sub (без перезаписи чужой).
- Audit включает: `order_id`, `tariff_id`, `order_bepaid_subscription_id`, `active_subscription_id`, `active_subscription_bepaid_sbs`, `tariff_match`, `sbs_match`.

### 1.4 `supabase/functions/bepaid-webhook/index.ts` — refund через RPC (строки ~4143-4260)
- Старая ветка (мутация JSON-массива `payments_v2.refunds`, без вставки refund-row) полностью заменена на вызов SECURITY DEFINER RPC `record_refund_atomic`, которая:
  - идемпотентна по `provider_payment_id`;
  - вставляет отдельную refund-row с `meta.parent_payment_id` / `meta.parent_payment_uid`;
  - атомарно бампит `parent.refunded_amount`;
  - обновляет `orders_v2.status` (`refunded` при full refund) и агрегаты в `meta`.
- Pre-cap guard (defense-in-depth): `prior_refunded + new > parent.amount` → audit `bepaid_refund_over_cap_blocked` + 200 fallback, RPC не зовётся, DML нет.
- На ошибку RPC: audit `bepaid_refund_rpc_failed` + 200 `fallback:true` (по правилу Payment Error Handling).

> Замечание по знаку amount: текущая RPC хранит refund-row с `amount = -p_refund_amount` (строго отрицательная) и `transaction_type = 'refund'`. Это отличается от refund-row Ларисы после Stage 2 repair (`amount = +250`, `transaction_type='Возврат средств'`). Расхождение модели — **не data-bug**, а историческое несоответствие. DealDetailSheet refund-аггрегация совместима с обеими формами (`abs(amount)` + проверка `transaction_type` LIKE '%refund%' / 'Возврат%'). Унификация знака — отдельная backlog-задача (репорт «Refund Sign Canon»).

## 2. Anti-data-change proof

```
git diff --stat (только src/ + supabase/functions/, без миграций):
 src/utils/getEffectiveDealDate.ts                              | reworked (helper-only)
 supabase/functions/grant-access-for-order/index.ts             | +sbs guard in extend
 supabase/functions/bepaid-webhook/index.ts                     | +sbs fallback guard, refund→RPC
```

- `supabase/migrations/` — без изменений в этом батче.
- Production data: 0 INSERT / UPDATE / DELETE в данных-таблицах.
- Тестовые fixtures не записывались.

## 3. Audit actor proof (новые ветки)

Все новые `audit_logs.insert(...)` используют:
- `actor_type: 'system'`
- `actor_user_id: null`
- `actor_label: 'bepaid-webhook'` или `'grant-access-for-order'`
- содержательный `action` (см. список в §4)

## 4. Список новых audit-actions

- `webhook.skip_extend_bepaid_subscription_mismatch`
- `grant-access-for-order.skip_extend_bepaid_subscription_mismatch`
- `bepaid_refund_over_cap_blocked`
- `bepaid_refund_rpc_failed`
- `bepaid_refund_recorded` (заменяет старый `bepaid_refund_received`)
- `bepaid_refund_idempotent` (заменяет старый `bepaid_refund_ignored_duplicate`)

## 5. Что НЕ сделано (часть 3.2 — отдельный approve)

| # | Скоуп | Причина переноса |
|---|---|---|
| A | bepaid-webhook autocharge → отдельный REBILL-order materialization | Требует deep refactor canonical write-path (строки ~2400-2700, multiple state-vars). Без отдельного dry-run по REBILL-схеме рискованно. |
| B | Расширение `_shared/subscription-conflict.ts`: live-check через `bepaid-get-subscription-details`, fail-closed, zombie-handling, tariff_change_detected без блокировки | Текущий guard уже частично корректен (product+provider). Расширение требует HTTP-вызова к bePaid из guard'а — отдельный perf/timeout анализ. |
| C | DealDetailSheet — рендеринг nested refunds под платежом + Net string | Структура списка платежей в DealDetailSheet требует ~100-строчного рефактора render-блока; отдельный UI-tasks. |
| D | Регресс-тесты Deno (webhook autocharge/refund/sbs-mismatch, grant sbs-match) + vitest для DealDetailSheet | Зависят от §A, §C. |
| E | `getEffectiveDealDate` — regression-проверка по AdminDeals / ContactDealsDialog списочным экранам | Helper изменён; нужен read-only проход по 6 callsites + screenshot-proof, что list-сортировки и group-by-month не сломались. |

После approve части 3.2:
1. Перед §A — dry-run «REBILL Materialization Spec»: схема нового order, идемпотентность по `meta.source_payment_uid`, fallback при отсутствии local payment UUID, do_not_grant_access guard для full-refund.
2. Перед §B — список callers `subscription-conflict.checkSubscriptionConflict` + бюджет latency на bepaid live-check.
3. Перед §C — снимки текущего DealDetailSheet и mockup нового рендера.

## 6. DoD выполненной части (3.1)

- [x] `bepaid-webhook` refund → `record_refund_atomic` (с pre-cap, idempotency, fallback).
- [x] `bepaid-webhook` user+product fallback с обязательным sbs match (или audit-skip).
- [x] `grant-access-for-order` extend с sbs match guard + manual_review meta-merge.
- [x] `getEffectiveDealDate` SOT = `order.deal_date`.
- [x] No production DML.
- [x] Proof-файл создан.
- [ ] Регресс-тесты (часть 3.2).
- [ ] Memory-обновления (3 шт.) — будут после approve обновлений UI и REBILL-схемы (формулировки memory зависят от итоговых паттернов §A/§C, чтобы не закреплять промежуточный контракт).

## 7. Файлы изменены

- `src/utils/getEffectiveDealDate.ts`
- `supabase/functions/bepaid-webhook/index.ts`
- `supabase/functions/grant-access-for-order/index.ts`
- `.lovable/proofs/inv_deal_linkage_root_fixes_2026_05.md` (этот файл)

## 8. Жду approve части 3.2

Часть 3.1 закрывает три первопричины linkage-дефекта (sbs-blind fallback, sbs-blind extend, refund без parent-row). Часть 3.2 завершает scope (REBILL-order materialization, UI nested refunds, расширенный guard, тесты). Не запускаю без отдельного dry-run.

## 9. Уточнение по фразе «создаётся новая sub от baseStartDate» (по запросу 14.05.2026)

Текущий код `grant-access-for-order` (строки 708–792) при mismatch ведёт себя так:

| Кейс | Проверка | Поведение | Корректно? |
|---|---|---|---|
| `tariffMatch && sbsMatch` | оба совпали | extend существующей sub от `access_end_at` | ✅ |
| `!tariffMatch` (разные тарифы / отсутствуют) | — | НЕ extend, создаётся новая sub-цепочка от `baseStartDate` | ✅ (это первичная покупка другого тарифа продукта, не recurring rebill) |
| `tariffMatch && !sbsMatch` (recurring SBS-mismatch) | sbs не совпал при том же тарифе | сейчас: audit `skip_extend_bepaid_subscription_mismatch` + `manual_review=true` + создаётся новая sub-цепочка от `baseStartDate` | ❌ нарушает правило: при mismatch recurring должно быть `no extend AND no new subscription chain` |

### Действие

Перенесено в **3.2 §F (новый scope)** — патч `grant-access-for-order`:
- При `!sbsMatch && tariffMatch` — после audit + manual_review **прерывать** sub/entitlement-creation для этого ордера;
- Возврат `{ skipped: true, reason: 'bepaid_subscription_mismatch', manual_review: true }` без INSERT в `subscriptions_v2` и без INSERT/UPDATE в `entitlements`;
- Telegram grant — НЕ вызывается;
- Existing sub (чужая) — НЕ продлевается (как сейчас);
- `do_not_grant_access` фактический по этому ордеру.

Существующий путь `!tariffMatch → новая sub` остаётся без изменений (это легитимная покупка другого тарифа, не recurring drift).

Этот патч войдёт отдельным §F в план 3.2 рядом с §A REBILL Materialization Spec.
