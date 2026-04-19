## да, согласен, с учетом правок:

1. **P2 уточнить как PATCH с обязательным diagnose-before-fix**
  - Не утверждать финально новый ManyChat payload как факт до снятия **sanitized raw-response proof** по последнему `Validation error`.
  - В плане зафиксировать: сначала логируем **HTTP status + top-level keys + body preview до 1KB** ответа ManyChat на send, и только затем меняем payload.
  - Иначе есть риск зашить неверный контракт второй раз.
  - Но execute можно делать в одном PATCH: diagnose лог + фикс payload + retry/fallback.
2. **P2: не возвращать runtime 500/502 наружу в UI**
  - Зафиксировать явно:
    - edge function для outbound ManyChat **никогда** не должна ронять UI runtime overlay;
    - на бизнес-ошибке ManyChat возвращаем **200 + нормализованный JSON** (`ok:false`, `status:'failed'`, `error_code`, `error_message`, `provider_response_excerpt`);
    - запись в `instagram_messages.status='failed'` и `integration_logs` обязательна.
  - Это надо выделить отдельно как DoD, не только упомянуть в тексте.
3. **P2: retry-chain сделать строгим и проверяемым**
  - Не писать “без tag → HUMAN_AGENT при outside_24h ИЛИ Validation error” в расплывчатом виде.
  - Нужен чёткий порядок:
    1. первичный send;
    2. если provider явно вернул признак outside-24h / tag required / message tag invalid for context — retry c допустимым tag;
    3. если снова fail — нормализованный failed без runtime crash.
  - Для каждого шага логировать отдельный `attempt_no` в `integration_logs.payload_meta`.
4. **P1: media normalizer не должен делать обязательный HEAD как блокирующий шаг**
  - HEAD к `lookaside.fbsbx.com` может быть нестабильным/медленным.
  - Зафиксировать порядок:
    - сначала быстрая классификация по URL/домену/расширению;
    - потом optional HEAD с timeout 3s как enrichment, не как hard dependency.
  - Если HEAD не удался, media всё равно должна отрендериться fallback-карточкой.
5. **P1/P5: voice и audio различать, но с общим безопасным fallback**
  - Если точно не удаётся отличить `voice` от `audio`, не выдумывать.
  - Хранить `media_type='audio'`, а UI рендерить единым audio-player.
  - `voice` использовать только если есть явный MIME/metadata.
  - Это уменьшит ложную типизацию.
6. **P3: display_name делать add-only без риска сломать существующие выборки**
  - Поддерживаю добавление `display_name`, но в плане надо явно указать:
    - старое поле `account_name` не переиспользуем и не переписываем как source-of-truth;
    - UI читает `display_name` с fallback на `account_name`, но сам synthetic `mc:*` скрывает через resolver.
  - Это безопаснее, чем массово перетирать старые значения.
7. **P3: backfill display_name зафиксировать строго**
  - Источник backfill:
    - `integration_instances.config->>'manychat_page_name'`,
    - затем metadata/healthcheck/discover cache,
    - затем fallback `NULL`.
  - Не брать synthetic `mc:*` как display_name ни при каких условиях.
8. **P4: resolver вынести в одно место и использовать везде**
  - Поддерживаю.
  - Добавить явный запрет на локальные ad-hoc проверки `startsWith('mc:')` по компонентам.
  - Только единая функция `resolveInstagramSourceLabel()` + единая функция `resolveInstagramAccountDisplayName()`.
9. **P5/P6: legacy repair in UI делать только presentation-level**
  - Хорошо, что существующие кривые записи не трогаем.
  - Зафиксировать: “лечение на лету” для старых URL-сообщений — **только UI render layer**, без silent DB rewrite/миграции данных.
10. **Добавить отдельный PATCH: скрыть provider/internal diagnostics из bubble**
  - На скрине уже видны ошибки вида:
    - `manychat http error: Validation error`
    - `manychat http error: Content can't be se...`
  - Это технические provider-errors в теле чата.
  - Их нельзя показывать как пользовательские сообщения в переписке.
  - Нужно:
    - либо рендерить их как system/admin-only status badge;
    - либо скрывать из user-facing thread и оставлять только в logs/debug panel.
  - DoD: в обычной ленте переписки нет сырого provider error текста как будто это сообщение пользователя.
11. **Добавить отдельный proof для outbound success именно в Instagram app**
  - Недостаточно success log.
  - Нужен proof-пакет:
    - отправка из Contact Center,
    - запись `sent/delivered` в нашей системе,
    - фактическое появление сообщения в Instagram/ManyChat inbox.
  - Это надо явно включить в финальный proof, иначе PATCH нельзя считать закрытым.
12. **Regression DoD расширить**
  - Помимо apixdrive, проверить:
    - список диалогов не ломается,
    - unread counter не ломается,
    - search по диалогам не ломается,
    - шапка диалога корректно показывает source label и для apix, и для manychat.
13. **Файлы/объём патча**
  - Поддерживаю текущий состав, но migration + RPC patch лучше явно разделить:
    - Migration: `instagram_accounts.display_name`
    - RPC patch: `get_instagram_dialogs_v1`
    - Frontend resolver/renderer
    - Edge inbound/outbound
  - Это упростит proof и rollback.

Итог: план хороший, логика верная. Главные обязательные правки перед execute — не утверждать outbound payload без raw-response proof, убрать технические provider-errors из ленты чата, и сделать `display_name`/resolver единым source-of-truth без перезаписи legacy данных.

&nbsp;

Diagnose (факты из логов и БД)

*1. mc: в UI** — в `get_instagram_dialogs_v1` поле `account_name` возвращается как `"mc:305d6fa43ef5c6f8cc9602cb"`. Это synthetic ID из ManyChat-аккаунта (`instagram_accounts.account_name`). UI показывает его как-есть в списке/шапке диалога.

**2. Outbound 502 / Validation error** — последний fail (`a65237c5...`, `03faefd4...`) → `manychat http error: Validation error`. При этом 24h-окно НЕ закрыто (Сергей писал минуту назад: `Test 6666` в 18:44, ответ в 18:46). Значит проблема не в окне, а в **структуре payload**. Текущий код шлёт `data.version: 'v2'` + `content.messages[]`. По факту контракта `/fb/sending/sendContent` для Instagram валидным является `**message_tag` на верхнем уровне**, а не внутри data, и `data` должен содержать `version: "v2"` + `content: { type: "instagram", messages: [...] }` (с явным `type: "instagram"`). Также фронт получает 502, потому что edge function возвращает `status: 500`/non-2xx при fail вместо 200+`fallback:true` (нарушает `payment-error-handling` стандарт).

**3. Inbound media** — приходит как `last_input_text: "https://lookaside.fbsbx.com/..."`. ManyChat в `last_input_text` суёт URL вложения для image/audio/video. Сейчас inbound-функция кладёт это в `message_text`, `media_url=null`, `media_type=null`. Нужно детектить URL+расширение/домен `lookaside.fbsbx.com` и нормализовать в media поля.

**4. UI bubble** — рендерит `message_text` как plain text, длинная ссылка показывается строкой.

## План (8 точечных патчей, add-only)

### Backend

**P1. `manychat-inbound`: нормализация media**

- Детектить `last_input_text`, начинающийся с `http(s)://lookaside.fbsbx.com/` или содержащий расширение `.jpg/.png/.mp4/.mp3/.ogg/.m4a/.webp`.
- HEAD-запрос (с timeout 3s, fallback по URL pattern) → определить `mime_type`.
- Маппинг: `image/* → image`, `audio/*|voice → voice/audio`, `video/* → video`, иначе `file`.
- Писать в `instagram_messages`: `media_url=<url>`, `media_type=<тип>`, `message_text=NULL` (для media-only) или текст без URL.
- Для уже существующих кривых записей — НЕ трогать (regression safety).

**P2. `instagram-admin-chat` outbound: правильный ManyChat payload + graceful error**

- Payload v2:
  ```json
  {
    "subscriber_id": <number>,
    "data": {
      "version": "v2",
      "content": { "type": "instagram", "messages": [{"type":"text","text":"..."}] }
    },
    "message_tag": "<tag>"  // на верхнем уровне
  }
  ```
- Retry chain: (1) без tag → (2) `HUMAN_AGENT` при `outside_24h` ИЛИ `Validation error`.
- Полный sanitized dump ответа ManyChat (status + body 1KB) → `integration_logs.event_type='manychat.send.response'` (без токенов).
- При финальном fail — возвращать **HTTP 200** + `{ok:false, fallback:true, error:"<normalized>"}`. UI больше не получит 502/runtime overlay.

**P3. Page display metadata SOT**

- В `instagram_accounts` уже есть `account_name`. Добавим миграцией поле `display_name TEXT` (если ещё нет) + бэкфилл из `metadata.page_name`/`metadata.instagram_username` если присутствует.
- При следующем inbound от ManyChat — если в payload есть `page.name` или `account.name` — апдейтить `display_name`.
- RPC `get_instagram_dialogs_v1` дополнить: возвращать `display_name` отдельно, а `account_name` оставить для совместимости.

### Frontend

**P4. Source label resolver (add-only утилита)**

- Новая функция `resolveInstagramSourceLabel(account)`:
  - Если `display_name` есть и не начинается с `mc:` → `"Instagram Direct · <display_name>"`.
  - Иначе → `"Instagram Direct"`.
  - Никогда не показывать `mc:*`, `subscriber_id`, `thread_key`.
- Применить в: списке диалогов слева, шапке открытого диалога, subtitle карточки.

**P5. Media bubble renderer (add-only)**

- Новый компонент `<InstagramMessageMedia>`:
  - `image` → `<img>` thumbnail с кликом → `MediaLightbox` (уже есть).
  - `voice/audio` → `<audio controls>`.
  - `video` → `<video controls>` с poster.
  - `file` → карточка с иконкой + кнопка «Открыть».
  - unknown + media_url → fallback карточка с кнопкой «Открыть ссылку» (НЕ сырой URL-текст).
- В существующем bubble:
  - если `media_url` есть → рендерить media + (опционально) текст;
  - если text начинается с `http(s)://lookaside.fbsbx.com/` и `media_url` пуст → лечить «на лету» (legacy записи): показать как image/file fallback, не плейн-ссылкой.

**P6. Mixed content handling**

- text+media → text bubble сверху + media снизу.
- media-only → только media bubble (без пустого пузыря).
- unsupported → бейдж «Вложение недоступно» вместо «Unsupported message».

### Regression safety

**P7. Legacy apixdrive**

- Все изменения в RPC/UI — additive: новые поля опциональны, старый `account_name` остаётся.
- Renderer для media срабатывает только при `media_url != null` ИЛИ если text — это валидный media URL (по pattern). Старые text-only диалоги не затрагиваются.

### Финальный proof (после execute)

1. Скрин Contact Center: в шапке/списке `Instagram Direct · <имя>` вместо `mc:*`.
2. Скрин входящей картинки от Сергея — рендер preview, клик → лайтбокс.
3. Скрин успешной отправки текста в Instagram (status `sent`, без 502).
4. SQL-выписка из `integration_logs`: `manychat.send.response` с HTTP 200 от ManyChat.
5. Diff-summary по файлам:
  - `supabase/functions/manychat-inbound/index.ts` (P1, P3)
  - `supabase/functions/instagram-admin-chat/index.ts` (P2)
  - migration: `instagram_accounts.display_name` + RPC update (P3)
  - `src/lib/resolveInstagramSourceLabel.ts` (new, P4)
  - `src/components/admin/chat/InstagramMessageMedia.tsx` (new, P5)
  - `src/components/admin/chat/MessageBubble.tsx` или эквивалент (P5, P6)
  - инстанс-список + шапка диалога в `InboxTabContent`/Instagram-чате (P4)

### DoD (cumulative)

- Нигде в UI нет `mc:*`, `subscriber_id`, `thread_key`.
- Source label единообразный во всех трёх местах.
- Текст из Contact Center реально приходит в Instagram, в БД status=`sent`.
- Никаких 502/runtime overlay при ошибках send — только нормализованный текст ошибки.
- Inbound image/voice/video рендерится как media, не как URL-текст.
- Legacy apixdrive диалоги визуально не изменились.

### Stop-condition

Закрываем только при выполнении всех 6 пунктов proof выше с приложенными скринами и SQL-выписками.