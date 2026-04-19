## да, согласен, с учетом правок:

1. **Снизить scope первого патча**
  - Не тащить сразу весь Telegram-чат 1:1 в один проход.
  - Разбить на 2 очереди:
    - **PATCH 1 (обязательный, production pain):** убрать `mc:*`, починить outbound send, нормализовать inbound media, inline-render image/audio/video/file, backfill/display avatar, page/source label.
    - **PATCH 2 (UX enhancement):** реакции, reply-цитирование, pin/favorite, ContactDetailSheet, emoji picker, drag&drop, voice/video-note recorder.
  - Иначе слишком большой риск сломать уже работающий IG/MCT контур.
2. **Не заявлять “визуально и функционально идентичен Telegram” как DoD для первого прохода**
  - Это завышенный scope.
  - Для первого этапа DoD должен быть:
    - читаемый чат,
    - нормальные source labels,
    - медиа рендерятся,
    - outbound работает,
    - аватар есть,
    - без сырых URL и без runtime 502.
  - Полную Telegram-parity вынести во второй этап.
3. **A1/A2/A3 миграции разделить**
  - Отдельно:
    - `instagram_messages` add-only columns,
    - `instagram_message_reactions`,
    - `instagram_chat_preferences`,
    - `display_name`/RPC patch.
  - Не смешивать всё в одну огромную миграцию.
  - Нужен порядок:
    1. schema add-only,
    2. backfill,
    3. RPC patch,
    4. edge updates,
    5. frontend.
4. `display_name` **поддерживаю, но** `account_name` **не переписывать**
  - `account_name` оставить как legacy/internal field.
  - UI должен читать:
    - `display_name`,
    - fallback на человекочитаемое имя страницы из config,
    - и только потом нейтральный `Instagram Direct`.
  - `mc:*` никогда не выводить в UI, но и не использовать как display source.
5. **A4 backfill avatar сделать безопасным**
  - Поддерживаю backfill из `raw_payload->subscriber->profile_pic`.
  - Но не перетирать существующий `avatar_url`, если новый null/пустой.
  - В `manychat-inbound` обновлять только если пришло валидное URL-значение.
6. **A6 /** `get_instagram_messages_v1` **— поддерживаю, но без мгновенного выпиливания старого edge history**
  - Новый RPC добавить.
  - Переключение фронта на него делать флагом/поэтапно.
  - Старый `get_history` оставить как fallback до proof нового RPC в UI.
  - Это снизит риск blank screen.
7. **B1 outbound media/upload — вынести из первого production-патча**
  - Сейчас главная боль не отправка файлов наружу, а:
    - текстовые outbound ошибки,
    - входящие media как ссылки,
    - кривой source label.
  - `upload_media`, outbound attachments, video-note recorder — это уже второй этап.
  - Иначе очень большой scope на один патч.
8. **B2 media proxy в Storage — поддерживаю, но как async best-effort**
  - Нельзя делать загрузку в Storage блокирующим условием отображения сообщения.
  - Порядок:
    - сообщение сразу сохраняется,
    - UI рендерит текущий URL/fallback,
    - proxy job догружает media в Storage,
    - после этого UI использует storage URL.
  - Иначе получим задержки/потери медиа на ingestion.
9. `instagram_chat_preferences` **— поддерживаю**
  - Это правильный путь для pinned/favorite.
  - Но сами pinned/favorite можно вынести во второй этап.
  - В первом этапе достаточно заложить схему и RPC-ready поля, без обязательного UI-доведения до production.
10. **Реакции — только второй этап**
  - Внутренние реакции админов ок, но это не критичный production blocker.
  - Не мешать их с media/send/source-label fixes.
  - Иначе proof размоется.
11. **Reply-цитирование — второй этап**
  - Тоже полезно, но не production blocker.
  - Сначала добиться:
    - нормального имени,
    - аватара,
    - медиа,
    - стабильной отправки текста.
12. **Voice/video-note recorder — точно отдельным этапом**
  - Это тяжелый UI/media scope.
  - Не включать в текущий обязательный патч.
  - В текущем этапе достаточно корректно **принимать и воспроизводить** входящие voice/audio inline.
13. **P0 перед execute: обязательный diagnose raw shapes**
  - Перед первым этапом показать raw examples для:
    - inbound image,
    - inbound audio/voice,
    - outbound validation error response,
    - текущий источник `mc:*` в RPC.
  - Без этого будет риск чинить “по предположению”.
14. **DoD пересобрать на 2 этапа**

**Этап 1 — production fix DoD:**

- в UI нигде нет `mc:*`;
- source label человекочитаемый;
- аватар Сергея отображается;
- inbound image/audio/video/file не рендерятся сырым URL;
- outbound text из Contact Center уходит без runtime 502;
- provider errors не показываются как обычные сообщения пользователя;
- legacy apixdrive не сломан.

**Этап 2 — UX parity DoD:**

- pinned/favorite;
- reply-цитирование;
- реакции;
- emoji picker;
- drag&drop;
- outbound media attachments;
- voice/video-note recorder;
- ContactDetailSheet parity.

15. **Финальный формат исполнения**

- Сначала принести **сокращённый revised plan** на Этап 1.
- После его закрытия — отдельный план на Этап 2.
- Не смешивать оба этапа в один execute.
- &nbsp;
- Diagnose (факты)

**Telegram-чат — что есть (1486 строк, эталон):**

1. **Сообщения**: текст, edit, delete, **reply (цитирование)**, статусы (queued/sending/sent/delivered/failed), edited badge.
2. **Реакции**: whitelist эмодзи, hover-picker над bubble, агрегированный счётчик (`useTelegramReactions`).
3. **Закрепление и избранное диалога**: `chat_preferences` (admin_user_id × contact_user_id) + Pin/Star в шапке списка и фильтры «Закреплённые/Избранные».
4. **Медиа inline**: `ChatMediaMessage` (image/video/audio/voice/video-note/file/PDF) + `MediaLightbox` (zoom, скачать, скопировать). `uploadStatus=pending/ok/error` с авто-poll.
5. **Отправка медиа**: `OutboundMediaPreview` — drag&drop, paste, превью перед отправкой, кнопки 📎/🎙️/🎥/🖼️.
6. **Голосовые/видео-кружки**: `VideoNoteRecorder` запись прямо в браузере.
7. **Шапка**: аватар (с возможностью обновить через `onAvatarUpdated`), имя, контакт-кнопка → `**ContactDetailSheet**` (профиль, заказы, подписки, доступы).
8. **Bot selector** (для Telegram актуален; для IG не нужен).
9. **Список диалогов**: pin/favorite badges, swipe-to-read, hover-actions, фильтры all/unread/read/favorites/pinned, расширенные фильтры (продукт, дата, заказ).
10. **Эмодзи-пикер** в input.
11. **Контекстное меню сообщения** (3-точки): edit/delete/reply.

**Instagram-чат — что есть сейчас (314 строк):**

- Только текст + базовый `InstagramMessageMedia` (image/video/audio/file fallback) + render legacy URL «на лету».
- Нет: pin/favorite, реакций, reply, edit/delete, voice recorder, drag&drop, lightbox, контактной шторки, фильтра pinned/favorite, эмодзи-пикера, превью загрузки.
- Аватар собеседника (Сергея) пустой — `instagram_contacts.avatar_url IS NULL`. ManyChat в inbound payload присылает `subscriber.profile_pic`, но мы это не сохраняем.

**Что Instagram (через ManyChat Send API) технически поддерживает:**

- ✅ Текст, image, video, audio (через URL/file).
- ✅ Quick reply кнопки, generic templates.
- ✅ Reactions (через ManyChat API: лайк ❤️, ограниченный набор).
- ✅ Reply-to-message (цитирование сообщения подписчика).
- ❌ **Edit/Delete отправленного** — Instagram API НЕ поддерживает (в отличие от Telegram).
- ❌ **Pin message в треде** — IG API не поддерживает (только наш UI-pin диалога).
- ✅ Аватар подписчика (`subscriber.profile_pic` из ManyChat).
- ✅ 24h-окно + HUMAN_AGENT tag (уже сделано).

## План — перенос фич Telegram → Instagram (ID-first, add-only)

### Этап A — Backend: схема + RPC (миграция)

**A1. `instagram_messages**` — добавить колонки (NULL по умолчанию, без break):

- `reply_to_message_id UUID NULL` (ссылка на нашу `instagram_messages.id` цитируемого).
- `is_edited BOOLEAN NOT NULL DEFAULT false` (для будущих API; сейчас IG не поддерживает edit, но колонка готова).
- `is_deleted BOOLEAN NOT NULL DEFAULT false` (soft-delete локально, без provider).
- `media_storage_bucket TEXT NULL`, `media_storage_path TEXT NULL`, `media_mime_type TEXT NULL`, `media_size_bytes BIGINT NULL`, `media_duration_ms INT NULL` — для **проксирования media в Supabase Storage** (быстрая загрузка, не зависит от lookaside-токенов FB).
- `upload_status TEXT NULL` (`pending|ok|error`) — параллель с Telegram media pipeline.

**A2. `instagram_message_reactions**` — новая таблица:

```
id, message_id (FK→instagram_messages), admin_user_id, emoji TEXT, created_at
UNIQUE(message_id, admin_user_id, emoji)
RLS: admin/super_admin
```

Для нашего внутреннего слоя реакций (видны в админке). Опциональный sync с ManyChat reactions API — отдельным флагом.

**A3. `instagram_chat_preferences**` — новая таблица (т.к. Сергей не имеет `user_id`):

```
id, admin_user_id, instagram_account_id, peer_id TEXT, is_pinned, is_favorite, updated_at
UNIQUE(admin_user_id, instagram_account_id, peer_id)
```

Аналог `chat_preferences`, но ключ — `(account_id, peer_id)`, а не `user_id`.

**A4. `instagram_contacts.avatar_url**` — backfill из `raw_payload` существующих сообщений (где есть `subscriber.profile_pic`), и в `manychat-inbound` сохранять `profile_pic` в `instagram_contacts.avatar_url` при каждом сообщении (не перетирать если уже есть свежий).

**A5. RPC `get_instagram_dialogs_v1**` — расширить:

- джойн с `instagram_chat_preferences` → `is_pinned`, `is_favorite` поля.
- сортировка: pinned first, потом по `last_at`.
- джойн `instagram_contacts.avatar_url` (уже есть, но использовать после backfill).

**A6. RPC `get_instagram_messages_v1**` — новая, заменить edge `get_history`:

- возвращает сообщения + реакции (агрегат) + reply_to_snapshot (для рендера цитаты) одним запросом.
- Прямой SQL быстрее, чем edge invoke (минус сетевой hop).

### Этап B — Backend: edge functions

**B1. `instagram-admin-chat**` — расширить actions:

- `send_reply` — добавить параметры `media_url`, `media_type`, `reply_to_message_id`, `attachments[]`. Маппинг на ManyChat Send API: для media → `content.messages: [{type:"image"|"video"|"audio", url}]`.
- `upload_media` (новый): принимает файл → `instagram_media` storage bucket → возвращает public URL → `send_reply` отправляет URL ManyChat'у.
- `add_reaction` / `remove_reaction` (новый): пишет в `instagram_message_reactions`. Опционально форвардит ManyChat reactions API.
- `toggle_pin` / `toggle_favorite` (новый): upsert в `instagram_chat_preferences`.
- `delete_message` (новый): soft-delete `is_deleted=true` локально (Instagram API не позволяет удалять у получателя).

**B2. `manychat-inbound**` — улучшения:

- Сохранять `subscriber.profile_pic` → `instagram_contacts.avatar_url`.
- Параллельно с записью URL — асинхронно скачивать media в `instagram_media` storage bucket (обход lookaside-токенов которые истекают). `upload_status='pending'→'ok'`.
- Парсить `reply_to` из payload если ManyChat шлёт.

**B3. Storage bucket `instagram_media**` — public, RLS read=public, write=service_role.

### Этап C — Frontend: рефакторинг IG чата под Telegram-паттерн

**C1. `ContactInstagramChat.tsx**` — переписать по образу `ContactTelegramChat.tsx`:

- **Header**: аватар (большой) + имя + source label + кнопка ⓘ → открывает `**ContactDetailSheet**` (если есть `profile_id` — полные данные; иначе урезанная карточка с IG username).
- **Message bubble**: переиспользовать `ChatMediaMessage` (он универсальный) и `MediaLightbox` для image/video. Voice/audio — inline `<audio>` без открытия в новом окне.
- **Reply context**: над input полоса «Ответ на: <текст/превью>», + крестик отмены.
- **Reactions**: hover над bubble → SmilePlus picker (тот же `EMOJI_LIST`); агрегированные реакции под bubble.
- **Контекстное меню сообщения**: «Ответить», «Скопировать», «Удалить локально» (soft delete).
- **Status badges**: уже есть, оставить + tooltip с raw error для админа.
- **Edited indicator**: бейдж «изм.» (готов к будущему API).

**C2. Input area** — переиспользовать паттерн Telegram:

- Эмодзи-пикер (📎 SmilePlus → Popover с `EMOJI_LIST`).
- Кнопки: 🖼️ image, 🎬 video, 🎵 audio, 📎 file, 🎙️ voice (рекордер), 🎥 video-note (`VideoNoteRecorder`).
- `**OutboundMediaPreview**` — переиспользовать как есть; перед отправкой превью.
- Drag&drop / paste image — переиспользовать.
- Authentication ManyChat: блок «вне 24h окна» — если последнее inbound > 24h, показать info-баннер «Сообщение уйдёт с тегом HUMAN_AGENT» (бэк уже это делает).

**C3. `InstagramInboxView.tsx**` — добавить:

- Фильтры: `all | unread | favorites | pinned` (как в Telegram tabs).
- Сортировка pinned-first (берётся из RPC).
- Pin/Star кнопки в hover-actions карточки + badge-иконки.
- Эту карточку можно стилево оставить «тоненький разделитель» — пользователь явно сказал что нравится IG-вариант — **только добавить функциональные элементы**, не менять border/spacing.

**C4. `InstagramMessageMedia.tsx**` — заменить на `ChatMediaMessage` (универсальный) или сделать тонкий адаптер. Voice/audio inline-плеер обязателен (требование пользователя).

### Этап D — Производительность (требование «всё ускорить»)

**D1.** Заменить edge `get_history` на прямой `supabase.rpc('get_instagram_messages_v1')` — экономия ~150-300ms на hop.
**D2.** Прокси media в Storage (B2) — картинки/аудио грузятся из CDN Supabase, а не из lookaside.fbsbx (часто медленный + токены).
**D3.** Realtime: уже есть, оставить.
**D4.** Виртуализация списка сообщений (`useVirtualizer`) при >50 сообщений.
**D5.** `staleTime: 30000` + `refetchOnWindowFocus: false` (как в Telegram).

### Этап E — Аватар Сергея и других

**E1.** Backfill: SQL-скрипт прогон `raw_payload->subscriber->profile_pic` → `instagram_contacts.avatar_url` для всех существующих контактов.
**E2.** В `manychat-inbound` всегда обновлять `avatar_url` если в payload свежий есть (не nullify).

### Этап F — Что НЕ переносим (ограничения IG)

- **Edit отправленных сообщений** — IG API не позволяет. UI скрывает edit для outbound IG.
- **Delete у получателя** — IG не позволяет. Только soft-delete локально (скрывается у админа).
- **Pin сообщения в треде** — IG не поддерживает. Pin будет только на уровне диалога (наш `instagram_chat_preferences`).
- **Bot selector** — для IG один аккаунт = одна точка отправки, селектор не нужен.

## DoD

1. UI Instagram-чата визуально и функционально идентичен Telegram (header с ⓘ, реакции, reply, эмодзи, медиа-кнопки, voice recorder, lightbox).
2. **Аватар Сергея виден в шапке и списке** (после backfill).
3. **Voice/audio из Instagram играет inline** (никаких переходов по ссылке).
4. **Все типы media** (image/video/audio/voice/file) рендерятся в bubble без сырых URL.
5. **Pinned/Favorites диалоги** работают и сортируются вверх.
6. **Реакции** ставятся (UI-уровень, видны админам).
7. **Reply-цитирование** работает (отображается над input при выборе).
8. **Скорость**: история чата открывается <500ms, медиа из Supabase Storage.
9. **24h окно**: явный info-баннер при отправке вне окна.
10. Legacy ApiX-Drive диалоги не сломаны (regression check).

## Файлы (план изменений)

**Миграции**:

- `supabase/migrations/<ts>_instagram_chat_features.sql` — A1, A2, A3, A4 (backfill), A5, A6, B3 (bucket).

**Edge functions**:

- `supabase/functions/instagram-admin-chat/index.ts` — B1 (новые actions).
- `supabase/functions/manychat-inbound/index.ts` — B2 (avatar + media proxy).

**Frontend**:

- `src/components/admin/communication/instagram/ContactInstagramChat.tsx` — C1, C2 (полный рефакторинг по образу Telegram).
- `src/components/admin/communication/instagram/InstagramInboxView.tsx` — C3 (фильтры, pin/favorite).
- `src/components/admin/communication/instagram/InstagramMessageMedia.tsx` — C4 (тонкий адаптер к `ChatMediaMessage` или удалить).
- Переиспользуем без копирования: `ChatMediaMessage`, `MediaLightbox`, `OutboundMediaPreview`, `VideoNoteRecorder`, `EMOJI_LIST`, `useTelegramReactions` (генерализуем в `useChatReactions` или создаём `useInstagramReactions` зеркало).

## Stop-condition

Закрываем только при:

- скрин IG-чата с аватаром Сергея, реакциями на сообщении, reply-цитатой, inline voice player;
- success-отправка картинки/аудио из IG-чата (статус `sent`);
- pinned диалог поднимается вверх;
- regression: ApiX-Drive диалог открывается без визуальных изменений.