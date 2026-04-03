# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 0 сделать отдельным обязательным blocker-gate до всех proof по live/events/comments.**
  Добавь явное правило: пока не получен runtime-proof стабильной сессии 10–15 минут в preview и production-like сценарии, PATCH 2–6 не считаются закрытыми. Иначе все дальнейшие proof по эфирам недостоверны.
2. **Не объединять в одном UI live_stream и recorded_webinar без явного первого шага выбора типа и без отдельной terminology-matrix.**
  Добавь в план обязательный UX-блок:
  &nbsp;
  - Живой эфир — онлайн-трансляция в реальном времени;
  - Эфир в записи / Автовебинар — готовое видео;
  - везде в admin, user menu, шаблонах приглашений и summary использовать только эти человекочитаемые названия;
  - не показывать технические event_type, source_kind, provider status пользователю.
  &nbsp;
3. **PATCH 1 дополнить no-loss mapping 1:1 для уже существующих полей.**
  Явно зафиксируй mapping:
  &nbsp;
  - старый status → новый platform_status;
  - старый kinescope_video_id сохраняется как есть;
  - старый recorded flow продолжает работать без миграции UI/URL;
  - event_type='recorded_webinar', source_kind='kinescope_video', event_timezone='Europe/Minsk' назначаются всем legacy-записям автоматически;
  - ничего из старых invite/session/access flows не ломается.
  &nbsp;
4. **Для комментариев и вопросов нужен отдельный secure access layer, а не дублирование логики доступа в нескольких местах.**
  Добавь обязательный PATCH:
  &nbsp;
  - один канонический SQL/RPC helper user_has_live_event_access;
  - его используют RLS для comments/questions, live-events-list, live-resolve, любые будущие выборки по эфирам;
  - запрет на параллельные client-side проверки как источник истины.
  &nbsp;
5. **RLS для comments/questions нужно уточнить по update/delete.**
  Сейчас описаны SELECT/INSERT/DELETE для admin. Добавь:
  &nbsp;
  - user может редактировать только свой комментарий/вопрос в ограниченное окно времени либо вообще не может — выбрать один вариант явно;
  - admin delete/comment moderation — обязательно;
  - обычный пользователь не может удалять чужие сообщения;
  - audit на delete/moderation обязателен.
  &nbsp;
6. **PATCH 2 по Kinescope Live API усилить доказуемым discovery gate перед полноценной реализацией create/update lifecycle.**
  Добавь подпункты:
  &nbsp;
  - доказать реальным вызовом create_live_event на подключённом instance;
  - доказать exact response payload и какие поля сохраняются в БД;
  - доказать, чем именно плеер должен открывать live: live_event_id, stream_id, отдельный playback/video source;
  - доказать post-live replay source после complete;
  - только после этого финализировать поля kinescope_live_event_id / kinescope_stream_id / возможный kinescope_replay_video_id.
    Иначе есть риск заложить неверную модель.
  &nbsp;
7. **Добавить отдельный PATCH на provider sync, а не только ручные admin actions.**
  Помимо кнопок Создать / Запустить / Завершить / Обновить статус, нужен add-only блок:
  &nbsp;
  - sync_live_event_from_provider — подтягивает provider status и replay availability;
  - dry-run / execute режим не нужен для UI, но нужен доказуемый sync result;
  - status provider хранить отдельно в metadata или provider_status, не смешивать с platform_status.
  &nbsp;
8. **PATCH 3: kinescope_project_id сделать обязательным только для live_stream, но не для recorded_webinar manual fallback.**
  Это нужно явно прописать, чтобы не сломать существующий recorded flow:
  &nbsp;
  - live_stream: project обязателен;
  - recorded_webinar с picker: project желателен/используется;
  - recorded_webinar manual fallback: project не обязателен.
  &nbsp;
9. **PATCH 3 дополнить явным publish/invite readiness matrix по обоим типам.**
  Сейчас это есть в тексте, но нужно зафиксировать как таблицу DoD/UI:
  &nbsp;
  - что нужно для save draft;
  - что нужно для publish;
  - что нужно для invite_ready;
  - что является blocker, а что warning.
    И именно эта матрица должна отображаться в readiness panel.
  &nbsp;
10. **PATCH 4 user section “Эфиры” должен быть не просто списком, а целевой точкой входа для приглашённых пользователей.**
  Добавь:
  &nbsp;
  - карточка эфира показывает обложку, тип, статус, время, кнопку входа;
  - если эфир скоро начнётся — отдельный badge/CTA;
  - если нет доступа — эфир не показывается вообще через secure resolver;
  - если доступ есть, но invite required — карточка показывает понятный статус без утечки лишних данных.
  &nbsp;
11. **PATCH 4 нужен отдельный proof по secure resolver.**
  Обязательные сценарии:
  &nbsp;
  - пользователь с доступом видит эфир в /live;
  - пользователь без доступа не видит;
  - user menu работает только через backend resolver, не client-side filtering;
  - время отображается в timezone пользователя, а source timezone подписан отдельно.
  &nbsp;
12. **PATCH 5 разделить на три визуальных блока на странице эфира:**
  &nbsp;
  - player / scheduled banner;
  - comments;
  - questions.
    И добавить в план, что comments/questions не должны ломать live-session/heartbeat flow.
    То есть heartbeat и access gate продолжают работать независимо от realtime-комментариев.
  &nbsp;
13. **Нужно явно зафиксировать reuse existing knowledge-base player UX как обязательный design source.**
  Добавь:
  &nbsp;
  - не создавать второй альтернативный player UI;
  - wrapper для live/replay должен использовать уже рабочую визуальную модель платформы;
  - Kinescope side UI наружу не показывать;
  - страница эфира внутри платформы выглядит как собственный продукт.
  &nbsp;
14. **Комментарии и вопросы сразу готовить под sales/analytics.**
  Добавь обязательные поля/связи:
  &nbsp;
  - user_id;
  - join к profiles;
  - created_at;
  - связь с live_event_id;
  - возможность в будущем связать активность с CRM/contact.
    В текущем спринте достаточно правильной модели данных и audit, но это нужно явно зафиксировать как DoD по schema.
  &nbsp;
15. **BroadcastTemplateDialog нужно дополнить не только badges, но и явной причиной, почему эфир нельзя выбрать для приглашения.**
  В требования добавить:
  &nbsp;
  - disabled item с readable reason;
  - CTA “Открыть эфиры”;
  - live_stream и recorded_webinar различаются в copy;
  - invite_ready определяется по readiness matrix из PATCH 3, а не по локальной логике компонента.
  &nbsp;
16. **Timezone-часть перенести из “nice to have” в обязательный scope текущего спринта.**
  Добавь explicit requirement:
  &nbsp;
  - event_timezone обязательна для live_stream;
  - отображение времени в user section и на странице эфира — обязательное;
  - шаблонные переменные времени пока можно оставить scope marker, но backend/model должны быть готовы уже сейчас.
  &nbsp;
17. **Нужен отдельный PATCH на unified /live/:slug lifecycle без смены ссылок.**
  Явно зафиксируй:
  &nbsp;
  - одна и та же платформенная ссылка живёт для scheduled/live/replay;
  - приглашения не пересоздаются из-за смены стадии эфира;
  - после завершения live_stream этот же slug открывает replay;
  - не создаются дублирующие сущности/роуты для replay.
  &nbsp;
18. **Финальный smoke-test расширить до полного proof-first пакета.**
  Добавь обязательные сценарии:
  &nbsp;
  - admin создаёт recorded_webinar без регрессии старого flow;
  - admin создаёт live_stream через Kinescope API v2;
  - live_stream появляется в admin и user section;
  - пользователь с доступом открывает эфир;
  - пользователь без доступа не открывает;
  - пользователь пишет комментарий;
  - пользователь задаёт вопрос;
  - после завершения live_stream тот же /live/:slug показывает replay;
  - приглашение можно создать без тупика в BroadcastTemplateDialog;
  - auth стабилен 10–15 минут во время просмотра и отправки комментариев/вопросов.
  &nbsp;
19. **Добавить явный список того, что переносится в follow-up и не блокирует approve текущего спринта.**
  Чтобы подрядчик не растягивал scope:
  &nbsp;
  - advanced moderation;
  - CRM scoring/integration;
  - webhook automation provider events;
  - расширенная аналитика эфиров;
  - host-side deep automation beyond proven Kinescope API scope.
    Всё это пометить как backlog, если нет новых доказанных API-фактов.
  &nbsp;
20. **Итоговый consolidated plan должен оставаться add-only.**
  Добавь в начало плана блок:
  &nbsp;
  - current recorded webinar flow не удалять и не переписывать;
  - live_stream добавляется рядом;
  - reuse existing access/session/invite/player infrastructure максимально;
  - любые новые сущности и маршруты не должны ломать старые recorded_webinar, live-resolve, useKinescopePlayer, BroadcastTemplateDialog, session heartbeat.
  &nbsp;

&nbsp;

&nbsp;

Спринт Live Events v2 — Consolidated Implementation Plan

## Текущее состояние

**Таблица `live_events**`: id, slug, title, description, kinescope_video_id, product_id, access_rule, status, is_published, scheduled_at, replay_enabled, metadata, invite_mode, direct_access_allowed. **Нет**: event_type, source_kind, event_timezone, kinescope_live_event_id, kinescope_project_id, kinescope_stream_id.

**Существующий recorded flow** полностью рабочий: Kinescope v1 picker, manual fallback, access rules, invite modes, slug auto-gen, DateTimePicker, session displacement, heartbeat. Не трогаем.

**Компоненты для reuse**: `useKinescopePlayer` (v3), `TimezoneSelector` (payments), `DateTimePicker`, `KinescopePlayerWrapper` в LiveEvent.tsx.

---

## PATCH 0 — Auth/Session Stability (blocker-gate)

**Цель**: Устранить forced logout в preview/production. Без этого proof по остальным фазам недостоверен.

**Root-cause discovery**:

- Добавить structured logging в `AuthContext.tsx` для всех `onAuthStateChange` events (`INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`)
- На `SIGNED_OUT`: retry `getSession()` перед сбросом state (false positive от preview hot reload)
- Добавить `visibilitychange` listener: при возврате на вкладку — `getSession()` refresh
- Проверить, не вызывается ли `signOut()` при route remount в `ProtectedRoute`

**Файл**: `src/contexts/AuthContext.tsx`

**DoD**: пользователь работает 10–15 мин без forced logout, просмотр эфира + комментарий без потери сессии.

---

## PATCH 1 — Schema: event types + timezone + comments + questions

**Миграция**:

```sql
-- Event type and source separation
ALTER TABLE public.live_events
  ADD COLUMN event_type TEXT NOT NULL DEFAULT 'recorded_webinar',
  ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'kinescope_video',
  ADD COLUMN event_timezone TEXT NOT NULL DEFAULT 'Europe/Minsk',
  ADD COLUMN kinescope_live_event_id TEXT,
  ADD COLUMN kinescope_project_id TEXT,
  ADD COLUMN kinescope_stream_id TEXT,
  ADD COLUMN platform_status TEXT NOT NULL DEFAULT 'draft';

-- Comments
CREATE TABLE public.live_event_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lec_event ON public.live_event_comments(live_event_id);

-- Questions (separate entity for sales/analytics)
CREATE TABLE public.live_event_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id UUID NOT NULL REFERENCES public.live_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  is_answered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leq_event ON public.live_event_questions(live_event_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_questions;
```

**RLS**: Access-aware через RPC `user_has_live_event_access(user_id, live_event_id)` (security definer), не `USING (true)`.

- SELECT comments/questions: только пользователи с доступом к эфиру
- INSERT: auth.uid() = user_id AND has access
- DELETE: has_role_v2(auth.uid(), 'admin')

**Модель типов**:


| event_type         | source_kind            | Описание                                  |
| ------------------ | ---------------------- | ----------------------------------------- |
| `live_stream`      | `kinescope_live_event` | Живой эфир через Kinescope Live API v2    |
| `recorded_webinar` | `kinescope_video`      | Автовебинар через Kinescope Videos API v1 |


**Platform status (lifecycle)**: `draft` → `scheduled` → `live` → `ended` → `replay_available` → `archived`. Отдельно от provider status (хранится в metadata).

**No-loss migration**: все текущие записи → `event_type='recorded_webinar'`, `source_kind='kinescope_video'`, `platform_status` = текущий `status`.

**Readiness по типам**:


| Уровень        | live_stream                                                    | recorded_webinar                           |
| -------------- | -------------------------------------------------------------- | ------------------------------------------ |
| draft_saveable | title                                                          | title                                      |
| publish_ready  | + slug + kinescope_live_event_id + scheduled_at + access_rules | + slug + kinescope_video_id + access_rules |
| invite_ready   | + is_published + scheduled_at                                  | + is_published                             |


---

## PATCH 2 — Kinescope Live API v2 Integration

**Edge function** `kinescope-api/index.ts` — добавить v2 actions:


| Action                  | Endpoint                          | Назначение                   |
| ----------------------- | --------------------------------- | ---------------------------- |
| `create_live_event`     | POST /v2/live/events              | Создать live event в проекте |
| `get_live_event`        | GET /v2/live/events/{id}          | Получить event               |
| `enable_live_event`     | PUT /v2/live/events/{id}/enable   | Запустить                    |
| `complete_live_event`   | PUT /v2/live/events/{id}/complete | Завершить                    |
| `get_live_event_videos` | GET /v2/live/events/{id}/videos   | Записи после завершения      |


**Обязательный proof-gate**:

1. create_live_event → получить event_id
2. Доказать, что event_id → embed URL для player (формат?)
3. После complete → get_live_event_videos → подтвердить replay source
4. Зафиксировать exact mapping: какой ID нужен для live embed vs replay

**Файл**: `supabase/functions/kinescope-api/index.ts`

---

## PATCH 3 — Admin Create/Edit UX (два режима)

**Файл**: `src/pages/admin/AdminLiveEvents.tsx`

**Выбор типа при создании** (первый шаг формы):

- **Живой эфир** — онлайн-трансляция в реальном времени
- **Видео / Автовебинар** — готовое видео, показываемое как вебинар

**live_stream flow**:

1. Выбор проекта Kinescope (`kinescope_project_id` — first-class поле)
2. Кнопка «Создать живой эфир в Kinescope» → create_live_event → сохранить `kinescope_live_event_id`, `kinescope_project_id`
3. После создания: показать ID, статус, следующий шаг
4. `scheduled_at` обязателен + `TimezoneSelector` (reuse из payments)
5. Label: «Дата и время эфира (Минск, UTC+3)»

**recorded_webinar flow**: без изменений (текущий picker + manual fallback).

**Timezone**: `event_timezone` field, UTC storage, source tz display.

**Admin lifecycle actions** для live_stream:

- Кнопки: «Запустить эфир» (enable), «Завершить эфир» (complete), «Обновить статус» (refresh)
- Секция «Инструкция ведущему»: provider event id, stream details, ссылка на консоль Kinescope

**Readiness panel** — 3 группы, разные для live_stream и recorded_webinar. Blockers vs warnings.

**Кнопка «Опубликовать»** вместо switch (с блокерами под ней).

**CTA после сохранения**: toast + «Создать приглашение для этого эфира» если invite_ready.

**UX-тексты** без технических формулировок (см. предыдущие планы).

---

## PATCH 4 — User Section «Эфиры» + Secure List Resolver

**Backend resolver**: новая edge function `live-events-list`:

- Принимает JWT
- Возвращает только доступные пользователю эфиры (server-side access check, не client-side)
- Returns: id, slug, title, event_type, platform_status, scheduled_at, event_timezone, replay_enabled
- Время в source tz + user-local preview (из `profiles.timezone`, fallback = source tz + подпись)

**AppSidebar** (`src/components/layout/AppSidebar.tsx`):

```typescript
{ key: "live", title: "Эфиры", url: "/live", icon: Radio }
```

В `mainMenuItems` (пользовательское меню).

**Новая страница** `src/pages/LiveEvents.tsx`:

- Карточки эфиров с обложкой/названием/датой/статусом
- Badge: «Идёт сейчас» / «Запланирован» / «Запись»
- Тип: «Живой эфир» / «Видео»
- Дата в локальной зоне пользователя + подпись source tz
- Клик → `/live/{slug}`

**Routes** (`src/App.tsx`):

- `/live` — список (ProtectedRoute)
- `/live/:slug` — страница эфира (уже есть)

---

## PATCH 5 — Unified Player Page + Comments + Questions

`**src/pages/LiveEvent.tsx**` — расширение:

- source_kind resolution: `kinescope_live_event` → embed через live event ID; `kinescope_video` → текущий flow
- Reuse `useKinescopePlayer` и `KinescopePlayerWrapper` (не создавать второй player stack)
- Состояния: scheduled → live → ended → replay_available
- Одна постоянная ссылка `/live/:slug` на весь lifecycle (до/во время/после)
- Timezone: время в локальной зоне пользователя + source tz

`**live-resolve**` — расширить response: + event_type, source_kind, kinescope_live_event_id, event_timezone, platform_status

`**src/components/live/LiveEventComments.tsx**` — новый:

- Realtime через supabase channel
- author: profiles join (имя/аватар)
- Только для авторизованных с доступом к эфиру
- Admin delete + audit_logs
- user_id/profile linkage для sales-scoring

`**src/components/live/LiveEventQuestions.tsx**` — новый:

- Аналогичная модель, отдельный tab
- is_answered flag
- Минимум: таблица + базовый UI tab

---

## PATCH 6 — Invitation/Template Integration + Final Smoke Tests

`**BroadcastTemplateDialog.tsx**`:

- Убрать `.eq("is_published", true)` — загружать все эфиры
- Badge типа: «Живой эфир» / «Видео»
- Badge readiness с причиной недоступности:
  - «Черновик — сначала опубликуйте»
  - «Нет даты — задайте дату и время»
  - «Нет видео/источника — привяжите источник»
  - «Готов к приглашениям»
- Copy различается: live → «Живой эфир, начнётся …» / recorded → «Эфир в записи / доступен к просмотру»
- Disabled items с tooltip

**Переменные шаблонов** (scope marker):

- `{{live_event.time_source_timezone}}` — «04.04.2026 17:10 по Минску»
- `{{live_event.time_user_timezone}}` — локальное время получателя
- Source of truth: `profiles.timezone`, fallback = source tz + подпись

---

## Файлы (полный список)


| Файл                                                             | Действие                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/contexts/AuthContext.tsx`                                   | PATCH 0: auth stability                                                          |
| Миграция SQL                                                     | PATCH 1: event_type, source_kind, timezone, platform_status, comments, questions |
| `supabase/functions/kinescope-api/index.ts`                      | PATCH 2: v2/live endpoints                                                       |
| `src/pages/admin/AdminLiveEvents.tsx`                            | PATCH 3: два типа, timezone, lifecycle actions, readiness split                  |
| `supabase/functions/live-events-list/index.ts`                   | PATCH 4: новый secure resolver                                                   |
| `src/pages/LiveEvents.tsx`                                       | PATCH 4: новый user gallery                                                      |
| `src/components/layout/AppSidebar.tsx`                           | PATCH 4: пункт «Эфиры»                                                           |
| `src/App.tsx`                                                    | PATCH 4: route /live                                                             |
| `src/pages/LiveEvent.tsx`                                        | PATCH 5: source_kind support, comments/questions                                 |
| `src/components/live/LiveEventComments.tsx`                      | PATCH 5: новый                                                                   |
| `src/components/live/LiveEventQuestions.tsx`                     | PATCH 5: новый                                                                   |
| `supabase/functions/live-resolve/index.ts`                       | PATCH 5: расширить response                                                      |
| `src/components/admin/communication/BroadcastTemplateDialog.tsx` | PATCH 6: все эфиры + статусы                                                     |


## Что НЕ удаляется

- Текущий recorded flow (v1/videos picker, manual fallback)
- Access rules, invite modes, session displacement, heartbeat
- useKinescopePlayer, KinescopePlayerWrapper
- Все текущие edge functions
- Старые данные: `event_type='recorded_webinar'`, `source_kind='kinescope_video'` по умолчанию

## DoD (полный)

1. Auth: 10–15 мин стабильной работы без forced logout (PATCH 0 gate)
2. Два типа эфиров в одной таблице с раздельной readiness
3. live_stream: auto-create в Kinescope + proof embed source
4. recorded_webinar: без изменений
5. platform_status отделён от provider status
6. kinescope_project_id как first-class поле
7. event_timezone сохраняется и отображается (source tz + user local)
8. «Эфиры» в user menu, secure backend resolver
9. Единая страница /live/:slug для всего lifecycle (scheduled → live → replay)
10. Комментарии с access-aware RLS, realtime, profile linkage
11. Вопросы — таблица + базовый UI tab
12. BroadcastTemplateDialog: оба типа со статусами и причинами
13. Proof: live → replay end-to-end
14. Proof: admin создаёт recorded_webinar (без регрессии)
15. Proof: auth стабилен при просмотре + комментарии