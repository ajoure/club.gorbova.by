## да, согласен, с учетом правок:

1. Добавь в DoD отдельную проверку **по конкретному message_id** `396183eb-90d2-49eb-9536-aeb292c9c0f3`:
  - до фикса: `media_type='image'`
  - после фикса: `media_type='video'`
  - UI: inline `<video>` без fallback-карточки.
2. В пункте про `instagram-media-proxy` зафиксируй, что при rehost нужно обновлять не только:
  - `media_url`
  - `raw_payload.rehosted_*`
  - `media_type`
  но и **отдельное поле mime**, если оно уже есть в схеме; если отдельного поля нет — явно писать в `raw_payload.rehosted_content_type` и использовать его как source of truth для backfill и renderer fallback.
3. В `instagram-webhook` добавь правило приоритета определения типа:
  - сначала `content-type`, если уже известен;
  - потом extension URL;
  - потом fallback guess;
  - **не доверять blindly значению от ManyChat**, если URL явно `.mp4/.mov/.webm/.mp3/.ogg/.m4a`.
4. В SQL backfill добавь scope не только для `video/` и `audio/`, но и safety-case:
  &nbsp;
  - если `media_url` оканчивается на video/audio extension, а `media_type='image'`, тоже пересчитать.  
  Это закроет случаи, где `rehosted_content_type` не записан, но URL уже корректный.
5. В UI `InstagramMessageMedia.tsx` добавь явный fallback-приоритет:
  - если `media_type` ошибочный, но `url` выглядит как video/audio, renderer должен брать **тип из URL как override**;
  - fallback «Открыть в новой вкладке» показывать только после `onError` именно на **rehosted/stable URL**, а не на исходном unstable URL.
6. Добавь в DoD ещё один regression-check:
  - image/file/audio не поменяли тип после миграции ошибочно;
  - ApiX-Drive диалоги не затронуты;
  - raw URL в bubble не показывается для распознанного media.
7. В proof-пакет добавь 4 артефакта:
  - SQL до/после по `396183eb-...`
  - headers storage object (`Content-Type`)
  - UI-скрин inline video
  - подтверждение, что console warning по `forwardRef` исчез.

&nbsp;

План после этих правок можно выполнять.

&nbsp;

План: Исправление inline playback для inbound video (PATCH)

### Диагностика

Из network logs видно конкретный проблемный кейс:

- **message_id:** `396183eb-90d2-49eb-9536-aeb292c9c0f3`
- **media_type в БД:** `"image"` ❌ (должно быть `"video"`)
- **rehosted_content_type:** `"video/mp4"` ✅
- **rehosted_storage_path:** `instagram-inbound/.../1776634923427_f5146d57.mp4`
- **media_url:** signed URL на `.mp4` файл

**Корневая причина #1 (главная):** В БД `media_type = "image"` для mp4-файла. Renderer `InstagramMessageMedia` смотрит на `media_type` и рендерит `<img>` вместо `<video>`. Отсюда «не удалось встроенно проиграть» — браузер пытается показать mp4 как изображение.

**Корневая причина #2:** В `instagram-webhook` при rehost мы определяем правильный content-type (`video/mp4`) и пишем его в `rehosted_content_type`, но `media_type` в основном поле сообщения не пересчитывается — остаётся то, что пришло от ManyChat (а ManyChat для lookaside ссылок отдаёт `"image"` всем подряд).

**Корневая причина #3 (вторичная):** Console warning — `InstagramMessageMedia` использует `forwardRef` некорректно (Dialog даёт ref функциональному компоненту).

### Что делаю

**1. Edge function `instagram-media-proxy` (rehost):**

- При upload в storage явно передавать `contentType` определённый по signature/extension/HEAD upstream'а (не по тому что пришло в payload).
- После успешного rehost — **обновлять `media_type` в `instagram_messages**` на основе реального `rehosted_content_type` (`video/*` → `video`, `audio/*` → `audio`, `image/*` → `image`, иначе → `file`).
- Сохранять `media_mime_type` в `raw_payload` (уже есть как `rehosted_content_type`).

**2. Edge function `instagram-webhook`:**

- При первичном сохранении inbound media — если URL заканчивается на `.mp4/.mov/.webm` или `.mp3/.ogg/.m4a`, корректно проставлять `media_type` сразу, не доверяя ManyChat'у.

**3. SQL миграция (data fix):**

- Разовый UPDATE по `instagram_messages` где `raw_payload->>'rehosted_content_type'` начинается с `video/` / `audio/` — пересчитать `media_type` корректно. Это починит ретроспективно сообщение Сергея.

**4. UI компонент `InstagramMessageMedia.tsx`:**

- Убрать неверный `forwardRef` / привязку ref к Dialog (фикс console warning).
- Для `video`: `<video controls preload="metadata" playsInline>` с stable rehosted URL.
- Fallback «открыть в новой вкладке» показывать **только** после реального `onError` события на rehosted URL, не до попытки.
- Дополнительная защита: если `media_type === "image"` но URL заканчивается на `.mp4/.webm/.mov` — рендерить как video (на случай если миграция/rehost ещё не отработали).

**5. Storage delivery:**

- Signed URL из `telegram-media` уже подходит для inline video — браузеры играют его, если Content-Type корректный. Подтверждено proof'ом по audio (играл inline).
- Дополнительно при `createSignedUrl` передаём `download: false` (по умолчанию), чтобы Storage отдавал inline, а не attachment.

### DoD

- Видео `396183eb-...` проигрывается inline в bubble.
- `media_type` в БД = `"video"` для всех rehosted mp4.
- Content-Type у storage object — `video/mp4` (проверим HEAD после повторного upload).
- Console warning про forwardRef — исчез.
- Image/audio/file продолжают работать.

### Файлы

- `supabase/functions/instagram-media-proxy/index.ts` — корректный contentType + UPDATE media_type
- `supabase/functions/instagram-webhook/index.ts` — определение media_type по extension
- `src/components/admin/communication/instagram/InstagramMessageMedia.tsx` — video renderer + forwardRef fix
- Миграция: backfill `media_type` по `rehosted_content_type`