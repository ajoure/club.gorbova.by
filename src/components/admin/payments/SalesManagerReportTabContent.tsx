import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { ru } from "date-fns/locale";
import { toZonedTime } from "date-fns-tz";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { supabase } from "@/integrations/supabase/client";

type SalesReportRow = {
  month_start: string;
  responsible_user_id: string | null;
  responsible_name: string;
  product_id: string | null;
  product_name: string;
  tariff_id: string | null;
  tariff_name: string;
  currency: string;
  paid_deals: number;
  payment_count: number;
  gross_amount: number;
  refund_amount: number;
  net_amount: number;
  average_payment: number;
  installment_received: number;
  installment_expected: number;
};

const money = (value: number, currency: string) =>
  `${Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;

export function SalesManagerReportTabContent() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canViewAll = hasPermission("sales_reports.view_all");
  const canViewOwn = hasPermission("sales_reports.view_own");
  const nowMinsk = toZonedTime(new Date(), "Europe/Minsk");
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(nowMinsk), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(endOfMonth(nowMinsk), "yyyy-MM-dd"));
  const [manager, setManager] = useState("all");
  const [product, setProduct] = useState("all");
  const [tariff, setTariff] = useState("all");
  const { data: staff = [] } = useStaffOptions(canViewAll);
  const { data: products = [] } = useProductsV2();
  const { data: tariffs = [] } = useTariffs(product === "all" ? undefined : product);

  useEffect(() => {
    setTariff("all");
  }, [product]);

  const report = useQuery({
    queryKey: ["sales-manager-report-v1", dateFrom, dateTo, manager, product, tariff],
    enabled: canViewAll || canViewOwn,
    queryFn: async (): Promise<SalesReportRow[]> => {
      const { data, error } = await supabase.rpc("sales_manager_report_v1", {
        p_from: dateFrom,
        p_to: dateTo,
        ...(manager !== "all" && manager !== "__unassigned__"
          ? { p_responsible_user_id: manager }
          : {}),
        p_unassigned_only: manager === "__unassigned__",
        ...(product !== "all" ? { p_product_id: product } : {}),
        ...(tariff !== "all" ? { p_tariff_id: tariff } : {}),
      });
      if (error) throw error;
      return (data || []) as SalesReportRow[];
    },
  });

  const currencyTotals = useMemo(() => {
    const totals = new Map<string, {
      gross: number;
      refunds: number;
      net: number;
      received: number;
      expected: number;
    }>();
    for (const row of report.data || []) {
      const current = totals.get(row.currency) || {
        gross: 0,
        refunds: 0,
        net: 0,
        received: 0,
        expected: 0,
      };
      current.gross += Number(row.gross_amount || 0);
      current.refunds += Number(row.refund_amount || 0);
      current.net += Number(row.net_amount || 0);
      current.received += Number(row.installment_received || 0);
      current.expected += Number(row.installment_expected || 0);
      totals.set(row.currency, current);
    }
    return Array.from(totals.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [report.data]);

  if (permissionsLoading) {
    return <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  if (!canViewAll && !canViewOwn) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4" />
        Нет разрешения на просмотр отчёта по продажам.
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1">
          <Label className="text-xs">Оплата от</Label>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Оплата до</Label>
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </div>
        {canViewAll && (
          <div className="space-y-1">
            <Label className="text-xs">Менеджер продажи</Label>
            <Select value={manager} onValueChange={setManager}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все менеджеры</SelectItem>
                <SelectItem value="__unassigned__">Без менеджера</SelectItem>
                {staff.map((item) => (
                  <SelectItem key={item.user_id} value={item.user_id}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Продукт</Label>
          <Select value={product} onValueChange={setProduct}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все продукты</SelectItem>
              {products.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Тариф</Label>
          <Select value={tariff} onValueChange={setTariff}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все тарифы</SelectItem>
              {tariffs.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button variant="outline" className="w-full gap-2" onClick={() => report.refetch()} disabled={report.isFetching}>
            {report.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Месяц определяется по <code>paid_at</code> в Europe/Minsk. Валюты не конвертируются и не складываются между собой.
      </p>

      {report.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Не удалось построить отчёт: {(report.error as Error).message}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {currencyTotals.map(([currency, total]) => (
          <div key={currency} className="rounded-xl border bg-card p-4">
            <div className="mb-2 text-sm font-semibold">{currency}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">Валовая сумма</span><span className="text-right font-medium">{money(total.gross, currency)}</span>
              <span className="text-muted-foreground">Возвраты</span><span className="text-right font-medium text-rose-600">{money(total.refunds, currency)}</span>
              <span className="text-muted-foreground">Чистая сумма</span><span className="text-right font-semibold">{money(total.net, currency)}</span>
              <span className="text-muted-foreground">Рассрочки получено</span><span className="text-right">{money(total.received, currency)}</span>
              <span className="text-muted-foreground">Рассрочки ожидается</span><span className="text-right">{money(total.expected, currency)}</span>
            </div>
          </div>
        ))}
      </div>

      {!report.isLoading && (report.data || []).length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          За выбранный период данных нет.
        </div>
      ) : (
        <div className="table-scroll-x rounded-xl border">
          <Table className="min-w-[1420px]">
            <TableHeader>
              <TableRow>
                <TableHead>Месяц</TableHead>
                <TableHead>Менеджер продажи</TableHead>
                <TableHead>Продукт</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead>Валюта</TableHead>
                <TableHead className="text-right">Сделки</TableHead>
                <TableHead className="text-right">Платежи</TableHead>
                <TableHead className="text-right">Валовая сумма</TableHead>
                <TableHead className="text-right">Возвраты</TableHead>
                <TableHead className="text-right">Чистая сумма</TableHead>
                <TableHead className="text-right">Средний платёж</TableHead>
                <TableHead className="text-right">Рассрочки получено</TableHead>
                <TableHead className="text-right">Рассрочки ожидается</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report.data || []).map((row) => (
                <TableRow key={[
                  row.month_start,
                  row.responsible_user_id || "unassigned",
                  row.product_id || "no-product",
                  row.tariff_id || "no-tariff",
                  row.currency,
                ].join(":")}>
                  <TableCell>{format(parseISO(row.month_start), "LLLL yyyy", { locale: ru })}</TableCell>
                  <TableCell className="font-medium">{row.responsible_name}</TableCell>
                  <TableCell>{row.product_name}</TableCell>
                  <TableCell>{row.tariff_name}</TableCell>
                  <TableCell>{row.currency}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.paid_deals}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.payment_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.gross_amount, row.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-rose-600">{money(row.refund_amount, row.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{money(row.net_amount, row.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.average_payment, row.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.installment_received, row.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.installment_expected, row.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
