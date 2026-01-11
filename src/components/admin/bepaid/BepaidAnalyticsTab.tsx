import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Area, AreaChart 
} from "recharts";
import { 
  TrendingUp, CreditCard, Package, Users, AlertTriangle, 
  CheckCircle2, Clock, DollarSign, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import { format, subDays, eachDayOfInterval, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";

interface DateFilter {
  from: string;
  to?: string;
}

interface BepaidAnalyticsTabProps {
  dateFilter: DateFilter;
}

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];
const STATUS_COLORS = {
  successful: "hsl(142 76% 36%)",
  pending: "hsl(43 96% 56%)",
  failed: "hsl(0 84% 60%)",
  skipped: "hsl(var(--muted-foreground))",
};

export default function BepaidAnalyticsTab({ dateFilter }: BepaidAnalyticsTabProps) {
  // Fetch queue data for analytics
  const { data: queueData } = useQuery({
    queryKey: ["bepaid-analytics-queue", dateFilter.from, dateFilter.to],
    queryFn: async () => {
      const query = supabase
        .from("payment_reconcile_queue")
        .select("*")
        .gte("created_at", dateFilter.from);
      
      if (dateFilter.to) {
        query.lte("created_at", dateFilter.to + "T23:59:59");
      }
      
      const { data, error } = await query.order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch payments data
  const { data: paymentsData } = useQuery({
    queryKey: ["bepaid-analytics-payments", dateFilter.from, dateFilter.to],
    queryFn: async () => {
      const query = supabase
        .from("payments_v2")
        .select(`
          *,
          order:order_id(
            id,
            product:product_id(id, name, code),
            tariff:tariff_id(id, name)
          )
        `)
        .eq("provider", "bepaid")
        .gte("created_at", dateFilter.from);
      
      if (dateFilter.to) {
        query.lte("created_at", dateFilter.to + "T23:59:59");
      }
      
      const { data, error } = await query.order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Daily revenue chart data
  const dailyData = useMemo(() => {
    if (!queueData || queueData.length === 0) return [];
    
    const fromDate = parseISO(dateFilter.from);
    const toDate = dateFilter.to ? parseISO(dateFilter.to) : new Date();
    const days = eachDayOfInterval({ start: fromDate, end: toDate });
    
    return days.map(day => {
      const dayStr = format(day, "yyyy-MM-dd");
      const dayItems = queueData.filter(item => 
        item.created_at?.startsWith(dayStr) || item.paid_at?.startsWith(dayStr)
      );
      
      const successful = dayItems.filter(item => 
        item.status === "processed" || 
        (item.raw_payload as Record<string, unknown>)?.status_normalized === "successful"
      );
      const failed = dayItems.filter(item => 
        item.status === "error" || item.status === "failed"
      );
      const pending = dayItems.filter(item => item.status === "pending");
      
      return {
        date: format(day, "dd.MM", { locale: ru }),
        fullDate: dayStr,
        revenue: successful.reduce((sum, item) => sum + (item.amount || 0), 0),
        transactions: dayItems.length,
        successful: successful.length,
        failed: failed.length,
        pending: pending.length,
      };
    });
  }, [queueData, dateFilter]);

  // Status funnel data
  const statusFunnel = useMemo(() => {
    if (!queueData) return [];
    
    const statusCounts: Record<string, number> = {};
    queueData.forEach(item => {
      const status = item.status || "unknown";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    return Object.entries(statusCounts)
      .map(([status, count]) => ({
        name: getStatusLabel(status),
        value: count,
        status,
      }))
      .sort((a, b) => b.value - a.value);
  }, [queueData]);

  // Top products by revenue
  const topProducts = useMemo(() => {
    if (!paymentsData) return [];
    
    const productRevenue: Record<string, { name: string; revenue: number; count: number }> = {};
    
    paymentsData.forEach(payment => {
      const productName = (payment.order as { product?: { name?: string } })?.product?.name || "Без продукта";
      if (!productRevenue[productName]) {
        productRevenue[productName] = { name: productName, revenue: 0, count: 0 };
      }
      productRevenue[productName].revenue += payment.amount || 0;
      productRevenue[productName].count += 1;
    });
    
    return Object.values(productRevenue)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [paymentsData]);

  // Summary stats
  const stats = useMemo(() => {
    if (!queueData) return null;
    
    const totalAmount = queueData
      .filter(item => 
        item.status === "processed" || 
        (item.raw_payload as Record<string, unknown>)?.status_normalized === "successful"
      )
      .reduce((sum, item) => sum + (item.amount || 0), 0);
    
    const totalTransactions = queueData.length;
    const successful = queueData.filter(item => 
      item.status === "processed" || 
      (item.raw_payload as Record<string, unknown>)?.status_normalized === "successful"
    ).length;
    const failed = queueData.filter(item => 
      item.status === "error" || item.status === "failed"
    ).length;
    const pending = queueData.filter(item => item.status === "pending").length;
    const matched = queueData.filter(item => item.matched_profile_id).length;
    
    // Calculate trends (compare with previous period)
    const periodDays = dailyData.length || 1;
    const halfPoint = Math.floor(dailyData.length / 2);
    const firstHalf = dailyData.slice(0, halfPoint);
    const secondHalf = dailyData.slice(halfPoint);
    
    const firstHalfRevenue = firstHalf.reduce((sum, d) => sum + d.revenue, 0);
    const secondHalfRevenue = secondHalf.reduce((sum, d) => sum + d.revenue, 0);
    const revenueTrend = firstHalfRevenue > 0 
      ? ((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue * 100).toFixed(1)
      : 0;
    
    return {
      totalAmount,
      totalTransactions,
      successful,
      failed,
      pending,
      matched,
      successRate: totalTransactions > 0 ? (successful / totalTransactions * 100).toFixed(1) : 0,
      matchRate: totalTransactions > 0 ? (matched / totalTransactions * 100).toFixed(1) : 0,
      revenueTrend: Number(revenueTrend),
    };
  }, [queueData, dailyData]);

  function getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      processed: "Обработано",
      pending: "В ожидании",
      error: "Ошибка",
      failed: "Провалено",
      skipped: "Пропущено",
      unknown: "Неизвестно",
    };
    return labels[status] || status;
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("ru-BY", {
      style: "currency",
      currency: "BYN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  if (!stats) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Загрузка аналитики...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Выручка
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalAmount)}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {stats.revenueTrend >= 0 ? (
                <ArrowUpRight className="h-3 w-3 text-green-500" />
              ) : (
                <ArrowDownRight className="h-3 w-3 text-red-500" />
              )}
              <span className={stats.revenueTrend >= 0 ? "text-green-600" : "text-red-600"}>
                {stats.revenueTrend >= 0 ? "+" : ""}{stats.revenueTrend}%
              </span>
              <span>к предыдущему периоду</span>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              Транзакции
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalTransactions}</div>
            <p className="text-xs text-muted-foreground">
              Успешных: {stats.successful} ({stats.successRate}%)
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Сопоставлено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.matched}</div>
            <p className="text-xs text-muted-foreground">
              {stats.matchRate}% с контактами
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Требуют внимания
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.pending + stats.failed}</div>
            <p className="text-xs text-muted-foreground">
              Ожидает: {stats.pending} | Ошибок: {stats.failed}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Daily Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Выручка по дням
            </CardTitle>
            <CardDescription>
              Динамика поступлений за выбранный период
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dailyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={dailyData}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `${value}`}
                    className="text-muted-foreground"
                  />
                  <Tooltip 
                    formatter={(value: number) => [formatCurrency(value), "Выручка"]}
                    labelFormatter={(label) => `Дата: ${label}`}
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="hsl(var(--primary))" 
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                Нет данных за выбранный период
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Воронка статусов
            </CardTitle>
            <CardDescription>
              Распределение транзакций по статусам
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statusFunnel.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusFunnel}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {statusFunnel.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={STATUS_COLORS[entry.status as keyof typeof STATUS_COLORS] || COLORS[index % COLORS.length]} 
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [value, "Транзакций"]}
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                Нет данных
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily Transactions Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Транзакции по дням
          </CardTitle>
          <CardDescription>
            Количество успешных, ошибочных и ожидающих транзакций
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                />
                <YAxis 
                  tick={{ fontSize: 12 }}
                  className="text-muted-foreground"
                />
                <Tooltip
                  contentStyle={{ 
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
                <Bar dataKey="successful" name="Успешные" stackId="a" fill="hsl(142 76% 36%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="pending" name="Ожидание" stackId="a" fill="hsl(43 96% 56%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" name="Ошибки" stackId="a" fill="hsl(0 84% 60%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              Нет данных за выбранный период
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Products */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Топ-5 продуктов по выручке
          </CardTitle>
          <CardDescription>
            Продукты с наибольшим количеством платежей
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topProducts.length > 0 ? (
            <div className="space-y-4">
              {topProducts.map((product, index) => (
                <div key={product.name} className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-sm">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{product.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {product.count} платежей
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold">{formatCurrency(product.revenue)}</div>
                    <div className="text-xs text-muted-foreground">
                      ~{formatCurrency(product.revenue / product.count)} / платёж
                    </div>
                  </div>
                  <div className="w-24">
                    <div 
                      className="h-2 rounded-full bg-primary"
                      style={{ 
                        width: `${(product.revenue / topProducts[0].revenue) * 100}%` 
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Нет данных о продуктах
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
