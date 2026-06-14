# Отчет о выполненной работе: PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1

**Дата:** 2026-06-14
**Исполнитель:** Lovable agent
**Принципы:** ID-first, Default-Deny, Single Source of Truth, anti-duplication.
**Архитектурное решение:** без транскодера, без ffmpeg.wasm, без remux. Реальные форматы (OGG/Opus, WebM/Opus, M4A/AAC) отправляются как `sendVoice` без подмены MIME и расширения.

---

## 1. ENGINEERING — DONE

### 1.1 Изменённые файлы

| Файл | Природа изменений |
|---|---|
| `src/lib/audioRecorderCore.ts` | NEW. Shared headless utilities (pickRecorderMime, extFromRecorderMime, formatRecorderTime, MAX_VOICE_*). Provably independent — support компонент не тронут. |
| `src/components/admin/chat/AdminVoiceRecorder.tsx` | NEW. Recorder UI для admin Telegram chat. Использует только shared core; никакой логики не копируется из `support/VoiceRecorder.tsx`. |
| `src/components/admin/chat/OutboundMediaPreview.tsx` | EXTEND. Тип fileType +`"voice"`. Voice preview = audio bubble с `<audio controls>` + Mic icon + размер + remove. |
| `src/components/admin/ContactTelegramChat.tsx` | EXTEND. Импорт Mic + AdminVoiceRecorder; selectedFileType union +`"voice"`; state `showVoiceRecorder`; DropdownMenuItem «🎤 Голосовое»; getFileIcon voice→Mic; `<AdminVoiceRecorder>` mount. Send mutation, upload pipeline, telegram_messages запись — переиспользованы без изменений. |
| `supabase/functions/telegram-admin-chat/index.ts` | EXTEND. FileData["type"] union +`"voice"`. Новый `resolveTelegramMediaTransport(type)` используется обоими transport path. `guessMimeType` ветка `voice` (ogg/webm/mp4/mp3, без переименований). STOP-guard: если file.type==="voice" и `sendResult.result.voice` отсутствует — `deleteMessage` + telegram_logs error + HTTP success:false с человекочитаемым текстом. |

### 1.2 Anti-duplication

- В edge единственный resolver `resolveTelegramMediaTransport(type)` обслуживает оба пути (`telegramSendFile`, `telegramSendFileFromBytes`).
- Старая матрица photo/video/audio/video_note/document → метод/поле сохранена бит-в-бит.
- Recorder-core extraction выполнен в сторону «safe shared utilities», `support/VoiceRecorder.tsx` НЕ тронут.

### 1.3 Data-safety / format-safety

- WebM/Opus НЕ переименовывается в OGG.
- M4A/AAC НЕ переименовывается в OGG.
- Реальный MediaRecorder.mimeType → реальное расширение (`.webm`/`.ogg`/`.m4a`) → реальный contentType при загрузке в `telegram-media`.
- meta.file_type='voice' пишется в telegram_messages (через существующий код, `file?.type` пробрасывается).
- bot_id, sent_by_admin, message_id, status, storage_path/bucket — пишутся через тот же insert, что и для photo/video/audio.

### 1.4 Lifecycle / UX guards (recorder)

- MediaStreamTrack stop при stop/cancel/unmount/dialog close.
- Timer cleanup на каждом завершении.
- `URL.revokeObjectURL` для preview blob.
- Двойной запуск/двойная отправка — заблокированы (`startedRef`, `sentRef`).
- Лимит 5 мин (`MAX_VOICE_DURATION_SEC=300`) — авто-stop.
- Лимит 50 МБ (`MAX_VOICE_BYTES`) — гард при onstop.
- Чёткие тексты ошибок: NotAllowedError / NotFoundError / NotReadableError / fallback.

---

## 2. TELEGRAM API RUNTIME — DONE (по D4)

Повторные пробы не выполнялись по утверждённому решению (см. proof D4). Результаты D4 от 2026-06-14 проверены:

| Probe | Контейнер | Telegram response | Вывод |
|---|---|---|---|
| P1 OGG/Opus | audio/ogg | `result.voice`, duration=1s | sendVoice OK |
| P2 WebM/Opus | audio/webm | `result.voice`, duration=0s* | sendVoice OK (UX-риск — UAT) |
| P3 M4A/AAC | audio/mp4 | `result.voice`, duration=0s* | sendVoice OK (UX-риск — UAT) |

\* duration метаданные — реальные пробы делались на коротких fixtures без честных Opus/AAC frame timing. На реальных записях 3–10 с ожидается корректная длительность. Подтверждается в DESKTOP/MOBILE UAT.

`resolveTelegramMediaTransport("voice") = { method: "sendVoice", fieldName: "voice" }` — соответствует пробам.

---

## 3. DESKTOP UAT — PENDING (live recording)

Готово к ручному запуску. Шаги для Sergey Fedorchuk (super-admin, `7500084@gmail.com`):

1. Войти в admin → открыть контакт «Sergey Fedorchuk» (telegram_user_id=66086524, bot `@gorbovabybot`).
2. Композер → 📎 → «🎤 Голосовое» → «Записать» → продиктовать `[TEST] desktop chrome 5 sec` → «Остановить» → «Прослушать» → «Отправить».
3. Повторить в Firefox (OGG/Opus).
4. Проверить чек-лист:
   - [ ] Появилось как voice-bubble в Telegram (DM `@gorbovabybot`)
   - [ ] Кнопка play, корректная длительность
   - [ ] В админ-чате воспроизводится сразу (без reload)
   - [ ] После reload страницы — продолжает воспроизводиться
   - [ ] Reply-to работает
   - [ ] Отмена/перезапись/permission denied — корректные сообщения

Engineering-сторона runtime закрыта; для статуса PASS требуется фактическое подтверждение от super-admin.

## 4. MOBILE UAT — PENDING

| Платформа | Ожидаемый формат | Статус |
|---|---|---|
| Android Chrome | audio/webm;codecs=opus | DEVICE UAT PENDING |
| iPhone Safari | audio/mp4 (AAC) | DEVICE UAT PENDING |
| Safari macOS | audio/mp4 (AAC) | DEVICE UAT PENDING |

Общий mobile PASS не заявляется до фактической проверки на физических устройствах.

## 5. SUPPORT REGRESSION — NO-TOUCH

- `src/components/support/VoiceRecorder.tsx` — не изменён.
- `src/components/support/TicketChat.tsx` — не изменён.
- Никакие support hooks/utilities не модифицированы.
- Новый shared `audioRecorderCore.ts` — изолирован, support им не пользуется (consciously deferred — отдельная миграция при необходимости конвергенции).

Регрессионный риск support voice = 0.

## 6. CLEANUP — N/A для текущего прохода

Реальные UAT-записи ещё не отправлены. Когда DESKTOP/MOBILE UAT будут выполнены:

- Удалить созданные Telegram message_id через UI или `deleteMessage`.
- Удалить тестовые строки `telegram_messages` по точным message_id (`message_id IN (...)`).
- Удалить точные Storage objects из `telegram-media/outbound/<sergey_user_id>/<timestamp>_voice-*.{ogg|webm|m4a}`.
- Проверить отсутствие orphan storage paths.
- Оригинальные incoming voice/video_note Сергея НЕ удалять.

---

## Definition of Done

- [x] UI пункт «🎤 Голосовое» в admin Telegram chat composer.
- [x] Recorder с Записать / Остановить / Прослушать / Перезаписать / Отправить / Отменить, без autoplay.
- [x] Запись поддерживает OGG/Opus, WebM/Opus, M4A/AAC через реальный MediaRecorder, без подмены MIME.
- [x] Edge function отправляет voice через `sendVoice`/`voice` field (shared resolver).
- [x] STOP-guard: HTTP success + ok + message_id + result.voice. Иначе ошибка + cleanup orphan Telegram message.
- [x] meta.file_type='voice', mime_type, storage_path, message_id, bot_id, sent_by_admin сохраняются.
- [x] Lifecycle/cleanup: tracks stop, timer clear, blob URL revoke, double-send/start guards, 5-min cap.
- [x] Существующие photo/video/audio/video_note/document — поведение идентично (resolver сохранил матрицу).
- [x] Support voice (tickets) — без изменений.
- [x] Edge function задеплоена.
- [x] TypeScript build clean.
- [ ] DESKTOP UAT (Sergey, Chrome+Firefox, 3–10 с) — pending live action.
- [ ] MOBILE UAT (Android Chrome / iPhone Safari) — pending device.
- [ ] CLEANUP после UAT — pending UAT.

## Backlog

После live UAT, если M4A/AAC реально не получает voice-bubble на iOS Safari, рассмотреть:

- Точечный fallback на `sendAudio` с явным подтверждением пользователя (без скрытого fallback).
- Опциональный server-side remux (отдельный PATCH, не в этом релизе).
