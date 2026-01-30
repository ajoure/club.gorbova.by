

# План: Исправление ошибки `removeChild` на мобильных устройствах

## Диагноз

### Подтверждённая проблема
При тестировании в мобильном viewport (390x844) зафиксирована ошибка:
```
NotFoundError: Failed to execute 'removeChild' on 'Node': 
The node to be removed is not a child of this node.
```

**Стек вызовов указывает на React DOM reconciliation** — React пытается удалить DOM-узел, который уже был удалён Kinescope SDK.

### Причина ошибки
В `useKinescopePlayer.ts` есть три источника проблемы:

1. **`container.innerHTML = ""`** (строка 268-269) — очистка контейнера напрямую через DOM, минуя React
2. **`MutationObserver` вызывает `forceFill()` после unmount** — несмотря на проверку `isMounted`, observer может сработать между `isMounted = false` и `observer.disconnect()`
3. **Kinescope SDK вставляет/удаляет DOM-узлы** — внешний скрипт модифицирует DOM под управлением React

### Контекст: Preview vs Production
- Preview-режим редактора Lovable ресурсоёмкий и может падать на мобильных из-за лимитов памяти
- Однако ошибка `removeChild` может проявляться и на продакшне при быстрой навигации между уроками

---

## План исправлений

### Шаг 1: Безопасная очистка контейнера
**Файл:** `src/hooks/useKinescopePlayer.ts`

Вместо `container.innerHTML = ""` использовать удаление дочерних элементов по одному с проверкой:

```text
Строки 266-270: заменить
```
```tsx
// BEFORE:
const container = document.getElementById(containerId);
if (container) {
  container.innerHTML = "";
}

// AFTER:
const container = document.getElementById(containerId);
if (container) {
  // Safe DOM cleanup - remove children one by one
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}
```

### Шаг 2: Отключить observer ДО установки `isMounted = false`
**Файл:** `src/hooks/useKinescopePlayer.ts`

Изменить порядок в cleanup-функции:

```text
Строки 337-361: реорганизовать cleanup
```
```tsx
return () => {
  // FIRST: Disconnect observer to stop any pending callbacks
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  
  // Cancel pending RAF
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  
  // THEN: Mark as unmounted
  isMounted = false;
  isReadyRef.current = false;
  
  // Finally: Destroy player
  if (player) {
    try {
      player.destroy();
    } catch {
      // ignore
    }
  }
  playerRef.current = null;
};
```

### Шаг 3: Добавить дополнительную проверку в `forceFill`
**Файл:** `src/hooks/useKinescopePlayer.ts`

Добавить проверку существования контейнера И его подключения к DOM:

```text
Строки 216-218: добавить проверку
```
```tsx
const forceFill = () => {
  if (!isMounted) return; // Early exit if unmounted
  
  const containerEl = document.getElementById(containerId);
  if (!containerEl || !containerEl.isConnected) return; // Check if still in DOM
  
  // ... rest of function
};
```

### Шаг 4: Обернуть setTimeout в проверку
**Файл:** `src/hooks/useKinescopePlayer.ts`

Текущий код уже имеет проверки `if (isMounted)`, но добавить дополнительную защиту через RAF (вместо setTimeout) для лучшей синхронизации с React:

```text
Строки 293-296: заменить setTimeout на RAF-цепочку
```
```tsx
// BEFORE:
setTimeout(() => { if (isMounted) forceFill(); }, 100);
setTimeout(() => { if (isMounted) forceFill(); }, 300);
setTimeout(() => { if (isMounted) forceFill(); }, 500);

// AFTER:
const scheduleDelayedFill = (delay: number) => {
  const timeoutId = setTimeout(() => {
    if (isMounted) {
      requestAnimationFrame(() => {
        if (isMounted) forceFill();
      });
    }
  }, delay);
  // Return cleanup (не используется напрямую, но для полноты)
};

scheduleDelayedFill(100);
scheduleDelayedFill(300);
scheduleDelayedFill(500);
```

---

## Технические детали

### Почему происходит ошибка
React поддерживает виртуальный DOM и ожидает, что он синхронизирован с реальным DOM. Когда внешний скрипт (Kinescope SDK) добавляет/удаляет узлы, React не знает об этих изменениях. При размонтировании компонента React пытается удалить узлы, которые уже были удалены SDK.

### Почему `MutationObserver` опасен
Observer может получить уведомление о мутации и вызвать `forceFill()` в микротаске, ПОСЛЕ того как React начал unmount, но ДО того как cleanup-функция успела отключить observer.

### Почему Preview падает чаще
Preview-режим Lovable запускает HMR (Hot Module Replacement), который чаще вызывает unmount/remount компонентов, увеличивая шанс race condition.

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/hooks/useKinescopePlayer.ts` | Исправление race condition и безопасная очистка DOM |

---

## Ожидаемый результат

- Ошибка `removeChild` больше не возникает при навигации между уроками
- Страница урока не становится пустой после просмотра видео
- Preview-режим стабильнее работает на мобильных устройствах

