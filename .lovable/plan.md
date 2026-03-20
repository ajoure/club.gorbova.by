

# План: Финальная подгонка отступов на /ai

## Изменения

### 1. `src/components/layout/DashboardLayout.tsx` — уменьшить header

Строка 58: `minHeight: 'calc(3.5rem + ...)'` → `minHeight: 'calc(2.75rem + ...)'` — header тоньше на ~12px.

### 2. `src/pages/AI.tsx` — три правки

**Корневой div** (строка 210): `space-y-2` → `space-y-1` — ещё меньше зазор между breadcrumbs и табами.

**Обёртка табов** (строка 214): `pt-0.5 pb-0.5` → `pt-0` pb-0` — убрать внешний padding; внутренний `p-0.5` pill-bar достаточен для симметрии.

**Chat panel** (строка 243): `calc(var(--app-height) - 240px)` → `calc(var(--app-height) - 200px)` и убрать `minHeight: "500px"` — панель растянется до низа страницы без пустоты. Учитываем что header стал тоньше + отступы уменьшились.

## Файлы

| Файл | Что |
|---|---|
| `DashboardLayout.tsx` | header minHeight 3.5rem → 2.75rem |
| `AI.tsx` | space-y-1, убрать pt/pb обёртки, пересчитать calc |

