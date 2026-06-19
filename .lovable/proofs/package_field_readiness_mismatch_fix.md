# Proof: Stage 0.2 — Package Field Readiness Mismatch Fix

PATCH: package-field-readiness-mismatch-fix  
Date: 2026-06-19  
Scope: Только UI/cache-инвалидация. Формула readiness не меняется.

---

## 1. Baseline (скриншот «6/7»)

- Пакет: `document_package_templates.id = 21764469-1ba9-49b3-90d9-5349bcbcd531` (Годовое собрание участников)
- Документ: `document_package_template_items.id = f9962f6b-b3a5-411d-ad2c-fa651aa8b6e9` (1. Приказ…)
- Шаблон: `document_templates.id = 9231032b-271c-47e0-9a41-0dd8b45574db`
- Активная версия: `document_template_versions.id = 64332e6c-cbcf-4939-91e6-ccd960b26fe5`
  - `is_current=true`, `validation_status=valid`, `markup_status=marked`
- Сессия: `document_package_sessions.id = 6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53`

## 2. Таблица 7 detected pf-полей Приказа (live SQL)

```
public_id | label                     | data_type | required | active | per_item_value | session_value | resolved | isFilled
----------+---------------------------+-----------+----------+--------+----------------+---------------+----------+---------
pf-000003 | Дата приказа              | date      | yes      | yes    | 2026-01-01     | —             | per-item | true
pf-000004 | Номер приказа             | number    | no       | yes    | 55             | —             | per-item | true
pf-000005 | Дата проведения собрания  | date      | yes      | yes    | 2026-02-10     | —             | per-item | true
pf-000007 | Дата извещения            | date      | yes      | yes    | 2026-01-01     | —             | per-item | true
pf-000008 | Год отчетности            | year      | yes      | yes    | 2025           | —             | per-item | true
pf-000009 | Дата предложений          | date      | yes      | yes    | 2026-02-09     | —             | per-item | true
pf-000010 | Время проведения собрания | time      | yes      | yes    | 12:10:00       | —             | per-item | true
```

## 3. Текущее состояние

- filled/total = **7/7**
- requiredFilled/requiredTotal = **6/6**
- requiredRolesFilled/requiredRolesTotal — отдельно через `useDocumentItemRoleAssignments` (не предмет Stage 0.2)
- readyForGeneration (fields part) = **true**

## 4. Root cause скриншота «6/7»

`updated_at` per-item значений:

- pf-000003/004/005/007/010: `2026-06-19 13:02:01`
- pf-000008, pf-000009: `2026-06-19 13:05:47`

Скриншот сделан между 13:02 и 13:05 — реально не хватало одного из двух 13:05-полей. Дополнительно усугублял проблему **stale react-query cache**:

- `useAtomicDocumentSave.onSuccess` инвалидировал ключ `["pkg-session-field-values"]`, которого никто не использует. Канонический ключ — `["package-session-values", sessionId]` из `usePackageSessionFields`.
- Поэтому после atomic save badge мог остаться «6/7», пока пользователь не переключится между вкладками / не перезагрузит страницу.

Формула readiness корректна и совпадает с UI: token-driven (detected_tokens активной версии) ∩ active catalog → per-item value → fallback session-level. Архивные поля и чужие версии в счёт не идут.

## 5. Изменённые query keys / места инвалидации

| Файл                                | Было                                                   | Стало                                                                                     |
| ----------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/hooks/useAtomicDocumentSave.ts` | invalidate `["pkg-session-field-values"]` (мёртвый ключ) | invalidate + точечный `refetchQueries({ queryKey: ["package-session-values", sessionId], type: "active" })` |
| `src/hooks/usePackageSessionFields.ts` (saveMutation) | только invalidate                                  | invalidate + `refetchQueries({..., type: "active"})`                                       |
| `src/hooks/usePackageSessionFields.ts` (resetOverrideMutation) | только invalidate                          | invalidate + `refetchQueries({..., type: "active"})`                                       |

`type: "active"` гарантирует, что refetch выполнится **только** для открытых наблюдателей (одна активная карточка), без N+1 для закрытых аккордеонов. Никаких бесконечных циклов: refetch триггерится строго в `onSuccess`, не зависит от состояния values.

## 6. UI-изменения

- `PackageDocumentCard`:
  - Badge «X/Y полей» теперь показывает `Loader2` пока values refetching (`useIsFetching({ queryKey: ["package-session-values", sessionId] }) > 0`).
  - При непустом `getItemMissingRequired(item.id)` показывается amber-блок: «Не заполнено: <label1>, <label2>».
- `PackageFieldsClientForm` принимает `highlightFieldIds: Set<string>`; FieldRow с `highlightMissing` рендерится в amber-рамке.
- Required vs total: badge остаётся `filled/total` (UX-канон), а блокирующий список и подсветка — только по required. Optional empty поля не подсвечиваются и не блокируют генерацию.

## 7. Smoke / E2E

Шаги:

1. Открыть «Документы → Анкета → Пакет “Годовое собрание” → 1. Приказ…».
2. Очистить «Дата приказа» в карточке Приказа, нажать «Сохранить документ».
3. Badge переключается «7/7 → 6/7» в момент завершения atomic save без перехода на другую вкладку, FieldRow «Дата приказа» подсвечивается amber, появляется блок «Не заполнено: Дата приказа».
4. Заполнить дату, «Сохранить документ» → бейдж 7/7, подсветка пропадает, без ручного refresh.

Сеть:

- На save → 1 `rpc/save_session_document_atomic` + 1 `select document_package_session_field_values` (refetch active).
- Соседние карточки лишних запросов не получают (`type: "active"` + ключ `[..., sessionId]`).

## 8. Out of scope

- Формула readiness, `detected_tokens`, каталог, RPC `upsert_session_field_values`, `save_session_document_atomic`.
- Stage 5 combined field+role single-RPC.
- PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1.

## 9. DoD

- ✅ Badge X/Y полей совпадает с БД после каждого save без ручного refresh.
- ✅ Required-пустые поля видны явно (название + amber FieldRow).
- ✅ Optional empty не блокируют ready/генерацию и не подсвечиваются.
- ✅ Никаких миграций и изменений в RPC.
