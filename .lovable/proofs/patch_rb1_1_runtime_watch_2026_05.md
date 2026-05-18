# PATCH-RB1.1 runtime-watch — verify по двум live REBILL после фикса `base_price`

## Окно наблюдения

`[2026-05-17T13:45Z; 2026-05-18T07:30Z]` (после deploy фикса PATCH-RB1.1).

## Зафиксированные live события

| # | UTC | sbs | provider_payment_uid | parent_order | REBILL-order | payment_id |
|---|---|---|---|---|---|---|
| A | 2026-05-17 18:01:10 | `sbs_e1f92ff0e3fa4bff` | `111dfc17-80c2-477c-8ecd-9b768744e8b7` | `91b98bf3-282a-4ef0-854d-f71a86577139` (SUB-26-MMWC6988TBML) | `06f22ceb-9792-464e-adfb-d15519352d21` (REBILL-111dfc17-80c) | `f2892a00-5731-4adb-97d8-ff8d3472f953` |
| B | 2026-05-18 07:15:22 | `sbs_9d30ab4a6e029b61` | `e83818b8-10f6-46fc-9cec-cbb9043555ab` | `0ecbeebd-493f-4672-a900-403da0365caf` (SUB-LINK-MMX2DDTQ) | `36d690fb-8b3b-4d11-8b17-79bcac7c0d5c` (REBILL-e83818b8-10f) | `fa537e59-27cd-4858-b950-412a29ca3e44` |

Кодовые пути:
- Case A — `subscription` webhook (line ~1490), `payment_flow=provider_managed_checkout`.
- Case B — link_order/`system_payment_link_subscription` dispatcher (line ~2605), `payment_flow=renewal_subscription`.

## 7-пунктовый чек-лист

| # | Проверка | Case A | Case B |
|---|---|---|---|
| 1 | `bepaid.rebill.materialized` появился (без `_partial`) | ✅ | ✅ |
| 2 | REBILL-order создан, `status=paid`, `base_price=final_price=paid_amount=250.00` | ✅ | ✅ |
| 3 | `payments_v2.order_id` указывает на REBILL-order | ❌ payment на parent | ✅ `fa537e59→36d690fb` |
| 4 | Parent-order не получил payment | ❌ parent держит `f2892a00…` | ✅ |
| 5 | `grant-access-for-order` отработал успешно | ✅ extended до `2026-06-17 12:00Z`, `primary_entitlement_verified=true`, ledger writes есть | ✅ webhook → `bepaid.webhook.canonical_writer_only` + `link_order_processed` |
| 6 | Нет `dispatcher_error` / `sbs_mismatch` / `skip_blocked_stale_access` / `materialized_partial` / `conflict_uid` / `skip_grant_blocked` | ✅ 0 событий | ✅ 0 событий |
| 7 | `BEPAID_REBILL_MATERIALIZATION=on` остался | ✅ оба materialized с `meta.mode='on'` | ✅ |

## Вердикт

`base_price` фикс работает: больше нет `materialized_partial` из-за NOT NULL, dispatcher_error нет. Контракт «отдельная REBILL-сделка» выполнен в `orders_v2` для обоих кейсов.

Контракт «payment.order_id → REBILL» выполнен для Case B и **нарушен** для Case A — sub-bug, не связанный с `base_price`. Это контрактное нарушение, не «частичный успех».

Root cause Case A: в subscription webhook STEP E `upsertPaymentV2(order_id: orderV2Id=PARENT)` выполнялся безусловно после `runRebillFlow`, перетирая `payments_v2.order_id` обратно с REBILL на parent. Link_order путь (Case B) такой бэк-овер не делал, поэтому был чист.

## Действия

- **Mode оставлен `on`** (фикс RB1.2 уже выкачен).
- **PATCH-RB1.2** — code fix STEP E + post-rebind verify + payment_rebind_failed audits. Proof: `.lovable/proofs/patch_rb1_2_payment_rebind_fix_2026_05.md`. 5 регрессий + 65/65 зелёных.
- **PATCH-RB3** — financial repair Case A. Proof: `.lovable/proofs/patch_rb3_case_a_payment_rebind_repair_2026_05.md`.

## DoD

- ✅ Оба live кейса зафиксированы с фактическими ID и таймштампами.
- ✅ 7-пунктовый чек-лист пройден явно по каждому.
- ✅ Sub-bug найден, локализован и исправлен в коде (RB1.2).
- ✅ Case A исправлен финансово (RB3) без вызова `grant-access-for-order`.
- ✅ Secret `BEPAID_REBILL_MATERIALIZATION=on`.
- ✅ Никаких ручных правок subscriptions_v2 / entitlements / access_rules / telegram_*.

## Триггер немедленного rollback `on→dry_run`

Появление в audit_logs:
- `bepaid.rebill.payment_rebind_failed`
- `bepaid.rebill.payment_rebind_post_check_failed`
- `bepaid.rebill.materialized_partial`
- `bepaid.rebill.dispatcher_error`
- `bepaid.rebill.sbs_mismatch`
- `bepaid.rebill.conflict_uid`

→ stop, rollback, investigate.
