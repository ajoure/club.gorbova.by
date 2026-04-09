# План: подключение SectionGuard ко всем секциям + единая visible/active/filtering логика

## Статус: реализовано, ожидает runtime proof

## Корневые причины

1. **SectionGuard подключён только к eisenhower** — `/ai`, `/money`, `/live`, `/self-development` не обёрнуты, поэтому `is_public=false` ни на что не влияет
2. **Sidebar не живёт полностью от section-resolver** — деактивированный "Деньги" (`is_active=false`) всё равно виден, т.к. sidebar не использовал `is_active` из RPC (RPC ранее не возвращал inactive секции)
3. Замочек на "Нейросеть" показывается (sidebar работает), но страница `/ai` открывается свободно (нет guard)

## Что сделано

### 1. RPC `get_user_section_access` — возвращает `is_active`

- Убран фильтр `WHERE s.is_active = true` — теперь возвращаются ВСЕ секции
- Добавлено поле `is_active` в результат
- Для inactive секций `has_access = false` (кроме admin)
- Admin видит все секции с полным доступом

### 2. `src/App.tsx` — обёрнуты все секции в SectionGuard

| Роут | sectionCode |
|------|-------------|
| `/ai` | `ai` |
| `/money` | `money` |
| `/live`, `/live/:slug` | `live` |
| `/self-development` + все вложенные | `self_development` |
| `/dashboard` | `dashboard` |
| `/knowledge` | `knowledge` |
| `/products` | `products` |
| `/tools/eisenhower` | `eisenhower` |

### 3. `src/hooks/useSectionAccess.ts` — `is_active` в checkAccess

- `SectionAccessEntry` расширен полем `is_active`
- `checkAccess()` возвращает `is_active`
- Единый SoT: sidebar и guard используют один и тот же хук

### 4. `src/components/layout/SectionGuard.tsx` — поддержка inactive

Порядок проверок:
1. Kill-switch off → allow
2. Loading → spinner
3. isError → deny + error UI
4. not found → pass through
5. **is_active=false → deny screen** (admin bypass через checkAccess)
6. is_public=true → allow
7. has_access=true → allow
8. deny → paywall overlay

### 5. `src/components/layout/AppSidebar.tsx` — единая логика

- `checkAccess()` вызывается всегда (не только при `gatingEnabled`)
- `is_active=false` + non-admin → пункт меню скрыт
- Lock-иконка: `gatingEnabled && !isAdmin && found && !is_public && !has_access`

## Кэш (зафиксировано)

- **Kill-switch** (`section_gating_enabled`): `staleTime = 10_000` (10с)
- **Section access** (`section-access`): `staleTime = 60_000` (60с)
- Два отдельных query, каждый со своим TTL

## Ограничения

- money и live обёрнуты guard-ом, но остаются `is_public=true` в БД
- **Переводить money/live в `is_public=false` на этом этапе ЗАПРЕЩЕНО** без отдельного proof
- SectionGuard — внешний фильтр, не заменяет внутренние проверки (module-level доступ через useSidebarModules)

## DoD (ожидает runtime proof)

1. `/ai` с `is_public=false` блокируется overlay для обычного пользователя
2. `/tools/eisenhower` deny для non-admin — контрольный proof
3. `is_active=false` скрывает sidebar item для обычного пользователя
4. Direct URL на inactive section → deny screen для обычного пользователя
5. Admin bypass — gated и inactive секции доступны
6. Kill-switch `false` → deny снимается, lock исчезает без hard refresh
7. `/self-development` + вложенный маршрут — оба закрыты при `is_public=false`
8. knowledge/products — модульные ограничения внутри работают как раньше
9. money/live остаются `is_public=true`, функционал не затронут
