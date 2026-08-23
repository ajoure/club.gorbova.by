# План: read-only ревизия PR #352 (ответы участников в эфире)

## Итог: BLOCKED — ревизия diff невозможна, execute запрещён

Головной SHA PR #352 `63543a3264ae24bafb262bbeeed0c5562f0fa8f0` недоступен из managed-зеркала:

- `git ls-remote origin` — HEAD зеркала ровно `c06306bed7afe42a0d2be3656202ff2022bd39a0` (совпадает с указанным production SHA);
- `git cat-file -t 63543a32...` — объект отсутствует; ветки PR #352 в зеркале нет;
- файл `supabase/migrations/20260823094017_participant_live_event_replies.sql` в дереве отсутствует (последняя миграция реплаев — `20260822093925_allow_staff_live_event_replies.sql`).

Поэтому ни миграцию из PR, ни UI-дельту `LiveEventReplies/Comments/Questions` подтвердить нельзя. Любое утверждение о содержимом PR было бы догадкой. Execute запрещён до того, как содержимое SHA станет доступно (merge в main зеркала либо предоставление diff/файла миграции в чат).

## Что подтверждено на текущем production (baseline, read-only)

Политики `public.live_event_replies` сейчас ровно 3:

1. `Admins can manage replies` — ALL, `has_role_v2(auth.uid(),'admin')` (qual и with_check).
2. `Staff can create live event replies` — INSERT, требует `created_by = auth.uid()`, роль `employee`, `user_has_live_event_access`, и что `source_comment_id`/`source_question_id` принадлежит тому же `live_event_id`.
3. `Users can read visible replies` — SELECT, `visibility_scope = 'public' OR target_user_id = auth.uid()`.

Колонки: `source_comment_id`, `source_question_id`, `target_user_id`, `target_display_name` — все NULLable; `visibility_scope`, `created_by`, `live_event_id` — NOT NULL.

Realtime-публикация `supabase_realtime` содержит `live_event_comments`, `live_event_questions`, `live_event_room_blocks`, `live_event_cta_runtime_events`, `live_event_reactions`, `live_event_comment_reactions` — **`live_event_replies` в публикации нет**.

## Findings на baseline (их PR обязан закрыть)

### CRITICAL-1 — SELECT-политика реплаев не проверяет доступ к эфиру
`Users can read visible replies` разрешает читать любой публичный reply любому авторизованному пользователю, вне зависимости от `user_has_live_event_access(auth.uid(), live_event_id)` и от `is_user_removed_from_room`. Это кросс-эфирная утечка контента. Требование «публичный ответ видят все участники **с доступом к эфиру**» сейчас не выполняется.

### CRITICAL-2 — приватный ответ не виден его автору и не виден staff
Условие `target_user_id = auth.uid()` не покрывает ни `created_by = auth.uid()`, ни роли `employee`/`super_admin`. Приватный ответ видит только адресат и `admin` (через политику ALL). Требование «private видят автор, адресат и весь staff/admin» не выполняется.

### HIGH-1 — участник не может ответить
INSERT разрешён только роли `employee` (и `admin` через ALL). Обычный участник получает 42501. Требование PR — INSERT для любого участника с доступом; при этом обязательны проверки `NOT is_user_removed_from_room` и `NOT is_user_muted_in_room` (в политиках comments/questions они есть, в reply-INSERT — отсутствуют, см. HIGH-2).

### HIGH-2 — в INSERT реплаев нет проверок remove/mute
Существующая INSERT-политика реплаев не содержит `NOT is_user_removed_from_room(...)` и `NOT is_user_muted_in_room(...)`, в отличие от `live_event_comments`/`live_event_questions`. Замьюченный/удалённый участник (или staff) сможет отвечать.

### HIGH-3 — приватность target_user_id не ограничена
Нет CHECK/политики, требующей `visibility_scope='private' ⇒ target_user_id IS NOT NULL` и что `target_user_id` — автор исходного comment/question. Иначе приватный ответ может быть адресован произвольному пользователю или «повиснуть» невидимым.

### MEDIUM-1 — Realtime для реплаев отсутствует
Без `ALTER PUBLICATION supabase_realtime ADD TABLE public.live_event_replies` новые ответы не приезжают в ленту в реальном времени; UI (`LiveEventRepliesList`) сейчас работает только на react-query без подписки и без инвалидции от чужих вставок. Даже после добавления в публикацию Realtime отдаёт строки только в пределах SELECT-RLS — то есть private-ответы корректно не утекут, но потребуется `REPLICA IDENTITY FULL` для корректной работы фильтров/DELETE.

### MEDIUM-2 — UI не даёт участнику отвечать и не гарантирует автоскролл ответов
- `LiveEventQuestions.tsx`: форма ответа рендерится под `isStaff` (строка ~376), участнику недоступна.
- `LiveEventComments.tsx`: `onReply` приходит из `LiveInlineModeration`, которая целиком возвращает `null` для не-staff — значит кнопки «Ответить» у участника нет.
- `LiveEventReplies.tsx`: `LiveEventRepliesList` рендерит ответы вложенным блоком `ml-6` под сообщением, а не «новой карточкой внизу ленты с цитатой». Автоскролл в обоих списках завязан на массив `comments`/`questions`, появление нового reply скролл не триггерит.
- `LiveEventReplyForm` жёстко ставит `created_by: user.id` и позволяет выбрать `private` без `target_user_id` (если он не передан) — сочетается с HIGH-3.

Итого: **critical/high присутствуют на baseline ⇒ execute запрещён**, пока PR не будет прочитан и не подтверждено, что каждый пункт закрыт.

## Как разблокировать ревизию

1. Смержить PR #352 в main зеркала (или дать доступ к SHA `63543a32`), либо прислать в чат содержимое `supabase/migrations/20260823094017_participant_live_event_replies.sql` и diff трёх UI-файлов.
2. После этого — повторная plan-only ревизия: проверка порядка политик (в PostgreSQL политики одного командного типа объединяются через OR, поэтому старая `Users can read visible replies` обязана быть **DROP**, иначе новая, более строгая SELECT-политика её не ограничит — это ключевая проверка миграции), наличие DROP старых политик, CHECK-констрейнтов и публикации Realtime.

## Безопасный execute-план (только после разблокировки и полного PASS)

1. Подтвердить чистое дерево и exact managed HEAD, содержащий merge PR #352; убедиться, что после merge-коммита нет дельты в `src/**`, `supabase/functions/**`, `supabase/migrations/**`.
2. Байт-сверка `20260823094017_participant_live_event_replies.sql` с версией из PR.
3. Baseline-снимок (см. read-back ниже) до применения: список политик, `count(*)`, `max(created_at)` по `live_event_replies`, `live_event_comments`, `live_event_questions`.
4. Применить ровно эту миграцию через Lovable Cloud. Никаких других SQL/DDL/DML, никаких Edge Functions.
5. Read-back: набор политик соответствует ожидаемому (старая SELECT-политика удалена), счётчики и `max(created_at)` неизменны.
6. Тестовая матрица (см. ниже) — только в транзакциях с обязательным `ROLLBACK`, на завершённом/тестовом эфире. Если безопасных principals нет — статус UNVERIFIED, не угадывать.
7. Publish frontend только если в PR есть дельта в `src/**`, с двумя скриншотами (ПК и мобильный) опубликованной комнаты.
8. Повторный прогон security advisors.

## SQL read-back (без изменения данных)

```sql
-- 1. Политики целевых таблиц
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename in ('live_event_replies','live_event_comments','live_event_questions')
order by tablename, policyname;

-- 2. RLS включён
select relname, relrowsecurity, relforcerowsecurity, relreplident
from pg_class where relname = 'live_event_replies';

-- 3. Инварианты данных
select 'replies' t, count(*), max(created_at) from live_event_replies
union all select 'comments', count(*), max(created_at) from live_event_comments
union all select 'questions', count(*), max(created_at) from live_event_questions;

-- 4. Целостность ссылок и приватности
select count(*) filter (where source_comment_id is null and source_question_id is null) as orphan_source,
       count(*) filter (where source_comment_id is not null and source_question_id is not null) as double_source,
       count(*) filter (where visibility_scope = 'private' and target_user_id is null) as private_without_target
from live_event_replies;

-- 5. Realtime
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename like 'live_event%';

-- 6. Грантов и функций не меняли
select grantee, privilege_type from information_schema.role_table_grants
where table_name = 'live_event_replies';
select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('has_role_v2','user_has_live_event_access','is_user_removed_from_room','is_user_muted_in_room');
```

## Тестовая матрица (в транзакции, финал — ROLLBACK)

| # | Актор | Действие | Ожидание |
|---|-------|----------|----------|
| 1 | Participant A (с доступом) | INSERT public reply к комментарию своего эфира | OK |
| 2 | Participant A | INSERT reply с `source_comment_id` из **другого** эфира | 42501 |
| 3 | Participant A (removed) | INSERT reply | 42501 |
| 4 | Participant A (muted) | INSERT reply | 42501 |
| 5 | Participant A | INSERT private reply без `target_user_id` | отказ (CHECK/RLS) |
| 6 | Participant B (с доступом) | SELECT public reply от A | видит |
| 7 | Participant B | SELECT private reply A→C | не видит |
| 8 | Participant C (адресат) | SELECT private reply A→C | видит |
| 9 | Participant A (автор) | SELECT собственного private reply | видит |
| 10 | Пользователь без доступа к эфиру | SELECT любого reply этого эфира | 0 строк |
| 11 | Staff (employee) | SELECT всех public+private реплаев эфира | видит все |
| 12 | Staff (muted/removed) | INSERT reply | 42501 |
| 13 | Admin | SELECT/INSERT/UPDATE/DELETE | полный доступ |
| 14 | Любой | UPDATE/DELETE чужого reply | отказ |

Проверки выполняются через `set local role authenticated` + `set local request.jwt.claims`; при отказе прав роли — фиксировать UNVERIFIED, а не подменять проверку.

## Rollback-план

- Откат миграции: `DROP POLICY` для всех политик, созданных `20260823094017`, и восстановление прежних трёх политик в точных исходных определениях (зафиксированы в baseline-снимке шага 3, тексты приведены выше в разделе «baseline»).
- Если миграция добавляла таблицу в Realtime: `ALTER PUBLICATION supabase_realtime DROP TABLE public.live_event_replies`.
- Если добавлялись CHECK-констрейнты: `ALTER TABLE public.live_event_replies DROP CONSTRAINT <name>`.
- Данные не изменяются ни при применении, ни при откате; DML в rollback отсутствует.
- Frontend-откат: Publish предыдущего SHA `c06306be`.
