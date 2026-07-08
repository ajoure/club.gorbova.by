## да, согласен, с учетом правок:

1. **Не использовать голый** `id` **как ключ в общем** `Map`**.**  
У разных таблиц UUID теоретически могут совпасть. Для новых событий делать стабильный prefixed id:

```ts
`notification:${row.id}`
`access_grant:${row.id}`
```

2. **RLS не выносить “если потребуется” в неопределенный отдельный шаг.**  
В плане нужно явно добавить gate:

```text
Если ContactFeedTab не может читать order_notification_deliveries / access_grant_ledger из-за RLS, патч не считается завершенным. Нужно либо использовать существующий admin-safe RPC, либо добавить минимальную read-policy для admin role.
```

3. **Не читать** `access_grant_ledger` **слишком широко.**  
Только по `order_id IN (...)`, полученным из заказов конкретного контакта. Не делать отдельный глобальный поиск по contact/profile.
4. **Добавить empty-state guard.**  
Если у контакта нет `order_id`, новые запросы не выполняются:

```ts
if (!orderIds.length) return [];
```

5. **Для** `order_notification_deliveries` **показывать не только** `sent`**, но и** `failed/skipped/pending`**.**  
В ленте это полезно для диагностики. Title лучше формировать по статусу:

```text
Email отправлен
Email не отправлен
Email пропущен
Telegram отправлен
Telegram не отправлен
Telegram пропущен
```

6. **Для access ledger аккуратно маппить** `result`**.**  
Не завязываться на один формат JSON. Если `result.access_end` есть — показывать дату. Если нет — показывать `status`, `target_type`, `target_key`, `action_type`.
7. **Добавить визуальное различие ошибок.**  
Если `status='failed'` или есть `error/error_details`, событие должно быть видно как проблемное, а не как обычное успешное.
8. **DoD дополнить проверкой дублей.**

```text
В ленте нет дублей при повторной загрузке вкладки / смене фильтра / refetch.
```

9. **DoD дополнить проверкой сортировки.**

```text
Email 10:53:45 отображается выше Telegram 10:53:44, если сортировка desc.
```

10. **Формулировку про “страница** `/admin/deals` **ими пользуется на бэке” уточнить.**  
Если `/admin/deals` читает через edge/RPC/service role, это не доказывает, что прямой frontend Supabase-запрос из `ContactFeedTab` пройдет RLS. Проверка RLS обязательна в runtime.
11. **Документировать границу scope.**  
В отчете после выполнения явно указать, что патч только отображает уже существующие факты в UI и не меняет write-path оплаты, уведомлений и выдачи доступа.

В остальном план корректный: это frontend-only visibility patch, без вмешательства в `grant-access-for-order`, `notify-order-purchased`, webhook и entitlement-логику. Это соответствует правилу не ломать production write-path и переиспользовать существующие данные вместо создания параллельных сущностей.  

&nbsp;

План: показать post-payment уведомления и выдачу доступа в ленте контакта

### Диагностика (что уже проверено в БД)

По сделке ORD-26-00276 (Ольга Шидловская, тариф «Бизнес-леди», 1325 BYN) backend отработал полностью:


| Что            | Где в БД                                                                                                                                | Статус            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Платёж         | `payments_v2` (bepaid `36b8d882…`)                                                                                                      | succeeded         |
| Заказ          | `orders_v2.d308d91c…`                                                                                                                   | paid              |
| Выдача доступа | `access_grant_ledger` row `granted`, post-check pass                                                                                    | granted           |
| Entitlement    | `entitlements.cb20` продлён до **2027-04-04**                                                                                           | active            |
| Email          | `email_send_log` + `order_notification_deliveries` (template `product-purchased`) → [olka_logoysk@mail.ru](mailto:olka_logoysk@mail.ru) | **sent** 10:53:45 |
| Telegram       | `order_notification_deliveries` → chat 1382549899 (@Lyalya5557, её линкованный аккаунт) msg 25786                                       | **sent** 10:53:44 |
| Suppression    | `suppressed_emails` — записи нет                                                                                                        | ok                |


**Причина «нет отправки в системе»:** компонент `src/components/admin/contact/ContactFeedTab.tsx` читает только `orders_v2`, `payments_v2`, `audit_logs` — таблицу `order_notification_deliveries` он не запрашивает вообще (`rg` подтверждает: во всём `src/` нет ни одного обращения к ней). Поэтому в ленте карточки контакта отображается только событие платежа, а факты отправки письма/Telegram и выдачи доступа не видны — при том, что все три события действительно произошли.

### Про «доступ к конкретным модулям/урокам»

Для тарифа `9bc81736` («Бизнес-леди») в `access_rules` есть активное правило `fc9e584e…` с `grant_target_type='training_content'` и списком из 28 `allowed_module_ids` (ЦБ 2.0). Это правило — **клиентский фильтр** контента LMS: оно применяется на фронте при рендере, а не как отдельный grant. Оно срабатывает автоматически при наличии активного entitlement по `cb20` (который у Ольги теперь есть). После патча ниже мы отдельным DoD-пунктом верифицируем, что в её кабинете эти 28 модулей действительно открыты — если нет, это уже отдельная задача про резолвер `useTrainingContentRules`.

### Изменения (только фронт, в один компонент)

Файл: `src/components/admin/contact/ContactFeedTab.tsx`

1. Добавить запрос `order_notification_deliveries` для всех `order_id`, полученных запросом заказов контакта:
  - поля: `id, order_id, channel, notification_type, status, recipient, provider_message_id, sent_at, created_at, error`;
  - `channel='email'` → `FeedEvent.kind='email'`, `title='Уведомление о покупке (шаблон: <notification_type>)'`, `body='Получатель: <recipient>. Статус: <status>'`, при `error` — показать в body;
  - `channel='telegram'` → `FeedEvent.kind='telegram'`, тот же паттерн (recipient = chat_id/username), провайдерский `message_id` в meta;
  - `at = sent_at ?? created_at`.
2. Добавить запрос `access_grant_ledger` по тем же `order_id`:
  - поля: `id, order_id, action_type, status, target_type, target_key, result, created_at`;
  - маппить в `FeedEvent.kind='event'`, `title='Доступ: <action_type> <target_type>'`, `body` — короткая расшифровка (`granted до <access_end>`, окно N дней; при `error_details` — показать).
3. Оба источника мержатся в общий `FeedEvent[]` тем же путём, что calls/sms/deals: складываются в `Map` по `id`, сортируются по `at` desc.
4. Никаких новых типов фильтров не добавляем — уже есть чипы `email`, `telegram`, `event`, они автоматически охватят новые события.
5. RLS-проверка: `order_notification_deliveries` и `access_grant_ledger` уже доступны админам (страница `/admin/deals` ими пользуется на бэке). Если политика для `authenticated` ограничена — потребуется отдельная миграция; проверим сразу после первого рендера и, если нужно, вынесем в отдельный шаг.

### Что НЕ трогаем

- `grant-access-for-order`, `send-transactional-email`, `notify-order-purchased`, `bepaid-webhook` — работают корректно, доказано данными.
- `access_rules` и `training_content` резолвер — сначала верифицируем визуально в кабинете Ольги.
- Никаких новых edge-функций, миграций схемы, изменений `orders_v2`/`entitlements`.

### DoD

1. В карточке контакта Ольги (профиль `806deb56…`) на вкладке «Лента» по сделке ORD-26-00276 отображаются:
  - Сделка / Платёж (уже видны).
  - Событие **«Email отправлен»** — шаблон `product-purchased`, получатель `olka_logoysk@mail.ru`, статус `sent`, 10:53:45.
  - Событие **«Telegram отправлен»** — получатель `@Lyalya5557` / chat `1382549899`, msg `25786`, статус `sent`, 10:53:44.
  - Событие **«Доступ выдан»** — target `cb20 (7101ed3c…)`, `granted до 2027-04-04`.
2. Фильтры-чипы `email`, `telegram`, `event` корректно скрывают/показывают эти новые строки.
3. Регрессия: старые записи (звонки, письма из inbox если есть, задачи, файлы, сделки, платежи) продолжают отображаться в ленте без визуальных изменений.
4. Отдельная верификация (диагностическая, вне патча): открыть кабинет Ольги под impersonation, убедиться что в разделе ЦБ 2.0 открыты 28 модулей из `allowed_module_ids` правила `fc9e584e`. Если нет — заводим отдельный тикет на резолвер training_content.

### Верификация (Verify этап)

- Сеть/консоль: два новых Supabase-запроса в компоненте, без ошибок RLS.
- Скриншот вкладки «Лента» карточки Ольги с четырьмя типами событий по ORD-26-00276.
- Cross-check с БД: `select count(*) from order_notification_deliveries where order_id='d308d91c-1bae-45cd-aab7-3e85672ccb82'` = 2, оба видны в UI.