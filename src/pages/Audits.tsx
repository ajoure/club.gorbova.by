import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { ClipboardCheck } from "lucide-react";

export default function Audits() {
  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
            <ClipboardCheck className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Проверки</h1>
            <p className="text-muted-foreground">Аудит и контроль качества</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Чек-листы</h3>
            <p className="text-sm text-muted-foreground">
              Шаблоны проверок и аудитов
            </p>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">История</h3>
            <p className="text-sm text-muted-foreground">
              Архив проведенных проверок
            </p>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Отчеты</h3>
            <p className="text-sm text-muted-foreground">
              Результаты и рекомендации
            </p>
          </GlassCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
