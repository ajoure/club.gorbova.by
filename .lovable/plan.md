# да, согласен, с учетом правок:

&nbsp;

1. **Part A переименовать из proof-only в fix+proof**
  По скрину DoD не выполнен: кнопка **«Выйти без сохранения»** визуально кривая, выбивается по высоте/базовой линии и ломает композицию. Это уже не proof-only, а отдельный **UI-fix внутри этого PATCH**. Нужно сначала исправить layout, потом снять 3 proof-скрина.
2. **Явно зафиксировать root cause и способ исправления**
  В PATCH добавить:
  &nbsp;
  - все 3 кнопки должны иметь **одинаковую высоту**;
  - у destructive-кнопки убрать стиль/классы, которые меняют line-height, padding, font-size, border-radius или vertical-align относительно остальных;
  - footer собрать в **две зоны**:
    &nbsp;
    - зона safe actions: Сохранить и выйти + Остаться
    - зона destructive: Выйти без сохранения
    &nbsp;
  - на desktop destructive-кнопка должна быть **отдельно**, но не визуально “проваливаться” по оси Y;
  - на mobile все 3 кнопки идут **строго столбцом** с одинаковой шириной w-full.
  &nbsp;
3. **Добавить строгий DoD по кнопкам**
  Не просто “no overflow”, а:
  &nbsp;
  - одинаковая высота всех 3 кнопок;
  - одинаковое вертикальное выравнивание текста;
  - destructive не выходит за baseline соседних кнопок;
  - нет сжатия текста и нет обрезки на 375 / 768 / 1189 px;
  - primary visually dominant, destructive visually secondary.
  &nbsp;
4. **Part A: proof делать после фикса**
  Для каждого viewport приложить:
  &nbsp;
  - screenshot;
  - краткую подпись: mobile/tablet/desktop;
  - подтверждение: equal heights / no overflow / no wrap glitch / baseline aligned.
  &nbsp;
5. **Part B: artifact сохранить не только в /mnt/documents, но и дать copyable summary в docs**
  В docs/[corporate-templates-rules.md](http://corporate-templates-rules.md) добавить краткий блок:
  &nbsp;
  - 6 scenarios checked;
  - match=true for all;
  - diffs=[].
    Сам json-артефакт оставить как machine-readable proof.
  &nbsp;
6. **Part B: в artifact добавить еще 2 поля**
  Помимо текущего списка добавить:
  &nbsp;
  - frontend_count
  - server_count
    Чтобы сразу видеть совпадение не только по содержимому, но и по количеству.
  &nbsp;
7. **Part C: activation matrix должна сверяться сразу с двумя файлами**
  Проверять не только corporateTemplateSpec.ts, но и серверный fallback в _shared/corporate-manifest.ts, чтобы не пропустить drift. В docs явно отметить:
  &nbsp;
  - frontend runtime_status
  - server fallback runtime_status
  - sync_ok: true/false
  &nbsp;
8. **Part D расширить**
  В PATCH S4-ACTIVE-PROOF добавить не только test sessions, но и требование:
  &nbsp;
  - каждая test session должна быть сохранена в статусе confirmed;
  - для каждой должен быть указан ожидаемый список active templates до запуска;
  - после запуска приложить proof chain:
    session -> manifest -> pre-flight -> batch -> ai_generated_documents -> signed url.
  &nbsp;
9. **Добавить отдельный mini-proof по history UI**
  Раз уж закрывается S3 closeout, в этом PATCH нужно хотя бы потребовать:
  &nbsp;
  - 1 screenshot списка batch в History;
  - 1 screenshot раскрытого corporate batch;
  - 1 proof скачивания документа из UI.
    Иначе пункт про history снова останется “partial”.
  &nbsp;
10. **Файлы**
  В список файлов добавить:

&nbsp;

&nbsp;

&nbsp;

- src/components/corporate/CorporateWizard.tsx — **UI-fix exit dialog before proof**
- docs/[corporate-templates-rules.md](http://corporate-templates-rules.md)
- /mnt/documents/manifest_parity_proof.json

&nbsp;

&nbsp;

&nbsp;

11. **Итоговый статус PATCH**
  В конце плана явно разделить:

&nbsp;

&nbsp;

&nbsp;

- UI fix
- UI proof
- manifest proof artifact
- activation matrix verification
- next PATCH definition

&nbsp;

&nbsp;

Чтобы подрядчик не попытался снова выдать только proof без исправления самой кнопки.

&nbsp;

PATCH S3-CLOSE-5 — UI-proof + Manifest proof artifact + Activation matrix + Next PATCH

## Part A. UI-proof Exit Dialog (3 viewport)

**Task**: Use browser tools to capture screenshots of the exit dialog at 3 viewport sizes.

**Method**:

1. Navigate to Corporate Wizard in preview
2. Trigger exit dialog (click back/close with unsaved data)
3. Screenshot at mobile (375px), tablet (768px), desktop (1189px)
4. Verify: no overflow, no text overlap, destructive button low-prominence, primary action dominant

**File changes**: None. This is proof-only. If a layout bug is found, it becomes a separate PATCH.

---

## Part B. Machine-readable manifest parity proof artifact

**Task**: Generate a JSON artifact with 6 scenario comparisons showing actual template lists from both functions.

**Method**: Write a comparison script that imports both `calculatePackageManifest` (frontend) and `calculateServerManifest` (server) logic, runs 6 scenarios, outputs per-scenario JSON with:

- `scenario_name`
- `frontend_included[]` (template_code, legal_basis, category, runtime_status)
- `server_included[]` (same fields)
- `match: true/false`
- `diffs: []`

Save to `/mnt/documents/manifest_parity_proof.json`.

Since both functions cannot be imported in the same runtime (frontend vs Deno), the proof will be done by code-level comparison: extract the template arrays and conditional logic from both files, run them through identical input params, compare outputs programmatically.

**6 scenarios**:

1. `annual_meeting` + `law_default`
2. `annual_meeting` + `charter_confirmed` + `has_board=true`
3. `annual_meeting` + `has_auditor=true` + `has_audit_commission=true`
4. `annual_meeting` + `charter_change` in agenda
5. `sole_participant_decision` + `law_default`
6. `annual_meeting` + `secret` voting

**Output**: Artifact file with full per-scenario data.

---

## Part C. Full activation matrix in docs

**Task**: Ensure `docs/corporate-templates-rules.md` contains the complete 18+4 template matrix (already present at lines 376-421). Verify it matches current `corporateTemplateSpec.ts` statuses exactly.

**File changes**: Minor update to `docs/corporate-templates-rules.md` if any discrepancy found.

---

## Part D. PATCH S4-ACTIVE-PROOF — Next patch for remaining active templates

**Task**: Define a separate follow-up PATCH in docs for Sprint 4 that covers:

1. **Create test sessions** for missing scenarios:
  - `sole_participant_decision` (confirmed)
  - `annual_meeting` + `charter_confirmed` + `has_board=true` (confirmed)
  - `annual_meeting` + `charter_confirmed` + `has_auditor=true` (confirmed)
  - `annual_meeting` + `charter_change` in agenda (confirmed)
2. **Per-template end-to-end proof** for:
  - `corp_sole_decision`
  - `corp_sole_appendices`
  - `corp_board_consent`
  - `corp_auditor_candidates`
  - `corp_auditor_consent`
  - `corp_charter_amendments`
3. **Per-template proof chain**: manifest includes → pre-flight → render → upload → DB record → signed URL → batch linked → snapshot present

**File changes**: Add section to `docs/corporate-templates-rules.md` under Sprint 4 GAPs.

---

## Files


| File                                        | Change                                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| `docs/corporate-templates-rules.md`         | Add PATCH S4-ACTIVE-PROOF definition, verify activation matrix |
| `/mnt/documents/manifest_parity_proof.json` | New artifact: machine-readable proof                           |


## DoD

1. 3 viewport screenshots of exit dialog (mobile/tablet/desktop) — no overflow
2. Machine-readable manifest parity artifact with 6 scenarios, match=true
3. Activation matrix verified complete in docs (all 18+4)
4. PATCH S4-ACTIVE-PROOF defined with test session requirements and per-template proof chain