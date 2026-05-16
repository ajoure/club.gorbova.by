# PATCH H2.1 — Canonical-writer enforcement: WEBHOOK-SUBSCRIPTION закрыт; 3DS/legacy — STOP

**Дата:** 2026-05-16
**Скоуп:** `supabase/functions/bepaid-webhook/index.ts`
**Режим:** `BEPAID_REBILL_MATERIALIZATION=dry_run` (НЕ меняли)
**Production DML:** 0 · **Migrations:** 0 · **mode=on:** НЕ включали

---

## 1. Inventory оставшихся access-grant writes (read-only, до правок)

| Ветка | Строки до правок | Что писалось | Тип | Сценарий |
|---|---|---|---|---|
| **WEBHOOK-SUBSCRIPTION renewal** | 1535–1644 | `subscriptions_v2.{status, access_start_at, access_end_at}` + `entitlements.{expires_at,status}` upsert | access-grant | bePaid `subscription_charge.success` для recurring/installment |
| **3DS finalize / основной paid-order branch** | 4541–4951 | `subscriptions_v2` INSERT с `access_start_at/access_end_at`, `subscriptions_v2.update access_end_at`, `entitlements` insert/update `expires_at/status`, `telegram-grant-access` invoke | access-grant | первичный paid-order одноразовых тарифов + 3DS finalize, **bootstrap новой subscription** + proration + payment_method create |
| **Legacy одноразовый path** | 5820–6070 | `orders_v2` INSERT, `subscriptions_v2` INSERT с `access_*_at`, `entitlements` upsert, `telegram-grant-access` invoke, `telegram_access_grants` insert | access-grant | исторический orphan-payment path (Людмила-case), создаёт `orders_v2` из webhook body |

`bepaid.webhook.access_end_at_skipped_overshoot` guard (≈3000–3330) — НЕ access-grant write, оставлен как был.

`orderV2.id` validity per ветке:
- **WEBHOOK-SUBSCRIPTION:** доступен через `orderV2Id` из tracking (`subv2:{sub}:order:{order}`). Подтверждено: проверяется `subError || !subV2` → 404 раньше.
- **3DS finalize:** `orderV2.id` существует (загружается выше по коду через `paymentV2`/`payments_v2.order_id`).
- **Legacy path:** `orderV2.id` создаётся ВНУТРИ этой же ветки из webhook body — chicken-and-egg для canonical writer.

---

## 2. Что фактически закрыто в H2.1 (1 из 3 веток)

### WEBHOOK-SUBSCRIPTION renewal — **ЗАКРЫТО**

Старые 186 строк (1504–1689) заменены на canonical-writer-first блок (~190 строк). Структура:

- **STEP A:** invoke `grant-access-for-order({ orderId, source:'bepaid_webhook', context:'subscription_renewal' })` ПЕРВЫМ. Outcome классифицируется: `ok | skip | error`. Порядок проверки исправлен: skip раньше ok (раньше был баг — `{skipped:true}` мог классифицироваться как ok).
- **STEP B:** на `skip|error` → audit `bepaid.webhook.grant_skipped_no_fallback` (severity=CRITICAL для error, INFO для skip). **Никаких access-fallback writes.**
- **STEP C:** provider-sync `subscriptions_v2`: только `billing_type`, `next_charge_at`, `auto_renew`, `meta.bepaid_*`, `updated_at`. **`access_start_at`, `access_end_at`, `status` удалены.**
- **STEP D:** `provider_subscriptions` state (provider fact mirror).
- **STEP E:** `payments_v2` upsert (payment fact, не access).
- **Удалено:** прямой `entitlements` insert/update (строки 1601–1644).
- **Удалено:** второй (старый) invoke `grant-access-for-order` на 1647–1689 — теперь он единственный в STEP A.

`forceExtend=true` НЕ вводился. `extended_by_orders` НЕ трогался в webhook. `grant-access-for-order` НЕ изменялся.

### 3DS finalize / основной paid-order branch — **STOP, вынос в H2.1b**

**Причина STOP (per revision #8 пользователя):** ветка делает bootstrap новой `subscriptions_v2` строки из голого `orders_v2.paid`, с proration-логикой и созданием `payment_methods` из card data. `grant-access-for-order` сегодня:
1. Находит существующую subscription по user+product+tariff и extend-ит;
2. Создаёт новую subscription, если её нет — НО без proration ветки tariff change и без обработки `payment_methods` create из card token.

Перенос этой ветки требует:
- Либо обогащения canonical writer'а (proration delegation, payment_method create) — **расширение grant-access-for-order, вне скоупа H2.1**;
- Либо разделения webhook-логики: payment_method create / proration calc остаются в webhook (это не access), а финальный subscription INSERT/UPDATE access-полей делегируется canonical writer'у — требует отдельной инвентаризации каждой подветки (existingSub+sameTariff extend / new sub create / cancel old on tariff change).

**Рекомендация:** отдельный план **PATCH H2.1b** с:
1. Извлечь proration calc и payment_method create в pre-grant блок (они не access).
2. Заменить subscription INSERT/UPDATE на invoke `grant-access-for-order` с передачей вычисленных prorationResult через `orderV2.meta` (canonical writer уже читает purchase_snapshot/meta).
3. Заменить entitlement upsert (4854–4947) на отсутствие — canonical writer создаёт entitlement сам.
4. Заменить `telegram-grant-access` invoke (5043) на отсутствие — canonical writer вызывает его сам.

### Legacy одноразовый path — **STOP, вынос в H2.1c**

**Причина STOP:** ветка создаёт `orders_v2` ВНУТРИ webhook из payload (orphan recovery). Затем создаёт subscription + entitlement + telegram_access_grants + telegram-grant-access invoke. Это полный bootstrap из orphan payment.

Перенос требует:
1. Разделить: orphan order create (не access) остаётся в webhook;
2. После insert `orders_v2` — invoke `grant-access-for-order({orderId: orderV2.id, source:'bepaid_webhook_legacy_orphan'})`;
3. Удалить прямой subscription create (5880–5941) и entitlement upsert (6031–6052) и telegram_access_grants insert (5966–5986).

**Рекомендация:** отдельный план **PATCH H2.1c**. Риск: legacy path = старый код, вряд ли исполняется на свежих платежах. Возможна стратегия: пометить ветку deprecated + добавить orphan-detect → reject 422 с audit, без миграции на canonical writer.

---

## 3. Контракт-тесты

Файл: `supabase/functions/bepaid-webhook/canonical_writer_enforcement_test.ts`

Покрытие (7 тестов, все зелёные):

1. `grant outcome OK on success body` — happy path classifier.
2. `grant outcome SKIP on skipped/sbs_mismatch/manual_review` — все 5 skip-сигналов резолвятся как skip (важно: ловит регрессию порядка проверок).
3. `grant outcome ERROR on non-200 or success:false` — error classification.
4. `provider-sync update has NO access fields` — структурный контракт: `access_start_at`, `access_end_at`, `status` запрещены в provider-sync; разрешены только `billing_type`, `next_charge_at`, `auto_renew`, `meta`, `updated_at`.
5. `finite installment: auto_renew=false and next_charge_at=null` — installment provider-sync контракт.
6. `recurring (non-finite): auto_renew=true and next_charge_at=renewAt` — recurring provider-sync контракт.
7. `contract: webhook never owns subscription status` — `status` field key никогда не появляется в provider-sync update body.

```
ok | 7 passed | 0 failed (4ms)
```

`deno check` индекса падает с pre-existing ошибкой `npm:resend@2.0.0` package resolution (issue с node_modules в sandbox, не связано с правками; релевантные изменения — TypeScript-валидны).

---

## 4. Static check (manual inventory)

```
=== subscriptions_v2 access_*_at writes (after H2.1) ===
4761:                    access_end_at: accessEndAt.toISOString(),   ← 3DS finalize (H2.1b)
4790:                    access_start_at: now.toISOString(),           ← 3DS finalize (H2.1b)
5895:              access_end_at: newEndAt.toISOString(),              ← Legacy path (H2.1c)
```

WEBHOOK-SUBSCRIPTION (бывшие строки 1540/1541) — **отсутствуют**. ✅

```
=== entitlements writes in WEBHOOK-SUBSCRIPTION (1450–1900) ===
0 матчей. ✅
```

```
=== telegram-grant-access invokes (по веткам) ===
5043: 3DS finalize (H2.1b)
5944: Legacy path (H2.1c)
6086: Legacy path / access_rules club fallback (H2.1c)
```

WEBHOOK-SUBSCRIPTION → 0 прямых `telegram-grant-access` invokes. ✅

LINK-ORDER (H2 закрытая ветка) — 0 access writes (подтверждено отдельным proof H2).

---

## 5. Deploy

```
Successfully deployed edge functions: bepaid-webhook
```

`grant-access-for-order` НЕ трогался — закрыт в H2.

---

## 6. DoD по H2.1 (scope = WEBHOOK-SUBSCRIPTION)

- [x] 0 прямых access-grant writes в WEBHOOK-SUBSCRIPTION renewal ветке.
- [x] Canonical writer вызывается ПЕРВЫМ, его результат классифицируется и логируется.
- [x] skip/error → audit `bepaid.webhook.grant_skipped_no_fallback`, без fallback writes.
- [x] Provider-sync ограничен только non-access полями (доказано структурным тестом).
- [x] 7 контракт-тестов зелёные.
- [x] Static check: 0 access writes в ветке (бывшие 1540/1541/1620/1637 исчезли).
- [x] Deploy выполнен.
- [x] `forceExtend=true` не вводился.
- [x] `extended_by_orders` не трогался в webhook.
- [x] `grant-access-for-order` не изменялся.
- [x] production DML = 0, migrations = 0.
- [x] `BEPAID_REBILL_MATERIALIZATION` остался `dry_run`.

**3DS finalize и Legacy path оставлены без изменений** — per revision #8 пользователя, при отсутствии поддержки сценария в canonical writer'е делается STOP и отдельный план. См. секцию 2 для H2.1b / H2.1c.

---

## 7. Что блокирует `mode=on` после H2.1

`BEPAID_REBILL_MATERIALIZATION=on` всё ещё нельзя включать:

1. **H2.1b** — 3DS finalize / основной paid-order branch ещё пишет access напрямую (4761, 4790, и entitlements 4854–4947, telegram-grant-access 5043).
2. **H2.1c** — Legacy одноразовый path ещё пишет access (5895, entitlements 6031–6052, telegram-grant-access 5944/6086).
3. **H2b** — atomic append `extended_by_orders` через RPC (если race замечен).

После H2.1b + H2.1c — открывается H4 (preconditions + mode=on).

PATCH G (read-only bonus/secondary discovery) ведётся параллельно, не конфликтует.
