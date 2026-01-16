import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Rocket, Target, CheckCircle2, Circle, Trophy } from "lucide-react";

// Import the balance wheel content directly
import BalanceWheelContent from "@/pages/tools/BalanceWheel";

// Mock quests data
const quests = [
  {
    id: "1",
    title: "Первый шаг",
    description: "Заполните профиль и познакомьтесь с платформой",
    reward: "50 XP",
    completed: true,
    category: "Знакомство",
  },
  {
    id: "2",
    title: "Исследователь",
    description: "Изучите 3 урока в базе знаний",
    reward: "100 XP",
    completed: false,
    progress: 1,
    total: 3,
    category: "Обучение",
  },
  {
    id: "3",
    title: "Баланс жизни",
    description: "Заполните колесо жизненного баланса",
    reward: "75 XP",
    completed: false,
    category: "Саморазвитие",
  },
  {
    id: "4",
    title: "Спрашивай смело",
    description: "Задайте первый вопрос эксперту",
    reward: "50 XP",
    completed: false,
    category: "Сообщество",
  },
];

function QuestCard({ quest }: { quest: typeof quests[0] }) {
  return (
    <GlassCard className={`${quest.completed ? 'bg-emerald-500/5 border-emerald-500/20' : 'hover:border-primary/30'} transition-all`}>
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          quest.completed 
            ? 'bg-emerald-500/20' 
            : 'bg-primary/10'
        }`}>
          {quest.completed ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          ) : (
            <Circle className="w-5 h-5 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className={`font-semibold ${quest.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {quest.title}
            </h3>
            <Badge variant={quest.completed ? "secondary" : "default"} className="shrink-0 gap-1">
              <Trophy className="w-3 h-3" />
              {quest.reward}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-2">{quest.description}</p>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{quest.category}</Badge>
            {quest.progress !== undefined && quest.total !== undefined && !quest.completed && (
              <span className="text-xs text-muted-foreground">
                {quest.progress}/{quest.total}
              </span>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// Wrapper to render BalanceWheel without its own DashboardLayout
function BalanceWheelTab() {
  // We need to render the inner content of BalanceWheel without the DashboardLayout wrapper
  // For now, we'll show a placeholder that links to the full page
  return (
    <div className="space-y-6">
      <GlassCard className="bg-primary/5 border-primary/20">
        <div className="flex items-start gap-3">
          <Target className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-foreground font-medium">Колесо жизненного баланса</p>
            <p className="text-sm text-muted-foreground">
              Оцените ключевые сферы жизни и найдите точки роста
            </p>
          </div>
        </div>
      </GlassCard>
      
      {/* Embed the full BalanceWheel component content */}
      <BalanceWheelContent />
    </div>
  );
}

export default function SelfDevelopment() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "quests";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  const completedQuests = quests.filter(q => q.completed).length;
  const totalXP = quests.filter(q => q.completed).reduce((sum, q) => sum + parseInt(q.reward), 0);

  // If we're showing the balance wheel tab, render the BalanceWheel component directly
  if (currentTab === "balance-wheel") {
    return <BalanceWheelContent />;
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
            <Sparkles className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Саморазвитие</h1>
            <p className="text-muted-foreground">Личностный рост и развитие</p>
          </div>
        </div>

        <Tabs value={currentTab} onValueChange={handleTabChange}>
          <TabsList className="mb-6">
            <TabsTrigger value="quests" className="gap-2">
              <Rocket className="w-4 h-4" />
              Квесты
            </TabsTrigger>
            <TabsTrigger value="balance-wheel" className="gap-2">
              <Target className="w-4 h-4" />
              Колесо баланса
            </TabsTrigger>
          </TabsList>

          <TabsContent value="quests" className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <GlassCard className="text-center">
                <p className="text-2xl font-bold text-foreground">{completedQuests}</p>
                <p className="text-sm text-muted-foreground">Выполнено</p>
              </GlassCard>
              <GlassCard className="text-center">
                <p className="text-2xl font-bold text-foreground">{quests.length - completedQuests}</p>
                <p className="text-sm text-muted-foreground">Осталось</p>
              </GlassCard>
              <GlassCard className="text-center">
                <p className="text-2xl font-bold text-primary">{totalXP} XP</p>
                <p className="text-sm text-muted-foreground">Заработано</p>
              </GlassCard>
              <GlassCard className="text-center">
                <p className="text-2xl font-bold text-foreground">1</p>
                <p className="text-sm text-muted-foreground">Уровень</p>
              </GlassCard>
            </div>

            {/* Active quests */}
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-4">Активные квесты</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {quests.filter(q => !q.completed).map((quest) => (
                  <QuestCard key={quest.id} quest={quest} />
                ))}
              </div>
            </div>

            {/* Completed quests */}
            {completedQuests > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-4">Выполненные</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {quests.filter(q => q.completed).map((quest) => (
                    <QuestCard key={quest.id} quest={quest} />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="balance-wheel">
            <BalanceWheelTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
