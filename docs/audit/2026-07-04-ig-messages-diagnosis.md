# Отчет о выполненной работе: PATCH-IG-MESSAGES-DIAGNOSIS

Дата: 2026-07-04
Тип: read-only диагностика. Изменений в коде и БД не производилось.

## Статус

```
Our webhook ingestion for received events — PASS
Missing inbound messages — upstream/config gap, requires ManyChat flow proof
Admin replies from Instagram app — not ingested by current architecture
Code changes — none
```

## Факты (из БД и кода)

1. `instagram_messages` за последние 14 дней: **inbound = 133, outbound = 0**.
2. Всего outbound за всё время — **10 записей**, все от 19.04.2026 (тесты платформенного composer'а через `instagram-admin-chat.send_message`). Это исторический тестовый шум, а не «раньше работало, потом сломалось».
3. `integration_logs` за 2 дня: **133 success, 0 error, 0 rejected**. Ни одного webhook, который наш `instagram-webhook` отверг.
4. Все входящие приходят с одинаковой формой payload:
   ```json
   {"subscriber":{"id":"...","name":"...","first_name":"..."},"last_input_text":"..."}
   ```
   Никаких `attachments`, `media_url`, `story`, `reels`, `shared_post`, `is_echo`, `from_admin` — только текст последней реплики подписчика.
5. `supabase/functions/instagram-webhook/index.ts:394` жёстко пишет `direction: 'inbound'`. Ветки для outbound/echo нет.
6. Единственный источник outbound-записей — `instagram-admin-chat.send_message` (сообщения, отправленные из нашей платформы).

## Root cause

### A. «Приходят не все входящие»

На нашей стороне потерь нет — все 133 доставленных webhook записаны без ошибок. Неполнота возникает **до** попадания события в наш webhook — на уровне ManyChat/ApiX flow или Meta → ManyChat доставки. Правдоподобные механизмы (нужен ManyChat-proof):

- **A1. Text burst loss.** Триггер External Request отдаёт только `last_input_text`. Если подписчик пишет несколько текстовых сообщений подряд быстрее, чем flow доходит до шага External Request (или упирается в предшествующий User Input / Delay), новые реплики перезаписывают `last_input_text` и часть теряется.
- **A2. Non-text unsupported.** В текущем payload вообще нет полей для медиа/story/reels/shared post. Значит для медиа нужен отдельный триггер ManyChat (Media Reply, Story Mention, Story Reply, Reels Share) с отдельным flow, дёргающим наш webhook. Сейчас такого триггера в конфигурации нет — все non-text события в БД физически отсутствуют.
- **A3. Flow filters/conditions.** Если во flow есть условие (тег, сегмент, время суток, subscribed=true) — не проходящие фильтр сообщения не доедут до External Request.

Это два **независимых** класса потерь (A1 и A2) плюс возможный A3. Каждый требует отдельного DoD.

### B. «Нет ответов Екатерины из её директа»

Ответы, отправленные оператором **напрямую из мобильного Instagram**, не попадают в нашу БД. Текущая архитектура сохраняет только:

- outbound, отправленный через нашу платформу (`instagram-admin-chat.send_message` → `direction='outbound'`);
- inbound, пришедший через ManyChat webhook (`direction='inbound'`, hardcoded).

Обработчика echo нет. ManyChat в стандартном flow-триггере не форвардит исходящие оператора — Instagram Graph API отдаёт их только через отдельную подписку `message_echoes` (нужен собственный Meta App с page-token, сейчас не подключено), либо через ManyChat Live Chat trigger (если тариф это поддерживает).

Проверено: старые 10 outbound от 19.04.2026 — платформенные тесты, а не архив echo-интеграции. Значит эта функциональность у нас **никогда не существовала**, а не «сломалась».

## Что нужно снять с ManyChat перед любым патчем (обязательный proof)

Пока эти артефакты не собраны, root cause по A остаётся гипотезой:

1. Скрин flow, где стоит External Request к нашему webhook.
2. Список включённых trigger'ов на IG-аккаунте (New Message, Media, Story Reply, Story Mention, Reels, Live Chat).
3. Есть ли шаг User Input / Delay / Condition перед External Request.
4. Есть ли фильтры/conditions на входе flow (тег, сегмент).
5. Доступен ли Live Chat trigger «message sent by admin» в текущем тарифе.
6. История выполнения External Request за сутки (кол-во успешных вызовов на нашей стороне уже известно — 133; сравнить с числом входящих в ManyChat inbox).
7. 3–5 обезличенных raw payload sample от разных типов событий (текст, фото, голос, story).

## Что предложить следующими патчами (после апрува)

Ничего не запускаем без proof выше. Порядок:

1. **PATCH-IG-MANYCHAT-FLOW-AUDIT** — read-only: скриншоты flow + payload samples. Только после этого можно проектировать код.
2. **PATCH-IG-INGEST-COMPLETENESS** (закрывает A):
   - Сперва **ManyChat-config patch**: добавить/включить недостающие триггеры и убрать блокирующие шаги перед External Request.
   - Затем **code patch** на webhook: принять `attachments[]`, если ManyChat реально начнёт их присылать; уметь принять batch (несколько сообщений в одном вызове) **только** если ManyChat подтвердит такой формат — не проектировать вслепую.
   - Отдельные DoD для A1 (text burst) и A2 (non-text).
3. **PATCH-IG-ADMIN-ECHO-DISCOVERY** (закрывает B): три взаимоисключающих варианта, выбор — за пользователем:
   - **Вариант A. ManyChat Live Chat echo** — если Live Chat trigger доступен в тарифе. Дёшево: расширить webhook, чтобы при флаге `from_admin`/`is_echo` писать `direction='outbound'`, `sent_by_admin=<оператор>`.
   - **Вариант B. Direct Meta Graph API `message_echoes`** — полноценно, но требует отдельного discovery: наличие Meta Business Manager, владение IG-аккаунтом/страницей, свой Meta App, Business Verification, Advanced Access для `instagram_manage_messages`, отсутствие конфликта с ManyChat. Это отдельная большая фаза, не «следующий патч».
   - **Вариант C. Операционная политика** — все операторы отвечают только из нашей платформы. Тогда исходящие гарантированно пишутся через `instagram-admin-chat`. Ноль кода, но нужен регламент.

## Бизнес-вывод для пользователя

Если нужна полная история Instagram в контакт-центре — параллельно отвечать из мобильного Instagram нельзя без echo-интеграции (Вариант A или B). Иначе история в системе будет неполной by design, независимо от того, что мы поправим в webhook.

## Rollback

Не применимо — изменений не было.
