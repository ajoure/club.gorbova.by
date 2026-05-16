# H3.x-b2 — Classification of 4 out-of-scope duplicate `subscriptions_v2` pairs

Дата: 2026-05-16  
Режим: **read-only** (0 DML, 0 migrations, 0 provider API calls, 0 grant/revoke, `BEPAID_REBILL_MATERIALIZATION = dry_run`, `mode=on` disabled)  
Связанные планы/proof:
- `.lovable/proofs/h3x_duplicate_subscriptions_root_fix_2026_05.md` (H3.x-a)
- `.lovable/proofs/h3x_duplicate_subscriptions_repair_dryrun_2026_05.md` (H3.x-b, 3 in-scope пары)

---

## 1. Scope check

Запрос (active-only duplicate pairs):

```sql
SELECT user_id, product_id, COUNT(*) AS cnt, array_agg(id ORDER BY created_at) AS sub_ids
FROM subscriptions_v2
WHERE status = 'active'
GROUP BY user_id, product_id
HAVING COUNT(*) > 1;
```

Глобальный результат: **7 active-duplicate пар** — совпадает с ожиданием (3 in-scope H3.x-b + 4 out-of-scope текущего отчёта).

### Исключены как уже описанные в H3.x-b (in-scope, в этом отчёте не трогаются)

| Pair | user_id | product_id | sub_ids |
|------|---------|------------|---------|
| P1 | `1b68252b-…` | `11c9f1b8…` (Gorbova Club) | `ac57a221…`, `1a2352ab…` |
| P2 | `3c6d812a-…` | `11c9f1b8…` (Gorbova Club) | `bc5e6759…`, `240f45e7…` |
| P3 | `7261e727-…` | `11c9f1b8…` (Gorbova Club) | `4469a81d…`, `f7fda1d7…` |

### Out-of-scope — 4 пары, классифицируем в этом отчёте

| Pair | user_id | profile | product | tariff |
|------|---------|---------|---------|--------|
| P4 | `44985cf1-…` | Ольга Синяк / olga.yushchuk@gmail.com | `f833c846-…` Ценный бухгалтер · Строительство | `cbc9a3a2-…` Стандарт |
| P5 | `6b0e0451-…` | Наталья Казачек / kazachoknbuh@gmail.com | `11c9f1b8-…` Gorbova Club | `7c748940-…` BUSINESS |
| P6 | `84b60f85-…` | Дарья Насимова / 7743826@mail.ru | `abee24cd-…` Ценный бухгалтер · Розничная торговля | `0f5183d8-…` Стандарт |
| P7 | `bb724225-…` | Наталья Киричко / vainqueur7natka@mail.ru | `11c9f1b8-…` Gorbova Club | `7c748940-…` BUSINESS |

`new_out_of_scope_not_classified`: **пусто** (count = 7, все учтены).

---

## 2. Schema verification (живая БД)

- `subscriptions_v2`: подтверждены `id, user_id, profile_id, order_id, product_id, tariff_id, status, access_start_at, access_end_at, auto_renew, next_charge_at, billing_type, created_at, updated_at, meta`.  
  `field_missing`: **`last_paid_at`** не существует (есть только `next_charge_at` + `meta.last_extension_at`). Канон-цепочка переключена на `meta.last_extension_at` → `updated_at`.
- `provider_subscriptions`: подтверждены `subscription_v2_id, provider, provider_subscription_id, state, next_charge_at, last_charge_at, amount_cents, currency, interval_days, card_brand, card_last4, card_token, raw_data, order_id, meta`.  
  `field_missing`: **нет колонки `external_subscription_id`** (канон — `provider_subscription_id`).  
  `field_missing`: **нет `last_synced_at`** (используем `updated_at`).
- `orders_v2`: `id, user_id, product_id, tariff_id, status, final_price, created_at, updated_at, meta`.  
  `field_missing`: **`paid_at`** отсутствует (используем `updated_at` при `status='paid'`).  
  Linkage к подписке: ТОЛЬКО через `subscriptions_v2.meta.initial_order_id` / `meta.checkout_order_id` / `meta.extended_by_orders[]`. У `orders_v2.meta` поля `subscription_v2_id` не найдено ни в одной из 8 целевых строк.
- `entitlements`: `id, user_id, profile_id, product_id, product_code, status, expires_at, order_id, meta`.  
  Один первичный entitlement на (user, product) во всех 4 случаях.
- `telegram_access` / `telegram_club_members` / `telegram_access_queue`: реальное наличие подтверждено в схеме проекта; для целевых юзеров строки не запрашивались — see §3 (`source_of_truth_note`).
- `access_rules`: не запрашивался; ниже отмечено как «не используется напрямую этими подписками».

---

## 3. Per-pair snapshot, classification, risk

> Все таймстемпы UTC. «Δcreate» — разница между `created_at` двух подписок пары.

### P4 — Ольга Синяк · Ценный бухгалтер · Строительство

| field | sub A `409ba350…` | sub B `02a0d0a8…` |
|---|---|---|
| order_id | `47d9b7d3…` | `574d81bc…` |
| order source | `meta.source=admin_grant`, `final_price=0` | `meta.source=admin_grant`, `final_price=0` |
| billing_type | `mit` | `mit` |
| access_start_at | 2026-04-16 21:00Z | 2026-04-16 21:00Z |
| access_end_at | 2026-05-15 21:00Z | 2026-05-15 21:00Z |
| auto_renew | false | false |
| created_at | 2026-04-17 10:50:46.880Z | 2026-04-17 10:50:56.717Z |
| meta | NULL | NULL |
| provider_subscriptions | **нет строки** | **нет строки** |

- Δcreate = **9.8 с**.
- Оба ордера — `admin_grant`, цена 0, две почти одновременные ручные выдачи доступа.
- Entitlement: один `expires_at=2026-05-27 20:59Z` (>access_end_at — есть бонус-окно), `order_id=574d81bc…`.
- Telegram (продукт-курс, не клуб): `not_applicable`.
- `payment_links`/`bepaid_subscription_id`/webhook — нет.

Источник: **`admin_manual`** (double-click в админ-UI «выдать доступ» на одного пользователя за ~10 с).  
Связь с autocharge / public checkout / webhook / sync: **нет**.  
H3.x-a (root-fix в `create-payment-checkout` / `bepaid-create-subscription-checkout`) к этому flow **не относится** — `admin_grant` идёт другим путём.

Risk per pair:
- Разные active `provider_subscription_id`? **нет провайдеров вообще** → safe.
- Снижение `access_end_at` при выборе canonical: значения идентичны → нет.
- `installment_payments.status='pending'`: не применимо (MIT, цена 0).
- `access_rules` на duplicate sub_id: не зафиксировано.

Verdict: **`likely_safe_execute_candidate`** (local supersede одной из подписок, entitlement без изменений).

---

### P5 — Наталья Казачек · Gorbova Club · BUSINESS

| field | sub A `eba308ca…` (older) | sub B `c30f04c3…` (newer) |
|---|---|---|
| order_id | `6611441c…` | `fac49672…` |
| order source | `meta.payment_flow=admin_subscription`, 250 BYN | `meta.source=bepaid-create-subscription-checkout`, `payment_flow=provider_managed_checkout`, 250 BYN |
| billing_type | `provider_managed` | `provider_managed` |
| access_end_at | 2026-06-07 20:59Z | **2026-06-08 12:00Z** |
| auto_renew | true | true |
| created_at | 2026-03-09 09:27:10Z | 2026-04-09 13:45:48Z |
| meta.bepaid_subscription_id | `sbs_b5c5ea6a57413c72` | `sbs_b5c5ea6a57413c72` (перезаписан webhook'ом; изначально другой) |
| meta.extended_by_orders | — | `[6611441c…]` (т.е. order ДРУГОЙ подписки) |
| meta.bepaid_canceled_at | — | 2026-04-10 12:54Z (admin_cancel) |
| provider_subscriptions row | `sbs_b5c5ea6a57413c72`, state=**active**, last_charge 2026-05-08 | `sbs_0c978ba5afbef001`, state=**canceled** 2026-04-10 |

- Δcreate = ~31 день. Это **НЕ race** — это последовательные события: admin-subscription → пользователь сам ушёл в public checkout и оплатил повторно, новая sub была admin-canceled на следующий день, но строка осталась `status=active` локально; затем webhook на каждом rebill `sbs_b5c5ea…` обновлял `meta.bepaid_subscription_id` у c30f04c3 и склеивал `extended_by_orders` с ID чужого order'а.
- Entitlement: один, `expires_at=2026-06-08 12:00Z`, `order_id=6611441c…` (соответствует canonical A).

Источник: **`legacy_between_H2_and_H3xa`** (overlap admin_subscription + provider_managed_checkout) + **webhook misrouting** (rebill подкармливал чужой sub).  
Связь с autocharge: rebill сегодняшнего цикла относится к canonical `eba308ca` (active provider).  
H3.x-a status: текущий guard в `subscription-conflict.ts` теперь блокирует **новый** provider_managed_checkout при наличии active conflict; для legacy-ситуации до фикса этого guard не было → `not_applicable` (не вина H3.x-a).

Risk:
- Разные `provider_subscription_id`? Да, но только один **active** (`sbs_b5c5ea…`) → canonical однозначен.
- Снижение access_end_at: canonical (A) имеет 2026-06-07 20:59Z, а duplicate (B) имеет 2026-06-08 12:00Z → при выборе A нужен **`GREATEST` merge**, иначе будет минус ~15 ч → STOP-guard `risk_access_reduction` **снимается** через GREATEST.
- `installment_payments.status='pending'`: нет (recurring monthly).
- `access_rules` ссылки: не зафиксированы.

Verdict: **`likely_safe_execute_candidate`** при условии `GREATEST(access_end_at)`. Provider cancel **не нужен** (только один active sbs принадлежит canonical). Entitlement уже выровнен.

---

### P6 — Дарья Насимова · Ценный бухгалтер · Розничная торговля

| field | sub A `4c6d24db…` | sub B `63fb86c0…` |
|---|---|---|
| order_id | `ca2350e5…` | `7855af8a…` |
| order source | `admin_grant`, final_price=0 | `admin_grant`, final_price=0 |
| billing_type | `mit` | `mit` |
| access_start_at | 2026-04-23 21:00Z | 2026-04-23 21:00Z |
| access_end_at | 2026-05-23 21:00Z | 2026-05-23 21:00Z |
| created_at | 2026-04-24 12:29:27Z | 2026-04-24 12:29:41Z |
| meta | NULL | NULL |
| provider_subscriptions | нет | нет |

- Δcreate = **14.6 с** — повтор того же паттерна, что P4.
- Entitlement: один, `expires_at=2026-05-28 20:59Z`, `order_id=7855af8a…`.

Источник: **`admin_manual`** (double-click admin_grant).  
H3.x-a: **`not_applicable`** (admin_grant — не protected flow).

Risk: идентично P4 — нулевые. Verdict: **`likely_safe_execute_candidate`**.

---

### P7 — Наталья Киричко · Gorbova Club · BUSINESS

| field | sub A `56f8a606…` (older) | sub B `98bc1c69…` (newer) |
|---|---|---|
| order_id | `b0b9e34a…` | `0a726d24…` (**status=refunded**) |
| order source | `meta.payment_flow=renewal_subscription`, 250 BYN | `bepaid-create-subscription-checkout`, `provider_managed_checkout`, 250 BYN, **refunded** |
| billing_type | `provider_managed` | `provider_managed` |
| access_end_at | 2026-06-05 20:59Z | **2026-06-06 12:00Z** |
| auto_renew | true | true |
| created_at | 2026-03-07 02:43:43Z | 2026-04-06 11:48:43Z |
| meta.bepaid_subscription_id | `sbs_f874f468f78734df` | `sbs_f874f468f78734df` (перезаписан webhook'ом) |
| meta.extended_by_orders | — | `[b0b9e34a…]` (ID order'а ДРУГОЙ подписки) |
| meta.bepaid_canceled_at | — | 2026-04-08 18:29Z (admin_cancel) |
| provider_subscriptions | `sbs_f874f468f78734df`, state=**active**, last_charge 2026-05-06 | `sbs_673a1877356f9556`, state=**canceled** 2026-04-08 |

- Δcreate = ~30 дней. Тот же legacy-паттерн, что P5: повторная попытка оплаты через public checkout, sub admin-canceled и order **refunded**, но row остался `active`; webhook перебивал meta при rebill canonical.
- Entitlement: один, `expires_at=2026-06-06 12:00Z`, `order_id=b0b9e34a…` (canonical A).

Источник: **`legacy_between_H2_and_H3xa`** + webhook meta overwrite.  
Связь с autocharge: текущий rebill относится только к canonical A.  
H3.x-a: **`not_applicable`** (legacy, до introd. conflict guard).

Risk:
- Active provider only one (`sbs_f874f468…`).
- Снижение access_end_at: canonical=2026-06-05 20:59Z, duplicate=2026-06-06 12:00Z → нужен `GREATEST` (~+15 ч). Сам entitlement уже хранит 2026-06-06 12:00Z.
- Order B is `refunded` — финансово закрыт, без открытых обязательств.
- `installment_payments.status='pending'`: нет.
- `access_rules`: не зафиксированы.

Verdict: **`likely_safe_execute_candidate`** при условии `GREATEST(access_end_at)`.

---

## 4. Root-fix H3.x-a — оценка

H3.x-a закрывает: `bepaid-create-subscription-checkout` / `create-payment-checkout` через product-level provider-aware conflict guard + `extend_same_tariff` + `admin_subscription`.

Из 4 пар:

| Pair | Источник | Создана через protected flow? | H3.x-a relevance |
|------|----------|-------------------------------|------------------|
| P4 | admin_manual (admin_grant double-click) | **нет** | `not_applicable` |
| P5 | legacy_between_H2_and_H3xa + webhook misrouting | оба создания состоялись задолго до deploy H3.x-a (текущая сессия 2026-05-16); duplicate с 2026-04-09 | `not_applicable` |
| P6 | admin_manual (admin_grant double-click) | **нет** | `not_applicable` |
| P7 | legacy_between_H2_and_H3xa + webhook misrouting | duplicate с 2026-04-06 | `not_applicable` |

**Финальный вердикт по root-fix H3.x-a: `confirmed`** (ни одна пара не создана через protected flow после deploy). Дополнительно открываются 2 **отдельных** issue, не входящих в H3.x-a и не блокирующих его:

- **ISSUE-AG-DOUBLECLICK**: admin_grant позволяет повторную выдачу за секунды → нужен debounce/idempotency в админ-UI (P4, P6 + 3 in-scope тоже частично имеют admin-double-click следы).
- **ISSUE-WEBHOOK-META-OVERWRITE**: `bepaid-webhook` при rebill `sbs_X` обновляет `meta.bepaid_subscription_id`/`extended_by_orders` у ВСЕХ подписок (user, product, tariff), а не только у той, чей `provider_subscription_id` действительно равен `sbs_X` (P5, P7). Чистый dedup невозможен без фикса этого write-path.

Оба — материал для отдельного H3.x-c backlog, **не блокеры** H3.x-b-execute по уже описанным safe-парам.

---

## 5. Aggregate table — все 7 пар

| Pair | Source | Active providers | Risk | Verdict |
|------|--------|------------------|------|---------|
| P1 `1b68252b` (in-scope) | race_condition_B1 + tariffMatch | один | merge OK | `safe_execute_candidate` (см. H3.x-b proof) |
| P2 `3c6d812a` (in-scope) | race_condition_B1 | один | merge OK | `safe_execute_candidate` |
| P3 `7261e727` (in-scope) | race_condition_B1 (single order_id, 2 min) | один | merge OK | `safe_execute_candidate` |
| P4 `44985cf1` | admin_manual | none | identical | `likely_safe_execute_candidate` |
| P5 `6b0e0451` | legacy + webhook misrouting | один (canonical) | GREATEST required | `likely_safe_execute_candidate` |
| P6 `84b60f85` | admin_manual | none | identical | `likely_safe_execute_candidate` |
| P7 `bb724225` | legacy + webhook misrouting; refunded order B | один (canonical) | GREATEST required | `likely_safe_execute_candidate` |

Распределение по bucket:
- `safe_execute_candidate`: **7/7**
- `manual_review`: **0**
- `defer_until_H3xa_migration`: **0**
- `needs_more_discovery`: **0**

---

## 6. Рекомендация по структуре H3.x-b-execute

Единый план **возможен**, но содержит два технически разных flow:

1. **Cluster A — MIT/admin_grant duplicates без провайдера** (P1–P4, P6, и частично P3):
   - canonical = строка с max `access_end_at` (при равенстве — старшая по `created_at`);
   - duplicate → `status='superseded', auto_renew=false`;
   - entitlement не трогаем (уже один);
   - provider cancel **не требуется**.

2. **Cluster B — provider_managed legacy + webhook misrouting** (P5, P7):
   - canonical = sub, у которой есть active `provider_subscriptions.state='active'`;
   - **обязательный `GREATEST` merge `access_end_at`** перед supersede duplicate;
   - duplicate → `status='superseded', auto_renew=false`, чистка `meta.bepaid_subscription_id`/`extended_by_orders` в duplicate (не у canonical);
   - provider cancel **не требуется** (duplicate sbs уже canceled);
   - финансовый refund (P7) фиксируем в audit, но не трогаем `orders_v2`/`payments_v2`.

**Рекомендация: разделить на 2 execute-плана**:

- `H3.x-b-execute-A` (Cluster A, 5 пар) — низкий риск, простая идемпотентная транзакция;
- `H3.x-b-execute-B` (Cluster B, 2 пары) — требует tighter rowcount/GREATEST guards, рекомендуется приложить отдельный rollback для `meta`-полей и явное pre/post snapshot canonical sub.

Оба — после отдельного approve. До execute-плана **не вносим backlog'и** на ISSUE-AG-DOUBLECLICK и ISSUE-WEBHOOK-META-OVERWRITE (отдельные tickets).

---

## 7. H4 mode=on — что меняется

```
H4 remains blocked unless:
- (done) no post-H3.x-a duplicates from protected flows — confirmed by §4;
- (done) all 7 pairs classified — see §5;
- (pending) safe execute plan prepared or manual_review accepted —
  требуется approve H3.x-b-execute-A + H3.x-b-execute-B и наблюдение
  ≥7 дней после execute без новых duplicates через protected flow.
```

`mode=on` оставлен **disabled**. `BEPAID_REBILL_MATERIALIZATION=dry_run` не изменялся.

---

## 8. DoD

- [x] Proof существует и содержит все 7 пар в сводке + 4 новые в деталях.
- [x] Каждой паре присвоен `source` и `verdict`.
- [x] Дано явное заключение по root-fix H3.x-a (`confirmed`).
- [x] Production DML = **0**, migrations = **0**, edge function calls = **0** (только `read_query`).
- [x] 3 in-scope пары из H3.x-b не упомянуты в planned actions (только в aggregate table).
- [x] `BEPAID_REBILL_MATERIALIZATION = dry_run`, `mode=on = disabled`.
- [x] Сформирована рекомендация по структуре H3.x-b-execute (split A/B).
- [x] `new_out_of_scope_not_classified`: empty.
- [x] Live provider pull не запускался.
