import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Search, Calendar, Play, Clock, User, FileText, Video } from "lucide-react";
import { useSearchParams } from "react-router-dom";

// Mock data for questions
const mockQuestions = [
  {
    id: "1",
    author_name: "Елена Иванова",
    content: "Как правильно оформить возврат НДС при экспорте товаров в страны ЕАЭС?",
    video_url: "https://example.com/video1",
    timecode: "12:34",
    created_at: "2026-01-15",
  },
  {
    id: "2",
    author_name: "Андрей Петров",
    content: "Какие документы нужны для подтверждения командировочных расходов?",
    video_url: "https://example.com/video2",
    timecode: "45:12",
    created_at: "2026-01-14",
  },
  {
    id: "3",
    author_name: "Мария Сидорова",
    content: "Изменились ли ставки налога на прибыль в 2026 году?",
    video_url: "https://example.com/video3",
    timecode: "08:45",
    created_at: "2026-01-13",
  },
];

// Mock data for video episodes
const mockEpisodes = [
  {
    id: "1",
    title: "Выпуск #47 — Изменения в НК 2026",
    date: "2026-01-10",
    video_url: "https://example.com/episode47",
    questions_count: 12,
  },
  {
    id: "2",
    title: "Выпуск #46 — Проверки МНС",
    date: "2026-01-03",
    video_url: "https://example.com/episode46",
    questions_count: 8,
  },
  {
    id: "3",
    title: "Выпуск #45 — Годовая отчётность",
    date: "2025-12-27",
    video_url: "https://example.com/episode45",
    questions_count: 15,
  },
  {
    id: "4",
    title: "Выпуск #44 — ЭСФ и ЭТТН",
    date: "2025-12-20",
    video_url: "https://example.com/episode44",
    questions_count: 10,
  },
];

function QuestionCard({ question }: { question: typeof mockQuestions[0] }) {
  return (
    <GlassCard className="hover:border-primary/30 transition-all">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-foreground">{question.author_name}</span>
            <span className="text-xs text-muted-foreground">{question.created_at}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">{question.content}</p>
          {question.video_url && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2">
                <Play className="w-4 h-4" />
                Смотреть ответ
              </Button>
              {question.timecode && (
                <Badge variant="secondary" className="gap-1">
                  <Clock className="w-3 h-3" />
                  {question.timecode}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function EpisodeCard({ episode }: { episode: typeof mockEpisodes[0] }) {
  return (
    <GlassCard className="hover:border-primary/30 transition-all cursor-pointer group">
      <div className="aspect-video bg-gradient-to-br from-primary/20 to-accent/20 rounded-lg mb-4 flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
          <Video className="w-8 h-8 text-primary" />
        </div>
      </div>
      <h3 className="font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
        {episode.title}
      </h3>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{episode.date}</span>
        <Badge variant="secondary">{episode.questions_count} вопросов</Badge>
      </div>
    </GlassCard>
  );
}

export default function Knowledge() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "questions";
  const [searchQuery, setSearchQuery] = useState("");

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  const filteredQuestions = mockQuestions.filter(q =>
    q.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    q.author_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
            <BookOpen className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">База знаний</h1>
            <p className="text-muted-foreground">Ответы экспертов на ваши вопросы</p>
          </div>
        </div>

        <Tabs value={currentTab} onValueChange={handleTabChange}>
          <TabsList className="mb-6">
            <TabsTrigger value="questions" className="gap-2">
              <Search className="w-4 h-4" />
              Вопросы
            </TabsTrigger>
            <TabsTrigger value="video-answers" className="gap-2">
              <Video className="w-4 h-4" />
              Видеоответы
            </TabsTrigger>
            <TabsTrigger value="legislation" className="gap-2">
              <FileText className="w-4 h-4" />
              Законодательство
            </TabsTrigger>
          </TabsList>

          <TabsContent value="questions" className="space-y-6">
            {/* Search and filters */}
            <GlassCard>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск по вопросам..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Период
                </Button>
              </div>
            </GlassCard>

            {/* Questions list */}
            <div className="space-y-4">
              {filteredQuestions.length > 0 ? (
                filteredQuestions.map((question) => (
                  <QuestionCard key={question.id} question={question} />
                ))
              ) : (
                <GlassCard className="text-center py-12">
                  <Search className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground">Вопросы не найдены</p>
                </GlassCard>
              )}
            </div>
          </TabsContent>

          <TabsContent value="video-answers" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {mockEpisodes.map((episode) => (
                <EpisodeCard key={episode.id} episode={episode} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="legislation" className="space-y-6">
            <GlassCard className="text-center py-16">
              <FileText className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-foreground mb-2">Законодательство</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Раздел находится в разработке. Здесь будут актуальные нормативные документы и их разборы.
              </p>
              <Badge variant="secondary" className="mt-4">Скоро</Badge>
            </GlassCard>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
