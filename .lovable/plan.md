

# FIX — Scroll to top при возврате на страницу

## Проблема

Компонент `ScrollToTop` (src/components/layout/ScrollToTop.tsx) вызывает `window.scrollTo(0, 0)` при **любом** изменении `pathname` — включая навигацию назад (кнопка "Назад" браузера, возврат на предыдущую вкладку приложения).

Когда пользователь:
1. Прокрутил страницу урока до середины
2. Перешёл на другую страницу (другой урок, раздел)
3. Вернулся назад

`pathname` меняется → `ScrollToTop` срабатывает → страница прокручивается в начало.

Это системная проблема, затрагивающая **все** страницы приложения.

## Решение

Использовать `useNavigationType()` из React Router v6 для определения типа навигации:

- **PUSH** (переход вперёд) → скроллить в начало ✅
- **POP** (назад/вперёд) → **не скроллить**, сохранять позицию ✅
- **REPLACE** → скроллить в начало ✅

Дополнительно: включить `history.scrollRestoration = 'manual'` чтобы браузер не вмешивался в управление скроллом.

## Изменения

### Файл: `src/components/layout/ScrollToTop.tsx`

```typescript
import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  // Disable browser's built-in scroll restoration
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    // Only scroll to top on forward navigation (PUSH/REPLACE)
    // On POP (back/forward), let the browser preserve scroll position
    if (navigationType !== "POP") {
      window.scrollTo(0, 0);
    }
  }, [pathname, navigationType]);

  return null;
}
```

## Не делаем

- Не трогаем явные `window.scrollTo` в LibraryLesson.tsx (они привязаны к конкретным действиям — seek to video)
- Не добавляем сохранение/восстановление позиции скролла (браузер сам это делает при `POP` навигации, если не вызывать `scrollTo(0,0)`)
- Не меняем другие компоненты

## DoD

- При переходе на новую страницу — скролл в начало (как раньше)
- При возврате назад — позиция скролла сохраняется
- Работает во всех разделах: уроки, квесты, библиотека, админка

