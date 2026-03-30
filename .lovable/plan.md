# да, согласен, с учетом правок:

&nbsp;

1. Добавь шаг **“proof sync sweep”**: перед финальным decision block сделать grep/поиск по всем proof-файлам и readiness summary на старые формулировки:
  &nbsp;
  - BLOCKED_SAFE_GUARD
  - sandbox billing
  - subscription-charge renew blocker
  - R3 = blocked
    И обновить **все** затронутые файлы add-only, не только 4 перечисленных. Иначе останутся противоречия между proof-слоем и новым решением Path A.
  &nbsp;
2. В шаге 5 зафиксируй жёсткий порядок:
  &nbsp;
  - сначала обновление proof-файлов,
  - потом **idempotent** запись phase1_ledger_schema_ready_at,
  - потом финальный SQL recheck,
  - потом финальный decision block.
    Не оставляй формулировку “если решено”. Для текущего плана решение уже должно быть определено.
  &nbsp;
3. Отдельно пропиши, что в v22.8:
  &nbsp;
  - phase1_ledger_schema_ready_at можно записывать,
  - phase1_ledger_cutover_at **не записывается**,
  - readiness/cutover approval и cutover watermark — это разные вещи.
    Это нужно явно, чтобы не смешать schema_ready и cutover_at.
  &nbsp;
4. В блоке “Production Truth / Source of Renewal” добавь не только narrative, но и **контрактное следствие**:
  &nbsp;
  - текущий production renewal ledger classification = grant
  - это временно считается допустимым для cutover
  - semantic mismatch renewal classified as grant, not extend не blocker текущего релиза, а deferred design debt
  &nbsp;
5. В “Dead-Code Proof Package” добавь отдельный подпункт:
  &nbsp;
  - unreachable_extend_coverage = excluded_from_runtime_matrix
  - extend ledger rows expected in current production = 0
    Это должно быть записано явно, иначе потом снова появится старое ожидание runtime-proof по extend.
  &nbsp;
6. В remaining blockers запиши точнее:
  &nbsp;
  - если после записи phase1_ledger_schema_ready_at и финального SQL recheck всё PASS, то
    remaining_cutover_blockers = only formal approval
    Сейчас формулировка немного смешивает текущие и будущие blockers.
  &nbsp;
7. Добавь отдельный machine-check для v22.8:
  &nbsp;
  - после proof sync sweep проверить, что нигде в актуальных proof-файлах не осталось старого статуса R3 = BLOCKED_SAFE_GUARD
  - и что subscription-charge extend везде помечен как EXCLUDED_FROM_CUTOVER / dead code
    Это нужен как финальный anti-drift check.
  &nbsp;
8. В deferred list добавь ещё один пункт:
  &nbsp;
  - semantic reporting / analytics impact: renewals currently counted as grant in ledger
    Чтобы потом не забыть, что это влияет не только на код, но и на интерпретацию отчётов.
  &nbsp;
9. В decision block добавь ещё две строки:
  &nbsp;
  - CURRENT_RENEWAL_LEDGER_CLASSIFICATION = grant
  - EXTEND_PATH_RUNTIME_EXPECTATION = none (dead code)
    Тогда итоговый статус будет полностью однозначным.
  &nbsp;

&nbsp;

&nbsp;

После этих правок план уже можно считать финальным и не возвращаться к пересогласованию.

&nbsp;

План: v22.8 — Dead Code Resolution + Cutover Finalization

## Статус

```
CURRENT_PATH = A (dead code recognition, no sandbox billing)
NEW_CODE_IN_V22.8 = NO
DEAD_CODE_CLEANUP_NOW = NO
SUBSCRIPTION_CHARGE_EXTEND_RUNTIME_REQUIREMENT = REMOVED
CUTOVER_DECISION = proceed_to_final_readiness_check
FOLLOW_UP_SPRINT = semantics refactor / dead code cleanup
```

---

## 1. Production Truth / Source of Renewal

**Факт**: `subscription-charge` содержит два взаимоисключающих guard на строках 554–574, которые делают весь код ниже (включая extend ledger write на строках 1520–1556) **недостижимым**:

```text
Line 556: if (billing_type === 'provider_managed')
            → return { skipped: true, skip_reason: 'provider_managed' }

Line 566: if (billing_type !== 'provider_managed')
            → return { skipped: true, skip_reason: 'mit_disabled' }
```

Обе ветки возвращают `skipped`. Код после строки 574 — **dead code**.

**Production renewal source of truth:**

```text
bePaid webhook → bepaid-webhook → payment_reconcile_queue
  → bepaid-queue-cron / bepaid-auto-process
    → grant-access-for-order (action_type='grant', status='granted')
```

Этот путь (`grant-access-for-order`) уже имеет **runtime PASS** из v22.6/v22.7.

**Решения:**

- `subscription-charge` renew/extend path = dead code / unreachable under current guards
- Production renewal = webhook pipeline через `grant-access-for-order`
- Cutover readiness оценивается по живому пути, а не по unreachable ветке
- Требование sandbox billing для v22.7/v22.8 **отменяется** как не относящееся к реальному production path

---

## 2. Cutover Impact of Dead Code Finding

### Что меняется в readiness-оценке


| Аспект                      | Было (v22.7)                 | Стало (v22.8)                                |
| --------------------------- | ---------------------------- | -------------------------------------------- |
| subscription-charge extend  | BLOCKED_SAFE_GUARD           | **EXCLUDED_FROM_CUTOVER** (dead code)        |
| Sandbox billing requirement | Обязательное условие cutover | **Снято**                                    |
| Renewal runtime proof       | Отсутствует                  | **Покрыт через grant-access-for-order PASS** |


### Какой blocker снимается

- **R3 subscription-charge renew** — больше не blocker, т.к. extend path = unreachable dead code

### Какие blockers остаются

```
remaining_cutover_blockers:
  1. S13: phase1_ledger_schema_ready_at watermark not set in app_settings
  2. Final SQL recheck after watermark is set
  3. Formal cutover approval
```

Других blockers нет. Все SQL invariants S1–S12 = PASS. Runtime PASS для живых путей уже получен.

---

## 3. No-New-Code Decision

Для текущего спринта жёстко зафиксировано:

- **Код не меняем** — ни edge functions, ни shared helpers, ни DDL
- **Dead code не чистим** — cleanup deferred
- **Ledger semantics**: `grant` используется для renewals в текущем production pipeline — принимаем как operational reality
- **Semantic refactor** grant vs extend — переносится в отдельный будущий спринт

---

## 4. Обновлённая Runtime Матрица


| #      | Path                       | Status (v22.8)            | Основание                                      |
| ------ | -------------------------- | ------------------------- | ---------------------------------------------- |
| R1     | grant-access-for-order     | **PASS**                  | Runtime verified; live renewal-equivalent path |
| R2     | subscriptions-reconcile    | **PASS**                  | Runtime verified v22.6                         |
| R3     | subscription-charge extend | **EXCLUDED_FROM_CUTOVER** | Dead code, unreachable under current guards    |
| R4–R18 | Revoke/admin/import paths  | DEFERRED_NON_BLOCKING     | Functions invoked where possible, 0 candidates |


**Важно**: R3 больше не `BLOCKED_SAFE_GUARD`, а `EXCLUDED_FROM_CUTOVER as dead code`. Это принципиальное изменение статуса.

---

## 5. Proof-файлы для обновления


| Файл                                | Что обновляется                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `p0_ledger_runtime_smoke_proof.txt` | Заменить blocker по sandbox/renew → EXCLUDED_FROM_CUTOVER; добавить dead-code finding с excerpt guard-веток                    |
| `p0_ledger_path_coverage_proof.txt` | Пометить subscription-charge extend как dead/unreachable, excluded from live coverage; обновить итоговую таблицу               |
| `p0_invariant_report.txt`           | Добавить finding + decision block по dead code; обновить deferred list и decision block; снять sandbox requirement             |
| `.lovable/v22.7_readiness_plan.md`  | Синхронизировать итоговый cutover status; обновить R3 статус; убрать формулировки про sandbox billing как обязательное условие |


---

## 6. Dead-Code Proof Package

Обязательные доказательства для записи в proof-файлы:

### 6.1 Guard-ветки (excerpt из subscription-charge/index.ts:554–574)

```text
Lines 556-563: if (billing_type === 'provider_managed')
  → return { skipped: true, skip_reason: 'provider_managed' }

Lines 566-573: if (billing_type !== 'provider_managed')
  → return { skipped: true, skip_reason: 'mit_disabled' }
```

Обе ветки взаимоисключающие и исчерпывающие (X === Y || X !== Y). Обе возвращают `skipped`. **Код после строки 574 недостижим.**

### 6.2 Extend ledger write (строки 1520–1556)

Содержит `action_type: 'extend'`, `status: 'extended'`, `reason_code: 'subscription_renew'`. Этот код **никогда не выполняется** при текущем control flow.

### 6.3 Живой renewal path

```text
bepaid-webhook (получает callback от bePaid)
  → записывает в payment_reconcile_queue
bepaid-queue-cron / bepaid-auto-process
  → обрабатывает очередь
  → вызывает grant-access-for-order
    → action_type='grant', status='granted'
    → runtime PASS подтверждён в v22.6
```

---

## 7. Deferred List (не блокирует cutover)


| #   | Item                                                          | Sprint       | Priority        |
| --- | ------------------------------------------------------------- | ------------ | --------------- |
| 1   | Semantic split: grant vs extend в live renewal path           | Post-cutover | Medium          |
| 2   | Cleanup/removal dead code в subscription-charge (~1200 строк) | Post-cutover | Low             |
| 3   | Optional sandbox program для future semantic verification     | Post-cutover | Low             |
| 4   | Cross-product access rules / offer_grant_rules UI             | Post-cutover | Separate sprint |


---

## 8. Задачи v22.8

1. Обновить `p0_ledger_runtime_smoke_proof.txt` — dead-code finding, excerpt, EXCLUDED_FROM_CUTOVER
2. Обновить `p0_ledger_path_coverage_proof.txt` — extend = dead/unreachable, excluded
3. Обновить `p0_invariant_report.txt` — finding, decision, deferred list, снять sandbox requirement
4. Обновить `.lovable/v22.7_readiness_plan.md` — синхронизировать cutover status
5. Установить `phase1_ledger_schema_ready_at` watermark в `app_settings` (если решено)
6. Финальный SQL recheck
7. Decision block: CUTOVER_ALLOWED = YES/NO

---

## 9. Финальный Decision Block

```
CURRENT_PATH = A
NEW_CODE_IN_V22.8 = NO
DEAD_CODE_CLEANUP_NOW = NO
SUBSCRIPTION_CHARGE_EXTEND_RUNTIME_REQUIREMENT = REMOVED
PRODUCTION_RENEWAL_PATH = bepaid-webhook → grant-access-for-order (PASS)
SANDBOX_BILLING_REQUIREMENT = REMOVED (not applicable to live path)
CUTOVER_DECISION = proceed_to_final_readiness_check
REMAINING_BLOCKERS = schema_ready watermark + final SQL recheck + formal approval
FOLLOW_UP_SPRINT = semantics refactor / dead code cleanup / access rules UI
```

---

## Что НЕ входит в v22.8

- Новый код / code patches
- Dead code cleanup
- Schema changes / DDL
- UI / admin panels
- Cross-product access rules
- Semantic refactor grant vs extend
- Sandbox billing setup