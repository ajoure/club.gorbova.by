## Отчет о выполнении: CONSOLIDATED SPRINT — FINAL REBUCKETING & EXECUTE PLANS

Главный вопрос: **почему у пользователя есть конкретный доступ, почему он видит конкретный модуль, как это названо в UI, и совпадает ли с реальной сущностью в БД**.

---

### Статус-блок

| Патч | Статус |
|---|---|
| PATCH 1 | closed |
| PATCH 2 | partial — 12 ghost кейсов |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **closed** |
| PATCH-DERGELEVA-BROWSER-PROOF | **closed** |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | **root cause proved** |
| PATCH-KOROLYOVA-REVOKE-GUARD-FIX | Guard A: **proven (synthetic)**, Guard B: **code-proved** |
| PATCH 3 ACCESS-SCOPE-FORENSICS | **done — all phases** |
| PATCH-GRANULAR-MODULE-BINDING-NORMALIZATION | **ready for execute** |
| PATCH-NAMING-NORMALIZATION-UI-FIRST | **ready for execute** |
| PATCH-REAL-FULFILLMENT-GAPS | **ready for execute** |
| 49 cb_module_ip | **manual_or_bulk_unconfirmed_business_basis** — revoke запрещён |
| PATCH 4 duration drift | pending |

---

### ФИНАЛЬНЫЙ REBUCKETING: 477 paid orders без active entitlement

**Фраза "122/461/469 paid_but_no_entitlement" — УБРАНА как вводящая в заблуждение.**

| Bucket | Count | Verdict | Объяснение |
|---|---|---|---|
| no_user_id_imported | 278 | NOT BUG | Импортированные заказы без user_id — entitlement физически невозможен |
| historical_expired | 146 | NOT BUG | Истекшие подписки/entitlements, штатный жизненный цикл |
| subscription_product_no_entitlement_needed | 20 | LEGAL | SoT = subscriptions_v2 (Club, buh_business, consultation) |
| module_covered_by_parent_cb20 | 17 | LEGAL (if included) | У пользователя active cb20 entitlement |
| covered_by_business_club_rule | 7 | LEGAL | BUSINESS-тариф клуба покрывает доступ к ЦБ |
| legacy_or_test_noise | 4 | NOT BUG | Тестовый продукт |
| entitlement_exists_by_code | 1 | NOT BUG | Entitlement есть, но привязан по product_code |
| **real_fulfillment_gap** | **4** | **BUG** | 1 пользователь (Бруйло), 4 модуля |
| **ИТОГО** | **477** | | |

**Реальных багов: 4** (все — 1 пользователь, 4 модульных заказа без entitlement).

---

### KOROLYOVA GUARDS — PROOF STATUS

| Guard | Proof | Статус |
|---|---|---|
| Guard A (stale date override) | Synthetic curl → `subscription.stale_date_overridden` в audit_logs (id: bba06866) | ✅ PROVEN |
| Guard B (kick grace window) | Code-verified: L365-396 в telegram-kick-violators, skip для provider_managed < 48h | ⚠️ CODE-PROVED, нет production event |

---

### 3 TRAINING MODULES — БИЗНЕС-ПРОВЕРКА

| Модуль | Standalone заказы | Часть cb20 | Бизнес-модель | Рекомендация |
|---|---|---|---|---|
| Общепит | 2 paid | да (parent=cb20_root) | **dual** | Rule-based visibility |
| ПВТ | 0 | да (parent=cb20_root) | part_of_cb20 only | Rule-based visibility |
| Строительство | 1 paid | да (parent=cb20_root) | **dual** | Rule-based visibility |

**Все 3 модуля имеют product_id=NULL в training_modules.** Привязаны к дереву cb20 через parent_module_id.

**Вывод:** Простой UPDATE product_id недостаточен, т.к. Общепит и Строительство — dual model (и standalone, и часть cb20). Нужен rule-based visibility через access_rules, а не жёсткая перепривязка.

---

### 49 cb_module_ip — СТАТУС

**Классификация: `manual_or_bulk_unconfirmed_business_basis`**

- Выданы через bulk_grant (batch a2ff3724, 2026-03-27)
- Нет связанных paid orders
- Массовый revoke **ЗАПРЕЩЁН** до выяснения бизнес-основания
- Не является cleanup-candidate и не является auto-revoke

---

### EXECUTE PLAN: PATCH-GRANULAR-MODULE-BINDING-NORMALIZATION

**Цель:** Пользователь с entitlement на cb20 не должен автоматически видеть модуль, который продаётся как самостоятельный продукт.

**DoD:**
1. Каждый продаваемый отдельно модуль имеет собственный product_id в training_modules
2. Fallback на parent допустим ТОЛЬКО для модулей, входящих в основной продукт по бизнес-логике
3. Для dual-модулей (Общепит, Строительство) — rule-based visibility через access_rules
4. Default deny: нет binding/rule = visibility denied

**Блокер:** Нужно бизнес-решение по каждому из 3 модулей — какие пользователи cb20 должны видеть их бесплатно, а какие нет.

---

### EXECUTE PLAN: PATCH-NAMING-NORMALIZATION-UI-FIRST

**Стратегия: UI-First.** Не менять products_v2.name массово. 

**Три уровня отображения:**
- `canonical_name_db` — products_v2.name (только точечная чистка trailing pipes)
- `short_display_name_ui` — короткий лейбл в UI (напр. "Модуль: Общепит")
- `entity_badge` — course / module / subscription / service

**Экраны для обновления (все используют getDealDisplayName):**
1. Список сделок (AdminDeals.tsx) — HIGH
2. Карточка сделки (DealDetailSheet.tsx) — HIGH
3. Карточка контакта (ContactDetailSheet.tsx) — HIGH
4. История оплат (ContactPaymentsTab.tsx) — HIGH
5. Связанные сделки bePaid (ContactDealsDialog.tsx) — MEDIUM
6. Привязка сделки/подписки (LinkDealDialog, LinkSubscriptionDealDialog) — MEDIUM

**DB fixes (LOW):**
- cb20: убрать trailing `|` → "Ценный бухгалтер 1 ступень 2.0"
- prd_0d01a2fdc477: убрать trailing `| ` → "Ценный бухгалтер 2 ступень"

**Зона ЦБ — обязательное разделение в UI:**
- Основной продукт: badge "Курс"
- Отдельный модуль: badge "Модуль" + короткое имя
- Тариф: отдельная строка, не подменяет продукт

---

### EXECUTE PLAN: PATCH-REAL-FULFILLMENT-GAPS

**4 реальных бага** (1 пользователь — Анна Бруйло, a.bruylo@ajoure.by):
- cb_module_retail (order GC-3830657-M1)
- cb_module_catering (order GC-3830657-M2)
- cb_module_production (order GC-3830657-M3)
- cb_module_marketplaces (order GC-3830657-M5)

**Root cause:** fulfillment_broken — paid order создан, но entitlement не был выдан.

**Fix:** Backfill 4 entitlements для user_id 8482889a через grant-access-for-order.

---

### PRODUCT VISIBILITY CONTRACT MATRIX

Артефакт: `product_visibility_contract_matrix.csv`

Ключевые правила:
- Club, buh_business → SoT = subscriptions_v2, entitlement не обязателен
- cb20, course_close_year, ЦБ2 → SoT = entitlements (+ subscriptions для курсов)
- Все модули → SoT = entitlements, requires_entitlement = yes
- consultation → service, entitlement не применим
- digital_product (вебинары) → entitlement не обязателен

---

### АРТЕФАКТЫ

| Файл | Описание |
|---|---|
| paid_no_entitlement_final_rebucketed.csv | Финальная классификация 477 paid-no-entitlement |
| real_fulfillment_gaps_detail.csv | 4 реальных бага с root cause |
| product_visibility_contract_matrix.csv | Единый контракт видимости по всем продуктам |
| naming_normalization_ui_first_plan.csv | План нормализации по экранам |
| training_module_business_check.csv | Бизнес-проверка 3 модулей |

---

### СЛЕДУЮЩИЙ ШАГ

Порядок execute-патчей (после утверждения):
1. **PATCH-REAL-FULFILLMENT-GAPS** — backfill 4 entitlements (минимальный риск)
2. **PATCH-NAMING-NORMALIZATION-UI-FIRST** — entity badges + trailing pipe cleanup
3. **PATCH-GRANULAR-MODULE-BINDING-NORMALIZATION** — rule-based visibility (требует бизнес-решения)

Массовые revoke/cleanup запрещены до полной цепочки: покупка → продукт → subscription → entitlement → visibility → UI label.
