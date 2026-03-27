

# План: Исправить обрезание контента на /admin/ai

## Диагностика

`AiPageContent` (строка 495-500) использует:
```ts
const AI_CONTAINER_OFFSET = '4.5rem';
style={{ height: `calc(100dvh - ${AI_CONTAINER_OFFSET})` }}
```

Этот offset рассчитан на `DashboardLayout` (header ~4.5rem). В `AdminLayout` header ~2.5rem, плюс контент уже находится внутри flex-контейнера с `flex-1 min-h-0`. Из-за этого высота считается неправильно и верхние табы обрезаются.

Дополнительно: `className` содержит `-mt-2 md:-mt-4` — отрицательные отступы, тоже рассчитанные на DashboardLayout.

## Решение

Единственный файл: `src/components/ai-chat/AiPageContent.tsx`

1. Вынести `AI_CONTAINER_OFFSET` в зависимость от `mode`:
   - `mode === "user"` → `'4.5rem'` (текущее значение для DashboardLayout)
   - `mode === "admin"` → `'3rem'` (AdminLayout header ~2.5rem + padding)

2. Убрать отрицательные отступы `-mt-2 md:-mt-4` для admin-режима:
   - `mode === "user"` → `-mt-2 md:-mt-4` (как сейчас)
   - `mode === "admin"` → без отрицательных отступов

## Что НЕ меняется
- Sidebar, AdminLayout, DashboardLayout, router, useAdminMenuSettings
- Tab ids, state, handlers, mutation guards
- Поведение на `/ai` (user mode) — offset и отступы остаются 1:1

## DoD
1. На `/admin/ai` верхние табы (Gorbova AI, Документы, Реквизиты) полностью видны без обрезания
2. Контент не обрезается снизу
3. На `/ai` визуальное поведение не изменилось

