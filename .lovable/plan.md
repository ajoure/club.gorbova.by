Да, согласен, с учетом правок:

План согласован.

&nbsp;

Обязательные уточнения перед build:

&nbsp;

1. Не создавать новый параллельный механизм выдачи доступа.

   Использовать только существующий canonical flow:

   bePaid webhook → grant-access-for-order → subscriptions_v2 / entitlements / Telegram access / audit.

&nbsp;

2. Главный фикс:

   если recurring payment успешно прошёл, `skip_already_fulfilled` НЕ должен блокировать продление.

   Для rebill нужно продлевать существующую подписку и доступы идемпотентно.

&nbsp;

3. End-of-day invariant обязателен:

   access_end_at / expires_at = 23:59:59 Europe/Minsk нужного дня.

   Не возвращаться к точному времени платежа.

&nbsp;

4. Перед backfill:

   обязательно показать CSV/list всех пострадавших:

   user, product, tariff, payment_id, paid_at, old_access_end, expected_access_end, Telegram status.

   Execute backfill только после отдельного approve.

&nbsp;

5. По Елене Ширшовой отдельно показать proof:

   было / стало по subscription, entitlement, Telegram access, audit.

&nbsp;

6. Добавить мониторинг/alert:

   successful recurring payment без продления access_end_at в течение 15 минут = alert.

&nbsp;

7. Уведомления клиентам пока не отправлять.

   Сначала восстановить доступы и показать итоговый список.

&nbsp;

После этих правок можно начинать Diagnose/Fix/Dry-run.

&nbsp;

## План: восстановить продление подписок при rebill public-link

### Diagnose (подтверждено по аудиту Елены Ширшовой)

- public-link подписка `SUB-LINK-MNHH6TU2`, order `2e0b6eaa`, sub `a25168db`.
- 02.04.26 — первичный grant, access до 02.05.26 12:00.
- 02.05.26 13:15 — bePaid rebill с тем же `order_id`/`tracking_id`.
- `bepaid-webhook` → `grant-access-for-order` → HARD GUARD `skip_already_fulfilled` (entitlement+sub уже есть на этот `order_id`).
- Ответ `{ already_fulfilled: true, existing: { subscription_id } }` — `subscription_id` НЕ на верхнем уровне.
- В webhook: `grantedSubscriptionV2Id = grantResult?.subscription_id || grantResult?.subscription_v2_id` → `null`.
- Fallback-лукап требует `entitlements.status='active'`, но он уже `expired` → снова `null`.
- INLINE-блок продления (`access_end_at`, `entitlements`, `telegram_access`) пропущен. Деньги списаны, доступа нет.

Это регресс idempotency-guard на rebill: гвард корректно блокирует дубль первого платежа, но ломает rebill по тому же `order_id`.

### Fix-1: контракт `grant-access-for-order` (idempotent response)

`supabase/functions/grant-access-for-order/index.ts` — в ветке `skip_already_fulfilled` поднять `subscription_id` и `entitlement_id` на верхний уровень ответа, не ломая существующее поле `existing`.

### Fix-2: webhook — надёжный rebill-extend

`supabase/functions/bepaid-webhook/index.ts` (link-order ветка):

1. Расширить чтение ID:
  ```
   grantedSubscriptionV2Id =
     grantResult?.subscription_id ||
     grantResult?.subscription_v2_id ||
     grantResult?.existing?.subscription_id ||
     null;
  ```
2. Заменить fallback-лукап на надёжный по `order_id`:
  - `subscriptions_v2 WHERE order_id = linkOrder.id`
  - затем `meta->'extended_by_orders' ? linkOrder.id`
  - убрать жёсткий фильтр `entitlements.status='active'`.
3. Вычисление `accessEndAt` / `next_charge_at` выполнять ВСЕГДА при наличии `linkSubV2`, даже если grant вернул `already_fulfilled`.
4. Сохранить инварианты:
  - GREATEST по `expires_at` (Entitlement Sync Engine);
  - end-of-day Europe/Minsk (`endOfDayAppTz`) — same-day drift игнорируется;
  - overshoot guard (date-level, ≤1.5×access_days);
  - canonical write-path: только через grant + INLINE как страховка.

### Fix-3: единая точка продления — `mode: 'rebill'`

В `grant-access-for-order` добавить детектор rebill (вторая+ `payments_v2.succeeded` по тому же `order_id`) либо явный параметр `mode: 'rebill'`. В этом режиме функция:

- НЕ создаёт сущности;
- вызывает существующую `extendSubscriptionAccess(subscription_id, accessDays)`;
- пишет audit `grant-access-for-order.rebill_extended`;
- запускает sync entitlements + `telegram-grant-access` через canonical путь (см. Canonical Telegram Grant Write-Path).

INLINE-блок в webhook остаётся как страховка, но идемпотентен по дате (GREATEST + EOD Minsk).

### Backfill пострадавших

Dry-run выборка (recurring `payments_v2.succeeded` без сопровождающего `bepaid.webhook.link_order_dates_updated` в окне ±15 мин):

```
SELECT s.id sub_id, s.user_id, s.product_id, s.tariff_id,
       s.access_end_at, p.id payment_id, p.paid_at, p.amount,
       o.id order_id, o.order_number
FROM payments_v2 p
JOIN orders_v2 o ON o.id = p.order_id
JOIN subscriptions_v2 s ON s.order_id = o.id
WHERE p.status='succeeded'
  AND p.is_recurring = true
  AND p.paid_at > s.access_end_at - interval '12 hours'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.action='bepaid.webhook.link_order_dates_updated'
      AND a.meta->>'order_id' = o.id::text
      AND a.created_at BETWEEN p.paid_at - interval '5 minutes'
                           AND p.paid_at + interval '15 minutes')
ORDER BY p.paid_at DESC;
```

1. Полный список → CSV в `/mnt/documents/rebill_backfill_2026_05_dryrun.csv`.
2. Показать тебе before-execute, ждать approve.
3. По approve — для каждой строки вызвать `grant-access-for-order` (после Fix-1/2/3) с `mode='rebill'` и `idempotency_key='rebill_backfill_2026_05:{payment_id}'`.
4. Audit per row: `rebill_backfill_2026_05.fixed`.

### Verify / DoD

- Елена Ширшова: `a25168db` → `status=active`, `access_end_at` = EOD Minsk даты от bePaid `active_to`, `next_charge_at` обновлён, telegram_access продлён, новый audit `bepaid.webhook.link_order_dates_updated`.
- Backfill-выборка возвращает 0 строк.
- Smoke: повторный вызов `grant-access-for-order` для уже продлённого order → `skip_already_fulfilled` БЕЗ изменения дат.
- Новых `skip_already_fulfilled` без сопутствующего `link_order_dates_updated` для rebill-платежей не появляется (мониторинг 7 дней).
- Proof: `.lovable/proofs/rebill_idempotency_fix_2026_05.md` (diagnose, fix, dry-run CSV, execute log, verify).

### НЕ трогаем

- Первичный grant (работает корректно).
- Installment-ветку (`billing_type='mit'` + `meta.model='internal_installment'`).
- `subscriptions_v2` schema (только meta).
- Other providers, manual queue (`telegram_access_queue`).
- Same-day drift correction (закрыто `microcorrection_rollback_2026_05_03`).

После твоего approve — переключаюсь в build, делаю Fix-1/2/3, dry-run CSV backfill, показываю список, и только после второго approve выполняю backfill.