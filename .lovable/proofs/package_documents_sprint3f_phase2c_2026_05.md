# Sprint 3F Phase 2c — proof (2026-05-28)

## ВЫПОЛНЕНО

### 1. Консолидация UX «Пакеты документов»
- Удалена отдельная админ-вкладка `pkg-admin` из `AiPageContent.tsx`.
- Всё управление конкретным пакетом теперь живёт внутри вкладки
  «Пакеты документов» через `PackagesWorkspace.tsx`:
  - **Состав** (`PackageContentsList`) — read-only список привязанных шаблонов.
  - **Шаблоны пакета** (`TemplateBindingControl`, admin-only) — bind/unbind через RPC.
  - **Анкета пакета** (`DocumentPackageIdeologyView`) — без изменений по сути.
  - **Роли пакета** (`PackageRolesManager`, admin-only) — упрощённая форма.
  - **Проверка шаблонов** (`PackageTemplateValidationPanel`, admin-only) — без генерации.
- Селектор пакетов сверху; не-активные пакеты в селекторе показаны как
  «появится позже» (disabled), без отдельной админки.

### 2. Загрузка шаблонов из общей вкладки «Шаблоны документов»
- `StrictDocumentTemplatesManager.tsx`: добавлен переключатель
  «Тип документа» — Биллинговый / Пакетный.
- При выборе «Пакетный» открывается селектор пакета; после успешного
  INSERT шаблона выполняется
  `supabase.rpc("package_template_bind_template", …)`.
- Никаких direct INSERT в `document_package_template_items` и
  никаких ручных правок `document_templates.template_scope`.

### 3. Упрощённая форма роли (PKR)
- `PackageRolesManager.tsx`: видны только «Название» и «Описание».
  Технические поля (`role_key`, `output_template`, `min/max_count`,
  `allowed_entity_types`, `sort_order`) скрыты — назначаются дефолтами
  и триггерами БД.
- `usePackageRoleCatalog.create` slugify-ит `role_key` per-package
  и обеспечивает уникальность; `public_id` (PKR-XXXXXX) выдаётся
  BEFORE INSERT триггером (Phase 2 миграция).

### 4. Inline-создание роли из анкеты
- Новый компонент `packages/InlineCreateRoleDialog.tsx`.
- Виден внутри dropdown «Роль участника» в `DocumentPackageIdeologyView`
  только для admin/super_admin (через `useRbac`).
- При создании:
  - инвалидируется и админский каталог (`package-role-catalog`),
    и каталог анкеты (`doc-package-role-catalog`);
  - роль автоматически выставляется выбранному физлицу
    (callback `onCreated(roleKey)`).
- В форме только Название + Описание; всё остальное — дефолты
  (`allowed_entity_types=["person"]`, `is_system=false`,
  `is_active=true`).

### 5. Валидация в админской подвкладке
- `PackageTemplateValidationPanel` теперь живёт под подвкладкой
  «Проверка шаблонов» конкретного пакета (Phase 2b логика без изменений):
  читает DOCX через `mammoth`, классифицирует токены
  valid / warning / error, **не вызывает** `canonical-document-generate-strict`,
  Gotenberg, не пишет в `ai_generated_documents`.

## ЗАПРЕТЫ — перепроверка

```
$ rg -n "canonical-document-generate-strict|gotenberg|ai_generated_documents" \
    src/components/ai-documents/packages/ \
    src/components/ai-documents/DocumentPackageIdeologyView.tsx
(пусто)

$ rg -n "from\(\"document_package_template_items\"\)\s*\.\s*(insert|delete|update)" \
    src/components/ai-documents/
(пусто — все мутации через RPC)

$ rg -n "template_scope\s*[:=]" \
    src/components/ai-documents/ src/hooks/
(только чтение и установка scope='package' внутри RPC-параметров)

$ rg -n "pkg-admin" src/
(пусто — отдельная админ-вкладка удалена)
```

## Billing regression — нетронуто
- `src/components/ai-requisites/`, `useLegalDetails*`, `useAiEntities*`,
  `useAiPersons*` — БЕЗ ИЗМЕНЕНИЙ.
- `supabase/functions/canonical-document-generate-strict/` —
  БЕЗ ИЗМЕНЕНИЙ.
- `supabase/functions/_shared/resolve-package-tokens.ts`
  (`HARDCODED_ENABLED=false`) — БЕЗ ИЗМЕНЕНИЙ.
- Группы плейсхолдеров «Заказчик ЮЛ/ИП/ФЛ», «Исполнитель ЮЛ» в
  каталоге не модифицированы.
- `package.*` токены в billing-резолвере по-прежнему не разрешены
  (резолвер не трогали).
- Биллинговые шаблоны открываются так же, как раньше: scope='billing'
  по умолчанию в `StrictDocumentTemplatesManager`.

## DoD Phase 2c
- [x] Отдельная вкладка «Админ. пакеты» удалена.
- [x] Всё управление пакетом находится внутри «Пакеты документов».
- [x] Шаблоны загружаются во вкладке «Шаблоны документов» с выбором пакета.
- [x] Bind/unbind — только через admin-only RPC, с audit (триггер Phase 2).
- [x] Роль создаётся одной формой «Название + Описание».
- [x] Inline «+ Создать новую роль» работает прямо из dropdown анкеты.
- [x] Канонический токен роли: `{{package.role.PKR-XXXXXX}}`.
- [x] Validation report не запускает генерацию.
- [x] Все UI-labels на русском.
- [x] `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`,
  billing-резолвер — нетронуты.

## Файлы
- created `src/components/ai-documents/packages/InlineCreateRoleDialog.tsx`
- edited  `src/components/ai-documents/DocumentPackageIdeologyView.tsx`
  (импорт `InlineCreateRoleDialog` + admin-only inject в dropdown ролей)

(созданные в этой сессии ранее: `PackagesWorkspace.tsx`,
`PackageContentsList.tsx`, правки в `StrictDocumentTemplatesManager.tsx`,
`PackageRolesManager.tsx`, `AiPageContent.tsx` — см. предыдущий ответ.)

## Следующий шаг
Sprint 3G: контролируемый dry-run генерации одного пакета
(`HARDCODED_ENABLED` остаётся `false` до отдельного approve).
