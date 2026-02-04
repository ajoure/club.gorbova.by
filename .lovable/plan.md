

# План: Исправление кнопки админ-bypass и бага перезагрузки вкладки

## Проблема 1: Кнопка "Продолжить без видео (админ)" не появляется

### Анализ

В `VideoUnskippableBlock.tsx` есть ДВА места, где должна появляться кнопка bypass:

1. **Когда URL видео пустой** (строки 456-461) — работает
2. **Когда URL видео есть, но видео не досмотрено** (строки 522-533) — НЕ работает

Причина: Кнопка на строках 522-533 показывается только когда `allowBypassEmptyVideo && !canConfirm`:

```tsx
{allowBypassEmptyVideo && !canConfirm && (
  <Button onClick={handleConfirmWatched}...>
    Продолжить без видео (админ)
  </Button>
)}
```

Но название пропа `allowBypassEmptyVideo` вводит в заблуждение — фактически она означает "разрешить bypass для админа в preview режиме" и должна работать И когда URL пустой, И когда видео не досмотрено.

Логика правильная, но проблема в том, что `canConfirm` зависит от `videoStarted`:

```tsx
const canConfirm = isThresholdReached && videoStarted;
```

Если видео не запущено (`videoStarted = false`), то `canConfirm = false` — и кнопка ДОЛЖНА показываться. Но условие `allowBypassEmptyVideo` требует, чтобы этот проп был `true`.

### Проверка передачи пропа

Цепочка передачи:
1. `LibraryLesson.tsx` (строка 73): `const allowBypassEmptyVideo = isAdminMode && isPreviewMode;`
2. `LibraryLesson.tsx` (строка 267): `<KvestLessonView ... allowBypassEmptyVideo={allowBypassEmptyVideo} />`
3. `KvestLessonView.tsx` (строка 303): `allowBypassEmptyVideo: allowBypassEmptyVideo,`
4. `LessonBlockRenderer.tsx` (строка 323): `allowBypassEmptyVideo={kvestProps?.allowBypassEmptyVideo}`
5. `VideoUnskippableBlock.tsx` (строка 49): `allowBypassEmptyVideo = false`

### Проблема найдена!

В `usePermissions` хук может возвращать `false` если проверка еще не завершена. Нужно:
1. Добавить дебаг-лог в `LibraryLesson.tsx` для проверки значения `allowBypassEmptyVideo`
2. Убедиться что `isAdmin()` возвращает `true` для админа

## Проблема 2: Перезагрузка вкладки при переключении

### Анализ

Пользователь описывает:
> "Если я во вкладке запустил видео, слушаю его, перехожу в другую вкладку, звук идет, и потом возвращаюсь обратно во вкладке, где идет видео, то вкладка перезагружается"

Это **не баг нашего кода**, а поведение браузера:

1. **iOS Safari** имеет агрессивный memory management — при переключении вкладок Safari может "заморозить" или выгрузить неактивные вкладки
2. **Chrome на мобильных устройствах** также может выгружать вкладки при нехватке памяти
3. Когда пользователь возвращается — браузер перезагружает страницу

### Решение

Мы НЕ МОЖЕМ предотвратить выгрузку вкладки браузером — это поведение ОС/браузера для экономии памяти.

НО мы УЖЕ сохраняем прогресс просмотра видео в `lesson_progress_state`, поэтому видео продолжает с того же места — это работает корректно.

Что можно улучшить:
1. **Показать уведомление** при восстановлении страницы: "Страница была перезагружена браузером. Прогресс сохранён."
2. **Оптимизировать частоту сохранения** прогресса (debounce)

Но это cosmetic — основная проблема в поведении браузера, не в нашем коде.

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/components/admin/lesson-editor/blocks/VideoUnskippableBlock.tsx` | Добавить console.log для дебага `allowBypassEmptyVideo`, убедиться что кнопка bypass всегда видна для админа |
| `src/hooks/usePermissions.tsx` | Проверить логику `isAdmin()` |
| `src/pages/LibraryLesson.tsx` | Добавить дебаг-лог для проверки `allowBypassEmptyVideo` |

## Решение проблемы 1

### Шаг 1: Добавить явный дебаг в VideoUnskippableBlock

```tsx
// После строки 63
useEffect(() => {
  if (!isEditing) {
    console.info('[VideoUnskippableBlock] Render state:', {
      allowBypassEmptyVideo,
      canConfirm,
      videoStarted,
      isThresholdReached,
      embedUrl: !!embedUrl,
      isCompleted
    });
  }
}, [allowBypassEmptyVideo, canConfirm, videoStarted, isThresholdReached, embedUrl, isCompleted, isEditing]);
```

### Шаг 2: Упростить логику кнопки bypass

Текущая логика:
```tsx
{allowBypassEmptyVideo && !canConfirm && (
  <Button>Продолжить без видео (админ)</Button>
)}
```

Проблема: если `embedUrl` есть, но видео заблокировано (не запущено), кнопка должна быть видна.

Новая логика — показывать кнопку bypass ВСЕГДА когда:
- `allowBypassEmptyVideo === true` (админ + preview режим)
- `!isCompleted` (блок не завершён)

```tsx
{/* Admin bypass button - visible in preview mode when not completed */}
{allowBypassEmptyVideo && !isCompleted && (
  <Button
    onClick={() => {
      onComplete?.();
    }}
    variant="outline"
    className="w-full text-amber-600 border-amber-300 hover:bg-amber-50"
    size="sm"
  >
    <CheckCircle2 className="mr-2 h-4 w-4" />
    Пропустить (админ preview)
  </Button>
)}
```

И удалить дублирующую кнопку из блока с пустым URL (строки 456-461) — она станет избыточной.

## Решение проблемы 2

### Шаг 1: Показать уведомление при восстановлении

Добавить в `LibraryLesson.tsx` или `KvestLessonView.tsx`:

```tsx
// Detect page restoration (bfcache or reload after tab suspension)
useEffect(() => {
  const handlePageShow = (e: PageTransitionEvent) => {
    if (e.persisted) {
      toast.info("Страница восстановлена", {
        description: "Прогресс просмотра сохранён"
      });
    }
  };
  
  window.addEventListener('pageshow', handlePageShow);
  return () => window.removeEventListener('pageshow', handlePageShow);
}, []);
```

### Шаг 2: Оптимизировать сохранение прогресса видео

В `KvestLessonView.tsx` уже есть debounced сохранение через `updateState`. Можно добавить `beforeunload` для гарантии сохранения:

```tsx
// Save progress before page unload
useEffect(() => {
  const handleBeforeUnload = () => {
    // Force immediate save of any pending state
    if (pendingStateRef.current) {
      // Use sendBeacon for reliable delivery
      navigator.sendBeacon('/api/save-progress', JSON.stringify(pendingStateRef.current));
    }
  };
  
  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, []);
```

Но это сложнее — нужен отдельный endpoint. Пока достаточно информировать пользователя.

## DoD

| Проверка | Ожидаемый результат |
|----------|---------------------|
| Урок в preview режиме (`?preview=1`) как админ | Кнопка "Пропустить (админ preview)" видна под видео |
| Клик по кнопке bypass | Блок помечается завершённым, переход к следующему шагу |
| Переключение вкладок на мобильном | Toast "Страница восстановлена" при возврате, видео с сохранённого момента |
| Обычный пользователь (без `?preview=1`) | Кнопка bypass НЕ видна |

