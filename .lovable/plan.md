# PLAN-ONLY ревизия — «Определение шифра ОС», merged SHA `609a4b64229d1b1a5fce420afc7e6815a54b663a`

## Owner / environment
- Lovable Cloud владеет production Supabase (`hdjgkjceownmmnrqqtuz`). Собственного BYO Supabase у проекта нет. Все migration/deploy — только через managed Lovable-инструменты.
- Managed git origin sync выполнен. `origin/main` HEAD теперь `609a4b642`, PR #211 присутствует в истории (`a2bf4d9c4..609a4b642`).

## Current state — GitHub / managed / DB
- **Merged diff PR #211** (13 файлов, +15 620/-15) содержит только заявленный scope: миграция, `asset-classifier` (новая), shared `_shared/asset-classifier/{engine,catalog-161}.ts`, shared `_shared/ai-access.ts` (расширен), `gorbova-ai-chat` (guard), UI (`AiPageContent.tsx`, `PromptRunFlow.tsx`, `useAiChat.ts`), `supabase/config.toml` (verify_jwt), тест `assetClassifier.test.ts`, docs/scripts.
- **DB текущее состояние (read-back)**:
  - `app_sections WHERE code='ai_asset_classifier'` → 0 rows.
  - `ai_user_prompts WHERE code='asset_classifier'` → 0 rows.
  - `access_rules` для секции → 0 rows.
  - Оба целевых продукта существуют: `11c9f1b8… Gorbova Club`, `85046734… Бухгалтерия как бизнес`.
  - RPC `public.user_has_access_to_rule` присутствует.
- **Currently-unpublished / auto-copy миграций**:
  - `20260729141809_77871e3e-...sql` (auto-снимок ранее применённого reset-trial за пределами старого SHA `6f4c17de`) присутствует в `main` и не даёт мусора: содержимое уже применено ранее (см. отчёт по SHA `6f4c17de`). Дубликата новой миграции нет; sequential order (`…142000`, `…160000`) корректен.
- **Server-side каталог**:
  - `_shared/asset-classifier/catalog-161.ts` — 626 450 байт (~612 KB, в пределах заявленных ~625 KB).
  - `grep -c normativeLifeYears` = 1901 конечных позиции (≈ заявленным 1900).
  - `engine.ts` не содержит `fetch`/HTTP/OpenAI/Gemini/gateway — единственное упоминание URL — комментарий-ссылка на etalonline.by. LLM-вызовов нет.
- **verify_jwt в `supabase/config.toml`**: секция `[functions.asset-classifier] verify_jwt = true`. Для `ai-access-status` и `gorbova-ai-chat` секции в diff PR #211 не менялись (унаследованный режим сохраняется).
- **`gorbova-ai-chat` guard**: добавлен ранний 409 (`deterministic_scenario_requires_dedicated_endpoint`) для `promptData.code === 'asset_classifier'` — фолбэк на генеративный шлюз исключён даже при прямом вызове.
- **`ai-access-status`**: файл функции самой функции не менялся, обновлён shared-хелпер `_shared/ai-access.ts` — добавлены `ASSET_CLASSIFIER_SCENARIO_CODE/SECTION_CODE`, `resolveAssetClassifierAccess`, интеграция в `resolveAiAccessStatus` (только чтение `app_sections` + `access_rules` + RPC `user_has_access_to_rule`). Admin-bypass через `hasAdminRole` работает и здесь.
- **`asset-classifier` (новая)**: POST-only, требует `Authorization`, `auth.getUser()` на userClient, затем `resolveAssetClassifierAccess` через service-role; при `false` — HTTP 403 + `asset_classifier_not_in_products`; при `true` — детерминированный `classifyAsset(query)` без сети, запись двух сообщений в `ai_chat_messages`. Валидация длины (3..4000).

## Findings

### Critical
- Нет.

### High
- Нет.

### Medium / Info
1. Миграция вставляет только `INSERT … ON CONFLICT`; никаких новых FK/CHECK/RLS не создаёт. Использует существующие таблицы `app_sections`, `ai_user_prompts`, `access_rules` и их текущие RLS-политики. Совместимо с `user_has_access_to_rule` (проверено: RPC существует).
2. Guard в `resolveAssetClassifierAccess` требует, чтобы `access_rules.target_ref` был **строковым UUID секции**. Миграция кладёт `section.id::text` — согласовано. Регрессии для существующих `section_access`-правил не вносит: фильтр ограничен `target_ref = <section.id>`.
3. `supabase/config.toml` уже задаёт `verify_jwt = true` для `asset-classifier`; функция дополнительно проверяет пользователя сама — двойная защита корректна.
4. Каталог 612 KB + engine ≈ 15 KB импортируется только `asset-classifier`. В bundle-лимит edge function (~5 MB) вписывается со значительным запасом. Не влияет на bundle других функций (shared-код используется только этой одной).
5. Access-rules приоритет `30` совпадает с текущими соглашениями в БД (нужно оставить как есть, чтобы не переиграть уже настроенные вручную приоритеты — INSERT идёт только при `NOT EXISTS`, идемпотентно).

## Exact managed actions (только после одобрения EXECUTE)
1. Sync managed репозитория на точный `SHA 609a4b64229d1b1a5fce420afc7e6815a54b663a`. Никакой правки кода в managed сессии, никаких новых коммитов сверх merged SHA.
2. Применить ровно одну миграцию: `supabase/migrations/20260729160000_asset_classifier_scenario.sql`. Ничего больше.
3. Задеплоить ровно три Edge Functions:
   - `asset-classifier` (новая, будет впервые развернута с `verify_jwt=true`);
   - `gorbova-ai-chat` (обновление — добавлен deterministic guard);
   - `ai-access-status` (обновление — подтягивает новую версию shared `_shared/ai-access.ts`).
4. Никаких fixture-платежей, писем, сообщений в мессенджеры, создания пользователей/контактов; репаиров данных нет.

## Exact read-back / runtime checks (после EXECUTE)
- **SHA**: `git rev-parse origin/main` → `609a4b64229d1b1a5fce420afc7e6815a54b663a`.
- **Migration rows**:
  - `SELECT id, code, is_active FROM public.app_sections WHERE code='ai_asset_classifier';` → 1 row, `is_active=true`.
  - `SELECT code, is_active, is_visible_in_chat, launcher_order FROM public.ai_user_prompts WHERE code='asset_classifier';` → 1 row, `is_active=true`, `is_visible_in_chat=true`.
  - `SELECT product_id, priority, is_active FROM public.access_rules WHERE grant_target_type='section_access' AND target_ref = (SELECT id::text FROM public.app_sections WHERE code='ai_asset_classifier') ORDER BY product_id;` → 2 rows: `11c9f1b8…` и `85046734…`, `priority=30`, `is_active=true`.
  - Идемпотентность: повторный dry-run миграции не добавляет строк (проверить через сравнение count до/после — должен совпасть).
- **Grants/RLS**: проверить, что RLS на `app_sections`, `ai_user_prompts`, `access_rules` не поменялся (миграция их не трогает). Через `supabase--linter` убедиться, что новых RLS-финдингов нет.
- **Function version / logs**:
  - `supabase--edge_function_logs` для `asset-classifier` — свежий boot без crash, cold start ok.
  - Для `gorbova-ai-chat` — cold start ok, отсутствие ошибок парсинга нового guard'а.
  - Для `ai-access-status` — cold start ok, нет `column does not exist`/RPC ошибок.
- **Safe runtime smoke** (без реальных пользовательских данных):
  - Анонимный `curl` `asset-classifier` без Authorization → 401 `Необходима авторизация` (identity guard).
  - Анонимный `curl` `asset-classifier` с невалидным JWT → 401 `Неавторизованный доступ`.
  - Аутентифицированный препятствия/probe **не** запускаем от реального клиента; если владелец захочет, отдельный test-identity probe c enrollment в `access_rules` для этой identity — по запросу.
  - `ai-access-status` от анонима → 401 (unchanged).
  - Убедиться, что `gorbova-ai-chat` при `prompt.code='asset_classifier'` в теле реквеста вернёт 409 `deterministic_scenario_requires_dedicated_endpoint` (probe с service-role headers в dev-runtime; никаких пользовательских данных).

## Publish gate
Publish frontend (`main` HEAD → prod) допустим только при одновременном PASS:
- SHA read-back = `609a4b64…`.
- Все три функции задеплоены; logs без критических ошибок за первые 5 минут.
- Миграция read-back показывает ровно 1/1/2 строк выше.
- `supabase--linter` не даёт новых critical/high по scope миграции.
- Runtime smoke анонимных 401 и `gorbova-ai-chat` 409-guard PASS.
- Нет открытых critical/high в `project_monitoring` в scope.

Если любой пункт не PASS — STOP, репорт, без Publish.

## STOP-условия
- Не выполнять никаких дополнительных миграций/коммитов/деплоев поверх `609a4b64…`.
- При обнаружении несоответствия SHA после sync — STOP.
- При non-empty pre-existing row в `app_sections/ai_user_prompts` с тем же `code` до миграции (сейчас 0/0) — сравнить содержимое, не Publish без явной команды.
- Реальные платежи, письма, telegram-сообщения, изменение реальных контактов — запрещены как smoke.

Готов к EXECUTE по вашему одобрению.
