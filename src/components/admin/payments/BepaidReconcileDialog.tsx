import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, AlertTriangle, CheckCircle, Download, Search, XCircle } from 'lucide-react';
import { format } from 'date-fns';

interface Discrepancy {
  payment_id: string;
  provider_payment_id: string | null;
  order_id: string | null;
  our_amount: number;
  bepaid_amount: number;
  transaction_type: string;
  status: string;
  paid_at: string;
  customer_email: string | null;
}

interface NotFoundDetail {
  payment_id: string;
  provider_payment_id: string;
  endpoints_tried: string[];
  last_http_status: number;
}

interface ReconcileResult {
  success: boolean;
  dry_run: boolean;
  checked: number;
  discrepancies_found: number;
  fixed: number;
  skipped: number;
  not_found: number;
  errors: number;
  discrepancies: Discrepancy[];
  not_found_details: NotFoundDetail[];
  error_details: Array<{ payment_id: string; error: string }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BepaidReconcileDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState('2026-01-01');
  const [toDate, setToDate] = useState('2026-12-31');
  const [filterAmount1, setFilterAmount1] = useState(true);
  const [batchSize, setBatchSize] = useState(200);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ReconcileResult | null>(null);

  const runReconcile = async (dryRun: boolean) => {
    setIsRunning(true);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Требуется авторизация');
        return;
      }

      const response = await supabase.functions.invoke('admin-bepaid-reconcile-amounts', {
        body: {
          from_date: fromDate,
          to_date: toDate,
          dry_run: dryRun,
          filter_only_amount_1: filterAmount1,
          batch_size: batchSize,
          max_payments_to_check: batchSize,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      setResult(response.data as ReconcileResult);

      if (response.data.success) {
        if (dryRun) {
          const notFoundMsg = response.data.not_found > 0 ? `, не найдено в API: ${response.data.not_found}` : '';
          toast.info(`Проверено ${response.data.checked} платежей, найдено ${response.data.discrepancies_found} расхождений${notFoundMsg}`);
        } else {
          toast.success(`Исправлено ${response.data.fixed} платежей`);
          queryClient.invalidateQueries({ queryKey: ['payments'] });
        }
      }
    } catch (error) {
      console.error('Reconcile error:', error);
      toast.error(error instanceof Error ? error.message : 'Ошибка сверки');
    } finally {
      setIsRunning(false);
    }
  };

  const exportCSV = () => {
    if (!result?.discrepancies.length) return;

    const headers = ['payment_id', 'bepaid_uid', 'order_id', 'our_amount', 'bepaid_amount', 'diff', 'type', 'status', 'paid_at', 'email'];
    const rows = result.discrepancies.map(d => [
      d.payment_id,
      d.provider_payment_id || '',
      d.order_id || '',
      d.our_amount.toFixed(2),
      d.bepaid_amount.toFixed(2),
      (d.bepaid_amount - d.our_amount).toFixed(2),
      d.transaction_type,
      d.status,
      d.paid_at,
      d.customer_email || '',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconcile-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Сверка сумм с bePaid API</DialogTitle>
          <DialogDescription>
            Проверяет суммы платежей в базе и исправляет расхождения с данными bePaid
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="from">Дата с</Label>
              <Input
                id="from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                disabled={isRunning}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">Дата по</Label>
              <Input
                id="to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                disabled={isRunning}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="filter1"
                checked={filterAmount1}
                onCheckedChange={(c) => setFilterAmount1(!!c)}
                disabled={isRunning}
              />
              <Label htmlFor="filter1" className="text-sm">Только платежи с суммой 1 BYN</Label>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="batch" className="text-sm whitespace-nowrap">Лимит:</Label>
              <Input
                id="batch"
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                disabled={isRunning}
                className="w-20"
              />
            </div>
          </div>
        </div>

        {result && (
          <div className="space-y-4 flex-1 min-h-0">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline">Проверено: {result.checked}</Badge>
              
              {result.discrepancies_found > 0 ? (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Расхождений: {result.discrepancies_found}
                </Badge>
              ) : (
                <Badge variant="default" className="flex items-center gap-1 bg-green-600">
                  <CheckCircle className="h-3 w-3" />
                  Расхождений нет
                </Badge>
              )}
              
              {result.fixed > 0 && (
                <Badge variant="default" className="bg-blue-600">
                  Исправлено: {result.fixed}
                </Badge>
              )}
              
              {result.skipped > 0 && (
                <Badge variant="secondary">Без UID: {result.skipped}</Badge>
              )}
              
              {result.not_found > 0 && (
                <Badge variant="outline" className="border-orange-500 text-orange-600 flex items-center gap-1">
                  <Search className="h-3 w-3" />
                  Не найдено в API: {result.not_found}
                </Badge>
              )}
              
              {result.errors > 0 && (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  Ошибок: {result.errors}
                </Badge>
              )}
            </div>

            <Tabs defaultValue="discrepancies" className="flex-1 min-h-0">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="discrepancies">
                  Расхождения ({result.discrepancies.length})
                </TabsTrigger>
                <TabsTrigger value="not_found">
                  Не найдено ({result.not_found_details.length})
                </TabsTrigger>
                <TabsTrigger value="errors">
                  Ошибки ({result.error_details.length})
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="discrepancies" className="mt-2">
                {result.discrepancies.length > 0 ? (
                  <ScrollArea className="h-[280px] border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="p-2 text-left">Платёж</th>
                          <th className="p-2 text-right">У нас</th>
                          <th className="p-2 text-right">bePaid</th>
                          <th className="p-2 text-right">Разница</th>
                          <th className="p-2 text-left">Тип</th>
                          <th className="p-2 text-left">Дата</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.discrepancies.map((d, i) => (
                          <tr key={i} className="border-t hover:bg-muted/50">
                            <td className="p-2">
                              <div className="font-mono text-xs truncate max-w-[150px]" title={d.provider_payment_id || ''}>
                                {d.provider_payment_id?.slice(0, 12)}...
                              </div>
                              {d.customer_email && (
                                <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                                  {d.customer_email}
                                </div>
                              )}
                            </td>
                            <td className="p-2 text-right font-mono text-destructive">
                              {d.our_amount.toFixed(2)}
                            </td>
                            <td className="p-2 text-right font-mono text-green-600">
                              {d.bepaid_amount.toFixed(2)}
                            </td>
                            <td className="p-2 text-right font-mono font-bold">
                              +{(d.bepaid_amount - d.our_amount).toFixed(2)}
                            </td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-xs">
                                {d.transaction_type}
                              </Badge>
                            </td>
                            <td className="p-2 text-xs text-muted-foreground">
                              {format(new Date(d.paid_at), 'dd.MM.yy HH:mm')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                    Расхождений не найдено
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="not_found" className="mt-2">
                {result.not_found_details.length > 0 ? (
                  <ScrollArea className="h-[280px] border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="p-2 text-left">Payment ID</th>
                          <th className="p-2 text-left">bePaid UID</th>
                          <th className="p-2 text-left">Endpoints</th>
                          <th className="p-2 text-right">HTTP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.not_found_details.map((d, i) => (
                          <tr key={i} className="border-t hover:bg-muted/50">
                            <td className="p-2 font-mono text-xs truncate max-w-[120px]" title={d.payment_id}>
                              {d.payment_id.slice(0, 8)}...
                            </td>
                            <td className="p-2 font-mono text-xs truncate max-w-[150px]" title={d.provider_payment_id}>
                              {d.provider_payment_id.slice(0, 12)}...
                            </td>
                            <td className="p-2 text-xs text-muted-foreground">
                              {d.endpoints_tried.length} tried
                            </td>
                            <td className="p-2 text-right">
                              <Badge variant="outline" className="text-xs">
                                {d.last_http_status || '?'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                    Все транзакции найдены в bePaid API
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="errors" className="mt-2">
                {result.error_details.length > 0 ? (
                  <ScrollArea className="h-[280px] border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="p-2 text-left">Payment ID</th>
                          <th className="p-2 text-left">Ошибка</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.error_details.map((d, i) => (
                          <tr key={i} className="border-t hover:bg-muted/50">
                            <td className="p-2 font-mono text-xs truncate max-w-[150px]" title={d.payment_id}>
                              {d.payment_id.slice(0, 8)}...
                            </td>
                            <td className="p-2 text-xs text-destructive">
                              {d.error}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                ) : (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                    Ошибок нет
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {result?.discrepancies.length ? (
            <Button variant="outline" onClick={exportCSV} disabled={isRunning}>
              <Download className="h-4 w-4 mr-2" />
              Экспорт CSV
            </Button>
          ) : null}

          <Button
            variant="outline"
            onClick={() => runReconcile(true)}
            disabled={isRunning}
          >
            {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Проверить (dry-run)
          </Button>

          <Button
            onClick={() => runReconcile(false)}
            disabled={isRunning || !result?.discrepancies_found}
            variant="destructive"
          >
            {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Исправить ({result?.discrepancies_found || 0})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
