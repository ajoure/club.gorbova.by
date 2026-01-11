import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Edit2, Trash2, RefreshCw, AlertCircle, Package, Link2, Check, Eye } from "lucide-react";
import { useBepaidMappings, BepaidMapping, UnmappedProduct } from "@/hooks/useBepaidMappings";
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { useQueueProductNames, DateFilter } from "@/hooks/useBepaidData";
import QueueRecordsDialog from "./QueueRecordsDialog";
import UnmatchedPaymentsSection from "./UnmatchedPaymentsSection";

interface BepaidMappingsTabProps {
  dateFilter?: DateFilter;
}

export default function BepaidMappingsTab({ dateFilter }: BepaidMappingsTabProps) {
  const {
    mappings,
    mappingsLoading,
    unmappedProducts,
    unmappedLoading,
    refetchMappings,
    refetchUnmapped,
    createMapping,
    updateMapping,
    deleteMapping,
    isCreating,
    isUpdating,
    isDeleting,
  } = useBepaidMappings();
  const { data: products, isLoading: productsLoading } = useProductsV2();
  const { data: queueProductNames } = useQueueProductNames(dateFilter);
  const { data: allTariffs } = useTariffs();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<BepaidMapping | null>(null);
  const [newMappingData, setNewMappingData] = useState<Partial<BepaidMapping>>({});
  
  // Queue records dialog state
  const [queueRecordsOpen, setQueueRecordsOpen] = useState(false);
  const [selectedProductName, setSelectedProductName] = useState("");

  const handleOpenEdit = (mapping: BepaidMapping | null, unmapped?: UnmappedProduct) => {
    if (mapping) {
      setEditingMapping(mapping);
      setNewMappingData(mapping);
    } else if (unmapped) {
      setEditingMapping(null);
      setNewMappingData({
        bepaid_plan_title: unmapped.bepaid_plan_title,
        bepaid_description: unmapped.sample_description || null,
        is_subscription: false,
        auto_create_order: true,
      });
    } else {
      setEditingMapping(null);
      setNewMappingData({
        bepaid_plan_title: "",
        bepaid_description: null,
        is_subscription: false,
        auto_create_order: true,
      });
    }
    setEditDialogOpen(true);
  };

  const handleSave = () => {
    if (!newMappingData.bepaid_plan_title) return;

    if (editingMapping) {
      updateMapping({ id: editingMapping.id, ...newMappingData });
    } else {
      createMapping({
        bepaid_plan_title: newMappingData.bepaid_plan_title!,
        bepaid_description: newMappingData.bepaid_description || null,
        product_id: newMappingData.product_id || null,
        tariff_id: newMappingData.tariff_id || null,
        offer_id: newMappingData.offer_id || null,
        is_subscription: newMappingData.is_subscription || false,
        auto_create_order: newMappingData.auto_create_order ?? true,
        notes: newMappingData.notes || null,
      });
    }
    setEditDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirm("Удалить этот маппинг?")) {
      deleteMapping(id);
    }
  };

  const refreshAll = () => {
    refetchMappings();
    refetchUnmapped();
  };
  
  const handleViewQueueRecords = (productName: string) => {
    setSelectedProductName(productName);
    setQueueRecordsOpen(true);
  };

  

  return (
    <div className="space-y-6">
      {/* Unmapped Products */}
      {unmappedProducts.length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                <CardTitle className="text-base">Немаппированные продукты</CardTitle>
              </div>
              <Button variant="ghost" size="sm" onClick={refreshAll}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <CardDescription>
              Продукты из очереди bePaid, для которых ещё не настроено соответствие
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {unmappedProducts.map((unmapped) => {
                // Find matching queue product for additional info
                const queueProduct = queueProductNames?.find(p => p.name === unmapped.bepaid_plan_title);
                return (
                  <div
                    key={unmapped.bepaid_plan_title}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{unmapped.bepaid_plan_title}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                          {unmapped.sample_description && (
                            <span className="truncate max-w-[200px]">{unmapped.sample_description}</span>
                          )}
                          {queueProduct && queueProduct.amounts.length > 0 && (
                            <Badge variant="outline">{queueProduct.amounts.join(", ")} BYN</Badge>
                          )}
                          <Badge variant="secondary">{unmapped.count} записей</Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {queueProduct && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewQueueRecords(unmapped.bepaid_plan_title)}
                          title="Просмотреть записи из очереди"
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1">
                                <Eye className="h-4 w-4" />
                                <span className="text-xs">{queueProduct.count}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px]">
                              <div className="space-y-1">
                                <p className="font-medium">Нажмите для просмотра записей</p>
                                {queueProduct.amounts.length > 0 && (
                                  <p>Суммы: {queueProduct.amounts.join(", ")} BYN</p>
                                )}
                                {queueProduct.descriptions.length > 0 && (
                                  <p>Описания: {queueProduct.descriptions.slice(0, 3).join("; ")}</p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEdit(null, unmapped)}
                      >
                        <Link2 className="h-4 w-4 mr-2" />
                        Связать
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing Mappings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Маппинг продуктов bePaid</CardTitle>
              <CardDescription>
                Соответствие названий планов из bePaid продуктам в системе
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refreshAll}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button onClick={() => handleOpenEdit(null)}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить маппинг
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {mappingsLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : mappings.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Нет настроенных маппингов. Добавьте первый маппинг.
            </div>
          ) : (
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название в bePaid</TableHead>
                    <TableHead>Продукт в системе</TableHead>
                    <TableHead>Тариф</TableHead>
                    <TableHead>Опции</TableHead>
                    <TableHead className="w-[100px]">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell>
                        <div className="font-medium">{mapping.bepaid_plan_title}</div>
                        {mapping.bepaid_description && (
                          <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {mapping.bepaid_description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {mapping.product_name ? (
                          <Badge variant="default">{mapping.product_name}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Не задан</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {mapping.tariff_name ? (
                          <Badge variant="secondary">{mapping.tariff_name}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {mapping.is_subscription && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-xs">Подписка</Badge>
                              </TooltipTrigger>
                              <TooltipContent>Рекуррентный платёж</TooltipContent>
                            </Tooltip>
                          )}
                          {mapping.auto_create_order && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-xs text-green-600">
                                  <Check className="h-3 w-3 mr-1" />
                                  Авто
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Автоматическое создание сделок</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(mapping)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(mapping.id)}
                            disabled={isDeleting}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit/Create Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingMapping ? "Редактировать маппинг" : "Новый маппинг"}</DialogTitle>
            <DialogDescription>
              Настройте соответствие продукта bePaid продукту в системе
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="bepaid_plan_title">Название плана в bePaid *</Label>
              <Input
                id="bepaid_plan_title"
                value={newMappingData.bepaid_plan_title || ""}
                onChange={(e) => setNewMappingData({ ...newMappingData, bepaid_plan_title: e.target.value })}
                placeholder="Gorbova Club"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bepaid_description">Альтернативное описание</Label>
              <Input
                id="bepaid_description"
                value={newMappingData.bepaid_description || ""}
                onChange={(e) => setNewMappingData({ ...newMappingData, bepaid_description: e.target.value })}
                placeholder="Для поиска по description"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="product_id">Продукт в системе</Label>
              <Select
                value={newMappingData.product_id || "__none__"}
                onValueChange={(v) => setNewMappingData({ ...newMappingData, product_id: v === "__none__" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите продукт" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Не выбран</SelectItem>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {newMappingData.product_id && allTariffs && allTariffs.filter(t => t.product_id === newMappingData.product_id).length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="tariff_id">Тариф</Label>
                <Select
                  value={newMappingData.tariff_id || "__none__"}
                  onValueChange={(v) => setNewMappingData({ ...newMappingData, tariff_id: v === "__none__" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите тариф" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Не выбран</SelectItem>
                    {allTariffs.filter(t => t.product_id === newMappingData.product_id).map((tariff) => (
                      <SelectItem key={tariff.id} value={tariff.id}>
                        {tariff.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center justify-between">
              <Label htmlFor="is_subscription">Рекуррентный платёж (подписка)</Label>
              <Switch
                id="is_subscription"
                checked={newMappingData.is_subscription || false}
                onCheckedChange={(checked) => setNewMappingData({ ...newMappingData, is_subscription: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="auto_create_order">Автоматически создавать сделки</Label>
              <Switch
                id="auto_create_order"
                checked={newMappingData.auto_create_order ?? true}
                onCheckedChange={(checked) => setNewMappingData({ ...newMappingData, auto_create_order: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Заметки</Label>
              <Input
                id="notes"
                value={newMappingData.notes || ""}
                onChange={(e) => setNewMappingData({ ...newMappingData, notes: e.target.value })}
                placeholder="Дополнительные заметки"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleSave}
              disabled={!newMappingData.bepaid_plan_title || isCreating || isUpdating}
            >
              {isCreating || isUpdating ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {editingMapping ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Queue Records Dialog */}
      <QueueRecordsDialog
        open={queueRecordsOpen}
        onOpenChange={setQueueRecordsOpen}
        productName={selectedProductName}
        dateFilter={dateFilter}
      />

      {/* Unmatched Payments Section */}
      <UnmatchedPaymentsSection
        dateFilter={dateFilter}
        mappings={mappings}
        onRefresh={refreshAll}
      />
    </div>
  );
}
