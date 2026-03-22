import { useState, useCallback } from "react";
import { useAiEntities } from "@/hooks/useAiEntities";
import { EntityTableView } from "@/components/ai-requisites/EntityTableView";
import { EntityEditorSheet } from "@/components/ai-requisites/EntityEditorSheet";
import { EntityViewSheet } from "@/components/ai-requisites/EntityViewSheet";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { 
  Bot, 
  PlayCircle, 
  Copy, 
  Send, 
  Clock,
  Target,
  TrendingUp,
  Users,
  FileText,
  MessageSquare,
  Lightbulb,
  Zap,
  Calculator,
  Briefcase,
  ShieldCheck,
  FileStack,
  Building2
} from "lucide-react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Tutorial {
  id: string;
  title: string;
  description: string;
  duration: string;
  category: string;
}

interface Prompt {
  id: string;
  title: string;
  description: string;
  promptText: string;
  category: string;
  icon: React.ReactNode;
}

// Mock data
const initialMessages: ChatMessage[] = [
  {
    id: "1",
    role: "assistant",
    content: "Привет! 👋 Я gorbova AI — твой персональный помощник в бизнесе и налогах. Чем могу помочь сегодня?",
    timestamp: new Date(),
  },
  {
    id: "2",
    role: "assistant", 
    content: "Я могу помочь тебе с:\n• Составлением бизнес-планов\n• Анализом финансов\n• Налоговыми вопросами\n• Маркетинговыми стратегиями\n\nПросто напиши свой вопрос!",
    timestamp: new Date(),
  },
];

const tutorials: Tutorial[] = [
  {
    id: "1",
    title: "Как писать эффективные промпты",
    description: "Основы промпт-инжиниринга для получения качественных ответов от AI",
    duration: "15 мин",
    category: "Основы",
  },
  {
    id: "2",
    title: "AI для маркетинга",
    description: "Используй нейросети для создания контента, анализа аудитории и автоматизации",
    duration: "25 мин",
    category: "Маркетинг",
  },
  {
    id: "3",
    title: "Автоматизация рутины с AI",
    description: "Как делегировать повторяющиеся задачи искусственному интеллекту",
    duration: "20 мин",
    category: "Продуктивность",
  },
  {
    id: "4",
    title: "AI-ассистент для финансов",
    description: "Анализ данных, прогнозирование и финансовое планирование с помощью AI",
    duration: "30 мин",
    category: "Финансы",
  },
];

const prompts: Prompt[] = [
  {
    id: "1",
    title: "План продаж на месяц",
    description: "Структурированный план достижения целей по продажам",
    promptText: "Создай детальный план продаж на месяц для [тип бизнеса]. Включи: цели по выручке, ключевые метрики, еженедельные задачи, потенциальные риски и способы их минимизации. Формат: таблица с разбивкой по неделям.",
    category: "Продажи",
    icon: <Target className="h-5 w-5" />,
  },
  {
    id: "2",
    title: "Анализ конкурентов",
    description: "Глубокий анализ конкурентной среды",
    promptText: "Проведи анализ конкурентов для [ниша/бизнес]. Определи 5 главных конкурентов, их сильные и слабые стороны, ценовую политику, УТП, каналы продвижения. Дай рекомендации, как выделиться на их фоне.",
    category: "Маркетинг",
    icon: <TrendingUp className="h-5 w-5" />,
  },
  {
    id: "3",
    title: "Скрипт холодного звонка",
    description: "Эффективный скрипт для первого контакта с клиентом",
    promptText: "Напиши скрипт холодного звонка для [продукт/услуга]. Включи: приветствие, выявление боли, презентацию решения, работу с возражениями (минимум 5), призыв к действию. Тон: дружелюбный, но профессиональный.",
    category: "Продажи",
    icon: <Users className="h-5 w-5" />,
  },
  {
    id: "4",
    title: "Контент-план на неделю",
    description: "Готовый план публикаций для соцсетей",
    promptText: "Создай контент-план на неделю для [ниша] в Instagram. Для каждого дня: тема поста, формат (рилс/карусель/сторис), текст, 10 хештегов, лучшее время публикации. Цель: вовлечение и продажи.",
    category: "Контент",
    icon: <FileText className="h-5 w-5" />,
  },
  {
    id: "5",
    title: "Ответ на негативный отзыв",
    description: "Профессиональный ответ на претензию клиента",
    promptText: "Напиши профессиональный ответ на негативный отзыв клиента: '[текст отзыва]'. Ответ должен: признать проблему, выразить сочувствие, предложить решение, сохранить репутацию компании. Тон: спокойный, уважительный.",
    category: "Сервис",
    icon: <MessageSquare className="h-5 w-5" />,
  },
  {
    id: "6",
    title: "Идеи для продукта",
    description: "Генерация идей для развития бизнеса",
    promptText: "Предложи 10 идей для нового продукта/услуги в нише [ниша]. Для каждой идеи укажи: суть, целевую аудиторию, конкурентное преимущество, примерные затраты на запуск, потенциал монетизации.",
    category: "Стратегия",
    icon: <Lightbulb className="h-5 w-5" />,
  },
];

/* ─── Конфигурация секций и подменю ─── */

type Section = "ai" | "documents" | "requisites";
type SubTab = "chat" | "tutorials" | "prompts" | "accountant" | "manager" | "audit" | "templates" | "entities" | "persons";

const SECTIONS = [
  { id: "ai" as const, label: "Gorbova AI", icon: Bot },
  { id: "documents" as const, label: "Документы", icon: FileText },
  { id: "requisites" as const, label: "Реквизиты", icon: Building2 },
];

interface SubMenuItem {
  id: SubTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  activeGradient: string;
  borderColor: string;
  iconColor: string;
}

const AI_SUB_TABS: SubMenuItem[] = [
  {
    id: "chat",
    label: "Чат",
    icon: MessageSquare,
    gradient: "from-blue-500/10 to-indigo-500/8",
    activeGradient: "from-blue-500/20 to-indigo-500/15",
    borderColor: "border-blue-400/20",
    iconColor: "text-blue-500",
  },
  {
    id: "tutorials",
    label: "Туториалы",
    icon: PlayCircle,
    gradient: "from-purple-500/10 to-violet-500/8",
    activeGradient: "from-purple-500/20 to-violet-500/15",
    borderColor: "border-purple-400/20",
    iconColor: "text-purple-500",
  },
  {
    id: "prompts",
    label: "Промпты",
    icon: Copy,
    gradient: "from-amber-500/10 to-orange-500/8",
    activeGradient: "from-amber-500/20 to-orange-500/15",
    borderColor: "border-amber-400/20",
    iconColor: "text-amber-600",
  },
];

const DOC_SUB_TABS: SubMenuItem[] = [
  {
    id: "accountant",
    label: "Для бухгалтера",
    icon: Calculator,
    gradient: "from-emerald-500/10 to-teal-500/8",
    activeGradient: "from-emerald-500/20 to-teal-500/15",
    borderColor: "border-emerald-400/20",
    iconColor: "text-emerald-500",
  },
  {
    id: "manager",
    label: "Для руководителя",
    icon: Briefcase,
    gradient: "from-rose-500/10 to-pink-500/8",
    activeGradient: "from-rose-500/20 to-pink-500/15",
    borderColor: "border-rose-400/20",
    iconColor: "text-rose-500",
  },
  {
    id: "audit",
    label: "При проверке",
    icon: ShieldCheck,
    gradient: "from-sky-500/10 to-cyan-500/8",
    activeGradient: "from-sky-500/20 to-cyan-500/15",
    borderColor: "border-sky-400/20",
    iconColor: "text-sky-500",
  },
  {
    id: "templates",
    label: "Шаблоны",
    icon: FileStack,
    gradient: "from-slate-500/10 to-gray-500/8",
    activeGradient: "from-slate-500/20 to-gray-500/15",
    borderColor: "border-slate-400/20",
    iconColor: "text-slate-500",
  },
];

const REQ_SUB_TABS: SubMenuItem[] = [
  {
    id: "entities",
    label: "Юрлица / ИП",
    icon: Building2,
    gradient: "from-indigo-500/10 to-violet-500/8",
    activeGradient: "from-indigo-500/20 to-violet-500/15",
    borderColor: "border-indigo-400/20",
    iconColor: "text-indigo-500",
  },
  {
    id: "persons",
    label: "Физлица",
    icon: Users,
    gradient: "from-teal-500/10 to-emerald-500/8",
    activeGradient: "from-teal-500/20 to-emerald-500/15",
    borderColor: "border-teal-400/20",
    iconColor: "text-teal-500",
  },
];

const DEFAULT_SUB: Record<Section, SubTab> = {
  ai: "chat",
  documents: "accountant",
  requisites: "entities",
};

const AI = () => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("ai");
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("chat");

  // Entity management state
  const [entitySheetOpen, setEntitySheetOpen] = useState(false);
  const [entitySheetMode, setEntitySheetMode] = useState<"create" | "edit">("create");
  const [entitySheetTarget, setEntitySheetTarget] = useState<ClientLegalDetails | null>(null);
  const [entityViewOpen, setEntityViewOpen] = useState(false);
  const [entityViewTarget, setEntityViewTarget] = useState<ClientLegalDetails | null>(null);
  const aiEntities = useAiEntities();

  const handleEntityCreate = useCallback(async (data: Partial<ClientLegalDetails>) => {
    await aiEntities.createEntity(data);
  }, [aiEntities]);

  const handleEntityUpdate = useCallback(async (data: Partial<ClientLegalDetails>) => {
    if (!entitySheetTarget) return;
    await aiEntities.updateEntity({ id: entitySheetTarget.id, ...data });
  }, [aiEntities, entitySheetTarget]);

  const handleOpenCreateSheet = useCallback(() => {
    setEntitySheetTarget(null);
    setEntitySheetMode("create");
    setEntitySheetOpen(true);
  }, []);

  const handleOpenEditSheet = useCallback((entity: ClientLegalDetails) => {
    setEntitySheetTarget(entity);
    setEntitySheetMode("edit");
    setEntitySheetOpen(true);
  }, []);

  const handleOpenExistingEntity = useCallback((id: string) => {
    const found = aiEntities.allEntities.find(e => e.id === id);
    if (found) {
      handleOpenEditSheet(found);
    }
  }, [aiEntities.allEntities, handleOpenEditSheet]);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    setTimeout(() => {
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Спасибо за вопрос! Функционал AI-чата находится в разработке. Скоро я смогу полноценно отвечать на твои вопросы. А пока воспользуйся вкладкой «Промпты» — там есть готовые шаблоны для работы с любой нейросетью! 🚀",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1500);
  };

  const handleCopyPrompt = (promptText: string, title: string) => {
    navigator.clipboard.writeText(promptText);
    toast({
      title: "Скопировано!",
      description: `Промпт «${title}» скопирован в буфер обмена`,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
    setActiveSubTab(DEFAULT_SUB[section]);
  };

  const subTabs = activeSection === "ai" ? AI_SUB_TABS : activeSection === "requisites" ? REQ_SUB_TABS : DOC_SUB_TABS;

  /* ─── Главный таб (pill-bar) ─── */
  const sectionTabClass = (active: boolean) =>
    `relative flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <DashboardLayout>
      <div className="flex flex-col flex-1 min-h-0 gap-1 -mt-2 md:-mt-4 bg-gradient-to-br from-blue-500/[0.02] via-transparent to-purple-500/[0.02]">

        {/* ── Главные табы (Gorbov AI / Документы) ── */}
        <div className="px-1 py-0.5 shrink-0">
          <div
            role="tablist"
            aria-label="AI разделы"
            className="inline-flex p-0.5 rounded-full bg-muted/40 backdrop-blur-md border border-border/20 overflow-x-auto max-w-full scrollbar-none"
          >
            {SECTIONS.map((sec) => {
              const isActive = activeSection === sec.id;
              const Icon = sec.icon;
              return (
                <button
                  type="button"
                  key={sec.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleSectionChange(sec.id)}
                  className={sectionTabClass(isActive)}
                >
                  <Icon className="h-4 w-4 mr-0.5" />
                  <span>{sec.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Подменю (цветные glass pills) ── */}
        <div className="px-1 shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {subTabs.map((tab) => {
              const isActive = activeSubTab === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveSubTab(tab.id)}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                    transition-all duration-200 whitespace-nowrap
                    backdrop-blur-sm border
                    bg-gradient-to-r
                    ${isActive ? tab.activeGradient : tab.gradient}
                    ${isActive ? tab.borderColor : "border-white/15"}
                    ${isActive ? "shadow-sm shadow-white/10" : "hover:shadow-sm"}
                    ${isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
                    active:scale-[0.97]
                  `}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive ? tab.iconColor : ""}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Контент ── */}

        {/* Chat */}
        {activeSubTab === "chat" && (
          <GlassCard className="p-0 overflow-hidden flex flex-col flex-1 min-h-0">
            <ScrollArea className="flex-1 min-h-0 p-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted rounded-bl-md"
                      }`}
                    >
                      {message.role === "assistant" && (
                        <div className="flex items-center gap-2 mb-2">
                          <div className="p-1 rounded-full bg-primary/10">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                          <span className="text-xs font-medium text-primary">gorbova AI</span>
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1 rounded-full bg-primary/10">
                          <Bot className="h-4 w-4 text-primary animate-pulse" />
                        </div>
                        <span className="text-sm text-muted-foreground">Думаю...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="border-t border-border/50 p-4 bg-background/50 shrink-0">
              <div className="flex gap-2">
                <Textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Напиши свой вопрос..."
                  className="min-h-[44px] max-h-[120px] resize-none"
                  disabled={isLoading}
                />
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isLoading}
                  size="icon"
                  className="h-[44px] w-[44px] shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Нажми Enter для отправки, Shift+Enter для новой строки
              </p>
            </div>
          </GlassCard>
        )}

        {/* Tutorials */}
        {activeSubTab === "tutorials" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tutorials.map((tutorial) => (
              <GlassCard key={tutorial.id} hover className="flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="secondary">{tutorial.category}</Badge>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {tutorial.duration}
                  </div>
                </div>
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                    <PlayCircle className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold leading-tight">{tutorial.title}</h3>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-4 flex-1">
                  {tutorial.description}
                </p>
                <Button variant="outline" className="w-full">
                  <PlayCircle className="h-4 w-4 mr-2" />
                  Смотреть
                </Button>
              </GlassCard>
            ))}
          </div>
        )}

        {/* Prompts */}
        {activeSubTab === "prompts" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {prompts.map((prompt) => (
                <GlassCard key={prompt.id} className="flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        {prompt.icon}
                      </div>
                      <Badge variant="outline">{prompt.category}</Badge>
                    </div>
                  </div>
                  <h3 className="font-semibold mb-2">{prompt.title}</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {prompt.description}
                  </p>
                  <div className="bg-muted/50 rounded-lg p-3 mb-4 flex-1">
                    <p className="text-xs font-mono text-muted-foreground line-clamp-4">
                      {prompt.promptText}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => handleCopyPrompt(prompt.promptText, prompt.title)}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Копировать
                  </Button>
                </GlassCard>
              ))}
            </div>
            
            <GlassCard className="mt-6">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Как использовать промпты?</h3>
                  <p className="text-sm text-muted-foreground">
                    Скопируй промпт и вставь его в ChatGPT, Claude или другую нейросеть. 
                    Замени текст в [квадратных скобках] на свои данные. 
                    Чем точнее ты опишешь контекст, тем лучше будет результат!
                  </p>
                </div>
              </div>
            </GlassCard>
          </>
        )}

        {/* Document stubs */}
        {(activeSubTab === "accountant" || activeSubTab === "manager" || activeSubTab === "audit" || activeSubTab === "templates") && (
          <div className="flex flex-1 items-center justify-center min-h-[200px]">
            <GlassCard className="max-w-md w-full text-center py-12">
              <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
                {activeSubTab === "accountant" && <Calculator className="h-8 w-8 text-emerald-500" />}
                {activeSubTab === "manager" && <Briefcase className="h-8 w-8 text-rose-500" />}
                {activeSubTab === "audit" && <ShieldCheck className="h-8 w-8 text-sky-500" />}
                {activeSubTab === "templates" && <FileStack className="h-8 w-8 text-slate-500" />}
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {subTabs.find(t => t.id === activeSubTab)?.label}
              </h3>
              <p className="text-sm text-muted-foreground">
                Раздел в разработке. Скоро здесь появятся полезные документы и шаблоны.
              </p>
            </GlassCard>
          </div>
        )}

        {/* Entities — table + sheet editor */}
        {activeSubTab === "entities" && (
          <>
            <EntityTableView
              allEntities={aiEntities.allEntities}
              isLoading={aiEntities.isLoading}
              isArchiving={aiEntities.isArchiving}
              onCreateNew={handleOpenCreateSheet}
              onEdit={handleOpenEditSheet}
              onArchive={(id) => aiEntities.archiveEntity(id)}
            />
            {aiEntities.profileId && (
              <EntityEditorSheet
                open={entitySheetOpen}
                onOpenChange={setEntitySheetOpen}
                mode={entitySheetMode}
                entity={entitySheetTarget}
                profileId={aiEntities.profileId}
                isSubmitting={entitySheetMode === "create" ? aiEntities.isCreating : aiEntities.isUpdating}
                onSubmit={entitySheetMode === "create" ? handleEntityCreate : handleEntityUpdate}
                onOpenExisting={handleOpenExistingEntity}
              />
            )}
          </>
        )}

        {/* Persons stub */}
        {activeSubTab === "persons" && (
          <div className="flex flex-1 items-center justify-center min-h-[200px]">
            <GlassCard className="max-w-md w-full text-center py-12">
              <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
                <Users className="h-8 w-8 text-teal-500" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {subTabs.find(t => t.id === activeSubTab)?.label}
              </h3>
              <p className="text-sm text-muted-foreground">
                Раздел в разработке. Здесь будет управление реквизитами для автозаполнения документов.
              </p>
            </GlassCard>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AI;
