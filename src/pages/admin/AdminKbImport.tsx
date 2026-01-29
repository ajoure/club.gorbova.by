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
import { parseTimecode, formatTimecode } from "@/hooks/useKbQuestions";
import { EPISODE_SUMMARIES, getEpisodeSummary } from "@/lib/episode-summaries";
import * as XLSX from "xlsx";
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

  // PATCH-5: Strict episode number parsing
  const parseEpisodeNumber = (value: string | number): number => {
    const str = String(value ?? "").trim();
    if (!str) return 0;

    // Format "Выпуск №74" or "Выпуск 74"
    const m = str.match(/выпуск\s*№?\s*(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      return n > 0 && n <= MAX_EPISODE_NUMBER ? n : 0;
    }

    // Pure number 1-200
    if (/^\d+$/.test(str)) {
      const n = parseInt(str, 10);
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

  // PATCH-3: Parse date from DD.MM.YY, DD.MM.YYYY, ISO, or Excel serial
  const parseDate = (value: string | number | Date | null | undefined): string => {
    if (value === null || value === undefined || value === "") return "";

    // Date object (if XLSX returns Date)
    if (value instanceof Date && !isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
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
    const m = asString.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) {
      const [, d, mo, y] = m;
      const yyyy = y.length === 2 ? `20${y}` : y;
      return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    // ISO format
    if (/^\d{4}-\d{2}-\d{2}/.test(asString)) return asString.slice(0, 10);

    return "";
  };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setState((s) => ({ ...s, file, parsing: true, parsed: false, parsedRows: [], episodes: [], validationErrors: [] }));

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

      const parsed: ParsedRow[] = [];
      const allErrors: ValidationError[] = [];

      rows.forEach((row, idx) => {
        const rowIndex = idx + 2; // Excel rows start at 1, header is row 1
        const rowErrors: ValidationError[] = [];

        const answerDateRaw = row["Дата ответа"];
        const answerDate = parseDate(answerDateRaw);
        const episodeRaw = row["Номер выпуска"] ?? "";
        const episodeNumber = parseEpisodeNumber(episodeRaw);
        const questionNumber = row["Номер вопроса"] ? parseInt(String(row["Номер вопроса"]), 10) : null;
        const fullQuestion = String(row["Вопрос ученика (копируем из анкеты)"] || "").trim();
        const title = String(row["Суть вопроса (из описания в канале, если есть; задача на Горбовой, если нет)"] || "").trim();
        const tagsRaw = String(row["Теги (для поиска, ставим самостоятельно)"] || "");
        const getcourseUrl = String(row["Ссылка на видео в геткурсе"] || "").trim();
        const kinescopeUrl = String(row["Ссылка на видео в кинескопе"] || "").trim();
        const timecodeRaw = row["Тайминг (час:мин:сек начала видео с этим вопросом)"];
        const year = parseInt(String(row[""] || row["Год"] || "2024"), 10) || 2024;

        // PATCH-2: Parse timecode (supports Excel numeric time)
        const timecodeSeconds = parseTimecode(timecodeRaw);

        // Collect values for error export
        const errorValues = {
          answerDate: String(answerDateRaw ?? ""),
          episodeNumber: String(episodeRaw ?? ""),
          title: title.slice(0, 50),
          kinescopeUrl: kinescopeUrl.slice(0, 50),
          timecode: String(timecodeRaw ?? ""),
        };

        // Validation with typed errors
        if (!title) {
          rowErrors.push({
            row: rowIndex,
            type: "empty_title",
            message: `Строка ${rowIndex}: пустая "Суть вопроса"`,
            values: errorValues,
          });
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
          questionNumber: questionNumber || idx + 1,
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

      // PATCH-4: Group by episode_number (not URL)
      const episodeMap = new Map<number, GroupedEpisode>();

      parsed.forEach((row) => {
        if (!row.episodeNumber) return;

        if (!episodeMap.has(row.episodeNumber)) {
          episodeMap.set(row.episodeNumber, {
            episodeNumber: row.episodeNumber,
            answerDate: row.answerDate,
            kinescopeUrl: row.kinescopeUrl || "",
            questions: [],
            description: "",
            errors: [],
            warnings: [],
          });
        }

        const ep = episodeMap.get(row.episodeNumber)!;
        ep.questions.push(row);

        // URL normalization & collision warning
        const url = String(row.kinescopeUrl || "").trim();
        if (url) {
          if (!ep.kinescopeUrl) {
            ep.kinescopeUrl = url;
          } else if (ep.kinescopeUrl !== url) {
            ep.warnings.push(`Коллизия Kinescope URL: "${ep.kinescopeUrl}" vs "${url}"`);
          }
        }

        // Use first valid date
        if (!ep.answerDate && row.answerDate) {
          ep.answerDate = row.answerDate;
        }
      });

      // Sort episodes and compute descriptions
      const episodes = Array.from(episodeMap.values())
        .sort((a, b) => b.episodeNumber - a.episodeNumber)
        .map((ep) => ({
          ...ep,
          description: getEpisodeSummary(
            ep.episodeNumber,
            ep.questions.map((q) => q.title)
          ),
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
    const description = state.usePredefinedSummaries
      ? EPISODE_SUMMARIES[episode.episodeNumber] || episode.description
      : episode.description;

    try {
      // 1. Check if lesson exists
      const { data: existing } = await supabase
        .from("training_lessons")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      let lessonId: string;

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
            title: episode.answerDate,
            provider: "kinescope",
          },
        });

        if (blockError) console.warn("Block creation failed:", blockError);
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
    const predefinedCount = state.episodes.filter((e) => EPISODE_SUMMARIES[e.episodeNumber]).length;

    return { totalQuestions, totalEpisodes, withErrors, predefinedCount };
  }, [state.episodes, state.parsedRows]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Импорт видеоответов</h1>
          <p className="text-muted-foreground">
            Массовый импорт выпусков и вопросов из Excel файла в Базу знаний
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
                        {stats.predefinedCount} из {stats.totalEpisodes} выпусков
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
                    <div className="text-2xl font-bold text-green-600">{stats.predefinedCount}</div>
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
