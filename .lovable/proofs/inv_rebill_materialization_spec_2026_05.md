# §A — REBILL Materialization Spec + Read-only Dry-run

**Дата:** 2026-05-14
**Скоуп:** spec и read-only dry-run для будущего code-patch §A. **0 DML, 0 миграций, 0 изменений edge functions.** Лариса не трогается.

---

## 0. Предусловия и память

- `Commercial Entity SOT`: `orders_v2` — единая SOT финансового события.
- `Canonical Write Path`: write-path доступа = только `grant-access-for-order`.
- `Canonical Telegram Grant Write-Path`: TG grant идёт строго один раз через `grant-access-for-order → telegram-grant-access`.
- `bePaid active_to Overshoot Guard`: `bepaid-webhook` уже не двигает `access_end_at` дальше SOT (`grant-access-for-order`) сверх 1.5×access_days.
- `Extend ↔ Tariff Match` + 3.1: при `tariffMatch && !sbsMatch` сейчас всё ещё создаётся новая sub-цепочка (см. proof 3.1 §9). Это §F, отдельным approve. §A исходит из того, что §F будет применён до production-включения kill-switch'а.

## 1. Подтверждённая фактура схемы

### 1.1. `orders_v2`
- Колонка `provider_payment_id text NULL` существует.
- Колонка `bepaid_subscription_id text NULL` существует.
- Колонки `pipeline_id`, `pipeline_stage_id`, `deal_date`, `meta jsonb` существуют.
- enum `order_status`: `draft, pending, paid, partial, failed, refunded, canceled, needs_mapping`.
  - `refunded` поддержан → REBILL `status='refunded'` валиден.
  - `partial` поддержан → частичный refund REBILL не нужен (используется на parent через `record_refund_atomic`, см. §4).

### 1.2. Индекс идемпотентности
```
CREATE UNIQUE INDEX idx_orders_v2_provider_payment_unique
ON public.orders_v2 USING btree (provider, provider_payment_id)
WHERE ((provider IS NOT NULL) AND (provider_payment_id IS NOT NULL));
```
- partial UNIQUE → admin manual rebill (`provider_payment_id=NULL`) не блокируется.
- bePaid uid коллизия → 23505 → переход в SELECT-ветку (см. §3).

### 1.3. `subscriptions_v2`
- НЕТ колонки `origin_order_id`. НЕТ колонки `bepaid_subscription_id` на верхнем уровне.
- `bepaid_subscription_id` хранится в `meta->>'bepaid_subscription_id'` (см. memory `Subscriptions V2 Schema Contract`).
- Дополнительная связь: `provider_subscriptions(provider='bepaid', provider_subscription_id, subscription_v2_id)`.
- `subscriptions_v2.order_id` — initial-order, через который subscription была создана.

### 1.4. RPC `record_refund_atomic`
Сигнатура:
```
record_refund_atomic(
  p_order_id uuid,
  p_parent_payment_id uuid,
  p_refund_amount numeric,
  p_refund_uid text,
  p_refund_reason text,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_bepaid_response jsonb
) RETURNS jsonb
```
- Идемпотентно по `(provider='bepaid', provider_payment_id=p_refund_uid, transaction_type='refund')` → no-op повтор.
- Считает `paid_sum` и `prior_refunded` по строкам `payments_v2` где `order_id=p_order_id`.
- Обновляет `payments_v2.refunded_amount` parent-row и `orders_v2.status` (`refunded` если full, `paid` если partial — без `partial` enum-значения!).
  - **Замечание:** RPC сейчас НЕ выставляет `partial`. Если в будущем нужен амбер-бейдж partial, нужен отдельный апдейт RPC. В §A это не блокер — REBILL full-refund устанавливается, partial остаётся как сейчас.
- Audit пишется как `actor_label='subscription-admin-actions[refund]'`. Для webhook-вызова это легаси-лейбл, но контракт не нарушен. Доп. webhook-audit пишется отдельной записью в `bepaid-webhook`.

### 1.5. Существующий REBILL-pattern
Из БД: `REBILL-7a64cd04-3d0`, `REBILL-420bec3d-21e`, `REBILL-5ad48899-0c5`.
Формат: `REBILL-<first8(hex provider_payment_id)>-<next3>` (8+3 без последующих сегментов).
**Решение:** в spec/code оставляем существующий формат `REBILL-<first8>-<next3>` (НЕ `first12`). Это backward-совместимо с `rebill_orders_materialization_2026` и Lori-repair.

### 1.6. `grant-access-for-order` — реальный контракт
- НЕТ параметра `source_payment_uid`.
- НЕТ guard'а `meta.do_not_grant_access` внутри функции.
- `extendFromCurrent` (default true), `customAccessStartAt`, `customAccessEndAt` — поддерживаются.
- `skip_already_fulfilled` (line 584): если по `order_id` уже есть entitlement+sub с правильными датами — no-op. Однако PATCH 12.2 (line 544) умеет ломать skip и идти в extend, если existing dates stale vs `expectedMinEndForSkipGuard`.
- INLINE-блок продления подписки в `bepaid-webhook` (lines ~2540–2670) дублирует часть extend-логики через `provider_subscriptions.update + subscriptions_v2.meta.merge`. Это легаси rebill-idempotency-fix.

### 1.7. Контракт `do_not_grant_access` — фактический
Поиск по `supabase/functions/grant-access-for-order/index.ts`:
```
$ grep -n 'do_not_grant_access' supabase/functions/grant-access-for-order/index.ts
(нет совпадений)
```
**Вывод:** `do_not_grant_access=true` в migration `rebill_orders_materialization_2026` работал не как in-function guard, а как **caller-level контракт** — миграция просто **не вызывала** `grant-access-for-order` для materialized REBILL. См. proof `rebill_orders_dryrun_2026.md` §"Что НЕ трогается": *«`grant-access-for-order` — НЕ вызываем (по правке пользователя, `do_not_grant_access=true` в meta).»*

### 1.8. Last-30d dry-run метрики (read-only)

| Метрика | Значение |
|---|---|
| recurring `payments_v2` (provider=bepaid, succeeded, есть `bepaid_subscription_id` у order) | 2 |
| из них rebill-кандидаты (rn>1 в parent order) | **1** |
| первый платёж parent (rn=1) | 1 |
| distinct parent orders с rebill | 1 |
| rebill с refund | 0 |
| rebill полный refund | 0 |
| distinct uids среди rebill | 1 |
| дубль uid среди кандидатов | 0 |
| unresolvable parent sub через `meta.bepaid_subscription_id` | 0 |
| уже материализованные REBILL за окно | 0 |

Распределение по `deal_month (Europe/Minsk)`: `2026-05 → 1`. Это единственный rebill — Лариса (исторический; уже исправлен §2 data-repair). За окно 30 дней нет других rebill, потому что предыдущая массовая материализация `rebill_orders_materialization_2026` уже накрыла январь–апрель.

**Вывод:** окно «30 дней» под текущий runtime-write-path даст ~1 rebill в неделю. Production rollout REBILL Materialization не угрожает массовой инвалидации; основной риск — корректность отдельных операций, а не throughput.

---

## 2. Архитектурное решение по контракту grant ↔ REBILL

В первоначальном плане предлагалось:
> «REBILL с `do_not_grant_access=true` → grant вызывается на parent_order».

Этот подход **отклонён** по результатам §1.6–§1.7:
- В `grant-access-for-order` нет ни `do_not_grant_access`, ни `source_payment_uid` → нельзя различить «первичный grant parent-order» и «rebill-grant parent-order».
- Повторный вызов на parent попадёт в `skip_already_fulfilled` → access не продлится; INLINE-блок в webhook уже компенсирует это, но это легаси-обход, а не контракт.
- Фраза «финансовый учёт = REBILL, доступ = parent» создаёт двойной источник истины для одной транзакции.

### 2.1. Принятая модель (для §A code-patch)

**REBILL-order = единый источник истины для финансового события + триггер extend подписки.**

```
recurring webhook (is_recurring=true && parent_uid != null)
   │
   ├─ idempotency check (provider='bepaid', provider_payment_id=uid)
   │    └── exists → SELECT, audit `rebill_skipped_already_materialized`, return 200
   │
   ├─ resolve parent_subscription_v2:
   │     1) provider_subscriptions(provider='bepaid', provider_subscription_id=sbs)
   │     2) subscriptions_v2 WHERE meta->>'bepaid_subscription_id'=sbs
   │     3) если 0 кандидатов → audit `rebill_unresolvable_parent_sub` + manual_review queue → 200
   │     4) если >1 кандидатов → audit `rebill_ambiguous_parent_sub` + manual_review → 200 (NO write)
   │
   ├─ resolve parent_order = parent_subscription_v2.order_id (initial-order)
   │     (НЕ user+product fallback)
   │
   ├─ INSERT orders_v2 REBILL-order:
   │     order_number = 'REBILL-<first8(uid)>-<next3>'   (существующий паттерн)
   │     user_id/profile_id/product_id/tariff_id ← copy из parent_order
   │     provider='bepaid', provider_payment_id=uid     (UNIQUE guard)
   │     bepaid_subscription_id=sbs
   │     status='paid'  (refund — отдельным webhook'ом, см. §4)
   │     paid_amount=amount, final_price=amount
   │     deal_date=paid_at
   │     pipeline_id/pipeline_stage_id ← copy из parent_order
   │     meta = {
   │       payment_flow:'bepaid_subscription_charge',
   │       source:'rebill_materialization_v2_runtime',
   │       parent_order_id, parent_subscription_v2_id,
   │       materialized_from_payment_uid:uid,
   │       materialization_run:'webhook_runtime',
   │       deal_month: YYYY-MM (Europe/Minsk),
   │       write_path_mode:'on'|'dry_run'
   │     }
   │
   ├─ INSERT payments_v2 → order_id = REBILL.id (не parent.id)
   │
   ├─ call grant-access-for-order(order_id = REBILL.id)
   │     — внутри grant: extend-by-sbs резолвит существующую subscription
   │       (tariff+sbs match), GREATEST по `access_end_at`, идемпотентно по REBILL.id.
   │     — INLINE-блок в webhook (lines ~2540–2670) удаляется в §A code-patch
   │       (зона риска — оставляется в legacy-режиме `off`/`dry_run`).
   │     — Telegram grant идёт ровно один раз через grant.
   │
   └─ audit `bepaid.webhook.rebill_order_materialized`
```

**Отказ от `do_not_grant_access`** делает контракт явным: REBILL — это новый order, проходящий полный canonical write-path. Никаких caller-level guard'ов.

### 2.2. Совместимость с историческим `rebill_orders_materialization_2026`

Старая массовая миграция создала ~200 REBILL-ордеров с `meta.do_not_grant_access=true` и НЕ вызвала grant. Это OK по двум причинам:
- subscriptions_v2 / entitlements уже были на правильных датах (миграция гарантировала pre==post checksum).
- Telegram уже синхронизирован для тех периодов.

В §A runtime-режиме `meta.do_not_grant_access` **не используется**, но и не противоречит legacy-метке — это просто отсутствующий flag в новых REBILL-ордерах. Старые 200 строк остаются валидной историей; новые runtime-REBILL отличает `meta.source='rebill_materialization_v2_runtime'`.

---

## 3. Идемпотентность

| Уровень | Механизм | Поведение при повторе |
|---|---|---|
| L1 | partial UNIQUE `idx_orders_v2_provider_payment_unique` | INSERT 23505 → SELECT existing → return existing.id |
| L2 | pre-INSERT lookup по `provider`, `provider_payment_id` | exists → audit `rebill_skipped_already_materialized` + skip |
| L3 | pre-INSERT lookup по `meta->>'materialized_from_payment_uid'` | дополнительная защита от race на partial unique |
| L4 | grant-access-for-order на REBILL.id | `skip_already_fulfilled` если повторный вызов |

**Race-сценарий:** одновременные webhook'и с одним uid →
- победитель INSERT'ит REBILL;
- проигравший получает 23505 → SELECT → `rebill_skipped_already_materialized` → 200;
- никаких 5xx.

**Конфликт-сценарий (point #11):** REBILL по тому же uid существует, но с другим `(user_id, product_id, amount, sbs)` →
- audit `rebill_uid_collision_conflict` + meta-merge на existing REBILL: `manual_review=true, manual_review_reason='rebill_uid_collision'`;
- skip + return 200 (НЕ 5xx, иначе bePaid начнёт ретраить и DDoS'ить);
- ops видит флаг в `manual_review` queue.

---

## 4. Refund сценарии (point #8)

### 4.1. Same-transaction refund (full-refund flow Ларисы)
Webhook content: один платёж + один сразу же refund по тому же sbs.
- bePaid обычно шлёт ДВА webhook'а: payment, затем refund (race возможен).
- Spec: НЕ предполагать «same notification».

### 4.2. Payment webhook
- Materializes REBILL `status='paid'`, `paid_amount=full`.
- `payments_v2` insert с `order_id=REBILL.id`, `refunded_amount=0`.

### 4.3. Refund webhook (отдельным сообщением)
- Resolve parent payment по `provider`, `provider_payment_id` (uid платежа, который вернули).
- `parent_payment.order_id` уже = REBILL.id (после §4.2).
- Вызов `record_refund_atomic(p_order_id=REBILL.id, p_parent_payment_id=parent.id, p_refund_amount, p_refund_uid, ...)`.
- RPC сама:
  - идемпотентна по `p_refund_uid` (см. §1.4);
  - обновит `parent.refunded_amount += amount`;
  - выставит `REBILL.status='refunded'` (full) или оставит `'paid'` (partial; без `'partial'` — см. §1.4);
  - запишет audit.
- **Никаких миграций, никаких новых колонок.** RPC уже принимает `order_id`.

### 4.4. Refund приходит ДО payment (edge-case)
- Resolve parent payment не находит uid → audit `refund_orphaned_no_parent_payment` + manual_review queue → 200.
- Когда payment-webhook прилетит — parent payment появится; ops перезапустит refund вручную через admin UI.

---

## 5. Resolver parent-subscription (point #6, явный)

```ts
async function resolveParentSubscription(sbs: string): Promise<{
  subscription_v2_id?: string;
  parent_order_id?: string;
  decision: 'resolved' | 'unresolvable' | 'ambiguous';
  reason?: string;
}> {
  // 1. provider_subscriptions
  const ps = await select from provider_subscriptions
    where provider='bepaid' and provider_subscription_id=sbs and subscription_v2_id is not null;

  // 2. subscriptions_v2.meta fallback
  const subs = await select from subscriptions_v2
    where meta->>'bepaid_subscription_id' = sbs;

  const candidates = unique([...ps.map(x=>x.subscription_v2_id), ...subs.map(x=>x.id)]);

  if (candidates.length === 0) return { decision:'unresolvable', reason:'no_sub_for_sbs' };
  if (candidates.length  >  1) return { decision:'ambiguous', reason:'multiple_subs_for_sbs' };

  const sub = await select from subscriptions_v2 where id=candidates[0];
  if (!sub.order_id)        return { decision:'unresolvable', reason:'sub_has_no_order_id' };

  return { decision:'resolved', subscription_v2_id: sub.id, parent_order_id: sub.order_id };
}
```
- НИКАКОГО user+product fallback на этапе materialization (это и есть корень дефекта Ларисы).
- `unresolvable`/`ambiguous` → audit + manual_review, `200 OK` без write.

---

## 6. Kill-switch `BEPAID_REBILL_MATERIALIZATION` (point #10, расширено)

Три режима:
- `off` (default до approve): старый write-path (платёж пишется в parent.id), как сейчас. INLINE-блок остаётся.
- `dry_run`: write-path как `off`, но дополнительно SELECT-резолв parent_sub и audit `rebill_dry_run_would_materialize` с расчётным REBILL meta. БД не меняется.
- `on`: новый write-path. INLINE-блок в webhook отключается (или становится no-op для этой ветки).

`meta.write_path_mode` пишется в каждый REBILL и в audit, чтобы post-mortem мог отделить runtime-REBILL от migration-REBILL (`rebill_materialization_v2_runtime` vs `rebill_orders_materialization_2026`).

---

## 7. Атомарность и компенсация (point #12)

Operations внутри §A:
1. SELECT existing REBILL by uid (read).
2. SELECT parent subscription / parent order (read).
3. INSERT orders_v2 REBILL.
4. INSERT payments_v2 (order_id=REBILL.id).
5. Call grant-access-for-order(REBILL.id).
6. INSERT audit_logs.

**Атомарность:**
- (3)+(4) → один RPC `materialize_rebill_atomic(p_uid, p_amount, p_paid_at, p_user_id, ...)` (создаётся в §A code-patch с миграцией; в §A spec — описывается, но **не пишется**).
- (5) и (6) — best-effort, как и в текущем legacy flow.

**Компенсация:**
- (3) ok, (4) fail → дельта: REBILL без payment. На следующий webhook L2-проверка увидит meta.materialized_from_payment_uid и попробует docomplete (5)+(4 retry). Чтобы избежать «висящих» REBILL без payment, RPC `materialize_rebill_atomic` делает 3+4 в одной транзакции.
- (5) fail → REBILL+payment созданы, доступ не продлён. Aud `rebill_grant_failed` + manual_review. Повторный webhook от bePaid (через 30 сек) повторно вызовет grant; idempotency по REBILL.id защитит.

---

## 8. Full-refund guard (point #13)

В будущем общий guard в `grant-access-for-order` (вне §A — это §F или отдельный §G):
- если `paid_amount <= refunded_amount` ИЛИ `meta.refunded_in_full=true` ИЛИ `status='refunded'` → no extend, no grant.

Сейчас (§A):
- REBILL создаётся `status='paid'` (refund приходит позже отдельным webhook'ом).
- На момент grant-вызова REBILL никогда не `refunded`.
- Если refund успел приехать до payment'а (edge §4.4) — payment-материализация всё равно создаст REBILL `status='paid'`, refund пометит `manual_review`. Безопасно.

---

## 9. No-loss mapping old vs new (point #16)

| Аспект | Old path (current) | New path (§A on) |
|---|---|---|
| Платёж rebill | INSERT payments_v2 с `order_id=parent_order.id` | INSERT с `order_id=REBILL.id` |
| Сделка в UI | parent_order содержит N платежей разных месяцев | parent + N REBILL-ордеров, по одному на месяц |
| `deal_date` | parent.deal_date (initial), но header UI показывал MAX(payment.paid_at) — fixed в 3.1 | parent.deal_date + REBILL.deal_date=paid_at |
| Refund attribution | refund летит в parent.linked_payments (linkage-дефект Ларисы) | refund летит в REBILL.id (чистый attribution) |
| Extend подписки | INLINE-блок в webhook + grant skip_already_fulfilled (легаси-обход) | grant-access-for-order(REBILL.id) — единый canonical path |
| Telegram grant | INLINE-блок webhook'а или grant — race-prone | grant-access-for-order(REBILL.id) → telegram-grant-access ровно один раз |
| Идемпотентность | provider_payment_id у parent остаётся initial; rebill uid не уникален на уровне orders_v2 | partial UNIQUE на REBILL.uid защищает от дублей |
| Audit traceability | `bepaid.webhook.rebill_grant_*` | `bepaid.webhook.rebill_order_materialized` + grant audits |

---

## 10. Inventory изменений (для §A code-patch — не в этой итерации)

### 10.1. Точные строки `bepaid-webhook/index.ts` (call-graph)
- L80–L95: парсинг полей, `is_recurring`, `parent_uid`.
- L1058: `webhookReferenceUid = transaction.parent_uid || body.parent_uid`.
- L1485–L1631: subscription-handling блок (kind='subscription'), формирует `subscriptionId`.
- L2354–L2364: первичный set `bepaid_subscription_id` в meta при INSERT `subscriptions_v2`.
- **L2540–L2670 (CRITICAL):** INLINE-блок rebill — это место для развилки по `BEPAID_REBILL_MATERIALIZATION`:
  - `off` → текущий код без изменений;
  - `dry_run` → текущий код + dry_run audit;
  - `on` → новый materialize-блок (см. §2.1) вместо INLINE.
- L2665–L2700: `provider_subscriptions.update + subscriptions_v2.meta.merge` — оставляется в `off`/`dry_run`, переносится внутрь grant в `on`.
- L2830+: «internal SOT for where access SHOULD reach» — read-only расчёт; не меняется в §A.

### 10.2. Файлы, которые БУДУТ изменены в §A code-patch
- `supabase/functions/bepaid-webhook/index.ts` — добавить kill-switch и новую ветку.
- `supabase/migrations/<ts>_rebill_materialize_atomic_rpc.sql` — новый RPC `materialize_rebill_atomic` (atomic INSERT REBILL+payment).
- (опционально) `supabase/functions/_shared/rebill-materialization.ts` — helper, чтобы не раздувать webhook.

### 10.3. Файлы, которые НЕ меняются
- `grant-access-for-order/index.ts` — никаких новых параметров (`do_not_grant_access`/`source_payment_uid` НЕ добавляются в §A).
- `subscriptions_v2`, `entitlements`, `access_rules`, `telegram_*` — без DML/schema changes.
- UI (`DealDetailSheet`) — отдельный §C.

---

## 11. STOP-условия (point #11, переписано)

| Триггер | Действие |
|---|---|
| INSERT REBILL fail (не 23505) | rollback атомарного RPC, audit `rebill_insert_failed`, return 200 (bePaid retry safe) |
| 23505 на (provider, provider_payment_id) | SELECT existing; если параметры совпадают → skip; если расходятся → `manual_review` |
| `subscriptions_v2.access_end_at` после grant < pre | audit `access_end_at_regressed` + alert; access не уменьшается за счёт GREATEST в access-resolver |
| `entitlements.expires_at` после grant < pre | то же, GREATEST guard |
| Resolver parent_sub `unresolvable`/`ambiguous` | manual_review без INSERT REBILL |
| REBILL без `parent_order_id` в meta | возможно только при ambiguous → блокируется в §5 |

---

## 12. DoD §A spec (этой итерации)

- [x] Файл `.lovable/proofs/inv_rebill_materialization_spec_2026_05.md` создан со всеми разделами.
- [x] Подтверждено: spec не требует DML/миграций/правок кода в этой итерации.
- [x] Подтверждён индекс `idx_orders_v2_provider_payment_unique` (DDL включён).
- [x] Подтверждён parent-order resolver (через `subscription.order_id`, не через user+product).
- [x] Подтверждён grant-contract: REBILL.id передаётся в grant как обычный order; **отказ от `do_not_grant_access`** зафиксирован как архитектурное решение, отвечающее на point #1.
- [x] Read-only dry-run встроен (last 30d: 1 rebill — Лариса; цифры в §1.8).
- [x] Edge-cases описаны: refund split webhook'ами (§4), refund-before-payment (§4.4), uid collision (§3), unresolvable/ambiguous (§5), race (§3).
- [x] Запреты соблюдены: 0 DML, 0 миграций, 0 правок кода/edge functions, Лариса не трогается.
- [x] §F (SBS-mismatch no-new-sub) явно вынесен в отдельный approve, помечен как блокер для production-включения.
- [x] Существующий REBILL-pattern зафиксирован (`REBILL-<8>-<3>`); первоначальный `first12` отклонён.
- [x] Kill-switch расширен на 3 режима (`off`/`dry_run`/`on`) — point #10.
- [x] STOP-условия переработаны: 23505 не 500, а skip + audit — point #11.
- [x] Атомарность через новый RPC `materialize_rebill_atomic` (создание — в §A code-patch) — point #12.

## 13. Следующие шаги

1. **Approve §A spec** (этот документ).
2. **§F (SBS-mismatch no-new-sub)** — отдельный dry-run и approve. Должен быть code-patch'нут до включения `BEPAID_REBILL_MATERIALIZATION=on` в production.
3. **§A code-patch** (отдельный approve):
   - миграция `materialize_rebill_atomic` RPC;
   - изменения в `bepaid-webhook/index.ts` (kill-switch + новая ветка);
   - регресс-тесты Deno (часть §D);
   - rollout: `off → dry_run` (1 неделя) → `on`.
4. **§C DealDetailSheet** (отдельный approve, UI nested refunds + Net).
5. **§B duplicate guard live-check** (отдельный approve).
6. **§E getEffectiveDealDate callsites audit** (отдельный approve).
7. **§D полный регресс-набор** после §A/§B/§C.

Production-включение `on` блокировано до:
- ✅ §F исправлен;
- ✅ §A code-patch + Deno-тесты зелёные;
- ✅ §C UI готов (иначе админ продолжит видеть «два платежа в одной сделке»);
- ✅ 1 неделя в `dry_run` без расхождений в audit.
