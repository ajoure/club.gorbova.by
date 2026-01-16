import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Sparkles,
  Clock,
  Target,
  TrendingUp,
  Users,
  FileText,
  MessageSquare,
  Lightbulb,
  Zap
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

const AI = () => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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

    // Simulate AI response (later will connect to real AI)
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Нейросеть</h1>
            <p className="text-muted-foreground">AI-инструменты для твоего бизнеса</p>
          </div>
        </div>

        <Tabs defaultValue="chat" className="w-full">
          <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-flex">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              <span className="hidden sm:inline">gorbova AI</span>
              <span className="sm:hidden">AI</span>
            </TabsTrigger>
            <TabsTrigger value="tutorials" className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Туториалы</span>
              <span className="sm:hidden">Видео</span>
            </TabsTrigger>
            <TabsTrigger value="prompts" className="flex items-center gap-2">
              <Copy className="h-4 w-4" />
              <span>Промпты</span>
            </TabsTrigger>
          </TabsList>

          {/* Chat Tab */}
          <TabsContent value="chat" className="mt-6">
            <GlassCard className="p-0 overflow-hidden flex flex-col" style={{ height: "calc(100vh - 280px)", minHeight: "500px" }}>
              {/* Messages Area */}
              <ScrollArea className="flex-1 p-4">
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

              {/* Input Area */}
              <div className="border-t border-border/50 p-4 bg-background/50">
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
          </TabsContent>

          {/* Tutorials Tab */}
          <TabsContent value="tutorials" className="mt-6">
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
          </TabsContent>

          {/* Prompts Tab */}
          <TabsContent value="prompts" className="mt-6">
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
            
            {/* Hint */}
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
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default AI;
