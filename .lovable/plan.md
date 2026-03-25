# да, согласен, с учетом правок:

&nbsp;

1. **Part A дополнить жёстким условием фиксации бага**
  Если на одном из 3 viewport выявится дефект, в отчёте нужно явно указать:
  &nbsp;
  - bug_found: true
  - имя отдельного патча: S3-UI-EXIT-DIALOG-FIX
  - какой именно viewport его воспроизводит
  - что proof-скрины “после фикса” и “до фикса” не смешиваются
  &nbsp;
2. **Part A уточнить, что скрины должны быть именно из preview/UI, а не из кода**
  В proof указать:
  &nbsp;
  - источник: реальный UI preview
  - viewport width
  - шаги воспроизведения: открыть wizard → изменить поле → открыть exit dialog
    Это нужно, чтобы скрины были доказательством UI-факта, а не просто верстки.
  &nbsp;
3. **Part B добавить проверку parity не только по included, но и по excluded**
  В artifact и в docs зафиксировать отдельно:
  &nbsp;
  - excluded_match
  - список excluded templates в каждом сценарии
    Потому что для manifest parity важно доказать и корректное исключение шаблонов, а не только включение.
  &nbsp;
4. **Part B зафиксировать, что artifact — proof-only и не SoT**
  В docs добавить явную строку:
  &nbsp;
  - manifest_parity_proof.json — артефакт проверки
  - не является source of truth
  - SoT остаются: frontend rule engine, server manifest module, activation matrix docs
  &nbsp;
5. **Part C добавить явную проверку порядка строк в docs matrix**
  Нужна сверка не только статусов, но и порядка template_code:
  &nbsp;
  - docs matrix order = frontend spec order = server fallback order
    Иначе можно пропустить скрытый drift при совпадающих статусах.
  &nbsp;
6. **Part C уточнить, что 3-way sync делается только по 18 internal templates**
  В финальном short proof block прямо написать:
  &nbsp;
  - 3-way sync checked only for 18 corporate templates
  - 4 externally_provided excluded from runtime sync by design
  &nbsp;
7. **Part D сделать backlog-блок более операционным**
  Для каждого remaining active template добавить не только required test session type, но и:
  &nbsp;
  - expected included template_code in manifest
  - expected runtime_status before proof
  - expected final status after proof
    Это упростит следующий патч и уберет двусмысленность.
  &nbsp;
8. **Part D явно закрепить запрет на “частичный proof”**
  Добавь формулировку:
  &nbsp;
  - signed URL без записи в ai_generated_documents не считается proof
  - запись в batch без download не считается proof
  - нужен полный chain целиком, без пропусков
  &nbsp;
9. **Part E расширить финальный short proof block**
  Добавить туда ещё 2 строки:
  &nbsp;
  - excluded_match=true
  - docs matrix order matches spec/server fallback
    Тогда финальный блок будет действительно самодостаточным.
  &nbsp;
10. **Финальный DoD уточнить**
  Перепиши пункты 4–7 так:

&nbsp;

&nbsp;

&nbsp;

- по 6 сценариям: all_match=true, total_diffs=0, included_match=true, excluded_match=true, full_order_match=true
- verified 3-way sync for 18 corporate templates
- docs matrix order verified
- 4 external docs marked N/A by design

&nbsp;

&nbsp;

&nbsp;

11. **Отдельно зафиксировать, что в этом PATCH не трогаются server/frontend runtime maps**
  В разделе “Жёсткие правила этого PATCH” добавь:

&nbsp;

&nbsp;

&nbsp;

- не менять corporateTemplateSpec.ts
- не менять *shared/corporate-manifest.ts::DEFAULT*RUNTIME_STATUS
- любые расхождения только документируются, но не исправляются в этом proof-only PATCH

&nbsp;

&nbsp;

PATCH S3-CLOSE-5 (revised) — UI-fix + proof-only closeout

## Жёсткие правила этого PATCH

- **Proof-only**: не менять `corporateTemplateSpec.ts`, не менять `_shared/corporate-manifest.ts::DEFAULT_RUNTIME_STATUS`
- Любые расхождения только документируются, но не исправляются
- Если при 3 viewport proof обнаружится UI-баг — оформляется отдельный **PATCH S3-UI-EXIT-DIALOG-FIX** с явной фиксацией: `bug_found: true`, viewport, описание
- Локальные UI-правки — только в `CorporateWizard.tsx`, глобальный `alert-dialog.tsx` не трогать

---

## Part A. UI-fix exit dialog + 3 viewport proof

### Текущее состояние кода (lines 402-430)

Footer уже имеет `flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`. Кнопки имеют `h-9`. Но на скриншоте видно, что destructive-кнопка визуально проседает.

### Root cause (по коду)

`AlertDialogFooter` в `alert-dialog.tsx` задаёт `flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2`. CorporateWizard переопределяет className, но `sm:space-x-2` из базового компонента может наследоваться через merge. `AlertDialogCancel` имеет `mt-2 sm:mt-0` по умолчанию — уже переопределено `mt-0`.

### Фикс

- Убедиться, что footer className полностью переопределяет базовые классы (проверить cn merge)
- Все 3 кнопки: `h-9 text-sm` — единая высота и размер шрифта
- Destructive ghost: убрать любые padding/line-height отличия
- На mobile: `flex-col w-full` строго столбцом
- На desktop: `sm:flex-row sm:items-center` — baseline aligned

### Proof (из реального UI preview)

Шаги воспроизведения:

1. Открыть Corporate Wizard в preview
2. Изменить любое поле (чтобы появились unsaved changes)
3. Нажать назад/закрыть → exit dialog

Снять 3 скрина через browser tools:

- **375px**: `no overflow / no wrap break / equal heights`
- **768px**: `baseline aligned / no clipping`
- **1189px**: `destructive visually secondary / primary dominant / no horizontal squeeze`

Под каждым скрином подпись с подтверждением.

Если баг найден:

- `bug_found: true`
- Отдельный патч `S3-UI-EXIT-DIALOG-FIX`
- Скрины "до" и "после" не смешиваются

---

## Part B. Machine-readable manifest parity artifact

### Формат JSON — по каждому из 6 сценариев

```text
{
  "scenario_name": "...",
  "frontend_all": [...],          // все шаблоны (included + excluded)
  "server_all": [...],
  "frontend_included": [...],     // только included=true
  "server_included": [...],
  "frontend_excluded": [...],     // только included=false
  "server_excluded": [...],
  "frontend_count": N,
  "server_count": N,
  "included_match": true/false,
  "excluded_match": true/false,
  "full_order_match": true/false,
  "runtime_status_match": true/false,
  "required_data_match": true/false,
  "diffs": []
}
```

### Корень файла (self-contained metadata)

```text
{
  "generated_at": "ISO timestamp",
  "source_files": [
    "src/lib/corporate/corporateRuleEngine.ts",
    "supabase/functions/_shared/corporate-manifest.ts"
  ],
  "total_scenarios": 6,
  "all_match": true/false,
  "total_diffs": 0,
  "runtime_status_sync": { ... },
  "note": "This artifact is proof-only, NOT source of truth. SoT: frontend rule engine, server manifest module, activation matrix in docs."
}
```

### В docs добавить short proof block

```text
- manifest_parity_proof.json — артефакт проверки, не SoT
- SoT: frontend rule engine, server manifest module, docs matrix
- 6 scenarios checked
- all_match=true, diffs=[]
- included_match=true, excluded_match=true
- frontend_count === server_count
- full_order_match=true
- docs matrix order matches spec/server fallback
```

---

## Part C. 3-way activation matrix sync

### Три источника для сверки

1. `corporateTemplateSpec.ts` — TEMPLATE_SPECS[].runtime_status
2. `corporate-manifest.ts` — DEFAULT_RUNTIME_STATUS
3. `docs/corporate-templates-rules.md` — activation matrix

### Два отдельных блока в docs

**Блок 1: 18 corporate templates — runtime sync**


| template_code | frontend | server fallback | docs matrix | order_match | sync_ok |
| ------------- | -------- | --------------- | ----------- | ----------- | ------- |


Сверка не только статусов, но и **порядка** template_code во всех 3 источниках.

**Блок 2: 4 externally_provided — N/A by design**

Отдельно, не смешивать с runtime sync.

### Итоговая фиксация

- `3-way sync checked only for 18 corporate templates`
- `4 externally_provided excluded from runtime sync by design`
- `sync_ok: true/false`, `drifts: []`, `order_match: true/false`

---

## Part D. PATCH S4-ACTIVE-PROOF — операционный backlog-блок

Для каждого remaining active template:


| template_code | required_session_type | required_manifest_condition | expected_runtime_status_before | expected_final_status_after |
| ------------- | --------------------- | --------------------------- | ------------------------------ | --------------------------- |


### 6 шаблонов

- `corp_sole_decision` — sole_participant_decision
- `corp_sole_appendices` — sole_participant_decision
- `corp_board_consent` — annual_meeting + has_board=true
- `corp_auditor_candidates` — annual_meeting + has_auditor=true
- `corp_auditor_consent` — annual_meeting + has_auditor=true
- `corp_charter_amendments` — annual_meeting + charter_change

### Proof chain (полный, без пропусков)

`confirmed session → manifest include → pre-flight pass → render → upload → ai_generated_documents row → signed URL → history batch`

### Запрет на частичный proof

- signed URL без записи в `ai_generated_documents` ≠ proof
- запись в batch без download ≠ proof
- без confirmed test sessions статус менять запрещено

---

## Part E. Финальный short proof block в docs

```text
## Sprint 3 Closeout Proof Summary (S3-CLOSE-5)
- UI proof: 3 viewport screenshots attached (375/768/1189)
- Manifest parity artifact: /mnt/documents/manifest_parity_proof.json
- 6 scenarios checked, all_match=true, diffs=[]
- included_match=true, excluded_match=true
- full_order_match=true
- docs matrix order matches spec/server fallback
- runtime_status_sync_ok for 18/18 corporate templates
- 4 externally_provided: N/A by design
```

---

## Файлы


| Файл                                           | Что делать                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/components/corporate/CorporateWizard.tsx` | UI-fix кнопок exit dialog (если proof покажет баг)                                           |
| `docs/corporate-templates-rules.md`            | 3-way sync table, short proof block, S4 backlog block с операционными полями, excluded_match |
| `/mnt/documents/manifest_parity_proof.json`    | Самодостаточный artifact с included + excluded + metadata                                    |


---

## Финальный DoD

1. 3 viewport screenshots из реального UI preview, подписаны
2. Под каждым: `no overflow / equal heights / baseline aligned`
3. `/mnt/documents/manifest_parity_proof.json` создан и читается
4. По 6 сценариям: `all_match=true`, `total_diffs=0`, `included_match=true`, `excluded_match=true`, `full_order_match=true`
5. Verified 3-way sync for 18 corporate templates (spec + server fallback + docs matrix)
6. Docs matrix order verified against spec/server fallback
7. 4 external docs marked N/A by design
8. `PATCH S4-ACTIVE-PROOF` добавлен как операционный backlog block с per-template requirements
9. В этом PATCH **не менялись** `corporateTemplateSpec.ts` и `_shared/corporate-manifest.ts`