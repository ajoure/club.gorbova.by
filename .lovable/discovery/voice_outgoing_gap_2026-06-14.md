# D3 — Outgoing voice gap audit (что именно отсутствует)

**Дата:** 2026-06-14

## Текущий outgoing-путь (другие медиа)

```
ContactTelegramChat composer
  ├─ DropdownMenu (lines 2009-2088): Фото / Видео / Кружок / Аудио / Документ
  ├─ Pick → setSelectedFileType("photo"|"video"|"audio"|"video_note"|"document")
  │  setSelectedFile(blob)
  │
  ▼
handleSend (line 1335)
  sendMutation.mutate({ text, file, fileType: selectedFileType, replyToMessageId })
  │
  ▼
[edge invoke] telegram-admin-chat
  │
  ▼  telegram-admin-chat/index.ts:142 guessMimeType(fileName, kind)
  │  loadFileBytes → telegramSendFile (line 180)
  │
  ▼  switch (file.type)  // line 225-249
     photo      → sendPhoto      field=photo
     video      → sendVideo      field=video
     audio      → sendAudio      field=audio
     video_note → sendVideoNote  field=video_note (length=384)
     default    → sendDocument   field=document   ◄── voice попадёт сюда
  │
  ▼ POST https://api.telegram.org/bot{token}/{method}
    multipart FormData (chat_id, field=blob, caption?, reply_parameters?)
  │
  ▼ Telegram returns Message object
  │
  ▼ DB write back (audit, telegram_messages outgoing INSERT)
```

## Gap-таблица (что отсутствует для voice)

| Звено | Текущее состояние | Что нужно | Решение |
|---|---|---|---|
| **UI пункт меню «🎤 Голосовое»** | Отсутствует (lines 2015-2087: только 5 пунктов) | Новый `DropdownMenuItem` с `setShowVoiceRecorder(true)` | новое |
| **State recorder open** | `showVideoNoteRecorder` есть; `showVoiceRecorder` отсутствует | `const [showVoiceRecorder, setShowVoiceRecorder] = useState(false)` | новое (по аналогии) |
| **`selectedFileType` union** | `"photo"\|"video"\|"audio"\|"video_note"\|"document"\|null` (line 288) | Добавить `"voice"` | расширение существующего |
| **Recorder UI компонент** | Нет в `src/components/admin/` для аудио | `AdminVoiceRecorder` или shared `recorder-core` | reuse из `src/components/support/VoiceRecorder.tsx` (см. ниже) |
| **`previewForQuote`** (line 548) | Уже поддерживает `"voice"` (line 554) | — | reuse |
| **`getFileIcon`** (line 1377) | photo/video/audio/video_note без voice | Добавить voice → `Mic` icon | расширение |
| **`OutboundMediaPreview` / inline preview** (line 1925) | `fileType={selectedFileType}` | Уже generic — нужно лишь чтобы voice прокидывался | reuse |
| **Bucket / storage upload** | `telegram-media` принимает `audio/*` (migrations 20260122213752, 20260218123106 включают `audio/ogg`, `audio/mp4`, `audio/webm`) | — | существует |
| **Edge: `telegramSendFile.switch`** (lines 225-249) | Нет `case "voice"` | `case "voice": method="sendVoice"; fieldName="voice"; break;` | новое |
| **Edge: `telegramSendFileFromBytes.switch`** (lines 280-286) | Нет `case "voice"` | То же | новое |
| **Edge: `FileData["type"]` union** | `"photo" \| "video" \| "audio" \| "video_note" \| "document"` | Добавить `"voice"` | расширение |
| **Edge: `guessMimeType`** (line 142) | Нет ветки `voice` | `if (kind==="voice") return "audio/ogg"` (preferred default) | расширение |
| **DB write back outgoing** | Через тот же insert path по `fileType`-meta | работает, если `fileType="voice"` пробрасывается | reuse (no change) |
| **Mobile lifecycle (фон/блокировка/звонок)** | `VideoNoteRecorder` обрабатывает `MediaRecorder` ошибки, но не page-visibility | Желателен `visibilitychange` pause/stop hook | новое (мелкое) |
| **Permissions UI** | `VoiceRecorder.tsx` уже умеет `NotAllowedError` / `NotFoundError` | — | reuse |
| **Size guard** | Сейчас в composer `maxSize = 20MB` для не-видео (line 1357) | Для voice достаточно; Telegram `sendVoice` лимит ~50MB | reuse |

## Дублирование в edge function

`telegram-admin-chat/index.ts` содержит **две параллельные карты** `fileType → method/fieldName`:

- `telegramSendFile` (multipart from storage/base64) — lines 225-249.
- `telegramSendFileFromBytes` (raw Uint8Array) — lines 280-286.

Любое расширение должно правиться в обоих, иначе voice будет работать только по одному пути. **В build-фазе следует консолидировать в `resolveTelegramMediaTransport(fileType)`** (anti-duplication из плана).

## Анти-дублирование с support

`src/components/support/VoiceRecorder.tsx` уже реализует:

- `MediaRecorder.isTypeSupported`-driven mime preference (`audio/webm;codecs=opus` → `audio/ogg;codecs=opus` → `audio/webm`)
- Permission error handling (`NotAllowedError`, `NotFoundError`)
- Timer, level meter, cancel/save
- Размер blob и duration

**Стратегия build-фазы:** извлечь `useAudioRecorderCore` (headless hook) в `src/hooks/`, оставив `support/VoiceRecorder.tsx` как тонкую UI-обёртку. Затем создать `src/components/admin/chat/AdminVoiceRecorder.tsx` поверх того же hook'а. Regression-proof для support обязателен (snapshot отправки voice в ticket).

## Итог D3

- Outgoing voice — **полностью новая ветка** на client + edge.
- Storage и DB-write back инфраструктура уже готова (incoming уже хранит `audio/ogg` voice в том же `telegram-media` bucket).
- Дублирующиеся switch-карты в edge → консолидация обязательна.
- Recorder-core — кандидат на reuse через extraction.
