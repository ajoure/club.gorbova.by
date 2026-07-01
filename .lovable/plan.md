## да, согласен, с учетом правок:

1. **Не создавать новую Edge Function**, если можно расширить существующую.  
Сначала проверить `call-transcribe-summarize`: если можно вынести shared-модуль — делаем:
  - `_shared/transcribe-audio.ts`
  - `call-transcribe-summarize` использует shared
  - `voice-note-transcribe-summarize` только thin wrapper
2. **Перед миграцией проверить** `contact_files` **schema.**  
Если уже есть `meta jsonb`, лучше хранить:
  &nbsp;
  ```sql
  meta.transcript
  meta.summary
  meta.transcribe_status
  meta.transcribe_reason
  ```
  Не добавлять колонки, если `meta` уже есть.
3. **Telegram forward:**  
Лучше не новая функция, а сначала проверить существующие:
  &nbsp;
  &nbsp;
  - `telegram-admin-chat`
  - `telegram-webhook`
  - support-bot send helpers  
  Если нет подходящего action — добавить action add-only.
4. **Security guard:**  
Для forward/download/transcribe:
  - только authenticated staff;
  - `has_permission(auth.uid(), 'contacts.view')`;
  - service_role только внутри edge.
5. **Download fix:**  
Обязательно оставить два действия:
  - `Открыть`
  - `Скачать`  
  Не заменять preview полностью.
6. **CallRecordingPlayer:**  
Не ломать звонки. `accentClassName` сделать optional, default оставить прежним.
7. **Realtime / refresh:**  
После транскрибации обязательно:
  - обновить `contact_files.meta`;
  - invalidate `contact_feed_list`;
  - проверить, что карточка обновляется без F5.
8. **DoD добавить raw proof:**
  - schema `contact_files`;
  - proof reuse shared transcribe;
  - SQL по voice file meta после транскрибации;
  - browser proof download;
  - Telegram delivery screenshot/log.

&nbsp;

Можно отдавать в работу.

&nbsp;

План: Апгрейд «Ленты» — голосовые, плеер, цвета, скачивание, Telegram

### 1. Транскрибация голосовых (reuse call-transcribe-summarize)

- Добавить в `contact_files` (или meta) поля-снапшот: `transcript`, `summary`, `transcribe_status` (`pending|processing|done|skipped_too_short|failed`), `transcribe_reason`.
- Создать Edge Function `voice-note-transcribe-summarize` — тонкий wrapper поверх существующей логики `call-transcribe-summarize` (переиспользовать shared-модуль или вынести общую функцию `transcribeAndSummarize(audioUrl)` в `_shared/`). Никакой параллельной второй реализации.
- Автозапуск: после успешной загрузки голосового в композере (`ContactFeedTab`) — вызвать функцию (fire-and-forget), UI показывает статус «Расшифровывается…», при готовности — карточка обновляется через React Query invalidation/Realtime.
- Применить те же guard'ы: файл < 4KB или длительность < 5с → `skipped_too_short`, кнопка AI-сводки скрыта (единая логика, как в `AdminCalls.tsx`).
- Расширить `contact_feed_list` — отдавать `transcript`, `summary`, `transcribe_status` в событии типа `voice_note`.

### 2. Единый медиаплеер для голосовых

- Переиспользовать `CallRecordingPlayer` (тот же, что в звонках): seek-bar, скорость 0.5×–2×, скачивание.
- В `ContactFeedTab.tsx` заменить `<audio controls>` в ветке `voice_note` на `<CallRecordingPlayer src={fileUrl} />`.
- Убрать нативное меню трёх точек браузера (оно исчезнет автоматически вместе с `controls`).

### 3. Кнопка «Отправить в Telegram support-бот»

- В карточке голосового — иконка Telegram рядом со скачиванием.
- Edge Function `voice-note-forward-to-support` (или расширить существующую `telegram-send-support`): скачивает файл из `contact-files` bucket (service_role), шлёт `sendVoice`/`sendAudio` в чат support-бота (ID из secret `TELEGRAM_SUPPORT_CHAT_ID`), в caption — ссылка на контакт + транскрипт (если готов).
- Гвард: только роли с правом `contacts.view` (employee+).

### 4. Фикс «Скачать» для файлов

- В `ContactFeedTab.tsx` кнопка скачивания сейчас открывает `getPublicUrl` в новом табе → браузер показывает preview.
- Использовать `supabase.storage.from('contact-files').download(path)` → `Blob` → `URL.createObjectURL` + `<a download={filename}>` программный клик. Для крупных файлов — сгенерировать signed URL с `?download=filename` параметром (Supabase поддерживает `download` опцию в `createSignedUrl`).
- Оставить отдельный action «Открыть» для preview (текст/PDF/картинка).

### 5. Цветовая система событий (все типы разные)

Ввести единый map `EVENT_STYLES` в `ContactFeedTab.tsx`:


| Тип        | Bg (light)                        | Icon color  | Accent      |
| ---------- | --------------------------------- | ----------- | ----------- |
| call       | sky-50                            | sky-600     | sky-500     |
| sms        | emerald-50                        | emerald-600 | emerald-500 |
| email      | violet-50                         | violet-600  | violet-500  |
| telegram   | cyan-50                           | cyan-600    | cyan-500    |
| voice_note | pink-50 (сохранить текущий)       | pink-600    | pink-500    |
| file       | amber-50                          | amber-600   | amber-500   |
| note       | yellow-50                         | yellow-700  | yellow-600  |
| task       | indigo-50                         | indigo-600  | indigo-500  |
| deal       | teal-50 (сейчас совпадает с file) | teal-600    | teal-500    |
| event      | slate-50                          | slate-600   | slate-500   |


Сейчас `file` и `deal` одного цвета — развести. Плеер `CallRecordingPlayer` в голосовом получает пропс `accentClassName`, чтобы прогресс-бар/кнопки совпадали с pink-акцентом карточки (для звонков остаётся sky).

### 6. DoD

- Голосовое, записанное в композере, появляется в ленте, через ~10с показывает транскрипт и AI-сводку (или `skipped_too_short`).
- Плеер голосового = плеер звонка (внешне и функционально), 3-точечного нативного меню нет.
- Клик «Скачать» на файле или голосовом — реально скачивает (Content-Disposition: attachment), а не открывает preview.
- Кнопка Telegram отправляет файл + метаданные в support-бот, приходит уведомление.
- Все 10 типов событий визуально различимы (bg/icon/accent), `file` ≠ `deal`.
- Никаких дубликатов Edge-функций/RPC: воспроизводимая цепочка `_shared/transcribe.ts` → `call-transcribe-summarize` и `voice-note-transcribe-summarize`.