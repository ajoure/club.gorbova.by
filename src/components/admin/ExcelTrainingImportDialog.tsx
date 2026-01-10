import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  FileSpreadsheet, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Loader2,
  Video,
  Link,
  FileText,
  Sparkles,
  ArrowLeft,
  X
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { LessonBlockFormData, BlockType } from "@/hooks/useLessonBlocks";

interface ExcelTrainingImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete?: () => void;
}

interface ParsedLesson {
  id: string;
  title: string;
  sourceUrl?: string;
  videos: { url: string; title?: string }[];
  buttons: { label: string; url: string }[];
  accessInfo?: string;
  pageUrl?: string;
  textContent?: string;
  selected: boolean;
}

interface ImportLogEntry {
  type: 'info' | 'success' | 'error';
  message: string;
}

// Parse Markdown link format: [Title](URL)
function parseMarkdownLink(text: string): { title: string; url: string | null } {
  if (!text) return { title: "", url: null };
  const match = text.match(/\[([^\]]+)\]\(([^)]+)\)/);
  return match ? { title: match[1], url: match[2] } : { title: text, url: null };
}

// Parse buttons from text with <br/> separators
function parseButtons(text: string): { label: string; url: string }[] {
  if (!text) return [];
  
  const buttons: { label: string; url: string }[] = [];
  const parts = text.split(/<br\s*\/?>/gi);
  let currentLabel = "";
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Check for Markdown link
    const linkMatch = trimmed.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      buttons.push({ label: linkMatch[1], url: linkMatch[2] });
      currentLabel = "";
    } else if (trimmed.startsWith("http")) {
      buttons.push({ label: currentLabel || "Ссылка", url: trimmed });
      currentLabel = "";
    } else {
      currentLabel = trimmed;
    }
  }
  
  return buttons;
}

// Detect video provider
function detectVideoProvider(url: string): 'youtube' | 'vimeo' | 'kinescope' | 'other' {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('vimeo.com')) return 'vimeo';
  if (url.includes('kinescope.io')) return 'kinescope';
  return 'other';
}

// Generate slug from title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\sа-яё-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

export function ExcelTrainingImportDialog({ 
  open, 
  onOpenChange, 
  onImportComplete 
}: ExcelTrainingImportDialogProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'complete'>('upload');
  const [moduleName, setModuleName] = useState("");
  const [lessons, setLessons] = useState<ParsedLesson[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importLog, setImportLog] = useState<ImportLogEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const resetDialog = () => {
    setStep('upload');
    setModuleName("");
    setLessons([]);
    setImportProgress(0);
    setImportLog([]);
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  const addLog = (type: ImportLogEntry['type'], message: string) => {
    setImportLog(prev => [...prev, { type, message }]);
  };

  const handleFileUpload = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
      
      if (jsonData.length < 2) {
        toast.error("Файл пустой или содержит только заголовки");
        return;
      }

      // Get headers from first row
      const headers = jsonData[0].map(h => String(h || '').toLowerCase().trim());
      
      // Find column indices
      const findColumn = (keywords: string[]) => {
        return headers.findIndex(h => keywords.some(k => h.includes(k)));
      };

      const lessonCol = findColumn(['урок', 'lesson', 'название']);
      const video1Col = findColumn(['видео 1', 'video 1', 'видео']);
      const video2Col = headers.findIndex((h, i) => i > video1Col && h.includes('видео'));
      const buttons1Col = findColumn(['кнопки', 'buttons', 'материалы']);
      const buttons2Col = headers.findIndex((h, i) => i > buttons1Col && h.includes('кнопки'));
      const accessCol = findColumn(['доступ', 'access', 'тариф']);
      const siteCol = findColumn(['сайт', 'site', 'url', 'страница']);
      const textCol = findColumn(['текст', 'text', 'описание', 'контент']);

      // Set module name from file name
      const fileName = file.name.replace(/\.[^/.]+$/, "");
      setModuleName(fileName);

      // Parse lessons
      const parsedLessons: ParsedLesson[] = [];
      
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || !row[lessonCol]) continue;

        const { title, url: sourceUrl } = parseMarkdownLink(String(row[lessonCol] || ''));
        if (!title.trim()) continue;

        const videos: { url: string; title?: string }[] = [];
        if (video1Col >= 0 && row[video1Col]) {
          videos.push({ url: String(row[video1Col]), title: "Видео 1" });
        }
        if (video2Col >= 0 && row[video2Col]) {
          videos.push({ url: String(row[video2Col]), title: "Видео 2" });
        }

        let buttons: { label: string; url: string }[] = [];
        if (buttons1Col >= 0 && row[buttons1Col]) {
          buttons = [...buttons, ...parseButtons(String(row[buttons1Col]))];
        }
        if (buttons2Col >= 0 && row[buttons2Col]) {
          buttons = [...buttons, ...parseButtons(String(row[buttons2Col]))];
        }

        parsedLessons.push({
          id: `lesson-${i}`,
          title: title.trim(),
          sourceUrl: sourceUrl || undefined,
          videos,
          buttons,
          accessInfo: accessCol >= 0 ? String(row[accessCol] || '') : undefined,
          pageUrl: siteCol >= 0 ? String(row[siteCol] || '') : undefined,
          textContent: textCol >= 0 ? String(row[textCol] || '') : undefined,
          selected: true,
        });
      }

      if (parsedLessons.length === 0) {
        toast.error("Не удалось найти уроки в файле");
        return;
      }

      setLessons(parsedLessons);
      setStep('preview');
      toast.success(`Найдено ${parsedLessons.length} уроков`);
    } catch (error) {
      console.error("Error parsing Excel:", error);
      toast.error("Ошибка чтения файла Excel");
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls'))) {
      handleFileUpload(file);
    } else {
      toast.error("Пожалуйста, загрузите файл Excel (.xlsx или .xls)");
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const toggleLesson = (id: string) => {
    setLessons(prev => prev.map(l => 
      l.id === id ? { ...l, selected: !l.selected } : l
    ));
  };

  const toggleAll = (selected: boolean) => {
    setLessons(prev => prev.map(l => ({ ...l, selected })));
  };

  const startImport = async () => {
    const selectedLessons = lessons.filter(l => l.selected);
    if (selectedLessons.length === 0) {
      toast.error("Выберите хотя бы один урок");
      return;
    }

    if (!moduleName.trim()) {
      toast.error("Введите название модуля");
      return;
    }

    setStep('importing');
    setImportProgress(0);
    setImportLog([]);

    try {
      // Create module
      addLog('info', `Создание модуля: ${moduleName}`);
      const moduleSlug = generateSlug(moduleName);
      
      const { data: newModule, error: moduleError } = await supabase
        .from("training_modules")
        .insert({
          title: moduleName,
          slug: moduleSlug,
          description: `Импортировано из Excel: ${selectedLessons.length} уроков`,
          is_active: true,
          sort_order: 0,
        })
        .select()
        .single();

      if (moduleError) throw moduleError;
      addLog('success', `Модуль создан: ${moduleName}`);
      setImportProgress(10);

      // Create lessons
      const totalLessons = selectedLessons.length;
      
      for (let i = 0; i < selectedLessons.length; i++) {
        const lesson = selectedLessons[i];
        addLog('info', `Импорт урока ${i + 1}/${totalLessons}: ${lesson.title}`);

        // Determine content type
        let contentType = 'article';
        if (lesson.videos.length > 0) contentType = 'video';

        // Create lesson
        const { data: newLesson, error: lessonError } = await supabase
          .from("training_lessons")
          .insert({
            module_id: newModule.id,
            title: lesson.title,
            slug: generateSlug(lesson.title) + `-${i + 1}`,
            description: lesson.accessInfo || null,
            content_type: contentType,
            video_url: lesson.videos[0]?.url || null,
            audio_url: null,
            content: lesson.textContent || null,
            sort_order: i,
            is_active: true,
          })
          .select()
          .single();

        if (lessonError) {
          addLog('error', `Ошибка создания урока: ${lesson.title}`);
          continue;
        }

        // Create blocks for the lesson
        const blocksToInsert: LessonBlockFormData[] = [];

        // Add videos as blocks
        lesson.videos.forEach((video, vIndex) => {
          blocksToInsert.push({
            block_type: 'video',
            content: {
              url: video.url,
              provider: detectVideoProvider(video.url),
              title: video.title,
            },
            sort_order: vIndex,
          });
        });

        // Add buttons as a single block
        if (lesson.buttons.length > 0) {
          blocksToInsert.push({
            block_type: 'button',
            content: {
              buttons: lesson.buttons,
            },
            sort_order: lesson.videos.length,
          });
        }

        // Add text content if present
        if (lesson.textContent) {
          blocksToInsert.push({
            block_type: 'text',
            content: {
              html: lesson.textContent,
            },
            sort_order: lesson.videos.length + (lesson.buttons.length > 0 ? 1 : 0),
          });
        }

        // Insert blocks
        if (blocksToInsert.length > 0) {
          const { error: blocksError } = await supabase
            .from("lesson_blocks")
            .insert(blocksToInsert.map(block => ({
              lesson_id: newLesson.id,
              block_type: block.block_type,
              content: block.content,
              sort_order: block.sort_order,
              settings: {},
            })) as any);

          if (blocksError) {
            addLog('error', `Ошибка создания блоков для: ${lesson.title}`);
          }
        }

        addLog('success', `Урок создан: ${lesson.title}`);
        setImportProgress(10 + ((i + 1) / totalLessons) * 90);
      }

      setImportProgress(100);
      setStep('complete');
      addLog('success', `Импорт завершён! Создано ${selectedLessons.length} уроков.`);
      toast.success("Импорт завершён!");
      
    } catch (error) {
      console.error("Import error:", error);
      addLog('error', `Ошибка импорта: ${(error as Error).message}`);
      toast.error("Ошибка при импорте");
    }
  };

  const selectedCount = lessons.filter(l => l.selected).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 bg-background/80 backdrop-blur-xl border-border/50 shadow-2xl overflow-hidden">
        {/* iOS-style header */}
        <div className="relative px-6 py-5 border-b border-border/30 bg-gradient-to-b from-background/90 to-background/70">
          {step === 'preview' && (
            <button
              onClick={resetDialog}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-muted/50 transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-primary" />
            </button>
          )}
          
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 mb-3 ring-1 ring-primary/20">
              <FileSpreadsheet className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {step === 'complete' ? 'Импорт завершён' : 'Импорт из Excel'}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              {step === 'upload' && "Перетащите файл или выберите вручную"}
              {step === 'preview' && `${lessons.length} уроков найдено`}
              {step === 'importing' && "Пожалуйста, подождите..."}
              {step === 'complete' && "Все данные успешно импортированы"}
            </DialogDescription>
          </div>

          <button
            onClick={handleClose}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-muted/50 transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {step === 'upload' && (
            <div className="p-6">
              <div
                className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 ${
                  isDragging 
                    ? 'border-primary bg-primary/5 scale-[0.99]' 
                    : 'border-border/50 hover:border-primary/50 hover:bg-muted/30'
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <div className="py-16 px-8 text-center">
                  <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-6 transition-all duration-300 ${
                    isDragging 
                      ? 'bg-primary/20 scale-110' 
                      : 'bg-muted/50'
                  }`}>
                    <Upload className={`h-8 w-8 transition-colors ${
                      isDragging ? 'text-primary' : 'text-muted-foreground'
                    }`} />
                  </div>
                  
                  <h3 className="text-lg font-medium mb-2">
                    Перетащите файл сюда
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    или нажмите для выбора
                  </p>
                  
                  <Button 
                    asChild 
                    variant="outline" 
                    className="rounded-full px-6 bg-background/50 backdrop-blur-sm border-border/50 hover:bg-muted/50"
                  >
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      Выбрать файл
                    </label>
                  </Button>
                  
                  <p className="text-xs text-muted-foreground/70 mt-6">
                    Поддерживаются форматы .xlsx и .xls
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="flex flex-col h-full">
              {/* Module name input */}
              <div className="px-6 py-4 border-b border-border/30 bg-muted/20">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
                  Название модуля
                </Label>
                <Input
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  placeholder="Введите название..."
                  className="bg-background/50 border-border/50 rounded-xl h-11 focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Selection controls */}
              <div className="flex items-center justify-between px-6 py-3 bg-muted/10">
                <span className="text-sm font-medium">
                  <span className="text-primary">{selectedCount}</span>
                  <span className="text-muted-foreground"> из {lessons.length} выбрано</span>
                </span>
                <div className="flex gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => toggleAll(true)}
                    className="text-xs h-8 px-3 rounded-full"
                  >
                    Все
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => toggleAll(false)}
                    className="text-xs h-8 px-3 rounded-full"
                  >
                    Снять
                  </Button>
                </div>
              </div>

              {/* Lessons list */}
              <ScrollArea className="flex-1">
                <div className="px-4 py-2 space-y-1">
                  {lessons.map((lesson, index) => (
                    <div
                      key={lesson.id}
                      onClick={() => toggleLesson(lesson.id)}
                      className={`group flex items-start gap-3 p-4 rounded-2xl cursor-pointer transition-all duration-200 ${
                        lesson.selected 
                          ? 'bg-primary/10 ring-1 ring-primary/20' 
                          : 'bg-muted/30 hover:bg-muted/50'
                      }`}
                    >
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                        lesson.selected 
                          ? 'bg-primary text-primary-foreground' 
                          : 'bg-muted/50 text-muted-foreground'
                      }`}>
                        {lesson.selected ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <span className="text-xs font-medium">{index + 1}</span>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium truncate transition-colors ${
                          lesson.selected ? 'text-foreground' : 'text-muted-foreground'
                        }`}>
                          {lesson.title}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {lesson.videos.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                              <Video className="h-3 w-3" />
                              {lesson.videos.length}
                            </span>
                          )}
                          {lesson.buttons.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                              <Link className="h-3 w-3" />
                              {lesson.buttons.length}
                            </span>
                          )}
                          {lesson.textContent && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-full">
                              <FileText className="h-3 w-3" />
                              Текст
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-border/30 bg-gradient-to-t from-background to-background/80">
                <Button 
                  onClick={startImport} 
                  disabled={selectedCount === 0 || !moduleName.trim()}
                  className="w-full h-12 rounded-2xl font-medium bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Импортировать {selectedCount} уроков
                </Button>
              </div>
            </div>
          )}

          {(step === 'importing' || step === 'complete') && (
            <div className="p-6 space-y-6">
              {/* Progress circle - iOS style */}
              <div className="flex flex-col items-center py-6">
                <div className="relative w-32 h-32">
                  {/* Background circle */}
                  <svg className="w-full h-full -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      className="text-muted/30"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 56}`}
                      strokeDashoffset={`${2 * Math.PI * 56 * (1 - importProgress / 100)}`}
                      className="text-primary transition-all duration-500 ease-out"
                    />
                  </svg>
                  
                  {/* Center content */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    {step === 'complete' ? (
                      <CheckCircle2 className="h-12 w-12 text-primary animate-in zoom-in-50 duration-300" />
                    ) : (
                      <span className="text-3xl font-semibold tabular-nums">
                        {Math.round(importProgress)}%
                      </span>
                    )}
                  </div>
                </div>
                
                <p className="text-sm text-muted-foreground mt-4">
                  {step === 'complete' 
                    ? 'Все данные успешно импортированы' 
                    : 'Импортируем уроки...'
                  }
                </p>
              </div>

              {/* Import log */}
              <div className="rounded-2xl bg-muted/20 border border-border/30 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/30 bg-muted/10">
                  <h4 className="text-sm font-medium">Журнал импорта</h4>
                </div>
                <ScrollArea className="h-[200px]">
                  <div className="p-3 space-y-1">
                    {importLog.map((entry, index) => (
                      <div
                        key={index}
                        className={`flex items-start gap-2 text-sm py-2 px-3 rounded-xl ${
                          entry.type === 'error' 
                            ? 'bg-destructive/10 text-destructive' 
                            : entry.type === 'success'
                            ? 'bg-primary/5 text-foreground'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {entry.type === 'success' && (
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" />
                        )}
                        {entry.type === 'error' && (
                          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        )}
                        {entry.type === 'info' && (
                          <Loader2 className="h-4 w-4 flex-shrink-0 mt-0.5 animate-spin text-muted-foreground" />
                        )}
                        <span className="flex-1">{entry.message}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Complete button */}
              {step === 'complete' && (
                <Button 
                  onClick={() => {
                    onImportComplete?.();
                    handleClose();
                  }}
                  className="w-full h-12 rounded-2xl font-medium"
                >
                  Готово
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
