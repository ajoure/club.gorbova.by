да, согласен, с учетом правок:

## 1. Seed-роли удалить полностью, не архивировать

Подтверждаю: PKR-000001…PKR-000011 по пакету «Идеология» — тестовые seed/system-роли. Их нужно полностью удалить из системы.

Не архивировать.  

Не оставлять в разделе «Системные».  

Не показывать в каталоге плейсхолдеров.  

Не восстанавливать при reload страницы.

После удаления в пакете «Идеология» ролей быть не должно, пока администратор сам вручную не создаст первую роль.

## 2. Не использовать широкий bypass session_replication_role = replica, если можно иначе

В Phase 2e заменить опасный вариант:

SET LOCAL session_replication_role = replica

на более безопасный controlled cleanup.

Правильный порядок:

1. В одной миграции временно изменить/расширить trigger guard_package_role_catalog_mutations, чтобы он разрешал hard-delete только для whitelist:

sql package_template = 'Идеология' AND is_system = true AND public_id IN ('PKR-000001' ... 'PKR-000011') 

2. Удалить связанные строки из document_package_session_participants.

3. Удалить seed-роли из document_package_role_catalog.

4. Вернуть trigger-защиту в строгий режим.

5. Записать audit package_role_seed_cleanup_deleted.

Если технически проще сделать SECURITY DEFINER cleanup-функцию — функция должна быть временной, whitelist-only, выполниться один раз и затем быть удалена. Не оставлять permanent bypass-функцию.

## 3. Проверка использования не является STOP-условием

Не делать блокирующую проверку «используются ли роли».

Владелец проекта подтвердил: эти роли тестовые и не используются. Поэтому удаление выполняется без STOP по usage.

Можно сделать snapshot до удаления только для proof, но он не должен блокировать выполнение.

## 4. Отключить автосоздание seed-ролей

Обязательно найти и отключить любые источники повторного создания системных ролей:

- seedPackageRoles

- ensureDefaultRoles

- createDefaultPackageRoles

- PKR-000001

- Организация пакета

- Руководитель организации

- любые frontend fallback-списки ролей

- edge/RPC/migration/seed-код, который создаёт роли автоматически

Новое правило:

text Пакет документов создаётся без ролей. Все роли создаёт администратор вручную. 

## 5. Убрать dev dry-run из обычного UI

Блок:

text Dev: Dry-run пакетных alias-токенов 

убрать из обычной анкеты пакета.

Допускается оставить только при двойном guard:

text super_admin + ?debug=1 

В обычном UI не должно быть английских технических надписей, alias-token debug, resolver debug, dry-run debug.

## 6. Убрать дубль «Состав пакета» из анкеты

Вкладка «Анкета» должна содержать только:

- выбор ЮЛ/ИП пакета;

- список физлиц;

- назначение ролей;

- кнопку «Сохранить анкету».

Состав пакета должен быть только в отдельной подвкладке:

text Пакеты документов → Идеология → Состав 

## 7. Роли: активные и архив отдельно

Во вкладке «Роли» сделать разделение:

text Активные Архив 

Системные роли после cleanup должны отсутствовать.

Архивные роли не должны отображаться в общем списке активных ролей и не должны попадать в dropdown анкеты и каталог плейсхолдеров.

## 8. Каталог «Пакет: Роли»

В каталоге плейсхолдеров показывать только активные роли текущих пакетов в формате:

text {{package.role.PKR-XXXXXX}} 

Не показывать:

text {{package.roles.<key>.full_name}} {{package.roles.<key>.position}} {{package.roles.<key>.short_name}} 

Старый формат может остаться только в валидаторе как deprecated warning, но не в UI.

Если в пакете «Идеология» нет ролей, показывать empty state:

text В этом пакете пока нет ролей. Создайте роль в анкете пакета или во вкладке «Роли». 

## 9. Форма создания роли

Форма создания роли должна быть простой:

- Название роли — обязательно.

- Описание — необязательно.

Не показывать пользователю:

- role_key

- output_template

- min_count

- max_count

- required

- sort_order

- is_system

- технические подсказки на английском

PKR создаётся автоматически и не меняется при переименовании роли.

## 10. Шаблоны пакета

Загрузка DOCX остаётся во вкладке «Шаблоны документов».

При загрузке добавить выбор:

text Тип шаблона: - Биллинговый документ - Пакет документов  Пакет: - Идеология 

Если выбран пакет, шаблон должен автоматически появиться в:

text Пакеты документов → Идеология → Состав 

Не создавать отдельную загрузку шаблонов внутри анкеты пакета.

## 11. Proof обязателен

Создать proof:

text .lovable/proofs/package_documents_sprint3f_phase2d_ux_cleanup_2026_[05.md](http://05.md) .lovable/proofs/package_documents_sprint3f_phase2e_hard_delete_seed_roles_2026_[05.md](http://05.md) 

В proof зафиксировать:

- PKR-000001…PKR-000011 удалены полностью;

- в document_package_role_catalog по пакету «Идеология» больше нет системных ролей;

- связанные assignments удалены;

- reload страницы не пересоздаёт seed-роли;

- dropdown анкеты пустой: только «— без роли —» и «+ Добавить роль»;

- каталог «Пакет: Роли» пустой для «Идеологии», пока не создана новая роль;

- dev dry-run скрыт из обычного UI;

- дубль «Состав пакета» убран из анкеты;

- canonical-document-generate-strict, Gotenberg, ai_generated_documents, billing resolver, billing FLD не тронуты.

## 12. Финальный ожидаемый статус

text completed: package UX cleaned; seed/system roles hard-deleted from Ideology package; roles are now admin-created only; PKR placeholders are per-package and rename-safe; ordinary UI contains no dev dry-run or technical role fields; template upload supports package binding; generation still deferred 

&nbsp;

&nbsp;

&nbsp;

# План: Sprint 3F Phase 2d + 2e — UX cleanup пакетов и удаление seed-ролей

## Цель

Очистить UI пакетов документов от технических блоков и hard-delete все системные seed-роли пакета «Идеология» (PKR-000001…PKR-000011). После этого администратор работает по простой модели: создал роль вручную → получил PKR → вставил в Word → загрузил DOCX → проверил → готов к dry-run.

**Не трогать:** `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing resolver, billing FLD-токены, биллинговые шаблоны.

---

## Phase 2d — UX cleanup (frontend-only)

### 1. Убрать Dev dry-run блок из анкеты

- В `DocumentPackageIdeologyView.tsx` снять рендер `<PackageTokensDryRunPanel />` из вкладки «Анкета».
- Компонент `PackageTokensDryRunPanel.tsx` оставить в коде, но рендерить только при `?debug=1` в URL И `super_admin` (двойной guard).
- DoD: в обычном UI анкеты блок не виден, нет английских технических надписей.

### 2. Убрать блок «Состав пакета» из анкеты

- В `DocumentPackageIdeologyView.tsx` удалить секцию со списком шаблонов/состава пакета. Состав остаётся только в подвкладке «Состав» (`PackageContentsList`).
- Внутри «Анкеты» оставить: выбор ЮЛ/ИП, список физлиц, назначение ролей, кнопку «Сохранить анкету», статус заполнения обязательных ролей.

### 3. Роли пакета: разделить активные / архив / системные

В `PackageRolesManager.tsx` ввести три секции через переключатель/Tabs:

- **Активные** — `is_active=true AND is_system=false`. Действие: «Архивировать». Поиск — только по активным.
- **Архив** — `is_active=false AND is_system=false`. Действие: «Восстановить». Hard-delete не показывать.
- **Системные** — `is_system=true`, свернуты `<Collapsible>` по умолчанию. Только просмотр + копирование PKR. Без архивации/удаления в UI.

После Phase 2e секция «Системные» будет пустой для «Идеологии» — это ожидаемо.

### 4. Inline «+ Добавить роль» из анкеты

Уже реализовано через `InlineCreateRoleDialog`. Проверить, что форма содержит только «Название» и «Описание» — без `role_key`, `output_template`, `required`, `min/max`, `sort_order`, `is_system`.

### 5. Каталог плейсхолдеров → группа «Пакет: Роли»

В `PlaceholdersCatalogTab.tsx`:

- Показывать только `{{package.role.PKR-XXXXXX}}` (по одному на роль из `document_package_role_catalog` где `is_active=true`).
- Скрыть legacy-форматы `{{package.roles.<key>.full_name|position|short_name}}` из UI каталога и picker.
- Старый формат остаётся read-only в валидаторе как `deprecated_placeholder_format` warning.
- Если ролей в пакете нет — empty state: «В этом пакете пока нет ролей. Создайте роль в анкете пакета или во вкладке „Роли“».

### 6. Загрузка шаблона и привязка к пакету

Уже реализовано в `StrictDocumentTemplatesManager` (выбор «Биллинговый» / «Пакет документов» → пакет → RPC `package_template_bind_template`).

Проверить:

- Что после загрузки шаблон сразу виден в `Пакеты → Идеология → Состав`.
- Что подвкладка «Шаблоны» внутри пакета показывает тот же список через `document_package_template_items` (read-only), без отдельной загрузки.

### 7. Валидация шаблона (read-only)

В `PackageTemplateValidationPanel`:


| Токен                                               | Статус                            |
| --------------------------------------------------- | --------------------------------- |
| `{{field:FLD-...}}` (системные/документные)         | valid                             |
| `{{field:FLD-...}}` (биллинговые реквизиты)         | warning, не error                 |
| `{{package.ul                                       | ip                                |
| `{{package.role.PKR-...}}` принадлежит этому пакету | valid                             |
| `{{package.role.PKR-...}}` из другого пакета        | error `pkr_outside_bound_package` |
| `{{package.roles.<key>.<field>}}` (legacy)          | deprecated warning                |


Активация шаблона блокируется только при наличии error, не warning. Проверка не вызывает генерацию.

---

## Phase 2e — Hard-delete seed-ролей «Идеологии»

### 8. Миграция: cleanup PKR-000001…PKR-000011

Один migration файл, всё в транзакции:

1. **Резолв `package_template_id**` «Идеология» через подзапрос (без хардкода UUID): по `document_package_templates.name = 'Идеология'`.
2. **Snapshot для proof** (SELECT в audit_logs.meta перед удалением).
3. **DELETE назначений** в `document_package_session_participants` где `role_catalog_id` относится к PKR-000001…PKR-000011 «Идеологии».
4. **DELETE из `document_package_role_catalog**` по whitelist `public_id IN (PKR-000001..PKR-000011) AND is_system=true AND package_template_id=<ideology>`.
5. Если существующий trigger блокирует hard-delete системных ролей — использовать **Вариант A**: создать `SECURITY DEFINER` функцию `public.cleanup_ideology_seed_roles()` со встроенным whitelist, которая внутри себя обходит trigger через `SET LOCAL session_replication_role = replica` (или эквивалентный безопасный bypass), затем вызывать её один раз из миграции. После выполнения функцию `DROP`, чтобы не оставлять «чёрный ход». Защита trigger для будущих ролей сохраняется.
6. **Audit log**: `action='package_role_seed_cleanup_deleted'`, `actor_type='system'`, `meta` содержит `package_template_id`, `deleted_public_ids[]`, `reason='Owner confirmed seed/system roles are test data'`, snapshot.

### 9. Отключить автосоздание seed-ролей

Поиск и нейтрализация любых источников пересоздания:

- Сетка поиска: `seedPackageRoles`, `ensureDefaultRoles`, `createDefaultPackageRoles`, `PKR-000001`, `Организация пакета`, `Руководитель организации`, и т.п. — в `src/`, `supabase/functions/`, миграциях.
- Если найден seed-код (RPC/edge/триггер/frontend fallback) — отключить вызов или удалить вставку.
- Если найдена прошлая seed-миграция — её **не откатывать** (история), но в текущей миграции добавить idempotent guard, чтобы повторное создание не происходило.
- Новое правило в коде комментарием: «Пакет создаётся без ролей. Роли создаёт администратор вручную».

### 10. Empty state UI после удаления

- Вкладка «Роли» → «Активные»: «Ролей пока нет. Добавьте первую роль вручную. После создания роль получит свой PKR-плейсхолдер для вставки в Word.» + кнопка «+ Добавить роль».
- Dropdown роли физлица в анкете: только `— без роли —` и `+ Добавить роль`.
- Каталог плейсхолдеров «Пакет: Роли»: empty state (см. п.5).

---

## Файлы

**Frontend (edit):**

- `src/components/ai-documents/DocumentPackageIdeologyView.tsx` — убрать dry-run панель и блок «Состав»; debug-флаг для dry-run.
- `src/components/ai-documents/packages/PackageRolesManager.tsx` — Tabs «Активные / Архив / Системные», правила действий.
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — только PKR в группе «Пакет: Роли», скрыть legacy.
- `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx` — billing FLD как warning, PKR-cross-package как error.
- `src/components/ai-documents/packages/InlineCreateRoleDialog.tsx` — проверить минимальную форму.

**Backend (migration):**

- Одна миграция: создать temp `cleanup_ideology_seed_roles()` → выполнить → drop; audit.
- Поиск/нейтрализация seed-источников (edit/delete edge function или миграция-guard по обстоятельствам).

**Proof:**

- `.lovable/proofs/package_documents_sprint3f_phase2d_ux_cleanup_2026_05.md`
- `.lovable/proofs/package_documents_sprint3f_phase2e_hard_delete_seed_roles_2026_05.md`

---

## DoD (сводный)

- В `/admin/documents → Пакеты → Идеология → Анкета` нет dev dry-run блока и нет дубля «Состава».
- Роли разделены: Активные / Архив / Системные (свернуто).
- PKR-000001…PKR-000011 в `document_package_role_catalog` отсутствуют (0 строк по «Идеологии» с `is_system=true`).
- Связанные `document_package_session_participants` для этих PKR удалены.
- Автосоздание seed-ролей отключено; reload страницы не возвращает их.
- Каталог плейсхолдеров «Пакет: Роли» не содержит PKR-000001…PKR-000011 и не содержит `.full_name/.position/.short_name`.
- Inline создание роли из анкеты работает (форма: только «Название» + «Описание»), назначает роль физлицу, PKR rename-safe.
- Шаблон приказа виден в `Состав` после загрузки с привязкой к пакету.
- Валидация шаблона: billing FLD → warning, PKR cross-package → error, legacy `package.roles.*` → deprecated warning; генерация не вызывается.
- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`, billing resolver, биллинговые шаблоны и FLD — не тронуты (proof diff-grep).
- Trigger-защита от hard-delete системных ролей сохранена для будущих ролей.

---

## Порядок исполнения

1. Phase 2d — frontend edits (без БД).
2. Phase 2e — миграция (cleanup + drop временной функции + audit) — отдельный apply с подтверждением пользователя.
3. Поиск и нейтрализация seed-источников.
4. Verify через `read_query`: 0 строк seed-PKR; audit-запись есть.
5. Записать оба proof-файла.

Жду подтверждения, чтобы перейти в build mode и начать с Phase 2d.