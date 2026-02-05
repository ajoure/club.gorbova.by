
# План: Исправление ошибки "removeChild" при переходе между шагами квеста

## Диагноз проблемы

При клике на "Я просмотрел видео" или "Перейти к следующему шагу" возникает критическая ошибка:

```
NotFoundError: Failed to execute 'removeChild' on 'Node': 
The node to be removed is not a child of this node.
```

**Причина:** Kinescope Player SDK напрямую манипулирует DOM внутри контейнера, а React ожидает, что DOM структура соответствует его virtual DOM. Когда React пытается удалить/обновить компонент, происходит конфликт.

**Последовательность проблемы:**
1. Пользователь нажимает "Я просмотрел видео"
2. Вызывается `handleVideoComplete` → `markBlockCompleted` → `updateState`
3. React начинает ре-рендер KvestLessonView
4. VideoUnskippableBlock меняет `isCompleted` с false на true
5. React пытается удалить/заменить DOM элементы
6. **CRASH:** Kinescope изменил DOM, React не может найти ожидаемые элементы

---

## Решение: Изоляция DOM Kinescope от React

### PATCH-1: Использовать React ref вместо document.getElementById

Заменить прямое манипулирование DOM на React ref, который не конфликтует с reconciliation.

**Файл:** `src/hooks/useKinescopePlayer.ts`

```typescript
// БЫЛО:
const container = document.getElementById(containerId);
if (container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

// СТАНЕТ:
// Не очищаем DOM вручную - позволяем Kinescope SDK управлять своим контейнером
// Kinescope.IframePlayer.create сам очистит и заполнит контейнер
```

### PATCH-2: Добавить ключ стабильности для VideoUnskippableBlock

Когда `isCompleted` меняется, React пытается обновить компонент. Проблема в том, что содержимое рендерится условно (разный JSX для completed/not completed). Нужно использовать `key` для полной перемонтировки компонента.

**Файл:** `src/components/lesson/KvestLessonView.tsx`

В `renderBlockWithProps` для `video_unskippable` добавить условный рендеринг с уникальным ключом:

```typescript
case 'video_unskippable':
  // Для completed блока - простой статичный UI без Kinescope
  if (isCompleted) {
    return (
      <div key={`${blockId}-completed`} className="opacity-80">
        <LessonBlockRenderer 
          {...commonProps}
          kvestProps={{ isCompleted: true }}
        />
      </div>
    );
  }
  // Для активного блока - полный Kinescope player
  return (
    <div key={`${blockId}-active`}>
      <LessonBlockRenderer 
        {...commonProps}
        kvestProps={{
          watchedPercent: videoProgress,
          onProgress: (percent: number) => handleVideoProgress(blockId, percent),
          onComplete: () => handleVideoComplete(blockId),
          isCompleted: false,
          allowBypassEmptyVideo: allowBypassEmptyVideo,
        }}
      />
    </div>
  );
```

### PATCH-3: Улучшить cleanup в useKinescopePlayer

Обеспечить корректное уничтожение player'а без конфликтов с React:

```typescript
return () => {
  // 1. Сначала отключаем observer
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  
  // 2. Отменяем RAF
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  
  // 3. Помечаем как unmounted
  isMounted = false;
  isReadyRef.current = false;
  
  // 4. Уничтожаем player (он сам очистит свой DOM)
  if (player) {
    try {
      player.destroy();
    } catch {
      // ignore
    }
    player = null;
  }
  playerRef.current = null;
  
  // 5. НЕ очищаем container вручную - React сам удалит DOM элемент
};
```

### PATCH-4: Предотвратить forceFill после unmount

В функции `forceFill` и `throttledForceFill` добавить дополнительную проверку:

```typescript
const forceFill = () => {
  // Guard: exit if unmounted
  if (!isMounted) return;
  
  const containerEl = document.getElementById(containerId);
  // Guard: exit if container not in DOM (React removed it)
  if (!containerEl || !containerEl.isConnected) return;
  
  // ... rest of forceFill logic
};
```

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/hooks/useKinescopePlayer.ts` | Убрать ручную очистку DOM, улучшить cleanup |
| `src/components/lesson/KvestLessonView.tsx` | Добавить key для изоляции completed/active состояний |

---

## Техническое объяснение

React использует Virtual DOM для отслеживания изменений. Когда внешняя библиотека (Kinescope) напрямую добавляет/удаляет DOM элементы, React "теряет" связь между своим virtual DOM и реальным DOM.

**Паттерн решения:**
1. Изолировать внешнюю библиотеку в контейнер, который React не модифицирует
2. Использовать `key` prop для полной перемонтировки при существенных изменениях
3. Позволить внешней библиотеке управлять своим DOM через её API (destroy), а не через React

---

## DoD

1. Нажать "Я просмотрел видео" → страница НЕ становится белой
2. Переход к следующему шагу происходит плавно
3. Консоль браузера НЕ содержит "removeChild" ошибок
4. При возврате на вкладку страница НЕ перезагружается (это отдельная проблема bfcache, но должна обрабатываться корректно)
