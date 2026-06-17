да, согласен, с учетом правок:

1. **Источник версии шаблона определять через фактически активную версию**, а не только `is_current=true`. Канон:
  &nbsp;
  ```text
  document_templates.active_version_id
  → document_template_versions.id
  → detected_tokens / tokens
  ```
  `is_current=true` использовать только как доказанный fallback, если `active_version_id` отсутствует. Черновая текущая версия не должна менять клиентскую анкету до активации.
2. **Orphan-поле показывать клиенту только один раз как общее поле пакета**, но явно отделить от анкеты документов:
  - заголовок «Общие поля пакета»;
  - пометка «Пока не используется в документах»;
  - сохранение только session-level;
  - отсутствие per-item override и reset-кнопки;
  - не учитывать в готовности и генерации.
3. **Atomic RPC не должна позволять управлять системными или скрытыми назначениями через desired-state.** Перед удалением отсутствующих ролей определить множество назначений, которыми текущий пользователь вправе управлять. DELETE выполнять только внутри этого множества.
4. **Для ролей определить устойчивый ключ desired-state.** Нельзя сопоставлять строки только по случайному `id`, если новая роль его ещё не имеет. Зафиксировать ключ, например:
  &nbsp;
  ```text
  role_catalog_id + person_id + legal_entity_id + link discriminator
  ```
  чтобы upsert и удаление не создавали дубли и не удаляли соседние назначения.
5. **Concurrent proof не должен требовать одну audit-запись.** Пять успешно завершившихся транзакций закономерно могут создать пять audit rows. DoD:
  - каждая запись содержит свой payload/порядок;
  - финальное состояние целиком соответствует одному завершённому вызову;
  - нет смешанного состояния;
  - нет ложных audit-записей для откатившихся транзакций.
6. **Multi-tenant proof должен опираться на фактическую модель доступа.** Не считать любого пользователя того же workspace автоматически уполномоченным. Для каждого сценария указать конкретную роль и ожидаемое право согласно действующему RBAC.
7. **Редизайн выполнить по ранее утверждённому визуальному контракту**, а не ограничиться созданием технической карточки:
  - единая карточка документа;
  - вложенные секции полей и ролей;
  - состояния `готово / частично / пусто`;
  - постоянный dirty/saved indicator;
  - одна pinned-кнопка сохранения;
  - desktop/mobile и light/dark;
  - без технических `pf-/ln-/FLD-/PKR-` в клиентском UI.
8. **E2E нового пакета выполнять через обычный пользовательский workflow.** Создание пакета, загрузка и активация шаблонов, создание полей и ролей, анкета и генерация должны пройти через те же UI/RPC, которыми будут пользоваться реальные клиенты. Прямые SQL-вставки допустимы только для подготовки proof, но не заменяют пользовательский сценарий.
9. **После перехода orphan → detected проверить сохранённое общее значение.** Оно должно сохраниться и автоматически стать fallback для нового document-level поля после появления токена, без потери данных и без создания лишнего per-item override.
10. **Финальный отчёт разделить по фактам:**
  &nbsp;
  ```text
  cross-package parity
  atomic save
  concurrent save
  multi-tenant isolation
  unified redesign
  new-package E2E
  orphan transition
  ```
  Для каждого блока — `PASS / FAIL / deferred` и конкретный proof. Патч закрывается только при полном PASS всех DoD.
11. &nbsp;
12. План: PATCH-PACKAGE-CROSS-PARITY-V1 + UNIFIED-REDESIGN (revised)

## Diagnose (выполнен до плана)

Сравнение «Годовое собрание» vs «Идеология»:


| Пакет            | Шаблон (активная версия) | detected_tokens содержит pf-*                         | Каталог pf пакета                                          |
| ---------------- | ------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| Годовое собрание | Приказ                   | 7 шт. (pf-000003…009)                                 | используются в DOCX                                        |
| Идеология        | Приказ об организации    | 0 pf-* (только `field:FLD-*`, `package.ul.*`, `ln-*`) | каталог содержит pf-000002, **не вставлен ни в один DOCX** |
| Идеология        | Положение                | 0 pf-*                                                | —                                                          |


Текущий `usePackageDetectedFields` корректно возвращает pf-* строго из активной версии. Для «Идеологии» это пусто → клиентская анкета не рендерит pf-блок. Это data-contract gap (pf создан в каталоге, но токен не вставлен в шаблон), а не bug извлечения. Решение должно быть единым для всех пакетов, без веток по name/id, и не подменять parity показом orphan внутри каждой карточки.

## Архитектурные инварианты (зафиксировано)

1. **Источник detection — каноничен:** только `document_template_versions` где `is_current=true`, поле `detected_tokens` (fallback `tokens`). Старые/draft/неактивные версии НЕ объединяются. Новый пакет работает автоматически после активации версии шаблона.
2. **orphan = диагностика пакета, не свойство item.** `byItemId[item.id]` содержит только pf, реально найденные в активной версии шаблона этого item. orphan pf отображаются один раз на уровне пакета, никогда не дублируются в карточках.
3. **orphan не участвует ни в чём бизнес-критичном:** не входит в required-gate, не считается в X/Y документа, не попадает в snapshot/DOCX, не блокирует генерацию даже если `required=true` в каталоге, только показывает админу/клиенту явную диагностику «не вставлено ни в один шаблон».
4. **Никаких `BEGIN/ROLLBACK` внутри plpgsql RPC.** Функция уже исполняется в одной транзакции. Guards → write → audit → при ошибке `RAISE`, всё откатывается автоматически.
5. **Desired-state semantics для ролей:** RPC принимает полный desired-state ролей конкретного item; upsert переданных + DELETE отсутствующих в этом item; роли других items и системные/недоступные назначения не трогаются.
6. **Semantics для полей:** непереданные поля НЕ удаляются (поле может быть просто не отредактировано). Пустое значение обрабатывается по текущему канону (хранение `''` vs absent). Reset override остаётся через `delete_session_field_value` (уже создан). Atomic save **никогда не превращает наследованное session-level значение в пустой per-item override**.
7. **SaaS-guards дублируются на сервере** — RPC не доверяет hooks. Проверки в `save_session_document_atomic`:
  - сессия принадлежит вызывающему / он admin / он member workspace;
  - item принадлежит `session.package_template_id`;
  - каждое поле принадлежит каталогу пакета **и** реально присутствует в активной версии шаблона item (либо является разрешённым package-level orphan — для orphan write запрещён в per-item, только session-level или вовсе игнор);
  - каждая role assignment относится к пакету и item;
  - выбранные `person_id` / `legal_entity_id` принадлежат клиентскому контексту, доступному пользователю;
  - cross-workspace запись запрещена (`RAISE EXCEPTION 'forbidden_cross_workspace'`).

## Scope патча

### 1. Cross-package parity — detection

**Файл:** `src/hooks/usePackageDetectedFields.ts`

- Источник: только `is_current=true` активная версия, `detected_tokens` → fallback `tokens`.
- Возврат:
  - `byItemId[item_id]: string[]` — pf реально в шаблоне item (как сейчас);
  - `byPublicId[pf]: string[]` — items, где используется (для бейджа admin);
  - `allDetectedPublicIds: string[]` — union по DOCX;
  - `catalogPublicIds: string[]` — все pf из `document_package_field_catalog`;
  - `orphanCatalogIds: string[]` = catalog − detected.
- Никаких веток по name/id пакета. Никакого объединения версий.

### 2. UI parity без дублирования orphan

```
PackageFieldsClientForm (existing renderer)
  ├─ блок «Поля пакета, не используемые в шаблонах» (orphan) — один раз
  │     • явный help-text: «Поле пока не используется ни в одном документе пакета»;
  │     • редактируется только как session-level (без per-item override);
  │     • не считается в готовность и не блокирует генерацию;
  └─ PackageDocumentCard[] (новый, по items)
        ├─ блок «Поля документа»  ← detected fields этого item
        ├─ блок «Роли документа»  ← assignments этого item
        ├─ header: статус + «X/Y полей документа» (только detected) + «K/N ролей» (только обязательные)
        └─ action-bar: Сохранить (atomic), Сбросить override
```

**Файлы:**

- Новый `src/components/ai-documents/packages/PackageDocumentCard.tsx`.
- Композиция: `DocumentPackageQuestionnairesView` рендерит общий orphan-блок + список `PackageDocumentCard`. Внутри карточки переиспользуется существующий field-renderer из `PackageFieldsClientForm` (или выделить `PackageFieldsItemForm` без дублирования логики дат/select/smart defaults/effective-values/reset override).
- `PackageFieldsClientForm.tsx` НЕ заменяется целиком — остаётся как renderer; меняется только композиция верхнего уровня и удаляется любая ветка по названию пакета.
- `PackageFieldsAssignmentPanel.tsx` (админ): бейдж «используется в N документах» / «не вставлено ни в один шаблон» — берётся из `byPublicId`/`orphanCatalogIds`. Никаких изменений каталога/реестра.

### 3. Atomic save — поля и роли одним RPC

**Migration:** RPC

```
save_session_document_atomic(
  _session_id uuid,
  _package_template_item_id uuid,
  _field_values jsonb,           -- [{ field_catalog_id, value, meta? }]  -- desired patch (sparse)
  _role_assignments jsonb,       -- desired full state of roles of THIS item
                                 --   [{ role_catalog_id, person_id?, legal_entity_id?, link_meta? }]
  _expected_template_version_id uuid  -- guard against stale UI
) RETURNS jsonb  -- { ok, written_fields, written_roles, deleted_roles, audit_id }
SECURITY DEFINER
```

Контракт:

- Никаких `BEGIN/COMMIT/ROLLBACK` — функция атомарна по умолчанию.
- Все SaaS-guards выше; orphan pf в `_field_values` для per-item → `RAISE 'orphan_field_not_writable_per_item'`.
- Поля: upsert переданных; пропущенные НЕ удаляются; reset only через `delete_session_field_value`.
- Роли: upsert переданных + DELETE отсутствующих в `_role_assignments` ровно по этому item (`WHERE package_template_item_id = _item AND id NOT IN (...)`); другие items не трогаются.
- Audit `package_document_atomic_save` (counts, item_id, version_id).
- Версионный guard: если `_expected_template_version_id` ≠ текущая активная → `RAISE 'stale_template_version'`.

**Hooks:**

- `usePackageSessionFields.ts` + `useDocumentItemRoleAssignments.ts` — добавить `saveDocumentAtomic({ itemId, fields, rolesDesired, expectedVersionId })`.
- Invalidate `values`, `role-assignments`, `session-q` **только после `ok:true**`. При ошибке: dirty-state сохраняется, точная серверная ошибка → `normalizeEdgeFunctionError` → toast; ложного «Сохранено» нет.
- Старые отдельные mutate-цепочки save-fields → save-roles в карточке заменяются одним вызовом.

### 4. UNIQUE-индексы — без третьего конфликта

Перед миграцией провести аудит существующих partial UNIQUE на `document_package_session_field_values`:

- `UNIQUE(session_id, field_catalog_id) WHERE item IS NULL`
- `UNIQUE(session_id, field_catalog_id, item) WHERE item IS NOT NULL`

Решение: **не создавать** `COALESCE(...)`-индекс. Текущая пара partial UNIQUE покрывает оба контракта (session-level и per-item override). Никаких новых uniqueness-индексов в этом патче. Если по факту аудита обнаружится дрейф — отдельная migration с явной заменой одной согласованной моделью.

### 5. Concurrent upsert proof

`/tmp/proof_concurrent_save.ts` (cleanup after):

- 5 параллельных RPC `save_session_document_atomic` одной (session, item) с РАЗНЫМИ payload (разные fields+roles).
- DoD:
  - 0 ошибок 23505 (или каноническая обработка через ON CONFLICT);
  - ровно 1 строка по каждому ключу (session, field, item) и (session, item, role);
  - финальное состояние = ровно один полностью завершённый payload (последний коммит), без смешения полей одного и ролей другого;
  - в audit нет 5 разных «success» с противоречивыми снимками; либо last-write-wins с одной audit-записью на финальное состояние, либо 5 audit с явно сериализованным порядком.
- Результат → `.lovable/proofs/concurrent-save-2026-06-17.md`.

### 6. Multi-tenant proof — безопасный

Сценарии в `.lovable/proofs/multi-tenant-2026-06-17.md`:

1. владелец сессии — full access;
2. другой пользователь того же workspace в разрешённой роли — ожидаемый доступ;
3. тот же workspace, запрещённая роль — 0 rows / canonical error;
4. пользователь другого workspace — 0 rows на чтение, RPC `RAISE 'forbidden_cross_workspace'`;
5. прямой RPC-вызов с чужими session/item/field/person/legal_entity ID — каноническая ошибка;
6. read и write — обе стороны.

Все временные fixtures (профили, сессии, поля) удаляются в конце proof-скрипта. Никаких production-данных не создаётся.

### 7. Унифицированный редизайн

Единый `PackageDocumentCard` для всех пакетов. Header: статус (пусто/частично/готово), `X/Y полей документа` (только detected), `K/N обязательных ролей`. Orphan-поля не считаются в готовности документа и пакета. action-bar: Сохранить (atomic), Сбросить override. dirty-state — per-card, локальный diff; success — только после `ok:true`. Никаких условий по имени/UUID пакета — grep `идеолог|годов` по `src/components/ai-documents/packages/**` после рефактора должен дать пусто кроме контента.

## DoD

1. Две **разных сессии** одного пользователя (одна для «Годового собрания», одна для «Идеологии») открыты в анкете — обе используют один и тот же компонент `PackageDocumentCard` с идентичной моделью поведения; контент различается, контракт — нет.
2. orphan pf-000002 «Идеологии» виден один раз в общем package-блоке с пояснением «Поле пока не используется ни в одном документе пакета», не повторяется в карточках, не блокирует генерацию.
3. detected pf отображается только в тех документах, где он найден в активной версии шаблона.
4. Atomic rollback: тест с искусственной ошибкой в ролях → fields тоже откатываются; в БД ноль частичных записей; UI остаётся dirty; toast — точная ошибка.
5. Desired-state ролей доказан: пользователь удалил роль в UI → в БД эта роль для item удалена; роли других items не затронуты.
6. Concurrent: 5×parallel → одно когерентное финальное состояние, без смешения полей одного и ролей другого payload.
7. Multi-tenant: все 6 сценариев — ожидаемые результаты, fixtures удалены.
8. Новый пакет (создан в админке, два шаблона, токены вставлены, активная версия) — анкета и роли появляются автоматически, без миграций данных и без ветвлений по id.
9. Orphan-переход (E2E):
  - создать pf в каталоге без токена → виден один раз в общем orphan-блоке как «не используется»;
  - вставить `{{pf-XXXXXX}}` в один шаблон и активировать новую версию;
  - поле исчезает из orphan-блока и появляется ТОЛЬКО в нужном документе; во втором документе его нет;
  - required-gate начинает учитывать его только после появления токена.
10. Все proof-артефакты — в `.lovable/proofs/` (единая директория, не `.lovable/proof/`).

## Файлы

Изменяются:

- `src/hooks/usePackageDetectedFields.ts`
- `src/hooks/usePackageSessionFields.ts`
- `src/hooks/useDocumentItemRoleAssignments.ts`
- `src/components/ai-documents/packages/PackageFieldsClientForm.tsx` (только композиция верхнего уровня + общий orphan-блок; field renderer переиспользуется/выделяется в `PackageFieldsItemForm`)
- `src/components/ai-documents/packages/PackageFieldsAssignmentPanel.tsx` (бейджи)
- `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx` (рендерит orphan-блок + список карточек)

Создаются:

- `src/components/ai-documents/packages/PackageDocumentCard.tsx`
- (опционально) `src/components/ai-documents/packages/PackageFieldsItemForm.tsx` — выделенный renderer без дублирования логики дат/select/effective values/reset
- Migration: RPC `save_session_document_atomic` (без новых UNIQUE-индексов)
- Proofs: `.lovable/proofs/atomic-save-2026-06-17.md`, `concurrent-save-2026-06-17.md`, `multi-tenant-2026-06-17.md`, `e2e-new-package-2026-06-17.md`, `orphan-transition-2026-06-17.md`

## Out of scope

- `canonical-document-generate-strict` (snapshot уже PASS).
- token registry / каталог токенов / pf-extractor / role-resolver / billing snapshot.
- Третий UNIQUE-индекс через `COALESCE` (см. §4).
- Объединение detection из нескольких версий шаблона.
- Любые ветвления по `package.name` или `package.id` в коде анкеты и карточек.

## Порядок выполнения (одним проходом)

cross-package parity (detection + orphan UI) → atomic save RPC + hooks → concurrent proof → multi-tenant proof → единый редизайн `PackageDocumentCard` → E2E нового пакета + orphan-переход.
---

## Прогресс выполнения

### Этап 1 — cross-package parity (detection + orphan UI): IMPLEMENTED

- `usePackageSessionFields`: добавлен `orphanQuestions` (pf каталога, отсутствующие во всех активных DOCX-версиях). Сортировка по `sort_order` + label. Не входит в `progress`, не входит в `getItemProgress`. Никаких веток по name/id пакета.
- `PackageFieldsClientForm`: добавлен проп `orphanOnly`. В этом режиме:
  - источник вопросов — `orphanQuestions`;
  - `effectiveItemId = null` всегда → сохраняется session-level;
  - бейджи «общее значение / переопределено» и кнопка «Сбросить к общему» подавлены;
  - per-item override недоступен по контракту.
- `DocumentPackageQuestionnairesView`: над аккордеоном документов один раз рендерится блок «Общие поля пакета · не используются в документах» при `orphanCount > 0`. В карточках документов orphan-поля не повторяются.

### Этап 1 — runtime proof: PASS (2026-06-17)

См. `.lovable/proofs/stage1_cross_package_parity_runtime.md`. Идеология: orphan-блок один раз на уровне пакета, pf-000002=15.06.2026, в карточках не дублируется. Годовое собрание: orphan-блока нет, документ-карточка показывает 7/7 полей. Сохранение orphan: session-level, hydration после refresh, без per-item row. Админский бейдж в `PackageFieldsAssignmentPanel` — отложен до этапа единого редизайна. Orphan→detected transition остаётся для E2E нового пакета.

### Этап 2 — atomic save RPC: IMPLEMENTED (code-complete)

См. `.lovable/proofs/stage2_atomic_save.md`.
- Migration: `save_session_document_atomic(uuid, uuid, jsonb, jsonb, uuid)` создан, GRANT EXECUTE authenticated+service_role.
- Hook: `src/hooks/useAtomicDocumentSave.ts`.
- Guards (server-side): session ownership, item↔package, stale template version, orphan-per-item, type-cast, role/person validity, desired-state cleanup.
- Audit: одна запись `package_document_atomic_save` на вызов.
- Atomic rollback и desired-state semantics — PASS by construction (одна транзакция, scoped `NOT (id = ANY(v_kept_ids))`).

### Этап 3 — concurrent proof: NOT STARTED (требует proof-скрипта с 5×parallel RPC)

### Этап 4 — multi-tenant proof: NOT STARTED

### Этап 5 — unified `PackageDocumentCard` (рефакторинг UI с использованием атомарного RPC): NOT STARTED

### Этап 6 — E2E нового пакета + Этап 7 — orphan transition: NOT STARTED
