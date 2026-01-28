

# План: Исправление проблемы перезагрузки при скролле на мобильных

## Причина проблемы

В `AdminLayout` контент скроллится внутри `<main className="overflow-y-auto">`, а не на уровне `window`. Компонент `PullToRefresh` проверяет `window.scrollY === 0`, которое **всегда равно 0**, потому что `window` не скроллится — скроллится внутренний контейнер.

В результате **любой жест вниз** ошибочно воспринимается как pull-to-refresh и вызывает перезагрузку страницы.

## Решение

Модифицировать `PullToRefresh` чтобы он отслеживал позицию скролла **ближайшего скроллируемого контейнера**, а не `window`.

## Изменения в коде

### Файл: `src/components/layout/PullToRefresh.tsx`

**Что изменится:**

1. Добавить `ref` на контейнер для получения позиции скролла
2. Найти ближайший скроллируемый родитель при старте жеста
3. Проверять `scrollTop` этого контейнера вместо `window.scrollY`

```tsx
// БЫЛО:
if (window.scrollY === 0 && !refreshing) {
  startY.current = e.touches[0].clientY;
  isPulling.current = true;
}

// СТАНЕТ:
const scrollContainer = findScrollableParent(containerRef.current);
const scrollTop = scrollContainer 
  ? scrollContainer.scrollTop 
  : window.scrollY;

if (scrollTop === 0 && !refreshing) {
  startY.current = e.touches[0].clientY;
  isPulling.current = true;
  scrollContainerRef.current = scrollContainer;
}
```

**Новая вспомогательная функция:**

```tsx
function findScrollableParent(el: HTMLElement | null): HTMLElement | null {
  while (el) {
    const { overflowY } = window.getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      if (el.scrollHeight > el.clientHeight) {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}
```

**Также в `handleTouchMove`:**

```tsx
// БЫЛО:
if (window.scrollY > 0) {

// СТАНЕТ:
const scrollTop = scrollContainerRef.current 
  ? scrollContainerRef.current.scrollTop 
  : window.scrollY;
if (scrollTop > 0) {
```

## Результат

| Ситуация | До исправления | После исправления |
|----------|----------------|-------------------|
| Скролл вниз внутри контейнера | ❌ Перезагрузка | ✅ Нормальный скролл |
| Скролл вверх до упора + тянем вниз | ✅ Pull-to-refresh | ✅ Pull-to-refresh |
| Скролл на странице без контейнера | ✅ Работает | ✅ Работает |

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/components/layout/PullToRefresh.tsx` | Добавить определение скроллируемого родителя, проверять его `scrollTop` вместо `window.scrollY` |

