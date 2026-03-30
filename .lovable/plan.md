# Sprint v23.1 — Access Rules UI completion

## Статус

```
SPRINT = v23.1
PHASE_0 = DONE (discovery / SoT audit)
PHASE_1 = DONE (UI taxonomy + mapping matrix)
PHASE_2 = DONE (form redesign + selectors)
PHASE_3 = DONE (effective preview / explain / source resolution)
PHASE_4 = DONE (legacy/fallback visibility + conflict states)
PHASE_5 = DONE (duration model)
PHASE_6 = DONE (advanced/settings cleanup)
```

## Цель

Довести вкладку «Доступы» до полноценного админского интерфейса, где видно бизнес-смысл: что именно получит покупатель при покупке продукта/тарифа.

---

## Phase 0 — Discovery / SoT Audit

### Источники данных для селекторов

| Тип выдачи | Источник данных | Кол-во записей | Поля |
|---|---|---|---|
| Telegram-клуб | `telegram_clubs` | 2 | id, club_name, chat_id, channel_id, access_mode |
| Продукт | `products_v2` | 23 | id, name, code |
| Entitlement | `entitlements` (product_code) | 9 уникальных | product_code |
| Email/домен | `email_accounts` | 2 placeholder | id, email |

### Legacy mappings

| Таблица | Записей | Описание |
|---|---|---|
| `product_club_mappings` | 2 | Gorbova Club → product Gorbova Club, Бухгалтерия → product Бухгалтерия |
| `product_email_mappings` | 0 | Нет записей |

### Gaps (обнаружены)

- **Справочник доменов/разделов** — НЕ существует. `email_accounts` содержит placeholder emails, не бизнес-разделы.
- **access_rules** — таблица пустая, правила ещё не создавались.
- **runtime для "часть продукта / тренинг / урок"** — НЕ поддержан. Нет edge function handlers.

### Effective access compute path

1. `access_rules` (tariff-level) → приоритет 1
2. `access_rules` (product-level, tariff_id IS NULL) → приоритет 2
3. `product_club_mappings` → legacy fallback
4. `product_email_mappings` → legacy fallback

### Файлы, участвующие в access grant flow

| Файл | Роль |
|---|---|
| `src/hooks/useAccessRules.ts` | CRUD + effective grants + legacy mappings |
| `src/hooks/useAccessRuleSelectors.ts` | Selector hooks (clubs, products, entitlements, tariff durations) |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | UI компонент |
| `supabase/functions/grant-access-for-order/index.ts` | Runtime: rules → legacy fallback |

---

## Phase 1 — UI Taxonomy + Mapping Matrix

### Mapping matrix

| UI тип | DB `grant_target_type` | Storage | Runtime support | Selector source |
|---|---|---|---|---|
| Доступ в Telegram-клуб | `club` | target_ref = club UUID | **full** | `telegram_clubs` |
| Доступ к продукту | `product_access` | target_ref = product UUID | **full** | `products_v2` |
| Системное право доступа | `entitlement` | target_ref = product_code | **full** | `entitlements` distinct codes |
| Доступ к домену / разделу | `email` | target_ref = string | **partial** (нет справочника) | ручной ввод |

### НЕ реализовано в runtime (preview-only / deferred)

| UI тип | Причина |
|---|---|
| Доступ к части продукта | Нет runtime handler |
| Доступ к тренингу | Нет runtime handler |
| Доступ к части тренинга | Нет runtime handler |
| Доступ к уроку | Нет runtime handler |

Эти типы **не добавляются** в текущий UI, чтобы не создавать ложное ощущение готовности.

---

## Phase 2 — Form Redesign + Selectors

### Реализовано

- Форма разбита на 6 логических секций:
  1. Где действует (продукт/тариф + выбор тарифа с показом access_days)
  2. Что выдаём (русские типы, entitlement помечен как advanced)
  3. Куда выдаём (связанные селекторы по типу)
  4. Назначение (основной/бонус/дополнительный/служебный)
  5. Срок (из тарифа / вручную + пресеты)
  6. Дополнительно (приоритет, заметка, активность — collapsed)

### Selectors по типу

| Тип | Селектор | Fallback |
|---|---|---|
| `club` | `<Select>` из `telegram_clubs` с показом chat/channel | — |
| `product_access` | `<Select>` из `products_v2` | — |
| `entitlement` | `<Select>` из unique product_codes | — |
| `email` | `<Input>` с пояснением (справочник не создан) | ручной ввод |

---

## Phase 3 — Effective Preview / Explain / Source Resolution

### Алгоритм сборки explain-блока

Для каждого grant в preview:

```
source_type:      "rule" | "legacy" | "fallback"
source_id:        UUID правила или маппинга
source_label:     "Правило (тариф)" | "Правило (продукт)" | "Legacy (product_club_mappings)"
migrated_status:  "new_rule" | "migrated" | "not_migrated" | "n/a"
effective_status: "active" | "overridden" | "inactive"
overridden_by:    string | undefined
duplicated_with:  string | undefined
duration_days:    resolved итоговый срок
duration_source:  "rule" | "tariff" | "legacy" | "unknown"
rule_purpose:     "primary" | "bonus" | "additional" | "service"
runtime_support:  "full" | "partial" | "preview_only"
club_access_label: "чат" | "канал" | "чат + канал" (для клубов)
```

### Приоритет разрешения

1. Tariff-level rules (active) → effective
2. Product-level rules (active) → effective если не перекрыто tariff-level
3. Legacy club mappings (active) → fallback если не перекрыто rules
4. Legacy email mappings → fallback

Перекрытые правила показываются в collapsed секции "Перекрытые правила".

---

## Phase 4 — Legacy/Fallback Visibility + Conflict States

### Legacy статусы

| Статус | Описание | Цвет |
|---|---|---|
| `active_legacy_only` | Действует (только legacy) | amber |
| `duplicated_by_rule` | Дублируется новым правилом | blue |
| `migrated_replaced` | Мигрировано и заменено | green |
| `inactive_legacy` | Неактивно | muted |
| `fallback_effective` | Fallback (правило неактивно) | orange |

### Конфликтные состояния

- Одна цель из нескольких правил → warning badge + показ победителя по приоритету
- Дублирование rule + legacy → badge "Дублирует legacy" в карточке правила
- Inactive rule + active legacy fallback → статус "fallback_effective"

---

## Phase 5 — Duration Model

### Источники срока (precedence)

| Приоритет | Источник | Описание |
|---|---|---|
| 1 | `access_rules.duration_days` | Явно задан в правиле |
| 2 | `tariffs.access_days` | Из тарифа покупки |
| 3 | `product_club_mappings.duration_days` | Legacy mapping |
| 4 | null | Бессрочно / не настроено |

### UX

- Переключатель: "По умолчанию из тарифа" / "Задать вручную"
- При выборе "из тарифа" — показ текущего значения access_days
- При access_days = null — отображается "не задан"
- Пресеты: 7/14/30/60/90/180/365 дней
- В preview: итоговый срок + источник (из правила / из тарифа / legacy)

---

## Phase 6 — Advanced/Settings Cleanup

- Priority скрыт в collapsible "Дополнительные настройки"
- Notes в advanced секции
- Active/inactive toggle в advanced
- target_ref в сыром виде не показывается (заменён селекторами)
- entitlement помечен как "advanced" в списке типов

---

## rule_purpose storage

Хранится в `conditions` JSON как `conditions.rule_purpose`.
Проверено: поле `conditions` в `access_rules` типа JSONB, nullable, default null.
Существующих записей нет → нет конфликта ключей.
Допустимые значения: "primary" | "bonus" | "additional" | "service".
Default (если отсутствует): "primary".

---

## Add-only mapping по полям

### DB fields (без изменений)

- `access_rules.*` — все поля остаются как есть
- `conditions` JSONB — используется для `rule_purpose`
- Legacy таблицы — не модифицируются

### Новые computed/UI-only поля

| Поле | Тип | Где живёт |
|---|---|---|
| `duration_mode` | UI-only | form state |
| `rule_purpose` | JSON key | `conditions.rule_purpose` |
| `effective_status` | computed | useEffectiveGrants |
| `duration_source` | computed | useEffectiveGrants |
| `migrated_status` | computed | useEffectiveGrants |
| `runtime_support` | computed | useEffectiveGrants |
| `club_access_label` | computed | useEffectiveGrants |
| `legacy_status` | computed | getLegacyStatus() |

### Runtime — не меняется

- `grant-access-for-order` — без изменений
- Legacy fallback — без изменений

---

## Ограничения UI

| Тип | Статус в UI |
|---|---|
| `club` | Доступно для настройки + preview + runtime |
| `product_access` | Доступно для настройки + preview + runtime |
| `entitlement` | Доступно (advanced) + preview + runtime |
| `email` | Ручной ввод + preview. Справочник не создан |
| Часть продукта | **НЕ добавлено в UI** — нет runtime |
| Тренинг / часть тренинга | **НЕ добавлено в UI** — нет runtime |
| Урок | **НЕ добавлено в UI** — нет runtime |

---

## Файлы

| Файл | Действие |
|---|---|
| `src/hooks/useAccessRules.ts` | Переработан: types, CRUD, effective grants с full source resolution |
| `src/hooks/useAccessRuleSelectors.ts` | **Новый**: selector hooks для clubs, products, entitlements, tariff durations |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | **Полная переработка**: форма, preview, legacy, конфликты |

---

## DoD

1. ✅ Все тексты на русском, без технических ID/slug в основном UX
2. ✅ Для 3 типов (club, product, entitlement) — связанные селекторы
3. ✅ Для клубов видно чат/канал/чат+канал
4. ✅ Срок: из тарифа / вручную / пресеты с показом источника
5. ✅ Назначение правила: основной/бонус/доп/служебный
6. ✅ Preview отвечает на «что получит покупатель» с source resolution
7. ✅ Legacy видны без скрытия, с 5 статусами миграции
8. ✅ Priority скрыт в advanced
9. ✅ Каждый grant в preview: source_type, source_label, duration_source, migrated_status, effective_status
10. ✅ Runtime support отображается в UI (partial/preview_only badges)
11. ✅ Конфликты: conflict badge + effective winner + legacy overlap
12. ✅ Перекрытые правила показываются отдельно

---

## Deferred / Follow-up

### Follow-up sprint (после v23.1)

| Задача | Причина отложения |
|---|---|
| Часть продукта / тренинг / урок | Нет runtime handler |
| Полноценный domain/section registry | Нет таблицы справочника |
| grant vs extend semantic refactor | Вне scope |
| Dead code cleanup | Вне scope |
| Cutover legacy → rules-only | Требует миграции данных |
| Массовый bulk-edit всех продуктов | Вне scope |
