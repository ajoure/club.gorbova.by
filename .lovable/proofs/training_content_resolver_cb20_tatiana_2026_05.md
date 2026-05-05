# VERIFY: training_content resolver — cb20 / Татьяна Трубникова

Дата: 2026-05-05
User: 4870dfc5-6609-4e0c-96a9-20fbd2d05928 (tatsiana0708@yandex.ru)
Product: 7101ed3c-7839-4a74-ad95-aa0660369b22 (Ценный бухгалтер, cb20)
Training root: c9f7e9b8-e613-459a-91e3-38bbcfe424d8 (1 ступень 2.0)

## 1. Состояние данных (SOT)

entitlements (active):
- product 7101ed3c… → meta.tariff_id = 543940b1-99da-47f3-accc-671ad5b11afe, expires_at 2026-05-08 21:00 UTC

subscriptions_v2 (active):
- product 7101ed3c… → tariff_id = 543940b1-99da-47f3-accc-671ad5b11afe (P1 tariff matching стабилен)

access_rules (training_content, product 7101ed3c…, is_active=true):
- 63fbef2a-e74f-48d7-aaac-1aaad06cf6c8 → tariff 543940b1… → allowed_module_ids = 18
- ecb37704… → tariff adbe94e8… → 25
- fc9e584e… → tariff 9bc81736… → 28

## 2. Симуляция резолвера (resolveTrainingContentFilter)

Вход:
- productId = 7101ed3c…
- trainingModuleId = c9f7e9b8…
- userTariffIds = [7c748940…, 543940b1…]
- entitlementTariffsByProduct[7101ed3c…] = [543940b1…]

Результат:
```
matched_rule_id   = 63fbef2a-e74f-48d7-aaac-1aaad06cf6c8
rule_source       = db_tariff           (P1)
allowed_module_count = 18
synthetic_legacy  = НЕ выбран (suppressed by productsWithDbRules)
rule_unresolved   = НЕ сработал (P1 matched)
```

Ожидание клиента (1 ступень 2.0, 18 модулей) выполнено.

## 3. Регрессионная проверка (статический анализ resolveTrainingContentFilter)

- module_scope_only → синтетика P3 (synthetic_bonus) с явным allowlist; full access не возникает.
- rule_unresolved → возвращает `{ mode:"partial", allowedModuleIds: ∅ }` (default-deny), full access невозможен.
- bonus / no-meta entitlement БЕЗ DB rules для product → P4 synthetic_legacy сохраняется (старое поведение).
- Root-карточка: useSidebarModules показывает root, если есть видимые child modules (логика `hasVisibleChildren || isModAllowed(filter, m.id)`).

## 4. Debug flag

- Файл src/lib/trainingContentDiag.ts: лог идёт ТОЛЬКО при `localStorage.getItem('debug.training_content') === '1'`.
- Без флага — `console.info` не вызывается. PII (email/имя) не пишется, только UUID.

## 5. UI runtime verify (требуется на стороне клиента)

В кабинете Татьяны:
1. Открыть «Моя библиотека» → должна появиться карточка
   `Ценный бухгалтер | 1 ступень 2.0`.
2. Внутри — ровно 18 доступных модулей (соответствует rule 63fbef2a…).
3. В DevTools → Console:
   ```js
   localStorage.setItem('debug.training_content','1');
   location.reload();
   ```
   Ожидаемый лог `[training_content_diag]`:
   ```
   product_id            = 7101ed3c-7839-4a74-ad95-aa0660369b22
   entitlement_tariff_id = 543940b1-99da-47f3-accc-671ad5b11afe
   subscription_tariff_ids ⊇ [543940b1-99da-47f3-accc-671ad5b11afe]
   matched_rule_id       = 63fbef2a-e74f-48d7-aaac-1aaad06cf6c8
   rule_source           = db_tariff
   allowed_module_count  = 18
   ```
4. Снять флаг: `localStorage.removeItem('debug.training_content')` → логи прекращаются.

## PASS/FAIL (по код-/данным-стороне)

- [PASS] P1 db_tariff матчит rule 63fbef2a (18 модулей)
- [PASS] synthetic_legacy подавлен для product с DB rules
- [PASS] rule_unresolved = default-deny, не full access
- [PASS] debug-лог opt-in, без PII
- [PENDING — UI] Подтверждение клиентом: карточка cb20 + 18 модулей видны в «Моя библиотека»

После UI-подтверждения Татьяной — фикс закрывается окончательно.
