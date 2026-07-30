План: PASS для merged SHA 435b4a066afef008f1aa3ba33ae7f2989eb2c47a (PR #220)

Режим текущего сообщения: PLAN-ONLY / READ-ONLY. Ничего не изменено, не развёрнуто и не опубликовано.

## 1. Прочитанное состояние

- Managed HEAD = `435b4a066afef008f1aa3ba33ae7f2989eb2c47a` («Merge pull request #220»), рабочее дерево чистое; предыдущий коммит — `1dcd95116 fix: split asset legislation into managed migrations`. Синхронизация не требуется.
- В `supabase/migrations` ровно 14 файлов серии `202607300015xx`: stage (3.5 КБ), batch_01..batch_12 (61.6–62.6 КБ, последний 22.6 КБ), finalize (5.6 КБ). Максимальный файл 62 579 байт — на порядок меньше отклонённых ранее 684 669 байт, каждый проходит managed-канал по отдельности.
- `scripts/asset-classifier/validate-legislation-migrations.mjs` → PASS: 14 миграций, 2349 уникальных якорей, `code-70034` присутствует, лимит 70 КБ соблюдён.
- Stage: вставляет документ `w21124359` с `is_published = false`, `structure = '[]'`, `checksum = NULL`, метаданными `resolution_161_import{expected_nodes:2349, expected_batches:12, applied_batches:[], state:"staging"}`; STOP-условия при count > 1, при чужом checksum и при попытке перезаписать опубликованный частичный импорт.
- Batches: строго упорядочены — каждый требует точную предшествующую длину `structure` (0 → … → 2279 → 2349), помечает себя в `applied_batches`, делает read-back длины; повторный запуск после применения (по маркеру или по финализированному документу) выполняет сверку содержимого и `RETURN` без записи. Checksum `ac7e28c9…5f4b` зафиксирован в stage, во всех 12 батчах и в finalize.
- Finalize: требует ровно 2349 узлов, 2349 уникальных `id`, наличие `code-70034`; собирает `content_text`; ставит checksum/metadata `state:"complete"` и `is_published = true`; затем проверяет read-back `legal_document_search_chunks` = 2349 и наличие anchor `code-70034`; обновляет `ai_user_prompts.code = 'asset_classifier'` с проверкой ROW_COUNT = 1; снимает `is_current` со старых версий и вставляет `2017-04-10-etalon-w21124359` как единственную текущую (ON CONFLICT DO UPDATE).
- Чанки создаёт существующий триггер `refresh_legal_document_search_chunks` (AFTER INSERT OR UPDATE OF structure ON public.legal_documents) — отдельная вставка в миграциях не нужна и корректно отсутствует.
- Production после неудачной попытки чист: `legal_documents` с `external_id='w21124359'` — 0 строк, связанных `legal_document_versions` — 0, промпт `asset_classifier` существует в старой «детерминированной» редакции (1 строка). Частичных артефактов нет.
- `LOVABLE_API_KEY` присутствует по имени. `supabase/config.toml`: `[functions.asset-classifier] verify_jwt = true`.
- Security scan: только `warn` (agent_security, supabase linter, supabase_lov). Нерешённых critical нет.
- Managed-миграции исполняются привилегированным managed-executor'ом, а не ролью sandbox: повышение прав `sandbox_exec` (прошлый блокер `permission denied for table ai_user_prompts`) для этого пути не требуется.

## 2. Вердикт

PASS. Блокеров нет.

## 3. EXECUTE (точный, при одобрении)

1. Preflight: managed HEAD ровно `435b4a066afef008f1aa3ba33ae7f2989eb2c47a`, дерево чистое; повторно подтвердить document count = 0.
2. Применить ровно 14 миграций строго по возрастанию имени: `…1500_stage` → `…1501..1512_batch_01..12` → `…1599_finalize`. Каждая — отдельным managed-вызовом, по одной, с проверкой успеха перед следующей. Никакого другого SQL/DML.
3. Read-back после серии: 1 строка `legal_documents` с `is_published = true`, checksum `ac7e28c9…5f4b`, 2349 узлов; 2349 чанков плюс anchor `code-70034`; 1 текущая версия `2017-04-10-etalon-w21124359`; промпт `asset_classifier` обновлён (1 строка).
4. Deploy ровно одной функции `asset-classifier` (`verify_jwt = true` без изменений). Другие функции, `config.toml`, секреты и ключи не трогаем.
5. Синтетические smoke через Lovable AI Gateway (без персональных и платёжных данных): «мобильный телефон» → ожидаемо шифр `70034`, нормативный срок 3 года; плюс 1–2 контрольных объекта из каталога. Проверить, что ответ строится по внутренней базе.
6. Внутренняя проверка на `club.gorbova.by`: страница закона и якорь `#code-70034` открываются, содержимое отдаётся из внутренней базы, ссылок/переходов на etalonline в пользовательском пути нет.
7. Publish — ровно один frontend Publish и только при всех PASS шагов 2–6.
8. UI-подтверждение: два скриншота уже опубликованного результата (ПК 1440×900 и мобильный 390×844) страницы с якорем `#code-70034`, привязанные к URL, опубликованному SHA и viewport.

## 4. Rollback и повторный запуск

- Каждая миграция атомарна (один `DO`-блок): ошибка откатывает свою миграцию целиком.
- Прерывание в середине серии оставляет только неопубликованный staging-документ с частичным `structure` — он не виден пользователям (`is_published = false`) и корректно дозаполняется повторным запуском оставшихся батчей.
- Повторный прогон всей серии после успешного finalize идемпотентен: stage и батчи выходят через сверку без записи, finalize переустанавливает те же значения.
- Полный откат (при явном отдельном решении): удаление версии `2017-04-10-etalon-w21124359`, чанков документа и строки `legal_documents` с `external_id = 'w21124359'`, плюс возврат прежнего текста промпта — отдельной задачей, в текущий scope не входит.

## 5. Явные исключения

Никаких новых коммитов и правок кода, других миграций, изменений RLS/Auth/Storage/секретов/`config.toml`, деплоя других функций, реальных платежей, рассылок и создания пользовательских данных.

## 6. Definition of Done

Managed SHA подтверждён; 14 миграций применены по порядку; все read-back PASS; развёрнута только `asset-classifier`; синтетические smokes и внутренняя проверка `#code-70034` PASS; выполнен ровно один Publish; два скриншота опубликованного интерфейса приложены.

CODE CHANGES: NONE · DATABASE CHANGES: NONE · EDGE DEPLOY: NONE · SECRETS CHANGES: NONE · PUBLISH: NONE
