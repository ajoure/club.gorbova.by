да, согласен, с учетом правок:

1. **Backend-расширение SOT подтверждено.** Реализовать новую колонку `package_template_item_id`, partial UNIQUE, trigger-guard, обновление RPC и приоритет резолвинга:
2. **Жёстко обеспечить SaaS-изоляцию данных.** Каждое значение должно принадлежать конкретной связке:
  &nbsp;
  ```text
  workspace
  → пользователь/владелец сессии
  → document_package_session
  → package_template
  → package_template_item
  → field_catalog
  ```
  Один клиент не должен иметь возможности читать, изменять или подставлять:
  - чужую сессию;
  - чужое юридическое лицо;
  - чужие значения полей;
  - item другого пакета;
  - поле каталога другого workspace или package template.
3. **RPC не должен доверять переданным ID.** `upsert_session_field_values` обязан серверно проверить:
  - доступ текущего пользователя к сессии;
  - принадлежность `field_catalog_id` пакету этой сессии;
  - принадлежность `package_template_item_id` тому же `package_template_id`;
  - что item действительно входит в пакет сессии;
  - что поле реально обнаружено в активном шаблоне этого item;
  - отсутствие архивности поля;
  - допустимый тип и формат значения.
4. **RLS строить не только через** `session_owner`**, но и через workspace membership/RBAC**, если сессии могут редактировать администраторы или сотрудники клиента. Должны поддерживаться:
  - клиент — только свои сессии;
  - уполномоченный администратор — сессии своего workspace;
  - `service_role` — системные операции;
  - никакого доступа между workspace.
5. **Выбранное юридическое лицо также изолировано внутри сессии.** Проверить, что `selected_legal_entity_id` принадлежит текущему пользователю/workspace и не может быть подменено ID чужой организации. Значения полей одного юрлица не должны автоматически попадать в сессию другого клиента.
6. **Исправить семантику required-ролей.** Нельзя считать обязательную роль заполненной, если она назначена «хотя бы в одном документе». Канон:
  &nbsp;
  ```text
  для каждого package_template_item
  каждая обязательная роль, используемая этим документом,
  должна иметь назначение именно в этом item
  ```
  Gate должен агрегировать незаполненные пары:
  ```text
  package_template_item_id + role/link id
  ```
  а не только роль на уровне всего пакета.
7. **Required-поля проверять также по каждому item.** Для каждой пары:
  &nbsp;
  ```text
  package_template_item_id + field_catalog_id
  ```
  значение считается заполненным, если существует:
  - непустое per-item значение;
  - иначе непустое общее session-level значение.
  Одно per-item значение другого документа не должно удовлетворять gate текущего документа.
8. **Общее session-level значение сохранить как fallback, но не смешивать с per-item UI.** В анкете документа:
  - показывать effective value: per-item либо общее;
  - явно различать наследованное общее значение и собственное значение документа;
  - при изменении создавать per-item override;
  - очистка override должна возвращать fallback к общему, а не сохранять пустую строку как блокирующее значение.
9. **Одна кнопка сохранения документа должна иметь определённую атомарность.** Зафиксировать поведение:
  - сначала валидируются поля и роли;
  - затем сохраняются обе части;
  - при ошибке одной части пользователь получает точное сообщение;
  - UI не должен заявлять «анкета сохранена», если поля сохранились, а роли — нет.
  Предпочтительно использовать один orchestration RPC либо последовательное сохранение с явным partial-failure handling.
10. **Не использовать** `ON DELETE CASCADE` **для item без проверки исторических последствий.** Удаление package template item может уничтожить введённые клиентом значения. Безопаснее:
  - запретить физическое удаление используемого item;
  - архивировать item;
  - либо использовать `ON DELETE RESTRICT`.
  `CASCADE` допустим только если доказано, что package template items никогда не удаляются после появления сессий.
11. **Partial UNIQUE реализовать именованными индексами**, поскольку обычный `ON CONFLICT(column...)` не всегда однозначно работает с partial indexes. RPC должен использовать:
  - явное UPDATE → INSERT;
  - либо корректный `ON CONFLICT` с predicate;
  - либо отдельную серверную функцию для общего и per-item уровня.
  Добавить конкурентный тест двух параллельных upsert одного значения.
12. **Не пересобирать RLS без необходимости удаления существующих политик.** Изменение колонки само по себе не требует новых CRUD-политик, если текущая политика уже корректно проверяет доступ через session. Добавить item/package guard в trigger/RPC, не расширяя права пользователя.
13. **Резолвер должен получать** `package_template_item_id` **доказуемо.** Проверить полный путь генерации каждого документа. Нельзя надеяться на необязательный параметр:
  &nbsp;
  ```text
  package generation
  → конкретный item
  → template version
  → resolve-package-tokens(item_id)
  ```
  Если item context потерян, генерация должна остановиться с канонической ошибкой, а не молча взять общее значение, кроме действительно legacy-вызова без document-item контекста.
14. **Уточнить формулировку “backend pipeline не меняется”.** Pipeline архитектурно не переписывается, но его поведение изменяется через resolver и передачу item context. Это должно быть отражено в proof и regression-тестах.
15. **Шапка аккордеона должна считать заполнение конкретного документа:**
  &nbsp;
  ```text
  X/Y полей · M/N ролей
  ```
  где:
  - поля — уникальные required/total поля активного шаблона item;
  - роли — назначенные/требуемые роли этого item;
  - session fallback учитывается как заполненное поле.
16. **Добавить runtime multi-tenant UAT.**
  - Клиент A создаёт сессию и значения.
  - Клиент B не может прочитать или изменить их через UI, RPC и прямой REST-запрос.
  - Администратор workspace A видит данные согласно RBAC.
  - Администратор workspace B не видит данные.
  - Два клиента могут использовать один и тот же `pf-XXXXXX`, но получать полностью независимые значения.
17. **Добавить runtime по двум документам одной сессии.**
  - Один `pf-XXXXXX` присутствует в двух шаблонах.
  - Для item A сохранено значение `A`.
  - Для item B сохранено значение `B`.
  - В двух итоговых DOCX подставляются разные значения.
  - После удаления override item B используется общее значение сессии.
  - Snapshot каждого документа содержит фактически использованное значение.
18. **Предыдущие D7-проверки включить в новый итоговый прогон**, поскольку новая per-item модель меняет источник значения:
  - HTTP 200;
  - реальная подстановка;
  - snapshot;
  - HTTP 422 при отсутствии required effective value;
  - отсутствие созданного документа при 422.
19. **Не делать избыточный исторический discovery.** Функциональность ещё фактически не используется клиентами, поэтому достаточно короткого preflight существующих строк и проверки отсутствия дублей. После этого можно прямо внедрять новую модель без сложного compatibility-проекта.

Все остальные пункты сохраняются add-only.

&nbsp;

План: объединение анкеты ролей+полей по документам, восстановление кнопки генерации и per-document значения полей.

1. **Проблема**
  - Поля анкеты выводятся одной общей кучей сверху, а роли — внутри документов. Это не идеология.
  - Кнопка «Сформировать пакет документов» остаётся заблокирована даже после полного заполнения анкеты — gate несовместим с новой моделью ролей.
  - Одно и то же pf-поле сейчас имеет ОДНО значение на сессию. Нужно, как у ролей, разрешить разное значение этого же поля в каждом документе.
2. **Диагностика**
  - `DocumentPackageQuestionnairesView.tsx`: общий `PackageFieldsClientForm` стоит над аккордеоном документов; внутри документа — только роли (`useDocumentItemRoleAssignments`).
  - `PackageGenerationPanel.tsx` (стр. 69–98):
    - `requiredRolesStatus` считается через `pkg.participants` и `role_key`, т.е. читает legacy `document_package_session_participants`. Новая канонич. SOT ролей — `document_package_item_role_assignments` (per-document). Поэтому «Не заполнены обязательные роли» висит навсегда → `canGenerate=false`.
    - `requiredFieldsSatisfied` берётся из `usePackageSessionFields(...)` по session+field_catalog_id — пока поля «общие на сессию», это работает; при переходе на per-document надо переориентировать gate на агрегацию по item+field.
  - SOT значений полей сейчас — `document_package_session_field_values(session_id, field_catalog_id)` UNIQUE по этим двум колонкам. Резолвер шаблонов (`supabase/functions/_shared/resolve-package-tokens.ts`) тоже читает по (session, field_catalog_id) — per-item override на бекенде ещё не поддержан.
  - Триггер `dpira_assert_package_match` гарантирует согласованность ролей по item. По полям такого ещё нет.
3. **Предлагаемое решение**
  3.1. **UI (фронт)**
  - Из `DocumentPackageQuestionnairesView` убрать общий блок `PackageFieldsClientForm` сверху.
  - Внутри каждого `AccordionItem` шаблона показывать единую анкету документа:
    - блок полей этого документа (через `usePackageDetectedFields.byItemId[item.id]`);
    - блок ролей этого документа (как сейчас, `useDocumentItemRoleAssignments`).
  - Одна общая кнопка `Сохранить анкету документа` сохраняет и поля, и роли только этого документа.
  - Поля показываем компактно, без `pf-XXXXXX` для клиента, канон календарей `DatePicker` / `DateTimePicker`.
  - В шапке аккордеона: «N/N полей · M назначений».
   3.2. **Per-document значения полей (BACKEND-расширение, аккуратно)**
  - В `document_package_session_field_values`:
    - добавить колонку `package_template_item_id uuid NULL` с FK на `document_package_template_items(id) ON DELETE CASCADE`;
    - снять старый UNIQUE и поставить два partial UNIQUE:
      - `UNIQUE(session_id, field_catalog_id) WHERE package_template_item_id IS NULL` — «общее значение пакета»;
      - `UNIQUE(session_id, field_catalog_id, package_template_item_id) WHERE package_template_item_id IS NOT NULL` — «значение для конкретного документа»;
    - триггер-валидатор: `package_template_item_id` должен принадлежать тому же `package_template_id`, что и сессия и каталог.
  - Обновить RPC `upsert_session_field_values`:
    - добавить опциональный аргумент `_package_template_item_id uuid` (NULL = общий уровень, не-NULL = per-document);
    - upsert по соответствующему UNIQUE;
    - все остальные guards/типизацию значений сохранить.
  - Расширить резолвер `_shared/resolve-package-tokens.ts`:
    - при разворачивании токена `{{pf-XXXXXX}}` в контексте конкретного `package_template_item_id` искать значение сначала per-item, затем fallback на общий уровень сессии;
    - не менять контракт для не-пакетных вызовов.
  - GRANT/RLS: пересобрать политики для новой колонки в той же миграции, оставить `SELECT/INSERT/UPDATE/DELETE` для `authenticated` через `session_owner`, `ALL` для `service_role`.
   3.3. **Хук `usePackageSessionFields**`
  - Дополнить запрос values: тянуть и общий уровень (`item_id IS NULL`), и per-item.
  - Возвращать `valuesByField` (общие) и `valuesByItemField[item_id][field_id]` (per-item).
  - В `save` принимать `package_template_item_id?: string` и пробрасывать в RPC.
  - Расчёт `progress` по требуемым полям: поле считается заполненным, если для item существует per-item значение **или** общее значение сессии.
   3.4. **Кнопка генерации (`PackageGenerationPanel`)**
  - Заменить legacy-проверку обязательных ролей через `pkg.participants` на чтение SOT `document_package_item_role_assignments`, агрегированное по всем `package_template_item_id` пакета. Required = все обязательные роли пакета должны иметь ≥1 назначение хотя бы в одном документе (точная семантика берётся из текущей `Package Document-Level Questionnaires` memory: per-document SOT).
  - `requiredFieldsSatisfied` агрегировать так же по items: required-поле, встречающееся в item, должно иметь либо per-item, либо общее значение.
  - НЕ менять backend pipeline генерации, НЕ трогать `ai-generate-document-package` за пределами резолвера.
4. **Изменяемые компоненты**
  - Frontend:
    - `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx`
    - `src/components/ai-documents/packages/PackageFieldsClientForm.tsx` (рефакторинг в per-item renderer)
    - `src/components/ai-documents/packages/PackageGenerationPanel.tsx` (gate)
    - `src/hooks/usePackageSessionFields.ts`
    - `src/hooks/useDocumentItemRoleAssignments.ts` (доп. агрегатор по всем items, либо новый узкий хук `usePackageRoleAssignmentsAll`)
  - Backend:
    - Новая миграция: колонка `package_template_item_id`, partial UNIQUE, валидирующий триггер, RPC расширение, обновлённые GRANT/RLS.
    - `supabase/functions/_shared/resolve-package-tokens.ts` — fallback chain per-item → session.
5. **Что не будет изменено**
  - НЕ меняем `ai_generated_documents`, `canonical-document-generate-strict`, Gotenberg, storage.
  - НЕ меняем `document_package_item_role_assignments` и его триггеры.
  - НЕ возвращаем `document_package_item_field_assignments` как SOT.
  - НЕ показываем клиенту технические `pf-XXXXXX` для копирования.
  - НЕ создаём второй источник истины для значений полей; per-item — это просто дополнительный уровень в той же таблице.
6. **Dry-run**
  - На staging-сессии: получить snapshot existing `document_package_session_field_values`, убедиться, что все строки попадают под новый partial UNIQUE (`package_template_item_id IS NULL`).
  - Прогнать `resolve-package-tokens.pf.test.ts` + добавить новый кейс: per-item override побеждает общее значение.
  - Прогнать `usePackageSessionFields` dedup-тесты (`src/utils/packageFieldsDedup.ts`) с новой структурой values.
7. **Execute**
  - Сначала миграция (колонка + indexes + триггер + RPC), затем edge-функция резолвера, затем фронт.
  - В RPC и резолвере явные guards: при mismatch `(session.package_template_id ≠ item.package_template_id)` — ошибка `pkg_field_value_item_mismatch`, без silent fallback.
8. **STOP-guards**
  - Если migration детектит дубли по новому UNIQUE — остановиться и репортить (не должно быть, т.к. сейчас уже UNIQUE по (session_id, field_catalog_id)).
  - Если резолвер где-то вызывается без `package_template_item_id` контекста, fallback ОБЯЗАН вернуть общее значение, чтобы не сломать существующие шаблоны.
  - Если в legacy gate генерации обнаружится зависимость от `document_package_session_participants` где-то ещё (генерация, биллинг) — НЕ убирать чтение participants глобально, только в UI gate.
9. **DoD**
  - В клиентской анкете нет общей кучи полей сверху; каждый шаблон содержит свои поля + роли + одну кнопку сохранения.
  - Если pf-поле встречается в 3 документах, клиент может задать 3 разных значения; при отсутствии per-item значения подставляется общее значение сессии.
  - Кнопка «Сформировать пакет документов» становится активной, когда заполнены все обязательные роли (per-document SOT) и все обязательные поля (per-item ИЛИ общее значение).
  - Резолвер pf-токенов в edge-функции уважает приоритет per-item → session.
  - Существующие сессии и шаблоны продолжают работать без миграции данных.
  - Backend pipeline генерации не меняется.
10. **Риски и зависимости**
  - Расширение SOT значений — это backend-миграция и edge-функция; затрагивает резолвер шаблонов. Делать одной согласованной серией: миграция → edge → фронт.
  - Если в будущем понадобится «фиксировать» общее значение при наличии per-item, это уже отдельный UX, не входит в этот патч.
11. **Требуется дополнительная информация**
  - Подтверждение, что готов идти на backend-расширение SOT (новая колонка + триггер + изменение RPC и резолвера). Без него остаётся только UI-перегруппировка и фикс gate генерации; per-document значения полей реализовать невозможно по текущему контракту таблицы.