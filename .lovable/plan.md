# План: RBAC section/resource model для админки

## 0. Контекст и факты (уже проверено в текущем коде/БД)

- **Текущая модель прав:** таблицы `roles` / `role_permissions` / `permissions` (16 категорий, 37 кодов). Роль `support` имеет 13 codes (см. ниже). Эти права раздаются через edge-функцию `roles-admin` (6 actions).
- **Текущий гейт сайдбара** (`AdminSidebar.tsx` + `useAdminMenuSettings.tsx`): фильтр через `permissionMap` — карта из **5 ключей** (`users.view, roles.view, entitlements.view, content.view, audit.view`). Любой пункт меню с `permission`, которого нет в карте, → `?? true` → виден всем. Это и есть «не срабатывает».
- **Гейт роутов в `App.tsx`:** только `ProtectedRoute` (=залогинен), **никакой permission-проверки нет**. Прямой URL `/admin/roles` грузится у роли support.
- **Каталог админ-меню уже наполовину в БД:** есть таблица `admin_menu_settings` (jsonb `items`, RLS = superadmin) — переопределение поверх `DEFAULT_MENU` из `src/hooks/useAdminMenuSettings.tsx`. SOT каталога фронтенд-хардкод; БД — только overrides.
- **`app_sections`** (UUID, code, route, is_public, is_active) — это **клиентские** разделы (Пульс/Эфиры/Knowledge), для админки **не используются**. Не путать.
- **`access_rules` с `grant_target_type='section_access'`** (6 строк) — гейтят клиентские секции через продукты/тарифы, не админку.
- **Tenants:** `tenants` + `tenant_memberships` существуют (255 строк), но текущие `roles`/`user_roles_v2` глобальные (нет `tenant_id`).

**Что роль `support` имеет сейчас (зафиксировано как baseline):**
`contacts.view/edit, deals.view/edit/delete, orders.view, support.view/manage, users.view/update/block, telegram.manage`. Нет: `content.*, news.*, roles.view, entitlements.view, audit.view, integrations.*`.

**Дыры, которые сейчас видит QA Admin (`qa.admin@gorbova.test`, роль support):**
- В сайдбаре видны (но не должны): `Конструктор сайтов` (content.edit), `Редакция` (news.view), `Эфиры` (content.edit), `Маркетинг-инсайты` (без permission), `Участники клуба` (без permission), `Telegram invite audit` (telegram.clubs.manage).
- Все админ-URL открываются напрямую.
- Внутри секций с табами (Контакт-центр: Сообщения/Email/Рассылки/Тех.поддержка/Instagram; Платежи: Заказы/Автопродления/Диагностика; Интеграции; Анкеты) — нет ни одного гейта, любой видит всё.

---

## 1. Принцип SOT (без дублирования)

- **Каталог админ-меню (секции + ресурсы) — единый SOT в БД.** Канонические таблицы `admin_section` / `admin_resource` (UUID) — рабочий источник для прав и гейтов.
- **Auto-sync from sidebar.** В `useAdminMenuSettings.tsx` уже есть структура `MenuGroup` + `MenuItem`. Расширяем её опциональным `resources?: AdminResourceDescriptor[]`. При старте админ-сессии вызывается RPC `sync_admin_menu_registry(_payload jsonb)` (idempotent upsert by `code` + soft-disable orphans, без DELETE). Тот же RPC вызывается из миграций при дополнении DEFAULT_MENU. Любой новый пункт меню → автоматически появляется в редакторе ролей.
- **Старая модель `permissions`/`role_permissions` НЕ удаляется** — переезжает в «низкоуровневые операции» (delete/impersonate/block/refund/manage) и читается только из мест, где такая семантика нужна. Видимость секций больше не зависит от этих кодов.
- **`admin_menu_settings`** остаётся как «override» (порядок/скрытие пунктов суперадмином), на каталог не влияет.

## 2. Миграции (одна за раз, утверждаем отдельно)

### Migration A — каталог

```text
admin_section
 id uuid pk default gen_random_uuid()
 public_id text unique  (формат asec_xxxxxx)
 code text unique not null             — стабильный канонический ключ ("communication", "deals", …)
 label text not null
 route_prefix text not null            — "/admin/communication"
 icon text
 sort_order int not null default 0
 workspace_id uuid null                — задел под мультитенант; сейчас NULL = global
 is_active boolean not null default true
 created_at, updated_at, created_by uuid, updated_by uuid
 metadata jsonb not null default '{}'

admin_resource
 id uuid pk
 public_id text unique  (ares_xxxxxx)
 section_id uuid not null references admin_section(id) on delete restrict
 code text not null                    — ключ ресурса внутри секции ("messages", "email", …)
 label text not null
 route text not null                   — "/admin/communication?tab=email" или "/admin/payments/auto-renewals"
 sort_order int not null default 0
 is_active boolean not null default true
 workspace_id uuid null
 created_at, updated_at, created_by, updated_by, metadata jsonb default '{}'
 UNIQUE (section_id, code)
```

GRANT: `SELECT, INSERT, UPDATE` для `authenticated`, `ALL` для `service_role` (анон отсутствует). RLS: чтение — любой `authenticated` (каталог нечувствителен), запись — `has_role_v2(auth.uid(),'super_admin')`.

### Migration B — права

```text
role_admin_section_access
 id uuid pk, public_id text unique (rsa_)
 role_id uuid not null references roles(id) on delete cascade
 section_id uuid not null references admin_section(id) on delete cascade
 access_level text not null check (access_level in ('none','view','manage'))
 workspace_id uuid null
 created_at, updated_at, created_by, updated_by, metadata jsonb default '{}'
 UNIQUE (role_id, section_id)

role_admin_resource_access
 id uuid pk, public_id text unique (rra_)
 role_id uuid not null references roles(id) on delete cascade
 resource_id uuid not null references admin_resource(id) on delete cascade
 access_level text not null check (access_level in ('none','view','manage'))
 workspace_id uuid null
 …стандартные поля
 UNIQUE (role_id, resource_id)
```

GRANT: `authenticated` — `SELECT` (через RPC), `service_role` — `ALL`. INSERT/UPDATE/DELETE — только через edge `roles-admin`. RLS: чтение разрешено только своих ролей или admin/super_admin (security definer RPC); запись закрыта (delegated to edge with service role).

### Migration C — RPC и хелперы

```text
public.sync_admin_menu_registry(_payload jsonb) returns table(...)
   — idempotent upsert по (code) для секций и (section.code, resource.code) для ресурсов;
   — orphan (есть в БД, нет в payload) → is_active=false (НЕ удаляем);
   — пишет одну запись в audit_logs (actor_type='system'|'admin', actor_user_id=auth.uid()).

public.get_admin_access(_user_id uuid)
  returns table(section_code text, resource_code text, access_level text, source text)
  language sql security definer set search_path=public stable
  — алгоритм наследования (см. §3);
  — admin/super_admin → возвращает manage для всех активных секций/ресурсов;
  — пользователь без роли → пустой результат (deny by default).

public.assert_admin_self_role_lock(_actor uuid)
  — guard для §6.10 (актёр не может отозвать у себя доступ к секции «roles»).
```

GRANT EXECUTE на оба RPC — `authenticated`. На `sync_*` ещё `service_role`.

### Migration D — seed

Идемпотентный seed `admin_section`/`admin_resource` из текущего DEFAULT_MENU + явный разбор табов (Контакт-центр: messages/email/broadcasts/support/instagram; Платежи: orders/auto_renewals/diagnostics/links; Интеграции: crm/telegram/amocrm; Анкеты: forms/preorders/responses; Продукты: list/relations/tariffs; Сделки: pipelines/kanban). Все системные роли (`admin`, `super_admin`) — без записей (получают full через RPC). `support` — таргет-инсёрт: `view`/`manage` ровно по тому, что есть сейчас в её permissions; всё остальное → строка `none` (явный deny).

## 3. Семантика доступа (зафиксирована)

Правила, по которым `get_admin_access` принимает решение:

1. `admin` или `super_admin` → `manage` на всё активное. Никаких записей не нужно.
2. Для остальных ролей:
   - **Resource override главный.** Если есть строка `role_admin_resource_access(role, resource)` → её `access_level` побеждает строку секции.
   - **Section fallback.** Если ресурс в override-таблице отсутствует — применяется `role_admin_section_access(role, section).access_level`.
   - **Default deny.** Если ни секции, ни ресурса нет в таблицах прав → `none`.
   - **`none` на секции не открывает ресурсы.** Чтобы ресурс был виден, нужен либо `view`/`manage` на секции, либо явный resource override `view`/`manage`.
   - **`manage` ⊃ `view`.** Кто имеет `manage` — автоматически имеет `view`.
   - **`is_active = false`** на секции/ресурсе → результат `none` независимо от записей.
3. Конфликт `view` vs `manage` в overriding-строке: побеждает явная запись на меньшем уровне (resource), на одинаковом уровне разрешения дублей нет (UNIQUE).
4. Неизвестный (отсутствующий в каталоге) `section_code`/`resource_code` в запросе фронта → `none` (deny by default).

**Machine-check proof в Migration C — pgTAP-style assertions** (отдельный raise-блок в конце миграции):

- support → has resource access на `communication.messages` = `view/manage`, нет доступа на `sites.*`, `editorial.*`, `live-events.*`, `marketing.*`, `roles.*`, `telegram_audit.*`.
- admin/super_admin → `manage` на все активные секции.
- безролевый пользователь → 0 строк.
- `none` на секции + отсутствие resource override → ресурс закрыт.
- `none` на секции + явный resource `view` → ресурс открыт.

## 4. Auto-sync каталога из сайдбара

**Источник:** структура `MenuSettings` (`DEFAULT_MENU` плюс админский override из `admin_menu_settings.items`). Расширяем `MenuItem` опциональным полем `resources?: { code, label, route, sortOrder }[]`. В `DEFAULT_MENU` явно заполняем для секций с табами; для остальных — пусто (=одна секция без ресурсов).

**Когда срабатывает sync:**

1. На первом маунте `AdminSidebar` у пользователя с ролью `admin`/`super_admin` хук `useAdminMenuRegistrySync` вызывает RPC `sync_admin_menu_registry(payload)` (one-shot per session, lock через `app_settings.admin_menu_registry_lock`).
2. На каждое сохранение «настроек меню» суперадмином в `MenuSettingsDialog` — повторный вызов.
3. Из миграций — прямой вызов RPC с фиксированным snapshot’ом DEFAULT_MENU (для гарантии baseline).

**Что синхронизация делает:**

- INSERT новых секций/ресурсов (которых нет по `code`).
- UPDATE label/route/sort_order/icon если изменилось.
- Помечает `is_active=false` для записей, которых больше нет в payload (НЕ удаляет → исторические `role_admin_*_access` не теряются).
- При повторном появлении кода — `is_active=true` обратно.
- Возвращает diff (added/updated/disabled) — фронт показывает тост «Добавлено N новых разделов в редактор ролей».

**В UI редактора ролей** — список секций строится по `admin_section.is_active=true` + `admin_resource.is_active=true`, сортировка по `sort_order`. Любой новый пункт в `DEFAULT_MENU` автоматически появляется без правки UI.

## 5. Гейты в коде

1. **`useAdminAccess` (новый хук)** — обёртка над `get_admin_access`, кэш React Query 5 мин:
   - `canSeeSection(code)` / `canManageSection(code)`
   - `canSeeResource(section, resource)` / `canManageResource(...)`
   - `accessLevel(section, resource?)` (для UI-индикации)
2. **`AdminSidebar`** — заменяем `permissionMap` на `useAdminAccess`. Каждый `MenuItem` маркируется `section: code`, видимость = `canSeeSection`. Старая карта удаляется (запрет «old permissionMap as fallback», правка #9).
3. **`AdminRouteGuard`** — новый wrapper в `App.tsx` (одной заменой по regex), который оборачивает каждый `/admin/...` `Route`. Принимает `section`, опционально `resource`. Использует **точный prefix match** + явный mapping для конфликтных URL: `/admin/telegram/invite-audit` → resource `telegram_audit/invite_audit`, не section `integrations.telegram`. Mapping хранится в одном файле `src/lib/adminRouteMap.ts` и автотестом сверяется с каталогом БД.
4. **Гейт табов с query-params (правка #8).** Утилита `useTabAccessGuard(sectionCode, tabResources[])`: на mount определяет первый доступный таб; если открытый `?tab=` закрыт — `replace` URL на первый доступный; если ни один не доступен — `navigate('/admin')` + тост «Нет доступа». Внедряется в `AdminCommunication`, `AdminPayments`, `AdminForms`, `AdminProductsV2`, `AdminIntegrations`.
5. **Серверный double-check.** Edge-функции, обслуживающие закрытые разделы (`broadcast-*`, `support-*` админ-действия, `live-event-*` админ-действия и т.п.), валидируют `get_admin_access` через service role + `auth.uid()` из JWT. Список этих edge-функций — отдельный артефакт-инвентаризация в deferred-листе (§9).

## 6. Edge `roles-admin` — расширение

Добавляем actions:

- `list_admin_catalog` — возвращает {sections, resources} из БД для редактора.
- `get_role_access(role_id)` — текущие access-строки роли.
- `set_role_access` со следующим контрактом:
  - `mode: 'dry_run' | 'execute'`,
  - `role_id`,
  - `changes: [{ section_id, resource_id?: uuid|null, access_level: 'none'|'view'|'manage' }]` (resource_id null = section-level),
  - guards:
    - запрет менять `super_admin` (кроме самого super_admin),
    - запрет менять `admin`/`user`/`editor`/`support` если флаг `lock_system_roles=true` (по умолчанию true; super_admin может явно разблокировать в UI),
    - **self-role guard**: если actor — единственный super_admin, либо у actor роль через эту же запись — нельзя выставить себе `none` на секцию `roles` (вызов `assert_admin_self_role_lock`),
  - dry-run вернёт diff (`{section, resource?, before, after}`); execute применит изменения транзакционно и запишет в `audit_logs` запись `actor_type='admin', actor_user_id=auth.uid(), actor_label=email, action='role_access.set', meta={role_id, changes, diff}`.
- `bulk_set_section_access(role_id, section_id, access_level)` — массовое выставление всем ресурсам секции.

Все actions проверяют JWT через service role + `has_permission('roles.manage')` (старый permission остаётся как admin-gate действия).

## 7. Новый редактор ролей (UI)

Переписываем `RolePermissionEditor.tsx` + таб «Роли и права» в `AdminRoles.tsx`:

- Слева — список ролей (как сейчас).
- Справа — **секции в порядке левого сайдбара**. Каждая раскрывается в свои ресурсы.
- На строке секции — радио `Нет / Только просмотр / Полный доступ` + кнопка «Применить ко всем подразделам».
- На строке ресурса — то же радио. Если override совпадает с уровнем секции, показываем «наследуется» серым.
- Поиск по label/code (как сейчас).
- Системные роли — `read-only` с явной отметкой и кнопкой «Разблокировать» (доступна только super_admin, активирует `lock_system_roles=false` для текущей сессии).
- Низкоуровневые `permissions` (delete/impersonate/block/refund) — отдельный аккордеон «Особые операции» внизу, сохраняем существующий редактор как есть.
- Кнопка **«Предпросмотр изменений»** = dry-run, показывает таблицу diff и кнопку «Применить».

## 8. Rollback / compat (правка #11)

- Старые `permissions`/`role_permissions` **остаются**. В `permissions` добавляем колонку `category_kind text default 'operation'` (миграция B+1) — для UI чтобы понимать «это особая операция, не section-access».
- Mapping старого → нового кладём в `docs/RBAC_SECTION_MODEL.md`:
  | старый permission | заменён на | использование |
  |---|---|---|
  | `content.view/edit` | section `sites` + `editorial` + `live-events` | видимость секций |
  | `news.view/edit/publish/delete` | section `editorial` + операция `news.*` | видимость + операции в редакции |
  | `roles.view/manage` | section `roles` + операция `admins.manage` | редактор ролей |
  | `entitlements.view/manage` | section `deals` + `payments` | видимость секций |
  | `users.delete/impersonate/block/reset_password` | операция (без замены) | низкоуровневые действия |
  | `support.*` | section `communication` + операция `support.manage` | видимость + действия |
  | `telegram.manage` | section `integrations` (telegram resource) + операция | гейт + действия |
- Список edge-функций, которые **продолжат читать старую модель**, — фиксируется отдельным реестром в `docs/RBAC_SECTION_MODEL.md` (см. §5.5).
- **Kill-switch `app_settings.admin_section_gating_enabled`** добавляется ТОЛЬКО как аварийный rollback (если правда что-то сломалось). Default = `true`. DoD проверяется при `true`. Старый `permissionMap` удаляется из кода полностью (правка #9).
- Если флаг = `false`, `useAdminAccess` возвращает «всё открыто», и роуты пускают всех с `hasAdminAccess()` (как сейчас) — это аварийный режим для саппорта, не штатный.

## 9. DoD (правка #12) — SQL и behavior proof

SQL proof (запускается отдельным скриптом `scripts/rbac_dod_proof.sql`):

1. `SELECT count(*) FROM admin_section WHERE is_active` = число активных групп+пунктов в DEFAULT_MENU.
2. `SELECT id FROM admin_resource WHERE section_id NOT IN (SELECT id FROM admin_section)` → 0 строк (orphan check).
3. `SELECT role_id FROM role_admin_section_access WHERE role_id NOT IN (SELECT id FROM roles)` → 0.
4. То же для `role_admin_resource_access`.
5. Для `support`: `get_admin_access` НЕ возвращает `section_code IN ('sites','editorial','live_events','marketing','roles','telegram_audit','club_members')` с `access_level != 'none'`.
6. Для `admin`/`super_admin`: `count(distinct section_code)` == `count(*) FROM admin_section WHERE is_active`.
7. Безролевый пользователь: `get_admin_access` возвращает 0 строк.

Behavior proof (Playwright, под `qa.admin@gorbova.test`):

- Логин → видимый сайдбар = эталонный список для `support`.
- Прямой переход на каждую закрытую страницу (`/admin/sites`, `/admin/editorial`, `/admin/live-events`, `/admin/marketing`, `/admin/roles`, `/admin/telegram/invite-audit`) → редирект + тост.
- В `/admin/communication?tab=email` (закрытый таб у support) → редирект на первый доступный таб.
- В новом редакторе у роли support меняю `communication.email` с `view` на `none` → у QA Admin пропадает таб. Возвращаю — появляется.
- `admin` / `super_admin` ничего не теряют (контроль-скриншоты).

Скриншоты до/после + diff-summary прилагаются в отчёте (правка #13).

## 10. Этапы выполнения (один спринт)

1. Migration A (каталог) → утверждение.
2. Migration B (права) → утверждение.
3. Migration C (RPC + machine-check proof) → утверждение.
4. Migration D (seed из DEFAULT_MENU + явные ресурсы табов) → утверждение.
5. Edge `roles-admin` — добавление actions + аудит.
6. Фронт: `useAdminAccess`, `useAdminMenuRegistrySync`, `AdminRouteGuard`, обновление `AdminSidebar`, `App.tsx`, гейт табов, новый редактор ролей.
7. Удаление старого `permissionMap` из сайдбара.
8. Playwright proof + SQL proof + скриншоты.
9. Документация (`docs/RBAC_SECTION_MODEL.md`) + memory (`mem://security/rbac/section-resource-model-v3`).
10. Отчёт о выполнении (на русском, по правке #13).

## 11. Deferred (вне этого спринта — явный список, правка #14)

- Серверный гейт во всех старых edge-функциях, читающих `permissions`. Инвентаризация и поэтапная миграция — отдельным спринтом.
- Перенос «низкоуровневых операций» в отдельную таблицу `admin_operation` с UUID (сейчас остаются как `permissions.category_kind='operation'`).
- Workspace-scope: сейчас все новые таблицы имеют `workspace_id nullable` = global; реальная тенант-изоляция админ-ролей — отдельный план, синхронно с переездом `roles`/`user_roles_v2` на тенанты.
- Перенос `admin_menu_settings.items` целиком в `admin_section/admin_resource` (избавление от двух SOT) — после стабилизации новой модели.
- Подвязка `live_event_*` админ-резолверов на новые секции/ресурсы.

## 12. Технические заметки

- Никаких параллельных эпиков: каталог админ-меню и каталог клиентских разделов (`app_sections`) физически разные таблицы, не путаем.
- Триггеры `updated_at` — общий `public.update_updated_at_column()` (уже есть в проекте).
- `public_id` генерируется триггером `before insert` (есть шаблон в `public.generate_public_id(prefix)` — переиспользуем).
- Все INSERT/UPDATE в `role_admin_*` идут только через edge `roles-admin` (RLS закрыта для прямой записи).
- Никаких ALTER `auth`/`storage`/`realtime` схем.

---

Подтвердите план — стартую с Migration A (каталог `admin_section` + `admin_resource`) и параллельно собираю Playwright-baseline «до» (скриншоты текущих дыр у роли support).