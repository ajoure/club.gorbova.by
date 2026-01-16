import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Sparkles } from "lucide-react";

export default function SelfDevelopment() {
  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
            <Sparkles className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Саморазвитие</h1>
            <p className="text-muted-foreground">Личностный рост и обучение</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Курсы</h3>
            <p className="text-sm text-muted-foreground">
              Обучающие материалы и курсы
            </p>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Привычки</h3>
            <p className="text-sm text-muted-foreground">
              Трекер полезных привычек
            </p>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Цели</h3>
            <p className="text-sm text-muted-foreground">
              Планирование целей и достижений
            </p>
          </GlassCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
