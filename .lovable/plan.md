да, согласен, с учетом правок:

&nbsp;

1. PATCH 1 — video fix  

  - Не хардкодить live URL в клиенте. LiveEvent.tsx должен получать уже готовый resolved_source из live-resolve и рендерить только его.
  - В resolved_source вернуть полный контракт:  

    - resolved_source_kind
    - resolved_embed_url
    - resolved_play_url
    - provider_source_status
    - source_reason
    - last_synced_at
    - provider_payload_snapshot
  - &nbsp;
  - В debug-блоке админки показать именно этот финальный resolved payload, а не набор разрозненных полей.
  - После Запустить эфир и после Обновить источник делать принудительный refresh source state, чтобы UI не жил на stale metadata.
2. &nbsp;
3. PATCH 2 — names snapshot  

  - Snapshot имени и аватара фиксировать на backend для обоих путей создания: comment и question.
  - Приоритет имени закрепить жёстко:  

    - full_name
    - first_name + last_name
    - masked email
    - Пользователь
  - &nbsp;
  - В UI legacy fallback тоже должен идти в том же порядке.
  - Если есть avatar_url, писать author_avatar_url snapshot сразу.
4. &nbsp;
5. PATCH 3 — replies  

  - Оставить два FK: source_comment_id и source_question_id с CHECK (num_nonnulls(...) = 1) — это правильно.
  - Добавить ещё:  

    - индекс по (source_comment_id)
    - индекс по (source_question_id)
  - &nbsp;
  - В reply model явно хранить visibility_scope, target_user_id, target_display_name.
  - В room UI private reply должен иметь отдельный визуальный маркер, а в projection и CRM — отдельный privacy flag.
6. &nbsp;
7. PATCH 4 — moderation  

  - Убрать UNIQUE (live_event_id, user_id, created_at) как бессмысленный защитный constraint. Нужен просто индекс по (live_event_id, user_id, created_at desc).
  - Moderation должна быть server-enforced в трёх местах:  

    - user_has_live_event_access / overlay
    - live-resolve
    - RLS/insert path для comments/questions
  - &nbsp;
  - Добавить controlled state на /live/:slug: пользователь удалён из комнаты.
  - Добавить runtime re-check/refresh, чтобы уже открытая комната не оставалась доступной после remove.
8. &nbsp;
9. PATCH 5 — сценарий  

  - Делать только как server-side projection / RPC, без client-side merge.
  - В projection сразу заложить фильтры:  

    - by entry_type
    - by user_id
    - by visibility_scope
  - &nbsp;
  - admin_notes не добавлять без доказанного use-case. Сначала unified timeline из уже существующих сущностей.
10. &nbsp;
11. PATCH 6 — CRM sync  

  - Связь с CRM — только через domain_events → consumer → domain_executions.
  - Никаких direct writes из UI и никаких связей по email/title/slug.
  - Contact resolution только по UUID-связи пользователя/контакта, существующей в системе.
  - Для crm_activity_log нужен явный idempotency key и proof, что дубли не создаются.
  - Private replies/private moderation events должны сохранять visibility_scope и не становиться публичными в CRM timeline.
12. &nbsp;
13. PATCH 7 — room blocks  

  - В main sprint включить только:  

    - button
    - banner
  - &nbsp;
  - form делать только если discovery докажет прямой reuse существующего CRM form flow без новой ad-hoc логики. Иначе сразу унести в deferred.
  - Для button/banner обязательно логировать клики в audit_logs, а если это бизнес-событие — дополнительно в domain_events.
14. &nbsp;
15. PATCH 8–9 — admin UX / audit  

  - В админке добавить отдельные панели:  

    - source debug
    - moderation
    - scenario
    - room blocks
  - &nbsp;
  - Не смешивать:  

    - audit_logs
    - domain_events
    - domain_executions
  - &nbsp;
  - В финальном proof показать по одному реальному примеру записи из каждого контура.
16. &nbsp;
17. Обязательный discovery request перед execute  

  - Подрядчик до execute обязан приложить:  

    - DDL текущих таблиц
    - все RLS/policies
    - definition user_has_live_event_access
    - runtime payload live-resolve для:  

      - одного live_stream
      - одного recorded_webinar
    - &nbsp;
    - список reusable компонентов/flows:  

      - player
      - site-form-submit / CRM form pipeline
      - domain event consumer pattern
      - existing activity/timeline UI
    - &nbsp;
    - justification по каждой новой сущности:  

      - почему reuse недостаточен
      - SoT
      - writers/readers
    - &nbsp;
  - &nbsp;
  - Без этого execute не начинать.
18. &nbsp;
19. Regression-proof обязателен отдельным блоком  

  - recorded_webinar
  - replay
  - /live/:slug как единый маршрут
  - user_has_live_event_access
  - comments/questions RLS
  - notification guardrails  
  Всё это должно быть отдельным proof-разделом, а не размазано по narrative.
20. &nbsp;
21. Machine-check proof обязателен  

  - SQL row examples:  

    - live_event_replies
    - live_event_room_moderation
    - live_event_room_blocks
    - crm_activity_log
  - &nbsp;
  - пример domain_events
  - пример domain_executions
  - пример audit_logs
  - пример результата is_user_removed_from_room()
  - пример resolved_source payload
  - proof, что все новые связи идут по UUID
22. &nbsp;
23. Что не ломать  

  - Отдельно зафиксировать как stop-condition:  

    - recorded_webinar flow
    - replay flow
    - existing access rules
    - current comments/questions access
    - notification guardrails
    - /live/:slug как единый маршрут  
    При любом регрессе по этим зонам execute не принимать.
  - &nbsp;
24. &nbsp;
25. Порядок выполнения  

  - Сначала:  

    - discovery package
    - schema/RLS/RPC
    - video fix
    - names
    - replies
    - moderation
  - &nbsp;
  - Потом:  

    - scenario
    - CRM consumer
    - room blocks
    - admin UX/audit
  - &nbsp;
  - В конце:  

    - regression proof
    - machine-check proof
  - &nbsp;
26. &nbsp;

&nbsp;

&nbsp;

В остальном план сильный и логичный: root cause по видео и именам уже подтверждён, новые сущности обоснованы, а main risk теперь — не в scope, а в дисциплине исполнения и доказуемом proof.

&nbsp;

# План: Webinar Room Stabilization + Engagement + CRM Sync

---

## Этап 0 — Discovery Report (завершён)

### Подтверждённые root causes

**1. Видео не отображается**

- `LiveEvent.tsx:344`: рендер плеера только при `data?.kinescope_video_id`
- Из 4 эфиров в БД: 3 — `live_stream` с `kinescope_live_event_id`, из них 2 имеют `kinescope_video_id = null`
- `useKinescopePlayer` принимает `videoId` и строит URL `https://kinescope.io/{videoId}` — для live embed нужен другой URL формат
- **Root cause**: нет единого resolver'а источника; UI напрямую проверяет `kinescope_video_id`

**2. Имена = "Пользователь"**

- `LiveEventComments.tsx:41-44` и `LiveEventQuestions.tsx:41-44` запрашивают `first_name, last_name`
- В реальных профилях `first_name`/`last_name` часто `null`, заполнен `full_name`
- Пример: `Лебецкая Анастасия` — `full_name` заполнен, `first_name`/`last_name` = null
- **Root cause**: UI берёт не то поле

**3. Отсутствующие сущности** (подтверждено SQL):

- `live_event_replies` — не существует
- `live_event_room_moderation` — не существует
- `live_event_room_blocks` — не существует
- CRM activity/timeline table — не существует (нет ни одной таблицы `%activity%`, `%timeline%`, `%crm%`)

### Существующие reusable сущности


| Сущность                              | Статус                                  | Reuse                          |
| ------------------------------------- | --------------------------------------- | ------------------------------ |
| `domain_events` + `domain_executions` | Существует                              | Полный reuse                   |
| `audit_logs`                          | Существует                              | Полный reuse                   |
| `user_has_live_event_access` RPC      | Существует                              | Расширить overlay              |
| `has_role_v2` RPC                     | Существует                              | Reuse для RLS                  |
| `useKinescopePlayer` hook             | Существует                              | Reuse, добавить live embed URL |
| `site-form-submit` edge function      | Существует (633 строки)                 | Reference для form reuse       |
| `FormSection.tsx`                     | Существует                              | Reference для form blocks      |
| `DomainEventService`                  | Существует (`src/lib/domain-events.ts`) | Полный reuse                   |
| `kinescope-api` edge function         | Существует                              | Reuse для source status        |
| `live-resolve` edge function          | Существует                              | Расширить resolved_source      |


### DDL текущих таблиц

**live_event_comments**: `id uuid pk, live_event_id uuid, user_id uuid, content text, created_at, updated_at` — нет `author_display_name`, нет `metadata`

**live_event_questions**: `id uuid pk, live_event_id uuid, user_id uuid, content text, is_answered bool, created_at, updated_at` — нет `author_display_name`, нет `metadata`

**live_events**: 23 колонки, включая `kinescope_video_id`, `kinescope_live_event_id`, `event_type`, `source_kind`, `platform_status`

### RLS/RPC

- `user_has_live_event_access`: проверяет admin role, subscriptions, entitlements, live_access_proofs — **нет moderation overlay**
- Comments RLS: INSERT через `auth.uid() = user_id AND user_has_live_event_access(...)`, SELECT через `user_has_live_event_access(...)`
- Questions RLS: аналогично comments + admin UPDATE/DELETE

### Justification новых сущностей


| Таблица                      | Почему reuse невозможен                                             | SoT                                 | Читатели / Писатели                          |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| `live_event_replies`         | Нет reply-модели нигде                                              | Ответы админа на comments/questions | Room UI, Scenario RPC, CRM consumer          |
| `live_event_room_moderation` | Модерация telegram/subscriptions — другой scope (product, не event) | Event-scoped membership state       | `user_has_live_event_access`, Room UI, Audit |
| `live_event_room_blocks`     | `site_page_blocks` привязаны к page, нет event scope                | CTA/banner config per event         | Room UI renderer, Admin editor               |
| `crm_activity_log`           | Нет ни одной activity/timeline таблицы в системе                    | CRM customer timeline               | Contact card UI, Admin                       |


---

## Этап 1 — Schema migrations

### Migration 1: Extend comments + questions

```sql
ALTER TABLE live_event_comments
  ADD COLUMN IF NOT EXISTS author_display_name text,
  ADD COLUMN IF NOT EXISTS author_avatar_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

ALTER TABLE live_event_questions
  ADD COLUMN IF NOT EXISTS author_display_name text,
  ADD COLUMN IF NOT EXISTS author_avatar_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';
```

### Migration 2: live_event_replies

```sql
CREATE TABLE public.live_event_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT ('rep_' || gen_random_uuid()),
  live_event_id uuid NOT NULL REFERENCES live_events(id) ON DELETE CASCADE,
  source_comment_id uuid REFERENCES live_event_comments(id) ON DELETE CASCADE,
  source_question_id uuid REFERENCES live_event_questions(id) ON DELETE CASCADE,
  target_user_id uuid,
  target_display_name text,
  reply_text text NOT NULL,
  visibility_scope text NOT NULL CHECK (visibility_scope IN ('public','private')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  metadata jsonb DEFAULT '{}',
  CONSTRAINT exactly_one_source CHECK (num_nonnulls(source_comment_id, source_question_id) = 1)
);

CREATE INDEX idx_replies_event_created ON live_event_replies(live_event_id, created_at DESC);
CREATE INDEX idx_replies_target ON live_event_replies(target_user_id, live_event_id);

ALTER TABLE live_event_replies ENABLE ROW LEVEL SECURITY;
-- admin full access
-- user sees public + private where target_user_id = auth.uid()
```

### Migration 3: live_event_room_moderation

```sql
CREATE TABLE public.live_event_room_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT ('mod_' || gen_random_uuid()),
  live_event_id uuid NOT NULL REFERENCES live_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('removed','banned','restored')),
  reason text,
  expires_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  metadata jsonb DEFAULT '{}',
  CONSTRAINT unique_latest UNIQUE (live_event_id, user_id, created_at)
);

CREATE INDEX idx_moderation_event_user ON live_event_room_moderation(live_event_id, user_id, created_at DESC);
```

### Migration 4: RPC is_user_removed_from_room

```sql
CREATE OR REPLACE FUNCTION public.is_user_removed_from_room(_user_id uuid, _live_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT action_type IN ('removed','banned')
     FROM live_event_room_moderation
     WHERE user_id = _user_id AND live_event_id = _live_event_id
     ORDER BY created_at DESC LIMIT 1),
    false
  )
$$;
```

### Migration 5: Расширить user_has_live_event_access — moderation overlay

Добавить в конец функции: `AND NOT is_user_removed_from_room(_user_id, _live_event_id)`

### Migration 6: Обновить RLS для comments/questions INSERT — добавить moderation check

```sql
-- Drop and recreate INSERT policies adding moderation overlay
DROP POLICY IF EXISTS "Users with access can insert own comments" ON live_event_comments;
CREATE POLICY "Users with access can insert own comments" ON live_event_comments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
    AND user_has_live_event_access(auth.uid(), live_event_id)
    AND NOT is_user_removed_from_room(auth.uid(), live_event_id));
-- Same for questions
```

### Migration 7: live_event_room_blocks

```sql
CREATE TABLE public.live_event_room_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT ('blk_' || gen_random_uuid()),
  live_event_id uuid NOT NULL REFERENCES live_events(id) ON DELETE CASCADE,
  block_type text NOT NULL CHECK (block_type IN ('button','banner','form')),
  display_scope text NOT NULL CHECK (display_scope IN ('always','live_only','replay_only')),
  position text NOT NULL CHECK (position IN ('under_video','sidebar','sticky')),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid,
  metadata jsonb DEFAULT '{}'
);
```

### Migration 8: crm_activity_log

```sql
CREATE TABLE public.crm_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT ('act_' || gen_random_uuid()),
  contact_id uuid,
  user_id uuid NOT NULL,
  activity_type text NOT NULL,
  source_entity_id uuid NOT NULL,
  source_entity_type text NOT NULL,
  live_event_id uuid REFERENCES live_events(id),
  title_snapshot text,
  text_snapshot text,
  author_snapshot text,
  visibility_scope text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);
```

### Migration 9: Scenario RPC

```sql
CREATE OR REPLACE FUNCTION public.get_live_event_scenario(_live_event_id uuid)
RETURNS TABLE (
  entry_id uuid, entry_type text, user_id uuid,
  display_name text, entry_text text, visibility_scope text,
  created_at timestamptz, metadata jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, 'comment', c.user_id, c.author_display_name, c.content, NULL, c.created_at, c.metadata
  FROM live_event_comments c WHERE c.live_event_id = _live_event_id
  UNION ALL
  SELECT id, 'question', q.user_id, q.author_display_name, q.content, NULL, q.created_at, q.metadata
  FROM live_event_questions q WHERE q.live_event_id = _live_event_id
  UNION ALL
  SELECT id, 'reply', r.created_by, NULL, r.reply_text, r.visibility_scope, r.created_at, r.metadata
  FROM live_event_replies r WHERE r.live_event_id = _live_event_id
  UNION ALL
  SELECT id, 'moderation', m.created_by, NULL, m.action_type || ': ' || COALESCE(m.reason,''), NULL, m.created_at, m.metadata
  FROM live_event_room_moderation m WHERE m.live_event_id = _live_event_id
  ORDER BY created_at
$$;
```

---

## Этап 2 — PATCH 1: Video fix

### Файлы

1. `**supabase/functions/live-resolve/index.ts**` — добавить `resolved_source` объект в response:
  - Логика: если `kinescope_video_id` → `{source_kind: 'kinescope_video', embed_url: 'https://kinescope.io/embed/{id}'}`;
   если `kinescope_live_event_id` → `{source_kind: 'kinescope_live_embed', embed_url: 'https://kinescope.io/embed/live/{id}'}`;
   иначе → `{source_kind: 'none', source_reason: '...'}`
  - Не ломает existing response contract — add-only поле
2. `**src/pages/LiveEvent.tsx**` — заменить `data?.kinescope_video_id` check на `data?.resolved_source?.embed_url`:
  - `KinescopePlayerWrapper` принимает `embedUrl` вместо `videoId`
  - При `source_kind === 'none'` показывать controlled error state
  - Для `kinescope_live_embed` использовать iframe напрямую (не IframePlayer SDK, т.к. live embed может не поддерживаться через SDK)
3. `**src/pages/admin/AdminLiveEvents.tsx**` — добавить source debug block в карточке эфира:
  - provider_source_status, resolved_source_kind, embed_url, stream status

### Что не меняется

- `useKinescopePlayer` — продолжает работать для recorded_webinar/replay через `kinescope_video_id`
- Replay flow — не затрагивается
- `recorded_webinar` — не затрагивается (у него `kinescope_video_id` есть)

---

## Этап 3 — PATCH 2: Names snapshot

### Файлы

1. **DB trigger** (migration): `BEFORE INSERT` на `live_event_comments` и `live_event_questions` — snapshot автора:
  ```sql
   NEW.author_display_name = COALESCE(
     (SELECT full_name FROM profiles WHERE id = NEW.user_id),
     (SELECT CONCAT_WS(' ', first_name, last_name) FROM profiles WHERE id = NEW.user_id),
     'Пользователь'
   );
  ```
2. `**src/components/live/LiveEventComments.tsx**` — select добавить `author_display_name`; использовать его; fallback по `full_name` для legacy
3. `**src/components/live/LiveEventQuestions.tsx**` — аналогично

### Priority chain

`author_display_name` (snapshot) → `profiles.full_name` → `first_name + last_name` → masked email → 'Пользователь'

---

## Этап 4 — PATCH 3: Replies

### Файлы

1. **Новый компонент** `src/components/live/LiveEventReplies.tsx` — рендер replies inline под comment/question
2. `**src/components/live/LiveEventComments.tsx**` — добавить отображение replies под каждым comment; кнопка "Ответить" для admin
3. `**src/components/live/LiveEventQuestions.tsx**` — аналогично
4. `**src/pages/admin/AdminLiveEvents.tsx**` — reply form с выбором public/private

---

## Этап 5 — PATCH 4: Room moderation

### Файлы

1. **RLS** для `live_event_room_moderation` — admin write, admin read
2. `**src/pages/admin/AdminLiveEvents.tsx**` — moderation panel: remove, restore, список удалённых
3. `**supabase/functions/live-resolve/index.ts**` — проверка `is_user_removed_from_room` перед access_granted

### Server enforcement

- `user_has_live_event_access` RPC расширен overlay
- INSERT policies для comments/questions расширены
- `live-resolve` проверяет moderation state

---

## Этап 6 — PATCH 5: Scenario projection

### Файлы

1. `**src/pages/admin/AdminLiveEvents.tsx**` — новая вкладка "Сценарий" с вызовом `get_live_event_scenario` RPC
2. Фильтры по `entry_type`, по `user_id`

---

## Этап 7 — PATCH 6: CRM activity через domain events

### Файлы

1. **DB triggers** на `live_event_comments`, `live_event_questions`, `live_event_replies`, `live_event_room_moderation` — INSERT trigger → `domain_events`
2. **Новый edge function** `supabase/functions/webinar-activity-consumer/index.ts`:
  - Reads domain_event → resolves contact by user_id → INSERT `crm_activity_log` с `idempotency_key = '{event_type}:{source_entity_id}'`
  - Writes `domain_executions`
3. **Privacy**: `visibility_scope` сохраняется в `crm_activity_log`; private записи видны только admin в CRM

---

## Этап 8 — PATCH 7: Room blocks (button + banner only)

### Файлы

1. **RLS** для `live_event_room_blocks` — admin CRUD, authenticated SELECT
2. `**src/pages/admin/AdminLiveEvents.tsx**` — room blocks editor
3. `**src/pages/LiveEvent.tsx**` — renderer: button/banner по `display_scope` и `position`
4. **Form**: только если `site-form-submit` pipeline reuse доказан минимальными изменениями. Иначе → deferred.

---

## Этап 9 — PATCH 8-9: Admin UX + Audit

### Файлы

1. Admin source debug block
2. Moderation panel shortcuts
3. `audit_logs` записи для: reply created, user removed/restored, CTA clicked
4. `domain_events` для cross-domain (отдельно от audit)
5. `domain_executions` для downstream tracking (отдельно от audit)

---

## Regression Proof (обязательный)


| Проверка                                      | Метод                                                 |
| --------------------------------------------- | ----------------------------------------------------- |
| `recorded_webinar` открывается                | `/live/:slug` для `event_type=recorded_webinar`       |
| Replay работает                               | `/live/:slug` для `platform_status=replay_available`  |
| `user_has_live_event_access` не сломан        | SQL: function definition diff                         |
| Comments/Questions RLS расширены, не заменены | `pg_policies` diff — только add overlay               |
| Notification guardrails не затронуты          | Code diff: `live-event-notifications-cron` не изменён |


## Machine-check Proof (обязательный)

- SQL row по каждой новой таблице
- Пример `domain_events` row
- Пример `domain_executions` row
- Пример `audit_logs` row
- Пример `crm_activity_log` row
- Пример `is_user_removed_from_room()` result
- Пример `resolved_source` payload из `live-resolve`

## Deferred / Follow-up

- Export сценария CSV/DOCX
- FAQ / important / reuse-next-webinar labels
- Backfill старых comments/questions author_display_name
- Full form-builder для room blocks
- `live_event_admin_notes` (если projection без notes окажется недостаточной)
- UX polish