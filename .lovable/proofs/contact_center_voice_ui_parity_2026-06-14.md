# Отчет о выполненной работе: PATCH-CONTACT-CENTER-VOICE-UI-PARITY-V1

Дата: 2026-06-14
Scope: UI-парность голосовых сообщений в админ-контакт-центре. Transport/recorder/storage/metadata НЕ менялись.

## Diagnose (root cause)

- Incoming voice (history) → `ChatMediaMessage` → `AudioPlayer` (компактный кастомный).
- Outgoing voice (history) → тот же `ChatMediaMessage` → `AudioPlayer` (тот же компонент, флаг `isOutgoing`).
- Voice после reload → тот же путь, ветка `isAudio` по `meta.file_type='voice'` + signed Storage URL.
- **Pre-send preview (Safari "большой пустой блок")** → `OutboundMediaPreview` использовал нативный `<audio controls>`, который в Safari растягивается на ширину родителя и имеет высокий встроенный хром. Это и есть единственный источник проблемы. **Не transport, не storage, не MIME.**
- В истории Safari проблема НЕ воспроизводится: voice корректно попадает в `isAudio`-ветку.

STOP-guard не сработал — правка чисто UI.

## Engineering changes

| File | Change |
|---|---|
| `src/components/admin/chat/VoiceMessageBubble.tsx` | NEW. Canonical glassmorphism-bubble для voice. play/pause, seek, duration с fallback на `loadedmetadata`, размер, меню ⋯ (Скачать / Ответить), compact-режим для preview. |
| `src/components/admin/chat/ChatMediaMessage.tsx` | Voice-ветка (`canonicalType === "voice"`) теперь рендерится через `VoiceMessageBubble` с `direction`, `fileName`, `onDownload`. Audio (не-voice) продолжает использовать `AudioPlayer`. Приоритет `fileType==='voice'` уже стоит первым в canonical resolver — voice всегда выигрывает над MIME-эвристикой (Safari `audio/mp4` не уедет в video). |
| `src/components/admin/chat/OutboundMediaPreview.tsx` | Voice-preview теперь использует `VoiceMessageBubble` (compact, `onDelete=onRemove`). Нативный `<audio controls>` удалён → Safari «большой пустой блок» устранён. `URL.createObjectURL` теперь создаётся через `useEffect` с cleanup `revokeObjectURL` (устранена утечка). |

## Design

- Glassmorphism: `bg-card/40 backdrop-blur-xl border border-border/40` (incoming), `bg-primary/10 border-primary/20` (outgoing) — лёгкий primary-tint, не сплошная заливка.
- Play/Pause: нейтральная `bg-foreground/10`, одинаковая для in/out, focus-ring, aria-label.
- Структура: `[play 36×36] [progress + 0:02 / 0:06 · 119 КБ] [⋯/×]`.
- Filename скрыт из bubble — доступен в `title` триггера ⋯ и в подписи кнопки «Скачать».
- Время/статус (sentAt / status) — компактной строкой под bubble (`text-[10px]`).
- Max width: desktop 380px, mobile `calc(100vw-96px)`. Высота определяется контентом, без `aspect-ratio`/`min-height`. `overflow: hidden`.
- `<audio>` всегда без атрибута `controls` (программно через ref).

## Duration logic

Приоритет (как в плане §6):
1. `durationHint > 0` (передаётся при наличии в meta — сейчас не пробрасывается, задел на будущее).
2. `HTMLAudioElement.duration` после `loadedmetadata` (с `isFinite` guard).
3. Fallback `—` (не ложное `0:00`).

Полученная клиентом duration **не записывается обратно в БД**.

## Safari-guards (CSS)

В `VoiceMessageBubble`:
- нет `aspect-ratio`, `min-height` под видео, `<video>`, `poster`;
- ширина адаптивная (`w-fit max-w-[380px]`);
- высота от контента;
- `overflow: hidden`;
- нативный `<audio controls>` не используется нигде в voice-цепочке.

## Что НЕ трогали (regression-safety)

`sendVoice`, `sendAudio`, `uploadToTelegramMedia.ts`, `AdminVoiceRecorder`, `audioRecorderCore`, edge `telegram-admin-chat`, схема `meta`, incoming webhook, video_note / photo / video / document ветки.

## Статусы

| Раздел | Статус |
|---|---|
| ENGINEERING | DONE |
| TELEGRAM API RUNTIME | NOT TOUCHED (PATCH UI-only) |
| DESKTOP UAT (Chrome) | PENDING USER |
| DESKTOP UAT (Safari) | PENDING USER — главный кейс «большой пустой блок в preview» |
| MOBILE UAT (iPhone Safari) | PENDING USER |
| SUPPORT REGRESSION | NOT AFFECTED (отдельный модуль, audio core не общий) |
| CLEANUP | N/A — БД/Storage/Telegram не трогаются |

## UAT checklist (для Сергея, DM @fs_by, chat_id 66086524, bot @gorbovabybot)

1. Запись 3–10 с в Chrome → preview компактный, отправка ОК, в истории — справа, компактно.
2. Запись 3–10 с в Safari (desktop) → **preview больше не «большой белый блок»**, компактный bubble.
3. Запись в iPhone Safari (M4A) → preview компактный, после отправки — компактный.
4. Reload страницы → voice продолжает играть (signed URL).
5. ⋯ → Скачать → файл скачивается.
6. Seek работает (drag по прогресс-бару).
7. Длинное имя файла → bubble не ломается (имя скрыто, только в tooltip ⋯).
8. Light/dark mode → оба читаемы.
9. Audio (не voice) MP3 → остаётся `AudioPlayer` с Music-иконкой и именем файла — отличается визуально.
10. Video note → круглый, без регрессий.
11. Document → без регрессий.

## DoD

- [x] incoming + outgoing + preview voice используют один canonical `VoiceMessageBubble`
- [x] incoming слева, outgoing справа, единый glassmorphism
- [x] filename убран из bubble, доступен в меню/tooltip
- [x] duration + размер показываются; fallback через `loadedmetadata`
- [x] download через ⋯
- [x] Safari `<audio controls>` удалён из preview (root cause устранён)
- [x] voice играет после reload (Storage-путь не тронут)
- [x] audio и voice визуально различаются (Music vs Mic + разный layout)
- [x] video_note / photo / video / document — без изменений в коде
- [ ] screenshots desktop + mobile — приложить в ходе UAT

Останов по STOP-guard не потребовался.
