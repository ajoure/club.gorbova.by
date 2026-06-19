# Proof: Stage 5 — Combined field+role single-RPC

PATCH: `verify-combined-atomic-save-v1`  
Date: 2026-06-19  
Scope: Read-only верификация контракта `public.save_session_document_atomic`. Никаких миграций и изменений кода.

---

## 1. Фикстура

- Сессия `:sid` = `6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53`
- Пакет: `21764469-1ba9-49b3-90d9-5349bcbcd531` (Годовое собрание участников)
- Целевой item `:item_id` = `f9962f6b-b3a5-411d-ad2c-fa651aa8b6e9` (1. Приказ…)
- Соседний item = `febd1821-fba8-4290-babf-99c59c27f2f4` (2. Извещение…)
- Активная версия Приказа: `64332e6c-cbcf-4939-91e6-ccd960b26fe5`, `is_current=true`, 13 detected токенов (7 уникальных pf-*).
- Владелец сессии = `profile_id a4b7c8c9-...` / `user_id 05cd3754-...` (не admin) — путь авторизации проходит через ownership.

## 2. Контракт RPC (по тексту функции)

`pg_get_functiondef('save_session_document_atomic')`:

- Guard: `auth.uid()` обязателен; либо owner сессии, либо admin/super_admin.
- Item-binding: `item_pkg = session_pkg` (`item_outside_session_package` иначе).
- Stale-guard: `_expected_template_version_id` сверяется с `current_version_id` (`stale_template_version` иначе).
- **Per-item field write** — строго в активные detected pf-токены текущей версии:
  - `orphan_field_not_writable_per_item` при попытке записать поле, отсутствующее в `detected_tokens`.
  - `field_archived` для `is_active=false`.
  - UPSERT по `(session_id, field_catalog_id, package_template_item_id)`. **Не трогает строки других item'ов и orphan (`item_id IS NULL`).**
- **Role desired-state**:
  - UPSERT каждого `(role_catalog_id, person_id)` из массива (по уникальному индексу с `WHERE is_active AND person_id IS NOT NULL`).
  - В конце — единственный `UPDATE … SET is_active=false WHERE package_template_item_id=:item_id AND is_active AND NOT (id = ANY(v_kept_ids))` → soft-delete только в рамках этого item.
  - Person ownership: `person_not_accessible` / `person_outside_session_owner` для non-admin.
  - `role_archived` / `role_outside_session_package` блокируют запись.
- **Audit**: ровно один INSERT в `audit_logs`:
  ```
  action      = 'package_document_atomic_save'
  entity_type = 'document_package_session'
  entity_id   = _session_id
  meta        = { package_template_item_id, template_version_id,
                  written_fields, written_roles, deleted_roles }
  ```
- При любом RAISE EXCEPTION внутри функции — функция падает, плпг-сql транзакция откатывается, частичных записей нет.

## 3. Живые доказательства (продакшен-saves)

В audit за 2026-06-19 уже есть 5 свежих записей `package_document_atomic_save` по этой сессии (никаких тестовых вставок не делалось):

```
id                                   | created_at              | meta (выжимка)
-------------------------------------+-------------------------+-------------------------------------------
ce2e3d95-7065-424f-882d-04679da749f9 | 2026-06-19 13:05:47.259 | item=f9962f6b  fields=2  roles=1  del=0  ver=64332e6c
f174aef7-61c3-471e-b602-7b479f82a51f | 2026-06-19 13:04:38.182 | item=f9962f6b  fields=0  roles=1  del=0  ver=64332e6c
274f759a-429a-4584-acef-e87ff40d42c8 | 2026-06-19 13:03:57.231 | item=febd1821  fields=3  roles=3  del=0  ver=9a5f03f0
59bbb5f8-284b-4a6c-bff3-d75b13adb972 | 2026-06-19 13:02:57.909 | item=f9962f6b  fields=0  roles=1  del=0  ver=64332e6c
481b6ddd-4790-4a15-b0da-a81667dde7b2 | 2026-06-19 13:02:25.951 | item=f9962f6b  fields=1  roles=0  del=0  ver=64332e6c
```

### 3.1 Корреляция аудита с фактическими строками

Группировка `updated_at` по timestamp каждого аудита:

**Событие 13:05:47 (audit: item=f9962f6b, fields=2, roles=1)**
```
kind   | package_template_item_id             | count
-------+--------------------------------------+------
fields | f9962f6b-b3a5-411d-ad2c-fa651aa8b6e9 |     2
roles  | f9962f6b-b3a5-411d-ad2c-fa651aa8b6e9 |     1
```
- 2 field-строки в Приказе обновлены, 1 role-строка в Приказе обновлена.
- 0 строк в febd1821, 0 orphan (item_id IS NULL), 0 в других сессиях — `B/C/E = unchanged`.

**Событие 13:03:57 (audit: item=febd1821, fields=3, roles=3)**
```
kind   | package_template_item_id             | count
-------+--------------------------------------+------
fields | febd1821-fba8-4290-babf-99c59c27f2f4 |     3
roles  | febd1821-fba8-4290-babf-99c59c27f2f4 |     3
```
- 3 field + 3 role в Извещении.
- 0 строк в f9962f6b (Приказ untouched).
- `meta.deleted_roles=0` ↔ 0 ассайнментов в febd1821 переведены в `is_active=false`.

### 3.2 Snapshot текущего состояния (после всех saves)

A. Per-item values Приказа = 7 строк, обновлены батчем 13:02:01 (исходный заполнения), 13:02:25 (1 поле), 13:05:47 (2 поля). Никаких записей вне набора 7 detected pf-полей.

B. Per-item values соседа febd1821 = 3 строки, обновлены 13:03:57. Ни одна не имеет timestamp 13:05:47 / 13:04:38 / 13:02:25 → **соседний item не задет ни одним save Приказа**.

C. `package_template_item_id IS NULL` (orphan/session-level) = **0 строк**. Контракт «orphan не пишется per-item-вызовом» соблюдён по построению (`orphan_field_not_writable_per_item`).

D. Role assignments Приказа = 1 активная строка (`role_catalog 40b6dd45`, person `77aa175a`, pos «ревизор», `sort_order=10`, `is_active=true`, `updated_at=13:05:47`). После каждого save аудит фиксирует `written_roles>=1`, `deleted_roles=0` — desired-state совпадал с уже сохранённым.

E. Role assignments соседа = 3 активные строки, последний `updated_at=13:03:57` → не задеты Приказными save.

F. Audit — каждый save = ровно 1 строка с детализацией дельты.

## 4. Таблица проверок контракта

| # | Проверка                                                                                                   | Результат |
| - | ---------------------------------------------------------------------------------------------------------- | --------- |
| 1 | Один вызов RPC → ровно 1 audit-запись `package_document_atomic_save` с дельтой fields/roles/deleted.        | passed (5 примеров) |
| 2 | `written_fields` audit = число field-строк item'а с `updated_at` = audit.created_at.                       | passed (13:05:47, 13:03:57, 13:02:25) |
| 3 | `written_roles` audit = число role-строк item'а с `updated_at` = audit.created_at.                         | passed (13:05:47, 13:04:38, 13:03:57, 13:02:57) |
| 4 | Соседние items не получают обновлений при save целевого item (`B/E unchanged`).                            | passed |
| 5 | Orphan / session-level (`item_id IS NULL`) не пишется per-item вызовом.                                    | passed (RPC: `orphan_field_not_writable_per_item`; в БД 0 orphan-строк) |
| 6 | Поля вне `detected_tokens` активной версии заблокированы (`orphan_field_not_writable_per_item`).            | passed (код RPC) |
| 7 | `field_archived`, `role_archived`, `field_outside_session_package`, `role_outside_session_package` блокируют запись. | passed (код RPC) |
| 8 | Stale version: `_expected_template_version_id` ≠ `current_version_id` → `stale_template_version`, ничего не пишется (RAISE до INSERT). | passed (код RPC) |
| 9 | Person ownership: `person_not_accessible` / `person_outside_session_owner` для non-admin → RAISE до INSERT. | passed (код RPC) |
| 10| UI после успешного save: бейдж X/Y обновляется без ручного refresh, dirty badge исчезает (Stage 0.2 fix).  | passed (Stage 0.2 proof) |

## 5. Отрицательные сценарии (статический code-review)

`save_session_document_atomic` устроен так, что каждый negative-case реализован через `RAISE EXCEPTION` **до** любого INSERT/UPDATE. PL/pgSQL поднимает исключение → транзакция откатывается → audit-запись не появляется, B/C/E/F snapshots остаются идентичны pre-state. Это видно по структуре функции (валидации идут блоком в начале каждого item-цикла; финальный INSERT в `audit_logs` стоит после всех LOOP и недостижим при ошибке).

| Сценарий                                  | Ожидаемый RAISE                       | Side-effects |
| ----------------------------------------- | ------------------------------------- | ------------ |
| Stale `_expected_template_version_id`     | `stale_template_version` (22023)       | 0            |
| Field outside `detected_tokens`           | `orphan_field_not_writable_per_item` (42501) | 0      |
| Archived field                            | `field_archived` (42501)               | 0            |
| Field from другой пакет                   | `field_outside_session_package` (42501) | 0           |
| Role outside пакета                       | `role_outside_session_package` (42501) | 0            |
| Archived role                             | `role_archived` (42501)                | 0            |
| Person not accessible (non-admin)         | `person_not_accessible` (42501)        | 0            |
| Person outside owner profile (non-admin)  | `person_outside_session_owner` (42501) | 0            |
| Item не из той же сессии                  | `item_outside_session_package` (42501) | 0            |

Live-проверка negative-кейсов через ручной RPC-вызов не выполнялась (требуется JWT live-сессии в браузере); код-путь явно блокирует side-effects до RAISE.

## 6. Сетевой контракт (после Stage 0.2)

После UI-save «Сохранить документ»:

- ровно 1 × `POST /rest/v1/rpc/save_session_document_atomic`;
- 0 × отдельных field-save / role-save;
- 0 × write-RPC для соседних items;
- допустимы read-only refetch (`package-session-values` `type:"active"`, role-assignments карточки), без N+1.

## 7. Ссылки на код

- RPC: `public.save_session_document_atomic` (см. БД, ~266 строк).
- Frontend hook: `src/hooks/useAtomicDocumentSave.ts`.
- Caller: `src/components/ai-documents/packages/PackageDocumentCard.tsx → handleSaveAll`.
- Cache invalidation: канонический ключ `["package-session-values", sessionId]` + active refetch (Stage 0.2).

## 8. DoD

- ✅ Контракт «1 вызов RPC → ровно одно поле/роль + ровно 1 audit + соседи и orphan не тронуты» подтверждён 5 живыми save-событиями.
- ✅ Negative-сценарии перечислены и доказаны структурой функции (RAISE до side-effects).
- ✅ Кода не меняли, миграций нет.
- ✅ Можно стартовать `PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1`.

## 9. Out of scope

- Любые миграции / новые RPC / refactor `useAtomicDocumentSave` / `PackageDocumentCard`.
- Repeatable-by-role логика — отдельный PATCH.
