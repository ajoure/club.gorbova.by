# План: production rollout PR #388 (счёт-акт, сумма прописью)

Режим написания плана: PLAN-ONLY. Ничего не изменено, деплой и Publish не выполнялись.

## Факты discovery (read-only)

- SHA `478d6985fd26870d0ccec53e33715df011fd1200` — текущий HEAD рабочего дерева, дерево чистое, коммит `fix(documents): canonicalize invoice-act kopecks (#388)`.
- Состав коммита: изменены `_shared/document-render.ts`, `canonical-document-generate-strict/index.ts`, `document-auto-generate/index.ts`, `generate-from-template/index.ts`; удалены целиком `generate-invoice-act/` (index.ts) и `generate-document-pdf/` (index.ts + встроенный `template.docx`); тесты обновлены.
- Миграций в коммите нет. Изменений фронтенда нет (только тесты в `src/test`).
- В коде нет ни одного вызова удалённых функций (единственные упоминания — тест-гард и старая миграция).
- В БД `edge_functions_registry` до сих пор помечены `enabled=true, must_exist=true`: `generate-invoice-act`, `generate-document-pdf`, `generate-from-template`, `document-auto-generate`, `send-invoice`. Это значит, что nightly health-check будет ругаться на отсутствие удалённых функций.
- Активные шаблоны счёт-акта (`document_type='act'`, `is_active=true`): ФЛ `7caee05d…`, ЮЛ `4fa3160f…`, ИП `bcf5e015…` — у каждого свой `current_version_id`. За 60 дней документы писались только через эти три шаблона (+ «Отчёт об израсходованных денежных средствах»), других генераторов счёт-акта не видно.
- `canonical-document-generate-strict` поддерживает `mode='preview'`, который резолвит токены и возвращает `resolved_tokens`/`source_trace` **без** вызова `allocate_document_number` (номер резервируется только в `mode='generate'`) и без записи в `ai_generated_documents`. Это и есть безопасная контрольная проверка.

## Что деплоить

Канонический Lovable deploy ровно четырёх функций из этого SHA (с checked-in shared imports из `supabase/functions/_shared/`):

1. `canonical-document-generate-strict` — основной production-путь счёт-акта.
2. `document-auto-generate` — автогенерация.
3. `generate-from-template` — legacy-контрактный путь, ещё живой.
4. Пересборка shared-модуля `_shared/amount-with-words.ts` + `_shared/document-render.ts` происходит вместе с каждой из функций (отдельного деплоя не требует).

Ничего больше не деплоить: `canonical-document-send`, `document-download`, `invoice-*` не менялись.

## Удаление устаревших функций

Директории уже удалены из репозитория, но в Supabase они, вероятно, ещё развёрнуты. Порядок:

1. Проверить логи `generate-invoice-act`, `generate-document-pdf` и `send-invoice` за последние 14 дней. Ноль вызовов — обязательное условие.
2. Только при нулевых вызовах удалить развёрнутые `generate-invoice-act` и `generate-document-pdf` через канонический delete-инструмент. `send-invoice` в этом SHA не удалялся — оставить как есть.
3. Синхронизировать `edge_functions_registry`: снять `must_exist`/`enabled` с двух удалённых имён отдельной managed-миграцией (это единственное изменение БД в рамках rollout; выполняется после подтверждения нулевых вызовов). Без этого шага nightly health-check начнёт давать ложные FAIL.
4. `supabase/functions.registry.txt` уже не содержит удалённых имён — правок не нужно.

## Подтверждение единственного канонического шаблона

- Read-only: перечислить активные шаблоны `document_type='act'` и убедиться, что счёт-актов ровно три (ФЛ/ЮЛ/ИП) и у каждого ровно один `current_version_id`.
- Проверить, что за последние 30 дней `ai_generated_documents` для контекста заказов ссылается только на эти `template_id` и на `template_version_id`, равный `current_version_id`.
- Проверить, что удалённый встроенный DOCX больше не встречается: в `generate-document-pdf` больше нет `template.docx`, а все пути рендера идут через `_shared/document-render.ts`.

## Безопасная контрольная генерация (без отправки и без расхода номера)

Возможна и рекомендуется в таком виде:

1. Выбрать уже оплаченный реальный заказ, у которого счёт-акт **уже сформирован** ранее (номер уже израсходован), с суммой, содержащей копейки (например `…,74`, `…,01`, `…,11`).
2. Вызвать `canonical-document-generate-strict` с `mode='preview'` под сервисной/админской авторизацией. Ответ содержит `resolved_tokens` — проверить токен суммы прописью на формат «100 (сто) рублей, 74 копейки» с правильным склонением. Номер не выделяется, файл не пишется, `ai_generated_documents` не растёт.
3. При необходимости полного файлового доказательства — повторный `mode='generate'` с **тем же** `idempotency_key`, что у уже существующего документа: функция возвращает существующую запись и не выделяет новый номер. Новый номер расходовать не требуется.
4. Отправка клиенту не выполняется ни в одном шаге: `canonical-document-send` не вызывается.

## Порядок исполнения

1. Гейты: exact SHA `478d6985f`, чистое дерево, `tsgo --noEmit` PASS, `vite build` PASS, `vitest` по `src/test/invoiceActCanonicalAmountWords.test.ts` PASS.
2. Логи по трём legacy-функциям за 14 дней (read-only).
3. Deploy четырёх функций.
4. Read-back деплоя: OPTIONS/CORS 200, вызов без JWT 401 для каждой задеплоенной функции.
5. Preview-проверка суммы прописью на 3–4 суммах (`,74`, `,01`, `,11`, `,00`).
6. Удаление двух устаревших функций + миграция синхронизации реестра.
7. Read-back: реестр не содержит `must_exist` для удалённых, nightly health-check не даёт новых FAIL.
8. Publish фронтенда не требуется (в SHA нет изменений `src/` кроме тестов) — выполнять только если пользователь явно попросит выровнять фронтенд-SHA.

## Stop conditions

- SHA не совпадает, дерево не чистое, typecheck/build/тесты FAIL.
- Любой вызов `generate-invoice-act` или `generate-document-pdf` в логах за 14 дней → удаление не выполняется, деплой остальных функций допустим.
- Ошибка деплоя любой из четырёх функций → откат к предыдущей версии, дальше не идти.
- Preview показывает пустой/некорректный токен суммы прописью или `can_generate=false` для контрольного заказа.
- Появление незапланированного DDL/DML, изменение `document_templates`, рост `ai_generated_documents` или `document_number_sequences` во время проверок.
- Любой critical finding сканера в scope документов.

## DoD

- Три активных шаблона счёт-акта, один канонический renderer, ноль встроенных DOCX в функциях.
- Сумма прописью в превью и в существующем документе — с явной корректно склонённой копеечной частью.
- Удалённые функции отсутствуют и в коде, и в деплое, и в `edge_functions_registry`.
- Номера документов не израсходованы, клиенту ничего не отправлено, реальные данные не изменены.
