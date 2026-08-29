# План: production rollout эфиров (PR #385 + PR #387), exact SHA 4c5cc1c2

PLAN-ONLY. Ничего не изменено: код, данные, миграции, деплой, Publish — не выполнялись.

## 1. SHA-гейт (факт)

- Managed mirror содержит целевой коммит `4c5cc1c23 «Усилить вход и проверку доступа к эфирам (#387)»` и под ним `c772fcd15 fix(live): show reply author identity (#385)`.
- HEAD зеркала — служебный коммит бота `687d6db79 «Work in progress»` поверх целевого. Дельта HEAD ↔ целевой SHA: **только автогенерируемый** `src/integrations/supabase/types.ts` (1 вставка / 10 удалений). Прикладной код, `supabase/functions/**` и `supabase/migrations/**` байт-идентичны целевому SHA.
- Последний опубликованный SHA — `87610d98a` (PR #384, timezone-fix). Целевой SHA идёт ровно на два коммита выше: `c772fcd15` → `4c5cc1c23`.

## 2. Очередь эфиров (production, read-only)

- `live_events` с `room_state IN ('opened','live')`: **1** — только `testiruem-kartinku-do-veba` (`status = scheduled`), ранее подтверждённая небоевая тестовая комната.
- Боевых opened/live эфиров нет → STOP-гейт по активному эфиру **не срабатывает**.
- Текущий slug `cb-20-20-potok-konferentsiya-4`: `room_state = completed`, `status = ended`, `scheduled_at = 2026-08-29 07:00+00`. Эфир уже завершён; 46 исторических записей сессий (lifecycle не трогаем).

## 3. Состав деплоя (только чтение diff)

`c772fcd15^ … 4c5cc1c23`, 12 файлов:

- UI PR #385: `src/components/live/LiveEventReplies.tsx`, тест `src/lib/liveReplyAuthorSnapshot.test.ts`.
- UI PR #387: `src/components/live/RoomEntryDialog.tsx`, `src/pages/LiveEvent.tsx`, `src/lib/roomEntryIdentity.ts` + тесты `roomEntryIdentity.test.ts`, `liveEventAccessParity.test.ts`.
- Edge: `supabase/functions/live-resolve/index.ts` (+38/−4). Checked-in shared зависимости: `_shared/check-month-purchase.ts`, `_shared/live-access-rule-eval.ts`, `_shared/live-room-gate.ts` — в диапазоне не менялись, но упаковываются вместе с функцией.
- Миграции: `20260829105213_harden_live_event_access.sql` (304 стр.) **и** `20260829081200_add_live_reply_author_snapshot.sql` (132 стр.).
- Прочее: `.gitignore`, автоген `types.ts`.

**Важное уточнение к scope:** в задаче названа одна миграция, но PR #385 нерабочий без второй — колонок `author_display_name/author_role/author_nickname_color` в `live_event_replies` в production **нет** (текущие колонки: id, public_id, live_event_id, source_comment_id, source_question_id, target_user_id, target_display_name, reply_text, visibility_scope, created_by, created_at, updated_at, metadata). Без `20260829081200` DoD «участнику виден автор ответа» недостижим, а новый UI будет читать отсутствующие поля. Требуется явное решение: применять обе миграции или отложить PR #385.

## 4. Зависимости миграции 20260829105213 (проверено без выполнения)

- `public.user_has_live_event_access(uuid, uuid)` — существует, текущее определение ~1.8 КБ (новое ~10 КБ) → это фактический hardening-переписыв, не no-op.
- `public.has_month_purchase(_user_id uuid, _tariff_id uuid, _month text)` — существует, сигнатура совпадает с вызовом в миграции.
- `public.is_user_removed_from_room(_user_id uuid, _live_event_id uuid)` — существует.
- Таблицы/колонки, используемые новой версией: `live_events(product_id, access_rule, metadata)`, `live_event_access_rules(rule_kind, product_id, tariff_id, conditions, sort_order)`, `subscriptions_v2(status, access_end_at, billing_type, next_charge_at, tariff_id)`, `entitlements(status, expires_at)`, `entitlement_sources(user_id, product_id, tariff_id, status, starts_at, expires_at)` — все присутствуют (состав колонок `entitlement_sources` подтверждён).
- Статусы сравниваются через `status::text`, поэтому enum-дрейф `subscription_status` не ломает функцию.

Ожидаемый DDL-эффект: ровно один `CREATE OR REPLACE FUNCTION` + `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated, service_role`. Ноль изменений таблиц, ноль DML, rowcount данных = 0.

Callers, которые немедленно наследуют новую логику (17 RLS-политик + 6 RPC):
- RLS: `live_event_comments` (INSERT, SELECT autoweb), `live_event_questions` (INSERT, SELECT), `live_event_reactions` (SELECT, INSERT), `live_event_comment_reactions` (SELECT, INSERT), `live_event_replies` (INSERT, SELECT), `live_event_product_cta_bindings` (SELECT), `live_event_cta_runtime_events` (SELECT, INSERT), `live_event_sessions` (SELECT), `live_event_timeline_events` (SELECT), `live_event_room_blocks` (SELECT), `live_event_participant_prefs` (INSERT).
- RPC: `autoweb_scenario_runtime_list`, `autoweb_scenario_runtime_list_v2`, `autoweb_history_comments_list`, `autoweb_history_questions_list`, `get_autoweb_session_participants`, `get_room_participants`.

Rollback: сохранить `pg_get_functiondef` текущей функции до применения (снимок в отчёт, без PII) и при регрессе восстановить её тем же `CREATE OR REPLACE` + вернуть прежние grants. Для `20260829081200` rollback — `DROP TRIGGER` + `DROP FUNCTION snapshot_live_event_reply_author()`; три добавленные колонки оставить (безопасны, additive), либо удалить отдельной обратной миграцией.

## 5. Правила доступа текущего эфира (обезличенно)

`cb-20-20-potok-konferentsiya-4` — 5 правил, все `rule_kind = 'product'`, у каждого задан product_id и tariff_id, `conditions = {}` (month-gate выключен), sort_order 0…4. **`any_authenticated` отсутствует.** Значит успешный админский вход в тестах объясняется исключительно веткой bypass `user_roles_v2.code IN ('admin','super_admin')` в новой функции, а не публичным правилом. `live_access_proofs` — 0 записей, самостоятельным коммерческим доступом не является.

## 6. Порядок выполнения (execute-этап, отдельное одобрение)

1. **Preflight**: сверить SHA `4c5cc1c2315039ce70b086d5446eec4a2fadd087`, чистое дерево, `tsgo --noEmit` и `vite build` PASS; повторно перечитать очередь opened/live (ожидание: только `testiruem-kartinku-do-veba`); снять снимок текущего определения `user_has_live_event_access` и его grants.
2. **Migration**: применить `20260829105213_harden_live_event_access.sql` байт-в-байт из репозитория (и, при подтверждении scope, `20260829081200_add_live_reply_author_snapshot.sql`). Любой неожиданный DDL/rowcount — STOP.
3. **Read-back**: новое `pg_get_functiondef`, наличие ключевых веток (removed-check, admin bypass, exact-tariff, month fail-closed), grants = `authenticated, service_role`, отсутствие EXECUTE у PUBLIC/anon; `supabase--linter`.
4. **Deploy**: только `live-resolve` (со своими checked-in `_shared`-модулями).
5. **Безопасные проверки** (без создания пользователей, покупок, платежей, сообщений и без изменения данных): OPTIONS/CORS = 200; вызов без JWT = 401; невалидный JWT = 401; закрытая/завершённая комната = `room_closed`; аккаунт без доступа = 403 и 0 новых `live_active_sessions`; админ = allow (bypass); read-back `count(live_active_sessions)` до/после = без прироста.
6. **Publish** фронтенда exact SHA после всех PASS.
7. **QA опубликованного URL**: desktop 1280 и mobile 390×844 на разрешённой небоевой комнате `testiruem-kartinku-do-veba` — обязательный диалог подтверждения имени, отсутствие heartbeat до подтверждения; плюс скриншоты завершённой комнаты `cb-20-20-potok-konferentsiya-4` (закрытый экран, 0 heartbeat, 0 прироста сессий).

## 7. DoD

**Access:** anon и невалидный JWT → 401/403; `any_authenticated` работает только при явном правиле такого вида; exact tariff не выводится из generic entitlement (требуется `tariff_id` в `subscriptions_v2`/`entitlement_sources`); month gate при включённом `match_purchase_month` без валидного месяца → deny; `live_access_proofs` не даёт коммерческого доступа; removed-user denied раньше admin bypass; admin/super_admin bypass сохраняется; ошибка чтения правил → deny, без legacy fallback (legacy-ветка только при полном отсутствии строк правил).

**Entry UI:** новый прямой вход показывает обязательный диалог с предзаполненным именем; X/Escape/клик вне не закрывают; до подтверждения heartbeat = 0 и active session не создаётся; после подтверждения вход работает; reload действующей вкладки не переспрашивает; устаревшая session возвращает к подтверждению.

**Replies:** участник видит автора ответа из снапшота; staff-only реальные данные (email, профиль) не раскрываются — клиент не запрашивает `profiles`.

## 8. Stop-guards

SHA mismatch; появление боевого opened/live эфира; отсутствующая зависимость (в т.ч. неприменённая миграция `20260829081200` при включённом PR #385 в scope); неожиданный rowcount/DDL; ошибка деплоя; critical security finding; невозможность получить desktop+mobile proof → остановка без Publish.
