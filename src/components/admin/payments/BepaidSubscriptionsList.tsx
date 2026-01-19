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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
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

type StatusFilter = "all" | "active" | "trial" | "cancelled" | "past_due";
type LinkFilter = "all" | "linked" | "orphan";
type SortField = "created_at" | "next_billing_at" | "plan_amount" | "status";
type SortDir = "asc" | "desc";

export default function BepaidSubscriptionsList() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  
  const queryClient = useQueryClient();

  // Fetch subscriptions from bePaid
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["bepaid-subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-list-subscriptions");
      if (error) throw error;
      return data as { subscriptions: BepaidSubscription[]; stats: SubscriptionStats };
    },
    staleTime: 60000, // 1 minute
  });

  const subscriptions = data?.subscriptions || [];
  const stats = data?.stats || { total: 0, active: 0, trial: 0, cancelled: 0, orphans: 0, linked: 0 };

  // Filter and sort subscriptions
  const filteredSubscriptions = useMemo(() => {
    let result = [...subscriptions];
    
    // Status filter
    if (statusFilter !== "all") {
      result = result.filter(s => s.status === statusFilter);
    }
    
    // Link filter
    if (linkFilter === "linked") {
      result = result.filter(s => !s.is_orphan);
    } else if (linkFilter === "orphan") {
      result = result.filter(s => s.is_orphan);
    }
    
    // Search filter
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
    
    // Sort
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case "created_at":
          aVal = a.created_at || "";
          bVal = b.created_at || "";
          break;
        case "next_billing_at":
          aVal = a.next_billing_at || "";
          bVal = b.next_billing_at || "";
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
        toast.error(`Не удалось отменить: ${data.failed.length}`);
      }
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["bepaid-subscriptions"] });
    },
    onError: (e: any) => {
      toast.error("Ошибка отмены: " + e.message);
    },
  });

  const handleSelectAll = () => {
    if (selectedIds.size === filteredSubscriptions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSubscriptions.map(s => s.id)));
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ExternalLink className="h-5 w-5" />
              Подписки bePaid (внешний контур)
            </CardTitle>
            <CardDescription className="flex items-center gap-4 mt-2">
              <span>Всего: <strong>{stats.total}</strong></span>
              <span className="text-emerald-600">Активных: {stats.active}</span>
              <span className="text-blue-600">Trial: {stats.trial}</span>
              <span className="text-red-600">Сирот: {stats.orphans}</span>
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
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
              className="w-48"
            />
          </div>
          
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-36">
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
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Связь" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="linked">Связанные</SelectItem>
              <SelectItem value="orphan">Сироты</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={`${sortField}-${sortDir}`} onValueChange={(v) => {
            const [field, dir] = v.split("-") as [SortField, SortDir];
            setSortField(field);
            setSortDir(dir);
          }}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Сортировка" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at-desc">Дата создания ↓</SelectItem>
              <SelectItem value="created_at-asc">Дата создания ↑</SelectItem>
              <SelectItem value="next_billing_at-asc">След. списание ↑</SelectItem>
              <SelectItem value="next_billing_at-desc">След. списание ↓</SelectItem>
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
              Сбросить выбор
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
                      checked={selectedIds.size === filteredSubscriptions.length && filteredSubscriptions.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>План</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Сумма</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Карта</TableHead>
                  <TableHead>Создана</TableHead>
                  <TableHead>След. списание</TableHead>
                  <TableHead>Связь</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSubscriptions.map((sub) => (
                  <TableRow key={sub.id} className={sub.is_orphan ? "bg-red-500/5" : ""}>
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
                        {sub.id.slice(0, 12)}...
                        {copiedId === sub.id ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={sub.plan_title}>
                      {sub.plan_title}
                    </TableCell>
                    <TableCell>{getStatusBadge(sub.status)}</TableCell>
                    <TableCell className="font-medium">
                      {sub.plan_amount.toFixed(2)} {sub.plan_currency}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {sub.customer_name || sub.customer_email || "—"}
                      </div>
                      {sub.customer_name && sub.customer_email && (
                        <div className="text-xs text-muted-foreground">{sub.customer_email}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {sub.card_last4 ? (
                        <span className="text-xs">
                          {sub.card_brand} •••• {sub.card_last4}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(sub.created_at)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {sub.next_billing_at ? formatDate(sub.next_billing_at) : "—"}
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        {/* Cancel confirmation dialog */}
        <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Отменить подписки?</AlertDialogTitle>
              <AlertDialogDescription>
                Вы собираетесь отменить <strong>{selectedIds.size}</strong> подписок в bePaid.
                Автоматические списания прекратятся, но токены карт сохранятся.
                Это действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  cancelMutation.mutate([...selectedIds]);
                  setShowCancelDialog(false);
                }}
              >
                Да, отменить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
