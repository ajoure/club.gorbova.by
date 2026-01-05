import { useState } from "react";
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
import { Plus, Pencil, Trash2, Package, Tag, Clock, CreditCard, Users, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { useProductsV2, useCreateProductV2, useUpdateProductV2, useDeleteProductV2 } from "@/hooks/useProductsV2";
import { useTelegramClubs } from "@/hooks/useTelegramIntegration";
import { useNavigate } from "react-router-dom";

interface ProductFormData {
  code: string;
  name: string;
  description: string;
  telegram_club_id: string | null;
  is_active: boolean;
}

const defaultFormData: ProductFormData = {
  code: "",
  name: "",
  description: "",
  telegram_club_id: null,
  is_active: true,
};

export default function AdminProductsV2() {
  const navigate = useNavigate();
  const { data: products, isLoading } = useProductsV2();
  const { data: clubs } = useTelegramClubs();
  const createMutation = useCreateProductV2();
  const updateMutation = useUpdateProductV2();
  const deleteMutation = useDeleteProductV2();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleOpenDialog = (product?: any) => {
    if (product) {
      setEditingProduct(product.id);
      setFormData({
        code: product.code,
        name: product.name,
        description: product.description || "",
        telegram_club_id: product.telegram_club_id,
        is_active: product.is_active,
      });
    } else {
      setEditingProduct(null);
      setFormData(defaultFormData);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
    setFormData(defaultFormData);
  };

  const handleSubmit = async () => {
    if (!formData.code || !formData.name) {
      toast.error("Заполните код и название");
      return;
    }

    if (editingProduct) {
      await updateMutation.mutateAsync({ id: editingProduct, ...formData });
    } else {
      await createMutation.mutateAsync(formData);
    }
    handleCloseDialog();
  };

  const handleDelete = async () => {
    if (deleteConfirmId) {
      await deleteMutation.mutateAsync(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const copyProductId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("ID скопирован");
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Продукты v2</h1>
            <p className="text-muted-foreground">
              Управление продуктами, тарифами и ценами
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить продукт
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{products?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">Всего продуктов</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-green-500/10 rounded-lg">
                  <Package className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {products?.filter(p => p.is_active).length || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">Активных</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Users className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {products?.filter(p => p.telegram_club_id).length || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">С Telegram клубом</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-purple-500/10 rounded-lg">
                  <Tag className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">—</p>
                  <p className="text-sm text-muted-foreground">Тарифов</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Products Table */}
        <Card>
          <CardHeader>
            <CardTitle>Список продуктов</CardTitle>
            <CardDescription>
              Нажмите на продукт для настройки тарифов и цен
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : !products?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                Нет продуктов. Создайте первый продукт.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Код</TableHead>
                    <TableHead>Название</TableHead>
                    <TableHead>Telegram клуб</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow 
                      key={product.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/admin/products-v2/${product.id}`)}
                    >
                      <TableCell>
                        <code className="text-sm bg-muted px-2 py-1 rounded">
                          {product.code}
                        </code>
                      </TableCell>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>
                        {(product as any).telegram_clubs?.name || (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.is_active ? "default" : "secondary"}>
                          {product.is_active ? "Активен" : "Неактивен"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyProductId(product.id);
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDialog(product);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(product.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Редактировать продукт" : "Новый продукт"}
            </DialogTitle>
            <DialogDescription>
              {editingProduct
                ? "Измените данные продукта"
                : "Заполните данные нового продукта"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Код *</Label>
                <Input
                  placeholder="gorbova_club"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input
                  placeholder="Gorbova Club"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea
                placeholder="Описание продукта..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Telegram клуб</Label>
              <Select
                value={formData.telegram_club_id || "none"}
                onValueChange={(v) =>
                  setFormData({ ...formData, telegram_club_id: v === "none" ? null : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите клуб" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не привязан</SelectItem>
                  {clubs?.map((club) => (
                    <SelectItem key={club.id} value={club.id}>
                      {club.club_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
              <Label>Активен</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Отмена
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingProduct ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить продукт?</DialogTitle>
            <DialogDescription>
              Это действие нельзя отменить. Все связанные тарифы и данные будут удалены.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
