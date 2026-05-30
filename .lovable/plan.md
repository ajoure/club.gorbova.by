План правильный. Я бы утвердил **с небольшими правками**, чтобы не было ложных FAIL на скачивании и run_mode.

да, согласен, с учетом правок:

**1.**

**user_generate**

**не требовать как обязательный network body**

Если backend-контракт для пользовательского запуска — дефолтный режим, то user-кнопка должна отправлять:

{ "package_session_id": "..." }

А не обязательно:

{ "package_session_id": "...", "run_mode": "user_generate" }

В proof писать фактический body из network request.  
Admin-кнопка — обязательно:

{ "package_session_id": "...", "run_mode": "admin_test" }

&nbsp;

**2. Проверку скачивания делать на trusted**

***.[gorbova.by](http://gorbova.by)**

**, не на preview**

После фикса origin скачивание корректно работает на:

[club.gorbova.by](http://club.gorbova.by)

[gorbova.by](http://gorbova.by)

*.[gorbova.by](http://gorbova.by)

На preview/lovable-доменах может быть fallback на canonical [gorbova.by](http://gorbova.by), и session может не совпасть. Поэтому в proof для скачивания использовать именно [club.gorbova.by](http://club.gorbova.by) или другой trusted *.[gorbova.by](http://gorbova.by).

&nbsp;

**3. Не требовать именно HEAD**

DocumentDownloadPage может нормально работать через GET, но не поддерживать HEAD.

DoD заменить на:

DOCX/PDF download: GET или browser-click возвращает HTTP 200, файл size > 0.

HEAD использовать только если реально поддерживается.

&nbsp;

**4. Legacy**

**DocumentPackageIdeologyView**

Если rg "DocumentPackageIdeologyView" src/** показывает 0 реальных usage — удалить файл и import.

Если есть остаточная ссылка — не удалять, а добавить в файл явный комментарий:

// @deprecated Phase 3I-C: legacy package UI, do not add new logic here.

Новая логика туда больше не добавляется.

&nbsp;

**5. История генераций**

В PackageGenerationHistory обязательно скрыть технический JSON по умолчанию.

Показывать пользователю только:

- дата;
- режим: «Обычная генерация» / «Тестовая генерация»;
- статус по-русски;
- количество документов;
- DOCX/PDF;
- ошибки по-русски.

Технические данные — только admin/debug, если уже есть такой режим.

&nbsp;

**6. Русификация**

Проверить не только видимые тексты, но и:

- toast success/error;
- Alert;
- empty-state;
- подписи статусов generated / partial / failed / blocked;
- ошибки из edge-кодов.

Сырые коды типа package_session_id_required, role_assignment_missing, blocked не показывать пользователю без русской расшифровки.

&nbsp;

**7. Proof**

В proof добавить отдельную строку:

/admin/documents открыт без runtime console errors.

И отдельно:

Phase 3I-C is frontend-only: git diff не содержит supabase/functions/**, supabase/migrations/**, /purchases, purchaseDocumentRules.

&nbsp;

**8. Финальный статус**

При PASS зафиксировать:

completed: Phase 3I-C cleanup and UX polish completed;

legacy package UI removed or deprecated;

generation history polished;

user-flow smoke passed;

DOCX/PDF download works on trusted *.[gorbova.by](http://gorbova.by) origin;

backend pipeline, migrations, Gotenberg, billing documents untouched.

**DoD остается:**

- legacy view удалён или явно deprecated с grep-proof;
- все новые user-facing тексты на русском;
- история показывает дату/режим/статус/документы/DOCX/PDF;
- user-flow smoke пройден: анкета → генерация → скачивание;
- proof-файл создан;
- git diff — только frontend.

Главная правка: скачивание проверять не через HEAD и не на preview-домене, а через реальный GET/browser-click на [club.gorbova.by](http://club.gorbova.by) или другом trusted *.[gorbova.by](http://gorbova.by).

&nbsp;

# План: Phase 3I-C — Cleanup + UX polish (frontend-only)

Backend, миграции, edge functions, Gotenberg, billing-документы и `/purchases` НЕ трогаем. Только UI-чистка, тексты, отображение истории и финальный proof.

## Шаги

### 1. Законсервировать legacy `DocumentPackageIdeologyView`

- `rg "DocumentPackageIdeologyView"` по `src/**` — собрать все usages.
- Ожидаемо: только `PackagesWorkspace.tsx` (import) уже не использует его в активных табах. Подтвердить grep-proof.
- Если usages нет — удалить файл `src/components/ai-documents/DocumentPackageIdeologyView.tsx` и его import.
- Если есть остаточные ссылки в dead-роутах — пометить заголовком `@deprecated Phase 3I-C` и не добавлять новой логики.

### 2. Русификация ошибок и warnings

Пройти по новым компонентам Phase 3I:

- `PackageGenerationPanel.tsx`
- `PackageGenerationHistory.tsx`
- `useAiDocumentPackageGeneration.ts`
- `DocumentPackageQuestionnairesView.tsx` (preflight messages)

Проверить toast/Alert/empty-state тексты: только русский, без сырых кодов вида `package_session_id_required`. Маппинг технических кодов в человеческие фразы через локальный helper (без правки backend контракта).

### 3. Улучшить отображение истории генераций

В `PackageGenerationHistory.tsx`:

- Колонки/строки batch: дата (локаль ru, `dd.MM.yyyy HH:mm`), режим (бейдж `admin_test` / `user_generate`), статус (`generated`/`partial`/`failed`/`blocked` с цветовым бейджем), счётчик `generated/total`.
- Раскрытие batch: список документов с номером, датой, статусом и кнопками DOCX / PDF (через `getDocumentDownloadUrl`, уже фикснутый origin).
- Фильтр по `meta->>package_session_id` сохранить.
- Пустое состояние: «Пока нет ни одной генерации для этого пакета».

### 4. User-flow smoke (preview)

- `navigate_to_sandbox` → `/admin/documents → Пакеты документов → Идеология`.
- Анкеты: убедиться, что выбранное ЮЛ гидратируется на reload.
- Вкладка «Генерация»: preflight зелёный → клик «Сформировать пакет документов» (user_generate).
- Дождаться завершения, проверить «Last Run Result» и историю.
- Скачать DOCX и PDF с текущего origin (`club.gorbova.by` / preview) — HTTP 200, файл > 0.

### 5. Финальный proof

Новый файл `.lovable/proofs/sprint_3i_c_closeout_2026_05.md`, 6 секций:

1. Grep-proof legacy `DocumentPackageIdeologyView` (удалён или законсервирован).
2. Скрин «Генерация»: preflight + кнопки.
3. Network request user_generate (POST `ai-generate-document-package`, body `{ package_session_id }`).
4. Скрин «Last Run Result» + истории с режимом/статусом/датой.
5. HTTP 200 для DOCX и PDF (curl HEAD), origin = текущий `*.gorbova.by`.
6. `git diff --name-only` — только frontend; нет `supabase/functions/**`, `supabase/migrations/**`, `purchaseDocumentRules*`, `/purchases*`, Gotenberg.

Обновить `.lovable/plan.md`: Phase 3I-B → CLOSED (со ссылкой на 3I-B proof), Phase 3I-C → DONE (со ссылкой на новый proof). Memory не обновляется (архитектура не меняется).

## Что НЕ делаем

- Не меняем backend, RPC, edge functions, миграции, storage, Gotenberg.
- Не трогаем `/purchases`, `purchaseDocumentRules`, биллинговые шаблоны и группы плейсхолдеров.
- Не меняем контракт `ai-generate-document-package` (`{ package_session_id, run_mode? }`).
- Не добавляем новую логику в legacy `DocumentPackageIdeologyView`.

## DoD

- Legacy view удалён или явно `@deprecated` с grep-proof.
- Все user-facing тексты в новых компонентах на русском.
- История показывает дату/режим/статус/документы с рабочими DOCX/PDF ссылками.
- User-flow smoke пройден: анкета → генерация → скачивание.
- Proof-файл из 6 секций приложен, `git diff` — только frontend.