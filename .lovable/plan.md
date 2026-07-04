# да, согласен, с учетом правок:

1. **Диагноз принимать как read-only, но не как финальный root cause без ManyChat proof.**
  &nbsp;
  Сейчас доказано:
  ```text
  наша система получила 133 webhook и записала их без ошибок
  ```
  Но формулировку «потери на стороне ManyChat/ApiX» нужно сделать аккуратнее:
  ```text
  потерь на стороне нашего webhook за полученные события не видно; неполнота возникает до попадания события в наш webhook — на уровне ManyChat/ApiX flow/configuration или Meta→ManyChat доставки.
  ```
  То есть не обвинять ManyChat окончательно, пока не проверены flow logs / Live Chat / trigger history.
2. **Добавить обязательный proof из ManyChat.**
  &nbsp;
  Перед любым патчем нужно попросить/снять:
  - скрин flow, где стоит External Request;
  - какие trigger-и включены;
  - стоит ли User Input перед External Request;
  - есть ли фильтры/conditions;
  - есть ли Live Chat triggers;
  - есть ли история выполнения External Request;
  - что именно отправляет ApiX/ManyChat payload.
3. `last_input_text` **— подтвердить payload samples.**
  &nbsp;
  В proof добавить 3–5 обезличенных raw payload samples:
  ```text
  subscriber
  last_input_text
  absence of attachments/media/story/reels fields
  ```
  Это нужно, чтобы не спорить потом, что «медиа было, но мы не сохранили».
4. **Разделить “не все входящие” на два независимых риска.**
  &nbsp;
  В плане сейчас всё сведено к `last_input_text`, но есть два слоя:
  - **text burst loss** — несколько текстовых сообщений подряд могут перезаписывать/схлопываться в `last_input_text`;
  - **non-text unsupported** — медиа/story/reels вообще не попадают в текущий payload.
  Для каждого нужен отдельный DoD в будущем патче.
5. **Для** `PATCH-IG-INGEST-COMPLETENESS` **сначала сделать ManyChat-config patch, потом code patch.**
  &nbsp;
  Не начинать с кода, пока не понятно, какие payload-и ManyChat реально может прислать.
  Правильный порядок:
6. **Не обещать “batch”, пока ManyChat не подтвердил batch payload.**
  &nbsp;
  Формулировку заменить:
  ```text
  webhook должен уметь принять как одиночное сообщение, так и массив attachments/messages, если ManyChat/ApiX реально присылает такой формат.
  ```
  Не проектировать batch вслепую.
7. **Для** `PATCH-IG-ADMIN-ECHO` **добавить третий вариант: отказаться от IG-app replies как источника истины.**
  &nbsp;
  Варианты должны быть:
  - **A. ManyChat Live Chat echo** — если доступен и отдаёт admin outbound webhook.
  - **B. Direct Meta Graph API message_echoes** — полноценная интеграция.
  - **C. Операционная политика** — все операторы отвечают только из нашей платформы, тогда исходящие гарантированно пишутся через `instagram-admin-chat`.
  Вариант C дешевле и может быть достаточным, если не хочется строить Meta App.
8. **Вариант Meta Graph API требует отдельного Discovery.**
  &nbsp;
  Не писать сразу как “следующий патч”. Сначала:
  - есть ли Meta Business Manager;
  - кто владеет IG account/page;
  - есть ли app;
  - есть ли permissions;
  - нужна ли Business Verification;
  - можно ли получить `instagram_manage_messages`;
  - не конфликтует ли это с ManyChat.
  Это отдельная большая фаза.
9. **Для ответов Екатерины из мобильного IG уточнить ограничение.**
  &nbsp;
  Правильнее:
  ```text
  ответы, отправленные напрямую из Instagram app, сейчас не попадают в нашу БД, потому что текущая интеграция сохраняет только outbound, отправленный через нашу платформу, и inbound, пришедший через ManyChat webhook.
  ```
  Не писать категорично «никогда не попадали» без проверки старых outbound 19.04.2026 — там были тесты платформы, но это тоже нужно указать.
10. **Добавить краткий бизнес-вывод.**

Для пользователя важно:

```text
Если хотите полную историю Instagram в контакт-центре, нельзя параллельно отвечать из Instagram app без echo-интеграции. Иначе история в нашей системе будет неполной.
```

11. **Следующий утверждённый порядок.**

После этого диагностического отчёта запускать так:

```text
1. PATCH-IG-MANYCHAT-FLOW-AUDIT
   read-only / screenshots / payload samples

2. PATCH-IG-INGEST-COMPLETENESS
   только после samples

3. PATCH-IG-ADMIN-ECHO-DISCOVERY
   выбрать ManyChat Live Chat vs Meta Graph API vs policy “reply only from platform”
```

12. **Итоговый отчёт по диагностике назвать отдельно.**

```text
Отчет о выполненной работе: PATCH-IG-MESSAGES-DIAGNOSIS
```

Статус:

```text
Our webhook ingestion for received events — PASS
Missing inbound messages — upstream/config gap, requires ManyChat flow proof
Admin replies from Instagram app — not ingested by current architecture
Code changes — none
```

С этими правками диагноз можно принять. Следующий шаг — не код, а **аудит ManyChat flow с payload samples**.

&nbsp;

План: Диагноз проблем Instagram (без правок кода)

Задача — только диагностика. Ничего не меняем, пока не согласуем починку отдельным патчем.

## Что проверил (факты из БД и кода)

1. `instagram_messages`: за последние 14 дней — 133 входящих, 0 исходящих. Всего outbound за всё время — 10 (все от 19.04.2026, тесты из платформы).
2. Все входящие приходят через `instagram-webhook` из ApiX/ManyChat. В `raw_payload` только ключи `subscriber` и `last_input_text` — то есть один триггер = одно «последнее сообщение подписчика».
3. `integration_logs` за 2 дня: 133 успеха, 0 ошибок. Отвергнутых webhook'ов нет — значит потери не на нашей стороне приёма, они на стороне ManyChat/ApiX (что именно оттуда прилетает).
4. В `supabase/functions/instagram-webhook/index.ts:394` `direction` захардкожен в `'inbound'`. Обработчика исходящих (echo от оператора) в webhook нет вообще.
5. Outbound-записи создаёт только `instagram-admin-chat` action `send_message` — когда админ пишет из нашей платформы. Ответы Екатерины из мобильного приложения Instagram в БД не попадают в принципе.

## Root cause

### A. «Приходят не все сообщения»

Триггер ManyChat External Request отдаёт только `last_input_text` — это одно последнее текстовое сообщение подписчика на момент срабатывания flow. Из этого следует три класса потерь, которые совпадают с симптомом:

1. Если клиент шлёт несколько сообщений подряд быстрее, чем ManyChat успевает дойти до шага External Request (или до User Input), новые сообщения перезаписывают `last_input_text` — часть теряется.
2. Медиа-сообщения (voice, фото, reels-reply, story-reply, share) не попадают в `last_input_text`. Для них в ManyChat нужен отдельный триггер (Media, Story Mention/Reply, Reels Share) с отдельным flow, который тоже дёргает наш webhook. Сейчас такого триггера нет — все non-text сообщения в БД отсутствуют.
3. Если во flow есть условие/фильтр (тег, сегмент, время), сообщения не проходящие фильтр не доезжают до webhook.

### B. «Нет ответов Екатерины из её директа»

Наш `instagram-webhook` жёстко ставит `direction='inbound'`. Обработки исходящих echo нет. ManyChat в стандартном flow-триггере тоже не шлёт исходящие оператора — Instagram Graph API отдаёт их только через отдельную подписку `message_echoes` (для этого нужен собственный Meta App с page-token, что сейчас не подключено), либо через Live Chat webhook (если тариф ManyChat это поддерживает и включён отдельный триггер «Live Chat message sent by admin»).

Итог: ответы, которые Екатерина пишет с телефона в IG-приложении, физически не доходят ни до ManyChat External Request, ни до нашего webhook. В БД их нет, поэтому в ленте пусто. В самом ManyChat они видны, потому что ManyChat ведёт свою историю через Graph API напрямую.

## Что показать пользователю (без правок)

- Подтвердить: сервер приёма работает, все 133 полученных за 2 дня записались, ошибок 0. Значит «пропажа» — на стороне ManyChat flow, не у нас.
- Подтвердить: исходящие Екатерины никогда и не попадали в БД для сообщений вне платформы — это архитектурный gap, а не регресс.

## Что предложить сделать следующим патчем (после апрува)

Два независимых направления, каждое — отдельный патч. Ничего сейчас не трогаем.

1. **PATCH-IG-INGEST-COMPLETENESS** (закрывает A):
  - В ManyChat добавить отдельные External Request триггеры для: Media (image/video/audio/voice), Story Reply, Story Mention, Reels Share, Shared Post.
  - Убедиться, что основной триггер стоит на «New Message» без блокирующего User Input перед External Request (иначе теряются «догоняющие» сообщения).
  - На стороне webhook принять `attachments[]` (не только `media_url` одиночный) и уметь писать несколько `instagram_messages` за один вызов, если ManyChat пришлёт batch.
2. **PATCH-IG-ADMIN-ECHO** (закрывает B): выбрать один из двух путей и согласовать с пользователем:
  - Вариант 1 (ManyChat Live Chat): включить в ManyChat триггер «Live Chat: message sent by admin» → External Request → наш webhook расширить: если payload помечен как исходящий, писать `direction='outbound'`, `sent_by_admin=<оператор>`. Просто, но требует платного Live Chat плана ManyChat.
  - Вариант 2 (Meta Graph API напрямую): подключить собственный Meta App, подписаться на `messages` + `message_echoes` через Graph API, вести приём в новой edge-функции; ManyChat остаётся для автоответчиков. Полноценно, но требует Business Verification и Advanced Access для `instagram_manage_messages`.

## DoD плана (не задачи)

- Пользователь понимает: потери входящих — из-за конфигурации ManyChat (last_input_text), не из-за нашего кода.
- Пользователь понимает: ответы из личного директа Екатерины архитектурно не могут попасть к нам без Live Chat-триггера ManyChat или прямого Graph API.
- Пользователь выбирает, какое из двух направлений (или оба) запускать патчем.