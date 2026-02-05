
# План: Исправление трекинга прогресса видео в блоке "Видео (обязат.)"

## Диагноз проблемы

**Корневая причина:**  
В `VideoUnskippableBlock.tsx` используется пассивный `postMessage` listener (строки 132-219), который ожидает события от iframe. Однако **Kinescope Player API не отправляет события автоматически** — необходимо создать плеер через их `IframePlayer.create()` API.

В отличие от этого, `VideoBlock.tsx` использует `useKinescopePlayer.ts`, который:
1. Загружает скрипт `https://player.kinescope.io/latest/iframe.player.js`
2. Создаёт плеер через `Kinescope.IframePlayer.create(containerId, { url })`
3. Получает события через API плеера (`player.on('timeupdate', ...)`)

**Проблема:** `VideoUnskippableBlock` пытается слушать postMessage от обычного iframe — это не работает с Kinescope.

---

## Решение

### PATCH-1: Добавить подписку на события через Kinescope IframePlayer API

**Файл:** `src/hooks/useKinescopePlayer.ts`

Добавить callback `onTimeUpdate` для передачи прогресса:

```typescript
interface UseKinescopePlayerOptions {
  // ... существующие поля
  onTimeUpdate?: (currentTime: number, duration: number, percent: number) => void;
  onEnded?: () => void;
}
```

Внутри `initPlayer()` после создания плеера:

```typescript
// Subscribe to timeupdate events
player.on('timeupdate', async () => {
  try {
    const currentTime = await player.getCurrentTime();
    const duration = ...; // получить из события или закешировать
    const percent = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;
    onTimeUpdate?.(currentTime, duration, percent);
  } catch { /* ignore */ }
});

player.on('ended', () => {
  onEnded?.();
});
```

---

### PATCH-2: Переписать VideoUnskippableBlock на использование useKinescopePlayer

**Файл:** `src/components/admin/lesson-editor/blocks/VideoUnskippableBlock.tsx`

**Изменения:**

1. **Импортировать `useKinescopePlayer` и `extractKinescopeVideoId`**

2. **Заменить postMessage listener на хук:**

```typescript
// Для Kinescope используем IframePlayer API
const kinescopeVideoId = content.provider === 'kinescope' 
  ? extractKinescopeVideoId(content.url || "") 
  : null;

const containerId = `kinescope-unskippable-${useId().replace(/:/g, '-')}`;

// Обновлённый useKinescopePlayer с onTimeUpdate
const { isReady } = useKinescopePlayer({
  videoId: kinescopeVideoId || "",
  containerId,
  onReady: () => {
    setApiWorking(true);
  },
  onTimeUpdate: (currentTime, duration, percent) => {
    setLocalWatched(prev => Math.max(prev, percent));
    setVideoStarted(true);
    onProgress?.(percent);
  },
  onEnded: () => {
    setLocalWatched(100);
    onProgress?.(100);
  },
  onError: () => {
    setApiDetectionDone(true); // Показать fallback
  }
});
```

3. **Для Kinescope — рендерить контейнер `<div id={containerId}>` вместо `<iframe>`**  
   (плеер создаётся автоматически хуком)

4. **Для YouTube/Vimeo — оставить iframe с postMessage** (они поддерживают postMessage API напрямую)

---

### PATCH-3: Расширить useKinescopePlayer для получения duration и timeupdate

**Файл:** `src/hooks/useKinescopePlayer.ts`

Добавить:

```typescript
interface UseKinescopePlayerOptions {
  // ... существующие
  onTimeUpdate?: (currentTime: number, duration: number, percent: number) => void;
  onPlay?: () => void;
  onEnded?: () => void;
}
```

В `initPlayer()`:

```typescript
let cachedDuration = 0;

// Listen for duration change (usually fires once on ready)
player.on('durationchange', async () => {
  try {
    cachedDuration = await player.getDuration?.() || 0;
  } catch {}
});

// Listen for timeupdate
player.on('timeupdate', async () => {
  try {
    const currentTime = await player.getCurrentTime();
    // Try to get duration if not cached
    if (!cachedDuration) {
      cachedDuration = await player.getDuration?.() || 0;
    }
    if (cachedDuration > 0) {
      const percent = Math.round((currentTime / cachedDuration) * 100);
      onTimeUpdate?.(currentTime, cachedDuration, percent);
    }
  } catch {}
});

player.on('play', () => onPlay?.());
player.on('ended', () => onEnded?.());
```

---

## Файлы для изменения

| Файл | Действие |
|------|----------|
| `src/hooks/useKinescopePlayer.ts` | Добавить `onTimeUpdate`, `onPlay`, `onEnded` callbacks |
| `src/components/admin/lesson-editor/blocks/VideoUnskippableBlock.tsx` | Использовать `useKinescopePlayer` для Kinescope вместо postMessage |

---

## Тестирование

После изменений необходимо протестировать:

1. **Открыть квест-урок с video_unskippable блоком (Kinescope)**
2. **Запустить видео** → прогресс должен увеличиваться (0% → 10% → 50% → ...)
3. **Достичь порога (95%)** → кнопка "Я просмотрел(а) видео" активируется
4. **Нажать кнопку** → блок помечается завершённым, открывается следующий шаг
5. **Перемотка** — должна корректно обновлять прогресс (currentTime / duration)
6. **Fallback таймер** — если API не сработал за 5 сек, показать кнопку ручного старта

---

## DoD (Definition of Done)

| Проверка | Критерий |
|----------|----------|
| Прогресс обновляется | При просмотре Kinescope видео % растёт в реальном времени |
| Порог срабатывает | При достижении 95% (или настроенного порога) кнопка активируется |
| Перемотка работает | Перемотка вперёд обновляет прогресс корректно |
| Данные сохраняются | Прогресс сохраняется в `lesson_progress_state.state_json.videoProgress[blockId]` |
| Fallback работает | Если API недоступен, fallback-таймер активируется через 5 сек |
| YouTube/Vimeo | Для этих провайдеров сохраняется текущая логика (postMessage) |

---

## Техническое примечание

Kinescope IframePlayer API использует **нестандартный подход**: вместо отправки событий через `postMessage` к родительскому окну, он требует создания инстанса плеера через их JS SDK и подписки на события через `player.on(event, callback)`.

Это отличается от YouTube/Vimeo, которые отправляют postMessage-события напрямую.

Именно поэтому текущий `postMessage` listener в `VideoUnskippableBlock` не получает события — Kinescope их просто не отправляет таким образом.
