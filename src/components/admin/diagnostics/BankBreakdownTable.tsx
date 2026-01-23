import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { BankBreakdown } from "@/hooks/usePaymentDiagnostics";

interface BankBreakdownTableProps {
  data: BankBreakdown[];
  isLoading?: boolean;
}

export function BankBreakdownTable({ data, isLoading }: BankBreakdownTableProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Детализация по банкам</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Детализация по банкам</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground py-8">
          Нет данных о банках
        </CardContent>
      </Card>
    );
  }

  const getApprovalBadge = (rate: number) => {
    if (rate >= 90) return <Badge variant="default" className="bg-green-500">Отлично</Badge>;
    if (rate >= 80) return <Badge variant="secondary">Хорошо</Badge>;
    if (rate >= 70) return <Badge variant="outline">Средне</Badge>;
    return <Badge variant="destructive">Проблема</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Детализация по банкам</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Банк</TableHead>
                <TableHead className="text-center">Страна</TableHead>
                <TableHead className="text-center">Всего</TableHead>
                <TableHead className="text-center">Успешно</TableHead>
                <TableHead className="text-center">Отказов</TableHead>
                <TableHead className="text-center">3DS %</TableHead>
                <TableHead className="text-center">Approval</TableHead>
                <TableHead className="w-[150px]">Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((bank, index) => {
                const needs3dsPercent = bank.failed > 0 ? (bank.needs3ds / bank.failed) * 100 : 0;
                
                return (
                  <TableRow key={index}>
                    <TableCell className="font-medium max-w-[200px] truncate" title={bank.bank}>
                      {bank.bank || "Unknown"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{bank.country || "??"}</Badge>
                    </TableCell>
                    <TableCell className="text-center">{bank.total}</TableCell>
                    <TableCell className="text-center text-green-600">{bank.successful}</TableCell>
                    <TableCell className="text-center text-red-500">{bank.failed}</TableCell>
                    <TableCell className="text-center">
                      {needs3dsPercent > 0 ? (
                        <span className="text-amber-600">{needs3dsPercent.toFixed(0)}%</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center gap-2">
                        <Progress
                          value={bank.approvalRate}
                          className="h-2 w-16"
                        />
                        <span className="text-sm font-medium">{bank.approvalRate.toFixed(1)}%</span>
                      </div>
                    </TableCell>
                    <TableCell>{getApprovalBadge(bank.approvalRate)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
