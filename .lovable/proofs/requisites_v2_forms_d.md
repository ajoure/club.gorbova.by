# PATCH D — Requisites v2 forms behind feature flag

Дата: 2026-05-10
Статус: реализовано (UI слой); resolver/fields_registry/clean reset не тронуты.

## Цель

Переключить формы системных и пользовательских реквизитов на новые таблицы
(`legal_entities_requisites`, `individual_requisites`, `tenants`,
`tenant_memberships`) — строго через feature flag, без удаления старых
таблиц и без изменения resolver генерации документов.

## Feature flag

- Файл: `src/lib/featureFlags.ts`
- Имя: `REQUISITES_V2_UI_ENABLED`
- Источник: `import.meta.env.VITE_REQUISITES_V2_UI`
  (`"1" | "true" | "on" | "yes"` — включает; всё остальное — выключено)
- Поведение:
  - **flag = false (default)** — `/settings/legal-details` рендерит старый UI
    (`LegalDetailsSettings`) поверх `useLegalDetails` → `client_legal_details`.
    Маршрут `/settings/user-requisites` показывает заглушку.
  - **flag = true** — `/settings/legal-details` рендерит `RequisitesV2Manager`
    со `scope='system_customer'`. `/settings/user-requisites` рендерит
    `RequisitesV2Manager` со `scope='user_requisites'`. Обе страницы читают и
    пишут только в новые таблицы V2.

## Изменённые / созданные файлы

| Файл | Действие |
|---|---|
| `src/lib/featureFlags.ts` | NEW — централизованный флаг |
| `src/hooks/useRequisitesV2.ts` | NEW — единый CRUD-хук под новые таблицы |
| `src/components/requisites-v2/LegalEntityRequisitesForm.tsx` | NEW — форма ЮЛ/ИП |
| `src/components/requisites-v2/IndividualRequisitesForm.tsx` | NEW — форма ФЛ |
| `src/components/requisites-v2/RequisitesV2Manager.tsx` | NEW — list+CRUD UI |
| `src/pages/settings/UserRequisites.tsx` | NEW — страница пользовательских реквизитов |
| `src/pages/settings/LegalDetails.tsx` | EDIT — early-return на V2 при включённом флаге |
| `src/App.tsx` | EDIT — добавлен route `/settings/user-requisites` |

Старые файлы / таблицы:

- `client_legal_details`, `legal_details_persons`, `legal_details_entities` — **не тронуты**;
- `useLegalDetails`, `useAiPersons`, `useAiEntities` — **не тронуты**;
- старые формы `OrganizationDetailsForm`, `IndividualDetailsForm`,
  `LegalEntityDetailsForm`, `EntrepreneurDetailsForm` — **не тронуты**;
- resolver генерации документов и `fields_registry` — **не тронуты**.

## Контракт хука `useRequisitesV2({ scope })`

Идентификационные колонки заполняются автоматически:

- `tenant_id` — личный tenant пользователя (через `tenant_memberships` + `tenants.is_personal`);
- `owner_user_id` — `auth.uid()`;
- `owner_profile_id` — `profiles.id` текущего пользователя;
- `created_by` / `updated_by` — `auth.uid()`.

Параметры записи:

- `scope`: `'system_customer' | 'user_requisites'`;
- `subject_type` (для legal): `'legal_entity' | 'entrepreneur'`;
- `is_default`: bool, свойство записи; уникальность поддерживается partial unique
  индексами на уровне БД (tenant_id + scope + subject_type).

Экспортируемые мутации:

- `createLegalEntityRequisites`, `updateLegalEntityRequisites`, `deleteLegalEntityRequisites`;
- `createIndividualRequisites`, `updateIndividualRequisites`, `deleteIndividualRequisites`;
- `setDefaultRequisites` — атомарный сброс предыдущих default + установка нового.

## Labels

Все подписи в новых формах и заголовках строятся как
`[Сист. заказчик] [ЮЛ|ИП|ФЛ] <field>` или
`[Пользовательские] [ЮЛ|ИП|ФЛ] <field>`.

Запрещённое:

- слово **AI / ai** в UI-labels, route, новых компонентах и хуках — отсутствует
  (есть только метаупоминания в комментариях файлов: «No AI wording…»);
- слово **«Основное»** в group-label — не используется; default присутствует
  только как чекбокс «Использовать по умолчанию» и бейдж «По умолчанию»;
- одинаковые визуальные labels с разными FLD-ID — исключены за счёт префикса
  `[scope] [subject_type]`;
- общий «банк/расчётный счёт» без subject_type — все labels несут subject prefix.

## Сценарии (UI-proof, описательно)

1. **flag=false** — `/settings/legal-details` показывает старый list/form
   (карточка «Мои реквизиты», `PayerTypeSelector`, `OrganizationDetailsForm` /
   `IndividualDetailsForm`); чтение/запись идут в `client_legal_details`.
2. **flag=true** — `/settings/legal-details` показывает `RequisitesV2Manager`
   со scope `system_customer`, тремя вкладками (Юрлицо / ИП / Физлицо) и
   формами V2; чтение/запись идут в `legal_entities_requisites` /
   `individual_requisites`.
3. **Создание ЮЛ system_customer** — кнопка «Добавить» во вкладке Юрлицо →
   `LegalEntityRequisitesForm` → `createLegalEntityRequisites` записывает
   строку с `scope='system_customer'`, `subject_type='legal_entity'`.
4. **Создание ИП system_customer** — то же, вкладка ИП, `subject_type='entrepreneur'`.
5. **Создание ФЛ system_customer** — вкладка Физлицо, `IndividualRequisitesForm` →
   `createIndividualRequisites` со `scope='system_customer'`.
6. **Создание ЮЛ/ФЛ user_requisites** — те же формы по
   `/settings/user-requisites` с `scope='user_requisites'`.
7. **Default selection** — кнопка «Сделать default» в строке списка вызывает
   `setDefaultRequisites`; предыдущий default по комбинации
   `tenant + scope (+ subject_type)` сбрасывается.

## RLS CRUD proof

Страница `/admin/tenants` (PATCH B+C.1) уже подтвердила:

- 255 personal tenants и 255 active owner memberships;
- 11 строк `legal_entities_requisites` и 10 строк `individual_requisites`
  со `scope='system_customer'` доступны соответствующим owner-пользователям и
  всем admin/super_admin.

Контракты RLS-политик новых таблиц (заданы в миграции B+C):

- `SELECT` — `tenant_id IN public.user_tenant_ids(auth.uid())` ИЛИ
  `has_role_v2('admin'|'super_admin')`;
- `INSERT` — `with_check`: `owner_user_id = auth.uid()` AND
  `tenant_id IN public.user_tenant_ids(auth.uid())`;
- `UPDATE` / `DELETE` — `owner_user_id = auth.uid()` AND
  `tenant_id IN public.user_tenant_ids(...)` ИЛИ admin-роли.

UI-хук **никогда** не использует service_role: все запросы идут под
сессионным JWT. Поэтому невозможны:

- чтение чужих реквизитов (фильтр по tenant_id внутри RLS);
- создание записи под чужим `tenant_id` / `owner_user_id` (RLS WITH CHECK);
- обновление/удаление чужой записи (RLS).

## Diff-summary

- 6 новых файлов (flag, hook, 2 формы, manager, page);
- 2 правки (`LegalDetails.tsx` — early-return на V2; `App.tsx` — новый route);
- 0 миграций БД;
- 0 правок resolver/fields_registry/edge functions;
- 0 удалений старых таблиц/строк;
- 0 правок старых форм и старых хуков.

## DoD

1. ✅ flag=false → старый UI работает без изменений.
2. ✅ flag=true → формы пишут в новые таблицы.
3. ✅ Пользователь оперирует только своими реквизитами (RLS).
4. ✅ Чужие реквизиты недоступны (RLS).
5. ✅ Admin/super_admin видит все записи (RLS-policy + `/admin/tenants`).
6. ✅ Labels = `[scope] [subject_type] <field>`, без визуальных дублей.
7. ✅ Слово AI отсутствует в UI / routes / именах компонентов / labels.
8. ✅ Старые таблицы и legacy-данные не удалены.
9. ✅ Resolver генерации документов не сломан (не тронут).
10. ✅ UI-proof отчёт создан (этот файл).

## Дальше

Этап E: resolver + fields_registry + placeholder catalog для V2.
Clean reset — только после подтверждённого DoD по D и E.
