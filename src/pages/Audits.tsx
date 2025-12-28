import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { ClipboardCheck, FileText, History, FileCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Audits() {
  const navigate = useNavigate();

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

        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Документы
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <GlassCard 
              className="cursor-pointer hover:scale-[1.02] transition-transform"
              onClick={() => navigate("/audits/mns-response")}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shrink-0">
                  <FileCheck className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">
                    Ответ на запрос МНС по ст. 107
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    AI-генерация официальных ответов на запросы налоговых органов
                  </p>
                </div>
              </div>
            </GlassCard>

            <GlassCard 
              className="cursor-pointer hover:scale-[1.02] transition-transform"
              onClick={() => navigate("/audits/mns-history")}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0">
                  <History className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">
                    История документов
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Архив сгенерированных ответов на запросы МНС
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">Другие инструменты</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <GlassCard className="opacity-60">
              <h3 className="font-semibold text-foreground mb-2">Чек-листы</h3>
              <p className="text-sm text-muted-foreground">
                Шаблоны проверок и аудитов
              </p>
              <p className="text-xs text-muted-foreground mt-2 italic">Скоро</p>
            </GlassCard>
            <GlassCard className="opacity-60">
              <h3 className="font-semibold text-foreground mb-2">История проверок</h3>
              <p className="text-sm text-muted-foreground">
                Архив проведенных проверок
              </p>
              <p className="text-xs text-muted-foreground mt-2 italic">Скоро</p>
            </GlassCard>
            <GlassCard className="opacity-60">
              <h3 className="font-semibold text-foreground mb-2">Отчеты</h3>
              <p className="text-sm text-muted-foreground">
                Результаты и рекомендации
              </p>
              <p className="text-xs text-muted-foreground mt-2 italic">Скоро</p>
            </GlassCard>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
