# PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1 — Voice discovery consolidated

**Дата:** 2026-06-14
**Discovery proof'ы:**
- `.lovable/discovery/voice_history_2026-06-14.md` (D1)
- `.lovable/discovery/voice_incoming_architecture_2026-06-14.md` (D2)
- `.lovable/discovery/voice_outgoing_gap_2026-06-14.md` (D3)
- `.lovable/discovery/voice_runtime_probes_2026-06-14.md` (D4)

---

## HISTORICAL FACT (D1)

- Исходящая voice-реализация **никогда не существовала** в admin Telegram chat. Поиск по `sendVoice|VoiceRecorder|MediaRecorder|voice_message|audio_message|"voice"` по `src/` и `supabase/` не выявил ни одного следа outgoing voice mapping для admin-канала.
- Reference-реализация существует только в support-тикетах (`src/components/support/VoiceRecorder.tsx` + `TicketChat.tsx`), причём при bridge в Telegram voice **явно конвертируется в `document`** (`TicketChat.tsx:454`).
- Никаких удалённых файлов, осиротевших обработчиков или legacy-миграций с `voice`-enum для message types не обнаружено.

**Mapping старое → текущее:** не применимо (терять было нечего). Build-фаза — чистая new implementation, без restore.

---

## CURRENT CODE FACT (D2 + D3)

### Incoming (полностью работает)

- `telegram-webhook/index.ts:1014-1021` парсит `message.voice` → `fileType='voice'`, `fileName='voice.ogg'`.
- `telegram-media-worker/index.ts:52` сохраняет с `contentType='audio/ogg'` в bucket `telegram-media`.
- `ChatMediaMessage.tsx:148-174, 405-413` рендерит `<AudioPlayer isVoice>` через **first-class branch** (не fallback по MIME). Branch-таблица:

  | DB `meta.file_type` | mime_type | UI |
  |---|---|---|
  | `voice` | `audio/ogg` | `AudioPlayer isVoice=true` |
  | `audio` | `audio/mpeg` / `audio/mp4` | `AudioPlayer isVoice=false` |
  | `document` | provider | `DocumentBlock` |

- DB ground truth: 12 incoming voice rows, 100% `audio/ogg`, persistent после reload.

### Outgoing (gap-список)

| Звено | Текущее | Решение |
|---|---|---|
| UI пункт «🎤 Голосовое» в `ContactTelegramChat.tsx:2009-2087` | отсутствует | новое |
| `selectedFileType` union (line 288) | без `"voice"` | расширение |
| `showVoiceRecorder` state | отсутствует | новое |
| `AdminVoiceRecorder` компонент | отсутствует | новое (через extraction shared recorder-core) |
| `getFileIcon`, fallback-text-rendering | без voice | расширение |
| `OutboundMediaPreview` / `previewForQuote` | уже generic / уже поддерживают voice | reuse |
| `telegram-admin-chat/index.ts:225-249` (`telegramSendFile`) | нет `case "voice"` | новое |
| `telegram-admin-chat/index.ts:280-286` (`telegramSendFileFromBytes`) | нет `case "voice"` (дублирующая карта) | новое — **+ консолидация в `resolveTelegramMediaTransport`** |
| `FileData["type"]` union в edge | без `"voice"` | расширение |
| `guessMimeType` (line 142) | без ветки voice | расширение (`voice → audio/ogg`) |
| DB write back outgoing | через тот же insert path | reuse |
| Storage `telegram-media` bucket | `audio/ogg|webm|mp4` уже whitelisted | reuse |

---

## TELEGRAM API RUNTIME FACT (D4)

**Статус: BLOCKED_BY_SECURE_RUNTIME.**

- Fixtures сгенерированы и верифицированы ffprobe + magic-bytes:
  - P1 OGG/Opus reference (`OggS` magic, 1.506s)
  - P2 WebM/Opus (Matroska EBML magic `1A 45 DF A3`, 1.508s)
  - P3 M4A/AAC (`ftypM4A ` magic, 1.500s)
- Probe execution **не выполнен**: нет verified test bot и test chat_id, гарантированно не принадлежащих реальному клиенту. Согласно data-safety guard плана — STOP только для runtime probes; D1–D3 и D5 завершены.
- Run-book для безопасного запуска: см. `.lovable/discovery/voice_runtime_probes_2026-06-14.md` секция «Минимальный run-book».

**Следствие:** P1/P2/P3 → `result.voice/audio/document` пока не зафиксированы. Решение по транскодеру в RECOMMENDATION даётся условно (с явным указанием, что финальный ответ требует выполнения probe).

---

## DEVICE-SPECIFIC UAT PENDING

Даже после успешного probe в sandbox остаются полностью UAT-only вопросы:

- **iOS Safari real recording.** `MediaRecorder.isTypeSupported` в Safari ≥14.1 даёт `audio/mp4;codecs=mp4a.40.2`, но фактический blob контейнер может отличаться от ffmpeg-генерированного M4A. Требуется реальный recording на iOS ≥15 + iOS ≥17.
- **Android Chrome / WebView.** Обычно WebM/Opus, но WebView в обёртках (e.g. Capacitor) может вернуть другой mime.
- **Mobile lifecycle:** фон / блокировка экрана / прерывание входящим звонком / переключение микрофона — visibility/devicechange events требуют живого устройства.
- **Поведение voice-bubble после reload chat'а в Telegram-клиенте** для каждого формата (если P2/P3 вернёт `result.voice`).

Эти пункты явно помечаются `NEEDS DEVICE UAT` и не блокируют build-фазу.

---

## RECOMMENDATION (4 отдельных вывода)

### 1. Нужен ли `sendVoice` mapping в `telegram-admin-chat`?

**Да, безусловно.** Без него никакой исходящий voice невозможен (текущий `default → sendDocument` ломает voice-bubble). Маппинг добавляется одновременно в обе switch-карты (`telegramSendFile` и `telegramSendFileFromBytes`) **и одновременно консолидируется** в один helper `resolveTelegramMediaTransport(fileType): { method, fieldName }`. Также расширяется `FileData["type"]` union и `guessMimeType` (`voice → audio/ogg`).

### 2. Нужен ли UI recorder в `ContactTelegramChat`?

**Да.** В композере добавляется `DropdownMenuItem` «🎤 Голосовое», state `showVoiceRecorder`, новый компонент `AdminVoiceRecorder` (модальное окно записи), интеграция в `handleSend` с `fileType="voice"`. Расширяется `selectedFileType` union, `getFileIcon`, fallback-text.

### 3. Можно ли переиспользовать `src/components/support/VoiceRecorder.tsx`?

**Да, через extraction shared headless hook `useAudioRecorderCore` (`src/hooks/useAudioRecorderCore.ts`).** Компонент в `support/` уже реализует:

- `MediaRecorder.isTypeSupported`-driven mime preference (`audio/webm;codecs=opus → audio/ogg;codecs=opus → audio/webm`),
- permission error handling (`NotAllowedError`, `NotFoundError`),
- timer / level meter / cancel / save,
- size & duration метаданные.

**Условие:** extraction должен сопровождаться regression proof для support (snapshot отправки voice в ticket до и после рефакторинга должны быть идентичны). Без proof — не трогать `support/VoiceRecorder.tsx`, а создать новый `AdminVoiceRecorder` с минимальным duplication; в backlog зафиксировать unification.

### 4. Нужен ли transcoding / remux?

**Условно. Финальный ответ требует выполнения D4 probe.**

Базовая логика (на основе D1+D2+D3, без runtime ground truth):

- **Firefox** нативно даёт `audio/ogg;codecs=opus` → точное совпадение с тем, что Telegram гарантированно принимает как voice (`audio/ogg`). Транскодер не нужен.
- **Chrome / Edge** нативно дают `audio/webm;codecs=opus` (Matroska контейнер с opus packets). Telegram официально документирует OGG/Opus, MP3, M4A. WebM не указан, но opus packet stream идентичен. Pre-probe гипотеза: либо `result.voice` (принимает по codec), либо `result.audio/document` (отвергает по контейнеру). До D4 — неизвестно.
- **Safari (desktop + iOS)** нативно даёт `audio/mp4;codecs=mp4a.40.2`. Telegram документирует M4A как valid voice input. Pre-probe гипотеза: `result.voice` высоковероятно, но требует ground truth на реальном Safari blob.

**Решение (минимальное, если D4 будет выполнено):**

| Случай D4 | Что строить |
|---|---|
| P1 voice + P2 voice + P3 voice | Без транскодера. Honest transport (Вариант 1 из обсуждения). |
| P1 voice + P2 audio/document + P3 voice | Chrome → требуется container-swap WebM→OGG remux (Вариант 4 hybrid) ИЛИ fallback на `sendAudio` с предупреждением. |
| P1 voice + P2 ? + P3 audio/document | Safari → `NEEDS DEVICE UAT` обязателен (sandbox-fixture может отличаться от реального Safari blob). Минимально — fallback `sendAudio`. |
| любая комбинация с `ok=false` | Investigate `description`, скорее всего лимит размера или невалидный mime — корректировать transport spec. |

**До выполнения D4 — НЕ принимать решение по транскодеру.** В build-фазе можно реализовать пункты 1–3 (mapping + UI + recorder) с **honest transport policy**: пытаемся `sendVoice`; если Telegram возвращает не `result.voice` — пишем audit и fallback на `sendAudio`. После D4 — закрепляем итоговую логику.

---

## Итоговый минимальный build-план (после approval D5)

1. **Edge:** консолидировать `resolveTelegramMediaTransport`, добавить `voice→sendVoice`, расширить `FileData["type"]` и `guessMimeType`.
2. **Hook:** извлечь `useAudioRecorderCore` из `support/VoiceRecorder.tsx` + regression proof.
3. **UI admin:** `AdminVoiceRecorder` + пункт меню + state + интеграция в `handleSend`.
4. **Frontend types:** расширить `selectedFileType` union.
5. **Honest transport policy** в edge: если `ok=true && !result.voice` → audit + (по конфигу) fallback `sendAudio`.
6. **D4 execute** через run-book → закрепить транскодерное решение.
7. **Device UAT** iOS Safari + Android Chrome.
8. **Anti-duplication backlog:** при unification recorder-core для всего проекта.

**Status board:**

- D1: PASS
- D2: PASS
- D3: PASS
- D4: BLOCKED_BY_SECURE_RUNTIME (run-book + fixtures ready)
- D5: PASS (this document)
- Production-код: НЕ изменён.
- Secrets: НЕ утекли (fixtures synthetic, без bot tokens в proof).
- Cleanup: fixtures в `/tmp/`, не в storage, не в git.
