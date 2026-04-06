## Отчет о выполнении: CONSOLIDATED SPRINT — ACCESS-SCOPE-FORENSICS

Главный вопрос: **почему у пользователя есть конкретный доступ, почему он видит конкретный модуль, как это названо в UI, и совпадает ли с реальной сущностью в БД**.

---

### Статус-блок

| Патч | Статус |
|---|---|
| PATCH 1 | closed |
| PATCH 2 | partial — 12 ghost кейсов |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **closed** — manual proof |
| PATCH-DERGELEVA-BROWSER-PROOF | **closed** — manual proof |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | **root cause proved** |
| PATCH-KOROLYOVA-REVOKE-GUARD-FIX | **implemented** — Guard A + Guard B deployed, proof incomplete (no real trigger yet) |
| PATCH-GHOST-PLACEHOLDER-NORMALIZATION | pending |
| PATCH-GHOST-CLAIM-BRIDGE-PROOF | pending |
| PATCH 3 ACCESS-SCOPE-FORENSICS | **done — phases 1-9** |
| — Phase 5: 43 overvisible classification | done |
| — Phase 5b: 49 cb_module_ip basis audit | done |
| — Phase 6: naming audit | done |
| — Phase 7: default-deny visibility | done |
| — Phase 8: purchase→access→visibility matrix | done |
| — Phase 8b: 102→226 paid re-classification | done |
| — Phase 9: product card access SoT | done |
| PATCH-PRODUCT-MODULE-TARIFF-NAMING-AUDIT | **done** (Phase 6) |
| PATCH-DEFAULT-DENY-TRAINING-VISIBILITY | **done** (Phase 7) |
| PATCH-PRODUCT-CARD-ACCESS-SOT | **done** (Phase 9) |
| PATCH 4 duration drift | pending |

---

### PATCH-KOROLYOVA-REVOKE-GUARD-FIX — IMPLEMENTED, PROOF INCOMPLETE

**Guard A** (`grant-access-for-order`): если `accessEndAt < now()` при создании подписки → override на `now() + 48h`. Логирование: `subscription.stale_date_overridden`.

**Guard B** (`telegram-kick-violators`): перед kick проверяет наличие `provider_managed` подписки, созданной < 48h назад → skip kick с audit `KICK_SKIP_PROVIDER_GRACE`.

Оба guard-а задеплоены. В audit_logs пока нет ни одного срабатывания — guard-ы не триггерились в production. **Для полного proof нужен один из:** реальный audit-log после срабатывания ИЛИ воспроизводимый synthetic test-case.

---

### PATCH 3 ACCESS-SCOPE-FORENSICS — Результаты

#### Phase 5: 43 overvisible → re-bucketing в 4 группы

| Bucket | Кол-во | Описание |
|---|---|---|
| direct_order_legal | 0 | — |
| bonus_rule_legal | 0 | — |
| manual_or_bulk_legal_but_unconfirmed_reason | 49 | cb_module_ip, bulk_grant без order |
| cleanup_candidate_no_basis | 0 | — |

**Все 49** overvisible = cb_module_ip, все через bulk_grant (batch a2ff3724) от 2026-03-27, entitlement через historical_backfill. Ни у одного нет paid order. Классификация: **admin bulk grant с неподтверждённым бизнес-основанием**.

#### Phase 5b: cb_module_ip basis audit (49 записей)

Единый паттерн для всех 49:
- **Subscription source:** bulk_grant, batch_id=a2ff3724-19bd-44fd-8201-944cdfec174f, group=A, duration=90d
- **Entitlement source:** historical_backfill, batch=BACKFILL-ENT-v23.1.9B-2026-03-31T1117Z
- **Paid order:** НЕТ (0 из 49)
- **Billing type:** mit
- **Grant actor:** admin bulk_grant
- CSV: `cb_module_ip_basis_audit.csv`

#### Phase 6: Naming audit

| Anomaly | Кол-во | Описание |
|---|---|---|
| module_named_as_parent_prefix | 7 | cb_module_* — имя начинается с "Ценный бухгалтер \| 1 ступень 2.0 \|" |
| module_named_as_parent_prefix_wrong_category | 1 | prd_08a84b2b7223 — category=course, но имя модульное |
| trailing_pipe | 2 | cb20, prd_0d01a2fdc477 — trailing pipe в имени |
| ok | остальные | — |

**ЦБ zone продукты (карта сущностей):**

| product_code | name | category | real_entity_type | paid_orders | active_ent |
|---|---|---|---|---|---|
| cb20 | Ценный бухгалтер \| 1 ступень 2.0 \| | course | **full_product** | 444 | 121 |
| prd_0d01a2fdc477 | Ценный бухгалтер \| 2 ступень \| | course | **full_product** | 111 | 88 |
| cb_module_ip | ...Модуль: Учет у ИП | module | **module** | 0 | 49 |
| cb_module_catering | ...Модуль: Общепит | module | **module** | 2 | 0 |
| cb_module_construction | ...Модуль: Строительство | module | **module** | 1 | 0 |
| cb_module_marketplaces | ...Модуль: Маркетплейсы | module | **module** | 5 | 0 |
| cb_module_production | ...Модуль: Производство | module | **module** | 5 | 0 |
| cb_module_pvt | ...Модуль: ПВТ | module | **module** | 0 | 0 |
| cb_module_retail | ...Модуль: Розничная торговля | module | **module** | 6 | 0 |
| prd_08a84b2b7223 | ...Модуль: Грузо-/пассажироперевозки | course(!) | **module** | 3 | 0 |

**Проблемы naming:**
1. Все модули начинаются с имени parent product — в UI выглядят как будто полный продукт
2. prd_08a84b2b7223 имеет category=course, но по naming — это модуль
3. cb20 и prd_0d01a2fdc477 имеют trailing pipe в имени

**Deal label resolution chain:**
- Приоритет отображения: products_v2.name → purchase_snapshot.display_purchase_name → fallback
- Для модулей HIGH collision risk — имя начинается с parent
- **Fix target:** strip parent prefix в UI, показывать только "Модуль: X"

#### Phase 7: Default-deny visibility audit

| Anomaly | Кол-во | Описание |
|---|---|---|
| access_controlled | 5 | Имеют product + access_rules → корректно |
| active_without_access_rule | 3 | product_id привязан, но access_rules нет |
| no_product_no_rule_inactive | 7 | Нет product, нет rules, is_active=false |

**3 тренинга без access_rules (активные):**
1. `pn_s_fl` — Подоходный налог для физ лиц (0 entitlements, 0 subs)
2. `prd_0e5fda1e2273` — Деньги BY 1 тариф (0 entitlements, 3 subs)  
3. `1769009596189-398a` — Подоходный налог ИП (9 entitlements, 9 subs, 11 orders)

**Целевой контракт Default Deny:**
- current: если product_id есть → gated by entitlement; если нет → implicit allow
- target: нет binding + нет access_rule = deny. Период отсутствия = невидимость

**Mapping текущего → целевого:**

| Сущность | Current | Target |
|---|---|---|
| 7 inactive без product | implicit allow (but inactive) | deny (уже inactive, ok) |
| 3 active без access_rules | entitlement-gated but no rule path | добавить access_rules ИЛИ скрыть |
| 5 с access_rules | access_controlled | ok |

#### Phase 8: Purchase→Access→Visibility matrix

Полная матрица: 1733 строки в `purchase_to_access_to_visibility_matrix.csv`.

**Re-классификация "102 paid_but_no_entitlement"** (реально 226 кейсов после полного скана):

| Sub-bucket | Кол-во | Коды продуктов | Описание |
|---|---|---|---|
| historical_expired | 102 | buh_business, cb20, club, consultation | Были entitlement, срок истёк — **не аномалия** |
| paid_missing_active_entitlement | 103 | cb20, club, course_close_year, prd_0d01a2fdc477 и др. | **Реальный gap** — paid order, нет active entitlement |
| module_paid_no_entitlement | 19 | cb_module_* | Модульные покупки без entitlement |
| service_no_entitlement_expected | 2 | consultation | Услуга, entitlement не требуется |

**Итого реальных проблемных:** 103 + 19 = **122 кейса** (paid order → нет active entitlement).

#### Phase 9: Product card Access SoT

- `ProductAccessRulesTab` читает из `access_rules` — это **конфигурационный инструмент**, не SoT фактического доступа.
- Фактический SoT: `entitlements` (кто имеет) + `subscriptions_v2` (кто платит).
- Вкладка «Доступы» продукта показывает **правила выдачи**, а не реальных получателей.

**Расхождения config vs fact:**

| Продукт | access_rules (config) | live entitlements (fact) | live subs | paid orders | Расхождение |
|---|---|---|---|---|---|
| cb_module_ip | 2 rules (1 active) | 49 | 59 | 0 | 49 ent без orders — bulk grant |
| 1769009596189-398a | 0 rules | 9 | 9 | 11 | entitlements без rules |
| prd_3318c30fdf2c | 0 rules | 0 | 3 | 4 | subs без rules (тестовый) |
| consultation | 0 rules | 0 | 0 | 3 | orders без entitlements (service) |

**Вывод:** вкладка «Доступы» = access_rules (config), НЕ entitlements (fact). До подтверждения обратного, **не использовать как SoT для execute-решений**.

#### Sample-case: Протасевич

| Слой | Продукт | Статус | Срок | Basis |
|---|---|---|---|---|
| ORDER | Gorbova Club (CHAT) | paid | 2026-01-26 | club expired |
| ORDER | ЦБ 1 ступень (Бизнес-леди) | paid | 2026-03-28 | ✅ direct |
| ORDER | ЦБ 2 ступень (Премиум) | paid | 2026-03-29 | ✅ direct |
| ORDER | ЗАКРОЙ ГОД (x2) | paid | 2026-03-29 | ✅ direct |
| SUB | cb_module_ip | active | 2026-06-25 | ⚠️ bulk_grant, no order |
| SUB | prd_0d01a2fdc477 (2 ступень) | active | 2026-08-30 | ✅ from order |
| ENT | cb_module_ip | active | 2026-06-25 | ⚠️ historical_backfill from sub |
| ENT | prd_0d01a2fdc477 | active | 2026-08-30 | ✅ from order |
| ENT | cb20 | active | 2026-12-23 | ✅ historical_backfill from order |

**Вывод по Протасевич:** cb_module_ip — необоснованный доступ. Нет paid order. Subscription создана admin bulk_grant. UI-название `Ценный бухгалтер | 1 ступень 2.0 | Модуль: Учет у ИП` — содержит модуль, но начинается с названия основного продукта, создавая визуальную путаницу с cb20.

---

### Consolidated Summary Table (для execute-решений)

| Bucket | Кол-во | Scope | Действие |
|---|---|---|---|
| legal_access | ~510 | orders+entitlements совпадают | ok |
| legal_bonus_access | 0 | — | — |
| legal_manual/bulk_access | 49 | cb_module_ip — bulk_grant | **бизнес-решение: оставить или revoke?** |
| paid_but_missing_entitlement | 122 | 103 course + 19 module | **backfill entitlements** |
| historical_expired | 102 | были, истекли | **не аномалия** |
| visibility_mislabel_only | 10 | 8 module prefix + 2 trailing pipe | **fix UI labels** |
| default_deny_gap | 3 | active trainings без access_rules | **добавить rules или скрыть** |
| cleanup_candidates | 0 | — | — |

---

### Source-of-Truth Hierarchy (зафиксировано)

1. **orders_v2** — факт оплаты (purchase basis)
2. **subscriptions_v2** — период активного доступа (access period)
3. **entitlements** — факт наличия права (access fact, canonical SoT)
4. **access_rules** — конфигурационная логика выдачи (config)
5. **training_modules + useSidebarModules** — UI visibility resolver (1:1 с entitlements)

Вкладка продукта «Доступы» = access_rules (config), НЕ entitlements (fact).

---

### Артефакты (CSV)

| Файл | Строк | Описание |
|---|---|---|
| cb_module_ip_basis_audit.csv | 2 | Полный origin audit 49 cb_module_ip |
| deal_product_naming_audit.csv | 1987 | Naming audit всех paid orders |
| mislabelled_ui_entities.csv | 11 | Модули/продукты с проблемными UI-именами |
| deal_label_resolution_chain.csv | 11 | Цепочка разрешения label для каждого ЦБ продукта |
| default_deny_training_visibility_audit.csv | 15 | Все root training modules + binding status |
| purchase_to_access_to_visibility_matrix.csv | 1734 | Полная матрица purchase→access→visibility |
| product_access_tab_sot_audit.csv | 39 | Все active products + access data |

---

### STOP-guards

- **До утверждения execute-патча запрещено:**
  - Массовые revoke по cb_module_ip
  - Массовые revoke bonus access
  - Изменение UI labels без матрицы
- Не менять auth, RLS, edge functions (кроме Korolyova guards — done)
- Сначала полная карта, потом execute

---

### Следующие шаги (pending approval)

1. **Execute-решение по 49 cb_module_ip** — revoke или оставить? Все от admin bulk_grant, без orders.
2. **3 training modules без access_rules** — добавить rules или скрыть?
3. **122 paid_but_no_entitlement** — backfill missing entitlements?
4. **10 naming mislabels** — нормализовать UI-имена (strip parent prefix)?
5. **prd_08a84b2b7223** — исправить category course→module?
6. **Korolyova proof** — дождаться реального trigger или сделать synthetic test?
