import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Bug, Copy, Database, Table2, Filter, Calendar, 
  CheckCircle2, AlertTriangle, Info, Layers, Clock
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DataTraceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateFrom: string;
  dateTo: string;
  uiRowsShown: number;
  activeFilters: Record<string, string>;
  mode: 'canon' | 'unified';
}

interface TraceData {
  payments_v2_rows: number;
  payments_v2_unique_uid: number;
  queue_rows: number;
  queue_unique_uid: number;
  queue_only_rows: number;
  queue_only_unique_uid: number;
  legacy_rows: number;
  loading: boolean;
}

// Data sources documentation
const DATA_SOURCES = [
  {
    id: 'canon',
    name: 'CANON: payments_v2',
    description: 'Основная таблица платежей. Истина для отчётности и сверки.',
    table: 'payments_v2',
    icon: Database,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
  },
  {
    id: 'staging',
    name: 'STAGING: payment_reconcile_queue',
    description: 'Временная очередь. Записи ожидают материализации в CANON.',
    table: 'payment_reconcile_queue',
    icon: Layers,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
  },
  {
    id: 'legacy',
    name: 'LEGACY: payments',
    description: 'Устаревшая таблица. Не используется в текущем UI.',
    table: 'payments',
    icon: Clock,
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
    deprecated: true,
  },
];

const HOOKS_USED = [
  {
    name: 'useUnifiedPayments',
    file: 'src/hooks/useUnifiedPayments.tsx',
    description: 'Объединяет payments_v2 + queue (anti-join по UID)',
    tables: ['payments_v2', 'payment_reconcile_queue'],
    filters: [
      'provider = "bepaid"',
      'origin IN ("bepaid", "import") — если включён import toggle',
      'paid_at >= fromDate AND paid_at <= toDate',
      'bepaid_uid IS NOT NULL — для queue',
    ],
    dedupKey: '{provider}:{provider_payment_id}',
  },
];

export default function DataTraceModal({
  open,
  onOpenChange,
  dateFrom,
  dateTo,
  uiRowsShown,
  activeFilters,
  mode,
}: DataTraceModalProps) {
  const { toast } = useToast();
  const [trace, setTrace] = useState<TraceData>({
    payments_v2_rows: 0,
    payments_v2_unique_uid: 0,
    queue_rows: 0,
    queue_unique_uid: 0,
    queue_only_rows: 0,
    queue_only_unique_uid: 0,
    legacy_rows: 0,
    loading: true,
  });

  useEffect(() => {
    if (!open) return;

    const fetchCounts = async () => {
      setTrace(prev => ({ ...prev, loading: true }));

      const fromDateUtc = `${dateFrom}T00:00:00Z`;
      const toDateUtc = `${dateTo}T23:59:59Z`;

      try {
        // Fetch payments_v2 count
        const { count: p2Count } = await supabase
          .from('payments_v2')
          .select('id', { count: 'exact', head: true })
          .eq('provider', 'bepaid')
          .in('origin', ['bepaid', 'import'])
          .gte('paid_at', fromDateUtc)
          .lte('paid_at', toDateUtc);

        // Fetch payments_v2 unique UIDs
        const { data: p2Uids } = await supabase
          .from('payments_v2')
          .select('provider_payment_id')
          .eq('provider', 'bepaid')
          .in('origin', ['bepaid', 'import'])
          .not('provider_payment_id', 'is', null)
          .gte('paid_at', fromDateUtc)
          .lte('paid_at', toDateUtc);

        const p2UidSet = new Set((p2Uids || []).map(r => r.provider_payment_id));

        // Fetch queue count
        const { count: qCount } = await supabase
          .from('payment_reconcile_queue')
          .select('id', { count: 'exact', head: true })
          .not('bepaid_uid', 'is', null)
          .gte('paid_at', fromDateUtc)
          .lte('paid_at', toDateUtc);

        // Fetch queue unique UIDs
        const { data: qUids } = await supabase
          .from('payment_reconcile_queue')
          .select('bepaid_uid')
          .not('bepaid_uid', 'is', null)
          .gte('paid_at', fromDateUtc)
          .lte('paid_at', toDateUtc);

        const qUidSet = new Set((qUids || []).map(r => r.bepaid_uid));

        // Calculate queue-only (anti-join)
        const queueOnlyUids = [...qUidSet].filter(uid => !p2UidSet.has(uid));

        setTrace({
          payments_v2_rows: p2Count || 0,
          payments_v2_unique_uid: p2UidSet.size,
          queue_rows: qCount || 0,
          queue_unique_uid: qUidSet.size,
          queue_only_rows: queueOnlyUids.length,
          queue_only_unique_uid: queueOnlyUids.length,
          legacy_rows: 0, // Not used
          loading: false,
        });

        // Log audit
        await supabase.from('audit_logs').insert({
          action: 'payments.trace_viewed',
          actor_type: 'system',
          actor_user_id: null,
          actor_label: 'DataTraceModal',
          meta: {
            date_from: dateFrom,
            date_to: dateTo,
            payments_v2_count: p2Count,
            queue_count: qCount,
            queue_only_count: queueOnlyUids.length,
          },
        });
      } catch (err) {
        console.error('Trace fetch error:', err);
        setTrace(prev => ({ ...prev, loading: false }));
      }
    };

    fetchCounts();
  }, [open, dateFrom, dateTo]);

  const copyTraceJson = () => {
    const json = JSON.stringify({
      timestamp: new Date().toISOString(),
      date_range: { from: dateFrom, to: dateTo },
      mode,
      counts: {
        payments_v2_rows: trace.payments_v2_rows,
        payments_v2_unique_uid: trace.payments_v2_unique_uid,
        queue_rows: trace.queue_rows,
        queue_unique_uid: trace.queue_unique_uid,
        queue_only_unique_uid: trace.queue_only_unique_uid,
      },
      ui_rows_shown: uiRowsShown,
      active_filters: activeFilters,
      formula: mode === 'canon' 
        ? 'UI_total = payments_v2_rows (filtered)'
        : 'UI_total = payments_v2_rows + queue_only_rows (anti-join)',
    }, null, 2);

    navigator.clipboard.writeText(json).then(() => {
      toast({ title: "Скопировано", description: "Trace JSON скопирован в буфер" });
    });
  };

  const unifiedTotal = trace.payments_v2_unique_uid + trace.queue_only_unique_uid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col bg-slate-900/95 backdrop-blur-xl border-slate-700/50">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Bug className="h-5 w-5 text-purple-400" />
            Data Trace — Источники данных
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6 py-4">
            {/* Current Mode Banner */}
            <div className={`p-4 rounded-lg border ${mode === 'canon' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
              <div className="flex items-center gap-3">
                {mode === 'canon' ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                )}
                <div>
                  <div className={`font-semibold ${mode === 'canon' ? 'text-emerald-300' : 'text-amber-300'}`}>
                    TABLE SOURCE MODE: {mode === 'canon' ? 'canon-only' : 'unified'}
                  </div>
                  <div className="text-sm text-slate-400 mt-0.5">
                    {mode === 'canon' 
                      ? 'Показываются только записи из payments_v2 (CANON)'
                      : 'Показываются payments_v2 + queue (без дублей по UID)'}
                  </div>
                </div>
              </div>
            </div>

            {/* Counters Grid */}
            <div className="grid grid-cols-2 gap-3">
              <CounterCard
                label="payments_v2 rows"
                value={trace.payments_v2_rows}
                subLabel={`${trace.payments_v2_unique_uid} unique UID`}
                color="emerald"
                loading={trace.loading}
              />
              <CounterCard
                label="queue rows"
                value={trace.queue_rows}
                subLabel={`${trace.queue_unique_uid} unique UID`}
                color="amber"
                loading={trace.loading}
              />
              <CounterCard
                label="queue_only (anti-join)"
                value={trace.queue_only_unique_uid}
                subLabel="UIDs не в payments_v2"
                color="rose"
                loading={trace.loading}
              />
              <CounterCard
                label="unified_total"
                value={unifiedTotal}
                subLabel="payments_v2 ∪ queue_only"
                color="purple"
                loading={trace.loading}
              />
            </div>

            {/* UI Shown */}
            <div className="p-4 rounded-lg border border-slate-700/50 bg-slate-800/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-300">UI_rows_shown (после фильтров)</div>
                  <div className="text-2xl font-bold text-slate-100 tabular-nums">{uiRowsShown}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500 mb-1">Формула</div>
                  <code className="text-xs text-purple-300 bg-purple-500/10 px-2 py-1 rounded">
                    {mode === 'canon' 
                      ? 'payments_v2 (filtered)'
                      : 'p2 + queue_only (filtered)'}
                  </code>
                </div>
              </div>
            </div>

            {/* Active Filters */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Filter className="h-4 w-4" />
                Активные фильтры
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="border-slate-600 text-slate-300">
                  <Calendar className="h-3 w-3 mr-1" />
                  {dateFrom} — {dateTo}
                </Badge>
                {Object.entries(activeFilters)
                  .filter(([, v]) => v !== 'all' && v !== '')
                  .map(([key, value]) => (
                    <Badge key={key} variant="outline" className="border-slate-600 text-slate-300">
                      {key}: {value}
                    </Badge>
                  ))}
              </div>
            </div>

            {/* Data Sources */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Database className="h-4 w-4" />
                Источники данных
              </div>
              <div className="space-y-2">
                {DATA_SOURCES.map((src) => (
                  <div 
                    key={src.id}
                    className={`p-3 rounded-lg border border-slate-700/50 ${src.bgColor} ${src.deprecated ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <src.icon className={`h-5 w-5 ${src.color} mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium text-sm ${src.color}`}>{src.name}</span>
                          {src.deprecated && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">deprecated</Badge>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">{src.description}</div>
                        <code className="text-[10px] text-slate-500 font-mono">{src.table}</code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hooks Used */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Table2 className="h-4 w-4" />
                Хуки/запросы страницы
              </div>
              {HOOKS_USED.map((hook) => (
                <div key={hook.name} className="p-3 rounded-lg border border-slate-700/50 bg-slate-800/20">
                  <div className="font-medium text-sm text-sky-400">{hook.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">{hook.file}</div>
                  <div className="text-xs text-slate-400 mt-1">{hook.description}</div>
                  <div className="mt-2 space-y-1">
                    <div className="text-[10px] text-slate-500 uppercase">WHERE-условия:</div>
                    {hook.filters.map((f, i) => (
                      <code key={i} className="block text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">{f}</code>
                    ))}
                    <div className="text-[10px] text-slate-500 mt-2">
                      Dedup key: <code className="text-purple-300">{hook.dedupKey}</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="shrink-0 pt-4 border-t border-slate-700/50 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            <Info className="h-3 w-3 inline mr-1" />
            Данные актуальны на момент открытия модалки
          </div>
          <Button onClick={copyTraceJson} variant="secondary" size="sm" className="gap-2">
            <Copy className="h-3.5 w-3.5" />
            Экспорт Trace JSON
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Counter card component
function CounterCard({ 
  label, 
  value, 
  subLabel, 
  color, 
  loading 
}: { 
  label: string; 
  value: number; 
  subLabel: string; 
  color: 'emerald' | 'amber' | 'rose' | 'purple';
  loading: boolean;
}) {
  const colors = {
    emerald: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
    amber: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
    rose: 'text-rose-400 border-rose-500/30 bg-rose-500/5',
    purple: 'text-purple-400 border-purple-500/30 bg-purple-500/5',
  };

  return (
    <div className={`p-3 rounded-lg border ${colors[color]}`}>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${loading ? 'animate-pulse text-slate-500' : colors[color].split(' ')[0]}`}>
        {loading ? '...' : value.toLocaleString('ru-RU')}
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5">{subLabel}</div>
    </div>
  );
}
