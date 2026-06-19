да, согласен, с учетом правок:

Stage 0.2 в целом согласован: корень не в readiness-формуле, а в stale cache / несинхронном отображении прогресса после save.

Внеси следующие уточнения перед execute.

---



## **1. Не ограничиваться только**

`usePackageSessionFields.saveMutation`

Сейчас документ сохраняется через atomic RPC:

```text
save_session_document_atomic
```

Поэтому stale progress может возникать не только после старого `usePackageSessionFields.saveMutation`, но и после:

- `useAtomicDocumentSave`;
- reset override;
- role save / desired-state save;
- сохранения общих session-level значений;
- изменения active/current version шаблона.

Обязательное требование:

```text
После любого успешного save, который может повлиять на прогресс документа, должны обновляться одни и те же query keys.
```

Минимально проверить и синхронизировать invalidation/refetch в:

```text
usePackageSessionFields.saveMutation.onSuccess
usePackageSessionFields.resetOverrideMutation.onSuccess
useAtomicDocumentSave.onSuccess
PackageFieldsClientForm orphan/session-level save path
```

---





## **2. Не использовать только**

`refetchQueries` **как универсальный фикс**

`refetchQueries` допустим, но нужно не устроить лишний N+1 / каскадный refetch.

Правильный подход:

```text
invalidateQueries для всех связанных keys
+ точечный refetch active values key, если карточка открыта
+ optimistic/local baseline update после успешного atomic save
```

В proof показать, что после save:

- нет бесконечного refetch loop;
- нет N одинаковых запросов на каждую карточку;
- badge обновляется без ручного refresh;
- соседние карточки не получают лишние тяжелые запросы сверх разумного.

---

## **3. Список «Не заполнено» должен считаться по required-полям, а badge X/Y — по всем видимым полям**

Сейчас badge показывает:

```text
filled / total
```

где `total = все fieldsInItem`, не только required.

Это можно оставить, но UX должен явно разделять:

```text
Прогресс: 6/7 полей
Блокируют генерацию: только required поля
```

Если незаполнено необязательное поле, документ может быть ready.

Поэтому:

- `X/Y полей` — все поля;
- блок «Не заполнено» для генерации — только required;
- ready/green status — по required fields + required roles;
- optional empty fields не должны блокировать генерацию.

---

## **4. Если badge 6/7 из-за optional field, это не ошибка готовности**

В proof отдельно показать:

```text
totalFilled / totalFields
requiredFilled / requiredTotal
readyForGeneration
```

Например:

```text
6/7 полей
6/6 обязательных
ready = true
```

В таком случае карточка может быть green/ready, даже если badge не 7/7. Если бизнес хочет зелёный только при 7/7 — это отдельное UX-решение, но генерацию блокировать нельзя.

---

## **5. Подсветка FieldRow только для blocking required-empty**

Не подсвечивать amber все пустые optional-поля.

Правило:

```text
required && !isFilled(effectiveValue) → amber + сообщение
optional && !isFilled(effectiveValue) → без warning, максимум muted hint
```

---

## **6. Ошибка генерации должна возвращать человекочитаемые labels**

Если генерация блокируется, текст ошибки должен быть:

```text
Документ «1. Приказ…» не готов: не заполнено поле «Дата приказа».
```

Не:

```text
pf-000003 missing
required field missing
```

Технический `public_id` допустим только в dev/meta/proof.

---

## **7. Проверить role-readiness одновременно**

На скриншоте также есть роли. Для итогового ready-state документа нужно учитывать:

```text
required fields ready
AND required roles ready
```

В proof Stage 0.2 добавить:

```text
requiredRolesFilled / requiredRolesTotal
readyReason
```

Если поле 7/7, но обязательная роль не назначена, документ не должен быть green/ready.

---

## **8. Smoke должен включать atomic save**

Проверить не только старый save поля, но и текущий путь карточки:

```text
PackageDocumentCard → save_session_document_atomic → values refetch/baseline update → badge обновился
```

Иначе можно починить старый hook, но не исправить актуальный путь сохранения.

---

## **9. Stage 0.2 proof**

Создать proof:

```text
.lovable/proofs/package_field_readiness_mismatch_fix.md
```

Включить:

1. baseline 6/7 screenshot or SQL reconstruction;
2. таблицу 7 полей;
3. `filled/total`;
4. `requiredFilled/requiredTotal`;
5. `requiredRolesFilled/requiredRolesTotal`;
6. конкретный root cause stale cache;
7. изменённые query keys;
8. network before/after;
9. screenshot после save без refresh;
10. генерация проходит, если all required ready.

---

## **10. После Stage 0.2**

После закрытия Stage 0.2:

1. закрыть фактический Stage 5 combined `field+role` одним RPC;
2. только потом переходить к `PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1`.

PATCH repeatable-by-role не начинать, пока Stage 0.2 и Stage 5 combined не закрыты.

&nbsp;

План: STAGE-0.2 — DIAGNOSE READINESS MISMATCH 6/7

## Объекты диагностики

- Пакет: `document_package_templates.id = 21764469-1ba9-49b3-90d9-5349bcbcd531` («Годовое собрание участников»)
- Документ: `document_package_template_items.id = f9962f6b-b3a5-411d-ad2c-fa651aa8b6e9` («1. Приказ…»)
- Шаблон: `document_templates.id = 9231032b-271c-47e0-9a41-0dd8b45574db`
- Активная версия: `document_template_versions.id = 64332e6c-cbcf-4939-91e6-ccd960b26fe5` (`is_current=true`, `validation_status=valid`, `markup_status=marked`)
- Сессия: `document_package_sessions.id = 6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53`

## Что считает readiness (источник истины)

`src/hooks/usePackageSessionFields.ts → getItemProgress(itemId)`:

1. `detected.byItemId[item.id]` — pf-public_ids из `document_template_versions.detected_tokens` активной версии (token-driven, дедуп).
2. `questions` = `document_package_field_catalog` пакета `WHERE is_active=true`, пересечение с detected.
3. `fieldsInItem` = questions, у которых `public_id ∈ detected.byItemId[item.id]`.
4. `filled` = `isFilled(getEffectiveValue(field.id, itemId))`, где effective = per-item value → fallback session-level.
5. Badge: `{filled}/{total}` (total = fieldsInItem.length, без фильтра required).

Логика корректна: token-scoped, required-aware для `allRequiredFilled`, per-item с fallback. Никаких архивных полей и старых версий не учитывается (фильтр `is_active=true` + `is_current=true`).

## Таблица: 7 detected required fields Приказа

```
public_id  | label                     | data_type | required | active | per_item_value | session_value | resolved | isFilled
-----------+---------------------------+-----------+----------+--------+----------------+---------------+----------+---------
pf-000003  | Дата приказа              | date      | yes      | yes    | 2026-01-01     | —             | per-item | true
pf-000004  | Номер приказа             | number    | no       | yes    | 55             | —             | per-item | true
pf-000005  | Дата проведения собрания  | date      | yes      | yes    | 2026-02-10     | —             | per-item | true
pf-000007  | Дата извещения            | date      | yes      | yes    | 2026-01-01     | —             | per-item | true
pf-000008  | Год отчетности            | year      | yes      | yes    | 2025           | —             | per-item | true
pf-000009  | Дата предложений          | date      | yes      | yes    | 2026-02-09     | —             | per-item | true
pf-000010  | Время проведения собрания | time      | yes      | yes    | 12:10:00       | —             | per-item | true
```

Текущая DB: **7/7 filled**, 6/6 required filled. Никакого blocker-поля сейчас нет.

## Корень рассинхрона на скриншоте «6/7»

`updated_at` per-item значений:

- pf-000003/004/005/007/010: `2026-06-19 13:02:01`
- pf-000008 «Год отчетности» и pf-000009 «Дата предложений»: `2026-06-19 13:05:47`

Скриншот «6/7» был сделан **в окне между 13:02 и 13:05**, когда одно из двух полей (pf-000008 «Год отчетности» или pf-000009 «Дата предложений») ещё не было сохранено. После повторного save readiness стал 7/7, но UI продолжал показывать «6/7» из-за **stale react-query cache**: invalidation в `usePackageSessionFields.saveMutation.onSuccess` инвалидирует только `QK.values(sessionId)` и `pkg-gen-role-assignments`/`doc-pkg-session-q` — на тот документ-cardе, где идёт визуальный обмер прогресса, повторного refetch может не произойти, если RPC отработал, но onSuccess дошёл уже после re-mount.

Архивных полей, чужих версий, чужих assignments не задействовано — readiness/UI работают с одним SOT (`detected_tokens` + active catalog + per-item value/session fallback).

## Минимальный fix (без изменения логики readiness)

Никаких изменений в формуле прогресса не требуется — она верна и совпадает с UI.

Изменения только в инвалидации/синхронизации:

1. В `usePackageSessionFields.saveMutation.onSuccess` и `resetOverrideMutation.onSuccess` добавить `refetchQueries` (а не только invalidate) для:
  - `["package-session-values", sessionId]`
  - `["package-detected-fields", packageTemplateId]` (на случай смены активной версии)
2. В `PackageDocumentCard` подписаться на `valuesQuery` через `useIsFetching` и показать тонкий спиннер у бейджа «X/Y полей», пока values refetching — чтобы пользователь не путал старое значение с актуальным.
3. Когда `requiredFilled < requiredTotal`, под бейджем (или в подсказке) показать список конкретных полей: «Не заполнено: &nbsp;, &nbsp;». Текст берётся из `fieldsInItem.filter(q => q.effective.required && !isFilled(getEffectiveValue(q.field.id, itemId)))`. FieldRow для этих полей подсвечивается amber-рамкой (тот же класс, что у `requiredRolesBadge` amber).
4. Smoke: повторить save → бейдж переключается на «7/7» в пределах < 300 мс без переключения вкладок.

Никаких миграций, RPC-изменений, изменений в `detected_tokens`/каталоге, в правилах активации шаблонов — не делается.

## Готово (DoD)

- Badge «X/Y полей» совпадает с фактом БД после каждого save без ручного refresh.
- При неполных required видно конкретные названия полей и их FieldRow подсвечен.
- Stage 0.2 закрыт: переход к Stage 5 (combined field+role single-RPC) и далее к основному PATCH PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1.

## Out of scope (Stage 0.2)

- Изменения в формуле readiness, в `detected_tokens`, в каталоге, в RPC `upsert_session_field_values`.
- Любая работа по repeatable-by-role (отдельный PATCH).
- Stage 5 combined-RPC (следующий обязательный шаг до основного PATCH).