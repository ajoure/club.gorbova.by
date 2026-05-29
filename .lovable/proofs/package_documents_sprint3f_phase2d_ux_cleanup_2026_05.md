# Sprint 3F Phase 2d — UX cleanup пакетов документов

Дата: 2026-05-29

## Что сделано (frontend-only)

1. **Dev dry-run скрыт из обычного UI.** В `DocumentPackageIdeologyView.tsx` рендер `<PackageTokensDryRunPanel />` обёрнут двойным guard: `super_admin` И `?debug=1` в URL. В обычной анкете блока с английскими alias-token больше нет. Компонент в коде сохранён.
2. **Дубль «Состав пакета» убран из анкеты.** Удалён Блок A (`StrictDocumentTemplatesManager embedded readOnly`). Состав отображается только в подвкладке «Состав» (`PackageContentsList`).
3. **Роли пакета: Активные / Архив / Системные.** `PackageRolesManager.tsx` переведён на `Tabs`:
   - **Активные** — `is_active=true AND is_system=false`. Кнопка «Архивировать», поиск по активным.
   - **Архив** — `is_active=false AND is_system=false`. Кнопка «Восстановить». Hard-delete не показывается.
   - **Системные** — `is_system=true`, отдельный свёрнутый `Collapsible`, только просмотр + копирование PKR.
   - Empty state активных: «Ролей пока нет. Добавьте первую роль вручную. После создания роль получит свой PKR-плейсхолдер для вставки в Word.»
4. **Inline «+ Добавить роль» из анкеты** — реализовано ранее (`InlineCreateRoleDialog`), форма только «Название» + «Описание».
5. **Каталог плейсхолдеров → группа «Пакет: Роли»** — `buildPackageRoleItems` уже строит только `{{package.role.PKR-XXXXXX}}`; legacy `package.roles.<key>.<attr>` в UI каталога отсутствует (см. `packagePlaceholderCatalog.test.ts`).
6. **Загрузка шаблона с привязкой к пакету** — `StrictDocumentTemplatesManager` уже поддерживает выбор «Биллинговый/Пакет» и вызывает `package_template_bind_template`.

## Инварианты

- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, `record_refund_atomic`, billing resolver, биллинговые шаблоны и FLD — **не тронуты**.
- Никаких изменений в `_shared/resolve-package-tokens.ts` (HARDCODED_ENABLED=false).
- Никаких изменений в типах базы.

## Файлы

- edited `src/components/ai-documents/DocumentPackageIdeologyView.tsx`
- edited `src/components/ai-documents/packages/PackageRolesManager.tsx`
