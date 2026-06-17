# Stage 5 — unified PackageDocumentCard (code-complete)

Patch: PATCH-PACKAGE-CROSS-PARITY-V1
Status: implementation PASS, runtime proof PENDING

## Что сделано

1. **Извлечён `PackageDocumentCard`** (`src/components/ai-documents/packages/PackageDocumentCard.tsx`) — единая
   карточка документа для любого пакета. Никаких ветвлений по `package_template_id`, названию или UUID.
   Используется в `DocumentPackageQuestionnairesView` для всех элементов `items.map`.

2. **Atomic save через Stage 2 RPC.** Карточка вызывает `useAtomicDocumentSave` ровно один раз на нажатие
   «Сохранить документ». Payload:
   - `fields` — `getDirtyPatch()` от `PackageFieldsClientForm` (только явно изменённые пользователем pf-поля
     этого item; orphan-поля по контракту формы сюда не попадают);
   - `rolesDesired` — ВСЕГДА полный desired-state ролей этого item (даже если dirty только поля), иначе
     `save_session_document_atomic` архивирует все существующие назначения (см. `v_kept_ids` unconditional
     UPDATE);
   - `expectedTemplateVersionId` — `document_templates.active_version_id` шаблона item (фетчится в
     `itemsQuery`). При отсутствии активной версии save заблокирован, в шапке карточки бейдж
     «нет активной версии».

3. **Dirty-state и canSave.**
   - `isDirty = fieldsDirty || rolesDirty`. `fieldsDirty` приходит из формы через новый
     `onDirtyChange` callback. `rolesDirty` — diff (`role_catalog_id|person_id|position`) draft vs baseline.
   - `canSave = isDirty && !rolesLoading && !fieldsState.isLoading && rolesHydrated && hasActiveVersion && !isPending`.
   - При clean-state кнопка disabled, RPC не вызывается.

4. **После успешного atomic save:**
   - `fieldsRef.current?.markSaved()` — формы поля очищают `dirtyFields`, новый baseline = текущий draft;
   - роли: baseline := draft;
   - toast `«Анкета документа сохранена»`;
   - инвалидация кешей — один раз внутри `useAtomicDocumentSave.onSuccess` (per-item field values,
     per-item role assignments, gen-role-assignments, session query).
   - При ошибке оба draft и dirty-state сохраняются.

5. **Sparse field patch (`getDirtyPatch`):**
   - Возвращает только поля, помеченные пользователем как изменённые через `handleChange`.
   - Smart-date prefill, session-level fallback, неизменённый initial draft — НЕ отправляются.
   - Reset override продолжает использовать существующий RPC `delete_session_field_value`, в atomic не
     вмешивается.

6. **Orphan-блок не тронут.** Контракт Stage 1 сохранён: orphan-секция уровня пакета рендерится в
   `DocumentPackageQuestionnairesView` через `PackageFieldsClientForm orphanOnly`, в карточках не дублируется
   и в per-item payload не попадает.

7. **Legacy путь не вызывается из карточки:** ни `fieldsRef.submit()`, ни прямой
   `useDocumentItemRoleAssignments.save()`. Последний хук используется только для чтения (`assignments`,
   `isLoading`). Старая mutation остаётся доступна для других потенциальных вызовов вне карточки.

## Изменённые/созданные файлы

- created  `src/components/ai-documents/packages/PackageDocumentCard.tsx`
- edited   `src/components/ai-documents/packages/PackageFieldsClientForm.tsx` — добавлены `getDirtyPatch`,
  `markSaved`, `onDirtyChange`, per-field dirty tracking.
- edited   `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx` — удалён локальный
  `ItemQuestionnaire`, подключён `PackageDocumentCard`, `itemsQuery` дополнительно загружает
  `document_templates.active_version_id`.

## Runtime proof — что осталось проверить

Будет выполнено в превью при пользовательской проверке:

- «Идеология»: orphan-блок наверху, в карточках секция «Поля документа» отсутствует (по Stage 1 в активных
  шаблонах нет detected pf-*), роли сохраняются одним atomic RPC.
- «Годовое собрание»: orphan-блока нет; в карточках 7 detected fields + роли; save = один RPC.
- Сценарии: dirty fields only / dirty roles only / both / clean → ровно один `save_session_document_atomic`
  в Network, отдельных `upsert_session_field_values` и role-save от карточки нет; один audit на успешную
  транзакцию; baseline корректно обновляется без перезагрузки.
- Stale template version → точный toast «Шаблон документа был обновлён».

Готово к Stage 6 (новый пакет E2E) и Stage 7 (orphan transition).
