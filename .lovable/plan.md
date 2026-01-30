
# План: Исправить размер видео Kinescope на странице урока

## Проблема
На скриншоте видно, что видеоплеер Kinescope отображается очень маленьким в центре контейнера вместо того, чтобы занимать полную ширину.

## Причина
Kinescope IFrame API создаёт iframe внутри контейнера с размерами `width: "100%", height: "100%"`. Но:
1. Контейнер `<div id={containerId}>` имеет только `aspect-video`, без явной ширины
2. Когда iframe создаётся через API, он не понимает "100% от чего"
3. Плеер отображается с минимальными размерами по умолчанию

## Решение
Добавить явные стили для контейнера и iframe внутри него:

### Файл: `src/components/admin/lesson-editor/blocks/VideoBlock.tsx`

1. **Контейнер плеера**: добавить `w-full` для полной ширины
2. **Стили для iframe внутри контейнера**: через CSS selector или inline styles убедиться, что iframe растягивается на весь контейнер

Изменения в строках 132-136:
```tsx
<div 
  id={containerId}
  className="aspect-video rounded-lg overflow-hidden bg-black w-full"
  style={{ minHeight: '360px' }}
/>
```

И добавить глобальный CSS или inline для iframe внутри контейнера Kinescope:
```css
[id^="kinescope-player"] iframe {
  width: 100% !important;
  height: 100% !important;
}
```

### Альтернативный подход (более надёжный)
В хуке `useKinescopePlayer.ts` после создания плеера найти iframe внутри контейнера и установить ему стили явно:

```typescript
// После создания плеера
const container = document.getElementById(containerId);
if (container) {
  const iframe = container.querySelector('iframe');
  if (iframe) {
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.position = 'absolute';
    iframe.style.inset = '0';
  }
}
```

И контейнер сделать `position: relative` с `aspect-ratio`:
```tsx
<div 
  id={containerId}
  className="relative aspect-video rounded-lg overflow-hidden bg-black w-full"
/>
```

---

## Технические детали

### VideoBlock.tsx (строки 132-136)
```tsx
// БЫЛО:
<div 
  id={containerId}
  className="aspect-video rounded-lg overflow-hidden bg-black"
/>

// СТАНЕТ:
<div 
  id={containerId}
  className="relative w-full aspect-video rounded-lg overflow-hidden bg-black"
/>
```

### useKinescopePlayer.ts (после строки 238)
После `playerRef.current = player;` добавить:
```typescript
// Force iframe to fill container
setTimeout(() => {
  const container = document.getElementById(containerId);
  if (container) {
    const iframe = container.querySelector('iframe');
    if (iframe) {
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.position = 'absolute';
      iframe.style.top = '0';
      iframe.style.left = '0';
    }
  }
}, 50);
```

---

## Ожидаемый результат
- Видеоплеер занимает всю ширину контейнера
- Соотношение сторон 16:9 сохраняется (aspect-video)
- Удобно смотреть без включения полноэкранного режима
- Работает на desktop, tablet и mobile

## Файлы для изменения
1. `src/components/admin/lesson-editor/blocks/VideoBlock.tsx` — добавить `relative w-full` к контейнеру
2. `src/hooks/useKinescopePlayer.ts` — принудительно установить размеры iframe после создания плеера

## DoD
- Видео отображается на всю ширину карточки контента
- Соотношение сторон 16:9
- Скриншот: видео занимает нормальный размер, без необходимости включать полный экран
