

# План: Исправление парсинга XLSX для нового формата файла

## Причина ошибки

В файле `Эфиры_БУКВА_ЗАКОНА_IMPORT_v2.xlsx` заголовки колонок отличаются от ожидаемых:

| Заголовок в файле | Ожидаемый заголовок | Статус |
|-------------------|---------------------|--------|
| `Выпуск` | `Номер выпуска` | ❌ Не найден |
| `Вопрос` | `Номер вопроса` | ❌ Не найден |
| `Вопрос участника Клуба...` | `Вопрос ученика` | ❌ Не найден |

**Код на строках 545-553 ищет старые заголовки:**
```typescript
const episodeRaw = row.episodeNumber ?? row["Номер выпуска"] ?? "";
const questionNumber = row.questionNumber ?? row["Номер вопроса"];
const fullQuestion = row.fullQuestion ?? row["Вопрос ученика (копируем из анкеты)"];
```

Но заголовки в новом файле — `"Выпуск"`, `"Вопрос"`, `"Вопрос участника Клуба..."` — не добавлены как fallback!

**Ключевая причина**: Функция `normalizeRowKeys()` вызывается **только для CSV**, но **не для XLSX**. XLSX парсер (`sheet_to_json`) использует оригинальные заголовки как ключи объекта.

## Решение

Добавить вызов `normalizeRowKeys()` для XLSX файлов, чтобы новые заголовки маппились на внутренние поля (`episodeNumber`, `questionNumber`, `fullQuestion`, и т.д.).

## Файл для изменения

`src/pages/admin/AdminKbImport.tsx`

## Изменения

### 1. Применить normalizeRowKeys для XLSX (строки 521-522)

```typescript
// БЫЛО:
rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

// СТАНЕТ:
const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
// Normalize XLSX headers the same way as CSV
rows = rawRows.map(row => normalizeRowKeys(row, false));
```

### 2. Добавить маппинг для заголовка "Вопрос" (questionNumber)

В `CSV_COLUMN_MAP` (строка 37-52) добавить:

```typescript
"вопрос": "questionNumber",  // NEW: short variant "Вопрос"
```

**Важно**: Это должно идти **после** `"вопрос участника": "fullQuestion"`, чтобы длинный заголовок ловился первым (partial match приоритет).

### 3. Переупорядочить маппинги по приоритету partial match

```typescript
const CSV_COLUMN_MAP: Record<string, string> = {
  "дата ответа": "answerDate",
  "номер выпуска": "episodeNumber",
  "выпуск": "episodeNumber",
  "номер вопроса": "questionNumber",
  "вопрос участника": "fullQuestion",   // ДОЛЖЕН быть перед "вопрос"
  "вопрос ученика": "fullQuestion",
  "вопрос": "questionNumber",            // NEW: catch-all после длинных
  "суть вопроса": "title",
  "теги": "tags",
  "ссылка на видео в геткурсе": "getcourseUrl",
  "ссылка на видео в кинескопе": "kinescopeUrl",
  "тайминг старта": "timecode",
  "тайминг": "timecode",
  "время (секунды)": "timecodeSeconds",
  "год": "year",
};
```

### 4. Исправить порядок проверки partial match (более длинные паттерны первыми)

В функции `normalizeRowKeys()` сортировать паттерны по длине (longest first), чтобы `"вопрос участника"` ловился до `"вопрос"`:

```typescript
// Sort patterns by length descending (longest match first)
const sortedPatterns = Object.entries(CSV_COLUMN_MAP).sort(
  ([a], [b]) => b.length - a.length
);

for (const [pattern, field] of sortedPatterns) {
  if (normalizedKey.includes(pattern)) {
    result[field] = value;
    matched = true;
    break;
  }
}
```

## Ожидаемый результат

После правок:
1. ✅ XLSX файлы проходят через `normalizeRowKeys()` 
2. ✅ Заголовок `"Выпуск"` маппится на `episodeNumber`
3. ✅ Заголовок `"Вопрос"` маппится на `questionNumber` (короткий вариант)
4. ✅ Заголовок `"Вопрос участника Клуба..."` маппится на `fullQuestion`
5. ✅ Все 753 строки парсятся корректно
6. ✅ 0 ошибок валидации "Не распознан номер выпуска"

## DoD

1. Загрузить файл `Эфиры_БУКВА_ЗАКОНА_IMPORT_v2.xlsx`
2. Убедиться: **0 выпусков** → **75 выпусков**
3. Убедиться: **753 ошибки** → **0 ошибок**
4. Preview: раскрыть выпуск 1, проверить вопросы
5. Test Run на 1 выпуске → проверить создание

