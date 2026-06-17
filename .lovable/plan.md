# да, согласен, с учетом правок:

1. **Исправить runtime-сценарий для «Идеологии».** По Stage 1 в активных шаблонах «Идеологии» нет detected `pf-*`. Поэтому проверять:
  - общий orphan-блок `pf-000002`;
  - внутри карточек — роли;
  - блок «Поля документа» отсутствует или показывает корректное пустое состояние.
  Формулировка «orphan-поля + детектированные поля + роли» для текущей «Идеологии» неверна.
2. **Версию шаблона передавать по фактической активной связи item.** `_expected_template_version_id` брать из:
  &nbsp;
  ```text
  document_package_template_item
  → document_template
  → active_version_id
  ```
  а не из случайной текущей или последней загруженной версии. При отсутствии активной версии сохранение блокируется предметной ошибкой.
3. **Не смешивать field patch и effective fallback.** `getDirtyPatch()` должен возвращать только явно изменённые per-item значения:
  - session-level fallback не отправлять как новый override;
  - неизменённый smart-date prefill не отправлять до явного изменения/сохранения;
  - reset override не кодировать пустым значением — использовать существующую отдельную RPC.
4. **Role payload должен быть полным desired-state конкретного item.** Даже при изменении только полей в atomic RPC необходимо передать текущий полный набор управляемых ролей item, иначе пустой или неполный массив может архивировать существующие назначения. Перед вызовом различать:
  &nbsp;
  ```text
  roles not loaded
  roles loaded and empty
  roles loaded with assignments
  ```
  Сохранение запрещено, пока desired-state ролей не гидратирован.
5. **Использовать фактический контракт ролей Stage 2 RPC.** Проверить реальные названия ключей и идентификаторов. Не вводить в UI условный `role_catalog_id`, если SOT использует `link_id`, `package_role_link_id` или иной канонический идентификатор. Payload должен 1:1 соответствовать доказанному runtime-контракту RPC.
6. **Dirty-state карточки объединить корректно:**
  &nbsp;
  ```text
  isDirty = fieldsDirty || rolesDirty
  ```
  После успешного atomic save:
  - обновить baseline обоих локальных draft;
  - снять dirty-state;
  - обновить прогресс;
  - не ждать полной перезагрузки карточки.
  При ошибке оба draft и dirty-state сохраняются.
7. **Не вызывать atomic RPC при clean-state.** Кнопка отключена при:
  - `!isDirty`;
  - загрузке полей или ролей;
  - отсутствии session/item/activeVersion;
  - незавершённой гидратации desired-state;
  - текущем `isSaving`.
8. **Старые write-path должны быть действительно отключены только внутри карточки.** После перехода:
  - `fieldsRef.submit()` не вызывается;
  - отдельный role `save()` не вызывается;
  - orphan session-level форма продолжает использовать свой существующий save-path;
  - другие административные экраны, использующие эти hooks, не ломаются.
9. **Инвалидация должна происходить один раз через** `useAtomicDocumentSave`**.** Не дублировать invalidation дополнительно в карточке или дочерних формах. После успеха обновить:
  - per-item field values;
  - role assignments;
  - package session/readiness;
  - generation gate.
10. **Одна карточка не должна создавать повторные независимые запросы ко всему пакету без необходимости.** Общие данные `session`, `items`, `persons`, `activeRoles`, detection map предпочтительно получить в родителе и передать props. Внутри карточки оставлять только item-specific state/mutations, чтобы новый пакет с большим числом документов не создавал N одинаковых запросов.
11. **Сохранить ранее утверждённый клиентский UI-контракт:**

- не показывать `pf-*`, `ln-*`, `FLD-*`, `PKR-*`;
- `X/Y полей` — только detected fields item;
- `K/N ролей` — назначенные/обязательные роли этого item;
- состояния `готово / частично / пусто`;
- отдельный индикатор `Сохранено / Есть несохранённые изменения`;
- «заполнено» и «сохранено» не смешивать.

12. **Не использовать** `GlassCard`**, если это не существующий канонический компонент проекта.** Сначала переиспользовать фактическую карточку/accordion-pattern платформы. Не создавать новый визуальный примитив только для этого раздела.
13. **Проверить мобильную карточку:**

- кнопка не перекрывает поля;
- DatePicker/Select не обрезаются контейнером;
- длинное название документа переносится;
- бейджи не ломают заголовок;
- сохранение доступно при открытой клавиатуре.

14. **Добавить тесты интеграции карточки:**

- dirty fields only → один atomic RPC;
- dirty roles only → один atomic RPC;
- fields + roles → один atomic RPC;
- clean → RPC не вызывается;
- server error → baseline не меняется, dirty сохраняется;
- stale version → точная ошибка;
- orphan не попадает в payload;
- роли другого item не попадают в desired-state;
- после success старые последовательные mutations не вызываются.

15. **Runtime proof дополнить network и DB-фактами:**

- в Network ровно один `save_session_document_atomic`;
- отдельных `upsert_session_field_values` и role-save от карточки нет;
- audit появляется одной записью;
- поля и роли изменены в одной операции;
- orphan session-level row не изменён;
- одинаковый компонент фактически работает в двух отдельных сессиях «Идеологии» и «Годового собрания».

Остальной порядок сохраняется: извлечение единой карточки → atomic wiring → тесты и runtime proof → Stage 6 нового пакета → Stage 7 orphan transition.

&nbsp;

План: Stage 5 — unified PackageDocumentCard

## Контекст

Сейчас карточка документа существует как локальный компонент `ItemQuestionnaire` внутри `DocumentPackageQuestionnairesView.tsx` (~575 строк, оба пакета — «Идеология» и «Годовое собрание» — уже идут через один и тот же путь). Поведение единое по контракту (Stage 1 PASS), но:

- `ItemQuestionnaire` не вынесен как отдельный переиспользуемый компонент;
- сохранение полей и ролей идёт двумя последовательными вызовами (`fieldsRef.current.submit()` → `save(payload)`), не использует Stage 2 RPC `save_session_document_atomic`;
- между сохранением полей и ролей возможна частичная фиксация (поля записаны, роли упали) — это и есть причина, ради которой Stage 2 RPC создавался;
- визуальная структура карточки (бейджи прогресса, секции «Поля документа» / «Роли документа», кнопка сохранения) дублируется логикой, но не имеет единого корня для редизайна.

DoD редизайна (по утверждённому scope): единый `PackageDocumentCard` работает для обоих существующих пакетов без специальных условий по UUID/названию и для любого нового пакета.

## Что делаем

### 1. Извлечь `PackageDocumentCard`

Файл: `src/components/ai-documents/packages/PackageDocumentCard.tsx`.

Полностью переносим текущий `ItemQuestionnaire` (props, hydrate, draft state, бейджи, секции) — без изменений поведения. Внутри карточки используются те же хуки:

- `usePackageSessionFields` — детектированные поля документа (`byItemId[item.id]`);
- `useDocumentItemRoleAssignments` — текущие role assignments документа;
- `PackageFieldsClientForm` — рендер полей (внутренний компонент, без редизайна на этом этапе).

Orphan-блок остаётся на уровне `DocumentPackageQuestionnairesView` (Stage 1 контракт): карточка про orphan не знает и не показывает orphan-поля.

### 2. Подключить atomic save через Stage 2 RPC

Меняем `handleSaveAll` так, чтобы поля и роли уходили одним вызовом `useAtomicDocumentSave` (Stage 2). Контракт payload:

- `session_id`, `package_template_item_id`, `template_version` (берётся из `usePackageSessionFields`/`useDocumentItemRoleAssignments`);
- `field_values`: sparse-патч только для полей, реально присутствующих в шаблоне этого документа (`byItemId[item.id]`); orphan-поля в этот payload не попадают никогда;
- `role_assignments`: desired-state массив `{role_catalog_id, person_id, position}` — отсутствующие в массиве роли архивируются Stage 2 RPC автоматически.

После успешного RPC: единая инвалидация кешей (через хук), один тост, один индикатор `isSaving`. При ошибке RPC — ни поля, ни роли не зафиксированы (Stage 3 rollback proof).

`PackageFieldsClientForm` в режиме `hideSaveButton` остаётся источником значений; вытаскиваем dirty-патч через ref (`getDirtyPatch()` — добавить, если ещё нет) и передаём в atomic-payload вместо вызова собственного `submit()`. Внутренняя запись из `PackageFieldsClientForm` отключается, когда карточка работает в atomic-режиме.

### 3. Унифицированная вёрстка карточки (минимальный редизайн)

В рамках утверждённого scope — без смены визуального языка, только консолидация:

- единый `GlassCard`-обёртка для документа (вместо `AccordionItem` без рамки) с заголовком: `#sort_order` + иконка + название документа + бейджи `fields_progress`, `roles_progress`;
- две секции внутри: «Поля документа» (если `hasFields`) и «Роли документа»;
- одна кнопка `Сохранить документ` внизу карточки, единый `disabled = !isDirty || isSaving`;
- состояния `loading / empty roles / empty fields` — общие для обоих пакетов.

Никаких веток по `package_template_id`, названию или UUID — карточка получает только `item`, `sessionId`, `packageTemplateId`, `activeRoles`, `persons`.

### 4. Подключить новый компонент в `DocumentPackageQuestionnairesView`

Удаляем локальный `ItemQuestionnaire`, заменяем на `<PackageDocumentCard ... />` в `items.map`. Orphan-блок и заголовок секции — без изменений (Stage 1 контракт сохранён).

### 5. Diagnose → Dry run → Verify

- runtime-проверка в превью на «Идеологии» (есть orphan-поля + детектированные поля + роли) и «Годовом собрании» (только детектированные поля + роли);
- сценарии: dirty fields only / dirty roles only / both / no changes → один atomic вызов, корректные бейджи прогресса после сохранения, orphan-значение продолжает храниться на session-level и не появляется в payload документа;
- проверка, что `save_session_document_atomic` действительно вызывается (network log) и старый последовательный путь больше не используется.

## DoD

- `PackageDocumentCard` — единственная точка рендера карточки документа в обоих пакетах;
- сохранение поля+роли документа = один atomic RPC вызов;
- orphan-поля не попадают в per-item payload ни при каких условиях;
- никаких ветвлений по названию пакета / UUID;
- Stage 1 контракт (`byItemId` / `orphanCatalogIds`) сохранён;
- готово к Stage 6 (новый пакет E2E) и Stage 7 (orphan transition).

## Технические детали

- Новый файл: `src/components/ai-documents/packages/PackageDocumentCard.tsx`.
- Изменение: `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx` — удалить `ItemQuestionnaire`, импортировать новый компонент.
- Возможное расширение: `src/components/ai-documents/packages/PackageFieldsClientForm.tsx` — добавить `getDirtyPatch()` к `PackageFieldsSubmitHandle` для отдачи sparse-патча в atomic-payload (без записи в БД из формы).
- Использовать существующий `useAtomicDocumentSave` (Stage 2).
- Артефакты proof: `.lovable/proofs/stage5_unified_package_document_card.md` + обновление `.lovable/plan.md`.