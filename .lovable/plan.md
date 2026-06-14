
# План: PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1 — Discovery (D1–D5)

Финальная редакция плана с учётом всех уточнений. Выполняется одним проходом без ожидания файлов от пользователя и без дополнительных согласований. Остановка — только при реальном data-safety / secret-safety STOP-guard.

## Базовые принципы

- Discovery-first. Никакого production-кода и выбора архитектуры (варианты 1–4 транспорта) до D5.
- Вариант 1 для fixtures: только публичные короткие WebM/Opus и M4A/AAC с зафиксированным источником, контейнером, codec, MIME, расширением, целостностью и лицензией. Простого расширения недостаточно — реальный формат проверяется диагностическим инструментом (ffprobe/file/mediainfo в sandbox).
- Если подходящих публичных fixtures нет — допускается локальная генерация диагностическим инструментом (ffmpeg в sandbox, вне приложения): WebM/Opus и M4A/AAC, 1–2 сек, без коммита бинарников в репозиторий, без добавления зависимости в `package.json`. Команда создания и фактический формат фиксируются в proof.
- Реальные пользовательские файлы пока не запрашиваются. Неоднозначный публичный fixture → P2/P3 помечается `NEEDS DEVICE UAT`, но D1–D3 и P1 не блокируются.
- Support-тикеты функционально не меняем.

## Data-safety / secret-safety инварианты

- Bot token / `TELEGRAM_API_KEY` / `LOVABLE_API_KEY` НИКОГДА не попадают в: отчёты, stdout, screenshots, `.lovable/`-артефакты, git history. В proof — только маскированные ссылки на имена секретов.
- Runtime probes (D4) — только на выделенных test bot / test Telegram account / test contact / test profile. Если хотя бы один идентификатор относится к реальному клиенту → STOP только для runtime probes; D1–D3 и D5 продолжаются.
- Оригинальное входящее voice клиента не модифицируется и не удаляется. Для P1 байты скачиваются и сохраняются как отдельная тестовая копия в изолированном storage path (или только локально), отправляется копия, удаляется только созданная копия и тестовое исходящее сообщение.
- Cleanup direct Telegram probe: `deleteMessage` по каждому `result.message_id`; удаляются только созданные fixture-объекты; если диагностический вызов не создаёт строку в `telegram_messages` — DB cleanup явно отмечается `not applicable`. Никаких широких DELETE по типу файла или временному диапазону.

## D1 — Historical discovery (git + DB)

Цель: доказать, существовала ли ранее исходящая voice-реализация и не потерялась ли при рефакторингах.

Семантический поиск (не только точные строки) по всей истории всех веток, включая удалённые/переименованные файлы:

- Код: `sendVoice`, `VoiceRecorder`, `MediaRecorder`, `audio/ogg`, `audio/webm`, `audio/mp4`, `audio/mpeg`, `opus`, `recording`, `recorder`, `sendAudio`, `OutboundMediaPreview`, `voice`, `voice_message`, `audio_message`, `mic`, `microphone`, `BlobEvent`, `getUserMedia({ audio`.
- Файлы интереса: `ContactTelegramChat.tsx`, `telegram-admin-chat/index.ts`, `telegram-webhook*/index.ts`, `VoiceRecorder.tsx`, `VideoNoteRecorder.tsx`, `OutboundMediaPreview.tsx`, `.lovable/proofs/`, `.lovable/plan.md`, `.lovable/discovery/**`.

История БД и миграций:

- enum / `CHECK` constraints со значением `voice` (`telegram_messages.message_type`, `meta.file_type`, любые message-type enums).
- Сгенерированные `src/integrations/supabase/types.ts` в прошлых коммитах — наличие `"voice"` в union'ах.
- Старые metadata contracts на `telegram_messages.meta` (поля `duration`, `waveform`, `mime_type`, `is_voice`).
- `audit_logs` и proof-файлы с упоминаниями исходящего voice.

Output: `.lovable/discovery/voice_history_2026-06-14.md` — список находок, коммиты, ветки, удалённые файлы, фрагменты diff'ов, вывод «функция существовала / не существовала / частично существовала».

## D2 — Reverse-engineer incoming voice chain (proof что плеер — именно voice)

Цель: доказать, что красивый плеер на скриншоте относится именно к voice, а не к универсальному audio-рендеру.

Фиксируем:

- Webhook handler (`telegram-webhook*`): как `message.voice` отличается от `message.audio` и `message.document`; какое значение записывается в `telegram_messages.message_type` и `meta.file_type`.
- Полный путь: Telegram update → download → bucket/storage path → DB row → signed URL → UI player.
- UI: какой именно React-компонент рендерит плеер, по какому условию (`file_type === 'voice'` vs `'audio'` vs MIME-fallback), как ведёт себя после reload.
- Реальный MIME сохранённого файла (через storage HEAD / DB `meta.mime_type`), реальная `duration`.

Output: `.lovable/discovery/voice_incoming_architecture_2026-06-14.md` с branch-mapping `voice → component`, `audio → component`, `document → component`.

## D3 — Audit outgoing chain (что именно отсутствует)

Цель: точно определить недостающие звенья исходящего voice без записи нового кода.

Проходим существующий путь для других медиа (`recording → uploadToTelegramMedia → storage_path → telegram-admin-chat → sendXxx → telegram_messages`) и фиксируем разрывы:

- Composer: есть ли пункт меню «🎤 Голосовое»? Где он должен встроиться? Какие типы поддерживает `selectedFileType`?
- Edge function `telegram-admin-chat/index.ts`: две дублирующиеся карты `fileType → method/fieldName` (строки ~230 и ~280) — `voice` не маппится.
- Storage upload: ограничения на bucket по MIME / size; политика на `audio/*`.
- DB write back: ветка для `voice` после успешного sendVoice (`message_type`, `meta`).
- Mobile lifecycle: где обрабатывается фон/блокировка экрана/прерывание звонком (если уже есть для других медиа).

Output: `.lovable/discovery/voice_outgoing_gap_2026-06-14.md` — точный список отсутствующих звеньев и для каждого пометка «можно переиспользовать существующее / нужно новое».

## D4 — Runtime transport probes (Telegram Bot API напрямую, БЕЗ изменения production-кода)

Цель: получить ground truth от Telegram, что он принимает как `voice`, `audio`, `document` или отвергает.

Способ выполнения:

- Прямой диагностический вызов Telegram Bot API `sendVoice` из защищённого sandbox/runner с использованием существующего тестового bot secret через connector gateway (`https://connector-gateway.lovable.dev/telegram/sendVoice`, headers `Authorization: Bearer $LOVABLE_API_KEY`, `X-Connection-Api-Key: $TELEGRAM_API_KEY`).
- Либо временный ad-hoc diagnostic runner, который НЕ деплоится, НЕ коммитится и НЕ меняет production edge function.
- `case "voice"` в `telegram-admin-chat/index.ts` НЕ добавляется до D5.
- Только test bot / test contact / test chat. Перед probe — verification, что `chat_id` не принадлежит реальному клиенту.

Probes:

- **P1 — OGG/Opus (real incoming):** скачать байты существующего voice клиента → создать тестовую копию в изолированном path (или держать локально) → отправить тестовому контакту → зафиксировать ответ Telegram.
- **P2 — WebM/Opus (Chrome-like):** публичный или локально сгенерированный fixture с доказанным контейнером (Matroska/WebM) и codec (opus), длительность 1–2 сек.
- **P3 — M4A/AAC (Safari-like):** публичный или локально сгенерированный fixture с доказанным контейнером (ISO MP4 / `M4A `) и codec (AAC-LC), длительность 1–2 сек.

Главное техническое доказательство — структурное поле в ответе Telegram Bot API (объект Message):

| Поле ответа        | Интерпретация                  |
|--------------------|--------------------------------|
| `result.voice`     | Telegram принял как voice      |
| `result.audio`     | audio-track                    |
| `result.document`  | document                       |
| `ok=false`         | transport rejected             |

Скриншот клиента — дополнительный UI-proof, не основной. Для P3 (если `result.voice`) дополнительно проверить воспроизведение в клиенте и в нашей UI-истории после reload — только тогда Safari-формат считается пригодным.

Cleanup после каждого probe: `deleteMessage` по `result.message_id`; удалить созданный fixture-объект из storage; если DB-строки в `telegram_messages` не создавалось — `DB cleanup = not applicable`. Никаких широких DELETE.

Если runtime probe нельзя безопасно выполнить без изменения production-кода или раскрытия секрета — guard не обходится; D4 помечается `BLOCKED_BY_SECURE_RUNTIME`; D1–D3 завершаются; D5 возвращает точный минимальный run-book.

Output: `.lovable/discovery/voice_runtime_probes_2026-06-14.md` — для каждого probe фиксируется fixture (источник, контейнер, codec, MIME, расширение, длительность, целостность, лицензия), HTTP status, `ok`, какое из полей `voice/audio/document` присутствует, `message_id`, cleanup-результат, маска секретов.

## D5 — Консолидированный отчёт и решение

Output: `.lovable/proofs/voice_discovery_consolidated_2026-06-14.md`.

Структурные блоки, разделённые по природе фактов:

- **HISTORICAL FACT** — было ли это уже реализовано (из D1), какие коммиты/ветки, что потеряно.
- **CURRENT CODE FACT** — текущая входящая (D2) и исходящая (D3) архитектура; точный список gap'ов.
- **TELEGRAM API RUNTIME FACT** — результаты P1/P2/P3 по полям `result.voice/audio/document` (из D4).
- **DEVICE-SPECIFIC UAT PENDING** — что нельзя закрыть публичными fixtures и требует реального устройства (явный список: iOS Safari, Android Chrome WebView и т.д.).
- **RECOMMENDATION** — итоговое решение.

Если в D1 найдена старая реализация — НЕ переносить автоматически. Дать mapping-таблицу:

| старый элемент | текущий эквивалент | решение: восстановить / не использовать / адаптировать |

Сравнение проводится по: Storage contract, edge payload, Telegram response validation, metadata, signed URL, current composer, mobile lifecycle.

Итоговое решение принимается по совокупности (git history + D2 + P1/P2/P3 + поля Message + требование одинакового поведения Chrome/Safari), а НЕ только по таблице поддержки браузеров. RECOMMENDATION содержит четыре отдельных вывода:

1. Нужен ли `sendVoice` mapping в `telegram-admin-chat`?
2. Нужен ли UI recorder в `ContactTelegramChat`?
3. Можно ли переиспользовать `src/components/support/VoiceRecorder.tsx` (через извлечение shared `recorder-core` без изменения support-UI)?
4. Нужен ли transcoding / remux (и если да — на каком уровне: client `ffmpeg.wasm`, server, container-swap remux)?

Граничные случаи:

- Если P2 (WebM/Opus) → `result.voice`, это не закрывает Safari. Минимально допустимый вывод: Chrome/Edge без транскодера, Firefox без транскодера, Safari/iOS → `DEVICE-SPECIFIC UAT PENDING` или отдельный fallback (`sendAudio`).
- Если P3 (M4A/AAC) → `result.voice` + reload-playback OK → Safari-формат пригоден.
- Если `BLOCKED_BY_SECURE_RUNTIME` — D5 содержит минимальный run-book для безопасного запуска probes.

## Технические детали выполнения

- Anti-duplication: общий `recorder-core` (`src/components/admin/chat/useAudioRecorderCore.ts`) будет вынесен только в build-фазе после D5, и только после regression proof для support.
- В `telegram-admin-chat/index.ts` две дублирующиеся карты `fileType → method/fieldName` будут консолидированы в `resolveTelegramMediaTransport(fileType)` тоже только в build-фазе.
- Все proof-файлы пишутся в `.lovable/discovery/` и `.lovable/proofs/`. Bot token / API keys никогда не попадают в эти файлы; используются только маскированные ссылки (`$TELEGRAM_API_KEY`).
- Diagnostic ffmpeg/ffprobe вызовы — в `/tmp/`, без модификации `package.json`.

## Исключения (вне scope этого discovery-прохода)

- Биллинг, Stripe, RLS, Telegram lifecycle (join/kick), support-тикеты как фича, S0–S4 `PATCH-CONTACT-CENTER-FIX-V1`.
- Выбор и реализация транспортной архитектуры (варианты 1–4) — только после D5.
- Любые изменения production edge functions, DB schema, миграций.

## DoD discovery-прохода

- `.lovable/discovery/voice_history_2026-06-14.md` создан, содержит верифицируемые ссылки на коммиты/ветки/файлы.
- `.lovable/discovery/voice_incoming_architecture_2026-06-14.md` создан, доказывает природу плеера (voice vs audio).
- `.lovable/discovery/voice_outgoing_gap_2026-06-14.md` создан с точным списком gap'ов.
- `.lovable/discovery/voice_runtime_probes_2026-06-14.md` создан с fixtures-картами и полями `result.voice/audio/document` (или `BLOCKED_BY_SECURE_RUNTIME` + run-book).
- `.lovable/proofs/voice_discovery_consolidated_2026-06-14.md` создан с пятью блоками (HISTORICAL/CURRENT/RUNTIME/UAT-PENDING/RECOMMENDATION) и четырьмя ответами в RECOMMENDATION.
- Cleanup всех тестовых артефактов подтверждён в proof; оригинальное voice клиента не тронуто; секреты не утекли.
- Production-код не изменён.
