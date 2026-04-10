# Live Events v2 — Техническая документация

> **Версия**: 2026-04-10  
> **Статус**: Wave 1–3 completed; deferred: полная theme propagation во вложенные компоненты  
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
| metadata | jsonb | Включает notification_settings, provider_source_status, obs_data, **room_theme** |
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

| Поле | Тип | Описание |
|------|-----|----------|
| author_display_name | text | Snapshot имени автора (заполняется trigger'ом) |
| author_avatar_url | text | Snapshot аватара автора (заполняется trigger'ом) |
| author_role | text | Роль автора на момент отправки (admin/employee/user) |
| metadata | jsonb | Доп. данные |

### `live_event_questions`
Вопросы ведущему. RLS через `user_has_live_event_access`.

| Поле | Тип | Описание |
|------|-----|----------|
| author_display_name | text | Snapshot имени автора (заполняется trigger'ом) |
| author_avatar_url | text | Snapshot аватара автора (заполняется trigger'ом) |
| author_role | text | Роль автора на момент отправки |
| metadata | jsonb | Доп. данные |

### `live_event_replies`
Ответы админа на комментарии/вопросы.

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| live_event_id | uuid FK → live_events | |
| source_comment_id | uuid FK → live_event_comments (nullable) | Ссылка на комментарий |
| source_question_id | uuid FK → live_event_questions (nullable) | Ссылка на вопрос |
| target_user_id | uuid (nullable) | Для приватных ответов |
| reply_text | text | Текст ответа |
| visibility_scope | text | `public` / `private` |
| created_by | uuid | Автор (admin) |
| CHECK | | exactly one of source_comment_id / source_question_id |

### `live_event_room_moderation`
Действия модерации в комнате.

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| live_event_id | uuid FK → live_events | |
| user_id | uuid | Целевой пользователь |
| action_type | text | `removed` / `banned` / `restored` / `muted` / `unmuted` |
| reason | text (nullable) | Причина |
| expires_at | timestamptz (nullable) | Срок действия |
| created_by | uuid | Модератор |

### `live_event_room_blocks` (legacy)
Интерактивные блоки в вебинарной комнате. **Legacy** — при наличии активного product CTA binding на той же позиции, legacy блок не рендерится (см. §3a).

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| live_event_id | uuid FK → live_events | |
| block_type | text | `button` / `banner` (form — schema-ready / deferred in UI) |
| display_scope | text | `always` / `live_only` / `replay_only` |
| position | text | `under_video` / `sidebar` |
| sort_order | integer | Порядок отображения |
| is_active | boolean | Активен ли блок |
| config | jsonb | Конфигурация блока (text, url, style и т.д.) |

> **Примечание**: `block_type = 'form'` присутствует в схеме как future-ready, но **не реализован в UI** в текущем спринте. Рендеринг форм разрешён только через каноническое CRM-flow (`site-form-submit`).

### `live_event_product_cta_bindings` (Wave 3)
Привязки продуктов к CTA-блокам эфира. Binding layer — не каталог; SoT цен и продуктов остаётся в products_v2/tariffs/tariff_offers.

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| live_event_id | uuid FK → live_events | |
| product_id | uuid FK → products_v2 | Продукт |
| tariff_id | uuid FK → tariffs (nullable) | Тариф |
| offer_id | uuid FK → tariff_offers (nullable) | Оффер (SoT цены) |
| cta_type | text | `buy_now` / `open_product` / `open_tariff` / `external_link` |
| display_mode | text | `always` / `live_only` / `replay_only` |
| position | text | `under_video` / `sidebar` |
| sort_order | integer | Порядок отображения |
| is_active | boolean | Активен ли CTA |
| overrides | jsonb | Presentation overrides (button_text, description) |
| theme_override | jsonb | Цветовые override для конкретного CTA |
| metadata | jsonb | Доп. данные (external_url для cta_type=external_link) |

**RLS:**
| Policy | CMD | Условие |
|--------|-----|---------|
| Staff can read all CTA bindings | SELECT | admin OR super_admin OR employee |
| Users with event access can read active CTA bindings | SELECT | is_active=true AND user_has_live_event_access |
| Admins can create CTA bindings | INSERT | admin OR super_admin |
| Admins can update CTA bindings | UPDATE | admin OR super_admin |
| Admins can delete CTA bindings | DELETE | admin OR super_admin |

### `live_event_cta_runtime_events` (Wave 3)
Runtime-события CTA: показ, скрытие, замена, клики, отправки форм. Realtime enabled.

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| live_event_id | uuid FK → live_events | |
| binding_id | uuid FK → live_event_product_cta_bindings | |
| event_type | text | `shown` / `hidden` / `replaced` / `clicked` / `form_submitted` |
| trigger_mode | text | `manual` / `auto` |
| shown_by | uuid (nullable) | Кто показал (admin) |
| user_id | uuid (nullable) | Кто кликнул (пользователь) |
| metadata | jsonb | Доп. данные: product_id, tariff_id, offer_id, external_url, cta_type |

**RLS:**
| Policy | CMD | Условие |
|--------|-----|---------|
| Staff can read all CTA runtime events | SELECT | admin OR super_admin OR employee |
| Users with event access can read CTA runtime events | SELECT | user_has_live_event_access |
| Admins can show/hide/replace CTA | INSERT | (admin OR super_admin) AND event_type IN (shown, hidden, replaced) |
| Users can record CTA clicks and submissions | INSERT | event_type IN (clicked, form_submitted) AND user_has_live_event_access |

### `crm_activity_log`
Лог активности для CRM. Заполняется consumer'ом из domain_events.

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | |
| idempotency_key | text UNIQUE | Ключ дедупликации (`{type}:{id}`) |
| activity_type | text | Тип активности |
| source_entity_type | text | `live_event_comment` / `live_event_question` / `live_event_reply` / `live_event_moderation` |
| source_entity_id | uuid | ID исходной записи |
| user_id | uuid | Пользователь |
| live_event_id | uuid FK → live_events (nullable) | |
| author_snapshot | text (nullable) | Имя автора на момент события |
| text_snapshot | text (nullable) | Превью контента |
| visibility_scope | text (nullable) | Область видимости |

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
Серверная проверка доступа пользователя к эфиру. Вызывает RPC `user_has_live_event_access`. Проверяет moderation overlay через `is_user_removed_from_room`. Возвращает `resolved_source` с полным видео-контрактом и флаг `removed_from_room`.

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

### `webinar-activity-consumer`
Обрабатывает `domain_events` с `source='webinar'`. Пишет в `crm_activity_log` с ключом идемпотентности `{type}:{id}`. Вызывается pg_cron job #43 каждую минуту.

**Логика:**
1. SELECT из `domain_events` WHERE `source='webinar'` AND не обработаны
2. Для каждого события → INSERT в `crm_activity_log` с `idempotency_key`
3. Записать `domain_executions` (step=`crm_activity_write`, status=`success`)
4. Повторный вызов с тем же event не создаёт дубль (idempotency)

---

## 2a. Триггеры

### Snapshot автора

**Функция**: `snapshot_author_display_name()`  
**Тип**: BEFORE INSERT trigger  
**Таблицы**: `live_event_comments`, `live_event_questions`  
**Триггеры**: `trg_snapshot_comment_author`, `trg_snapshot_question_author`

**Логика:**
1. Lookup профиля: `SELECT FROM profiles WHERE user_id = NEW.user_id`  
   ⚠️ **Именно `profiles.user_id`**, не `profiles.id` — это было исправлено как баг в стабилизационном спринте.
2. Приоритет имени: `full_name` → `first_name || ' ' || last_name` → masked email → `'Пользователь'`
3. Записывает в `NEW.author_display_name`, `NEW.author_avatar_url` и `NEW.author_role`

### Domain events

**Функция**: `emit_webinar_domain_event()`  
**Тип**: AFTER INSERT trigger  
**Таблицы**: `live_event_comments`, `live_event_questions`, `live_event_replies`, `live_event_room_moderation`  
**Триггеры**: `trg_emit_domain_event_comment`, `trg_emit_domain_event_question`, `trg_emit_domain_event_reply`, `trg_emit_domain_event_moderation`

**Payload по типу таблицы:**

| Таблица | event_type | Особенности payload |
|---------|-----------|-------------------|
| `live_event_comments` | `live_comment_created` | `author_display_name` из snapshot, `content_preview` |
| `live_event_questions` | `live_question_created` | `author_display_name` из snapshot, `content_preview` |
| `live_event_replies` | `live_reply_created` | `author_display_name = NULL` (resolve отдельно в consumer), **`source_comment_id`**, **`source_question_id`** |
| `live_event_room_moderation` | `live_user_removed/banned/restored` | `action_type`, `reason` |

> ⚠️ **Исправлено в стабилизационном спринте**: trigger для `live_event_replies` изначально ссылался на несуществующие колонки `NEW.author_display_name`, `NEW.comment_id`, `NEW.question_id`. Исправлено на `NULL`, `NEW.source_comment_id`, `NEW.source_question_id` соответственно (миграция `20260408203235`).

---

## 3. Access Logic

**SoT**: RPC `user_has_live_event_access(p_user_id, p_live_event_id)`

**Логика:**
- Роли `admin` / `super_admin` → безусловный bypass
- Для остальных: проверка через `live_event_access_rules` → `subscriptions_v2` (active/trial) + `entitlements` (active) + invitation tokens
- Используется в: RLS `live_event_comments`, RLS `live_event_questions`, edge function `live-resolve`, edge function `live-events-list`

**Запрещено**: параллельные клиентские проверки доступа. Все решения о допуске — только через серверный RPC.

### Video source resolver

Функция `resolveVideoSource()` в `live-resolve` определяет источник видео:
1. `kinescope_video_id` → iframe video player
2. `kinescope_live_event_id` → iframe live player
3. ни одного → `source_type: 'none'` (placeholder)

**Debug block**: в UI комнаты (для admin/employee) доступен debug-блок с информацией об источнике: `source_kind`, `kinescope_video_id`, `kinescope_live_event_id`, `provider_source_status`. Позволяет диагностировать проблемы с видео без обращения к разработчику.

### Moderation overlay (security contract)

RPC `is_user_removed_from_room(p_user_id, p_live_event_id)` проверяет, удалён ли пользователь из комнаты.

**Принудительно исполняется в 3 точках:**
1. **`user_has_live_event_access`** — moderation overlay встроен в RPC доступа
2. **`live-resolve`** — edge function проверяет и возвращает `removed_from_room: true`
3. **RLS INSERT policies** для `live_event_comments` и `live_event_questions` — содержат явную проверку `AND NOT is_user_removed_from_room(...)`

> Это **security contract**: удаление из комнаты блокирует доступ к видео, комментариям и вопросам на серверном уровне.

**Inline moderation**: персонал (admin/employee) может выполнять действия модерации прямо из комнаты без перехода в админ-панель:
- Удаление сообщения
- Mute пользователя (запрет отправки сообщений, просмотр разрешён)
- Unmute пользователя
- Remove из комнаты (admin-only)
- Restore пользователя (admin-only)
- Открытие карточки пользователя через `openContactSheet`

### Scenario RPC

`get_live_event_scenario(p_live_event_id, ...)` — unified timeline, объединяющий:
- Комментарии
- Вопросы
- Ответы (replies)
- Действия модерации
- **CTA runtime events** (Wave 3): `cta_shown`, `cta_hidden`, `cta_replaced`, `cta_clicked`, `cta_form_submitted`

CTA events включают metadata: `binding_id`, `product_id`, `tariff_id`, `offer_id`, `trigger_mode`, `cta_type`. JOIN на `products_v2.name` для human-readable текста в timeline и Excel export.

Поддерживает фильтры по типу событий.

---

## 3a. Product-linked CTA Architecture (Wave 3)

### Принцип

Product CTA — это **binding layer**, а не каталог. Источником истины (SoT) для цен, продуктов и тарифов остаются:
- `products_v2` — основная сущность продукта
- `tariffs` — тарифные пакеты
- `tariff_offers` — конкретные офферы с ценами

Binding (`live_event_product_cta_bindings`) хранит **только presentation overrides**: текст кнопки, описание, стиль. Цена всегда берётся из `tariff_offers.amount`.

### cta_type

| Тип | Действие | Маршрут |
|-----|----------|---------|
| `buy_now` | Открывает каноничный PaymentDialog | productId, price из offer.amount, offerId |
| `open_product` | Переход на страницу продукта | `/product/{product.slug}` |
| `open_tariff` | Переход на страницу тарифа | `/tariff/{tariff.public_id}`, fallback на product page |
| `external_link` | Controlled exception — внешняя ссылка | URL из `metadata.external_url` |

### Правило приоритета: Product CTA > Legacy room blocks

Хук `useHasActiveCtaBindings(eventId, position)` проверяет наличие активных CTA bindings для данной позиции (`under_video` / `sidebar`).

**Логика рендера:**
```
if (hasActiveProductCTA для позиции) → рендерим ТОЛЬКО product CTA
else → рендерим legacy LiveEventRoomBlocks
```

Это исключает двойной рендер CTA и legacy блоков на одной позиции.

### Runtime events

При действиях над CTA создаются записи в `live_event_cta_runtime_events`:
- `shown` — CTA показан зрителям (admin-only, trigger_mode=manual)
- `hidden` — CTA скрыт (admin-only)
- `replaced` — один CTA заменён другим (admin-only)
- `clicked` — пользователь кликнул CTA
- `form_submitted` — пользователь отправил форму CTA

Metadata клика включает: `external_url`, `cta_type`, `product_id`, `tariff_id`, `offer_id`.

### RLS матрица

| Роль | bindings | runtime events (show/hide) | runtime events (click) |
|------|----------|---------------------------|----------------------|
| admin / super_admin | CRUD | INSERT shown/hidden/replaced | — |
| employee | SELECT only | — | — |
| user (with access) | SELECT active only | — | INSERT clicked/form_submitted |

### Domain events

CTA runtime events попадают в `get_live_event_scenario` и Excel export. Типы: `live_product_cta_shown`, `live_product_cta_hidden`, `live_product_cta_replaced`, `live_product_cta_clicked`, `live_product_cta_form_submitted`.

---

## 3b. Room Theme (Wave 3)

### Хранение

Тема комнаты хранится в `live_events.metadata.room_theme` (add-only расширение metadata).

### Поля

| Поле | Описание |
|------|----------|
| background_color | Фон комнаты |
| primary_text_color | Основной текст |
| secondary_text_color | Вторичный текст |
| panel_color | Цвет панелей |
| accent_color | Акцентный цвет |
| tabs_color | Цвет вкладок |
| admin_badge_color | Цвет бейджа админа |
| employee_badge_color | Цвет бейджа сотрудника |

### Применение

Тема применяется в `LiveEvent.tsx` через:
1. CSS-переменные на контейнере: `--room-bg`, `--room-text`, `--room-panel`, `--room-accent`, `--room-tabs`, `--room-admin-badge`, `--room-employee-badge`
2. Inline styles: `backgroundColor`, `color` на основном контейнере

### Редактор

`LiveEventThemeEditor` — компонент админки для визуальной настройки темы с color picker, hex-input и preview.

### ⚠️ Deferred: полная пропагация

Текущая реализация:
- ✅ **Работает**: фон комнаты, основной текст первого уровня
- ⚠️ **Частично**: вложенные компоненты (Card, Tabs, Badge, chat messages) используют Tailwind-классы (`bg-card`, `text-foreground`), а не CSS-переменные темы

**Follow-up patch**: пропагация CSS variables во все вложенные компоненты (чат, табы, бейджи, панели, card wrappers).

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
1. **pg_cron job #42** (`live-event-notifications-cron`) — **ДЕАКТИВИРОВАН** (active=false). Notification cron, отключён после инцидента.
2. **pg_cron job #43** (`invoke-webinar-activity-consumer`) — **АКТИВЕН** (active=true, `* * * * *`). CRM consumer, обрабатывает domain_events каждую минуту.
3. **Ручной HTTP invoke** — единственный активный путь для notifications, гейтирован guardrails
4. Нет webhook'ов, DB triggers, UI-кнопок для автоматического запуска notifications

### Запрещённые действия без approve
- Включение `enabled=true` без явного согласования
- Установка `production_approved=true` без прохождения dry_run
- Добавление пользователей в `test_allowlist` без согласования
- Активация pg_cron job #42

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

**Вкладки карточки эфира:**
- Основное / Источник / Доступы / Уведомления
- **Модерация** — управление пользователями в комнате (remove/restore/ban/mute/unmute)
- **Сценарий** — unified timeline (comments, questions, replies, moderation, **CTA events**) с фильтрами
- **Блоки** — редактор legacy room blocks (button, banner)
- **CTA** — управление product CTA bindings (Wave 3): привязка продуктов/тарифов/офферов, show/hide (admin-only)
- **Тема** — редактор room theme (Wave 3): цвета фона, текста, панелей, бейджей с preview

**Excel export (вкладка Сценарий):**
- Комментарии — отдельный лист
- Вопросы — отдельный лист
- Сценарий — unified timeline, включая CTA events с metadata

### `/live` (список эфиров)
Личный кабинет пользователя. Отображается с DashboardLayout (боковое меню). Показывает только доступные пользователю эфиры.

### `/live/:slug` (плеер / комната)
Полноэкранный режим без сайдбара. Kinescope-плеер + чат комментариев + вопросы ведущему + replies + product CTA (или legacy room blocks) + role badges.

**Desktop layout:**
- Видео-область: `flex-[2.5]`
- Колонка чата/вопросов: `calc(100vh - 120px)`, input фиксирован внизу
- Product CTA / legacy blocks: `under_video` (под видео) и `sidebar` (в боковой колонке)

**Mobile layout:**
- Sticky input с поддержкой safe-area bottom
- Sticky tabs (Чат / Вопросы)
- Устранены лишние вертикальные отступы

**Role badges:**
- Admin: бейдж «Админ» с фоном (default: indigo, или `admin_badge_color` из theme)
- Employee: бейдж «Сотрудник» с фоном (default: violet, или `employee_badge_color` из theme)
- Сообщения персонала визуально выделены красным фоном

**Inline moderation (из комнаты):**
- Ответить (reply) — публичный или приватный
- Удалить сообщение
- Mute / Unmute пользователя (staff)
- Remove / Restore (admin-only)
- Открытие карточки пользователя (`openContactSheet`)

**Webinar activity в профиле:**
Активность пользователя в вебинарах отображается в CRM-карточке контакта (раздел «События» / Webinar Activity Section). Записи синхронизируются из `crm_activity_log`.

### Developer notes (UI)

- **Profile lookup**: `LiveEventComments.tsx`, `LiveEventQuestions.tsx`, `LiveEventModeration.tsx` используют lookup профиля по `profiles.user_id` (не по `profiles.id`).  
  ⚠️ Legacy fallback по `profiles.id` был **багом** и исправлен в стабилизационном спринте. При возникновении edge case'ов — проверять именно этот lookup.

- **Display name resolution** (UI fallback chain): `author_display_name` (snapshot) → `profiles.full_name` → `first_name + last_name` → masked email → `'Пользователь'`

- **Role resolution**: `author_role` из snapshot; для inline controls используется `liveRoomRoles.ts` — `isStaffRole()`, `isAdminRole()`, `canModerateMessages()`, `canRemoveFromRoom()`.

---

## 8. Runtime Dependencies / Внешние зависимости

| Зависимость | Описание | Критичность |
|-------------|----------|------------|
| **Kinescope** | Видеохостинг, live streaming, OBS relay | Критическая — без неё нет видео |
| **Telegram Bot** (`telegram_bots`) | Отправка уведомлений в Telegram | Высокая для notification channel |
| **telegram_clubs** | Связка Telegram-аккаунтов с профилями | Высокая для доставки |
| **send-email** edge function | Отправка email-уведомлений | Средняя |
| **pg_cron job #42** | Notification cron | **Деактивирован** |
| **pg_cron job #43** | CRM activity consumer | **Активен**, каждую минуту |
| **Supabase Realtime** | Живой чат комментариев/вопросов, CTA runtime events | Средняя |
| **auth.users / profiles** | Аутентификация, профили | Критическая |
| **subscriptions_v2 / entitlements** | Проверка доступа | Критическая |
| **domain_events / domain_executions** | Event pipeline для CRM sync | Высокая |
| **products_v2 / tariffs / tariff_offers** | SoT для product CTA (цены, продукты) | Высокая для CTA |

---

## 9. Known Limitations / Deferred

1. **Token picker внутри Dialog** — баг: `[` token picker не работает внутри Radix Dialog из-за конфликта pointer-events. Workaround: Popover+Command вместо Select.
2. **Автоматический pg_cron job #42** — деактивирован после инцидента. Требует отдельного approve для реактивации.
3. **Email channel** — не полностью протестирован в notification flow.
4. **Автоматический replay detection** — нет polling'а Kinescope; требуется ручной sync.
5. **Множественные offset windows** — теоретически поддерживаются, но протестирован только один offset за раз.
6. **Room block type `form`** — schema-ready, но **deferred in UI**. Реализация только через каноническое CRM-flow.
7. **Runtime room proof** — live stream с реальным видео ещё не проверялся. Требуется отдельный runtime тест.
8. **Полная пропагация room_theme CSS variables** — CSS-переменные темы заданы на контейнере, но вложенные компоненты (Card, Tabs, Badge, chat) используют Tailwind-классы. Требуется follow-up patch для глубокой темизации.
9. **Legacy `live_event_room_blocks`** — сохранён как compat fallback. При наличии активного product CTA binding на той же позиции, legacy блок подавляется. Legacy блоки не удаляются, чтобы обеспечить обратную совместимость.

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
| Snapshot trigger (`profiles.user_id`) | Lookup по `user_id`, не по `id` — исправлено |
| Domain event pipeline | `emit_webinar_domain_event` → `domain_events` → consumer → `crm_activity_log` |
| CRM idempotency | `idempotency_key` в `crm_activity_log` предотвращает дубли |
| Moderation overlay (3 точки) | `user_has_live_event_access` + `live-resolve` + RLS INSERT policies |
| `live-event-notifications-cron` | Guardrails, kill-switch — не трогать без явного approve |
| Product CTA priority rule | Product CTA > legacy room blocks на одной позиции — не допускать двойной рендер |

---

## 11. Что не затрагивалось в Wave 1–3

Следующие компоненты **не были изменены** и не входят в scope:

- `live-event-notifications-cron` — guardrails и kill-switch остаются без изменений
- Incident guardrails / kill-switch — `live_notification_config` не изменялся
- `recorded_webinar` и replay flow — не затрагивались (CTA и theme работают в обоих режимах)
- `broadcast_templates` — не изменялись
- `send-email` edge function — не затрагивалась
- **pg_cron job #42** — остаётся деактивированным
- **pg_cron job #43** — остаётся активным без изменений
