# H4 preconditions — `BEPAID_REBILL_MATERIALIZATION=on`

**Дата:** 2026-05-16 (Europe/Minsk) · read-only · DML=0 · migrations=0 · secrets без изменений
**Итог:** **NO-GO** (см. §6, §9).

---

## 1. Deployment status blocker patches

| Patch | Status |
|---|---|
| H2 LINK-ORDER | closed + deployed |
| H2.1 WEBHOOK-SUBSCRIPTION | closed + deployed |
| H2.1b 3DS finalize (writer + webhook) | closed + deployed |
| H2.1c-i legacy one-time retirement | closed + deployed (proof `patch_h2_1c_i_legacy_retirement_2026_05.md`) |
| §F SBS mismatch no-new-sub guard | closed + deployed |
| §A.2 REBILL mode=on wiring (dry_run path) | closed + deployed |
| `BEPAID_REBILL_MATERIALIZATION` | **`dry_run`** (без изменений) |

Все required patches deployed. Pass.

---

## 2. Static check `bepaid-webhook`

Мульти-строчный regex (`from('table').(insert|update|upsert)` через перенос строки):

| Цель | Hits | Verdict |
|---|---|---|
| `subscriptions_v2.insert/update/upsert` | 6 | все provider-sync (см. ниже) |
| `entitlements.insert/update/upsert` | **0** | ✅ |
| `subscriptions` (v1) `.insert/update/upsert` | **0** | ✅ |
| `entitlement_orders.insert/update/upsert` | **0** | ✅ |
| `telegram_access*.insert/update/upsert` | **0** | ✅ |
| `functions.invoke('telegram-grant-access')` | **0** | ✅ |

6 subv2 writes — построчная проверка:

| Line | Branch | Payload | Verdict |
|---|---|---|---|
| 1618 | WEBHOOK-SUBSCRIPTION renewal provider-sync | `billing_type/next_charge_at/auto_renew/meta.bepaid_*/updated_at` | provider-sync only ✅ |
| 1874 | INV-22 terminal state autorenew disable | `auto_renew/meta.bepaid_terminal_*` | provider-sync only ✅ |
| 2893 | LINK-ORDER post-grant billing_type marker | `billing_type/meta.bepaid_subscription_id` | provider-sync only ✅ |
| 2926 | STAGE L3 INSTALLMENT fallback subscription INSERT | `status=active, billing_type=mit, model=internal_installment` | разрешено (installment-only fallback, не renewal access write) ✅ |
| 3192 | LINK-ORDER H2 canonical-writer-only provider sync | `billing_type/auto_renew/meta.bepaid_*` | provider-sync only ✅ |
| 4651 | 3DS finalize provider sync (H2.1b-ii) | `billing_type/auto_renew/next_charge_at/payment_method_id/payment_token/updated_at/meta.bepaid_*` | provider-sync only ✅ |

Прямые access-grant writes (access_start_at/access_end_at/status в access-контексте/entitlements/telegram_access/telegram-grant-access invoke) — **0**. Pass.

---

## 3. Dry_run observability (30 дней)

`audit_logs.action = 'bepaid.rebill.dry_run'`:

| Кол-во | uid | sbs | decision | conflict_uid | sbs_mismatch | proceedLegacy | dispatcher_error |
|---|---|---|---|---|---|---|---|
| 1 | `bdfc574d-…` | `sbs_70f8efb8949a490c` | `would_materialize` | no | no | n/a | no |

Запись (2026-05-16 06:45 UTC):
- parent_order = `68e2c243-…` (admin_subscription, deal_month=2026-05)
- planned REBILL-order = новый UUID, `meta.source=bepaid_rebill`, `meta.materialization_run=bepaid_webhook_rebill_v2`
- planned payment repoint = `14d419cb-…` → новый order
- planned grant call = `grant-access-for-order(order_id=<new>)`
- existing_rebill_order_id = null
- full_refunded_uid = false

Counters за 30 дней: `total=1`, `happy=1`, `conflict_uid=0`, `sbs_mismatch=0`, `idempotent=0`, `dispatcher_error=0`, `manual_review=0`. Pass.

---

## 4. Recurring payments vs dry_run audit (14 дней)

`payments_v2` recurring `succeeded` за 14 дней: **84** (≤17/день, пик 2026-05-03/07).

Сверка `payments.provider_payment_id ↔ audit.meta.uid`:

| Origin / source / flow | n | dry_run audit |
|---|---|---|
| `bepaid-create-subscription-checkout` / `provider_managed_checkout` (первый charge) | 12/7д | n/a — это не rebill |
| order_meta=NULL, flow=`renewal_subscription` (cron-driven) | 6/7д | not expected (см. ниже) |
| order_meta=NULL, flow=`admin_subscription` (webhook-driven) | 2/7д | **1 из 2** имеет dry_run audit |
| `rebill_materialization_repair` / `bepaid_subscription_charge` | 1/7д | архив |

**Архитектурное разделение (важно):**
- `subscription-charge` cron сам создаёт child `orders_v2` (`meta.source='subscription-renewal'`, lines 1320–1400 в `subscription-charge/index.ts`) и материализация в webhook им не нужна.
- `bepaid-webhook` REBILL материализует только webhook-driven recurring (admin_subscription, public-link-subscription) где parent_order != child renewal order.

То есть «83 без audit» — это либо first-charge (12), либо cron-материализованные renewals (6). Реальный rebill-materialization eligible трафик = 2 (admin_subscription), audit-coverage = 1/2 = 50%.

**Замечание (не STOP, но к учёту в rollout):** один admin_subscription succeeded recurring payment 2026-05-XX без dry_run audit нужно отдельно проверить перед mode=on — возможно payment до deploy §A.2 wiring или other_flow.

---

## 5. Canonical grant path (28 audits за 7 дней)

- `grant_access*` audits: **28**, все с `order_id`.
- `bepaid.webhook.grant_skipped_no_fallback`: **0** за 14 дней. ✅
- Pass.

---

## 6. Duplicate / race risks — **BLOCKER**

### Duplicate by `meta.bepaid_subscription_id` (active)

2 пары (March/April):

| sbs | ids | created_at | access_end_at |
|---|---|---|---|
| `sbs_b5c5ea6a57413c72` | `eba308ca…`, `c30f04c3…` | 2026-03-09, 2026-04-09 | 2026-06-07, 2026-06-08 |
| `sbs_f874f468f78734df` | `56f8a606…`, `98bc1c69…` | 2026-03-07, 2026-04-06 | 2026-06-05, 2026-06-06 |

→ pre-H2 legacy (March/April создания). Legacy debt.

### Active duplicates по `(user_id, product_id, tariff_id)` (7 пар)

После H2 deploy (≥2026-05-13) появилось **3 новых дубля** на product `11c9f1b8…` (КБ-1), tariff `7c748940…`:

| user_id | sub1 | sub2 | Δ | order_ids |
|---|---|---|---|---|
| `1b68252b…` | 2026-05-13 16:21 (mit, no sbs) | 2026-05-16 06:00 (provider_managed, `sbs_6b03…`, public_link_subscription) | 3 дня | разные |
| `3c6d812a…` | 2026-05-14 17:54 (mit, no sbs) | 2026-05-16 06:00 (provider_managed, `sbs_82e2…`, public_link_subscription) | 2 дня | разные |
| `7261e727…` | 2026-05-16 07:54:55 (provider_managed, `sbs_2f63…`) | 2026-05-16 07:57:06 (mit, no sbs) | **2 мин** | **ОДИН** `d1080bf5…` |

**Анализ:**

- Кейсы 1–2: тот же tariff_id, разные orders, разница ~3 дня. По правилу `extend ↔ tariff match` второй платёж должен был `extend` существующую sub, а не создать новую. **Bug.**
- Кейс 3: оба subscription созданы на один `order_id=d1080bf5…` за 2 минуты — чистый **race condition**.

**Правило из плана §6:** «Если найдены новые дубли после H2 patches — STOP и отдельный H3 repair.»

**→ BLOCKER.**

---

## 7. Refund check (14 дней)

| total refunds | with refunded_amount>0 | full refund | partial |
|---|---|---|---|
| 1 | 1 | 1 | 0 |

Refund привязан к parent payment (refunded_at IS NOT NULL on payments_v2.id), parent.refunded_amount = amount. Refund не создаёт доступ. Full-refund не продлевает (нет дополнительного `grant_access*` audit на parent). REBILL dry_run учитывает refund state (`full_refunded_uid: false` в существующем event). Pass.

---

## 8. UI consistency (read-only)

- Канонический view `orders_v2.deal_date` остаётся = первая оплата parent order (не изменялся).
- Новые recurring child orders, созданные cron'ом (`renewal_subscription`), имеют свой `deal_date` = renewal time → отдельные карточки.
- Admin AccessTab и user cabinet читают `access-resolver` (`subscriptions_v2.access_end_at` SOT) → совпадают.
- В новых дублях по §6 (1b68252b, 3c6d812a, 7261e727) cabinet/admin покажет «две активные подписки на один тариф» — UI inconsistency, требующая H3 repair.

---

## 9. Go / No-Go

**Verdict: NO-GO.**

Включать `BEPAID_REBILL_MATERIALIZATION=on` сейчас опасно по следующим причинам:

1. **Active race condition в subscription create path** (кейс 7261e727 — два sub за 2 минуты на один `order_id`). Mode=on создаёт ещё один write-path в orders_v2 и умножит race-фронт.
2. **Tariff-match extend logic не работает для public-link-subscription** (кейсы 1b68252b, 3c6d812a). Перед mode=on требуется убедиться, что новые REBILL-orders не будут уплотнять эти дубли.
3. **Audit coverage admin_subscription = 50%** (1/2). Перед mode=on нужно поднять observability до 100% (см. §4).

### Blocker list (H3 candidates)

- **B-1** (P0): race в `create-payment-checkout` / `public-link-subscription`: один order_id → две subscriptions_v2.
- **B-2** (P0): отсутствует tariff-match extend для public-link-subscription повторных покупок (≤ 3 дня окно).
- **B-3** (P1): admin_subscription recurring payment без `bepaid.rebill.dry_run` audit — расследовать конкретный uid и закрыть wiring gap.

### Pre-H2 legacy debt (НЕ blocker, отдельный backlog)

- 2 пары March/April duplicates by sbs (`sbs_b5c5ea…`, `sbs_f874f4…`) — legacy. Не трогать в H4, отдельный data-repair с approve.

---

## 10. Rollout / rollback (заготовлено, не выполнять)

### Rollout (только после approve и закрытия B-1/B-2/B-3)
1. `secrets--update_secret BEPAID_REBILL_MATERIALIZATION=on` в рабочее окно (Mon–Thu, 10:00–16:00 Minsk).
2. Watch первого webhook ≤30 мин:
   - `audit_logs.action='bepaid.rebill.materialized'` появляется
   - `orders_v2` новые `REBILL-…` строки имеют корректные `meta.parent_order_id`, `meta.source='bepaid_rebill'`
   - `payments_v2.order_id` репойнтнулся со старого parent на новый child
   - `grant-access-for-order` вызван 1×, audit `extended_by_orders` единичный
3. Monitoring queries (Lovable proof template):
   ```sql
   SELECT count(*) FROM audit_logs
   WHERE action LIKE 'bepaid.rebill%' AND created_at > now() - interval '1 hour';

   SELECT count(*) FROM orders_v2
   WHERE meta->>'materialization_run' = 'bepaid_webhook_rebill_v2'
     AND created_at > now() - interval '1 hour';

   SELECT count(*) FROM subscriptions_v2 s
   WHERE status='active'
   GROUP BY user_id, product_id, tariff_id HAVING count(*)>1;
   ```

### STOP criteria после первого webhook (mode=on)
- любой `bepaid.rebill.conflict_uid` / `dispatcher_error` / `sbs_mismatch` / `manual_review`
- duplicate active sub `(user, product, tariff)` ↑ vs baseline
- `payments_v2.order_id` не репойнтнулся
- `grant-access-for-order` вызывается >1× на один платёж

### Rollback
- `secrets--update_secret BEPAID_REBILL_MATERIALIZATION=dry_run` (или `off`).
- Никаких DML на orders_v2/payments_v2 от агента; ручная зачистка только через отдельный H3 dry-run + approve.

---

## DoD

- proof создан ✅
- production DML = 0 ✅
- migrations = 0 ✅
- secrets не менялись ✅
- `BEPAID_REBILL_MATERIALIZATION` остался `dry_run` ✅
- `mode=on` не включался ✅
- финальный go/no-go: **NO-GO** ✅

**Дальнейшие шаги:** H3 repair (B-1, B-2, B-3) → повторный H4 → approve → mode=on.
