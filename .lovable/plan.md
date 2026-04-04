да, согласен, с учетом правок:

&nbsp;

&nbsp;

**Главное исправление по логике плана**

&nbsp;

&nbsp;

Текущий вариант слишком сузился до уведомлений. Это неверно.

&nbsp;

Правильный scope:

уведомления — это один из блоков внутри полного спринта по эфирам, а не отдельный спринт.

&nbsp;

Нужен единый end-to-end спринт Live Events, где пользовательский путь выглядит так:

&nbsp;

1. админ создает эфир;
2. настраивает источник;
3. настраивает доступ;
4. настраивает уведомления;
5. публикует эфир;
6. пользователи видят эфир в разделе Эфиры;
7. заходят по /live/:slug;
8. смотрят live / replay;
9. пишут комментарии и вопросы.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**Финальный спринт: Live Events v2 — полный цикл эфиров**

&nbsp;

&nbsp;

&nbsp;

**PATCH 0 — Auth/session stability**

&nbsp;

&nbsp;

Оставить как уже реализованный блокер-гейт.

&nbsp;

DoD:

&nbsp;

- 10–15 минут без forced logout;
- просмотр эфира и работа в админке без выкидывания в логин.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**PATCH 1 — Schema / RLS / realtime / logs**

&nbsp;

&nbsp;

Финализировать схему как основу спринта:

&nbsp;

- live_events — использовать как SoT по эфиру;
- live_event_access_rules — правила доступа;
- live_event_comments — комментарии;
- live_event_questions — вопросы;
- live_event_notification_log — лог уведомлений.

&nbsp;

&nbsp;

Добавить таблицу:

live_event_notification_log

&nbsp;

DoD:

&nbsp;

- comments/questions/log tables существуют;
- RLS корректен;
- realtime включен.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**PATCH 2 — Kinescope integration**

&nbsp;

&nbsp;

Оставить как часть общего спринта, не выносить отдельно.

&nbsp;

Должно быть:

&nbsp;

- create_live_event
- sync_live_event
- enable_live_event
- complete_live_event
- get_live_event_videos
- list_live_folders

&nbsp;

&nbsp;

Плюс обязательная модель статуса источника:

&nbsp;

- draft
- ok
- missing
- broken

&nbsp;

&nbsp;

DoD:

&nbsp;

- live source создается;
- sync работает;
- recreate/detach работают;
- replay определяется.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**PATCH 3 — Admin UX: карточка эфира как единый центр управления**

&nbsp;

&nbsp;

Это ключевая часть спринта.

&nbsp;

В карточке эфира должны быть все секции:

&nbsp;

&nbsp;

**A. Основное**

&nbsp;

&nbsp;

- title
- slug
- description
- дата и время
- timezone

&nbsp;

&nbsp;

&nbsp;

**B. Тип эфира**

&nbsp;

&nbsp;

- live_stream
- recorded_webinar

&nbsp;

&nbsp;

&nbsp;

**C. Источник Kinescope**

&nbsp;

Для live_stream:

&nbsp;

- live folder
- project for recording
- create source
- sync
- recreate
- detach

&nbsp;

&nbsp;

Для recorded_webinar:

&nbsp;

- video picker
- manual fallback

&nbsp;

&nbsp;

&nbsp;

**D. OBS / source settings**

&nbsp;

&nbsp;

- play link
- rtmp
- streamkey
- copy buttons

&nbsp;

&nbsp;

&nbsp;

**E. Access rules**

&nbsp;

&nbsp;

- кто может войти;
- доступ по product/tariff rules.

&nbsp;

&nbsp;

&nbsp;

**F. Уведомления**

&nbsp;

Это внутри карточки эфира, а не отдельно.

&nbsp;

Нужно добавить секцию:

&nbsp;

- toggle Включить уведомления
- выбор шаблона из broadcast_templates
- каналы:  

  - Telegram
  - Email
- &nbsp;
- сроки:  

  - за 1 день
  - за 1 час
- &nbsp;
- summary:  

  - какой шаблон
  - какие каналы
  - за сколько уведомляем
  - что уведомляем только тех, у кого есть доступ к эфиру
- &nbsp;

&nbsp;

&nbsp;

&nbsp;

**G. Publish / readiness**

&nbsp;

&nbsp;

- publish button
- blockers
- source health
- invite readiness

&nbsp;

&nbsp;

&nbsp;

**H. Control panel**

&nbsp;

&nbsp;

- platform badge
- provider badge
- start
- complete
- sync
- comments/questions tabs

&nbsp;

&nbsp;

&nbsp;

**I. Инструкция**

&nbsp;

Обязательно добавить в UI:

&nbsp;

- инструкция для администратора;
- инструкция для ведущего / преподавателя.

&nbsp;

&nbsp;

DoD:

&nbsp;

- по карточке эфира полностью понятно, как его создать, опубликовать, провести и завершить.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**PATCH 4 — Пользовательский раздел**

&nbsp;

&nbsp;

Нужен полноценный user flow.

&nbsp;

&nbsp;

**/live**

&nbsp;

Список доступных эфиров:

&nbsp;

- scheduled
- live
- replay
- type badge
- дата/время
- переход на /live/:slug

&nbsp;

&nbsp;

&nbsp;

**/live/:slug**

&nbsp;

Страница эфира со всеми состояниями:

&nbsp;

- scheduled
- live
- replay_available
- ended_no_replay
- access_denied
- invite_required
- source_unavailable
- unpublished
- not_found

&nbsp;

&nbsp;

Обязательная правка:

&nbsp;

- replay state fix;
- использовать platform_status как source of truth;
- heartbeat только для live, не для replay.

&nbsp;

&nbsp;

DoD:

&nbsp;

- scheduled/live/replay работают корректно;
- replay доступен по той же ссылке.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**PATCH 5 — Comments + Questions**

&nbsp;

&nbsp;

Это часть финального сценария эфира.

&nbsp;

Нужно:

&nbsp;

- realtime comments;
- realtime questions;
- profile linkage;
- admin moderation.

&nbsp;

&nbsp;

DoD:

&nbsp;

- пользователь может писать;
- админ может модерировать;
- всё хранится корректно.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**PATCH 6 — Уведомления как часть live event flow**

&nbsp;

&nbsp;

Это не отдельный проект, а встроенный блок спринта.

&nbsp;

&nbsp;

**Правильная бизнес-логика**

&nbsp;

&nbsp;

Шаблон уведомления:

&nbsp;

- существует отдельно;
- является обычным системным шаблоном;
- не должен создаваться под каждый эфир заново.

&nbsp;

&nbsp;

Эфир:

&nbsp;

- сам выбирает шаблон;
- сам хранит настройки уведомлений;
- сам определяет, за сколько и по каким каналам отправлять.

&nbsp;

&nbsp;

&nbsp;

**То есть:**

&nbsp;

&nbsp;

не шаблон привязывается к эфиру,

а эфир выбирает шаблон.

&nbsp;

&nbsp;

**Что хранить в**

**live_events.metadata.notification_settings**

&nbsp;

&nbsp;

- enabled
- template_id
- channels
- offsets

&nbsp;

&nbsp;

Пример:

&nbsp;

- за 1 день
- за 1 час

&nbsp;

&nbsp;

&nbsp;

**Кому отправлять**

&nbsp;

&nbsp;

Не ручная аудитория.

&nbsp;

Получатели = все пользователи, у которых на момент отправки есть доступ к эфиру по access rules.

&nbsp;

&nbsp;

**Что делает cron**

&nbsp;

&nbsp;

Новая функция:

live-event-notifications-cron

&nbsp;

Она:

&nbsp;

1. берет опубликованные live-эфиры;
2. проверяет notification settings;
3. проверяет окно отправки;
4. собирает аудиторию по access rules;
5. берет выбранный шаблон;
6. подставляет переменные эфира;
7. отправляет Telegram / Email;
8. пишет лог;
9. не допускает дублей.

&nbsp;

&nbsp;

&nbsp;

**Переменные шаблона**

&nbsp;

&nbsp;

- {{live_event.title}}
- {{live_event.description}}
- {{live_event.start_at_source_tz}}
- {{live_event.start_at_user_tz}}
- {{live_[event.link](http://event.link)}}
- {{live_event.type}}

&nbsp;

&nbsp;

DoD:

&nbsp;

- уведомления настраиваются внутри эфира;
- cron реально отправляет;
- live_event_notification_log пишет записи;
- повторных дублей нет.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**PATCH 7 — Инструкция и QA**

&nbsp;

&nbsp;

Подрядчик должен отдать не только код, но и понятную логику использования.

&nbsp;

Обязательно отдать:

&nbsp;

&nbsp;

**Инструкция для администратора**

&nbsp;

&nbsp;

- как создать шаблон уведомления;
- как создать live_stream;
- как выбрать live folder;
- как создать source;
- как включить уведомления;
- как выбрать шаблон;
- как выбрать каналы;
- как включить offsets;
- как опубликовать эфир;
- как завершить эфир;
- как получить replay.

&nbsp;

&nbsp;

&nbsp;

**Инструкция для ведущего**

&nbsp;

&nbsp;

- где взять RTMP;
- где взять streamkey;
- как вставить в OBS;
- когда запускать OBS;
- когда завершать эфир;
- как проверить replay.

&nbsp;

&nbsp;

&nbsp;

**Smoke-test / QA plan**

&nbsp;

&nbsp;

- scheduled state;
- live state;
- replay state;
- source_unavailable;
- comments/questions;
- notification cron;
- notification log;
- no duplicate sends;
- recorded_webinar без регрессии.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**Что уже есть и не нужно выносить как новый scope**

&nbsp;

&nbsp;

Не надо делать вид, что эти части — новый отдельный проект. Они уже являются частью общего спринта:

&nbsp;

- auth/session stabilization;
- comments/questions tables + realtime;
- access rules;
- user /live;
- /live/:slug;
- Kinescope source lifecycle;
- provider sync/recreate/detach.

&nbsp;

&nbsp;

Их нужно не заново перепридумывать, а довести до конца и собрать в единый рабочий сценарий.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**Deferred**

&nbsp;

&nbsp;

Отдельно зафиксировать, но не блокировать спринт:

&nbsp;

- баг [ внутри Dialog — deferred patch;
- сложный редактор шаблонов;
- A/B шаблоны;
- ручной override аудитории;
- дополнительные offsets;
- advanced analytics.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**Финальный DoD всего спринта**

&nbsp;

&nbsp;

Спринт закрыт только если доказано:

&nbsp;

1. админ создает live_stream;
2. админ создает recorded_webinar;
3. OBS-данные реально видны;
4. source sync/recreate/detach работают;
5. /live показывает доступные эфиры;
6. /live/:slug корректно работает для scheduled/live/replay;
7. comments/questions работают;
8. уведомления настраиваются внутри эфира;
9. cron реально отправляет уведомления;
10. live_event_notification_log пишет записи;
11. повторный cron не делает дублей;
12. replay доступен по той же ссылке;
13. recorded flow не сломан;
14. есть инструкция по использованию и тестированию.

&nbsp;

&nbsp;

&nbsp;

**Ключевая формулировка для подрядчика**

&nbsp;

&nbsp;

Не делать отдельный мини-спринт “про уведомления”.

Нужно завершить весь сценарий эфиров целиком, а уведомления реализовать как встроенную часть карточки эфира и общего live-event flow.

&nbsp;

# План: Финализация Live Events v2 — полный end-to-end сценарий эфиров + уведомления

## Текущее состояние (discovery)

### Уже работает

- **Таблица `live_events**` — все нужные колонки есть (event_type, platform_status, kinescope_live_event_id, metadata и т.д.)
- `**live_event_access_rules**` — множественные правила доступа
- `**live_event_comments` / `live_event_questions**` — таблицы, RLS через `user_has_live_event_access` RPC, realtime
- `**AdminLiveEvents.tsx` (2033 строки)** — полная админка: форма, Kinescope source, OBS data, `_providerDraft`, sync/recreate/detach, control panel, comments/questions tabs
- `**LiveEvent.tsx**` — все error states (not_found, access_denied, invite_required, source_unavailable, session_revoked/expired), player, heartbeat, comments/questions sidebar
- `**LiveEvents.tsx**` — список эфиров через `live-events-list` edge function
- `**live-resolve**` — admin bypass, source_unavailable guard, invite_mode check
- `**live-events-list**` — фильтрация по доступу через `user_has_live_event_access` RPC
- `**kinescope-api**` — create/sync/enable/complete/list_folders actions
- `**broadcast_templates**` — есть `template_type`, `live_event_id` (nullable)
- **Auth session stability** — visibility refresh, false SIGNED_OUT guard уже в AuthContext

### Баги, которые нужно починить

1. **Replay state**: `LiveEvent.tsx` строка 265 — `event_status: event.status` вместо `event.platform_status`. При `platform_status=replay_available` клиент видит `event_status=replay_available`, но `isReplay` проверяет только `event_status === "ended"` (строка 315)
2. **Heartbeat при replay**: строка 140 — `startHeartbeat()` вызывается и для replay, хотя не нужен
3. **Нет таблицы `live_event_notification_log**` — нужно создать
4. **Нет cron-функции уведомлений** — нужно создать `live-event-notifications-cron`
5. **Нет UI секции "Уведомления"** в карточке эфира
6. **Нет инструкции** для администратора/ведущего в control panel

---

## PATCH-структура

### PATCH 0 — Auth/session stability

**Статус: уже реализован.** AuthContext уже содержит:

- `getSession()` guard при SIGNED_OUT
- `visibilitychange` listener для refresh
- Structured logging

DoD: подтвержден предыдущими патчами. Пропускаем.

---

### PATCH 1 — Schema: `live_event_notification_log`

**Миграция:**

```sql
CREATE TABLE public.live_event_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.broadcast_templates(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'email')),
  notify_offset_minutes INTEGER NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(live_event_id, user_id, channel, notify_offset_minutes)
);

ALTER TABLE public.live_event_notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage notification log"
  ON public.live_event_notification_log FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));
```

Остальные таблицы (comments, questions, access_rules) уже существуют с корректным RLS.

---

### PATCH 2 — Kinescope integration

**Статус: уже реализован.** `kinescope-api` edge function поддерживает:

- `create_live_event`, `sync_live_event`, `enable_live_event`, `complete_live_event`
- `get_live_event_videos`, `list_live_folders`
- Provider source status: draft/ok/missing/broken

Пропускаем.

---

### PATCH 3 — Admin UX: секция "Уведомления" + инструкция

**Файл: `src/pages/admin/AdminLiveEvents.tsx**`

A. Добавить в `LiveEventForm`:

```typescript
notification_enabled: boolean;
notification_template_id: string;
notification_channels: string[];
notification_offsets: Array<{ minutes: number; enabled: boolean; label: string }>;
```

B. Секция "Уведомления" в карточке `live_stream` (после access rules, перед control panel):

- Toggle "Включить уведомления"
- Select шаблона из `broadcast_templates` (type `webinar_invite` или `general`)
- Чекбоксы каналов: Telegram / Email
- Два пресета offset: "За 1 день" (1440 мин) / "За 1 час" (60 мин) с toggle
- Summary: "Уведомления уйдут пользователям с доступом за 1 день и 1 час до начала через Telegram"

C. Данные сохраняются в `metadata.notification_settings` при save.

D. При загрузке формы (editing) — восстанавливать notification_settings из metadata.

E. Collapsible-блок "Инструкция" в LiveStreamControlPanel:

- Для администратора (10 шагов)
- Для ведущего/преподавателя (7 шагов с OBS)

---

### PATCH 4 — Replay state fix + live-resolve

**Файл: `supabase/functions/live-resolve/index.ts**`

- Строка 265: `event_status: event.platform_status` вместо `event.status`

**Файл: `src/pages/LiveEvent.tsx**`

- Строки 133-141: добавить явную обработку `replay_available`:

```typescript
case "ok":
  if (json.event_status === "scheduled" || json.platform_status === "scheduled") {
    setState("scheduled");
  } else if (json.platform_status === "replay_available" || 
             (json.event_status === "ended" && json.replay_enabled)) {
    setState("live"); // показать плеер с записью
  } else if (json.event_status === "ended" && !json.replay_enabled) {
    setState("ended_no_replay");
  } else {
    setState("live");
    startHeartbeat();
  }
```

- Строка 315: `isReplay` — добавить `platform_status === "replay_available"`
- Guard: не запускать heartbeat для replay

---

### PATCH 5 — Comments + Questions

**Статус: уже реализован.** Компоненты `LiveEventComments` и `LiveEventQuestions` работают с realtime, RLS через `user_has_live_event_access`, admin moderation (delete comments, update questions). Пропускаем.

---

### PATCH 6 — Edge function `live-event-notifications-cron`

**Новый файл: `supabase/functions/live-event-notifications-cron/index.ts**`

Логика:

1. Запрашивает `live_events` где `is_published=true`, `event_type='live_stream'`, `scheduled_at IS NOT NULL`, `platform_status IN ('draft','scheduled')`, `metadata->notification_settings->enabled = true`
2. Для каждого эфира и каждого enabled offset: вычисляет `window = scheduled_at - offset_minutes`. Если `now() >= window` → пора отправлять
3. Собирает аудиторию: через `live_event_access_rules` → находит product_id/tariff_id → ищет пользователей с активными подписками/entitlements
4. Для каждого user+channel проверяет UNIQUE constraint в `live_event_notification_log` (дедупликация)
5. Загружает шаблон из `broadcast_templates` по `template_id`
6. Подставляет переменные эфира:
  - `{{live_event.title}}`, `{{live_event.description}}`
  - `{{live_event.start_at_source_tz}}`, `{{live_event.start_at_user_tz}}`
  - `{{live_event.link}}` → полный URL `/live/${slug}`
  - `{{live_event.type}}` → "Живой эфир" / "Эфир в записи"
7. Отправляет:
  - Telegram → через bot API (аналогично `telegram-mass-broadcast`)
  - Email → через `send-email` edge function invoke
8. Пишет результат в `live_event_notification_log`

**Cron job** (через insert tool):

```sql
SELECT cron.schedule(
  'live-event-notifications',
  '* * * * *',
  $$ SELECT net.http_post(...) $$
);
```

**Регистрация** в `supabase/functions.registry.txt`.

---

### PATCH 7 — Broadcast template alignment

**Частично уже реализован.** `broadcast_templates.live_event_id` уже nullable. Шаблоны `webinar_invite` уже можно создавать без привязки к эфиру.

Broadcast flow остаётся как дополнительный manual channel. Основной live-notification flow через `notification_settings` внутри эфира + cron.

---

## Файлы для изменения


| Файл                                                        | Изменение                                         |
| ----------------------------------------------------------- | ------------------------------------------------- |
| миграция                                                    | Таблица `live_event_notification_log`             |
| `src/pages/admin/AdminLiveEvents.tsx`                       | Секция "Уведомления" + инструкция в control panel |
| `supabase/functions/live-resolve/index.ts`                  | `event_status → platform_status`                  |
| `src/pages/LiveEvent.tsx`                                   | Replay state fix + heartbeat guard                |
| `supabase/functions/live-event-notifications-cron/index.ts` | Новая edge function                               |
| `supabase/functions.registry.txt`                           | Регистрация cron функции                          |


## Что НЕ трогаем

- `recorded_webinar` flow — не затрагивается
- Существующие `broadcast_templates` / `BroadcastSendDialog` — остаются как есть
- Auth/session — уже стабильно
- Comments/Questions — уже работают
- Kinescope integration — уже работает
- `[ token picker` баг — deferred

## DoD

1. В карточке live_stream можно настроить уведомления (шаблон, каналы, offsets)
2. Cron реально отправляет уведомления по access rules
3. `live_event_notification_log` пишет записи
4. Дедупликация: повторный cron не создаёт дублей
5. `/live/:slug` при `replay_available` показывает плеер + плашку "Запись"
6. Heartbeat не запускается для replay
7. Инструкция для администратора/ведущего видна в control panel
8. `recorded_webinar` flow не сломан
9. OBS данные сохраняются при создании (уже работает)
10. Provider sync/recreate/detach работают (уже работает)