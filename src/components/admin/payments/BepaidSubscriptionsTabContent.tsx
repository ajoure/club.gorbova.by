import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  RefreshCw,
  Ban,
  Search,
  ExternalLink,
  Copy,
  Check,
  Link2,
  Link2Off,
  AlertTriangle,
  Database,
  Calendar,
  Play,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";

interface BepaidSubscription {
  id: string;
  status: string;
  plan_title: string;
  plan_amount: number;
  plan_currency: string;
  customer_email: string;
  customer_name: string;
  card_last4: string;
  card_brand: string;
  created_at: string;
  next_billing_at: string;
  linked_subscription_id: string | null;
  linked_user_id: string | null;
  linked_profile_name: string | null;
  is_orphan: boolean;
}

interface SubscriptionStats {
  total: number;
  active: number;
  trial: number;
  cancelled: number;
  orphans: number;
  linked: number;
}

interface ReconcileResult {
  success: boolean;
  dry_run: boolean;
  distinct_sbs_ids_total: number;
  missing_provider_subscriptions_count: number;
  already_present: number;
  inserted: number;
  would_insert: number;
  linked_to_subscription_v2: number;
  still_unlinked: number;
  sample_ids: string[];
}

type StatusFilter = "all" | "active" | "trial" | "cancelled" | "past_due";
type LinkFilter = "all" | "linked" | "orphan" | "urgent";
type SortField = "created_at" | "next_billing_at" | "plan_amount" | "status";
type SortDir = "asc" | "desc";

export function BepaidSubscriptionsTabContent() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("next_billing_at");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showReconcileDialog, setShowReconcileDialog] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  
  const queryClient = useQueryClient();

  // Fetch subscriptions from bePaid
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["bepaid-subscriptions-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-list-subscriptions");
      if (error) throw error;
      return data as { subscriptions: BepaidSubscription[]; stats: SubscriptionStats };
    },
    staleTime: 60000,
  });

  const subscriptions = data?.subscriptions || [];
  const stats = data?.stats || { total: 0, active: 0, trial: 0, cancelled: 0, orphans: 0, linked: 0 };

  // Calculate urgent subscriptions (next charge within 7 days)
  const urgentCount = useMemo(() => {
    return subscriptions.filter(s => {
      if (!s.next_billing_at || s.status === 'cancelled') return false;
      const daysUntil = differenceInDays(new Date(s.next_billing_at), new Date());
      return daysUntil <= 7 && daysUntil >= 0 && s.is_orphan;
    }).length;
  }, [subscriptions]);

  // Filter and sort subscriptions
  const filteredSubscriptions = useMemo(() => {
    let result = [...subscriptions];
    
    if (statusFilter !== "all") {
      result = result.filter(s => s.status === statusFilter);
    }
    
    if (linkFilter === "linked") {
      result = result.filter(s => !s.is_orphan);
    } else if (linkFilter === "orphan") {
      result = result.filter(s => s.is_orphan);
    } else if (linkFilter === "urgent") {
      result = result.filter(s => {
        if (!s.next_billing_at || s.status === 'cancelled') return false;
        const daysUntil = differenceInDays(new Date(s.next_billing_at), new Date());
        return daysUntil <= 7 && daysUntil >= 0;
      });
    }
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s => 
        s.id.toLowerCase().includes(q) ||
        s.plan_title.toLowerCase().includes(q) ||
        s.customer_email.toLowerCase().includes(q) ||
        s.customer_name.toLowerCase().includes(q) ||
        s.linked_profile_name?.toLowerCase().includes(q)
      );
    }
    
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case "created_at":
          aVal = a.created_at || "";
          bVal = b.created_at || "";
          break;
        case "next_billing_at":
          aVal = a.next_billing_at || "9999";
          bVal = b.next_billing_at || "9999";
          break;
        case "plan_amount":
          aVal = a.plan_amount;
          bVal = b.plan_amount;
          break;
        case "status":
          const order: Record<string, number> = { active: 0, trial: 1, past_due: 2, cancelled: 3 };
          aVal = order[a.status] ?? 4;
          bVal = order[b.status] ?? 4;
          break;
      }
      
      if (sortDir === "asc") {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
    
    return result;
  }, [subscriptions, statusFilter, linkFilter, searchQuery, sortField, sortDir]);

  // Reconcile mutation (dry-run)
  const reconcileMutation = useMutation({
    mutationFn: async (execute: boolean) => {
      const { data, error } = await supabase.functions.invoke("admin-reconcile-bepaid-legacy", {
        body: { dry_run: !execute, limit: 500 },
      });
      if (error) throw error;
      return data as ReconcileResult;
    },
    onSuccess: (data, execute) => {
      setReconcileResult(data);
      if (!data.dry_run) {
        toast.success(`Reconcile завершён: ${data.inserted} записей создано`);
        queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
      }
    },
    onError: (e: any) => {
      toast.error("Ошибка reconcile: " + e.message);
    },
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.functions.invoke("bepaid-cancel-subscriptions", {
        body: { subscription_ids: ids },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отменено: ${data.cancelled.length} из ${data.total_requested}`);
      if (data.failed.length > 0) {
        const failedReasons = data.failed.map((f: any) => f.error || 'unknown').join(', ');
        toast.error(`Не удалось отменить ${data.failed.length}: ${failedReasons}`);
      }
      setSelectedIds(new Set());
      setShowCancelDialog(false);
      queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions-admin"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка отмены: " + e.message);
    },
  });

  const handleSelectAll = () => {
    if (selectedIds.size === filteredSubscriptions.filter(s => s.status !== 'cancelled').length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSubscriptions.filter(s => s.status !== 'cancelled').map(s => s.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd.MM.yy HH:mm", { locale: ru });
    } catch {
      return dateStr;
    }
  };

  const getDaysUntilCharge = (dateStr: string | undefined) => {
    if (!dateStr) return null;
    try {
      const days = differenceInDays(new Date(dateStr), new Date());
      return days;
    } catch {
      return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Активна</Badge>;
      case "trial":
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Trial</Badge>;
      case "past_due":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Просрочена</Badge>;
      case "cancelled":
        return <Badge variant="secondary">Отменена</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="p-3">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Всего</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-emerald-600">{stats.active}</div>
          <div className="text-xs text-muted-foreground">Активных</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-blue-600">{stats.trial}</div>
          <div className="text-xs text-muted-foreground">Trial</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-red-600">{stats.orphans}</div>
          <div className="text-xs text-muted-foreground">Сирот</div>
        </Card>
        <Card className="p-3">
          <div className="text-2xl font-bold text-emerald-600">{stats.linked}</div>
          <div className="text-xs text-muted-foreground">Связанных</div>
        </Card>
        {urgentCount > 0 && (
          <Card className="p-3 border-amber-500/50 bg-amber-500/5">
            <div className="text-2xl font-bold text-amber-600">{urgentCount}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> ≤7 дней
            </div>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ExternalLink className="h-5 w-5" />
                Подписки bePaid
              </CardTitle>
              <CardDescription className="mt-1">
                Управление provider-managed подписками
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  setReconcileResult(null);
                  setShowReconcileDialog(true);
                  reconcileMutation.mutate(false);
                }}
                disabled={reconcileMutation.isPending}
              >
                {reconcileMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Database className="h-4 w-4 mr-2" />
                )}
                Reconcile Legacy
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => refetch()}
                disabled={isRefetching}
              >
                {isRefetching ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Обновить
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 h-8"
              />
            </div>
            
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="active">Активные</SelectItem>
                <SelectItem value="trial">Trial</SelectItem>
                <SelectItem value="past_due">Просроченные</SelectItem>
                <SelectItem value="cancelled">Отменённые</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={linkFilter} onValueChange={(v) => setLinkFilter(v as LinkFilter)}>
              <SelectTrigger className="w-32 h-8">
                <SelectValue placeholder="Связь" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="linked">Связанные</SelectItem>
                <SelectItem value="orphan">Сироты</SelectItem>
                <SelectItem value="urgent">Срочные (≤7д)</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={`${sortField}-${sortDir}`} onValueChange={(v) => {
              const [field, dir] = v.split("-") as [SortField, SortDir];
              setSortField(field);
              setSortDir(dir);
            }}>
              <SelectTrigger className="w-44 h-8">
                <SelectValue placeholder="Сортировка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="next_billing_at-asc">След. списание ↑</SelectItem>
                <SelectItem value="next_billing_at-desc">След. списание ↓</SelectItem>
                <SelectItem value="created_at-desc">Дата создания ↓</SelectItem>
                <SelectItem value="created_at-asc">Дата создания ↑</SelectItem>
                <SelectItem value="plan_amount-desc">Сумма ↓</SelectItem>
                <SelectItem value="plan_amount-asc">Сумма ↑</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <span className="text-sm">
                Выбрано: <strong>{selectedIds.size}</strong>
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowCancelDialog(true)}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4 mr-2" />
                )}
                Отменить выбранные
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
              >
                Сбросить
              </Button>
            </div>
          )}

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSubscriptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {subscriptions.length === 0 
                ? "Подписки не найдены" 
                : "Нет подписок по выбранным фильтрам"}
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.size === filteredSubscriptions.filter(s => s.status !== 'cancelled').length && filteredSubscriptions.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>План / Сумма</TableHead>
                    <TableHead>След. списание</TableHead>
                    <TableHead>Связь</TableHead>
                    <TableHead>Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSubscriptions.map((sub) => {
                    const daysUntil = getDaysUntilCharge(sub.next_billing_at);
                    const isUrgent = daysUntil !== null && daysUntil <= 7 && daysUntil >= 0 && sub.is_orphan;
                    
                    return (
                      <TableRow 
                        key={sub.id} 
                        className={isUrgent ? "bg-amber-500/5 border-l-2 border-l-amber-500" : sub.is_orphan ? "bg-red-500/5" : ""}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(sub.id)}
                            onCheckedChange={() => handleSelectOne(sub.id)}
                            disabled={sub.status === "cancelled"}
                          />
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => copyId(sub.id)}
                            className="font-mono text-xs hover:text-primary flex items-center gap-1"
                            title="Скопировать ID"
                          >
                            {sub.id.slice(0, 16)}...
                            {copiedId === sub.id ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3 opacity-50" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell>{getStatusBadge(sub.status)}</TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">
                            {sub.customer_name || sub.customer_email || "—"}
                          </div>
                          {sub.customer_name && sub.customer_email && (
                            <div className="text-xs text-muted-foreground">{sub.customer_email}</div>
                          )}
                          {sub.card_last4 && (
                            <div className="text-xs text-muted-foreground">
                              {sub.card_brand} •••• {sub.card_last4}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{sub.plan_title}</div>
                          <div className="text-sm font-medium">
                            {sub.plan_amount.toFixed(2)} {sub.plan_currency}
                          </div>
                        </TableCell>
                        <TableCell>
                          {sub.next_billing_at ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-muted-foreground" />
                              <span className={`text-xs ${isUrgent ? 'text-amber-600 font-medium' : ''}`}>
                                {formatDate(sub.next_billing_at)}
                              </span>
                              {daysUntil !== null && daysUntil <= 7 && (
                                <Badge variant={daysUntil <= 3 ? "destructive" : "outline"} className="ml-1 text-xs">
                                  {daysUntil}д
                                </Badge>
                              )}
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {sub.is_orphan ? (
                            <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                              <Link2Off className="h-3 w-3" />
                              Сирота
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="flex items-center gap-1 w-fit bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                              <Link2 className="h-3 w-3" />
                              {sub.linked_profile_name || "Связана"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {sub.status !== 'cancelled' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setSelectedIds(new Set([sub.id]));
                                  setShowCancelDialog(true);
                                }}
                                title="Отменить подписку"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Cancel confirmation dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Отменить подписки?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Вы собираетесь отменить <strong>{selectedIds.size}</strong> подписок в bePaid.
              </p>
              <p className="text-amber-600">
                ⚠️ Автоматические списания прекратятся. Если bePaid откажет в отмене 
                (например, при past_due), подписка останется активной.
              </p>
              <p>Это действие нельзя отменить.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelMutation.mutate([...selectedIds])}
              disabled={cancelMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Ban className="h-4 w-4 mr-2" />
              )}
              Отменить {selectedIds.size} подписок
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reconcile dialog */}
      <AlertDialog open={showReconcileDialog} onOpenChange={setShowReconcileDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Reconcile Legacy Subscriptions
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {reconcileMutation.isPending && !reconcileResult && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="ml-2">Анализ...</span>
                  </div>
                )}
                
                {reconcileResult && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium">{reconcileResult.distinct_sbs_ids_total}</div>
                        <div className="text-xs text-muted-foreground">Всего в orders.meta</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium">{reconcileResult.missing_provider_subscriptions_count}</div>
                        <div className="text-xs text-muted-foreground">Отсутствует в provider_subs</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium">{reconcileResult.already_present}</div>
                        <div className="text-xs text-muted-foreground">Уже есть</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium text-emerald-600">
                          {reconcileResult.dry_run ? reconcileResult.would_insert : reconcileResult.inserted}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {reconcileResult.dry_run ? "Будет создано" : "Создано"}
                        </div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium text-blue-600">{reconcileResult.linked_to_subscription_v2}</div>
                        <div className="text-xs text-muted-foreground">Со связью</div>
                      </div>
                      <div className="p-2 bg-muted rounded">
                        <div className="font-medium text-amber-600">{reconcileResult.still_unlinked}</div>
                        <div className="text-xs text-muted-foreground">Без связи</div>
                      </div>
                    </div>

                    {reconcileResult.sample_ids.length > 0 && (
                      <div className="text-xs">
                        <div className="font-medium mb-1">Примеры ID:</div>
                        <div className="font-mono text-muted-foreground break-all">
                          {reconcileResult.sample_ids.slice(0, 5).join(', ')}
                          {reconcileResult.sample_ids.length > 5 && '...'}
                        </div>
                      </div>
                    )}

                    {reconcileResult.dry_run && reconcileResult.would_insert > 0 && (
                      <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20 text-sm">
                        ⚠️ Это dry-run. Нажмите "Выполнить" чтобы создать записи.
                      </div>
                    )}

                    {!reconcileResult.dry_run && (
                      <div className="p-2 bg-emerald-500/10 rounded border border-emerald-500/20 text-sm">
                        ✅ Reconcile выполнен. Создано {reconcileResult.inserted} записей.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Закрыть</AlertDialogCancel>
            {reconcileResult?.dry_run && reconcileResult.would_insert > 0 && (
              <Button
                onClick={() => reconcileMutation.mutate(true)}
                disabled={reconcileMutation.isPending}
              >
                {reconcileMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Выполнить
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
