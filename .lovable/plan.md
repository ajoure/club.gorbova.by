## да, согласен, с учетом правок:

## 1. Не включать admin-уведомления в Sprint C2

Sprint C2 уже закрыт:

```text
Sprint C2 overall: VERIFIED, PASS — CLOSED

```

Admin-уведомления оформить отдельной задачей, например:

```text
PATCH-ADMIN-PURCHASE-NOTIFY-V1

```

Обновить существующий `.lovable/plan.md`. Новый `docs/audit/*.md` не создавать.

---

## 2. Очистка: сначала только dry-run

Текущие критерии слишком широкие. Не использовать самостоятельный `OR` по `test_fixture`, названию продукта или периоду.

Сначала сформировать **точный UUID allowlist**:

- dedicated Stage E/F test product;
- его tariff и offer;
- конкретные test-order IDs;
- связанные payment/source/event/delivery IDs.

Отдельно показать:


| Таблица                         | Count  | Примеры ID | Сумма  |
| ------------------------------- | ------ | ---------- | ------ |
| `orders_v2`                     | &nbsp; | &nbsp;     | &nbsp; |
| `payments_v2`                   | &nbsp; | &nbsp;     | amount |
| `entitlement_sources`           | &nbsp; | &nbsp;     | &nbsp; |
| `provider_events`               | &nbsp; | &nbsp;     | &nbsp; |
| `order_notification_deliveries` | &nbsp; | &nbsp;     | &nbsp; |
| `telegram_messages`             | &nbsp; | &nbsp;     | &nbsp; |
| CRM-записи                      | &nbsp; | &nbsp;     | &nbsp; |


В dry-run обязательно доказать, что ни один target-order:

- не относится к трём действующим CB-офферам;
- не имеет реального provider transaction ID;
- не связан с нетестовым продуктом;
- не входит в ORD-26-00296/297/298 и другие реальные CB-заказы.

### Не удалять автоматически

- `access_grant_ledger` — это immutable audit log;
- `audit_logs`;
- реальные CB orders/payments;
- профили по совпадению email или телефона.

`telegram_messages` сейчас пропущена в cleanup-списке — добавить выборку по `meta.source_order_id`.

### Stop-condition

Для one-off RR test-product ожидается:

```text
subscriptions_v2 count = 0
profiles created by flow = 0

```

Если найдены subscription или новый profile/contact, не удалять их автоматически — остановиться и диагностировать причину.

`rr_test_ledger` не очищать целиком. Удалять только строки, однозначно связанные с утверждённым набором тестовых заявок. Полная очистка может удалить доказательства других тестов.

После dry-run требуется отдельное явное подтверждение DELETE.

---

## 3. DELETE выполнять транзакционно и с assertions

Не просто набор последовательных DELETE, а один guarded transaction:

```text
BEGIN
→ materialize exact target UUIDs
→ assert expected order count
→ assert exact product/offer IDs
→ delete dependants
→ recalculate affected entitlements
→ delete target orders
→ assert target rows = 0
→ COMMIT

```

Для shared real product агрегат `entitlements` не удалять. После удаления или revoke test-source вызвать `recalculate_entitlement_aggregate`.

Тестовые определения product/tariff/offer оставить деактивированными.

---

## 4. Перед `telegram_admin` требуется закрыть security blocker

Сейчас `notify-order-purchased` настроена как `verify_jwt=false`, а внутри функции отсутствует проверка вызывающей стороны.

После добавления admin-канала публичный вызывающий смог бы:

- повторно запускать уведомления;
- использовать `force=true`;
- рассылать сообщения администраторам по известному order ID.

До реализации канала:

1. Установить `verify_jwt=true`.
2. Разрешить вызов только с service-role JWT либо отдельным internal secret.
3. Убедиться, что `grant-access-for-order` передаёт service-role Authorization.
4. Пользовательский authenticated JWT не должен иметь право вызвать функцию.

Операционные ошибки каналов остаются non-fatal, но неавторизованный вызов должен получать `401/403`.

---

## 5. Идемпотентность нужно реализовать отдельно для admin recipients

Сейчас canonical guard рассчитан на одну доставку каждого канала:

```text
(order_id, channel, notification_type)

```

И lookup delivery также не учитывает recipient.

Простое добавление `telegram_admin` позволит сохранить только одного администратора.

Нужна миграция с сохранением текущей семантики:

```text
buyer channels:
UNIQUE (order_id, channel, notification_type)
WHERE channel IN ('email', 'telegram')

admin channel:
UNIQUE (order_id, channel, notification_type, recipient)
WHERE channel = 'telegram_admin'

```

Также проверить и при необходимости расширить CHECK/enum для `channel`.

`upsertDelivery` должен:

- для email/telegram работать как сейчас;
- для `telegram_admin` искать строку с обязательным `recipient`;
- создавать отдельную delivery на каждого Telegram recipient.

---

## 6. Роли не хардкодить как `super_admin`

Сначала прочитать фактический role source. В действующем коде используется значение:

```text
admin
superadmin

```

а не `super_admin`.

Получателей выбирать из canonical role table/helper:

- только действующие `admin` и `superadmin`;
- profile имеет `telegram_user_id`;
- `DISTINCT` по Telegram ID;
- пользователь с двумя ролями получает одно сообщение.

До discovery не фиксировать `user_roles_v2` как гарантированное имя таблицы.

---

## 7. Патч `notify-order-purchased`

Расширить order SELECT полями, которых сейчас не хватает для admin message:

```text
provider
customer_phone

```

Для каждого администратора:

- создать `telegram_admin` delivery;
- отправить primary bot;
- отметить `sent` либо `failed`;
- записать `provider_message_id`;
- зеркалировать в `telegram_messages`.

Для admin mirror использовать:

```text
user_id = admin profile.user_id
telegram_user_id = admin telegram_user_id
meta.event = admin_product_purchased_dm
meta.source_order_id = order_id

```

Текущий mirror покупателя записывается именно после успешной Telegram-доставки; этот паттерн можно переиспользовать.

Нужен отдельный unique guard mirror:

```text
(source_order_id, admin user_id, event='admin_product_purchased_dm')

```

Все interpolated значения экранировать для Telegram HTML:

- product/tariff;
- email/phone;
- order number;
- provider.

Admin sends не запускать как необработанный background `fire-and-forget`. Использовать awaited `Promise.allSettled` с обработкой каждого recipient. Ошибка одного администратора не блокирует покупателя и остальных администраторов.

---

## 8. Устранить дубли bePaid

Нельзя одновременно:

- оставить purchase-вызовы `telegram-notify-admins` в bePaid;
- добавить canonical `telegram_admin` для bePaid.

Администратор получит два сообщения, а старый вызов не участвует в новом idempotency guard.

Допустимы два варианта:

### Предпочтительный

В этой же задаче удалить **только purchase-success вызовы** `telegram-notify-admins` из `bepaid-webhook`. Диагностические и системные вызовы оставить.

### Временный

Исключить `provider='bepaid'` из нового admin-канала до отдельной миграции.

Публиковать одновременную двойную рассылку нельзя.

---

## 9. Финальный smoke

Использовать только временно реактивированный Stage F test-offer на 50 BYN. Live offer не использовать.

Проверять срок по canonical правилу:

```text
entitlement_source.expires_at
= entitlement_source.starts_at + tariffs.access_days

```

Не от `paid_at`.

Для каждого admin recipient показать отдельную строку:

```text
telegram_admin / recipient / sent|failed / provider_message_id

```

Повтор webhook:

- payments без роста;
- entitlement sources без роста;
- buyer deliveries без роста;
- admin deliveries без роста;
- Telegram mirrors без роста.

После smoke test entities снова деактивировать. Один финальный order можно оставить как явно помеченный canonical proof; если требуется ноль тестовых строк, для него нужен второй отдельный dry-run и подтверждение удаления.

---

## Ответы на открытые вопросы

1. **Разово реактивировать тестовый offer.** Действующий live offer не использовать.
2. **CRM-контакт оставить.** Удалять только если dry-run докажет, что он отдельно создан как test fixture, явно помечен и не имеет ни одной нетестовой связи. По email/phone applicant контакт не удалять.

## Уточнённый порядок

```text
закрыть C2 в существующем plan.md
→ dry-run cleanup
→ явное подтверждение
→ guarded cleanup
→ harden notify-order-purchased auth
→ migration channel/index/mirror idempotency
→ telegram_admin patch
→ устранить bePaid duplicate path
→ deploy
→ browser smoke
→ повтор webhook
→ deactivate test entities
→ отчёт PATCH-ADMIN-PURCHASE-NOTIFY-V1


План: закрытие Sprint C2 + очистка тестовых данных + admin-уведомления при покупке
```

### 1. Закрытие Sprint C2 (документация)

Обновить `.lovable/plan.md` (или создать `docs/audit/2026-07-12-sprint-c2-closed.md`) с итоговой формулировкой пользователя:

- Sprint C2 Stage B/C/D/E/F: VERIFIED, PASS
- Sprint C2 overall: VERIFIED, PASS — CLOSED
- Оговорка о failed-сценарии: `canonical runtime proof PASS; provider-driven not_created в RR test-mode не воспроизведён; reconciler safe-no-op подтверждён`
- Реальный REJECTED/CANCELLED/EXPIRED от РР — отдельное production observation, не блокирующее.

Никаких кодовых изменений в рамках закрытия не требуется.

### 2. Очистка тестовых данных

Инвентаризация тестовых артефактов и удаление через один DELETE-миграционный пакет (в правильном порядке FK).

Критерии тестовых записей (пересекающийся набор):

- `orders_v2.meta->>'test_fixture' = 'true'` ИЛИ `meta ? 'test_fixture_run'`
- `orders_v2` привязанные к деактивированному тестовому product/tariff/offer, созданному в Stage E runtime
- Соответствующие `payments_v2` (по `order_id`)
- `entitlement_sources` (по `order_id`)
- `entitlements` — пересчёт агрегата (не удаляем строки, а вызываем rebuild-RPC или удаляем только те, где не остаётся источников)
- `access_grant_ledger` (по `order_id`)
- `provider_events` (по `related_order_id`)
- `order_notification_deliveries` (по `order_id`)
- `subscriptions_v2` (по `order_id`)
- `crm_activity_log` / `crm_tasks` тестовые (по `order_id`)
- `rr_test_ledger` — очистка полностью (это тестовая таблица по определению)
- CRM сделки/контакты, созданные под тестового applicant (`profiles`/сделки, помеченные как test — уточняется через SELECT перед удалением)

Порядок работы:

1. **Dry-run SELECT** — вывести все идентификаторы, которые будут затронуты (по каждой таблице count + примеры), пользователю на подтверждение перед DELETE.
2. **Реальные записи не трогаем** — CB, живые заказы, боевые платежи остаются.
3. **DELETE-миграция** — только после явного OK пользователя после dry-run.
4. Продукт/тариф/offer оставляем деактивированными (не удаляем), т.к. это тестовые определения, но без активных ссылок.

### 3. Admin/Super-admin уведомление в canonical `notify-order-purchased`

Сейчас `notify-order-purchased` шлёт покупателю (email + Telegram DM) и не шлёт админам. bePaid-webhook рассылает админам прямыми `telegram-notify-admins` — нарушает канонику (см. `.lovable/backlog/admin-notify-on-purchase-canonical.md`). RR-заказы админ вообще не видит.

Изменения в `supabase/functions/notify-order-purchased/index.ts`:

- Добавить третий канал `telegram_admin` внутри той же функции.
- Получатели: `user_roles_v2` роли `admin` + `super_admin`, у которых `profiles.telegram_user_id IS NOT NULL`.
- Идемпотентность: `order_notification_deliveries` строка на пару `(order_id, channel='telegram_admin', recipient=<tg_id>)` — уникальность защищает от дублей при повторных webhook.
- Шаблон DM админу: продукт, тариф, сумма, email/телефон покупателя, ссылка на заказ в админке, provider (bepaid/rr/stripe).
- Mirror в `telegram_messages` (по паттерну существующего purchase DM).
- Ошибка канала админов не блокирует email/DM покупателю.

Ничего не меняем в `telegram-notify-admins` (остаётся для системных/диагностических событий).

Прямые вызовы `telegram-notify-admins` из `bepaid-webhook` в контексте «пришла оплата» — в этот спринт не переносим (отдельная задача из backlog); просто добавляем admin-канал в canonical, и он начинает работать для всех потоков, которые уже вызывают `notify-order-purchased` через `grant-access-for-order` (bepaid, stripe, RR).

### 4. Финальный live smoke run

После пункта 3 (deploy notify-order-purchased):

1. Реактивировать тестовый product/tariff/offer (или использовать существующий недорогой live offer — уточнить у пользователя).
2. Через реальный browser-flow (universal кнопка на продуктовой странице) создать заявку RR.
3. Дождаться authorized webhook → показать пользователю:
  - строку в `orders_v2` (status=paid, pipeline_stage_id, meta.crm_routing_snapshot)
  - строку в `payments_v2` (provider=rr, status=succeeded, amount, meta.rr, commission)
  - `entitlement_sources` + агрегат `entitlements` (access_end = paid_at + tariff.access_days)
  - CRM stage переход
  - `order_notification_deliveries`: email=sent, telegram (user)=sent, **telegram_admin**=sent (по всем admin/super_admin)
  - screenshot Telegram-уведомления администратору
4. Повторный webhook — no-op.
5. Деактивировать тестовые сущности.

### 5. Порядок выполнения (для build-режима)

1. Dry-run отчёт по тестовым данным → ждём OK.
2. DELETE-миграция.
3. Патч `notify-order-purchased` + deploy.
4. Финальный smoke run.
5. Закрывающий отчёт Sprint C2.

### Технические детали

- Роли: используем `user_roles_v2` + `has_role(auth.uid(), 'admin')`/`'super_admin'` через SECURITY DEFINER helper, JOIN с `profiles.telegram_user_id`.
- Уникальный индекс на `order_notification_deliveries(order_id, channel, recipient)` — проверить, что уже существует; если нет — добавить в миграции.
- Шаблон admin DM — inline в edge-function, без новой записи в `product_notification_templates` (можно оставить override на будущее).
- Bot: primary Telegram bot (тот же, что и user DM в `notify-order-purchased`).
- Ретраи: fire-and-forget, ошибки логируются в `order_notification_deliveries.status='failed'` + error.

### Открытые вопросы

1. Использовать существующий live offer для финального smoke (какой?), или разово реактивировать тестовый? Тестовый безопаснее (сумма 50 BYN, известный applicant).
2. Удалить ли CRM-контакт тестового applicant полностью, или оставить (сделки удалить, контакт оставить)?