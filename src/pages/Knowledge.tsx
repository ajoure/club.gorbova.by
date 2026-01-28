import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageSections } from "@/hooks/usePageSections";
import { useSidebarModules } from "@/hooks/useSidebarModules";
import { useContainerLessons } from "@/hooks/useContainerLessons";
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
  type LucideIcon,
} from "lucide-react";

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

// Mock данные для вопросов
const mockQuestions = [
  {
    id: "1",
    title: "Уплата налогов при УСН",
    content: "Добрый день! У меня ИП на упрощёнке. Недавно выставила счёт клиенту из РФ. Подскажите, нужно ли мне платить НДС в этом случае?",
    videoUrl: "#",
    timecode: "14:20",
    episodeNumber: 42,
    createdAt: "2025-01-15"
  },
  {
    id: "2", 
    title: "Оформление командировки сотрудника",
    content: "Планирую отправить сотрудника в командировку в Минск на 3 дня. Какие документы нужно оформить и как правильно рассчитать суточные?",
    videoUrl: "#",
    timecode: "8:45",
    episodeNumber: 41,
    createdAt: "2025-01-10"
  },
  {
    id: "3",
    title: "Расчёт отпускных при неполном году работы",
    content: "Сотрудник проработал 7 месяцев и хочет взять отпуск. Как правильно рассчитать отпускные в этом случае? Есть ли какие-то особенности?",
    videoUrl: "#",
    timecode: "22:15",
    episodeNumber: 40,
    createdAt: "2025-01-05"
  },
  {
    id: "4",
    title: "Декретный отпуск для ИП",
    content: "Я индивидуальный предприниматель. Скоро ухожу в декрет. Какие выплаты мне положены и как их оформить? Нужно ли приостанавливать деятельность?",
    videoUrl: "#",
    timecode: "18:30",
    episodeNumber: 39,
    createdAt: "2024-12-28"
  },
  {
    id: "5",
    title: "Договор с самозанятым из России",
    content: "Хочу заключить договор с самозанятым из РФ на разработку сайта. Какие документы нужны? Как правильно оформить оплату?",
    videoUrl: "#",
    timecode: "11:05",
    episodeNumber: 38,
    createdAt: "2024-12-20"
  }
];

// Mock данные для видеовыпусков удалены - используем только реальные данные из БД

// Questions tab content component
function QuestionsContent({ searchQuery }: { searchQuery: string }) {
  const filteredQuestions = mockQuestions.filter(q => 
    q.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    q.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {filteredQuestions.length === 0 ? (
        <GlassCard className="text-center py-12">
          <MessageCircleQuestion className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-muted-foreground">Вопросы не найдены</p>
        </GlassCard>
      ) : (
        filteredQuestions.map((question) => (
          <GlassCard key={question.id} hover className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-lg font-semibold text-foreground">
                {question.title}
              </h3>
              <Badge variant="outline" className="shrink-0 text-xs bg-primary/10 text-primary border-primary/20">
                Выпуск #{question.episodeNumber}
              </Badge>
            </div>
            
            <p className="text-muted-foreground leading-relaxed italic">
              "{question.content}"
            </p>
            
            <div className="flex items-center justify-between pt-3 border-t border-border/30">
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2 text-primary hover:text-primary hover:bg-primary/10 rounded-xl"
              >
                <Play className="h-4 w-4" />
                Смотреть видеоответ
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {question.createdAt}
                </span>
                <Badge variant="secondary" className="backdrop-blur-sm bg-secondary/50 gap-1">
                  <Clock className="h-3 w-3" />
                  {question.timecode}
                </Badge>
              </div>
            </div>
          </GlassCard>
        ))
      )}
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
