дополни план следующей информацией:

1. **Не удалять вкладку «Быстрая рассылка» сразу.**  
Сначала сделать unified template flow, убедиться, что он полностью заменяет quick-send. После DoD — отдельным cleanup-патчем скрыть/удалить старую вкладку.
2. **Не создавать** `broadcast_dispatcher_config`**, если уже есть** `live_notification_config`**.**  
Сначала проверить, можно ли переиспользовать общий config-паттерн. Если нужна отдельная таблица — обосновать, почему `live_notification_config` не подходит.
3. `live_event_notification_log` **не расширять.**  
Согласен: не трогать, так как это домен эфиров. Для рассылок лучше отдельный `broadcast_runs`, но добавить обоснование: это не дубль, а execution-level агрегат для broadcast templates.
4. **Per-recipient TG детализация:**  
В MVP агрегаты допустимы, но в `broadcast_runs.audience_snapshot` обязательно сохранять:
  - total candidates;
  - sent;
  - failed;
  - skipped;
  - per_bot;
  - per_channel.
5. **Обязательный anti-empty-audience guard:**  
Нельзя сохранить или запустить шаблон, если аудитория пустая или фильтры не заданы явно.
6. **Cron secret / auth:**  
Не использовать пустой Bearer в SQL. Сразу указать безопасный способ авторизации cron job, с учётом прошлого бага `current_setting(...) = NULL`.
7. **Статусы** `broadcast_templates`**:**  
Перед расширением CHECK показать текущие допустимые статусы и backfill-план. Не ломать старые `draft/scheduled/sent/archived`.
8. **Медиа:**  
`broadcast-media` bucket создавать только после проверки существующих storage buckets. Если уже есть подходящий bucket — переиспользовать.
9. **Email/TG дубль-доставка:**  
По умолчанию оставить дубль-доставку в оба канала, если выбраны оба. Но добавить UI-переключатель:
  - “отправлять в оба канала”
  - “email только тем, у кого нет Telegram”
10. **Спринт разбить на этапы:**

- Sprint A: DB + dispatcher + dry-run без UI-ломки.
- Sprint B: wizard UI.
- Sprint C: recurring + cron production enable.
- Sprint D: cleanup quick-send.

После этих правок план можно согласовывать.

&nbsp;

План: Планировщик рассылок на базе broadcast_templates (no-duplicates, дополненный план)

## 1. Проблема

В `/admin/communication?tab=broadcasts` есть две разорванные секции — «Шаблоны» (без отправки) и «⚡ Быстрая рассылка» (моментальная отправка без сохранения). Нет:

- единого создания рассылки с медиа + аудиторией + кнопкой;
- отложенной отправки на дату/время;
- периодической отправки (раз в N дней/недель/месяцев);
- автоматической отправки по обоим каналам, если в шаблоне заполнены и Telegram, и Email;
- обязательного dry-run перед execute.

## 2. Диагностика (фактическое состояние)

### 2.1. Существующие таблицы (проверено через psql)


| Таблица                       | Назначение                                                                                                                                                                                                                                                                                     | Статус для нашей задачи                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `broadcast_templates`         | Шаблоны TG/Email рассылок. Колонки: `id, name, channel, message_text, button_text, button_url, email_subject, email_body_html, status('draft','scheduled','sent','archived'), scheduled_for, sent_count, failed_count, sent_at, created_by, template_type, live_event_id, targeting_tariff_id` | **Переиспользуем как SoT шаблонов**. `scheduled_for` уже есть, статус `scheduled` уже есть. Не хватает: `audience_filters`, `media_*`, `channels[]`, `recurrence_rule`, `next_run_at`, `last_run_at`. |
| `live_event_notification_log` | Per-recipient лог рассылок по эфирам. Колонки: `id, live_event_id (NOT NULL FK), template_id → broadcast_templates, user_id, channel('telegram'                                                                                                                                                | 'email'), notify_offset_minutes (NOT NULL), scheduled_for, sent_at, status('pending'                                                                                                                  |
| `email_logs`                  | Универсальный лог всех outgoing email (любые каналы отправки).                                                                                                                                                                                                                                 | Уже пишется из `email-mass-broadcast`. **Источник истины для email-аудита**, не дублируем.                                                                                                            |
| `news_digest_queue`           | Очередь дайджестов **новостей** (FK на `news_content`).                                                                                                                                                                                                                                        | Не подходит по семантике; не переиспользуем.                                                                                                                                                          |
| `notification_outbox`         | Очередь персональных нотификаций. RLS отсутствует, idempotency_key — single-recipient контракт.                                                                                                                                                                                                | Не подходит для броадкастов; не переиспользуем.                                                                                                                                                       |
| `live_notification_config`    | Singleton kill-switch для cron эфиров.                                                                                                                                                                                                                                                         | Паттерн копируем (см. п.2.5), но отдельным singleton (см. п.3.4).                                                                                                                                     |


### 2.2. Существующие RPC

- `resolve_broadcast_audience(_filters jsonb)` — возвращает `{telegram_count, email_count, total_count, users[]}`. **Единый SoT аудитории**, используется и UI, и edge funcs. Переиспользуем.
- `resolve_broadcast_audience_user_ids(_filters jsonb)` — отдаёт только user_ids (для bulk-операций).

### 2.3. Существующие edge functions (по реестру)

- `telegram-mass-broadcast` — принимает `{message, include_button, button_text, button_url, filters, product_context_id}`, поддерживает multipart с File для медиа.
- `email-mass-broadcast` — принимает `{subject, html, filters, product_context_id}`.
- `live-event-notifications-cron` — **эталонный dispatcher** с `dry_run` body-параметром, kill-switch, `production_approved` gate, единым cron `* * * * *`.
- `manage-news-schedule` — управление расписанием новостей (другая семантика, не трогаем).

### 2.4. Существующие cron-jobs (cron.job)


| jobname                    | schedule     | active |
| -------------------------- | ------------ | ------ |
| `live-event-notifications` | `* * * * *`  | false  |
| `monitor-news-morning`     | `0 5 * * *`  | true   |
| `monitor-news-afternoon`   | `0 12 * * *` | true   |


Отдельного cron под broadcast-рассылки нет. **Создаём ровно один общий dispatcher** (см. п.3.5).

### 2.5. Существующие UI-компоненты рассылок

- `src/components/admin/communication/BroadcastsTabContent.tsx` — корневой контейнер, две вкладки `templates`/`quick`.
- `BroadcastTemplatesSection.tsx` — список шаблонов + 4 статус-фильтра (Черновики/Запланированные/Отправленные/Архив).
- `BroadcastTemplateCard.tsx` — карточка шаблона.
- `BroadcastTemplateDialog.tsx` — создание/редактирование (имя, канал, текст, кнопка, тип).
- `BroadcastSendDialog.tsx` — выбор аудитории + подтверждение отправки (использует свою упрощённую структуру `BroadcastFilters`).
- В быстрой рассылке (`BroadcastsTabContent.tsx`) — полная модель `BroadcastFilters` с include/exclude/club_ids/club_membership/bot_ids + `RuleListEditor` + загрузка медиа.

## 3. Предлагаемое решение

### 3.1. Anti-duplication guard (перед каждым шагом)


| Сущность                   | Существующее?                                                             | Действие                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Таблица шаблонов           | `broadcast_templates` ✅                                                   | **Переиспользуем**. ALTER add-only.                                                                                                                                                                              |
| Таблица очереди отложенных | Нет (в эфирах используется `live_event_notification_log` — несовместима)  | Доказательство: dedup-индекс требует `live_event_id NOT NULL` + `notify_offset_minutes NOT NULL`. **Только после этого** добавляем `broadcast_runs` (per-execution лог).                                         |
| Лог per-recipient          | `live_event_notification_log` (только эфиры), `email_logs` (только email) | **Не дублируем**. Per-recipient детализация по TG для broadcast-рассылок не требуется в MVP — агрегируем `sent/failed` в `broadcast_runs`. Email-детализация автоматически попадает в `email_logs` как и сейчас. |
| Аудит                      | `audit_logs` ✅                                                            | Переиспользуем (как сейчас telegram-mass-broadcast пишет).                                                                                                                                                       |
| RPC аудитории              | `resolve_broadcast_audience` ✅                                            | Переиспользуем без изменений.                                                                                                                                                                                    |
| Telegram broadcast         | `telegram-mass-broadcast` ✅                                               | **Add-only**: расширяем приёмом `media_url` (signed URL из Storage) для отложенных рассылок. Существующий multipart-путь сохраняем.                                                                              |
| Email broadcast            | `email-mass-broadcast` ✅                                                  | Без изменений.                                                                                                                                                                                                   |
| Cron dispatcher            | `live-event-notifications-cron` (только эфиры)                            | **Не дублируем под каждый broadcast**. Создаём ровно ОДИН общий cron `process-scheduled-broadcasts` (схема `* * * * *`), который обходит все pending шаблоны.                                                    |
| Kill-switch                | `live_notification_config` (только эфиры)                                 | Копируем паттерн в `broadcast_dispatcher_config` (singleton id=1) — отдельный, чтобы пауза эфиров не валила broadcast и наоборот.                                                                                |


### 3.2. Миграция БД (минимально необходимое, ALTER add-only)

В `broadcast_templates` добавить:

- `audience_filters jsonb` — снапшот фильтров. Структура совпадает с `BroadcastFilters` из `BroadcastsTabContent.tsx` (include/exclude/club_ids/club_membership/bot_ids). Дефолт `'{}'::jsonb`.
- `channels text[] not null default '{telegram}'` — поддерживает `{telegram}`, `{email}`, `{telegram,email}`. Старая колонка `channel` сохраняется как «primary channel» для обратной совместимости (UI миграция: при чтении — если `channels` пуст, fallback `[channel]`; при записи — синхронизируем `channel = channels[0]`).
- `media_storage_path text` — путь в существующем bucket (см. п.3.3).
- `media_type text` — `'photo'|'video'|'audio'|'video_note'`.
- `media_file_name text`.
- `send_mode text not null default 'manual' check (send_mode in ('manual','scheduled','recurring'))`.
- `recurrence_rule jsonb` — `{frequency:'daily'|'weekly'|'monthly', interval:int, by_weekday:int[]?, time_of_day:'HH:MM', timezone:'Europe/Minsk', ends_at:timestamptz?}`.
- `next_run_at timestamptz` — индексируется частичным индексом `where status in ('scheduled') and next_run_at is not null`.
- `last_run_at timestamptz`, `total_runs int default 0`.
- В CHECK на `status` добавить значение `'recurring'` (рассылки с активной периодичностью остаются в этом статусе бесконечно, до архивации).

Новая таблица `broadcast_runs` (per-execution лог, нужна потому что у периодических нет одного `sent_at`):

- `id uuid pk default gen_random_uuid()`
- `template_id uuid not null references broadcast_templates(id) on delete cascade`
- `started_at timestamptz not null default now()`
- `finished_at timestamptz`
- `channel text not null check (channel in ('telegram','email'))`
- `audience_count int`, `sent_count int default 0`, `failed_count int default 0`, `skipped_count int default 0`
- `dry_run boolean not null default false`
- `audience_snapshot jsonb` — что увидел dispatcher (для расследований)
- `dispatch_mode text not null default 'production'` (по аналогии с live_event_notification_log)
- `error text`
- `triggered_by text not null check (triggered_by in ('manual','scheduled','recurring','dry_run'))`
- `idempotency_key text unique` — формат `tpl:{template_id}:{channel}:{epoch_minute}` для отложенных, `tpl:{template_id}:{channel}:run:{n}` для recurring. Защита от двойного запуска при пересечении cron-тиков.
- Индексы: `(template_id, started_at desc)`, `(dispatch_mode, started_at desc)`.
- RLS: те же `has_permission(auth.uid(), 'entitlements.manage')` + `service_role` full access.

Новый singleton `broadcast_dispatcher_config` (1 row, копия паттерна `live_notification_config`):

- `id int pk check(id=1)`, `enabled boolean not null default false`, `production_approved boolean not null default false`, `updated_at`, `updated_by`. RLS только админам.

Новая SQL-функция `compute_next_broadcast_run(rule jsonb, from_ts timestamptz) returns timestamptz` (PL/pgSQL, immutable=false stable). Возвращает следующую отметку в UTC по правилу. Дублирующая JS-утилита для UI-предпросмотра следующих 3 запусков.

Storage: используем существующий bucket для медиа. Перед миграцией проверю наличие подходящего bucket (`broadcast-media` или общий) через `storage.buckets`. Если нет ни одного подходящего публичного — создаём `broadcast-media` (private, signed URL на 24h при отправке).

### 3.3. Edge functions (add-only)

`**telegram-mass-broadcast**` — расширяем приём:

- Если в body есть `media_url: string` (HTTPS, без `media: File` в multipart) — функция выкачивает файл по signed URL и пересылает в Telegram (добавляется ветка рядом с существующим multipart-приёмом).
- Существующий multipart-путь и текстовый JSON-путь не трогаем.

**Новая `process-scheduled-broadcasts**` — единственный новый dispatcher. Логика идентична `live-event-notifications-cron`:

1. Принимает body `{ dry_run?: boolean, force_template_id?: uuid }`.
2. Guard 1: читает `broadcast_dispatcher_config`. Если `enabled=false` → controlled skip с reason.
3. Guard 2: если `dry_run=false` и `production_approved=false` → controlled skip.
4. Выбирает шаблоны:
  - `status='scheduled' AND next_run_at <= now()` (одноразовые отложенные), либо
  - `status='recurring' AND next_run_at <= now()` (периодические).
5. Для каждого шаблона:
  - Резолвит аудиторию через `resolve_broadcast_audience(audience_filters)`.
  - Для каждого канала из `channels[]`:
    - Создаёт `broadcast_runs` row со статусом «started», `idempotency_key` (UNIQUE-индекс защищает от двойного выполнения).
    - Если `dry_run` — фиксирует `audience_count`, не отправляет, ставит `triggered_by='dry_run'`.
    - Иначе вызывает `telegram-mass-broadcast`/`email-mass-broadcast` с собранным body (для TG — генерит signed URL из `media_storage_path` если есть).
    - Записывает результат в `broadcast_runs` (`sent_count/failed_count/finished_at/error`).
  - Для `scheduled`: статус → `'sent'`, `sent_at=now()`.
  - Для `recurring`: вычисляет новый `next_run_at = compute_next_broadcast_run(...)`. Если он `> ends_at` → статус `'sent'` и `next_run_at=null`. Иначе обновляет `last_run_at`, `total_runs+=1`.
6. Пишет агрегированную запись в `audit_logs` с `actor_type='system'`, `action='broadcast_dispatcher_run'`, meta = `{dry_run, processed_templates, sent, failed, skipped}`.

Cron создаётся отдельной insert-операцией (не миграцией, т.к. содержит anon key — по schedule-jobs guide):

```sql
select cron.schedule('process-scheduled-broadcasts', '* * * * *',
  $$ select net.http_post(
    url:='https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/process-scheduled-broadcasts',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer <ANON>"}'::jsonb,
    body:='{}'::jsonb) $$);
```

### 3.4. UI

**Удаляется** вкладка «⚡ Быстрая рассылка» — её функционал переезжает в расширенный диалог шаблона. На главном экране остаётся одна вкладка «📋 Шаблоны рассылок» с фильтрами:
`Черновики | Запланированные | Периодические | Отправленные | Архив`.

`**BroadcastTemplateDialog**` — переписывается в единый wizard со следующими секциями:

1. **Название** + тип (general / webinar_invite — как сейчас).
2. **Каналы (мульти-чекбоксы)**: Telegram, Email. Live-подсказка: «Рассылка уйдёт в оба канала. Получателям, у которых есть и Telegram и Email, придут оба сообщения.»
3. **Контент** (по табам только для активных каналов): TG-секция (текст + медиа + кнопка), Email-секция (тема + HTML).
4. **Медиа** (TG): upload в Storage сразу при выборе → сохраняется `media_storage_path`.
5. **Аудитория**: переиспользуем `RuleListEditor` (include/exclude) + клубы + боты — копируем UI из `BroadcastsTabContent.tsx` как отдельный sub-компонент `BroadcastAudienceEditor`. Сразу под ним — счётчики из `resolve_broadcast_audience` (TG: N, Email: M).
6. **Режим отправки** (radio):
  - **Сразу** — по «Отправить» открывает обязательный dry-run модал (см. п.3.6).
  - **Запланировать** — DatePicker (shadcn `pointer-events-auto`) + TimePicker. Сохраняет `send_mode='scheduled'`, `next_run_at=...`, `status='scheduled'`.
  - **Периодически** — частота (день/неделя/месяц) + интервал + дни недели (для weekly) + время + опц. дата окончания. Под полями — «Следующие 3 запуска: …» (через JS-утилиту `computeNextBroadcastRuns`). Сохраняет `send_mode='recurring'`, `recurrence_rule`, `next_run_at`, `status='recurring'`.

`**BroadcastTemplateCard**` — добавляются:

- иконки активных каналов (TG/Email),
- индикатор медиа,
- для `scheduled`: дата/время следующего запуска,
- для `recurring`: человекочитаемое описание расписания + «Запусков: N · Следующий: …»,
- кнопки: «Отправить сейчас» (dry-run → confirm), «Пауза/Возобновить» (для recurring: `status` ↔ `draft`), «Редактировать», «Архив».

`**BroadcastSendDialog**` — упрощается до окна dry-run (см. п.3.6) и используется как для «Отправить сейчас», так и для предпросмотра запланированных.

### 3.5. Обязательный dry-run

Любая отправка (manual «сразу» или ручной trigger «запустить сейчас» для запланированной/периодической) проходит через двухшаговый модал:

1. **Шаг Dry-run**: показывает каналы, размер аудитории по каждому каналу (TG/Email), список ботов (для TG), первые 5 получателей с маркером «есть TG / есть Email», контент-превью. Кнопка «Это превью, ничего не отправлено». Создаётся `broadcast_runs` row с `dry_run=true`, `triggered_by='dry_run'`, `audience_snapshot` со счётчиками.
2. **Шаг Execute**: разблокирована только после успешного dry-run. Вызывает edge function без `dry_run` флага. Создаётся `broadcast_runs` row с `triggered_by='manual'`.

Cron-исполнение для отложенных/периодических НЕ требует ручного dry-run — оно идёт по уже сохранённому шаблону. Но первый запуск кронa для `production_approved=false` → controlled skip, чтобы оператор сначала включил флаг.

### 3.6. Логи и аудит

- Per-execution: `broadcast_runs`.
- Per-template-state: `broadcast_templates.last_run_at`, `total_runs`, `sent_count`, `failed_count`.
- Per-email-recipient: уже пишется в `email_logs` функцией `email-mass-broadcast` (не дублируем).
- Per-broadcast-system-event: `audit_logs` с `action IN ('telegram_mass_broadcast','email_mass_broadcast','broadcast_dispatcher_run')`, `actor_type='system'` для cron-вызовов.

## 4. Изменяемые компоненты

### Файлы (UI)

- `src/components/admin/communication/BroadcastsTabContent.tsx` — удалить вкладку «Быстрая рассылка», оставить только `BroadcastTemplatesSection`.
- `src/components/admin/communication/BroadcastTemplateDialog.tsx` — переписать как единый wizard.
- `src/components/admin/communication/BroadcastTemplateCard.tsx` — расширить отображение.
- `src/components/admin/communication/BroadcastSendDialog.tsx` — превратить в dry-run + execute модал.
- `src/components/admin/communication/BroadcastTemplatesSection.tsx` — добавить статус `recurring` в фильтр.
- Новые: `BroadcastAudienceEditor.tsx`, `BroadcastScheduleEditor.tsx`, `BroadcastDryRunDialog.tsx`, `src/lib/broadcast/computeNextRun.ts`.

### Edge functions

- `telegram-mass-broadcast` — add-only ветка приёма `media_url`.
- **Новая** `process-scheduled-broadcasts` — dispatcher.

### БД

- Миграция: ALTER `broadcast_templates` (8 новых колонок + расширение CHECK), CREATE `broadcast_runs`, CREATE `broadcast_dispatcher_config`, CREATE FUNCTION `compute_next_broadcast_run`. RLS на новые таблицы.
- Insert (не миграция): cron job `process-scheduled-broadcasts`, seed singleton `broadcast_dispatcher_config (1, false, false)`.

### Storage

- Bucket `broadcast-media` (private), если не существует.

## 5. Что не будет изменено (явно вне scope)

- `live_event_notification_log` и `live-event-notifications-cron` — продолжают обслуживать только эфиры.
- `news_digest_queue`, `notification_outbox`, `email_logs` — без изменений схемы.
- `email-mass-broadcast` — не трогаем.
- `resolve_broadcast_audience` — не трогаем.
- Bot/MTProto/user-account отправка — не вводим, рассылки идут только через текущие Bot API функции.
- Per-recipient детализация TG-рассылок (отдельная строка на пользователя) — не вводим в MVP, агрегаты в `broadcast_runs` достаточно.

## 6. Dry-run (на этапе разработки)

- Миграция применяется сначала на staging-snapshot: `EXPLAIN` на новых частичных индексах, проверка что существующие записи `broadcast_templates` с `channel='telegram'` корректно мапятся на дефолт `channels='{telegram}'`.
- `process-scheduled-broadcasts` — первый запуск с `dry_run=true` через `supabase--curl_edge_functions`, без cron. Проверяем что выбираются правильные шаблоны и audience-counter совпадает с UI-предпросмотром.
- UI dry-run модал — обязательный gate перед любым execute (см. п.3.5).
- Cron включается последним шагом, и `broadcast_dispatcher_config.production_approved` стартует в `false` — controlled skip пока оператор явно не включит.

## 7. Execute

1. Миграция БД (ALTER + CREATE).
2. Insert cron-job + seed singleton.
3. Деплой `telegram-mass-broadcast` (add-only) и `process-scheduled-broadcasts`.
4. UI-патч (один PR со всеми компонентами).
5. Smoke: создать тестовый шаблон → dry-run → ручной send «сразу» → проверить `broadcast_runs` и `audit_logs`.
6. Smoke: создать `scheduled` шаблон на now()+2min → дождаться cron → проверить переход в `sent`.
7. Smoke: создать `recurring` daily → проверить два последовательных запуска и пересчёт `next_run_at`.
8. Включить `broadcast_dispatcher_config.enabled=true, production_approved=true`.

## 8. STOP-guards

- Если миграция выявит, что в `broadcast_templates` уже есть строки со `status='scheduled'` и без `audience_filters` — STOP, обсудить backfill отдельно (сейчас таких быть не должно — проверить SELECT перед миграцией).
- Если в Storage уже существует bucket с тем же именем но другими политиками — STOP, не перезаписывать.
- Если `resolve_broadcast_audience` для пустых `audience_filters` возвращает «всех пользователей» — STOP, ввести явный guard «нельзя сохранить шаблон с пустой аудиторией».
- Если Telegram-функция при `media_url` начнёт ронять существующий multipart-путь — откат расширения (фича-флаг через ENV-переменную `ENABLE_MEDIA_URL`).
- Если cron-тик начнёт пересекаться сам с собой (выполнение > 60s) — uniqueness `idempotency_key` в `broadcast_runs` предотвратит двойную отправку, dispatcher должен это поймать и логировать.

## 9. DoD

- Discovery подтверждено: новых таблиц/функций-дублей не создано (см. таблицу 3.1).
- Миграция применена, существующие шаблоны сохраняют работоспособность (`channels` дефолтится из `channel`).
- Создание шаблона с медиа + аудиторией + режимом «Сразу» проходит обязательный dry-run, потом отправляет. `broadcast_runs` содержит обе записи (dry_run + manual).
- Шаблон `scheduled`: cron в указанную минуту срабатывает, `status` → `sent`, в `audit_logs` есть запись с `actor_type='system'`.
- Шаблон `recurring` daily: после двух последовательных запусков `next_run_at` корректно сдвигается, `total_runs=2`, в `broadcast_runs` две записи.
- Шаблон с обоими каналами: одна и та же рассылка попадает и в TG, и в Email; в `broadcast_runs` две строки (по строке на канал) с одним `template_id`.
- Существующий `live-event-notifications-cron` и `live_event_notification_log` продолжают работать без регрессий.
- Удалена вкладка «Быстрая рассылка»; функционал доступен в диалоге шаблона.
- `broadcast_dispatcher_config.enabled=true` и `production_approved=true` — установлены вручную после verify.
- Diff-summary изменённых файлов приложен к Отчёту о выполнении.

## 10. Риски и зависимости

- **Риск разрыва обратной совместимости** старых шаблонов без `channels[]` — митигируется дефолтом + UI-fallback.
- **Риск двойной отправки** при пересечении cron-тиков — митигируется UNIQUE `idempotency_key`.
- **Риск массовой отправки при первом включении cron** — митигируется `production_approved=false` и controlled skip.
- **Зависимость от `resolve_broadcast_audience**` — если RPC изменится, broadcast и live-events пострадают одинаково (это уже общий SoT).
- **Telegram rate limit** — при больших аудиториях (>30 msg/sec) текущая `telegram-mass-broadcast` уже умеет батчинг, не меняем.
- **Часовые пояса**: все timestamptz хранятся в UTC, ввод/отображение — через `Europe/Minsk` (date-fns-tz уже в проекте). В `recurrence_rule.timezone` явно сохраняем зону, в которой задавал оператор.

## 11. Требуется дополнительная информация

Подтверждение от пользователя:

1. Часовой пояс для расписаний — фиксируем `Europe/Minsk` по умолчанию или нужен выбор?
2. Per-recipient детализация TG-отправок (отдельная строка на каждого получателя) — в MVP агрегаты, или сразу детально как у эфиров? (Влияет на размер `broadcast_runs` или отдельную таблицу.)
3. При выборе обоих каналов — отправлять ли email тем, у кого ЕСТЬ Telegram (т.е. дубль-доставка), или только тем, у кого нет TG? (По умолчанию плана — дубль-доставка, как в формулировке задачи.)