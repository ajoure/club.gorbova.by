# Отчет о диагностике: PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1 — D4 transport probes

**Дата:** 2026-06-14
**Исполнитель (admin учётка):** 7500084@gmail.com (Сергей Федорчук, super_admin)
**Адресат тестов (Telegram):** тот же физический пользователь, отдельная сущность от admin-учётки

---

## 1. Discovery безопасного тестового контура

### 1.1 Telegram-боты в системе (`telegram_bots`)

| bot_username | bot_name | bot_id | is_primary | status |
|---|---|---|---|---|
| gorbovabybot | gorbova support | 8145684416 | **true** | active |
| gorbova_gc_bot | GetCourse | 5454094430 | false | active |
| Gorbova_club_bot | Gorbova Club | 5478015235 | false | active |
| gorbova_bot | Gorbova BOT | 1180882049 | false | active |

Отдельного `*_test_bot` в БД нет.

### 1.2 Решение по выбору бота — **переиспользование @gorbovabybot**

Соблюдены все условия из п.7 ТЗ:

- `chat_id = 66086524` доказуемо принадлежит Сергею Федорчуку:
  - `profiles.email = '7500084@gmail.com'`, `telegram_user_id = 66086524`, `telegram_username = 'fs_by'`, `telegram_link_status = 'active'`, `telegram_linked_at = 2026-01-15`, linked exactly к `telegram_bots.id = 1a560e98-…-bdc300b4` (primary @gorbovabybot).
  - В `telegram_messages` за последние сутки: входящий `voice` (mid 22910, 12:33 UTC) и `video_note` (mid 22911, 12:42 UTC) от того же `telegram_user_id = 66086524` — Сергей лично записал тестовые медиа в DM с ботом.
  - Это **private chat** (`chat.type='private'`) — не группа, не канал, не клиентский диалог.
- Каждое тестовое сообщение помечено `[TEST] PATCH-CONTACT-CENTER-VOICE-MESSAGES-V1`.
- Рассылки/группы/каналы/клиентские чаты не затронуты.
- Все три тестовых сообщения удалены через `deleteMessage` (см. §4).

Новый бот через BotFather не создавался.

### 1.3 Секреты в sandbox

Доступны (значения не показываются): `LOVABLE_API_KEY`, `PRIMARY_TELEGRAM_BOT_TOKEN`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_MEDIA_WORKER_TOKEN`. Connector-gateway ключа `TELEGRAM_API_KEY` нет, поэтому пробы шли через прямой `https://api.telegram.org/bot{TOKEN}/sendVoice`. Токен ни в одном артефакте не сохранён (`grep` подтвердил отсутствие).

---

## 2. Использованный bot

- **bot_id:** `8145684416` (без секрета)
- **bot_username:** `@gorbovabybot`
- **DB row:** `telegram_bots.id = 1a560e98-574e-4fd9-82ab-4b7bbdc300b4`, `is_primary=true`

---

## 3. Результаты P1 / P2 / P3

Транспорт: `POST https://api.telegram.org/bot<masked>/sendVoice`, multipart, поле `voice=@<file>;type=<mime>`, `chat_id=66086524`, `caption="[TEST] …"`.

| Проба | Фикстура | Client MIME | HTTP/ok | result.voice | result.audio | result.document | server mime | server duration | message_id |
|---|---|---|---|---|---|---|---|---|---|
| **P1** OGG/Opus | `fixture_ogg_opus.ogg` (7682 B) | `audio/ogg` | 200 / **true** | ✅ | — | — | `audio/ogg` | **1 сек** | 22912 |
| **P2** WebM/Opus | `fixture_webm_opus.webm` (8027 B) | `audio/webm` | 200 / **true** | ✅ | — | — | `audio/ogg` | **0 сек** ⚠️ | 22913 |
| **P3** M4A/AAC | `fixture_m4a_aac.m4a` (13518 B) | `audio/mp4` | 200 / **true** | ✅ | — | — | `audio/mp4` | **0 сек** ⚠️ | 22914 |

Полные ответы: `/mnt/documents/voice_probes/p{1,2,3}_*_sendVoice.json` (без токена).

### Ключевые наблюдения

1. **API-уровень:** все три формата приняты Telegram как `voice` — поле `result.voice` присутствует, `audio`/`document` нет. Это формальное доказательство по требованию п.10.
2. **Server-side normalization:**
   - OGG/Opus отдан как есть — корректный `audio/ogg`, корректная длительность.
   - WebM/Opus Telegram **перепаковал** в контейнер `audio/ogg`, но `duration=0` — индикатор того, что либо фикстура слишком короткая (<1 с), либо длительность не извлечена. Возможен риск отображения `0:00` в клиенте.
   - M4A/AAC Telegram **оставил** контейнер `audio/mp4` и тоже `duration=0`. По официальной спецификации `sendVoice` ожидает OGG/Opus; принятый `audio/mp4` — недокументированное поведение. Реальный voice-bubble Telegram-клиента не гарантирован.
3. Для honest verification поведения в реальном клиенте требуется визуальное подтверждение в Telegram-приложении (см. §5).

---

## 4. Cleanup (полный, 3-уровневый)

- **Telegram:** `deleteMessage` для 22912/22913/22914 — все три ответа `{"ok":true,"result":true}`.
- **DB `telegram_messages`:** записей не создавалось (пробы шли напрямую в Bot API, минуя `telegram-admin-chat` edge function и DB write-back). Подтверждено `SELECT … WHERE message_id IN (22912,22913,22914)` — 0 rows.
- **Storage `telegram-media`:** не использовался (multipart-загрузка напрямую в Telegram). Изменений нет.

---

## 5. Скриншоты Telegram-клиента — STATUS: **PENDING USER**

Sandbox не имеет доступа к Telegram-клиенту Сергея для скриншотов. Поскольку сообщения уже удалены через `deleteMessage` (требование cleanup), визуально подтвердить отображение P1/P2/P3 в этом проходе невозможно.

**Минимальное действие для замыкания доказательства** (необязательно для принятия архитектурного решения — см. §6):

1. Скажите «повторить пробы без cleanup» — отправлю те же три фикстуры и оставлю их на 5 минут.
2. Откройте DM с @gorbovabybot, сделайте 3 скриншота (P1/P2/P3) и пришлите.
3. После получения скриншотов выполню `deleteMessage` повторно.

Это закроет п.11 ТЗ. На вывод о транскодере (см. §6) уже имеющихся данных достаточно.

---

## 6. Вывод: нужен ли транскодер

| Сценарий клиента | Что отправит браузер | Поведение Telegram API | Риск UX |
|---|---|---|---|
| Chrome/Edge/Firefox desktop, Android Chrome | `audio/webm;codecs=opus` (MediaRecorder default) | `result.voice` + перепаковка в `audio/ogg` | **duration=0** в наших фикстурах → возможен `0:00` в клиенте. На реальных записях ≥1 сек поведение нужно подтвердить device-UAT. |
| Safari iOS / macOS | `audio/mp4` (AAC) | `result.voice` + `audio/mp4` | Недокументированный путь, в части клиентов может отображаться без воспроизведения / без длительности. |
| Любой клиент, если транскодировать в OGG/Opus | `audio/ogg;codecs=opus` | `result.voice` + корректная длительность | ✅ Гарантированный voice-bubble. |

### Рекомендация для build-фазы (минимальный путь)

**Не вводить тяжёлый серверный ffmpeg-транскодер сейчас.** Достаточно следующего минимального патча:

1. **Client (admin Telegram chat)** — переиспользовать существующий `src/components/support/VoiceRecorder.tsx`-paradigm через извлечение `useAudioRecorderCore`. Mime preference уже корректен: `audio/ogg;codecs=opus` → `audio/webm;codecs=opus` → `audio/webm`. Браузеры, поддерживающие `audio/ogg;codecs=opus` (Chrome 99+, Firefox), будут отдавать прямо OGG/Opus — оптимальный путь.
2. **Edge `telegram-admin-chat`** — добавить `case "voice"` в обе switch-карты (`telegramSendFile` и `telegramSendFileFromBytes`), method=`sendVoice`, fieldName=`voice`, `guessMimeType("voice") = "audio/ogg"` по умолчанию. Консолидировать дублирующиеся карты в один helper `resolveTelegramMediaTransport(fileType)`.
3. **Fallback policy для Safari/WebM с duration=0:** если фактический `MediaRecorder.mimeType` === `audio/mp4` (Safari) — на стороне UI пометить запись и отправлять через `sendAudio` (а не `sendVoice`). Тогда сообщение придёт как音дио-трек с корректной длительностью, без риска `0:00`-voice. Это **client-side fallback без транскодера**.
4. **DEVICE UAT блок** на стадии build/UAT: реальные записи длительностью 3–10 сек с Chrome desktop, Android Chrome, Safari iOS, Safari macOS. По результату решить, нужен ли всё-таки серверный remux WebM→OGG для нормализации длительности.

**Транскодер на edge (ffmpeg/WebAssembly remux) — НЕ включать в первую итерацию.** Включать только если device-UAT покажет систематический `0:00` на реальных записях из Chrome или сломанный voice-bubble на Safari при использовании `sendAudio`-fallback.

---

## 7. Итог по статусам D4

| Пункт ТЗ | Статус |
|---|---|
| Discovery безопасного контура | **PASS** (использован primary @gorbovabybot + DM Сергея, конфликтов нет) |
| P1 OGG/Opus → `result.voice` | **PASS** |
| P2 WebM/Opus → `result.voice` | **PASS на API** / `duration=0` ⚠️ |
| P3 M4A/AAC → `result.voice` | **PASS на API** / `duration=0` + контейнер `audio/mp4` ⚠️ |
| Cleanup Telegram/DB/Storage | **PASS** |
| Скриншоты клиента | **PENDING USER** (см. §5) — не блокирует архитектурное решение |
| Вывод по транскодеру | Транскодер **не нужен** в первой итерации; нужен client-side `sendAudio`-fallback для Safari + DEVICE UAT |

**D4 разблокирован.** Готов переходить к build-фазе (минимальный патч UI + edge mapping + extraction `useAudioRecorderCore`) либо к замыканию п.11 (повторить пробы без cleanup для скриншотов).
