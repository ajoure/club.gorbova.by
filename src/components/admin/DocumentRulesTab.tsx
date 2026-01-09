import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Edit, FileText, Zap, Mail, Send } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useDocumentRules, TRIGGER_TYPE_LABELS, PAYER_TYPE_OPTIONS, DocumentGenerationRule } from "@/hooks/useDocumentRules";
import { useDocumentTemplates } from "@/hooks/useDocumentTemplates";
import { useProductsV2 } from "@/hooks/useProductsV2";
import { useTariffs } from "@/hooks/useProductsV2";

interface RuleFormData {
  name: string;
  description: string;
  product_id: string;
  tariff_id: string;
  trigger_type: string;
  template_id: string;
  auto_send_email: boolean;
  auto_send_telegram: boolean;
  payer_type_filter: string[];
  priority: number;
  is_active: boolean;
}

const defaultFormData: RuleFormData = {
  name: "",
  description: "",
  product_id: "",
  tariff_id: "",
  trigger_type: "payment_success",
  template_id: "",
  auto_send_email: true,
  auto_send_telegram: false,
  payer_type_filter: [],
  priority: 0,
  is_active: true,
};

export function DocumentRulesTab() {
  const { rules, isLoading, createRule, updateRule, deleteRule, isCreating, isUpdating } = useDocumentRules();
  const { templates } = useDocumentTemplates();
  const { data: products = [] } = useProductsV2();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RuleFormData>(defaultFormData);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: tariffs = [] } = useTariffs(formData.product_id || undefined);

  const handleOpenDialog = (rule?: DocumentGenerationRule) => {
    if (rule) {
      setEditingId(rule.id);
      setFormData({
        name: rule.name,
        description: rule.description || "",
        product_id: rule.product_id || "",
        tariff_id: rule.tariff_id || "",
        trigger_type: rule.trigger_type,
        template_id: rule.template_id,
        auto_send_email: rule.auto_send_email,
        auto_send_telegram: rule.auto_send_telegram,
        payer_type_filter: rule.payer_type_filter || [],
        priority: rule.priority,
        is_active: rule.is_active,
      });
    } else {
      setEditingId(null);
      setFormData(defaultFormData);
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.template_id) {
      return;
    }

    try {
      const payload = {
        name: formData.name,
        description: formData.description || null,
        product_id: formData.product_id || null,
        tariff_id: formData.tariff_id || null,
        offer_id: null,
        trigger_type: formData.trigger_type as DocumentGenerationRule['trigger_type'],
        template_id: formData.template_id,
        field_overrides: {},
        auto_send_email: formData.auto_send_email,
        auto_send_telegram: formData.auto_send_telegram,
        payer_type_filter: formData.payer_type_filter.length > 0 ? formData.payer_type_filter : null,
        min_amount: null,
        max_amount: null,
        priority: formData.priority,
        is_active: formData.is_active,
      };

      if (editingId) {
        await updateRule({ id: editingId, ...payload });
      } else {
        await createRule(payload);
      }
      handleCloseDialog();
    } catch (error) {
      console.error("Submit error:", error);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteRule(deleteId);
      setDeleteId(null);
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  const togglePayerType = (value: string) => {
    const current = formData.payer_type_filter;
    if (current.includes(value)) {
      setFormData({ ...formData, payer_type_filter: current.filter(v => v !== value) });
    } else {
      setFormData({ ...formData, payer_type_filter: [...current, value] });
    }
  };

  const getTriggerBadge = (trigger: string) => {
    const colorMap: Record<string, string> = {
      payment_success: "default",
      trial_started: "secondary",
      installment_payment: "outline",
      installment_first: "outline",
      installment_last: "outline",
      manual: "secondary",
    };
    return <Badge variant={colorMap[trigger] as any}>{TRIGGER_TYPE_LABELS[trigger] || trigger}</Badge>;
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Правила генерации</CardTitle>
            <CardDescription>
              Настройка автоматической генерации документов при оплате
            </CardDescription>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить правило
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Правила не настроены</p>
              <p className="text-sm">Создайте первое правило для автогенерации документов</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Триггер</TableHead>
                  <TableHead>Продукт / Тариф</TableHead>
                  <TableHead>Шаблон</TableHead>
                  <TableHead>Отправка</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <div className="font-medium">{rule.name}</div>
                      {rule.description && (
                        <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                          {rule.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{getTriggerBadge(rule.trigger_type)}</TableCell>
                    <TableCell>
                      {rule.product?.name || rule.tariff?.name ? (
                        <div className="text-sm">
                          {rule.product?.name && <div>{rule.product.name}</div>}
                          {rule.tariff?.name && (
                            <div className="text-muted-foreground">{rule.tariff.name}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Все</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{rule.template?.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {rule.auto_send_email && (
                          <Badge variant="outline" className="text-xs">
                            <Mail className="h-3 w-3 mr-1" />
                            Email
                          </Badge>
                        )}
                        {rule.auto_send_telegram && (
                          <Badge variant="outline" className="text-xs">
                            <Send className="h-3 w-3 mr-1" />
                            TG
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rule.is_active ? "default" : "secondary"}>
                        {rule.is_active ? "Активно" : "Выкл"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(rule)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteId(rule.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Редактировать правило" : "Новое правило"}
            </DialogTitle>
            <DialogDescription>
              Настройте условия автоматической генерации документа
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Название *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Счёт-акт при оплате курса"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Описание</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Триггер *</Label>
                <Select
                  value={formData.trigger_type}
                  onValueChange={(v) => setFormData({ ...formData, trigger_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRIGGER_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Шаблон *</Label>
                <Select
                  value={formData.template_id}
                  onValueChange={(v) => setFormData({ ...formData, template_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите шаблон" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.filter(t => t.is_active).map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Продукт (опционально)</Label>
                <Select
                  value={formData.product_id}
                  onValueChange={(v) => setFormData({ ...formData, product_id: v, tariff_id: "" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Все продукты" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Все продукты</SelectItem>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Тариф (опционально)</Label>
                <Select
                  value={formData.tariff_id}
                  onValueChange={(v) => setFormData({ ...formData, tariff_id: v })}
                  disabled={!formData.product_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Все тарифы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Все тарифы</SelectItem>
                    {tariffs.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Тип плательщика (пусто = все)</Label>
              <div className="flex flex-wrap gap-4 pt-2">
                {PAYER_TYPE_OPTIONS.map(opt => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`payer-${opt.value}`}
                      checked={formData.payer_type_filter.includes(opt.value)}
                      onCheckedChange={() => togglePayerType(opt.value)}
                    />
                    <Label htmlFor={`payer-${opt.value}`} className="font-normal cursor-pointer">
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Приоритет (выше = применяется первым)</Label>
              <Input
                id="priority"
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
              />
            </div>

            <div className="flex flex-col gap-4 pt-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="send_email">Отправлять на Email</Label>
                <Switch
                  id="send_email"
                  checked={formData.auto_send_email}
                  onCheckedChange={(checked) => setFormData({ ...formData, auto_send_email: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="send_telegram">Отправлять в Telegram</Label>
                <Switch
                  id="send_telegram"
                  checked={formData.auto_send_telegram}
                  onCheckedChange={(checked) => setFormData({ ...formData, auto_send_telegram: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="is_active">Активно</Label>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Отмена
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isCreating || isUpdating || !formData.name || !formData.template_id}
            >
              {editingId ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить правило?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
