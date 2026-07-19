# companies_future_extensions.md

Speculative future scope. **Не добавляем поля в Phase 1** без подтверждённого ближайшего use case.

## 1. Holding / Parent / Subsidiary / Branches / Company Hierarchy

Требования, зафиксированные пользователем как будущая потребность:

- Holding — верхний уровень (юрлицо-родитель).
- Parent Company / Subsidiary — иерархия «мать / дочка».
- Branches — филиалы (может быть без отдельного УНП).
- Company Hierarchy — общее дерево.

## 2. Правило добавления полей

`parent_company_id uuid` и `hierarchy_type text` **не добавляются** в Phase 1 DDL «на всякий случай».

Добавление в Phase 1 допустимо **только при одновременном выполнении**:

- Есть подтверждённый ближайший use case (например, конкретный клиент-холдинг в течение 30 дней).
- Принято отдельное решение в `companies_phase1_execution_plan.md` с явным approval.

Иначе — поля добавляются отдельной миграцией в Phase 11 или позже (add-only, nullable, безопасно).

## 3. Deferred model (эскиз, не для DDL сейчас)

```
companies
├── parent_company_id uuid NULL REFERENCES companies(id)
├── hierarchy_type text NULL — 'holding'|'parent'|'subsidiary'|'branch'
├── hierarchy_level int NULL
└── group_root_company_id uuid NULL — для быстрого запроса группы
```

Индексы (когда/если добавим):

- btree `parent_company_id`.
- btree `group_root_company_id`.

RPC (когда добавим):

- `company_get_hierarchy(_company_id)` — recursive CTE.
- `company_link_parent(_child_id, _parent_id, _hierarchy_type)`.

UI: отдельная вкладка «Структура» в `CompanyDetailSheet`.

## 4. Другие возможные будущие расширения

- Multi-country поддержка: `country` уже canonical поле в `companies` Phase 1, но business-логика (форматы УНП, банки) — только BY на старте.
- Multi-tenant workspaces: `workspace_id` DEFAULT SYSTEM, готово к расширению (см. `.lovable/discovery/crm-tasks-diagnose.md` §Workspace / tenant).
- Entity abstraction (см. freeze ADR-0001): эволюционный путь после Phase 11.
- `company_contact_person_map` (замена / дополнение к `client_legal_details_persons` для company-scope): Phase 10+.

## 5. Что запрещено сейчас

- Добавлять `parent_company_id` / `hierarchy_type` в Phase 1 без approval.
- Планировать Entity abstraction как часть текущего спринта.
- Мигрировать `client_legal_details` в `companies` (compat SoT сохраняется, см. freeze §Rejected X3).
