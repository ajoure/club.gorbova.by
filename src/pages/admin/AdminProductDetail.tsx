import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  ArrowLeft, Plus, Pencil, Trash2, Tag, Clock, CreditCard, 
  Calendar, Users, DollarSign, Percent, Check
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  useProductV2,
  useTariffs, useCreateTariff, useUpdateTariff, useDeleteTariff,
  usePricingStages, useCreatePricingStage, useUpdatePricingStage, useDeletePricingStage,
  useTariffPrices, useCreateTariffPrice, useUpdateTariffPrice, useDeleteTariffPrice,
  usePaymentPlans, useCreatePaymentPlan, useUpdatePaymentPlan, useDeletePaymentPlan,
  useFlows, useCreateFlow, useUpdateFlow, useDeleteFlow,
  PRICING_STAGE_TYPE_LABELS, PAYMENT_PLAN_TYPE_LABELS,
} from "@/hooks/useProductsV2";
import type { Database } from "@/integrations/supabase/types";

type PricingStageType = Database["public"]["Enums"]["pricing_stage_type"];
type PaymentPlanType = Database["public"]["Enums"]["payment_plan_type"];

export default function AdminProductDetail() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();

  const { data: product, isLoading: productLoading } = useProductV2(productId || null);
  const { data: tariffs } = useTariffs(productId);
  const { data: pricingStages } = usePricingStages(productId);
  const { data: flows } = useFlows(productId);

  // Mutations
  const createTariff = useCreateTariff();
  const updateTariff = useUpdateTariff();
  const deleteTariff = useDeleteTariff();
  const createStage = useCreatePricingStage();
  const updateStage = useUpdatePricingStage();
  const deleteStage = useDeletePricingStage();
  const createFlow = useCreateFlow();
  const updateFlow = useUpdateFlow();
  const deleteFlow = useDeleteFlow();

  // Dialog states
  const [tariffDialog, setTariffDialog] = useState<{ open: boolean; editing: any }>({ open: false, editing: null });
  const [stageDialog, setStageDialog] = useState<{ open: boolean; editing: any }>({ open: false, editing: null });
  const [flowDialog, setFlowDialog] = useState<{ open: boolean; editing: any }>({ open: false, editing: null });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string } | null>(null);

  // Tariff form
  const [tariffForm, setTariffForm] = useState({
    code: "",
    name: "",
    description: "",
    access_days: 30,
    trial_enabled: false,
    trial_days: 7,
    trial_price: 0,
    trial_auto_charge: false,
    features: [] as string[],
    is_active: true,
  });

  // Pricing stage form
  const [stageForm, setStageForm] = useState({
    name: "",
    stage_type: "regular" as PricingStageType,
    start_date: "",
    end_date: "",
    is_active: true,
  });

  // Flow form
  const [flowForm, setFlowForm] = useState({
    code: "",
    name: "",
    start_date: "",
    end_date: "",
    max_participants: null as number | null,
    is_default: false,
    is_active: true,
  });

  if (productLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Загрузка...</div>
        </div>
      </AdminLayout>
    );
  }

  if (!product) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-muted-foreground">Продукт не найден</div>
          <Button variant="outline" onClick={() => navigate("/admin/products-v2")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            К списку продуктов
          </Button>
        </div>
      </AdminLayout>
    );
  }

  const openTariffDialog = (tariff?: any) => {
    if (tariff) {
      setTariffForm({
        code: tariff.code,
        name: tariff.name,
        description: tariff.description || "",
        access_days: tariff.access_days,
        trial_enabled: tariff.trial_enabled,
        trial_days: tariff.trial_days || 7,
        trial_price: tariff.trial_price || 0,
        trial_auto_charge: tariff.trial_auto_charge || false,
        features: (tariff.features as string[]) || [],
        is_active: tariff.is_active,
      });
      setTariffDialog({ open: true, editing: tariff });
    } else {
      setTariffForm({
        code: "",
        name: "",
        description: "",
        access_days: 30,
        trial_enabled: false,
        trial_days: 7,
        trial_price: 0,
        trial_auto_charge: false,
        features: [],
        is_active: true,
      });
      setTariffDialog({ open: true, editing: null });
    }
  };

  const handleSaveTariff = async () => {
    if (!tariffForm.code || !tariffForm.name) {
      toast.error("Заполните код и название");
      return;
    }
    
    const data = {
      ...tariffForm,
      product_id: productId!,
      features: tariffForm.features,
    };

    if (tariffDialog.editing) {
      await updateTariff.mutateAsync({ id: tariffDialog.editing.id, ...data });
    } else {
      await createTariff.mutateAsync(data);
    }
    setTariffDialog({ open: false, editing: null });
  };

  const openStageDialog = (stage?: any) => {
    if (stage) {
      setStageForm({
        name: stage.name,
        stage_type: stage.stage_type,
        start_date: stage.start_date ? format(new Date(stage.start_date), "yyyy-MM-dd'T'HH:mm") : "",
        end_date: stage.end_date ? format(new Date(stage.end_date), "yyyy-MM-dd'T'HH:mm") : "",
        is_active: stage.is_active,
      });
      setStageDialog({ open: true, editing: stage });
    } else {
      setStageForm({
        name: "",
        stage_type: "regular",
        start_date: "",
        end_date: "",
        is_active: true,
      });
      setStageDialog({ open: true, editing: null });
    }
  };

  const handleSaveStage = async () => {
    if (!stageForm.name) {
      toast.error("Заполните название");
      return;
    }
    
    const data = {
      ...stageForm,
      product_id: productId!,
      start_date: stageForm.start_date || null,
      end_date: stageForm.end_date || null,
    };

    if (stageDialog.editing) {
      await updateStage.mutateAsync({ id: stageDialog.editing.id, ...data });
    } else {
      await createStage.mutateAsync(data);
    }
    setStageDialog({ open: false, editing: null });
  };

  const openFlowDialog = (flow?: any) => {
    if (flow) {
      setFlowForm({
        code: flow.code,
        name: flow.name,
        start_date: flow.start_date || "",
        end_date: flow.end_date || "",
        max_participants: flow.max_participants,
        is_default: flow.is_default,
        is_active: flow.is_active,
      });
      setFlowDialog({ open: true, editing: flow });
    } else {
      setFlowForm({
        code: "",
        name: "",
        start_date: "",
        end_date: "",
        max_participants: null,
        is_default: false,
        is_active: true,
      });
      setFlowDialog({ open: true, editing: null });
    }
  };

  const handleSaveFlow = async () => {
    if (!flowForm.code || !flowForm.name) {
      toast.error("Заполните код и название");
      return;
    }
    
    const data = {
      ...flowForm,
      product_id: productId!,
      start_date: flowForm.start_date || null,
      end_date: flowForm.end_date || null,
    };

    if (flowDialog.editing) {
      await updateFlow.mutateAsync({ id: flowDialog.editing.id, ...data });
    } else {
      await createFlow.mutateAsync(data);
    }
    setFlowDialog({ open: false, editing: null });
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    
    switch (deleteConfirm.type) {
      case "tariff":
        await deleteTariff.mutateAsync(deleteConfirm.id);
        break;
      case "stage":
        await deleteStage.mutateAsync(deleteConfirm.id);
        break;
      case "flow":
        await deleteFlow.mutateAsync(deleteConfirm.id);
        break;
    }
    setDeleteConfirm(null);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/products-v2")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{product.name}</h1>
              <Badge variant={product.is_active ? "default" : "secondary"}>
                {product.is_active ? "Активен" : "Неактивен"}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Код: <code className="bg-muted px-2 py-0.5 rounded">{product.code}</code>
            </p>
          </div>
        </div>

        <Tabs defaultValue="tariffs">
          <TabsList>
            <TabsTrigger value="tariffs" className="gap-2">
              <Tag className="h-4 w-4" />
              Тарифы
            </TabsTrigger>
            <TabsTrigger value="pricing" className="gap-2">
              <DollarSign className="h-4 w-4" />
              Ценообразование
            </TabsTrigger>
            <TabsTrigger value="flows" className="gap-2">
              <Users className="h-4 w-4" />
              Потоки
            </TabsTrigger>
          </TabsList>

          {/* Tariffs Tab */}
          <TabsContent value="tariffs" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Тарифы</h2>
              <Button onClick={() => openTariffDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить тариф
              </Button>
            </div>

            {!tariffs?.length ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Нет тарифов. Создайте первый тариф для этого продукта.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {tariffs.map((tariff) => (
                  <TariffCard
                    key={tariff.id}
                    tariff={tariff}
                    pricingStages={pricingStages || []}
                    onEdit={() => openTariffDialog(tariff)}
                    onDelete={() => setDeleteConfirm({ type: "tariff", id: tariff.id })}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Pricing Stages Tab */}
          <TabsContent value="pricing" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Этапы ценообразования</h2>
              <Button onClick={() => openStageDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить этап
              </Button>
            </div>

            {!pricingStages?.length ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Нет этапов. Создайте этапы для управления ценами по времени.
                </CardContent>
              </Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Начало</TableHead>
                    <TableHead>Окончание</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pricingStages.map((stage) => (
                    <TableRow key={stage.id}>
                      <TableCell className="font-medium">{stage.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {PRICING_STAGE_TYPE_LABELS[stage.stage_type]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {stage.start_date
                          ? format(new Date(stage.start_date), "dd.MM.yyyy HH:mm", { locale: ru })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {stage.end_date
                          ? format(new Date(stage.end_date), "dd.MM.yyyy HH:mm", { locale: ru })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={stage.is_active ? "default" : "secondary"}>
                          {stage.is_active ? "Активен" : "Неактивен"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openStageDialog(stage)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm({ type: "stage", id: stage.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          {/* Flows Tab */}
          <TabsContent value="flows" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Потоки</h2>
              <Button onClick={() => openFlowDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить поток
              </Button>
            </div>

            {!flows?.length ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Нет потоков. Потоки нужны для запуска продукта в разное время.
                </CardContent>
              </Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Код</TableHead>
                    <TableHead>Название</TableHead>
                    <TableHead>Период</TableHead>
                    <TableHead>Участники</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flows.map((flow) => (
                    <TableRow key={flow.id}>
                      <TableCell>
                        <code className="bg-muted px-2 py-0.5 rounded text-sm">{flow.code}</code>
                      </TableCell>
                      <TableCell className="font-medium">
                        {flow.name}
                        {flow.is_default && (
                          <Badge variant="outline" className="ml-2">По умолчанию</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {flow.start_date && flow.end_date ? (
                          `${format(new Date(flow.start_date), "dd.MM.yy")} — ${format(new Date(flow.end_date), "dd.MM.yy")}`
                        ) : flow.start_date ? (
                          `с ${format(new Date(flow.start_date), "dd.MM.yy")}`
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {flow.max_participants ? `макс. ${flow.max_participants}` : "∞"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={flow.is_active ? "default" : "secondary"}>
                          {flow.is_active ? "Активен" : "Неактивен"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openFlowDialog(flow)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteConfirm({ type: "flow", id: flow.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Tariff Dialog */}
      <Dialog open={tariffDialog.open} onOpenChange={(open) => setTariffDialog({ ...tariffDialog, open })}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {tariffDialog.editing ? "Редактировать тариф" : "Новый тариф"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Код *</Label>
              <Input
                placeholder="base"
                value={tariffForm.code}
                onChange={(e) => setTariffForm({ ...tariffForm, code: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Название *</Label>
              <Input
                placeholder="Базовый"
                value={tariffForm.name}
                onChange={(e) => setTariffForm({ ...tariffForm, name: e.target.value })}
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Описание</Label>
              <Textarea
                value={tariffForm.description}
                onChange={(e) => setTariffForm({ ...tariffForm, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Дней доступа</Label>
              <Input
                type="number"
                value={tariffForm.access_days}
                onChange={(e) => setTariffForm({ ...tariffForm, access_days: parseInt(e.target.value) || 30 })}
              />
            </div>
            <div className="flex items-center space-x-2 pt-6">
              <Switch
                checked={tariffForm.is_active}
                onCheckedChange={(checked) => setTariffForm({ ...tariffForm, is_active: checked })}
              />
              <Label>Активен</Label>
            </div>
          </div>

          <div className="border-t pt-4 mt-4">
            <div className="flex items-center space-x-2 mb-4">
              <Switch
                checked={tariffForm.trial_enabled}
                onCheckedChange={(checked) => setTariffForm({ ...tariffForm, trial_enabled: checked })}
              />
              <Label>Пробный период</Label>
            </div>

            {tariffForm.trial_enabled && (
              <div className="grid grid-cols-3 gap-4 pl-6">
                <div className="space-y-2">
                  <Label>Дней пробного</Label>
                  <Input
                    type="number"
                    value={tariffForm.trial_days}
                    onChange={(e) => setTariffForm({ ...tariffForm, trial_days: parseInt(e.target.value) || 7 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Цена пробного (BYN)</Label>
                  <Input
                    type="number"
                    value={tariffForm.trial_price}
                    onChange={(e) => setTariffForm({ ...tariffForm, trial_price: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="flex items-center space-x-2 pt-6">
                  <Switch
                    checked={tariffForm.trial_auto_charge}
                    onCheckedChange={(checked) => setTariffForm({ ...tariffForm, trial_auto_charge: checked })}
                  />
                  <Label>Автосписание</Label>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTariffDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveTariff}>
              {tariffDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pricing Stage Dialog */}
      <Dialog open={stageDialog.open} onOpenChange={(open) => setStageDialog({ ...stageDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {stageDialog.editing ? "Редактировать этап" : "Новый этап"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Название *</Label>
              <Input
                placeholder="Ранняя цена до 15 января"
                value={stageForm.name}
                onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Тип этапа</Label>
              <Select
                value={stageForm.stage_type}
                onValueChange={(v) => setStageForm({ ...stageForm, stage_type: v as PricingStageType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRICING_STAGE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Дата начала</Label>
                <Input
                  type="datetime-local"
                  value={stageForm.start_date}
                  onChange={(e) => setStageForm({ ...stageForm, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Дата окончания</Label>
                <Input
                  type="datetime-local"
                  value={stageForm.end_date}
                  onChange={(e) => setStageForm({ ...stageForm, end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={stageForm.is_active}
                onCheckedChange={(checked) => setStageForm({ ...stageForm, is_active: checked })}
              />
              <Label>Активен</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStageDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveStage}>
              {stageDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flow Dialog */}
      <Dialog open={flowDialog.open} onOpenChange={(open) => setFlowDialog({ ...flowDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {flowDialog.editing ? "Редактировать поток" : "Новый поток"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Код *</Label>
                <Input
                  placeholder="flow_jan_2026"
                  value={flowForm.code}
                  onChange={(e) => setFlowForm({ ...flowForm, code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input
                  placeholder="Поток январь 2026"
                  value={flowForm.name}
                  onChange={(e) => setFlowForm({ ...flowForm, name: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Дата старта</Label>
                <Input
                  type="date"
                  value={flowForm.start_date}
                  onChange={(e) => setFlowForm({ ...flowForm, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Дата окончания</Label>
                <Input
                  type="date"
                  value={flowForm.end_date}
                  onChange={(e) => setFlowForm({ ...flowForm, end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Макс. участников (пусто = без ограничений)</Label>
              <Input
                type="number"
                value={flowForm.max_participants || ""}
                onChange={(e) => setFlowForm({ 
                  ...flowForm, 
                  max_participants: e.target.value ? parseInt(e.target.value) : null 
                })}
              />
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={flowForm.is_default}
                  onCheckedChange={(checked) => setFlowForm({ ...flowForm, is_default: checked })}
                />
                <Label>По умолчанию</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={flowForm.is_active}
                  onCheckedChange={(checked) => setFlowForm({ ...flowForm, is_active: checked })}
                />
                <Label>Активен</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFlowDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveFlow}>
              {flowDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подтвердите удаление</DialogTitle>
            <DialogDescription>
              Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

// Tariff Card Component
function TariffCard({ 
  tariff, 
  pricingStages,
  onEdit, 
  onDelete 
}: { 
  tariff: any;
  pricingStages: any[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { data: prices } = useTariffPrices(tariff.id);
  const { data: paymentPlans } = usePaymentPlans(tariff.id);
  
  const createPrice = useCreateTariffPrice();
  const updatePrice = useUpdateTariffPrice();
  const deletePrice = useDeleteTariffPrice();
  const createPlan = useCreatePaymentPlan();
  const updatePlan = useUpdatePaymentPlan();
  const deletePlan = useDeletePaymentPlan();

  const [priceDialog, setPriceDialog] = useState<{ open: boolean; editing: any }>({ open: false, editing: null });
  const [planDialog, setPlanDialog] = useState<{ open: boolean; editing: any }>({ open: false, editing: null });

  const [priceForm, setPriceForm] = useState({
    pricing_stage_id: null as string | null,
    price: 0,
    currency: "BYN",
    discount_enabled: false,
    discount_percent: 0,
    is_active: true,
  });

  const [planForm, setPlanForm] = useState({
    name: "",
    plan_type: "full" as PaymentPlanType,
    installments_count: 1,
    first_payment_percent: 100,
    grants_access_immediately: true,
    is_active: true,
  });

  const openPriceDialog = (price?: any) => {
    if (price) {
      setPriceForm({
        pricing_stage_id: price.pricing_stage_id,
        price: price.price,
        currency: price.currency,
        discount_enabled: price.discount_enabled,
        discount_percent: price.discount_percent || 0,
        is_active: price.is_active,
      });
      setPriceDialog({ open: true, editing: price });
    } else {
      setPriceForm({
        pricing_stage_id: null,
        price: 0,
        currency: "BYN",
        discount_enabled: false,
        discount_percent: 0,
        is_active: true,
      });
      setPriceDialog({ open: true, editing: null });
    }
  };

  const handleSavePrice = async () => {
    const data = {
      ...priceForm,
      tariff_id: tariff.id,
    };

    if (priceDialog.editing) {
      await updatePrice.mutateAsync({ id: priceDialog.editing.id, ...data });
    } else {
      await createPrice.mutateAsync(data);
    }
    setPriceDialog({ open: false, editing: null });
  };

  const openPlanDialog = (plan?: any) => {
    if (plan) {
      setPlanForm({
        name: plan.name,
        plan_type: plan.plan_type,
        installments_count: plan.installments_count || 1,
        first_payment_percent: plan.first_payment_percent || 100,
        grants_access_immediately: plan.grants_access_immediately,
        is_active: plan.is_active,
      });
      setPlanDialog({ open: true, editing: plan });
    } else {
      setPlanForm({
        name: "",
        plan_type: "full",
        installments_count: 1,
        first_payment_percent: 100,
        grants_access_immediately: true,
        is_active: true,
      });
      setPlanDialog({ open: true, editing: null });
    }
  };

  const handleSavePlan = async () => {
    if (!planForm.name) {
      toast.error("Заполните название");
      return;
    }

    const data = {
      ...planForm,
      tariff_id: tariff.id,
    };

    if (planDialog.editing) {
      await updatePlan.mutateAsync({ id: planDialog.editing.id, ...data });
    } else {
      await createPlan.mutateAsync(data);
    }
    setPlanDialog({ open: false, editing: null });
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {tariff.name}
                <Badge variant={tariff.is_active ? "default" : "secondary"}>
                  {tariff.is_active ? "Активен" : "Неактивен"}
                </Badge>
                {tariff.trial_enabled && (
                  <Badge variant="outline">Trial {tariff.trial_days} дней</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Код: <code>{tariff.code}</code> • Доступ: {tariff.access_days} дней
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            {/* Prices */}
            <AccordionItem value="prices">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Цены ({prices?.length || 0})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <Button size="sm" variant="outline" onClick={() => openPriceDialog()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить цену
                  </Button>

                  {prices?.map((price) => (
                    <div key={price.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="font-medium">
                          {price.price} {price.currency}
                          {price.discount_enabled && price.discount_percent && (
                            <span className="text-green-600 ml-2">
                              -{price.discount_percent}% = {price.final_price} {price.currency}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {(price as any).pricing_stages?.name || "Базовая цена"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={price.is_active ? "default" : "secondary"}>
                          {price.is_active ? "Активна" : "Неактивна"}
                        </Badge>
                        <Button variant="ghost" size="icon" onClick={() => openPriceDialog(price)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deletePrice.mutate(price.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Payment Plans */}
            <AccordionItem value="plans">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  Планы оплаты ({paymentPlans?.length || 0})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <Button size="sm" variant="outline" onClick={() => openPlanDialog()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить план
                  </Button>

                  {paymentPlans?.map((plan) => (
                    <div key={plan.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="font-medium">{plan.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {PAYMENT_PLAN_TYPE_LABELS[plan.plan_type]}
                          {plan.plan_type === "installment" && ` • ${plan.installments_count} платежей`}
                          {plan.grants_access_immediately && " • Доступ сразу"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={plan.is_active ? "default" : "secondary"}>
                          {plan.is_active ? "Активен" : "Неактивен"}
                        </Badge>
                        <Button variant="ghost" size="icon" onClick={() => openPlanDialog(plan)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deletePlan.mutate(plan.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Price Dialog */}
      <Dialog open={priceDialog.open} onOpenChange={(open) => setPriceDialog({ ...priceDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {priceDialog.editing ? "Редактировать цену" : "Новая цена"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Этап ценообразования</Label>
              <Select
                value={priceForm.pricing_stage_id || "none"}
                onValueChange={(v) => setPriceForm({ ...priceForm, pricing_stage_id: v === "none" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Базовая цена" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Базовая цена</SelectItem>
                  {pricingStages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Цена</Label>
                <Input
                  type="number"
                  value={priceForm.price}
                  onChange={(e) => setPriceForm({ ...priceForm, price: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Валюта</Label>
                <Select
                  value={priceForm.currency}
                  onValueChange={(v) => setPriceForm({ ...priceForm, currency: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BYN">BYN</SelectItem>
                    <SelectItem value="RUB">RUB</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={priceForm.discount_enabled}
                onCheckedChange={(checked) => setPriceForm({ ...priceForm, discount_enabled: checked })}
              />
              <Label>Скидка</Label>
            </div>
            {priceForm.discount_enabled && (
              <div className="space-y-2">
                <Label>Процент скидки</Label>
                <Input
                  type="number"
                  value={priceForm.discount_percent}
                  onChange={(e) => setPriceForm({ ...priceForm, discount_percent: parseFloat(e.target.value) || 0 })}
                />
              </div>
            )}
            <div className="flex items-center space-x-2">
              <Switch
                checked={priceForm.is_active}
                onCheckedChange={(checked) => setPriceForm({ ...priceForm, is_active: checked })}
              />
              <Label>Активна</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSavePrice}>
              {priceDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Plan Dialog */}
      <Dialog open={planDialog.open} onOpenChange={(open) => setPlanDialog({ ...planDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {planDialog.editing ? "Редактировать план" : "Новый план оплаты"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Название *</Label>
              <Input
                placeholder="Полная оплата"
                value={planForm.name}
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Тип плана</Label>
              <Select
                value={planForm.plan_type}
                onValueChange={(v) => setPlanForm({ ...planForm, plan_type: v as PaymentPlanType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_PLAN_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {planForm.plan_type === "installment" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Количество платежей</Label>
                  <Input
                    type="number"
                    value={planForm.installments_count}
                    onChange={(e) => setPlanForm({ ...planForm, installments_count: parseInt(e.target.value) || 1 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Первый платёж (%)</Label>
                  <Input
                    type="number"
                    value={planForm.first_payment_percent}
                    onChange={(e) => setPlanForm({ ...planForm, first_payment_percent: parseFloat(e.target.value) || 100 })}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-6">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={planForm.grants_access_immediately}
                  onCheckedChange={(checked) => setPlanForm({ ...planForm, grants_access_immediately: checked })}
                />
                <Label>Доступ сразу</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={planForm.is_active}
                  onCheckedChange={(checked) => setPlanForm({ ...planForm, is_active: checked })}
                />
                <Label>Активен</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSavePlan}>
              {planDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
