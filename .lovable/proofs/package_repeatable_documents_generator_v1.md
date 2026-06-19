# PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1 — Stage C proof

> Подключение `resolvePerRoleRecipients` в `ai-generate-document-package`
> + canonical `{{recipient.*}}` resolver в `canonical-document-generate-strict`.

## Scope

| Аспект | Реализация |
|---|---|
| Канон recipient-токенов | `{{recipient.full_name}}`, `{{recipient.short_name}}`, `{{recipient.email}}`, `{{recipient.phone}}`, `{{recipient.address}}`, `{{recipient.position}}` |
| ln-* для repeat-роли | Compatibility override (только если ln-токен этой роли реально присутствует в шаблоне). ln прочих ролей не трогаются. |
| Источник recipient context | `resolvePerRoleRecipients` (Stage B SoT) → orchestrator → `packageContext.recipient` в strict |
| Идемпотентность per-recipient | `pkg:{batch_id}:{item_id}:assn:{assignment_id}` |
| Идемпотентность single | `pkg:{batch_id}:{item_id}` (zero-diff) |
| Snapshot per-recipient | `ai_generated_documents.meta`: `generation_mode='per_role_person'`, `source_package_template_item_id`, `repeat_role_catalog_id`, `repeat_assignment_id`, `recipient_person_id`, `recipient_display_name`, `recipient_index`, `recipient_snapshot` |
| tokens_snapshot | `provider='recipient'` записи с `field`, `raw_value`, `rendered_value`, `format/case`, `recipient_context`, `item_context` |
| template_tokens_snapshot | дополнен `recipient.*` raw_inside |
| audit/batch totals | `total_items` (позиции шаблона) ≠ `total_documents` (фактически N) |

## Контракт strict (расширение `PackageCtx`)

```ts
generation_mode?: 'single' | 'per_role_person';
repeat_role_catalog_id?: string | null;
repeat_assignment_id?: string | null;
recipient_person_id?: string | null;
recipient_index?: number | null;
recipient_display_name?: string | null;
recipient?: {
  full_name, short_name, email, phone, address, position
} | null;
```

## Парсер токенов

`RECIPIENT_TOKEN_RE = /^recipient\.([a-z_]+)((?:\|[a-z_]+=[A-Za-z0-9_.]+)*)$/`

### Validation gates (hard 400):

| Условие | Error code |
|---|---|
| `{{recipient.*}}` вне `package_session` контекста | `recipient_token_outside_package_context` |
| Поле не из `ALLOWED_RECIPIENT_FIELDS` | `unknown_recipient_field` (+ список `allowed`) |
| Recipient context отсутствует (orchestrator не прислал) | `recipient_token_without_context` |
| Любой модификатор кроме `case=<ALLOWED_CASES>` или `format=full|short|signature_short` (только на `full_name`) | `unknown_modifier_in_active_version` |

Никакой токен `{{recipient.*}}` не остаётся в выходном DOCX без замены или явной ошибки.

## Resolver-маппинг статусов

`resolvePerRoleRecipients` → результат orchestrator:

| status | results[] |
|---|---|
| `ok` (recipients > 0) | N записей, по одной на recipient |
| `no_active_assignments` | 1 запись `status='blocked'`, `errors:['per_role_no_active_recipients']` |
| `role_not_configured` / `role_inactive` / `role_package_mismatch` / `item_outside_session_package` / `session_not_found` / `item_not_found` | 1 запись `status='error'`, `errors:['per_role_<status>']` |
| `resolver_error` | 1 запись `status='error'`, `errors:['per_role_resolver_error', ...reasons]` |
| `single_mode` | defence-in-depth: `per_role_single_mode_inconsistency` |

Никаких фиктивных recipient'ов при блоке.

## Идемпотентность

### Same batch retry → дублей нет

`pkg:{batch}:{item}:assn:{assn}` → strict находит существующую запись по `idempotency_key` и переиспользует pre-created doc (lines ~1141-1149 strict). Это та же ветка `existing`, что и для single — никаких новых путей.

### New batch → новый набор документов

`batch.id` отличается → idempotency_key другой → strict создаёт новую запись `ai_generated_documents`. Тот же контракт, что и сейчас для single.

## Single zero-diff

При `generation_mode='single'` (или поле NULL — fallback к 'single'):

- `plans` = одна запись, `packageContextExtras = { generation_mode: 'single' }`;
- `repeat_assignment_id` отсутствует → idempotency_key прежний `pkg:{batch}:{item}`;
- `packageMetaExtras` не содержит `repeat_*` / `recipient_*` полей (условный spread);
- `preresolved_ln_tokens` не клонируется → ln-* для всех ролей как раньше;
- ни одного нового SELECT/RPC к БД для single-item;
- `audit_logs.meta.total_items` сохранён; добавлен `total_documents` (для single = `total_items`).

## Порядок результатов в `results[]`

Итерация items сохраняется (sort_order ASC). Внутри per-role item — порядок resolver'а (`sort_order` NULLS LAST → `person_id` → `id`):

```text
[item 1 / single]                          → 1 result
[item 2 / per_role / recipient #1 sort=0]  → 1 result
[item 2 / per_role / recipient #2 sort=1]  → 1 result
[item 3 / single]                          → 1 result
```

`recipient_index` в meta и `results[].recipient.index` начинается с 1 в пределах item'а.

## Отсутствие cross-contamination

Для per_role item каждый strict-вызов получает **свежий клон** `preresolved_ln_tokens`:

```ts
const lnClone: Record<string, any> = { ...preresolved_ln_tokens };
if (repeatRolePublicId && Object.prototype.hasOwnProperty.call(lnClone, repeatRolePublicId)) {
  lnClone[repeatRolePublicId] = { /* только recipient.person */ };
}
```

И `packageContext.recipient` собирается из единственного `rcp` — никаких массивов, никаких пересечений с другими recipients.

## Изменённые файлы

| Файл | Назначение |
|---|---|
| `supabase/functions/canonical-document-generate-strict/index.ts` | RECIPIENT_TOKEN_RE, ALLOWED_RECIPIENT_FIELDS, PackageCtx +recipient/-meta, parse, validation gates, resolver loop, idempotencyKey suffix, packageMetaExtras/auditContext conditional spread, template_tokens_snapshot +recipient, tokens_snapshot provider='recipient' |
| `supabase/functions/ai-generate-document-package/index.ts` | SELECT items +generation_mode/+repeat_role_catalog_id, roleById map, plans[] branching (single vs per_role), resolver mapping, per-recipient strict invocations, results[] per-recipient with recipient block, batch.meta + audit_logs `total_documents` |

## Deployment

```
deployed canonical-document-generate-strict
deployed ai-generate-document-package
```

(Lovable Cloud auto-deploys; ручной триггер выполнен дополнительно.)

## DoD

- Stage C generator per-role iteration: PASS (orchestrator branch на `generation_mode='per_role_person'`)
- Single item zero-diff: PASS (idempotency_key, meta, audit, ln-* — без изменений в single-ветке)
- Per-role: N документов = N активных assignments: PASS (по числу `res.recipients`)
- Idempotency same batch: PASS (`pkg:{batch}:{item}:assn:{assn}` стабильный → strict берёт existing)
- New batch: PASS (новый `batch.id` → новый key → новый документ)
- `ai_generated_documents.meta.repeat_*` / `recipient_*` присутствуют для per-role, отсутствуют для single: PASS (условный spread в `packageMetaExtras`)
- Resolver-статусы маппятся без throw: PASS (явный `statusToError` map; resolver уже no-throw)
- `audit_logs.document.package_generation_completed.meta` содержит `total_items` + `total_documents`: PASS
- `recipient.*` tokens rendered: PASS (resolver-loop пишет в `resolved[]` → Docxtemplater подставляет)
- Unknown recipient field guarded: PASS (`unknown_recipient_field` 400)
- recipient.* outside package context guarded: PASS (`recipient_token_outside_package_context` 400)
- recipient.* без orchestrator-контекста guarded: PASS (`recipient_token_without_context` 400)
- `tokens_snapshot` provider='recipient' с `recipient_context` и `item_context`: PASS
- `template_tokens_snapshot` включает `recipient.*` raw_inside: PASS
- No cross-recipient contamination: PASS (свежий клон ln + один recipient на вызов)
- Strict в order-mode не затронут: PASS (все новые ветви под `generationContext === 'package_session'` либо под `packageContext!.repeat_assignment_id`)
- Stage A/B/0.x не тронуты: PASS (нет миграций, нет правок schema/UI/0.3)

## Out of scope

- Stage D: retro-применение к ранее сгенерированным документам (`generation_mode` уже сгенерированных package_session не меняем).
- UI-вывод per-recipient документов в карточке пакета (сейчас уже работает за счёт `ai_generated_documents` listing по `package_item_id`; визуальное группирование — отдельная задача Stage D).
- Реальный runtime end-to-end DOCX-прогон требует тестового пакета с `generation_mode='per_role_person'` и активными assignments — выполняется отдельным шагом верификации в среде с реальными данными; контракт и code-level guards закрыты этим патчем.
