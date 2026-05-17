# H5-final verification — status board (read-only)

**Snapshot UTC:** 2026-05-17 ~13:36 UTC
**Режим:** read-only. БД не менялась.
**Run id:** `h5_final_bulk_remaining_2026_05`

## 1. Stage 1 — Verify H5 report against DB

### 1.1 orders_v2 (run = h5_final_bulk_remaining_2026_05)

| check | expected | actual | OK |
| --- | --- | --- |:---:|
| total REBILL orders с run-маркером | 70 | 70 | ✅ |
| order_number LIKE 'REBILL-%' | 70 | 70 | ✅ |
| meta.do_not_grant_access=true | 70 | 70 | ✅ |
| meta.parent_order_id IS NOT NULL | 70 | 70 | ✅ |
| meta.source | `rebill_materialization` | `rebill_materialization` (70/70) | ✅ |

> ⚠️ Naming note: план говорил `meta.source='h5_historical_repair'`, фактически и в proof, и в БД — `rebill_materialization`. Это match с executed proof, **не** расхождение поведения. План фиксировал терминологию иначе.

### 1.2 payments_v2 repointing

| check | expected | actual | OK |
| --- | --- | --- |:---:|
| payments с `meta.rebill_materialization.run` = run | 70 | 70 | ✅ |
| payment.order_id = new REBILL.id | 70 | 70 | ✅ |
| payment.order_id всё ещё на parent | 0 | 0 | ✅ |
| REBILL orders с count(payments) ≠ 1 | 0 | 0 | ✅ |

### 1.3 Parent orders (≥1 succeeded payment, критичные поля не тронуты)

| check | expected | actual | OK |
| --- | --- | --- |:---:|
| distinct parents | 70 | 70 | ✅ |
| parents с 0 succeeded payments | 0 | 0 | ✅ |
| parents с ≥1 succeeded payment | 70 | 70 | ✅ |
| parents без payments вообще | 0 | 0 | ✅ |
| DML по orders_v2 (parent UPDATE) | none | none (по DML-скрипту run) | ✅ |
| audit_logs про изменение parent fields | 0 | 0 | ✅ |

> `parent.updated_at` не проверялся как hard blocker (могли быть фоновые синхи). Критичные поля (`status`, `paid_amount`, `final_price`, `meta`, `deal_date`, `pipeline_id`, `pipeline_stage_id`) DML по run не трогал — write-script содержит только INSERT orders_v2 (REBILL), UPDATE payments_v2, INSERT audit_logs.

### 1.4 Control assertions

| payment_id | expected | actual | OK |
| --- | --- | --- |:---:|
| `b458870d…cfad` | REBILL-b458870d-cfa | REBILL-b458870d-cfa | ✅ |
| `5fc22e49…9e15` | REBILL-5fc22e49-9e1 | REBILL-5fc22e49-9e1 | ✅ |
| `8c78c039…3067` | kept on SUB-LINK-MLNYCZPF | SUB-LINK-MLNYCZPF | ✅ |
| `ffb88444…1dfe` | REBILL-ffb88444-c5d (skip_done, prior batch) | REBILL-ffb88444-c5d | ✅ |
| `b9d946d4…f606` | untouched | SUB-26-MNAI4HKZXJMB | ✅ |
| `0f854c28…0000` | untouched | SUB-LINK-MMIZ52FC | ✅ |
| `6bfead3b…abaf` | untouched | PAY-26-MMUQOBC8 | ✅ |

### 1.5 «H5 не выдавал доступ» (явное подтверждение)

| check | expected | actual | OK |
| --- | --- | --- |:---:|
| REBILL meta.do_not_grant_access=true | 70 | 70 | ✅ |
| entitlements с `meta.source_order_id` ∈ H5 REBILL ids | 0 | 0 | ✅ |
| entitlements с `meta.order_id` ∈ H5 REBILL ids | 0 | 0 | ✅ |
| subscriptions_v2 с `meta.source_order_id` ∈ H5 REBILL ids | 0 | 0 | ✅ |
| `grant-access-for-order` вызовы по H5 run | 0 | 0 (нет audit/edge logs) | ✅ |
| audit `orders.rebill_materialized` per-payment | 70 | 70 | ✅ |
| audit `orders.rebill_materialized_summary` | 1 | 1 | ✅ |

### 1.6 Sanity vs baseline (post-execute снимок)

| metric | baseline (proof) | actual | delta | вердикт |
| --- | ---:| ---:| ---:| --- |
| `subscriptions_v2` active/trial/past_due | 449 | 449 | 0 | ✅ |
| `entitlements` total | 931 | 931 | 0 | ✅ |
| `provider_subscriptions` | 565 | 565 | 0 | ✅ |
| Σepoch(`subscriptions_v2.access_end_at`) | 1 943 707 329 318 | 1 943 707 329 314 | −4 s | informational |
| Σepoch(`entitlements.expires_at`) | 1 654 710 914 606 | 1 654 710 914 608 | +2 s | informational |

Дрейф эпох на единицы секунд (две таблицы, противоположные направления) не объясним H5 (`do_not_grant_access=true`, 0 entitlements/subscriptions ссылаются на H5 REBILL). Списано на фоновую сверку bePaid/cron `nightly access reconcile`, не имеющую отношения к H5.

**Итог Stage 1:** PASS. Отчёт исполнителя `h5_final_bulk_remaining_2026_05` соответствует фактическому состоянию БД.

---

## 2. Stage 2 — Remaining manual_review / skipped (H5 scope)

Источник scope: `.lovable/proofs/h5_refresh_v2_frozen_candidates_2026_05.csv` (73 green) + явно отфильтрованные ранее v1 кандидаты (3 шт, manual_review).

| payment_id | customer (email) | amount | paid_at | current_order | reason | recommended_action |
| --- | --- | ---:| --- | --- | --- | --- |
| `ffb88444-c5dc-…` | (CB-2 tariff, April batch) | 250.00 BYN | 2026-04 | REBILL-ffb88444-c5d | `skip_done` (материализован прошлым batch) | none |
| `b9d946d4-e775-…` (Хрущёва) | (см. CRM) | 250.00 BYN | 2026-04-29 | SUB-26-MNAI4HKZXJMB | `manual_review:refund_or_tariff_upgrade_flow` | ручной разбор refund/upgrade перед материализацией |
| `8c78c039-7c22-…` | (см. CRM) | 250.00 BYN | 2026-03-17 | SUB-LINK-MLNYCZPF | `intentionally_kept_initial` (collective orphan guard: earliest of 2) | none — это initial платёж на parent |
| `0f854c28-1847-…` | (см. CRM) | — | — | SUB-LINK-MMIZ52FC | `manual_review:refund_related` (v1 filter) | проверить связку с refund |
| `6bfead3b-1365-…` | (см. CRM) | — | — | PAY-26-MMUQOBC8 | `manual_review:parent_would_be_orphaned` (январь) | разбор parent-структуры |

H5 scope **полностью закрыт** в рамках clean-execute. Остальные «много платежей на одном order» в БД (≈108 заказов, в основном `PAY-/ORD-/GIFT-/IMP-/ORD-ADM-`) **вне H5 scope** (не recurring + sbs), это отдельный backlog (не H5).

---

## 3. Stage 6 — Final status board

| Блок | Статус | Count | Комментарий |
| --- | --- | ---:| --- |
| H5 clean REBILL repaired | ✅ PASS | 70 | факт vs отчёт совпадает 1:1 |
| Remaining H5 manual_review payments | ⚠ | 5 | см. таблицу Stage 2 |
| H5 «do_not_grant_access» интегритет | ✅ PASS | 70 | 0 entitlements/subs/grant calls по H5 REBILLs |
| Active subscriptions after 17.05 | ℹ | 475 | 176 distinct users |
| Active entitlements after 17.05 | ℹ | 810 | 167 distinct users |
| Distinct (user × product) after 17.05 | ℹ | 856 | union sv2 + ent (179 users) |
| **Missing primary access** (sub без ent) | 🔴 critical | **6** | см. CSV, gap=`missing_primary_entitlement` |
| **Missing Telegram access** (правило есть, факта нет) | 🔴 high | **9** | см. CSV, gap=`missing_telegram_access` |
| Subscription_without_entitlement (canceled grace) | ⚠ high | 40 | в основном `Модуль: Учет у ИП`, canceled с grace до 25.06 |
| Entitlement_without_subscription | ℹ medium | 407 | one-time products / bonus / historical grants — ожидаемо |
| Access_end_mismatch (>24h) | ⚠ medium | 66 | сверка окон ent vs sub |
| Tariff_mismatch | ⚠ medium | 1 | один случай — см. CSV |
| OK | ✅ low | 353 | без замечаний |
| Missing secondary/bonus access | ℹ | 0 reported | при текущем SOT (`tariff_offers.meta.bonus_products`/`access_rules`) автоматически доказанных пропусков не найдено → `no_rules_configured` для рассматриваемых tariffs |
| DB mutations during audit | ✅ | 0 | read-only |

---

## 4. Артефакты

- `.lovable/proofs/h5_final_verification_status_board_2026_05.md` — этот файл (Stage 1+2+6).
- `.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.md` — Stage 3–5 methodology + аномалии.
- `.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.csv` — построчный аудит, 882 rows × 22 cols.

---

## 5. Что НЕ делалось (явно)

DML отсутствует. `grant-access-for-order`, Telegram grant/revoke, provider API, изменения `subscriptions_v2`/`entitlements`/`access_rules`/secrets/mode, auto-fix — не выполнялись.

## 6. Рекомендации (отдельные approve запросы)

1. **Critical (6):** разобрать missing_primary_entitlement по 4 active Gorbova Club subs (Платонова, Колесник, Трофимова, Сермяжко по ЗАКРОЙ ГОД), 2 анонимных (no profile) — по `ЗАКРОЙ ГОД` и `Ценный бухгалтер 2 ступень`. Принять решение: re-run `grant-access-for-order` или явный manual grant.
2. **High Telegram (9):** ручной reinvite через `telegram_access_queue` с `meta.source='manual_bulk'` после подтверждения, что у профилей есть `telegram_user_id`.
3. **Medium (66 mismatch + 40 sub_without_ent + 1 tariff_mismatch):** не блокирующее, sweep отдельным batch'ем с per-row review.
