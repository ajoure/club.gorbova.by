# План: RBAC

- UI: `useRbac()` для разрешений действий; `useAdminAccess()` для секции/ресурсов.
- Каталог: добавить секцию `referrals`, route `/admin/referrals`, ресурсы `overview`, `partners`, `rules`, `payouts`, `fraud`, `diagnostics`.
- DB: seeding через существующий registry sync; точные таблицы — `admin_section/admin_resource/role_admin_section_access` по коду, но live DDL обязателен.
- Финансовые действия: deny-by-default, RPC-only, audit actor из `auth.uid()`, обязательная причина для manual adjustment/reassignment.
