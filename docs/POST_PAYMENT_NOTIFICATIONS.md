# Post-Payment Notifications — canonical architecture

## Границы
- **Access fulfilment** (`grant-access-for-order` → `telegram-grant-access`) — открывает доступ и, если у продукта есть клуб-rule, шлёт клубный DM «✅ Доступ открыт» с кнопками входа. Не меняется.
- **Commercial notification** (`notify-order-purchased`) — отдельный слой уведомлений «Вы приобрели продукт X» по email + Telegram. Работает для всех продуктов, включая те, у которых нет клуба.

## Триггер
`grant-access-for-order` в самом конце fire-and-forget вызывает `notify-order-purchased`. Ошибки уведомления НИКОГДА не блокируют выдачу доступа.

```
paid webhook / checkout
  → grant-access-for-order
     ├─ subscriptions_v2 / entitlements / access_grant_ledger
     ├─ telegram-grant-access  (club-DM, только если у продукта есть access_rules → club)
     ├─ canonical-document-payment-hook  (документы)
     └─ notify-order-purchased  (fire-and-forget)  ← НОВОЕ
           ├─ order_notification_deliveries  (idempotency SoT)
           ├─ send-transactional-email  (шаблон product-purchased)
           └─ Telegram sendMessage через primary bot
```

## Инварианты
- Триггер уходит **только для `orders_v2.status='paid'`**. Заявки, `pending`, `failed` не уведомляем.
- Идемпотентность по паре `(order_id, channel, notification_type)` — `UNIQUE` в `order_notification_deliveries`. Повторный вызов возвращает `skipped: already_sent`.
- Ошибка одного канала не блокирует другой канал.

## Recipient resolver
| Канал | Приоритет |
|---|---|
| email | `orders_v2.customer_email` → `profiles.email` |
| telegram | `profiles.telegram_user_id` |

Если получатель отсутствует — delivery-row помечается `status='skipped'`, а не `failed`.

## Дедупликация с club-DM
Если для того же `order_id` в `telegram_messages` уже есть запись `meta.event='access_granted_dm'`, purchase-DM в Telegram НЕ отправляется (skip `club_dm_already_sent`). Обход — вызвать `notify-order-purchased` с `{ force_purchase_dm: true }`. Email отправляется всегда.

## Шаблоны на продукт
Таблица `product_notification_templates(product_id, notification_type, channel, subject_override, intro_html, intro_text, is_enabled)` — опциональные переопределения. Без записи используется дефолтный шаблон (`product-purchased.tsx` + инлайн-текст DM). Установка `is_enabled=false` отключает канал для конкретного продукта.

## Каналы и типы
- `notification_type='product_purchased'` — единый тип для разовых и подписочных покупок.
- Для рассрочки (installment) в будущем предусмотрены `installment_first_payment_received`, `installment_payment_received` — не смешивать с обычной покупкой.

## Recovery / Backfill
Разовый backfill выполняется вручную:

```bash
psql -c "SELECT id FROM orders_v2
         WHERE status='paid'
           AND created_at > now() - interval '30 days'
           AND NOT EXISTS (
             SELECT 1 FROM order_notification_deliveries
             WHERE order_id = orders_v2.id
               AND notification_type = 'product_purchased'
           );"
# Затем для каждого id:
supabase functions invoke notify-order-purchased --body '{"order_id":"..."}'
```

## Аудит
Все результаты видны в:
- `order_notification_deliveries` — по одной строке на пару (order, channel).
- `email_send_log` — `message_id = product-purchased:{order_id}`.
- `telegram_messages` — mirror сообщения (индирект через logAutomatedTelegramMessage при интеграции с botmode; в текущей реализации notify-order-purchased лог пишется в `order_notification_deliveries.provider_message_id`).

## Что НЕ трогаем
- bepaid recurring / stripe subscription resolver.
- `telegram-grant-access` (клубный DM остаётся).
- `record_refund_atomic_multi`, `grant-access-for-order` write-логика.
