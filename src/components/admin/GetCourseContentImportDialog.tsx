import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTrainingModules } from "@/hooks/useTrainingModules";
import { useTrainingLessons } from "@/hooks/useTrainingLessons";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Download,
  Loader2,
  Search,
  CheckCircle2,
  XCircle,
  BookOpen,
  Video,
  FileText,
  AlertCircle,
} from "lucide-react";

interface ParsedLesson {
  title: string;
  description?: string;
  content?: string;
  video_url?: string;
  content_type: "video" | "audio" | "article" | "document" | "mixed";
  duration_minutes?: number;
  attachments?: { file_name: string; file_url: string }[];
  selected?: boolean;
}

interface ParsedModule {
  title: string;
  description?: string;
  external_id: string;
  lessons: ParsedLesson[];
  selected?: boolean;
}

interface ParsedTraining {
  title: string;
  description?: string;
  external_id: string;
  modules: ParsedModule[];
}

interface TrainingListItem {
  id: string;
  title: string;
  url: string;
}

interface GetCourseContentImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

export function GetCourseContentImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: GetCourseContentImportDialogProps) {
  const { createModule } = useTrainingModules();
  
  const [step, setStep] = useState<"select" | "two_factor" | "preview" | "importing" | "complete">("select");
  const [trainingUrl, setTrainingUrl] = useState("");
  const [getCourseEmail, setGetCourseEmail] = useState("");
  const [getCoursePassword, setGetCoursePassword] = useState("");
  const [trainings, setTrainings] = useState<TrainingListItem[]>([]);
  const [loadingTrainings, setLoadingTrainings] = useState(false);
  const [parsedTraining, setParsedTraining] = useState<ParsedTraining | null>(null);
  const [parsingTraining, setParsingTraining] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorSessionId, setTwoFactorSessionId] = useState<string | null>(null);
  const [twoFactorNotice, setTwoFactorNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ action: string; url?: string } | null>(null);

  const credsProvided = getCourseEmail.trim().length > 0 || getCoursePassword.length > 0;
  const credsValid = !credsProvided || (getCourseEmail.trim().length > 0 && getCoursePassword.length > 0);

  const resetDialog = () => {
    setStep("select");
    setTrainingUrl("");
    setGetCourseEmail("");
    setGetCoursePassword("");
    setTrainings([]);
    setParsedTraining(null);
    setImportProgress(0);
    setImportLog([]);
    setError(null);
    setTwoFactorCode("");
    setTwoFactorSessionId(null);
    setTwoFactorNotice(null);
    setPendingAction(null);
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  const loadTrainingsList = async (sessionId?: string, code?: string) => {
    setLoadingTrainings(true);
    setError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke("getcourse-content-scraper", {
        body: { 
          action: "list_trainings",
          session_id: sessionId,
          two_factor_code: code,
          getcourse_email: getCourseEmail.trim() || undefined,
          getcourse_password: getCoursePassword || undefined,
        },
      });

      if (error) throw error;
      
      // Handle 2FA requirement
      if (data.needs_two_factor) {
        setTwoFactorSessionId(data.session_id);
        setTwoFactorNotice(data.message || "Введите код подтверждения из письма и попробуйте снова.");
        setTwoFactorCode("");
        setPendingAction({ action: "list_trainings" });
        setStep("two_factor");
        return;
      }
      
      if (!data.success) throw new Error(data.error);

      setTrainings(data.trainings || []);
      setStep("select");
      setTwoFactorSessionId(null);
      setTwoFactorNotice(null);
      setPendingAction(null);
      
      if (data.trainings?.length === 0) {
        toast.info("Тренинги не найдены. Проверьте доступ к аккаунту.");
      }
    } catch (err) {
      console.error("Error loading trainings:", err);
      setError(err instanceof Error ? err.message : "Ошибка загрузки тренингов");
      toast.error("Ошибка загрузки списка тренингов");
    } finally {
      setLoadingTrainings(false);
    }
  };

  const parseTraining = async (url: string, sessionId?: string, code?: string) => {
    setParsingTraining(true);
    setError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke("getcourse-content-scraper", {
        body: { 
          action: "parse_training", 
          training_url: url,
          session_id: sessionId,
          two_factor_code: code,
          getcourse_email: getCourseEmail.trim() || undefined,
          getcourse_password: getCoursePassword || undefined,
        },
      });

      if (error) throw error;
      
      // Handle 2FA requirement
      if (data.needs_two_factor) {
        setTwoFactorSessionId(data.session_id);
        setTwoFactorNotice(data.message || "Введите код подтверждения из письма и попробуйте снова.");
        setTwoFactorCode("");
        setPendingAction({ action: "parse_training", url });
        setStep("two_factor");
        return;
      }
      
      if (!data.success) throw new Error(data.error);

      // Mark all modules and lessons as selected by default
      const training = data.training as ParsedTraining;
      training.modules = training.modules.map(mod => ({
        ...mod,
        selected: true,
        lessons: mod.lessons.map(les => ({ ...les, selected: true })),
      }));

      setParsedTraining(training);
      setStep("preview");
      setTwoFactorSessionId(null);
      setTwoFactorNotice(null);
      setPendingAction(null);
    } catch (err) {
      console.error("Error parsing training:", err);
      setError(err instanceof Error ? err.message : "Ошибка парсинга тренинга");
      toast.error("Ошибка парсинга структуры курса");
    } finally {
      setParsingTraining(false);
    }
  };

  const submitTwoFactorCode = async () => {
    if (!twoFactorCode || !twoFactorSessionId || !pendingAction) return;
    
    setError(null);
    
    if (pendingAction.action === "list_trainings") {
      await loadTrainingsList(twoFactorSessionId, twoFactorCode);
    } else if (pendingAction.action === "parse_training" && pendingAction.url) {
      await parseTraining(pendingAction.url, twoFactorSessionId, twoFactorCode);
    }
    
    setTwoFactorCode("");
  };

  const toggleModule = (moduleIndex: number) => {
    if (!parsedTraining) return;
    
    setParsedTraining(prev => {
      if (!prev) return prev;
      const modules = [...prev.modules];
      modules[moduleIndex] = {
        ...modules[moduleIndex],
        selected: !modules[moduleIndex].selected,
        lessons: modules[moduleIndex].lessons.map(les => ({
          ...les,
          selected: !modules[moduleIndex].selected,
        })),
      };
      return { ...prev, modules };
    });
  };

  const toggleLesson = (moduleIndex: number, lessonIndex: number) => {
    if (!parsedTraining) return;
    
    setParsedTraining(prev => {
      if (!prev) return prev;
      const modules = [...prev.modules];
      const lessons = [...modules[moduleIndex].lessons];
      lessons[lessonIndex] = {
        ...lessons[lessonIndex],
        selected: !lessons[lessonIndex].selected,
      };
      modules[moduleIndex] = {
        ...modules[moduleIndex],
        lessons,
        selected: lessons.some(l => l.selected),
      };
      return { ...prev, modules };
    });
  };

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[а-яё]/gi, (char) => {
        const ru = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
        const en = ["a","b","v","g","d","e","yo","zh","z","i","j","k","l","m","n","o","p","r","s","t","u","f","h","c","ch","sh","sch","","y","","e","yu","ya"];
        const idx = ru.indexOf(char.toLowerCase());
        return idx >= 0 ? en[idx] : char;
      })
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 50);
  };

  const startImport = async () => {
    if (!parsedTraining) return;
    
    setStep("importing");
    setImporting(true);
    setImportProgress(0);
    setImportLog([]);

    const selectedModules = parsedTraining.modules.filter(m => m.selected);
    const totalItems = selectedModules.reduce(
      (acc, mod) => acc + 1 + mod.lessons.filter(l => l.selected).length,
      0
    );
    let completedItems = 0;

    const addLog = (message: string) => {
      setImportLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
    };

    try {
      for (const module of selectedModules) {
        addLog(`Создание модуля: ${module.title}`);
        
        // Create module in DB
        const { data: newModule, error: moduleError } = await supabase
          .from("training_modules")
          .insert({
            title: module.title,
            slug: generateSlug(module.title) + "-gc-" + module.external_id,
            description: module.description,
            is_active: true,
            color_gradient: "from-blue-500 to-cyan-500",
          })
          .select()
          .single();

        if (moduleError) {
          addLog(`❌ Ошибка создания модуля: ${moduleError.message}`);
          throw moduleError;
        }

        completedItems++;
        setImportProgress(Math.round((completedItems / totalItems) * 100));
        addLog(`✅ Модуль создан: ${module.title}`);

        // Create lessons for this module
        const selectedLessons = module.lessons.filter(l => l.selected);
        for (let i = 0; i < selectedLessons.length; i++) {
          const lesson = selectedLessons[i];
          addLog(`  Создание урока: ${lesson.title}`);

          const { data: newLesson, error: lessonError } = await supabase
            .from("training_lessons")
            .insert({
              module_id: newModule.id,
              title: lesson.title,
              slug: generateSlug(lesson.title) + "-" + (i + 1),
              description: lesson.description,
              content: lesson.content,
              video_url: lesson.video_url,
              content_type: lesson.content_type,
              duration_minutes: lesson.duration_minutes,
              sort_order: i,
              is_active: true,
            })
            .select()
            .single();

          if (lessonError) {
            addLog(`  ❌ Ошибка создания урока: ${lessonError.message}`);
            throw lessonError;
          }

          // Add attachments if any
          if (lesson.attachments && lesson.attachments.length > 0 && newLesson) {
            for (const attachment of lesson.attachments) {
              await supabase
                .from("lesson_attachments")
                .insert({
                  lesson_id: newLesson.id,
                  file_name: attachment.file_name,
                  file_url: attachment.file_url,
                  sort_order: 0,
                });
            }
            addLog(`  📎 Добавлено ${lesson.attachments.length} файлов`);
          }

          completedItems++;
          setImportProgress(Math.round((completedItems / totalItems) * 100));
          addLog(`  ✅ Урок создан: ${lesson.title}`);
        }
      }

      addLog("🎉 Импорт завершён успешно!");
      setStep("complete");
      toast.success("Импорт завершён успешно!");
      onImportComplete();
    } catch (err) {
      console.error("Import error:", err);
      addLog(`❌ Критическая ошибка: ${err instanceof Error ? err.message : "Unknown error"}`);
      toast.error("Ошибка при импорте");
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = parsedTraining?.modules.reduce(
    (acc, mod) => acc + (mod.selected ? mod.lessons.filter(l => l.selected).length : 0),
    0
  ) || 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Импорт из GetCourse
          </DialogTitle>
          <DialogDescription>
            {step === "select" && "Загрузите структуру курса из GetCourse"}
            {step === "two_factor" && "Введите код подтверждения из почты"}
            {step === "preview" && "Выберите модули и уроки для импорта"}
            {step === "importing" && "Импорт в процессе..."}
            {step === "complete" && "Импорт завершён"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {step === "select" && (
            <div className="space-y-4 py-4">
              {error && (
                <div className="bg-destructive/10 text-destructive p-3 rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label>Учетные данные GetCourse</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="getcourseEmail" className="text-sm">Логин (email)</Label>
                    <Input
                      id="getcourseEmail"
                      name="gc_import_email"
                      type="email"
                      value={getCourseEmail}
                      onChange={(e) => setGetCourseEmail(e.target.value)}
                      placeholder="email@domain.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="getcoursePassword" className="text-sm">Пароль</Label>
                    <Input
                      id="getcoursePassword"
                      name="gc_import_password"
                      type="text"
                      value={getCoursePassword}
                      onChange={(e) => setGetCoursePassword(e.target.value)}
                      placeholder="••••••••"
                      className="[&:not(:placeholder-shown)]:[-webkit-text-security:disc]"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Эти данные используются только для импорта и не сохраняются.
                </p>
                {!credsValid && (
                  <p className="text-xs text-destructive">
                    Заполните и логин, и пароль (или очистите оба поля).
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>URL тренинга GetCourse</Label>
                <div className="flex gap-2">
                  <Input
                    value={trainingUrl}
                    onChange={(e) => setTrainingUrl(e.target.value)}
                    placeholder="https://gorbova.getcourse.ru/teach/control/stream/view/id/..."
                    className="flex-1"
                  />
                  <Button
                    onClick={() => parseTraining(trainingUrl)}
                    disabled={!trainingUrl || parsingTraining || !credsValid}
                  >
                    {parsingTraining ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    или выберите из списка
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Доступные тренинги</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadTrainingsList()}
                    disabled={loadingTrainings || !credsValid}
                  >
                    {loadingTrainings ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Загрузить список
                  </Button>
                </div>

                {loadingTrainings ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : trainings.length > 0 ? (
                  <ScrollArea className="h-48 border rounded-lg">
                    <div className="p-2 space-y-1">
                      {trainings.map((training) => (
                        <button
                          key={training.id}
                          onClick={() => {
                            setTrainingUrl(training.url);
                            parseTraining(training.url);
                          }}
                          disabled={parsingTraining}
                          className="w-full text-left p-3 rounded-lg hover:bg-muted transition-colors flex items-center gap-3"
                        >
                          <BookOpen className="h-5 w-5 text-muted-foreground" />
                          <span className="font-medium">{training.title}</span>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="h-48 border rounded-lg flex items-center justify-center text-muted-foreground">
                    Нажмите "Загрузить список" для получения тренингов
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "two_factor" && (
            <div className="space-y-4 py-4">
              {error && (
                <div className="bg-destructive/10 text-destructive p-3 rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              <div className="text-center space-y-4">
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <AlertCircle className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Требуется подтверждение</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {twoFactorNotice ?? "GetCourse запросил подтверждение. Проверьте почту и введите код ниже."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Если письма нет 1–2 минуты: проверьте «Спам»/«Промоакции» и нажмите «Отправить код ещё раз».
                  </p>
                </div>
              </div>

              <div className="space-y-2 max-w-sm mx-auto">
                <Label htmlFor="twoFactorCode">Код подтверждения</Label>
                <Input
                  id="twoFactorCode"
                  name="gc_2fa_code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="Введите код из письма"
                  className="text-center text-lg tracking-widest"
                />
                <Button
                  onClick={submitTwoFactorCode}
                  disabled={!twoFactorCode || loadingTrainings || parsingTraining}
                  className="w-full"
                >
                  {(loadingTrainings || parsingTraining) ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Подтвердить
                </Button>

                <Button
                  variant="outline"
                  onClick={async () => {
                    setError(null);
                    setTwoFactorCode("");
                    setTwoFactorSessionId(null);

                    if (pendingAction?.action === "list_trainings") {
                      await loadTrainingsList();
                    } else if (pendingAction?.action === "parse_training" && pendingAction.url) {
                      await parseTraining(pendingAction.url);
                    }
                  }}
                  disabled={loadingTrainings || parsingTraining}
                  className="w-full"
                >
                  Отправить код ещё раз
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep("select");
                    setTwoFactorCode("");
                    setTwoFactorSessionId(null);
                    setTwoFactorNotice(null);
                    setPendingAction(null);
                  }}
                  className="w-full"
                >
                  Отмена
                </Button>
              </div>
            </div>
          )}

          {step === "preview" && parsedTraining && (
            <div className="py-4 h-full flex flex-col">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{parsedTraining.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {parsedTraining.modules.length} модулей, {selectedCount} уроков выбрано
                  </p>
                </div>
                <Badge variant="outline">
                  ID: {parsedTraining.external_id}
                </Badge>
              </div>

              <ScrollArea className="flex-1 border rounded-lg">
                <Accordion type="multiple" className="w-full">
                  {parsedTraining.modules.map((module, moduleIndex) => (
                    <AccordionItem key={module.external_id} value={module.external_id}>
                      <AccordionTrigger className="px-4 hover:no-underline">
                        <div className="flex items-center gap-3 flex-1">
                          <Checkbox
                            checked={module.selected}
                            onCheckedChange={() => toggleModule(moduleIndex)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <BookOpen className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{module.title}</span>
                          <Badge variant="secondary" className="ml-auto mr-2">
                            {module.lessons.filter(l => l.selected).length}/{module.lessons.length}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="pl-10 pr-4 pb-2 space-y-1">
                          {module.lessons.map((lesson, lessonIndex) => (
                            <div
                              key={lessonIndex}
                              className="flex items-center gap-3 p-2 rounded hover:bg-muted"
                            >
                              <Checkbox
                                checked={lesson.selected}
                                onCheckedChange={() => toggleLesson(moduleIndex, lessonIndex)}
                              />
                              {lesson.video_url ? (
                                <Video className="h-4 w-4 text-blue-500" />
                              ) : (
                                <FileText className="h-4 w-4 text-green-500" />
                              )}
                              <span className="text-sm">{lesson.title}</span>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </ScrollArea>
            </div>
          )}

          {(step === "importing" || step === "complete") && (
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Прогресс импорта</span>
                  <span>{importProgress}%</span>
                </div>
                <Progress value={importProgress} className="h-2" />
              </div>

              <ScrollArea className="h-64 border rounded-lg bg-muted/50">
                <div className="p-4 font-mono text-sm space-y-1">
                  {importLog.map((log, i) => (
                    <div key={i} className="text-muted-foreground">
                      {log}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {step === "complete" && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Импорт успешно завершён!</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "select" && (
            <Button variant="outline" onClick={handleClose}>
              Отмена
            </Button>
          )}
          
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("select")}>
                Назад
              </Button>
              <Button onClick={startImport} disabled={selectedCount === 0}>
                Импортировать {selectedCount} уроков
              </Button>
            </>
          )}
          
          {step === "importing" && (
            <Button variant="outline" disabled>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Импорт...
            </Button>
          )}
          
          {step === "complete" && (
            <Button onClick={handleClose}>
              Закрыть
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
