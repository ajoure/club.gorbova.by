## CONSOLIDATED SPRINT — EXECUTE PHASE

Основная нить: **purchase → subscription → entitlement → visibility → UI label → fact/config SoT**.

Цель текущего спринта — не косметика, а окончательная увязка цепочки покупка → выдача → подписка/entitlement → видимость → UI → runtime SoT, без допущений по названиям и без решений по похожести строк.

---

### ОБЯЗАТЕЛЬНЫЙ ПРИНЦИП

**«Названия могут быть похожими. ID — уникален. Все решения принимает только ID.»**

Во всех runtime-цепочках source of truth:
- product_id
- tariff_id
- offer_id
- training_module_id
- при необходимости order_id / subscription_id

Названия, коды, slug, short label, snapshot text — только для отображения и текстового поиска.

**Зафиксировано:**
- cb20 = отдельный продукт «Ценный бухгалтер | 1 ступень 2.0» (product_id: 7101ed3c)
- prd_0d01a2fdc477 = отдельный продукт «Ценный бухгалтер | 2 ступень» (product_id: 87a8870f)
- Это НЕ parent/child, НЕ версии одного продукта. Любые выводы по похожести названий ошибочны.

**Запрещено:**
- Делать выводы по похожести имён
- Связывать продукты по тексту
- Считать code/name/slug surrogate key
- Принимать execute-решения по доступам без ID и runtime proof
- Если поле можно менять в UI, но runtime на него не смотрит — это SoT mismatch

---

### СТАТУС ПАТЧЕЙ

| Патч | Статус | Примечание |
|---|---|---|
| PATCH 1 | **closed** | |
| PATCH 2 | **closed** | 12 ghost кейсов — не баг |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **closed** | |
| PATCH-DERGELEVA-BROWSER-PROOF | **closed** | Manual proof от пользователя |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | **closed** | Root cause доказан |
| PATCH-KOROLYOVA-REVOKE-GUARD-FIX | **closed** | Guard A: proven, Guard B: code-proved |
| PATCH 3 ACCESS-SCOPE-FORENSICS | **closed** | Все фазы завершены |
| PATCH-DEALS-SEARCH-RESOLVER-FIX | **done** | RPC: поиск по product name, code, tariff name. UX-only text search, после выбора — только ID |
| PATCH-NAMING-NORMALIZATION-UI-FIRST | **done** | Badges, short labels, trim pipes, product_id visible |
| PATCH-REAL-FULFILLMENT-GAPS | **done** | 4/4 entitlements created for user 8482889a. Scope leakage=0 |
| PATCH-DEALS-SEARCH-BROWSER-PROOF | **done** | 9 терминов проверены, deals_search_proof.csv создан |
| PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF | **done** | field_binding_runtime_matrix.csv создан, auto_renew hardcode доказан |
| PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION-PROOF | **done** | product_identity_runtime_matrix.csv + id_vs_name_conflict_cases.csv |
| PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX | **pending** | Только после discovery matrix. auto_renew hardcoded → нужен execute |
| PATCH-GRANULAR-MODULE-BINDING-NORMALIZATION | **discovery** | Сначала бизнес-проверка |
| 49 cb_module_ip | **hold** | manual_or_bulk_unconfirmed, revoke запрещён |
| PATCH 4 duration drift | pending | |

---

### УСТАНОВЛЕННЫЕ ВЫВОДЫ (fact SoT)

| Вывод | Статус | Доказательство |
|---|---|---|
| covered_by_business_club_rule — легальный доступ | **FACT** | Правила BUSINESS-клуба |
| historical_expired — не баг | **FACT** | Истекшие подписки, штатный цикл |
| subscription_product_no_entitlement_needed | **FACT** | SoT для Club = subscriptions_v2 |
| Вкладка «Доступы» = config-view, не fact-view | **FACT** | Отображает access_rules |
| Default deny: нет binding = deny | **FACT** | Стандарт зафиксирован |
| Guard A (stale date override) | **FACT** | Synthetic proof |
| Guard B (kick grace window) | **CODE-PROVED** | Нет production event |
| DERGELEVA browser proof | **FACT** | Manual proof |
| Deals search SoT = RPC only | **FACT** | PostgREST — pill/filter/date only |
| auto_renew hardcoded in grant-access-for-order | **FACT** | L525: true для всех. bepaid-webhook L3871 не ставит — DB default |
| tariffs.is_subscription = dead_field | **FACT** | UI toggle есть, но ни один runtime код не читает |
| auto_charge_delay_days = misleading_ui_field | **FACT** | Поле в tariff_offers, но charge logic не читает |
| requires_card_tokenization = used_runtime | **FACT** | bepaid-webhook L3600, bepaid-create-token, direct-charge |
| grace/retry logic = working correctly | **FACT** | subscription-charge: 3 attempts, grace start/end, expired_reentry |

---

### ФИНАЛЬНЫЙ REBUCKETING: 477 paid orders

| Bucket | Count | Verdict |
|---|---|---|
| no_user_id_imported | 278 | NOT BUG |
| historical_expired | 146 | NOT BUG |
| subscription_product_no_entitlement_needed | 20 | LEGAL |
| module_covered_by_parent_cb20 | 17 | LEGAL |
| covered_by_business_club_rule | 7 | LEGAL |
| legacy_or_test_noise | 4 | NOT BUG |
| entitlement_exists_by_code | 1 | NOT BUG |
| **real_fulfillment_gap** | **4** | **FIXED** (2026-04-06) |
| **ИТОГО** | **477** | |

---

### PATCH-REAL-FULFILLMENT-GAPS — ОТЧЁТ

**Выполнено 2026-04-06.**

Scope: immutable, 4 order_id, 1 user_id.
- user_id = 8482889a-51f9-4f4b-ac23-6f4b59db51b1
- profile_id = 3dcf1b28-67a8-4ec2-b7cd-dfff87ebb59f
- order 8fa2d97d → cb_module_retail → entitlement b109bdae
- order ab2f4972 → cb_module_catering → entitlement b8042bab
- order 4d00d924 → cb_module_production → entitlement a29fe042
- order 01b81165 → cb_module_marketplaces → entitlement aad648ed

Guards:
- Duplicate guard: PASS (0 existing)
- Business model guard: PASS (all category=module, standalone, duration_days=NULL)
- Scope leakage: 0 (total entitlements 6 = 2 before + 4 new)
- Audit_logs: 4 entries, action=entitlement.backfilled

SoT по полям:
- user_id ← orders_v2.user_id
- product_id ← orders_v2.product_id
- product_code ← products_v2.code
- order_id ← конкретный заказ
- profile_id ← order/profile linkage
- expires_at ← NULL (standalone module, no subscription, perpetual access)
- meta.source = fulfillment_gap_backfill
- meta.patch = PATCH-REAL-FULFILLMENT-GAPS

---

### PATCH-DEALS-SEARCH-BROWSER-PROOF — ОТЧЁТ

**Выполнено 2026-04-06.**

Артефакт: `/mnt/documents/deals_search_proof.csv`

| Термин | Тип | RPC count | UI count | Match | Field |
|---|---|---|---|---|---|
| ценный бухгалтер | product_name | 577 | 577 | ✅ | products_v2.name |
| маркетплейсы | module_name | 5 | 5 | ✅ | products_v2.name |
| производство | module_name | 5 | 5 | ✅ | products_v2.name |
| учет у ип | module_name | 0 | 0 | ✅ | 0 orders for cb_module_ip |
| общепит | module_name | 2 | 2 | ✅ | products_v2.name |
| закрой год | product_name | 311 | 311 | ✅ | products_v2.name |
| премиум | tariff_name | 90 | 90 | ✅ | tariffs.name |
| business | tariff_name | 1251 | 1251 | ✅ | tariffs.name + products_v2.name |
| чат | — | 0 | 0 | ✅ | нет продуктов/тарифов |

Verdict: поиск работает корректно по products_v2.name, products_v2.code, tariffs.name. Все tabs совпадают.

---

### PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF — ОТЧЁТ

**Выполнено 2026-04-06.**

Артефакт: `/mnt/documents/field_binding_runtime_matrix.csv`

#### Ключевые находки:

1. **auto_renew** = `used_runtime`, но HARDCODED:
   - `grant-access-for-order` L525: `auto_renew: true` для ВСЕХ новых подписок
   - `bepaid-webhook` L3871: НЕ ставит auto_renew → DB default
   - UI toggle в EditDealDialog / subscription-admin-actions работает для СУЩЕСТВУЮЩИХ подписок
   - **Вывод: настройки продукта/тарифа НЕ влияют на initial auto_renew. Это SoT mismatch.**

2. **tariffs.is_subscription** = `dead_field`:
   - UI toggle существует в TariffForm
   - НИ ОДИН edge function не читает это поле
   - **Вывод: поле для красоты. Нужно либо подключить к runtime, либо убрать.**

3. **auto_charge_delay_days** = `misleading_ui_field`:
   - Поле в tariff_offers, редактируется в UI
   - Charge logic в subscription-charge НЕ читает это поле
   - **Вывод: misleading.**

4. **requires_card_tokenization** = `used_runtime`:
   - bepaid-webhook L3600, bepaid-create-token, direct-charge
   - Корректно определяет подписочность checkout

5. **Grace/retry** = `used_runtime`:
   - grace_period_started_at, grace_period_ends_at, grace_period_status, charge_attempts
   - Все работают корректно в subscription-charge

#### Особый кейс: course_close_year
- 70+ подписок с auto_renew=true
- Причина: `grant-access-for-order` L525 hardcodes `true` для ВСЕХ
- Настройки продукта/тарифа не влияют на это
- **Это системная проблема, не bug конкретного продукта**

#### Требуемые execute-патчи:
- PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX: auto_renew должен браться из tariff_offers.requires_card_tokenization или отдельного DB-flag, а не hardcode
- tariffs.is_subscription: подключить к runtime или убрать из UI
- auto_charge_delay_days: подключить к charge logic или убрать

---

### PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION-PROOF — ОТЧЁТ

**Выполнено 2026-04-06.**

Артефакты:
- `/mnt/documents/product_identity_runtime_matrix.csv`
- `/mnt/documents/id_vs_name_conflict_cases.csv`

#### Buckets:

**forbidden_business_identifier** (решение по тексту → нужна замена):
| Зона | Файл | Проблема |
|---|---|---|
| Hardcoded product_code sets | _shared/entitlement-sync.ts L17-29 | SUBSCRIPTION_BASED_CODES, ORDER_BASED_ONLY_CODES |
| Description-based matching | bepaid-auto-process L80-92 | descLower.includes('клуб'/'club'/'chat'/'business') |
| Description-based fallback | bepaid-auto-process L543-565 | titleLower.includes(tariffType) |
| Description mapping | bepaid-raw-transactions L139 | PRODUCT_TARIFF_MAPPINGS key match |
| Report fuzzy match | bepaid-report-import L299 | desc.includes(bepaid_plan_title) |

**legacy_transitional_usage** (временно допустимо, подлежит замене):
| Зона | Файл | Проблема |
|---|---|---|
| Product code compare | course-prereg-notify L67 | product_code === 'cb20_predzapis' |
| Entitlement by code | grant-access-for-order L233+ | product_code alongside product_id |
| Entitlement upsert | bepaid-webhook L3907 | productV2.code для entitlement |
| Staff email exclusion | admin-fix-club-billing-dates L198 | EXCLUDED_STAFF_EMAILS.includes |

**allowed_secondary_identifier** (допустимо для display/search):
| Зона | Файл | Использование |
|---|---|---|
| Static name map | src/lib/product-names.ts | UI display fallback |
| DB unique key | entitlement-sync.ts L183 | (user_id, product_code) — DB constraint |
| Payment classification | paymentClassification.ts L81 | 'проверка карты' — не бизнес-логика |

#### Name conflict cases (9 пар):
- cb20 ↔ prd_0d01a2fdc477: HIGH risk (курс vs курс, похожие названия)
- cb20 ↔ cb_module_*: MEDIUM risk (курс vs модуль, общий префикс)

---

### HIGH-RISK ЗОНЫ (ID-first audit)

| Зона | Файл | Проблема |
|---|---|---|
| Hardcoded product_code sets | _shared/entitlement-sync.ts | SUBSCRIPTION_BASED_CODES, ORDER_BASED_ONLY_CODES |
| Description-based matching | bepaid-auto-process | descLower.includes('клуб') |
| Description-based fallback | bepaid-auto-process | descLower.includes('club') |
| Static code→name map | product-names.ts | Hardcoded, не из БД |
| Entitlement by product_code | bepaid-webhook, grant-access-for-order | resolution по code, не id |
| Description mapping | bepaid-raw-transactions | PRODUCT_TARIFF_MAPPINGS |
| Report fuzzy match | bepaid-report-import | desc.includes(plan_title) |
| Name hack | course-prereg-notify | product_code === "cb20_predzapis" |

---

### ПОРЯДОК EXECUTE (следующие шаги)

1. ✅ **PATCH-REAL-FULFILLMENT-GAPS** — done
2. ✅ **PATCH-DEALS-SEARCH-BROWSER-PROOF** — done
3. ✅ **PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF** — done
4. ✅ **PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION-PROOF** — done
5. **PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX** — execute next
   - auto_renew: заменить hardcode на чтение из tariff_offers/DB flag
   - tariffs.is_subscription: подключить или убрать
6. **PATCH-ID-FIRST-HIGH-RISK-EXECUTE** — execute
   - Замена hardcoded code sets на DB flags
   - Перевод bepaid-auto-process на ID-based mapping
7. **DISCOVERY: GRANULAR-MODULE-BINDING**
8. **FOLLOW-UP: 49 cb_module_ip** — hold

---

### ЧТО НЕ ДЕЛАТЬ

- execute по auto_renew / field binding **пока не готов field_binding_runtime_matrix.csv** ✅ готов
- execute по ID-first normalization **пока не готов product_identity_runtime_matrix.csv** ✅ готов
- массовый cleanup по cb_module_ip
- revoke по бонусам/модулям
- считать naming fix архитектурным решением
- использовать вкладку «Доступы» как SoT до завершения аудита

---

### КОНТРАКТ ВИДИМОСТИ

Правила:
- Club, buh_business → SoT = subscriptions_v2
- cb20, course_close_year, ЦБ2 → SoT = entitlements
- Все модули → SoT = entitlements, requires_entitlement = yes
- consultation → service, entitlement не применим
- digital_product (вебинары) → entitlement не обязателен
- Нет binding/rule = deny (кроме админов)

---

### УРОВНИ ДОКАЗАТЕЛЬСТВ

- **FACT**: доказано synthetic proof, production data, или code verification
- **CODE-PROVED**: подтверждено анализом кода, нет production event
- **HYPOTHESIS**: требует проверки
- **CONFIG-VIEW**: отображает настройки, не реальное состояние
- **UNDECIDED**: требуется field-binding audit
