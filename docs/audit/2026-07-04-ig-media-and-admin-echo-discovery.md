# Отчет о выполненной работе: PATCH-IG-MEDIA-AND-ADMIN-ECHO-DISCOVERY

Дата: 2026-07-04
Тип: read-only discovery. Изменений в коде, БД, конфиге и edge functions не производилось.

## Корректировка прошлого диагноза

Файл `docs/audit/2026-07-04-ig-messages-diagnosis.md` — **superseded только в части non-text ingestion**. Утверждение «non-text не форвардятся и их нет в БД» снято: image и video приходят и записываются. Раздел про admin replies (B) остаётся в силе до появления новых доказательств.

## D1. Что реально есть в БД

### Распределение по типам за 30 дней

```
inbound  text/null    117
inbound  video         12
inbound  image          4
inbound  audio/voice    0   ← не подтверждено
inbound  story/reels    0   ← не подтверждено
outbound *             0    (за последние 30 дней)
```

Дубликатов по `external_message_id` — 0 (проверено `GROUP BY … HAVING count(*)>1`).

### Confirmed / not confirmed по типам

| Тип | Статус | Proof |
|---|---|---|
| text | confirmed | 117 записей, `message_text` заполнен |
| image | confirmed | 4 записи, `media_type='image'`, `media_url` = `lookaside.fbsbx.com/ig_messaging_cdn/…` |
| video | confirmed | 12 записей, `media_type='video'`, `media_url` уже = signed URL в `telegram-media/instagram-inbound/…`, `raw_payload.rehosted_*` заполнено |
| voice / audio | **not confirmed** | 0 записей за 30 дней. Пользователь мог видеть voice в UI ManyChat, но у нас в БД примеров нет — не можем сказать, приходит или теряется. |
| story / story reply / story mention | **not confirmed** | 0 записей. |
| reels share / shared post | **not confirmed** | 0 записей. |

### Rehost проверка (свежие 10 media)

- `video` (8 из 8): `raw_payload ? 'rehosted_media_url' = true`, `rehosted_content_type='video/mp4'`, `rehosted_at` в пределах 5–60 сек после `created_at`, `media_url` уже перезаписан на signed storage URL в bucket `telegram-media/instagram-inbound/<message_id>/…`.
- `image` (2 из 2, свежие): `raw_payload ? 'rehosted_media_url' = false`, `media_url` = сырой `lookaside.fbsbx.com/ig_messaging_cdn/…`.

Наблюдение: **rehost работает только для video**, для новых image ссылка остаётся сырой CDN. Это отдельный gap (риск протухания подписи lookaside), но выходит за рамки discovery и оформляется отдельным патчем при необходимости.

### Что видит оператор в UI

- `message_text` для media = NULL (см. `manychat-inbound/index.ts:184-187` — `message_text = null` когда `rawText` распознан как media URL). Поиск по ленте не засоряется CDN-ссылками. ✅
- UI рендерит по `media_url`, а не по `message_text`.
- Для video UI получает stable signed storage URL. Для image — сырой lookaside URL (см. риск протухания выше).

## D2. Code trace

### Кто создаёт inbound `instagram_messages` для ManyChat

`supabase/functions/manychat-inbound/index.ts` (endpoint пользователь видит как `/functions/v1/manychat-inbound?instance_id=…`). `instagram-webhook` — исторический ApiX-Drive путь, для ManyChat не используется.

### Где вычисляется `media_type` / `media_url`

Полностью в `manychat-inbound/index.ts:171-196`:

1. Пытается достать `body.media_url` / `body.attachment_url` / `body.message.attachments[0].payload.url` (в ManyChat External Request их обычно нет).
2. Если пусто и `last_input_text` матчится `isLikelyMediaUrl` (line 103–107: `lookaside.fbsbx.com | scontent…fbcdn.net | cdninstagram.com`, либо расширение файла), — переносит URL в `media_url`, а `message_text` обнуляет.
3. Тип: сначала `classifyMediaUrlFast` по расширению/паттерну, при неудаче — `probeMimeOptional` (HEAD-запрос по URL).

Итог: **никакого отдельного API-вызова к ManyChat/ApiX для получения media нет.** ManyChat сам подставляет CDN-URL актива в `last_input_text` вместо текста, и мы это распознаём.

### provider_kind

Выставляется в `manychat-inbound/index.ts:443` при upsert `instagram_accounts` как `provider_kind: "manychat"`. Единственные значения в БД сейчас: `manychat` (все свежие) и `apixdrive` (default для legacy, см. `instagram-admin-chat/index.ts:328`).

### Есть ли исходящий HTTP к ManyChat/ApiX

Да, но не для media/history:
- `manychat-inbound/index.ts:487` — `GET /fb/subscriber/getInfo?subscriber_id=…` только для **avatar backfill**. Не возвращает историю сообщений.
- `instagram-admin-chat/index.ts:519` — `POST /fb/sending/sendContent` для outbound с платформы.

**Никакой ManyChat history / conversation API не вызывается.** Ни в одном месте кода нет `getHistory`, `getMessages`, `conversation`, `history` (проверено `rg`).

### Rehost

`supabase/functions/instagram-media-proxy/index.ts` — server-side rehost. Вызывается fire-and-forget из `instagram-webhook/index.ts:409-425` (ApiX-путь) и, судя по `raw_payload.rehosted_*` в БД, для manychat-video тоже отрабатывает (через lazy path из UI или отдельный триггер). Записывает файл в bucket `telegram-media/instagram-inbound/<message_id>/…` и патчит `instagram_messages.media_url` + `raw_payload.rehosted_media_url|storage_path|content_type|at`.

### Есть ли аналогичный endpoint, способный вернуть outbound admin messages

**Не найдено в коде.** Ни ManyChat history endpoint, ни ApiX history endpoint в проекте не используется. См. также D3.

### Готовность кода принимать admin echo

**Важная находка:** `manychat-inbound/index.ts:120-132` уже умеет распознавать outbound-события:

```
is_outbound === true || is_outgoing === true || outbound === true ||
direction ∈ {outbound, outgoing, team_reply, team_member_reply,
             agent_reply, admin_reply, message_sent}
```

Плюс отдельная логика `sender_id` из `agent_id | team_member_id | admin_id` (line 217-235) и префикс `mc_out:` для `external_message_id` (line 207-212) чтобы не конфликтовать с уникальным индексом. Значит **если ManyChat пришлёт External Request с одним из этих флагов, наш ingest уже готов записать outbound корректно** — код-патч не нужен, нужен только flow в ManyChat.

## D3. ManyChat capability discovery

### Секреты (без раскрытия значений)

По grep по коду: используется `MANYCHAT_API_KEY` (см. `instagram-admin-chat/index.ts:475`, `manychat-inbound/index.ts` avatar backfill). Значение не читаем.

### Задокументированные endpoint'ы

Из `docs/integrations/manychat/api-probe-findings.md` (probe от 2026-04-19, 8/8 endpoints, 200 OK):

- `getInfo`, `getFlows`, `getTags`, `getCustomFields`, `getBotFields`, `getGrowthTools`, `getOtnTopics`, `getWidgets` — все read-meta, истории сообщений не содержат.
- `getSubscriberInfo`, `findByName`, `findByCustomField` — данные подписчика, не история.
- `sendContent`, `sendFlow` — write, не read.

**History / conversation endpoint в existing probes не найден.** Категорично утверждать «в ManyChat Public API его вообще нет» без официальной ссылки на docs не будем — статус: `not found in existing probes`.

### is_pro

`getInfo` подтверждает `is_pro=true` (см. probe findings), но это **не доказывает** наличие Live Chat admin trigger. Наличие trigger'а нужно подтверждать UI-скрином из ManyChat или официальной документацией (см. D4B).

## D4. Admin echo — оценка вариантов

| Вариант | supported | proof | blocker | next action |
|---|---|---|---|---|
| **A. ManyChat/ApiX history API** | not proven | history endpoint в existing probes не найден; в коде нигде не используется | нужен отдельный probe (не делаем без approval) или ссылка на официальные docs ManyChat Public API | опциональный отдельный discovery-патч: `probe candidate history endpoints (read-only) + docs lookup` |
| **B. ManyChat Live Chat / team-reply External Request** | not proven (готовность на нашей стороне: ✅) | код `manychat-inbound` уже принимает `is_outbound / direction=team_reply / admin_reply / message_sent` и корректно префиксует `external_message_id='mc_out:…'` (line 120-132, 207-212, 217-235); наличие trigger'а в тарифе аккаунта требует UI-скрина ManyChat | нет UI-скрина ManyChat со списком доступных trigger'ов; неизвестно, есть ли в текущем тарифе Live Chat admin trigger | пользователь снимает скрин ManyChat → Flow builder → Triggers, ищет `Live Chat message sent by admin` / `Team member replied` / аналог. Если есть — новый flow с External Request к тому же `/functions/v1/manychat-inbound?instance_id=…`, с `is_outbound=true` + `agent_name`/`agent_id` в body. Ноль кода. |
| **C. Meta Graph API `message_echoes`** | not proven | требует Meta Business Manager, own Meta App, Business Verification, Advanced Access `instagram_manage_messages`; проверить, можно ли параллельно подключить own Meta App, не ломая ManyChat webhook subscription (Meta допускает несколько subscribers на страницу, но с ограничениями по permissions/ownership — не утверждаем конфликт заранее) | большая инфраструктурная фаза, не «следующий патч» | отдельный discovery, только если A и B провалятся |
| **D. Операционная политика** | supported (fallback) | все outbound через `instagram-admin-chat.send_message` пишутся с `direction='outbound', provider_kind='manychat', sent_by_admin=<uuid>` | требует регламента для операторов | описать регламент и уведомить операторов; ноль кода |
| **E. Backfill старых admin replies (задним числом)** | **impossible unless A works** | без history API восстановить сообщения, уже отправленные Екатериной из мобильного IG, неоткуда — их нет ни в нашей БД, ни в webhook-payloads, ни в `integration_logs` | — | historical backfill: **impossible** для существующих сообщений; для новых — зависит от A/B/C |

## Decision tree для следующего патча

```
если пользователь снимет скрин ManyChat и найдёт Live Chat admin/team-reply trigger:
    → PATCH-IG-ADMIN-ECHO-MANYCHAT (только ManyChat flow config + smoke-test, кода нет)

иначе если approved probe ManyChat history endpoints и он вернёт outbound:
    → PATCH-IG-ADMIN-ECHO-APIX-HISTORY

иначе:
    → PATCH-IG-ADMIN-ECHO-META-GRAPH (большая фаза, отдельное discovery)
    или operational policy (вариант D)
```

Ни один патч не начинается без отдельного approval — даже если Live Chat trigger найдётся, следующий шаг = отдельный план, не реализация.

## Итоговая таблица

| Вопрос | Ответ | Proof |
|---|---|---|
| Как image попадает в БД? | ManyChat подставляет lookaside CDN URL в `last_input_text` → `manychat-inbound` распознаёт по regex и записывает в `media_url`, `message_text=null` | `manychat-inbound/index.ts:103-107, 184-187`; SQL sample id=`db0cb4c0-…`, `13b1a0b0-…` |
| Как video попадает в БД? | Так же, как image, + fire-and-forget rehost в `telegram-media/instagram-inbound/…`, `media_url` заменяется на signed storage URL | `instagram-media-proxy/index.ts:193-247`; SQL sample id=`2324e141-…` с `raw_payload.rehosted_media_url` |
| Приходят ли voice/audio? | not confirmed — 0 в БД за 30 дней | `SELECT DISTINCT media_type … WHERE created_at > now()-'30 days'` вернул только `null, image, video` |
| Приходят ли story/reels? | not confirmed — 0 в БД | тот же SQL |
| Есть ли отдельный API-вызов ManyChat/ApiX для media? | Нет | `rg` по коду: только `getInfo` (avatar) и `sendContent` (outbound) |
| Есть ли ManyChat history API в проекте? | Не используется; в existing probes не найден | `docs/integrations/manychat/api-probe-findings.md`; grep repo |
| Готов ли ingest принимать outbound admin echo? | Да, код уже поддерживает `is_outbound / direction=team_reply / admin_reply / …` | `manychat-inbound/index.ts:120-132, 207-235` |
| Есть ли Live Chat admin trigger в ManyChat? | not proven — требует UI-скрина ManyChat | is_pro=true доказывает только Pro-тариф, не наличие trigger'а |
| Нужен ли Meta Graph API? | only if A и B провалятся | см. D4C |
| Можно ли восстановить старые admin replies задним числом? | impossible (без history API) | `outbound=0` в БД за 30 дней; `mc_out:*` внешних id = 0 |
| Rehost работает для image? | нет (для свежих) | `raw_payload ? 'rehosted_media_url' = false` для 2/2 свежих image |
| Rehost работает для video? | да | 8/8 свежих video имеют `rehosted_*` в raw_payload |

## Что НЕ сделано (осознанно)

- Не менялся ManyChat flow, External Request body, trigger'ы.
- Не менялись edge functions (`instagram-webhook`, `instagram-admin-chat`, `manychat-inbound`, `instagram-media-proxy`).
- Не менялась схема БД, `instagram_messages`, ни одна миграция.
- Не подключался Meta Graph API.
- Не делались новые probe-вызовы к ManyChat API сверх задокументированных.
- Не читались значения секретов.

## Rollback

Не применимо — read-only.
