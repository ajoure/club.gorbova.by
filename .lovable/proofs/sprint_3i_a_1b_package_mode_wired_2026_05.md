# Sprint 3I-A-1.B — Package-mode wired into canonical strict pipeline

Дата: 2026-05-29. Статус: **completed (static)**. Runtime proof — Phase 3I-A-2.

## Что сделано

В `supabase/functions/canonical-document-generate-strict/index.ts` (без второго renderer/PDF/storage/persist):

1. **Удалён 501-gate** (`package_mode_not_wired_in_strict`). Package-mode идёт через ту же ветку Docxtemplater → Gotenberg → storage.upload → `ai_generated_documents`.
2. **Token parser расширен** (приоритеты в одном цикле):
   - `package.(role.PKR-…|roles.…)` → `legacy_placeholder_format_detected` (везде).
   - `package.(ul|ip|fl).FLD-XXXXXX[|case=…]` → в order-mode `package_token_outside_package_context`; в package-mode parsed.
   - `ln-XXXXXX[|case=…]` → аналогично.
   - `(document|executor|customer|deal|cf).…` → legacy (везде).
   - `field:FLD-XXXXXX[|format=…][|case=…]` → strict канон.
   - **Variant A** для модификаторов: `|case=` поддержан для package/ln; любой иной модификатор → `unknown_modifier`.
3. **No silent empty**:
   - `package_token_not_preresolved` если `package.*`/`ln-*` нет в соответствующем bag.
   - `package_field_not_preresolved` если `field:FLD-XXX` в package-mode не пришёл в `preresolved_fields` (системные FLD-000069/000070 исключены — заполняются `allocate_document_number`).
4. **Pre-fill `docFields`** из `packageContext.preresolved_fields` (ключи `FLD-XXXXXX` — нормализация уже совпадает с тем, что ожидает существующий резолвер).
5. **Package value resolution loop** добавлен после field-loop: значения берутся из `preresolved_package_fields` / `preresolved_ln_tokens`; `|case=` применяется через тот же `inflectRu`; пишется в общий `resolved[t.raw_inside]` → тот же Docxtemplater renderer.
6. **Idempotency**:
   - order-mode: `strict:${tpl.id}:${ver.id}:${order.id}` (или `body.idempotency_key`) — не изменено.
   - package-mode: `pkg:${generation_batch_id}:${package_template_item_id}`.
7. **Pre-create / final persist** (`ai_generated_documents`) — те же 2 точки (insert pre-create + final insert) + те же 2 lookup (existing-by-key + duplicate guard) + final update. Параметризованы:
   - `context_type`: `'order'` ↔ `'package_session'`
   - `context_id`: `order.id` ↔ `package_session_id`
   - `title`: `${tpl.name} — ${order_number|id8}` ↔ `title_override || tpl.name`
   - `meta`: добавлены `package_template_id / package_item_id / generation_batch_id / actor_type:'system' / source:'package_orchestrator'` только в package-mode.
8. **Storage prefix** параметризован одной переменной `pathPrefix` (`generated/{order.id}` ↔ `generated/package/{session_id}`); тот же `storage.from('documents').upload(...)` блок (2 upload — DOCX + PDF, без увеличения).
9. **Audit logs** (`document.pdf_converted` / `document.pdf_failed` / `document.generated`) — `actor_type='system'` и `auditContext` (`package_session_id/template_id/item_id/batch_id`) в package-mode.

В `supabase/functions/ai-generate-document-package/index.ts` — без изменений: остаётся thin orchestrator (preflight → invoke strict → batch update). Передаёт `template_id` внутри `packageContext`; strict его подхватывает (`templateId = packageContext.template_id`).

В `src/hooks/useAiDocumentPackageGeneration.ts` — без изменений (контракт `{ package_session_id, run_mode? }` уже соответствует).

## Grep-инварианты

```bash
$ rg -n "package-strict-handler" supabase/functions                      → 0
$ rg -n "package_mode_not_wired_in_strict" supabase/functions            → 0
$ rg -n "Docxtemplater|gotenberg|convertDocxToPdf" \
      supabase/functions/ai-generate-document-package                    → 0
$ rg -n "from\(['\"]ai_generated_documents['\"]\)" \
      supabase/functions/ai-generate-document-package                    → 0
$ rg -n "setData|\.render\(|\.generate\(" \
      supabase/functions/ai-generate-document-package                    → 0

$ rg -c "new Docxtemplater"  …/canonical-document-generate-strict/index.ts → 1
$ rg -c "convertDocxToPdf"   …                                              → 3  (import + call + comment)
$ rg -c "\.from\(['\"]ai_generated_documents['\"]\)" …                     → 5  (= hotfix baseline: dup-guard select, pre-create select, pre-create insert, final update, final insert)
$ rg -c "storage\.from\(['\"]documents['\"]\)\.upload" …                   → 2  (DOCX + PDF — без увеличения)
```

## DoD

| # | Критерий | Статус |
|---|----------|--------|
| 1 | `501 package_mode_not_wired_in_strict` удалён | ✓ |
| 2 | Package-mode → тот же Docxtemplater/Gotenberg/upload/persist | ✓ |
| 3 | Parser принимает `package.(ul\|ip\|fl).FLD-*` и `ln-*` только в package-mode | ✓ |
| 4 | Order-mode hard-error на `package.*` / `ln-*` (`package_token_outside_package_context`) | ✓ |
| 5 | `package_token_not_preresolved` + `package_field_not_preresolved` — no silent empty | ✓ |
| 6 | Idempotency `pkg:${batch}:${item}` | ✓ |
| 7 | Storage prefix `generated/package/{session_id}/...` | ✓ |
| 8 | `ai_generated_documents` write/lookup-точки не увеличились | ✓ |
| 9 | Orchestrator не содержит render/PDF/persist | ✓ |
| 10 | Build/typecheck | проверяется CI |
| 11 | Proof файл создан | ✓ (этот файл) |

## Чего НЕТ в этом заходе

- Никакой runtime генерации (order или package).
- Никакого UI (user button, admin test, package history).
- Никаких memory обновлений как completed.
- Sprint 3I-A не закрыт.

## Следующий шаг — Phase 3I-A-2

Baseline order generation → runtime package proof → snapshot regression → memory/closeout.

Финальный статус: **completed: package-mode wired into canonical strict pipeline; no second renderer; no second Gotenberg path; no second `ai_generated_documents` write path; ready for Phase 3I-A-2 runtime proof.**
