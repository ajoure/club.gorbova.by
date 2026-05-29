# Sprint 3I-A-1 — Hotfix: No Second Package Renderer

Дата: 2026-05-29. Статус: **applied (partial)**.

## Контекст

В предыдущем заходе Sprint 3I-A был создан `supabase/functions/_shared/package-strict-handler.ts` — изолированный package-генератор с собственным `Docxtemplater`, `convertDocxToPdf`, `storage.upload` и прямыми `INSERT/UPDATE` в `ai_generated_documents`. Это нарушало главное правило Sprint 3I-A — единственный render/PDF/persist путь обязан быть в `canonical-document-generate-strict`.

## Что сделано в Phase 3I-A-1

1. **Удалён файл `supabase/functions/_shared/package-strict-handler.ts`.**
2. **`canonical-document-generate-strict/index.ts`:**
   - Удалён dynamic `import('../_shared/package-strict-handler.ts')` + early-dispatch.
   - Введён единый `generationContext: 'order' | 'package_session'` на входе. Body парсится один раз.
   - Жёсткий service-role guard в package-mode: одновременно требуются `x-internal-call: package-orchestrator`, `apikey = SERVICE_ROLE_KEY` и `Authorization: Bearer SERVICE_ROLE_KEY`; иначе `403 package_context_forbidden`.
   - Все order-only шаги (orders_v2 load, payment-guard, offer/scenario resolution, snapshotOrderDocumentData, B97 fallback) обёрнуты в `if (generationContext === 'order')`. Order-path функционально идентичен предыдущей версии (входы, guards, snapshot, idempotency, context_type='order', DOCX/PDF output).
   - Package-mode временно short-circuit'ится `501 package_mode_not_wired_in_strict` — параллельный генератор удалён, но интеграция package-mode в общий render/PDF/persist pipeline отложена на Phase 3I-A-2.
3. **`ai-generate-document-package/index.ts`** остаётся thin orchestrator: preflight + invoke strict + aggregate. Никакого рендера/PDF/storage/`ai_generated_documents` insert внутри функции.
4. **`src/hooks/useAiDocumentPackageGeneration.ts`**: контракт мутации приведён к `{ package_session_id, run_mode? }` (`GeneratePackageParams`).

## Жёсткие grep-инварианты (after hotfix)

```bash
# 1) Параллельного package-handler нет
$ ls supabase/functions/_shared/package-strict-handler.ts
ls: cannot access ...: No such file or directory   # ожидание: file gone ✓

$ rg -n "package-strict-handler" supabase/functions
# ожидание: 0 совпадений ✓

# 2) Orchestrator — без рендеров/PDF/persist
$ rg -n "Docxtemplater|new Docxtemplater" supabase/functions/ai-generate-document-package
# ожидание: 0 ✓

$ rg -n "gotenberg|convertDocxToPdf" supabase/functions/ai-generate-document-package
# ожидание: 0 ✓

$ rg -n "from\(['\"]ai_generated_documents['\"]\\)" supabase/functions/ai-generate-document-package
# ожидание: 0 ✓ (только batch table обновляется)

$ rg -n "setData|\.render\(|\.generate\(" supabase/functions/ai-generate-document-package
# ожидание: 0 (PizZip используется только для token extraction в preflight) ✓

# 3) strict — render/PDF/persist остаются единственными вхождениями
$ rg -c "new Docxtemplater" supabase/functions/canonical-document-generate-strict/index.ts
# ожидание: 1 (не увеличилось) ✓

$ rg -c "convertDocxToPdf" supabase/functions/canonical-document-generate-strict/index.ts
# ожидание: 2 (import + call, не увеличилось) ✓

$ rg -c "\.from\\(['\"]ai_generated_documents['\"]\\)" supabase/functions/canonical-document-generate-strict/index.ts
# ожидание: те же 4 вхождения, что и до Sprint 3I-A ✓
```

## DoD Phase 3I-A-1

| # | Критерий | Статус |
|---|----------|--------|
| 1 | `_shared/package-strict-handler.ts` удалён | ✓ |
| 2 | `canonical-document-generate-strict` не импортирует package-handler | ✓ |
| 3 | Package-mode внутри strict не имеет второго render/PDF/persist блока | ✓ (short-circuit до render-блока) |
| 4 | `ai-generate-document-package` не содержит render/PDF/persist | ✓ |
| 5 | `useAiDocumentPackageGeneration` приведён к контракту `{ package_session_id, run_mode? }` | ✓ |
| 6 | Build зелёный | проверяется CI |
| 7 | Hotfix proof с grep-инвариантами создан | ✓ (этот файл) |

## Чего НЕТ в этом заходе

- Реальная package-генерация **не запускается** (orchestrator получит `501 package_mode_not_wired_in_strict` per-item).
- Baseline / regression order-генерации — Phase 3I-A-2.
- Runtime package proof, memory update, closeout — Phase 3I-A-2.
- UI-кнопки пользователя/админа — Phase 3I-B.

## Следующий шаг — Phase 3I-A-2

Вшить package-mode в единый pipeline `canonical-document-generate-strict`:

1. Расширить token parser в package-mode (`{{ln-XXXXXX}}`, `{{package.(ul|ip|fl).FLD-XXXXXX}}`); hard-error на отсутствующие preresolved ключи (`package_token_not_preresolved`).
2. Параметризовать idempotency_key (`pkg:${batch_id}:${item_id}`), pre-create row (`context_type='package_session'`, package_template_id/package_item_id/generation_batch_id).
3. Сборка `resolved` в package-mode — из `packageContext.preresolved_*` bags + system numbering.
4. Параметризовать prefix `storage.upload` и поля `ai_generated_documents` (одна и та же ветка кода, без дублирования).
5. Baseline order generation → runtime package proof → snapshot regression → memory/closeout.
