# да, согласен, с учетом правок:

&nbsp;

1. Не использовать supabase до его создания.  
В плане debug-блок вставляется “после парсинга body”, но в вашем описании “до cron loop” — проверьте реальную структуру файла: debug-блок должен стоять после создания supabase client (service role) и corsHeaders, иначе await supabase.from('audit_logs')... упадёт.  
Фикс: вставить debug-блок сразу после строки, где создаётся supabase = createClient(...) (и после source), но до любых загрузок “link bot”/cron loop.
2. Сделать debug полностью “не-шумным”: не писать production action reminders.paylink_cta_suppressed_sbs.  
Сейчас вы предлагаете писать reminders.paylink_cta_suppressed_sbs в debug. Это загрязнит прод-аналитику и будет выглядеть как реально подавленный paylink в прод-цикле.  
Фикс: в debug писать отдельное действие:  

  - reminders.orphan_dod_suppressed_sbs (вместо reminders.paylink_cta_suppressed_sbs)  
  и оставить production action только для реальных прогонов.
3. &nbsp;
4. Добавить STOP-guard от случайного “боевого” запуска debug.  
Сейчас есть только debug_dry_run === true. Этого мало, т.к. кто-то может случайно слать debug body в прод.  
Фикс: требовать source === "manual_orphan_dod" (строгое значение). Иначе 400.
5. Добавить audit-мету с provider_subscription_id (строка debug_subscription_id) и execution_id.  
Для склейки DoD:  

  - в meta писать provider_subscription_id: debugSubscriptionId
  - и execution_id (если есть заголовок X-Deno-Execution-Id, прокинуть в meta/response).
6. &nbsp;
7. UUID regex: ок, но добавить трим.  
Фикс: const debugUserId = String(body.debug_user_id || '').trim(); чтобы не упасть на пробелах.
8. DoD SQL обновить под новые debug actions.  
Раз вы отделяете debug от production (п.2), то DoD-2 должен проверять:  

  - reminders.orphan_dod_suppressed_sbs (а не reminders.paylink_cta_suppressed_sbs)  
  Остальные (started/completed/has_sbs_false) — ок.
9. &nbsp;
10. Результат debug должен возвращать hasActiveSBS и “почему”.  
hasActiveSBS сейчас возвращает boolean. Для реального разбирательства orphan лучше в debug дописать диагностический audit:  

  - reminders.orphan_dod_has_sbs_true с meta { via: "fallback|join|error_guard" }  
  (Если не хотите менять hasActiveSBS сигнатуру — хотя бы в debug дополнительно проверить orphan-факт: provider_subscriptions where user_id and subscription_v2_id is null and next_charge_at not null и записать orphan_ps_count.)
11. &nbsp;

&nbsp;

&nbsp;

Если эти правки внести — план можно исполнять без рисков загрязнить прод-события и без падений из-за порядка инициализации supabase.

&nbsp;

Plan: Debug-invoke mode for orphan DoD in subscription-renewal-reminders

## What

Add a debug mode to `subscription-renewal-reminders` that tests `hasActiveSBS` for a single user without triggering Telegram/email sends or the normal cron loop. This provides provable DoD for orphan suppression.

## Where

**File:** `supabase/functions/subscription-renewal-reminders/index.ts`

**Insertion point:** Lines 602-606, right after `body` is parsed and `source` is extracted (line 603-604). The debug block runs and returns early, before the link bot load (line 611) and cron loop (line 646).

## Changes (add-only, no existing logic modified)

### 1. Debug mode handler (insert after line 605, before line 607)

```typescript
// === DEBUG MODE: orphan DoD single-user test ===
if (body.debug_mode === true) {
  const debugUserId = body.debug_user_id;
  const debugDryRun = body.debug_dry_run;
  const debugDaysLeft = body.debug_days_left ?? 3;
  const debugProductId = body.debug_product_id ?? null;
  const debugSubscriptionId = body.debug_subscription_id ?? null;

  // STOP-guards
  if (!debugUserId || typeof debugUserId !== 'string') {
    return new Response(JSON.stringify({ error: 'debug_user_id required (UUID string)' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(debugUserId)) {
    return new Response(JSON.stringify({ error: 'debug_user_id must be valid UUID' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (debugDryRun !== true) {
    return new Response(JSON.stringify({ error: 'debug_dry_run must be true for DoD' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Audit: started
  await supabase.from('audit_logs').insert({
    action: 'reminders.orphan_dod_started',
    actor_type: 'system',
    actor_label: 'subscription-renewal-reminders',
    meta: { user_id: debugUserId, product_id: debugProductId, days_left: debugDaysLeft, source },
  });

  // Core test
  const userHasSBS = await hasActiveSBS(supabase, debugUserId, debugProductId);

  if (userHasSBS) {
    // Suppression audit (same action as production code)
    await supabase.from('audit_logs').insert({
      action: 'reminders.paylink_cta_suppressed_sbs',
      actor_type: 'system',
      actor_label: 'subscription-renewal-reminders',
      meta: {
        user_id: debugUserId, product_id: debugProductId,
        subscription_id: debugSubscriptionId, days_left: debugDaysLeft, source: 'debug',
      },
    });
  } else {
    // FAIL signal
    await supabase.from('audit_logs').insert({
      action: 'reminders.orphan_dod_has_sbs_false',
      actor_type: 'system',
      actor_label: 'subscription-renewal-reminders',
      meta: { user_id: debugUserId, product_id: debugProductId, source: 'debug' },
    });
  }

  // Audit: completed
  await supabase.from('audit_logs').insert({
    action: 'reminders.orphan_dod_completed',
    actor_type: 'system',
    actor_label: 'subscription-renewal-reminders',
    meta: {
      user_id: debugUserId, product_id: debugProductId,
      has_sbs: userHasSBS, dry_run: true, days_left: debugDaysLeft, source,
    },
  });

  return new Response(JSON.stringify({
    ok: true, mode: 'debug', userHasSBS, dryRun: true,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
// === END DEBUG MODE ===
```

### 2. No other files changed

No migrations, no new tables, no changes to existing cron logic. The debug block is a self-contained early-return before line 607.

## STOP-guards summary


| Guard            | Condition              | Response |
| ---------------- | ---------------------- | -------- |
| No user_id       | `!debugUserId`         | 400      |
| Invalid UUID     | regex fail             | 400      |
| dry_run not true | `debugDryRun !== true` | 400      |


## Post-deploy: invoke + DoD SQL

**Invoke body:**

```json
{
  "source": "manual_orphan_dod",
  "debug_mode": true,
  "debug_dry_run": true,
  "debug_user_id": "252e4b5c-8784-4876-a4ce-412444753b3a",
  "debug_days_left": 3,
  "debug_product_id": null,
  "debug_subscription_id": "sbs_2ba8ec82d7d5c39b"
}
```

**DoD-1** (started + completed): query `audit_logs` for `reminders.orphan_dod_started` / `reminders.orphan_dod_completed` with user_id filter.

**DoD-2** (suppression): query `reminders.paylink_cta_suppressed_sbs` with user_id filter. Expect ≥1 row.

**DoD-3** (no generated): query `reminders.paylink_cta_generated` with user_id filter + `created_at >= DEPLOY_TIME`. Expect 0 rows.

**DoD-4** (no fail): query `reminders.orphan_dod_has_sbs_false` with user_id filter. Expect 0 rows.

## Files


| File                                                         | Change                                         |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `supabase/functions/subscription-renewal-reminders/index.ts` | Add debug_mode block after line 605 (add-only) |
