# да, согласен, с учетом правок:

&nbsp;

1. **UI-fix по exit dialog вынести отдельным PATCH внутри этого же плана, но не смешивать с proof-блоком Sprint 3.**
  Раздели явно на:
  &nbsp;
  - PATCH S3-UI-EXIT-DIALOG
  - PATCH S3-CLOSE-4
  &nbsp;
  Чтобы не смешались визуальная правка и закрывающий proof-пакет.
2. **В Stage 1 не писать “line-by-line identical” как утверждение без факта.**
  Нужно требовать именно доказуемый output:
  &nbsp;
  - сценарий,
  - frontend manifest snapshot,
  - server manifest snapshot,
  - diff result,
  - итог match=true/false.
  &nbsp;
  Если найдётся хотя бы одно расхождение — не маскировать, а оформить отдельным PATCH.
3. **В Stage 2 добавить жёсткий STOP-guard: не переводить template в active, если proof неполный хотя бы по одному звену.**
  Обязательная цепочка proof для каждого template:
  &nbsp;
  - manifest includes template,
  - pre-flight passed,
  - render success,
  - upload success,
  - ai_generated_documents row exists,
  - signed URL/download works,
  - batch linked,
  - snapshot/meta present.
  &nbsp;
  Только после этого менять status в двух файлах.
4. **В Stage 2 добавить явную разбивку по сценариям для генерации, чтобы не получилось “нет подходящей test session”.**
  В плане прямо перечислить, какие тестовые сессии нужны:
  &nbsp;
  - sole_participant_decision
  - annual_meeting + has_board
  - annual_meeting + has_auditor
  - annual_meeting + charter_change
  &nbsp;
  Если какой-то сценарий отсутствует в данных — сначала создать/подготовить test session, а уже потом делать proof.
5. **В Stage 3 по UI-proof истории добавить обязательный минимум доказательств.**
  Не просто “проверить”, а приложить:
  &nbsp;
  - скрин списка batch в History,
  - скрин раскрытого batch,
  - скрин/факт скачивания минимум одного corporate document,
  - указание generation_batch_id.
  &nbsp;
  И отдельно проверить, что grouping не ломает не-corporate batch.
6. **В Stage 4 activation matrix сделать единой для всех 18 шаблонов, не только для remaining active.**
  Иначе финальная картина Sprint 3 будет неполной.
  В таблице должны быть все 18:
  &nbsp;
  - active proven,
  - pending,
  - externally_provided,
  - conditional not proven.
  &nbsp;
  Это нужно для полного закрытия спринта.
7. **В Stage 5 зафиксировать add-only sync rule по runtime_status.**
  Явно прописать:
  &nbsp;
  - corporateTemplateSpec.ts — primary SoT,
  - corporate-manifest.ts — synchronized fallback,
  - любые изменения статуса делать одной задачей и одним PATCH одновременно в двух файлах,
  - без массового перевода статусов.
  &nbsp;
8. **В Stage 6 docs closeout добавить обязательный раздел “Что именно доказано, а что нет”.**
  Не общий текст, а 3 отдельных блока:
  &nbsp;
  - Закрыто в Sprint 3
  - Не закрыто в Sprint 3
  - Переходит в Sprint 4
  &nbsp;
  С перечислением template_code и причины.
9. **По UI-fix exit dialog добавить DoD с адаптивным proof.**
  Сейчас DoD слишком общий. Нужно явно потребовать proof на:
  &nbsp;
  - mobile width,
  - tablet,
  - desktop.
  &nbsp;
  И проверить:
  &nbsp;
  - нет overflow,
  - нет налезания текста,
  - destructive не доминирует над safe action,
  - primary остаётся главным действием.
  &nbsp;
10. **Не делать status updates до завершения proof-части.**
  Сначала:
  &nbsp;
  - manifest parity,
  - generation proof,
  - history UI proof,
  - final matrix,
  &nbsp;
  и только после этого — точечные изменения runtime_status.
11. **Добавить в финальный отчёт обязательный раздел “PATCH-остатки / новые баги”.**
  Если в процессе proof всплывут новые проблемы, их нельзя терять — их нужно оформить как отдельные PATCH и перенести дальше.
12. **Build clean и proof-факты должны быть по обоим блокам отдельно.**
  Отдельно:
  &nbsp;
  - UI-fix proof,
  - Sprint 3 closeout proof.
  &nbsp;

&nbsp;

&nbsp;

PATCH S3-CLOSE-4 + UI Fix: Exit Dialog + Sprint 3 Final Proof Closeout

## Part A. UI Fix: Exit Dialog (CorporateWizard)

**Problem**: The "Выйти из мастера?" dialog has 3 buttons that overflow/look cramped on smaller screens (visible in screenshot).

**File**: `src/components/corporate/CorporateWizard.tsx` (lines 402-428)

**Fix**: Restructure AlertDialogFooter layout:

- Stack all 3 buttons vertically on mobile, horizontal on sm+
- "Выйти без сохранения" as destructive outline, full width on mobile
- "Остаться" and "Сохранить и выйти" side by side on sm+, stacked on mobile
- Use `flex-col gap-2 sm:flex-row sm:justify-between` pattern
- Ensure consistent button sizing with `w-full sm:w-auto`

---

## Part B. PATCH S3-CLOSE-4 — Sprint 3 Final Proof Closeout

This is a proof-collection and documentation patch, not new functionality. Work is split into 6 stages per approved plan.

### Stage 1. Machine-readable manifest parity proof

**Method**: Compare `calculatePackageManifest()` (frontend, `corporateRuleEngine.ts`) with `calculateServerManifest()` (server, `corporate-manifest.ts`) line-by-line for 6 scenarios.

**Code inspection reveals**: Both functions use identical:

- Template arrays (same codes, same order)
- Conditional logic (same conditions for has_board, has_auditor, has_audit_commission, voting_form_secret, charter_change, agenda_change)
- Legal basis assignment rules
- Externally provided document logic
- Charter-dependent exclusion at `law_default`

**One difference found**: Frontend reads `runtime_status` from `corporateTemplateSpec.ts` via `getTemplateSpec()`, server uses `resolveRuntimeStatus()` from `DEFAULT_RUNTIME_STATUS` map. Both maps must stay synchronized manually per existing sync rule.

**Action**: Document parity proof with per-scenario comparison in `docs/corporate-templates-rules.md`.

### Stage 2. Proof remaining active templates

Active templates needing proof beyond already-proven `corp_order_meeting` and `corp_review_list`:

- `corp_sole_decision` (sole_participant branch)
- `corp_sole_appendices` (sole_participant branch)
- `corp_board_consent` (conditional, has_board)
- `corp_auditor_candidates` (conditional, has_auditor)
- `corp_auditor_consent` (conditional, has_auditor)
- `corp_charter_amendments` (conditional, charter_change)

**Action**: Invoke edge function via `supabase--curl_edge_functions` with appropriate test sessions. Document results per template.

### Stage 3. UI-proof history integration

**Action**: After successful generation, use browser tools to verify corporate batch visibility in History tab, grouping, download links.

### Stage 4. Final runtime activation matrix

**Action**: Build complete table in docs with all 18 templates showing before/after status and proof evidence.

### Stage 5. Sync runtime_status (only for proven templates)

**Files** (synchronized):

- `src/lib/corporate/corporateTemplateSpec.ts`
- `supabase/functions/_shared/corporate-manifest.ts`

Only change status for templates with complete end-to-end proof. No mass updates.

### Stage 6. Documentation closeout

**File**: `docs/corporate-templates-rules.md`

- Final manifest parity summary
- Activation matrix
- UI/history proof summary
- Closed vs remaining templates
- Sprint 4 GAP list

---

## Files to modify


| File                                               | Change                              |
| -------------------------------------------------- | ----------------------------------- |
| `src/components/corporate/CorporateWizard.tsx`     | Fix exit dialog button layout       |
| `src/lib/corporate/corporateTemplateSpec.ts`       | Status updates per individual proof |
| `supabase/functions/_shared/corporate-manifest.ts` | Synchronized status updates         |
| `docs/corporate-templates-rules.md`                | Full closeout documentation         |


## DoD

1. Exit dialog buttons fit and look clean on all viewports
2. Machine-readable manifest parity documented for 6 scenarios
3. End-to-end proof for each remaining active template
4. UI-proof of history integration
5. Runtime activation matrix complete
6. Status changes synchronized in both files
7. Sprint 3 closed/remaining clearly listed
8. Build clean