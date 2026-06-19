# PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 — Stage B (recipient context resolver) — PROOF

## Изменённые файлы

- `supabase/functions/_shared/resolve-per-role-recipients.ts` — новый pure shared resolver, без side-effects.
- `supabase/functions/_shared/resolve-per-role-recipients.smoke.test.ts` — Deno smoke (10 кейсов) на in-memory fake supabase-клиенте, БД не модифицируется.
- `.lovable/proofs/package_repeatable_documents_resolver_v1.md` — этот файл.
- `.lovable/plan.md` — обновлён утверждённым планом Stage B.

## Контракт

```
resolvePerRoleRecipients(supabase, { session_id, item_id })
  -> {
    mode: 'single' | 'per_role_person' | 'unknown',
    status: 'ok' | 'single_mode' | 'role_not_configured'
          | 'role_inactive' | 'role_package_mismatch'
          | 'no_active_assignments' | 'session_not_found'
          | 'item_not_found' | 'item_outside_session_package'
          | 'resolver_error',
    session_id, item_id,
    package_template_id, repeat_role_catalog_id,
    recipients: Array<{
      assignment_id, role_catalog_id, role_key, role_label,
      person_id, sort_order,
      recipient: { full_name, short_name, email, phone, address, position }
    }>,
    reasons: string[]
  }
```

Правила:
- Источник назначений — только `document_package_item_role_assignments` (item-scope). `document_package_session_participants` не читается.
- Фильтр: `package_session_id=? AND package_template_item_id=? AND role_catalog_id=item.repeat_role_catalog_id AND is_active=true`.
- Non-person строки (`person_id IS NULL`) выкидываются → `reasons += 'non_person_assignment_skipped:<assignment_id>'`. Если после фильтра 0 человек → `no_active_assignments`.
- Сортировка: `sort_order NULLS LAST, person_id, id` (детерминированно).
- Дедуп по `person_id`: первая запись по сортировке попадает в recipients, остальные → `reasons += 'duplicate_person_skipped:<person_id>:assignment:<id>'`.
- Контракт «никаких throw»: при технической ошибке Supabase-запроса возвращается `status='resolver_error'` с конкретной причиной в `reasons[]` — Stage C не сможет спутать сбой с пустым списком.
- Session ↔ item: если `document_package_sessions.package_template_id != item.package_template_id` → `item_outside_session_package`.
- Активность роли проверяется по фактической колонке `document_package_role_catalog.is_active` (подтверждено через `information_schema`).
- `recipient.position` берётся из `assignment.metadata.position`, `address` собирается из `legal_details_persons.address_structured`, `short_name` — «Фамилия И.О.».

## Тесты (Deno, in-memory fake клиент)

```
running 10 tests from ./_shared/resolve-per-role-recipients.smoke.test.ts
S1 single mode → status=single_mode, recipients=[] ... ok
S2 per_role_person → ok + deterministic order + recipient context ... ok
S3 per_role_person + zero active assignments → no_active_assignments ... ok
S4 role from another package → role_package_mismatch ... ok
S5 session ↔ item mismatch → item_outside_session_package ... ok
S6 role_not_configured when repeat_role_catalog_id is NULL but mode=per_role_person ... ok
S7 inactive role → role_inactive ... ok
S8 duplicate person across assignments → deterministic dedup + reason ... ok
S9 non-person assignment (person_id=null) → skipped + reason ... ok
S10 session_not_found / item_not_found ... ok

ok | 10 passed | 0 failed
```

БД не модифицировалась — все сценарии собраны через in-memory фикстуры, скопированные с реальной сессии «Годовое собрание» (`6a61a7e3-…`, items `f9962f6b` Приказ = single, `febd1821` Извещение = per_role_person + uchastnik, 3 активных назначения).

## Пример результата (S2, фактический JSON формы)

```json
{
  "mode": "per_role_person",
  "status": "ok",
  "session_id": "6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53",
  "item_id": "febd1821-fba8-4290-babf-99c59c27f2f4",
  "package_template_id": "21764469-aaaa-bbbb-cccc-000000000001",
  "repeat_role_catalog_id": "c8fc4200-75c0-4c24-8eea-112c4e468aeb",
  "recipients": [
    {
      "assignment_id": "77540e62-b6b2-45ae-85c6-aff796a61680",
      "role_catalog_id": "c8fc4200-75c0-4c24-8eea-112c4e468aeb",
      "role_key": "uchastnik",
      "role_label": "Участник",
      "person_id": "9f6a564a-935d-4f03-a42b-04dd5366137b",
      "sort_order": 10,
      "recipient": {
        "full_name": "Петров Петр Петрович",
        "short_name": "Петров П.П.",
        "email": null,
        "phone": null,
        "address": "Минск, Ленина 1",
        "position": "директор"
      }
    },
    {
      "assignment_id": "0c458f06-cc15-4f8f-a095-bfadedff660b",
      "role_catalog_id": "c8fc4200-75c0-4c24-8eea-112c4e468aeb",
      "role_key": "uchastnik",
      "role_label": "Участник",
      "person_id": "77aa175a-a085-44b9-9d52-73e264b8f478",
      "sort_order": 20,
      "recipient": {
        "full_name": "Иванов Петр",
        "short_name": "Иванов П.",
        "email": null,
        "phone": null,
        "address": null,
        "position": null
      }
    },
    {
      "assignment_id": "44d5ce98-785c-4b9b-b454-4581a99441f7",
      "role_catalog_id": "c8fc4200-75c0-4c24-8eea-112c4e468aeb",
      "role_key": "uchastnik",
      "role_label": "Участник",
      "person_id": "26402449-4eb1-4b87-a004-8f5cbbc2ff65",
      "sort_order": 30,
      "recipient": {
        "full_name": "Федорчук Сергей Валерьвич",
        "short_name": "Федорчук С.В.",
        "email": "7500084@gmail.com",
        "phone": "+48571447124",
        "address": null,
        "position": null
      }
    }
  ],
  "reasons": []
}
```

## Изоляция от генератора

```
$ rg -l "resolve-per-role-recipients|resolvePerRoleRecipients" src supabase
supabase/functions/_shared/resolve-per-role-recipients.smoke.test.ts
supabase/functions/_shared/resolve-per-role-recipients.ts
```

Резолвер не импортируется ни в `ai-generate-document-package`, ни в `canonical-document-generate-strict`, ни в UI. Подключение — Stage C.

## DoD

- [x] Pure shared резолвер, чистая функция, без побочных эффектов (нет INSERT/UPDATE/DELETE/audit/функций генерации).
- [x] Smoke-тест покрывает 10 сценариев (S1–S10), все PASS.
- [x] Резолвер не подключён ни в одном генераторе/UI — `rg` показывает только сам файл и его тест.
- [x] `single`-флоу пакета «Годовое собрание» не затронут — код генератора не менялся.
- [x] Никаких новых RPC / таблиц / enum / cron / edge functions / миграций.
- [x] Контракт «no-throw»: технические ошибки возвращаются как `resolver_error` + reasons, чтобы Stage C не перепутал сбой с пустым списком.
- [x] Session ↔ item связка валидируется (`item_outside_session_package`).
- [x] Активность роли проверяется по реальной колонке `is_active`.
- [x] Non-person и duplicate-person сценарии явно покрыты reasons-кодами.

## Дальше (вне scope Stage B)

- **Stage C** — подключить резолвер в `ai-generate-document-package`: при `per_role_person` итерация по `recipients`, ключ идемпотентности `(session_id, item_id, assignment_id)` в `ai_generated_documents.meta`, recipient-контекст в snapshot, no-op при `recipients=[]` / `single_mode`.
- **Stage D** — ретро-синхронизация при изменениях desired-state ассайнментов (помечать устаревшие сгенерированные документы, без авто-удаления).
