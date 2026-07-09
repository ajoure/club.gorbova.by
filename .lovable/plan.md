да, согласен, с учетом правок:

1. **Не использовать** `acquiring_connections` **в guard-е.**  
В текущем core РР источник настроек — карточка интеграции:

```txt
integration_instances + config + config_secrets
```

Заменить:

```txt
mode = 'test' в acquiring_connections
```

на:

```txt
mode = 'test' в integration_instances.config для provider='rr'
```

2. **Webhook idempotency делать не только по** `(external_id, status_raw)`**.**  
Этого мало. Один и тот же статус может прийти повторно с другим payload. Правильнее:

```txt
idempotency_key = provider:rr + external_id + status_raw + sign_hash_short
```

При повторе — `200`, ledger не откатывается, в `integration_sync_logs` маркер `duplicate` / `already_applied`.

3. **Не требовать оригинальные секретные headers/body из** `integration_sync_logs`**.**  
Если лог уже redacted, его нельзя использовать как источник для полного replay. Для теста webhook:

```txt
- взять external_id/status_raw из ledger/logs;
- сформировать новый test payload по documented MD5-формуле;
- подписать его текущим secret_key внутри backend/test-call;
- отправить в rr-notification.
```

Не сохранять и не вытаскивать полные raw headers с подписью из логов.

4. `external_id_override` **— только test-only и без риска дублей в** `rr_test_ledger`**.**  
Уточнить поведение функции:

```txt
Если external_id_override уже есть в rr_test_ledger:
- не создавать вторую ledger-строку;
- выполнить вызов РР;
- записать результат в integration_sync_logs;
- обновить существующую строку только если это безопасно и не ломает историю.
```

Лучше тестировать повтор так:

```txt
1. Сгенерировать новый rr_test_<uuid>.
2. Вызвать createOrder с ним первый раз.
3. Вызвать createOrder с ним второй раз.
4. Зафиксировать ответ РР.
```

5. `authorized_partially` **не “в коде адаптера/маппере” менять, если уже корректно.**  
Нужно только подтвердить правило:

```txt
authorized_partially → pending
не paid
не выдавать доступ
не завершать заказ
```

Если код уже так делает — не менять, только зафиксировать в `.lovable/plan.md` / discovery docs.

6. **“0 записей” заменить на snapshot before/after.**  
В боевых таблицах могут быть существующие записи. Проверять не абсолютный ноль, а отсутствие новых/измененных строк за окно теста:

```sql
-- before/after snapshot:
count(*), max(created_at), max(updated_at)
```

По таблицам:

```txt
payments_v2
orders_v2
provider_events
domain_events
entitlements
subscriptions_v2
access_grant_ledger
```

7. **Письмо в поддержку не готовить автоматически.**  
Верно: не отправлять и не готовить письмо, пока runtime-тесты не выявили конкретный blocker. В отчете допустим только раздел:

```txt
Открытые вопросы, если остались
```

8. **Отчет после выполнения оформить строго так:**

```txt
Отчет о выполненной работе: закрытие runtime-проверок Ресурс Развития без поддержки
```

## **Итог**

План можно выполнять после этих правок. Главное: всё остается только в `rr_test_ledger` и `integration_sync_logs`; `PublicPayPage`, продукты, реальные платежи, доступы и статистику не трогать.

&nbsp;

План: закрыть оставшиеся runtime-проверки РР самостоятельно, без обращения в поддержку. Все действия — только в изолированном контуре (`rr_test_ledger`, `integration_sync_logs`, edge functions `rr-test-*` и `rr-notification`). Боевые таблицы (`payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2`), `PublicPayPage`, `OfferAcquiringSettings`, продукты, тарифы, доступы и статистику — не трогать.

## Шаг 1. Сценарий «Ошибка оплаты» (runtime behavior)

1. Создать новый заказ через `rr-test-create-order` (BYN, префикс `rr_test_`).
2. Открыть `payment_url` через Playwright, нажать «Ошибка оплаты».
3. Через 5–10 сек вызвать `rr-test-get-status` по этому `external_id`.
4. Зафиксировать в `rr_test_ledger` и в отчёте:
  - `status_raw` от РР,
  - `status_internal`,
  - пришёл ли webhook в `integration_sync_logs` (inbound `rr_notification`),
  - redacted копию response.
5. Вывод: если `status_raw` остаётся `new`/`created` и webhook не приходит — зафиксировать как **runtime behavior test-mode**, не блокер (сценарий `failed` уже покрыт кнопкой «Отклонить рассрочку»).

## Шаг 2. Идемпотентность webhook

1. Взять payload одного уже успешно принятого inbound `rr_notification` из `integration_sync_logs` (redacted копию тела + оригинальные заголовки/подпись).
2. Отправить тот же самый payload в `rr-notification` **2 раза подряд** через `curl_edge_functions`.
3. Проверить и зафиксировать:
  - оба ответа HTTP 200,
  - `rr_test_ledger` по этому `external_id` — без дублей (одна строка, `status_internal` не откатился),
  - `integration_sync_logs` содержит вторую запись с маркером `duplicate`/`ignored`/`already_applied` (или эквивалентом безопасного повтора).
4. Если сейчас в `rr-notification` нет явной защиты от повторов — добавить её на уровне обработчика (проверка по `(external_id, status_raw, signature)` перед апдейтом `rr_test_ledger`), только в пределах test-контура.

## Шаг 3. Плохая подпись

1. Взять тот же payload из шага 2.
2. Изменить один символ в MD5-подписи (или в одном из подписываемых полей, оставив старую подпись) и отправить в `rr-notification`.
3. Проверить и зафиксировать:
  - HTTP 4xx (ожидаемо 401),
  - `rr_test_ledger` не изменился,
  - в `integration_sync_logs` появилась запись с redacted security-маркером (`invalid_signature`), без утечки секрета и полного тела.

## Шаг 4. Повторный `createOrder` с тем же `external_id`

1. Проверить текущую `rr-test-create-order`: если `external_id` всегда генерируется внутри — добавить **test-only** опциональный параметр `external_id_override` со строгими guard-ами:
  - только префикс `rr_test_`,
  - только роль admin/superadmin (`has_role`),
  - только `mode = 'test'` в `acquiring_connections`,
  - категорически не трогает `payments_v2`/`orders_v2`/`provider_events`/`domain_events`.
2. Вызвать `rr-test-create-order` дважды с одним и тем же `external_id_override` (значение из ранее успешной заявки).
3. Зафиксировать фактический ответ РР одним из вариантов:
  - вернулась та же заявка (тот же `payment_url`/id),
  - вернулась ошибка (`duplicate`/`already_exists`),
  - создалась новая заявка с новым id.
4. По результату описать **retry policy** для v1 в `.lovable/plan.md` (например: «на дубль — не ретраить, читать `getOrderStatus`»).

## Шаг 5. `authorized_partially` — runtime фиксация

1. Взять уже существующий заказ со `status_raw = authorized_partially`.
2. Через ~10–15 минут ещё раз вызвать `rr-test-get-status`, зафиксировать:
  - изменился ли `status_raw` (пришёл ли `authorized`/`authorized_all` без действий),
  - появились ли новые inbound `rr_notification` в `integration_sync_logs`,
  - остался ли `status_internal = pending`.
3. Зафиксировать правило v1 в коде адаптера/маппере статусов и в `.lovable/plan.md`:
  - `authorized_partially → pending`, заказ **не** завершать, доступы **не** выдавать,
  - переход в `paid` только при последующем `authorized`/`authorized_all` от РР.

## Definition of Done

- По каждому из 5 шагов — redacted proof: строка(и) `rr_test_ledger` + записи `integration_sync_logs` (входящие/исходящие) с временными метками.
- В `.lovable/plan.md` обновлён раздел «Что закрыто / Что открыто»:
  - «Ошибка оплаты» — задокументировано как runtime behavior,
  - идемпотентность webhook — доказана,
  - плохая подпись — отклоняется 4xx с security log,
  - повтор `createOrder` — задокументированное поведение + retry policy v1,
  - `authorized_partially` — правило v1 зафиксировано в коде и в плане.
- 0 записей в `payments_v2`, `orders_v2`, `provider_events`, `domain_events`, `entitlements`, `subscriptions_v2` за окно тестирования.
- Письмо в поддержку РР **не** отправляется. Если после шагов 1–5 останется вопрос, который принципиально нельзя решить runtime-путём — он оформляется отдельным пунктом с redacted proof, и только тогда планируется письмо.

## Технические детали (для инженера)

- Все edge-вызовы — только `rr-test-create-order`, `rr-test-get-status`, `rr-notification`.
- `external_id_override` — добавляется в `rr-test-create-order` за guard-ом `has_role(auth.uid(),'admin') AND mode='test' AND external_id LIKE 'rr_test_%'`.
- Идемпотентность в `rr-notification` — по ключу `(external_id, status_raw)` с проверкой перед `UPDATE` на `rr_test_ledger`; повторный apply возвращает 200 и пишет `duplicate` в `integration_sync_logs.status`.
- Bad-signature путь — уже существующая MD5-проверка в `rr-adapter.ts` (`blueimp-md5`); нужно лишь убедиться, что при провале пишется `integration_sync_logs` с `direction='inbound'`, `status='error'`, `error_code='invalid_signature'` и redacted телом.
- Все скрипты Playwright — под `/tmp/browser/rr_stepN/`, скриншоты — туда же.