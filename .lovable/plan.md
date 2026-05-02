Да, согласен, с учетом правок:

1. Перед backfill сделать **dry-run с точным списком 76 подписок**:
  - subscription_id, email, текущий access_start_at/access_end_at, расчётный correct_end, дельта дней.
  - отдельно показать Екатерину.
2. Не отправлять уведомления всем 76 автоматически.  
Сначала исправить даты, затем решить отдельно, кому реально нужно письмо/Telegram. Екатерине — можно, если подтверждаешь.
3. Backfill должен менять также:
  - subscriptions_[v2.next](http://v2.next)_charge_at;
  - primary entitlements.expires_at;
  - secondary product_access entitlements, если они были выровнены по этой подписке.
4. В bepaid-webhook guard должен быть не просто > 1.5 × cycle, а:
  - если bePaid candidate > локально рассчитанного expected_end + tolerance → skip;
  - логировать current_end, bepaid_active_to, expected_end, subscription_id, order_id.
5. После backfill проверить не только Club:
  - read-only аудит всех recurring-подписок с last_extension_days=30 и фактическим окном >45 дней;
  - если есть другие продукты — отдельный блок, без исправления до подтверждения.
6. Execute только после dry-run rowcount. Тут затрагиваются реальные даты доступа, поэтому без dry-run — STOP.

&nbsp;

&nbsp;

## Диагноз

**Корень бага: bepaid-webhook перезаписывает корректно посчитанный `access_end_at` данными от bePaid, которые ушли на 1 цикл вперёд.**

### Доказательная цепочка (Екатерина Ларионец, sbs_50c2b31efad2850b)

```text
11:48:25  public-checkout создал order b68bf688 (Gorbova Club BUSINESS, 250 BYN)
11:51:06  grant-access-for-order:
          - старая подписка cd740534 expired 28.04 → existingProductSub = null
          - isClubProduct=true → calcCalendarMonthEnd(2026-05-02) = 2026-06-02 12:00 ✓ ПРАВИЛЬНО
          - INSERT subscriptions_v2 64067f5d с access_end_at = 2026-06-02 12:00
11:51:06  ensure_billing_alignment trigger: corrected_to=2026-06-01 20:59
11:51:08  bepaid-webhook (event=activated) сработал, попал в блок строки 2716-2776:
          - bepaidActiveTo = "2026-07-01" ← bePaid отдаёт active_to уже на 2-й цикл вперёд
          - access_end_at = endOfDayAppTz("2026-07-01") = 2026-07-01 12:00 UTC
          - UPDATE subscriptions_v2 SET access_end_at = 2026-07-01 12:00 ✗ ПЕРЕЗАПИСАЛО
```

**Это не разовая аномалия.** Запрос показал **76 Club-подписок** с `last_extension_days=30`, но фактическим окном 60+ дней (все с `bepaid_subscription_id`). Самые ранние пострадавшие — с 20.04.26.

### Почему это происходит

bePaid API при создании recurring `/subscriptions` сразу после первого charge возвращает `active_to`, который трактуется их системой как «дата истечения подписки = дата следующего после-следующего charge» (защита от race с next_charge_at). Это **их особенность**, не наша ошибка. Наш правильный SoT — `subscriptions_v2.access_end_at`, рассчитанный в `grant-access-for-order` через `calcCalendarMonthEnd`.

Блок в `bepaid-webhook/index.ts:2716-2776` (комментарий: «Without this, renewals rely on delayed sync to update access_end_at/expires_at») был добавлен для **продлений** (renewal payments), но он не различает «первичная активация» vs «renewal» и поэтому ломает первичную выдачу.

---

## План исправления

### Шаг 1. Патч `bepaid-webhook` — сделать блок idempotent при первичной активации

В `supabase/functions/bepaid-webhook/index.ts` блок 2716-2776:

```ts
// БЫЛО: безусловная перезапись из bePaid active_to
if (bepaidActiveTo) {
  accessEndAt = new Date(endOfDayAppTz(bepaidActiveTo));
}
// UPDATE access_end_at = accessEndAt
```

```ts
// СТАЛО: 
// 1. Прочитать ТЕКУЩИЙ access_end_at у linkSubV2 (он уже посчитан grant-access-for-order)
// 2. Кандидат от bePaid: bepaidActiveTo (если есть) либо +accessDays
// 3. Применить GREATEST + sanity-cap:
//    - НЕ перезаписывать, если кандидат больше текущего более чем на 1.5 × billing_cycle_days
//      (защита от bePaid active_to-shift на 1 цикл вперёд)
//    - Если кандидат внутри окна [текущий, текущий + 1.5cycle] — применять (это renewal)
//    - Если кандидат меньше текущего — НЕ перезаписывать (entitlement_sync GREATEST)
// 4. Audit `bepaid.webhook.access_end_at_skipped_overshoot` если skip
```

`renewAt` (next_charge_at) считаем по тому же правилу.

Это **сохраняет работу для renewal-платежей** (где access_end_at двигается вперёд на 1 цикл), но **ломает overshoot на первичной активации**.

### Шаг 2. Backfill 76 пострадавших Club-подписок

Скрипт правит только подписки, где:

- `product_id = Gorbova Club`
- `meta->>bepaid_subscription_id IS NOT NULL`
- `meta->>last_extension_days = '30'`
- `(access_end_at - access_start_at) > 45 дней` (overshoot ≥ 15 дней)

Для каждой:

1. Пересчитать `correct_end = calcCalendarMonthEnd(access_start_at)` (Phase 1: +1 calendar month) — реализовать прямо в SQL через `access_start_at + interval '1 month' AT TIME ZONE 'UTC' с нормализацией часа = 12 UTC`.
2. Если `current access_end_at > correct_end + 7 дней` → UPDATE access_end_at + next_charge_at = correct_end.
3. Sync entitlements через `entitlement-sync` (GREATEST defended — но нам нужно явное СНИЖЕНИЕ, т.к. baseline неверен; используем direct UPDATE с audit).
4. Audit `subscription.access_end_at_backfill_overshoot_2026_05` с before/after.

⚠️ **Внимание**: GREATEST в entitlement-sync защищает от снижения. Здесь надо обойти эту защиту с явным audit и `force_correction=true`. Это исключение фиксирую memory-rule.

### Шаг 3. Уведомить Екатерину

Дополнительно отправить ей письмо/Telegram с правильной датой:

```text
Здравствуйте, Екатерина!

В системе была исправлена ошибка с датой окончания доступа к Gorbova Club.

✅ Правильная дата окончания доступа: 1 июня 2026, 23:59 (Минск)
✅ Следующее автосписание: 1 июня 2026

Спасибо за понимание!
```

Канал: Telegram (у неё привязан `katerinalar7`) + email (`katx@tut.by`).

Для отправки использую существующие edge-функции:

- `send-email-via-resend` для email
- `telegram-bot-message` для Telegram DM

### Шаг 4. QA в режиме симуляции

После backfill:

1. SQL-проверка: `SELECT COUNT(*) FROM subscriptions_v2 WHERE ... AND days_diff > 45` должно быть = 0.
2. Скрин карточки контакта Екатерины в `/admin/contacts` — убедиться, что подписка показывает «Доступ до: 01.06.26 23:59».
3. Скрин аудита: ленты `subscription.access_end_at_backfill_overshoot_2026_05`.

### Шаг 5. Memory-rule

Добавить `mem://architecture/subscriptions/bepaid-active-to-overshoot-guard`: 

> bePaid `/subscriptions` после первого charge возвращает `active_to`, смещённый на +1 billing cycle. SoT для access_end_at — `grant-access-for-order` → `calcCalendarMonthEnd`. `bepaid-webhook` блок 2716-2776 применяет update из bePaid ТОЛЬКО если кандидат внутри окна [current, current + 1.5 × billing_cycle], иначе skip с audit.

---

## DoD

- `bepaid-webhook` патч применён, идемпотентен, audit `bepaid.webhook.access_end_at_skipped_overshoot` для skip.
- 76 Club-подписок исправлены, у Екатерины `access_end_at = 2026-06-01 23:59` (Минск).
- Audit-batch `subscription.access_end_at_backfill_overshoot_2026_05` записан.
- Екатерине отправлено уведомление в Telegram + email.
- QA: 0 подписок с overshoot в БД, скрин карточки контакта Екатерины.
- Memory-rule добавлен.
- **Не нарушает renewal-flow**: при следующем bePaid charge access_end_at нормально продлевается на следующий цикл.

## Что НЕ входит

- Аналогичная проверка не-Club продуктов с recurring (если такие есть). Можно добавить, если ты подтвердишь, что нужно расширить scope.
- Изменения в `bepaid-get-subscription-details` (ручная синхронизация) — там GREATEST уже защищает.