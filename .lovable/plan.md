да, согласен, с учетом правок:

1. **Не переопределять** `ln-*` **как основной способ recipient-подстановки.**  
В плане написано, что для repeat-роли нужно переопределять `preresolved_ln_tokens[repeat_role_public_id]` на текущего recipient. Это допустимо только как совместимость, но основной контракт Stage C должен быть через новый namespace:
  &nbsp;
  ```text
  {{recipient.full_name}}
  {{recipient.email}}
  {{recipient.phone}}
  {{recipient.address}}
  {{recipient.position}}
  ```
  Иначе `ln-*` потеряет исходный смысл «роль в документе» и станет зависеть от режима генерации. Правильно:
  - `recipient.*` — текущий получатель экземпляра;
  - `ln-*` — роли документа как раньше;
  - опционально: для repeat-роли можно добавить compatibility override `ln-*`, но только если это не ломает существующие шаблоны.
2. **В** `canonical-document-generate-strict` **нужно передать не только IDs recipient, но и сам recipient context.**  
Сейчас в strict предлагается добавить только:
  &nbsp;
  ```text
  repeat_assignment_id
  repeat_role_catalog_id
  recipient_person_id
  ```
  Этого недостаточно для рендера `{{recipient.full_name}}`. Нужно передавать:
3. **Strict должен уметь резолвить** `recipient.*` **токены.**  
Если strict остаётся «глупым исполнителем», он всё равно должен знать, как заменить уже переданный `recipient` context в DOCX. Минимальная правка:
  &nbsp;
  ```text
  token starts with recipient.
  → взять значение из packageContext.recipient
  → записать в tokens_snapshot
  ```
  Без этого Stage C создаст N файлов, но recipient-плейсхолдеры останутся сырыми.
4. **Добавить валидацию неизвестных recipient-токенов.**  
Если в шаблоне есть:
  &nbsp;
  ```text
  {{recipient.foo}}
  ```
  а такого поля нет, шаблон/генерация не должны молча подставлять пустоту. Нужна понятная ошибка:
  ```text
  unknown_recipient_field
  ```
  Для Stage C достаточно runtime guard в strict; полноценную template validation можно вынести, но сырые токены оставлять нельзя.
5. **Не менять поведение** `ln-*` **для других ролей.**  
Если выбран repeat по роли «Участник», то:
  - `recipient.*` меняется на каждого участника;
  - `ln-участник` можно переопределить только при явном решении compatibility mode;
  - все остальные `ln-*` должны работать как сейчас.
6. **Если repeat-role не используется в шаблоне через** `ln-*`**, это не ошибка.**  
Это правильно указано в плане. Но при наличии `recipient.*` токенов именно они должны рендериться. Если нет ни `recipient.*`, ни `ln-*` по этой роли, документ всё равно генерируется N раз, но в proof добавить warning:
7. **Idempotency key должен учитывать batch policy.**  
План предлагает:
  &nbsp;
  ```text
  pkg:{batch_id}:{item_id}:assn:{assignment_id}
  ```
  Это ок, если `batch_id` один и тот же при повторном запуске retry этого же batch. Но если пользователь запускает новую генерацию пакета, новый batch должен создавать новый набор документов. В proof явно проверить:
  - retry same batch → дублей нет;
  - new batch → создаётся новый набор.
8. `total_items` **и** `total_documents` **должны быть разведены в audit/meta.**  
Зафиксировать в `document.package_generation_completed.meta`:
  &nbsp;
  ```json
  {
    "total_items": 3,
    "total_documents": 5,
    "generated": 5,
    "errors": 0,
    "blocked": 0
  }
  ```
  Не переиспользовать старое поле `total`, если оно уже означало количество items, без явного mapping.
9. `results[]` **для blocked/error per_role item должен быть предсказуемым.**  
Если `per_role_person` заблокирован из-за отсутствия получателей, в `results[]` должна быть одна запись по item:
  &nbsp;
  ```json
  {
    "item_id": "...",
    "generation_mode": "per_role_person",
    "status": "blocked",
    "errors": ["per_role_no_active_recipients"]
  }
  ```
  Не создавать фиктивный recipient.
10. **Snapshot для per-recipient документа обязателен.**  
В `ai_generated_documents.meta` добавить:

```json
{
  "generation_mode": "per_role_person",
  "source_package_template_item_id": "...",
  "repeat_role_catalog_id": "...",
  "repeat_assignment_id": "...",
  "recipient_person_id": "...",
  "recipient_display_name": "...",
  "recipient_index": 1
}
```

И в `tokens_snapshot[]` должны быть `recipient.*` токены с `provider='recipient'`.

11. **Проверить порядок output-файлов.**  
В proof показать порядок:

```text
item 1 single
item 2 recipient 1
item 2 recipient 2
item 3 single
```

То есть порядок item сохраняется, а repeat-документы раскрываются внутри позиции item.

12. **Проверить отсутствие смешения данных.**  
В runtime proof обязательно:

- документ Иванова содержит Иванова;
- документ Иванова не содержит Петрова;
- документ Петрова содержит Петрова;
- документ Петрова не содержит Иванова.

13. **Не считать Stage C завершённым без реального DOCX с** `recipient.*`**.**  
Нужен тестовый шаблон, где есть минимум:

```text
{{recipient.full_name}}
{{recipient.email}}
{{recipient.position}}
```

Иначе будет доказано только размножение файлов, но не recipient resolver.

14. **Single zero-diff проверить на фактическом существующем пакете.**  
Для item с `generation_mode='single'` убедиться:

- idempotency key прежний;
- meta без recipient;
- количество документов прежнее;
- `ln-*`, `pf-*`, `package.*` работают как раньше.

15. **После Stage C не делать retro-sync автоматически.**  
Это верно указано. Если изменились назначения ролей после генерации, старые generated documents пока не трогать. Stage D отдельно решит archive/regenerate policy.
16. **Deployment обязателен.**  
Так как меняются edge functions, в proof добавить:

```text
deployed ai-generate-document-package
deployed canonical-document-generate-strict
deploy timestamp
```

17. **DoD дополнить:**

```text
recipient.* tokens rendered: PASS
unknown recipient token guarded: PASS
same batch idempotency: PASS
new batch creates new generated set: PASS
single zero-diff: PASS
per-role N docs: PASS
no cross-recipient contamination: PASS
meta recipient fields: PASS
tokens_snapshot provider=recipient: PASS
```

&nbsp;

&nbsp;

План: Stage C — подключение `resolvePerRoleRecipients` в `ai-generate-document-package`

## Цель

Для items пакета с `generation_mode='per_role_person'` генератор создаёт **по одному документу на каждого активного recipient** из `document_package_item_role_assignments` для `repeat_role_catalog_id`. Items с `generation_mode='single'` ведут себя ровно как сейчас (zero-diff). Никаких изменений в Stage A/B/0.x.

## Контракт


| Аспект                                           | Single (как сейчас)               | Per-role-person (Stage C)                                                                                          |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Кол-во документов на item                        | 1                                 | N = число активных персональных assignments по `repeat_role_catalog_id`                                            |
| Идемпотентность                                  | `pkg:{batch_id}:{item_id}`        | `pkg:{batch_id}:{item_id}:assn:{assignment_id}`                                                                    |
| `preresolved_ln_tokens[<repeat_role_public_id>]` | как сейчас (все assignments роли) | **переопределяется**: persons=[recipient.full_name], positions=[recipient.position], person_id=recipient.person_id |
| Остальные `ln-*` токены                          | как сейчас                        | как сейчас (другие роли — все участники роли)                                                                      |
| `ai_generated_documents.meta`                    | без recipient                     | добавляются `repeat_role_catalog_id`, `repeat_assignment_id`, `recipient_person_id`                                |
| `recipient` в `results[]`                        | отсутствует                       | `{ assignment_id, person_id, role_catalog_id }`                                                                    |


## Изменения

### 1. `supabase/functions/ai-generate-document-package/index.ts`

- SELECT items дополнить полями `generation_mode, repeat_role_catalog_id`.
- После сбора `preresolved_*` для item (без изменений в самой сборке):
  - если `generation_mode !== 'per_role_person'` → один вызов strict как сейчас;
  - иначе:
    1. Импортировать и вызвать `resolvePerRoleRecipients({ supabase, sessionId, itemId })`.
    2. Маппинг status → результат:
      - `ok` → итерация по recipients;
      - `no_active_assignments` → `blocked`, `errors:['per_role_no_active_recipients']`, 1 запись в `results`;
      - `role_not_configured | role_inactive | role_package_mismatch | item_outside_session_package | session_not_found | item_not_found` → `error`, `errors:[<status>]`;
      - `resolver_error` → `error`, `errors:['per_role_resolver_error', ...reasons]`;
      - `single_mode` → дефенсивно: fallback на single-путь (по идее не случится, т.к. ветка только при per_role_person).
    3. Для каждого recipient:
      - Найти роль `repeat_role_catalog_id` в `roleByPublicId`/`roleRows`, получить её `public_id` (ln-токен).
      - Создать `perRecipientLn` = клон `preresolved_ln_tokens` и переопределить запись по `lnPublicId`:
        ```
        { value: recipient.recipient.full_name,
          persons: [recipient.recipient.full_name],
          positions: [recipient.recipient.position ?? ''],
          position_genders: [null],
          role_catalog_id, person_id: recipient.person_id }
        ```
        Если эта роль вообще не упоминалась в шаблоне (нет `lnPublicId` в bag) — это **не ошибка**: документ всё равно рендерится N раз (бизнес-сценарий: индивидуальные приложения), но в strict уходит дополнительный recipient hint (см. ниже).
      - Передать в strict `packageContext` с новыми полями:
        - `repeat_assignment_id: recipient.assignment_id`
        - `repeat_role_catalog_id`
        - `recipient_person_id: recipient.person_id`
        - `preresolved_ln_tokens: perRecipientLn`
      - Инкремент `generated/errors` per recipient.
    4. В `results[]` для per_role_person item — N записей, каждая с `recipient: { assignment_id, person_id, role_catalog_id, sort_order }`.
- `total_items` в batch.meta оставить = `items.length` (число шаблонных позиций), добавить `total_documents = generated + errors + blocked` для прозрачности.

### 2. `supabase/functions/canonical-document-generate-strict/index.ts`

Минимальная поверхностная правка, без изменения логики токенов:

- Расширить `PackageCtx` опциональными `repeat_assignment_id?`, `repeat_role_catalog_id?`, `recipient_person_id?`.
- В вычислении `idempotencyKey` при `generation_context==='package_session'`:
  - если `repeat_assignment_id` задан → `pkg:{batch}:{item}:assn:{assignment_id}`;
  - иначе → текущий `pkg:{batch}:{item}` (zero-diff для single).
- В `packageMetaExtras` и `auditContext` добавить эти три поля, **только если присутствуют**. Это попадёт в `ai_generated_documents.meta` и `audit_logs.meta`, не меняя single-сценарий.
- Никаких новых ошибок/гардов: strict остаётся «глупым» исполнителем; политику выбора recipient определяет оркестратор.

### 3. Без изменений

- `resolve-per-role-recipients.ts` (готов, Stage B, PASS).
- UI пакетов, smart-date prefill (Stage 0.3), schema/триггер `dpti_assert_repeat_role_consistency` (Stage A).
- `document_package_item_role_assignments`, `save_session_document_atomic` (Stage 5).
- `document_package_session_participants` — не читаем (Stage B SoT).
- Retro-sync для уже сгенерированных пакетов — это **Stage D**, не сюда.

## DoD

- Stage C generator per-role iteration: PASS
- Single item zero-diff (идемпотентный ключ, meta, audit, кол-во документов): PASS
- Per-role item: N документов = N активных assignments, порядок = sort_order resolver: PASS
- Idempotency: повторный запуск того же batch не создаёт дубликатов (по `pkg:{batch}:{item}:assn:{aid}`): PASS
- `ai_generated_documents.meta.repeat_assignment_id / recipient_person_id / repeat_role_catalog_id` присутствуют для per-role и **отсутствуют** для single: PASS
- Resolver-статусы корректно маппятся в `results[].status` без throw: PASS
- `audit_logs.document.package_generation_completed.meta` содержит `generated/errors/blocked` по документам, `total` — по items: PASS
- Strict вне package_session-режима не затронут (regression-проверка single order generation): PASS
- Proof: `.lovable/proofs/package_repeatable_documents_generator_v1.md` с реальным runtime прогоном (single+per_role в одном пакете).

## Out of scope (отдельные stage)

- Stage D: retro-применение к ранее сгенерированным пакетам и UI-вывод per-recipient документов в карточке пакета.
- Любые изменения по smart-date / readiness / Stage 0.x.
- Изменение SoT назначений или resolver-контракта.