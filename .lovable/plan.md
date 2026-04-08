Да, согласен, с учетом правок:

&nbsp;

1. **Корень патча сформулирован правильно**
  Сейчас нельзя чинить дальше классификацию, пока не доказан базовый execute-path. Приоритет верный:
  &nbsp;
  - сначала missing_access create-path;
  - потом честный post-result;
  - только потом точечный разбор Елизаветы и, при необходимости, узкая правка классификации.
  &nbsp;
2. **Нужно явно добавить проверку insert-error в create-path**
  В DoD и dry-run стоит прямо требовать:
  &nbsp;
  - лог/ответ execute по каждой missing_access строке;
  - отдельное поле или массив ошибок insert/update;
  - нельзя считать строку просто skipped, если был реальный insert/update error.
  &nbsp;
3. **В execute-результате лучше разделить skipped на два типа**
  Не просто:
  &nbsp;
  - skipped
  - not_selected
  &nbsp;
  А:
  &nbsp;
  - not_selected
  - skipped_idempotent
  - skipped_conflict
  - skipped_error
  &nbsp;
  Иначе UI опять будет путать “не запускали” и “запускали, но не применили”.
4. **Для after-proof по Елизавете нужен не только preview_after, но и прямой DB-proof**
  Добавь в Execute-блок:
  &nbsp;
  - before: список target_product_id, которых у неё нет в entitlements;
  - after: те же target_product_id появились / не появились;
  - затем сверка с карточкой контакта.
  &nbsp;
  Иначе можно снова уткнуться в ситуацию: запись в БД есть, но карточка не показывает.
5. **По update-path нужно закрепить merge-правило**
  В плане лучше явно записать:
  &nbsp;
  - meta = { ...oldMeta, ...retroapplyPatch }
  - запрещено удалять существующие ключи, кроме специально оговоренных
  - если meta отсутствует, создавать add-only объект
  &nbsp;
  Это важно как отдельный STOP-guard, не только как пожелание.
6. **Для create-path нужен отдельный idempotency-proof**
  После первого safe execute:
  &nbsp;
  - preview_after должен уменьшить missing_access;
  - повторный execute должен дать created = 0;
  - и это должно быть доказано именно на тех же action_id.
  &nbsp;
7. **Статус патча**
  Правильно не закрывать его до получения сразу трех proof:
  &nbsp;
  - create-proof;
  - honest execute-stat-proof;
  - Elizabeth after-proof.
  &nbsp;
8. **Финальный статус лучше зафиксировать заранее**
  Пока патч не закрыт, формулировка должна быть такой:
  &nbsp;
  - rules-retroapply UI/engine partially fixed
  - safe create-path pending proof
  - Elizabeth case pending proof
  - reducible_by_rule runtime-proof absent or confirmed separately
  &nbsp;

&nbsp;

&nbsp;

Если коротко: план хороший и логика верная. Это уже правильный путь — не расширять вслепую механику конфликтов, а сначала починить реальный create/execute/result pipeline и доказать его на живом кейсе.

&nbsp;

План:

### Проблема

По текущему поведению RetroApply у пользователя создаётся ложное ощущение успешного применения:

- safe execute визуально “срабатывает”, но доступы фактически не появляются;
- зелёный post-result блок показывает недостоверную картину;
- по кейсу Елизаветы Семашкевич не доказано, это ошибка execute-path, ошибка классификации или оба дефекта сразу.

### Диагностика

По коду уже видно 3 реальные проблемы:

1. **Сломан create-path для `missing_access**`
  В `supabase/functions/rules-retroapply/index.ts` insert в `entitlements` пишет `source: "retroapply"`, но текущий контракт `entitlements` в `src/integrations/supabase/types.ts` такого поля не содержит. Это главный кандидат на `created = 0` при safe execute.
2. **Update-path опасно затирает `meta**`
  В `index.ts` update пишет новый `meta` целиком, а не merge. Это может уничтожать lineage, `business_subscription_id` и другие служебные поля.
3. **Счётчик execute искажён по смыслу**
  `executeActions()` увеличивает `skipped` для всех preview-строк, которые вообще не входили в таргет execute. Поэтому safe run на 3 строках может показать `skipped = 1100`, хотя реально 1097 строк вообще не пытались применять.

Дополнительно:

- текущий preview по продукту уже показывает `missing_access = 3`, значит живой safe create-case в датасете есть;
- runtime-proof для `reducible_by_rule` всё ещё не доказан;
- `requires_manual_review` по коду есть, но живой кейс не подтверждён.

### Предлагаемое решение

#### 1) Починить engine так, чтобы execute был реальным, а не “отчётным”

Файл: `supabase/functions/rules-retroapply/index.ts`

- **Create-path**
  - убрать запись в несуществующий столбец `source`;
  - писать происхождение только в `meta`:
    - `source_type: "retroapply"`
    - `source_rule_id`
    - `source_window_rule`
    - `business_subscription_id`
    - `batch_id`
    - `retroapply: true`
  - при наличии `profile_id` передавать его тоже.
- **Update-path**
  - сначала читать текущий `meta`;
  - делать **merge**, а не overwrite;
  - добавлять только retroapply-поля (`retroapply_updated`, `batch_id`, `source_rule_id`), не стирая существующий lineage.
- **Execute-статистика**
  - разделить:
    - `targeted_total` — сколько строк реально вошло в текущий execute;
    - `created`
    - `updated`
    - `skipped` — только реально таргетированные, но не применённые;
    - `not_selected` / `not_in_scope` — строки preview, которые не пытались применять;
  - при возможности вернуть `created_action_ids` / `updated_action_ids` / `skipped_action_ids` add-only полями.

#### 2) Починить UI, чтобы он показывал правду

Файл: `src/components/admin/product/RetroApplyPanel.tsx`

- зелёный блок после execute должен опираться на **фактический scope запуска**, а не на весь preview;
- текст должен явно разделять:
  - что реально было запущено;
  - что создано/обновлено;
  - что не вошло в execute;
  - что пропущено по идемпотентности/ошибке;
- auto-refresh preview оставить, но post-result блок должен честно переживать сценарий:
  - execute завершился;
  - preview_after обновился;
  - таблица уже показывает новое состояние;
- если preview_after не обновился, показывать это явно, а не писать будто таблица уже актуальна.

#### 3) Разобрать кейс Елизаветы точечно, без широкой слепой переклассификации

- разложить её цели по `target_product_id`:
  - что из них `missing_access`,
  - что `condition_not_met`,
  - что `conflict_existing`,
  - что уже выдано;
- если после починки create-path её missing_access-строки всё ещё не появляются в карточке контакта, тогда уже делать **узкий** патч классификации/execute для конкретной причины;
- не менять массово конфликтную модель, пока dry-run не докажет, что проблема не в create-path.

#### 4) Привести статус патча к честному виду

- `reducible_by_rule` считать реализованным по коду, но не доказанным runtime, пока нет живого execute-proof;
- `requires_manual_review` либо показать на живом preview-кейсе, либо убрать из статуса “доказано”.

### Изменяемые компоненты

- `supabase/functions/rules-retroapply/index.ts`
- `src/components/admin/product/RetroApplyPanel.tsx`

### Что не будет изменено

- структура таблиц;
- RLS;
- другие edge functions;
- общий UI-layout панели сверх правок правдивости post-result;
- логика правил `access_rules`, если dry-run не докажет ошибку именно в классификации.

### Dry-run

Перед реальным патчем проверить и зафиксировать:

1. **Create-path proof**

- preview_before на текущем продукте;
- выделить 3 строки `missing_access`;
- сопоставить их с фактическим отсутствием `entitlements`.

2. **Elizabeth proof**

- отдельно разложить строки Елизаветы по категориям и целевым продуктам;
- доказать, какие из ожидаемых доступов у неё реально должны создаваться именно сейчас.

3. **Meta proof**

- зафиксировать пример текущего `meta` у entitlement, который должен обновляться;
- заранее определить ожидаемый merged `meta` после execute.

### Execute

После реализации:

1. `preview_before`
2. `execute_safe_only`
3. `preview_after`
4. проверка карточки контакта Елизаветы после обновления
5. `repeat execute`

Отдельно:

- если в датасете есть живой `reducible_by_rule`, сделать отдельный selected/with_reductions proof;
- если нет — прямо зафиксировать, что runtime-proof по сокращению срока ещё отсутствует.

### STOP-guards

- если dry-run покажет, что строки Елизаветы находятся в `condition_not_met`, не маскировать это “ремонтом execute”;
- не перетирать `meta` целиком ни при каком update;
- не считать `not selected` как `skipped`;
- не менять массово классификацию конфликтов без доказанного кейса;
- не закрывать патч как “полностью завершённый”, пока нет живого create-proof и after-proof в карточке контакта.

### DoD

- safe execute на текущем продукте реально создаёт missing_access-записи, а не делает no-op;
- post-result блок больше не врёт про `skipped = весь preview`;
- `preview_after` и карточка контакта показывают одно и то же состояние;
- `meta` после update сохраняет старые поля и дополняется retroapply-маркерами;
- по Елизавете есть доказательство по каждой ожидаемой цели: создано / не создано / почему;
- `repeat execute = 0 изменений`;
- `reducible_by_rule` либо доказан на живом кейсе, либо в финальном статусе честно помечен как не доказанный runtime;
- `requires_manual_review` либо подтверждён живым preview-кейсом, либо убран из статуса как недоказанный.