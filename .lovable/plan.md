# Отчет о выполнении: PLAN-ONLY RE-REVIEW — PR #372 (`ai-generate-corporate-package` boot fix)

Режим: строго read-only. Ноль изменений: без code edits, commits, branches, generated files,
SQL/DDL/DML, миграций, RLS/Auth/Storage/config, deploy, Build и Publish. Выполнены только чтения,
один локальный контрактный тест и read-only SELECT из `information_schema`.

## Гейт SHA

- Целевой merge SHA `55032c695` (PR #372), head patch `4fcd42e8d` — оба присутствуют в managed-зеркале.
- Managed HEAD `dbcfb07e0`; дельта к `55032c695` — только 3 генерируемых файла
  (`src/integrations/supabase/client.ts`, `previewAuthStorage.ts`, `types.ts`). Дерево приложения совпадает.
- Diff патча `4fcd42e8d`: ровно 3 файла, +175/−1 —
  `supabase/functions/ai-generate-corporate-package/helpers.ts` (новый, 91 строка),
  `.../index.ts` (одна строка импорта), `src/test/aiCorporatePackageHelpers.contract.test.ts` (новый).
  Ни `_shared/*`, ни `config.toml`, ни другие функции не затронуты.

## 1. Root cause устранена — PASS

Production boot log (`hdjgkjceownmmnrqqtuz`, 2026-08-27T08:50:19Z / 08:51:02Z):

```text
worker boot error: Uncaught SyntaxError: The requested module '../_shared/docx-helpers.ts'
does not provide an export named 'buildAddress' at .../ai-generate-corporate-package/index.ts:23:75
```

Патч меняет единственную строку `} from '../_shared/docx-helpers.ts';` → `} from './helpers.ts';`.
`helpers.ts` экспортирует ровно и только шесть требуемых символов: `dateToRussianFormat`,
`fullNameToInitials`, `generateDocumentNumber`, `buildAddress`, `entityName`, `sanitizeFileName`.
Несуществующий именованный экспорт, ломавший ESM-линковку до входа в handler, устранён.

## 2. Полнота покрытия рантайм-импортов и зависимостей — PASS

- Импорт-список entrypoint (строки 25–32) посимвольно совпадает с экспорт-списком `helpers.ts`;
  контрактный тест дополнительно фиксирует и точный набор ключей модуля, и отсутствие строки
  `from '../_shared/docx-helpers.ts'`.
- `helpers.ts` не имеет ни одного `import` — новых зависимостей, npm-специфаеров и CDN-ссылок не добавлено.
- Остальные модульные зависимости функции не изменены: `_shared/cors.ts`, `_shared/corporate-manifest.ts`,
  `npm:docxtemplater@3.47.1`, `npm:pizzip@3.1.6`, `deno.land/std` `serve`, `esm.sh` supabase-js —
  все они и до патча линковались успешно (boot падал только на docx-helpers).
- Семантика сверена с sibling-реализациями: `dateToRussianFormat`/`fullNameToInitials` эквивалентны
  приватным функциям `_shared/document-render.ts` (формат `И.И.Иванов`, `27 августа 2026`);
  `buildAddress`/`entityName` используют поля `client_type`, `ind_full_name`, `ent_name`, `leg_name`,
  `ent_address`, `leg_address`, `ind_address_index|region|district|city|street|house|apartment` —
  все 13 колонок подтверждены в production в `public.client_legal_details`.
- `bunx vitest run src/test/aiCorporatePackageHelpers.contract.test.ts` — 5/5 PASS.

## 3. Auth/access contract не расширен — PASS

Диff не касается блока авторизации. Он остаётся прежним (index.ts, строки ~398–423):
обязательный `Authorization: Bearer` → `auth.getUser` (401 при ошибке) → резолв `profiles` по `user_id`
(400 при отсутствии) → загрузка `corporate_draft_sessions` по id → строгий ownership
`session.profile_id !== profileId → 403` → гейт статуса `confirmed` (400 иначе).
Service-role клиент, роли, RLS, secrets и `supabase/config.toml` не изменены; новых публичных путей нет.

## 4. Скоуп production-изменения — PASS

- Требуется redeploy ровно одной функции `ai-generate-corporate-package` (единичный вызов, не массовый).
  Функция не является webhook — controlled-webhook-протокол неприменим.
- SQL, миграции, RLS, Storage, secrets, `config.toml`, реестр функций — не требуются
  (`ai-generate-corporate-package` уже есть в `supabase/functions.registry.txt`).
- Frontend Publish в рамках этого фикса не нужен: изменение фронтенда — только новый тестовый файл.

## 5. Безопасный smoke после деплоя (без записей)

1. `OPTIONS` на функцию → ожидание 200/204 и CORS-заголовков вместо 503 / `BOOT_ERROR`.
2. Повтор `OPTIONS` на t=0 / 30s / 2m (проверка стабильности после cold start).
3. `POST` с заведомо невалидным `Authorization: Bearer invalid` → ожидание `401 Unauthorized`
   (доказывает, что модуль загрузился и auth-гейт работает; никаких DB/Storage-записей).
4. Чтение function logs: строк `worker boot error` быть не должно.
5. Реальную генерацию пакета (authenticated POST с валидной сессией) как smoke НЕ выполнять —
   она пишет в Storage, `ai_generated_documents`, батчи и меняет статус `corporate_draft_sessions`.
   Только по отдельному approve на тестовой сессии.

## Вердикт

**PASS TO DEPLOY** — патч минимален, root cause закрыта логом и кодом, новых зависимостей и
расширения auth/access нет, требуется только redeploy одной функции без SQL/config/миграций.
