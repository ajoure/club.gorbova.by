# да, согласен, с учетом правок:

&nbsp;

1. PATCH-3 (webhook) — правка про “хардкод canceled” обязательна и точнее  

  - В твоём тексте: «обновить state в provider_subscriptions … вместо хардкода 'canceled' (строка 1796)».
  - Уточнение: не только provider_subscriptions, но и audit meta (если там фиксированное значение), и любые поля где сейчас пишется 'canceled' как константа. Должно всегда писаться фактическое subscriptionState.
  - DoD: показать diff/фрагмент кода до/после по этому месту.
2. &nbsp;
3. PATCH-2 (backfill) — STOP-guard по “не трогать доступы” добавить явно  

  - В UPDATE на subscriptions_v2 обновлять только auto_renew (+ updated_at).
  - DoD: в отчёте приложить select до/после по 3 подпискам: access_end_at идентичен.
4. &nbsp;
5. PATCH-1 (data fix) — нужен “dry-run execute” формат  

  - Не просто “dry-run SQL список”, а два шага:  

    - Dry-run: SELECT (как у тебя) + count.
    - Execute: UPDATE + RETURNING (sub_v2_id, old_auto_renew, new_auto_renew, ps_state) или отдельный SELECT после.
  - &nbsp;
  - DoD: повторный dry-run = 0 строк.
6. &nbsp;
7. PATCH-2 — existingMap / идентификаторы  

  - В meta provider_subscription_id: [sub.id](http://sub.id) — убедиться, что это provider_[subscriptions.id](http://subscriptions.id), а не внешний uid. Если нужен внешний — добавить отдельным полем provider_subscription_uid из raw/bePaid.
  - DoD: meta должна однозначно ссылаться на запись provider_subscriptions.
8. &nbsp;
9. Итоговый отчёт (одним артефактом)  

  - В конце один блок “VERIFY” с 4 проверками из твоего списка + скрин/вывод audit_logs по action billing.inv22.autorenew_disabled_from_provider_state (минимум 3 строки).
10. &nbsp;

&nbsp;

&nbsp;

Текст для [Lovable.dev](http://Lovable.dev) можно отправлять как есть, добавив эти 5 правок как “обязательные”.

&nbsp;

INV-22: Проталкивание terminal provider states в subscriptions_v2

## Три патча

### PATCH-1: Data fix (единоразовый)

**Dry-run** — SQL-отчёт всех затронутых строк:

```sql
SELECT s.id as sub_v2_id, s.user_id, ps.state as ps_state, 
       s.auto_renew, s.status, s.access_end_at
FROM subscriptions_v2 s
JOIN provider_subscriptions ps ON ps.subscription_v2_id = s.id
WHERE s.auto_renew = true
  AND s.status IN ('active','trial')
  AND ps.state IN ('expired','canceled','failed','redirecting')
```

**Execute** — для каждой найденной строки:

- `subscriptions_v2.auto_renew = false`, `updated_at = now()`
- НЕ трогаем `access_end_at`, entitlements, гранты
- `audit_logs`: action=`billing.inv22.autorenew_disabled_from_provider_state`, actor_type=`system`, actor_label=`inv22-fix`, meta с sub_v2_id, ps_state, reason

**DoD**: повторный dry-run → 0 строк.

---

### PATCH-2: Backfill propagation

**Файл**: `supabase/functions/admin-bepaid-backfill-subscriptions/index.ts`

После строки 445 (конец блока `if (state === "active")`) добавить зеркальный блок:

```
if (['expired','canceled','failed','redirecting'].includes(state)) {
  const existing = existingMap.get(sub.id);
  if (existing?.subscription_v2_id) {
    const { data: linkedSub } = await serviceClient
      .from("subscriptions_v2")
      .select("id, auto_renew")
      .eq("id", existing.subscription_v2_id)
      .eq("auto_renew", true)  // STOP-guard
      .maybeSingle();
    if (linkedSub) {
      await serviceClient.from("subscriptions_v2")
        .update({ auto_renew: false, updated_at: new Date().toISOString() })
        .eq("id", linkedSub.id);
      await serviceClient.from("audit_logs").insert({
        actor_type: 'system', actor_user_id: null,
        actor_label: 'admin-bepaid-backfill-subscriptions',
        action: 'billing.inv22.autorenew_disabled_from_provider_state',
        meta: { subscription_v2_id: linkedSub.id,
                provider_subscription_id: sub.id,
                ps_state: state, reason: 'terminal_provider_state' }
      });
      result.terminal_auto_renew_disabled = (result.terminal_auto_renew_disabled || 0) + 1;
    }
  }
}
```

Счётчик `terminal_auto_renew_disabled` добавляется в итоговый audit log meta.

---

### PATCH-3: Webhook — расширить terminal states

**Файл**: `supabase/functions/bepaid-webhook/index.ts`, строка 1788

Текущее условие:

```ts
} else if (subscriptionState === 'canceled' || subscriptionState === 'expired') {
```

Заменить на:

```ts
} else if (['canceled','expired','failed','redirecting'].includes(subscriptionState)) {
```

Остальная логика блока (auto_renew=false, audit_log) уже корректна — она не трогает access_end_at и entitlements. Только обновить `state` в provider_subscriptions на фактический `subscriptionState` вместо хардкода `'canceled'` (строка 1796).

---

## P0 ограничения (контрольный чеклист)

- ❌ Создание/удаление entitlements
- ❌ Изменение access_end_at
- ❌ Массовые UPDATE без dry-run
- ❌ Даунгрейд auto_renew=false → true

## Файлы


| Действие      | Файл                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| Data fix      | SQL UPDATE через insert tool (с dry-run до и после)                                                   |
| Edit          | `supabase/functions/admin-bepaid-backfill-subscriptions/index.ts` — terminal state → auto_renew=false |
| Edit + Deploy | `supabase/functions/bepaid-webhook/index.ts` — добавить failed/redirecting                            |


## Verify (после всех патчей)

1. SQL: 0 строк с ps.state terminal + s.auto_renew=true
2. audit_logs: записи с action `billing.inv22.autorenew_disabled_from_provider_state`
3. access_end_at: выборка до/после по 3 примерам — не изменился
4. Негативный тест: ps.state=active → auto_renew не тронут