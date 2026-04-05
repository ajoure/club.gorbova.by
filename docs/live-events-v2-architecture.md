# Live Events v2 — Техническая документация

> **Версия**: 2026-04-05  
> **Статус**: post-incident, PATCH 8 guardrails active  
> **Аудитория**: разработчики / DevOps  

---

## 1. Архитектура — Таблицы

### `live_events`
Основная таблица событий. Хранит оба типа: `live_stream` и `recorded_webinar`.

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| slug | text UNIQUE | URL-ключ для /live/:slug |
| title | text | Название |
| description | text | Описание |
| event_type | text | `live_stream` \| `recorded_webinar` |
| source_kind | text | `kinescope_live_event` \| `kinescope_video` |
| platform_status | text | `draft` → `scheduled` → `live` → `completed` → `source_unavailable` |
| scheduled_at | timestamptz | Дата/время начала |
| event_timezone | text | TZ для отображения (Europe/Minsk) |
| is_published | boolean | Видимость для пользователей |
| replay_enabled | boolean | Доступна ли запись |
| kinescope_video_id | text | ID видео Kinescope (recorded_webinar) |
| kinescope_live_event_id | text | ID live-события Kinescope (live_stream) |
| kinescope_project_id | text | Папка Kinescope |
| kinescope_stream_id | text | ID потока Kinescope |
| metadata | jsonb | Включает notification_settings, provider_source_status, obs_data |
| product_id | text | Legacy — не использовать напрямую |
| access_rule | jsonb | Legacy — не использовать напрямую |

### `live_event_access_rules`
Канонические правила доступа к эфиру.

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| live_event_id | uuid FK → live_events | |
| product_id | uuid FK → products_v2 | |
| tariff_id | uuid FK → tariffs (nullable) | |
| is_active | boolean | |

### `live_event_comments`
Комментарии пользователей во время эфира. RLS через `user_has_live_event_access`.

### `live_event_questions`
Вопросы ведущему. RLS через `user_has_live_event_access`.

### `live_event_notification_log`
Лог отправленных уведомлений.

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| live_event_id | uuid FK | |
| user_id | uuid | Получатель |
| channel | text | `telegram` \| `email` |
| offset_minutes | integer | За сколько минут до начала |
| template_id | uuid FK → broadcast_templates | |
| status | text | `sent` \| `failed` \| `skipped` |
| dispatch_mode | text | `production` \| `proof` \| `dry_run` \| `incident_correction` |
| rendered_subject | text | Snapshot рендера (post-incident) |
| rendered_text | text | Snapshot рендера (post-incident) |
| rendered_button_text | text | Snapshot рендера |
| rendered_button_url | text | Snapshot рендера |
| provider_message_id | text | ID от провайдера (Telegram/Email) |
| provider_response | jsonb | Полный ответ провайдера |
| correction_of_log_id | uuid FK → self | Ссылка на исходную запись (для коррекции) |
| incident_batch_id | text | ID пакета инцидента |
| error_message | text | Текст ошибки при failed |

**Unique index**: `(live_event_id, user_id, channel, offset_minutes, dispatch_mode)` — предотвращает дубли.

### `live_notification_config` (синглтон, id=1)
Глобальная конфигурация безопасности рассылок.

| Поле | Тип | Описание |
|------|-----|----------|
| enabled | boolean | **Kill-switch** — false = все рассылки заблокированы |
| production_approved | boolean | **Approval gate** — false = только dry_run разрешён |
| proof_mode | boolean | **Proof mode** — true = отправка только по test_allowlist |
| test_allowlist | uuid[] | Список user_id для тестовых отправок |

### `broadcast_templates`
Шаблоны рассылок. Поддерживают переменные: `{{live_event.title}}`, `{{live_event.description}}`, `{{live_event.link}}`, `{{live_event.start_at_source_tz}}`, `{{live_event.start_at_user_tz}}`, `{{live_event.type}}`.

---

## 2. Edge Functions

### `kinescope-api`
Проксирует вызовы к Kinescope API. Операции: создание live-события, получение списка проектов/видео, синхронизация статуса, получение OBS-данных (RTMP URL + stream key).

### `live-resolve`
Серверная проверка доступа пользователя к эфиру. Вызывает RPC `user_has_live_event_access`. Используется клиентом перед отображением плеера на `/live/:slug`.

### `live-events-list`
Возвращает список доступных эфиров для пользователя. Фильтрует по `is_published=true` и проверяет доступ через каноническую логику.

### `live-event-notifications-cron`
Cron-функция рассылки уведомлений о предстоящих эфирах.

**Guardrails (в порядке проверки):**
1. Global kill-switch (`enabled=false` → controlled_skip)
2. Production approval gate (`production_approved=false` без `dry_run` → controlled_skip)
3. Template/channel compatibility check
4. Source readiness check (`provider_source_status` ≠ missing/broken)
5. Proof mode filter (отправка только user_id из `test_allowlist`)
6. Dedup через unique index в `live_event_notification_log`

**Режимы dispatch_mode:**
- `dry_run` — рендерит, считает аудиторию, не отправляет
- `proof` — отправляет только по test_allowlist
- `production` — полная отправка (требует `production_approved=true`)

**Payload snapshot**: каждая запись в лог включает `rendered_subject`, `rendered_text`, `rendered_button_text`, `rendered_button_url` — добавлено после инцидента для аудита.

### `live-event-send-correction` (если существует)
Ручная отправка корректирующих сообщений. Использует `dispatch_mode=incident_correction`, `correction_of_log_id`, `incident_batch_id`.

---

## 3. Access Logic

**SoT**: RPC `user_has_live_event_access(p_user_id, p_live_event_id)`

**Логика:**
- Роли `admin` / `super_admin` → безусловный bypass
- Для остальных: проверка через `live_event_access_rules` → `subscriptions_v2` (active/trial) + `entitlements` (active) + invitation tokens
- Используется в: RLS `live_event_comments`, RLS `live_event_questions`, edge function `live-resolve`, edge function `live-events-list`

**Запрещено**: параллельные клиентские проверки доступа. Все решения о допуске — только через серверный RPC.

---

## 4. Notification Logic

### Конфигурация в metadata
```json
{
  "notification_settings": {
    "enabled": true,
    "template_id": "uuid",
    "channels": ["telegram", "email"],
    "offsets": [
      { "minutes": 1440, "enabled": true, "label": "За 1 день" },
      { "minutes": 60, "enabled": true, "label": "За 1 час" }
    ]
  }
}
```

### Аудитория
Определяется через `live_event_access_rules` → `resolveEffectiveProductAccess`. Учитывает product_id, tariff_id, фактические сроки действия доступа.

### Совместимость template/channel
- Telegram: требует `message_text`
- Email: требует `email_subject` + `email_body_html`
- Несовместимые каналы пропускаются

### Delivery verification
- Telegram: статус по ответу bot API
- Email: статус по ответу `send-email` edge function
- `sent` только при success, иначе `failed` с error_message

---

## 5. Operational Safeguards

### Таблица `live_notification_config`
Центральный контроль безопасности. Синглтон (id=1).

| Параметр | Значение по умолчанию | Описание |
|----------|----------------------|----------|
| enabled | false | Kill-switch. false = ВСЕ отправки заблокированы |
| production_approved | false | Без этого — только dry_run |
| proof_mode | true | Только test_allowlist получает сообщения |
| test_allowlist | [] | UUID пользователей для тестов |

### Kill-switch
Проверяется ПЕРВЫМ. Если `enabled=false`, функция немедленно возвращает `controlled_skip` без какой-либо обработки.

### Production approval gate
Проверяется ВТОРЫМ. Если `production_approved=false` и `dry_run=false`, функция возвращает `controlled_skip`.

### Proof mode
Если `proof_mode=true`, аудитория фильтруется до `test_allowlist`. Пустой allowlist = 0 отправок.

### Incident correction flow
- `dispatch_mode=incident_correction`
- `correction_of_log_id` → ссылка на ошибочную запись
- `incident_batch_id` → группировка корректирующих записей

### Разрешённые entrypoints
1. **pg_cron** (job 42) — **ДЕАКТИВИРОВАН** (active=false)
2. **Ручной HTTP invoke** — единственный активный путь, гейтирован guardrails
3. Нет webhook'ов, DB triggers, UI-кнопок для автоматического запуска

### Запрещённые действия без approve
- Включение `enabled=true` без явного согласования
- Установка `production_approved=true` без прохождения dry_run
- Добавление пользователей в `test_allowlist` без согласования
- Активация pg_cron job

---

## 6. Live Source Lifecycle

```
create → sync → [recreate] → detach
```

### Состояния `provider_source_status`
- `active` — источник создан и работает
- `missing` — источник не найден в Kinescope
- `broken` — источник есть, но неработоспособен
- (пусто) — статус ещё не проверялся

### Replay transition
1. Админ нажимает «Завершить эфир» → `platform_status = completed`
2. Админ нажимает «Обновить источник» → sync с Kinescope
3. Kinescope конвертирует live в video → `kinescope_video_id` заполняется
4. `/live/:slug` автоматически показывает запись

### OBS-данные
Хранятся в `metadata.obs_data`: `rtmp_url`, `stream_key`. Копируются из Kinescope при создании источника.

---

## 7. UI Structure

### AdminLiveEvents (`/admin/live-events`)
Полная админка: CRUD эфиров, управление источниками, доступами, уведомлениями, контрольная панель.

### `/live` (список эфиров)
Личный кабинет пользователя. Отображается с DashboardLayout (боковое меню). Показывает только доступные пользователю эфиры.

### `/live/:slug` (плеер)
Полноэкранный режим без сайдбара. Kinescope-плеер + чат комментариев + вопросы ведущему. Автоматически переключается между live/replay на основе `platform_status`.

---

## 8. Runtime Dependencies / Внешние зависимости

| Зависимость | Описание | Критичность |
|-------------|----------|------------|
| **Kinescope** | Видеохостинг, live streaming, OBS relay | Критическая — без неё нет видео |
| **Telegram Bot** (`telegram_bots`) | Отправка уведомлений в Telegram | Высокая для notification channel |
| **telegram_clubs** | Связка Telegram-аккаунтов с профилями | Высокая для доставки |
| **send-email** edge function | Отправка email-уведомлений | Средняя |
| **pg_cron** | Планировщик cron-задач | Низкая (деактивирован) |
| **Supabase Realtime** | Живой чат комментариев/вопросов | Средняя |
| **auth.users / profiles** | Аутентификация, профили | Критическая |
| **subscriptions_v2 / entitlements** | Проверка доступа | Критическая |

---

## 9. Known Limitations / Deferred

1. **Token picker внутри Dialog** — баг: `[` token picker не работает внутри Radix Dialog из-за конфликта pointer-events. Workaround: Popover+Command вместо Select.
2. **Автоматический pg_cron** — деактивирован после инцидента. Требует отдельного approve для реактивации.
3. **Email channel** — не полностью протестирован в notification flow.
4. **Автоматический replay detection** — нет polling'а Kinescope; требуется ручной sync.
5. **Множественные offset windows** — теоретически поддерживаются, но протестирован только один offset за раз.

---

## 10. Что нельзя ломать

| Компонент | Причина |
|-----------|---------|
| `recorded_webinar` flow | Отдельный трек, не должен быть затронут live_stream логикой |
| `/live/:slug` единый маршрут | Оба типа используют один URL |
| Replay flow | Критически важен для post-event доступа |
| Comments / Questions | RLS через canonical access, не дублировать |
| `user_has_live_event_access` RPC | Единственный SoT для доступа |
| Incident guardrails | kill-switch, proof_mode, production_approved, test_allowlist |
| Unique index в notification_log | Предотвращает дубли отправок |
| `dispatch_mode` в логах | Аудит и трассировка |
