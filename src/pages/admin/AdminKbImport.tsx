import { useState, useCallback, useMemo } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { parseTimecode, formatTimecode } from "@/hooks/useKbQuestions";
import { EPISODE_SUMMARIES, getEpisodeSummary } from "@/lib/episode-summaries";
import { parseCSVContent } from "@/lib/csv-parser";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Play,
  Loader2,
  ChevronDown,
  ChevronRight,
  Video,
  HelpCircle,
  Sparkles,
  RotateCcw,
  Download,
  AlertTriangle,
} from "lucide-react";

// CSV Header mapping: normalize Russian headers to internal field names
// Uses partial matching to handle variations and broken headers
const CSV_COLUMN_MAP: Record<string, string> = {
  "дата ответа": "answerDate",
  "номер выпуска": "episodeNumber",
  "выпуск": "episodeNumber",
  "номер вопроса": "questionNumber",
  "вопрос участника": "fullQuestion",   // MUST be before "вопрос" (longest match first)
  "вопрос ученика": "fullQuestion",
  "вопрос": "questionNumber",           // NEW: catch-all short variant (after longer patterns)
  "суть вопроса": "title",
  "теги": "tags",
  "ссылка на видео в геткурсе": "getcourseUrl",
  "ссылка на видео в кинескопе": "kinescopeUrl",
  "тайминг старта": "timecode",
  "тайминг": "timecode",
  "время (секунды)": "timecodeSeconds",
  "год": "year",
};

// Expected column order for XLSX (used with fixed column positions)
// Updated for БУКВА_ЗАКОНА file structure (8 columns)
const COLUMN_ORDER = [
  "answerDate",      // 0: Дата ответа
  "episodeNumber",   // 1: Выпуск
  "questionNumber",  // 2: Вопрос
  "fullQuestion",    // 3: Вопрос участника Клуба
  "title",           // 4: Суть вопроса
  "kinescopeUrl",    // 5: Ссылка на видео в кинескопе
  "timecode",        // 6: Тайминг старта ответа
  "timecodeSeconds", // 7: Время (секунды)
];

/**
 * Extract timecode seconds from Kinescope URL (?t=1234)
 */
function extractTimecodeFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = String(url).match(/[?&]t=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse full description from "Описание выпуска (подробно): ..."
 */
function parseFullDescription(text: string | null | undefined): string {
  if (!text) return "";
  const match = String(text).match(/Описание выпуска \(подробно\):\s*(.+)/i);
  return match ? match[1].trim() : String(text).trim();
}

/**
 * Parse short description from "Кратко: ..."
 */
function parseShortDescription(text: string | null | undefined): string {
  if (!text) return "";
  const match = String(text).match(/Кратко:\s*(.+)/i);
  return match ? match[1].trim() : String(text).trim();
}

/**
 * Check if row is episode description (not a question)
 * Episode description rows have empty questionNumber
 */
function isEpisodeDescriptionRow(questionNumber: any): boolean {
  return !questionNumber || String(questionNumber).trim() === "";
}

// Windows-1251 → Unicode mapping for bytes 0x80-0xFF (Russian Cyrillic)
const WIN1251_MAP: Record<number, string> = {
  0x80: "\u0402", 0x81: "\u0403", 0x82: "\u201A", 0x83: "\u0453", 0x84: "\u201E", 0x85: "\u2026", 0x86: "\u2020", 0x87: "\u2021",
  0x88: "\u20AC", 0x89: "\u2030", 0x8A: "\u0409", 0x8B: "\u2039", 0x8C: "\u040A", 0x8D: "\u040C", 0x8E: "\u040B", 0x8F: "\u040F",
  0x90: "\u0452", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201C", 0x94: "\u201D", 0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014",
  0x98: "\u02DC", 0x99: "\u2122", 0x9A: "\u0459", 0x9B: "\u203A", 0x9C: "\u045A", 0x9D: "\u045C", 0x9E: "\u045B", 0x9F: "\u045F",
  0xA0: "\u00A0", 0xA1: "\u040E", 0xA2: "\u045E", 0xA3: "\u0408", 0xA4: "\u00A4", 0xA5: "\u0490", 0xA6: "\u00A6", 0xA7: "\u00A7",
  0xA8: "\u0401", 0xA9: "\u00A9", 0xAA: "\u0404", 0xAB: "\u00AB", 0xAC: "\u00AC", 0xAD: "\u00AD", 0xAE: "\u00AE", 0xAF: "\u0407",
  0xB0: "\u00B0", 0xB1: "\u00B1", 0xB2: "\u0406", 0xB3: "\u0456", 0xB4: "\u0491", 0xB5: "\u00B5", 0xB6: "\u00B6", 0xB7: "\u00B7",
  0xB8: "\u0451", 0xB9: "\u2116", 0xBA: "\u0454", 0xBB: "\u00BB", 0xBC: "\u0458", 0xBD: "\u0405", 0xBE: "\u0455", 0xBF: "\u0457",
  // Russian А-Я (0xC0-0xDF)
  0xC0: "А", 0xC1: "Б", 0xC2: "В", 0xC3: "Г", 0xC4: "Д", 0xC5: "Е", 0xC6: "Ж", 0xC7: "З",
  0xC8: "И", 0xC9: "Й", 0xCA: "К", 0xCB: "Л", 0xCC: "М", 0xCD: "Н", 0xCE: "О", 0xCF: "П",
  0xD0: "Р", 0xD1: "С", 0xD2: "Т", 0xD3: "У", 0xD4: "Ф", 0xD5: "Х", 0xD6: "Ц", 0xD7: "Ч",
  0xD8: "Ш", 0xD9: "Щ", 0xDA: "Ъ", 0xDB: "Ы", 0xDC: "Ь", 0xDD: "Э", 0xDE: "Ю", 0xDF: "Я",
  // Russian а-я (0xE0-0xFF)
  0xE0: "а", 0xE1: "б", 0xE2: "в", 0xE3: "г", 0xE4: "д", 0xE5: "е", 0xE6: "ж", 0xE7: "з",
  0xE8: "и", 0xE9: "й", 0xEA: "к", 0xEB: "л", 0xEC: "м", 0xED: "н", 0xEE: "о", 0xEF: "п",
  0xF0: "р", 0xF1: "с", 0xF2: "т", 0xF3: "у", 0xF4: "ф", 0xF5: "х", 0xF6: "ц", 0xF7: "ч",
  0xF8: "ш", 0xF9: "щ", 0xFA: "ъ", 0xFB: "ы", 0xFC: "ь", 0xFD: "э", 0xFE: "ю", 0xFF: "я",
};

/**
 * Manual Windows-1251 decoder (bypasses buggy browser TextDecoder)
 */
function manualDecodeWin1251(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 0x80) {
      result += String.fromCharCode(byte);
    } else {
      result += WIN1251_MAP[byte] || "?";
    }
  }
  return result;
}

/**
 * Check if a row is "garbage" (category headers, empty, etc.)
 * Returns true if the row should be SKIPPED
 */
function isGarbageRow(row: Record<string, any>): boolean {
  const values = Object.values(row);
  
  // All values are empty or whitespace
  if (values.every(v => !String(v ?? "").trim())) {
    return true;
  }
  
  // Check first value for garbage patterns
  const first = String(values[0] ?? "").trim().toUpperCase();
  
  // Category headers like "ВОПРОС ОТВЕТ", "Еженедельные эфиры"
  const garbagePatterns = [
    "ВОПРОС ОТВЕТ",
    "ЕЖЕНЕДЕЛЬНЫЕ ЭФИРЫ",
    "ВЕБИНАРЫ",
    "РАЗНОЕ",
    "ТЕМАТИЧЕСКИЕ УРОКИ",
    "ДАТА ОТВЕТА", // Header row appearing mid-file
  ];
  
  if (garbagePatterns.some(p => first.includes(p))) {
    return true;
  }
  
  return false;
}

/**
 * Normalize row keys using CSV_COLUMN_MAP (partial match)
 * Falls back to column index order if headers are broken (contain extra semicolons)
 */
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
  
  // Sort patterns by length descending (longest match first)
  // This ensures "вопрос участника" is matched before "вопрос"
  const sortedPatterns = Object.entries(CSV_COLUMN_MAP).sort(
    ([a], [b]) => b.length - a.length
  );
  
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toLowerCase().trim();
    
    // Try partial match from sorted CSV_COLUMN_MAP (longest first)
    let matched = false;
    for (const [pattern, field] of sortedPatterns) {
      if (normalizedKey.includes(pattern)) {
        result[field] = value;
        matched = true;
        break;
      }
    }
    
    // Keep original key as fallback
    if (!matched) {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Detect if CSV headers are broken (contain embedded semicolons that weren't quoted)
 */
function detectBrokenHeaders(headers: string[]): boolean {
  // If we have more than 9-10 headers, they're probably broken
  // Expected: 9 columns (Дата, Номер выпуска, Номер вопроса, Вопрос ученика, Суть, Теги, Геткурс, Кинескоп, Тайминг)
  if (headers.length > 12) {
    console.warn("[detectBrokenHeaders] Too many headers:", headers.length);
    return true;
  }
  
  // Check if any header looks like a fragment (doesn't start with expected patterns)
  const expectedStartPatterns = [
    "дата", "номер", "вопрос", "суть", "теги", "ссылка", "тайминг", "год"
  ];
  
  const fragmentHeaders = headers.filter(h => {
    const lower = h.toLowerCase().trim();
    return lower && !expectedStartPatterns.some(p => lower.startsWith(p));
  });
  
  if (fragmentHeaders.length > 3) {
    console.warn("[detectBrokenHeaders] Found fragment headers:", fragmentHeaders);
    return true;
  }
  
  return false;
}

/**
 * Read file with auto-detection of Windows-1251 encoding
 * Uses manual decoder to bypass buggy browser TextDecoder implementations
 */
async function readFileWithEncoding(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  // Check for UTF-8 BOM
  const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  
  if (hasUtf8Bom) {
    console.log("[readFileWithEncoding] UTF-8 BOM detected");
    return new TextDecoder("utf-8").decode(buffer);
  }
  
  // Try UTF-8 first
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  
  // Check if we got valid Cyrillic characters (а-я, А-Я, ё, Ё)
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(utf8Text);
  const hasReplacementChar = utf8Text.includes("\uFFFD");
  
  console.log("[readFileWithEncoding] UTF-8 attempt:", { 
    hasCyrillic, 
    hasReplacementChar, 
    firstChars: utf8Text.slice(0, 100) 
  });
  
  // If UTF-8 is valid with Cyrillic and no replacement chars - use it
  if (hasCyrillic && !hasReplacementChar) {
    return utf8Text;
  }
  
  // Check for high bytes (0xC0-0xFF) typical of Windows-1251 Russian text
  const hasHighBytes = bytes.slice(0, 500).some(b => b >= 0xC0 && b <= 0xFF);
  
  if (hasHighBytes) {
    // Use manual decoder to avoid browser bugs
    const manualText = manualDecodeWin1251(bytes);
    console.log("[readFileWithEncoding] Manual Win1251 decoded:", manualText.slice(0, 100));
    
    // Verify we got proper Cyrillic
    if (/[А-Яа-яЁё]{3,}/.test(manualText)) {
      return manualText;
    }
  }
  
  // Fallback to browser's TextDecoder for windows-1251
  const win1251Text = new TextDecoder("windows-1251").decode(buffer);
  console.log("[readFileWithEncoding] Browser Win1251 decoded:", win1251Text.slice(0, 100));
  
  return win1251Text;
}

// Container module ID for knowledge-videos (from page_sections)
const CONTAINER_MODULE_SLUG = "container-knowledge-videos";

// Max episode number to accept (filter out Excel serial numbers like 45302)
const MAX_EPISODE_NUMBER = 200;

// Validation error types
type ValidationErrorType = "empty_title" | "no_episode" | "no_kinescope" | "no_date" | "bad_timecode";

interface ValidationError {
  row: number;
  type: ValidationErrorType;
  message: string;
  values: Record<string, any>;
}

interface ParsedRow {
  answerDate: string;
  episodeNumber: number;
  questionNumber: number | null;
  fullQuestion: string;
  title: string;
  tags: string[];
  getcourseUrl: string;
  kinescopeUrl: string;
  timecode: string | number;
  timecodeSeconds: number | null;
  year: number;
  errors: ValidationError[];
  rowIndex: number;
}

interface GroupedEpisode {
  episodeNumber: number;
  answerDate: string;
  kinescopeUrl: string;
  questions: ParsedRow[];
  description: string;
  fullDescription: string;   // NEW: Full description from "Описание выпуска (подробно): ..."
  shortDescription: string;  // NEW: Short description from "Кратко: ..."
  errors: ValidationError[];
  warnings: string[];
}

interface ImportState {
  file: File | null;
  parsing: boolean;
  parsed: boolean;
  parsedRows: ParsedRow[];
  episodes: GroupedEpisode[];
  validationErrors: ValidationError[];
  importing: boolean;
  importProgress: number;
  importLog: string[];
  completed: boolean;
  usePredefinedSummaries: boolean;
  testEpisodeNumber: number | null;
}

// Error type labels for UI
const ERROR_TYPE_LABELS: Record<ValidationErrorType, string> = {
  empty_title: "Пустая суть вопроса",
  no_episode: "Не распознан номер выпуска",
  no_kinescope: "Нет ссылки Kinescope",
  no_date: "Нет даты ответа",
  bad_timecode: "Некорректный таймкод",
};

export default function AdminKbImport() {
  const [state, setState] = useState<ImportState>({
    file: null,
    parsing: false,
    parsed: false,
    parsedRows: [],
    episodes: [],
    validationErrors: [],
    importing: false,
    importProgress: 0,
    importLog: [],
    completed: false,
    usePredefinedSummaries: true,
    testEpisodeNumber: null,
  });

  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(new Set());

  // PATCH-5: Strict episode number parsing (handles damaged text like "‚ыпуск Ь74")
  const parseEpisodeNumber = (value: string | number): number => {
    const str = String(value ?? "").trim();
    if (!str) return 0;

    // Format "Выпуск №74", "Выпуск 74", or damaged "‚ыпуск Ь74"
    // Look for any word ending with "ыпуск" followed by optional № and digits
    let m = str.match(/ыпуск\s*[№Ь#]?\s*(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      return n > 0 && n <= MAX_EPISODE_NUMBER ? n : 0;
    }

    // Try matching "Выпуск" or "выпуск" specifically
    m = str.match(/выпуск\s*№?\s*(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      return n > 0 && n <= MAX_EPISODE_NUMBER ? n : 0;
    }

    // Pure number 1-200
    if (/^\d+$/.test(str)) {
      const n = parseInt(str, 10);
      return n > 0 && n <= MAX_EPISODE_NUMBER ? n : 0;
    }

    // Last resort: find any number in the string
    m = str.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      return n > 0 && n <= MAX_EPISODE_NUMBER ? n : 0;
    }

    return 0;
  };

  // Parse tags from "#налог#ИП" format
  const parseTags = (value: string): string[] => {
    if (!value) return [];
    return value
      .split("#")
      .map((t) => t.trim())
      .filter(Boolean);
  };

  // PATCH-3: Parse date from DD.MM.YY, DD.MM.YYYY, DD.MM (use year column), ISO, or Excel serial
  const parseDate = (value: string | number | Date | null | undefined, yearFallback?: number): string => {
    if (value === null || value === undefined || value === "") return "";

    // Date object (if XLSX returns Date)
    if (value instanceof Date && !isNaN(value.getTime())) {
      // Use local date components to avoid UTC shift
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, "0");
      const d = String(value.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }

    // Excel serial (number or 5-digit string)
    const asString = String(value).trim();
    if (typeof value === "number" || /^\d{5}$/.test(asString)) {
      const serial = typeof value === "number" ? value : parseInt(asString, 10);
      if (!Number.isFinite(serial) || serial <= 0) return "";

      // 1899-12-30 (Excel 1900 system with leap bug compensation)
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelEpoch.getTime() + serial * 86400000);
      return date.toISOString().slice(0, 10);
    }

    // DD.MM.YY / DD.MM.YYYY
    let m = asString.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) {
      const [, d, mo, y] = m;
      const yyyy = y.length === 2 ? `20${y}` : y;
      return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    // DD.MM (no year - use yearFallback or current year)
    m = asString.match(/^(\d{1,2})\.(\d{1,2})$/);
    if (m) {
      const [, d, mo] = m;
      const yyyy = yearFallback || new Date().getFullYear();
      return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    // ISO format
    if (/^\d{4}-\d{2}-\d{2}/.test(asString)) return asString.slice(0, 10);

    return "";
  };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input to allow re-uploading same file
    e.currentTarget.value = "";

    setState((s) => ({ ...s, file, parsing: true, parsed: false, parsedRows: [], episodes: [], validationErrors: [] }));

    try {
      let rows: Record<string, any>[];

      // Detect file format by extension
      const isCSV = file.name.toLowerCase().endsWith(".csv");

      if (isCSV) {
        // CSV: read with encoding detection (Windows-1251 support)
        const text = await readFileWithEncoding(file);
        console.log("[AdminKbImport] CSV text first 500 chars:", text.slice(0, 500));
        
        const { rows: csvRows, headers, errors: csvErrors, delimiter } = parseCSVContent(text);
        
        console.log("[AdminKbImport] CSV parsed:", {
          rowCount: csvRows.length,
          headers,
          delimiter,
          firstRow: csvRows[0],
          errors: csvErrors.slice(0, 5),
        });
        
        if (csvErrors.length > 0) {
          console.warn("CSV parse warnings:", csvErrors);
        }
        
        // Detect if headers are broken (embedded semicolons without quotes)
        const headersBroken = detectBrokenHeaders(headers);
        console.log("[AdminKbImport] Headers broken:", headersBroken);
        
        // Normalize CSV headers to internal field names
        rows = csvRows.map(row => normalizeRowKeys(row, headersBroken));
        console.log("[AdminKbImport] First normalized row:", rows[0]);
      } else {
        // XLSX: dynamic import to reduce bundle size
        const XLSX = await import("xlsx");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
        
        // CRITICAL: Apply normalizeRowKeys to XLSX rows (same as CSV)
        // This maps headers like "Выпуск" → episodeNumber, "Вопрос" → questionNumber, etc.
        rows = rawRows.map(row => normalizeRowKeys(row, false));
        console.log("[AdminKbImport] XLSX normalized row sample:", rows[0]);
      }

      const parsed: ParsedRow[] = [];
      const allErrors: ValidationError[] = [];
      let skippedGarbage = 0;

      rows.forEach((row, idx) => {
        const rowIndex = idx + 2; // Excel/CSV rows start at 1, header is row 1
        
        // SKIP garbage rows (category headers, empty rows)
        if (isGarbageRow(row)) {
          skippedGarbage++;
          return; // Skip this row entirely
        }
        
        const rowErrors: ValidationError[] = [];

        // Get year first for date parsing
        const year = parseInt(String(row.year ?? row["Год"] ?? row[""] ?? "2024"), 10) || 2024;

        // Use normalized keys for CSV, original keys for XLSX
        const answerDateRaw = row.answerDate ?? row["Дата ответа"];
        const answerDate = parseDate(answerDateRaw, year); // Pass year for DD.MM format
        const episodeRaw = row.episodeNumber ?? row["Номер выпуска"] ?? "";
        const episodeNumber = parseEpisodeNumber(episodeRaw);
        const questionNumber = row.questionNumber ?? row["Номер вопроса"];
        const questionNum = questionNumber ? parseInt(String(questionNumber), 10) : null;
        const fullQuestion = String(row.fullQuestion ?? row["Вопрос ученика (копируем из анкеты)"] ?? "").trim();
        const title = String(row.title ?? row["Суть вопроса (из описания в канале, если есть; задача на Горбовой, если нет)"] ?? "").trim();
        const tagsRaw = String(row.tags ?? row["Теги (для поиска, ставим самостоятельно)"] ?? "");
        const getcourseUrl = String(row.getcourseUrl ?? row["Ссылка на видео в геткурсе"] ?? "").trim();
        const kinescopeUrl = String(row.kinescopeUrl ?? row["Ссылка на видео в кинескопе"] ?? "").trim();
        
        // PRIORITY: Use "Время (секунды)" column if available, extract from URL, or parse timecode string
        const secondsRaw = row.timecodeSeconds ?? row["Время (секунды)"];
        const timecodeRaw = row.timecode ?? row["Тайминг (час:мин:сек начала видео с этим вопросом)"];
        
        // Try seconds column first (numeric), then URL extraction, then parseTimecode
        let timecodeSeconds: number | null = null;
        
        // 1. Try seconds column first (numeric)
        if (secondsRaw !== undefined && secondsRaw !== null && secondsRaw !== "") {
          const sec = parseInt(String(secondsRaw), 10);
          if (!isNaN(sec) && sec >= 0) {
            timecodeSeconds = sec;
          }
        }
        
        // 2. Try extracting from Kinescope URL (?t=1234)
        if (timecodeSeconds === null) {
          timecodeSeconds = extractTimecodeFromUrl(kinescopeUrl);
        }
        
        // 3. Fallback to parsing timecode string
        if (timecodeSeconds === null) {
          timecodeSeconds = parseTimecode(timecodeRaw);
        }

        // Collect values for error export
        const errorValues = {
          answerDate: String(answerDateRaw ?? ""),
          episodeNumber: String(episodeRaw ?? ""),
          title: title.slice(0, 50),
          kinescopeUrl: kinescopeUrl.slice(0, 50),
          timecode: String(secondsRaw ?? timecodeRaw ?? ""),
        };

        // Check if this is an episode description row (empty questionNumber)
        const isDescriptionRow = isEpisodeDescriptionRow(questionNumber);
        
        // Validation with typed errors - skip validation for description rows
        if (!isDescriptionRow) {
          if (!title) {
            rowErrors.push({
              row: rowIndex,
              type: "empty_title",
              message: `Строка ${rowIndex}: пустая "Суть вопроса"`,
              values: errorValues,
            });
          }
        }
        if (!episodeNumber) {
          rowErrors.push({
            row: rowIndex,
            type: "no_episode",
            message: `Строка ${rowIndex}: не распознан номер выпуска "${episodeRaw}"`,
            values: errorValues,
          });
        }
        if (!kinescopeUrl) {
          rowErrors.push({
            row: rowIndex,
            type: "no_kinescope",
            message: `Строка ${rowIndex}: отсутствует ссылка Kinescope`,
            values: errorValues,
          });
        }
        if (!answerDate) {
          rowErrors.push({
            row: rowIndex,
            type: "no_date",
            message: `Строка ${rowIndex}: не распознана дата "${answerDateRaw}"`,
            values: errorValues,
          });
        }

        parsed.push({
          answerDate,
          episodeNumber,
          questionNumber: questionNum || (isDescriptionRow ? null : idx + 1),
          fullQuestion,
          title,
          tags: parseTags(tagsRaw),
          getcourseUrl,
          kinescopeUrl,
          timecode: timecodeRaw,
          timecodeSeconds,
          year,
          errors: rowErrors,
          rowIndex,
        });

        allErrors.push(...rowErrors);
      });

      // Log garbage rows skipped
      if (skippedGarbage > 0) {
        console.log(`[AdminKbImport] Skipped ${skippedGarbage} garbage rows`);
      }

      // PATCH-4: Group by episode_number (not URL)
      const episodeMap = new Map<number, GroupedEpisode>();

      parsed.forEach((row) => {
        if (!row.episodeNumber) return;

        // Check if this is an episode description row (empty questionNumber)
        const isDescriptionRow = isEpisodeDescriptionRow(row.questionNumber);

        if (!episodeMap.has(row.episodeNumber)) {
          episodeMap.set(row.episodeNumber, {
            episodeNumber: row.episodeNumber,
            answerDate: row.answerDate,
            kinescopeUrl: "",
            questions: [],
            description: "",
            fullDescription: "",   // NEW
            shortDescription: "",  // NEW
            errors: [],
            warnings: [],
          });
        }

        const ep = episodeMap.get(row.episodeNumber)!;

        if (isDescriptionRow) {
          // This row is episode metadata, not a question
          ep.fullDescription = parseFullDescription(row.fullQuestion);
          ep.shortDescription = parseShortDescription(row.title);
          
          // URL from description row is the main video (without timecode)
          if (row.kinescopeUrl && !ep.kinescopeUrl) {
            ep.kinescopeUrl = row.kinescopeUrl;
          }
          
          // Use date from description row if available
          if (!ep.answerDate && row.answerDate) {
            ep.answerDate = row.answerDate;
          }
          
          // Don't add to questions
          return;
        }

        // Regular question row
        ep.questions.push(row);

        // URL normalization & collision warning (for questions - URLs have ?t= timecode)
        const url = String(row.kinescopeUrl || "").trim();
        if (url) {
          // Extract base URL without timecode for episode
          const baseUrl = url.replace(/[?&]t=\d+/g, "");
          if (!ep.kinescopeUrl) {
            ep.kinescopeUrl = baseUrl;
          }
        }

        // Use first valid date
        if (!ep.answerDate && row.answerDate) {
          ep.answerDate = row.answerDate;
        }
      });

      // Sort episodes and compute descriptions (use file descriptions if available)
      const episodes = Array.from(episodeMap.values())
        .sort((a, b) => b.episodeNumber - a.episodeNumber)
        .map((ep) => ({
          ...ep,
          // Priority: file shortDescription > file fullDescription > EPISODE_SUMMARIES > fallback
          description: ep.shortDescription || 
            ep.fullDescription ||
            EPISODE_SUMMARIES[ep.episodeNumber] || 
            getEpisodeSummary(ep.episodeNumber, ep.questions.map((q) => q.title)),
          errors: ep.questions.flatMap((q) => q.errors),
        }));

      setState((s) => ({
        ...s,
        parsing: false,
        parsed: true,
        parsedRows: parsed,
        episodes,
        validationErrors: allErrors,
      }));
    } catch (err) {
      console.error("Parse error:", err);
      toast.error("Ошибка парсинга файла");
      setState((s) => ({ ...s, parsing: false }));
    }
  }, []);

  // PATCH-6: Download errors as CSV
  const downloadErrorsCsv = useCallback(() => {
    const header = ["row", "type", "message", "values_json"];
    const lines = state.validationErrors.map((e) =>
      [e.row, e.type, `"${e.message.replace(/"/g, '""')}"`, `"${JSON.stringify(e.values).replace(/"/g, '""')}"`].join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kb-import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [state.validationErrors]);

  // PATCH-6: Group errors by type
  const errorGroups = useMemo(() => {
    const groups: Record<ValidationErrorType, ValidationError[]> = {
      empty_title: [],
      no_episode: [],
      no_kinescope: [],
      no_date: [],
      bad_timecode: [],
    };
    state.validationErrors.forEach((err) => {
      if (groups[err.type]) {
        groups[err.type].push(err);
      }
    });
    return groups;
  }, [state.validationErrors]);

  // PATCH-7: Get critical errors for a specific episode
  const getCriticalErrorsForEpisode = useCallback((ep: GroupedEpisode): string[] => {
    const critical: string[] = [];
    if (!ep.kinescopeUrl) critical.push("Нет ссылки Kinescope");
    if (!ep.answerDate) critical.push("Нет даты выпуска");

    const emptyTitles = ep.questions.filter((q) => !q.title).length;
    if (emptyTitles > 0) critical.push(`${emptyTitles} вопросов без заголовка`);

    return critical;
  }, []);

  // PATCH-7: Check if test episode has critical errors
  const testEpisodeCriticalErrors = useMemo(() => {
    if (!state.testEpisodeNumber) return [];

    const episode = state.episodes.find((e) => e.episodeNumber === state.testEpisodeNumber);
    if (!episode) return ["Выпуск не найден в файле"];

    return getCriticalErrorsForEpisode(episode);
  }, [state.testEpisodeNumber, state.episodes, getCriticalErrorsForEpisode]);

  // PATCH-7: Check if any validation errors exist (for Bulk Run block)
  const hasAnyValidationErrors = state.validationErrors.length > 0;

  // Get container module ID
  const getContainerModuleId = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from("training_modules")
      .select("id")
      .eq("slug", CONTAINER_MODULE_SLUG)
      .single();

    if (error || !data) {
      console.error("Container module not found:", error);
      return null;
    }
    return data.id;
  };

  // Import single episode
  const importEpisode = async (
    episode: GroupedEpisode,
    moduleId: string
  ): Promise<{ success: boolean; lessonId?: string; error?: string }> => {
    const slug = `episode-${episode.episodeNumber}`;
    const title = `Выпуск №${episode.episodeNumber}`;
    // Use file descriptions if available (file > EPISODE_SUMMARIES > fallback)
    const description = episode.shortDescription || 
      episode.fullDescription ||
      (state.usePredefinedSummaries ? EPISODE_SUMMARIES[episode.episodeNumber] : null) ||
      episode.description;

    try {
      // 1. Check if lesson exists
      const { data: existing } = await supabase
        .from("training_lessons")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      let lessonId: string;
      let isNewLesson = false;

      if (existing) {
        // Update existing lesson
        const { error } = await supabase
          .from("training_lessons")
          .update({
            title,
            description,
            published_at: episode.answerDate || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (error) throw error;
        lessonId = existing.id;
      } else {
        isNewLesson = true;
        
        // Create new lesson
        const { data: newLesson, error } = await supabase
          .from("training_lessons")
          .insert({
            module_id: moduleId,
            title,
            slug,
            description,
            content_type: "video",
            is_active: true,
            sort_order: episode.episodeNumber,
            published_at: episode.answerDate || null,
          })
          .select("id")
          .single();

        if (error) throw error;
        lessonId = newLesson.id;

        // Create video block
        const { error: blockError } = await supabase.from("lesson_blocks").insert({
          lesson_id: lessonId,
          block_type: "video",
          sort_order: 0,
          content: {
            url: episode.kinescopeUrl,
            title: episode.answerDate 
              ? format(new Date(episode.answerDate), "dd.MM.yyyy") 
              : null,
            provider: "kinescope",
          },
        });

        if (blockError) console.warn("Block creation failed:", blockError);

        // Generate AI cover for new lesson
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData?.session?.access_token;
          
          if (token) {
            const coverDescription = episode.shortDescription || episode.fullDescription || description;
            const coverResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-cover`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  title: title,
                  description: coverDescription,
                  moduleId: lessonId,
                }),
              }
            );
            
            if (coverResponse.ok) {
              const coverResult = await coverResponse.json();
              if (coverResult.url) {
                await supabase
                  .from("training_lessons")
                  .update({ thumbnail_url: coverResult.url })
                  .eq("id", lessonId);
                console.log(`[importEpisode] AI cover generated for episode ${episode.episodeNumber}`);
              }
            }
          }
        } catch (err) {
          console.warn("Cover generation failed (non-blocking):", err);
        }
      }

      // 2. Upsert questions
      for (const q of episode.questions) {
        if (!q.title) continue; // Skip questions without title

        const { error: qError } = await supabase.from("kb_questions").upsert(
          {
            lesson_id: lessonId,
            episode_number: episode.episodeNumber,
            question_number: q.questionNumber,
            title: q.title,
            full_question: q.fullQuestion || null,
            tags: q.tags.length > 0 ? q.tags : null,
            kinescope_url: q.kinescopeUrl,
            timecode_seconds: q.timecodeSeconds,
            answer_date: q.answerDate || episode.answerDate,
          },
          {
            onConflict: "lesson_id,question_number",
          }
        );

        if (qError) console.warn("Question upsert error:", qError);
      }

      return { success: true, lessonId };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // Test Run: import single episode
  const handleTestRun = async () => {
    if (!state.testEpisodeNumber) {
      toast.error("Выберите номер выпуска для тестового импорта");
      return;
    }

    const episode = state.episodes.find((e) => e.episodeNumber === state.testEpisodeNumber);
    if (!episode) {
      toast.error(`Выпуск №${state.testEpisodeNumber} не найден в файле`);
      return;
    }

    // PATCH-7: Block if critical errors
    const criticalErrors = getCriticalErrorsForEpisode(episode);
    if (criticalErrors.length > 0) {
      toast.error(`Невозможно импортировать: ${criticalErrors.join(", ")}`);
      return;
    }

    setState((s) => ({ ...s, importing: true, importLog: [], importProgress: 0 }));

    const moduleId = await getContainerModuleId();
    if (!moduleId) {
      toast.error("Контейнер-модуль для видеоответов не найден");
      setState((s) => ({ ...s, importing: false }));
      return;
    }

    setState((s) => ({ ...s, importLog: [...s.importLog, `Импорт выпуска №${episode.episodeNumber}...`] }));

    const result = await importEpisode(episode, moduleId);

    if (result.success) {
      setState((s) => ({
        ...s,
        importing: false,
        importProgress: 100,
        importLog: [
          ...s.importLog,
          `✅ Выпуск №${episode.episodeNumber} импортирован`,
          `   Создано/обновлено вопросов: ${episode.questions.filter((q) => q.title).length}`,
        ],
      }));
      toast.success(`Выпуск №${episode.episodeNumber} успешно импортирован`);
    } else {
      setState((s) => ({
        ...s,
        importing: false,
        importLog: [...s.importLog, `❌ Ошибка: ${result.error}`],
      }));
      toast.error(`Ошибка импорта: ${result.error}`);
    }
  };

  // Bulk Run: import all episodes in batches
  const handleBulkRun = async () => {
    // PATCH-7: Block if any validation errors
    if (hasAnyValidationErrors) {
      toast.error("Исправьте ошибки валидации перед массовым импортом");
      return;
    }

    setState((s) => ({ ...s, importing: true, importLog: [], importProgress: 0 }));

    const moduleId = await getContainerModuleId();
    if (!moduleId) {
      toast.error("Контейнер-модуль для видеоответов не найден");
      setState((s) => ({ ...s, importing: false }));
      return;
    }

    const total = state.episodes.length;
    let processed = 0;
    let errors = 0;

    for (const episode of state.episodes) {
      setState((s) => ({
        ...s,
        importLog: [...s.importLog, `Импорт выпуска №${episode.episodeNumber}...`],
      }));

      const result = await importEpisode(episode, moduleId);

      if (result.success) {
        setState((s) => ({
          ...s,
          importLog: [...s.importLog, `  ✅ Готово (${episode.questions.filter((q) => q.title).length} вопросов)`],
        }));
      } else {
        errors++;
        setState((s) => ({
          ...s,
          importLog: [...s.importLog, `  ❌ Ошибка: ${result.error}`],
        }));
      }

      processed++;
      setState((s) => ({
        ...s,
        importProgress: Math.round((processed / total) * 100),
      }));

      // Small delay between batches
      if (processed % 5 === 0) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    setState((s) => ({
      ...s,
      importing: false,
      completed: true,
      importLog: [
        ...s.importLog,
        "",
        `=== ИТОГО ===`,
        `Обработано выпусков: ${processed}`,
        `Ошибок: ${errors}`,
        `Всего вопросов: ${state.parsedRows.filter((r) => r.title).length}`,
      ],
    }));

    if (errors === 0) {
      toast.success(`Импорт завершён: ${processed} выпусков`);
    } else {
      toast.warning(`Импорт завершён с ошибками: ${errors} из ${processed}`);
    }
  };

  const handleReset = () => {
    setState({
      file: null,
      parsing: false,
      parsed: false,
      parsedRows: [],
      episodes: [],
      validationErrors: [],
      importing: false,
      importProgress: 0,
      importLog: [],
      completed: false,
      usePredefinedSummaries: true,
      testEpisodeNumber: null,
    });
  };

  const toggleEpisode = (episodeNumber: number) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(episodeNumber)) {
        next.delete(episodeNumber);
      } else {
        next.add(episodeNumber);
      }
      return next;
    });
  };

  // Stats
  const stats = useMemo(() => {
    const totalQuestions = state.parsedRows.length;
    const totalEpisodes = state.episodes.length;
    const withErrors = state.episodes.filter((e) => e.errors.length > 0).length;
    // Count episodes that have ANY description (from file or predefined)
    const withDescriptionCount = state.episodes.filter(
      (e) => e.shortDescription || e.fullDescription || EPISODE_SUMMARIES[e.episodeNumber]
    ).length;

    return { totalQuestions, totalEpisodes, withErrors, withDescriptionCount };
  }, [state.episodes, state.parsedRows]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Импорт видеоответов</h1>
          <p className="text-muted-foreground">
            Массовый импорт выпусков и вопросов из Excel или CSV файла в Базу знаний
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Upload & Settings */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Загрузка файла
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="file">Excel/CSV файл</Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                    disabled={state.parsing || state.importing}
                  />
                </div>

                {state.file && (
                  <div className="flex items-center gap-2 text-sm">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    <span className="truncate">{state.file.name}</span>
                  </div>
                )}

                {state.parsing && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Парсинг файла...
                  </div>
                )}
              </CardContent>
            </Card>

            {state.parsed && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    Настройки импорта
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="summaries" className="flex-1">
                      Использовать справочник описаний
                      <p className="text-xs text-muted-foreground font-normal">
                        {stats.withDescriptionCount} из {stats.totalEpisodes} выпусков с описаниями
                      </p>
                    </Label>
                    <Switch
                      id="summaries"
                      checked={state.usePredefinedSummaries}
                      onCheckedChange={(v) => setState((s) => ({ ...s, usePredefinedSummaries: v }))}
                    />
                  </div>

                  <div>
                    <Label htmlFor="testEpisode">Тестовый выпуск</Label>
                    <Input
                      id="testEpisode"
                      type="number"
                      placeholder="Номер выпуска"
                      value={state.testEpisodeNumber || ""}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          testEpisodeNumber: e.target.value ? parseInt(e.target.value, 10) : null,
                        }))
                      }
                    />
                  </div>

                  {/* PATCH-7: Show critical errors for selected test episode */}
                  {state.testEpisodeNumber && testEpisodeCriticalErrors.length > 0 && (
                    <Alert variant="destructive" className="text-xs">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {testEpisodeCriticalErrors.map((e, i) => (
                          <div key={i}>• {e}</div>
                        ))}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            {state.parsed && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Play className="h-5 w-5" />
                    Действия
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* PATCH-7: Test Run disabled if critical errors */}
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleTestRun}
                    disabled={state.importing || !state.testEpisodeNumber || testEpisodeCriticalErrors.length > 0}
                  >
                    {state.importing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Test Run (1 выпуск)
                  </Button>

                  {/* PATCH-7: Bulk Run disabled if any validation errors */}
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={handleBulkRun}
                    disabled={state.importing || state.episodes.length === 0 || hasAnyValidationErrors}
                  >
                    {state.importing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Bulk Run ({stats.totalEpisodes} выпусков)
                  </Button>

                  {hasAnyValidationErrors && (
                    <p className="text-xs text-destructive text-center">
                      Bulk Run заблокирован: {state.validationErrors.length} ошибок
                    </p>
                  )}

                  <Button variant="ghost" className="w-full" onClick={handleReset}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Сбросить
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Preview & Log */}
          <div className="lg:col-span-2 space-y-4">
            {/* Stats */}
            {state.parsed && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{stats.totalEpisodes}</div>
                    <p className="text-xs text-muted-foreground">Выпусков</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{stats.totalQuestions}</div>
                    <p className="text-xs text-muted-foreground">Вопросов</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-green-600">{stats.withDescriptionCount}</div>
                    <p className="text-xs text-muted-foreground">С описаниями</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-red-600">{stats.withErrors}</div>
                    <p className="text-xs text-muted-foreground">С ошибками</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* PATCH-6: Validation Errors with grouping and CSV export */}
            {state.validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="flex items-center justify-between">
                  <span>Ошибки валидации ({state.validationErrors.length})</span>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={downloadErrorsCsv}>
                    <Download className="h-3 w-3 mr-1" />
                    CSV
                  </Button>
                </AlertTitle>
                <AlertDescription>
                  <div className="mt-2 space-y-1">
                    {(Object.keys(errorGroups) as ValidationErrorType[]).map((type) => {
                      const count = errorGroups[type].length;
                      if (count === 0) return null;
                      return (
                        <div key={type} className="text-xs flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {count}
                          </Badge>
                          <span>{ERROR_TYPE_LABELS[type]}</span>
                        </div>
                      );
                    })}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Progress */}
            {state.importing && (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Прогресс импорта</span>
                    <span>{state.importProgress}%</span>
                  </div>
                  <Progress value={state.importProgress} />
                </CardContent>
              </Card>
            )}

            {/* Import Log */}
            {state.importLog.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Лог импорта</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-48 font-mono text-xs bg-muted/50 rounded p-3">
                    {state.importLog.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Episodes Preview */}
            {state.parsed && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Video className="h-5 w-5" />
                    Предпросмотр выпусков
                  </CardTitle>
                  <CardDescription>Нажмите на выпуск для просмотра вопросов</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96">
                    <div className="space-y-2">
                      {state.episodes.map((episode) => (
                        <Collapsible
                          key={episode.episodeNumber}
                          open={expandedEpisodes.has(episode.episodeNumber)}
                          onOpenChange={() => toggleEpisode(episode.episodeNumber)}
                        >
                          <CollapsibleTrigger className="w-full">
                            <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                              {expandedEpisodes.has(episode.episodeNumber) ? (
                                <ChevronDown className="h-4 w-4 shrink-0" />
                              ) : (
                                <ChevronRight className="h-4 w-4 shrink-0" />
                              )}
                              <div className="flex-1 text-left">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">Выпуск №{episode.episodeNumber}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {episode.questions.length} вопр.
                                  </Badge>
                                  {EPISODE_SUMMARIES[episode.episodeNumber] && (
                                    <Badge variant="secondary" className="text-xs">
                                      📋
                                    </Badge>
                                  )}
                                  {episode.errors.length > 0 && (
                                    <Badge variant="destructive" className="text-xs">
                                      {episode.errors.length} ош.
                                    </Badge>
                                  )}
                                  {episode.warnings.length > 0 && (
                                    <Badge variant="outline" className="text-xs text-yellow-600">
                                      ⚠️
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate mt-1">
                                  {episode.answerDate} • {episode.description.slice(0, 80)}...
                                </p>
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="ml-7 mt-2 space-y-1 border-l-2 pl-4 pb-2">
                              {episode.questions.map((q, i) => (
                                <div key={i} className="text-sm flex items-start gap-2">
                                  <Badge variant="outline" className="shrink-0 text-xs">
                                    {/* PATCH-2: Show formatted timecode, not raw value */}
                                    {q.timecodeSeconds !== null ? formatTimecode(q.timecodeSeconds) : "—"}
                                  </Badge>
                                  <span className={q.title ? "text-muted-foreground" : "text-destructive italic"}>
                                    {q.title || "(пустой заголовок)"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Empty State */}
            {!state.parsed && !state.parsing && (
              <Card className="lg:min-h-[400px] flex items-center justify-center">
                <CardContent className="text-center py-12">
                  <HelpCircle className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">Загрузите Excel файл</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Выберите файл "Эфиры Клуба БУКВА ЗАКОНА.xlsx" для предпросмотра и импорта
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
