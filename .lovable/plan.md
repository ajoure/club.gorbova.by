да, согласен, с учетом правок:

&nbsp;

1. Зафиксируй add-only режим для proof-файлов: ничего из ранее подтвержденного не удалять и не переписывать целиком; только:
  &nbsp;
  - добавить финальные секции,
  - исправить 3 найденных текстовых рассинхрона proof ↔ code,
  - явно пометить исправленные строки как proof-text sync fix, а не как новое требование.
  &nbsp;
2. В p0_ledger_path_coverage_proof.txt сделай одну итоговую таблицу со строгими колонками:
  &nbsp;
  - path
  - wrapped_in_code
  - runtime_status
  - proof_status
  - deferred_reason
  - notes
    И отдельно не смешивай runtime PASS и wrapped_in_code.
  &nbsp;
3. В p0_ledger_grep_guard_proof.txt добавь явный расширенный scope и результаты grep по import files:
  &nbsp;
  - [Date.now](http://Date.now)(
  - Math.random(
  - row:${index}
  - IMP-${
  - .single() в existence-check контексте
    С фактическими count, а не только PASS/FAIL.
  &nbsp;
4. В p0_invariant_report.txt добавь отдельный блок Proof/Text Sync Fixes, где перечислишь 3 уже найденных minor-расхождения:
  &nbsp;
  - fallback pattern в batch proof,
  - sprint status в parent propagation proof,
  - row:{index} → hash:{canonicalHash} в contract proof.
    Это нужно, чтобы не было ощущения, что proof тихо переписали задним числом.
  &nbsp;
5. В финальном decision block добавь два статуса, а не один:
  &nbsp;
  - SPRINT IMPLEMENTATION STATUS = COMPLETE
  - CUTOVER READINESS STATUS = BLOCKED
    И отдельной строкой:
  - NEW CODE PATCHES IN THIS FOLLOW-UP = NO
  &nbsp;
6. В deferred list раздели пункты на 2 группы:
  &nbsp;
  - Deferred runtime verification
  - Deferred cutover readiness
    И не смешивай их в один список.
  &nbsp;
7. В DoD добавь явную проверку:
  &nbsp;
  - все proof-файлы синхронизированы **между собой и с кодом**
  - все ранее найденные text-drift mismatches устранены
  - новых code tasks не создано
  &nbsp;

&nbsp;

&nbsp;

Если это внесено, план можно утверждать и переходить к финализации proof-пакета без нового цикла пересогласования.

&nbsp;

# План: PATCH v22.6 Sub-patch D — Consolidated Proof / Coverage / Finalization

## Статус

```
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
CUTOVER_ALLOWED = NO
CURRENT_STEP = FINAL CONSOLIDATED PROOF / COVERAGE FOLLOW-UP
```

## Диагностика

Проведена полная ревизия всех proof-файлов и кода. Новых blocker-фактов не обнаружено:

- `Date.now()` / `Math.random()` = 0 в обоих import files
- `row:${index}` в identity path = 0
- `.single()` в bepaid — только на INSERT (корректно), existence-check уже через select+length
- Все 7 proof-файлов существуют и содержат актуальные данные Sub-patch A/B/C
- `p0_invariant_report.txt` — не существует, нужно создать
- `p0_downstream_parent_propagation_proof.txt` — sprint status устарел (Sub-patch C = "next", должен быть "done")

## Scope

Только proof/coverage finalization. Код не трогаем — новых фактов нет.

## Задачи

### 1. Создать `p0_invariant_report.txt`

Consolidated invariant report по Phase 0 + Phase 1:

- Schema guards: action/status compatibility, target/reason/source_subject dictionaries
- Parent pair constraint (both NULL or both NOT NULL)
- chk_has_subject (≥1 subject ref NOT NULL)
- Batch symmetry (batch_start → target_type='batch', row-level → never 'batch')
- Deterministic identity (no entropy in import paths)
- Old-value guards (0 telegram_access, 0 bare subscription, 0 completed non-batch)
- No duplicate post-switch block
- stableRowHash drift guard (byte-identical)
- Archive pseudo-target contract v1
- DB SoT contracts (bepaid_product_mappings, tariffs.getcourse_offer_id)

### 2. Финализировать `p0_ledger_runtime_smoke_proof.txt`

Добавить блок:

```
## Sprint Close Runtime Assessment
Runtime smoke sufficient for sprint close: YES
Cutover allowed: NO
Reason: subscription-charge extend path lacks safe sandbox billing proof
Deferred paths: 9 revoke + parent propagation + batch/import = runtime_deferred_non_blocking
```

### 3. Финализировать `p0_downstream_parent_propagation_proof.txt`

Обновить sprint status:

- Sub-patch C = done in code (сейчас написано "next")
- Sub-patch D = current (proof finalization)

### 4. Финализировать `p0_batch_import_tree_proof.txt`

Обновить sprint status:

- Sub-patch D = current → done
- Обновить fallback identity строки: убрать `row:{index}` из таблиц секции 2 (сейчас proof-текст всё ещё показывает `row:{index}` как fallback в таблице, хотя код уже использует `hash:${canonicalHash}`)

### 5. Обновить `p0_ledger_contract_validation_proof.txt`

Добавить финальный sprint status block + Sub-patch D = done.

### 6. Обновить `p0_ledger_path_coverage_proof.txt`

Добавить:

- Итоговый runtime status per path (wrapped / runtime PASS / runtime deferred)
- Финальный coverage summary с runtime column

### 7. Обновить `p0_revoke_path_inventory.txt`

Sprint status: Sub-patch D = done, sprint = implementation-complete.

### 8. Обновить `p0_ledger_grep_guard_proof.txt`

Расширить grep scope на import files (bepaid-report-import, getcourse-import-deals). Добавить entropy grep results.

### 9. Финальный deferred list

Единый список в `p0_invariant_report.txt` (или отдельной секцией):

- Runtime smoke для parent propagation paths
- Runtime smoke для revoke wrappers
- Runtime smoke для import batch paths
- subscription-charge extend runtime proof
- Final cutover decision
- phase1_ledger_cutover_at выставление

### 10. Финальный decision block

```
v22.6 MAIN IMPLEMENTATION STATUS = COMPLETE
CODE PATCHES STATUS = COMPLETE (Sub-patches A, B, C)
PROOF FINALIZATION STATUS = COMPLETE
CUTOVER STATUS = BLOCKED
REASON = subscription-charge runtime proof requires safe billing sandbox
NEXT STEP = separate cutover/readiness sprint
phase1_ledger_cutover_at = NOT SET
```

## Файлы


| Действие | Файл                                                         |
| -------- | ------------------------------------------------------------ |
| Создать  | `.lovable/proofs/p0_invariant_report.txt`                    |
| Обновить | `.lovable/proofs/p0_ledger_runtime_smoke_proof.txt`          |
| Обновить | `.lovable/proofs/p0_downstream_parent_propagation_proof.txt` |
| Обновить | `.lovable/proofs/p0_batch_import_tree_proof.txt`             |
| Обновить | `.lovable/proofs/p0_ledger_contract_validation_proof.txt`    |
| Обновить | `.lovable/proofs/p0_ledger_path_coverage_proof.txt`          |
| Обновить | `.lovable/proofs/p0_revoke_path_inventory.txt`               |
| Обновить | `.lovable/proofs/p0_ledger_grep_guard_proof.txt`             |


## Что НЕ изменяется

- Любой код edge functions
- DDL / миграции
- UI
- frozen helpers
- phase1_ledger_cutover_at

## STOP-guards

- Не добавлять кодовые идеи — новых фактов нет
- Не заявлять cutover готовым
- Не подменять machine-check числа декларациями (где нельзя проверить runtime — честно пометить deferred)
- Если при финальной записи proof найден новый факт → либо critical blocker, либо deferred, но не новый цикл

## Найденные расхождения proof ↔ код (minor, не blockers)

1. `p0_batch_import_tree_proof.txt` секция 2: fallback pattern всё ещё показывает `row:{index}:{sha256_hash}` — код уже использует `row:hash:${canonicalHash}`. Нужно обновить текст proof.
2. `p0_downstream_parent_propagation_proof.txt` sprint status: Sub-patch C = "next" → должен быть "done in code".
3. `p0_ledger_contract_validation_proof.txt` секция chk_has_subject: `row:{index}` → должен быть `hash:{canonicalHash}`.

Все три — текстовые расхождения proof с уже исправленным кодом. Исправляются в рамках этого follow-up.

## DoD

1. Все proof-файлы синхронизированы между собой и с кодом
2. Есть одна итоговая таблица покрытия paths (в p0_ledger_path_coverage_proof.txt)
3. Есть один итоговый deferred list (в p0_invariant_report.txt)
4. Есть один финальный decision block
5. Нет новых кодовых идей
6. phase1_ledger_cutover_at = NOT SET
7. Спринт v22.6 = implementation-complete, cutover-blocked