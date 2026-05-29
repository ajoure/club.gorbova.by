# да, согласен, с учетом правок:

План в целом правильный: он наконец переводит роли с уровня всего пакета на уровень конкретного документа внутри пакета. Это нужно, иначе один и тот же человек будет «сквозить» одной ролью во всех документах пакета.

Нужно добавить/уточнить следующие пункты.

```md
## Обязательные правки к Sprint 3G

### 1. Анкета документа должна быть привязана не к template_id, а к package_template_item_id

Везде использовать `package_template_item_id`, а не просто `template_id`.

Причина:
один и тот же шаблон теоретически может быть привязан к разным пакетам или переиспользован в будущем. Назначение ролей должно относиться к конкретному элементу пакета, а не к шаблону вообще.

Правильно:

document_package_item_role_assignments.package_template_item_id
→ document_package_template_items.id

Не делать назначение только по `template_id`.

---

### 2. Нужен уникальный soft-guard от дублей одной роли у одного и того же физлица

План правильно пишет, что нельзя делать unique по `(session, item, role)`, потому что одну роль можно назначить нескольким физлицам.

Но нужно запретить дубль одной и той же связки:

```text
package_session_id + package_template_item_id + role_catalog_id + person_id + is_active=true
```

Иначе одного и того же человека можно случайно добавить два раза на одну роль в одном документе.

Добавить partial unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_package_item_role_assignments_active_person
ON public.document_package_item_role_assignments
(package_session_id, package_template_item_id, role_catalog_id, person_id)
WHERE is_active = true AND person_id IS NOT NULL;
```

При этом несколько разных физлиц на одну роль разрешены.

---

### **3. Нужен отдельный порядок вывода нескольких физлиц**

Добавить колонку:

```sql
sort_order integer NOT NULL DEFAULT 100
```

Для множественных назначений одной роли порядок должен быть управляемым.

В Sprint 3G можно не делать drag-and-drop, но в UI порядок должен быть стабильным:  
`sort_order ASC, created_at ASC`.

---

### **4. Нужен source-of-truth для общего ЮЛ/ИП пакета**

В плане указано, что `selected_legal_entity_id` остаётся на уровне session. Нужно дополнить:

- если пользователь меняет ЮЛ/ИП пакета, это влияет на все документы пакета;
- UI должен явно предупреждать: «Юрлицо/ИП применяется ко всем документам пакета»;
- role assignments по документам при смене ЮЛ/ИП не удаляются.

---





### **5. Старую таблицу**

`document_package_session_participants` **не использовать для новых назначений**

План пишет, что она остаётся read-only legacy. Нужно жёстче:

- новые сохранения ролей физлиц НЕ должны писать в `document_package_session_participants`;
- новый UI «Анкеты документов» пишет только в `document_package_item_role_assignments`;
- старый dev/dry-run блок, который использует `document_package_session_participants`, не показывать в обычном UI;
- если он остаётся для debug, только `super_admin + ?debug=1`.

---

### **6. Проверить кнопку «Сформировать пакет»**

Сейчас на экране есть кнопка «Сформировать пакет». В Sprint 3G генерации ещё нет.

Нужно:

- либо скрыть кнопку до Sprint 3H/3G-real-generation;
- либо оставить disabled;
- текст: «Генерация будет подключена после проверки шаблонов»;
- кнопка не должна вызывать Gotenberg, `canonical-document-generate-strict`, `ai_generated_documents`.

---

### **7. Исправить controlled validation: системные FLD не должны давать warning**

Обязательно проверить на реальном приказе:

```text
{{field:FLD-000209}} — Сегодня прописью → valid
{{field:FLD-000211}} — Текущий год → valid
{{field:FLD-000069}} — Номер документа → valid
```

Не warning.

Warning только для FLD из групп:

- Заказчик ФЛ;
- Заказчик ЮЛ;
- Заказчик ИП;
- Исполнитель ЮЛ.

---

### **8. В validator нельзя определять billing-FLD только по номеру FLD**

Нужно классифицировать не по диапазону FLD-ID, а по реальной группе/категории из registry/catalog.

Если в системе нет стабильного `group_code`, discovery должен найти фактический источник группировки в текущем каталоге плейсхолдеров.

DoD:

- список billing-групп берётся из единого helper;
- системные поля не попадают в billing warning;
- package.ul/ip/fl поля валидируются по `packagePlaceholderCatalog`.

---

### **9. PKR должен проверяться по пакету, к которому привязан шаблон**

Для `{{package.role.PKR-XXXXXX}}` validator должен проверять:

```text
PKR существует
PKR активен
PKR принадлежит package_template_id того пакета,
к которому привязан проверяемый шаблон через document_package_template_items
```

Если PKR из другого пакета:

```text
error: pkr_outside_bound_package
```

Если PKR архивный:

```text
error: pkr_archived
```

Если PKR не найден:

```text
error: pkr_not_found
```

---

### **10. В UI «Анкеты документов» роли должны показываться только активные**

В выборе ролей:

- показывать только `is_active=true`;
- архивные роли не показывать;
- если в старой анкете уже есть назначение на архивную роль — показывать предупреждение в конкретном документе: «Роль архивирована, замените роль».

---

### **11. Inline «+ Добавить роль» должен создавать роль только в текущем пакете**

При создании роли из анкеты документа обязательно передавать текущий `package_template_id`.

Не создавать глобальные роли.

После создания:

- роль появляется в «Роли пакета»;
- появляется в выпадающих списках всех документов этого пакета;
- появляется в группе плейсхолдеров «Пакет: Роли» именно под этим пакетом;
- не появляется в других пакетах.

---

### **12. Нужен empty-state, если в пакете нет шаблонов**

Если в пакете «Идеология» нет `document_package_template_items`, вкладка «Анкеты документов» должна показывать:

```text
В пакете пока нет шаблонов. Загрузите DOCX во вкладке «Шаблоны документов» и выберите пакет «Идеология».
```

Не показывать пустую/сломленную анкету.

---

### **13. Нужен статус заполненности по каждому документу**

В аккордеоне каждого документа показывать бейдж:

- «Не заполнено» — нет назначений;
- «Частично заполнено» — часть PKR из шаблона не назначена;
- «Заполнено» — все PKR, которые реально используются в DOCX, имеют назначение.

Важно: проверять не все роли пакета, а только PKR, которые реально используются в конкретном шаблоне.

---

### **14. Связать validation report с анкетой документа**

Controlled validation должна не только проверять синтаксис, но и показывать:

- PKR есть в шаблоне;
- PKR принадлежит этому пакету;
- есть ли назначение в анкете этого документа.

Если `{{package.role.PKR-000012}}` есть в DOCX, но в анкете этого документа не выбран человек:

```text
warning или error: role_assignment_missing
```

На Sprint 3G лучше сделать warning, потому что генерации ещё нет. В Sprint генерации это станет blocker.

---

### **15. Уточнить output PKR**

Пока формат вывода роли:

```text
должность, ФИО
```

Но если `metadata.position` пустой, вывод должен быть:

```text
ФИО
```

Не должно появляться:

```text
, Иванов Иван Иванович
```

Если назначено несколько физлиц:

- пока вывод через `;` ;
- пример: `главный бухгалтер, Иванов Иван Иванович; юрист, Петров Пётр Петрович`;
- финальные правила перечисления можно отложить.

---

### **16. Плейсхолдеры PKR в каталоге — без технических строк**

В `PlaceholdersCatalogTab` основной UI должен показывать:

```text
Группа: Пакет: Роли
Название: Идеология — Ответственный за координацию идеологической работы
ID: PKR-000012
Тип: Роль физлица
Пример: должность, ФИО
Плейсхолдер: {{package.role.PKR-000012}}
```

Не показывать в обычном UI:

- `document_package_role_catalog.public_id`;
- `document_package_session_participants`;
- `source_path`;
- raw JSON;
- английские коды.

Техническая информация — только `super_admin + ?debug=1`.

---

### **17. Template binding уже сделан — не переделывать**

В Sprint 3G не надо заново делать загрузку шаблонов.

Нужно только проверить:

- при загрузке DOCX можно выбрать «Пакет документов» → «Идеология»;
- шаблон появляется в «Пакеты документов → Идеология → Состав»;
- validation работает по привязанному шаблону.

Если уже работает — зафиксировать proof, не переписывать.

---

### **18. Proof должен содержать реальные сценарии**

В proof добавить обязательные сценарии:

1. В пакете «Идеология» есть минимум 1 DOCX-приказ.
2. Создана роль PKR вручную.
3. Эта роль вставлена в DOCX как `{{package.role.PKR-XXXXXX}}`.
4. Для приказа выбран человек на эту роль.
5. Для другого шаблона того же пакета этот же человек может иметь другую роль.
6. Одна роль назначена двум физлицам в одном документе.
7. `{{field:FLD-000209}}` и `{{field:FLD-000211}}` проходят validation без warning.
8. Billing-FLD в package-template даёт warning, не error.
9. Gotenberg / `canonical-document-generate-strict` / `ai_generated_documents` не вызывались.

---

### **19. Не начинать реальную генерацию в Sprint 3G**

Sprint 3G — это ещё не генерация.

Он должен закрыть:

- document-level анкету;
- корректную validation;
- корректный каталог PKR;
- готовность к генерации.

Реальное подключение резолвера к `canonical-document-generate-strict`, Gotenberg и запись результата — отдельный Sprint 3H.

```
## Итог

План хороший, но без этих правок есть риск снова получить «почти работает», но роли будут неправильно проверяться или назначаться не на тот документ.

Главные правки:

1. Назначения ролей должны быть **на уровне конкретного шаблона пакета**, не на весь пакет.
2. PKR должен проверяться через `package_template_item_id`.
3. Системные `{{field:FLD-000209}}`, `{{field:FLD-000211}}`, `{{field:FLD-000069}}` должны быть **valid без warning**.
4. Валидация должна показывать, хватает ли назначений ролей для конкретного документа.
5. Реальную генерацию пока не включать — это Sprint 3H.

План: Sprint 3G — Document-level questionnaires + package validation hardening
```

## 0. Главная архитектурная правка

Текущая модель «одна анкета на весь пакет» (`document_package_session_participants` на уровне `package_session_id`) недостаточна. Один человек в разных шаблонах одного пакета может иметь разные роли.

Разделяем на три уровня:

1. **Пакет** (`document_package_templates`) — например, «Идеология».
2. **Шаблон внутри пакета** (`document_package_template_items` → `document_templates`).
3. **Анкета по каждому шаблону** — назначение PKR → physical person делается отдельно для каждого `package_template_item_id`.

ЮЛ/ИП пакета остаётся общим реквизитом на уровне session (`document_package_sessions.selected_legal_entity_id`). Меняется только модель ролей физлиц.

---

## 1. Discovery (обязательный первый шаг)

До любых миграций прочитать и зафиксировать в proof:

- `document_package_sessions` — есть ли уже `selected_legal_entity_id` / эквивалент.
- `document_package_session_participants` — текущая schema, RLS, использование в коде.
- `document_package_template_items` — структура, как привязан `template_id`.
- `document_package_role_catalog` — `public_id` (PKR), `package_template_id`, триггеры.
- Поиск любой существующей таблицы document-level assignment (`grep` на `item_role_assignments`, `template_item_participants`, и т.п.) — чтобы не дублировать.
- Текущий код: `useDocumentPackageSession.ts`, `DocumentPackageIdeologyView.tsx`, `PackageTemplateValidationPanel.tsx`, `PlaceholdersCatalogTab.tsx`, `StrictDocumentTemplatesManager.tsx`.

Только после discovery — переход к DB и UI.

---

## 2. DB: document-level role assignments

Если discovery подтвердит отсутствие аналога — миграция:

```sql
CREATE TABLE public.document_package_item_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_session_id uuid NOT NULL REFERENCES public.document_package_sessions(id) ON DELETE CASCADE,
  package_template_item_id uuid NOT NULL REFERENCES public.document_package_template_items(id) ON DELETE CASCADE,
  role_catalog_id uuid NOT NULL REFERENCES public.document_package_role_catalog(id) ON DELETE RESTRICT,
  person_id uuid NULL, -- legal_details_persons.id
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, -- {position?: string}
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- индексы по (package_session_id, package_template_item_id), (role_catalog_id)
-- НЕТ unique по (session, item, role) — одну роль можно назначить нескольким физлицам.
```

GRANTs + RLS:

- `authenticated`: SELECT/INSERT/UPDATE только в рамках своей `package_session_id` (через subselect к `document_package_sessions.profile_id = auth.uid()`).
- `super_admin` / `admin` через `has_role_v2` — полный доступ.
- DELETE запрещён (hard delete не нужен → `is_active=false`).
- `service_role` — ALL.

Триггер `assign_role_must_belong_to_package`: проверяет, что `role_catalog.package_template_id` совпадает с `package_template_item.package_template_id`. Иначе — `raise exception 'pkr_outside_bound_package'`.

Audit: `audit_logs` записи `package_item_role_assignment_{created,updated,archived}` с `package_session_id`, `package_template_item_id`, `role_catalog_public_id`, `person_id`.

Атомарность replace для одного (session,item): backlog (RPC `replace_item_role_assignments`) — в Sprint 3G выполняется через delete-soft+insert внутри хука, как обсуждалось в `document_package_session_save_atomicity.md`.

---

## 3. UI: «Анкеты документов» вместо «Анкета пакета»

В `PackagesWorkspace.tsx` подвкладки пакета «Идеология»:

```
Состав | Шаблоны пакета | Анкеты документов | Роли пакета | Проверка шаблонов
```

Удаляем подвкладку «Анкета пакета», вместо неё — **«Анкеты документов»** (`DocumentPackageQuestionnairesView.tsx`, новый компонент).

Внутри:

- Верхний блок «ЮЛ/ИП пакета» (общий для всей session) — редактирование `document_package_sessions.selected_legal_entity_id`.
- Аккордеон по каждому `package_template_item` пакета:
  - Заголовок: название шаблона + бейдж статуса (заполнено / требует ролей).
  - Внутри: список активных ролей пакета (`document_package_role_catalog`, `is_active=true`).
  - Для каждой роли — выбор физлица из `legal_details_persons` (multi-add: «+ Добавить ещё человека на эту роль»).
  - Кнопка «Сохранить анкету документа» (scoped к одному `item`).
- Inline-кнопки «+ Добавить роль» и «+ Добавить физлицо» (используют существующие `InlineCreateRoleDialog`/`InlineCreatePersonDialog`).

Старая «Анкета пакета» (`DocumentPackageIdeologyView` в части ролей) — деприкейтится: ЮЛ/ИП-часть перемещается в верх «Анкет документов», role-assignment блок удаляется. Hook `useDocumentPackageSession` урезается до session+ЮЛ; participant-логика перемещается в новый хук `useDocumentItemRoleAssignments(itemId)`.

`document_package_session_participants` остаётся read-only legacy для уже сохранённых данных — миграция данных в Sprint 3G **не выполняется** (backlog: backfill в 3H, когда модель приживётся).

---

## 4. Validator fix — `PackageTemplateValidationPanel.tsx`

Правило:

- `{{field:FLD-XXXXXX}}` где FLD относится к **системным/документным** группам (Сегодня прописью, Текущий год, Номер документа, дата, и т.п.) → **valid**, без warning.
- `{{field:FLD-XXXXXX}}` где FLD относится к биллинговым группам (`Заказчик ФЛ`, `Заказчик ЮЛ`, `Заказчик ИП`, `Исполнитель ЮЛ`) → **warning** `billing_fld_in_package_scope` с русским сообщением: «Этот плейсхолдер относится к биллинговым реквизитам. Для реквизитов пакета используйте Пакет: ЮЛ/ИП/ФЛ.»

Реализация: классификация группы FLD через `fields_catalog.group_code` (или существующий аналог). Маппинг billing-групп — константа в `_shared/billing-fld-groups.ts` (frontend mirror в `src/utils/billingFldGroups.ts`). Discovery должен подтвердить точные коды групп.

Прочие правила (см. memory `package-token-aliases-v1`):

- `{{package.role.PKR-...}}` чужого пакета → **error** `pkr_outside_bound_package`.
- Несуществующий PKR → **error** `pkr_not_found`.
- `{{package.ul|ip|fl.FLD-...}}` отсутствует в каталоге → **error**.
- Legacy `{{package.roles.<key>.*}}` → **warning** `deprecated_placeholder_format`.

Проверка не вызывает Gotenberg, не пишет в `ai_generated_documents`, не зовёт `canonical-document-generate-strict`.

---

## 5. PlaceholdersCatalogTab — нормальный вид PKR

Сейчас package-плейсхолдеры показываются техническим списком. Привести к виду обычных FLD:


| Группа      | Название                                                       | ID         | Тип          | Пример                                  | Плейсхолдер                   | Copy |
| ----------- | -------------------------------------------------------------- | ---------- | ------------ | --------------------------------------- | ----------------------------- | ---- |
| Пакет: Роли | Идеология — Ответственный за координацию идеологической работы | PKR-000012 | Роль физлица | главный бухгалтер, Иванов Иван Иванович | `{{package.role.PKR-000012}}` | 📋   |


Если пример нельзя посчитать без анкеты — показать строку: «Пример появится после заполнения анкеты документа». Без английских технических строк.

Legacy `{{package.roles.<key>.full_name|position|short_name}}` — **скрыть из UI** (остаются read-only только в валидаторе как deprecated warning).

Debug-блок (source-path, raw catalog JSON) — только под `super_admin + ?debug=1` (уже сделано для dry-run, тот же гард).

---

## 6. Template binding — `StrictDocumentTemplatesManager.tsx`

При загрузке/редактировании шаблона:

- Поле «Тип шаблона»: `Биллинговый документ` | `Пакет документов`.
- Если выбран «Пакет документов» → обязательное поле «Пакет» (select из `document_package_templates`, активные).
- На submit — RPC `package_template_bind_template` (уже существует, выставляет `template_scope='package'` и пишет audit).
- После успеха — шаблон появляется в `Пакеты → Идеология → Состав`.

Во вкладке «Пакеты → Идеология → Состав» (`PackageContentsList`) — только список и действия: Открыть / Проверить / Отвязать. Загрузки DOCX там нет. Подвкладка «Шаблоны пакета» (`TemplateBindingControl`) — admin-only список привязок с теми же действиями.

---

## 7. Resolver contract (документ-уровень) — read-only proof для 3G

Реальной генерации в 3G нет. Но фиксируем контракт для 3H в proof + добавляем pure helper (без вызовов) `resolvePackageRolePlaceholder(token, ctx)`:

```text
{{package.role.PKR-000012}}
  + ctx: { package_session_id, package_template_item_id }
  → role_catalog by public_id → assert package_template_id match
  → document_package_item_role_assignments WHERE session+item+role AND is_active
  → person_id → legal_details_persons.full_name
  → metadata.position
  → output: "{position}, {full_name}" (если несколько — через ", ")
```

Helper лежит в `_shared/resolve-package-tokens.ts` под флагом `HARDCODED_ENABLED=false` (см. memory `package-token-aliases-v1`). Никаких новых FLD/edge-функций.

---

## 8. Что НЕ трогаем

- `canonical-document-generate-strict`, Gotenberg, `ai_generated_documents`.
- Billing resolver, billing FLD, реквизитные таблицы, `client_legal_details`, `legal_details_persons` (только чтение).
- Новые FLD без manifest.
- Не возвращаем seed-роли «Идеология».
- `{{package.roles.<key>.*}}` остаётся только в валидаторе как deprecated read-only.
- Backfill старых `document_package_session_participants` → новый item-level (в backlog 3H).

---

## 9. Файлы

**Миграция:**

- `supabase/migrations/<ts>_document_package_item_role_assignments.sql` (CREATE TABLE + GRANT + RLS + триггер + индексы).

**Frontend (новые):**

- `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx`
- `src/components/ai-documents/packages/ItemRoleAssignmentsBlock.tsx`
- `src/hooks/useDocumentItemRoleAssignments.ts`
- `src/utils/billingFldGroups.ts`

**Frontend (edit):**

- `src/components/ai-documents/packages/PackagesWorkspace.tsx` — заменить tab `anketa` на `questionnaires`.
- `src/components/ai-documents/DocumentPackageIdeologyView.tsx` — урезать до ЮЛ/ИП-части или удалить.
- `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx` — billing-group классификация.
- `src/components/ai-documents/packages/PlaceholdersCatalogTab.tsx` — табличный вид PKR.
- `src/components/ai-documents/StrictDocumentTemplatesManager.tsx` — селектор тип/пакет при загрузке.
- `src/hooks/useDocumentPackageSession.ts` — снять participant-CRUD.

**Shared:**

- `supabase/functions/_shared/billing-fld-groups.ts`
- `supabase/functions/_shared/resolve-package-tokens.ts` — добавить документ-уровневую ветку (флаг off).

**Proof:**

- `.lovable/proofs/package_documents_sprint3g_document_level_questionnaires_2026_05.md` (discovery findings + migration diff + screenshots + validator before/after).

**Memory update:**

- Дополнить `architecture/documents/package-token-aliases-v1` секцией про document-level assignment SOT и item-scoped resolution.

---

## 10. DoD

- Document-level анкеты работают: один человек = разные роли в разных шаблонах одного пакета.
- Одна роль в одном документе может иметь несколько физлиц.
- `{{package.role.PKR-XXXXXX}}` логически резолвится в рамках конкретного item (helper готов, генерация не запускается).
- `{{field:FLD-000209|211|069}}` в package template → valid (no warning).
- Billing-FLD в package template → warning с русским текстом.
- PKR в каталоге плейсхолдеров отображается по-русски в табличном виде.
- Загрузка DOCX позволяет выбрать «Пакет документов» → пакет; шаблон появляется в Составе.
- Controlled validation не зовёт Gotenberg / strict-generate / ai_generated_documents.
- Proof + memory обновлены.

---

## 11. Порядок исполнения

1. **Discovery** (read-only): схемы, существующие assignment-таблицы, коды billing-групп FLD. Записать в proof.
2. **Migration** `document_package_item_role_assignments` + GRANT + RLS + триггер.
3. **Hook + UI** анкет документов; урезание старого hook.
4. **Validator fix** + `billingFldGroups`.
5. **PlaceholdersCatalog** табличный вид PKR + скрытие legacy.
6. **Template binding** UI в `StrictDocumentTemplatesManager`.
7. **Helper** `resolve-package-tokens` document-level ветка (off).
8. **Proof + memory update**.
9. **QA**: ручная проверка на «Идеология» + реальный приказ (controlled validation должен пройти без блок-ошибок).