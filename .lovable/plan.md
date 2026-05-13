Да, по плану всё логично. Критических правок нет.

Я бы добавил только **одну обязательную правку перед approve**:

**Не выбирать A/B/C на уровне вопроса пользователю.**  
Сразу фиксировать решение:

**A + D:**

- деактивировать фантомные parent-entitlements;
- не удалять физически;
- статус: superseded;
- meta-маркер: inv_phantom_parent_v1;
- обязательно закрыть RetroApply, чтобы такие строки больше не создавались.

И добавить в DoD:

- для [lena_times@mail.ru](mailto:lena_times@mail.ru):
  - строка родительского ЦБ-1 с module_scope_only исчезла из активных доступов;
  - доступ к «Маркетплейсы» остался;
  - «Моя библиотека» показывает модуль как раньше;
- по всем 23 пользователям:
  - фантомные parent-entitlements больше не active;
  - отдельные module-entitlements остались active;
  - entitlements физически не удалены;
- RetroApply больше не создаёт parent-entitlement, если уже создаётся standalone module entitlement.

Можно запускать так.

&nbsp;

## План: Моя библиотека — пропавший тренинг ЦБ-1 (и аналогичные)

### Diagnose (что нашёл)

**Кейс:** [lena_times@mail.ru](mailto:lena_times@mail.ru) (`78123ed5-…`). Админ-панель Доступы показывает «Ценный бухгалтер | 1 ступень 2.0 — Активен — через BUSINESS — Область доступа: Отдельные модули». В Моей библиотеке этого тренинга нет, при этом виден отдельный «ЦБ-1 | Модуль: Маркетплейсы».

**Корень — данные RetroApply:**
У пользователя 3 активных entitlement по семейству ЦБ-1:


| product_id | название                     | scope_mode          | historical_module_product_ids                          |
| ---------- | ---------------------------- | ------------------- | ------------------------------------------------------ |
| `7101ed3c` | ЦБ-1 (родительский продукт)  | `module_scope_only` | `[d7effaf4]`                                           |
| `d7effaf4` | ЦБ-1 | Модуль: Маркетплейсы  | `module_scope_only` | `[4c97d21c]` *(это training_module_id, не product_id)* |
| `f833c846` | ЦБ-1 | Модуль: Строительство | `module_scope_only` | `[b7bae7fd]`                                           |


Тренинг-структура:

- root `c9f7e9b8` (product `7101ed3c`, ЦБ-1) — содержит 25+ дочерних модулей курса
- root `4c97d21c` (product `d7effaf4`, Маркетплейсы) — отдельный root, **не дочерний** для `c9f7e9b8`
- аналогично «Строительство» и др. — отдельные root-модули с собственными product_id

**Что делает резолвер (`useTrainingContentRules` + `useTrainingModules`):**

1. Для root `c9f7e9b8` подбирает synthetic-bonus rule по entitlement `7101ed3c` с `module_scope_only` → mapping `[d7effaf4]` → training_modules WHERE product_id IN ([d7effaf4]) → `allowed_module_ids=[4c97d21c]`.
2. Filter `partial`, allowed=[4c97d21c]. Для root код возвращает «keep visible, дети фильтруются» (Learning/useTrainingModules.tsx:269-270).
3. Для каждого реального ребёнка `c9f7e9b8` → `isModuleVisible` ложь (4c97d21c — не его ребёнок) → `has_access=false`, `lesson_count=0`.
4. **Phase E STOP-guard** (useTrainingModules.tsx:302-313): root с `visibleRecursive===0` скрывается → ЦБ-1 пропадает из библиотеки.

Маркетплейсы при этом виден, потому что есть **отдельный** entitlement на product `d7effaf4`, чей synthetic rule даёт allowed=[4c97d21c] и target_ref=4c97d21c (он сам root).

**Почему так получилось.** RetroApply (batch `RETROAPPLY-2026-04-29-…`) при покупке BUSINESS создаёт «теневой» entitlement родительского продукта ЦБ-1 со scope, указывающим на другой продукт-модуль. Этот entitlement функционально дублирует уже существующий entitlement на сам модуль, но создаёт админский «Активен — Отдельные модули» и одновременно «глушит» root в библиотеке (allowed_modules за пределами поддерева → ноль видимых детей → STOP-guard).

**Масштаб (активные entitlements с непустыми historical_module_product_ids и scope_resolution_mode∈{module_scope_only, union_scope}):**


| Родительский продукт      | Затронуто пользователей |
| ------------------------- | ----------------------- |
| ЦБ-1 (родитель)           | **23**                  |
| ЦБ-1 | Маркетплейсы       | 15                      |
| ЦБ-1 | Производство       | 14                      |
| ЦБ-1 | Грузоперевозки     | 9                       |
| ЦБ-1 | Строительство      | 8                       |
| ЦБ-1 | Розничная торговля | 7                       |
| ЦБ-1 | Общепит            | 5                       |
| ЦБ-1 | ПВТ                | 1                       |


23 пользователя — точные кандидаты «исчез ЦБ-1 в библиотеке». Остальные строки — entitlement на сам модуль, там `historical_module_product_ids` ссылается на собственный training_module и резолвер отрабатывает корректно (Маркетплейсы виден).

### Развилка решения (нужно выбрать ДО Plan/Execute)

Логически проблема — **семантика теневого parent-entitlement**. Возможные направления:

**A. Data-fix (рекомендую): убрать «теневые» parent-entitlements.**
Удаляем/деактивируем активные entitlements родительского ЦБ-1 (`7101ed3c`) и других «модуль-родителей», у которых `scope_resolution_mode='module_scope_only'` и `historical_module_product_ids` ссылается на ДРУГИЕ продукты, не покрытые поддеревом этого тренинга. Доступ к самому модулю Маркетплейсы остаётся (отдельный entitlement product=`d7effaf4`). Админ-панель перестаёт врать «через BUSINESS — Отдельные модули» для родителя. Библиотека не меняет логики.
Плюсы: чистый SOT, админу не показывается «теневой» доступ. Минусы: requires Retroapply patch чтобы это не воспроизводилось снова.

**B. Resolver-fix: при `module_scope_only` со ссылкой за пределы своего поддерева — не подавлять root, а возвращать `null` (full-deny на этот product), не вмешиваясь в Phase E.**
Эффект: root остаётся скрытым (как сейчас), но админская панель и data остаются. Не решает первопричину «фантомного» Активен в админке.

**C. UI-fix: показывать root в библиотеке как «есть только Х модулей: Маркетплейсы, …»** даже если allowed_module_ids за пределами поддерева — рендерить root + список покрытых модулей-продуктов с кросс-навигацией.
Плюсы: полное соответствие админ-сообщению. Минусы: меняет визуальную модель библиотеки.

**D. Retroapply-fix (обязателен в любом случае рядом с A): не выдавать parent-product entitlement, если historical purchase — standalone-модуль, имеющий собственный product_id с уже выданным entitlement.** Это устраняет генерацию «теневых» строк впредь.

### Вопросы пользователю (нужны до перехода к финальному Plan)

1. Какой подход: **A+D** (data-cleanup + блокировка повторного создания) или **C** (UI показывает «частичный родитель»)?
2. Если **A+D**: помечать теневые entitlements `status='superseded'` с meta-маркером `inv_phantom_parent_v1`, или физически `archived`? (предпочтение — superseded, он не ломает аудит).
3. Нужен ли отдельный отчёт по 23 пользователям (CSV в `/mnt/documents`) перед write-операцией.

### План работ (после выбора)

После одобрения подхода — **отдельным сообщением** дам уточнённый Plan: миграция/insert-фикс data-set, патч в `grant-access-for-order` / RetroApply, audit, dry-run + execute, верификация Lena + 22 ост., обновление memory `Training Content Resolver Rules`. Сейчас в plan-mode — без записей.

### Технические детали (для справки)

- Точка скрытия root: `src/hooks/useTrainingModules.tsx:302-313` (Phase E STOP-guard).
- Точка генерации синтетического правила: `src/hooks/useTrainingContentRules.ts:278-410` (`resolveBonusScopeRules`).
- Точка резолюции: `useTrainingContentRules.ts:462-586` (Priority 3 = synthetic_bonus).
- Источник entitlement: RetroApply batch (см. `meta.batch_id`, `source_rule_id`, `business_subscription_id`).
- Проверка валидности фикса: для тех же 23 user_id после удаления теневого entitlement → admin Доступы перестаёт показывать «ЦБ-1 — Активен» строкой родителя; library не меняет состав видимого; `useAccessValidation` → доступ к Маркетплейсы сохраняется.