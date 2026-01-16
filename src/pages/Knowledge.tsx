import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { 
  Search, 
  MessageCircleQuestion, 
  Video, 
  Scale, 
  Play, 
  Clock, 
  Filter,
  Calendar,
  ExternalLink
} from "lucide-react";

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

// Mock данные для видеовыпусков
const mockEpisodes = [
  { id: "42", title: "Выпуск #42", date: "15 янв 2025", questionsCount: 5 },
  { id: "41", title: "Выпуск #41", date: "10 янв 2025", questionsCount: 4 },
  { id: "40", title: "Выпуск #40", date: "05 янв 2025", questionsCount: 6 },
  { id: "39", title: "Выпуск #39", date: "28 дек 2024", questionsCount: 3 },
  { id: "38", title: "Выпуск #38", date: "20 дек 2024", questionsCount: 5 },
  { id: "37", title: "Выпуск #37", date: "15 дек 2024", questionsCount: 4 },
];

const Knowledge = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("questions");

  // Фильтрация вопросов по поиску
  const filteredQuestions = mockQuestions.filter(q => 
    q.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    q.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">База знаний</h1>
          <p className="text-muted-foreground">Ответы на вопросы подписчиков</p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start bg-muted/30 backdrop-blur-xl rounded-2xl p-1.5 h-auto border border-border/30 flex-wrap">
            <TabsTrigger 
              value="questions"
              className="rounded-xl data-[state=active]:bg-background/90 data-[state=active]:shadow-lg data-[state=active]:backdrop-blur-sm px-4 py-2.5 gap-2"
            >
              <MessageCircleQuestion className="h-4 w-4" />
              <span className="hidden sm:inline">Вопросы</span>
            </TabsTrigger>
            <TabsTrigger 
              value="videos"
              className="rounded-xl data-[state=active]:bg-background/90 data-[state=active]:shadow-lg data-[state=active]:backdrop-blur-sm px-4 py-2.5 gap-2"
            >
              <Video className="h-4 w-4" />
              <span className="hidden sm:inline">Видеоответы</span>
            </TabsTrigger>
            <TabsTrigger 
              value="legislation"
              className="rounded-xl data-[state=active]:bg-background/90 data-[state=active]:shadow-lg data-[state=active]:backdrop-blur-sm px-4 py-2.5 gap-2"
            >
              <Scale className="h-4 w-4" />
              <span className="hidden sm:inline">Законодательство</span>
            </TabsTrigger>
          </TabsList>
          
          {/* Вопросы */}
          <TabsContent value="questions" className="mt-6 space-y-6">
            {/* Поиск и фильтры */}
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

            {/* Список вопросов */}
            <div className="space-y-4">
              {filteredQuestions.length === 0 ? (
                <GlassCard className="text-center py-12">
                  <MessageCircleQuestion className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">Вопросы не найдены</p>
                </GlassCard>
              ) : (
                filteredQuestions.map((question) => (
                  <GlassCard key={question.id} hover className="space-y-4">
                    {/* Header - Заголовок/Тема вопроса */}
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="text-lg font-semibold text-foreground">
                        {question.title}
                      </h3>
                      <Badge variant="outline" className="shrink-0 text-xs bg-primary/10 text-primary border-primary/20">
                        Выпуск #{question.episodeNumber}
                      </Badge>
                    </div>
                    
                    {/* Body - Текст вопроса */}
                    <p className="text-muted-foreground leading-relaxed italic">
                      "{question.content}"
                    </p>
                    
                    {/* Footer - Видеоответ + Таймкод */}
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
          </TabsContent>
          
          {/* Видеоответы */}
          <TabsContent value="videos" className="mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {mockEpisodes.map((episode) => (
                <GlassCard key={episode.id} hover className="cursor-pointer group">
                  {/* Обложка видео */}
                  <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 rounded-xl mb-4 flex items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
                    <div className="relative z-10 h-14 w-14 rounded-full bg-primary/90 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
                      <Play className="h-6 w-6 text-primary-foreground ml-1" />
                    </div>
                  </div>
                  
                  {/* Информация */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground">{episode.title}</h3>
                      <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {episode.date}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircleQuestion className="h-3.5 w-3.5" />
                        {episode.questionsCount} вопросов
                      </span>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          </TabsContent>
          
          {/* Законодательство */}
          <TabsContent value="legislation" className="mt-6">
            <GlassCard className="text-center py-16">
              <Scale className="h-16 w-16 text-muted-foreground/30 mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Раздел наполняется нормативными актами
              </h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Здесь будут размещены ссылки на актуальные законы, постановления и другие нормативные документы Республики Беларусь
              </p>
            </GlassCard>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Knowledge;
