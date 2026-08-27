# Отчет о выполнении: PLAN-ONLY DIAGNOSIS — `ai-generate-corporate-package` BOOT_ERROR

Режим: строго read-only. Ноль изменений: без кода, миграций, SQL, config, deploy, Build, Publish.
Managed-зеркало HEAD `e15733661` = целевой clean SHA `7b0cee96f` + только 3 генерируемых файла
(`src/integrations/supabase/client.ts`, `previewAuthStorage.ts`, `types.ts`). Дерево приложения совпадает.

## 1. Root cause (с лог-доказательством)

Production logs (project_ref `hdjgkjceownmmnrqqtuz`, функция `ai-generate-corporate-package`):

```text
2026-08-27T08:51:02Z ERROR worker boot error: Uncaught SyntaxError:
  The requested module '../_shared/docx-helpers.ts' does not provide an export named 'buildAddress'
  at file:///var/tmp/sb-compile-edge-runtime/functions/ai-generate-corporate-package/index.ts:23:75
2026-08-27T08:50:19Z ERROR worker boot error: (то же самое)
```

Это ошибка ESM-линковки на этапе boot, до выполнения любого кода handler — поэтому OPTIONS-хендлер
в первой строке handler недостижим и шлюз отдаёт HTTP 503 / `BOOT_ERROR`.

Причина в исходнике (`supabase/functions/ai-generate-corporate-package/index.ts`, строки 25–33):
функция импортирует из `../_shared/docx-helpers.ts` шесть именованных символов —
`dateToRussianFormat`, `fullNameToInitials`, `generateDocumentNumber`, `buildAddress`,
`entityName`, `sanitizeFileName`.

Фактический экспортный контракт `supabase/functions/_shared/docx-helpers.ts` (полный список):

```text
CurrencyCode (type), normalizeCurrency, integerToWordsRu, numberToWordsRu,
formatMoney, TokenLocation (iface), TokenManifestEntry (iface), extractDocxTokensWithLocations
```

Ни один из шести импортируемых символов там не объявлен. Deno валидирует именованные экспорты при
линковке модуля, поэтому падает первый отсутствующий (`buildAddress`) — остальные пять сломаны так же.

Где символы существуют сегодня (все — приватные, не экспортированы):
- `dateToRussianFormat`, `fullNameToInitials` — локальные функции в `_shared/document-render.ts`
  (есть экспортируемый `fullNameToInitials` в `_shared/typed-tokens-resolver.ts`);
- `buildAddress` — локальная функция в `_shared/resolve-per-role-recipients.ts`;
- `entityName` — только во frontend (`src/utils/aiDocumentSnapshotResolver.ts`), в Deno-коде отсутствует;
- `generateDocumentNumber`, `sanitizeFileName` — в `supabase/functions/**` отсутствуют полностью.

Вывод: функция никогда не могла загрузиться в текущем виде; это не деградация рантайма и не
проблема deploy-канала. Гипотез не требуется — лог даёт точную причину.

## 2. Минимальный GitHub-first patch

Ветка `codex/fix-corp-package-boot`, один PR, только код функции.

Вариант A (рекомендуемый, минимальный blast radius): добавить локальный модуль
`supabase/functions/ai-generate-corporate-package/helpers.ts` с шестью экспортируемыми функциями
(перенос реализации 1:1 из `document-render.ts` / `resolve-per-role-recipients.ts` для
`dateToRussianFormat`, `fullNameToInitials`, `buildAddress`; новые чистые реализации
`generateDocumentNumber`, `entityName`, `sanitizeFileName`, соответствующие фактическому
использованию в строках 131/136/139/146/183/492/526/528) и переключить импорт на `./helpers.ts`.
Файл лежит внутри директории функции — деплоится вместе с ней и не трогает другие функции.

Вариант B (отклонён для этого патча): дописать экспорты в `_shared/docx-helpers.ts`. Это меняет
общий модуль, который импортируют ещё 5 функций (`canonical-template-apply-markup`,
`canonical-template-validate`, `canonical-template-backfill-validation`, `_shared/standard-fields.ts`,
`_shared/document-render.ts`, `_shared/document-data-snapshot.ts`), и расширяет scope деплоя.

Отдельными follow-up (вне этого патча, чтобы не смешивать boot-fix и миграцию стандартов):
`serve` из `deno.land/std` → `Deno.serve`, `https://esm.sh/@supabase/supabase-js@2` → `npm:@supabase/supabase-js@2`.

## 3. Затронутые файлы и зависимости

Патч:
- `supabase/functions/ai-generate-corporate-package/index.ts` (только строка импорта)
- `supabase/functions/ai-generate-corporate-package/helpers.ts` (новый)

Читаемые зависимости (не изменяются): `_shared/cors.ts`, `_shared/corporate-manifest.ts`,
`_shared/docx-helpers.ts`, `_shared/document-render.ts`, `_shared/resolve-per-role-recipients.ts`.
Реестр: `ai-generate-corporate-package` уже присутствует в `supabase/functions.registry.txt` — правка не нужна.

## 4. Безопасные probes

Локально (read-only, без деплоя):
- `deno check supabase/functions/ai-generate-corporate-package/index.ts` — линковка модулей должна пройти;
- `rg -n "^export" supabase/functions/ai-generate-corporate-package/helpers.ts` — сверка шести имён с импортом;
- `bunx vitest run src/test/edgeFunctionContracts.contract.test.ts` — контрактный гейт.

Production после деплоя (без записи данных):
- внешний `OPTIONS` на функцию → ожидание 200/204 и CORS-заголовков вместо 503/`BOOT_ERROR`;
- повторный OPTIONS на t=0/30s/2m;
- чтение свежих function logs: строк `worker boot error` быть не должно;
- POST-путь генерации документов НЕ запускать как smoke (пишет в storage, `ai_generated_documents`,
  батчи и меняет статусы `corporate_draft_sessions`) — только по отдельному approve на тестовой сессии.

## 5. Redeploy / SQL / config

- Redeploy: да, ровно одна функция `ai-generate-corporate-package`, единичным вызовом. Массового
  редеплоя не требуется. Функция не webhook — протокол controlled webhook redeploy не применяется.
- SQL / миграции / RLS / Storage / secrets: не требуются. Дефект чисто модульный.
- `supabase/config.toml`: изменения не нужны (текущий режим auth сохраняется как есть).

## 6. Вердикт

**PASS TO IMPLEMENT** — root cause доказана логом, патч изолирован в директории одной функции,
деплой ограничен одной функцией, БД и config не затрагиваются.
