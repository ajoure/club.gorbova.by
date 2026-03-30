Да, согласен, с учетом правок:

&nbsp;

1. Runtime smoke не считать PASS при отсутствии реальных строк.  
Если после phase1_ledger_schema_ready_at / до phase1_ledger_cutover_at для любого из 3 path нет ни одной ledger-row, статус должен быть не PASS, а PENDING_RUNTIME_EVENT. Cutover в таком случае запрещён.
2. Исправь JSON-проверку post_check.  
Не result->>'post_check', а result->'post_check' IS NOT NULL.  
И отдельно machine-check на 5 canonical keys:  

  - entitlement
  - telegram
  - subscription
  - ledger_row
  - target_resolution
3. &nbsp;
4. Паттерны source_event_key проверь по фактическим префиксам, а не по одному примеру.  
Для smoke-поиска используй не только:  

  - gafo:webhook:%
  - sub-renew:%
  - cron-reconcile:%  
  а все реально допустимые варианты из текущего wrapper-контракта:
  - gafo:%
  - sub-renew:%
  - cron-reconcile:% / sr:% — взять фактический префикс из кода, не гадать.
5. &nbsp;
6. Добавь отдельный machine-check на отсутствие старых ledger-значений в БД, а не только grep по коду.  
Проверить в access_grant_ledger после watermark:  

  - target_type IN ('telegram_access','subscription') = 0
  - status = 'completed' AND action_type <> 'batch_start' = 0
7. &nbsp;
8. Grep scope зафиксируй жёстко.  
Искать только в:  

  - supabase/functions/_shared/
  - supabase/functions/grant-access-for-order/
  - supabase/functions/subscription-charge/
  - supabase/functions/subscriptions-reconcile/  
  И явно исключить:
  - .lovable/proofs/
  - supabase/migrations/
  - archival/test paths  
  Иначе будут ложные срабатывания.
9. &nbsp;
10. Helper contract freeze надо проверить не текстом, а grep/assertion.  
В proof добавить:  

  - writeLedgerEntry возвращает id, execution_key, error
  - executeRevoke принимает targetType, targetKey, targetRef, reasonCode, reconcileBasis
  - buildPostCheck не содержит telegram_grant, только telegram
11. &nbsp;
12. Для runtime smoke нужен явный fallback-сценарий ручного прогона.  
Если cron/path ещё не сработал, в плане добавь:  

  - как вызвать subscriptions-reconcile
  - как вызвать тестовый grant-access-for-order
  - как вызвать тестовый subscription-charge:renew  
  И только после этого собирать p0_ledger_runtime_smoke_proof.txt.
13. &nbsp;
14. Обновление p0_ledger_contract_validation_proof.txt делай add-only.  
Новая секция: Runtime Validation Gate (v22.4) без переписывания уже утверждённых секций.
15. Cutover guard сформулируй жёстче.  
phase1_ledger_cutover_at запрещено писать, пока одновременно не выполнены:  

  - runtime_smoke = PASS
  - grep_guard = PASS
  - contract_validation = PASS
  - orphan_downstream = 0
  - missing_required_post_check = 0
16. &nbsp;
17. Файлы proof лучше перечислить так:

&nbsp;

&nbsp;

&nbsp;

- создать p0_ledger_runtime_smoke_proof.txt
- создать p0_ledger_grep_guard_proof.txt
- обновить p0_ledger_contract_validation_proof.txt
- при необходимости создать p0_runtime_manual_smoke_steps.txt, если реальных событий ещё нет

&nbsp;

&nbsp;

После этих правок план можно считать финальным для PATCH v22.4.

&nbsp;

# План: PATCH v22.4 — Runtime Validation Gate

## Цель

Подтвердить, что foundation-fix v22.3 реально пишет валидные ledger rows в runtime, а не только компилируется. Создать два proof-файла и зафиксировать helper contract freeze.

## Шаги реализации

### Шаг 1. Runtime smoke — запросить реальные ledger rows из БД

Выполнить SQL-запрос к `access_grant_ledger` для получения последних записей от каждого из 3 уже обёрнутых path-ов:

- `source_event_key LIKE 'gafo:webhook:%'` → grant-access-for-order
- `source_event_key LIKE 'sub-renew:%'` → subscription-charge
- `source_event_key LIKE 'cron-reconcile:%'` → subscriptions-reconcile

По каждой записи проверить:

1. `action_type ↔ status` валиден
2. `reason_code` из DDL словаря
3. `target_type` из DDL словаря
4. `source_subject_type` из DDL словаря
5. `chk_has_subject` — есть хотя бы один subject ref
6. `result->>'post_check'` существует и соответствует нормализованной схеме
7. result access window fields не затёрты (access_start, access_end, window_days присутствуют для grant/extend)

Если записей ещё нет (paths ещё не запускались после deploy) — зафиксировать это в proof как "pending first runtime event" и предложить ручной smoke-test.

### Шаг 2. Глобальный grep по live scope

Поиск по `supabase/functions/_shared/`, `supabase/functions/grant-access-for-order/`, `supabase/functions/subscription-charge/`, `supabase/functions/subscriptions-reconcile/` на:

- `target_type.*'telegram_access'` в ledger-контексте
- `target_type.*'subscription'` (без `_tier`) в ledger-контексте
- `status.*'completed'` в ledger-контексте (не payment status)
- `applicable:` (old-style boolean) в post_check
- `telegram_grant` как ключ в ledger post_check

Результаты зафиксировать в proof.

### Шаг 3. Создать `p0_ledger_runtime_smoke_proof.txt`

Содержимое:

- Для каждого path: фактическая ledger row (или статус "pending")
- Machine-check по 7 пунктам выше
- Вердикт PASS/FAIL

### Шаг 4. Создать `p0_ledger_grep_guard_proof.txt`

Содержимое:

- Перечень grep-запросов
- Результат: 0 matches для каждого запрещённого паттерна в live scope
- Отдельная секция: helper contract freeze

### Шаг 5. Зафиксировать helper contract freeze

В `p0_ledger_grep_guard_proof.txt` добавить секцию "Helper Contract Freeze":

- `writeLedgerEntry()` → возвращает `{ id, execution_key, error }`
- `executeRevoke()` → принимает `targetType/targetKey/targetRef/reasonCode/reconcileBasis` только извне
- `buildPostCheck()` → 5 canonical keys: `entitlement, telegram, subscription, ledger_row, target_resolution`

### Шаг 6. Обновить `p0_ledger_contract_validation_proof.txt`

Добавить секцию "Runtime validation" со ссылкой на runtime smoke proof.

## Файлы


| Действие | Файл                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| Создать  | `.lovable/proofs/p0_ledger_runtime_smoke_proof.txt`                                 |
| Создать  | `.lovable/proofs/p0_ledger_grep_guard_proof.txt`                                    |
| Обновить | `.lovable/proofs/p0_ledger_contract_validation_proof.txt` (добавить runtime секцию) |


## STOP-guard

Если хотя бы один runtime smoke row не проходит DDL/runtime contract → STOP. Не переходить к downstream parent propagation, batch/import tree, cutover marker.