да, согласен, с учетом правок:

&nbsp;

1. workspace_id нужно добавить во все новые таблицы и учитывать его в новых колонках/связях.  
Сейчас crm_pipelines, crm_pipeline_stages, crm_pipeline_product_bindings не соответствуют multi-tenant модели. Для этой платформы это обязательный слой изоляции данных.
2. Нужно довести DDL до канонического стандарта сущностей.  
В crm_pipelines и crm_pipeline_stages не хватает public_id.  
В crm_pipeline_product_bindings не хватает как минимум:  

  - public_id
  - workspace_id
  - metadata
  - updated_at
  - created_by
  - updated_by  
  Иначе новые сущности выбиваются из общей модели платформы.
3. &nbsp;
4. RLS нельзя оставлять как “policy для authenticated” без конкретики.  
В плане нужно явно прописать:  

  - read по workspace scope,
  - write только для ролей с правом редактирования сделок/воронок,
  - view-only не может создавать/удалять/переставлять воронки и стадии,
  - bindings тоже изолируются по workspace.  
  Иначе это слишком расплывчато для safe execution.
5. &nbsp;
6. Нужен жёсткий инвариант: pipeline_stage_id должен принадлежать выбранному pipeline_id.  
Одних FK недостаточно.  
Нужно явно добавить в план:  

  - либо DB trigger / constraint helper,
  - либо server-side/service validation,
  - лучше оба уровня.  
  Иначе можно получить сделку с pipeline_id = A, а pipeline_stage_id от воронки B.
7. &nbsp;
8. ON DELETE CASCADE для стадий и биндингов сейчас слишком опасен.  
Если пользователь или код удалит pipeline, каскадно исчезнут stages/bindings, а сделки потеряют классификацию.  
Для этой задачи лучше:  

  - удаление pipeline/stage только через controlled remap/cleanup,
  - на уровне БД — RESTRICT / NO ACTION,
  - UI guard остаётся, но БД тоже должна страховать.
9. &nbsp;
10. Автоматическое назначение воронки через product binding сейчас недоопределено.  
Вы сами заложили гибкость “один продукт ↔ несколько воронок”, но тогда auto-assignment становится неоднозначным.  
Нужно в плане выбрать одно из правил:  

  - либо у продукта может быть только одна auto-default воронка;
  - либо при нескольких bindings auto-assignment отключается и остаётся только manual assignment;
  - либо в bindings вводится priority / is_default_for_product.  
  Без этого логика будет конфликтной.
11. &nbsp;
12. Initial mapping “все существующие сделки → default pipeline → стадия Новая” слишком агрессивный.  
Это уже не просто UI-изменение, а массовое изменение данных и истории.  
Лучше зафиксировать безопасный порядок:  

  - dry-run,
  - показать counts,
  - по умолчанию оставить старые сделки pipeline_id = NULL, pipeline_stage_id = NULL,
  - дать controlled bulk-assign отдельно,
  - либо явно подтвердить backfill только после proof.  
  Иначе можно исказить реальную историческую картину продаж.
13. &nbsp;
14. Нужны uniqueness / default guards.  
Добавить в план:  

  - не более одной is_default = true воронки на workspace,
  - не более одной is_default = true стадии внутри pipeline,
  - unique order_index внутри pipeline,
  - unique order_index для pipeline внутри workspace,
  - CHECK (order_index >= 0).
15. &nbsp;
16. В URL и UI лучше использовать public_id / code, а не raw UUID.  
UUID — внутренняя связь. Для UI и пользовательских ссылок в платформе лучше использовать публичный идентификатор или стабильный code. Это ближе к архитектурному стандарту ID-driven + public_id.
17. Нужно явно описать “Без воронки” и “Без стадии” как first-class fallback states.  
Сейчас это упомянуто частично, но надо зафиксировать поведение:

&nbsp;

&nbsp;

&nbsp;

- сделки без pipeline не теряются,
- list-view умеет показывать их отдельно,
- board-view не ломается, если у части сделок нет pipeline/stage,
- фильтры умеют работать по NULL bucket.

&nbsp;

&nbsp;

&nbsp;

11. Бизнес-логика не должна уехать в hooks.  
В плане сейчас usePipelines.ts, usePipelineStages.ts, useDealsBoard.ts выглядят как место, где окажется почти вся логика.  
Нужно дописать, что hooks — это orchestration/query state, а правила:

&nbsp;

&nbsp;

&nbsp;

- create/delete pipeline,
- remap,
- reorder,
- assignment,
- validation  
живут в отдельном service/API слое.

&nbsp;

&nbsp;

&nbsp;

12. DoD нужно усилить machine-check proof-ами.  
Добавить обязательные проверки:

&nbsp;

&nbsp;

&nbsp;

- сумма карточек по всем колонкам = числу сделок в текущем pipeline/filter scope,
- counts до и после backfill,
- сколько сделок осталось без pipeline,
- сколько без stage,
- ни одна сделка не имеет stage из чужой pipeline,
- после удаления/remap не осталось orphan references.

&nbsp;

&nbsp;

&nbsp;

13. Follow-up теперь в целом корректный: multi-pipeline уже правильно вынесен из follow-up в основной scope.  
Это изменение уже учтено верно. Новые замечания выше допустимы, потому что у плана появился новый фактический материал: multi-pipeline DDL, bindings, delete semantics, initial mapping.

&nbsp;

&nbsp;

После внесения этих правок план уже можно утверждать.

&nbsp;

# План: CRM Воронка продаж — Multi-Pipeline Kanban Board

## Discovery-отчёт (сводка)

### Данные

- **SoT сделок**: `orders_v2` (2847 записей, 5 payment-статусов: paid/pending/failed/refunded/canceled)
- **Pipeline/stage модель**: отсутствует. `pricing_stages` — ценовые этапы продуктов, не CRM. `status` — платёжный lifecycle.
- **Продукты**: 20+ продуктов, топ-3 по сделкам: Club (1698), Ценный бухгалтер (442), ЗАКРОЙ ГОД (316)
- **Pipeline таблиц нет**: `crm_pipeline%` — пусто

### UI

- Route: `/admin/deals` → `AdminDeals.tsx` (1183 строк)
- `@dnd-kit` используется в 15+ файлах проекта
- Pill-tabs, GlassCard, GlassFilterPanel, QuickFilters, PeriodSelector — все переиспользуемы
- `usePermissions` → `canWrite("deals")` — готов
- `audit_logs` → стандартная схема (actor_user_id, action, meta, actor_type, actor_label)

### Вывод: новые таблицы необходимы

Нет ни одного существующего поля/таблицы пригодного для CRM pipeline stage. `status` = payment lifecycle, `pricing_stages` = ценовая модель. Add-only модель — единственный путь.

---

## Архитектура

```text
AdminDeals.tsx
├── [Pipeline selector: dropdown/tabs по воронкам]
├── [View toggle: Список | Воронка]
├── Общие: search, product pills, date filter, permissions
├── LIST VIEW (текущий, без изменений, + фильтр pipeline_id)
└── BOARD VIEW
    └── DealsKanbanBoard.tsx
        ├── KanbanSummaryStrip (total value, won/lost counts)
        ├── KanbanColumn.tsx (per stage)
        │   ├── KanbanColumnHeader (name, count, sum, avg, menu)
        │   └── KanbanDealCard.tsx (glass card + visual signals)
        └── StageManagementDialog.tsx (create/rename/delete/remap)
```

---

## DDL (миграция)

### 1. `crm_pipelines`

```sql
CREATE TABLE public.crm_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,                          -- display/config only, NOT SoT
  order_index INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
-- RLS + policy для authenticated
```

### 2. `crm_pipeline_stages`

```sql
CREATE TABLE public.crm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  stage_type TEXT NOT NULL DEFAULT 'open'
    CHECK (stage_type IN ('open', 'closed_won', 'closed_lost')),
  order_index INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (pipeline_id, order_index)
);
-- RLS + policy
```

### 3. `crm_pipeline_product_bindings`

```sql
CREATE TABLE public.crm_pipeline_product_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products_v2(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, product_id)
);
-- RLS + policy
```

### 4. Колонки в `orders_v2`

```sql
ALTER TABLE public.orders_v2
  ADD COLUMN pipeline_id UUID REFERENCES public.crm_pipelines(id) ON DELETE SET NULL,
  ADD COLUMN pipeline_stage_id UUID REFERENCES public.crm_pipeline_stages(id) ON DELETE SET NULL;
```

### 5. Seed

```sql
-- Default pipeline
INSERT INTO crm_pipelines (name, code, order_index, is_default) 
VALUES ('Основная', 'default', 0, true);

-- 4 стадии: open → open → closed_won → closed_lost
INSERT INTO crm_pipeline_stages (pipeline_id, name, color, order_index, stage_type, is_default) VALUES
  ((SELECT id FROM crm_pipelines WHERE code='default'), 'Новая',    '#6366f1', 0, 'open', true),
  ((SELECT id FROM crm_pipelines WHERE code='default'), 'В работе', '#f59e0b', 1, 'open', false),
  ((SELECT id FROM crm_pipelines WHERE code='default'), 'Успешно',  '#22c55e', 2, 'closed_won', false),
  ((SELECT id FROM crm_pipelines WHERE code='default'), 'Отказ',    '#ef4444', 3, 'closed_lost', false);
```

---

## Scope

### 1. Pipeline selector

- Dropdown / tabs в toolbar для выбора текущей воронки
- Board показывает стадии выбранной воронки
- List-view фильтруется по pipeline_id
- Состояние в URL `?pipeline=UUID&view=board`

### 2. Pipeline CRUD (inline)

- Создание новой воронки (имя)
- Привязка продуктов (product bindings)
- Переименование, удаление (с guard: есть сделки → запрет или remap)
- Audit на все операции

### 3. Stage management (inline в board)

- Создание, переименование, reorder, удаление с remap wizard
- Closed stages (Успешно/Отказ): всегда справа, нельзя удалить без cleanup, можно rename, нельзя потерять `stage_type` семантику
- Unique `order_index` внутри pipeline

### 4. Board view

- Колонки = стадии + "Без стадии" (NULL)
- Sticky column headers: name, count, sum, avg — пересчёт после drag
- Sticky summary strip: total active pipeline value, won/lost counts
- Glass UI в стиле платформы

### 5. Deal card (priority layout)

- Название продукта
- Контакт (имя/email)
- Сумма + currency
- Номер сделки
- Payment status badge
- Дата обновления
- **Visual signals**: stale (>7 дней), high-value (>500 BYN), failed payment
- **Hover quick actions**: переместить в стадию (dropdown), открыть детали

### 6. Перемещение сделок — два способа

1. Drag & drop между колонками (`@dnd-kit`)
2. Меню на карточке → "Переместить в стадию"

- Optimistic UI + rollback + audit log

### 7. Pipeline assignment для существующих сделок

- Auto: через `crm_pipeline_product_bindings` (product_id → pipeline_id)
- Manual: пользователь меняет воронку вручную
- Fallback: сделки без binding → "Без воронки" / default pipeline
- Initial mapping при seed: все существующие → default pipeline, stage = "Новая"

### 8. Audit

- `pipeline.created/renamed/deleted`
- `pipeline_stage.created/renamed/deleted/reordered`
- `deal.stage_changed` (old/new stage + pipeline)
- `deal.pipeline_changed`

### 9. Permissions

- View-only → board видим, drag/edit disabled
- `canWrite("deals")` → drag + stage management

---

## Файлы


| Действие  | Файл                                                                     |
| --------- | ------------------------------------------------------------------------ |
| Migration | 3 таблицы + 2 колонки + RLS + seed                                       |
| Edit      | `src/pages/admin/AdminDeals.tsx` — pipeline selector, view toggle, board |
| New       | `src/components/admin/deals/DealsKanbanBoard.tsx`                        |
| New       | `src/components/admin/deals/KanbanColumn.tsx`                            |
| New       | `src/components/admin/deals/KanbanColumnHeader.tsx`                      |
| New       | `src/components/admin/deals/KanbanDealCard.tsx`                          |
| New       | `src/components/admin/deals/StageManagementDialog.tsx`                   |
| New       | `src/components/admin/deals/KanbanSummaryStrip.tsx`                      |
| New       | `src/components/admin/deals/PipelineManagementDialog.tsx`                |
| New       | `src/hooks/usePipelineStages.ts`                                         |
| New       | `src/hooks/useDealsBoard.ts`                                             |
| New       | `src/hooks/usePipelines.ts`                                              |


---

## НЕ делаем

- ML-раскладку
- Конструктор автоматизаций
- Дублирование deals storage
- Hardcoded стадии в UI
- Отдельную страницу/route

## Follow-up (второй спринт)

- Customize card fields
- Stage probabilities
- SLA / stage timers
- Pipeline analytics / conversion funnel
- Перемещение из DealDetailSheet
- Automations / rules engine
- Advanced pipeline permissions

## DoD

1. Можно создать несколько воронок с разными стадиями
2. Каждая воронка имеет свой набор стадий с closed_won/closed_lost семантикой
3. Привязка продуктов к воронкам работает
4. Переключатель Список/Воронка + pipeline selector
5. Board показывает стадии только выбранной воронки
6. Drag & drop + menu перемещение сделок
7. Totals по колонкам (count, sum, avg) пересчитываются после drag
8. Sticky summary strip с pipeline value / won / lost
9. Карточка: product, contact, sum, status, stale/high-value signals
10. Stage deletion с remap wizard
11. Closed stages (Успешно/Отказ) всегда справа, нельзя удалить без cleanup
12. Audit logs на все pipeline/stage/deal операции
13. List-view не сломан
14. Permissions respected (view-only = no drag/edit)
15. Второй способ перемещения (menu), помимо drag
16. После refresh — pipeline, view, стадии сохраняются