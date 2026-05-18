# Non-Telegram follow-up — F1/F2 + Block A/C/D (read-only)

**Snapshot:** `2026-05-18T13:00:00+00:00`
**Режим:** READ-ONLY. 0 DML. Execute не запускался.

## 1. F1 — Katerina Kaplia (`katrinkap777@rambler.ru`)

user_id `61ef2f4b-04a4-4c14-a97a-0f3a4ec51e74` · profile `adc48621-…`

### Paid orders (SOT)

| order_id | product_id | tariff_id | created_at |
|---|---|---|---|
| e369353a | `7101ed3c` (CB20) | `9bc81736` | 2026-04-20 |
| 9463a4b1 | `11c9f1b8` (Gorbova Club) | `7c748940` (Business) | 2026-04-20 |
| ac2e99ad | `73c29914` (Закрытие года) | `56c35e86` | 2026-02-25 |
| + 7 ранних club Business-renewal orders | `11c9f1b8` | `7c748940` | 2025-09 … 2026-03 |

→ У Katerina **есть подтверждённая покупка BUSINESS-тарифа Gorbova Club** (`7c748940`), при которой по правилам ИДЕОЛОГИЯ должны открываться bonus-доступы (cb20, ИДЕОЛОГИЯ модули, prd_0e5fda1e2273).

### Active entitlements

| product_id | code | expires_at | source |
|---|---|---|---|
| `73c29914` | course_close_year | 2026-05-31 | primary order ac2e99ad |
| `11c9f1b8` | club | 2026-05-20 | primary_order_fulfillment |
| `7101ed3c` | cb20 | 2026-05-20 | **rule_engine_product_access** (business bonus, scope=full_tariff_scope) ✓ |
| `c153c811` | prd_0e5fda1e2273 | 2026-05-20 | retroactive_backfill (RETROAPPLY) ✓ |

### Active subscriptions_v2

| product_id | tariff_id | status | access_end_at |
|---|---|---|---|
| `7101ed3c` cb20 | `9bc81736` | active | 2026-05-18 |
| `11c9f1b8` club | `7c748940` Business | active | 2026-05-20 |
| `73c29914` close_year | `56c35e86` | active | 2026-05-31 |

### Классификация F1

| слой | вердикт | gap_class | planned_action |
|---|---|---|---|
| SQL (данные) | **sql_ok** — все ожидаемые BUSINESS history доступы материализованы (cb20 full, prd_0e5fda1e2273, primary club) | `no_data_gap` | `no_action` для data-слоя |
| UI/resolver (видимость) | **ui_not_verified** — без impersonation нельзя подтвердить, что `useSidebarModules` + `resolveTrainingContentFilter` действительно показывают эти 4 продукта в кабинете | `sql_access_exists_but_ui_missing` (если скрин подтверждает невидимость) | `ui_resolver_patch_needed` под отдельный approve, но сперва impersonation proof |

**Итоговый источник проблемы:** `ui_resolver` (data SOT в порядке). Если в `cabinet → Моя библиотека` cb20/ИДЕОЛОГИЯ всё-таки не отображаются — это resolver/visibility bug, не data bug. Канонический memory: `cabinet-visibility-entitlement-dependency` + `training-content-resolver-rules` (P1–P5).

## 2. F2 — Елена Гудвилович (`alena.gudvilovich@bk.ru`)

user_id `1b68252b-62ca-4e99-b1fd-d07706ac134d` · profile `77326882-…`

### Paid orders (выжимка)

| order_id | product_id | tariff_id | created_at | smysl |
|---|---|---|---|---|
| 0d192cc8 | `11c9f1b8` club | `7c748940` Business | **2026-05-16** | свежий BUSINESS renewal |
| d8b4e214 | `11c9f1b8` club | `7c748940` Business | 2026-04-17 | предыдущий BUSINESS |
| 2e19bc11 | `f833c846` cb_module_construction | — | 2026-04-22 | **отдельная** module-покупка |
| d3f31616 | `abee24cd` cb_module_retail | — | 2026-04-22 | **отдельная** module-покупка |
| 294c8532 | `064dd768` cb_module_production | — | 2026-04-22 | **отдельная** module-покупка |
| 16e6b77d | `99f1f156` cb_module_pvt | — | 2026-04-22 | **отдельная** module-покупка |
| 11d7eda0 | `9187db54` cb_module_catering | — | 2026-04-22 | **отдельная** module-покупка |
| a1bdc10d | `d7effaf4` cb_module_marketplaces | — | 2026-04-22 | **отдельная** module-покупка |
| 86e964f2 | `64d9f812` prd_08a84b2b7223 | — | 2026-04-22 | **отдельная** module-покупка |
| 6abf195b | `87a8870f` cb_2_step | `5d598dae` | 2026-03-29 | отдельный продукт |
| 76167d70 | `7101ed3c` cb20 | `9bc81736` | 2026-03-28 | отдельная покупка cb20 |

### Active entitlements (12)

`cb_2_step`, `prd_0e5fda1e2273`, `club`, `cb_module_construction`, `cb_module_production`, `cb_module_marketplaces`, `cb_module_catering`, `cb_module_pvt`, `cb_module_retail`, `cb20`, `prd_08a84b2b7223` — все active, expires 2026-06-17 (renew от BUSINESS) и 2026-08-30 (cb_2_step). `cb_module_ip` expired (2026-05-17).

### Active subscriptions_v2

- club `7c748940` BUSINESS — **active** до 2026-06-15 (+ один superseded и один past_due — нормальный renewal flow).
- cb_2_step — active до 2026-08-30.
- 6 cb_module_* и prd_08a84b2b7223 — active до 2026-05-21 (отдельные покупки).
- cb_module_ip — canceled (соответствует expired entitlement).

### Классификация F2

| слой | вердикт | gap_class | planned_action |
|---|---|---|---|
| SQL (данные) | **sql_ok** — есть full BUSINESS club + cb20 full entitlement + отдельно купленные модули. Это **не** «модули вместо full». | `no_data_gap` (mixed_by_design) | `no_action` для data-слоя |
| UI/resolver | **ui_not_verified** — если в кабинете отображаются только модули и не виден full cb20/ИДЕОЛОГИЯ — это resolver bug на P1/P5 (cb20 entitlement без `meta.tariff_id` или с `scope_resolution_mode='full_tariff_scope'` должен открывать full content) | `sql_access_exists_but_ui_missing` | `ui_resolver_patch_needed` под отдельный approve |

**Итоговый источник проблемы:** `ui_resolver`. Data SOT в порядке: есть full BUSINESS club + full cb20 entitlement + bonus entitlements ИДЕОЛОГИЯ. Если UI показывает «только набор модулей» — это priority/resolver bug, не data bug. Канонический memory: `module-visibility-logic-v2` (full > module_only).

## 3. Block A/C/D — общая когорта BUSINESS / ИДЕОЛОГИЯ / Бизнес-леди

Когорта взята из `/mnt/documents/audit_business_ideology_fix_dryrun_rows.csv` (existing dry-run). Переразметка по non-Telegram gap_class:

| gap_class | count | source_problem | planned_action |
|---|---:|---|---|
| `missing_business_training_history_access` | 8 | **data** | `data_repair_canonical_grant` (re-run grant-access-for-order с прежним order_id, bonus block) |
| `missing_primary_entitlement` | 4 | **data** | `data_repair_canonical_grant` (primary block) |
| `access_end_mismatch` | 20 | **data** | `data_repair_canonical_grant` (alignment) |
| `tariff_id_mismatch` | 8 | **data** | `data_repair_canonical_grant` (tariff backfill в `meta.tariff_id`, без перезаписи expires_at вниз) |
| `module_entitlements_instead_of_full_access` | 2 | **mixed** (data: проверить, есть ли full ent; ui: проверить resolver приоритет) | сначала data check, потом resolver |
| `sql_access_exists_but_ui_missing` | 65 | **ui_resolver** | `ui_resolver_patch_needed` под отдельный approve, требуется impersonation proof per-user |

Telegram-строки из старого CSV (185 `telegram_membership_*` и проч.) в этом следствии **исключены** — переходят в трек 1 (PATCH-TG-DISCOVERY-FULL, итог 13 revoke + 5 reinvite).

## 4. Категоризация по источнику проблемы

- **Pure data-gap (40 строк)** — `missing_*`, `access_end_mismatch`, `tariff_id_mismatch`. Fix через canonical `grant-access-for-order` или admin re-run, по одному блоку с verify между.
- **Pure ui_resolver-gap (65 строк)** — `sql_access_exists_but_ui_missing`. Нужен impersonation/resolver proof и точечный resolver patch. Auto-fix запрещён без proof.
- **Mixed (2 строки)** — `module_entitlements_instead_of_full_access`. Сначала data check (есть ли full ent), затем resolver priority audit.

## 5. F1/F2 финальный статус

| фикстура | data | ui | итог |
|---|---|---|---|
| **F1** Katerina | `sql_ok` | `ui_not_verified` (по скрину — невидимы) | `sql_ok_ui_not_verified` → требуется impersonation, ожидаемый патч = `ui_resolver` |
| **F2** Елена | `sql_ok` (full BUSINESS + cb20 full + модули) | `ui_not_verified` (по скрину — видны только модули) | `sql_ok_ui_not_verified` → ожидаемый патч = `module-visibility-logic-v2` enforce: full > module_only |

## 6. Artifacts

- `.lovable/proofs/audit_ideology_business_non_telegram_followup_2026_05.md` (этот файл)
- `/mnt/documents/audit_business_ideology_fix_dryrun_rows.csv` (исходник; для следующей итерации добавится колонка `source_problem` ∈ {`data`,`ui_resolver`,`mixed`})

## 7. Запреты — соблюдены

0 DML, 0 grant-access-for-order, 0 правок entitlements/access_rules/subscriptions_v2, 0 касаний Telegram.

## 8. DoD

| критерий | статус |
|---|:---:|
| F1 разобран SQL vs UI с gap_class и planned_action | ✅ |
| F2 разобран SQL vs UI с gap_class и planned_action | ✅ |
| Cohort переразмечена по non-Telegram gap_class | ✅ |
| 3 категории source_problem указаны | ✅ (data 40, ui_resolver 65, mixed 2) |
| Execute не запускался | ✅ |
