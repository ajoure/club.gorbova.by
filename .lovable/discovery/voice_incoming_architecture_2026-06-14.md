# D2 — Incoming voice chain (proof что плеер — именно voice)

**Дата:** 2026-06-14

## Полный путь voice update → UI

```
Telegram update {voice: {file_id, mime_type, duration}}
  │
  ▼
supabase/functions/telegram-webhook/index.ts:1014-1021
  → fileType = 'voice'
  → fileName = 'voice.ogg'
  → fileId   = msgAny.voice.file_id
  │
  ▼
telegram_messages INSERT (Phase 1, pending)
  meta = { file_type: 'voice', file_name: 'voice.ogg', file_id, ... }
  │
  ▼
telegram-media-worker/index.ts:52
  inferContentType('voice', _) → 'audio/ogg'
  download через getFile + bot file path
  storage.from('telegram-media').upload(path, bytes, {contentType:'audio/ogg'})
  │
  ▼
telegram_messages UPDATE (Phase 2)
  meta = { file_type:'voice', mime_type:'audio/ogg',
           storage_bucket:'telegram-media', storage_path:<71 chars>, ... }
  │
  ▼
useTelegramMessages / Realtime → ContactTelegramChat
  │
  ▼
ChatMediaMessage.tsx (lines 148-174)
  canonicalType resolver:
    ["photo","video","video_note","audio","voice"].includes(fileType) → keep
    elif mime "audio/*"  → fileType==='voice' ? 'voice' : 'audio'
  → canonicalType === 'voice'
  isAudio = (canonicalType==='audio'||canonicalType==='voice')  // true
  │
  ▼
ChatMediaMessage.tsx:405-413
  if (isAudio && hasFile)
    <AudioPlayer url={signedUrl} isVoice={canonicalType==='voice'} ... />
```

## DB ground truth (рабочий запрос)

```sql
select meta->>'file_type' as ft, meta->>'mime_type' as mt,
       meta->>'storage_bucket' as bkt, length(meta->>'storage_path') as plen
from telegram_messages
where (meta->>'file_type')='voice' and direction='incoming'
order by created_at desc limit 3;

  ft  |    mt     |      bkt       | plen
------+-----------+----------------+------
voice | audio/ogg | telegram-media |   71
voice | audio/ogg | telegram-media |   71
voice | audio/ogg | telegram-media |   71
```

12 incoming voice rows. 100% имеют `mime_type='audio/ogg'` и `file_type='voice'`. `duration` в `meta` не сохранён (NULL), Telegram-`voice.duration` теряется при upload — плеер показывает длительность из `<audio>` element после загрузки самого Opus-файла.

## Доказательство, что плеер — именно voice-вариант

`ChatMediaMessage.tsx:410` явно передаёт `isVoice={canonicalType === "voice"}` в `<AudioPlayer>`. Это **first-class branch**, не fallback по MIME:

- `voice` и `audio` идут в один `<AudioPlayer>` компонент,
- но `isVoice` prop включает voice-specific UI (см. `AudioPlayer.tsx`: voice-bubble стилистика, иконка микрофона, без названия файла).
- Fallback-ветка `mediaState === 'NO_STORAGE'` (line 423) тоже разделяет: `fileType === 'voice' ? "Голосовое" : "Аудио"`.

Таким образом, «красивый плеер» на скриншоте клиента — именно voice-рендер, а не общий audio.

## После reload

- `meta.file_type='voice'` persistent в DB.
- `storage_bucket/storage_path` persistent.
- Signed URL генерируется заново по path → `<AudioPlayer isVoice>` рендерится консистентно.
- Поведение проверено через DB — после reload компонент берёт те же `meta`-поля.

## Branch mapping (incoming)

| Telegram update | DB meta.file_type | mime_type | UI компонент |
|---|---|---|---|
| `message.voice` | `voice` | `audio/ogg` | `AudioPlayer isVoice` |
| `message.audio` | `audio` | provider mime (`audio/mpeg`/`audio/mp4`) | `AudioPlayer` (no isVoice) |
| `message.document` (audio/*) | `document` | provider mime | `DocumentBlock` |

Three-way branching доказано в коде. Плеер voice — это не универсальный audio fallback.
