## да, согласен, с учетом правок:

1. Перед реализацией определить фактическую точку UI после Sprint 3G/3I. Не привязываться слепо к `DocumentPackageIdeologyView.tsx`, если текущая рабочая структура уже `PackagesWorkspace / DocumentPackageQuestionnairesView`.

2. Кнопки генерации разместить внутри `Пакеты документов → Идеология`: во вкладке «Анкеты документов» и/или «Состав». Не создавать новую верхнюю вкладку.

3. Перед вызовом edge прочитать фактический контракт `ai-generate-document-package`. Пользовательская кнопка отправляет `{ package_session_id }`. Admin-кнопка отправляет `{ package_session_id, run_mode: "admin_test" }`, если именно это значение поддерживает backend.

4. В истории использовать фактическую таблицу `ai_document_generation_batches`, не `ai-document-generation-batches`.

5. Связь batch → documents делать через `ai_generated_documents.generation_batch_id = batch.id`. Fallback через `context_type='package_session' + context_id` использовать только если прямой связи нет.

6. Историю фильтровать по текущей package session, а не только по `package_template_id`, чтобы не смешивать разные генерации одного пакета.

7. Frontend preflight не должен дублировать backend-orchestrator. UI проверяет только очевидные условия, а финальные blockers/errors берёт из ответа `ai-generate-document-package`.

8. DOCX/PDF ссылки брать из ответа edge или из `ai_generated_documents`. Не собирать storage URL вручную, если есть готовые поля/существующий helper.

9. Добавить защиту от double-click: пока `isGenerating=true`, обе кнопки disabled, показывается spinner.

10. Для `run_mode='admin_test'` показывать бейдж «Тестовая генерация» в результате и истории.

11. В истории показывать простой русский UI: дата, статус, режим, документы, DOCX/PDF, ошибки. Технический JSON скрыть, максимум под admin/debug.

12. Proof должен подтвердить frontend-only scope: `git diff --name-only` не содержит `supabase/functions/**` и `supabase/migrations/**`.

13. `/purchases`, billing UI, `purchaseDocumentRules`, billing/order documents не трогать.

DoD остаётся:

- пользователь может сформировать пакет;

- admin может тестово сформировать пакет;

- результат по каждому документу виден с DOCX/PDF;

- история генераций доступна;

- backend pipeline не меняется;

- billing/order generation не затронута.

&nbsp;

План: Phase 3I-B — UI запуска пакетной генерации

### Цель

Подключить в `Пакеты документов → Идеология` рабочие кнопки запуска генерации пакета через существующую edge-функцию `ai-generate-document-package`. Backend pipeline не трогаем.

### Граница изменений

- **Только frontend** (`src/components/ai-documents/...`, `src/hooks/...`).
- **Edge-функции, миграции, storage, Gotenberg, `canonical-document-generate-strict`, `ai_generated_documents` write-path — НЕ трогаем.**
- Billing/order documents (вкладка `/purchases`, `purchaseDocumentRules`) — не трогаем.

---

### 1. Блок C «Сформировать пакет» в `DocumentPackageIdeologyView.tsx`

Заменить текущий disabled-stub (строки 402–431) на рабочий блок с:

**1.1. Preflight-сводка** (read-only, без сетевых вызовов — данные уже есть в `pkg`):

- Шаблон: `pkg.template.name` + кол-во items.
- Роли: список обязательных ролей со статусом satisfied/missing (уже есть `requiredRolesStatus` выше).
- Warnings/blockers:
  - blocker если `!allRequiredSatisfied` → кнопка disabled с tooltip;
  - blocker если `!pkg.session` (не сохранено) → подсказка «сначала сохраните анкету»;
  - warning если есть items без bound template (читаем из `pkg.items`).

**1.2. Кнопка пользователя** «Сформировать пакет документов»:

- `disabled` пока есть blockers или `isGenerating`.
- Вызов `generatePackage({ package_session_id: pkg.session.id })` (run_mode по умолчанию `user_generate`).

**1.3. Кнопка администратора** «Тестово сформировать пакет»:

- Видна только если `isAdmin` (уже вычисляется в файле).
- Вариант `variant="outline"`, иконка `FlaskConical`.
- Вызов `generatePackage({ package_session_id: pkg.session.id, run_mode: "admin_test" })`.

**1.4. Результат последнего запуска** (локальный state `lastResult: PackageGenerationResult | null`):

- Сводка: `status`, `generated / total`, `errors`, `blocked`.
- Таблица по items: название документа (резолвим из `pkg.items` по `item_id`), статус-бэйдж, ссылки DOCX/PDF (`download_url`), список `errors[]`.
- DOCX и PDF: используем `download_url` + помощник `buildDocumentDownloadUrl` (если нужен PDF-вариант, читаем из `results[].pdf_url` если контракт его уже отдаёт; иначе только DOCX, как возвращает orchestrator сейчас).

---

### 2. Новый компонент `PackageGenerationHistory.tsx`

Путь: `src/components/ai-documents/packages/PackageGenerationHistory.tsx`.

Содержание:

- Сворачиваемая секция «История генераций» под блоком C.
- React Query: `ai-document-generation-batches` по `package_template_id = pkg.templateId` AND `profile_id = currentUser` (для пользователя), без фильтра по profile — для админа. Сортировка `created_at desc`, лимит 20.
- Для каждой batch: дата, `status`, `meta.run_mode`, кнопка «Раскрыть».
- При раскрытии — подзапрос `ai_generated_documents` по `meta->>'batch_id' = batch.id` (или по `context_type='package_session'` + `context_id`); показать список документов со ссылками DOCX/PDF (`storage_path` через существующий `buildDocumentDownloadUrl`/`downloadDocumentBlob`).
- Никаких новых RPC, только select из уже существующих таблиц.

Перед написанием — уточнить точное поле связи batch↔documents чтением `ai-generate-document-package/index.ts` (как orchestrator проставляет batch_id в `ai_generated_documents.meta`). Если связи нет — фильтровать по `context_id = package_session_id` + временной диапазон ≥ `batch.created_at`.

---

### 3. Хук `useAiDocumentPackageGeneration.ts`

Минимальные правки:

- Расширить `PackageGenerationItemResult` опциональными полями `pdf_url?`, `docx_url?`, `item_label?` если orchestrator их уже возвращает (проверить чтением `index.ts`).
- В `onSuccess` дополнительно инвалидировать `["ai-document-generation-batches", templateId]`.
- Возвращать `data` из мутации, чтобы view сохранил `lastResult` (уже работает через `mutateAsync`).

---

### 4. UX-детали

- Spinner на кнопке во время `isGenerating`.
- Тосты: success / partial / error (уже есть в хуке).
- Ошибки — через `normalizeEdgeFunctionError` (согласно core rule «UI/UX Error Handling»).
- Иконки: `Sparkles` (user), `FlaskConical` (admin test), `History` (история), `FileText`/`FileDown` для ссылок.

---

### 5. DoD-чеклист

- User видит блок C с preflight и активной кнопкой при выполненных условиях.
- Клик → orchestrator вызван с `{ package_session_id, run_mode: 'user_generate' }`.
- Admin видит дополнительную кнопку `admin_test`.
- Per-item результат отображается с DOCX/PDF-ссылками и ошибками.
- История последних 20 batches доступна, раскрытие показывает документы пакета.
- `git grep` подтверждает: 0 новых вызовов `Docxtemplater`, `Gotenberg`, INSERT в `ai_generated_documents` со стороны frontend.
- Никаких изменений в `supabase/functions/**`, `supabase/migrations/**`.
- Билд проходит, рантайм-ошибок на `/admin/documents` нет.

---

### Технические детали (для разработчика)

```text
DocumentPackageIdeologyView.tsx
  ├─ GlassCard "Реквизиты"            (без изменений)
  ├─ GlassCard "Анкета пакета"        (без изменений)
  └─ GlassCard "Сформировать пакет"   ← переписываем
       ├─ PreflightSummary (inline)
       ├─ Buttons: [Сформировать] [Тестово (admin)]
       ├─ LastRunResult (per-item table)
       └─ PackageGenerationHistory (new component, collapsible)
```

Файлы:

- `src/components/ai-documents/DocumentPackageIdeologyView.tsx` — переписать блок C (~60 строк).
- `src/components/ai-documents/packages/PackageGenerationHistory.tsx` — новый файл.
- `src/hooks/useAiDocumentPackageGeneration.ts` — мелкие правки (доп. поля + инвалидация).

Никаких изменений в:

- `supabase/functions/ai-generate-document-package/index.ts`,
- `supabase/functions/canonical-document-generate-strict/**`,
- миграциях, RPC, storage policies,
- `purchaseDocumentRules`, `/purchases` UI.