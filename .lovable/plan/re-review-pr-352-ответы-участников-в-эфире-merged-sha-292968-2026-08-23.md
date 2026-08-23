# Re-review PR #352 (ответы участников в эфире) — merged SHA 2929686f

## Вердикт: PASS (critical/high отсутствуют) — execute разрешён

Managed HEAD = `2929686fd8c61f3c1dd10733aea1245dff01f5fa` (merge PR #352, head `b575a261`), дерево чистое. Дельта относительно `c06306be`: 1 миграция, 3 UI-файла, 1 тест, `.lovable/plan.md`. Edge Functions не затронуты.

## Проверка прежних findings

| Прежний finding | Статус | Основание |
|---|---|---|
| CRITICAL-1 SELECT без проверки доступа к эфиру | ЗАКРЫТ | Старая политика удалена (`DROP POLICY IF EXISTS "Users can read visible replies"`), новая требует `user_has_live_event_access((SELECT auth.uid()), live_event_id)` для не-staff |
| CRITICAL-2 private не виден автору/staff | ЗАКРЫТ | USING содержит `created_by = auth.uid()`, `target_user_id = auth.uid()` и ветку `has_role_v2(auth.uid(),'employee')`; `employee` — umbrella-код для любой не-`user` роли, т.е. покрывает employee/admin/super_admin |
| HIGH-1 участник не может отвечать | ЗАКРЫТ | Staff-only INSERT-политика удалена, создана `Participants can create live event replies` для `authenticated` |
| HIGH-2 нет remove/mute в INSERT | ЗАКРЫТ | В WITH CHECK есть `NOT is_user_removed_from_room` и `NOT is_user_muted_in_room`; кроме того `user_has_live_event_access` сам содержит `AND NOT is_user_removed_from_room` |
| HIGH-3 target/source не связаны | ЗАКРЫТ | public ⇒ `target_user_id IS NULL`; private ⇒ `target_user_id = comment.user_id` / `question.user_id` того же `live_event_id`; ровно одна из веток source обязательна |
| MEDIUM-1 нет Realtime | ЗАКРЫТ | Идемпотентный `DO $$ ... ALTER PUBLICATION supabase_realtime ADD TABLE ...`, плюс `REPLICA IDENTITY FULL`; подписка в `useLiveEventReplies` с `filter: live_event_id=eq.*` и инвалидацией react-query (payload не рендерится, утечки через Realtime нет — доставка ограничена SELECT-RLS) |
| MEDIUM-2 UI: нет кнопки участнику, нет карточек/цитаты/автоскролла | ЗАКРЫТ | Кнопка «Ответить» вынесена из `LiveInlineModeration` в шапку сообщения для всех (`LiveEventComments.tsx` ~L426, `LiveEventQuestions.tsx` ~L375) с блокировкой при mute/removed и toast; `LiveEventReplyActivity` рендерит нижние карточки с `blockquote`-цитатой исходного текста; счётчик автоскролла включает `commentReplies.length` / `questionReplies.length` |

Совместимость с `Admins can manage replies` (ALL, `has_role_v2(...,'admin')`): политики одного типа объединяются через OR, поэтому админ сохраняет полный доступ, а новые политики не ослабляют его и не конфликтуют. Дублирующих INSERT/SELECT политик после DROP не остаётся.

## Оставшиеся findings

### MEDIUM-1 — staff-ветка SELECT не ограничена событием
`has_role_v2(auth.uid(),'employee')` в USING стоит вне проверки `user_has_live_event_access`, поэтому любой сотрудник читает ответы всех эфиров, включая приватные, даже без доступа к конкретному эфиру. Соответствует требованию «staff видят все», но шире, чем event-scope; зафиксировать осознанно.

### MEDIUM-2 — во вкладке «Вопросы» участник видит только свои вопросы
SELECT-политика `live_event_questions` — «Staff read all, users read own». Поэтому `questionTextById` у обычного участника содержит только его вопросы, и `questionReplies` отфильтровывает ответы на чужие вопросы. Публичный ответ на чужой вопрос обычному участнику не отобразится (данных исходного вопроса у него нет). Поведение вытекает из существующей модели вопросов, PR его не ухудшает.

### MEDIUM-3 — dead code
`LiveEventRepliesList` остался экспортирован, но нигде не импортируется после перехода на `LiveEventReplyActivity`.

### LOW — mobile
Шапка сообщения — `flex items-center gap-1.5 flex-wrap`; кнопка «Ответить» с `ml-auto` при узком экране переносится на следующую строку и не обрезается. Для staff в строке два `ml-auto`-блока (кнопка + inline-модерация) — визуально допустимо, требуется скриншот-подтверждение после Publish.

## Execute steps (после одобрения)

1. Подтвердить чистое дерево и exact managed HEAD `2929686f`; убедиться, что дельты в `supabase/functions/**` нет.
2. Baseline-снимок read-back #1–#3 (ниже) до применения.
3. Применить через Lovable Cloud ровно `supabase/migrations/20260823094017_participant_live_event_replies.sql`. Иных SQL/DDL/DML нет, Edge Functions не деплоятся.
4. Read-back #1–#6: ровно 3 политики (`Admins can manage replies` ALL, `Participants can create live event replies` INSERT, `Users can read visible replies` SELECT в новой редакции); `relreplident = 'f'`; `live_event_replies` в публикации ровно один раз; счётчики и `max(created_at)` по replies/comments/questions неизменны.
5. Тест-матрица A/B/staff/admin — только в транзакциях с `ROLLBACK` на завершённом/тестовом эфире; при отказе `SET ROLE` — статус UNVERIFIED, без догадок.
6. Publish frontend на SHA `2929686f`, затем два скриншота опубликованной комнаты (ПК и мобильный): кнопка «Ответить» у участника, нижняя карточка ответа с цитатой.
7. Повторный прогон security advisors.

## SQL read-back (без изменения данных)

```sql
-- 1
select policyname, cmd, roles, qual, with_check from pg_policies
where tablename = 'live_event_replies' order by policyname;
-- 2
select relrowsecurity, relreplident from pg_class where relname = 'live_event_replies';
-- 3
select 'replies' t, count(*), max(created_at) from live_event_replies
union all select 'comments', count(*), max(created_at) from live_event_comments
union all select 'questions', count(*), max(created_at) from live_event_questions;
-- 4
select count(*) from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' and tablename='live_event_replies';
-- 5
select count(*) filter (where source_comment_id is null and source_question_id is null) orphan,
       count(*) filter (where source_comment_id is not null and source_question_id is not null) double_source,
       count(*) filter (where visibility_scope='private' and target_user_id is null) private_no_target,
       count(*) filter (where visibility_scope='public' and target_user_id is not null) public_with_target
from live_event_replies;
-- 6
select md5(pg_get_functiondef(p.oid)), p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('has_role_v2','user_has_live_event_access','is_user_removed_from_room','is_user_muted_in_room');
```

## Тестовая матрица (транзакция + ROLLBACK)

| # | Актор | Действие | Ожидание |
|---|---|---|---|
| 1 | Participant A | public reply на комментарий своего эфира, `target_user_id IS NULL` | OK |
| 2 | Participant A | public reply с непустым `target_user_id` | 42501 |
| 3 | Participant A | private reply с `target_user_id` = автор исходного сообщения | OK |
| 4 | Participant A | private reply с чужим `target_user_id` | 42501 |
| 5 | Participant A | reply с `source_comment_id` из другого эфира | 42501 |
| 6 | Participant A (muted) / (removed) | любой reply | 42501 |
| 7 | Participant A | reply с `created_by` ≠ своего uid | 42501 |
| 8 | Participant B (с доступом) | SELECT public reply A | видит |
| 9 | Participant B | SELECT private reply A→C | не видит |
| 10 | Participant C (адресат) | SELECT private reply A→C | видит |
| 11 | Participant A (автор) | SELECT собственного private reply | видит |
| 12 | Пользователь без доступа / removed | SELECT реплаев эфира | 0 строк |
| 13 | Staff (employee) | SELECT public+private реплаев | видит все |
| 14 | Staff (muted/removed) | INSERT reply | 42501 |
| 15 | Admin | SELECT/INSERT/UPDATE/DELETE | полный доступ |
| 16 | Любой не-admin | UPDATE/DELETE чужого reply | 0 строк затронуто |

## Rollback

```sql
DROP POLICY IF EXISTS "Participants can create live event replies" ON public.live_event_replies;
DROP POLICY IF EXISTS "Users can read visible replies" ON public.live_event_replies;

CREATE POLICY "Staff can create live event replies" ON public.live_event_replies
FOR INSERT TO authenticated WITH CHECK (
  created_by = (SELECT auth.uid())
  AND has_role_v2((SELECT auth.uid()), 'employee')
  AND user_has_live_event_access((SELECT auth.uid()), live_event_id)
  AND (
    (source_comment_id IS NOT NULL AND EXISTS (SELECT 1 FROM live_event_comments c
       WHERE c.id = live_event_replies.source_comment_id AND c.live_event_id = live_event_replies.live_event_id))
    OR (source_question_id IS NOT NULL AND EXISTS (SELECT 1 FROM live_event_questions q
       WHERE q.id = live_event_replies.source_question_id AND q.live_event_id = live_event_replies.live_event_id))
  ));

CREATE POLICY "Users can read visible replies" ON public.live_event_replies
FOR SELECT TO authenticated
USING (visibility_scope = 'public' OR target_user_id = auth.uid());

ALTER PUBLICATION supabase_realtime DROP TABLE public.live_event_replies;
ALTER TABLE public.live_event_replies REPLICA IDENTITY DEFAULT;
```

Frontend-откат: Publish предыдущего SHA `c06306be`. DML в откате отсутствует, данные не меняются ни при применении, ни при откате.
