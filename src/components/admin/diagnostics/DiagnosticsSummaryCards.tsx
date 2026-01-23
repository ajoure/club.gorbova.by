import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Shield, AlertTriangle, Globe, BarChart3 } from "lucide-react";
import type { DiagnosticsStats } from "@/hooks/usePaymentDiagnostics";

interface DiagnosticsSummaryCardsProps {
  stats: DiagnosticsStats;
  isLoading?: boolean;
}

export function DiagnosticsSummaryCards({ stats, isLoading }: DiagnosticsSummaryCardsProps) {
  const formatPercent = (value: number) => `${value.toFixed(1)}%`;
  const formatNumber = (value: number) => value.toLocaleString("ru-RU");

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="pt-4">
              <div className="h-4 bg-muted rounded w-1/2 mb-2" />
              <div className="h-8 bg-muted rounded w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      title: "Approval Rate",
      value: formatPercent(stats.approvalRate),
      subtitle: `${formatNumber(stats.successful)} / ${formatNumber(stats.total)}`,
      icon: stats.approvalRate >= 85 ? TrendingUp : TrendingDown,
      iconColor: stats.approvalRate >= 85 ? "text-green-500" : "text-red-500",
      bgColor: stats.approvalRate >= 85 ? "bg-green-500/10" : "bg-red-500/10",
    },
    {
      title: "Требует 3DS",
      value: formatPercent(stats.needs3dsRate),
      subtitle: `${formatNumber(stats.needs3dsCount)} из ${formatNumber(stats.failed)} ошибок`,
      icon: Shield,
      iconColor: stats.needs3dsRate > 30 ? "text-amber-500" : "text-blue-500",
      bgColor: stats.needs3dsRate > 30 ? "bg-amber-500/10" : "bg-blue-500/10",
    },
    {
      title: "BY vs Мир",
      value: `${formatPercent((stats.byCount / (stats.total || 1)) * 100)}`,
      subtitle: `BY: ${formatNumber(stats.byCount)} | Другие: ${formatNumber(stats.nonByCount)}`,
      icon: Globe,
      iconColor: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      title: "Отклонено",
      value: formatNumber(stats.failed),
      subtitle: `${formatPercent(100 - stats.approvalRate)} от общего`,
      icon: AlertTriangle,
      iconColor: stats.failed > 0 ? "text-red-500" : "text-muted-foreground",
      bgColor: stats.failed > 0 ? "bg-red-500/10" : "bg-muted",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card, index) => (
        <Card key={index} className={card.bgColor}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{card.title}</span>
              <card.icon className={`h-4 w-4 ${card.iconColor}`} />
            </div>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
