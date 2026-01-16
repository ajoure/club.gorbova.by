import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Wallet, 
  Briefcase, 
  Shield, 
  PiggyBank, 
  Play, 
  Headphones, 
  FileCheck, 
  AlertTriangle,
  Target,
  ShoppingBag,
  Plus,
  History
} from "lucide-react";

// Security scenarios (moved from Audits)
const securityScenarios = [
  {
    id: "1",
    situation: "Получен запрос МНС по ст. 107",
    solution: "Подготовка официального ответа с использованием AI-генератора документов",
    urgency: "high",
    link: "/audits/mns-response",
  },
  {
    id: "2",
    situation: "Выездная налоговая проверка",
    solution: "Аудит документации, подготовка пояснений и сопровождение проверки",
    urgency: "high",
    link: "/consultation",
  },
  {
    id: "3",
    situation: "Проверка правильности применения льгот",
    solution: "Ревизия оснований для применения налоговых льгот и преференций",
    urgency: "medium",
    link: "/consultation",
  },
  {
    id: "4",
    situation: "Подозрение на ошибки в учёте",
    solution: "Экспресс-аудит бухгалтерской отчётности и налоговых деклараций",
    urgency: "medium",
    link: "/consultation",
  },
];

// Business content blocks
const businessBlocks = [
  {
    id: "1",
    type: "video",
    title: "Видеоуроки и домашние задания",
    description: "Практические уроки по ведению бизнеса и управлению финансами",
    icon: Play,
    count: 24,
  },
  {
    id: "2",
    type: "podcast",
    title: "Подкасты и тактические задачи",
    description: "Аудиоматериалы с разбором реальных кейсов",
    icon: Headphones,
    count: 18,
  },
];

// Personal finance tools
const financeTools = [
  {
    id: "1",
    title: "Учёт доходов и расходов",
    description: "Таблица для отслеживания денежного потока",
    icon: PiggyBank,
    available: false,
  },
  {
    id: "2",
    title: "Финансовые цели",
    description: "Планирование и отслеживание целей",
    icon: Target,
    available: false,
  },
  {
    id: "3",
    title: "Wishlist",
    description: "Список желаний с приоритетами и сроками",
    icon: ShoppingBag,
    available: false,
  },
];

function SecurityCard({ scenario }: { scenario: typeof securityScenarios[0] }) {
  const navigate = useNavigate();
  
  const urgencyColors = {
    high: "bg-destructive/10 text-destructive border-destructive/20",
    medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    low: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  };

  return (
    <GlassCard className="hover:border-primary/30 transition-all">
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          scenario.urgency === 'high' ? 'bg-destructive/10' : 'bg-amber-500/10'
        }`}>
          {scenario.urgency === 'high' ? (
            <AlertTriangle className="w-5 h-5 text-destructive" />
          ) : (
            <Shield className="w-5 h-5 text-amber-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-foreground">{scenario.situation}</h3>
            <Badge variant="outline" className={urgencyColors[scenario.urgency as keyof typeof urgencyColors]}>
              {scenario.urgency === 'high' ? 'Срочно' : 'Важно'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{scenario.solution}</p>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => navigate(scenario.link)}
            className="gap-2"
          >
            <FileCheck className="w-4 h-4" />
            {scenario.link.includes('mns') ? 'Сформировать ответ' : 'Записаться на консультацию'}
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

function BusinessBlock({ block }: { block: typeof businessBlocks[0] }) {
  const Icon = block.icon;
  
  return (
    <GlassCard className="hover:border-primary/30 transition-all cursor-pointer group">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0 group-hover:from-primary/30 group-hover:to-accent/30 transition-colors">
          <Icon className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-foreground mb-1 group-hover:text-primary transition-colors">
            {block.title}
          </h3>
          <p className="text-sm text-muted-foreground mb-2">{block.description}</p>
          <Badge variant="secondary">{block.count} материалов</Badge>
        </div>
      </div>
    </GlassCard>
  );
}

function FinanceToolCard({ tool }: { tool: typeof financeTools[0] }) {
  const Icon = tool.icon;
  
  return (
    <GlassCard className={`${!tool.available ? 'opacity-60' : 'hover:border-primary/30'} transition-all`}>
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center shrink-0">
          <Icon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-foreground mb-1">{tool.title}</h3>
          <p className="text-sm text-muted-foreground">{tool.description}</p>
          {!tool.available && (
            <Badge variant="secondary" className="mt-2">Скоро</Badge>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export default function Money() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "business";
  const navigate = useNavigate();

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
            <Wallet className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Деньги</h1>
            <p className="text-muted-foreground">Бизнес, безопасность и личные финансы</p>
          </div>
        </div>

        <Tabs value={currentTab} onValueChange={handleTabChange}>
          <TabsList className="mb-6">
            <TabsTrigger value="business" className="gap-2">
              <Briefcase className="w-4 h-4" />
              Бизнес
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Shield className="w-4 h-4" />
              Безопасность
            </TabsTrigger>
            <TabsTrigger value="personal" className="gap-2">
              <PiggyBank className="w-4 h-4" />
              Личные финансы
            </TabsTrigger>
          </TabsList>

          <TabsContent value="business" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {businessBlocks.map((block) => (
                <BusinessBlock key={block.id} block={block} />
              ))}
            </div>
            
            <GlassCard className="bg-primary/5 border-primary/20">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-foreground mb-1">Нужна помощь с бизнесом?</h3>
                  <p className="text-sm text-muted-foreground">Запишитесь на консультацию эксперта</p>
                </div>
                <Button onClick={() => navigate('/consultation')}>
                  Записаться
                </Button>
              </div>
            </GlassCard>
          </TabsContent>

          <TabsContent value="security" className="space-y-6">
            {/* Quick actions */}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/audits/mns-response')} className="gap-2">
                <Plus className="w-4 h-4" />
                Ответ на запрос МНС
              </Button>
              <Button variant="outline" onClick={() => navigate('/audits/mns-history')} className="gap-2">
                <History className="w-4 h-4" />
                История документов
              </Button>
            </div>

            {/* Security scenarios */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">Типовые ситуации</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {securityScenarios.map((scenario) => (
                  <SecurityCard key={scenario.id} scenario={scenario} />
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="personal" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {financeTools.map((tool) => (
                <FinanceToolCard key={tool.id} tool={tool} />
              ))}
            </div>

            <GlassCard className="bg-primary/5 border-primary/20 text-center py-8">
              <PiggyBank className="w-12 h-12 text-primary/50 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Личные финансы</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Инструменты для учёта личных финансов находятся в разработке. 
                Скоро здесь появятся таблицы ДДС, трекер целей и Wishlist.
              </p>
            </GlassCard>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
