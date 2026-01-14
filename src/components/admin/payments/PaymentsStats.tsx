import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Clock, User, Package, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { PaymentsStats as Stats } from "@/hooks/useUnifiedPayments";
import { Skeleton } from "@/components/ui/skeleton";

interface PaymentsStatsProps {
  stats: Stats;
  isLoading: boolean;
}

export default function PaymentsStats({ stats, isLoading }: PaymentsStatsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
            <CardContent><Skeleton className="h-8 w-16" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Всего транзакций
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total}</div>
          <p className="text-xs text-muted-foreground">
            Обработано: {stats.processed} | В очереди: {stats.inQueue}
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <User className="h-4 w-4 text-green-500" />
            С контактом
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{stats.withContact}</div>
          <p className="text-xs text-muted-foreground">Без контакта: {stats.withoutContact}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Package className="h-4 w-4 text-blue-500" />
            Со сделкой
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">{stats.withDeal}</div>
          <p className="text-xs text-muted-foreground">Без сделки: {stats.withoutDeal}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Требуют внимания
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-amber-600">{stats.external + stats.conflicts}</div>
          <p className="text-xs text-muted-foreground">
            Внешние: {stats.external} | Конфликты: {stats.conflicts}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
