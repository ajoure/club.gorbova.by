import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Cpu, 
  MessageSquare, 
  BookOpen, 
  FileText, 
  Send, 
  Bot, 
  User,
  Copy,
  Play,
  Sparkles
} from "lucide-react";

// Mock tutorials
const tutorials = [
  {
    id: "1",
    title: "Как составить промпт для анализа договора",
    duration: "5 мин",
    difficulty: "Начинающий",
  },
  {
    id: "2",
    title: "Генерация ответов на запросы МНС",
    duration: "8 мин",
    difficulty: "Средний",
  },
  {
    id: "3",
    title: "Автоматизация рутинных задач с AI",
    duration: "12 мин",
    difficulty: "Продвинутый",
  },
];

// Mock prompts library
const promptsLibrary = [
  {
    id: "1",
    title: "Анализ договора",
    category: "Юридические",
    prompt: "Проанализируй следующий договор и выдели ключевые риски для заказчика...",
    uses: 156,
  },
  {
    id: "2",
    title: "Расчёт налога",
    category: "Бухгалтерия",
    prompt: "Рассчитай сумму НДС к уплате при следующих условиях...",
    uses: 234,
  },
  {
    id: "3",
    title: "Ответ на претензию",
    category: "Юридические",
    prompt: "Составь официальный ответ на претензию контрагента...",
    uses: 89,
  },
  {
    id: "4",
    title: "Проверка отчётности",
    category: "Бухгалтерия",
    prompt: "Проверь баланс на наличие типичных ошибок и несоответствий...",
    uses: 167,
  },
];

// Chat message type
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// Mock chat messages
const initialMessages: ChatMessage[] = [
  {
    id: "1",
    role: "assistant",
    content: "Здравствуйте! Я gorbova AI — ваш помощник по вопросам бухгалтерии, налогов и законодательства Беларуси. Чем могу помочь?",
  },
];

function ChatInterface() {
  const [messages, setMessages] = useState(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    const userMessage = {
      id: Date.now().toString(),
      role: "user" as const,
      content: inputValue,
    };

    setMessages([...messages, userMessage]);
    setInputValue("");
    setIsLoading(true);

    // Simulate AI response
    setTimeout(() => {
      const aiResponse = {
        id: (Date.now() + 1).toString(),
        role: "assistant" as const,
        content: "Спасибо за ваш вопрос! К сожалению, функция AI-чата находится в разработке. Скоро здесь появится полноценный интеллектуальный помощник.",
      };
      setMessages((prev) => [...prev, aiResponse]);
      setIsLoading(false);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-[600px]">
      <ScrollArea className="flex-1 pr-4">
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary-foreground" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                <p className="text-sm">{message.content}</p>
              </div>
              {message.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="bg-muted rounded-2xl px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="pt-4 border-t mt-4">
        <div className="flex gap-2">
          <Input
            placeholder="Задайте вопрос..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            disabled={isLoading}
          />
          <Button onClick={handleSend} disabled={isLoading || !inputValue.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function TutorialCard({ tutorial }: { tutorial: typeof tutorials[0] }) {
  const difficultyColors = {
    "Начинающий": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    "Средний": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    "Продвинутый": "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  };

  return (
    <GlassCard className="hover:border-primary/30 transition-all cursor-pointer group">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0 group-hover:from-primary/30 group-hover:to-accent/30 transition-colors">
          <Play className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
            {tutorial.title}
          </h3>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{tutorial.duration}</Badge>
            <Badge className={difficultyColors[tutorial.difficulty as keyof typeof difficultyColors]}>
              {tutorial.difficulty}
            </Badge>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function PromptCard({ prompt }: { prompt: typeof promptsLibrary[0] }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(prompt.prompt);
  };

  return (
    <GlassCard className="hover:border-primary/30 transition-all">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="font-semibold text-foreground mb-1">{prompt.title}</h3>
          <Badge variant="outline">{prompt.category}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={handleCopy} className="shrink-0">
          <Copy className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{prompt.prompt}</p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="w-3 h-3" />
        <span>Использовано {prompt.uses} раз</span>
      </div>
    </GlassCard>
  );
}

export default function AI() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "chat";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center">
            <Cpu className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Нейросеть</h1>
            <p className="text-muted-foreground">AI-помощник и инструменты автоматизации</p>
          </div>
        </div>

        <Tabs value={currentTab} onValueChange={handleTabChange}>
          <TabsList className="mb-6">
            <TabsTrigger value="chat" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              gorbova AI
            </TabsTrigger>
            <TabsTrigger value="tutorials" className="gap-2">
              <BookOpen className="w-4 h-4" />
              Туториалы
            </TabsTrigger>
            <TabsTrigger value="prompts" className="gap-2">
              <FileText className="w-4 h-4" />
              Промпты
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat">
            <GlassCard>
              <ChatInterface />
            </GlassCard>
          </TabsContent>

          <TabsContent value="tutorials" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {tutorials.map((tutorial) => (
                <TutorialCard key={tutorial.id} tutorial={tutorial} />
              ))}
            </div>

            <GlassCard className="text-center py-8">
              <BookOpen className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground">
                Больше туториалов появится в ближайшее время
              </p>
            </GlassCard>
          </TabsContent>

          <TabsContent value="prompts" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {promptsLibrary.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
