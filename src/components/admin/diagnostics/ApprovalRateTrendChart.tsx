import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { DailyTrend } from "@/hooks/usePaymentDiagnostics";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

interface ApprovalRateTrendChartProps {
  data: DailyTrend[];
  isLoading?: boolean;
}

export function ApprovalRateTrendChart({ data, isLoading }: ApprovalRateTrendChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Тренд Approval Rate</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] animate-pulse bg-muted rounded" />
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Тренд Approval Rate</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
          Нет данных для отображения тренда
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((item) => ({
    ...item,
    dateLabel: format(parseISO(item.date), "dd MMM", { locale: ru }),
    approvalRate: Number(item.approvalRate.toFixed(1)),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Тренд Approval Rate</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="dateLabel" className="text-xs" tick={{ fontSize: 11 }} />
            <YAxis
              className="text-xs"
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
                    <p className="font-medium">{item.date}</p>
                    <div className="mt-2 space-y-1">
                      <p>
                        Approval Rate:{" "}
                        <span className="font-medium text-green-600">{item.approvalRate}%</span>
                      </p>
                      <p>Всего: {item.total}</p>
                      <p className="text-green-600">Успешно: {item.successful}</p>
                      <p className="text-red-500">Отказов: {item.failed}</p>
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="approvalRate"
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              name="Approval Rate %"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
