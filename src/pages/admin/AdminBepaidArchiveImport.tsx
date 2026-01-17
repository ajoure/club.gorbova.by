import { useState, useMemo } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Archive,
  Play,
  CheckCircle,
  AlertCircle,
  Package,
  RefreshCw,
  Loader2,
  FileSpreadsheet,
  Edit3,
  Sparkles,
  Save,
  X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ManualMapping {
  customName: string | null;   // User's custom name (Priority 1)
  productId: string | null;     // Existing product (Priority 2)
  action: "manual" | "existing" | "auto"; // Type of mapping
}

export default function AdminBepaidArchiveImport() {
  const [onlyMapped, setOnlyMapped] = useState(false);
  const [batchSize, setBatchSize] = useState("100");
  const [manualMappings, setManualMappings] = useState<Record<string, ManualMapping>>({});
  const queryClient = useQueryClient();

  // Fetch queue stats
  const { data: queueStats, isLoading: statsLoading } = useQuery({
    queryKey: ["bepaid-queue-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_reconcile_queue")
        .select("status");
      
      if (error) throw error;
      
      const pending = data?.filter(i => i.status === "pending").length || 0;
      const completed = data?.filter(i => i.status === "completed").length || 0;
      const errored = data?.filter(i => i.status === "error").length || 0;
      
      return { pending, completed, errored, total: data?.length || 0 };
    },
  });

  // Fetch unique unmapped products from queue
  const { data: unmappedProducts, isLoading: unmappedLoading, refetch: refetchUnmapped } = useQuery({
    queryKey: ["bepaid-unmapped-descriptions"],
    queryFn: async () => {
      // Get pending queue items
      const { data: queue } = await supabase
        .from("payment_reconcile_queue")
        .select("description, raw_payload, amount")
        .eq("status", "pending");

      // Get existing mappings
      const { data: mappings } = await supabase
        .from("bepaid_product_mappings")
        .select("bepaid_plan_title, product_id");

      const mappedTitles = new Set((mappings || []).map(m => m.bepaid_plan_title?.toLowerCase()));

      // Extract unique product names
      const productCounts = new Map<string, { count: number; amount: number; hasMapping: boolean; originalName: string }>();

      (queue || []).forEach(item => {
        const payload = item.raw_payload as Record<string, any> || {};
        const plan = payload.plan || {};
        const additionalData = payload.additional_data || {};
        
        // Extract product name from description or plan title
        let productName = "";
        const desc = item.description || additionalData.description || "";
        
        // Try to extract from "Оплата по сделке X (Product Name)"
        const match = desc.match(/\(([^)]+)\)/);
        if (match) {
          productName = match[1];
        } else {
          productName = plan.title || plan.name || desc || "Unknown";
        }

        const key = productName.toLowerCase();
        const existing = productCounts.get(key);
        const hasMapping = mappedTitles.has(key) || mappedTitles.has((plan.title || "").toLowerCase());
        
        if (existing) {
          existing.count++;
          existing.amount += item.amount || 0;
        } else {
          productCounts.set(key, { 
            count: 1, 
            amount: item.amount || 0,
            hasMapping,
            originalName: productName,
          });
        }
      });

      return Array.from(productCounts.entries())
        .map(([name, data]) => ({
          productName: name,
          originalName: data.originalName,
          count: data.count,
          totalAmount: data.amount,
          hasMapping: data.hasMapping,
        }))
        .sort((a, b) => b.count - a.count);
    },
  });

  // Fetch available products for mapping
  const { data: products } = useQuery({
    queryKey: ["products-for-mapping"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, code, status")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Calculate mapping stats
  const mappingStats = useMemo(() => {
    if (!unmappedProducts) return { manual: 0, existing: 0, auto: 0, total: 0 };
    
    let manual = 0;
    let existing = 0;
    let auto = 0;
    
    unmappedProducts.forEach(item => {
      const mapping = manualMappings[item.productName];
      if (item.hasMapping) {
        existing++;
      } else if (mapping?.action === "manual" && mapping.customName) {
        manual++;
      } else if (mapping?.action === "existing" && mapping.productId) {
        existing++;
      } else {
        auto++;
      }
    });
    
    return { manual, existing, auto, total: unmappedProducts.length };
  }, [unmappedProducts, manualMappings]);

  // Update manual mapping
  const updateMapping = (productKey: string, update: Partial<ManualMapping>) => {
    setManualMappings(prev => ({
      ...prev,
      [productKey]: {
        ...prev[productKey],
        ...update,
      },
    }));
  };

  // Dry run mutation
  const dryRunMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-archive-import", {
        body: { 
          batchSize: parseInt(batchSize), 
          dryRun: true,
          onlyMapped,
          manualMappings,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Dry run: ${data.stats?.processed || 0} items would be processed`);
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("bepaid-archive-import", {
        body: { 
          batchSize: parseInt(batchSize), 
          dryRun: false,
          onlyMapped,
          manualMappings,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bepaid-queue-stats"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-unmapped-descriptions"] });
      toast.success(`Импортировано: ${data.stats?.ordersCreated || 0} сделок, ${data.stats?.paymentsCreated || 0} платежей`);
    },
    onError: (error: Error) => {
      toast.error(`Ошибка импорта: ${error.message}`);
    },
  });

  // Save all mappings to database
  const saveMappingsMutation = useMutation({
    mutationFn: async () => {
      const mappingsToSave = Object.entries(manualMappings)
        .filter(([_, m]) => (m.action === "manual" && m.customName) || (m.action === "existing" && m.productId))
        .map(([title, m]) => ({
          bepaid_plan_title: title,
          product_id: m.productId || null,
          bepaid_description: m.customName || null,
          auto_create_order: true,
        }));
      
      if (mappingsToSave.length === 0) {
        throw new Error("Нет маппингов для сохранения");
      }

      const { error } = await supabase
        .from("bepaid_product_mappings")
        .upsert(mappingsToSave, { onConflict: "bepaid_plan_title" });
      
      if (error) throw error;
      return mappingsToSave.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["bepaid-unmapped-descriptions"] });
      toast.success(`Сохранено ${count} маппингов`);
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  const progress = queueStats 
    ? Math.round((queueStats.completed / queueStats.total) * 100) 
    : 0;

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Archive className="h-6 w-6" />
              Импорт архива bePaid 2025
            </h1>
            <p className="text-muted-foreground">
              Гибридный маппинг: ручной + автоматический со звездочкой
            </p>
          </div>
          <Button variant="outline" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["bepaid-queue-stats"] });
            refetchUnmapped();
          }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                В очереди
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold text-amber-600">
                  {queueStats?.pending || 0}
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Обработано
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold text-green-600">
                  {queueStats?.completed || 0}
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Ошибки
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold text-destructive">
                  {queueStats?.errored || 0}
                </div>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Package className="h-4 w-4" />
                Уник. продуктов
              </CardTitle>
            </CardHeader>
            <CardContent>
              {unmappedLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold">
                  {unmappedProducts?.length || 0}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Mapping Summary */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Режим гибридного маппинга
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-green-600">
                  <Edit3 className="h-3 w-3 mr-1" />
                  {mappingStats.manual}
                </Badge>
                <span className="text-muted-foreground">Ручной</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-blue-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  {mappingStats.existing}
                </Badge>
                <span className="text-muted-foreground">Существующий</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  <Sparkles className="h-3 w-3 mr-1" />
                  {mappingStats.auto}
                </Badge>
                <span className="text-muted-foreground">Авто (*)</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {mappingStats.total}
                </Badge>
                <span className="text-muted-foreground">Всего</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              <strong>Приоритет:</strong> 1) Ваше название → 2) Существующий продукт → 3) Авто-создание "* Название из bePaid"
            </p>
          </CardContent>
        </Card>

        {/* Progress */}
        {queueStats && queueStats.total > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Прогресс обработки</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground">
                  {queueStats.completed} из {queueStats.total} ({progress}%)
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Import Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Управление импортом
            </CardTitle>
            <CardDescription>
              Настройки и запуск массового импорта
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-6">
              <div className="space-y-2">
                <Label>Размер пакета</Label>
                <Select value={batchSize} onValueChange={setBatchSize}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50 записей</SelectItem>
                    <SelectItem value="100">100 записей</SelectItem>
                    <SelectItem value="200">200 записей</SelectItem>
                    <SelectItem value="500">500 записей</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="only-mapped"
                  checked={onlyMapped}
                  onCheckedChange={setOnlyMapped}
                />
                <Label htmlFor="only-mapped">
                  Только с ручным маппингом
                </Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <Button 
                variant="outline" 
                onClick={() => saveMappingsMutation.mutate()}
                disabled={saveMappingsMutation.isPending || Object.keys(manualMappings).length === 0}
              >
                {saveMappingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Save className="h-4 w-4 mr-2" />
                Сохранить маппинги
              </Button>
              
              <Button 
                variant="outline" 
                onClick={() => dryRunMutation.mutate()}
                disabled={dryRunMutation.isPending || importMutation.isPending}
              >
                {dryRunMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Тестовый запуск
              </Button>
              
              <Button 
                onClick={() => importMutation.mutate()}
                disabled={dryRunMutation.isPending || importMutation.isPending}
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Play className="h-4 w-4 mr-2" />
                Запустить импорт
              </Button>
            </div>

            {/* Last run stats */}
            {(dryRunMutation.data || importMutation.data) && (
              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-medium mb-2">Результат последнего запуска:</h4>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Обработано:</span>{" "}
                    <strong>{(dryRunMutation.data || importMutation.data)?.stats?.processed || 0}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Сделок:</span>{" "}
                    <strong className="text-green-600">{(dryRunMutation.data || importMutation.data)?.stats?.ordersCreated || 0}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Профилей:</span>{" "}
                    <strong>{(dryRunMutation.data || importMutation.data)?.stats?.profilesCreated || 0}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Возвратов:</span>{" "}
                    <strong>{(dryRunMutation.data || importMutation.data)?.stats?.refundsProcessed || 0}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Авто-продуктов:</span>{" "}
                    <strong className="text-amber-600">{(dryRunMutation.data || importMutation.data)?.stats?.productsAutoCreated || 0}</strong>
                  </div>
                </div>
                {(dryRunMutation.data || importMutation.data)?.stats?.errors?.length > 0 && (
                  <div className="mt-2 text-sm text-destructive">
                    Ошибки: {(dryRunMutation.data || importMutation.data)?.stats?.errors?.length}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Product Mapping Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Сверка продуктов из файла
            </CardTitle>
            <CardDescription>
              Укажите правильные названия для ключевых продуктов. Остальные будут созданы автоматически со звездочкой (*).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {unmappedLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !unmappedProducts?.length ? (
              <div className="text-center text-muted-foreground py-8">
                <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Нет записей в очереди</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Название из bePaid</TableHead>
                      <TableHead className="text-right w-20">Кол-во</TableHead>
                      <TableHead className="text-right w-32">Сумма</TableHead>
                      <TableHead className="min-w-[200px]">Ваше название</TableHead>
                      <TableHead className="min-w-[200px]">Или выберите продукт</TableHead>
                      <TableHead className="w-24">Результат</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmappedProducts.map((item, idx) => {
                      const mapping = manualMappings[item.productName];
                      const selectedProduct = mapping?.productId 
                        ? products?.find(p => p.id === mapping.productId) 
                        : null;
                      
                      // Determine what will happen on import
                      let resultType: "manual" | "existing" | "auto" = "auto";
                      let resultName = `* ${item.originalName}`;
                      
                      if (item.hasMapping) {
                        resultType = "existing";
                        resultName = "✓ Уже сопоставлен";
                      } else if (mapping?.customName) {
                        resultType = "manual";
                        resultName = mapping.customName;
                      } else if (selectedProduct) {
                        resultType = "existing";
                        resultName = selectedProduct.name;
                      }
                      
                      return (
                        <TableRow key={idx} className={item.hasMapping ? "bg-green-50/50" : ""}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>{item.originalName}</span>
                              {item.productName !== item.originalName.toLowerCase() && (
                                <span className="text-xs text-muted-foreground">
                                  key: {item.productName}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {item.count}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {new Intl.NumberFormat("ru-BY", { 
                              style: "currency", 
                              currency: "BYN",
                              maximumFractionDigits: 0,
                            }).format(item.totalAmount)}
                          </TableCell>
                          <TableCell>
                            {!item.hasMapping && (
                              <div className="flex items-center gap-2">
                                <Input
                                  placeholder="Введите название..."
                                  value={mapping?.customName || ""}
                                  onChange={(e) => updateMapping(item.productName, {
                                    customName: e.target.value || null,
                                    action: e.target.value ? "manual" : (mapping?.productId ? "existing" : "auto"),
                                  })}
                                  className="w-full"
                                  disabled={!!mapping?.productId}
                                />
                                {mapping?.customName && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={() => updateMapping(item.productName, {
                                      customName: null,
                                      action: "auto",
                                    })}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {!item.hasMapping && (
                              <Select
                                value={mapping?.productId || ""}
                                onValueChange={(productId) => {
                                  if (productId === "__clear__") {
                                    updateMapping(item.productName, {
                                      productId: null,
                                      action: mapping?.customName ? "manual" : "auto",
                                    });
                                  } else {
                                    updateMapping(item.productName, {
                                      productId,
                                      customName: null, // Clear custom name when selecting existing product
                                      action: "existing",
                                    });
                                  }
                                }}
                                disabled={!!mapping?.customName}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Выберите..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {mapping?.productId && (
                                    <SelectItem value="__clear__" className="text-muted-foreground">
                                      — Очистить выбор —
                                    </SelectItem>
                                  )}
                                  {products?.map(p => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name}
                                      {p.status === "archived" && " (архив)"}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>
                            {resultType === "existing" && item.hasMapping ? (
                              <Badge variant="default" className="bg-green-600 text-xs">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                OK
                              </Badge>
                            ) : resultType === "manual" ? (
                              <Badge variant="default" className="bg-green-600 text-xs">
                                <Edit3 className="h-3 w-3 mr-1" />
                                {resultName}
                              </Badge>
                            ) : resultType === "existing" ? (
                              <Badge variant="default" className="bg-blue-600 text-xs whitespace-nowrap">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                {resultName.substring(0, 15)}...
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                <Sparkles className="h-3 w-3 mr-1" />
                                *Авто
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
