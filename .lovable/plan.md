да, согласен, с учетом правок:

1. **Stage B должен возвращать не только список** `person_id`**, но и готовый recipient context.**  
Иначе Stage C снова будет делать отдельный resolver и появится дубль логики. В `recipients[]` добавить:
  &nbsp;
  ```ts
  recipient: {
    full_name: string
    short_name: string | null
    email: string | null
    phone: string | null
    address: string | null
    position: string | null
  }
  ```
  `position` брать из `assignment.metadata.position`, если есть.
2. **Обязательно проверить связь session ↔ item.**  
Resolver должен подтвердить:
  &nbsp;
  ```text
  document_package_sessions.package_template_id
  =
  document_package_template_items.package_template_id
  ```
  Если item не относится к пакету сессии — вернуть статус:
  ```text
  item_outside_session_package
  ```
  Иначе service-client resolver может случайно прочитать assignments чужого item.
3. **Добавить статус для активных assignment без** `person_id`**.**  
Так как repeat v1 работает только по физлицам, строки с `legal_entity_id` или пустым `person_id` не должны попадать в recipients. Добавить reasons:
  &nbsp;
  ```text
  non_person_assignment_skipped:<assignment_id>
  ```
  Если после фильтрации физлиц нет:
4. **Smoke-тест через SQL** `DO-block` **не подходит для TS-resolver.**  
`resolvePerRoleRecipients` — TypeScript shared helper, его нельзя реально вызвать внутри SQL `DO`. Правильный proof:
  - Deno smoke-test;
  - временный setup через SQL transaction/fixtures;
  - вызов TS resolver;
  - cleanup/rollback после теста.
  В proof отдельно указать, что БД после теста восстановлена.
5. **S2 должен использовать реальный** `per_role_person` **item state.**  
Можно временно переключить item в `per_role_person` внутри теста и откатить, но сам resolver должен читать реальные колонки Stage A:
  &nbsp;
  ```text
  generation_mode
  repeat_role_catalog_id
  ```
  Не передавать role id напрямую в resolver.
6. **Дедуп по** `person_id` **должен быть детерминированным и видимым.**  
Если две активные строки на одного person:
  - первая по `sort_order NULLS LAST, person_id, assignment_id` попадает в recipients;
  - остальные идут в reasons;
  - в proof показать порядок.
7. **Сортировку уточнить:**
  &nbsp;
  ```sql
  ORDER BY sort_order NULLS LAST, person_id, id
  ```
  `id` нужен как финальный tie-breaker.
8. **Не использовать** `document_package_session_participants`**.**  
Это правильно в плане, но в DoD явно проверить через `rg`/код, что resolver читает только:
9. **Добавить тест на session/item mismatch.**  
Помимо S1–S4 нужен сценарий:
10. `role_inactive` **должен проверяться по фактической колонке.**  
Если в `document_package_role_catalog` есть `is_active`, использовать её. Если фактическое поле называется иначе или отсутствует — остановиться и зафиксировать discovery, не писать условную проверку.
11. **Ошибки Supabase-запросов не должны теряться.**  
Контракт «никаких throw» допустим, но тогда при database/query error вернуть структурный статус, например:

```text
resolver_error
```

с `reasons[]`, чтобы Stage C не трактовал технический сбой как `no_active_assignments`.

12. **В Stage B proof добавить пример результата.**  
Не только PASS/FAIL тестов, а фактический JSON:

```json
{
  "mode": "per_role_person",
  "status": "ok",
  "recipients": [
    {
      "assignment_id": "...",
      "person_id": "...",
      "role_label": "Участник",
      "recipient": {
        "full_name": "..."
      }
    }
  ]
}
```

После этих правок Stage B можно выполнять.

&nbsp;

План: PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 — Stage B (recipient context resolver)

## 1. Цель

Закрыть единственный read-only слой, который превращает item «1 шаблон» в детерминированный упорядоченный список получателей `N` для будущей генерации (Stage C). Никакой генерации, никаких side-effects, никакой записи. Один SoT-резолвер, который потом одинаково используют генератор, ретро-синхронизация и UI-превью.

## 2. Контракт резолвера

Файл: `supabase/functions/_shared/resolve-per-role-recipients.ts`

Сигнатура:

```ts
resolvePerRoleRecipients(
  supabase, // service client
  { session_id: uuid, item_id: uuid }
): Promise<PerRoleRecipientsResult>
```

`PerRoleRecipientsResult` (единая форма, никаких throw — всегда возвращает структуру):

```text
{
  mode: 'single' | 'per_role_person',
  item_id, package_template_id, session_id,
  repeat_role_catalog_id: uuid | null,
  recipients: Array<{
    assignment_id: uuid,            // document_package_item_role_assignments.id — ключ идемпотентности Stage C
    role_catalog_id: uuid,
    role_key: string, role_label: string,
    person_id: uuid,
    sort_order: number,             // (assignment.sort_order, person_id) — детерминированно
  }>,
  status: 'ok'
        | 'single_mode'                  // mode=single → recipients=[]
        | 'role_not_configured'          // per_role_person, но repeat_role_catalog_id=NULL (трг это запрещает, но защита для исторических данных)
        | 'role_inactive'                // роль архивирована после конфигурации item
        | 'role_package_mismatch'        // роль другого пакета (защита)
        | 'no_active_assignments'        // mode=per_role_person, активных назначений 0
        | 'session_not_found' | 'item_not_found'
  ,
  reasons: string[]                 // машинные коды для UI/логов
}
```

Правила:

- Источник назначений — только `document_package_item_role_assignments` (item-scope, Stage 5 SoT). `document_package_session_participants` НЕ используется (он session-level).
- Фильтр: `package_session_id=session_id AND package_template_item_id=item_id AND role_catalog_id=item.repeat_role_catalog_id AND is_active=true AND person_id IS NOT NULL`.
- Сортировка: `sort_order NULLS LAST, person_id` — стабильный порядок для идемпотентного ключа Stage C.
- Дедуп по `person_id` (если случайно две активных строки на одного — берётся первая по сортировке, остальные отдаются в `reasons` как `duplicate_person_skipped:<person_id>`).
- Никаких новых RPC. Резолвер делает 3 SELECT'а: item (для mode/repeat_role_catalog_id/package_template_id), role_catalog row (для активности/скоупа/label), assignments.

## 3. Что НЕ делается в Stage B

- Не вызывается из `ai-generate-document-package` и `canonical-document-generate-strict` (это Stage C).
- Не пишет в `ai_generated_documents`, `audit_logs`, `document_package_session_field_values`.
- Не меняет UI-генерации. В админке `TemplateBindingControl` ничего не трогаем.
- Не вводит новые таблицы/enum/cron/edge functions/RPC.
- Не валидирует field-readiness — это другой слой.

## 4. Тесты (smoke, read-only)

Файл: `supabase/functions/_shared/resolve-per-role-recipients.smoke.test.ts` (по образцу `resolve-package-tokens.smoke.test.ts`).

Сценарии на сессии «Годовое собрание» (`6a61a7e3-…`):

- S1 (`single`): item «1. Приказ…» → `status=single_mode, recipients=[]`.
- S2 (`per_role_person` + role=`uchastnik`): фиктивно через transactional DO-блок (BEGIN; UPDATE…; SELECT через резолвер; ROLLBACK;) — recipients = активные `uchastnik`-назначения, отсортированы детерминированно.
- S3 (`per_role_person`, ноль активных): `status=no_active_assignments`.
- S4: роль чужого пакета не должна попасть (триггер блокирует на UPDATE, дополнительно резолвер возвращает `role_package_mismatch` для исторических случаев).

Все сценарии read-only/rollback. В proof — `EXPLAIN`-free выводы запросов и итоговая структура.

## 5. Proof и DoD

Proof: `.lovable/proofs/package_repeatable_documents_resolver_v1.md`.

DoD:

- `resolve-per-role-recipients.ts` существует, чистая функция, без побочных эффектов.
- Smoke-тест покрывает 4 сценария S1–S4, все PASS.
- Резолвер не импортируется ни в одном генераторе/edge-функции в этом стейдже (`rg` показывает только тест-файл).
- `single`-флоу пакета «Годовое собрание» не затронут (генератор код не менялся).
- Список изменённых файлов в proof: shared resolver, smoke-test, proof, обновлённый `.lovable/plan.md`.

## 6. Дальше (вне scope)

- Stage C — подключение резолвера в `ai-generate-document-package`: при `per_role_person` итерация по `recipients`, ключ идемпотентности `(session_id, item_id, assignment_id)` в `ai_generated_documents.meta`, recipient-контекст в snapshot, no-op при `recipients=[]`.
- Stage D — ретро-синхронизация: при изменении desired-state ассайнментов помечать устаревшие сгенерированные документы (без авто-удаления).