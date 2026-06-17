# Stage 4 — Multi-tenant proof (PASS)

Дата: 2026-06-17
Scope: RPC `public.save_session_document_atomic` (SECURITY DEFINER) — границы между владельцами сессий.

## Дефект, найденный до запуска proof

В предыдущей версии RPC проверка `person_id` выполнялась только через `EXISTS`.
Т.к. функция SECURITY DEFINER, любой авторизованный пользователь мог прикрепить к
своей сессии чужого `legal_details_persons.id`. Это полноценная cross-tenant
утечка прав на запись.

Исправлено в миграции (Stage 4 hardening):
- читаем `legal_details_persons.profile_id`;
- если `profile_id IS NULL` и актор не админ — `person_not_accessible`;
- если `profile_id <> session_owner_profile` и актор не админ —
  `person_outside_session_owner`;
- админ (`admin`/`super_admin`) сохраняет полный bypass.

## Harness

Транзиентная edge-функция `proof-stage4-multitenant` (удалена после proof):
- создавала трёх пользователей: owner-A, foreign-B, admin;
- для каждого upsert профиля и `legal_details_persons`;
- A и B получали по сессии на пакет «Идеология»;
- сценарии вызывались через PostgREST RPC с реальными JWT каждого пользователя;
- никаких прямых SQL-обходов RLS, никаких подменённых заголовков.

## Результаты (11/11 PASS)

| #   | Сценарий                                       | Ожидание                       | Результат                       |
| --- | ---------------------------------------------- | ------------------------------ | ------------------------------- |
| T1  | Владелец сохраняет свою сессию                 | ok                             | ok                              |
| T2  | Чужой пользователь сохраняет сессию владельца  | `forbidden`                    | `forbidden`                     |
| T3  | Владелец передаёт `person_id` чужого профиля   | `person_outside_session_owner` | `person_outside_session_owner`  |
| T4  | A пытается писать в `session_id` пользователя B| `forbidden`                    | `forbidden`                     |
| T5  | A передаёт item другого пакета                 | `item_outside_session_package` | `item_outside_session_package`  |
| T6  | A передаёт field-catalog другого пакета        | `field_outside_session_package`| `field_outside_session_package` |
| T7  | A передаёт role-catalog другого пакета         | `role_outside_session_package` | `role_outside_session_package`  |
| T8  | Админ сохраняет сессию A                       | ok                             | ok                              |
| T9  | B читает `session_field_values` сессии A       | 0 строк (RLS)                  | status=200, rows=0              |
| T10 | B читает `item_role_assignments` сессии A      | 0 строк (RLS)                  | status=200, rows=0              |
| T11 | `audit_logs` только за реально успешные вызовы | new=2, B=0                     | new=2, B=0                      |

## Audit-инвариант

В диапазоне теста добавились ровно 2 записи `package_document_atomic_save`
(T1 и T8). У foreign-B 0 audit-записей — это финальное подтверждение, что
ни одна заблокированная операция не оставила «успешного» следа в журнале.

## Cleanup (verified)

```
users_leftover    = 0
sessions_leftover = 0
persons_leftover  = 0
roles_leftover    = 0
audit_leftover    = 0
```

Edge-функция `proof-stage4-multitenant` удалена и из проекта, и из репозитория.

## Артефакты

- Миграция: добавлены guards `person_not_accessible` и `person_outside_session_owner`
  в `save_session_document_atomic`.
- Транзиентная edge-функция: удалена.
- Документ proof: этот файл.

## Статус

- Stage 1: PASS
- Stage 2: PASS (после runtime-фиксов из Stage 3)
- Stage 3: PASS
- **Stage 4 multi-tenant: PASS**
- Stage 5 unified `PackageDocumentCard`: NOT STARTED
- Stage 6 новый пакет E2E: NOT STARTED
- Stage 7 orphan transition: NOT STARTED
- Patch: OPEN
