import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Clock, User, Package, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { PaymentsStats as Stats } from "@/hooks/useUnifiedPayments";
import { Skeleton } from "@/components/ui/skeleton";

interface PaymentsStatsProps {
  stats: Stats;
  isLoading: boolean;
}

export default function PaymentsStats({ stats, isLoading }: PaymentsStatsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
            <CardContent><Skeleton className="h-8 w-16" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Всего
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total}</div>
          <p className="text-xs text-muted-foreground">
            Обраб: {stats.processed} | Очередь: {stats.inQueue}
          </p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            Успешные
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{stats.successful || 0}</div>
          <p className="text-xs text-muted-foreground">Контакт: {stats.withContact}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            Ожидают
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-amber-600">{stats.pending || 0}</div>
          <p className="text-xs text-muted-foreground">В обработке</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-500" />
            Ошибки
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">{stats.failed || 0}</div>
          <p className="text-xs text-muted-foreground">Требуют проверки</p>
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
          <p className="text-xs text-muted-foreground">Без: {stats.withoutDeal}</p>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Внимание
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">{stats.external + stats.conflicts}</div>
          <p className="text-xs text-muted-foreground">
            Внеш: {stats.external} | Конфл: {stats.conflicts}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
