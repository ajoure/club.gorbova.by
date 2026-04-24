---
name: System Health — Owner View
description: UI-only owner-view для /admin/system-health. Mapping invariant→problem_type, фильтр legacy noise, схема вкладок, генерация PATCH.
type: feature
---

# /admin/system-health — Owner View

UI-only переработка. Backend (`system-health-full-check`, `system-health-remediate`, `system_health_reports`, `system_health_discovery_findings`, invariants, cron) **не трогался**. Меняется только представление.

## Источники данных
- `useLatestFullCheck()` → `report_json.invariants.results[]` — текущие инварианты.
- `useSystemHealthReports()` (последние 30) → используется для diff: `[0]` vs `[1]`.
- `useLegacyNoiseBreakdown()` (новый) → SHDF с фильтром `decision='exclude' AND note ILIKE '%source_invariant=%'`.
- `useLatestSystemHealth()` / `useSystemHealthRuns()` — только во вкладке Техинфо.

## Схема вкладок
1. **Проблемы сейчас** — только `problem_type='critical_fix'`. Если пусто → empty-state «Сейчас нет проблем, требующих исправления». Внизу: diff-панель + блок legacy noise.
2. **Ручная проверка** — только `problem_type='manual_review'`. Сейчас всегда пуст (см. mapping ниже), поэтому показывается заранее заготовленный empty-state с пояснением «Если появятся manual_review-кейсы, они будут здесь».
3. **Техинфо** — старые компоненты (`SystemHealthOverview`, `EdgeFunctionsHealth`, `HealthRunHistory`, `AuditLogViewer`) — add-only, без изменений. Сверху info-баннер «Этот раздел для технической проверки».

## Mapping invariant → problem_type (актуальный)
Источник: `src/lib/system-health/invariant-humanize.ts`.

| Код | problem_type | recommended_action |
|---|---|---|
| `INV-P0-1` (Автопродления за 24ч) | `critical_fix` | `fix_via_lovable` |
| `INV-P0-4` (Cron jobs за 24ч) | `critical_fix` | `fix_via_lovable` |
| `INV-P0-2` (Renewal orders за 24ч) | `tech_info` | `observe` |
| `INV-P0-3` (Telegram queue) | `tech_info` | `observe` |
| `INV-P0-5` (Успешные платежи за 24ч) | `tech_info` | `observe` |

Для `critical_fix` обязательны поля `whyNotAutofixed` и `consequenceOfInaction`.
Неизвестные коды → fallback `tech_info / observe`.

**Manual_review сейчас пустой намеренно**: ни один из 5 текущих P0-инвариантов не классифицирован как `manual_review`. Вкладка сохранена, чтобы при появлении таких кейсов в будущем (например, граничные SHDF-сценарии без чёткой автофиксации) их было куда положить без редизайна.

## Legacy noise — exact-фильтр
- SQL: `decision = 'exclude' AND note ILIKE '%source_invariant=%'`
- Без этого фильтра попадает технический шум (например, F999 без source_invariant), что искажает картину.
- Breakdown по `source_invariant=...` показывается отдельным списком в карточке (на 2026-04-24: `INV-20 — 8 исключений`).
- В `OwnerSummaryStrip` это **отдельный спокойный серый блок** «Исторический шум исключён», не смешан с проблемами.

## PATCH-генератор (`src/lib/system-health/patch-generator.ts`)
Каждый PATCH (одиночный или агрегатный) начинается со служебной шапки:
```
Источник: /admin/system-health
Сгенерировано по результатам последней диагностики
```
Агрегатный PATCH собирается **только из actionable** (`critical_fix` + `manual_review`). `tech_info` не включается.

## Diff (`src/lib/system-health/diff-engine.ts`)
4 статуса: `new`, `disappeared`, `count_changed`, `unchanged`.
В UI для `count_changed` показывается текстом `было X → стало Y` + дельта `+N/-N` (зелёная/красная), не только бейдж.

## Связанные маршруты
Кнопка «Открыть связанный раздел» — вторичная и показывается **только** если маршрут реально помогает расследовать проблему.
- `INV-P0-1` → `/admin/payments`
- `INV-P0-4` → нет (нет UI для cron — кнопка скрыта).

## Файлы
- `src/lib/system-health/invariant-humanize.ts`
- `src/lib/system-health/legacy-noise-config.ts`
- `src/lib/system-health/patch-generator.ts`
- `src/lib/system-health/diff-engine.ts`
- `src/hooks/useLegacyNoiseBreakdown.ts`
- `src/components/admin/system-health/owner/OwnerStatusHero.tsx`
- `src/components/admin/system-health/owner/OwnerSummaryStrip.tsx`
- `src/components/admin/system-health/owner/OwnerProblemCard.tsx`
- `src/components/admin/system-health/owner/OwnerLegacyNoiseCard.tsx`
- `src/components/admin/system-health/owner/OwnerDiffPanel.tsx`
- `src/components/admin/system-health/owner/OwnerTechInfoTab.tsx`
- `src/pages/admin/AdminSystemHealth.tsx` (полностью переписан)

## Что НЕ менялось
- Edge functions, RPC, таблицы, RLS, cron, recurring checks, evidence-layer.
- Старые компоненты в `src/components/admin/system-health/*` (только переехали внутрь Техинфо).
