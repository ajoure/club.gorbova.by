# да, согласен, с учетом правок:

&nbsp;

1. PATCH C (audit paylink) — обязательно уточнить точные места вставки в коде по факту, а не “строка 721/822/852”, т.к. номера плавают. В плане нужно формулировать как:  

  - C1: сразу после присваивания oneTimeUrl/subscriptionUrl (после ctas = ... / subscriptionUrl = ...), до ветвления отправки сообщения.
  - C2: сразу перед continue в ветке “SBS найден → skipping paylink/expiry reminder”.
  - C3: если есть второй аналогичный блок (вторая ветка генерации CTA), продублировать C1/C2.
2. &nbsp;
3. DoD SQL-пруф 3 — корректировка ожидания: не всегда “0 строк” корректно. Если функция уже генерировала paylink до фикса, в истории audit могут быть старые записи.  
В плане нужно ограничить окно по времени: created_at >= <время деплоя/запуска> или хотя бы created_at >= now() - interval '2 hours'.
4. PATCH A (fallback broad при productId!=null) — ок как “безопаснее не слать paylink”, но в плане нужно явно добавить guard от ложного suppression:  

  - fallback срабатывает только если [directPS.next](http://directPS.next)_charge_at >= now() (или >= now() - 1 day), чтобы не блокировать paylink по старым/мусорным записям.
  - и/или state IN ('active','failed_attempt','past_due') уже есть — дополнить проверкой по дате.
5. &nbsp;
6. STOP-guard при fallbackError = return true — зафиксировать как “skip reminders for user in this run”, и добавить DoD: наличие [reminders.sbs](http://reminders.sbs)_fallback_query_error должно быть 0 в окне после запуска.
7. PATCH B — ок, но “пруф поиска” в плане должен быть формализован: команда + результат (1 match) прикладывается в отчёт о выполнении.

&nbsp;

&nbsp;

После этих правок план готов к исполнению.

&nbsp;

Финальный план: hasActiveSBS fallback + audit priority + DoD-пруфы

## ADD-ONLY правило

- **PATCH A**: строка 50 (`if (!productId) return false;`) заменяется на `if (productId) { ... }` блок — строки 53-75 (product-scoped inner join) переносятся внутрь без изменений. Fallback (строки 79-98) становится безусловным.
- **PATCH B**: в audit meta меняется только значение поля `priority` — бизнес-логика не затрагивается.
- **PATCH C**: add-only audit записи `reminders.paylink_cta_generated` и `reminders.paylink_cta_suppressed_sbs` для DoD-верификации.

---

## PATCH A: hasActiveSBS — структура после правки

**Файл:** `supabase/functions/subscription-renewal-reminders/index.ts`

**Точная точка внедрения (строки 49-101):**

```typescript
async function hasActiveSBS(supabase: any, userId: string, productId: string | null): Promise<boolean> {
  let found = false;  // ← новая переменная (строка 50 заменяет `if (!productId) return false;`)

  // Product-scoped check — ТОЛЬКО если productId есть
  if (productId) {
    // === строки 53-75 без изменений, обёрнуты в if ===
    const { data, error } = await supabase
      .from('provider_subscriptions')
      .select(`id, state, subscription_v2_id,
        subscriptions_v2!inner (id, tariff_id, tariffs!inner ( product_id ))`)
      .eq('user_id', userId)
      .eq('state', 'active')
      .limit(50);

    if (error) {
      console.error('[reminders] hasActiveSBS query error:', error);
    }

    found = data && data.length > 0 && data.some((ps: any) => {
      const tariffs = ps.subscriptions_v2?.tariffs;
      return tariffs?.product_id === productId;
    });
  }
  // === конец if (productId) ===

  if (found) return true;  // строка 77 без изменений

  // === строки 79-98: fallback — теперь БЕЗУСЛОВНЫЙ ===
  // При productId=null — это ЦЕЛЕВОЕ поведение: broad check,
  // не слать paylink вообще если есть любая активная SBS у пользователя.
  // При productId!=null — это defense-in-depth для unlinked subs.
  // Осознанно НЕ фильтруем по product_id в fallback, потому что:
  //   - provider_subscriptions не имеет прямого product_id поля
  //   - определение через meta/joins ненадёжно для orphan записей
  //   - безопаснее не слать paylink, чем слать ложный
  const { data: directPS, error: fallbackError } = await supabase  // ← добавить error
    .from('provider_subscriptions')
    .select('id, state, next_charge_at')
    .eq('user_id', userId)
    .in('state', ['active', 'past_due', 'failed_attempt'])
    .not('next_charge_at', 'is', null)
    .limit(5);

  // STOP-guard: при ошибке fallback query
  if (fallbackError) {
    console.error('[reminders] hasActiveSBS fallback query error:', fallbackError);
    await supabase.from('audit_logs').insert({
      action: 'reminders.sbs_fallback_query_error',
      actor_type: 'system',
      actor_label: 'subscription-renewal-reminders',
      meta: { user_id: userId, product_id: productId, error: fallbackError.message },
    });
    // Безопасная стратегия: return true → НЕ слать paylink, скипать кейс.
    // Последствие: пользователь не получит напоминание в этом цикле.
    // Ошибка фиксируется в audit_logs для ручного разбора.
    // Альтернатива (нейтральное сообщение) не реализуется — слишком сложно
    // менять downstream sendTelegramReminder для "нейтрального" типа.
    return true;
  }

  if (directPS && directPS.length > 0) {
    const auditAction = productId
      ? 'reminders.sbs_fallback_hit'
      : 'reminders.sbs_fallback_hit_no_product';
    console.warn(`[reminders] hasActiveSBS fallback: user ${userId}, action=${auditAction}`);
    await supabase.from('audit_logs').insert({
      action: auditAction,
      actor_type: 'system',
      actor_label: 'subscription-renewal-reminders',
      meta: { user_id: userId, product_id: productId, ps_count: directPS.length },
    });
    return true;
  }

  return false;
}
```

**Зафиксированное поведение при `productId=null`:** fallback broad check — если есть любая active/past_due/failed_attempt provider_subscription с next_charge_at → `return true` → не слать paylink. Это осознанное и целевое поведение.

**Зафиксированное поведение при `fallbackError`:** `return true` → пользователь НЕ получает напоминание в этом cron-цикле. Audit log `reminders.sbs_fallback_query_error` фиксирует инцидент. При следующем cron-запуске повторная попытка. Нейтральное сообщение без ссылки не реализуется (потребовало бы рефакторинг sendTelegramReminder).

---

## PATCH B: priority '4b' → priority: 5

**Файл:** `supabase/functions/bepaid-get-subscription-details/index.ts`

**Пруф поиска по репо:**

```
ripgrep "'4b'" supabase/functions/ → 1 совпадение:
  строка 313: meta: { subscription_id, priority: '4b', error: userSubsError.message }
```

Других вхождений нет. Также проверено: строка 308 (`console.error`) содержит текст `Priority 4b` в строковом литерале — это лог, не meta-поле, оставить как есть.

**Правка строки 313:**

```
БЫЛО:  meta: { subscription_id, priority: '4b', error: userSubsError.message }
СТАЛО: meta: { subscription_id, priority: 5, autolink_source: 'user_only_single_sub', error: userSubsError.message }
```

Поле `autolink_source` (не `source`) — чтобы не конфликтовать с `source: autolinkSource` в audit success (строка ~405).

---

## PATCH C: Add-only audit для paylink CTA (источник правды для DoD)

**Файл:** `supabase/functions/subscription-renewal-reminders/index.ts`

Сейчас нет ни таблицы, ни audit action для факта генерации/подавления paylink. Telegram_logs пишет `SEND_REMINDER` с `meta.has_one_time_url` / `meta.has_subscription_url`, но нет явного события "paylink сгенерирован" vs "paylink suppressed".

**Добавить 2 audit записи:**

### C1. После генерации CTA (строка 721, после `subscriptionUrl = ctas.subscriptionUrl;`)

```typescript
if (oneTimeUrl || subscriptionUrl) {
  await supabase.from('audit_logs').insert({
    action: 'reminders.paylink_cta_generated',
    actor_type: 'system',
    actor_label: 'subscription-renewal-reminders',
    meta: {
      user_id: userId,
      product_id: productId,
      subscription_id: sub.id,
      days_left: daysLeft,
      has_one_time: !!oneTimeUrl,
      has_subscription: !!subscriptionUrl,
    },
  });
}
```

### C2. После SBS suppression (строка 822, после `console.log(... skipping ...)`)

```typescript
await supabase.from('audit_logs').insert({
  action: 'reminders.paylink_cta_suppressed_sbs',
  actor_type: 'system',
  actor_label: 'subscription-renewal-reminders',
  meta: { user_id: userId, product_id: productId, subscription_id: sub.id },
});
```

### C3. Аналогично для второго блока (строки 715-722 и 820-824) — "expiring without SBS" секция

Те же 2 audit записи в соответствующих местах (строка 852 для generated, строка 823 для suppressed).

---

## DoD — 2 независимых блока

### DoD-Reminders (suppression paylink + правильный тип уведомления)

**SQL-пруф 1: orphan provider_subscriptions**

```sql
SELECT ps.id, ps.provider_subscription_id, ps.user_id, ps.state, ps.next_charge_at, ps.subscription_v2_id
FROM provider_subscriptions ps
WHERE ps.state IN ('active', 'past_due', 'failed_attempt')
  AND ps.next_charge_at IS NOT NULL
  AND ps.subscription_v2_id IS NULL
LIMIT 10;
```

Ожидание: минимум 1 строка.

**SQL-пруф 2: suppression сработал**

```sql
SELECT id, action, meta, created_at
FROM audit_logs
WHERE action IN ('reminders.sbs_fallback_hit', 'reminders.sbs_fallback_hit_no_product', 'reminders.paylink_cta_suppressed_sbs')
ORDER BY created_at DESC
LIMIT 20;
```

Ожидание: записи для user_id из пруфа 1.

**SQL-пруф 3: paylink НЕ генерировался для orphan-юзеров**

```sql
SELECT id, action, meta, created_at
FROM audit_logs
WHERE action = 'reminders.paylink_cta_generated'
  AND (meta->>'user_id') IN (
    SELECT user_id::text FROM provider_subscriptions
    WHERE state IN ('active','past_due','failed_attempt')
      AND next_charge_at IS NOT NULL
      AND subscription_v2_id IS NULL
  )
ORDER BY created_at DESC
LIMIT 10;
```

Ожидание: 0 строк — для orphan-юзеров CTA не генерируется.

**SQL-пруф 4: fallback error (если был)**

```sql
SELECT id, action, meta, created_at
FROM audit_logs
WHERE action = 'reminders.sbs_fallback_query_error'
ORDER BY created_at DESC
LIMIT 5;
```

Ожидание: 0 строк (ошибок не должно быть). Если есть — разбор вручную.

### DoD-UI ("Доступ до" / "Следующее списание" в карточке)

**Для orphan (subscription_v2_id=NULL):**

- "Следующее списание" отображается (из `provider_subscriptions.next_charge_at`)
- "Доступ до" отображается с бейджем `provider` (из `meta.provider_snapshot.active_to`)

**Для linked (subscription_v2_id!=NULL):**

- "Доступ до" отображается без бейджа (из `subscriptions_v2.access_end_at`)
- "Следующее списание" из `provider_subscriptions.next_charge_at`

**Проверка UI refresh:**

- AdminPaymentLinkDialog → действие → список подписок обновляется без F5

---

## Файлы


| Файл                                                          | Патч | Изменение                                                                                     |
| ------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------- |
| `supabase/functions/subscription-renewal-reminders/index.ts`  | A, C | Убрать early return, if(productId) guard, fallback STOP-guard, audit CTA generated/suppressed |
| `supabase/functions/bepaid-get-subscription-details/index.ts` | B    | `priority: '4b'` → `priority: 5, autolink_source: '...'` (строка 313, единственное место)     |
