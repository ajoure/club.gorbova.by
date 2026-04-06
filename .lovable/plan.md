## CONSOLIDATED SPRINT — EXECUTE PHASE

Основная нить: **purchase → subscription → entitlement → visibility → UI label → fact/config SoT**.

---

### СТАТУС ПАТЧЕЙ

| Патч | Статус | Примечание |
|---|---|---|
| PATCH 1 | **closed** | |
| PATCH 2 | **closed** | 12 ghost кейсов — не баг |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **closed** | |
| PATCH-DERGELEVA-BROWSER-PROOF | **closed** | Manual proof от пользователя: техподдержка и контакт-центр открывают одинаковые карточки |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | **closed** | Root cause доказан |
| PATCH-KOROLYOVA-REVOKE-GUARD-FIX | **closed** | Guard A: proven (synthetic), Guard B: code-proved |
| PATCH 3 ACCESS-SCOPE-FORENSICS | **closed** | Все фазы завершены |
| PATCH-DEALS-SEARCH-RESOLVER-FIX | **done** | RPC обновлены: поиск по product name, code, tariff name |
| PATCH-NAMING-NORMALIZATION-UI-FIRST | **next** | UI badges + short labels + trim separators |
| PATCH-REAL-FULFILLMENT-GAPS | **ready** | 4 gap-кейса, backfill после naming |
| PATCH-GRANULAR-MODULE-BINDING-NORMALIZATION | **discovery** | Сначала бизнес-проверка, потом execute |
| 49 cb_module_ip | **hold** | manual_or_bulk_unconfirmed_business_basis, revoke запрещён |
| PATCH 4 duration drift | pending | |

---

### УСТАНОВЛЕННЫЕ ВЫВОДЫ (fact SoT)

| Вывод | Статус | Доказательство |
|---|---|---|
| covered_by_business_club_rule — легальный доступ | **FACT** | Правила BUSINESS-клуба дают исторический доступ к ЦБ |
| historical_expired — не баг | **FACT** | Истекшие подписки, штатный жизненный цикл |
| subscription_product_no_entitlement_needed | **FACT** | SoT для Club = subscriptions_v2, entitlement не обязателен |
| Вкладка «Доступы» = config-view, не fact-view | **FACT** | Отображает access_rules, а не реальные entitlements |
| Default deny: нет binding = deny | **FACT** | Стандарт зафиксирован |
| Guard A (stale date override) | **FACT** | Synthetic proof, audit log bba06866 |
| Guard B (kick grace window) | **CODE-PROVED** | L365-396 telegram-kick-violators, нет production event |
| DERGELEVA browser proof | **FACT** | Manual proof пользователем |

---

### ФИНАЛЬНЫЙ REBUCKETING: 477 paid orders

**Фраза "paid_but_no_entitlement" как единая проблема — УБРАНА.**

| Bucket | Count | Verdict |
|---|---|---|
| no_user_id_imported | 278 | NOT BUG — импорт без user_id |
| historical_expired | 146 | NOT BUG — истекший срок |
| subscription_product_no_entitlement_needed | 20 | LEGAL — SoT = subscriptions_v2 |
| module_covered_by_parent_cb20 | 17 | LEGAL (if included in parent) |
| covered_by_business_club_rule | 7 | LEGAL — BUSINESS-тариф клуба |
| legacy_or_test_noise | 4 | NOT BUG — тест |
| entitlement_exists_by_code | 1 | NOT BUG |
| **real_fulfillment_gap** | **4** | **BUG** — 1 пользователь, 4 модуля |
| **ИТОГО** | **477** | |

**Реальных багов: 4** (Анна Бруйло, 4 модульных заказа без entitlement).

---

### ПОРЯДОК EXECUTE

1. **PATCH-DEALS-SEARCH-RESOLVER-FIX** ✅ done
   - RPC `search_deal_rows` и `get_deal_tab_counts` теперь ищут по `products_v2.name`, `products_v2.code`, `tariffs.name`

2. **PATCH-NAMING-NORMALIZATION-UI-FIRST** — next
   - UI badges: course / module / service / subscription
   - Short labels для модулей
   - Trim trailing `|` у cb20 и ЦБ 2
   - Тариф — отдельное поле, не смешивать с продуктом
   - Экраны: список сделок, карточка сделки, карточка контакта, история оплат
   - После: убедиться что поиск находит и short label и canonical DB name

3. **PATCH-REAL-FULFILLMENT-GAPS** — ready
   - Только 4 реальных gap (Бруйло): cb_module_retail, catering, production, marketplaces
   - Dry-run → backfill entitlements

4. **DISCOVERY: GRANULAR-MODULE-BINDING-NORMALIZATION**
   - Бизнес-проверка: standalone vs dual vs parent-only для каждого модуля
   - Где visibility через parent, где через standalone entitlement
   - Где content физически не развязан
   - Только после discovery → execute plan

5. **FOLLOW-UP: 49 cb_module_ip**
   - Статус: manual_or_bulk_unconfirmed_business_basis
   - Нужно: batch source, actor, reason, affected users
   - Revoke запрещён до бизнес-proof

---

### КОНТРАКТ ВИДИМОСТИ

Артефакт: `product_visibility_contract_matrix.csv`

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
