# PATCH-IG-MANYCHAT-API-ECHO-DISCOVERY

Дата: 2026-07-04
Тип: read-only discovery. Ни код, ни ManyChat flow, ни webhook, ни `instagram_messages`, ни Meta Graph не меняли. Новых API probe-вызовов не делали (только скачали публичный Swagger).

## Короткий ответ

**Можно ли получить ответы Екатерины из Instagram app через ManyChat API/UI?**
**Нет** — через официальный ManyChat Public API это невозможно, и через стандартные Automation trigger'ы в UI — тоже. Proof: полный inventory endpoints Swagger'а (см. D1) и проверенный список Instagram trigger'ов в UI пользователем.

Что делать дальше: одно из двух — **D. операционная политика** (отвечать только из платформы) прямо сейчас, либо **C. отдельная Meta Graph API интеграция с `message_echoes`** как крупная отдельная фаза. Варианты **A** (ManyChat history polling) и **B** (ManyChat admin echo trigger) — отпадают по документации.

---

## D1. ManyChat Public API — полный inventory endpoints (Swagger)

Источник: `https://api.manychat.com/swagger` → `Page API` (`compileJson?type=Page_API`) и `Profile API` (`compileJson?type=Profile_API`), скачано 2026-07-04.

**Page API — все endpoint'ы (35 шт., полный список):**

| Endpoint | Method | Что делает | History? | Outbound/admin echo? | Timestamp/msg_id? | Direction? | Media? | Для backfill? | Доп. permission |
|---|---|---|---|---|---|---|---|---|---|
| `/fb/page/getInfo` | GET | инфо о странице/боте | — | — | — | — | — | — | нет |
| `/fb/page/getTags` | GET | список тегов | — | — | — | — | — | — | нет |
| `/fb/page/createTag` | POST | создать тег | — | — | — | — | — | — | нет |
| `/fb/page/removeTag` / `removeTagByName` | POST | удалить тег | — | — | — | — | — | — | нет |
| `/fb/page/getWidgets` | GET | growth widgets | — | — | — | — | — | — | нет |
| `/fb/page/getGrowthTools` | GET | growth tools | — | — | — | — | — | — | нет |
| `/fb/page/getFlows` | GET | список flows | — | — | — | — | — | — | нет |
| `/fb/page/getCustomFields` | GET | custom fields | — | — | — | — | — | — | нет |
| `/fb/page/createCustomField` | POST | создать custom field | — | — | — | — | — | — | нет |
| `/fb/page/getOtnTopics` | GET | one-time notification topics | — | — | — | — | — | — | нет |
| `/fb/page/getBotFields` / `createBotField` / `setBotField[s]` / `setBotFieldByName` | GET/POST | глобальные bot fields | — | — | — | — | — | — | нет |
| `/fb/sending/sendContent` | POST | **отправить контент подписчику** | — | — | — | outbound only (запись, не чтение) | ✅ (в payload) | — | нет |
| `/fb/sending/sendContentByUserRef` | POST | send via user_ref | — | — | — | outbound only | ✅ | — | нет |
| `/fb/sending/sendFlow` | POST | запустить flow подписчику | — | — | — | outbound only | ✅ | — | нет |
| `/fb/subscriber/getInfo` | GET | инфо о подписчике (name, tags, custom_fields, last_interaction) | ❌ | ❌ | — | — | — | ❌ (нет messages) | нет |
| `/fb/subscriber/getInfoByUserRef` | GET | то же по user_ref | ❌ | ❌ | — | — | — | ❌ | нет |
| `/fb/subscriber/findByName` | GET | поиск по имени | ❌ | ❌ | — | — | — | ❌ | нет |
| `/fb/subscriber/findByCustomField` | GET | поиск по custom field | ❌ | ❌ | — | — | — | ❌ | нет |
| `/fb/subscriber/findBySystemField` | GET | поиск по system field | ❌ | ❌ | — | — | — | ❌ | нет |
| `/fb/subscriber/addTag[ByName]` / `removeTag[ByName]` | POST | теги подписчика | — | — | — | — | — | — | нет |
| `/fb/subscriber/setCustomField[s]` / `setCustomFieldByName` | POST | поля подписчика | — | — | — | — | — | — | нет |
| `/fb/subscriber/verifyBySignedRequest` | POST | верификация | — | — | — | — | — | — | нет |
| `/fb/subscriber/createSubscriber` | POST | создать unified subscriber | — | — | — | — | — | — | нет |
| `/fb/subscriber/updateSubscriber` | POST | обновить subscriber | — | — | — | — | — | — | нет |

**Profile API — все endpoint'ы (1 шт.):**

| Endpoint | Method | Что делает |
|---|---|---|
| `/user/template/generateSingleUseLink` | POST | создать одноразовую ссылку для установки шаблона |

**Ключевой вывод по D1:** в официальном Swagger **не существует** ни одного из:

- `conversation`, `conversations`, `messages`, `history`, `getMessages`, `getHistory`
- `inbox`, `livechat`, `live_chat`
- `event`, `events`, `webhook subscriptions`, `subscribe`
- `team`, `admin`, `agent` (кроме упоминания в custom flow payload)

Единственный способ отправить сообщение — POST на `/fb/sending/*`. Единственный способ узнать что-то про подписчика — GET `/fb/subscriber/*`, и там возвращаются только профильные поля и `last_interaction` timestamp — **не тело сообщений**. Читающего history endpoint в Public API нет.

## D2. Текущий ManyChat API usage в проекте

Grep по `api.manychat`, `manychat`, `/fb/`, `conversation`, `history`, `live[_-]?chat`, `inbox`:

- `supabase/functions/instagram-admin-chat/index.ts:475,519` — `POST /fb/sending/sendContent` (outbound с платформы).
- `supabase/functions/manychat-inbound/index.ts:487` — `GET /fb/subscriber/getInfo?subscriber_id=…` (только avatar backfill).
- `supabase/functions/manychat-diagnose-capture` — probe `getInfo/getFlows/getTags/getCustomFields/getBotFields/getGrowthTools/getOtnTopics/getWidgets` (см. `docs/integrations/manychat/api-probe-findings.md`).
- ApiX как отдельная прослойка **не используется** для чтения — `instagram-webhook/index.ts` это legacy ApiX-Drive путь inbound-only, не hitting ManyChat API.
- Credentials: `MANYCHAT_API_KEY` (уже есть в secrets, account-level Public API key). Отдельных read-only ключей нет.

**Endpoint'а, который может вернуть сообщения оператора, в текущем коде нет и по Swagger не существует.**

## D3. Гипотеза «через API можно прочитать conversation history»

```
ManyChat API has conversation/history endpoint: no (not present in official Swagger — full inventory in D1)
Admin outbound replies included: no (no endpoint returns message bodies at all)
Media included: no
Historical backfill possible: no
```

Новых probe-вызовов не делаем — probe не нужен: endpoint отсутствует в спецификации.

## D4. ManyChat Inbox / Live Chat event

- Swagger (D1) не содержит ни `webhook subscription`, ни `event`, ни `livechat` endpoint'ов. Управление webhook subscription'ами в Public API отсутствует; входящие события форвардятся исключительно через **flow trigger + External Request** (пользовательская конфигурация внутри Automations).
- В Automations trigger'ы для Instagram (проверено пользователем в UI): `Post or Reel comment`, `Story reply`, `Direct message`. Отсутствуют: `Admin replied`, `Team member replied`, `Live Chat message sent by admin`, `Operator replied`, `Message sent by page/admin`.
- Публичной документации ManyChat, описывающей admin outbound trigger для Instagram, найти не удалось. В Settings → Webhooks/Live Chat в UI такой trigger пользователь тоже не нашёл.

**Вывод:** ManyChat UI + Swagger не предоставляют admin outbound echo trigger для Instagram.

## D5. Текущий код-путь для outbound

- `supabase/functions/instagram-admin-chat/index.ts` (`send_message`) — при отправке из нашей платформы вызывает `POST /fb/sending/sendContent` и создаёт запись в `instagram_messages` с `direction='outbound'`, `provider_kind='manychat'`, `sent_by_admin=<uuid>`. Подтверждено ранее в `2026-07-04-ig-media-and-admin-echo-discovery.md`.
- `supabase/functions/manychat-inbound/index.ts:120-132, 207-235` — уже умеет распознавать outbound-payload (`is_outbound`, `direction ∈ {outbound, outgoing, team_reply, agent_reply, admin_reply, message_sent}`) и пишет `direction='outbound'` c префиксом `external_message_id='mc_out:…'`, `sent_by_admin_name=<agent_name>`.

Значит наша сторона к outbound-payload'у готова. Проблема исключительно в том, что **ManyChat никем никогда его не отправляет** — trigger'а для этого в Automations нет, а в Public API нет endpoint'а, откуда бы наш webhook мог получить/дозапросить эти сообщения.

## D6. Decision matrix

| Вариант | Реальность | Что нужно | Риск | Рекомендация |
|---|---|---|---|---|
| **A. ManyChat API history polling** | **not supported** — endpoint отсутствует в официальном Swagger (D1 — полный inventory 35 Page + 1 Profile) | — | — | **отклонить** |
| **B. ManyChat Live Chat / Admin echo trigger в Automations** | **not found** — trigger не существует в Instagram Automations (проверено пользователем в UI); Swagger не содержит event/webhook subscription API | — | — | **отклонить** (пока ManyChat не добавит такой trigger публично) |
| **C. Meta Graph API `message_echoes`** | технически возможно | Meta Business Manager, own Meta App, Business Verification, Advanced Access `instagram_manage_messages`, проверка сосуществования с ManyChat webhook subscription на той же странице | high (большая инфра-фаза, риск конфликта с ManyChat как webhook receiver, срок Business Verification недели) | если исходящая история из мобильного IG критична бизнес-требованием — отдельный discovery-патч на инфраструктуру Meta App |
| **D. Операционная политика — отвечать только из платформы** | доступно **прямо сейчас** без единого коммита | регламент для операторов + мягкий UI-nudge (опционально) | low | **рекомендуемый шаг**. Все outbound через `instagram-admin-chat.send_message` пишутся с `direction='outbound', provider_kind='manychat', sent_by_admin=<uuid>` — история будет полной by design |

## Что дальше (без действий, только предложения)

1. **Немедленно:** зафиксировать за операторами регламент отвечать Instagram-клиентам только из платформы (Вариант D). Ноль кода.
2. **Опционально позже:** отдельный discovery-патч `PATCH-IG-META-GRAPH-ECHO-DISCOVERY` — только инфраструктурная проверка (Business Manager ownership, возможность параллельного webhook subscription с ManyChat, план получения Advanced Access `instagram_manage_messages`). Только discovery, без кода.
3. Периодически мониторить changelog ManyChat на предмет появления Instagram admin-echo trigger — если появится, наша сторона (`manychat-inbound`) готова принять payload без изменений.

## Что НЕ сделано (по контракту патча)

- Не менялся код.
- Не менялся ManyChat flow.
- Не публиковалась новая automation.
- Не делалось новых API probe-вызовов (только скачан публичный Swagger — read-only, без auth).
- Не подключался Meta Graph API.
- Не менялся webhook.
- Не менялась таблица `instagram_messages`.

## Rollback

Не применимо — изменений не было.
