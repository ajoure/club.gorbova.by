# План: RLS-фикс ответов на комментарии в эфире (PR #350)

Режим текущего сообщения: **PLAN-ONLY / STRICT READ-ONLY**. Ничего не изменено: 0 code edits, 0 commits, 0 migrations, 0 SQL writes, 0 deploy, 0 Publish. Ожидающая публикация предыдущей задачи не продолжена.

## 1. Проект и effective SHA

- Проект: текущий production (Lovable Cloud) — PASS.
- Managed HEAD: `8b47b92753d33852d0823d756047f68249d61389`, дерево чистое.
- Разбор дельты относительно `origin/main` `5a7365967d59d2d26985136ce99d7207ff050679`: два managed-коммита (`9301c0596`, merge `8b47b9275`) добавляют **ровно один файл** — зеркало уже применённой миграции `...094336_6fd6fb5f-....sql` (87 строк, продукт PRD-000039). Это managed migration mirror, **не** code mismatch: файлов `src/**` и `supabase/functions/**` в дельте нет.
- Коммит `639d62cd9af75acbe242c1d1e9f8482a60d4af4e` (head PR #350) в managed-зеркале **отсутствует**; файла `supabase/migrations/20260822093925_allow_staff_live_event_replies.sql` в дереве нет.
- **Вывод: EXECUTE BLOCKED** — PR #350 не merged в `main` (или merge ещё не доехал в managed-зеркало). Нужен exact merged SHA.

## 2. Фактические production policies/grants (без PII)

`public.live_event_replies`, RLS включён, 2 политики:

| Политика | cmd | roles | USING | WITH CHECK |
|---|---|---|---|---|
| Admins can manage replies | ALL | authenticated | `has_role_v2(auth.uid(),'admin')` | `has_role_v2(auth.uid(),'admin')` |
| Users can read visible replies | SELECT | authenticated | `visibility_scope='public' OR target_user_id=auth.uid()` | — |

Grants (`relacl`): `anon`, `authenticated`, `service_role` — полный набор; то есть отказ идёт именно от RLS (42501), а не от привилегий.

Колонки: `live_event_id`, `reply_text`, `visibility_scope`, `created_by` — NOT NULL; `source_comment_id`, `source_question_id`, `target_user_id`, `target_display_name`, `metadata` — nullable.

Функции:
- `public.has_role_v2(uuid, text)` — SQL, STABLE, SECURITY DEFINER, `search_path=public`. Особенность: код `'employee'` — виртуальный umbrella (любая роль в `user_roles_v2`, кроме `user`); `'superadmin'`/`'super-admin'` нормализуются в `super_admin`.
- `public.user_has_live_event_access(uuid, uuid)` — SQL, STABLE, SECURITY DEFINER, `search_path=public`; true для admin/super_admin, для правил `any_authenticated` и для правил по продукту при наличии подписки/доступа.

## 3. Проверка гипотезы — ПОДТВЕРЖДЕНА

- UI: `src/pages/LiveEvent.tsx:134` и `src/components/live/LiveEventQuestions.tsx:82` открывают ответ при `role === 'admin' || 'superadmin' || 'employee'`.
- INSERT: `src/components/live/LiveEventReplies.tsx:51`, payload с `created_by: user.id`.
- БД: единственная разрешающая INSERT политика требует ровно `has_role_v2(auth.uid(),'admin')`.
- Следствие: `super_admin` и любой сотрудник вне роли `admin` проходят UI-гейт, но получают 42501. Соседние таблицы (`live_event_comments`, `live_event_questions`) уже используют более широкий staff-набор — предлагаемая правка выравнивает `live_event_replies` с этим каноном.

## 4. Ревизия миграции PR #350 (по описанию; файл в зеркале недоступен)

Требования к миграции, которые я обязан проверить построчно после merge:

1. Новая политика только `FOR INSERT TO authenticated`, существующая «Admins can manage replies» **сохраняется** (не DROP, не REPLACE).
2. `WITH CHECK` содержит все четыре условия:
   - `created_by = auth.uid()`;
   - staff umbrella: `has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin') OR has_role_v2(auth.uid(),'employee')` (учесть, что `'employee'` уже покрывает первые два — дубли безопасны, но не должны заменяться на `'superadmin'`-строку без нормализации);
   - доступ к эфиру: `user_has_live_event_access(auth.uid(), live_event_id)`;
   - источник из того же эфира: `source_comment_id`/`source_question_id`, если заданы, ссылаются на строку с тем же `live_event_id` (EXISTS-подзапросы), и допускается случай, когда оба NULL — только если это осознанно.
3. Никаких `ALTER TABLE`, `GRANT`, изменений функций, данных, индексов; идемпотентность через `DROP POLICY IF EXISTS <new_name>` + `CREATE POLICY`.
4. Никаких изменений `live_event_comments`, `live_event_questions`, `live_events`.

Любое отклонение → STOP без применения.

## 5. Безопасный dry-run / read-back (без INSERT в текущий эфир)

До применения:
- снимок `pg_policies` по `live_event_replies` (2 строки), `relrowsecurity`, `relacl`;
- контрольные счётчики: `count(*) live_event_replies`, `max(created_at)`;
- определения `has_role_v2`, `user_has_live_event_access` (хэш `pg_get_functiondef`).

После применения (read-back):
- ровно 3 политики: две прежние без изменений + одна новая INSERT;
- `count(*)` и `max(created_at)` в `live_event_replies` не изменились;
- 0 изменений в `live_event_comments`, `live_event_questions`, `live_events`, `entitlements`, `orders`, `payments_v2`;
- определения функций не изменились.

Runtime proof без сохранения строки (эквивалент impersonation, транзакция с ROLLBACK, вне текущего эфира):
```
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<staff_uuid>","role":"authenticated"}';
INSERT INTO public.live_event_replies (...)  -- тестовый эфир/строка
RETURNING id;
ROLLBACK;
```
и негативный кейс: тот же INSERT под не-staff `sub` должен падать 42501. Обе проверки — только с ROLLBACK, ни одной сохранённой строки; при невозможности сделать это без касания текущего эфира — использовать завершённый/тестовый `live_event_id`, иначе пометить runtime proof как UNVERIFIED, а не имитировать его.

## 6. Stop-guards, rollback, DoD, вне scope

Stop-guards:
- нет exact merged SHA PR #350 → STOP (текущее состояние);
- миграция не байт-в-байт с файлом PR → STOP;
- миграция трогает что-то кроме политики INSERT на `live_event_replies` → STOP;
- read-back даёт ≠3 политики или изменившиеся счётчики → STOP + rollback;
- любой новый critical security finding → STOP.

Rollback: `DROP POLICY IF EXISTS "<новое имя>" ON public.live_event_replies;` — возвращает ровно исходные 2 политики, данные не затрагиваются.

DoD:
- exact merged SHA подтверждён, дерево чистое;
- применена ровно одна миграция `20260822093925_allow_staff_live_event_replies.sql`;
- 3 политики, старые не изменены;
- positive/negative runtime proof с ROLLBACK, 0 сохранённых строк;
- 0 изменений данных эфира, комментариев, вопросов, доступов, заказов, платежей;
- линтер без новых critical findings.

Вне scope: любые изменения UI, Edge Functions, текущего эфира и его данных, ретро-исправление уже не отправленных ответов, расширение прав на SELECT/UPDATE/DELETE, изменение `has_role_v2`/`user_has_live_event_access`.

## 7. Publish

Publish не требуется: изменение только на уровне RLS, UI не менялся, скриншоты ПК/мобайл неприменимы. Доказательство — policy read-back и impersonation-проверка с ROLLBACK. Отдельно отмечу: ожидающая публикация предыдущей задачи (PRD-000039) остаётся невыполненной и требует отдельного решения.
