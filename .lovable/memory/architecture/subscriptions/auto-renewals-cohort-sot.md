---
name: Auto-Renewals Cohort SOT
description: Канонический источник истины для когорты автопродлений и поведения уведомлений
type: feature
---

# Auto-Renewals Cohort & Notifications SOT

## SOT когорты «Автопродления»
- В таблицу/счётчики `/admin/payments/auto-renewals` попадает подписка ТОЛЬКО если соответствующий тариф имеет `tariff_offers.meta.recurring.is_recurring = true`.
- Категория продукта (`product.category`) и наличие токена карты (`auto_renew=true`) НЕ являются классификаторами — это прежние эвристики, удалены.
- Recurring-подписки попадают в когорту независимо от наличия карты:
  - bePaid (managed token) → счётчик «bePaid»
  - локальная карта → счётчик «Локальная карта»
  - без карты → счётчик «Без карты» (получают уведомления, но без авто-списания)
- Лейбл «MIT» в UI запрещён. Используется «Локальная карта» / «Без карты».

## One-time продукты
- НЕ попадают в когорту автопродлений (нет `is_recurring=true`).
- Получают только уведомления об окончании доступа через стандартный канал access-expiry, не через `subscription-renewal-reminders`.

## Уведомления 7/3/1 (зелёные точки UI)
- Канал Telegram: `telegram_logs.event_type IN (subscription_reminder_7d|3d|1d)`, статус `success`.
- Канал Email: `email_logs` с `meta.source='subscription-renewal-reminders'` и `meta.event_type IN (subscription_reminder_*)`, статус `sent`.
- Идемпотентность TG: уникальный индекс `(user_id, event_type, event_day, meta->>'subscription_id')` — у каждой подписки своё окно напоминаний.
- Антистейл-гард в `subscription-renewal-reminders` обязан читать `status` из subscriptions_v2 (без него — ложные skip всех напоминаний).

## Запрещено
- Использовать `product.category` как классификатор recurring.
- Фильтровать когорту по `auto_renew=true` (отрезает подписки без карты, у которых тоже нужны напоминания).
- Перезаписывать TG-напоминания одной строкой на пользователя, игнорируя `subscription_id`.
