import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { BankBreakdown } from "@/hooks/usePaymentDiagnostics";

interface BankDeclineChartProps {
  data: BankBreakdown[];
  isLoading?: boolean;
}

export function BankDeclineChart({ data, isLoading }: BankDeclineChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Топ банков по отказам</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] animate-pulse bg-muted rounded" />
      </Card>
    );
  }

  // Take top 10 banks with most failures
  const chartData = data
    .filter((b) => b.failed > 0)
    .slice(0, 10)
    .map((b) => ({
      name: b.bank?.length > 20 ? b.bank.slice(0, 17) + "..." : b.bank,
      fullName: b.bank,
      country: b.country,
      failed: b.failed,
      needs3ds: b.needs3ds,
      approvalRate: b.approvalRate,
      total: b.total,
    }));

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Топ банков по отказам</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
          Нет данных об отказах
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Топ банков по отказам</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" className="text-xs" />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              className="text-xs"
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
                    <p className="font-medium">{item.fullName}</p>
                    <p className="text-muted-foreground">Страна: {item.country}</p>
                    <div className="mt-2 space-y-1">
                      <p>Отказов: <span className="font-medium text-red-500">{item.failed}</span></p>
                      <p>Из них 3DS: <span className="font-medium text-amber-500">{item.needs3ds}</span></p>
                      <p>Всего: {item.total}</p>
                      <p>Approval: <span className="font-medium">{item.approvalRate.toFixed(1)}%</span></p>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="failed" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.needs3ds > entry.failed * 0.3 ? "hsl(var(--warning))" : "hsl(var(--destructive))"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
