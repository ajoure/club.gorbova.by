# PATCH H2.1c-i — retire legacy one-time access writes

**Дата:** 2026-05-16 (Minsk)
**Scope:** удаление прямых access/Telegram writes из `bepaid-webhook` legacy zone 2 (`if (orderStatus === 'completed' && order.user_id) { ... }`) и замена на единственную ветку `manual_review` с audit-логом.
**Status:** code + tests closed; **deploy pending approve**.

---

## Что удалено (legacy zone 2, completed-branch)

Старый блок строк ≈5378–6228 содержал 4 группы прямых writes:

1. `orders_v2.insert` + `payments_v2.insert` (создавался дубль canonical orders_v2 «из legacy»);
2. `subscriptions_v2.insert / update` (3 точки: select existing, extend, create new);
3. `entitlements.upsert` (legacy `product_code`-based, нарушает ID-first);
4. `subscriptions.update` (legacy v1, `tier/is_active/starts_at/expires_at`);
5. два `functions.invoke('telegram-grant-access', ...)` (productV2 ветка + access_rules ветка) + ручная вставка `telegram_access_grants`;
6. AmoCRM contact/deal create, GetCourse sync, admin-notify email — всё было привязано к legacy access-grant пути.

Также удалён `auto_renew=true` дефолт, который ставился на каждую subv2 INSERT в этой ветке (G8 fix — закрывается автоматически).

## Что осталось

- `orders` (legacy v1) status UPDATE — операционный, нужен для visibility legacy записи.
- `orderStatus === 'failed'` ветка с e-mail уведомлением — нетронута.
- Zone 1 (`PATCH P-LEGACY-BEPAID.1`, материализация без `orderId`/`subscriptionId`) — нетронута. Пишет только `payments_v2` + AmoCRM. Access writes отсутствовали изначально (validated by analysis + новый regression test).
- Canonical link_order ветка (3DS finalize H2.1b-ii + `WEBHOOK-LINK-ORDER` основной flow) — нетронута. Делегация в `grant-access-for-order` сохранена.

## Новая retire-ветка

```ts
if (orderStatus === 'completed' && order.user_id) {
  await supabase.from('audit_logs').insert({
    actor_user_id: order.user_id ?? '00000000-...',
    target_user_id: order.user_id ?? null,
    action: 'bepaid.webhook.legacy_one_time_retired_manual_review',
    meta: {
      reason: 'legacy_one_time_path_retired_h2_1c_i',
      transaction_uid, tracking_id (orderId), subscription_id,
      legacy_order_id, legacy_order_number,
      customer_email, amount, currency,
      product_code, product_v2_id, tariff_code,
      timestamp,
    },
  });
  return new Response(JSON.stringify({
    ok: true, status: 'manual_review',
    reason: 'legacy_one_time_path_retired',
  }), { status: 200, headers: corsHeaders });
}
```

`status: 200` критично — bePaid не будет ретраить вебхук бесконечно. Manual_review кейсы видны в `audit_logs` фильтром по `action`.

---

## Static check

```
awk 'NR>=5274 && NR<=5430' supabase/functions/bepaid-webhook/index.ts \
  | grep -E "from\('subscriptions_v2'\)\.(insert|update|upsert)|from\('entitlements'\)\.(insert|update|upsert)|from\('subscriptions'\)\.update|from\('entitlement_orders'\)\.(insert|update|upsert)|functions\.invoke\('telegram-grant-access'"
```

Результат: **0 совпадений** в zone 2 retirement-регионе. Read-only SELECT'ы (`profiles`, `subscriptions_v2` select для trial-check вне zone 2) — допустимы и не затронуты.

Тот же контроль выполняется автоматически 6 тестами в `legacy_one_time_retirement_test.ts` (по subscriptions_v2 / entitlements / entitlement_orders / subscriptions v1 / telegram-grant-access).

---

## Тесты

### bepaid-webhook: **54 passed | 0 failed** (44 existing + 10 new)

Новый файл `legacy_one_time_retirement_test.ts`:

1. retirement marker exists in zone 2
2. zone 2 has 0 `subscriptions_v2` insert/update/upsert
3. zone 2 has 0 `entitlements` insert/update/upsert
4. zone 2 has 0 `entitlement_orders` insert/update/upsert
5. zone 2 has 0 `subscriptions` (v1) update
6. zone 2 has 0 `telegram-grant-access` invokes
7. zone 2 retire-branch содержит audit action + `status: 'manual_review'` + `reason: 'legacy_one_time_path_retired'` + `status: 200`
8. canonical link_order branch (3DS finalize H2.1b-ii + `grant-access-for-order` invocation) untouched
9. zone 1 (materialization-only) regression — пишет `payments_v2`, НЕ пишет subv2/entitlements/telegram
10. failed-payment branch (resend email) сохранена

Существующие 44 теста (`canonical_writer_enforcement_test.ts` 7/7, `rebill_builders_test.ts` 16/16, `rebill_flow_test.ts` 17/17, `rebill_wiring_test.ts` 4/4) — все зелёные, регрессий нет.

### grant-access-for-order: **42 passed | 0 failed**

H2.1b-ii contract preserved:

- `extended_by_orders_dedupe_test.ts` 6/6
- `sbs_mismatch_guard_test.ts` 9/9 (Larisa fixture)
- `three_ds_writer_h2_1b_ii_test.ts` 7/7 (включая static check 3DS finalize handover)
- `three_ds_writer_test.ts` 20/20

Static check: `deno check` чистый, оба пакета компилируются.

---

## Размер изменений

- `supabase/functions/bepaid-webhook/index.ts`: **6690 → 5889 строк** (−801). Удалено 851 строк access-write кода, добавлено 50 строк retire-ветки + комментарии.
- Новый файл: `supabase/functions/bepaid-webhook/legacy_one_time_retirement_test.ts` (135 строк).

---

## Safety state

- production DML = **0**
- migrations = **0**
- secrets — без изменений
- `BEPAID_REBILL_MATERIALIZATION` = `dry_run` (не менялся)
- `mode=on` НЕ включался
- Рабчевская / другие data-repair НЕ трогались
- H2.1c legacy path / H2.1b-ii / canonical link_order — соответствующие ветки выше zone 2 не редактировались
- `grant-access-for-order` НЕ расширялся под `legacy_order_id` (по плану)

## Rollback

```
git revert <commit-hash>
```

Один коммит — одна правка `index.ts` + новый тест-файл. Откат восстанавливает старое поведение полностью (нежелательно, но возможно).

---

## Status

- **H2.1c-i code+tests** — ready for deploy
- **H2.1c-i fully closed** — only after deploy verification (audit-логи zone 2 в первые часы после deploy: ожидается 0 invocations за неделю по analysis)

После H2.1c-i:
- → **H4 preconditions** для `BEPAID_REBILL_MATERIALIZATION=on` (отдельный план + approve)
- `mode=on` остаётся **запрещён** до закрытия H4
