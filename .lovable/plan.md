# План: мониторинг recurring rebill без продления доступа

## Цель

Diagnostic alert: «успешный recurring платёж прошёл, но доступ фактически не продлился». Без auto-repair. Только сигнал админу.

## Этап 1 — Discovery (без миграций)

1. Проверить существующие таблицы для алертов:
   - `system_health_alerts` — структура, поля, есть ли уникальность по ключу.
   - `system_health_reports` — подходит ли как контейнер.
   - audit_logs — какие action уже есть для rebill (`bepaid.webhook.link_order_dates_updated`, `rebill_backfill_2026_05.fixed`, `skip_already_fulfilled` и т.п.).
2. Проверить существующие cron jobs (`pg_cron`) — есть ли уже похожие 15-минутные мониторы, чтобы не дублировать.
3. Проверить `telegram-notify-admins` — формат aggregated-сообщения, лимиты.
4. Подтвердить: новую таблицу создаём ТОЛЬКО если существующие не подходят.

Discovery → отдельный отчёт перед миграцией.

## Этап 2 — Detection logic

**Главный критерий (SOT):**

```
payment.status = 'succeeded'
AND payment.is_recurring = true
AND subscription.access_end_at <= expected_end_at_minsk
```

где `expected_end_at_minsk = endOfDayAppTz(paid_at + access_days)` (Europe/Minsk, 23:59:59).

**Audit `bepaid.webhook.link_order_dates_updated`** — диагностическое поле в alert (`audit_present: true/false`), НЕ единственный фильтр.

**Окно cron:** платежи старше 15 минут и не старше 24 часов.
**Окно dry-run:** параметризуется до 7 дней (для бэкаудита).

**Обязательные исключения:**
- `subscriptions_v2.meta->>'model' = 'internal_installment'` или `billing_type IN ('mit')` с installment-маркером;
- `subscriptions_v2.status IN ('canceled','superseded','refunded')`;
- payments с уже существующим audit `rebill_backfill_*.fixed` или `manual_repair.*`;
- same-day drift: `date_trunc('day', access_end_at AT TIME ZONE 'Europe/Minsk') = date_trunc('day', expected_end_at AT TIME ZONE 'Europe/Minsk')` → **не алертим** (закрыто `microcorrection_rollback_2026_05_03`);
- не-bePaid провайдеры.

## Этап 3 — Alert payload

Поля per alert (idempotent по `payment_id`):
- `payment_id`, `order_id`, `subscription_id`, `user_id`, `email`
- `product_id` + name, `tariff_id` + name
- `paid_at`, `access_days`
- `current_access_end_at`, `expected_access_end_at_minsk`, `gap_hours`
- `audit_link_order_dates_updated_present` (диагностика)
- `reason` enum: `no_extension` / `partial_extension` / `audit_missing_with_drift`
- `created_at`

## Этап 4 — Notification

- Telegram: **aggregated message per tick** (один пост со списком), не по одному на платёж.
- Если 0 кандидатов — ничего не отправляем (silent OK).
- Формат: count + top-N строк + ссылка на admin view.
- Reuse `telegram-notify-admins`.

## Этап 5 — Cron

`pg_cron` каждые 15 минут → edge function `monitor-rebill-no-extension`.
Функция:
1. Запускает SELECT detection-логики (окно 15м–24ч).
2. Для каждого нового кандидата (нет alert по этому `payment_id`) — INSERT в alerts table.
3. Если есть новые → один aggregated Telegram-пост.
4. **No auto-repair.** Только запись + нотификация.

## Этап 6 — Execute порядок

1. Discovery → отчёт.
2. Dry-run за 7 дней → CSV `/mnt/documents/rebill_monitor_dryrun_2026_05.csv` + список «какой alert был бы создан».
3. Approve от тебя.
4. Миграция (alerts table если нужна + cron) + deploy edge function.
5. Verify: 1-я итерация cron → 0 новых alert (после Fix-1/2/3 и backfill Ширшовой пострадавших нет).
6. Smoke: искусственно отметить тестовый платёж → проверить, что alert создаётся и приходит в Telegram.

## DoD

- Discovery-отчёт с решением «новая таблица / переиспользуем».
- Dry-run CSV с 0 false positives после фиксов.
- Cron активен, edge function deployed.
- Telegram aggregated alert работает.
- Repair кнопка/ручная процедура — отдельная follow-up задача (вне этого плана).
- Proof: `.lovable/proofs/rebill_monitoring_alert_2026_05.md` — discovery, схема, dry-run, smoke-тест.

## НЕ трогаем

- `grant-access-for-order` / `bepaid-webhook` (Fix-1/2/3 уже задеплоены).
- Installment-ветку.
- Same-day drift correction.
- Auto-repair — explicit out of scope.

После approve — переключаюсь в build, начинаю с Discovery без миграций.
