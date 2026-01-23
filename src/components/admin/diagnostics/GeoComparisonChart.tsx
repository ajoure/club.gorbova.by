import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { DiagnosticsStats } from "@/hooks/usePaymentDiagnostics";

interface GeoComparisonChartProps {
  stats: DiagnosticsStats;
  rawData?: any[];
  isLoading?: boolean;
}

export function GeoComparisonChart({ stats, rawData, isLoading }: GeoComparisonChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">BY vs Другие страны</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] animate-pulse bg-muted rounded" />
      </Card>
    );
  }

  // Calculate BY vs non-BY breakdown
  const byItems = rawData?.filter(
    (item) =>
      item.customer_country === "BY" ||
      item.card_bank_country === "BY" ||
      item.client_geo_country === "BY"
  ) || [];

  const nonByItems = rawData?.filter(
    (item) =>
      item.customer_country !== "BY" &&
      item.card_bank_country !== "BY" &&
      item.client_geo_country !== "BY"
  ) || [];

  const bySuccessful = byItems.filter(
    (item) => item.status_normalized === "successful" || item.status === "successful"
  ).length;

  const nonBySuccessful = nonByItems.filter(
    (item) => item.status_normalized === "successful" || item.status === "successful"
  ).length;

  const chartData = [
    {
      name: "Беларусь",
      total: byItems.length,
      successful: bySuccessful,
      failed: byItems.length - bySuccessful,
      approvalRate: byItems.length > 0 ? ((bySuccessful / byItems.length) * 100).toFixed(1) : "0",
    },
    {
      name: "Другие страны",
      total: nonByItems.length,
      successful: nonBySuccessful,
      failed: nonByItems.length - nonBySuccessful,
      approvalRate: nonByItems.length > 0 ? ((nonBySuccessful / nonByItems.length) * 100).toFixed(1) : "0",
    },
  ];

  if (chartData[0].total === 0 && chartData[1].total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">BY vs Другие страны</CardTitle>
        </CardHeader>
        <CardContent className="h-[300px] flex items-center justify-center text-muted-foreground">
          Нет данных о географии
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">BY vs Другие страны</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" className="text-xs" />
            <YAxis className="text-xs" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const item = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-3 text-sm">
                    <p className="font-medium">{item.name}</p>
                    <div className="mt-2 space-y-1">
                      <p>Всего: <span className="font-medium">{item.total}</span></p>
                      <p className="text-green-600">Успешно: {item.successful}</p>
                      <p className="text-red-500">Отказов: {item.failed}</p>
                      <p>Approval Rate: <span className="font-medium">{item.approvalRate}%</span></p>
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="successful" stackId="a" fill="hsl(var(--chart-2))" name="Успешно" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" stackId="a" fill="hsl(var(--destructive))" name="Отказано" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
