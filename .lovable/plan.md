да, согласен, с учетом правок:

1. **Не утверждать “voice приходит”, пока нет SQL-примера voice/audio.**
  &nbsp;
  В плане правильно добавлено:
  ```text
  Если voice нет — честно записать «voice в БД не подтверждён».
  ```
  Но в D5 сейчас снова написано:
  ```text
  Media/voice приходят через ManyChat External Request...
  ```
  Исправить на:
2. **Разделить** `image/video` **и** `voice/audio`**.**
  &nbsp;
  Для каждого типа отдельно:
  ```text
  image — confirmed / not confirmed
  video — confirmed / not confirmed
  audio/voice — confirmed / not confirmed
  story/reels — confirmed / not confirmed
  ```
  Не объединять всё словом “media”.
3. `last_input_text = CDN URL` **— проверить, не ломается ли text search/history.**
  &nbsp;
  В discovery добавить вопрос:
  ```text
  Если media хранится как URL в message_text/last_input_text, что показывается оператору в UI и ContactFeed?
  ```
  Нужно понять:
  - `message_text` остаётся URL или пустой;
  - UI рендерит по `media_url`;
  - поиск по ленте не засоряется CDN-ссылками.
4. **Проверить срок жизни CDN URL.**
  &nbsp;
  `lookaside.fbsbx.com/ig_messaging_cdn` ссылки часто временные. Раз уже есть rehost в `telegram-media/instagram-inbound`, нужно доказать:
  - rehost происходит успешно;
  - UI использует `rehosted_media_url` или signed storage URL, а не протухший CDN;
  - failed rehost логируется.
5. **D1: брать не только 5 media messages, а минимум по одному на каждый найденный** `media_type`**.**
  &nbsp;
  Сначала:
  ```sql
  SELECT media_type, count(*)
  FROM instagram_messages
  WHERE created_at > now() - interval '30 days'
  GROUP BY media_type;
  ```
  Потом примеры по каждому типу.
6. **D1: проверить** `external_message_id` **/ dedup.**
  &nbsp;
  Для admin echo это важно. Добавить:
  ```sql
  SELECT external_message_id, count(*)
  FROM instagram_messages
  WHERE external_message_id IS NOT NULL
  GROUP BY external_message_id
  HAVING count(*) > 1;
  ```
  Нужно понять, можно ли безопасно дедуплицировать будущие echo-события.
7. **D2: найти все insert/update в** `instagram_messages`**, не только функции по именам.**
  &nbsp;
  Добавить grep:
  ```bash
  rg -n "from\\('instagram_messages'\\)|instagram_messages|insert\\(|update\\(" supabase/functions src
  ```
  Цель — не пропустить worker/helper, который пишет rehost или media.
8. **D2: подтвердить, кто именно ставит** `provider_kind='manychat'`**.**
  &nbsp;
  В audit указать:
  - где выставляется `provider_kind`;
  - какие ещё provider_kind бывают;
  - есть ли ApiX как отдельный provider.
9. **D3:** `secrets--fetch_secrets` **не использовать без необходимости.**
  &nbsp;
  Для read-only discovery достаточно:
  - grep по названиям секретов;
  - существующие docs/probe findings;
  - проверка, какие переменные используются в коде.
  Не вытаскивать реальные секреты в отчёт. Если нужно подтвердить наличие — писать только:
  ```text
  secret exists / missing
  ```
  без значения.
10. **D3: не делать новых API probe-вызовов — верно.**

Но если в существующих docs нет ответа по history endpoint, статус должен быть:

```text
not found in existing probes
```

А не категорично:

```text
ManyChat Public API не предоставляет endpoint
```

Категорично можно писать только при ссылке на официальный API/docs или уже выполненный probe.

11. **D4B: тариф** `is_pro` **не доказывает наличие Live Chat admin trigger.**

`is_pro=true` только означает, что аккаунт Pro. Наличие trigger-а нужно подтверждать:

- UI-скрином из ManyChat;
- официальной документацией;
- или existing API/probe.

12. **D4C: “конфликт с ManyChat как единственным получателем webhook” сформулировать осторожно.**

Meta может отправлять webhook нескольким apps/подпискам в зависимости от конфигурации, но могут быть ограничения по permissions/ownership. Написать:

```text
проверить, можно ли параллельно подключить own Meta App, не ломая ManyChat.
```

Не утверждать конфликт заранее.

13. **Добавить вариант E: Instagram app replies невозможно восстановить задним числом.**

Даже если echo подключим завтра, старые ответы Екатерины из IG app, скорее всего, не появятся в нашей БД, если нет history API.

В audit указать:

```text
historical backfill of admin replies: possible / impossible / unknown
```

14. **Рекомендация должна быть не “один из четырёх вариантов”, а decision tree.**

В итоговой таблице:

```text
Если ManyChat/ApiX history returns outbound → PATCH-IG-ADMIN-ECHO-APIX-HISTORY
Если есть Live Chat admin trigger → PATCH-IG-ADMIN-ECHO-MANYCHAT
Если нет → operational policy or Meta Graph discovery
```

15. **В DoD заменить “доступен ли admin echo” на “что доказано”.**

Для каждого варианта:

```text
supported / not supported / not proven
proof
blocker
next action
```

16. **Не смешивать** `manychat-inbound` **и** `instagram-webhook` **без точного ответа.**

На скринах URL ведёт в:

```text
/functions/v1/manychat-inbound?instance_id=...
```

Поэтому в отчёте нужно точно указать, какая функция реально принимает этот flow и дальше куда роутит.

17. **Добавить проверку** `raw_payload.rehosted_*` **по свежим media.**

SQL:

```sql
SELECT
  raw_payload ? 'rehosted_media_url',
  raw_payload ? 'rehosted_storage_path',
  raw_payload->>'rehosted_content_type',
  raw_payload->>'rehosted_at'
FROM instagram_messages
WHERE media_type IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

18. **Старый audit пометить superseded только частично.**

Формулировка:

```text
Superseded only for non-text/media completeness.
Still valid for admin replies gap unless new evidence disproves it.
```

19. **Итоговый отчёт:**

```text
Отчет о выполненной работе: PATCH-IG-MEDIA-AND-ADMIN-ECHO-DISCOVERY
```

20. **После discovery не начинать код без отдельного approval.**

Даже если найдётся Live Chat trigger/API endpoint, следующий шаг — отдельный план, не реализация сразу.

После этих правок план утверждён. Выполнять строго read-only.

&nbsp;

План: PATCH-IG-MEDIA-AND-ADMIN-ECHO-DISCOVERY (read-only)

## Контекст и корректировка прошлого диагноза

Предыдущий вывод «non-text не форвардятся и их нет в БД» — **неверный**. Быстрая проверка `instagram_messages` показывает: за 2026-07-04 приходят входящие с `media_type IN ('image','video')`, `provider_kind='manychat'`, и:

- В `raw_payload` — тот же самый ManyChat External Request body формата `{subscriber, last_input_text}`.
- Но при медиа-сообщении `last_input_text` содержит **CDN-URL** `https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=…&signature=…` — ManyChat сам подставляет URL актива вместо текста.
- Наш обработчик распознаёт этот URL, ставит `media_type`, и затем через media-worker перезаливает файл в bucket `telegram-media/instagram-inbound/…`, дописывая `rehosted_media_url`, `rehosted_storage_path`, `rehosted_content_type`, `rehosted_at` обратно в `raw_payload`.

То есть механизм — **тот же External Request**, никакой отдельной ManyChat/ApiX History API-подкачки нет (по крайней мере на этих примерах). Это принципиально меняет вывод про admin echo: тот же трюк «подставить URL в last_input_text» **не поможет** для сообщений оператора из мобильного Instagram, потому что ManyChat не триггерит External Request на исходящие оператора в стандартном тарифе/flow.

Цель патча — read-only подтвердить эту гипотезу до конца и сформулировать реальные варианты для admin echo.

## Что делаем (read-only, ничего не меняем)

### D1. Trace media ingestion path

- Взять 5 свежих `instagram_messages` c `media_type IS NOT NULL` (разные типы: image, video, voice/audio если есть).
- Для каждого зафиксировать: `id, created_at, direction, message_text, media_type, media_url, external_message_id, provider_kind, thread_key, peer_id, ig_thread_id, instagram_account_id, полный raw_payload`.
- Сопоставить с `integration_logs` (± 30 сек по `created_at`) — какой webhook создал запись, есть ли рядом «второй» вызов (indicator external API lookup).
- Отдельно проверить наличие voice/audio: `SELECT DISTINCT media_type FROM instagram_messages WHERE created_at > now()-interval '30 days'`. Если voice нет — честно записать «voice в БД не подтверждён; пользователь видел voice в UI ManyChat, но у нас в БД примеров нет».

### D2. Code trace (без правок)

Прочитать и задокументировать:

- `supabase/functions/instagram-webhook/index.ts` — как определяется `media_type`/`media_url`, есть ли ветка распознавания `lookaside.fbsbx.com`, есть ли исходящий HTTP к ManyChat/ApiX.
- `supabase/functions/manychat-inbound/index.ts` (если существует) — тот же вопрос.
- `supabase/functions/instagram-admin-chat/index.ts` — где пишется outbound (`direction='outbound'`), какие поля устанавливаются.
- Media-worker (`telegram-media-worker*` или аналог для IG) — как rehost попадает в `raw_payload.rehosted_*` и bucket `telegram-media/instagram-inbound`.
- Поиск по репо: `rg -n 'lookaside|ig_messaging_cdn|instagram-inbound|rehosted_media_url|history|conversations' supabase/functions`.

Ответить письменно:

1. Какая функция создаёт inbound `instagram_messages` для IG/ManyChat?
2. Где вычисляется `media_type` / `media_url` (по URL-паттерну из `last_input_text` или из отдельных полей payload)?
3. Есть ли исходящий вызов ManyChat/ApiX API после получения `subscriber.id`? Если да — endpoint, credentials, что возвращает.
4. Есть ли где-либо fetching «conversation history» / «contact messages»?
5. Почему media/voice приходит: подстановкой URL в `last_input_text` (гипотеза), отдельным API-вызовом, или ещё чем.
6. Есть ли аналогичный endpoint, способный вернуть outbound admin messages?

### D3. ManyChat capability discovery (без записи, без включения новых trigger'ов)

- `secrets--fetch_secrets` → какие ManyChat/ApiX ключи сохранены и где используются (grep).
- Список endpoint'ов ManyChat уже задокументирован в `docs/integrations/manychat/api-probe-findings.md`. Сверить: `getSubscriberInfo`, `findByCustomField`, есть ли probe для history/conversation. Если есть публичный endpoint истории — зафиксировать; если нет (по нашей probe-матрице сейчас его нет) — явно написать «ManyChat Public API не предоставляет endpoint для чтения истории сообщений подписчика».
- Если по коду выяснится, что в webhook есть outbound HTTP к ManyChat/ApiX (D2 п.3), — задокументировать endpoint и его возможности. Никаких новых probe-вызовов без отдельного approval.

### D4. Admin echo — три варианта, оценка каждого

На основе фактов D1–D3 заполнить таблицу:

- **A. ManyChat/ApiX history API** — доступен ли, возвращает ли outbound, есть ли admin identity, timestamps, message_ids, media. Если такого endpoint нет — зафиксировать.
- **B. ManyChat Live Chat trigger** — по докам/API-матрице проверить наличие «message sent by admin»/«Live Chat» trigger в тарифе аккаунта (`getInfo → is_pro`). Скрин UI ManyChat запрашивается у пользователя отдельно — сами в UI не лезем.
- **C. Meta Graph API `message_echoes**` — зафиксировать требования (Business Manager, own Meta App, Business Verification, Advanced Access `instagram_manage_messages`, конфликт с ManyChat как единственным получателем webhook'а).
- **D. Операционная политика** — все ответы только через нашу платформу (`instagram-admin-chat.send_message`).

### D5. Обновить audit

Создать `docs/audit/2026-07-04-ig-media-and-admin-echo-discovery.md`:

- Явный дисклеймер: предыдущий вывод «non-text не приходят / отсутствуют» — **снят**. Media/voice приходят через ManyChat External Request с CDN-URL в `last_input_text`, затем rehost в наш storage.
- Единственный подтверждённый gap: **outbound admin replies из мобильного Instagram** в нашу БД не попадают.
- Итоговая таблица вопрос/ответ/proof.
- Рекомендация: какой из патчей (A/B/C/D) двигать дальше.

Прошлый файл `docs/audit/2026-07-04-ig-messages-diagnosis.md` не удаляем — добавим ссылку на новый audit с пометкой «superseded в части non-text».

## Границы (что НЕ делаем)

- Не меняем ManyChat flow, External Request body, trigger'ы.
- Не меняем `instagram-webhook`, `instagram-admin-chat`, media-worker.
- Не пишем миграции, не трогаем `instagram_messages`.
- Не подключаем Meta Graph API.
- Не делаем probe-вызовов к ManyChat API сверх уже задокументированных.

## DoD

- Файл `docs/audit/2026-07-04-ig-media-and-admin-echo-discovery.md` создан с секциями D1–D5 и итоговой таблицей.
- Явно указано: как именно media/voice попадают в БД (с SQL/код-цитатами и line refs).
- Явно указано, доступен ли admin echo через (A) ManyChat API, (B) Live Chat trigger, (C) Meta Graph API; для каждого — цена/риск/blocker.
- Рекомендация «следующий патч» с одним из четырёх вариантов.
- Ноль изменений в коде, БД, конфиге, edge functions.

## Rollback

Не применимо — read-only.