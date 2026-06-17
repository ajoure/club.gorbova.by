да, согласен, с учетом правок:

1. **Не удалять старую запись** `ai_generated_documents ba5e7b44-…`**.** Это исторический сформированный документ и immutable-факт. Для повторного D7 использовать:
  - новый batch/idempotency key;
  - либо новую тестовую генерацию/сессию;
  - либо предусмотренный pipeline параметр повторного запуска.
  Старые документы, snapshots и audit-записи не удалять ради обхода идемпотентности.
2. **Сохранять snapshot по фактически использованному raw-токену, а не только по базовому ID.** Один `pf-XXXXXX` или `ln-XXXXXX` может встречаться с разными модификаторами. Дедуп определить по:
  &nbsp;
  ```text
  provider + raw_inside
  ```
  либо по эквивалентному ключу, включающему `format` и `case`. Иначе два токена одного поля с разным форматированием могут потерять разные `rendered_value`.
3. `template_tokens_snapshot` **должен фиксировать точные токены шаблона.** Сохранять не только базовые:
  &nbsp;
  ```text
  pf-000005
  ln-000001
  package.ul.FLD-000010
  ```
  но и модификаторы, если они присутствовали:
  ```text
  pf-000005|format=full
  package.ul.FLD-000010|format=long
  ln-000001|format=signature_short
  ```
  Это необходимо для исторической воспроизводимости.
4. **Не использовать** `resolved[raw_inside]`**, если фактический ключ map отличается.** Перед реализацией подтвердить точный ключ `resolved` для package/ln/pf. При отсутствии ключа snapshot не должен молча писать `undefined`; генерация либо сохраняет фактическое rendered value из trace, либо останавливается с доказуемой ошибкой snapshot propagation.
5. **Для** `package` **snapshot зафиксировать происхождение без избыточного раскрытия внутренних объектов.** Сохранять канонические поля:
  &nbsp;
  ```text
  provider
  raw_inside
  bag_key
  raw_value
  rendered_value
  format_applied
  case_applied
  source
  item_context
  ```
  Не складывать целиком внутренний resolver entry, если там могут быть лишние данные.
6. **Для** `ln` **не сохранять неограниченный внутренний объект** `persons/positions`**.** Зафиксировать минимальный исторический набор, необходимый для воспроизводимости:
  &nbsp;
  ```text
  link_public_id / token
  selected_person_ids либо snapshot отображённых ФИО
  position labels
  rendered_value
  format_applied
  case_applied
  item_context
  ```
  Структура должна быть JSON-safe и не зависеть от временных внутренних типов resolver.
7. **Snapshot формировать до INSERT документа и записывать атомарно вместе с документом.** Не допускается:
  - сначала создать документ с пустым snapshot;
  - затем отдельным UPDATE дописать trace.
  При ошибке построения snapshot документ не должен сохраняться как успешно сгенерированный с неполной историей.
8. **Сохранить обратную совместимость** `meta.tokens_snapshot`**.** Старые читатели могут ожидать текущую структуру pf-записей. Новые providers добавлять add-only, не переименовывая существующие pf-поля:
9. `item_context` **должен брать доказуемый item текущего генерируемого документа.** Проверить, что:
  &nbsp;
  ```text
  package_template_item_id
  ```
  не приходит из необязательного внешнего параметра и не может быть item другого пакета. При package-mode без item context — STOP с канонической ошибкой, кроме явно подтверждённого legacy-сценария.
10. **RPC reset должна проверять не только владельца сессии.** Серверно подтвердить:
  - session доступна текущему пользователю или администратору его workspace;
  - field принадлежит `session.package_template_id`;
  - item принадлежит тому же package template;
  - удаляемая строка соответствует именно этой связке;
  - нет доступа между workspace.
  Не доверять одним переданным UUID.
11. **При отсутствии строки reset должен быть идемпотентным.** Возврат:
  &nbsp;
  ```json
  { "deleted": 0 }
  ```
  допустим и не является ошибкой. Ошибка нужна только при нарушении guard/auth/package boundaries.
12. **Добавить серверный audit reset-операции.** При фактическом удалении per-item override записать:
  &nbsp;
  ```text
  entity_type
  entity_id
  action
  actor_user_id
  session_id
  field_catalog_id
  package_template_item_id
  previous_value
  ```
  Без удаления или изменения исторических snapshot сформированных документов.
13. **Развести RPC reset и полное очищение значения.** В этом узком патче реализуется только:
  &nbsp;
  ```text
  delete per-item override → fallback на session-level
  ```
  Не называть session-level `upsert value:null` «Очистить полностью», пока не доказано, удаляет ли RPC строку или сохраняет NULL и как required-gate трактует NULL.
14. **Инвалидация после reset должна использовать реальные канонические query keys.** Не добавлять условный `pkg-gen-role-assignments`, если reset поля не меняет роли. Обязательно обновить:
  - values текущей сессии/item;
  - effective fields;
  - generation readiness;
  - package summary.
  После reset fallback должен появиться без перезагрузки.
15. **Добавить тесты snapshot propagation:**
  - `pf`, `ln`, `package` в одном документе;
  - одинаковый token ID с двумя разными modifiers;
  - дедуп одинакового raw-токена;
  - разные `rendered_value`;
  - корректный `item_context`;
  - billing-mode остаётся без изменений;
  - ошибка snapshot builder не создаёт документ.
16. **Добавить тесты reset RPC:**
  - успешное удаление собственного override;
  - повторный reset → `deleted:0`;
  - `item=NULL` → `cannot_delete_session_level_via_reset`;
  - item другого package → `pkg_field_value_item_mismatch`;
  - field другого package;
  - чужая session/workspace;
  - admin согласно RBAC;
  - session-level строка не удалена.
17. **D7 proof выполнять без изменения предыдущего исторического документа.** В новом результате доказать:
  - PDF идентичен по содержанию;
  - `meta.tokens_snapshot[]` содержит все три provider;
  - точные modifiers сохранены;
  - `template_tokens_snapshot` заполнен;
  - старый документ остался неизменным.
18. **Статус** `token_manifest_snapshot` **зафиксировать честно.** Если он остаётся пустым для package-mode by design, не считать его частью закрываемого package snapshot DoD. В proof явно указать:
19. **После патча повторить semantic 422 regression.** Транспортный контракт фиксировать фактически:
  &nbsp;
  ```text
  HTTP 200 envelope
  batch.status = failed
  details.code = pf_required_value_missing
  generated documents = 0
  ```
  Не называть это прямым HTTP 422.

Остальной scope сохраняется: snapshot propagation и reset override выполняются сейчас; atomic save, concurrent upsert, расширенный multi-tenant proof и редизайн остаются следующим этапом.

&nbsp;

План v4 (узкий): закрыть D7-snapshot и reset per-item override. Редизайн откладывается до полного закрытия backend-контрактов.

---

## Диагностика snapshot-gap (root cause)

Источник пустоты `snapshot.fields`, `template_tokens_snapshot`, `token_manifest_snapshot` — НЕ потеря данных, а **architectural mismatch**:

- `canonical-document-generate-strict/index.ts` строки 1658–1661 пишут snapshot ТОЛЬКО для billing-стека `{{field:FLD-XXXXXX}}`:
  - `snapshot.fields = docFields` — bag, ключи = FLD-XXXXXX (billing).
  - `template_tokens_snapshot = allIds.map(f => 'field:' + f)` — только billing FLD.
  - `token_manifest_snapshot = manifest` — берётся из `document_template_versions.token_manifest`, который для пакетных шаблонов пуст.
- Package-режим использует другие парсеры: `parsedPackageTokens` (`package.ul/ip/fl.FLD-*` и `ln-*`) и `parsedPfTokens` (`pf-*`). Их разрешённые значения попадают в `resolved` map (рендер DOCX) и `sourceTrace`, но в snapshot-блок строк 1658–1661 НЕ копируются.
- Существующий add-only `meta.tokens_snapshot` (строки 1689–1710, PATCH-PACKAGE-CUSTOM-FIELDS-V1 B4) фиксирует только `pf-*`. `ln-*` и `package.*` нигде не сохраняются.

Подтверждение по `ba5e7b44-…`: `meta.tokens_snapshot` содержит 7 pf-токенов (raw+rendered+label+data_type), но НЕТ ln-*, НЕТ package.*; верхнеуровневые snapshot-поля пусты.

Решение: расширить существующий `meta.tokens_snapshot` (тот же ключ, тот же канонический add-only контракт) на providers `pf | ln | package` и заполнить `template_tokens_snapshot` для package-mode. **Не создаём параллельный контракт, не трогаем billing-поведение.**

---

## Scope изменений (только этот патч)

### A. Snapshot propagation — `supabase/functions/canonical-document-generate-strict/index.ts`

A

1. Внутри блока `meta.tokens_snapshot` (≈1690) добавить итерацию `parsedPackageTokens`:

- Для `kind='package'`: `{ provider:'package', token: raw_inside, bag_key, raw_value: entry.value, rendered_value: resolved[raw_inside], source: entry.source, case_applied, format_applied }`.
- Для `kind='ln'`: `{ provider:'ln', token, bag_key, persons: entry.persons, positions: entry.positions, rendered_value: resolved[raw_inside], format_applied, case_applied }`.
- pf-блок остаётся как есть.
- К каждой записи добавить `item_context: { package_session_id, package_template_item_id }` для исторической воспроизводимости.

A

2. В `template_tokens_snapshot` (≈1661) в package-mode дописать после `field:FLD-*` все распарсенные пакетные токены:

- `package.<ul|ip|fl>.FLD-XXXXXX` (из `parsedPackageTokens.bag_key` при `kind='package'`);
- `ln-XXXXXX` (при `kind='ln'`);
- `pf-XXXXXX` (из `parsedPfTokens`).
Дедуп по строке. Billing-режим не меняется.

A

3. `snapshot.fields` оставляем billing-only. Добавить inline-комментарий: «package/ln/pf canonical snapshot lives in `meta.tokens_snapshot`; this bag is reserved for billing `{{field:FLD-*}}`».

A

4. `token_manifest_snapshot` оставляем billing-only (manifest = required-FLD контракт для billing). Комментарий: «pf-required-gate enforced upstream в orchestrator; manifest пустой для package-mode by design».

Никаких изменений в Gotenberg, storage, файлах, allocate_document_number, immutability trigger, resolver_version.

### B. Reset per-item override

B

1. Migration: RPC `delete_session_field_value(_session_id uuid, _field_catalog_id uuid, _package_template_item_id uuid)`:

- SECURITY DEFINER, SET search_path=public.
- Guard: `_package_template_item_id IS NOT NULL` (через эту RPC нельзя удалить session-level — для этого есть upsert с `value:null`).
- Authorization: проверка, что session принадлежит вызывающему профилю (либо admin/super_admin через `has_role_v2`).
- DELETE FROM `document_package_session_field_values` WHERE `session_id=_session_id AND field_catalog_id=_field_catalog_id AND package_template_item_id=_package_template_item_id`.
- Возвращает `jsonb { deleted: int }`.

B

2. `src/hooks/usePackageSessionFields.ts`: добавить `resetOverride({field_catalog_id, package_template_item_id})` → вызов RPC → инвалидация `QK.values` + `pkg-gen-role-assignments` + `doc-pkg-session-q`.

B

3. UI: в существующем per-item рендере поля показать кнопку «Сбросить к общему» рядом со значением, когда `valuesByItemField.get(itemId)?.get(fieldId)` существует. При клике — `resetOverride`. После успеха `getEffectiveValue` автоматически вернёт session-level (visual transition без перезагрузки). Toast «Возвращено к общему значению». Никаких новых компонентов — кнопка в текущем `PackageFieldsClientForm`.

---

## DoD (узкий)

D7-snapshot proof (та же сессия `6a61a7e3-…`, тот же шаблон):

- Повторная генерация → `meta.tokens_snapshot[]` содержит:
  - 7 × `provider='pf'` (как сейчас);
  - ≥1 × `provider='ln'` с `persons` + `rendered_value` + `item_context`;
  - ≥3 × `provider='package'` (org name, address, head FIO) с `raw_value`+`rendered_value`+`item_context`.
- `template_tokens_snapshot` содержит все pf/ln/package токены шаблона (дедуплицировано).
- Старая запись (`ba5e7b44-…`) удаляется до повторного запуска, чтобы не было idempotency-конфликта.
- PDF рендерится идентично (без визуальных изменений).

Reset override proof:

- 1. Установить per-item override для `pf-000005` на `item_id=a1a40df2-…` со значением `2026-08-15`.
- 2. Подтвердить в `document_package_session_field_values` row с непустым `package_template_item_id`.
- 3. Вызвать `delete_session_field_value(...)`.
- 4. Row исчез; UI показывает session-level `2026-07-01` без перезагрузки.
- 5. Попытка `delete_session_field_value` с `package_template_item_id=NULL` → ошибка `cannot_delete_session_level_via_reset`.

D7-422 — без регрессии (повтор предыдущего теста).

Out-of-scope: atomic save, concurrent upsert, multi-tenant, редизайн карточек, новые snapshot-bag'и, замена `snapshot.fields`/`token_manifest_snapshot` контрактов.

---

## Не делаю в этом патче (зафиксировано явно)

- НЕ создаю параллельный snapshot-bag.
- НЕ меняю billing FLD-resolver.
- НЕ трогаю Gotenberg/storage/numbering/immutability.
- НЕ удаляю существующие snapshot-поля.
- НЕ редизайню карточки.

После approval — патчу edge function + миграцию RPC + hook + одну UI-кнопку, прогоняю D7-snapshot proof в этой же сессии, отчитываюсь конкретными JSON-выписками из БД.