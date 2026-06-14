# D1 — Historical Discovery: voice messages в admin Telegram chat

**Дата:** 2026-06-14
**Scope:** PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1

## Метод

Семантический поиск по текущему дереву (git history через одну рабочую ветку):

```
rg -n -S 'sendVoice|VoiceRecorder|MediaRecorder|audio/ogg|audio/webm|audio/mp4|opus|sendAudio|voice_message|audio_message|getUserMedia\(\{ ?audio|BlobEvent|"voice"' src supabase
```

Дополнительно — поиск по миграциям, enum/CHECK constraints, `src/integrations/supabase/types.ts`.

## Находки

### 1. Входящая ветка `voice` (полностью реализована)

| Файл | Строки | Что делает |
|---|---|---|
| `supabase/functions/telegram-webhook/index.ts` | 1014–1021 | Парсит `msgAny.voice` → `fileType='voice'`, `fileName='voice.ogg'` |
| `supabase/functions/telegram-media-worker/index.ts` | 52 | `if (fileType === "voice") return "audio/ogg"` |
| `src/components/admin/chat/ChatMediaMessage.tsx` | 151, 159, 174, 410, 423 | Canonical `"voice"` + `isVoice` prop в плеере, отдельная ветка от `audio` |

DB-доказательство (`telegram_messages` rows):

```
ft   |    mt     |      bkt       | plen
voice| audio/ogg | telegram-media |   71
```

12 incoming voice rows (`meta->>'file_type' = 'voice'`, direction=`incoming`), всегда `audio/ogg`.

### 2. Исходящая ветка `voice` — НЕ найдена в текущем коде

- `supabase/functions/telegram-admin-chat/index.ts:225–249` (`telegramSendFile`) — `switch (file.type)` имеет `photo | video | audio | video_note | default→document`. **Нет `case "voice"`.**
- `supabase/functions/telegram-admin-chat/index.ts:280–286` (`telegramSendFileFromBytes`) — вторая дублирующая карта. **Тоже нет `case "voice"`.**
- `src/components/admin/ContactTelegramChat.tsx:288` — `selectedFileType: "photo" | "video" | "audio" | "video_note" | "document" | null`. **`"voice"` отсутствует в union.**
- `previewForQuote` (line 554) рендерит `"voice"` иконкой 🎤 только для входящих цитат.
- Меню композера (lines ~1300–1500): пункт «🎤 Голосовое» **отсутствует**.

### 3. Support-тикеты — рабочая исходящая реализация (для reference)

- `src/components/support/VoiceRecorder.tsx` — полнофункциональный `MediaRecorder`-based recorder. Mime preference order: `audio/webm;codecs=opus → audio/ogg;codecs=opus → audio/webm` (через `MediaRecorder.isTypeSupported`).
- `src/components/support/TicketChat.tsx:34, 247, 315, 424, 552–554` — `MediaFileType` включает `"voice"`, обрабатывает запись и предпросмотр, поднимает диалог `VoiceRecorder`.
- `src/hooks/useTickets.ts:43` — `kind` union содержит `"voice"`.
- На bridge в Telegram (`canBridgeToTelegram && selectedFileType !== "voice"`, line 408) — **voice явно исключён**. На Telegram-стороне tickets отправляют voice как `document` (line 454).

### 4. Schema / migrations / generated types

- Поиск `voice` по `supabase/migrations/**` → совпадений по message types **нет** (только `invoice_*`).
- Нет enum/CHECK constraint с literal `'voice'` — `telegram_messages.meta.file_type` хранится как `text` в jsonb meta.
- `src/integrations/supabase/types.ts` — нет union с `"voice"` (поле `meta` типизировано как `Json`).
- В `audit_logs` — `voice` не упоминается.

### 5. Параллельные каналы

- `supabase/functions/telegram-mass-broadcast/index.ts:767` — собственный `switch`: `audio → sendAudio`. **Нет `voice → sendVoice`** (для рассылок voice не требуется).
- `supabase/functions/instagram-admin-chat/index.ts:491` — для IG `'audio' || 'voice'` маппится в один `audio` тип (другой канал, не Telegram).

## Вывод

**Функция «отправка voice в admin Telegram chat» в текущем коде НИКОГДА не существовала.** В git history (рабочая ветка) нет ни удалённых файлов, ни старых коммитов, ни осиротевших обработчиков с `case "voice"` для исходящей стороны Telegram-канала. Реализация существует только:

1. Для входящей стороны (`telegram-webhook`, `telegram-media-worker`, `ChatMediaMessage`).
2. Для support-тикетов (`VoiceRecorder` + `TicketChat`), причём при bridge в Telegram voice форсируется в `document`.

Это означает, что D5 будет содержать чистый **NEW IMPLEMENTATION** mapping, а не restore. Поиск «утраченного кода» закрыт: терять было нечего.

## Файлы интереса для D2/D3

- D2 (incoming): `telegram-webhook/index.ts` (1014–1021), `telegram-media-worker/index.ts` (52), `ChatMediaMessage.tsx` (130–200, 400–425).
- D3 (outgoing gap): `telegram-admin-chat/index.ts` (180–308), `ContactTelegramChat.tsx` (288, 1078, 1300–1500, 1925).
