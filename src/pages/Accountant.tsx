import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Calculator } from "lucide-react";

export default function Accountant() {
  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
            <Calculator className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Бухгалтер</h1>
            <p className="text-muted-foreground">Финансовый учет и отчетность</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Документы</h3>
            <p className="text-sm text-muted-foreground">
              Управление финансовыми документами
            </p>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Отчеты</h3>
            <p className="text-sm text-muted-foreground">
              Формирование отчетности
            </p>
          </GlassCard>
          <GlassCard>
            <h3 className="font-semibold text-foreground mb-2">Калькулятор</h3>
            <p className="text-sm text-muted-foreground">
              Расчеты и калькуляции
            </p>
          </GlassCard>
        </div>
      </div>
    </DashboardLayout>
  );
}
