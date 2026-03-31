# да, согласен, с учетом правок:

&nbsp;

1. **PATCH A не должен добавлять training_content в GrantTargetType и не должен показывать слой 2 как рабочий блок до миграции PATCH B.**
  В PATCH A слой 2 допустим только как planned / not configured yet placeholder или readonly empty state. Иначе получится несоответствие UI и БД.
2. **Rebind / unbind нужно сделать add-only и с явным mapping старого состояния в новое.**
  В плане добавь:
  &nbsp;
  - old_product_id -> new_product_id;
  - список affected root/child modules;
  - список deactivated training_content rules;
  - подтверждение, что никакие product_access / club rules не тронуты.
  &nbsp;
3. **Unbind нужно запретить не только при active training_content rules, но и при наличии дочерних модулей/уроков, которые реально используются в runtime, без явного dry-run preview.**
  Иначе можно получить “свободный” root с наследием в дереве.
  Для unbind обязателен preview:
  &nbsp;
  - сколько descendants;
  - сколько уроков;
  - есть ли legacy module_access;
  - есть ли active rules;
  - есть ли entitlements у пользователей на продукт.
  &nbsp;
4. **В PATCH A в блоке “Привязать тренинг” добавь фильтр и пресеты.**
  Нужны быстрые режимы:
  &nbsp;
  - только свободные;
  - только текущего продукта;
  - все;
  - inactive отдельно.
    Иначе на 80+ модулей UI быстро станет неудобным.
  &nbsp;
5. **public_id для training_modules зафиксируй как обязательный, а не факультативный, но с safe rollout.**
  Не оставляй формулировку “если без риска”.
  Правильно так:
  &nbsp;
  - сначала dry-run генерации;
  - проверка уникальности;
  - затем миграция;
  - если блокер — отдельный mini-patch должен быть выполнен ДО финального proof PATCH A.
    То есть PATCH A без TRN-XXXXXX не считается полностью закрытым.
  &nbsp;
6. **В PATCH A diagnostics block добавь явное поле binding_source = product_id / legacy_only / mixed_conflict.**
  Это упростит понимание, почему конкретный тренинг открыт пользователю.
7. **В PATCH A для rebind child inheritance добавь backend guard, что все descendants реально получат тот же product_id, а не только UI-обещание.**
  Нужен proof query:
  &nbsp;
  - all descendants of root have same product_id as root;
  - no descendants left with old_product_id.
  &nbsp;
8. **В PATCH B уточни, что training_content rules настраиваются только для root training, но allowlist может включать и child modules, и direct lessons root-модуля одновременно.**
  Это нужно прямо прописать, чтобы не было путаницы в mixed tree.
9. **Формат conditions для training_content зафиксируй явно.**
  Не общими словами, а структурой:
  &nbsp;
  - access_mode;
  - allowed_module_ids;
  - allowed_lesson_ids;
    плюс правило: пустой allowlist при partial запрещён.
  &nbsp;
10. **Добавь guard на сохранение partial, если выбран весь тренинг.**
  Если пользователь фактически отметил всё дерево, правило должно нормализоваться в access_mode='full', а не хранить огромный allowlist.
11. **Scope resolution нужно описать с tie-break полностью.**
  Сейчас есть только tariff_id > product_id. Добавь:

&nbsp;

&nbsp;

&nbsp;

- если у пользователя несколько активных подписок/энтitlements на один продукт с разными тарифами, runtime берёт правило по реально активному entitlement/subscription для текущего продукта;
- если одновременно матчится несколько тарифных правил одного уровня — hard fail конфигурации и лог в diagnostics.

&nbsp;

&nbsp;

&nbsp;

12. **PATCH B должен включать backend validation, что root training уже привязан к продукту до сохранения rule.**
  Не просто совпадает product_id, а product_id IS NOT NULL и equals current product.
  Если root ещё не привязан — предложить сначала bind в PATCH A flow.
13. **В PATCH B добавь отдельный proof на mixed structure.**
  Нужен кейс, где:

&nbsp;

&nbsp;

&nbsp;

- у root есть direct lessons;
- есть child modules с lessons;
- partial access разрешает часть direct lessons и один child module;
  runtime должен показать именно это и не больше.

&nbsp;

&nbsp;

&nbsp;

14. **useSidebarModules в PATCH B не делай “если нужно”.**
  Его нужно включить в scope PATCH B обязательно.
  Иначе sidebar и content page будут считать доступ по-разному.
15. **В PATCH B пересчёт lesson_count / completed_count должен быть согласован в одном helper, а не дублироваться по хукам.**
  Иначе потом снова разъедется UI.
  Добавь отдельный shared runtime helper для filtered tree/counts.
16. **Нужен явный guard на product-level full rule + tariff-level partial rule для одного и того же training.**
  Это валидный кейс, не конфликт.
  Runtime должен отдать:

&nbsp;

&nbsp;

&nbsp;

- для тарифа с partial — partial;
- для остальных тарифов продукта — full по product-level rule.
  Это надо зафиксировать как поддерживаемый сценарий.

&nbsp;

&nbsp;

&nbsp;

17. **Нужен запрет на одновременное существование двух product-level rules одного training с разным access_mode.**
  Это уже должно закрыться unique-индексом, но пропиши это и на UI/save уровне с понятной ошибкой.
18. **В PATCH B добавь явный empty-state UX, если у продукта пока нет связанных тренингов.**
  Вместо пустого списка — CTA:

&nbsp;

&nbsp;

&nbsp;

- “Сначала привяжите тренинг к продукту”;
- кнопка перехода к bind flow.
  Это важно, иначе снова будет ощущение “функция не работает”.

&nbsp;

&nbsp;

&nbsp;

19. **PATCH C зафиксируй как cleanup только после proof, что все 6 модулей без product_id либо привязаны, либо отдельно помечены как intentionally legacy/deferred.**
  Нельзя просто удалить legacy fallback, пока эти 6 не классифицированы явно.
20. **В roadmap добавь отдельный mini-patch на нормализацию admin labels уже в PATCH A/B deliverables.**
  То есть:

&nbsp;

&nbsp;

&nbsp;

- сейчас убрать технические коды из primary labels;
- позже в v23.1.11 делать глубокий mapping-layer audit.
  Это должно быть зафиксировано как обязательный UI результат, а не “потом”.

&nbsp;

&nbsp;

&nbsp;

21. **Итоговую цель в начале усили ещё одним предложением:**
  после внедрения админ должен иметь возможность:

&nbsp;

&nbsp;

&nbsp;

- из продукта привязать тренинг;
- из тренинга увидеть и поменять продукт;
- по тарифу ограничить контент внутри уже привязанного тренинга;
- при этом клубные и product→product доступы остаются полностью рабочими.

&nbsp;

&nbsp;

&nbsp;

План: Одна жёсткая связь продукт ↔ тренинг через `training_modules.product_id`, видимая и редактируемая с двух сторон, плюс отдельный слой тарифной гранулярности контента без создания второго контура доступа

---

## Канонические invariants

1. `**training_modules.product_id` — единственный SoT связи «продукт ↔ тренинг».** `access_rules.training_content` НЕ связывает продукт с тренингом, а ТОЛЬКО настраивает гранулярность доступа внутри уже связанного тренинга.
2. **Один тренинг → один продукт. Один продукт → много тренингов.** UI с двух сторон, запись в одно поле.
3. **Entitlement создаётся на продукт, не на тренинг.** Отдельной модели «entitlement на тренинг» нет и не будет. Partial access — только runtime filtering.
4. `**training_content` rule запрещён для чужого тренинга.** Guard на UI + backend: `training_modules.product_id` ДОЛЖЕН совпадать с product_id правила. Hard fail при несовпадении.
5. `**training_content` rule target — только root module** (`parent_module_id IS NULL`). Если target_ref указывает на child-module → reject на backend.
6. **Partial access — только allowlist.** Правило хранит `allowed_module_ids` / `allowed_lesson_ids`. Показывается ТОЛЬКО то, что разрешено.
7. **Legacy `module_access` — read-only хвост.** Новые записи не создаются. Не является SoT. Сворачивание — PATCH C (immediate follow-up).
8. **Partial access НЕ меняет entitlement generation.** Ни grant-access-for-order, ни backfill, ни renewal не создают дополнительных entitlement на тренинг/урок.

---

## Runtime precedence (точный)

```text
1. Нет entitlement на продукт → доступа нет (даже если rule существует)
2. Admin bypass → полный доступ
3. Есть entitlement, нет training_content rule → полный доступ ко всему тренингу
4. Есть entitlement, есть training_content rule с access_mode='full' → полный доступ
5. Есть entitlement, есть training_content rule с access_mode='partial' → только allowed модули/уроки
6. Legacy module_access → temporary read-only fallback (только для 6 модулей без product_id)
```

### Scope resolution (PATCH B)

- `tariff_id` rule имеет приоритет над `product_id` rule (более специфичное выше)
- Несколько правил одного уровня для одного тренинга — ошибка конфигурации, hard fail при сохранении, не merge в runtime
- Runtime берёт scope из подписки/заказа пользователя → находит matching tariff → ищет training_content rule для этого scope

---

## Deliverables: PATCH A → proof A → PATCH B → proof B → PATCH C

**Жёсткая зависимость по порядку.** Proof каждого патча собирается отдельно.

---

## PATCH A: Единая двусторонняя связь + UI + naming

### A1. SQL migration — public_id для training_modules

- `ALTER TABLE training_modules ADD COLUMN IF NOT EXISTS public_id TEXT UNIQUE`
- Триггер auto-generate `TRN-XXXXXX` при INSERT (аналогично `PRD-` для products_v2)
- Заполнить existing модули
- **Правило**: если миграция не создаёт рисков — включить в PATCH A. Если создаёт — отдельный mini-patch сразу следом с тем же proof-пакетом UI. Не растворять.

### A2. Карточка продукта — блок «Тренинги этого продукта» (2 слоя + 2 режима)

**Слой 1 — Привязанные тренинги** (через `training_modules.product_id`):

- Иерархия: root → child modules → count уроков
- Статус active/inactive, public_id (TRN-XXXXXX)
- Кнопка «Привязать тренинг» / «Отвязать»

**Слой 2 — Правила гранулярности** (через `access_rules.training_content`, появится в PATCH B):

- Отдельный блок после привязанных тренингов
- Для каждого правила: тренинг, тариф/scope, full/partial, count разрешённых модулей/уроков

**Матрица «продукт → тренинг → тариф → контент»** с 2 режимами:

- **Summary**: compact-карточки с бейджами full/partial + count
- **Expanded details**: полное дерево модулей/уроков с отметками доступности

### A3. Bind / Rebind / Unbind

**Bind** (свободный тренинг, `product_id IS NULL`):

- Обычная привязка, `UPDATE training_modules SET product_id = ? WHERE id = ?`
- Каскадное обновление всех descendants по `parent_module_id` одним проходом
- Proof query: `SELECT COUNT(*) FROM training_modules WHERE parent_module_id IN (...) AND product_id != ?` = 0

**Rebind** (тренинг другого продукта):

- Обычный bind ЗАПРЕЩЁН
- **Dry-run / preview перед rebind** (обязательно):
  - текущий продукт (name + PRD-XXXXXX)
  - новый продукт (name + PRD-XXXXXX)
  - сколько child-модулей унаследуют новый product_id
  - сколько training_content rules будет деактивировано
  - есть ли legacy module_access
- Только после preview разрешать execute
- При execute: все `training_content` rules старого продукта с `target_ref = this training` **деактивируются** (`is_active = false`)
- Каскадное обновление product_id у всех descendants

**Rebind audit DoD:**

- `audit_logs` записи: `training.rebind.preview` и `training.rebind.executed`
- В meta: список деактивированных rule ids, старый product_id → новый product_id, count affected children

**Unbind** (отвязка от продукта):

- Если есть активные `training_content` rules → прямой unbind запрещён
- Сначала deactivate/archive rules, потом unbind
- При unbind: `UPDATE training_modules SET product_id = NULL WHERE id = ? OR parent_module_id = ?`

### A4. Карточка тренинга — зеркальный обзор (2 слоя)

**Слой 1 — Связанный продукт:**

- Название продукта + PRD-XXXXXX
- Кнопка «Изменить продукт» → меняет `training_modules.product_id` (тот же SoT)
- Кнопка «Перейти к настройке доступа» → навигация в продукт

**Слой 2 — Правила ограничения контента:**

- Действующие training_content rules по тарифам (PATCH B)
- Full/partial + список разрешённых уроков

**Отдельный бейдж:** `⚠ legacy module_access detected` если для этого модуля есть записи в module_access.

### A5. Diagnostics block (readonly, в обоих карточках)

- `product_id`
- Есть ли training_content rules (count)
- Есть ли legacy module_access (count)
- Есть ли конфликт scope/rules

### A6. Нормализация naming (в этом патче)

- Primary label: `training_modules.title` / `products_v2.name`
- Secondary: `public_id` или `product_code` мелким текстом
- В wizard: убрать `cb20`, `cb_module_ip`, `prd_0d01a2fdc477` из primary labels
- Deep normalization mapping → v23.1.11

### A7. Slug-декаплинг

Discovery подтвердил: slug не FK, все связи по UUID. Зафиксировать в UI подсказку.

### A8. Active/inactive тренинги

- В селекторе привязки: показывать и active, и inactive
- Inactive с бейджем, сортировка active выше
- Inactive не показываются пользователю без entitlement/runtime path — это разные вещи

---

## PATCH A — Proof-пакет (собирается до начала PATCH B)

1. **SoT единый**: привязали тренинг из продукта → сразу видно в тренинге; поменяли продукт у тренинга → сразу видно в продукте
2. **UI продукта**: скриншот блока «Тренинги» с 2 слоями (summary + expanded)
3. **UI тренинга**: скриншот зеркального блока с legacy badge + diagnostics
4. **Rebind**: dry-run preview → execute → audit_logs записи → proof query (no orphan children)
5. **Unbind guard**: попытка отвязать тренинг с активными rules → блокировка
6. **No regression**: продукт с полным доступом без partial rules работает; product_access для клуба работает; public_id TRN-XXXXXX показывается
7. **Naming**: wizard не показывает technical codes как primary label

---

## PATCH B: Partial access к контенту уже связанного тренинга по scope продукта/тарифа без создания отдельной модели тренинговых entitlement

### B1. SQL migration

```sql
-- Расширить CHECK constraint
ALTER TABLE access_rules
  DROP CONSTRAINT access_rules_grant_target_type_check;
ALTER TABLE access_rules
  ADD CONSTRAINT access_rules_grant_target_type_check
  CHECK (grant_target_type IN (
    'entitlement', 'club', 'email', 'product_access', 'training_content'
  ));

-- Два UNIQUE ограничения (NULL-safe для tariff_id)
CREATE UNIQUE INDEX access_rules_unique_training_content_product
  ON access_rules (product_id, grant_target_type, target_ref)
  WHERE grant_target_type = 'training_content' AND tariff_id IS NULL;

CREATE UNIQUE INDEX access_rules_unique_training_content_tariff
  ON access_rules (product_id, tariff_id, grant_target_type, target_ref)
  WHERE grant_target_type = 'training_content' AND tariff_id IS NOT NULL;
```

Для `training_content` rules:

- `target_ref` = `training_modules.id` (UUID, только root: `parent_module_id IS NULL`)
- `conditions.access_mode` = `'full'` | `'partial'`
- `conditions.allowed_module_ids` = UUID[] (child modules)
- `conditions.allowed_lesson_ids` = UUID[]

### B2. Backend guards

**При создании/обновлении training_content rule:**

1. `target_ref` → загрузить `training_modules` → проверить `parent_module_id IS NULL` → иначе reject
2. `training_modules.product_id === rule.product_id` → иначе hard fail
3. `allowed_lesson_ids` → все принадлежат target training tree → иначе reject
4. `allowed_module_ids` → все принадлежат target training tree → иначе reject

**Scope uniqueness:**

- Один rule на комбинацию `(product_id|tariff_id) + target_ref`
- Если несколько правил одного уровня → hard fail при save, не merge в runtime

### B3. UI wizard — тип «Доступ к контенту тренинга»

В wizard шаг 2 «Что выдаём»:

```
- Доступ в Telegram-клуб
- Доступ к продукту
- Доступ к контенту тренинга  ← НОВЫЙ
- Системное право (служебный)  ← legacy
```

Шаг 3 «Куда выдаём»:

- Только root тренинги текущего продукта (`WHERE product_id = X AND parent_module_id IS NULL`)
- Active и inactive, inactive с бейджем, active выше
- Отображение: title (primary) + TRN-XXXXXX (secondary)

### B4. Древовидный селектор (шаг 3b)

```text
◉ Весь тренинг
  ☐ Модуль: Итоги месяца
    ☐ Урок 1.1
    ☐ Урок 1.2
  ☐ Модуль: Видеоответы
    ☐ Урок 2.1
```

- По умолчанию: `access_mode: 'full'`
- При снятии чекбоксов → `access_mode: 'partial'` + allowlist
- Partial state (indeterminate) визуально
- Lessonless root-контейнеры: full = все descendants; partial по allowed_module_ids = только выбранные descendants и их уроки

### B5. Runtime — partial access enforcement

Обновить `useContainerLessons`, `useTrainingModules`, `useSidebarModules`:

1. Загрузить training_content rules для тренингов пользователя
2. Scope resolution: tariff_id rule > product_id rule
3. Allowlist фильтрация
4. **Скрыть пустые модули/контейнеры** после фильтрации (если внутри нет разрешённых уроков → модуль не показывается)
5. **Пересчитать lesson_count / completed_count** после фильтрации — карточки не показывают старые total

### B6. grant-access-for-order НЕ меняется

training_content rules не создают entitlements. Entitlement создаётся на продукт (уже работает). Rules читаются только в runtime.

---

## PATCH B — Proof-пакет (собирается отдельно от PATCH A)

1. **Guard foreign training**: попытка создать training_content rule для чужого тренинга → hard fail
2. **Guard child target**: попытка создать rule с target_ref = child module → reject
3. **Guard allowlist consistency**: lesson_id не из target tree → reject
4. **Guard scope uniqueness**: дублирующий rule → hard fail
5. **Partial access runtime**: один тариф видит часть уроков, другой — все
6. **Пустые модули скрываются**: модуль без разрешённых уроков не показывается
7. **Счётчики корректны**: lesson_count / completed_count пересчитаны после фильтрации
8. **No regression (3 сценария)**:
  - продукт с полным доступом без partial rules → работает как раньше
  - product_access для клуба → работает
  - продукт с новым training_content partial rule → ограничение работает
9. **Двусторонняя синхронность**: partial rule из продукта отражается в тренинге без дублирования
10. **Entitlement generation не затронута**: никаких новых entitlement на тренинг/урок

---

## PATCH C: Сворачивание legacy module_access (immediate follow-up после стабилизации PATCH B)

**Не backlog, а обязательный следующий спринт.**


| Хук/компонент            | Действие                         |
| ------------------------ | -------------------------------- |
| `useTrainingModules`     | Убрать чтение module_access      |
| `useContainerLessons`    | Убрать чтение module_access      |
| `useSidebarModules`      | Убрать чтение module_access      |
| `ContentCreationWizard`  | Убрать запись в module_access    |
| `ContentSectionSelector` | Убрать копирование module_access |


Proof: runtime не зависит от legacy-path для product-linked trainings.

---

## Roadmap после PATCH C

**v23.1.11 — Deep naming normalization:**

- Audit всех technical codes в продуктах/тренингах/доступах
- Mapping: `technical_code → admin_label → public_label`
- Без переписывания runtime-кодов без migration/compat plan

---

## Изменяемые компоненты

### PATCH A


| Компонент                    | Изменение                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------- |
| SQL migration                | `public_id` + trigger для training_modules                                      |
| `ProductAccessRulesTab.tsx`  | Блок «Тренинги» (2 слоя, 2 режима) + bind/rebind/unbind + матрица + diagnostics |
| `ProductAccessInfoBlock.tsx` | Расширить: 2 слоя + legacy badge + diagnostics + кнопка изменения               |
| `AdminTrainingModules.tsx`   | Public ID chips                                                                 |
| `useAccessRules.ts`          | Добавить `'training_content'` в `GrantTargetType`                               |
| Naming в wizard              | Primary = title, secondary = code                                               |


### PATCH B


| Компонент                   | Изменение                                 |
| --------------------------- | ----------------------------------------- |
| SQL migration               | CHECK constraint + 2 UNIQUE indexes       |
| `ProductAccessRulesTab.tsx` | Новый тип в wizard + TreeCheckboxSelector |
| `useAccessRuleSelectors.ts` | `useAvailableTrainingModules()`           |
| `useContainerLessons.ts`    | Partial access check + count recompute    |
| `useTrainingModules.tsx`    | Partial access check + count recompute    |
| `useSidebarModules.ts`      | Partial access check                      |


---

## DoD

### PATCH A

1. Из продукта видны привязанные тренинги (слой 1) и правила гранулярности (слой 2) раздельно
2. Bind/rebind/unbind работают с каскадным обновлением descendants
3. Rebind: dry-run preview обязателен → audit_logs записи → no orphan children
4. Unbind: запрещён при активных training_content rules
5. Из тренинга видно связанный продукт + правила + legacy badge + diagnostics
6. Изменение с одной стороны видно с другой
7. `public_id` TRN-XXXXXX (если без риска; иначе mini-patch сразу следом)
8. Slug можно менять без влияния на доступы
9. В UI нормальные названия, не technical codes как primary label
10. Product→product rules не сломаны
11. Club access не сломан
12. Entitlement продукта открывает тренинг
13. Матрица summary/expanded доступна
14. Legacy module_access не пишет новых данных
15. Active/inactive тренинги доступны для настройки, но inactive не показываются пользователю

### PATCH B

16. В wizard тип «Доступ к контенту тренинга» с выбором root тренингов текущего продукта
17. Guard: training_content rule для чужого тренинга → hard fail (UI + backend)
18. Guard: target_ref = child module → reject (backend)
19. Guard: allowlist consistency (уроки/модули из чужого дерева → reject)
20. Два UNIQUE constraint (product-level + tariff-level, NULL-safe)
21. Scope resolution: tariff_id rule > product_id rule; дубли одного уровня → hard fail при save
22. Древовидный чекбокс-селектор с partial state
23. Partial access — allowlist only
24. Runtime: один тариф видит часть уроков, другой — все
25. Пустые модули после фильтрации скрываются
26. lesson_count / completed_count корректны после фильтрации
27. training_content НЕ создаёт второй контур доступа
28. Entitlement generation не затронута (ни grant-access-for-order, ни backfill, ни renewal)
29. No regression: 3 сценария сосуществуют (полный доступ / клуб product_access / partial rule)