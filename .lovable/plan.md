да, согласен, с учетом правок:

1. **Не фиксировать “ровно 1 follow-up select” как обязательный PASS-критерий.** После Stage 0.2 может быть:
  &nbsp;
  ```text
  1 × save_session_document_atomic
  + refetch package-session-values
  + возможные lightweight refetch/readiness queries
  ```
  PASS-критерий: нет второго write/RPC-save и нет лишних write-path, а не строго один select.
2. **Network-критерий сформулировать так:**
  &nbsp;
  ```text
  1 × POST /rpc/save_session_document_atomic
  0 × отдельный field-save
  0 × отдельный role-save
  0 × write-RPC для соседних items
  ```
  Read-only refetch-запросы допустимы, если они не создают N+1-loop и не пишут данные.
3. **Для combined field+role использовать только активное detected-поле.** Не использовать `pf-000002 / UAT B5` и любые archived fields. В proof явно указать:
4. **В role desired-state передать полный актуальный набор управляемых ролей item.** Не отправлять только изменённую роль, если RPC трактует массив как desired-state. Иначе тест может искусственно удалить роли и исказить proof.
5. **Проверку “ассайнменты, не вошедшие в desired-state, стали inactive” делать только если это намеренная часть сценария.** Для основного combined proof лучше:
  - изменить/добавить одну роль;
  - сохранить остальные роли в desired-state;
  - проверить, что непредназначенных удалений нет.
  Отдельный desired-state delete уже был доказан раньше.
6. **Audit action проверить по фактическому имени.** В прошлых отчётах встречалось:
  &nbsp;
  ```text
  package_document_atomic_save
  ```
  Убедиться, что в SQL используется точное значение action, которое реально пишет RPC.
7. **Rollback negative-сценарии сравнивать полным snapshot, а не только COUNT.** До/после:
  - значения полей;
  - `updated_at`;
  - `is_active`;
  - `person_id`;
  - `metadata`;
  - audit delta.
8. **Не использовать** `gen_random_uuid()` **в DevTools JS как literal без подготовки.** Для stale version можно передать заранее заданный валидный UUID:
  &nbsp;
  ```text
  00000000-0000-4000-8000-000000000001
  ```
  или получить UUID SQL-запросом до теста.
9. **Проверить UI-state после success.** Помимо БД:
  - dirty badge исчез;
  - кнопка снова disabled;
  - `X/Y` обновился без refresh;
  - role badge обновился;
  - success-toast один.
10. **После PASS этого stage сразу переходить к repeatable-by-role PATCH.** Не возвращаться к уже закрытым Stage 0.1/0.2, если нет нового runtime-факта.
11. &nbsp;
12. План: STAGE-5 — VERIFY COMBINED FIELD+ROLE SINGLE-RPC

## Контекст

RPC `public.save_session_document_atomic(_session_id, _package_template_item_id, _field_values, _role_assignments, _expected_template_version_id)` уже существует и используется через `useAtomicDocumentSave` в `PackageDocumentCard.handleSaveAll`. Stage 5 — это **доказательство контракта**, а не новая реализация. Никаких миграций и кода не меняем.

## Контракт, который нужно подтвердить

Один вызов `save_session_document_atomic` за одну транзакцию:

1. Пишет в `document_package_session_field_values` только те field_values, чьи `field_catalog_id` входят в `detected_tokens` активной версии целевого item (per-item, `package_template_item_id = _package_template_item_id`).
2. Применяет к `document_package_item_role_assignments` полный desired-state управляемых ролей этого item:
  - UPSERT новых/изменённых;
  - soft delete (`is_active=false`) для активных ассайнментов, не вошедших в desired-state.
3. Пишет ровно 1 запись в `audit_logs` с `action='package_document_atomic_save'`, `entity_id=_package_template_item_id`, `meta` с дельтой (`written_fields`, `written_roles`, `deleted_roles`, `template_version_id`).
4. Не трогает:
  - field_values других item'ов (per-item `package_template_item_id` строго `<>`);
  - session-level/orphan-значения (`package_template_item_id IS NULL`);
  - role assignments других item'ов;
  - другие сессии того же пакета.
5. Откат при первой ошибке (FOUND/EXCEPTION) — частичных записей нет.

## Метод проверки (read-only + один контрольный save через UI)

### Baseline snapshot (psql)

Снять до save для пакета «Годовое собрание» и целевого item `f9962f6b-...` (1. Приказ):

```sql
-- A. Per-item values этого item
SELECT field_catalog_id, value_text, value_number, value_date, value_datetime, value_time, updated_at
FROM document_package_session_field_values
WHERE session_id = :sid AND package_template_item_id = :item_id
ORDER BY field_catalog_id;

-- B. Per-item values соседних items (febd1821-..., 63bb4030-...)
SELECT package_template_item_id, field_catalog_id, value_text, value_number, value_date, updated_at
FROM document_package_session_field_values
WHERE session_id = :sid AND package_template_item_id <> :item_id;

-- C. Session-level / orphan values (item_id IS NULL)
SELECT field_catalog_id, value_text, value_number, value_date, updated_at
FROM document_package_session_field_values
WHERE session_id = :sid AND package_template_item_id IS NULL;

-- D. Role assignments этого item
SELECT id, role_catalog_id, person_id, metadata->>'position' AS pos, sort_order, is_active, updated_at
FROM document_package_item_role_assignments
WHERE package_session_id = :sid AND package_template_item_id = :item_id
ORDER BY sort_order, id;

-- E. Role assignments соседних items
SELECT package_template_item_id, role_catalog_id, person_id, is_active, updated_at
FROM document_package_item_role_assignments
WHERE package_session_id = :sid AND package_template_item_id <> :item_id;

-- F. Последние записи audit для этого item
SELECT id, action, entity_id, created_at, meta
FROM audit_logs
WHERE action = 'package_document_atomic_save' AND entity_id = :item_id
ORDER BY created_at DESC LIMIT 5;
```

### Контрольное действие

В UI на `/admin/documents` открыть карточку «1. Приказ…», изменить:

- одно pf-поле (например, `pf-000003` «Дата приказа» → новая дата);
- одно role assignment (изменить person для существующей роли ИЛИ добавить новое назначение).

Нажать «Сохранить документ». Зафиксировать через DevTools Network:

- ровно 1 запрос `POST .../rpc/save_session_document_atomic`;
- ровно 1 follow-up `select document_package_session_field_values` (active refetch из Stage 0.2);
- никаких прочих rpc/select для других items.

### After snapshot

Повторить A–F. Проверки:


| #   | Проверка                                                                                                                                                              | Ожидание |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | A: ровно 1 строка изменилась (новый `updated_at`, value = новое значение).                                                                                            | passed   |
| 2   | A: остальные 6 строк item имеют `updated_at` без изменений.                                                                                                           | passed   |
| 3   | D: изменённый ассайнмент имеет новый `updated_at`/`person_id`; ассайнменты, не вошедшие в desired-state, переключились в `is_active=false`; новые — `is_active=true`. | passed   |
| 4   | B: ни одна строка соседних items не изменилась (`updated_at` идентичен).                                                                                              | passed   |
| 5   | C: orphan/session-level (`item_id IS NULL`) — `updated_at` идентичен.                                                                                                 | passed   |
| 6   | E: ассайнменты соседних items — `updated_at` и `is_active` идентичны.                                                                                                 | passed   |
| 7   | F: появилась ровно 1 новая запись `package_document_atomic_save` с `meta.written_fields=1`, `meta.written_roles>=1`, `entity_id=:item_id`.                            | passed   |
| 8   | Бейдж X/Y и подсветка required-empty (Stage 0.2) переключились без ручного refresh.                                                                                   | passed   |


### Отрицательные сценарии (read-only от UI; psql проверка побочных эффектов)

1. Stale version: передать `_expected_template_version_id = gen_random_uuid()` — RPC должен поднять `stale_template_version`, ни одной строки в A/D/F не появилось.
2. Person outside owner: указать `person_id` чужого профиля — `person_not_accessible` / `person_outside_session_owner`, никаких частичных записей.
3. Inactive role: указать `role_catalog_id` неактивной роли — соответствующая ошибка, без записи.

Все три выполняем через скриптовый rpc-вызов в DevTools console (await supabase.rpc(...)) и сверяем snapshot — никаких миграций, никакого нового UI.

## Изменения в коде

Никаких. Stage 5 — только верификация и proof.

## Proof

Создать `.lovable/proofs/atomic_save_combined_field_role_v1.md`:

1. Фикстура: session_id, item_id (Приказ), соседние item_ids, выбранные field/role для контроля.
2. Snapshots A–F до и после (вырезки psql).
3. Network лог (1×rpc + 1×select).
4. Audit запись (id, meta).
5. Таблица проверок 1–8 со статусом.
6. 3 отрицательных сценария с RPC-ответом и snapshot-дельтой = 0.
7. Ссылка на код: `useAtomicDocumentSave`, `save_session_document_atomic`, `PackageDocumentCard.handleSaveAll`.

## DoD

- ✅ Контракт (1 вызов → ровно поле + ровно роль + ровно 1 audit, соседи и orphan не тронуты) подтверждён живыми snapshots.
- ✅ Отрицательные кейсы возвращают ошибку и не оставляют частичных записей.
- ✅ Proof опубликован.
- После закрытия Stage 5 — стартует основной `PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1`.

## Out of scope

- Любые миграции / новые RPC / изменения схемы.
- Refactor `useAtomicDocumentSave` / `PackageDocumentCard`.
- Repeatable-by-role логика — отдельный PATCH после закрытия Stage 5.