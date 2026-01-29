
# План: Добавление поддержки CSV импорта для База знаний

## Проблема

На скриншоте видно, что CSV файл загружен, но **все 501 строки показывают ошибки**:
- `501` - Пустая суть вопроса
- `501` - Не распознан номер выпуска  
- `501` - Нет ссылки Kinescope
- `501` - Нет даты ответа

**Причина:** Текущий код использует XLSX библиотеку для парсинга, которая:
1. Неправильно читает CSV с кодировкой Windows-1251 (видны артефакты `���`)
2. Ищет заголовки на русском языке, которые не совпадают из-за кодировки

**Заголовки в CSV файле (видно из первой строки):**
```
Дата ответа;Номер выпуска;Номер вопроса;Вопрос ученика (копируем из анкеты);
Суть вопроса (из описания в канале, если есть; задача на Горбовой, если нет);
Теги (для поиска, ставим самостоятельно);Ссылка на видео в геткурсе;
Ссылка на видео в кинескопе;Тайминг (час:мин:сек начала видео с этим вопросом)
```

---

## Решение: Использовать PapaParse с автодетектом кодировки

### Шаг 1: Добавить парсинг CSV в `AdminKbImport.tsx`

**Изменения в `handleFileChange`:**

```typescript
const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setState((s) => ({ ...s, file, parsing: true, ... }));

  try {
    let rows: Record<string, any>[];

    // Определяем формат файла
    const isCSV = file.name.toLowerCase().endsWith(".csv");

    if (isCSV) {
      // CSV: читаем как текст с автодетектом кодировки
      const text = await readFileWithEncoding(file);
      const { rows: csvRows } = parseCSVContent(text);
      rows = csvRows;
    } else {
      // XLSX: динамический импорт
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    }

    // ... парсинг строк (общий для CSV и XLSX)
  } catch (err) {
    // ...
  }
}, []);
```

### Шаг 2: Добавить функцию `readFileWithEncoding` для детекта Windows-1251

```typescript
async function readFileWithEncoding(file: File): Promise<string> {
  // Сначала пробуем UTF-8
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buffer);
  
  // Проверяем на артефакты кодировки (признаки Windows-1251)
  if (text.includes("�") || /[\x80-\xFF]{3,}/.test(text.slice(0, 500))) {
    // Пробуем Windows-1251
    text = new TextDecoder("windows-1251").decode(buffer);
  }
  
  return text;
}
```

### Шаг 3: Нормализация заголовков CSV/XLSX

Создать маппинг заголовков для гибкости:

```typescript
const COLUMN_MAP: Record<string, string> = {
  "дата ответа": "answerDate",
  "номер выпуска": "episodeNumber", 
  "номер вопроса": "questionNumber",
  "вопрос ученика": "fullQuestion",
  "суть вопроса": "title",
  "теги": "tags",
  "ссылка на видео в геткурсе": "getcourseUrl",
  "ссылка на видео в кинескопе": "kinescopeUrl",
  "тайминг": "timecode",
};

function normalizeRow(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toLowerCase().trim();
    
    // Ищем частичное совпадение
    for (const [pattern, field] of Object.entries(COLUMN_MAP)) {
      if (normalizedKey.includes(pattern)) {
        result[field] = value;
        break;
      }
    }
    
    // Сохраняем оригинальный ключ как fallback
    result[key] = value;
  }
  
  return result;
}
```

### Шаг 4: Обновить парсинг строк для работы с нормализованными данными

```typescript
rows.forEach((rawRow, idx) => {
  const row = normalizeRow(rawRow);
  const rowIndex = idx + 2;

  const answerDate = parseDate(row.answerDate || row["Дата ответа"]);
  const episodeNumber = parseEpisodeNumber(row.episodeNumber || row["Номер выпуска"]);
  const title = String(row.title || row["Суть вопроса..."] || "").trim();
  const kinescopeUrl = String(row.kinescopeUrl || row["Ссылка на видео в кинескопе"] || "").trim();
  const timecodeRaw = row.timecode || row["Тайминг..."];
  
  // ... rest of validation
});
```

### Шаг 5: Исправить клик по вопросу — внутренний просмотр с таймкодом

**Файл:** `src/pages/LibraryLesson.tsx` (строки 337-348)

Текущий код открывает внешнюю ссылку:
```tsx
onClick={() => q.timecode_seconds && window.open(
  `${q.kinescope_url}?t=${q.timecode_seconds}`,
  '_blank'
)}
```

**Исправить на внутренний seek:**
```tsx
import { buildKinescopeUrlWithTimecode } from "@/hooks/useKbQuestions";

// Внутри компонента:
const [activeTimecode, setActiveTimecode] = useState<number | null>(null);

// При клике на вопрос:
onClick={() => {
  if (q.timecode_seconds) {
    setActiveTimecode(q.timecode_seconds);
  }
}}

// VideoBlock получает таймкод:
<VideoBlock 
  key={`video-${activeTimecode}`}  // key для пересоздания iframe
  content={{
    ...block.content,
    url: buildKinescopeUrlWithTimecode(block.content.url, activeTimecode)
  }}
/>
```

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/pages/admin/AdminKbImport.tsx` | Добавить CSV парсинг с автодетектом кодировки, нормализацию заголовков |
| `src/pages/LibraryLesson.tsx` | Внутренний seek по таймкоду вместо внешней ссылки |
| `src/lib/csv-parser.ts` | Использовать существующий `parseCSVContent` |

---

## Тестирование (DoD)

1. **Загрузка CSV:** Файл `Эфиры_Клуба_БУКВА_ЗАКОНА.csv` распознаётся без ошибок кодировки
2. **Статистика:** Показывает корректное количество выпусков (не 0)
3. **Предпросмотр:** Вопросы отображаются с правильными таймкодами (формат `MM:SS`)
4. **Клик по вопросу:** Видео начинает воспроизведение с указанного таймкода **внутри сайта**
5. **Test Run:** Успешный импорт тестового выпуска
6. **SQL-пруф:** `SELECT * FROM kb_questions WHERE episode_number = X` — показывает корректные `timecode_seconds`

---

## Скриншоты для подтверждения

После реализации предоставлю:
1. Скриншот страницы импорта с загруженным CSV без ошибок
2. Скриншот предпросмотра выпуска с таймкодами
3. Скриншот страницы урока с вопросами и работающим seek
4. SQL-запрос с результатами
