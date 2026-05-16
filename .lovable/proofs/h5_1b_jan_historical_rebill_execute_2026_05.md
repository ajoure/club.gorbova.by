# H5.1b-Jan — Historical REBILL Deal Linkage Repair 2026 / January batch

**Snapshot:** 2026-05-16 / Минск 2026-05-17. **Stage 0–2 read-only. DML=0, migrations=0, edge calls=0, provider API=0, secrets unchanged. Stage 3 execute НЕ запускался.**

SQL: `/tmp/h51b_jan/stage02.sql` (inline §10). Frozen source: `.lovable/proofs/h5_1a_r2_expanded_frozen_candidate_cohort_2026_05_green.csv`, фильтр `payment_month='2026-01'` → 12 строк, Σ 1 581.00 BYN.

---

## Stage 0 — Mode & frozen re-check

### Mode proof from audit_logs
| action | актуальный `meta->>'mode'` | n | created_at |
|---|---|---|---|
| `bepaid.rebill.decision_audit` / `bepaid.rebill.dry_run` | **`dry_run`** | 3 (за 2 дня) | 2026-05-16 16:31 |

**🚨 КРИТИЧЕСКОЕ РАСХОЖДЕНИЕ:** Пользователь сообщал «mode=on», но runtime пишет в audit `mode='dry_run'`. Подтверждение: за последние 14 дней рантайм создал **всего 1 REBILL** (`2026-05-14`, repair). Это означает, что bepaid-webhook сейчас НЕ материализует REBILL автоматически. Mode-race risk при execute → **≈0**, но контрактное условие плана («mode=on перед execute») формально не выполнено. Решение пользователя требуется перед Stage 3.

### Frozen Jan recheck
- CSV → TEMP `h5_1b_jan_frozen` (session-scoped, не migration, не persistent), `COPY 12` строк.
- Sum amount = 1 581.00 BYN ✓
- Все 12 payment_id присутствуют в `payments_v2` (preflight подтвердил).

---

## Stage 1 — Schema-check + runtime канон REBILL

### `orders_v2` (для INSERT)
ключевые колонки: `id (uuid pk, default gen_random_uuid)`, `order_number (text, UNIQUE)`, `user_id, product_id, tariff_id, offer_id, pipeline_id, pipeline_stage_id, profile_id, currency (default BYN), status (order_status, default draft)`, `base_price NOT NULL`, `final_price NOT NULL`, `paid_amount`, `provider, provider_payment_id` (с UNIQUE-индексом `(provider, provider_payment_id) WHERE NOT NULL`), `deal_date timestamptz`, `created_at timestamptz NOT NULL default now()`, `bepaid_subscription_id text`, `meta jsonb`.

**Implication UNIQUE(provider, provider_payment_id):** наш INSERT REBILL должен либо НЕ дублировать `provider_payment_id` уже существующих orders, либо мы триггерим collision. Pre-flight `pp_collision_any` = false для всех 12. ✓

### `audit_logs` (фактическая схема)
`id, actor_user_id, action NOT NULL, target_user_id, meta jsonb, created_at, actor_type NOT NULL (default 'user', CHECK IN ('user','system')), actor_label`.

**Поля плана `actor='system'`, `actor_subtype`, `entity_type`, `entity_id` — не существуют как колонки.** Маппинг:
- `actor_type = 'system'`
- `actor_label = 'h5_1b_jan'` (subtype идёт сюда)
- `action = 'h5_historical_rebill_materialized'` / `'h5_1b_jan_batch_completed'`
- `meta` содержит `entity_type='orders_v2'`, `entity_id=<rebill_order_id>`, payment_id, parent_order_id, provider_payment_id, amount, paid_at, recurring_evidence_source.
- `target_user_id = payment.user_id`.

### `provider_subscriptions` (для checksum)
Колонки: `id, provider, provider_subscription_id, user_id, subscription_v2_id, profile_id, state, next_charge_at, last_charge_at, amount_cents, currency, interval_days, card_*, raw_data, created_at, updated_at, meta, order_id`. **`current_period_end` не существует.** Checksum строится по `(id || state || next_charge_at || updated_at)`.

### Runtime канон REBILL (по последним 50 REBILL-orders)
| метрика | значение |
|---|---|
| status | `paid` (49) / `refunded` (1, после возврата) |
| `meta->>'source'` | `rebill_materialization` (49) / `rebill_materialization_repair` (1) |
| `deal_date IS NOT NULL` | 50/50 |
| **`deal_date = created_at`** | **49/49 для paid (sec_diff=0)** |
| `bepaid_subscription_id IS NOT NULL` | **0/50** (runtime НЕ пишет sbs на REBILL) |
| meta keys (sample) | `source, parent_order_id, do_not_grant_access, payment_flow, deal_month, materialized_from_payment_id, materialization_run, source_payment_uid, linked_old_subscription_v2` |

**Применённые правки плана:**
- `created_at` ⇒ **`payment.paid_at`** (а не `now()`), чтобы совпадало с runtime каноном (`deal_date = created_at = paid_at`).
- `bepaid_subscription_id` ⇒ **NULL** (runtime тоже не пишет, evidence уходит в meta).
- `status` ⇒ **`'paid'`** (подтверждено на runtime).
- `meta.source` — **план оставляет `'h5_historical_repair'`** (отделяет H5-batch от runtime `rebill_materialization`); это позволяет идемпотентный rollback по `meta->>'run'='h5_1b_jan_2026'` и не пересекается с runtime audit.

---

## Stage 2 — Preflight per row

Проверки (по 12 frozen Jan):
- `current_payment_order_id = parent_order_id` ✓ (все 12)
- `parent.order_number NOT LIKE 'REBILL-%'` ✓ (все 12)
- already-materialized guard (4 ключа: order_number, mfpi, mfpu, provider_payment_id) — **0/12 совпадений**
- `provider_payment_id` collision (other orders) — **0/12**
- refund guard (refunded_amount, refund-row по 4 uid-каналам) — **clean 12/12**
- **sibling non-refund payment count > 0** — пересечение с правилом «parent не осиротеет»
- pipeline/stage/tariff/product NOT NULL — 12/12
- amount > 0, currency=BYN — 12/12
- expected_rebill_order_number = computed `'REBILL-' || first12(payment.id)` совпадает с CSV — 12/12

### Распределение preflight
| guard_status | n |
|---|---|
| `pass` | **8** |
| `fail:parent_has_no_other_payment` | **4** |

### 4 fail rows (исключены из execute)
| email | payment_id | parent_order | parent_status | sibling_nonrefund |
|---|---|---|---|---|
| ritka.4289@yandex.ru | b6a3920b-… | 0bb9ee3f-… (PAY-26-MNARLAF7) | paid | **0** |
| 6214525@mail.ru | 4db3d748-… | f87bce7c-… (PAY-26-MMUQGCEC) | paid | **0** |
| irkaguzarevich@mail.ru | 6bfead3b-… | 43c34b9a-… (PAY-26-MMUQOBC8) | paid | **0** |
| lana0407@tut.by | 019dd3e0-… | df2d8eda-… (PAY-26-MMUQDEPD) | paid | **0** |

**Причина:** у этих parent-orders ровно один non-refund payment (наш кандидат). Перенос в REBILL оставит parent без payments → orphan. Парадокс: split-signal сработал по разрыву месяцев (parent_month=2025-12/2026-03 vs payment_month=2026-01), но это означает, что parent либо изначально не имел собственного платежа, либо его собственный payment был оторван ранее. Эти 4 строки уходят в отдельный manual review (H5.2 candidate), **execute по ним не запускается**.

### 8 pass rows (final frozen execute table)
| email | payment_id | provider_payment_id | parent_order_id | expected_rebill | amount | paid_at | sibling_nonrefund |
|---|---|---|---|---|---|---|---|
| 1@ajoure.by | 1fbe2822-d02a-4023-a99a-caf076e7a12f | a2ee4adf-… | c98896b4-… | `REBILL-1fbe2822-d02` | 1.00 | 2026-01-16 17:06:53+00 | 1 |
| aliaunesco@gmail.com | 95fbdacd-3de7-43f4-a25e-fced2c480cff | 6c5f34f9-… | 6a2b3b58-… | `REBILL-95fbdacd-3de` | 1.00 | 2026-01-18 19:16:04+00 | 1 |
| alinka197@yandex.ru | d26d295b-44bf-42ce-bb50-dc1ae6a14a3b | 12ba0e0f-… | 7beaca33-… | `REBILL-d26d295b-44b` | 150.00 | 2026-01-19 11:58:54+00 | 1 |
| s12217801@gmail.com | 20489cc0-2975-4cf1-a445-2d7cbb7a7f32 | c62e62ab-… | 94c38b5a-… | `REBILL-20489cc0-297` | 1.00 | 2026-01-19 14:02:39+00 | 1 |
| vikushkamoon@mail.ru | fd7c514e-416d-4b18-80ac-5d175c8fe3c1 | ca4f1262-… | 8a41c5dc-… | `REBILL-fd7c514e-416` | 1.00 | 2026-01-20 20:48:37+00 | 1 |
| elena.platonova-fedyakova@yandex.ru | f49d3fb0-7190-482c-aa45-d044efbfd84a | d788b73c-… | 415f0a95-… | `REBILL-f49d3fb0-719` | 1.00 | 2026-01-21 13:18:33+00 | 1 |
| polyaq@tut.by | 4b48bbb4-a5c0-4dcd-8c00-5d5e44f5b902 | b2912cfd-… | dd6c6330-… | `REBILL-4b48bbb4-a5c` | 1.00 | 2026-01-22 11:21:12+00 | 1 |
| olesiko105@mail.ru | d984dc99-8dbe-4a62-b613-bde0227f7285 | e9009623-… | bb01036c-… | `REBILL-d984dc99-8db` | 45.00 | 2026-01-27 17:49:22+00 | 1 |

Σ amount (pass) = **200.00 BYN**. Все 8 parent имеют `status='refunded'` (sibling=1 non-refund + 1 refund + наш rebill — типичный H5 кейс: bePaid продолжил списывать после refund одного из платежей).

### Scoped baselines (12 R2 Jan users)

| Object | Метрика | Значение |
|---|---|---|
| `subscriptions_v2` scoped | rows | 49 |
| `subscriptions_v2` scoped | md5(id\|access_end_at\|status\|updated_at) | `78ee14d19039cbc37e3ad03f3375a436` |
| `subscriptions_v2` scoped | Σepoch(access_end_at) | 83 316 493 184 |
| `entitlements` scoped | rows | 44 |
| `entitlements` scoped | md5(id\|expires_at\|updated_at) | `33c62a5e28faa3e8bec276457b244f80` |
| `entitlements` scoped | Σepoch(expires_at) | 78 378 471 143 |
| `provider_subscriptions` scoped | rows | 25 |
| `provider_subscriptions` scoped | md5(id\|state\|next_charge_at\|updated_at) | `13e03c8887e9bdb350e52a2c7b89f908` |
| `telegram_access_queue` scoped (user_id ∈ 12 ∪ order_id ∈ 12 parents) | rows | 43 |
| `telegram_access_queue` scoped | md5(id\|status) | `25460796609f9d401105ceb3aa8a9682` |
| `payments_v2` scoped (12 frozen ids) | md5(id\|order_id\|amount\|provider_payment_id) | `65d13e057d851e09792be1f1dac55768` |
| `orders_v2` global REBILL-% | rows | 201 |
| `orders_v2` global REBILL-% | md5(ids) | `f4b7f8055f48b17ab34ba383128622d6` |

### Expected rowcounts (Stage 3, если будет approve)
```
expected_inserts_orders_v2     = 8
expected_updates_payments_v2   = 8   (UPDATE WHERE id=… AND order_id=frozen.parent_order_id)
expected_audit_rows            = 9   (8 per-payment + 1 summary)
skipped (parent_has_no_other_payment) = 4
do_not_grant_access flag       = true (на всех 8 REBILL.meta)
```

### Rollback preview
До execute: `SELECT COUNT(*) FROM orders_v2 WHERE meta->>'run'='h5_1b_jan_2026'` = **0**, `SELECT COUNT(*) FROM payments_v2 WHERE order_id IN (...)` = **0**.

После execute rollback DML (внутри одной транзакции):
1. `UPDATE payments_v2 SET order_id = <frozen.parent_order_id> WHERE id IN (<8 frozen ids>) AND order_id IN (SELECT id FROM orders_v2 WHERE meta->>'run'='h5_1b_jan_2026');` — ожидается 8.
2. `DELETE FROM orders_v2 WHERE meta->>'run'='h5_1b_jan_2026';` — ожидается 8.
3. `INSERT INTO audit_logs (actor_type='system', actor_label='h5_1b_jan', action='h5_1b_jan_rollback', meta={reverted_count:8, reason});` — 1.

**Pre-delete guard для rollback** (per plan correction #7) — перед DELETE проверить, что для каждого нашего REBILL-order:
- ровно 1 planned payment с `order_id=REBILL.id` (наш переехавший)
- нет entitlements с `meta->>'order_id'=REBILL.id`
- нет subscriptions_v2 с `order_id=REBILL.id` или `meta->'initial_order_id'/'checkout_order_id'=REBILL.id`
- нет refund-rows ссылающихся на наш payment.provider_payment_id
- нет telegram_access_queue с `meta->>'order_id'=REBILL.id`

Если все гарды чистые → rollback DELETE безопасен. Если нет → STOP rollback, manual review.

---

## Verdict

```
mode_actual                           = dry_run  (audit proof)
mode_expected_by_plan                 = on
mode_race_risk                        = ~0   (runtime пишет 0 REBILL за 14 дней)
frozen_jan_count                      = 12
preflight_pass                        = 8
preflight_fail_parent_no_other        = 4   (→ H5.2 manual review)
expected_inserts_orders_v2            = 8
expected_updates_payments_v2          = 8
expected_audit_rows                   = 9
sum_amount_execute                    = 200.00 BYN
applied_plan_corrections              = 1 (mode=audit proof), 2 (TEMP only), 3 (created_at=paid_at), 4 (audit_logs schema mapping), 5 (provider_subscriptions schema), 6 (taq scoped), 7 (rollback pre-delete guard)
ready_for_stage3_execute              = WAITING_APPROVE  (требуется решение пользователя по двум пунктам)
```

### Требуется решение пользователя перед Stage 3

1. **Mode mismatch:** runtime mode = `dry_run`, плановое условие = `on`. Варианты:
   - (A) Принять `dry_run` как валидный режим для H5.1b execute (rationale: runtime ничего не пишет = race-risk ≈ 0, наш контракт guard в транзакции всё равно защищает).
   - (B) Подождать переключения mode=on пользователем, повторить mode-check.
2. **4 fail rows (parent_has_no_other_payment):** подтвердить, что они переходят в H5.2 без действия в H5.1b-Jan.

После approve обоих пунктов — **отдельный** approve на Stage 3 DML.

---

## Stage 3 / 4 / 5 — НЕ выполнены

DML = 0. Транзакция не открывалась. Никакие orders/payments/audit/subscriptions/entitlements/telegram записи не созданы и не изменены.
