import { useState, useCallback, useMemo } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseTimecode } from "@/hooks/useKbQuestions";
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
} from "lucide-react";

// Container module ID for knowledge-videos (from page_sections)
const CONTAINER_MODULE_SLUG = "container-knowledge-videos";

interface ParsedRow {
  answerDate: string;
  episodeNumber: number;
  questionNumber: number | null;
  fullQuestion: string;
  title: string;
  tags: string[];
  getcourseUrl: string;
  kinescopeUrl: string;
  timecode: string;
  timecodeSeconds: number | null;
  year: number;
  errors: string[];
}

interface GroupedEpisode {
  episodeNumber: number;
  answerDate: string;
  kinescopeUrl: string;
  questions: ParsedRow[];
  description: string;
  errors: string[];
}

interface ImportState {
  file: File | null;
  parsing: boolean;
  parsed: boolean;
  parsedRows: ParsedRow[];
  episodes: GroupedEpisode[];
  validationErrors: string[];
  importing: boolean;
  importProgress: number;
  importLog: string[];
  completed: boolean;
  usePredefinedSummaries: boolean;
  testEpisodeNumber: number | null;
}

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

  // Parse episode number from "Выпуск №74" format
  const parseEpisodeNumber = (value: string): number => {
    const match = value.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  // Parse tags from "#налог#ИП" format
  const parseTags = (value: string): string[] => {
    if (!value) return [];
    return value
      .split("#")
      .map((t) => t.trim())
      .filter(Boolean);
  };

  // Parse date from "08.01.24" or "08.01.2024" format
  const parseDate = (value: string): string => {
    if (!value) return "";
    
    // Handle DD.MM.YY or DD.MM.YYYY
    const match = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (match) {
      const [, day, month, year] = match;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return value;
  };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setState((s) => ({ ...s, file, parsing: true, parsed: false, parsedRows: [], episodes: [], validationErrors: [] }));

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

      const parsed: ParsedRow[] = [];
      const errors: string[] = [];

      rows.forEach((row, idx) => {
        const rowErrors: string[] = [];
        
        const answerDate = parseDate(String(row["Дата ответа"] || ""));
        const episodeRaw = String(row["Номер выпуска"] || "");
        const episodeNumber = parseEpisodeNumber(episodeRaw);
        const questionNumber = row["Номер вопроса"] ? parseInt(String(row["Номер вопроса"]), 10) : null;
        const fullQuestion = String(row["Вопрос ученика (копируем из анкеты)"] || "").trim();
        const title = String(row["Суть вопроса (из описания в канале, если есть; задача на Горбовой, если нет)"] || "").trim();
        const tagsRaw = String(row["Теги (для поиска, ставим самостоятельно)"] || "");
        const getcourseUrl = String(row["Ссылка на видео в геткурсе"] || "").trim();
        const kinescopeUrl = String(row["Ссылка на видео в кинескопе"] || "").trim();
        const timecodeRaw = String(row["Тайминг (час:мин:сек начала видео с этим вопросом)"] || "").trim();
        const year = parseInt(String(row[""] || row["Год"] || "2024"), 10) || 2024;

        // Validation
        if (!title) rowErrors.push(`Строка ${idx + 2}: пустая "Суть вопроса"`);
        if (!episodeNumber) rowErrors.push(`Строка ${idx + 2}: не удалось распознать номер выпуска`);
        if (!kinescopeUrl) rowErrors.push(`Строка ${idx + 2}: отсутствует ссылка Kinescope`);
        if (!answerDate) rowErrors.push(`Строка ${idx + 2}: отсутствует дата ответа`);

        const timecodeSeconds = parseTimecode(timecodeRaw);

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
        });

        errors.push(...rowErrors);
      });

      // Group by episode (using kinescope_url as unique key)
      const episodeMap = new Map<string, GroupedEpisode>();
      
      parsed.forEach((row) => {
        const key = row.kinescopeUrl || `episode-${row.episodeNumber}`;
        
        if (!episodeMap.has(key)) {
          episodeMap.set(key, {
            episodeNumber: row.episodeNumber,
            answerDate: row.answerDate,
            kinescopeUrl: row.kinescopeUrl,
            questions: [],
            description: "",
            errors: [],
          });
        }
        
        episodeMap.get(key)!.questions.push(row);
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
        validationErrors: errors,
      }));
    } catch (err) {
      console.error("Parse error:", err);
      toast.error("Ошибка парсинга файла");
      setState((s) => ({ ...s, parsing: false }));
    }
  }, []);

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
  const importEpisode = async (episode: GroupedEpisode, moduleId: string): Promise<{ success: boolean; lessonId?: string; error?: string }> => {
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
            published_at: episode.answerDate,
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
            published_at: episode.answerDate,
          })
          .select("id")
          .single();

        if (error) throw error;
        lessonId = newLesson.id;

        // Create video block
        const { error: blockError } = await supabase
          .from("lesson_blocks")
          .insert({
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
        const { error: qError } = await supabase
          .from("kb_questions")
          .upsert(
            {
              lesson_id: lessonId,
              episode_number: episode.episodeNumber,
              question_number: q.questionNumber,
              title: q.title,
              full_question: q.fullQuestion || null,
              tags: q.tags.length > 0 ? q.tags : null,
              kinescope_url: q.kinescopeUrl,
              timecode_seconds: q.timecodeSeconds,
              answer_date: q.answerDate,
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
          `   Создано/обновлено вопросов: ${episode.questions.length}`,
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
          importLog: [...s.importLog, `  ✅ Готово (${episode.questions.length} вопросов)`],
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
        `Всего вопросов: ${state.parsedRows.length}`,
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
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleTestRun}
                    disabled={state.importing || !state.testEpisodeNumber}
                  >
                    {state.importing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Test Run (1 выпуск)
                  </Button>

                  <Button
                    variant="default"
                    className="w-full"
                    onClick={handleBulkRun}
                    disabled={state.importing || state.episodes.length === 0}
                  >
                    {state.importing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Bulk Run ({stats.totalEpisodes} выпусков)
                  </Button>

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

            {/* Validation Errors */}
            {state.validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Ошибки валидации ({state.validationErrors.length})</AlertTitle>
                <AlertDescription>
                  <ScrollArea className="h-32 mt-2">
                    {state.validationErrors.slice(0, 20).map((e, i) => (
                      <div key={i} className="text-xs">
                        {e}
                      </div>
                    ))}
                    {state.validationErrors.length > 20 && (
                      <div className="text-xs text-muted-foreground mt-2">
                        И ещё {state.validationErrors.length - 20} ошибок...
                      </div>
                    )}
                  </ScrollArea>
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
                  <CardDescription>
                    Нажмите на выпуск для просмотра вопросов
                  </CardDescription>
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
                                    {q.timecode || "—"}
                                  </Badge>
                                  <span className="text-muted-foreground">{q.title}</span>
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
