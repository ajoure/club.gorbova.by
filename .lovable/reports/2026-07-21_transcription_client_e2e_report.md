# Client-Assisted Transcription — Defect Remediation E2E Report

**Дата:** 2026-07-21
**Скоуп:** исправления по code-review после mainline sync (PR #58/spring) для client-assisted транскрибации крупных записей эфиров.

## 1. Исправленные дефекты

### 1.1 Heartbeat handler в worker (defect #1)
- `supabase/functions/transcription-client-worker/index.ts`
  - Добавлен `handleHeartbeat` (RBAC + owner-check, `heartbeat_at = now()`).
  - Ветка `case "heartbeat"` добавлена в диспетчер `POST`-запросов.
- Hook `src/hooks/useAdminTranscriptionRunner.ts`:
  - `heartbeatTimerRef` запускает `heartbeat` каждые **20 сек**, пока job активна.
  - Таймер очищается при `ready`, `failed`, `cancelled`, unmount и смене job.

### 1.2 Импорт chunker (defect #2)
- `src/lib/wavChunker.ts` подтверждён как канонический путь.
- Hook импортирует из `@/lib/wavChunker` — путь совпадает с реальным модулем.
- Проверка: `bunx tsgo --noEmit` — **PASS**.

### 1.3 Resume после reload (defect #3)
- В хук добавлена функция `ensurePlan(job, asset)`:
  - Если `chunksRef.current` пуст (после reload/mount) — скачивает исходное аудио (signed URL) и **детерминированно** нарезает по существующему `window_ms` из строки job.
  - Восстановленные окна сверяются по количеству и границам с уже зарегистрированными `parts` через `register_parts` (idempotent).
- Отправляются **только `pending`/`failed`** окна старой job. Новая job **не создаётся**, если существует активная — worker возвращает `resumed:true` при повторном `create_job`.

### 1.4 Честный UX (defect #4)
- `src/components/admin/live/TranscriptionWizard.tsx`:
  - Верхний баннер: «Не закрывайте вкладку до завершения. Оценка: 10–15 минут».
  - Прогресс: `X из N окон · YY%`, текущий индекс.
  - Success state: `CheckCircle2 + "Всё сохранено. Вкладку можно закрывать"`.
- `beforeunload` в hook: подтверждение при закрытии активной job.

### 1.5 `public.orders` — вне scope (defect #5)
- Не трогали. Отдельная security-находка отложена ранее отдельным патчем.
- В текущем скане сборки нет `error`-уровня, только `warn` → публикация не блокируется.

## 2. E2E-прогон (скрытые фикстуры)

Фикстура-аудио: синтезированная OpenAI TTS речь `openai/gpt-4o-mini-tts` (7.55 сек, 362 444 байт, RU). STT возвращает 108-символный transcript (>= 20 симв. семантического гварда).

### 2.1 Успешный E2E
- `live_event: e1277307-…` (draft, hidden, slug `e2e-tx-hidden-…`)
- `create_job → register_parts(1) → heartbeat → transcribe_part(0) → status → finalize`
- Все шаги — `HTTP 200`. Finalize вернул `transcript.id=3de789ff-…`, DOCX записан в `live-event-media/…/transcripts/…/transcription.docx`. **PASS**

### 2.2 Reload + Resume
- `live_event: cd35d427-…` (2 окна × 8000 мс).
- Загрузили только `part 0`. Симулировали reload через `status`:
  - Ответ: `parts=[(0,ready),(1,pending)]` — worker честно репортит остаток.
- Загрузили `part 1` → оба ready → finalize `transcript.id=6e8ea0e8-…`. **PASS**

### 2.3 Намеренный failure + retry
- `live_event: 5daeffb3-…`, 1 окно.
- Отправили 3000 байт `os.urandom` как `audio/wav`.
  - STT ответил `400 unsupported_format` → worker вернул `HTTP 502 code=part_transcription_failed`, `part.status='failed'`, `attempts=1`.
- Retry той же части с реальным WAV → `part.status='ready'`, `attempts=2`. **PASS**

### 2.4 Build
- `bunx tsgo --noEmit` — **PASS** (0 диагностик).

## 3. Cleanup

Удалены (verified):
- `live_events` 3 шт (`e1277307`, `cd35d427`, `5daeffb3`).
- Все связанные `live_event_audio_assets`, `live_event_client_transcription_jobs`, `live_event_client_transcription_job_parts`, `live_event_transcripts`.
- Все объекты в bucket `live-event-media` под этими live_event префиксами (audio + transcripts + DOCX) через Storage API.
- Проверка: `SELECT … WHERE slug LIKE 'e2e-tx-%'` → 0 строк. ЦБ2 (`cb2-modul3-practica1`) не тронут.

## 4. Security posture перед публикацией

Scan (`2026-07-21T14:37Z`):
- 0 findings уровня `error`.
- 9 findings уровня `warn` (все — известные ранее приняты риски или отдельные патчи вне спринта).

## 5. Результат

Дефекты #1–#4 закрыты кодом и подтверждены E2E; #5 — не в скоупе. Готово к публикации.
