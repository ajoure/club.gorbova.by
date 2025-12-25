import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Briefcase } from "lucide-react";

export default function Business() {
  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Briefcase className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Бизнес</h1>
            <p className="text-muted-foreground">Управление бизнес-процессами</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Проекты</h3>
            <p className="text-sm text-muted-foreground">
              Управление проектами и задачами
            </p>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Партнеры</h3>
            <p className="text-sm text-muted-foreground">
              База партнеров и контрагентов
            </p>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Аналитика</h3>
            <p className="text-sm text-muted-foreground">
              Бизнес-аналитика и метрики
            </p>
          </GlassCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
