

# План исправлений: PostMessage Security + Fallback Logic

## Анализ текущего состояния

### Проблемы в VideoUnskippableBlock.tsx (строки 114-169)

| Проблема | Местоположение | Критичность |
|----------|----------------|-------------|
| `window.location.origin` в trustedOrigins — дыра безопасности | Строка 122 | BLOCKER |
| Нет проверки `event.source` | Строки 118-127 | BLOCKER |
| Нет валидации формата событий Kinescope | Строки 132-164 | Высокая |
| Fallback запускается только по клику, без auto-detect | Строки 171-200 | Средняя |
| При получении API событий fallback не останавливается | Строки 136-161 | Средняя |

### Проблемы в DiagnosticTableBlock.tsx (строки 99-111)

| Проблема | Местоположение | Критичность |
|----------|----------------|-------------|
| `genId` используется в useEffect без deps | Строка 102 | Средняя |
| `columns` не в deps | Строка 103 | Средняя |
| `onRowsChange` не в deps | Строка 107 | Средняя |
| Потенциальное "размножение" строк при ререндерах | Строки 99-111 | Высокая |

---

## PATCH-B: PostMessage Security для Kinescope

### Изменения в VideoUnskippableBlock.tsx

**Текущий код (строки 118-127):**
```typescript
const handleMessage = (event: MessageEvent) => {
  // PATCH-B: Проверка origin для Kinescope
  const trustedOrigins = [
    'https://kinescope.io',
    window.location.origin // Для локальной разработки ← ДЫРА
  ];
  
  if (!trustedOrigins.some(origin => event.origin.startsWith(origin))) {
    return;
  }
```

**Новый код:**
```typescript
const handleMessage = (event: MessageEvent) => {
  // PATCH-B: Жёсткая проверка origin для Kinescope
  // Реальные домены Kinescope player/embed
  const KINESCOPE_ORIGINS = [
    'https://kinescope.io',
    'https://player.kinescope.io',
  ];
  
  // 1) Проверка origin
  const originValid = KINESCOPE_ORIGINS.some(o => event.origin === o || event.origin.startsWith(o + '/'));
  if (!originValid) {
    return; // Игнорируем недоверенные источники
  }
  
  // 2) Проверка source: должен быть наш iframe
  if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
    return; // Сообщение не от нашего iframe
  }
  
  // 3) Валидация формата события
  if (!event.data) return;
  
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    
    // Проверка структуры: ожидаем type или event
    const eventType = data.type || data.event;
    if (!eventType || typeof eventType !== 'string') {
      return; // Неверный формат события
    }
    
    // Белый список событий Kinescope
    const ALLOWED_EVENTS = ['player:timeupdate', 'player:ended', 'player:play', 'player:pause', 
                            'timeupdate', 'ended', 'play', 'pause'];
    if (!ALLOWED_EVENTS.includes(eventType)) {
      return; // Неизвестное событие
    }
    
    // ... обработка событий
  } catch {
    // Not a JSON message, ignore
  }
};
```

### Ключевые изменения

1. **Удаление `window.location.origin`** — убрана дыра
2. **Добавление `player.kinescope.io`** — реальный домен плеера
3. **Проверка `event.source`** — сообщение должно быть от нашего iframe
4. **Белый список событий** — игнорируем неизвестные события
5. **Строгое сравнение origin** — `===` вместо `startsWith`

---

## PATCH-E: Корректный fallback при отсутствии событий API

### Новая логика

```text
┌─────────────────────────────────────────────────────────────────┐
│ СТАРТ ВИДЕО                                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Iframe загружен]                                              │
│       │                                                         │
│       ▼                                                         │
│  Запуск таймера: 5 секунд ожидания API                          │
│       │                                                         │
│       ├── [timeupdate пришёл] → apiWorking=true, стоп таймер    │
│       │                                                         │
│       └── [таймер истёк, нет API] → показать оверлей            │
│                   │                                             │
│                   ▼                                             │
│           [Клик "Начать просмотр"]                              │
│                   │                                             │
│                   ▼                                             │
│           startFallbackTimer()                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Изменения

**Добавить новый state и таймер автодетекта:**

```typescript
const [apiDetectionDone, setApiDetectionDone] = useState(false);
const apiDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

// Запуск таймера автодетекта API (5 сек)
useEffect(() => {
  if (isEditing || isCompleted || apiWorking) return;
  
  // Если уже есть embed URL → запускаем детекцию
  if (getEmbedUrl()) {
    apiDetectionTimeoutRef.current = setTimeout(() => {
      if (!apiWorking) {
        setApiDetectionDone(true); // API не ответил за 5 сек
      }
    }, 5000);
  }
  
  return () => {
    if (apiDetectionTimeoutRef.current) {
      clearTimeout(apiDetectionTimeoutRef.current);
    }
  };
}, [isEditing, isCompleted, getEmbedUrl, apiWorking]);

// При получении timeupdate — остановить fallback если запущен
if (data.type === 'player:timeupdate' || data.event === 'timeupdate') {
  setApiWorking(true);
  
  // Остановить fallback таймер если был запущен
  if (fallbackIntervalRef.current) {
    clearInterval(fallbackIntervalRef.current);
    fallbackIntervalRef.current = null;
    setFallbackTimer(null);
  }
  
  // ... остальной код
}
```

**Условие показа оверлея:**
```typescript
// Показывать оверлей "Начать просмотр" только если:
// - API не работает (apiWorking = false)
// - Детекция завершена (apiDetectionDone = true)
// - Видео ещё не запущено (videoStarted = false)
// - Есть duration_seconds для fallback
{!videoStarted && content.duration_seconds && !apiWorking && apiDetectionDone && (
  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
    <Button onClick={startFallbackTimer}>
      Начать просмотр
    </Button>
  </div>
)}
```

---

## PATCH-C: DiagnosticTableBlock — стабилизация useEffect

### Текущий код (строки 99-111)

```typescript
useEffect(() => {
  if (rows.length === 0 && localRows.length === 0 && !isCompleted) {
    const newRow: Record<string, unknown> = { _id: genId() };
    columns.forEach(col => {
      newRow[col.id] = col.type === 'number' ? 0 : col.type === 'slider' ? 5 : '';
    });
    setLocalRows([newRow]);
    onRowsChange?.([newRow]);
  } else if (rows.length > 0 && localRows.length === 0) {
    setLocalRows(rows);
  }
}, [rows, isCompleted]); // ← Неполные deps
```

### Исправленный код

```typescript
// Вынести genId за пределы компонента (стабильная функция)
const genId = () => Math.random().toString(36).substring(2, 9);

// Внутри компонента:
const columnsRef = useRef(columns);
columnsRef.current = columns;

const onRowsChangeRef = useRef(onRowsChange);
onRowsChangeRef.current = onRowsChange;

const initDoneRef = useRef(false);

useEffect(() => {
  // Одноразовая инициализация
  if (initDoneRef.current) return;
  
  if (rows.length === 0 && !isCompleted) {
    // Создать первую пустую строку
    const newRow: Record<string, unknown> = { _id: genId() };
    columnsRef.current.forEach(col => {
      newRow[col.id] = col.type === 'number' ? 0 : col.type === 'slider' ? 5 : '';
    });
    setLocalRows([newRow]);
    onRowsChangeRef.current?.([newRow]);
    initDoneRef.current = true;
  } else if (rows.length > 0) {
    setLocalRows(rows);
    initDoneRef.current = true;
  }
}, [rows, isCompleted]);
```

### Ключевые изменения

1. **`genId` вне компонента** — стабильная функция
2. **`initDoneRef`** — флаг одноразовой инициализации
3. **`columnsRef` / `onRowsChangeRef`** — refs вместо deps для избежания циклов
4. **Гарантия**: первая строка создаётся ровно 1 раз

---

## Файлы для изменения

| Файл | Изменение | PATCH |
|------|-----------|-------|
| `VideoUnskippableBlock.tsx` | Строки 118-169: security + fallback logic | B, E |
| `DiagnosticTableBlock.tsx` | Строки 99-122: стабилизация useEffect | C |

---

## Доказательства выполнения (DoD)

| Проверка | Метод |
|----------|-------|
| PostMessage security | Console: нет обработки сообщений от недоверенных origins |
| event.source проверка | Логи: сообщения от других iframes игнорируются |
| Kinescope API работает | Видео: прогресс растёт при просмотре Kinescope видео |
| Fallback активируется | Видео: если API не ответил за 5 сек — показать оверлей |
| Fallback останавливается | Видео: при получении timeupdate fallback интервал очищается |
| Первая строка таблицы | UI: при открытии DiagnosticTable уже есть 1 пустая строка |
| Нет размножения строк | UI: при ререндере строки не дублируются |
| SQL: данные сохраняются | `state_json` содержит role, videoProgress, pointA_rows, pointB_answers |

---

## Безопасность

- Удалена дыра `window.location.origin` из trusted origins
- Добавлена проверка `event.source === iframeRef.current.contentWindow`
- Белый список событий Kinescope (только известные типы)
- Строгое сравнение origin (без `startsWith` с произвольными путями)
- Никаких изменений RLS/RBAC

