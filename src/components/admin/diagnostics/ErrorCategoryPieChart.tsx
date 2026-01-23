import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import type { ErrorBreakdown } from "@/hooks/usePaymentDiagnostics";

interface ErrorCategoryPieChartProps {
  data: ErrorBreakdown[];
  isLoading?: boolean;
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(210, 40%, 60%)",
  "hsl(270, 40%, 60%)",
  "hsl(330, 40%, 60%)",
];

export function ErrorCategoryPieChart({ data, isLoading }: ErrorCategoryPieChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Распределение ошибок</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] animate-pulse bg-muted rounded" />
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Распределение ошибок</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
          Нет данных об ошибках
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((item) => ({
    name: item.label,
    value: item.count,
    percentage: item.percentage,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Распределение ошибок</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
              nameKey="name"
              label={({ name, percentage }) =>
                percentage > 5 ? `${name} (${percentage.toFixed(0)}%)` : ""
              }
              labelLine={false}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-muted-foreground">
                      {item.value} ({item.percentage.toFixed(1)}%)
                    </p>
                  </div>
                );
              }}
            />
            <Legend
              layout="vertical"
              align="right"
              verticalAlign="middle"
              wrapperStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
