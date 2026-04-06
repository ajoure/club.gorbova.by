## CONSOLIDATED SPRINT — EXECUTE PHASE

Основная нить: **purchase → subscription → entitlement → visibility → UI label → fact/config SoT**.

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
| PATCH-REAL-FULFILLMENT-GAPS | **ready** | 4 gap-кейса, backfill после naming |
| PATCH-PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION | **discovery** | Audit всех мест с text-based logic |
| PATCH-PRODUCT-TARIFF-OFFER-FIELD-BINDING-AUDIT | **discovery** | Какие поля runtime vs decorative |
| PATCH-UI-FIELD-TO-RUNTIME-BINDING-PROOF | **discovery** | Доказать UI toggle → runtime binding |
| PATCH-REMOVE-SLUG-DEPENDENCY-FROM-BUSINESS-LOGIC | **discovery** | slug/code только для display |
| PATCH-PAYMENT-BUTTON-SUBSCRIPTION-SOT-FIX | **pending** | Только после discovery matrix |
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
| auto_renew hardcoded in grant-access-for-order | **UNDECIDED** | L525: true для всех. Требуется field-binding audit |

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
| **real_fulfillment_gap** | **4** | **BUG** |
| **ИТОГО** | **477** | |

---

### ПОРЯДОК EXECUTE

1. **PATCH-DEALS-SEARCH-RESOLVER-FIX** ✅ done
2. **PATCH-NAMING-NORMALIZATION-UI-FIRST** ✅ done
   - getCategoryBadge.ts, getShortDisplayName, ProductCategoryBadge
   - Badges во всех 8 точках: AdminDeals, DealDetailSheet, ContactDetailSheet, ContactPaymentsTab, ContactDealsDialog, LinkDealDialog, LinkSubscriptionDealDialog
   - Trailing pipes убраны у cb20 и prd_0d01a2fdc477
   - Product ID виден в detail views (CopyableIdChip)
3. **DISCOVERY: PRODUCT-IDENTITY-ID-FIRST-NORMALIZATION** — next
   - Артефакт: product_identity_runtime_matrix.csv
   - Артефакт: id_vs_name_conflict_cases.csv
4. **DISCOVERY: UI-FIELD-TO-RUNTIME-BINDING-PROOF** — parallel
   - Артефакт: field_binding_runtime_matrix.csv
5. **PATCH-REAL-FULFILLMENT-GAPS** — после discovery
6. **DISCOVERY: GRANULAR-MODULE-BINDING**
7. **FOLLOW-UP: 49 cb_module_ip** — hold

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

### УРОВНИ ДОКАЗАТЕЛЬСТВ

- **FACT**: доказано synthetic proof, production data, или code verification
- **CODE-PROVED**: подтверждено анализом кода, нет production event
- **HYPOTHESIS**: требует проверки
- **CONFIG-VIEW**: отображает настройки, не реальное состояние
- **UNDECIDED**: требуется field-binding audit
