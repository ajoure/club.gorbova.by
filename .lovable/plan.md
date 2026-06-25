да, согласен, с учетом правок:

1. **Не менять модель терминов**  
В backend уже зафиксировано `access_level: none | view | manage`.  
В плане нельзя вводить новый маппинг `effect='deny/allow'`, `scope='read/full'`, если таких колонок нет.  
Исправить везде:
  - «Нет» → `access_level='none'`
  - «Только просмотр» → `access_level='view'`
  - «Полный доступ» → `access_level='manage'`
2. **Не использовать** `section_key`**, если в БД** `section_code/code`  
В SQL-proof указано:
  &nbsp;
  ```sql
  select role_id, section_key, effect ...
  ```
  Нужно заменить на реальные поля текущей схемы:
3. **Dry-run должен идти через backend, не только локальный diff**  
Локальный preview можно оставить для UI, но перед execute нужен backend dry-run через `roles-admin`, чтобы проверить:
  - system-role guard;
  - self-lock;
  - реальные before/after из БД;
  - audit-ready diff.
4. **Уточнить actions**  
В предыдущем отчёте были добавлены:
  - `set_section_access`
  - `set_resource_access`
  - `bulk_set_section_access`
  - `sync_menu_registry`
  В этом плане нельзя внезапно ссылаться на `set_role_access`, если такого action уже нет. Либо использовать существующие 3 access-actions, либо явно добавить один unified `set_role_access`, но без дублирования логики.
5. `list_admin_catalog` **/** `get_role_access` **лучше делать через** `roles-admin`**, а не RPC, если actions уже заявлены**  
Чтобы не плодить два API-контура.  
Допустимо:
  &nbsp;
  - RPC оставить как read-only backend helper;
  - UI вызывать только `roles-admin` actions.  
  Главное — один публичный фронтовый контракт.
6. **Системные роли**  
В плане указаны read-only только `super_admin`, `admin`.  
Нужно синхронизировать с backend guard:
  - если `support` редактируемая роль — она не должна считаться системной;
  - если `user/editor/support` заблокированы через `lock_system_roles=true`, это должно быть явно отражено в UI;
  - UI не должен показывать возможность редактирования роли, которую backend всё равно отклонит.
7. **Self-lock не должен быть только “если actor редактирует свою собственную роль”**  
У пользователя может быть несколько ролей. UI-проверка может быть только предварительной.  
Источник истины — backend `assert_admin_self_role_lock`. В UI писать: “предварительно блокируем очевидный случай, но окончательное решение за backend”.
8. **Фраза “Email появляется в сайдбаре” некорректна**  
`Email` — это ресурс/таб внутри `communication`, а не отдельный пункт сайдбара, если в текущем UI он не вынесен отдельно.  
Исправить proof:
  - после allow у `communication.email` появляется таб `Email` внутри `/admin/communication`;
  - после deny таб скрывается / прямой `?tab=email` редиректится.
9. **Не использовать** `/admin/support` **как гарантированно доступный URL без проверки route map**  
В текущей модели доступная секция может быть `/admin/communication`, а `support` — ресурс/таб.  
В Playwright использовать URL из `adminMenuRegistry.ts`, а не вручную придуманную ссылку.
10. **Создание QA Admin не делать “supabase–insert” без уточнения**  
Если пользователь уже есть — только проверить роль.  
Если нет — нужен безопасный сценарий через существующий seed/test helper. Прямой insert в auth/users/profile-таблицы может сломать связки.
11. **Добавить проверку** `AdminRouteGuard` **на неизвестный URL**  
В Playwright обязательно:

&nbsp;

- `/admin/__unknown-rbac-test` → deny/redirect;
- это доказывает deny-by-default.

12. **Audit proof**  
В отчёте проверять не только `action like 'rbac.%'`, а фактические action names:

- `rbac_v3.*` или реальные значения из edge.  
Сейчас в плане есть расхождение с предыдущим отчётом (`rbac_v3.seed_catalog...`).

13. **DoD расширить**  
Добавить обязательные проверки:

- после изменения прав React Query cache инвалидируется;
- после logout/login новые права применяются;
- при ошибке edge-action UI показывает нормализованную ошибку;
- bulk update не оставляет частично применённые изменения без audit.

14. **Не менять backend RBAC вне нужных read endpoints**  
Формулировку оставить, но добавить: любые найденные backend-баги — только fix-to-patch с отдельным описанием, без скрытого рефакторинга уже закрытой RBAC v3 backend-модели.

После этих правок план можно выполнять.

&nbsp;

План: PATCH-RBAC-V3-UI-EDITOR-AND-PROOF

## Цель

Закрыть оставшиеся два блока спринта RBAC v3: UI-редактор Section/Resource Access в `/admin/roles` и Playwright/UI-proof реального сценария.

## Скоуп

### 1. UI-редактор доступа (`/admin/roles`)

- Файл: `src/pages/admin/AdminRoles.tsx` — добавить вторую вкладку `Tabs`: «Пользователи и роли» (текущее) и «Доступ к разделам».
- Новый компонент `src/components/admin/roles/RoleAccessEditor.tsx`:
  - левая колонка — список ролей (read-only badge для системных: `super_admin`, `admin`);
  - правая колонка — каталог секций (группировка по `group_key`), внутри каждой секции — её ресурсы;
  - на каждой строке radio из трёх состояний: **Нет** / **Только просмотр** / **Полный доступ** (маппинг → `effect`/`scope` в `role_admin_section_access` / `role_admin_resource_access`);
  - на уровне секции — кнопка «Применить ко всем ресурсам» (bulk).
- Источники данных:
  - каталог: `supabase.rpc('list_admin_catalog')` (если нет — добавим тонкую RPC; смотрим ниже);
  - текущие права роли: `supabase.rpc('get_role_access', { p_role_id })`;
  - сохранение: edge-action'ы `set_section_access` / `set_resource_access` / `bulk_set_section_access` (уже есть в `roles-admin/index.ts`).
- Dry-run preview:
  - перед записью собрать локальный diff (было → станет) по секциям и ресурсам и показать в `Dialog` со списком изменений и итоговой матрицей видимости (resolved через тот же резолвер, что использует `useAdminAccess`);
  - кнопка «Применить» вызывает actions по списку diff'а, по одному запросу на изменение.
- Guards:
  - системные роли (`is_system=true`) — редактор в read-only, кнопка «Сохранить» скрыта, поверх — badge «Системная роль, изменения запрещены»;
  - self-lock: если actor редактирует свою собственную роль и снимает доступ к `admin.roles`, показать toast/блок и не отправлять — это уже защищает backend (`assert_admin_self_role_lock`), но дублируем в UI;
  - все ошибки edge-функции пропускаем через `normalizeEdgeFunctionError`.

### 2. RPC `list_admin_catalog` и `get_role_access`

- Если их ещё нет — добавить как `SECURITY DEFINER` read-only функции, доступные `authenticated` с проверкой `has_role_v2(auth.uid(),'admin') OR has_role_v2(...,'super_admin')`.
- `list_admin_catalog()` → массив `{ section: {key,label,group_key,route,…}, resources: [{key,label,route,...}] }`.
- `get_role_access(p_role_id uuid)` → `{ sections: [...], resources: [...] }` с текущими `effect`/`scope`.

### 3. Playwright / UI-proof

- Тестовый пользователь: `qa.admin@gorbova.test` уже создан (упоминался ранее); если нет — создать через `supabase--insert` + назначить роль `support`.
- Сценарии под Playwright (sandbox, headless), результаты — скриншоты в `/tmp/browser/rbac-v3/screenshots/`:
  1. Логин как `qa.admin@gorbova.test` → проверить, что в сайдбаре нет пунктов, закрытых для `support` (минимум 3 пункта из baseline deny).
  2. Прямой переход на закрытый `/admin/...` URL → редирект на `/admin` + toast «Нет доступа».
  3. Доступный пункт (например `/admin/support`) открывается без редиректа.
  4. Логин как `super_admin` → в `/admin/roles` → вкладка «Доступ к разделам» → роль `support` → переключить `communication.email` с deny на allow → сохранить → перелогин под `qa.admin` → пункт «Email» появляется в сайдбаре. Затем откатить и убедиться, что снова скрыт.
- Дополнительно проверить SQL: `select role_id, section_key, effect from role_admin_section_access where role_id = <support>` до и после.

### 4. Финальный отчёт

- Список изменённых/созданных файлов.
- SQL-proof: select по `role_admin_section_access` / `role_admin_resource_access` до/после, плюс audit-записи (`action like 'rbac.%'`).
- Playwright-proof: пути к скриншотам + краткое описание каждого шага.
- Diff-summary по компонентам.
- Deferred (отдельным блоком): любые мелочи, выходящие за scope патча (например, тонкая настройка scope='own' — на будущее).

## DoD

- Вкладка «Доступ к разделам» работает: каталог рендерится, текущие права видны, переключение и bulk сохраняются, dry-run показывает diff.
- Системные роли защищены в UI; self-lock не даёт сохранить.
- Playwright-сценарии 1–4 пройдены, скриншоты приложены.
- В отчёте перечислены файлы, SQL-, UI-proof и deferred.
- Никаких изменений в backend RBAC за пределами добавления `list_admin_catalog` / `get_role_access` (если их ещё нет) — остальные actions уже выкатаны.

## Технические детали

- `RoleAccessEditor` использует `@tanstack/react-query` для кеша каталога и прав; инвалидация после save.
- Маппинг radio → запись:
  - «Нет» → `effect='deny'`, `scope=null`;
  - «Только просмотр» → `effect='allow'`, `scope='read'`;
  - «Полный доступ» → `effect='allow'`, `scope='full'`.
- Если для строки нет явной записи — отображается унаследованное значение с подсказкой «(наследуется от секции)» для ресурсов и «(baseline)» для секций без override.
- Системные роли определяются по `roles.is_system = true` (поле уже есть в схеме).

## Rollback

- UI-вкладка чисто аддитивная — отключается удалением `<TabsTrigger>` и компонента.
- Новые RPC drop-нуть отдельной миграцией при необходимости.