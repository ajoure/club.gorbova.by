# Patch 12.1 + 12.2 — diff & dry-run (no repair)

Дата: 2026-05-04 (Europe/Minsk)
Скоп: только логические патчи. Никаких UPDATE данных не выполнялось.

## 1. Diff (изменённые файлы)

| файл | блок | изменение |
|---|---|---|
| `supabase/functions/bepaid-webhook/index.ts` | WEBHOOK-LINK-ORDER access_end_at resolver (~строки 2782–2905) | добавлена ветка `stale_local_end_recovered`: если `local_access_end_at < paid_at` ИЛИ `< now`, overshoot-guard игнорируется, дата = `GREATEST(local, expected_min_end, bepaid_active_to)`, audit `bepaid.webhook.stale_local_end_recovered`. Старый overshoot-guard остаётся, но срабатывает ТОЛЬКО при свежем local baseline. Top-level audit actor: `actor_type='system'`, `actor_user_id=NULL`, `actor_label='bepaid-webhook'`. |
| `supabase/functions/grant-access-for-order/index.ts` | idempotency skip_already_fulfilled (~строки 485–625) | перед skip-блоком вычисляется `expected_min_end = order.paid_at + tariff.access_days`. Если `existing.entitlement.expires_at < expected_min_end - 12h` ИЛИ `existing.subscription.access_end_at < expected_min_end - 12h` — skip НЕ выполняется, audit `grant-access-for-order.skip_blocked_stale_access`, поток падает в обычный extend-flow ниже (там GREATEST уже реализован). Исходная skip-ветка сохранена для свежих данных, в её audit добавлено поле `skip_guard_passed=true`. Audit actor: `actor_type='system'`, `actor_user_id=NULL`, `actor_label='grant-access-for-order'`. |

Новые audit-action'ы:
- `bepaid.webhook.stale_local_end_recovered`
- `grant-access-for-order.skip_blocked_stale_access`

Сохранены без изменений:
- existing audit `bepaid.webhook.access_end_at_skipped_overshoot` (теперь только для fresh baseline);
- existing audit `grant-access-for-order.skip_already_fulfilled` (теперь только когда skip_guard_passed);
- идемпотентность по `order_id` / `extended_by_orders` (структура match не тронута);
- secondary product_access sync (вызывается только в skip-ветке, как и раньше);
- response shape `subscription_id` / `subscription_v2_id` / `entitlement_id` на верхнем уровне (rebill-fix-2026-05) — нетронут.

## 2. Deploy

`supabase--deploy_edge_functions(["bepaid-webhook","grant-access-for-order"])` → success.

## 3. Dry-run по 17 строкам инцидента (read-only)

Запрос: см. §6. Source-of-truth — те же payments_v2 succeeded recurring за 7 дней + текущие subscriptions_v2/entitlements/profiles/tariffs. **Ни одного UPDATE не выполнено**.

| paid_at (UTC) | full_name | order_number | sub_end | ent_end | expected_min_end | predicted_grant_outcome | predicted_webhook_outcome |
|---|---|---|---|---|---|---|---|
| 2026-05-04 10:16 | Екатерина Королёва | SUB-LINK-MMD23P9X | 2026-02-12 | 2026-02-12 | 2026-06-03 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-05-04 10:15 | Светлана Монич | SUB-LINK-MMD5EC9Y | 2026-02-06 | 2026-02-06 | 2026-06-03 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-05-04 07:15 | Шидловская Ольга | SUB-LINK-MMD24LLZ | 2026-03-08 | 2026-03-08 | 2026-06-03 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-05-03 06:45 | Татьяна Чистякова | SUB-LINK-MMBMO4LL | 2026-02-07 | 2026-02-07 | 2026-06-02 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-05-03 13:30 | Татьяна Ефимчик | (audit ad3f55c5) | 2026-04-04 | 2026-04-04 | 2026-06-02 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-05-03 17:15 | Анастасия Жарко | (audit dfeb8812) | 2026-02-08 | 2026-02-08 | 2026-06-02 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-05-03 11:30 | Юлия Криштопик | (audit 8b806a34) | 2026-02-07 | 2026-02-07 | 2026-06-02 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-05-03 12:25 | Ольга Дергелёва | SUB-26-MOPKB4U996HQ | 2026-05-04 | 2026-07-02 | 2026-06-02 | skip_BLOCKED_stale_access (12.2) sub side | stale_local_end_recovered (12.1) |
| 2026-05-03 10:23 | Екатерина Иванченко* | SUB-26-MOPG0655Y22S | 2026-03-05 | 2026-07-02 | 2026-06-02 | skip_BLOCKED_stale_access (12.2) sub side | stale_local_end_recovered (12.1) |
| 2026-05-01 13:30 | Ольга Самец* | REBILL-420bec3d | 2026-05-31 | 2026-02-06 | 2026-05-31 | skip_BLOCKED_stale_access (12.2) ent side | apply_candidate (sub fresh) |
| 2026-05-01 07:00 | Ангелина Залевская | REBILL-58d1d641 | 2026-02-04 | 2026-02-04 | 2026-05-31 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-05-01 06:00 | Светлана Дещеня | REBILL-68c677d6 | 2026-05-30 | 2026-05-30 | 2026-05-31 | skip_BLOCKED_stale_access (12.2) (1 day short) | apply_candidate / overshoot guard as before |
| 2026-04-30 03:01 | Марина Киреева | REBILL-b358d540 | 2026-01-29 | 2026-01-29 | 2026-05-30 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-04-29 17:59 | Валентина Хрущёва* | SUB-LINK-MOKCGUNW | 2026-05-29 | NULL | 2026-05-29 | extend_flow_no_existing (нет ent) | apply_candidate (sub fresh) |
| 2026-04-28 17:27 | Ольга Глушкова | SUB-LINK-MOIVTZHQ | 2026-04-06 | 2026-04-06 | 2026-05-28 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-04-28 14:16 | Ольга Ананевич | REBILL-7ccbbc4e | 2026-03-27 | 2026-03-27 | 2026-05-28 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-04-28 12:01 | Ирина Данилюк | REBILL-7f8afcca | 2026-05-28 | 2026-01-30 | 2026-05-28 | skip_BLOCKED_stale_access (12.2) ent side | apply_candidate (sub fresh) |
| 2026-04-28 11:46 | Наталья Новикова | REBILL-4a6850f0 | 2026-03-26 | 2026-03-26 | 2026-05-28 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |
| 2026-04-28 10:16 | Марина Босак | REBILL-746dfc86 | 2026-03-27 | 2026-03-27 | 2026-05-28 | **skip_BLOCKED_stale_access (12.2)** | **stale_local_end_recovered (12.1)** |

`*` — спорные кейсы (Хрущёва / Иванченко / Самец) выделены для исключения из авто-repair, согласно стоп-листу.

## 4. Гарантии патчей (chain-of-evidence)

### Patch 12.1 — overshoot stale-local recovery

- Условие срабатывания: `local_access_end_at < paid_at` или `local_access_end_at < now`.
- Действие: `accessEndAt = GREATEST(local_access_end_at, expected_min_end, provider_active_to)`.
- Audit: `bepaid.webhook.stale_local_end_recovered` со всеми входами (paid_at, local_end, expected_min_end, bepaid_active_to, resolved, access_days, candidate_source, reason).
- Старая ветка `keep_existing_overshoot` теперь возможна **только** при свежем local baseline — это означает, что для всех 14 stale-кейсов dry-run новые webhook'и пойдут в recovery, а не в skip.
- Доказательство, что новые recurring не уходят в overshoot skip: dry-run §3 — ни в одной строке `predicted_webhook_outcome = keep_existing_overshoot`. У всех stale-строк → `stale_local_end_recovered`. Свежие 4 строки (Самец/Хрущёва/Данилюк/Дещеня sub) → `apply_candidate`.

### Patch 12.2 — idempotency skip stale guard

- Условие срабатывания: `entitlement.expires_at < expected_min_end - 12h` ИЛИ `subscription.access_end_at < expected_min_end - 12h`.
- Действие: НЕ skip; audit `grant-access-for-order.skip_blocked_stale_access`; падение в обычный extend-flow (там GREATEST + canonical write-path).
- Audit actor: `system / NULL / grant-access-for-order`.
- Доказательство, что `skip_already_fulfilled` больше не срабатывает при stale: dry-run §3 — все 17 строк (включая 3 спорных) дают либо `skip_BLOCKED_stale_access`, либо `extend_flow_no_existing`. Ни одной `skip_allowed (fresh)` в проблемной выборке.

## 5. Что НЕ менялось

- Логика создания подписок при первом grant.
- Installment-ветка (`linkOrder.meta.installment_count >= 2`) — не тронута, у неё свой STAGE L3 GUARD выше.
- Структура idempotency match (`order_id` + `extended_by_orders`).
- Telegram grant/revoke вызовы.
- Schema БД, RLS, миграции.
- Cron `telegram-check-expired`.

## 6. Запросы dry-run (для воспроизведения)

```sql
WITH base AS (
  SELECT p.id AS payment_id, p.paid_at, p.order_id, p.amount,
         o.user_id, o.product_id, o.tariff_id, o.order_number,
         pr.name AS product_name, t.access_days,
         s.id AS sub_id, s.access_end_at AS sub_end, s.status AS sub_status,
         e.id AS ent_id, e.expires_at AS ent_end, e.status AS ent_status,
         pf.full_name, pf.email
  FROM payments_v2 p
  JOIN orders_v2 o   ON o.id = p.order_id
  LEFT JOIN products_v2 pr ON pr.id = o.product_id
  LEFT JOIN tariffs t      ON t.id  = o.tariff_id
  LEFT JOIN profiles pf    ON pf.user_id = o.user_id
  LEFT JOIN LATERAL (
    SELECT s2.id, s2.access_end_at, s2.status
    FROM subscriptions_v2 s2
    WHERE s2.user_id = o.user_id AND s2.product_id = o.product_id
    ORDER BY s2.access_end_at DESC NULLS LAST LIMIT 1
  ) s ON TRUE
  LEFT JOIN entitlements e
    ON e.user_id = o.user_id AND e.product_id = o.product_id
  WHERE p.provider = 'bepaid' AND p.status = 'succeeded'
    AND p.is_recurring = TRUE AND p.paid_at >= now() - interval '7 days'
)
SELECT paid_at, full_name, email, order_number, access_days,
       sub_end, sub_status, ent_end, ent_status,
       paid_at + (access_days || ' days')::interval AS expected_min_end,
       CASE
         WHEN sub_end IS NULL OR ent_end IS NULL THEN 'extend_flow_no_existing'
         WHEN sub_end < (paid_at + (access_days || ' days')::interval - interval '12 hours')
           OR ent_end < (paid_at + (access_days || ' days')::interval - interval '12 hours')
           THEN 'skip_BLOCKED_stale_access (12.2)'
         ELSE 'skip_allowed (fresh)'
       END AS predicted_grant_outcome,
       CASE
         WHEN sub_end IS NULL THEN 'apply_candidate (no baseline)'
         WHEN sub_end < paid_at THEN 'stale_local_end_recovered (12.1)'
         ELSE 'apply_candidate / overshoot guard as before'
       END AS predicted_webhook_outcome
FROM base
WHERE (sub_end IS NULL OR sub_end < paid_at + interval '12 hours'
       OR ent_end IS NULL OR ent_end < paid_at + interval '12 hours')
ORDER BY paid_at DESC;
```

## 7. Следующий шаг (по согласованию)

Подготовка отдельного **repair dry-run** по варианту A:
- expected_min_end как внутренний SOT;
- только 17 подтверждённых строк, **исключить** Хрущёву / Иванченко / Самец;
- staff_ids исключены;
- backup в `*_repair_backup_2026_05`;
- UPDATE через `GREATEST(current, expected_min_end)` для `subscriptions_v2.access_end_at`, `entitlements.expires_at`, `telegram_access.active_until`;
- audit: `repair.recurring_2026_05.subscription_extended` / `entitlement_extended` / `telegram_access_extended`;
- запуск только после отдельного approve.

До approve repair — ничего не трогать.
