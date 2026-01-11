import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  RefreshCw, Play, Download, AlertCircle, CheckCircle2, User, CreditCard, Mail, 
  HelpCircle, Phone, Package, Plus, ArrowRight, UserPlus 
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface SyncResult {
  bepaid_uid: string;
  email: string | null;
  phone: string | null;
  card_holder: string | null;
  card_holder_cyrillic: string | null;
  card_mask: string | null;
  amount: number;
  currency: string;
  paid_at: string | null;
  description: string | null;
  product_name: string | null;
  matched_profile_id: string | null;
  matched_profile_name: string | null;
  matched_profile_phone: string | null;
  match_type: 'email' | 'card_mask' | 'name_translit' | 'none';
  action: 'created' | 'skipped_duplicate' | 'skipped_no_match' | 'error' | 'pending';
  order_id: string | null;
  error?: string;
}

interface SyncStats {
  total_fetched: number;
  matched_by_email: number;
  matched_by_card: number;
  matched_by_name: number;
  not_matched: number;
  skipped_duplicate: number;
  created: number;
  errors: number;
}

export default function AdminBepaidSync() {
  const [dryRun, setDryRun] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [results, setResults] = useState<SyncResult[]>([]);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  // Query existing payments count
  const { data: paymentsCount } = useQuery({
    queryKey: ["bepaid-payments-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("payments_v2")
        .select("id", { count: "exact", head: true })
        .eq("provider", "bepaid");
      return count || 0;
    },
  });

  // Query queue count
  const { data: queueCount } = useQuery({
    queryKey: ["bepaid-queue-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("payment_reconcile_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count || 0;
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-full-sync", {
        body: { dryRun, fromDate: fromDate || undefined, toDate: toDate || undefined },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setResults(data.results || []);
      setStats(data.stats || null);
      setSelectedItems(new Set());
      
      if (data.dryRun) {
        toast.success(`Предпросмотр завершён: найдено ${data.stats?.total_fetched || 0} платежей`);
      } else {
        toast.success(`Синхронизация завершена: импортировано ${data.stats?.created || 0} платежей`);
        queryClient.invalidateQueries({ queryKey: ["bepaid-payments-count"] });
      }
    },
    onError: (error: Error) => {
      toast.error(`Ошибка синхронизации: ${error.message}`);
    },
  });

  const importSelectedMutation = useMutation({
    mutationFn: async (items: SyncResult[]) => {
      // For each selected item, create order/payment/subscription
      const { data, error } = await supabase.functions.invoke("bepaid-full-sync", {
        body: { 
          dryRun: false, 
          fromDate: fromDate || undefined, 
          toDate: toDate || undefined,
          selectedUids: items.map(i => i.bepaid_uid)
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Импортировано ${data.stats?.created || 0} сделок`);
      setSelectedItems(new Set());
      queryClient.invalidateQueries({ queryKey: ["bepaid-payments-count"] });
      // Refresh results
      syncMutation.mutate();
    },
    onError: (error: Error) => {
      toast.error(`Ошибка импорта: ${error.message}`);
    },
  });

  const filteredResults = results.filter(r => {
    if (activeTab === "all") return true;
    if (activeTab === "matched") return r.match_type !== "none";
    if (activeTab === "unmatched") return r.match_type === "none" && r.action !== "skipped_duplicate";
    if (activeTab === "duplicates") return r.action === "skipped_duplicate";
    if (activeTab === "errors") return r.action === "error";
    return true;
  });

  const importableResults = results.filter(r => 
    r.match_type !== "none" && r.action !== "skipped_duplicate" && r.action !== "created"
  );

  const toggleSelectAll = () => {
    if (selectedItems.size === importableResults.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(importableResults.map(r => r.bepaid_uid)));
    }
  };

  const toggleItem = (uid: string) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(uid)) {
      newSet.delete(uid);
    } else {
      newSet.add(uid);
    }
    setSelectedItems(newSet);
  };

  const getMatchTypeIcon = (matchType: string) => {
    switch (matchType) {
      case "email": return <Mail className="h-4 w-4 text-green-500" />;
      case "card_mask": return <CreditCard className="h-4 w-4 text-blue-500" />;
      case "name_translit": return <User className="h-4 w-4 text-amber-500" />;
      default: return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getMatchTypeBadge = (matchType: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
      email: { variant: "default", label: "Email" },
      card_mask: { variant: "secondary", label: "Карта" },
      name_translit: { variant: "outline", label: "Имя" },
      none: { variant: "destructive", label: "Нет" },
    };
    const config = variants[matchType] || variants.none;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getActionBadge = (action: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
      created: { variant: "default", label: "Создан" },
      pending: { variant: "outline", label: "Готов" },
      skipped_duplicate: { variant: "secondary", label: "Дубликат" },
      skipped_no_match: { variant: "outline", label: "Не найден" },
      error: { variant: "destructive", label: "Ошибка" },
    };
    const config = variants[action] || { variant: "outline" as const, label: action };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const exportResults = () => {
    const csv = [
      ["UID", "Email", "Телефон", "Владелец карты", "Кириллица", "Маска", "Сумма", "Валюта", "Дата", "Продукт", "Клиент", "Телефон клиента", "Тип совпадения", "Статус"].join(";"),
      ...results.map(r => [
        r.bepaid_uid,
        r.email || "",
        r.phone || "",
        r.card_holder || "",
        r.card_holder_cyrillic || "",
        r.card_mask || "",
        r.amount,
        r.currency,
        r.paid_at || "",
        r.product_name || "",
        r.matched_profile_name || "",
        r.matched_profile_phone || "",
        r.match_type,
        r.action,
      ].join(";"))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bepaid-sync-${format(new Date(), "yyyy-MM-dd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSelected = () => {
    const itemsToImport = results.filter(r => selectedItems.has(r.bepaid_uid));
    if (itemsToImport.length === 0) {
      toast.error("Выберите платежи для импорта");
      return;
    }
    importSelectedMutation.mutate(itemsToImport);
  };

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Синхронизация bePaid</h1>
          <p className="text-muted-foreground">
            Импорт всех покупок из bePaid с сопоставлением клиентов
          </p>
        </div>
      </div>

      {/* Help section */}
      <Card className="bg-muted/50">
        <CardContent className="pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-medium mb-2">Платежи в системе</h3>
              <p className="text-sm text-muted-foreground">
                Количество платежей bePaid, уже сохранённых в базе данных (payments_v2)
              </p>
            </div>
            <div>
              <h3 className="font-medium mb-2">В очереди</h3>
              <p className="text-sm text-muted-foreground">
                Платежи в очереди на обработку (payment_reconcile_queue), ожидающие сопоставления с клиентами
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Платежи в системе</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{paymentsCount ?? "..."}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">В очереди</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{queueCount ?? "..."}</div>
          </CardContent>
        </Card>
        {stats && (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Получено из bePaid</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total_fetched}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Сопоставлено</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {stats.matched_by_email + stats.matched_by_card + stats.matched_by_name}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Email: {stats.matched_by_email} | Карта: {stats.matched_by_card} | Имя: {stats.matched_by_name}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Параметры синхронизации</CardTitle>
          <CardDescription>
            Настройте параметры и запустите синхронизацию
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="fromDate">С даты</Label>
              <Input
                id="fromDate"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="toDate">По дату</Label>
              <Input
                id="toDate"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
              />
            </div>
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Загрузить данные
            </Button>
            {results.length > 0 && (
              <Button variant="outline" onClick={exportResults}>
                <Download className="h-4 w-4 mr-2" />
                Экспорт CSV
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle>Результаты ({results.length})</CardTitle>
              <div className="flex gap-4 items-center">
                {stats && (
                  <div className="flex gap-4 text-sm">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      Готово: {stats.matched_by_email + stats.matched_by_card + stats.matched_by_name}
                    </span>
                    <span>Дубликаты: {stats.skipped_duplicate}</span>
                    <span>Не найдено: {stats.not_matched}</span>
                    {stats.errors > 0 && (
                      <span className="text-destructive">Ошибки: {stats.errors}</span>
                    )}
                  </div>
                )}
                {selectedItems.size > 0 && (
                  <Button 
                    onClick={handleImportSelected}
                    disabled={importSelectedMutation.isPending}
                  >
                    {importSelectedMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Импортировать выбранные ({selectedItems.size})
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="all">Все ({results.length})</TabsTrigger>
                <TabsTrigger value="matched">
                  Сопоставлено ({results.filter(r => r.match_type !== "none").length})
                </TabsTrigger>
                <TabsTrigger value="unmatched">
                  Не найдено ({results.filter(r => r.match_type === "none" && r.action !== "skipped_duplicate").length})
                </TabsTrigger>
                <TabsTrigger value="duplicates">
                  Дубликаты ({results.filter(r => r.action === "skipped_duplicate").length})
                </TabsTrigger>
                {stats && stats.errors > 0 && (
                  <TabsTrigger value="errors" className="text-destructive">
                    Ошибки ({stats.errors})
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value={activeTab}>
                <ScrollArea className="h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox 
                            checked={selectedItems.size === importableResults.length && importableResults.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                        <TableHead>Дата</TableHead>
                        <TableHead>Продукт</TableHead>
                        <TableHead className="text-right">Сумма</TableHead>
                        <TableHead>Данные карты</TableHead>
                        <TableHead>Контакт bePaid</TableHead>
                        <TableHead>Совпадение</TableHead>
                        <TableHead>Контакт в системе</TableHead>
                        <TableHead>Статус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredResults.map((r, idx) => {
                        const canImport = r.match_type !== "none" && r.action !== "skipped_duplicate" && r.action !== "created";
                        return (
                          <TableRow key={r.bepaid_uid || idx} className={selectedItems.has(r.bepaid_uid) ? "bg-muted/50" : ""}>
                            <TableCell>
                              {canImport && (
                                <Checkbox 
                                  checked={selectedItems.has(r.bepaid_uid)}
                                  onCheckedChange={() => toggleItem(r.bepaid_uid)}
                                />
                              )}
                            </TableCell>
                            <TableCell className="text-xs whitespace-nowrap">
                              {r.paid_at ? format(new Date(r.paid_at), "dd.MM.yy HH:mm", { locale: ru }) : "—"}
                            </TableCell>
                            <TableCell>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1 max-w-[150px]">
                                      <Package className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                      <span className="truncate text-sm">{r.product_name || r.description || "—"}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{r.product_name || r.description || "Нет данных"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableCell>
                            <TableCell className="text-right font-medium whitespace-nowrap">
                              {r.amount.toFixed(2)} {r.currency}
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <div className="flex items-center gap-1 text-xs">
                                  <CreditCard className="h-3 w-3 text-muted-foreground" />
                                  <span className="font-mono">{r.card_mask ? `****${r.card_mask}` : "—"}</span>
                                </div>
                                <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                                  {r.card_holder || "—"}
                                </div>
                                {r.card_holder_cyrillic && r.card_holder_cyrillic !== r.card_holder && (
                                  <div className="text-xs text-amber-600 truncate max-w-[120px]">
                                    → {r.card_holder_cyrillic}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                {r.email && (
                                  <div className="flex items-center gap-1 text-xs">
                                    <Mail className="h-3 w-3 text-muted-foreground" />
                                    <span className="truncate max-w-[120px]">{r.email}</span>
                                  </div>
                                )}
                                {r.phone && (
                                  <div className="flex items-center gap-1 text-xs">
                                    <Phone className="h-3 w-3 text-muted-foreground" />
                                    <span>{r.phone}</span>
                                  </div>
                                )}
                                {!r.email && !r.phone && <span className="text-xs text-muted-foreground">—</span>}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {getMatchTypeIcon(r.match_type)}
                                {getMatchTypeBadge(r.match_type)}
                              </div>
                            </TableCell>
                            <TableCell>
                              {r.matched_profile_id ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1">
                                    <User className="h-3 w-3 text-green-500" />
                                    <span className="text-sm font-medium truncate max-w-[120px]">
                                      {r.matched_profile_name || "Без имени"}
                                    </span>
                                  </div>
                                  {r.matched_profile_phone && (
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Phone className="h-3 w-3" />
                                      <span>{r.matched_profile_phone}</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <UserPlus className="h-3 w-3" />
                                  <span className="text-xs">Не найден</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{getActionBadge(r.action)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
