import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useUnreadFeedbackByLesson } from "@/hooks/useTrainingFeedback";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useTrainingLessons, TrainingLesson } from "@/hooks/useTrainingLessons";
import { useTrainingModules } from "@/hooks/useTrainingModules";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  BookOpen,
  Video,
  FileText,
  Music,
  Files,
  Clock,
  CheckCircle2,
  ChevronRight,
  Lock,
  Timer,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { getStatusBadgeClass } from "@/utils/badgeUtils";
import { formatLockedMonth } from "@/hooks/useMonthGate";

const contentTypeConfig = {
  video: { icon: Video, label: "Видео", color: "text-blue-500" },
  audio: { icon: Music, label: "Аудио", color: "text-purple-500" },
  article: { icon: FileText, label: "Статья", color: "text-green-500" },
  document: { icon: Files, label: "Документ", color: "text-orange-500" },
  mixed: { icon: BookOpen, label: "Материал", color: "text-pink-500" },
};

// Маппинг секций меню для динамических хлебных крошек
const menuSectionMap: Record<string, { path: string; label: string }> = {
  'knowledge': { path: '/knowledge', label: 'База знаний' },
  'knowledge-videos': { path: '/knowledge', label: 'База знаний' },
  'knowledge-questions': { path: '/knowledge', label: 'База знаний' },
  'knowledge-qa': { path: '/knowledge', label: 'База знаний' },
  'knowledge-webinars': { path: '/knowledge', label: 'База знаний' },
  'products-library': { path: '/products?tab=library', label: 'Моя библиотека' },
  'products': { path: '/products', label: 'Продукты' },
  'trainings': { path: '/knowledge', label: 'Тренинги' },
  'courses': { path: '/knowledge', label: 'Курсы' },
};

const getMenuSectionPath = (key: string | null): string => 
  menuSectionMap[key || 'products-library']?.path || '/knowledge';

const getMenuSectionLabel = (key: string | null): string => 
  menuSectionMap[key || 'products-library']?.label || 'База знаний';

export default function LibraryModule() {
  const { moduleSlug } = useParams<{ moduleSlug: string }>();
  const navigate = useNavigate();

  // Fetch module info
  const { data: module, isLoading: moduleLoading } = useQuery({
    queryKey: ["training-module", moduleSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select("*")
        .eq("slug", moduleSlug)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!moduleSlug,
  });

  // Get access info from useTrainingModules (sidebar/global access list)
  const { modules: allModules, loading: modulesLoading } = useTrainingModules();
  const moduleWithAccess = allModules.find(m => m.slug === moduleSlug);
  const hasAccess = moduleWithAccess?.has_access ?? true;
  // Month-lock comes from useTrainingLessons / sidebar; for module-level we read it from
  // the first lesson lock (cabinet rule: parent month-lock manifests via lesson lock_reason).
  const { lessons, loading: lessonsLoading, markCompleted, markIncomplete } = useTrainingLessons(module?.id);
  const moduleMonthLocked = hasAccess && lessons.length > 0 && lessons.every(l => l.lock_reason === "month_mismatch");
  const moduleLockedMonth = moduleMonthLocked
    ? lessons.find(l => l.lock_reason === "month_mismatch")?.locked_month ?? null
    : null;

  // Fetch child modules if this module has no direct lessons
  const { data: childModules, isLoading: childModulesLoading } = useQuery({
    queryKey: ["child-modules-with-lessons", module?.id],
    queryFn: async () => {
      // Get direct children
      const { data: children, error: childErr } = await supabase
        .from("training_modules")
        .select("id, title, slug, description, sort_order, is_active, is_container, color_gradient, icon")
        .eq("parent_module_id", module!.id)
        .eq("is_active", true)
        .order("sort_order");
      if (childErr) throw childErr;
      if (!children || children.length === 0) return [];

      // Filter children through allModules access list (access leak fix)
      const accessibleChildren = children.filter(child => {
        const moduleInfo = allModules.find(m => m.id === child.id);
        // If module not found in allModules (access-controlled list), hide it
        if (!moduleInfo) return false;
        return moduleInfo.has_access !== false;
      });

      if (accessibleChildren.length === 0) return [];

      // For each accessible child, get lesson count
      const childIds = accessibleChildren.map(c => c.id);
      const { data: lessonCounts, error: lcErr } = await supabase
        .from("training_lessons")
        .select("module_id")
        .in("module_id", childIds)
        .eq("is_active", true);
      if (lcErr) throw lcErr;

      const countMap: Record<string, number> = {};
      (lessonCounts || []).forEach(l => {
        countMap[l.module_id] = (countMap[l.module_id] || 0) + 1;
      });

      return accessibleChildren.map(c => ({
        ...c,
        lessonCount: countMap[c.id] || 0,
      }));
    },
    enabled: !!module?.id && lessons.length === 0 && !lessonsLoading && !modulesLoading,
  });

  const handleLessonClick = (lesson: TrainingLesson) => {
    if (lesson.lock_reason === "month_mismatch") return;
    navigate(`/library/${moduleSlug}/${lesson.slug}`);
  };

  const handleToggleComplete = async (lesson: TrainingLesson, e: React.MouseEvent) => {
    e.stopPropagation();
    if (lesson.is_completed) {
      await markIncomplete(lesson.id);
    } else {
      await markCompleted(lesson.id);
    }
  };

  const completedCount = lessons.filter(l => l.is_completed).length;
  const progress = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;

  // Batch fetch unread feedback per lesson (shared hook, no N+1)
  const lessonIds = lessons.map(l => l.id);
  const { data: unreadByLesson } = useUnreadFeedbackByLesson(lessonIds);

  if (moduleLoading) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-6 max-w-4xl">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-32 w-full mb-6" />
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!module) {
    return (
      <DashboardLayout>
        <div className="container mx-auto px-4 py-6 max-w-4xl text-center">
          <h1 className="text-2xl font-bold mb-4">Модуль не найден</h1>
          <Button onClick={() => navigate("/knowledge")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Вернуться в библиотеку
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Breadcrumb - динамический на основе menu_section_key */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link 
            to={getMenuSectionPath(module.menu_section_key)} 
            className="hover:text-foreground transition-colors"
          >
            {getMenuSectionLabel(module.menu_section_key)}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">{module.title}</span>
        </div>

        {/* Module Header */}
        <Card className={`mb-8 overflow-hidden bg-gradient-to-br ${module.color_gradient || "from-pink-500 to-fuchsia-600"}`}>
          <CardHeader className="text-white">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-2xl mb-2">{module.title}</CardTitle>
                {module.description && (
                  <CardDescription className="text-white/80">
                    {module.description}
                  </CardDescription>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate("/knowledge")}
                className="shrink-0"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Назад
              </Button>
            </div>
          </CardHeader>
          <CardContent className="text-white">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                <span>
                  {lessons.length > 0 
                    ? `${lessons.length} уроков` 
                    : childModules && childModules.length > 0 
                      ? `${childModules.length} разделов · ${childModules.reduce((s, c) => s + c.lessonCount, 0)} уроков`
                      : '0 уроков'}
                </span>
              </div>
              {lessons.length > 0 && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Пройдено: {completedCount} из {lessons.length} ({progress}%)</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Access Restricted Banner */}
        {!hasAccess && !modulesLoading && (
          <Card className="mb-6 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
            <CardContent className="py-8 text-center">
              <Lock className="h-12 w-12 mx-auto mb-4 text-amber-600 dark:text-amber-500" />
              {moduleSlug === "buhgalteriya-kak-biznes" ? (
                <>
                  <h3 className="text-lg font-semibold mb-2 text-amber-900 dark:text-amber-100">
                    Доступен участникам Gorbova Club
                  </h3>
                  <p className="text-amber-700 dark:text-amber-300 mb-4 max-w-md mx-auto">
                    Тренинг «Бухгалтерия как бизнес» приобретается отдельно и доступен только участникам клуба на любом тарифе
                  </p>
                  <Button 
                    onClick={() => window.location.href = 'https://business-training.gorbova.by'}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Подробнее о тренинге
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold mb-2 text-amber-900 dark:text-amber-100">
                    Контент доступен участникам тарифов FULL и BUSINESS
                  </h3>
                  <p className="text-amber-700 dark:text-amber-300 mb-4 max-w-md mx-auto">
                    Оформите подписку на Gorbova Club, чтобы получить доступ к этим материалам
                  </p>
                  <Button 
                    onClick={() => window.location.href = 'https://club.gorbova.by'}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Узнать о Клубе
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Month-locked banner (has_access=true но контент за неоплаченный месяц) */}
        {moduleMonthLocked && (
          <Card className="mb-6 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 dark:border-amber-800">
            <CardContent className="py-8 text-center">
              <Lock className="h-12 w-12 mx-auto mb-4 text-amber-600 dark:text-amber-400" />
              <h3 className="text-lg font-semibold mb-2 text-amber-900 dark:text-amber-100">
                Контент доступен покупателям тарифа BUSINESS
              </h3>
              <p className="text-amber-800/90 dark:text-amber-200/90 mb-4 max-w-xl mx-auto">
                Вы можете ознакомиться с темой и описанием, но просмотр материалов
                открыт только покупателям клуба BUSINESS. Оформите доступ, чтобы
                открыть видео и материалы.
              </p>
              <Button
                onClick={() => window.location.href = "https://club.gorbova.by"}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                Получить доступ
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Lessons List */}
        {lessonsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !hasAccess ? (
          null // Don't show lessons if no access
        ) : lessons.length === 0 && childModules && childModules.length > 0 ? (
          /* Show child modules hierarchy when root has no direct lessons */
          <div className="space-y-3">
            {childModules.map((child, idx) => (
              <Card
                key={child.id}
                className="cursor-pointer hover:shadow-md transition-all group"
                onClick={() => navigate(`/library/${child.slug}`)}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-muted">
                    {idx + 1}
                  </div>
                  <div className="shrink-0 text-primary">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium group-hover:text-primary transition-colors">
                      {child.title}
                    </h3>
                    {child.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {child.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {child.lessonCount} {child.lessonCount === 1 ? 'урок' : child.lessonCount < 5 ? 'урока' : 'уроков'}
                  </Badge>
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : lessons.length === 0 && (childModulesLoading) ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : lessons.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">Уроки пока не добавлены</h3>
              <p className="text-muted-foreground">
                Материалы скоро появятся
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {lessons.map((lesson, index) => {
              const config = contentTypeConfig[lesson.content_type];
              const Icon = config.icon;
              const isScheduled = lesson.isScheduled;
              const isMonthLocked = lesson.lock_reason === "month_mismatch";

              return (
                <Card
                  key={lesson.id}
                  className={`transition-all group ${
                    lesson.is_completed ? "bg-muted/30" : ""
                  } ${isScheduled || isMonthLocked
                    ? "opacity-80 cursor-not-allowed"
                    : "cursor-pointer hover:shadow-md"
                  }`}
                  onClick={() => !isScheduled && !isMonthLocked && handleLessonClick(lesson)}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* Lesson number or lock icon */}
                    <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      isScheduled || isMonthLocked
                        ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30"
                        : "bg-muted"
                    }`}>
                      {(isScheduled || isMonthLocked) ? (
                        <Lock className="h-4 w-4" />
                      ) : (
                        index + 1
                      )}
                    </div>

                    {/* Content type icon */}
                    <div className={`shrink-0 ${config.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>

                    {/* Lesson info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={`font-medium transition-colors ${
                          lesson.is_completed ? "text-muted-foreground line-through" : ""
                        } ${!isScheduled && !isMonthLocked ? "group-hover:text-primary" : ""}`}>
                          {lesson.title}
                        </h3>
                        {(unreadByLesson?.get(lesson.id) ?? 0) > 0 && (
                          <Badge variant="default" className="shrink-0 text-[10px] px-1.5 py-0">
                            💬 {unreadByLesson!.get(lesson.id)}
                          </Badge>
                        )}
                      </div>
                      {isMonthLocked ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Доступно покупателям тарифа BUSINESS
                        </p>
                      ) : isScheduled && lesson.published_at ? (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <Timer className="h-3 w-3" />
                          Откроется {format(new Date(lesson.published_at), "d MMMM 'в' HH:mm", { locale: ru })}
                        </p>
                      ) : lesson.description ? (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {lesson.description}
                        </p>
                      ) : null}
                    </div>

                    {/* Right-side badge / controls */}
                    {isMonthLocked ? (
                      <Badge
                        variant="outline"
                        className={`shrink-0 ${getStatusBadgeClass("warning")}`}
                      >
                        <Lock className="h-3 w-3 mr-1" />
                        Доступно за отдельную плату
                      </Badge>
                    ) : isScheduled ? (
                      <Badge variant="outline" className="shrink-0 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-500 dark:border-amber-700">
                        <Clock className="h-3 w-3 mr-1" />
                        Скоро
                      </Badge>
                    ) : (
                      <>
                        {/* Duration */}
                        {lesson.duration_minutes && (
                          <div className="shrink-0 flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span>{lesson.duration_minutes} мин</span>
                          </div>
                        )}

                        {/* Content type badge */}
                        <Badge variant="secondary" className="shrink-0">
                          {config.label}
                        </Badge>

                        {/* Completion checkbox */}
                        <div
                          className="shrink-0"
                          onClick={(e) => handleToggleComplete(lesson, e)}
                        >
                          <Checkbox
                            checked={lesson.is_completed}
                            className="h-6 w-6 rounded-full"
                          />
                        </div>

                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
