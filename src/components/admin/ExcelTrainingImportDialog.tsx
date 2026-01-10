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
  FileText
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
              content: block.content as unknown as Record<string, unknown>,
              sort_order: block.sort_order,
              settings: {},
            })));

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
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Импорт тренингов из Excel
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && "Загрузите файл Excel с уроками"}
            {step === 'preview' && `Найдено ${lessons.length} уроков. Выберите для импорта.`}
            {step === 'importing' && "Импорт в процессе..."}
            {step === 'complete' && "Импорт завершён!"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {step === 'upload' && (
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-2">Перетащите файл Excel сюда</p>
              <p className="text-sm text-muted-foreground mb-4">или</p>
              <Button asChild variant="outline">
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
              <p className="text-xs text-muted-foreground mt-4">
                Поддерживаемые форматы: .xlsx, .xls
              </p>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Название модуля</Label>
                <Input
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  placeholder="Введите название модуля..."
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Выбрано: {selectedCount} из {lessons.length}
                </span>
                <div className="space-x-2">
                  <Button variant="outline" size="sm" onClick={() => toggleAll(true)}>
                    Выбрать все
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => toggleAll(false)}>
                    Снять все
                  </Button>
                </div>
              </div>

              <ScrollArea className="h-[400px] border rounded-lg">
                <div className="p-2 space-y-1">
                  {lessons.map((lesson, index) => (
                    <div
                      key={lesson.id}
                      className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                        lesson.selected ? 'bg-primary/5' : 'bg-muted/30'
                      }`}
                    >
                      <Checkbox
                        checked={lesson.selected}
                        onCheckedChange={() => toggleLesson(lesson.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{lesson.title}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {lesson.videos.length > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              <Video className="h-3 w-3 mr-1" />
                              {lesson.videos.length} видео
                            </Badge>
                          )}
                          {lesson.buttons.length > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              <Link className="h-3 w-3 mr-1" />
                              {lesson.buttons.length} ссылок
                            </Badge>
                          )}
                          {lesson.textContent && (
                            <Badge variant="secondary" className="text-xs">
                              <FileText className="h-3 w-3 mr-1" />
                              Текст
                            </Badge>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">#{index + 1}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {(step === 'importing' || step === 'complete') && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Прогресс</span>
                  <span>{Math.round(importProgress)}%</span>
                </div>
                <Progress value={importProgress} />
              </div>

              <ScrollArea className="h-[350px] border rounded-lg p-3">
                <div className="space-y-1">
                  {importLog.map((entry, index) => (
                    <div key={index} className="flex items-start gap-2 text-sm">
                      {entry.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />}
                      {entry.type === 'error' && <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />}
                      {entry.type === 'info' && <Loader2 className="h-4 w-4 text-blue-500 mt-0.5 shrink-0 animate-spin" />}
                      <span className={entry.type === 'error' ? 'text-red-600' : ''}>
                        {entry.message}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>Отмена</Button>
          )}
          
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>Назад</Button>
              <Button onClick={startImport} disabled={selectedCount === 0 || !moduleName.trim()}>
                Импортировать {selectedCount} уроков
              </Button>
            </>
          )}
          
          {step === 'importing' && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Импорт...
            </Button>
          )}
          
          {step === 'complete' && (
            <Button onClick={() => { handleClose(); onImportComplete?.(); }}>
              Готово
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
