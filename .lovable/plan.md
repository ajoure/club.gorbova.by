# PLAN-ONLY REVIEW — PR #310 (role-based access to historical data)

Вердикт: **PASS с условиями** (2 обязательных условия перед EXECUTE, 0 блокирующих дефектов в SQL).
Изменений не вносил: только чтение diff и managed production metadata.

## 1. Точный SHA и production-факты

- Production-connected main SHA до PR: `e6bbe7336365d2109ea50db71b0d75fc3fcc8f9e` — подтверждён локально (`git rev-parse HEAD`).
- PR head SHA: `ffd06c51cd885ee13d796f2dc2cd4591a5c8e5a2` (draft PR #310), diff прочитан (1018 строк, 14 файлов, 1 новая миграция).
- Миграция `20260814134846_fix_role_data_access_contract.sql` в дереве `e6bbe733` отсутствует; последняя применённая в репозитории — `20260814130836`. Версия НЕ применена, дубликата нет. Прямое чтение `supabase_migrations.schema_migrations` из sandbox запрещено (permission denied) — сверка ledger выполняется в EXECUTE через managed sync.
- Текущие CHECK-ограничения: `role_admin_section_access` и `role_admin_resource_access` допускают только `none | view | manage` — уровень `edit` физически не сохраняется. Это подтверждает заявленную первопричину.
- Фактические значения: section-грантов `manage`=42, `none`=15, `view`=3; resource-грантов `manage`=19. Значений `edit` нет — backfill не требуется.
- `public.get_admin_access(uuid)` уже использует `has_role_v2('super_admin'/'admin')`, но ранг только 2-уровневый (`manage`=2, `view`=1) и строки фильтруются `lvl_rank > 0`, то есть явный `none` теряется.
- `public.has_admin_section_access(uuid,text,text)` всё ещё делает bypass через legacy `has_role(_user_id,'superadmin'::app_role)` — это второй подтверждённый дефект.
- ACL обеих функций уже `authenticated, service_role` (без anon/PUBLIC) — миграция это лишь закрепляет.
- Роли и гранты по ключевым секциям: `admin` и `menedzher` — manage по contacts/deals/forms-hub/training; `support` — manage contacts/deals, view forms-hub, none training; `super_admin` — 0 явных грантов, полностью зависит от canonical bypass (в патче bypass сохранён в обеих функциях — PASS).
- Legacy-администраторы без записи в `user_roles_v2`: **0** (v2-админов 8, legacy 2, разница пустая) — удаление legacy-политик `course_preregistrations` никого не отрежет.
- RLS включён на всех 9 таблицах scope. Табличные привилегии `authenticated`/`service_role` присутствуют везде (`training_modules`/`training_lessons` — без anon, что корректно).
- Секция `forms-hub` существует и активна (24 активных секции, 18 активных resource).

## 2. Preflight (read-only, выполнить непосредственно перед EXECUTE)

1. Подтвердить, что merged main SHA совпадает с одобренным, и что файл миграции в дереве байт-в-байт равен ревизованному.
2. Снять baseline-счётчики: `profiles=12074`, `orders_v2=4629`, `site_form_submissions=47`, `course_preregistrations=35`, `lesson_progress_state=75`, `training_modules=148`, `training_lessons=604`, `site_pages=24`, `products_v2=38`.
3. Снять baseline политик по 9 таблицам (`pg_policies` count) и текст обеих функций (`pg_get_functiondef`) в артефакт для отката.
4. Подтвердить отсутствие версии `20260814134846` в ledger.
5. Подтвердить, что распределение access_level не изменилось с момента ревизии (нет значений вне `none/view/manage`).

## 3. Findings ревизии

PASS:
- Четырёхуровневый CHECK (`none/view/edit/manage`) корректен, расширяющий, не требует backfill.
- Новый ранг 0..3 и `max()` дают корректное «highest access wins» при нескольких ролях.
- Явный resource-`none` теперь возвращается отдельной строкой; `useAdminAccess.getResourceLevel` возвращает override как есть, поэтому запрет не «проваливается» в section-уровень — семантика explicit none соблюдена.
- Canonical bypass `super_admin`/`admin` сохранён в обеих функциях и переведён на `has_role_v2`; legacy `app_role`-путь удалён.
- `SET search_path = ''` безопасен: все объекты схемо-квалифицированы, остальные вызовы — `pg_catalog`.
- Все новые политики `TO authenticated`, permissive, с `(SELECT auth.uid())`; DELETE только на уровне `manage`, `lesson_progress_state`/`training_*`/`products_v2`/`site_pages` — только SELECT. Семантика view/edit/manage соблюдена.
- Frontend: реальные ошибки запросов больше не превращаются в «пустой список» (`if (error) throw error` + `FormsHubLoadError`); bulk-delete и редактирование переведены с хардкода роли на `canAccessSection('forms-hub', 'manage'/'edit')`.

Findings (не блокируют SQL, но требуют решения):

- **F1 — ЗАКРЫТ (PASS) на head SHA `0f97a2999269cffd9ca45e80aab9ea3db9f38a5d`.** Diff `ffd06c51…..0f97a299…` — 2 файла, одно смысловое изменение: `usePermissions.hasAdminAccess()` вместо `sectionLevels.size > 0` возвращает `Array.from(sectionLevels.values()).some(level => LEVEL_RANK[level] >= LEVEL_RANK.view)`. `LEVEL_RANK = {none:0, view:1, edit:2, manage:3}`, в `sectionLevels` попадают только section-строки (`resource_code IS NULL`) с максимальным рангом — роль с одними явными `none` в админ-оболочку больше не попадает, `view/edit/manage` сохраняют доступ. Legacy-ветки (`super_admin`/`admin`, permission-коды) не затронуты, `useAdminAccess`/`AdminRouteGuard` (deny-by-default) не менялись. Добавлен regression source-contract тест. Новых дефектов и расширений прав diff не вносит.
- **F2 (medium, производительность) — обязательный pre-Publish gate.** `profiles` (12074) и `orders_v2` (4629) получают per-row вызов `has_admin_section_access` → `get_admin_access` (plpgsql, набор CTE).

  Уточнённый план замера:
  - Метод: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` под ролью `authenticated` с подставленными `request.jwt.claims` тестового пользователя для каждой категории (view-роль, manage-роль, explicit none). Возвращаются только план и тайминги — ни одной строки данных, без PII и без UUID пользователей в отчёте.
  - Запросы: те же, что шлёт UI, но в безопасной форме — `SELECT count(*)` и `SELECT 1 FROM … LIMIT 50` c реальными фильтрами и сортировкой списков контактов (`public.profiles`) и сделок (`public.orders_v2`).
  - Baseline — на текущем production до применения миграции; пост-замер — сразу после применения, те же запросы и роли, 3 прогона, медиана.
  - Hard stop: рост медианного `Execution Time` более чем в 2 раза или свыше 1000 мс на любом запросе; рост `shared read` буферов более чем в 3 раза; появление в плане вызовов функции числом порядка количества строк таблицы.
  - При превышении порога Publish не выполняется, миграция откатывается по разделу 7, смягчение — однократное вычисление через `(SELECT public.has_admin_section_access(...))` или STABLE-обёртка с кэшем на запрос.

- **F3 (low, асимметрия).** На `course_preregistrations` legacy admin-политики удаляются, а на `site_form_submissions` аналогичные `Admins can …` остаются. Итог корректен (permissive OR), но контракт «доступ только через forms-hub» соблюдён не полностью.
- **F4 (low, расширение видимости).** Новая SELECT-политика на `profiles` открывает все исторические профили любому с `contacts:view` — это заявленная семантика, но фиксируем как осознанное расширение PII-видимости.
- **F5 (info).** `products_v2`/`site_pages` уже имеют публичные/широкие SELECT-политики; новые permissive-политики не сужают и не расширяют реальную поверхность.

Критических находок нет. Данные не изменялись.

## 4. Единственная миграция к применению (после merge и exact-SHA sync)

`supabase/migrations/20260814134846_fix_role_data_access_contract.sql` — ровно из merged SHA, без правок в Lovable. Другие миграции в этом релизе не применяются.

## 5. Ожидаемые изменения объектов и безопасные агрегаты

- 2 CHECK-ограничения пересозданы (добавлено значение `edit`).
- 2 функции `CREATE OR REPLACE` + REVOKE/GRANT (ACL фактически не меняется).
- Политики: `profiles` +1 SELECT; `orders_v2` +1 SELECT, +1 UPDATE, +1 INSERT; `site_form_submissions` +SELECT/UPDATE/DELETE; `course_preregistrations` −2 legacy, +SELECT/UPDATE/DELETE; `lesson_progress_state`, `training_modules`, `training_lessons`, `products_v2`, `site_pages` — по +1 SELECT.
- Строки данных не изменяются: все 9 baseline-счётчиков должны остаться прежними.
- `get_admin_access` для неадминской роли теперь возвращает больше строк (section-`none` + унаследованные resource-строки, до 18 активных resource на роль) — это ожидаемо.

## 6. Post-apply read-back и проверки

1. Схема: оба CHECK содержат `edit`; `has_admin_section_access` больше не содержит `app_role`; ACL функций = `authenticated, service_role`, без anon/PUBLIC.
2. Политики: пересчёт `pg_policies` по 9 таблицам против baseline; отсутствие `Admins can view all preregistrations` / `Admins can manage preregistrations`.
3. Данные: повтор всех 9 count — дельта 0.
4. Матрица через `get_admin_access` (агрегаты, без PII и без UUID) для одного представителя каждой категории:
   - super_admin — `manage` по всем активным секциям (source `admin_full`);
   - admin — то же;
   - manage-роль (`menedzher`) — forms-hub/contacts/deals = `manage`, все источники Forms Hub возвращают полные исторические счётчики;
   - view-роль (`support`) — forms-hub = `view`: чтение всех записей, UPDATE/DELETE отклонены RLS;
   - edit-роль (создать временно на тестовой роли) — UPDATE проходит, DELETE отклоняется;
   - explicit none (training у `support`) — `has_admin_section_access(...,'training','view') = false`.
5. Runtime/impersonation: под каждой категорией открыть Forms Hub и убедиться, что исторические записи видны, ошибка загрузки показывается как ошибка, а не как пустой список; view-роль не видит кнопок bulk-delete и сохранения.
6. Anon-контроль: анонимный клиент не получает строк ни из одной из 9 таблиц (кроме уже публичных `products_v2`/`site_pages`).
7. Publish frontend — только после всех PASS и решения по F1/F2.

## 7. Rollback и hard stop

Rollback (обратимый, одна транзакция):
- восстановить сохранённые в preflight определения `get_admin_access` и `has_admin_section_access`;
- вернуть CHECK на `('none','view','manage')` (безопасно только если строк с `edit` ещё нет — проверить перед откатом);
- удалить все политики `RBAC v3: …`;
- восстановить `Admins can view all preregistrations` и `Admins can manage preregistrations` из baseline-текста.

Hard stop (немедленно прекратить EXECUTE):
- SHA дерева ≠ одобренному merged SHA либо файл миграции отличается;
- версия `20260814134846` уже в ledger;
- появились значения `access_level` вне `none/view/manage` до применения;
- любой из 9 count изменился после применения;
- super_admin или admin теряет доступ хотя бы к одной секции в read-back;
- view-роль получает успешный UPDATE/DELETE, либо explicit none возвращает `true`;
- деградация запросов `profiles`/`orders_v2` в админ-списках.

**Итог: PASS.** F1 закрыт на head SHA `0f97a2999269cffd9ca45e80aab9ea3db9f38a5d`, критических дефектов нет, новых находок в diff `ffd06c51…..0f97a299…` нет. PR #310 может идти в merge после зелёных GitHub checks; открытым остаётся только F2 как pre-Publish performance gate (не блокирует merge, блокирует Publish).
