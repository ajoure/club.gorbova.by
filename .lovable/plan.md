да, согласен, с учетом правок:

1. Перед UPDATE сделать dry-run rowcount и список orphan training_modules, где parent.product_id IS NOT NULL AND child.product_id IS NULL.
2. Backfill делать только:
  - child.product_id IS NULL
  - parent_module_id IS NOT NULL
  - parent.product_id IS NOT NULL
  - без перезаписи уже заполненного product_id.
3. Триггер:
  - только BEFORE INSERT OR UPDATE OF parent_module_id
  - если NEW.product_id IS NULL
  - наследовать product_id от ближайшего родителя.
4. В audit_logs записать:
  - training_modules.product_id_inherited_backfill
  - affected_count
  - список первых 50 модулей.
5. UI-бейдж «Унаследовано» — только если реально есть product_id_inherited=true; не делать обязательным для первого патча.
6. Главное DoD:
  - «Идеологическая работа в бизнесе» появляется в «Тренинги этого продукта».
  - Новые дочерние вебинары автоматически получают product_id.
  - Picker правил не ломается.

&nbsp;

План:

## Контекст и диагноз (Diagnose)

На вкладке «Продукт → Доступы» дерево «Тренинги этого продукта» (компонент `ProductLinkedTrainingsBlock` + хук `useProductTrainings`) строится **строго по `training_modules.product_id = productId**`. Если у дочернего модуля (например, новый вебинар внутри контейнера «Вебинары») `product_id = NULL`, он в дерево не попадает, хотя физически лежит под нужным родителем.

В то же время мастер правил доступа (`useTrainingContentTree` → `TrainingContentTreePicker`) ходит по `parent_module_id` от корня тренинга и `product_id` не проверяет — поэтому там новые вебинары видны. Отсюда и расхождение, которое описывает пользователь.

Проверка БД подтвердила причину на конкретном продукте «База знаний» (`product_id = 11c9f1b8-…`):

- Контейнер «Вебинары» (TRN-000026) имеет 12 дочерних модулей.
- 11 из них имеют `product_id = 11c9f1b8-…` и видны на вкладке «Доступы».
- Новый вебинар «Идеологическая работа в бизнесе» (создан 28.04.2026, TRN-000054) имеет `product_id = NULL` → невидим в «Доступах», но виден в picker правил.

В `pg_trigger` нет триггера, который наследует `product_id` от родителя при INSERT/UPDATE `parent_module_id`. То есть проблема системная: любой новый модуль/вебинар, созданный без явного указания `product_id`, будет «бесхозным».

Дополнительно: данные на вкладке кешируются React Query и не инвалидируются при возврате на страницу, поэтому без явного refresh обновлений не видно.

## Что сделаем

### 1. Server-side: автонаследование `product_id` от родителя (миграция)

Создать BEFORE INSERT OR UPDATE OF `parent_module_id` триггер `tg_training_module_inherit_product_id` на `public.training_modules`:

- Если `NEW.parent_module_id IS NOT NULL` и `NEW.product_id IS NULL` → подставить `product_id` родителя.
- Не перезаписывать `product_id`, если он уже задан явно (включая случай, когда админ хочет «бесхозный» модуль — задаёт `product_id = NULL` отдельно).
- Добавить `audit_logs` запись `training_module.inherit_product_id` с `{module_id, parent_module_id, inherited_product_id}` для трассируемости.

### 2. Однократный backfill «бесхозных» потомков (миграция, dry-run → execute)

- **Dry-run отчёт** в `.lovable/proofs/training_modules_orphan_product_id_audit.md`: для каждого модуля с `product_id IS NULL` и `parent_module_id IS NOT NULL` показать `{id, title, parent_id, root_product_id, depth}`. Источник истины — `product_id` корня поддерева (модуль с `parent_module_id IS NULL` в цепочке вверх).
- **Execute** UPDATE: проставить `product_id` рекурсивно от корня вниз по дереву только там, где у потомка `product_id IS NULL` и у корня `product_id IS NOT NULL`. Никогда не трогать модули, где корень тоже бесхозный (это легитимные «свободные» тренинги, доступные для bind через UI).
- Записать в `audit_logs` `training_module.product_id_backfill` с количеством обновлённых строк.

### 3. Расширить хук `useProductTrainings` (read-path, мягкая страховка)

Чтобы дерево перестало «терять» новые потомки даже если триггер вдруг не отработает (например, при прямой вставке с обходом):

- В `queryFn` дополнительно подгрузить ВСЕХ потомков (BFS по `parent_module_id`) от уже найденных корней с `product_id = productId`, без фильтра по `product_id`.
- Влить таких потомков в `allModules` с пометкой `product_id_inherited: true` (новый необязательный флаг в `LinkedTraining`).
- В UI рядом с такими модулями показывать маленький значок/тултип «Унаследовано от родителя» (мелкий бейдж, иконка `Info`), чтобы админ видел, что строка появилась через наследование.
- Глубина обхода — итеративная, как в существующем `getAllDescendantIds` (с защитой `MAX_ITERATIONS`).

### 4. Авто-обновление при открытии страницы

В `useProductTrainings` и `useTrainingContentRulesForProduct`:

- Добавить `refetchOnMount: "always"` и `refetchOnWindowFocus: true`.
- На монтирование `ProductLinkedTrainingsBlock` дополнительно вызывать `queryClient.invalidateQueries({ queryKey: ["product-linked-trainings", productId] })` и `["training-content-rules", productId]`.
- (Опционально, без перегруза) realtime-подписка на `training_modules` с фильтром `product_id=eq.<productId>` ИЛИ на `parent_module_id IN (<rootIds>)` — invalidate соответствующих query keys. Если будет дорого — оставить только refetch on mount/focus.

### 5. Привести picker глубины к универсальному обходу

В `useTrainingContentTree` сейчас явный двухуровневый `or(id.eq.,parent_module_id.eq.)` + один проход за внуками. Заменить на тот же итеративный BFS по `parent_module_id`, что используется в `getAllDescendantIds`, чтобы внуки/правнуки не терялись. Это поддерживает уже существующий контракт выбора по модулям/урокам.

### 6. DoD (Definition of Done)

- На странице «Продукт → Доступы» для «Базы знаний» появляется «Идеологическая работа в бизнесе» и любые будущие новые вебинары без ручного bind.
- При создании нового модуля под существующим контейнером `product_id` проставляется автоматически (триггер).
- Backfill выполнен, в `audit_logs` есть запись с количеством обновлённых строк, в proofs-файле — список затронутых модулей.
- Открытие/возврат на вкладку «Доступы» гарантированно перечитывает данные.
- Picker правил продолжает показывать тех же вебинаров (поведение не регрессирует), глубина обхода — единая.
- Никаких изменений write-path для `access_rules` / `entitlements` / `subscriptions` — только наследование `product_id` и read-path.

## Технические детали для реализации

- **Миграции** (две, в одной папке `supabase/migrations/`):
  1. `…_inherit_product_id_trigger.sql` — функция + триггер.
  2. `…_backfill_orphan_product_id.sql` — dry-run select в комментарии + UPDATE + audit.
- **Файлы фронта**:
  - `src/hooks/useProductTrainings.ts` — расширить `queryFn`, добавить `refetchOnMount/Focus`, поле `product_id_inherited` в `LinkedTraining`.
  - `src/hooks/useTrainingContentRules.ts` — заменить выборку модулей в `useTrainingContentTree` на итеративный BFS, `refetchOnMount: "always"`.
  - `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` — `useEffect` invalidate на mount; маленький бейдж «Унаследовано» рядом с такими строками.
- **Proof-файл**: `.lovable/proofs/training_modules_orphan_product_id_audit.md` — список «бесхозных» модулей до backfill + контрольный SELECT после.

Подтверждаете план — выполняю?