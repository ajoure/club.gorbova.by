import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { usePageSections } from "@/hooks/usePageSections";
import { useSidebarModules } from "@/hooks/useSidebarModules";
import { useContainerLessons } from "@/hooks/useContainerLessons";
import { useKbQuestions, formatTimecode } from "@/hooks/useKbQuestions";
import { ModuleCard } from "@/components/training/ModuleCard";
import { LessonCard } from "@/components/training/LessonCard";
import { 
  Search, 
  MessageCircleQuestion, 
  Video as VideoIcon,
  Scale, 
  Play, 
  Clock, 
  Filter,
  Calendar,
  BookOpen,
  Folder,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { format } from "date-fns";

// Icon mapping for dynamic icons
const ICONS: Record<string, LucideIcon> = {
  MessageCircleQuestion,
  HelpCircle: MessageCircleQuestion,
  Video: VideoIcon,
  Scale,
  BookOpen,
  Folder,
};

const getIcon = (iconName: string): LucideIcon => {
  return ICONS[iconName] || Folder;
};

// Questions tab content component - now uses real data from kb_questions
function QuestionsContent({ searchQuery }: { searchQuery: string }) {
  const { data: questions, isLoading } = useKbQuestions({ searchQuery, limit: 200 });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Navigate to video lesson with timecode - STRICTLY internal navigation
  const handleWatchVideo = (question: typeof questions[0]) => {
    const moduleSlug = question.lesson?.module?.slug;
    const lessonSlug = question.lesson?.slug;
    
    if (moduleSlug && lessonSlug) {
      // Internal navigation to lesson page with seekTo state
      navigate(`/library/${moduleSlug}/${lessonSlug}`, { 
        state: { seekTo: question.timecode_seconds } 
      });
    } else {
      // No external links! Show message instead
      console.warn("[Knowledge] Question missing lesson/module data:", question.id, {
        lessonSlug,
        moduleSlug,
        lessonId: question.lesson_id
      });
      toast.error("Видеоответ пока не привязан к уроку", {
        description: "Обратитесь к администратору для настройки связи"
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (!questions || questions.length === 0) {
    return (
      <GlassCard className="text-center py-12">
        <MessageCircleQuestion className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
        <p className="text-muted-foreground">
          {searchQuery ? "Вопросы не найдены" : "Вопросы ещё не добавлены"}
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {questions.map((question) => {
        const isExpanded = expandedIds.has(question.id);
        const formattedDate = question.answer_date
          ? format(new Date(question.answer_date), "dd.MM.yyyy")
          : null;
        const hasInternalLink = question.lesson?.slug && question.lesson?.module?.slug;

        return (
          <GlassCard key={question.id} className="space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-semibold text-foreground leading-tight">
                {question.title}
              </h3>
              <Badge variant="outline" className="shrink-0 text-xs bg-primary/10 text-primary border-primary/20">
                Выпуск #{question.episode_number}
              </Badge>
            </div>
            
            {/* Expandable full question */}
            {question.full_question && (
              <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(question.id)}>
                <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                  {isExpanded ? "Свернуть вопрос" : "Показать полный вопрос"}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="text-muted-foreground leading-relaxed italic mt-2 pl-5 border-l-2 border-primary/20">
                    "{question.full_question}"
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}
            
            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-border/30">
              <button 
                onClick={() => handleWatchVideo(question)}
                disabled={!hasInternalLink}
                className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="h-4 w-4" />
                Смотреть видеоответ
              </button>
              <div className="flex items-center gap-3">
                {formattedDate && (
                  <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formattedDate}
                  </span>
                )}
                {question.timecode_seconds !== null && (
                  <Badge variant="secondary" className="backdrop-blur-sm bg-secondary/50 gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimecode(question.timecode_seconds)}
                  </Badge>
                )}
              </div>
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}

// VideosContent удалён - видеовыпуски теперь отображаются через LessonCard из БД

// Legislation tab content component
function LegislationContent() {
  return (
    <GlassCard className="text-center py-16">
      <Scale className="h-16 w-16 text-muted-foreground/30 mx-auto mb-6" />
      <h3 className="text-xl font-semibold text-foreground mb-2">
        Раздел наполняется нормативными актами
      </h3>
      <p className="text-muted-foreground max-w-md mx-auto">
        Здесь будут размещены ссылки на актуальные законы, постановления и другие нормативные документы Республики Беларусь
      </p>
    </GlassCard>
  );
}

// Map of tab keys to content components (mock данные удалены, кроме questions и laws)
const MOCK_CONTENT_MAP: Record<string, React.ComponentType<{ searchQuery?: string }>> = {
  "knowledge-questions": QuestionsContent,
  "knowledge-laws": LegislationContent,
};

const Knowledge = () => {
  const [searchQuery, setSearchQuery] = useState("");
  
  // Fetch tabs dynamically from database
  const { tabs, isLoading: tabsLoading } = usePageSections("knowledge");
  
  // Fetch modules grouped by section (regular modules, not containers)
  const { modulesBySection, isLoading: modulesLoading } = useSidebarModules();
  
  // Fetch lessons from container modules (standalone lessons)
  const { lessonsBySection, isLoading: lessonsLoading } = useContainerLessons();
  
  // Set active tab to first tab from DB or fallback
  const [activeTab, setActiveTab] = useState<string>("");
  
  // Update active tab when tabs load
  const effectiveActiveTab = useMemo(() => {
    if (activeTab && tabs.some(t => t.key === activeTab)) {
      return activeTab;
    }
    return tabs[0]?.key || "knowledge-questions";
  }, [activeTab, tabs]);

  const isLoading = tabsLoading || modulesLoading || lessonsLoading;

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">База знаний</h1>
            <p className="text-muted-foreground">Ответы на вопросы подписчиков</p>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">База знаний</h1>
          <p className="text-muted-foreground">Ответы на вопросы подписчиков</p>
        </div>

        {/* Tabs - Dynamic from DB */}
        <Tabs value={effectiveActiveTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start bg-muted/30 backdrop-blur-xl rounded-2xl p-1.5 h-auto border border-border/30 flex-wrap">
            {tabs.map((tab) => {
              const Icon = getIcon(tab.icon);
              return (
                <TabsTrigger 
                  key={tab.key}
                  value={tab.key}
                  className="rounded-xl data-[state=active]:bg-background/90 data-[state=active]:shadow-lg data-[state=active]:backdrop-blur-sm px-4 py-2.5 gap-2"
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          
          {/* Dynamic Tab Content */}
          {tabs.map((tab) => {
            // Regular modules (not containers)
            const modules = (modulesBySection[tab.key] || []).filter(
              (m: any) => !m.is_container
            );
            // Standalone lessons from container modules
            const containerData = lessonsBySection[tab.key];
            const standaloneLessons = containerData?.lessons || [];
            const containerModuleSlug = containerData?.moduleSlug || "";
            
            const MockContent = MOCK_CONTENT_MAP[tab.key];
            const hasContent = modules.length > 0 || standaloneLessons.length > 0 || MockContent;
            
            return (
              <TabsContent key={tab.key} value={tab.key} className="mt-6 space-y-6">
                {/* Search and filters for questions tab */}
                {tab.key === "knowledge-questions" && (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Поиск по ключевым словам..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 bg-background/60 backdrop-blur-sm border-border/50 rounded-xl"
                      />
                    </div>
                    <Button variant="outline" className="gap-2 rounded-xl border-border/50 bg-background/60 backdrop-blur-sm">
                      <Filter className="h-4 w-4" />
                      <span className="hidden sm:inline">Фильтр по дате</span>
                    </Button>
                  </div>
                )}

                {/* Regular Modules (not containers) */}
                {modules.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {modules.map((module: any) => (
                      <ModuleCard key={module.id} module={module} />
                    ))}
                  </div>
                )}

                {/* Standalone Lessons from container modules */}
                {standaloneLessons.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {standaloneLessons.map((lesson) => (
                      <LessonCard 
                        key={lesson.id} 
                        lesson={lesson} 
                        moduleSlug={containerModuleSlug}
                        // episodeNumber убран - будет отображаться только если задан в настройках урока
                      />
                    ))}
                  </div>
                )}

                {/* Mock content (preserved for backwards compatibility) */}
                {MockContent && (
                  <MockContent searchQuery={searchQuery} />
                )}

                {/* Empty state if no content at all */}
                {!hasContent && (
                  <GlassCard className="text-center py-16">
                    <Folder className="h-16 w-16 text-muted-foreground/30 mx-auto mb-6" />
                    <h3 className="text-xl font-semibold text-foreground mb-2">
                      Раздел пока пуст
                    </h3>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      Контент для этого раздела ещё не добавлен
                    </p>
                  </GlassCard>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Knowledge;
