import { describe, it, expect } from 'vitest';
import { parseCSVContent } from './csv-parser';

// CSV Header mapping from AdminKbImport
const CSV_COLUMN_MAP: Record<string, string> = {
  "дата ответа": "answerDate",
  "номер выпуска": "episodeNumber",
  "номер вопроса": "questionNumber",
  "вопрос ученика": "fullQuestion",
  "суть вопроса": "title",
  "теги": "tags",
  "ссылка на видео в геткурсе": "getcourseUrl",
  "ссылка на видео в кинескопе": "kinescopeUrl",
  "тайминг": "timecode",
  "год": "year",
};

// Expected column order for fallback when headers are broken
const COLUMN_ORDER = [
  "answerDate",      // 0: Дата ответа
  "episodeNumber",   // 1: Номер выпуска
  "questionNumber",  // 2: Номер вопроса
  "fullQuestion",    // 3: Вопрос ученика
  "title",           // 4: Суть вопроса
  "tags",            // 5: Теги
  "getcourseUrl",    // 6: Ссылка на видео в геткурсе
  "kinescopeUrl",    // 7: Ссылка на видео в кинескопе
  "timecode",        // 8: Тайминг
];

function normalizeRowKeys(row: Record<string, any>, headersBroken: boolean = false): Record<string, any> {
  const result: Record<string, any> = {};
  
  // If headers are broken, use column index order
  if (headersBroken) {
    const values = Object.values(row);
    COLUMN_ORDER.forEach((field, idx) => {
      if (idx < values.length) {
        result[field] = values[idx];
      }
    });
    return result;
  }
  
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toLowerCase().trim();
    
    let matched = false;
    for (const [pattern, field] of Object.entries(CSV_COLUMN_MAP)) {
      if (normalizedKey.includes(pattern)) {
        result[field] = value;
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      result[key] = value;
    }
  }
  
  return result;
}

function detectBrokenHeaders(headers: string[]): boolean {
  if (headers.length > 12) return true;
  
  const expectedStartPatterns = [
    "дата", "номер", "вопрос", "суть", "теги", "ссылка", "тайминг", "год"
  ];
  
  const fragmentHeaders = headers.filter(h => {
    const lower = h.toLowerCase().trim();
    return lower && !expectedStartPatterns.some(p => lower.startsWith(p));
  });
  
  return fragmentHeaders.length > 3;
}

// Simulate Windows-1251 to UTF-8 conversion
function decodeWin1251(bytes: Uint8Array): string {
  return new TextDecoder('windows-1251').decode(bytes);
}

describe('KB Import CSV Parsing', () => {
  it('should parse CSV with semicolon delimiter and normalize headers', () => {
    // CSV with QUOTED header to avoid breaking (proper format)
    const csvContent = `Дата ответа;Номер выпуска;Номер вопроса;Вопрос ученика;"Суть вопроса";Теги;Ссылка в геткурсе;Ссылка на видео в кинескопе;Тайминг
15.01.2024;Выпуск №74;1;Вопрос от ученика;Как получить налоговый вычет?;#налоги#вычет;https://gc.example.com;https://kinescope.io/abc123;01:23:45`;

    const { headers, rows, delimiter } = parseCSVContent(csvContent);
    
    console.log('Headers:', headers);
    console.log('First row:', rows[0]);
    console.log('Delimiter:', delimiter);
    
    // Check delimiter detection
    expect(delimiter).toBe(';');
    expect(headers.length).toBe(9);
    expect(rows.length).toBe(1);
  });
  
  it('should use column index fallback when headers are broken', () => {
    // CSV with BROKEN header (embedded semicolon without quotes)
    const csvContent = `Дата ответа;Номер выпуска;Номер вопроса;Вопрос ученика;Суть вопроса (из описания; задача);Теги;Ссылка в геткурсе;Ссылка на видео в кинескопе;Тайминг;extra1;extra2;extra3;extra4
15.01.2024;74;1;Вопрос от ученика;Как получить налоговый вычет?;#налоги#вычет;https://gc.example.com;https://kinescope.io/abc123;01:23:45;;;;;`;
    
    const { rows, headers } = parseCSVContent(csvContent);
    const headersBroken = detectBrokenHeaders(headers);
    const normalized = normalizeRowKeys(rows[0], headersBroken);
    
    console.log('Broken headers:', headers);
    console.log('Headers broken detected:', headersBroken);
    console.log('Normalized row:', normalized);
    
    expect(headersBroken).toBe(true);
    expect(normalized.answerDate).toBe('15.01.2024');
    expect(normalized.episodeNumber).toBe('74');
    expect(normalized.title).toBe('Как получить налоговый вычет?');
    expect(normalized.kinescopeUrl).toBe('https://kinescope.io/abc123');
    expect(normalized.timecode).toBe('01:23:45');
  });
  
  it('should handle Windows-1251 encoded bytes', () => {
    const win1251Bytes = new Uint8Array([
      196, 224, 242, 224, 32, 238, 242, 226, 229, 242, 224,
      59,
      205, 238, 236, 229, 240, 32, 226, 251, 239, 243, 241, 234, 224
    ]);
    
    const decoded = decodeWin1251(win1251Bytes);
    expect(decoded).toBe('Дата ответа;Номер выпуска');
  });
  
  it('should handle quoted fields with embedded semicolons', () => {
    const csvContent = `"Дата ответа";"Номер выпуска";"Суть вопроса (описание; задача)";"Кинескоп"
15.01.2024;74;"Вопрос; с точкой запятой";https://kinescope.io/abc`;
    
    const { rows, headers } = parseCSVContent(csvContent);
    
    console.log('Headers with quotes:', headers);
    console.log('Row with quotes:', rows[0]);
    
    expect(rows.length).toBe(1);
    expect(headers).toContain('Суть вопроса (описание; задача)');
  });
});
