# Отчёт о Discovery: section_access

Дата: 2026-04-08

---

## Раздел A: PROOF / ФАКТЫ (доказано SQL/code)

### A1. Текущее состояние access_rules

**Proof (SQL):**
```sql
SELECT grant_target_type, count(*) FROM access_rules GROUP BY 1;
```

| grant_target_type  | count |
|--------------------|-------|
| training_content   | 23    |
| product_access     | 9     |
| club               | 2     |
| entitlement        | 0     |
| email              | 0     |
| **Итого**          | **34** |

**CHECK constraint (факт из pg_constraint):**
```
CHECK (grant_target_type = ANY (ARRAY[
  'entitlement','club','email','product_access','training_content'
]))
```

**Scope constraint (факт):**
```
CHECK (product_id IS NOT NULL OR tariff_id IS NOT NULL)
```

### A2. Legacy типы — status

#### email (SQL + code proof)
- Записей в access_rules: **0**
- Записей в product_email_mappings: **0**
- Runtime consumers: **НЕТ** (grant-access-for-order игнорирует, access-resolver не обрабатывает)
- UI: лейбл в `TARGET_TYPE_LABELS`, но скрыт фильтром `.filter(([k]) => k !== "entitlement" && k !== "email")` в ProductAccessRulesTab (строка ~1221)
- getRuntimeSupport('email'): **"partial"** (файл `src/hooks/useAccessRules.ts`, строка 544)
- **Статус: мёртвый тип, сохраняется в CHECK и union, не мигрируется, авто-миграция email → section_access запрещена**

#### entitlement (SQL + code proof)
- Записей в access_rules: **0**
- Runtime consumers: **НЕТ** — ни grant-access-for-order, ни access-resolver, ни rules-retroapply не содержат ветки для `grant_target_type='entitlement'`
- UI: скрыт тем же фильтром `.filter(([k]) => k !== "entitlement" && k !== "email")`
- **getRuntimeSupport('entitlement'): "full"** (файл `src/hooks/useAccessRules.ts`, строка 542)

**⚠ PROOF: getRuntimeSupport('entitlement') = "full" — ошибочная метка.**
- Расположение: `src/hooks/useAccessRules.ts`, строка 542: `case "entitlement": return "full";`
- Это **legacy UI-метка**, а НЕ доказательство реального runtime consumer
- Фактически ни один edge function, resolver или fulfillment pipeline не обрабатывает тип `entitlement`
- Метка существует только для отображения badge в ProductAccessRulesTab
- **Вывод:** значение "full" не означает поддержку. Это legacy-артефакт, который не трогается в текущем спринте, но НЕ должен использоваться как обоснование для создания правил типа `entitlement`

### A3. Runtime flow — как сейчас работают access_rules

```
ВЫДАЧА (fulfillment):
  order paid → grant-access-for-order EF
    → access-resolver.ts:
      → resolveClubGrants (club)
      → resolveProductAccessGrants (product_access)
      → resolveTrainingContentFilters (training_content, read-side only)
    → НЕ обрабатывает: email, entitlement

ПРОВЕРКА (frontend):
  useSidebarModules → subscriptions_v2 + entitlements + module_access + training_content rules
  AppSidebar → СТАТИЧЕСКИЙ массив, БЕЗ проверки доступа к секциям
  ProtectedRoute → только auth (user != null), без section gating

ОТЗЫВ:
  access-revoker → ledger → revoke entitlements/subscriptions
  НЕ трогает access_rules
```

**STOP-guard:** rules-retroapply и fulfillment pipeline (grant-access-for-order, access-resolver) **НЕ затрагиваются** в текущем спринте. section_access — read-side concern.

### A4. Карта секций сайдбара — текущее состояние

| section_key | route | page component | access logic сейчас | page-internal gating |
|-------------|-------|---------------|-------------------|---------------------|
| dashboard | /dashboard | Dashboard.tsx | auth only | Нет |
| knowledge | /knowledge | Knowledge.tsx | auth + useSidebarModules | per-module |
| money | /money | Money.tsx | auth only | inline `buh_business` entitlement check |
| self_development | /self-development | SelfDevelopment.tsx | auth only | Нет |
| ai | /ai | AI.tsx | auth only | Нет |
| live | /live | LiveEvents.tsx | auth only | per-event via live_event_access_rules |
| products | /products | Learning.tsx | auth + useSidebarModules | per-module |
| eisenhower | /tools/eisenhower | EisenhowerMatrix.tsx | auth only | Нет |

**Факт:** Ни одна секция сейчас не закрыта целиком (section-level gating отсутствует).

### A5. Код — где упоминается GrantTargetType (code proof)

| Файл | Использование |
|------|--------------|
| `src/hooks/useAccessRules.ts:5` | Тип union: `"entitlement" \| "club" \| "email" \| "product_access" \| "training_content"` |
| `src/hooks/useAccessRules.ts:538` | getRuntimeSupport — switch по типам |
| `src/components/admin/product/ProductAccessRulesTab.tsx:48` | TARGET_TYPE_LABELS — лейблы UI |
| `src/components/admin/product/ProductAccessRulesTab.tsx:56` | TARGET_TYPE_ICONS — иконки |
| `src/components/admin/product/ProductAccessRulesTab.tsx:1221` | Фильтр: скрывает email и entitlement в селекторе |
| `src/hooks/useTrainingContentRules.ts` | `.eq("grant_target_type", "training_content")` |
| `src/hooks/useProductTrainings.ts` | `.eq("grant_target_type", "training_content")` |
| `src/components/admin/product/RetroApplyPanel.tsx:279` | `.includes(r.grant_target_type)` для club/product_access |

**Факт:** section_access нигде в коде не упоминается. Это чисто новый тип.

### A6. Существующие page-internal проверки (code proof)

**Money.tsx:** Имеет inline-проверку entitlement с `product_code='buh_business'` для tab-контента. Это **не** section-level gating, а tab-level.

**LiveEvents.tsx:** per-event access через `live_event_access_rules` — отдельная система.

**Knowledge/Products:** Доступ управляется через useSidebarModules (module_access + entitlements + training_content rules).

### A7. Таблица app_sections — НЕ существует (SQL proof)

```sql
SELECT 1 FROM information_schema.tables WHERE table_name='app_sections';
-- 0 rows
```

---

## Раздел B: АРХИТЕКТУРНЫЕ РЕШЕНИЯ

### B1. section_access — новый тип (add-only)

- Добавляется как 6-й тип в CHECK constraint
- email и entitlement НЕ удаляются, НЕ переименовываются
- Авто-миграция email → section_access запрещена
- Это осознанное решение: add-only, без destructive changes

### B2. Source of Truth для section_access

- `tariff_id` заполнен → SoT = `subscriptions_v2.tariff_id` + status IN ('active','trial')
- `product_id` заполнен, `tariff_id` IS NULL → SoT = `subscriptions_v2.product_id` ИЛИ `entitlements.product_id`
- Оба заполнены → `tariff_id` единственный критерий, `product_id` только для лейбла
- Обоснование: согласовано с memory/architecture/access-control/club-product-sot

### B3. Mapping target_ref

- `target_ref` хранит UUID `app_sections.id` (не code)
- `target_label` — snapshot label на момент создания правила
- Soft-FK (без constraint), согласовано с паттерном club
- Orphan rules (target_ref не найден) → игнорируются resolver, помечаются в админке

### B4. safe_uuid helper

- target_ref::uuid прямой cast опасен для невалидных строк
- Решение: RPC использует LANGUAGE plpgsql с safe-cast через regex
- Невалидные target_ref → правило игнорируется

### B5. RPC auth model

- Неаутентифицированный вызов (auth.uid() IS NULL) → пустой массив, early return
- Обычный пользователь: RPC всегда проверяет по `auth.uid()`, параметр `p_user_id` игнорируется
- Admin: может передать `p_user_id` для диагностики чужого пользователя
- Guard: `IF NOT has_role_v2(auth.uid(), 'admin') THEN effective_uid = auth.uid()`

### B6. Двухуровневая проверка доступа (контракт)

```
Уровень 1 — SectionGuard: доступ к разделу целиком
Уровень 2 — Page-internal: Money.tsx buh_business, LiveEvents per-event, etc.

section_access НЕ заменяет page-internal checks.
live section_access может закрывать вход в /live целиком,
но НЕ управляет доступом к конкретным эфирам (это live_event_access_rules).
```

### B7. Sidebar — чисто визуальный уровень

- Lock-иконка — только визуальная индикация
- Клик допустим, ведёт на страницу
- Финальное решение принимает SectionGuard на странице
- Admin НЕ видит lock-иконок (bypass)

### B8. Fallback при ошибке RPC

- Hidden rollout (все is_public=true): default allow
- Visible rollout, is_public=false: default DENY + error UI
- Kill-switch: app_settings key `section_gating_enabled` (таблица app_settings, JSON value `{"enabled": false}`)
- При kill-switch = false: все проверки → allow

### B9. Scope ограничения текущего спринта

**НЕ затрагиваются:**
- rules-retroapply — без изменений
- grant-access-for-order — без изменений
- access-resolver.ts — без изменений
- fulfillment pipeline — без изменений
- subscriptions_v2, entitlements — структура не меняется

---

## Раздел C: РИСКИ

| # | Риск | Вероятность | Митигация |
|---|------|-------------|-----------|
| 1 | ALTER CHECK ломает insert существующих типов | Низкий | add-only, тестовые INSERT после ALTER |
| 2 | Money.tsx inline-проверка конфликтует | Низкий | section_access — уровень выше, inline остаётся |
| 3 | Пользователи теряют доступ к ранее открытым разделам | Высокий → 0 | is_public=true по умолчанию, gating только вручную |
| 4 | target_ref невалидный UUID → RPC падает | Средний | safe_uuid regex, plpgsql guard |
| 5 | Sidebar и SectionGuard рассинхрон | Средний | единый hook, один queryKey, один TTL |
| 6 | RPC ошибка открывает закрытый контент | Высокий | default DENY для gated sections в visible rollout |
| 7 | Orphan rules после удаления секции | Низкий | soft-FK, resolver игнорирует, badge в админке |
| 8 | Overgrant при product_id+tariff_id | Средний → 0 | tariff_id единственный критерий при обоих |
| 9 | auth.uid() IS NULL → неявное поведение | Средний | early return пустого массива |
